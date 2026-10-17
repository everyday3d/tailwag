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

      // Perceptual luminance matching buildHeightmapGrid
      let lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const greenExcess = Math.max(0, g - Math.max(r, b * 1.1));
      if (greenExcess > 0.04) {
        lum = Math.max(0.08, lum - greenExcess * 0.55);
      }

      // Chroma-aware separation between Brown Coat midtones and True White highlights (matching buildHeightmapGrid)
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = maxC - minC;
      if (r > g && g >= b * 0.85 && chroma > 0.15 && b < 0.62) {
        lum = Math.min(0.72, Math.max(0.18, lum * 0.92 + 0.06));
      }

      // Center subject Gaussian weight + foliage de-weighting
      const distCenter = Math.hypot(nx, ny);
      let weight = distCenter <= 0.65 ? 3.5 : 0.75;
      if (greenExcess > 0.05) {
        weight *= 0.15; // Ignore background grass when choosing portrait filament colors
      }
      if (r > g && g >= b * 0.85 && r > 0.18) {
        weight *= 2.5; // Prioritize subject coat/skin tones
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
 * Hue- & Chroma-weighted perceptual color distance in CIE LAB space.
 * Standard Euclidean ΔE weights lightness (L: 0..100) ~6x heavier than natural brown/tan chromaticity (a, b: 5..25),
 * which previously allowed bright orange (#ff9016) or washed-out beige (#dbbba1) to beat true brown (#7c594a / #a6896c).
 * Weighting chromaticity (da, db) and hue chord difference (dH) ensures browns match browns accurately.
 */
function perceptualPortraitError(target: LAB, simulated: LAB): number {
  const dL = target.L - simulated.L;
  const da = target.a - simulated.a;
  const db = target.b - simulated.b;

  const c1 = Math.hypot(target.a, target.b);
  const c2 = Math.hypot(simulated.a, simulated.b);
  const dC = c1 - c2;
  const dH2 = Math.max(0, da * da + db * db - dC * dC);

  return Math.sqrt(
    (0.75 * dL) * (0.75 * dL) +
      (1.95 * da) * (1.95 * da) +
      (1.95 * db) * (1.95 * db) +
      2.6 * dH2
  );
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
      const d = deltaE(tLab, rgbToLab(hexToRgb01(s.hex)));
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
    // Classic 4-color CMYW lithophane/color-mix stack (or KCMW ordered darkest to lightest)
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

  // Compute ΔE against image for reference badge
  const samples = extractImageHistogramSamples(imageData);
  const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
  let err = 0;
  let wSum = 0;
  for (const s of samples) {
    const lIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(s.luminance * (totalLayers - 1))));
    err += deltaE(s.lab, rgbToLab(lut[lIdx].rgb)) * s.weight;
    wSum += s.weight;
  }

  return {
    id: 'recipe-cmyk',
    name: `CMYK Color Stack (${slots.length} Colors)`,
    badge: 'CMYK Process',
    description: 'Dedicated Cyan / Magenta / Yellow / White subtractive optical blending stack.',
    scoreDeltaE: wSum > 0 ? err / wSum : 15.0,
    slots,
  };
}

