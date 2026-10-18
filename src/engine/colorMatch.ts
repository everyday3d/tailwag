import { Lab, rgbToLab, deltaE2000, linearToSrgb } from './colorScience';
import { LayerSwapSlot, hexToRgb01 } from './opticalTdEngine';
import { OpticalProfile, LinearRgb, DEFAULT_BACKING_LINEAR, layerOver, profileFromColor } from './opticalModel';

/**
 * Faithful color matching: every column picks the stack depth whose predicted color is closest to
 * the photo, instead of deriving depth from luminance. Targets are the photo's own colors (no
 * chroma boost, no subject weighting); every printed column counts equally.
 */

export interface RGB01 {
  r: number;
  g: number;
  b: number;
}

/** Samples the source image at every grid cell with the same nearest mapping the heightmap uses. */
export function sampleGridColors(
  image: { width: number; height: number; data: ArrayLike<number> },
  cols: number,
  rows: number
): Float32Array {
  const out = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    const sy = Math.min(image.height - 1, Math.floor((r / Math.max(1, rows - 1)) * image.height));
    for (let c = 0; c < cols; c++) {
      const sx = Math.min(image.width - 1, Math.floor((c / Math.max(1, cols - 1)) * image.width));
      const idx = (sy * image.width + sx) * 4;
      const o = (r * cols + c) * 3;
      out[o] = image.data[idx] / 255;
      out[o + 1] = image.data[idx + 1] / 255;
      out[o + 2] = image.data[idx + 2] / 255;
    }
  }
  return out;
}

export interface TargetBuckets {
  /** Representative color (weighted mean Lab) of each bucket */
  labs: Lab[];
  weights: Float64Array;
  /** Bucket index per grid cell, -1 for cells that are not part of the print */
  pixelBucket: Int32Array;
  totalWeight: number;
}

/**
 * Groups colors that are visually identical (within about 2 L* units and 3 units of a* and b*) so
 * cost tables stay small without changing the result.
 */
export function buildTargetBuckets(
  rgb: Float32Array,
  count: number,
  options: {
    mask?: Uint8Array | null;
    weights?: ArrayLike<number> | null;
    /** Bucket size in L*, a* and b* units (default 2, 3, 3) */
    step?: { L: number; a: number; b: number };
  } = {}
): TargetBuckets {
  const { mask, weights } = options;
  const sL = options.step?.L ?? 2;
  const sA = options.step?.a ?? 3;
  const sB = options.step?.b ?? 3;
  const keyToIdx = new Map<number, number>();
  const sumL: number[] = [];
  const sumA: number[] = [];
  const sumB: number[] = [];
  const sumW: number[] = [];
  const pixelBucket = new Int32Array(count).fill(-1);
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (mask && mask[i] === 0) continue;
    const lab = rgbToLab({ r: rgb[i * 3], g: rgb[i * 3 + 1], b: rgb[i * 3 + 2] });
    const key = (Math.round(lab.L / sL) * 256 + (Math.round(lab.a / sA) + 120)) * 256 + (Math.round(lab.b / sB) + 120);
    let idx = keyToIdx.get(key);
    if (idx === undefined) {
      idx = sumW.length;
      keyToIdx.set(key, idx);
      sumL.push(0);
      sumA.push(0);
      sumB.push(0);
      sumW.push(0);
    }
    const w = weights ? weights[i] : 1;
    sumL[idx] += lab.L * w;
    sumA[idx] += lab.a * w;
    sumB[idx] += lab.b * w;
    sumW[idx] += w;
    pixelBucket[i] = idx;
    total += w;
  }
  const labs: Lab[] = sumW.map((w, k) => ({ L: sumL[k] / w, a: sumA[k] / w, b: sumB[k] / w }));
  return { labs, weights: Float64Array.from(sumW), pixelBucket, totalWeight: total };
}

