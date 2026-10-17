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

/**
 * Extracts a 64x64 perceptual sample grid of the source image for fast ΔE optimization
 */
export function extractImageHistogramSamples(imageData: ImageData): { luminance: number; lab: { L: number; a: number; b: number } }[] {
  const { data, width, height } = imageData;
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  const samples: { luminance: number; lab: { L: number; a: number; b: number } }[] = [];

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3] / 255;
      if (a < 0.2) continue;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      samples.push({
        luminance: lum,
        lab: rgbToLab({ r, g, b }),
      });
    }
  }
  return samples;
}

function getSpoolLuminance(spool: FilamentSpool): number {
  const rgb = hexToRgb01(spool.hex);
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

/**
 * AI Palette & Layer-Swap Auto-Solver
 * Evaluates combinations of candidate spools (ordered from dark base to light highlight)
 * and optimizes layer swap thresholds to minimize perceptual ΔE + structural contrast loss.
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

  const darkAnchors = sortedByLum.slice(0, Math.min(3, Math.ceil(sortedByLum.length * 0.35)));
  const lightAnchors = sortedByLum.slice(Math.max(1, sortedByLum.length - 3));
  const midSpools = sortedByLum.slice(1, Math.max(2, sortedByLum.length - 1));

  // Compute luminance percentiles in image for intelligent swap height placement
  const sortedLums = samples.map((s) => s.luminance).sort((a, b) => a - b);
  const getPercentileLum = (p: number) => sortedLums[Math.min(sortedLums.length - 1, Math.floor(p * sortedLums.length))] ?? p;

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

    let totalError = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const layerIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(s.luminance * (totalLayers - 1))));
      totalError += deltaE(s.lab, lutLabs[layerIdx]);
    }

    return {
      avgDe: totalError / samples.length,
      slots,
    };
  };

  // Candidate quantile profiles
  const quantileProfiles4 = [
    [0.18, 0.46, 0.76],
    [0.14, 0.38, 0.68],
    [0.22, 0.54, 0.82],
    [
      Math.max(0.1, Math.min(0.35, getPercentileLum(0.25))),
      Math.max(0.36, Math.min(0.65, getPercentileLum(0.55))),
      Math.max(0.66, Math.min(0.9, getPercentileLum(0.82))),
    ],
  ];

  let bestColorMatch: { avgDe: number; slots: LayerSwapSlot[] } | null = null;

  for (const dark of darkAnchors) {
    for (const light of lightAnchors) {
      if (dark.id === light.id) continue;
      for (let i = 0; i < midSpools.length; i++) {
        for (let j = i + 1; j < midSpools.length; j++) {
          const m1 = midSpools[i];
          const m2 = midSpools[j];
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

  // Fallback if fewer than 4 spools available
  if (!bestColorMatch) {
    const fallbackCombo = sortedByLum.slice(0, Math.min(maxColors, sortedByLum.length));
    bestColorMatch = evaluateCombo(fallbackCombo, [0.2, 0.5, 0.78]);
  }

  // Recipe 2: BoxerDawg Signature Warm Amber / High-Contrast Portrait Pop
  const blackSpool = sortedByLum[0];
  const whiteSpool = sortedByLum[sortedByLum.length - 1];
  const brownSpool =
    candidateSpools.find((s) => s.name.toLowerCase().includes('brown') || s.name.toLowerCase().includes('charcoal')) ||
    sortedByLum[Math.floor(sortedByLum.length * 0.33)];
  const orangeGoldSpool =
    candidateSpools.find((s) => s.name.toLowerCase().includes('orange') || s.name.toLowerCase().includes('gold') || s.name.toLowerCase().includes('tan')) ||
    sortedByLum[Math.floor(sortedByLum.length * 0.66)];

  const signatureCombo = [blackSpool, brownSpool, orangeGoldSpool, whiteSpool].filter(
    (s, idx, arr) => s && arr.findIndex((x) => x.id === s.id) === idx
  );
  const signatureEval = evaluateCombo(signatureCombo, [0.16, 0.44, 0.74]);

  // Recipe 3: Monochrome / High-Definition Archival Relief (3 or 4 neutral steps)
  const neutrals = sortedByLum.filter((s) => {
    const lab = rgbToLab(hexToRgb01(s.hex));
    return Math.hypot(lab.a, lab.b) < 18;
  });
  const monoCombo =
    neutrals.length >= 3
      ? [neutrals[0], neutrals[Math.floor(neutrals.length * 0.4)], neutrals[Math.floor(neutrals.length * 0.7)], neutrals[neutrals.length - 1]].filter(
          (s, idx, arr) => s && arr.findIndex((x) => x.id === s.id) === idx
        )
      : [blackSpool, sortedByLum[Math.floor(sortedByLum.length / 2)], whiteSpool];
  const monoEval = evaluateCombo(monoCombo, [0.20, 0.52, 0.80]);

  return [
    {
      id: 'recipe-accurate',
      name: 'Optimal True-Tone Match',
      badge: `Best ΔE (${bestColorMatch.avgDe.toFixed(1)})`,
      description: 'Lowest perceptual color error across shadows, midtones, and highlights using Beer-Lambert TD blending.',
      scoreDeltaE: bestColorMatch.avgDe,
      slots: bestColorMatch.slots,
    },
    {
      id: 'recipe-boxerdawg',
      name: 'BoxerDawg Warm Portrait Pop',
      badge: 'Pet & Fur Favorite',
      description: 'Warm brown/orange midtone transition between deep black shadows and crisp jade-white highlights.',
      scoreDeltaE: signatureEval.avgDe,
      slots: signatureEval.slots,
    },
    {
      id: 'recipe-monochrome',
      name: 'Silver-Halide Archival Relief',
      badge: 'High Contrast',
      description: 'Graduated charcoal-to-grey-to-white tonal stack for razor-sharp whiskers and architectural detail.',
      scoreDeltaE: monoEval.avgDe,
      slots: monoEval.slots,
    },
  ];
}