/**
 * AI Palette & Layer-Swap Auto-Solver
 * Finds the best possible filaments and swap heights in the user's selected library
 * for the chosen color limit (4, 8, 12, or 16 colors).
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

  // Filter out non-optical carrier spools (TD >= 50mm like pure "Transparent" TD 100mm) unless no other spools exist
  const usablePool = candidateSpools.filter((s) => s.td < 40 && !s.name.toLowerCase().includes('transparent'));
  const activePool = usablePool.length >= 4 ? usablePool : candidateSpools;

  // Pre-aggregate image samples into `totalLayers` weighted LAB buckets
  const bucketL = new Float64Array(totalLayers);
  const bucketA = new Float64Array(totalLayers);
  const bucketB = new Float64Array(totalLayers);
  const bucketW = new Float64Array(totalLayers);

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const layerIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(s.luminance * (totalLayers - 1))));
    bucketL[layerIdx] += s.lab.L * s.weight;
    bucketA[layerIdx] += s.lab.a * s.weight;
    bucketB[layerIdx] += s.lab.b * s.weight;
    bucketW[layerIdx] += s.weight;
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

  const sortedByLum = [...activePool].sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
  const targetColorCount = Math.max(2, Math.min(maxColors, totalLayers, sortedByLum.length));

  const evaluateCombo = (spools: FilamentSpool[], quantiles: number[]): { avgDe: number; slots: LayerSwapSlot[] } => {
    const slots: LayerSwapSlot[] = spools.map((spool, idx) => {
      if (idx === spools.length - 1) {
        return { id: `slot-${idx}`, spool, upToLayer: totalLayers };
      }
      const q = quantiles[idx] ?? (idx + 1) / spools.length;
      const targetLayer = Math.max(
        idx + 1,
        Math.min(totalLayers - (spools.length - 1 - idx), Math.round(q * totalLayers))
      );
      return { id: `slot-${idx}`, spool, upToLayer: targetLayer };
    });

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
      totalWeightedError += perceptualPortraitError(bucket.lab, lutLab) * bucket.weight;
    }

    return {
      avgDe: totalWeightedError / Math.max(1e-5, totalSampleWeight),
      slots,
    };
  };

  /**
   * Forward Layer-Band Optical TD Optimizer:
   * Given a pool of spools and a quantile split profile, selects the optimal sequence of `targetColorCount` spools
   * from bottom (darkest base) to top (highlight) by simulating the actual Beer-Lambert TD blend at each band
   * and choosing the spool that minimizes `perceptualPortraitError` over that band's layers.
   */
  const optimizeBandStack = (
    pool: FilamentSpool[],
    quantiles: number[],
    forcedDark?: FilamentSpool,
    forcedLight?: FilamentSpool
  ): { avgDe: number; slots: LayerSwapSlot[] } => {
    const poolByLum = [...pool].sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
    const darkSpool = forcedDark || poolByLum[0];
    const lightCandidates = poolByLum.filter((s) => {
      const n = s.name.toLowerCase();
      return n.includes('white') || n.includes('ivory') || getSpoolLuminance(s) > 0.82;
    });
    const lightSpool =
      forcedLight ||
      (lightCandidates.length > 0
        ? lightCandidates.sort((a, b) => b.td - a.td)[0]
        : poolByLum[poolByLum.length - 1]);

    // Convert quantiles to layer boundaries [end_0, end_1, ..., totalLayers]
    const layerEnds: number[] = [];
    for (let k = 0; k < targetColorCount; k++) {
      if (k === targetColorCount - 1) {
        layerEnds.push(totalLayers);
      } else {
        const q = quantiles[k] ?? (k + 1) / targetColorCount;
        layerEnds.push(
          Math.max(k + 1, Math.min(totalLayers - (targetColorCount - 1 - k), Math.round(q * totalLayers)))
        );
      }
    }
    for (let i = 1; i < layerEnds.length; i++) {
      if (layerEnds[i] <= layerEnds[i - 1]) {
        layerEnds[i] = Math.min(totalLayers, layerEnds[i - 1] + 1);
      }
    }
    layerEnds[layerEnds.length - 1] = totalLayers;

    const chosenSlots: LayerSwapSlot[] = [
      { id: 'slot-0', spool: darkSpool, upToLayer: layerEnds[0] },
    ];
    const usedIds = new Set<string>([darkSpool.id, lightSpool.id]);

    // Greedily & accurately solve each intermediate band k = 1 .. targetColorCount - 2 using actual optical TD simulation
    for (let k = 1; k < targetColorCount - 1; k++) {
      const bandStartLayer = layerEnds[k - 1] + 1;
      const bandEndLayer = layerEnds[k];
      const prevLum = getSpoolLuminance(chosenSlots[k - 1].spool);
      const maxAllowedLum = Math.min(0.88, getSpoolLuminance(lightSpool) - 0.02);

      let bestBandSpool: FilamentSpool | null = null;
      let bestBandErr = Infinity;

      for (const candidate of poolByLum) {
        if (usedIds.has(candidate.id)) continue;
        const candLum = getSpoolLuminance(candidate);
        // Keep stack monotonically increasing in luminance so lighter layers blend over darker base layers
        if (candLum < prevLum - 0.02 || candLum > maxAllowedLum) continue;

        const trialSlots: LayerSwapSlot[] = [
          ...chosenSlots,
          { id: `slot-${k}`, spool: candidate, upToLayer: bandEndLayer },
        ];
        const lut = buildLayerColorLUT(bandEndLayer, baseLayerMm, layerHeightMm, trialSlots);

        let bandErr = 0;
        let bandW = 0;
        for (let l = bandStartLayer - 1; l < bandEndLayer; l++) {
          const b = layerBuckets[l];
          if (b.weight <= 0) continue;
          bandErr += perceptualPortraitError(b.lab, rgbToLab(lut[l].rgb)) * b.weight;
          bandW += b.weight;
        }
        // Also penalize raw spool hue distance to the band's average target LAB so ultra-opaque (low-TD) or ultra-sheer (high-TD) spools stay true to hue
        let avgL = 0, avgA = 0, avgB = 0, wTot = 0;
        for (let l = bandStartLayer - 1; l < bandEndLayer; l++) {
          const b = layerBuckets[l];
          avgL += b.lab.L * b.weight;
          avgA += b.lab.a * b.weight;
          avgB += b.lab.b * b.weight;
          wTot += b.weight;
        }
        const bandTargetLab: LAB =
          wTot > 0
            ? { L: avgL / wTot, a: avgA / wTot, b: avgB / wTot }
            : { L: ((bandStartLayer + bandEndLayer) / (2 * totalLayers)) * 100, a: 8, b: 14 };
        const directSpoolErr = perceptualPortraitError(bandTargetLab, rgbToLab(hexToRgb01(candidate.hex)));
        const combinedScore = (bandW > 0 ? bandErr / bandW : directSpoolErr) * 0.55 + directSpoolErr * 0.45;

        if (combinedScore < bestBandErr) {
          bestBandErr = combinedScore;
          bestBandSpool = candidate;
        }
      }

      if (!bestBandSpool) {
        bestBandSpool = poolByLum.find((s) => !usedIds.has(s.id) && getSpoolLuminance(s) >= prevLum) ||
          poolByLum.find((s) => !usedIds.has(s.id)) ||
          poolByLum[Math.min(poolByLum.length - 1, k)];
      }

      usedIds.add(bestBandSpool.id);
      chosenSlots.push({ id: `slot-${k}`, spool: bestBandSpool, upToLayer: bandEndLayer });
    }

    chosenSlots.push({
      id: `slot-${targetColorCount - 1}`,
      spool: lightSpool,
      upToLayer: totalLayers,
    });

    return evaluateCombo(
      chosenSlots.map((s) => s.spool),
      quantiles
    );
  };

  const evenQuantiles = Array.from(
    { length: targetColorCount - 1 },
    (_, i) => (i + 1) / targetColorCount
  );

  // Exclude pure CMYK process Cyan/Magenta/Yellow from hijacking natural portrait stacks unless in CMYK mode
  const naturalPool = sortedByLum.filter((s) => {
    const n = s.name.toLowerCase();
    if (n === 'cyan' || n === 'magenta' || n === 'yellow') return false;
    return true;
  });
  const effectiveNaturalPool = naturalPool.length >= targetColorCount ? naturalPool : sortedByLum;

  // Test multiple quantile profiles and dark/light anchors to find the globally best stack from the selected library
  const quantileProfiles: number[][] =
    targetColorCount === 4
      ? [
          [0.18, 0.46, 0.76],
          [0.21, 0.50, 0.78],
          [0.16, 0.42, 0.74],
          [0.24, 0.52, 0.80],
        ]
      : [
          evenQuantiles,
          Array.from({ length: targetColorCount - 1 }, (_, i) =>
            Math.min(0.92, 0.14 + (i / Math.max(1, targetColorCount - 2)) * 0.68)
          ),
        ];

  const darkAnchors = effectiveNaturalPool.slice(0, Math.min(3, Math.max(1, Math.ceil(effectiveNaturalPool.length * 0.12))));
  const allWhiteAnchors = effectiveNaturalPool.filter((s) => {
    const n = s.name.toLowerCase();
    return n.includes('white') || n.includes('ivory') || getSpoolLuminance(s) > 0.84;
  });
  const lightAnchors = (allWhiteAnchors.length > 0 ? allWhiteAnchors : effectiveNaturalPool.slice(-2))
    .slice()
    .sort((a, b) => b.td - a.td)
    .slice(0, 3);

  let bestLibraryMatch: { avgDe: number; slots: LayerSwapSlot[] } | null = null;

  if (targetColorCount <= 4) {
    // For 4 colors, also do an exhaustive pair search over top 14 hue-matched midtone spools so we never miss the global optimum
    let midTargetL = 0, midTargetA = 0, midTargetB = 0, midW = 0;
    for (let l = Math.floor(totalLayers * 0.18); l < Math.floor(totalLayers * 0.76); l++) {
      const b = layerBuckets[l];
      midTargetL += b.lab.L * b.weight;
      midTargetA += b.lab.a * b.weight;
      midTargetB += b.lab.b * b.weight;
      midW += b.weight;
    }
    const midCentroid: LAB =
      midW > 0 ? { L: midTargetL / midW, a: midTargetA / midW, b: midTargetB / midW } : { L: 48, a: 10, b: 18 };

    const candidateMids = effectiveNaturalPool
      .filter((s) => {
        const lum = getSpoolLuminance(s);
        return lum > 0.03 && lum < 0.84;
      })
      .map((s) => ({
        spool: s,
        err: perceptualPortraitError(midCentroid, rgbToLab(hexToRgb01(s.hex))),
      }))
      .sort((a, b) => a.err - b.err)
      .slice(0, 14)
      .map((x) => x.spool)
      .sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));

    for (const dark of darkAnchors) {
      for (const light of lightAnchors) {
        if (dark.id === light.id) continue;
        for (let i = 0; i < candidateMids.length; i++) {
          for (let j = i + 1; j < candidateMids.length; j++) {
            const m1 = candidateMids[i];
            const m2 = candidateMids[j];
            if (m1.id === dark.id || m1.id === light.id || m2.id === dark.id || m2.id === light.id) continue;
            // Score both optical LUT blend AND direct spool-to-band hue fidelity
            for (const qProf of quantileProfiles) {
              const res = evaluateCombo([dark, m1, m2, light], qProf);
              // Direct midtone hue fidelity bonus so true browns beat neon orange + pale beige tricks
              const m1Lab = rgbToLab(hexToRgb01(m1.hex));
              const m2Lab = rgbToLab(hexToRgb01(m2.hex));
              const lowBandLab = layerBuckets[Math.floor(totalLayers * 0.32)]?.lab || midCentroid;
              const highBandLab = layerBuckets[Math.floor(totalLayers * 0.60)]?.lab || midCentroid;
              const directErr =
                (perceptualPortraitError(lowBandLab, m1Lab) + perceptualPortraitError(highBandLab, m2Lab)) * 0.5;
              const totalScore = res.avgDe * 0.55 + directErr * 0.45;
              if (!bestLibraryMatch || totalScore < bestLibraryMatch.avgDe) {
                bestLibraryMatch = { avgDe: totalScore, slots: res.slots };
              }
            }
          }
        }
      }
    }
  }

  for (const dark of darkAnchors) {
    for (const light of lightAnchors) {
      for (const qProf of quantileProfiles) {
        const res = optimizeBandStack(effectiveNaturalPool, qProf, dark, light);
        if (!bestLibraryMatch || res.avgDe < bestLibraryMatch.avgDe) {
          bestLibraryMatch = res;
        }
      }
    }
  }

  // Recipe 2: Warm Portrait & Coat Stack (strictly warm brown/bronze/tan/ivory spools from the selected library)
  const warmOnlyPool = effectiveNaturalPool.filter((s) => {
    const rgb = hexToRgb01(s.hex);
    const n = s.name.toLowerCase();
    const isBlackOrWhite =
      n.includes('black') || n.includes('white') || getSpoolLuminance(s) < 0.06 || getSpoolLuminance(s) > 0.85;
    // Exclude neon oranges (where R > 0.90 and G > 0.30 and B < 0.15) when real browns exist
    const isNeonOrange = rgb.r > 0.88 && rgb.g > 0.25 && rgb.b < 0.20 && n.includes('orange');
    const isWarmBrownOrTan = rgb.r >= rgb.g && rgb.g >= rgb.b * 0.85 && !isNeonOrange;
    return isBlackOrWhite || isWarmBrownOrTan;
  });

  const warmEval = optimizeBandStack(
    warmOnlyPool.length >= targetColorCount ? warmOnlyPool : effectiveNaturalPool,
    targetColorCount <= 4 ? [0.18, 0.46, 0.76] : quantileProfiles[1] || evenQuantiles
  );

  if (!bestLibraryMatch) {
    bestLibraryMatch = warmEval;
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
      id: 'recipe-accurate',
      name: `Model Accurate (${bestLibraryMatch.slots.length} Colors)`,
      badge: `Best Match • ΔE ${bestLibraryMatch.avgDe.toFixed(1)}`,
      description: 'Optimal filaments & swap heights solved directly from your selected library.',
      scoreDeltaE: bestLibraryMatch.avgDe,
      slots: bestLibraryMatch.slots,
    },
    {
      id: 'recipe-boxerdawg',
      name: `Warm Portrait & Fur (${warmEval.slots.length} Colors)`,
      badge: 'Warm Brown & Coat',
      description: 'Black shadow mask -> rich dark & medium brown coat tones -> crisp white highlights.',
      scoreDeltaE: warmEval.avgDe,
      slots: warmEval.slots,
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