/** Cheap CIE94 difference used only to rank candidates during search; ΔE00 decides and reports. */
export function fastDeltaE(a: Lab, b: Lab): number {
  const dL = a.L - b.L;
  const c1 = Math.hypot(a.a, a.b);
  const c2 = Math.hypot(b.a, b.b);
  const dC = c1 - c2;
  const da = a.a - b.a;
  const db = a.b - b.b;
  const dH2 = Math.max(0, da * da + db * db - dC * dC);
  const sc = 1 + 0.045 * c1;
  const sh = 1 + 0.015 * c1;
  return Math.sqrt(dL * dL + (dC / sc) * (dC / sc) + dH2 / (sh * sh));
}

export type Metric = 'ciede2000' | 'fast';
const dist = (m: Metric, a: Lab, b: Lab) => (m === 'ciede2000' ? deltaE2000(a, b) : fastDeltaE(a, b));

export function lutToLab(lutRgb: RGB01[]): Lab[] {
  return lutRgb.map((c) => rgbToLab(c));
}

/** Optical profile of a slot's spool, the same one the layer color table uses. */
export function profileFor(slot: LayerSwapSlot): OpticalProfile {
  return profileFromColor(hexToRgb01(slot.spool.hex), slot.spool.td);
}

/**
 * CIELAB color of every layer for the given swap layers, without building the full table.
 * Mirrors buildLayerColorLUT exactly (a test keeps them identical); used inside searches where
 * thousands of candidates are scored.
 */
export function layerLabsForEnds(
  profiles: OpticalProfile[],
  ends: number[],
  totalLayers: number,
  layerHeightMm: number,
  baseLayerMm: number,
  backing: number = DEFAULT_BACKING_LINEAR
): Lab[] {
  const out: Lab[] = new Array(totalLayers);
  let cur: LinearRgb = { r: 0, g: 0, b: 0 };
  let s = 0;
  for (let layer = 1; layer <= totalLayers; layer++) {
    while (s < ends.length - 1 && layer > ends[s]) s++;
    const p = profiles[s];
    if (layer === 1) cur = layerOver({ r: backing, g: backing, b: backing }, p, baseLayerMm);
    else cur = layerOver(cur, p, layerHeightMm);
    out[layer - 1] = rgbToLab({ r: linearToSrgb(cur.r), g: linearToSrgb(cur.g), b: linearToSrgb(cur.b) });
  }
  return out;
}

/**
 * Cost of showing LUT layer L for bucket b, for layers fromLayer..toLayer (1-based, inclusive).
 * Layout: cost[b * layerCount + (L - fromLayer)].
 */
export function matchCostTable(
  buckets: TargetBuckets,
  lutLab: Lab[],
  fromLayer: number,
  toLayer: number,
  metric: Metric = 'ciede2000'
): Float32Array {
  const nl = toLayer - fromLayer + 1;
  const out = new Float32Array(buckets.labs.length * nl);
  for (let b = 0; b < buckets.labs.length; b++) {
    for (let l = 0; l < nl; l++) out[b * nl + l] = dist(metric, buckets.labs[b], lutLab[fromLayer - 1 + l]);
  }
  return out;
}

/** Weighted mean of the best achievable color difference per bucket. */
export function bestMatchScore(
  buckets: TargetBuckets,
  lutLab: Lab[],
  fromLayer: number,
  toLayer: number,
  metric: Metric = 'ciede2000',
  /** Stop and return Infinity once the running mean is certain to exceed this value */
  abortAbove = Infinity
): number {
  let sum = 0;
  const abortSum = abortAbove * Math.max(1e-9, buckets.totalWeight);
  for (let b = 0; b < buckets.labs.length; b++) {
    let best = Infinity;
    for (let l = fromLayer; l <= toLayer; l++) {
      const d = dist(metric, buckets.labs[b], lutLab[l - 1]);
      if (d < best) best = d;
    }
    sum += best * buckets.weights[b];
    if (sum > abortSum) return Infinity;
  }
  return sum / Math.max(1e-9, buckets.totalWeight);
}

