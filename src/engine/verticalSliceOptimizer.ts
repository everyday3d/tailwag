import { FilamentSpool } from '../data/filamentCatalog';
import { RGB, LayerSwapSlot, buildLayerColorLUT, hexToRgb01, rgbToLab } from './opticalTdEngine';
import { ciede2000, LABColor } from './colorQuantizerEngine';

export type ErrorMetric = 'ciede2000' | 'cielab-mse';

export interface TargetPixel {
  rgb: RGB;
  lab?: LABColor;
  layer: number; // 1-based target elevation layer (1..totalLayers)
  weight?: number; // Saliency or area weight (default: 1.0)
}

export interface LayerTargetProfile {
  layer: number;
  zHeightMm: number;
  avgLab: LABColor;
  avgRgb: RGB;
  totalWeight: number;
  pixelCount: number;
}

export interface SliceOptimizerConfig {
  totalLayers: number;
  baseLayerMm: number;
  layerHeightMm: number;
  /** Maximum allowed filament count (e.g. 4 or 5 colors, representing 3 or 4 swaps) */
  maxSwaps: number;
  /** Error metric to minimize: 'ciede2000' (perceptual) or 'cielab-mse' (mean squared error) */
  metric?: ErrorMetric;
  /** Minimum solid base foundation layers (default: 1) */
  minBaseLayers?: number;
  /** Number of coordinate-descent boundary tuning passes (default: 2) */
  tuningPasses?: number;
}

export interface SliceOptimizationResult {
  slots: LayerSwapSlot[];
  spools: FilamentSpool[];
  layerEnds: number[];
  avgError: number;
  metric: ErrorMetric;
  lut: Array<{
    layer: number;
    zHeightMm: number;
    rgb: RGB;
    hex: string;
    activeSpool: FilamentSpool;
  }>;
  layerErrors: Array<{
    layer: number;
    targetLab: LABColor;
    blendedLab: LABColor;
    error: number;
  }>;
}

/**
 * Computes CIELAB Mean Squared Error (MSE) between two colors:
 * MSE = (ΔL^2 + Δa^2 + Δb^2) / 3
 */
export function cielabMse(lab1: LABColor, lab2: LABColor): number {
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return (dL * dL + da * da + db * db) / 3.0;
}

/**
 * Evaluates color difference using the chosen metric ('ciede2000' or 'cielab-mse').
 */
export function computeColorError(lab1: LABColor, lab2: LABColor, metric: ErrorMetric): number {
  if (metric === 'cielab-mse') {
    return cielabMse(lab1, lab2);
  }
  return ciede2000(lab1, lab2);
}

/**
 * Aggregates raw target pixels or an ImageData buffer into discrete vertical layer profiles.
 */
export function buildLayerProfiles(
  pixels: TargetPixel[],
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number
): LayerTargetProfile[] {
  const buckets: {
    wL: number;
    wa: number;
    wb: number;
    wR: number;
    wG: number;
    wB: number;
    totalWeight: number;
    pixelCount: number;
  }[] = Array.from({ length: totalLayers }, () => ({
    wL: 0,
    wa: 0,
    wb: 0,
    wR: 0,
    wG: 0,
    wB: 0,
    totalWeight: 0,
    pixelCount: 0,
  }));

  for (const p of pixels) {
    const lIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(p.layer) - 1));
    const lab = p.lab || rgbToLab(p.rgb);
    const w = Math.max(1e-4, p.weight ?? 1.0);

    const b = buckets[lIdx];
    b.wL += lab.L * w;
    b.wa += lab.a * w;
    b.wb += lab.b * w;
    b.wR += p.rgb.r * w;
    b.wG += p.rgb.g * w;
    b.wB += p.rgb.b * w;
    b.totalWeight += w;
    b.pixelCount += 1;
  }

  return buckets.map((b, idx) => {
    const layer = idx + 1;
    const zHeightMm = Number((baseLayerMm + (layer - 1) * layerHeightMm).toFixed(4));
    const w = b.totalWeight;

    if (w > 0) {
      return {
        layer,
        zHeightMm,
        avgLab: { L: b.wL / w, a: b.wa / w, b: b.wb / w },
        avgRgb: { r: b.wR / w, g: b.wG / w, b: b.wB / w },
        totalWeight: w,
        pixelCount: b.pixelCount,
      };
    }

    // Default neutral grey for unassigned layers
    const defaultLab = { L: (layer / totalLayers) * 100, a: 0, b: 0 };
    return {
      layer,
      zHeightMm,
      avgLab: defaultLab,
      avgRgb: { r: layer / totalLayers, g: layer / totalLayers, b: layer / totalLayers },
      totalWeight: 0,
      pixelCount: 0,
    };
  });
}

