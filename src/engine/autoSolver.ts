import { FilamentSpool } from '../data/filamentCatalog';
import { LayerSwapSlot, buildLayerColorLUT, hexToRgb01, rgbToLab, deltaE } from './opticalTdEngine';

type LAB = { L: number; a: number; b: number };

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
  lab: LAB;
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

  // Pre-aggregate image samples into `totalLayers` weighted LAB buckets once upfront (100x faster evaluation)
  const bucketL = new Float64Array(totalLayers);
  const bucketA = new Float64Array(totalLayers);
  const bucketB = new Float64Array(totalLayers);
  const bucketW = new Float64Array(totalLayers);

  let lowMidL = 0, lowMidA = 0, lowMidB = 0, lowMidW = 0;
  let highMidL = 0, highMidA = 0, highMidB = 0, highMidW = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const layerIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(s.luminance * (totalLayers - 1))));
    bucketL[layerIdx] += s.lab.L * s.weight;
    bucketA[layerIdx] += s.lab.a * s.weight;
    bucketB[layerIdx] += s.lab.b * s.weight;
    bucketW[layerIdx] += s.weight;

    if (s.luminance >= 0.18 && s.luminance < 0.50) {
      lowMidL += s.lab.L * s.weight;
      lowMidA += s.lab.a * s.weight;
      lowMidB += s.lab.b * s.weight;
      lowMidW += s.weight;
    } else if (s.luminance >= 0.50 && s.luminance <= 0.82) {
      highMidL += s.lab.L * s.weight;
      highMidA += s.lab.a * s.weight;
      highMidB += s.lab.b * s.weight;
      highMidW += s.weight;
    }
  }

  const layerBuckets: { lab: LAB; weight: number }[] = [];
  let totalSampleWeight = 0;
  for (let l = 0; l < totalLayers; l++) {
    const w = bucketW[l];
    totalSampleWeight += w;
    if (w > 0) {
      layerBuckets.push({
        lab: { L: bucketL[l] / w, a: bucketA[l] / w, b: bucketB[l] / w },
        weight: w,
      });
    } else {
      layerBuckets.push({ lab: { L: (l / totalLayers) * 100, a: 0, b: 0 }, weight: 0 });
    }
  }

  const lowMidCentroid: LAB =
    lowMidW > 0
      ? { L: lowMidL / lowMidW, a: lowMidA / lowMidW, b: lowMidB / lowMidW }
      : { L: 38, a: 8, b: 14 };
  const highMidCentroid: LAB =
    highMidW > 0
      ? { L: highMidL / highMidW, a: highMidA / highMidW, b: highMidB / highMidW }
      : { L: 66, a: 10, b: 20 };

  // Sort candidate spools by luminance (darkest to lightest)
  const sortedByLum = [...candidateSpools].sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));

  // Cap darkAnchors to at most 3 darkest spools
  const darkAnchors = sortedByLum.slice(0, Math.min(3, Math.max(1, Math.ceil(sortedByLum.length * 0.15))));

  const allLightAnchors = sortedByLum.filter((s) => {
    const n = s.name.toLowerCase();
    return n.includes('white') || n.includes('ivory') || getSpoolLuminance(s) > 0.82;
  });
  // Cap effectiveLights to at most 3 best light/white spools (preferring higher TD for smooth top highlights)
  const effectiveLights = (allLightAnchors.length > 0 ? allLightAnchors : sortedByLum.slice(-2))
    .slice()
    .sort((a, b) => b.td - a.td)
    .slice(0, 3);

  // Filter midSpools and prune to top 14 candidates closest to the image's lower-mid and upper-mid LAB centroids
  // so 180+ or 1000+ spool libraries never trigger an O(M^2) combinatorial freeze
  const rawMidSpools = sortedByLum.filter((s) => {
    const lum = getSpoolLuminance(s);
    const n = s.name.toLowerCase();
    if (n.includes('yellow')) return false;
    return lum > 0.04 && lum < 0.86;
  });

  const midSpools =
    rawMidSpools.length <= 14
      ? rawMidSpools
      : rawMidSpools
          .map((s) => {
            const lab = rgbToLab(hexToRgb01(s.hex));
            const distLow = deltaE(lab, lowMidCentroid);
            const distHigh = deltaE(lab, highMidCentroid);
            return { spool: s, score: Math.min(distLow, distHigh) };
          })
          .sort((a, b) => a.score - b.score)
          .slice(0, 14)
          .map((x) => x.spool)
          .sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));

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

    let totalWeightedError = 0;
    for (let l = 0; l < totalLayers; l++) {
      const bucket = layerBuckets[l];
      if (bucket.weight <= 0) continue;
      const lutLab = rgbToLab(lut[l].rgb);
      totalWeightedError += deltaE(bucket.lab, lutLab) * bucket.weight;
    }

    return {
      avgDe: totalWeightedError / Math.max(1e-5, totalSampleWeight),
      slots,
    };
  };

  const targetColorCount = Math.max(2, Math.min(maxColors, totalLayers, sortedByLum.length));
  const evenQuantiles = Array.from(
    { length: targetColorCount - 1 },
    (_, i) => (i + 1) / targetColorCount
  );

  // Recipe 1: BoxerDawg Warm Portrait & Coat Stack (supports 4, 8, 12, or 16 colors)
  const blackSpool =
    candidateSpools.find((s) => s.id === 'bambu-pla-black' || s.name.toLowerCase().includes('black')) || sortedByLum[0];
  const whiteSpool =
    candidateSpools.find((s) => s.id === 'bambu-pla-jade-white' || s.name.toLowerCase().includes('jade white')) ||
    candidateSpools.find((s) => s.name.toLowerCase().includes('white')) ||
    effectiveLights[0];
  const brownSpool =
    candidateSpools.find((s) => s.id === 'bambu-pla-brown' || s.name.toLowerCase().includes('basic brown')) ||
    candidateSpools.find((s) => s.name.toLowerCase().includes('brown') || s.name.toLowerCase().includes('chocolate') || s.name.toLowerCase().includes('mahogany')) ||
    sortedByLum[Math.floor(sortedByLum.length * 0.3)];
  const warmMidSpool =
    candidateSpools.find(
      (s) =>
        s.id === 'bambu-pla-orange' ||
        s.id === 'bambu-pla-latte-brown' ||
        s.id === 'bambu-pla-desert-tan' ||
        s.name.toLowerCase().includes('caramel') ||
        s.name.toLowerCase().includes('orange') ||
        s.name.toLowerCase().includes('tan') ||
        s.name.toLowerCase().includes('beige')
    ) || sortedByLum[Math.floor(sortedByLum.length * 0.65)];

  let signatureCombo: FilamentSpool[] = [];
  if (targetColorCount <= 4) {
    signatureCombo = [blackSpool, brownSpool, warmMidSpool, whiteSpool].filter(
      (s, idx, arr) => s && arr.findIndex((x) => x.id === s.id) === idx
    );
  } else {
    // Rank spools that have warm portrait/coat affinity (red >= green >= blue or neutral dark/light)
    const warmPool = sortedByLum.filter((s) => {
      const rgb = hexToRgb01(s.hex);
      const isFoliage = rgb.g > rgb.r * 1.08 && rgb.g > rgb.b * 1.08;
      return !isFoliage && !s.name.toLowerCase().includes('yellow');
    });
    const effectiveWarm = warmPool.length >= targetColorCount ? warmPool : sortedByLum;
    const picked: FilamentSpool[] = [blackSpool];
    const usedIds = new Set<string>([blackSpool.id, whiteSpool.id]);
    const innerNeeded = targetColorCount - 2;
    const innerPool = effectiveWarm.filter((s) => !usedIds.has(s.id));
    for (let k = 0; k < innerNeeded && innerPool.length > 0; k++) {
      const idx = Math.min(
        innerPool.length - 1,
        Math.floor(((k + 0.5) / innerNeeded) * innerPool.length)
      );
      let chosen = innerPool[idx];
      if (usedIds.has(chosen.id)) {
        chosen = innerPool.find((s) => !usedIds.has(s.id)) || chosen;
      }
      usedIds.add(chosen.id);
      picked.push(chosen);
    }
    picked.push(whiteSpool);
    signatureCombo = picked.sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
  }

  const signatureQuantiles = targetColorCount <= 4 ? [0.21, 0.50, 0.79] : evenQuantiles;
  const signatureEval = evaluateCombo(signatureCombo, signatureQuantiles);

  // Recipe 2: Subject-Weighted Perceptual ΔE Optimizer (supports 4, 8, 12, or 16 colors)
  let bestColorMatch: { avgDe: number; slots: LayerSwapSlot[] } | null = null;

  if (targetColorCount <= 4) {
    const quantileProfiles4 = [
      [0.21, 0.50, 0.79],
      [0.17, 0.46, 0.75],
      [0.25, 0.54, 0.83],
    ];
    for (const dark of darkAnchors) {
      for (const light of effectiveLights) {
        if (dark.id === light.id) continue;
        for (let i = 0; i < midSpools.length; i++) {
          for (let j = i + 1; j < midSpools.length; j++) {
            const m1 = midSpools[i];
            const m2 = midSpools[j];
            if (m1.id === dark.id || m1.id === light.id || m2.id === dark.id || m2.id === light.id) continue;
            const combo = [dark, m1, m2, light].slice(0, targetColorCount);
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
  } else {
    // Multi-band (8 / 12 / 16 color) centroid-guided band matcher
    const used = new Set<string>([blackSpool.id, whiteSpool.id]);
    const bandSpools: FilamentSpool[] = [blackSpool];
    const bandCount = targetColorCount - 2;
    for (let b = 0; b < bandCount; b++) {
      const lStart = Math.floor(((b + 0.5) / (bandCount + 1)) * totalLayers);
      const targetLab = layerBuckets[Math.min(totalLayers - 1, lStart)].lab;
      const lumMin = (b / (bandCount + 1)) * 0.85;
      const lumMax = ((b + 2) / (bandCount + 1)) * 0.95;

      let bestSpool: FilamentSpool | null = null;
      let bestDist = Infinity;
      for (const s of sortedByLum) {
        if (used.has(s.id)) continue;
        const lum = getSpoolLuminance(s);
        if (lum < lumMin || lum > lumMax) continue;
        const d = deltaE(rgbToLab(hexToRgb01(s.hex)), targetLab);
        if (d < bestDist) {
          bestDist = d;
          bestSpool = s;
        }
      }
      if (!bestSpool) {
        bestSpool = sortedByLum.find((s) => !used.has(s.id)) || sortedByLum[0];
      }
      used.add(bestSpool.id);
      bandSpools.push(bestSpool);
    }
    bandSpools.push(whiteSpool);
    bandSpools.sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
    bestColorMatch = evaluateCombo(bandSpools, evenQuantiles);
  }

  if (!bestColorMatch) {
    bestColorMatch = signatureEval;
  }

  // Recipe 3: Monochrome / High-Definition Archival Relief (supports 4, 8, 12, or 16 colors)
  const neutrals = sortedByLum.filter((s) => {
    const lab = rgbToLab(hexToRgb01(s.hex));
    return Math.hypot(lab.a, lab.b) < 18;
  });
  const monoSource = neutrals.length >= targetColorCount ? neutrals : sortedByLum;
  const monoPicked: FilamentSpool[] = [];
  const monoUsed = new Set<string>();
  for (let k = 0; k < targetColorCount && k < monoSource.length; k++) {
    const idx = Math.min(
      monoSource.length - 1,
      Math.round((k / Math.max(1, targetColorCount - 1)) * (monoSource.length - 1))
    );
    let candidate = monoSource[idx];
    if (monoUsed.has(candidate.id)) {
      candidate = monoSource.find((s) => !monoUsed.has(s.id)) || candidate;
    }
    monoUsed.add(candidate.id);
    monoPicked.push(candidate);
  }
  const monoEval = evaluateCombo(
    monoPicked,
    targetColorCount <= 4 ? [0.21, 0.52, 0.80] : evenQuantiles
  );

  return [
    {
      id: 'recipe-boxerdawg',
      name: `BoxerDawg Warm Portrait (${signatureEval.slots.length} Colors)`,
      badge: 'Recommended • Pet & Fur',
      description: 'Black shadow mask -> graduated warm brown/fawn coat tones -> crisp white highlights.',
      scoreDeltaE: signatureEval.avgDe,
      slots: signatureEval.slots,
    },
    {
      id: 'recipe-accurate',
      name: `Subject True-Tone (${bestColorMatch.slots.length} Colors)`,
      badge: `ΔE ${bestColorMatch.avgDe.toFixed(1)}`,
      description: 'Center-subject weighted CIE LAB match ignoring background grass/foliage.',
      scoreDeltaE: bestColorMatch.avgDe,
      slots: bestColorMatch.slots,
    },
    {
      id: 'recipe-monochrome',
      name: `Archival Monochrome (${monoEval.slots.length} Colors)`,
      badge: 'High Contrast B&W',
      description: 'Graduated charcoal-to-grey-to-white tonal stack for razor-sharp whiskers and eyes.',
      scoreDeltaE: monoEval.avgDe,
      slots: monoEval.slots,
    },
  ];
}