/** Keeps the heaviest buckets covering coverage of the total weight (for fast candidate ranking). */
export function pruneBuckets(buckets: TargetBuckets, coverage = 0.995): TargetBuckets {
  const order = Array.from(buckets.weights, (w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
  const keep: number[] = [];
  let acc = 0;
  for (const o of order) {
    keep.push(o.i);
    acc += o.w;
    if (acc >= coverage * buckets.totalWeight) break;
  }
  const labs = keep.map((i) => buckets.labs[i]);
  const weights = Float64Array.from(keep.map((i) => buckets.weights[i]));
  return { labs, weights, pixelBucket: buckets.pixelBucket, totalWeight: acc };
}

export interface AssignOptions {
  /** Cost of a one-layer height step between neighbors with the same color (ΔE units per layer) */
  smoothness?: number;
  /** Steps larger than this many layers cost no more (lets real edges stay sharp) */
  stepCap?: number;
  /** Color distance (ΔE) at which two neighbors count as an edge and stop smoothing each other */
  edgeSigma?: number;
  /** Gentle pull toward `anchor` layers; breaks ties between equally good depths */
  anchorWeight?: number;
  anchor?: Uint16Array | null;
  passes?: number;
}

/**
 * Picks a layer count for every cell: the depth whose predicted color best matches the photo,
 * regularized so equal colors do not scatter across the stack. Uses iterated conditional modes
 * on a color-edge-aware smoothness term.
 */
export function assignLayersByColorMatch(
  buckets: TargetBuckets,
  cols: number,
  rows: number,
  lutLab: Lab[],
  fromLayer: number,
  toLayer: number,
  options: AssignOptions = {}
): Uint16Array {
  const lambda = options.smoothness ?? 1.5;
  const cap = options.stepCap ?? 3;
  const sigma = options.edgeSigma ?? 6;
  const mu = options.anchorWeight ?? 0.05;
  const anchor = options.anchor ?? null;
  const passes = options.passes ?? 3;

  const nl = toLayer - fromLayer + 1;
  const cost = matchCostTable(buckets, lutLab, fromLayer, toLayer, 'ciede2000');
  const n = cols * rows;
  const pb = buckets.pixelBucket;
  const layers = new Uint16Array(n);

  // Initial: independent best match (ties go to the anchor, then the lower layer)
  for (let p = 0; p < n; p++) {
    const b = pb[p];
    if (b < 0) continue;
    let best = fromLayer;
    let bestE = Infinity;
    for (let l = 0; l < nl; l++) {
      const L = fromLayer + l;
      const e = cost[b * nl + l] + (anchor ? mu * Math.abs(L - anchor[p]) : 0);
      if (e < bestE) {
        bestE = e;
        best = L;
      }
    }
    layers[p] = best;
  }
  if (lambda <= 0 || passes <= 0) return layers;

  // Edge-aware neighbor weights: strong between similar colors, weak across real color edges
  const wRight = new Float32Array(n);
  const wDown = new Float32Array(n);
  const edgeWeight = (b1: number, b2: number) => {
    if (b1 === b2) return 1;
    const d = fastDeltaE(buckets.labs[b1], buckets.labs[b2]) / sigma;
    return Math.exp(-d * d);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = r * cols + c;
      const b = pb[p];
      if (b < 0) continue;
      if (c + 1 < cols && pb[p + 1] >= 0) wRight[p] = edgeWeight(b, pb[p + 1]);
      if (r + 1 < rows && pb[p + cols] >= 0) wDown[p] = edgeWeight(b, pb[p + cols]);
    }
  }

  for (let pass = 0; pass < passes; pass++) {
    let changed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = r * cols + c;
        const b = pb[p];
        if (b < 0) continue;
        const nbL = c > 0 && pb[p - 1] >= 0 ? layers[p - 1] : 0;
        const wL = c > 0 ? wRight[p - 1] : 0;
        const nbR = c + 1 < cols && pb[p + 1] >= 0 ? layers[p + 1] : 0;
        const wR = wRight[p];
        const nbU = r > 0 && pb[p - cols] >= 0 ? layers[p - cols] : 0;
        const wU = r > 0 ? wDown[p - cols] : 0;
        const nbD = r + 1 < rows && pb[p + cols] >= 0 ? layers[p + cols] : 0;
        const wD = wDown[p];

        const energy = (L: number) => {
          let e = cost[b * nl + (L - fromLayer)] + (anchor ? mu * Math.abs(L - anchor[p]) : 0);
          if (nbL) e += lambda * wL * Math.min(Math.abs(L - nbL), cap);
          if (nbR) e += lambda * wR * Math.min(Math.abs(L - nbR), cap);
          if (nbU) e += lambda * wU * Math.min(Math.abs(L - nbU), cap);
          if (nbD) e += lambda * wD * Math.min(Math.abs(L - nbD), cap);
          return e;
        };

        let best = layers[p];
        let bestE = energy(best);
        for (let L = fromLayer; L <= toLayer; L++) {
          if (L === layers[p]) continue;
          const e = energy(L);
          if (e < bestE - 1e-9) {
            bestE = e;
            best = L;
          }
        }
        if (best !== layers[p]) {
          layers[p] = best;
          changed++;
        }
      }
    }
    if (changed === 0) break;
  }
  return layers;
}

