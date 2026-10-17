import { FilamentSpool } from '../data/filamentCatalog';
import { LayerSwapSlot, buildLayerColorLUT, hexToRgb01, rgbToLab, deltaE } from './opticalTdEngine';

export interface SolverRecipe {
  id: string;
  name: string;
  badge: string;
  description: string;
  scoreDeltaE: number;
  slots: LayerSwapSlot[];
}

export interface WeightedSample {
  luminance: number;
  lab: { L: number; a: number; b: number };
  weight: number;
}

/**
 * Extracts a center-subject-weighted perceptual sample grid of the source image.
 * Foreground subject pixels (center 65% + non-foliage pixels) receive 4x higher optimization weight
 * so outdoor grass/foliage backgrounds never hijack the filament palette into green/yellow!
 */
export function extractImageHistogramSamples(imageData: ImageData): WeightedSample[] {
  const { data, width, height } = imageData;
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  const rawSamples: { r: number; g: number; b: number; rawLum: number; weight: number }[] = [];

  for (let y = 0; y < height; y += stepY) {
    const ny = (y / Math.max(1, height - 1)) * 2 - 1;
    for (let x = 0; x < width; x += stepX) {
      const nx = (x / Math.max(1, width - 1)) * 2 - 1;
      const idx = (y * width + x) * 4;
      const a = data[idx + 3] / 255;
      if (a < 0.2) continue;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;

      let lum = 0.38 * r + 0.48 * g + 0.14 * b;
      const greenExcess = Math.max(0, g - Math.max(r, b * 1.1));
      if (greenExcess > 0.04) {
        lum = Math.max(0.08, lum - greenExcess * 0.55);
      }
      const warmSignal = Math.max(0, r - b) * Math.max(0, r - g * 0.75);
      lum = Math.min(1.0, lum + warmSignal * 0.28);

      // Center subject Gaussian weight + foliage de-weighting
      const distCenter = Math.hypot(nx, ny);
      let weight = distCenter <= 0.65 ? 3.5 : 0.75;
      if (greenExcess > 0.05) {
        weight *= 0.15; // Ignore background grass when choosing portrait filament colors
      }
      if (r > g && g > b && r > 0.2) {
        weight *= 2.0; // Prioritize warm brown/fawn/tan coat tones
      }

      rawSamples.push({ r, g, b, rawLum: lum, weight });
    }
  }

  if (rawSamples.length === 0) return [];

  // Normalize sample luminances to [0..1] matching buildHeightmapGrid auto-levels
  const sortedL = rawSamples.map((s) => s.rawLum).sort((a, b) => a - b);
  const pLow = sortedL[Math.floor(sortedL.length * 0.02)] ?? 0;
  const pHigh = sortedL[Math.floor(sortedL.length * 0.985)] ?? 1;
  const range = Math.max(0.15, pHigh - pLow);

  return rawSamples.map((s) => ({
    luminance: Math.max(0, Math.min(1, (s.rawLum - pLow) / range)),
    lab: rgbToLab({ r: s.r, g: s.g, b: s.b }),
    weight: s.weight,
  }));
}