/**
 * Evaluates the weighted error of a discrete layer boundary schedule across the target layer profiles.
 */
function evaluateLayerEnds(
  ends: number[],
  orderedSpools: FilamentSpool[],
  profiles: LayerTargetProfile[],
  config: SliceOptimizerConfig
): {
  avgError: number;
  slots: LayerSwapSlot[];
  lut: Array<{ layer: number; zHeightMm: number; rgb: RGB; hex: string; activeSpool: FilamentSpool }>;
  layerErrors: Array<{ layer: number; targetLab: LABColor; blendedLab: LABColor; error: number }>;
} {
  const { totalLayers, baseLayerMm, layerHeightMm, metric = 'ciede2000' } = config;

  const slots: LayerSwapSlot[] = orderedSpools.map((spool, idx) => ({
    id: `slot-${idx}`,
    spool,
    upToLayer: ends[idx],
  }));

  const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
  const lutLabs = lut.map((entry) => rgbToLab(entry.rgb));

  let totalWeightedError = 0;
  let totalWeight = 0;
  const layerErrors: Array<{ layer: number; targetLab: LABColor; blendedLab: LABColor; error: number }> = [];

  for (let l = 0; l < totalLayers; l++) {
    const prof = profiles[l];
    if (prof.totalWeight <= 0) continue;

    const blendedLab = lutLabs[l];
    const err = computeColorError(prof.avgLab, blendedLab, metric);

    totalWeightedError += err * prof.totalWeight;
    totalWeight += prof.totalWeight;

    layerErrors.push({
      layer: l + 1,
      targetLab: prof.avgLab,
      blendedLab,
      error: err,
    });
  }

  const avgError = totalWeight > 0 ? totalWeightedError / totalWeight : 99.0;
  return { avgError, slots, lut, layerErrors };
}

/**
 * Optimizes the vertical layer swap boundaries for a fixed filament sequence using
 * Coordinate-Descent over the simulated Beer-Lambert optical LUT.
 */
