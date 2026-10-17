import { FilamentSpool } from '../data/filamentCatalog';
import { LayerSwapSlot, buildLayerColorLUT, hexToRgb01, rgbToLab } from './opticalTdEngine';
import {
  LABColor,
  QuantizedSample,
  ciede2000,
  extractPerceptualSamples,
  analyzeImageColorClusters,
  getHueSector,
  HueSectorName,
  isSkinToneLab,
  boostChromaInLab,
  scaleLabChroma,
  computeDynamicChromaBoost,
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
 * Highlight Clamp Logic (Requirement 3):
 * Evaluates filament optical properties to identify low-TD greens or dark pigments
 * that are strictly blocked from occupying the final top 4 micro-layers.
 */
export function isLowTdGreenOrDarkPigment(spool: FilamentSpool): {
  isLowTdGreen: boolean;
  isDarkPigment: boolean;
  blockedFromTop: boolean;
} {
  const sLab = rgbToLab(hexToRgb01(spool.hex));
  const sHue = getHueSector(sLab);
  const lum = getSpoolLuminance(spool);

  // Low-TD Green: Green/cyan hue with low transmittance distance (TD < 4.0mm)
  const isGreen = sHue.sector === 'green' || sHue.sector === 'cyan' || sLab.a < -2.5;
  const isLowTdGreen = isGreen && spool.td < 4.0;

  // Dark Pigment: Dark luminance (L < 42 or lum < 0.38) or low TD opaque dark shade (TD < 2.0 && L < 52)
  const isDarkPigment = sLab.L < 42.0 || lum < 0.38 || (spool.td < 2.0 && sLab.L < 52.0);

  return {
    isLowTdGreen,
    isDarkPigment,
    blockedFromTop: isLowTdGreen || isDarkPigment,
  };
}

/**
 * Transmittance Distance (TD) Tier classification (Requirement 1):
 * Tier 0: Opaque Anchor (TD <= 0.8mm)
 * Tier 1: Dense Midtone (0.8mm < TD <= 2.2mm)
 * Tier 2: Translucent Blend (2.2mm < TD <= 5.5mm)
 * Tier 3: High-Transmittance Highlight (TD > 5.5mm)
 */
export function getTdTier(td: number): number {
  if (td <= 0.8) return 0;
  if (td <= 2.2) return 1;
  if (td <= 5.5) return 2;
  return 3;
}

/**
 * Computes TD tiering and spacing penalties across a physical filament stack (Requirement 1):
 * 1. Penalizes adjacent midtone layers with nearly identical TD (|TD_{i+1} - TD_i| < 0.35mm),
 *    which fight each other optically and flatten dynamic range.
 * 2. Penalizes optical occlusion inversions (e.g. placing dense opaque filament TD < 0.5mm on top of translucent filament TD > 2.0mm).
 */
export function computeTdSpacingPenalty(ordered: FilamentSpool[]): number {
  let penalty = 0.0;
  for (let i = 1; i < ordered.length - 2; i++) {
    const sLower = ordered[i];
    const sUpper = ordered[i + 1];
    const tdDiff = Math.abs(sUpper.td - sLower.td);
    // Crowded TD in midtones:
    if (tdDiff < 0.35 && sLower.td > 0.35 && sUpper.td > 0.35) {
      penalty += 18.0 * ((0.35 - tdDiff) / 0.35);
    }
    // Severe TD occlusion inversion (dense opaque over high-transmittance):
    if (sLower.td > 2.2 && sUpper.td < 0.5) {
      penalty += 30.0;
    }
  }
  return penalty;
}

/**
 * Subtractive Optical Blend Penalty Matrix between two consecutive layers (Requirement 4).
 * Heavily penalizes color combinations known to create ugly chemical-looking blends (e.g. yellow over cool dark blue).
 * Favors neutral gray/beige transitions as optical stepping stones when jumping between contrasting color families.
 */
export function computeSubtractiveBlendPenalty(
  sLower: FilamentSpool,
  sUpper: FilamentSpool
): number {
  const labLower = rgbToLab(hexToRgb01(sLower.hex));
  const labUpper = rgbToLab(hexToRgb01(sUpper.hex));
  const lumLower = getSpoolLuminance(sLower);
  const lumUpper = getSpoolLuminance(sUpper);
  const chromaLower = Math.hypot(labLower.a, labLower.b);
  const chromaUpper = Math.hypot(labUpper.a, labUpper.b);

  const hueLower = getHueSector(labLower);
  const hueUpper = getHueSector(labUpper);

  // 1. Neutral Buffer Exemption:
  // If either layer is an optical neutral buffer (neutral gray, ash gray, or beige stepping stone),
  // the neutral buffer absorbs and diffuses the light transition, preventing ugly subtractive cross-color mud!
  const isLowerNeutral =
    (chromaLower <= 7.0 && lumLower >= 0.12) ||
    (sLower.name.toLowerCase().includes('gray') && chromaLower <= 14);
  const isUpperNeutral =
    (chromaUpper <= 7.0 && lumUpper >= 0.12) ||
    (sUpper.name.toLowerCase().includes('gray') && chromaUpper <= 14) ||
    (hueUpper.sector === 'yellow' && chromaUpper <= 18 && sUpper.name.toLowerCase().includes('beige'));

  if (isLowerNeutral || isUpperNeutral) {
    return 0.0;
  }

  let penalty = 0.0;

  // 2. High-TD Warm Yellow/Gold directly over Cool Dark Blue / Cyan / Indigo (Ugly Chemical Green/Gray Mud)
  const isCoolDarkBlueLower =
    (hueLower.sector === 'blue' || hueLower.sector === 'cyan' || hueLower.sector === 'indigo') &&
    lumLower < 0.55;
  const isHighTdYellowUpper =
    (hueUpper.sector === 'yellow' || (labUpper.b > 20 && labUpper.a < 10)) &&
    sUpper.td > 1.8;
  if (isCoolDarkBlueLower && isHighTdYellowUpper) {
    penalty += 55.0;
  }

  // 3. High-TD Warm Yellow/Gold directly over Black Base without warm insulator
  if (lumLower < 0.08 && isHighTdYellowUpper) {
    penalty += 35.0;
  }

  // 4. Cool Green / Cyan directly over Warm Skin / Tan / Brown (Necrotic Zombie Skin)
  const isWarmLower = labLower.a >= 5.0 && labLower.b >= 8.0;
  const isCoolGreenCyanUpper =
    hueUpper.sector === 'green' || hueUpper.sector === 'cyan' || labUpper.a < -6.0;
  if (isWarmLower && isCoolGreenCyanUpper) {
    penalty += 45.0;
  }

  // 5. Direct Contrasting Chromatic Jump without Neutral Buffer:
  // If angle difference between hues is >= 110° (e.g. Red over Green, Purple over Yellow, Cyan over Orange)
  let angleDiff = Math.abs(hueUpper.hueAngle - hueLower.hueAngle);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;
  if (angleDiff >= 110 && chromaLower >= 10 && chromaUpper >= 10) {
    penalty += 35.0 * (angleDiff / 180.0);
  }

  return penalty;
}

/**
 * Gradient Preservation & Banding Prevention:
 * For scenic gradients (smooth canopy transitions, sky, road surfaces), enforces a continuous
 * transition constraint. Disallows the optimizer from abruptly swapping contrasting filaments
 * back and forth across adjacent micro-layers unless there is a sharp structural edge.
 */
export function computeGradientBandingPenalty(
  sLower: FilamentSpool,
  sUpper: FilamentSpool,
  edgeStrength: number = 0
): number {
  if (edgeStrength >= 0.35) return 0.0;

  const labLower = rgbToLab(hexToRgb01(sLower.hex));
  const labUpper = rgbToLab(hexToRgb01(sUpper.hex));
  const chromaLower = Math.hypot(labLower.a, labLower.b);
  const chromaUpper = Math.hypot(labUpper.a, labUpper.b);

  // Neutral tones, earth tones (beige, khaki, grey, silver), or extreme dark/light anchors
  // serve as natural transition buffers and do not trigger contrasting banding penalties
  if (
    chromaLower < 22 ||
    chromaUpper < 22 ||
    labLower.L < 18 ||
    labUpper.L > 88
  ) {
    return 0.0;
  }

  const hueLower = getHueSector(labLower);
  const hueUpper = getHueSector(labUpper);
  if (hueLower.sector === 'neutral' || hueUpper.sector === 'neutral') {
    return 0.0;
  }

  let angleDiff = Math.abs(hueUpper.hueAngle - hueLower.hueAngle);
  if (angleDiff > 180) angleDiff = 360 - angleDiff;

  // Continuous scenic transitions (e.g. orange to yellow canopy: angleDiff <= 45°) are smooth & encouraged
  if (angleDiff <= 45.0) {
    return 0.0;
  }

  // Contrasting chromatic jump (e.g. angleDiff >= 85° between saturated colors) in smooth scenic gradient
  const smoothnessWeight = Math.max(0, 1.0 - edgeStrength / 0.35);
  let penalty = 0.0;
  if (angleDiff >= 85.0) {
    penalty += 35.0 * smoothnessWeight * (angleDiff / 180.0);
  }

  return Number(penalty.toFixed(2));
}

/**
 * Filament Swap Economy & Purge Optimization Penalty:
 * Penalizes proposing extra filament swaps (beyond 4 colors) unless the visual Delta E
 * improvement is significant enough to justify the additional purge waste and AMS print time.
 */
export function computeSwapEconomyPenalty(
  colorCount: number,
  visualDe: number,
  benchmark4ColorDe?: number
): number {
  if (colorCount <= 4) return 0.0;
  const extraSwaps = colorCount - 4;

  // Base swap penalty for purge waste and toolhead changes (8.0 points per extra swap)
  const basePurgePenalty = extraSwaps * 8.0;

  if (benchmark4ColorDe === undefined || benchmark4ColorDe <= 0) {
    return basePurgePenalty;
  }

  // Required visual ΔE reduction: each extra swap must yield at least 0.85 ΔE drop to break even
  const visualGain = Math.max(0, benchmark4ColorDe - visualDe);
  const requiredGain = extraSwaps * 0.85;

  if (visualGain >= requiredGain) {
    // Significant visual improvement meeting or exceeding required threshold: fully exempt penalty!
    return 0.0;
  }

  // Pro-rated penalty: if visual gain is negligible (< 0.2 ΔE), full penalty applies
  const efficiencyRatio = Math.min(1.0, visualGain / Math.max(0.1, requiredGain));
  return Number((basePurgePenalty * (1.0 - efficiencyRatio)).toFixed(2));
}

/**
 * Computes a normalized high-frequency Sobel edge gradient map [0..1]
 * from an ImageData buffer at target resolution.
 * Used in Pass 2 (Micro) optimization to detect critical micro-features (faces, eyes, text, sharp lines).
 */
export function computeHighFrequencyEdgeMap(
  imageData: ImageData,
  targetWidth: number,
  targetHeight: number
): Float32Array {
  const srcW = imageData.width;
  const srcH = imageData.height;
  const src = imageData.data;
  const lumMap = new Float32Array(targetWidth * targetHeight);

  // 1. Compute downsampled perceptual luminance
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y / Math.max(1, targetHeight - 1)) * srcH));
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / Math.max(1, targetWidth - 1)) * srcW));
      const idx = (sy * srcW + sx) * 4;
      lumMap[y * targetWidth + x] =
        0.2126 * (src[idx] / 255) + 0.7152 * (src[idx + 1] / 255) + 0.0722 * (src[idx + 2] / 255);
    }
  }

  // 2. 3x3 Sobel edge filter: Gx and Gy
  const edgeMap = new Float32Array(targetWidth * targetHeight);
  let maxGrad = 0;

  for (let y = 1; y < targetHeight - 1; y++) {
    for (let x = 1; x < targetWidth - 1; x++) {
      const p00 = lumMap[(y - 1) * targetWidth + (x - 1)];
      const p01 = lumMap[(y - 1) * targetWidth + x];
      const p02 = lumMap[(y - 1) * targetWidth + (x + 1)];
      const p10 = lumMap[y * targetWidth + (x - 1)];
      const p12 = lumMap[y * targetWidth + (x + 1)];
      const p20 = lumMap[(y + 1) * targetWidth + (x - 1)];
      const p21 = lumMap[(y + 1) * targetWidth + x];
      const p22 = lumMap[(y + 1) * targetWidth + (x + 1)];

      const gx = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
      const gy = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;
      const grad = Math.hypot(gx, gy);
      edgeMap[y * targetWidth + x] = grad;
      if (grad > maxGrad) maxGrad = grad;
    }
  }

  // Normalize edge gradient
  if (maxGrad > 1e-4) {
    for (let i = 0; i < edgeMap.length; i++) {
      edgeMap[i] = Math.min(1.0, edgeMap[i] / maxGrad);
    }
  }

  return edgeMap;
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
  requestedTotalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  maxColors: number = 4,
  baseSolidThicknessMm?: number,
  totalDepthMm?: number,
  manualNeutralOverride: boolean = false
): SolverRecipe[] {
  const totalLayers =
    totalDepthMm !== undefined
      ? Math.max(4, 1 + Math.round(Math.max(0, totalDepthMm - baseLayerMm) / layerHeightMm))
      : requestedTotalLayers;

  const samples = extractPerceptualSamples(imageData);
  if (samples.length === 0 || candidateSpools.length < 2) return [];

  // 0. High-Frequency Edge Analysis: detect smooth scenic gradients vs sharp structural edges
  const edgeMap = computeHighFrequencyEdgeMap(imageData, 48, 48);
  let edgeSum = 0;
  for (let i = 0; i < edgeMap.length; i++) {
    edgeSum += edgeMap[i];
  }
  const meanEdgeStrength = edgeSum / Math.max(1, edgeMap.length);

  // Filter out pure transparent carrier spools (TD >= 40mm) unless no other spools exist
  const usablePool = candidateSpools.filter((s) => s.td < 40 && !s.name.toLowerCase().includes('transparent'));
  const activePool = usablePool.length >= 4 ? usablePool : candidateSpools;

  // 1. Run CIE LAB K-Means++ Color Quantization Engine on the image
  const clusterAnalysis = analyzeImageColorClusters(samples, activePool, 8, { manualNeutralOverride });
  const {
    clusters,
    intrinsicColorCount,
    isMonochromeOrGreySubject,
    essentialHues,
    hueSectorWeights,
    hasSkinToneSubject,
    skinToneLuminanceRange,
  } = clusterAnalysis;

  // Perceptual Saturation Boost in CIELAB (Requirement 1):
  // Compute adaptive chroma boost factor across image samples
  const dynamicChromaBoost = computeDynamicChromaBoost(samples);

  // Pre-aggregate image samples into `totalLayers` weighted LAB buckets
  // matching the user-configured solid starting base thickness
  const minBaseLayer =
    baseSolidThicknessMm !== undefined
      ? Math.min(Math.max(1, totalLayers - 3), Math.max(1, 1 + Math.round(Math.max(0, baseSolidThicknessMm - baseLayerMm) / layerHeightMm)))
      : 1;
  const bucketL = new Float64Array(totalLayers);
  const bucketA = new Float64Array(totalLayers);
  const bucketB = new Float64Array(totalLayers);
  const bucketW = new Float64Array(totalLayers);

  // Contrast-Stretched Dynamic Range Allocation:
  // Re-normalizes the sample luminance histogram dynamically across the full available Z-depth [0.16mm base up to max height]
  // avoiding compression of midtones into a flat washed-out band.
  const sampleLums = samples.map((s) => s.luminance).sort((a, b) => a - b);
  const pLow = sampleLums[Math.floor(sampleLums.length * 0.01)] ?? 0.0;
  const pHigh = sampleLums[Math.floor(sampleLums.length * 0.99)] ?? 1.0;
  const dynRange = Math.max(0.12, pHigh - pLow);

  let totalSampleWeight = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const normLum = Math.max(0, Math.min(1, (s.luminance - pLow) / dynRange));
    // S-curve tone mapping to preserve highlight and shadow separation
    const stretchedLum = 0.5 * (1.0 - Math.cos(normLum * Math.PI));
    const layerNumber = minBaseLayer + Math.round(stretchedLum * (totalLayers - minBaseLayer));
    const layerIdx = Math.max(0, Math.min(totalLayers - 1, layerNumber - 1));
    bucketL[layerIdx] += s.lab.L * s.weight;
    bucketA[layerIdx] += s.lab.a * s.weight;
    bucketB[layerIdx] += s.lab.b * s.weight;
    bucketW[layerIdx] += s.weight;
    totalSampleWeight += s.weight;
  }

  // Palette Diversity & Warm Vibrancy Anchor (Requirement 2):
  // Detect whether image features autumn foliage, sunset, gold, or vibrant warm hues (excluding skin tone portraits)
  const totalWeight = Math.max(1e-5, totalSampleWeight);
  const hasWarmAutumnOrScenicFoliage =
    !hasSkinToneSubject &&
    (essentialHues.includes('yellow') ||
      (essentialHues.includes('orange') &&
        ((hueSectorWeights['yellow'] ?? 0) / totalWeight >= 0.015 || dynamicChromaBoost >= 1.25)) ||
      ((hueSectorWeights['yellow'] ?? 0) + (hueSectorWeights['orange'] ?? 0)) / totalWeight >= 0.04);

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

  // Pre-calculate skin tone layer boundaries if face/skin detected (Requirement 3)
  const skinRange = skinToneLuminanceRange ?? [34, 80];
  const skinStartLayer = minBaseLayer + Math.round((skinRange[0] / 100) * (totalLayers - minBaseLayer));
  const skinEndLayer = minBaseLayer + Math.round((skinRange[1] / 100) * (totalLayers - minBaseLayer));

  // Precompute 4-layer sliding elevation windows across the midtone relief [minBaseLayer .. 84% height]
  // Because a 2.5D print can only extrude ONE filament color per layer Z-height, a chromatic filament
  // is only valid if at least one elevation window in the heightmap genuinely leans toward its hue.
  const winStartMin = Math.max(0, minBaseLayer - 1);
  const winStartMax = Math.max(winStartMin, Math.min(totalLayers - 3, Math.floor(totalLayers * 0.82)));
  const elevationWindows: { lab: LABColor; chroma: number; weight: number }[] = [];
  for (let l0 = winStartMin; l0 <= winStartMax; l0++) {
    let wL = 0, wA = 0, wB = 0, wSum = 0;
    for (let l = l0; l < Math.min(totalLayers, l0 + 4); l++) {
      const bk = layerBuckets[l];
      wL += bk.lab.L * bk.weight;
      wA += bk.lab.a * bk.weight;
      wB += bk.lab.b * bk.weight;
      wSum += bk.weight;
    }
    if (wSum > totalSampleWeight * 0.025) {
      const lab = { L: wL / wSum, a: wA / wSum, b: wB / wSum };
      elevationWindows.push({
        lab,
        chroma: Math.hypot(lab.a, lab.b),
        weight: wSum,
      });
    }
  }

  /**
   * Universal Cluster & Elevation-Band Spool Compatibility Engine (memoized per spool ID):
   * Classifies each spool (Black base, White highlight, Neutral grey, or Chromatic color)
   * and measures how closely it matches both the image's K-Means++ color clusters AND
   * the actual 1D luminance-to-height elevation bands via CIEDE2000 (ΔE00).
   */
  const spoolScoreCache = new Map<
    string,
    {
      isNeutral: boolean;
      isWhite: boolean;
      isBlack: boolean;
      minClusterDe00: number;
      minBandDe00: number;
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
      const res = {
        isNeutral: true,
        isWhite,
        isBlack,
        minClusterDe00: 0,
        minBandDe00: 0,
        hueSupportRatio: 1.0,
      };
      spoolScoreCache.set(spool.id, res);
      return res;
    }

    // 1. Find closest chromatic cluster in the image via CIEDE2000 + hue & chroma alignment
    let minClusterDe00 = Infinity;
    for (const c of clusters) {
      if (c.chroma < 5.5 || c.weightRatio < 0.02) continue;
      // Perceptual Saturation Boost in CIELAB (Requirement 1):
      const boostedCLab = boostChromaInLab(c.lab, dynamicChromaBoost);
      const boostedCChroma = Math.hypot(boostedCLab.a, boostedCLab.b);

      // If this spool was directly chosen as the optimal library match for cluster `c`, record it immediately
      if (c.bestSpool?.id === spool.id && (c.bestSpoolDeltaE00 ?? 99) <= 24) {
        minClusterDe00 = Math.min(minClusterDe00, c.bestSpoolDeltaE00 ?? ciede2000(boostedCLab, lab));
      }
      const cosSim = (boostedCLab.a * lab.a + boostedCLab.b * lab.b) / (boostedCChroma * chroma);
      // Require strong hue alignment (< ~28 deg)
      if (cosSim < 0.88) continue;
      // Guard against high-chroma warm spools (Orange/Red) masquerading as muted brown (since orange & brown share hue angle)
      const isWarmSpool = lab.a > 1.5 && lab.b > 6.0;
      const isWarmCluster = c.lab.a > 1.5 && c.lab.b > 6.0;
      if (isWarmSpool && isWarmCluster) {
        if (chroma > c.chroma * 1.55 + 8 || c.chroma > chroma * 1.85 + 10) continue;
      }
      const d00 = ciede2000(boostedCLab, lab);
      if (d00 < minClusterDe00) {
        minClusterDe00 = d00;
      }
    }

    // 2. Check 1D Elevation-Band Chromatic Coherence:
    // Ensure there is at least one elevation window in the heightmap whose net color vector
    // aligns with this chromatic filament
    let minBandDe00 = Infinity;
    for (const win of elevationWindows) {
      if (win.chroma < 4.5) continue;
      const boostedWinLab = boostChromaInLab(win.lab, dynamicChromaBoost);
      const boostedWinChroma = Math.hypot(boostedWinLab.a, boostedWinLab.b);
      const cosSim = (boostedWinLab.a * lab.a + boostedWinLab.b * lab.b) / (boostedWinChroma * chroma);
      if (cosSim < 0.84) continue;
      const isWarmSpool = lab.a > 1.5 && lab.b > 6.0;
      const isWarmWin = win.lab.a > 1.5 && win.lab.b > 6.0;
      if (isWarmSpool && isWarmWin) {
        if (chroma > win.chroma * 1.65 + 9 || win.chroma > chroma * 1.9 + 12) continue;
      }
      const d00 = ciede2000(boostedWinLab, lab);
      if (d00 < minBandDe00) {
        minBandDe00 = d00;
      }
    }

    // 3. Also measure direct pixel support in samples
    let matchingWeight = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const sChroma = Math.hypot(s.lab.a, s.lab.b);
      if (sChroma < 6.0) continue;
      const cosSim = (s.lab.a * lab.a + s.lab.b * lab.b) / (sChroma * chroma);
      if (cosSim >= 0.88) {
        const isWarmSpool = lab.a > 1.5 && lab.b > 6.0;
        const isWarmSample = s.lab.a > 1.5 && s.lab.b > 6.0;
        if (!isWarmSpool || !isWarmSample || (chroma <= sChroma * 1.55 + 8 && sChroma <= chroma * 1.85 + 10)) {
          if (ciede2000(s.lab, lab) <= 22.0) {
            matchingWeight += s.weight;
          }
        }
      }
    }

    const hueSupportRatio = matchingWeight / Math.max(1e-5, totalSampleWeight);
    const res = {
      isNeutral: false,
      isWhite: false,
      isBlack: false,
      minClusterDe00,
      minBandDe00,
      hueSupportRatio,
    };
    spoolScoreCache.set(spool.id, res);
    return res;
  };

  /**
   * Identifies whether a spool is an achromatic neutral or low-chroma muddy earth tone.
   */
  const isMuddyOrNeutral = (s: FilamentSpool): boolean => {
    const info = classifyAndScoreSpool(s);
    if (info.isNeutral) return true;
    const sLab = rgbToLab(hexToRgb01(s.hex));
    const sChroma = Math.hypot(sLab.a, sLab.b);
    const n = s.name.toLowerCase();
    return (
      sChroma < 12.0 ||
      (sChroma < 18.0 &&
        (n.includes('brown') ||
          n.includes('tan') ||
          n.includes('khaki') ||
          n.includes('slate') ||
          n.includes('gray') ||
          n.includes('earth')))
    );
  };

  // Filter candidate pool to spools supported by the image's K-Means++ clusters,
  // essential image hues, or direct pixel support
  const imageCompatiblePool = activePool.filter((s) => {
    const info = classifyAndScoreSpool(s);
    if (info.isBlack || info.isWhite || info.isNeutral) return true;

    // 1. Spool is the direct best match for an image K-Means++ cluster (>=1.5% area or high-chroma accent >=0.5%)
    const matchesStrongCluster = clusters.some(
      (c) =>
        c.bestSpool?.id === s.id &&
        ((c.weightRatio >= 0.005 && (c.chroma ?? 0) >= 14) || c.weightRatio >= 0.015) &&
        (c.bestSpoolDeltaE00 ?? 99) <= 22
    );
    if (matchesStrongCluster) return true;

    // 2. Or it matches an Essential Image Hue (e.g. green grass, blue sky, red suit, hearts) that exists in the image
    const sLab = rgbToLab(hexToRgb01(s.hex));
    const sHue = getHueSector(sLab);
    if (essentialHues.includes(sHue.sector)) {
      if (info.minClusterDe00 <= 24.0 || info.hueSupportRatio >= 0.008) {
        return true;
      }
    }

    // 3. Or it matches vibrant warm foliage/sunset colors when warm chromatic histogram is active (Requirement 2)
    if (hasWarmAutumnOrScenicFoliage && (sHue.sector === 'yellow' || sHue.sector === 'orange')) {
      if (Math.hypot(sLab.a, sLab.b) >= 20.0 && s.td >= 1.5) {
        return true;
      }
    }

    // 4. Or it has solid hue support ratio (>= 3.5%) in the image
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
      return 0.90 + lum * 0.05 + Math.min(0.04, s.td * 0.005);
    }
    const sLab = rgbToLab(hexToRgb01(s.hex));
    const sHue = getHueSector(sLab);

    // Requirement 3: Luminance-Dependent Hue Correction:
    // Bright highlights (sunlit canopy tops, golden hour highlights) map strictly to high-TD warm spools
    // (yellows, warm golds, ivory) directly beneath the white top cap (rank 0.80..0.88), above oranges/reds/greens
    if ((sHue.sector === 'yellow' || (sLab.b > 25 && sLab.a >= -6 && sLab.a <= 15)) && s.td >= 1.8) {
      return 0.80 + lum * 0.05 + Math.min(0.04, s.td * 0.005);
    }

    // Contiguous Hue Family Optical Progression:
    // Groups same-hue spools together so they print as cohesive contiguous relief layers,
    // avoiding erratic cross-color jumping (e.g. Green -> Blue -> Green)
    let familyBase = 0.35;
    if (info.isNeutral) {
      familyBase = 0.48; // Neutral greys/silvers act as transition buffers
    } else {
      switch (sHue.sector) {
        case 'green':
        case 'cyan':
          familyBase = 0.22; // Greens & cyans are lower midtones, strictly beneath warm canopy highlights
          break;
        case 'red':
          familyBase = 0.42;
          break;
        case 'orange':
          familyBase = 0.55;
          break;
        case 'magenta':
          familyBase = 0.65;
          break;
        case 'indigo':
          familyBase = 0.68;
          break;
        case 'blue':
          familyBase = 0.72;
          break;
        default:
          familyBase = 0.50;
          break;
      }
    }

    // For greens/cyans, cap optical rank at <= 0.38 so they can NEVER rank above warm midtones or highlights
    if (sHue.sector === 'green' || sHue.sector === 'cyan' || sLab.a < -4.0) {
      return 0.22 + Math.min(0.12, lum * 0.15) + Math.min(0.03, s.td * 0.01);
    }

    // Within each hue family, sort ascending by luminance and transmittance distance (TD)
    // so dense opaque under-layers print before translucent upper blending layers
    const tdOffset = Math.min(0.06, s.td * 0.012);
    return familyBase + lum * 0.05 + tdOffset;
  };

  /**
   * Evaluates a filament stack and runs Coordinate-Descent over the Beer-Lambert TD LUT
   * to find the exact layer swap heights (`upToLayer`) where TD-blended layer shades best match the image.
   */
  const evaluateStack = (
    spools: FilamentSpool[],
    optimizeBoundaries: boolean = false
  ): { avgDe: number; visualDe: number; slots: LayerSwapSlot[] } => {
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
    const shadowMaxQ = chromatics.length > 0 ? Math.max(0.18, (minBaseLayer + 1) / totalLayers) : 0.68;
    const chromaMaxQ = whites.length > 0 ? 0.82 : 0.96;
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

    // Requirement 3: Clamp green spools from invading upper highlight layers
    const hasWarmHighlightsOrYellow =
      ordered.some((s) => {
        const h = getHueSector(rgbToLab(hexToRgb01(s.hex)));
        return h.sector === 'yellow' || (h.sector === 'orange' && s.td >= 2.0);
      }) ||
      layerBuckets.slice(Math.round(totalLayers * 0.65)).some((b) => b.weight > 0 && b.lab.L >= 55 && b.lab.b >= 4.0);

    // Requirement 3: Highlight Clamp Logic:
    // Block any low-TD green (< 4.0mm) or dark pigment from occupying the final top 4 micro-layers
    const finalTop4Floor = Math.max(minBaseLayer + 1, totalLayers - 4);
    for (let i = 0; i < count - 1; i++) {
      const sLab = rgbToLab(hexToRgb01(ordered[i].hex));
      const sHue = getHueSector(sLab);
      if (hasWarmHighlightsOrYellow && (sHue.sector === 'green' || sHue.sector === 'cyan' || sLab.a < -3.0)) {
        const maxGreenEnd = Math.max(minBaseLayer + 1, Math.min(layerEnds[i], Math.round(totalLayers * 0.68)));
        layerEnds[i] = Math.min(layerEnds[i], maxGreenEnd);
      }
      const { blockedFromTop } = isLowTdGreenOrDarkPigment(ordered[i]);
      if (blockedFromTop) {
        layerEnds[i] = Math.min(layerEnds[i], finalTop4Floor);
      }
    }

    for (let i = 1; i < layerEnds.length; i++) {
      if (layerEnds[i] <= layerEnds[i - 1]) {
        layerEnds[i] = Math.min(totalLayers, layerEnds[i - 1] + 1);
      }
    }
    layerEnds[layerEnds.length - 1] = totalLayers;

    const scoreEnds = (ends: number[]): { avgDe: number; visualDe: number; slots: LayerSwapSlot[] } => {
      const slots: LayerSwapSlot[] = ordered.map((spool, idx) => ({
        id: `slot-${idx}`,
        spool,
        upToLayer: ends[idx],
      }));
      const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
      const lutLabs = lut.map((entry) => rgbToLab(entry.rgb));

      // Forward-Simulation Scoring (No Blended Surprises):
      // Scores the actual physically-blended transmitted color of the stacked layers
      // against the target image using CIEDE2000 Delta E rather than raw flat swatches.
      let totalWeightedError = 0;
      for (let l = 0; l < totalLayers; l++) {
        const bucket = layerBuckets[l];
        if (bucket.weight <= 0) continue;
        const lutLab = lutLabs[l];
        const blendErr = ciede2000(bucket.lab, lutLab);
        totalWeightedError += blendErr * bucket.weight;
      }

      // Cluster Hue Coverage Error: ensures the physical stack achieves the genuine chromatic colors
      let clusterCoverageError = 0;
      for (const c of clusters) {
        const isAccentCluster = (c.chroma ?? 0) >= 14 && c.weightRatio >= 0.005;
        if (c.weightRatio < 0.015 && !isAccentCluster) continue;
        let minClusterD = Infinity;
        for (let l = 0; l < totalLayers; l++) {
          const d = ciede2000(c.lab, lutLabs[l]);
          if (d < minClusterD) minClusterD = d;
        }
        // Give high-chroma accent clusters (hearts, logos, details) extra weight so they are not drowned out by background
        const effectiveWeight = isAccentCluster ? Math.max(c.weightRatio, 0.08) : c.weightRatio;
        clusterCoverageError += minClusterD * effectiveWeight * totalSampleWeight;
      }

      // Subtractive Inter-Layer Mud Penalty & Blend Matrix (Requirement 4):
      let mudPenalty = 0;
      for (let i = 0; i < ordered.length - 1; i++) {
        const sLower = ordered[i];
        const sUpper = ordered[i + 1];
        const lowerLab = rgbToLab(hexToRgb01(sLower.hex));
        const upperLab = rgbToLab(hexToRgb01(sUpper.hex));
        const lowerLum = getSpoolLuminance(sLower);
        const upperHue = getHueSector(upperLab);

        // Mud Penalty A: High-TD Warm Yellow/Gold directly over Dark Cool Base without warm insulator (Olive Mud)
        const isDarkCoolBase = lowerLum < 0.35 && lowerLab.a <= 2.5;
        const isHighTdWarmYellow =
          sUpper.td > 2.0 &&
          (upperHue.sector === 'yellow' || (upperLab.b > 20 && upperLab.a >= -2 && upperLab.a < 12));
        if (isDarkCoolBase && isHighTdWarmYellow) {
          mudPenalty += 35.0 * totalSampleWeight;
        }

        // Mud Penalty B: Cool Green / Cyan directly over Warm Skin / Tan / Brown (Necrotic Zombie Skin)
        const isWarmLower = lowerLab.a >= 5.0 && lowerLab.b >= 8.0;
        const isCoolGreenCyanUpper =
          upperHue.sector === 'green' ||
          upperHue.sector === 'cyan' ||
          upperLab.a < -6.0;
        if (isWarmLower && isCoolGreenCyanUpper) {
          mudPenalty += 45.0 * totalSampleWeight;
        }

        // Mud Penalty C: High-TD Yellow/Gold directly over Black without warm insulator
        if (lowerLum < 0.08 && isHighTdWarmYellow) {
          mudPenalty += 30.0 * totalSampleWeight;
        }

        // Subtractive Optical Blend Matrix Penalty with Neutral Buffer Exemption (Requirement 4)
        mudPenalty += computeSubtractiveBlendPenalty(sLower, sUpper) * totalSampleWeight;
      }

      // Mud Penalty D: Forward-Simulated Hue Distortion on Warm Human Skin Tones:
      for (let l = 0; l < totalLayers; l++) {
        const bucket = layerBuckets[l];
        if (bucket.weight <= 0) continue;
        const tHue = getHueSector(bucket.lab);
        const isTargetWarmSkin =
          bucket.lab.L >= 32 &&
          bucket.lab.L <= 82 &&
          bucket.lab.a >= 3.5 &&
          bucket.lab.b >= 7.0 &&
          (tHue.sector === 'orange' || tHue.sector === 'red');
        if (isTargetWarmSkin) {
          const simLab = lutLabs[l];
          const sHue = getHueSector(simLab);
          const isSimGreenOlive =
            sHue.sector === 'green' || (sHue.sector === 'yellow' && simLab.a < 2.0);
          if (isSimGreenOlive || (simLab.a < 1.0 && simLab.b > 8.0)) {
            mudPenalty += 40.0 * bucket.weight;
          }
        }
      }

      // Requirement 1: TD Spacing and Occlusion Inversion Penalty across stack
      const tdSpacingPenalty = computeTdSpacingPenalty(ordered) * totalSampleWeight;

      // Requirement 3: Face & Skin-Tone Protection Clamping
      let skinProtectionPenalty = 0;
      if (hasSkinToneSubject) {
        // Base layer must not creep up into mid-face layers (causing zombie bruises)
        if (ends[0] > skinStartLayer + 1) {
          skinProtectionPenalty += 45.0 * (ends[0] - skinStartLayer) * totalSampleWeight;
        }
        // Top cap white layer must not dump directly into mid-face region (causing chalky washouts)
        if (ends.length >= 2 && ends[ends.length - 2] < skinEndLayer - 1) {
          skinProtectionPenalty += 40.0 * (skinEndLayer - ends[ends.length - 2]) * totalSampleWeight;
        }
        // Mid-face layer shades must retain healthy warm tones
        for (let l = skinStartLayer; l <= skinEndLayer && l < totalLayers; l++) {
          const simLab = lutLabs[l];
          if (simLab.L < 28) {
            skinProtectionPenalty += 35.0 * (28 - simLab.L) * (bucketW[l] || 1);
          } else if (simLab.L > 92) {
            skinProtectionPenalty += 30.0 * (simLab.L - 92) * (bucketW[l] || 1);
          }
        }
      }

      // Gradient Preservation & Banding Prevention (Constraint 2):
      // For scenic gradients (smooth canopy transitions, sky, road surfaces), enforces a continuous
      // transition constraint. Disallows abruptly swapping contrasting filaments back and forth
      // across adjacent micro-layers unless backed by a sharp structural edge.
      let gradientBandingPenalty = 0;
      for (let i = 0; i < ordered.length - 1; i++) {
        const sLower = ordered[i];
        const sUpper = ordered[i + 1];
        const bandPen = computeGradientBandingPenalty(sLower, sUpper, meanEdgeStrength);
        if (bandPen > 0) {
          // If the upper contrasting filament is introduced for only 1 micro-layer (< 0.16mm),
          // it creates an erratic flicker/banding spike without opacity
          const nextSliceThickness = ends[i + 1] - ends[i];
          const thinMultiplier = nextSliceThickness < 2 ? 1.75 : 1.0;
          gradientBandingPenalty += bandPen * thinMultiplier * totalSampleWeight;
        }
      }

      // Requirement 3: Luminance-Dependent Highlight Hue Correction:
      // Dark or muted green spools must NEVER bleed into bright highlight / sunlit canopy layers.
      let highlightBleedPenalty = 0;
      const highlightStartLayer = Math.round(totalLayers * 0.68);
      for (let l = highlightStartLayer; l < totalLayers; l++) {
        const bucket = layerBuckets[l];
        const activeSlot = slots.find((s) => l + 1 <= s.upToLayer) || slots[slots.length - 1];
        const activeSpool = activeSlot.spool;
        const sLab = rgbToLab(hexToRgb01(activeSpool.hex));
        const sHue = getHueSector(sLab);

        const isGreenOrCool = sHue.sector === 'green' || sHue.sector === 'cyan' || sLab.a < -3.0;
        const targetIsBrightWarm = bucket.lab.L >= 55 && (bucket.lab.b >= 4.0 || bucket.weight <= 0);

        if (isGreenOrCool && targetIsBrightWarm) {
          highlightBleedPenalty += 55.0 * (bucket.weight || 1.0) * totalSampleWeight;
        }
      }

      // Requirement 3: Highlight Clamp Logic:
      // Conditional rule in the upper-layer assignment matrix evaluating layer index vs. Transmittance Distance (TD),
      // blocking any low-TD green or dark pigment from occupying the final top 4 micro-layers.
      let highlightClampPenalty = 0;
      const finalTop4Start = Math.max(0, totalLayers - 4);
      for (let l = finalTop4Start; l < totalLayers; l++) {
        const bucket = layerBuckets[l];
        const activeSlot = slots.find((s) => l + 1 <= s.upToLayer) || slots[slots.length - 1];
        const activeSpool = activeSlot.spool;
        const { isLowTdGreen, isDarkPigment } = isLowTdGreenOrDarkPigment(activeSpool);

        if (isLowTdGreen || isDarkPigment) {
          highlightClampPenalty += 5000.0 * (bucket.weight || 1.0) * totalSampleWeight;
        }
      }

      const visualDe =
        (totalWeightedError * 0.60 + clusterCoverageError * 0.40) / Math.max(1e-5, totalSampleWeight);
      const compositeCost =
        visualDe +
        (mudPenalty + tdSpacingPenalty + skinProtectionPenalty + gradientBandingPenalty + highlightBleedPenalty + highlightClampPenalty) /
          Math.max(1e-5, totalSampleWeight);
      return {
        avgDe: compositeCost,
        visualDe,
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
          let maxL = Math.min(
            currentEnds[i + 1] - 1,
            i === count - 1 - whites.length && whites.length > 0
              ? Math.max(minL, Math.round(totalLayers * 0.78))
              : currentEnds[i + 1] - 1
          );

          // Clamping: If this spool is green/cyan and warm highlights exist, clamp max layer to <= 68% total layers
          const spoolLab = rgbToLab(hexToRgb01(ordered[i].hex));
          const spoolHue = getHueSector(spoolLab);
          if (hasWarmHighlightsOrYellow && (spoolHue.sector === 'green' || spoolHue.sector === 'cyan' || spoolLab.a < -3.0)) {
            maxL = Math.min(maxL, Math.max(minL, Math.round(totalLayers * 0.68)));
          }

          // Highlight Clamp Logic: If spool is low-TD green or dark pigment, clamp max layer to <= totalLayers - 4
          const { blockedFromTop } = isLowTdGreenOrDarkPigment(ordered[i]);
          if (blockedFromTop) {
            maxL = Math.min(maxL, Math.max(minL, totalLayers - 4));
          }

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
  ): { avgDe: number; visualDe: number; slots: LayerSwapSlot[]; distinctChromaticsCount: number } => {
    const countLimit = Math.max(2, Math.min(desiredCount, totalLayers, pool.length));

    const blacks = pool
      .filter((s) => classifyAndScoreSpool(s).isBlack)
      .sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
    const whites = pool
      .filter((s) => classifyAndScoreSpool(s).isWhite)
      .sort((a, b) => b.td - a.td);
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
    const usedHues = new Set<HueSectorName>();

    const getSpoolHue = (s: FilamentSpool): { sector: HueSectorName; chroma: number } => {
      const lab = rgbToLab(hexToRgb01(s.hex));
      return getHueSector(lab);
    };

    const addSpool = (
      s?: FilamentSpool,
      allowDuplicateHex: boolean = false,
      enforceHueDiversity: boolean = true
    ) => {
      if (!s || usedIds.has(s.id) || picked.length >= countLimit) return;
      const h = s.hex.toLowerCase();
      if (!allowDuplicateHex && usedHexes.has(h)) return;

      const hue = getSpoolHue(s);
      // Palette Diversity Enforcement (Requirement 2):
      // Prevent the solver from clustering multiple similar neutral or muddy midtones
      const isNeutralMid = isMuddyOrNeutral(s) && !classifyAndScoreSpool(s).isBlack && !classifyAndScoreSpool(s).isWhite;
      if (isNeutralMid) {
        const hasChromaticContent = essentialHues.length > 0 || dynamicChromaBoost > 1.05;
        if (hasChromaticContent) {
          const currentMuddyCount = picked.filter(
            (p) => isMuddyOrNeutral(p) && !classifyAndScoreSpool(p).isBlack && !classifyAndScoreSpool(p).isWhite
          ).length;
          // Histogram Spacing Constraint:
          // Ensure the solver cannot select more than one neutral/gray spool unless explicitly forced by manual override
          const maxAllowedMuddy = manualNeutralOverride ? (countLimit <= 4 ? 2 : 3) : 1;
          if (currentMuddyCount >= maxAllowedMuddy) {
            // If unpicked image-compatible chromatic spools exist in candidate pool, skip adding redundant muddy neutrals
            const hasUnpickedChromatic = pool.some(
              (ps) =>
                !usedIds.has(ps.id) &&
                !usedHexes.has(ps.hex.toLowerCase()) &&
                !isMuddyOrNeutral(ps) &&
                (essentialHues.includes(getSpoolHue(ps).sector) ||
                  classifyAndScoreSpool(ps).minClusterDe00 <= 20.0 ||
                  classifyAndScoreSpool(ps).hueSupportRatio >= 0.02)
            );
            if (hasUnpickedChromatic) return;
          }
        }
      }

      if (enforceHueDiversity && hue.sector !== 'neutral') {
        // Hue Family Diversity Rule:
        // Do not add a 2nd or 3rd spool in an already-used hue family
        // if there are still unpicked Essential Image Hues present in the candidate pool!
        if (usedHues.has(hue.sector)) {
          const hasUnpickedEssential = essentialHues.some(
            (eh) => !usedHues.has(eh) && pool.some((ps) => getSpoolHue(ps).sector === eh)
          );
          if (hasUnpickedEssential) return;

          // Limit spools in the same chromatic hue family based on its area ratio in the image:
          // Accents (< 5% of photo) only need 1 spool, avoiding redundant multiple reds/blues
          const hueWeightRatio = (hueSectorWeights[hue.sector] ?? 0) / Math.max(1e-5, totalSampleWeight);
          const currentCountInHue = picked.filter((p) => getSpoolHue(p).sector === hue.sector).length;
          const maxSpoolsForHue = hueWeightRatio >= 0.35 ? 4 : hueWeightRatio >= 0.15 ? 3 : hueWeightRatio >= 0.05 ? 2 : 1;
          if (currentCountInHue >= maxSpoolsForHue) return;
        }
      }

      usedIds.add(s.id);
      usedHexes.add(h);
      if (hue.sector !== 'neutral') {
        usedHues.add(hue.sector);
      }
      picked.push(s);
    };

    // 1. Primary Black Shadow Base + Primary Crisp White Highlight (Locked per Fallback Safety Rule)
    addSpool(blacks[0] || pool[0], false, false);
    addSpool(whites[0] || pool[pool.length - 1], false, false);

    // 1b. Warm Vibrant Midtone Anchor (Requirement 2):
    // If the source photo contains warm autumn foliage, sunset, gold, or vibrant orange/yellow hues,
    // force at least one vibrant yellow or orange spool into the mid-layer candidate stack instead of defaulting to dull earth tones.
    if (hasWarmAutumnOrScenicFoliage) {
      const hasWarmVibrantPicked = picked.some((p) => {
        const h = getSpoolHue(p);
        const pLab = rgbToLab(hexToRgb01(p.hex));
        return (h.sector === 'yellow' || h.sector === 'orange') && Math.hypot(pLab.a, pLab.b) >= 20.0;
      });

      if (!hasWarmVibrantPicked && picked.length < countLimit) {
        const vibrantWarmCandidates = chromatics.filter((c) => {
          if (usedIds.has(c.id) || usedHexes.has(c.hex.toLowerCase())) return false;
          const h = getSpoolHue(c);
          const cLab = rgbToLab(hexToRgb01(c.hex));
          return (h.sector === 'yellow' || h.sector === 'orange') && Math.hypot(cLab.a, cLab.b) >= 20.0 && c.td >= 1.5;
        });

        if (vibrantWarmCandidates.length > 0) {
          vibrantWarmCandidates.sort((a, b) => {
            const infoA = classifyAndScoreSpool(a);
            const infoB = classifyAndScoreSpool(b);
            return Math.min(infoA.minClusterDe00, infoA.minBandDe00) - Math.min(infoB.minClusterDe00, infoB.minBandDe00);
          });
          addSpool(vibrantWarmCandidates[0], false, false);
        }
      }
    }

    // 2. High-Priority Cluster Spools:
    // Add distinct chromatic spools directly matched to image K-Means++ clusters (>=1.5% area or high-chroma accent >=0.5%)
    const clusterMatchedSpools = clusters
      .filter((c) => {
        if (!c.bestSpool || (c.bestSpoolDeltaE00 ?? 99) > 22) return false;
        const isAccentCluster = (c.chroma ?? 0) >= 14 && c.weightRatio >= 0.005;
        if (c.weightRatio < 0.015 && !isAccentCluster) return false;
        return true;
      })
      .map((c) => c.bestSpool!)
      .filter((s) => !classifyAndScoreSpool(s).isBlack && !classifyAndScoreSpool(s).isWhite)
      .sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));

    for (const cs of clusterMatchedSpools) {
      if (picked.length >= countLimit) break;
      // In 4-color mode, only take core midtone chromatics if multiple exist
      if (countLimit <= 4 && picked.length >= 3 && clusterMatchedSpools.length >= 2) {
        break;
      }
      addSpool(cs, false, false);
    }

    // 2b. Ensure Essential Image Hues (e.g. green grass, blue sky, red suit) each get representation
    for (const eh of essentialHues) {
      if (picked.length >= countLimit) break;
      if (usedHues.has(eh)) continue;
      // In 4-color mode, only cover up to 2 distinct chromatic essential hues to preserve base/highlight
      if (countLimit <= 4 && usedHues.size >= 2) break;

      let bestHueSpool: FilamentSpool | undefined;
      let bestHueScore = Infinity;
      for (const s of chromatics) {
        if (usedIds.has(s.id) || usedHexes.has(s.hex.toLowerCase())) continue;
        if (getSpoolHue(s).sector !== eh) continue;
        const info = classifyAndScoreSpool(s);
        // Only accept if spool actually matches an image cluster or has solid sample support!
        if (info.minClusterDe00 > 22.0 && info.hueSupportRatio < 0.04) continue;
        const score = info.minClusterDe00 - Math.min(8, info.hueSupportRatio * 50);
        if (score < bestHueScore) {
          bestHueScore = score;
          bestHueSpool = s;
        }
      }
      if (bestHueSpool) {
        addSpool(bestHueSpool, false, false);
      }
    }

    // 3. Sub-Band Elevation Matching: divide the chromatic midtone range [16%..72%] into M sub-bands
    // and pick the spool that best matches each sub-band's actual CIE LAB color in the image
    const numSubBands = Math.max(1, Math.min(countLimit - picked.length, distinctChromaticHexes.size));
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

      const effectiveChromaBoost = chromaBoost * dynamicChromaBoost;
      const targetBandLab: LABColor =
        bW > 0
          ? boostChromaInLab(
              {
                L: bL / bW,
                a: (bA / bW) * chromaBoost,
                b: (bB / bW) * chromaBoost,
              },
              dynamicChromaBoost
            )
          : { L: 48, a: 0, b: 0 };

      let bestCand: FilamentSpool | undefined;
      let bestScore = Infinity;
      for (const c of chromatics) {
        if (usedIds.has(c.id) || usedHexes.has(c.hex.toLowerCase())) continue;
        const cHue = getSpoolHue(c);
        // Anti-hallucination guard: if image has < 1.5% pixels in this hue sector and not essential, skip alien spool!
        if (
          cHue.sector !== 'neutral' &&
          !essentialHues.includes(cHue.sector) &&
          (hueSectorWeights[cHue.sector] ?? 0) / Math.max(1e-5, totalSampleWeight) < 0.015
        ) {
          continue;
        }
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
        addSpool(bestCand, false, true);
      }
    }

    // 4. Add any remaining distinct-hex chromatic spools that have image support
    const rankedRemainingChromatics = [...chromatics]
      .filter((c) => {
        const hue = getSpoolHue(c);
        if (hue.sector === 'neutral') return true;
        if (essentialHues.includes(hue.sector)) return true;
        return (hueSectorWeights[hue.sector] ?? 0) / Math.max(1e-5, totalSampleWeight) >= 0.015;
      })
      .sort((a, b) => {
        const scoreA = Math.min(classifyAndScoreSpool(a).minClusterDe00, classifyAndScoreSpool(a).minBandDe00);
        const scoreB = Math.min(classifyAndScoreSpool(b).minClusterDe00, classifyAndScoreSpool(b).minBandDe00);
        return scoreA - scoreB;
      });

    for (const c of rankedRemainingChromatics) {
      if (picked.length >= countLimit) break;
      const info = classifyAndScoreSpool(c);
      if (info.minClusterDe00 <= 18.0 || info.hueSupportRatio >= 0.035) {
        addSpool(c, false, true);
      }
    }

    // 5. First filler pass: graduated neutral Greys and secondary Whites for smooth tonal transitions
    for (const f of [...shadowGreys, ...whites.slice(1)]) {
      if (picked.length >= countLimit) break;
      addSpool(f, false, false);
    }

    // 5b. Remaining valid chromatics if still below countLimit
    for (const c of rankedRemainingChromatics) {
      if (picked.length >= countLimit) break;
      addSpool(c, false, false);
    }

    // 6. Neutral filler pass: add remaining neutral spools for smooth graduated tonal steps
    const neutralFillers = pool.filter((s) => classifyAndScoreSpool(s).isNeutral);
    for (const nf of [...shadowGreys, ...whites.slice(1), ...blacks.slice(1), ...neutralFillers]) {
      if (picked.length >= countLimit) break;
      addSpool(nf, true, false);
    }

    // 7. Essential image hue filler pass: add spools sharing essential image hues
    const essentialHueFillers = pool.filter((s) => {
      const hue = getSpoolHue(s);
      return essentialHues.includes(hue.sector);
    });
    for (const ef of essentialHueFillers) {
      if (picked.length >= countLimit) break;
      addSpool(ef, true, false);
    }

    // 8. Third filler pass: only accept spools that do not trigger severe subtractive cross-color mud (Requirement 4)
    for (const s of pool) {
      if (picked.length >= countLimit) break;
      const createsMud = picked.some(
        (p) => computeSubtractiveBlendPenalty(p, s) >= 35.0 || computeSubtractiveBlendPenalty(s, p) >= 35.0
      );
      if (!createsMud) {
        addSpool(s, true, false);
      }
    }

    for (const s of pool) {
      if (picked.length >= countLimit) break;
      addSpool(s, true, false);
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
    const blacks = effectivePool
      .filter((s) => classifyAndScoreSpool(s).isBlack)
      .sort((a, b) => getSpoolLuminance(a) - getSpoolLuminance(b));
    const whites = effectivePool
      .filter((s) => classifyAndScoreSpool(s).isWhite)
      .sort((a, b) => b.td - a.td);

    const hasWarmSkinSubject = samples.some((s) => {
      const h = getHueSector(s.lab);
      return (
        s.lab.L >= 32 &&
        s.lab.L <= 80 &&
        s.lab.a >= 4.0 &&
        s.lab.b >= 8.0 &&
        (h.sector === 'orange' || h.sector === 'red')
      );
    });
    const hasEssentialGreen = essentialHues.includes('green');

    const validMids = effectivePool.filter((s) => {
      const info = classifyAndScoreSpool(s);
      if (info.isBlack || info.isWhite) return false;
      const sLab = rgbToLab(hexToRgb01(s.hex));
      const sHue = getHueSector(sLab);

      // Protect warm portraits: do not allow green/cyan filaments into midtones unless photo has true green
      if (hasWarmSkinSubject && !hasEssentialGreen) {
        if (sHue.sector === 'green' || sHue.sector === 'cyan' || sLab.a < -4.0) {
          return false;
        }
      }

      if (!info.isNeutral) {
        if (
          sHue.sector !== 'neutral' &&
          !essentialHues.includes(sHue.sector) &&
          (hueSectorWeights[sHue.sector] ?? 0) / Math.max(1e-5, totalSampleWeight) < 0.015
        ) {
          return false;
        }
      }
      return true;
    });

    const b0 = blacks[0] || effectivePool[0];
    const w0 = whites[0] || effectivePool[effectivePool.length - 1];
    for (let i = 0; i < validMids.length; i++) {
      for (let j = i + 1; j < validMids.length; j++) {
        if (validMids[i].hex.toLowerCase() === validMids[j].hex.toLowerCase()) continue;
        const infoI = classifyAndScoreSpool(validMids[i]);
        const infoJ = classifyAndScoreSpool(validMids[j]);

        // When the photo has essential chromatic hues:
        const hueI = getHueSector(rgbToLab(hexToRgb01(validMids[i].hex))).sector;
        const hueJ = getHueSector(rgbToLab(hexToRgb01(validMids[j].hex))).sector;

        // Requirement 2: Palette Diversity Enforcement & Histogram Spacing Constraint:
        // Prevent clustering multiple similar neutral or muddy midtones (e.g. Earth Brown + Gray)
        // unless explicitly forced by manual override
        const isMuddyI = isMuddyOrNeutral(validMids[i]);
        const isMuddyJ = isMuddyOrNeutral(validMids[j]);
        if (isMuddyI && isMuddyJ && !manualNeutralOverride && (essentialHues.length > 0 || dynamicChromaBoost > 1.05)) {
          continue; // DISALLOWED! Prevents dual muddy midtones unless manual override
        }

        // When photo has warm autumn foliage/sunset/gold content:
        // Force at least one vibrant yellow or orange spool
        if (hasWarmAutumnOrScenicFoliage) {
          const labI = rgbToLab(hexToRgb01(validMids[i].hex));
          const labJ = rgbToLab(hexToRgb01(validMids[j].hex));
          const isVibrantWarmI = (hueI === 'yellow' || hueI === 'orange') && Math.hypot(labI.a, labI.b) >= 20.0;
          const isVibrantWarmJ = (hueJ === 'yellow' || hueJ === 'orange') && Math.hypot(labJ.a, labJ.b) >= 20.0;
          if (!isVibrantWarmI && !isVibrantWarmJ) {
            continue;
          }
        }

        // In 4-color mode, with only 2 midtone slots:
        // 1. Never allow two chromatic spools in the SAME hue family if another essential hue exists!
        if (hueI !== 'neutral' && hueI === hueJ && essentialHues.some((h) => h !== hueI)) {
          continue;
        }

        // 2. When essential chromatic hues exist:
        // The 4-color palette MUST cover the primary dominant essential hue (essentialHues[0])
        if (essentialHues.length > 0 && !isMonochromeOrGreySubject) {
          const coversPrimaryEssential = hueI === essentialHues[0] || hueJ === essentialHues[0];
          if (!coversPrimaryEssential) {
            continue;
          }
          // If 2 or more essential hues exist, ensure both midtones cover essential hues or are neutral
          if (essentialHues.length >= 2) {
            const hueIOk = infoI.isNeutral || essentialHues.includes(hueI);
            const hueJOk = infoJ.isNeutral || essentialHues.includes(hueJ);
            if (!hueIOk || !hueJOk) {
              continue;
            }
          }
        }

        // When a warm skin-tone or portrait/pet subject is present (Requirement 3):
        // At least one midtone slot must represent the warm skin/fur hue family (orange/red/tan/brown/beige)
        if (hasWarmSkinSubject) {
          const isWarmI =
            hueI === 'orange' ||
            hueI === 'red' ||
            validMids[i].name.toLowerCase().includes('brown') ||
            validMids[i].name.toLowerCase().includes('beige') ||
            validMids[i].name.toLowerCase().includes('bronze');
          const isWarmJ =
            hueJ === 'orange' ||
            hueJ === 'red' ||
            validMids[j].name.toLowerCase().includes('brown') ||
            validMids[j].name.toLowerCase().includes('beige') ||
            validMids[j].name.toLowerCase().includes('bronze');
          if (!isWarmI && !isWarmJ) {
            continue;
          }
        }

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

  // For the best possible photographic print results, proactively recommend >4 colors (8 or 12) whenever the image
  // has multiple color clusters, unlocking finer Beer-Lambert tonal transitions and eliminating banding.
  const highFidelityRecommended: 4 | 8 | 12 | 16 =
    effectivePool.length >= 12 && intrinsicColorCount >= 8
      ? 12
      : effectivePool.length >= 6 && (intrinsicColorCount >= 4 || best4ColorMatch.distinctChromaticsCount >= 2)
        ? 8
        : 4;

  const recommendedColors: 4 | 8 | 12 | 16 = highFidelityRecommended;

  const colorCountAdvisory =
    maxColors <= 4
      ? highFidelityRecommended > 4
        ? `✨ For the best possible print quality, ${highFidelityRecommended} Colors is recommended for this image. K-Means++ detected ${intrinsicColorCount} tonal clusters—upgrading to ${highFidelityRecommended} colors provides richer shadow gradation, smoother skin-tone blends, and superior photographic realism.`
        : `✓ 4-Color Single AMS stack. You can also switch to 8 colors for smoother Beer-Lambert gradient transitions.`
      : maxColors === 8
        ? `🌟 Master Photographic Quality (8 Colors Active): Smooth Beer-Lambert layer blending across all ${intrinsicColorCount} detected color clusters for optimal print fidelity.`
        : `💎 Ultra-HD Multi-AMS Quality (${maxColors} Colors Active): Maximum tonal gradation across all ${intrinsicColorCount} detected color clusters.`;

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
      badge: `Best Match • ΔE00 ${bestLibraryMatch.visualDe.toFixed(1)}`,
      description: 'K-Means++ cluster & Beer-Lambert optical solver using your selected library.',
      scoreDeltaE: Number(bestLibraryMatch.visualDe.toFixed(2)),
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
      scoreDeltaE: Number(vibrantEval.visualDe.toFixed(2)),
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
      scoreDeltaE: Number(monoEval.visualDe.toFixed(2)),
      slots: monoEval.slots,
      recommendedColors: 4,
      colorCountAdvisory,
      detectedClusterCount: intrinsicColorCount,
    },
  ];
}