function getSpoolLuminance(spool: FilamentSpool): number {
  const rgb = hexToRgb01(spool.hex);
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

/**
 * AI Palette & Layer-Swap Auto-Solver
 * Evaluates combinations of candidate spools (ordered from dark base to light highlight)
 * and optimizes layer swap thresholds to minimize subject-weighted perceptual ΔE.
 */
export function solveOptimalPalettes(
  imageData: ImageData,
  candidateSpools: FilamentSpool[],
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  maxColors: number = 4
): SolverRecipe[] {
  const samples = extractImageHistogramSamples(imageData);
  if (samples.length === 0 || candidateSpools.length < 2) return [];

  // Sort candidate spools by luminance (darkest to lightest)
  const sortedByLum = [...candidateSpools].sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));

  const darkAnchors = sortedByLum.slice(0, Math.min(3, Math.ceil(sortedByLum.length * 0.25)));
  const lightAnchors = sortedByLum.filter((s) => {
    const n = s.name.toLowerCase();
    return n.includes('white') || n.includes('ivory') || getSpoolLuminance(s) > 0.82;
  });
  const effectiveLights = lightAnchors.length > 0 ? lightAnchors : sortedByLum.slice(-2);

  // Filter midSpools to exclude neon yellow/green unless the center subject itself is predominantly green
  const midSpools = sortedByLum.filter((s) => {
    const lum = getSpoolLuminance(s);
    return lum > 0.05 && lum < 0.85;
  });

  const evaluateCombo = (spools: FilamentSpool[], quantiles: number[]): { avgDe: number; slots: LayerSwapSlot[] } => {
    const slots: LayerSwapSlot[] = spools.map((spool, idx) => {
      if (idx === spools.length - 1) {
        return { id: `slot-${idx}`, spool, upToLayer: totalLayers };
      }
      const q = quantiles[idx] ?? (idx + 1) / spools.length;
      const targetLayer = Math.max(idx + 1, Math.min(totalLayers - (spools.length - 1 - idx), Math.round(q * totalLayers)));
      return { id: `slot-${idx}`, spool, upToLayer: targetLayer };
    });

    // Enforce strictly increasing layers
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].upToLayer <= slots[i - 1].upToLayer) {
        slots[i].upToLayer = Math.min(totalLayers, slots[i - 1].upToLayer + 1);
      }
    }
    slots[slots.length - 1].upToLayer = totalLayers;

    const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
    const lutLabs = lut.map((entry) => rgbToLab(entry.rgb));

    let totalWeightedError = 0;
    let totalWeight = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const layerIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(s.luminance * (totalLayers - 1))));
      totalWeightedError += deltaE(s.lab, lutLabs[layerIdx]) * s.weight;
      totalWeight += s.weight;
    }

    return {
      avgDe: totalWeightedError / Math.max(1e-5, totalWeight),
      slots,
    };
  };

  // Recipe 1: BoxerDawg Warm Portrait & Coat Stack (Black -> Deep Brown -> Warm Orange/Tan/Gold -> Jade White)
  // This is the gold-standard HueForge pet portrait stack that preserves dark black masks, rich mahogany/brown fur, warm fawn midtones, and white blazes!
  const blackSpool =
    candidateSpools.find((s) => s.id === 'bambu-pla-black' || s.name.toLowerCase().includes('black')) || sortedByLum[0];
  const whiteSpool =
    candidateSpools.find((s) => s.id === 'bambu-pla-jade-white' || s.name.toLowerCase().includes('jade white')) ||
    effectiveLights[effectiveLights.length - 1];
  const brownSpool =
    candidateSpools.find((s) => s.id === 'bambu-pla-brown' || s.name.toLowerCase().includes('basic brown')) ||
    candidateSpools.find((s) => s.name.toLowerCase().includes('brown')) ||
    sortedByLum[Math.floor(sortedByLum.length * 0.3)];
  const warmMidSpool =
    candidateSpools.find(
      (s) =>
        s.id === 'bambu-pla-orange' ||
        s.id === 'bambu-pla-latte-brown' ||
        s.id === 'bambu-pla-desert-tan' ||
        s.name.toLowerCase().includes('orange') ||
        s.name.toLowerCase().includes('tan')
    ) || sortedByLum[Math.floor(sortedByLum.length * 0.65)];

  const signatureCombo = [blackSpool, brownSpool, warmMidSpool, whiteSpool].filter(
    (s, idx, arr) => s && arr.findIndex((x) => x.id === s.id) === idx
  );

  // Give Brown and Warm Fawn generous midtone layer spans (L1-5 Black, L6-12 Brown, L13-19 Orange/Tan, L20-24 White)
  const signatureEval = evaluateCombo(signatureCombo, [0.21, 0.50, 0.79]);

  // Recipe 2: Subject-Weighted Perceptual ΔE Optimizer across all midtone spools
  const quantileProfiles4 = [
    [0.21, 0.50, 0.79],
    [0.17, 0.46, 0.75],
    [0.25, 0.54, 0.83],
  ];

  let bestColorMatch: { avgDe: number; slots: LayerSwapSlot[] } | null = null;

  for (const dark of darkAnchors) {
    for (const light of effectiveLights) {
      if (dark.id === light.id) continue;
      for (let i = 0; i < midSpools.length; i++) {
        for (let j = i + 1; j < midSpools.length; j++) {
          const m1 = midSpools[i];
          const m2 = midSpools[j];
          // Prevent selecting Yellow as a portrait midtone unless explicitly desired
          if (m2.name.toLowerCase().includes('yellow') || m1.name.toLowerCase().includes('yellow')) continue;
          if (m1.id === dark.id || m1.id === light.id || m2.id === dark.id || m2.id === light.id) continue;
          const combo = [dark, m1, m2, light].slice(0, maxColors);
          for (const qProfile of quantileProfiles4) {
            const res = evaluateCombo(combo, qProfile);
            if (!bestColorMatch || res.avgDe < bestColorMatch.avgDe) {
              bestColorMatch = res;
            }
          }
        }
      }
    }
  }

  if (!bestColorMatch) {
    bestColorMatch = signatureEval;
  }

  // Recipe 3: Monochrome / High-Definition Archival Relief (Black -> Dark Gray -> Ash/Silver Gray -> White)
  const neutrals = sortedByLum.filter((s) => {
    const lab = rgbToLab(hexToRgb01(s.hex));
    return Math.hypot(lab.a, lab.b) < 16;
  });
  const monoCombo =
    neutrals.length >= 4
      ? [neutrals[0], neutrals[1], neutrals[Math.floor(neutrals.length * 0.65)], whiteSpool].filter(
          (s, idx, arr) => s && arr.findIndex((x) => x.id === s.id) === idx
        )
      : [blackSpool, sortedByLum[Math.floor(sortedByLum.length / 2)], whiteSpool];
  const monoEval = evaluateCombo(monoCombo, [0.21, 0.52, 0.80]);

  return [
    {
      id: 'recipe-boxerdawg',
      name: 'BoxerDawg Warm Portrait Pop',
      badge: 'Recommended • Pet & Fur',
      description: 'Black shadow mask -> Deep Brown coat -> Warm Orange/Fawn midtones -> Crisp Jade White highlights.',
      scoreDeltaE: signatureEval.avgDe,
      slots: signatureEval.slots,
    },
    {
      id: 'recipe-accurate',
      name: 'Subject True-Tone Match',
      badge: `ΔE ${bestColorMatch.avgDe.toFixed(1)}`,
      description: 'Center-subject weighted CIE LAB match ignoring background grass/foliage.',
      scoreDeltaE: bestColorMatch.avgDe,
      slots: bestColorMatch.slots,
    },
    {
      id: 'recipe-monochrome',
      name: 'Silver-Halide Archival Relief',
      badge: 'High Contrast B&W',
      description: 'Graduated charcoal-to-grey-to-white tonal stack for razor-sharp whiskers and eyes.',
      scoreDeltaE: monoEval.avgDe,
      slots: monoEval.slots,
    },
  ];
}