export function optimizeSwapBoundaries(
  spools: FilamentSpool[],
  profiles: LayerTargetProfile[],
  config: SliceOptimizerConfig
): {
  layerEnds: number[];
  avgError: number;
  slots: LayerSwapSlot[];
  lut: Array<{ layer: number; zHeightMm: number; rgb: RGB; hex: string; activeSpool: FilamentSpool }>;
  layerErrors: Array<{ layer: number; targetLab: LABColor; blendedLab: LABColor; error: number }>;
} {
  const { totalLayers, minBaseLayers = 1, tuningPasses = 2 } = config;
  const count = spools.length;

  if (count === 1) {
    const ends = [totalLayers];
    return { ...evaluateLayerEnds(ends, spools, profiles, config), layerEnds: ends };
  }

  // Initial quantile distribution
  const initialEnds = Array.from({ length: count }, (_, idx) => {
    if (idx === count - 1) return totalLayers;
    const q = (idx + 1) / count;
    return Math.max(idx + 1, Math.min(totalLayers - (count - 1 - idx), Math.round(q * totalLayers)));
  });

  // Ensure strict monotonicity
  for (let i = 1; i < count; i++) {
    if (initialEnds[i] <= initialEnds[i - 1]) {
      initialEnds[i] = Math.min(totalLayers, initialEnds[i - 1] + 1);
    }
  }
  initialEnds[count - 1] = totalLayers;

  let bestEnds = [...initialEnds];
  let bestEval = evaluateLayerEnds(bestEnds, spools, profiles, config);

  // Coordinate-Descent Boundary Optimization
  for (let pass = 0; pass < tuningPasses; pass++) {
    for (let i = 0; i < count - 1; i++) {
      const minL = i === 0 ? Math.max(1, minBaseLayers) : bestEnds[i - 1] + 1;
      const maxL = bestEnds[i + 1] - 1;
      if (minL > maxL) continue;

      const currentL = bestEnds[i];
      let bestLocalL = currentL;

      for (let candL = Math.max(minL, currentL - 3); candL <= Math.min(maxL, currentL + 3); candL++) {
        bestEnds[i] = candL;
        const trial = evaluateLayerEnds(bestEnds, spools, profiles, config);
        if (trial.avgError < bestEval.avgError) {
          bestEval = trial;
          bestLocalL = candL;
        }
      }
      bestEnds[i] = bestLocalL;
    }
  }

  return {
    layerEnds: bestEnds,
    avgError: bestEval.avgError,
    slots: bestEval.slots,
    lut: bestEval.lut,
    layerErrors: bestEval.layerErrors,
  };
}

/**
 * Vertical Slice Color Optimizer:
 * Finds the optimal filament sequence (up to maxSwaps colors) from userPool that minimizes
 * visual error (CIEDE2000 or CIELAB MSE) against target image pixels.
 */