export interface BoundarySearchParams {
  slots: LayerSwapSlot[];
  totalLayers: number;
  baseLayerMm: number;
  layerHeightMm: number;
  /** Lowest layer count any column can have (solid base) */
  minLayer: number;
  buckets: TargetBuckets;
  /** Largest number of candidates to enumerate exhaustively before switching to coordinate descent */
  exhaustiveLimit?: number;
  /** Fewest layers a filament may print before the next swap (each swap costs a purge). Default 2. */
  minBandLayers?: number;
}

export interface BoundarySearchResult {
  ends: number[];
  /** Mean ΔE00 of the best-match stack, the number shown to users */
  scoreDeltaE00: number;
  method: 'exhaustive' | 'coordinate-descent' | 'single';
}

/**
 * Finds the swap layers that minimize the mean best-match ΔE of the photo.
 *
 * Layer colors depend on everything below them, so the problem is not separable and a simple
 * dynamic program does not apply. For up to a few thousand candidates every monotone boundary set
 * is evaluated; beyond that, coordinate descent with exhaustive single-boundary sweeps is run from
 * several starting points. Candidates are ranked with a fast metric and the finalists are decided
 * with ΔE00.
 */
export function searchSlotBoundaries(params: BoundarySearchParams): BoundarySearchResult {
  const { slots, totalLayers, baseLayerMm, layerHeightMm, minLayer, buckets } = params;
  const count = slots.length;
  const limit = params.exhaustiveLimit ?? 4000;
  const from = Math.min(minLayer, totalLayers);
  // Never ask for more bands of this thickness than fit in the stack
  const minBand = Math.max(1, Math.min(params.minBandLayers ?? 2, Math.floor(totalLayers / count)));

  const profiles = slots.map((s) => profileFor(s));
  const lutLabFor = (ends: number[]): Lab[] =>
    layerLabsForEnds(profiles, ends, totalLayers, layerHeightMm, baseLayerMm);
  const searchBuckets = pruneBuckets(buckets);
  let abortAbove = Infinity;
  const fastScore = (ends: number[]) =>
    bestMatchScore(searchBuckets, lutLabFor(ends), from, totalLayers, 'fast', abortAbove);
  const exactScore = (ends: number[]) => bestMatchScore(buckets, lutLabFor(ends), from, totalLayers, 'ciede2000');

  if (count === 1) {
    return { ends: [totalLayers], scoreDeltaE00: exactScore([totalLayers]), method: 'single' };
  }

  // Bounds for each free boundary i in 0..count-2: strictly increasing, locked ones fixed.
  const fixed = slots.map((s, i) => (i < count - 1 && s.locked ? Math.max(1, Math.min(totalLayers - 1, s.upToLayer)) : null));
  const bounds = (prefix: number[], i: number): [number, number] => {
    const prev = i === 0 ? 0 : prefix[i - 1];
    let lo = prev + minBand;
    let hi = totalLayers - (count - 1 - i + 1) * minBand + minBand; // leave room for the remaining bands
    if (fixed[i] !== null) {
      lo = hi = fixed[i] as number;
    }
    // A later locked boundary caps this one
    for (let j = i + 1; j < count - 1; j++) {
      if (fixed[j] !== null) hi = Math.min(hi, (fixed[j] as number) - (j - i) * minBand);
    }
    return [lo, hi];
  };

  // Count candidates (with early exit) to choose the method
  let counted = 0;
  const countRec = (prefix: number[], i: number) => {
    if (counted > limit) return;
    if (i === count - 1) {
      counted++;
      return;
    }
    const [lo, hi] = bounds(prefix, i);
    for (let v = lo; v <= hi && counted <= limit; v++) {
      prefix[i] = v;
      countRec(prefix, i + 1);
    }
  };
  countRec([], 0);

  // The fast metric only ranks candidates; the best ones are re-scored with ΔE00 before choosing.
  const FINALISTS = 16;
  const finalists: Array<{ ends: number[]; fast: number }> = [];
  const offer = (ends: number[], fast: number) => {
    finalists.push({ ends: [...ends], fast });
    finalists.sort((a, b) => a.fast - b.fast);
    if (finalists.length > FINALISTS) finalists.pop();
    if (finalists.length >= FINALISTS) abortAbove = finalists[FINALISTS - 1].fast;
  };

  let method: BoundarySearchResult['method'] = 'exhaustive';
  if (counted <= limit) {
    const rec = (prefix: number[], i: number) => {
      if (i === count - 1) {
        const ends = [...prefix, totalLayers];
        offer(ends, fastScore(ends));
        return;
      }
      const [lo, hi] = bounds(prefix, i);
      for (let v = lo; v <= hi; v++) {
        prefix[i] = v;
        rec(prefix, i + 1);
      }
    };
    rec([], 0);
  } else {
    method = 'coordinate-descent';
    const evenStart = slots.map((_, i) => {
      if (i === count - 1) return totalLayers;
      return Math.round(from + ((i + 1) / count) * (totalLayers - from));
    });
    const currentStart = slots.map((s, i) => (i === count - 1 ? totalLayers : s.upToLayer));
    const starts = [evenStart, currentStart];
    for (const start of starts) {
      const ends = [...start];
      // make strictly increasing and within bounds
      for (let i = 0; i < count - 1; i++) {
        const [lo, hi] = bounds(ends, i);
        ends[i] = Math.max(lo, Math.min(hi, ends[i]));
      }
      ends[count - 1] = totalLayers;
      let best = fastScore(ends);
      for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (let i = 0; i < count - 1; i++) {
          if (fixed[i] !== null) continue;
          const [lo, hi] = bounds(ends, i);
          let bestV = ends[i];
          for (let v = lo; v <= hi; v++) {
            const keep = ends[i];
            ends[i] = v;
            const sc = fastScore(ends);
            if (sc < best - 1e-9) {
              best = sc;
              bestV = v;
              improved = true;
            }
            ends[i] = keep;
          }
          ends[i] = bestV;
        }
        if (!improved) break;
      }
      offer(ends, best);
    }
  }

  // The caller's current boundaries are always a candidate when they satisfy the constraints,
  // so the search can never return something worse than what the user already has.
  const startEnds = slots.map((s, i) => (i === count - 1 ? totalLayers : s.upToLayer));
  const startValid = startEnds.every((e, i) => {
    if (i === count - 1) return true;
    const [lo, hi] = bounds(startEnds, i);
    return e >= lo && e <= hi;
  });
  if (startValid) finalists.push({ ends: startEnds, fast: Infinity });

  // Decide the finalists with the standard metric
  let bestEnds = finalists[0].ends;
  let bestExact = Infinity;
  for (const f of finalists) {
    const sc = exactScore(f.ends);
    if (sc < bestExact) {
      bestExact = sc;
      bestEnds = f.ends;
    }
  }
  return { ends: bestEnds, scoreDeltaE00: bestExact, method };
}
