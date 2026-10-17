import { FilamentSpool } from '../data/filamentCatalog';
import { LayerSwapSlot, buildLayerColorLUT, hexToRgb01, rgbToLab } from './opticalTdEngine';
import {
  LABColor,
  QuantizedSample,
  ciede2000,
  extractPerceptualSamples,
  analyzeImageColorClusters,
} from './colorQuantizerEngine';

export interface SolverRecipe {
  id: string;
  name: string;
  badge: string;
  description: string;
  scoreDeltaE: number;
  slots: LayerSwapSlot[];
  recommendedColors?: 4 | 8 | 12 | 16;
  colorCountAdvisory?: string;
  detectedClusterCount?: number;
}

export type WeightedSample = QuantizedSample;

/**
 * Extracts spatially-weighted perceptual samples from the source image
 * using the universal border-vs-center saliency & chroma engine.
 */
export function extractImageHistogramSamples(imageData: ImageData): WeightedSample[] {
  return extractPerceptualSamples(imageData);
}

function getSpoolLuminance(spool: FilamentSpool): number {
  const rgb = hexToRgb01(spool.hex);
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

/**
 * Builds a dedicated CMYK palette stack (Black/Key + Cyan + Magenta + Yellow + White, or scaled to maxColors)
 * as a completely separate option from the natural filament solver.
 */
export function solveCmykPalette(
  imageData: ImageData,
  candidateSpools: FilamentSpool[],
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  maxColors: number = 4
): SolverRecipe {
  const sortedByLum = [...candidateSpools].sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));

  const findBestByTargetRgb = (target: { r: number; g: number; b: number }, used: Set<string>): FilamentSpool => {
    const tLab = rgbToLab(target);
    let best = sortedByLum[0];
    let bestD = Infinity;
    for (const s of candidateSpools) {
      if (used.has(s.id)) continue;
      const d = ciede2000(tLab, rgbToLab(hexToRgb01(s.hex)));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    used.add(best.id);
    return best;
  };

  const usedIds = new Set<string>();
  const keyBlack =
    candidateSpools.find((s) => s.name.toLowerCase().includes('black')) ||
    findBestByTargetRgb({ r: 0.05, g: 0.05, b: 0.05 }, usedIds);
  usedIds.add(keyBlack.id);

  const cyanSpool =
    candidateSpools.find((s) => !usedIds.has(s.id) && s.name.toLowerCase().includes('cyan')) ||
    findBestByTargetRgb({ r: 0.0, g: 0.55, b: 0.85 }, usedIds);
  usedIds.add(cyanSpool.id);

  const magentaSpool =
    candidateSpools.find((s) => !usedIds.has(s.id) && s.name.toLowerCase().includes('magenta')) ||
    findBestByTargetRgb({ r: 0.8, g: 0.05, b: 0.48 }, usedIds);
  usedIds.add(magentaSpool.id);

  const yellowSpool =
    candidateSpools.find((s) => !usedIds.has(s.id) && s.name.toLowerCase().includes('yellow')) ||
    findBestByTargetRgb({ r: 0.98, g: 0.88, b: 0.05 }, usedIds);
  usedIds.add(yellowSpool.id);

  const whiteSpool =
    candidateSpools.find((s) => !usedIds.has(s.id) && s.name.toLowerCase().includes('jade white')) ||
    candidateSpools.find((s) => !usedIds.has(s.id) && s.name.toLowerCase().includes('white')) ||
    findBestByTargetRgb({ r: 0.98, g: 0.98, b: 0.98 }, usedIds);
  usedIds.add(whiteSpool.id);

  const targetCount = Math.max(2, Math.min(maxColors, totalLayers, candidateSpools.length));
  let cmykSpools: FilamentSpool[];

  if (targetCount <= 4) {
    cmykSpools = [cyanSpool, magentaSpool, yellowSpool, whiteSpool].sort(
      (a, b) => getSpoolLuminance(a) - getSpoolLuminance(b)
    );
  } else {
    const baseSet = [keyBlack, cyanSpool, magentaSpool, yellowSpool, whiteSpool];
    for (const s of sortedByLum) {
      if (baseSet.length >= targetCount) break;
      if (!usedIds.has(s.id)) {
        usedIds.add(s.id);
        baseSet.push(s);
      }
    }
    cmykSpools = baseSet.slice(0, targetCount).sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
  }

  const slots: LayerSwapSlot[] = cmykSpools.map((spool, idx) => {
    const upToLayer =
      idx === cmykSpools.length - 1
        ? totalLayers
        : Math.max(idx + 1, Math.round(((idx + 1) / cmykSpools.length) * totalLayers));
    return { id: `slot-cmyk-${idx}`, spool, upToLayer };
  });

  const samples = extractPerceptualSamples(imageData);
  const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
  let err = 0;
  let wSum = 0;
  for (const s of samples) {
    const lIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(s.luminance * (totalLayers - 1))));
    err += ciede2000(s.lab, rgbToLab(lut[lIdx].rgb)) * s.weight;
    wSum += s.weight;
  }

  return {
    id: 'recipe-cmyk',
    name: `CMYK Color Stack (${slots.length} Colors)`,
    badge: 'CMYK Process',
    description: 'Dedicated Cyan / Magenta / Yellow / White subtractive optical blending stack.',
    scoreDeltaE: wSum > 0 ? err / wSum : 15.0,
    slots,
    recommendedColors: 4,
    colorCountAdvisory:
      maxColors > 4
        ? 'Standard subtractive CMYK lithophanes only require 4 colors (Cyan, Magenta, Yellow, White).'
        : undefined,
  };
}