/**
 * Optimizes the `upToLayer` swap boundaries for a user-defined manual palette
 * while strictly preserving the exact filament lay-down order chosen by the user.
 */
export function optimizeManualSlotBoundaries(
  imageData: ImageData,
  slots: LayerSwapSlot[],
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  baseSolidThicknessMm?: number
): LayerSwapSlot[] {
  const count = slots.length;
  if (count === 0) return [];
  if (count === 1) {
    return [{ ...slots[0], upToLayer: totalLayers }];
  }

  const samples = extractPerceptualSamples(imageData);
  const layerBuckets: { lab: LABColor; weight: number }[] = Array.from({ length: totalLayers }, () => ({
    lab: { L: 0, a: 0, b: 0 },
    weight: 0,
  }));

  const targetBaseLayers =
    baseSolidThicknessMm !== undefined
      ? Math.max(1, 1 + Math.round(Math.max(0, baseSolidThicknessMm - baseLayerMm) / layerHeightMm))
      : Math.min(Math.max(2, Math.floor(totalLayers / count)), 5);
  const minBaseLayer = Math.min(Math.max(1, totalLayers - count), targetBaseLayers);

  let totalSampleWeight = 0;
  for (const s of samples) {
    const layerNumber = minBaseLayer + Math.round(s.luminance * (totalLayers - minBaseLayer));
    const lIdx = Math.max(0, Math.min(totalLayers - 1, layerNumber - 1));
    const bucket = layerBuckets[lIdx];
    const newW = bucket.weight + s.weight;
    bucket.lab.L = (bucket.lab.L * bucket.weight + s.lab.L * s.weight) / newW;
    bucket.lab.a = (bucket.lab.a * bucket.weight + s.lab.a * s.weight) / newW;
    bucket.lab.b = (bucket.lab.b * bucket.weight + s.lab.b * s.weight) / newW;
    bucket.weight = newW;
    totalSampleWeight += s.weight;
  }

  // Initialize monotonic layer boundaries starting with HueForge base layer anchor
  const currentEnds: number[] = slots.map((_, idx) => {
    if (idx === count - 1) return totalLayers;
    if (idx === 0) return minBaseLayer;
    const remFraction = idx / (count - 1);
    return Math.max(
      idx + 1,
      Math.min(
        totalLayers - (count - 1 - idx),
        Math.round(minBaseLayer + remFraction * (totalLayers - minBaseLayer))
      )
    );
  });

  for (let i = 1; i < count; i++) {
    if (currentEnds[i] <= currentEnds[i - 1]) {
      currentEnds[i] = Math.min(totalLayers, currentEnds[i - 1] + 1);
    }
  }
  currentEnds[count - 1] = totalLayers;

  const scoreEnds = (ends: number[]): number => {
    const candidateSlots: LayerSwapSlot[] = slots.map((s, idx) => ({
      ...s,
      upToLayer: ends[idx],
    }));
    const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, candidateSlots);
    let err = 0;
    for (let l = 0; l < totalLayers; l++) {
      const bucket = layerBuckets[l];
      if (bucket.weight <= 0) continue;
      const lutLab = rgbToLab(lut[l].rgb);
      const activeSpoolLab = rgbToLab(hexToRgb01(lut[l].activeSpool.hex));
      err += (ciede2000(bucket.lab, lutLab) * 0.82 + ciede2000(bucket.lab, activeSpoolLab) * 0.18) * bucket.weight;
    }
    return err / Math.max(1e-5, totalSampleWeight);
  };

  let bestScore = scoreEnds(currentEnds);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count - 1; i++) {
      const minL = i === 0 ? Math.max(2, Math.min(4, currentEnds[1] - 1)) : currentEnds[i - 1] + 1;
      const maxL = currentEnds[i + 1] - 1;
      let bestLayerForI = currentEnds[i];
      for (let candidateL = minL; candidateL <= maxL; candidateL++) {
        currentEnds[i] = candidateL;
        const sc = scoreEnds(currentEnds);
        if (sc < bestScore) {
          bestScore = sc;
          bestLayerForI = candidateL;
        }
      }
      currentEnds[i] = bestLayerForI;
    }
  }

  return slots.map((s, idx) => ({
    ...s,
    upToLayer: currentEnds[idx],
  }));
}