export function optimizeVerticalSliceSequence(
  targetPixels: TargetPixel[],
  userPool: FilamentSpool[],
  config: SliceOptimizerConfig
): SliceOptimizationResult {
  const { totalLayers, baseLayerMm, layerHeightMm, maxSwaps, metric = 'ciede2000' } = config;

  if (userPool.length === 0) {
    throw new Error('User filament pool cannot be empty');
  }

  const profiles = buildLayerProfiles(targetPixels, totalLayers, baseLayerMm, layerHeightMm);
  const targetCount = Math.max(1, Math.min(maxSwaps, userPool.length));

  // If userPool is small (<= targetCount), optimize directly
  if (userPool.length <= targetCount) {
    const ordered = [...userPool].sort((a, b) => {
      const lumA = 0.2126 * hexToRgb01(a.hex).r + 0.7152 * hexToRgb01(a.hex).g + 0.0722 * hexToRgb01(a.hex).b;
      const lumB = 0.2126 * hexToRgb01(b.hex).r + 0.7152 * hexToRgb01(b.hex).g + 0.0722 * hexToRgb01(b.hex).b;
      return lumA - lumB;
    });
    const opt = optimizeSwapBoundaries(ordered, profiles, config);
    return {
      slots: opt.slots,
      spools: ordered,
      layerEnds: opt.layerEnds,
      avgError: opt.avgError,
      metric,
      lut: opt.lut,
      layerErrors: opt.layerErrors,
    };
  }

  // Pre-filter candidate spools: match each layer profile to the nearest pool filaments
  const candidateSet = new Set<string>();

  // Darkest spool for shadow base
  const sortedByLum = [...userPool].sort((a, b) => {
    const lumA = 0.2126 * hexToRgb01(a.hex).r + 0.7152 * hexToRgb01(a.hex).g + 0.0722 * hexToRgb01(a.hex).b;
    const lumB = 0.2126 * hexToRgb01(b.hex).r + 0.7152 * hexToRgb01(b.hex).g + 0.0722 * hexToRgb01(b.hex).b;
    return lumA - lumB;
  });
  candidateSet.add(sortedByLum[0].id);
  candidateSet.add(sortedByLum[sortedByLum.length - 1].id);

  // Layer elevation best matches for layers with actual target pixels
  for (let l = 0; l < totalLayers; l++) {
    const p = profiles[l];
    if (p.totalWeight <= 0) continue;
    let bestSpool = userPool[0];
    let bestErr = Infinity;
    for (const s of userPool) {
      const err = computeColorError(p.avgLab, rgbToLab(hexToRgb01(s.hex)), metric);
      if (err < bestErr) {
        bestErr = err;
        bestSpool = s;
      }
    }
    candidateSet.add(bestSpool.id);
  }

  const candidatePool = userPool.filter((s) => candidateSet.has(s.id));
  const activePool = candidatePool.length >= targetCount ? candidatePool : userPool;

  // Sort active pool strictly by luminance (dark to light)
  const sortedPool = [...activePool].sort((a, b) => {
    const lumA = 0.2126 * hexToRgb01(a.hex).r + 0.7152 * hexToRgb01(a.hex).g + 0.0722 * hexToRgb01(a.hex).b;
    const lumB = 0.2126 * hexToRgb01(b.hex).r + 0.7152 * hexToRgb01(b.hex).g + 0.0722 * hexToRgb01(b.hex).b;
    return lumA - lumB;
  });

  // Base shadow candidates (darkest) and top highlight candidates (lightest)
  const baseCandidates = sortedPool.slice(0, Math.min(2, Math.max(1, Math.floor(sortedPool.length / 3))));
  const topCandidates = sortedPool.slice(Math.max(baseCandidates.length, sortedPool.length - 2));
  const midCandidates = sortedPool.filter((s) => !baseCandidates.includes(s) && !topCandidates.includes(s));

  const subsets: FilamentSpool[][] = [];

  if (targetCount === 1) {
    for (const s of sortedPool) {
      subsets.push([s]);
    }
  } else if (targetCount === 2) {
    for (const b of baseCandidates) {
      for (const t of topCandidates) {
        if (b.id !== t.id) subsets.push([b, t]);
      }
    }
  } else if (targetCount === 3) {
    for (const b of baseCandidates) {
      for (const m of midCandidates) {
        for (const t of topCandidates) {
          subsets.push([b, m, t]);
        }
      }
    }
  } else if (targetCount === 4) {
    for (const b of baseCandidates) {
      for (let i = 0; i < midCandidates.length; i++) {
        for (let j = i + 1; j < midCandidates.length; j++) {
          for (const t of topCandidates) {
            subsets.push([b, midCandidates[i], midCandidates[j], t]);
          }
        }
      }
    }
  } else if (targetCount >= 5) {
    for (const b of baseCandidates) {
      for (let i = 0; i < midCandidates.length; i++) {
        for (let j = i + 1; j < midCandidates.length; j++) {
          for (let k = j + 1; k < midCandidates.length; k++) {
            for (const t of topCandidates) {
              subsets.push([b, midCandidates[i], midCandidates[j], midCandidates[k], t]);
            }
          }
        }
      }
    }
  }

  // Fallback subset if combinatorics produced none
  if (subsets.length === 0) {
    subsets.push(sortedPool.slice(0, targetCount));
  }

  // Evaluate candidate subsets and track the global minimum error
  let bestResult: SliceOptimizationResult | null = null;
  for (const subset of subsets.slice(0, 48)) {
    const ordered = [...subset].sort((a, b) => {
      const lumA = 0.2126 * hexToRgb01(a.hex).r + 0.7152 * hexToRgb01(a.hex).g + 0.0722 * hexToRgb01(a.hex).b;
      const lumB = 0.2126 * hexToRgb01(b.hex).r + 0.7152 * hexToRgb01(b.hex).g + 0.0722 * hexToRgb01(b.hex).b;
      return lumA - lumB;
    });

    const opt = optimizeSwapBoundaries(ordered, profiles, config);

    if (!bestResult || opt.avgError < bestResult.avgError) {
      bestResult = {
        slots: opt.slots,
        spools: ordered,
        layerEnds: opt.layerEnds,
        avgError: opt.avgError,
        metric,
        lut: opt.lut,
        layerErrors: opt.layerErrors,
      };
    }
  }

  return bestResult!;
}