/**
 * Physics-Based K-Means++ & Beer-Lambert Optical Auto-Solver Engine.
 * Works universally for any real photograph or graphic logo across all colors:
 * 1. Quantizes the image into CIE LAB dominant color clusters via K-Means++.
 * 2. Filters the user's filament library against the discovered image clusters using CIEDE2000 (ΔE00).
 * 3. Matches each elevation sub-band of the relief to the optimal library spools.
 * 4. Runs Coordinate-Descent over the Beer-Lambert optical LUT to optimize exact swap layer heights.
 * 5. Advises the user whenever <= 4 colors already capture the image's gamut.
 */
export function solveOptimalPalettes(
  imageData: ImageData,
  candidateSpools: FilamentSpool[],
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  maxColors: number = 4
): SolverRecipe[] {
  const samples = extractPerceptualSamples(imageData);
  if (samples.length === 0 || candidateSpools.length < 2) return [];

  // Filter out pure transparent carrier spools (TD >= 40mm) unless no other spools exist
  const usablePool = candidateSpools.filter((s) => s.td < 40 && !s.name.toLowerCase().includes('transparent'));
  const activePool = usablePool.length >= 4 ? usablePool : candidateSpools;

  // 1. Run CIE LAB K-Means++ Color Quantization Engine on the image
  const clusterAnalysis = analyzeImageColorClusters(samples, activePool, 8);
  const { clusters, intrinsicColorCount, isMonochromeOrGreySubject } = clusterAnalysis;

  // Pre-aggregate image samples into `totalLayers` weighted LAB buckets
  // matching the HueForge solid starting base (minBaseLayer = 5 -> 0.48mm at 0.16mm initial + 0.08mm layers)
  const minBaseLayer = Math.min(5, Math.max(1, Math.floor(totalLayers * 0.22)));
  const bucketL = new Float64Array(totalLayers);
  const bucketA = new Float64Array(totalLayers);
  const bucketB = new Float64Array(totalLayers);
  const bucketW = new Float64Array(totalLayers);

  let totalSampleWeight = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const layerNumber = minBaseLayer + Math.round(s.luminance * (totalLayers - minBaseLayer));
    const layerIdx = Math.max(0, Math.min(totalLayers - 1, layerNumber - 1));
    bucketL[layerIdx] += s.lab.L * s.weight;
    bucketA[layerIdx] += s.lab.a * s.weight;
    bucketB[layerIdx] += s.lab.b * s.weight;
    bucketW[layerIdx] += s.weight;
    totalSampleWeight += s.weight;
  }

  const layerBuckets: { lab: LABColor; weight: number }[] = [];
  for (let l = 0; l < totalLayers; l++) {
    const w = bucketW[l];
    if (w > 0) {
      layerBuckets.push({
        lab: { L: bucketL[l] / w, a: bucketA[l] / w, b: bucketB[l] / w },
        weight: w,
      });
    } else {
      layerBuckets.push({ lab: { L: (l / totalLayers) * 100, a: 0, b: 0 }, weight: 0 });
    }
  }

  /**
   * Universal Cluster-Driven Spool Compatibility Engine (memoized per spool ID):
   * Classifies each spool (Black base, White highlight, Neutral grey, or Chromatic color)
   * and measures how closely it matches the image's K-Means++ color clusters via CIEDE2000 (ΔE00).
   */
  const spoolScoreCache = new Map<
    string,
    {
      isNeutral: boolean;
      isWhite: boolean;
      isBlack: boolean;
      minClusterDe00: number;
      hueSupportRatio: number;
    }
  >();

  const classifyAndScoreSpool = (spool: FilamentSpool) => {
    const cached = spoolScoreCache.get(spool.id);
    if (cached) return cached;

    const rgb = hexToRgb01(spool.hex);
    const lab = rgbToLab(rgb);
    const chroma = Math.hypot(lab.a, lab.b);
    const lum = getSpoolLuminance(spool);
    const n = spool.name.toLowerCase();

    const isBlack = lum < 0.06 || (n.includes('black') && chroma < 8);
    const isWhite = (lum > 0.85 && chroma < 8) || ((n.includes('white') || n.includes('ivory')) && chroma < 10);
    const isNeutral = isBlack || isWhite || chroma <= 6.5;

    if (isNeutral) {
      const res = { isNeutral: true, isWhite, isBlack, minClusterDe00: 0, hueSupportRatio: 1.0 };
      spoolScoreCache.set(spool.id, res);
      return res;
    }

    // Find closest chromatic cluster in the image via CIEDE2000 + hue & chroma alignment
    let minClusterDe00 = Infinity;
    for (const c of clusters) {
      if (c.chroma < 6.0 || c.weightRatio < 0.02) continue;
      const cosSim = (c.lab.a * lab.a + c.lab.b * lab.b) / (c.chroma * chroma);
      // Require strong hue alignment (< ~28 deg) and compatible chroma/saturation
      // so high-chroma Red/Orange (chroma 50..85) cannot masquerade as muted Brown (chroma 15..28)
      if (cosSim < 0.88) continue;
      if (chroma > c.chroma * 1.55 + 8 || c.chroma > chroma * 1.85 + 10) continue;
      const d00 = ciede2000(c.lab, lab);
      if (d00 < minClusterDe00) {
        minClusterDe00 = d00;
      }
    }

    // Also measure direct pixel support in samples for fine details / smaller logo elements
    let matchingWeight = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const sChroma = Math.hypot(s.lab.a, s.lab.b);
      if (sChroma < 7.0) continue;
      const cosSim = (s.lab.a * lab.a + s.lab.b * lab.b) / (sChroma * chroma);
      if (
        cosSim >= 0.88 &&
        chroma <= sChroma * 1.55 + 8 &&
        sChroma <= chroma * 1.85 + 10 &&
        ciede2000(s.lab, lab) <= 18.0
      ) {
        matchingWeight += s.weight;
      }
    }

    const hueSupportRatio = matchingWeight / Math.max(1e-5, totalSampleWeight);
    const res = {
      isNeutral: false,
      isWhite: false,
      isBlack: false,
      minClusterDe00,
      hueSupportRatio,
    };
    spoolScoreCache.set(spool.id, res);
    return res;
  };

  // Filter candidate pool to spools supported by the image's actual K-Means++ color clusters
  const imageCompatiblePool = activePool.filter((s) => {
    const n = s.name.toLowerCase();
    if (n === 'cyan' || n === 'magenta' || n === 'yellow') return false;
    const info = classifyAndScoreSpool(s);
    if (info.isBlack || info.isWhite) return true;
    if (info.isNeutral) {
      return isMonochromeOrGreySubject;
    }
    return info.minClusterDe00 <= 18.0 || info.hueSupportRatio >= 0.035;
  });

  const effectivePool = imageCompatiblePool.length >= 4 ? imageCompatiblePool : activePool;
  const targetColorCount = Math.max(2, Math.min(maxColors, totalLayers, effectivePool.length));

  /**
   * Optical Stack Ordering:
   * 1. Black starting base layers (0.00 .. 0.02)
   * 2. Neutral Greys (0.03 .. 0.18, when subject has grey midtones)
   * 3. Chromatic spools ordered by luminance (0.20 .. 0.85) so darker under-colors blend into lighter upper colors
   * 4. White highlight spools (0.90 .. 1.00)
   */
  const getOpticalStackOrder = (s: FilamentSpool): number => {
    const info = classifyAndScoreSpool(s);
    const lum = getSpoolLuminance(s);
    if (info.isBlack) return lum * 0.05 + s.td * 0.005;
    if (info.isWhite) {
      return 0.90 + lum * 0.07 + (1 / Math.max(0.5, s.td)) * 0.02;
    }
    if (info.isNeutral) {
      return 0.03 + lum * 0.15;
    }
    return 0.20 + lum * 0.65;
  };

  /**
   * Evaluates a filament stack and runs Coordinate-Descent over the Beer-Lambert TD LUT
   * to find the exact layer swap heights (`upToLayer`) where TD-blended layer shades best match the image.
   */
  const evaluateStack = (
    spools: FilamentSpool[],
    optimizeBoundaries: boolean = false
  ): { avgDe: number; slots: LayerSwapSlot[] } => {
    const ordered = [...spools].sort((a, b) => getOpticalStackOrder(a) - getOpticalStackOrder(b));
    const count = ordered.length;

    const shadows = ordered.filter((s) => getOpticalStackOrder(s) < 0.19);
    const whites = ordered.filter((s) => getOpticalStackOrder(s) >= 0.89);
    const chromatics = ordered.filter((s) => {
      const ord = getOpticalStackOrder(s);
      return ord >= 0.19 && ord < 0.89;
    });

    const coreChromatics = chromatics.filter((s) => getSpoolLuminance(s) <= 0.68);
    const paleChromatics = chromatics.filter((s) => getSpoolLuminance(s) > 0.68);

    // Black starting base spans Layers 1..(minBaseLayer + 1) (e.g. L1..L6 = 0.56mm)
    // Remaining TD blending layers span from shadowMaxQ to totalLayers
    const quantiles: number[] = [];
    const shadowMaxQ = chromatics.length > 0 ? Math.max(0.24, (minBaseLayer + 1) / totalLayers) : 0.45;
    const chromaMaxQ = whites.length > 0 ? 0.75 : 0.96;
    const coreChromaMaxQ =
      paleChromatics.length > 0 && coreChromatics.length > 0
        ? chromaMaxQ - Math.min(0.08, paleChromatics.length * 0.06)
        : chromaMaxQ;

    for (let i = 0; i < shadows.length; i++) {
      quantiles.push(((i + 1) / Math.max(1, shadows.length)) * shadowMaxQ);
    }
    for (let i = 0; i < coreChromatics.length; i++) {
      const frac = (i + 1) / Math.max(1, coreChromatics.length);
      quantiles.push(shadowMaxQ + frac * (coreChromaMaxQ - shadowMaxQ));
    }
    for (let i = 0; i < paleChromatics.length; i++) {
      const frac = (i + 1) / Math.max(1, paleChromatics.length);
      quantiles.push(coreChromaMaxQ + frac * (chromaMaxQ - coreChromaMaxQ));
    }
    for (let i = 0; i < whites.length; i++) {
      quantiles.push(chromaMaxQ + ((i + 1) / Math.max(1, whites.length)) * (1.0 - chromaMaxQ));
    }

    const layerEnds = quantiles.map((q, idx) =>
      idx === count - 1
        ? totalLayers
        : Math.max(idx + 1, Math.min(totalLayers - (count - 1 - idx), Math.round(q * totalLayers)))
    );

    for (let i = 1; i < layerEnds.length; i++) {
      if (layerEnds[i] <= layerEnds[i - 1]) {
        layerEnds[i] = Math.min(totalLayers, layerEnds[i - 1] + 1);
      }
    }
    layerEnds[layerEnds.length - 1] = totalLayers;

    const scoreEnds = (ends: number[]): { avgDe: number; slots: LayerSwapSlot[] } => {
      const slots: LayerSwapSlot[] = ordered.map((spool, idx) => ({
        id: `slot-${idx}`,
        spool,
        upToLayer: ends[idx],
      }));
      const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
      let totalWeightedError = 0;
      for (let l = 0; l < totalLayers; l++) {
        const bucket = layerBuckets[l];
        if (bucket.weight <= 0) continue;
        // Evaluate primarily against `lutLab` — the true TD-blended color at layer `l`!
        const lutLab = rgbToLab(lut[l].rgb);
        const activeSpoolLab = rgbToLab(hexToRgb01(lut[l].activeSpool.hex));
        const blendErr = ciede2000(bucket.lab, lutLab);
        const surfaceErr = ciede2000(bucket.lab, activeSpoolLab);
        totalWeightedError += (blendErr * 0.82 + surfaceErr * 0.18) * bucket.weight;
      }
      return {
        avgDe: totalWeightedError / Math.max(1e-5, totalSampleWeight),
        slots,
      };
    };

    let bestEval = scoreEnds(layerEnds);

    // Coordinate-Descent Beer-Lambert Swap-Height Optimization:
    // Shifts swap boundaries so high-TD and low-TD filaments get the exact number of 0.08mm layers
    // needed to blend into the image's target shades
    if (optimizeBoundaries && count >= 3) {
      const currentEnds = [...layerEnds];
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < count - 1; i++) {
          const minL = i === 0 ? Math.max(2, minBaseLayer) : currentEnds[i - 1] + 1;
          const maxL = Math.min(
            currentEnds[i + 1] - 1,
            i === count - 1 - whites.length && whites.length > 0
              ? Math.max(minL, Math.round(totalLayers * 0.78))
              : currentEnds[i + 1] - 1
          );
          const origL = currentEnds[i];
          let bestL = origL;
          for (let candL = Math.max(minL, origL - 2); candL <= Math.min(maxL, origL + 2); candL++) {
            currentEnds[i] = candL;
            const trial = scoreEnds(currentEnds);
            if (trial.avgDe < bestEval.avgDe) {
              bestEval = trial;
              bestL = candL;
            }
          }
          currentEnds[i] = bestL;
        }
      }
    }

    return bestEval;
  };

  /**
   * Builds the optimal stack of `desiredCount` spools from `pool` by matching each
   * elevation sub-band of the image to the closest spool in CIEDE2000 space.
   */
  const buildBestStackFromPool = (
    pool: FilamentSpool[],
    chromaBoost: number,
    desiredCount: number
  ): { avgDe: number; slots: LayerSwapSlot[]; distinctChromaticsCount: number } => {
    const countLimit = Math.max(2, Math.min(desiredCount, totalLayers, pool.length));

    const blacks = pool
      .filter((s) => classifyAndScoreSpool(s).isBlack)
      .sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
    const whites = pool
      .filter((s) => classifyAndScoreSpool(s).isWhite)
      .sort((a, b) => {
        const lumDiff = getSpoolLuminance(b) - getSpoolLuminance(a);
        if (Math.abs(lumDiff) > 0.02) return lumDiff;
        return Math.abs(a.td - 5.0) - Math.abs(b.td - 5.0);
      });
    const shadowGreys = pool
      .filter((s) => {
        const info = classifyAndScoreSpool(s);
        return info.isNeutral && !info.isBlack && !info.isWhite;
      })
      .sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));

    const chromatics = pool.filter((s) => !classifyAndScoreSpool(s).isNeutral);
    const distinctChromaticHexes = new Set(chromatics.map((c) => c.hex.toLowerCase()));

    const picked: FilamentSpool[] = [];
    const usedIds = new Set<string>();
    const usedHexes = new Set<string>();

    const addSpool = (s?: FilamentSpool, allowDuplicateHex: boolean = false) => {
      if (!s || usedIds.has(s.id) || picked.length >= countLimit) return;
      const h = s.hex.toLowerCase();
      if (!allowDuplicateHex && usedHexes.has(h)) return;
      usedIds.add(s.id);
      usedHexes.add(h);
      picked.push(s);
    };

    // 1. Primary Black Shadow Base + Primary Crisp White Highlight
    addSpool(blacks[0] || pool[0]);
    addSpool(whites[0] || pool[pool.length - 1]);

    // 2. Sub-Band Elevation Matching: divide the chromatic midtone range [16%..72%] into M sub-bands
    // and pick the spool that best matches each sub-band's actual CIE LAB color in the image
    const numSubBands = Math.max(1, Math.min(countLimit - 2, distinctChromaticHexes.size));
    const startLayer = Math.floor(totalLayers * 0.16);
    const endLayer = Math.max(startLayer + 1, Math.floor(totalLayers * 0.72));
    const span = Math.max(1, endLayer - startLayer);

    for (let b = 0; b < numSubBands; b++) {
      if (picked.length >= countLimit) break;
      const l0 = startLayer + Math.floor((b / numSubBands) * span);
      const l1 = Math.max(l0, startLayer + Math.floor(((b + 1) / numSubBands) * span) - 1);

      let bL = 0, bA = 0, bB = 0, bW = 0;
      for (let l = l0; l <= l1 && l < totalLayers; l++) {
        const bk = layerBuckets[l];
        bL += bk.lab.L * bk.weight;
        bA += bk.lab.a * bk.weight;
        bB += bk.lab.b * bk.weight;
        bW += bk.weight;
      }

      const targetBandLab: LABColor =
        bW > 0
          ? {
              L: bL / bW,
              a: (bA / bW) * chromaBoost,
              b: (bB / bW) * chromaBoost,
            }
          : { L: 48, a: 0, b: 0 };

      let bestCand: FilamentSpool | undefined;
      let bestScore = Infinity;
      for (const c of chromatics) {
        if (usedIds.has(c.id) || usedHexes.has(c.hex.toLowerCase())) continue;
        // In 4-color mode, prefer core midtone spools (lum <= 0.68) over pale transition spools
        if (countLimit <= 4 && getSpoolLuminance(c) > 0.68 && distinctChromaticHexes.size >= 2) {
          continue;
        }
        const cLab = rgbToLab(hexToRgb01(c.hex));
        const d00 = ciede2000(targetBandLab, cLab);
        if (d00 < bestScore) {
          bestScore = d00;
          bestCand = c;
        }
      }
      if (bestCand) {
        addSpool(bestCand, false);
      }
    }

    // 3. Add any remaining distinct-hex chromatic spools ranked by cluster proximity
    const rankedRemainingChromatics = [...chromatics].sort(
      (a, b) => classifyAndScoreSpool(a).minClusterDe00 - classifyAndScoreSpool(b).minClusterDe00
    );
    for (const c of rankedRemainingChromatics) {
      if (picked.length >= countLimit) break;
      addSpool(c, false);
    }

    // 4. First filler pass: distinct-hex Whites and shadow Greys (if grey subject)
    for (const f of [...whites.slice(1), ...shadowGreys]) {
      if (picked.length >= countLimit) break;
      addSpool(f, false);
    }

    // 5. Second filler pass (if user requested more slots than distinct compatible hexes exist)
    for (const f of [...blacks.slice(1), ...rankedRemainingChromatics, ...whites.slice(1), ...shadowGreys]) {
      if (picked.length >= countLimit) break;
      addSpool(f, true);
    }

    for (const s of pool) {
      if (picked.length >= countLimit) break;
      addSpool(s, true);
    }

    const evalRes = evaluateStack(picked, true);
    return {
      ...evalRes,
      distinctChromaticsCount: distinctChromaticHexes.size,
    };
  };

  // Always compute the optimal 4-color stack (with exhaustive pair search + Beer-Lambert coordinate descent)
  let best4ColorMatch = buildBestStackFromPool(effectivePool, 1.0, 4);
  {
    const blacks = effectivePool.filter((s) => classifyAndScoreSpool(s).isBlack);
    const whites = effectivePool
      .filter((s) => classifyAndScoreSpool(s).isWhite)
      .sort((a, b) => Math.abs(a.td - 5.0) - Math.abs(b.td - 5.0));
    const validMids = effectivePool.filter((s) => {
      const info = classifyAndScoreSpool(s);
      if (info.isNeutral) return false;
      if (getSpoolLuminance(s) > 0.68 && best4ColorMatch.distinctChromaticsCount >= 2) return false;
      return true;
    });

    const b0 = blacks[0] || effectivePool[0];
    const w0 = whites[0] || effectivePool[effectivePool.length - 1];
    for (let i = 0; i < validMids.length; i++) {
      for (let j = i + 1; j < validMids.length; j++) {
        if (validMids[i].hex.toLowerCase() === validMids[j].hex.toLowerCase()) continue;
        const trial = evaluateStack([b0, validMids[i], validMids[j], w0], true);
        if (trial.avgDe < best4ColorMatch.avgDe) {
          best4ColorMatch = {
            ...trial,
            distinctChromaticsCount: best4ColorMatch.distinctChromaticsCount,
          };
        }
      }
    }
  }

  const bestLibraryMatch =
    targetColorCount === 4
      ? best4ColorMatch
      : buildBestStackFromPool(effectivePool, 1.0, targetColorCount);

  // Determine whether more than 4 colors are needed based on K-Means++ cluster count & ΔE00 gain
  const deImprovementOver4 = best4ColorMatch.avgDe - bestLibraryMatch.avgDe;
  const fourColorsSufficient =
    intrinsicColorCount <= 4 ||
    best4ColorMatch.distinctChromaticsCount <= 4 ||
    deImprovementOver4 < 2.0;

  const recommendedColors: 4 | 8 | 12 | 16 = fourColorsSufficient ? 4 : 8;
  const fourColorNames = best4ColorMatch.slots.map((s) => s.spool.name).join(' → ');

  const colorCountAdvisory = fourColorsSufficient
    ? maxColors > 4
      ? `More than 4 colors are not needed for this image. K-Means++ analysis detected ${intrinsicColorCount} dominant color clusters, and 4 filaments (${fourColorNames}) already capture the full tonal & color range (ΔE ${best4ColorMatch.avgDe.toFixed(1)}) on a single 4-slot AMS.`
      : `4 colors is optimal for this image — more than 4 colors are not needed (${intrinsicColorCount} dominant color clusters captured by ${fourColorNames} on a single AMS).`
    : maxColors > 8
      ? `More than 8 colors are not needed for this image (${intrinsicColorCount} dominant color clusters detected).`
      : undefined;

  // Recipe 2: Vibrant Chroma & Detail Stack (emphasizes chromatic saturation across all hues)
  const vibrantEval = buildBestStackFromPool(effectivePool, 1.28, targetColorCount);

  // Recipe 3: Monochrome / High-Definition Archival Relief (supports 4, 8, 12, or 16 colors)
  const sortedByLum = [...activePool].sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
  const neutrals = sortedByLum.filter((s) => {
    const lab = rgbToLab(hexToRgb01(s.hex));
    return Math.hypot(lab.a, lab.b) < 8;
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
  const monoEval = evaluateStack(monoPicked, true);

  return [
    {
      id: 'recipe-accurate',
      name: `Model Accurate (${bestLibraryMatch.slots.length} Colors)`,
      badge: `Best Match • ΔE00 ${bestLibraryMatch.avgDe.toFixed(1)}`,
      description: 'K-Means++ cluster & Beer-Lambert optical solver using your selected library.',
      scoreDeltaE: bestLibraryMatch.avgDe,
      slots: bestLibraryMatch.slots,
      recommendedColors,
      colorCountAdvisory,
      detectedClusterCount: intrinsicColorCount,
    },
    {
      id: 'recipe-boxerdawg',
      name: `Vibrant Subject (${vibrantEval.slots.length} Colors)`,
      badge: 'High Chroma',
      description: 'Boosts subject saturation and midtone color separation across all hues.',
      scoreDeltaE: vibrantEval.avgDe,
      slots: vibrantEval.slots,
      recommendedColors,
      colorCountAdvisory,
      detectedClusterCount: intrinsicColorCount,
    },
    {
      id: 'recipe-monochrome',
      name: `Archival Monochrome (${monoEval.slots.length} Colors)`,
      badge: 'High Contrast B&W',
      description: 'Graduated charcoal-to-grey-to-white tonal stack for razor-sharp relief detail.',
      scoreDeltaE: monoEval.avgDe,
      slots: monoEval.slots,
      recommendedColors: 4,
      colorCountAdvisory,
      detectedClusterCount: intrinsicColorCount,
    },
  ];
}
