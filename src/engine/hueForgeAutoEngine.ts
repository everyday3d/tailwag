import { FilamentSpool } from '../data/filamentCatalog';
import {
  RGB,
  hexToRgb01,
  rgb01ToHex,
  rgbToLab,
  computeKubelkaMunkReflectance,
  blendPigmentsKubelkaMunk,
  computeScatteringRadiusMm,
  applySubsurfaceLightDiffusion2D,
  buildLayerColorLUT,
  LayerSwapSlot,
} from './opticalTdEngine';
import { ciede2000, LABColor } from './colorQuantizerEngine';
import { applyCLAHE } from './cadMeshBuilder';
import { computeSwapEconomyPenalty, computeHighFrequencyEdgeMap } from './autoSolver';
import {
  STANDARD_BUILD_PLATE_MAX_BBOX_MM,
  STANDARD_INITIAL_LAYER_MM,
  STANDARD_MICRO_LAYER_MM,
  computeStandardBedDimensions,
  layerToZHeight,
  zHeightToExactLayer,
  createMultiAmsSlotMapping,
  computeMeshHeightLimits,
  AmsSlotAssignment,
  PurgeEconomyStats,
  MultiAmsScheduleResult,
  MeshHeightLimitsConfig,
  MeshHeightLimitsResult,
  FilamentLayerSegment,
} from './layerSliceConverter';

export {
  computeKubelkaMunkReflectance,
  blendPigmentsKubelkaMunk,
  computeScatteringRadiusMm,
  applySubsurfaceLightDiffusion2D,
  applyCLAHE,
  computeSwapEconomyPenalty,
  computeHighFrequencyEdgeMap,
  STANDARD_BUILD_PLATE_MAX_BBOX_MM,
  STANDARD_INITIAL_LAYER_MM,
  STANDARD_MICRO_LAYER_MM,
  computeStandardBedDimensions,
  layerToZHeight,
  zHeightToExactLayer,
  createMultiAmsSlotMapping,
  computeMeshHeightLimits,
};
export type {
  AmsSlotAssignment,
  PurgeEconomyStats,
  MultiAmsScheduleResult,
  MeshHeightLimitsConfig,
  MeshHeightLimitsResult,
};

export interface HueForgeAutoConfig {
  /** Target number of filament colors (e.g. 4, 5, 6, or 7 for dual-AMS setups) */
  colorCount: number;
  /** First layer height on build plate in mm (default: 0.16mm) */
  baseLayerMm?: number;
  /** Subsequent layer height in mm (default: 0.08mm) */
  layerHeightMm?: number;
  /** Total number of layers (default: 24 layers = 2.00mm) */
  totalLayers?: number;
  /** Total physical print depth in mm (e.g. 2.0mm to 2.4mm max height) */
  totalDepthMm?: number;
  /** Base solid foundation thickness in mm (e.g. 0.48mm to 0.80mm for total background opacity) */
  baseThicknessMm?: number;
  /** Maximum allowable model height in mm (e.g. 2.0mm to 2.4mm total depth) */
  maxMeshHeightMm?: number;
  /** Maximum palette pool limit for multi-material hardware (default: 7 for dual-AMS setups) */
  maxPalettePool?: number;
  /** Contrast intensity parameter for adaptive S-curve (default: 1.25) */
  sCurveSteepness?: number;
  /** S-curve midpoint bias (default: 0.48) */
  sCurveMidpoint?: number;
  /** Minimum solid base thickness in mm (default: 0.48mm) */
  minBaseThicknessMm?: number;
  /** Whether to apply Contrast Limited Adaptive Histogram Equalization (default: false unless requested) */
  enableClahe?: boolean;
  /** Contrast clip limit for CLAHE (default: 2.5) */
  claheClipLimit?: number;
  /** Maximum pixel dimension for input normalization (default: 256px) */
  maxInputDimension?: number;
  /** Project name for metadata output */
  projectName?: string;
  /** Whether to enforce strict palette feasibility validation (default: true) */
  validateInventory?: boolean;
}

export interface ColorZoneCluster {
  clusterIndex: number;
  lab: LABColor;
  rgb: RGB;
  hex: string;
  weightRatio: number; // 0.0..1.0 fraction of image area
  chroma: number;
}

export interface MatchedFilamentAssignment {
  slotIndex: number;
  spool: FilamentSpool;
  deltaE00: number;
  matchedCluster: ColorZoneCluster;
  opticalRole: 'shadow-base' | 'chromatic-midtone' | 'highlight';
}

export interface LayerChangeScheduleEntry {
  slotIndex: number;
  spool: FilamentSpool;
  startLayer: number;
  endLayer: number;
  /** Exact layer index where slicer pauses or initiates AMS filament swap (1-based) */
  swapAtLayer: number;
  /** Physical Z elevation in mm for the slicer pause/swap */
  swapAtZHeightMm: number;
  layerCount: number;
  thicknessMm: number;
  opticalRole: 'shadow-base' | 'chromatic-midtone' | 'highlight';
}

export interface HueForgeMetadataJSON {
  format: 'HueForge-v1.0';
  generator: string;
  timestamp: string;
  projectName: string;
  printSettings: {
    recommendedTotalPrintHeightMm: number;
    baseLayerThicknessMm: number;
    firstLayerHeightMm: number;
    layerHeightMm: number;
    totalLayers: number;
    infill: string;
  };
  filamentSequence: {
    order: number;
    brand: string;
    name: string;
    material: string;
    hex: string;
    td: number;
    amsTray?: string;
    opticalRole: 'shadow-base' | 'chromatic-midtone' | 'highlight';
    startLayer: number;
    endLayer: number;
    swapAtLayer: number;
    swapAtZHeightMm: number;
    thicknessMm: number;
    pauseGcode: string;
    instructions: string;
  }[];
  slicerPauseListMm: number[];
  multiAms?: {
    totalSwaps: number;
    estimatedPurgeVolumeMm3: number;
    isMonotonicZBand: boolean;
    slots: { tray: string; filament: string; hex: string; td: number }[];
  };
  summary: string;
}

export interface SideBySidePreviewResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  leftLabel: string;
  rightLabel: string;
}

export interface PaletteFeasibilityReport {
  isFeasible: boolean;
  warnings: string[];
  errors: string[];
  stats: {
    minL: number;
    maxL: number;
    minTd: number;
    maxTd: number;
  };
}

export interface HueForgeAutoResult {
  /** Extracted dominant color zones in CIELAB space */
  colorZones: ColorZoneCluster[];
  /** Assigned physical filaments matched via CIEDE2000 */
  assignedFilaments: MatchedFilamentAssignment[];
  /** Optically ordered layer change schedule */
  layerSchedule: LayerChangeScheduleEntry[];
  /** Recommended solid base thickness in mm */
  recommendedBaseThicknessMm: number;
  /** Total blend depth in mm where colors mix via Beer-Lambert transmission */
  blendDepthMm: number;
  /** Total physical model height in mm */
  totalHeightMm: number;
  /** Total layer count */
  totalLayers: number;
  /** Processed normalized luminance map with adaptive S-curve contrast */
  adjustedLuminance: Float32Array;
  /** Structured metadata JSON payload ready for slicer/automation export */
  metadata?: HueForgeMetadataJSON;
  /** Formatted JSON string of metadata */
  metadataJson?: string;
  /** Normalized image data buffer after input guardrails */
  normalizedImageData?: ImageData;
  /** Multi-AMS hardware slot mapping and purge economy statistics */
  multiAmsResult?: MultiAmsScheduleResult;
  /** Physical mesh height and blend depth parameters */
  heightLimits?: MeshHeightLimitsResult;
}

// ============================================================================
// MODULE 1: Perceptual Color Extraction in CIELAB Space
// ============================================================================

/**
 * Extracts N dominant color zone centroids using deterministic weighted K-Means++ in CIELAB.
 */
export function extractPerceptualColorZones(
  imageData: ImageData,
  nZones: number = 4
): { zones: ColorZoneCluster[]; rawLuminance: Float32Array } {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const rawLuminance = new Float32Array(totalPixels);

  interface LabSample {
    lab: LABColor;
    rgb: RGB;
    weight: number;
  }

  // Sample image down to ~3,000 perceptual samples for high speed and spatial representation
  const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / 3000)));
  const samples: LabSample[] = [];
  let totalWeight = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      const pIdx = y * width + x;

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      rawLuminance[pIdx] = lum;

      if (x % step === 0 && y % step === 0) {
        const lab = rgbToLab({ r, g, b });
        const chroma = Math.hypot(lab.a, lab.b);
        // Boost weight of chromatic accents so subtle reds/purples/greens are not erased
        const weight = chroma >= 12.0 ? 1.6 : 1.0;
        samples.push({ lab, rgb: { r, g, b }, weight });
        totalWeight += weight;
      }
    }
  }

  if (samples.length === 0) {
    return { zones: [], rawLuminance };
  }

  const k = Math.max(2, Math.min(nZones, samples.length));

  // K-Means++ deterministic seeding:
  // Seed 1: Darkest sample (shadow base)
  let darkestIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].lab.L < samples[darkestIdx].lab.L) darkestIdx = i;
  }
  const centroids: LABColor[] = [{ ...samples[darkestIdx].lab }];

  // Seed 2: Lightest sample (highlight)
  let lightestIdx = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].lab.L > samples[lightestIdx].lab.L) lightestIdx = i;
  }
  centroids.push({ ...samples[lightestIdx].lab });

  // Remaining seeds: maximize weighted CIEDE2000 distance
  while (centroids.length < k) {
    let maxDist = -1;
    let bestIdx = 0;
    for (let i = 0; i < samples.length; i++) {
      let minDistToCentroids = Infinity;
      for (const c of centroids) {
        const d = ciede2000(samples[i].lab, c);
        if (d < minDistToCentroids) minDistToCentroids = d;
      }
      const score = minDistToCentroids * samples[i].weight;
      if (score > maxDist) {
        maxDist = score;
        bestIdx = i;
      }
    }
    centroids.push({ ...samples[bestIdx].lab });
  }

  // Iterative K-Means convergence (8 passes in CIELAB)
  const assignments = new Int32Array(samples.length);
  for (let iter = 0; iter < 8; iter++) {
    // Expectation step: assign samples to nearest centroid
    for (let i = 0; i < samples.length; i++) {
      let minD = Infinity;
      let minC = 0;
      for (let c = 0; c < k; c++) {
        const d = ciede2000(samples[i].lab, centroids[c]);
        if (d < minD) {
          minD = d;
          minC = c;
        }
      }
      assignments[i] = minC;
    }

    // Maximization step: update centroids
    const sums = Array.from({ length: k }, () => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let i = 0; i < samples.length; i++) {
      const c = assignments[i];
      const s = samples[i];
      sums[c].L += s.lab.L * s.weight;
      sums[c].a += s.lab.a * s.weight;
      sums[c].b += s.lab.b * s.weight;
      sums[c].w += s.weight;
    }

    for (let c = 0; c < k; c++) {
      if (sums[c].w > 0) {
        centroids[c] = {
          L: sums[c].L / sums[c].w,
          a: sums[c].a / sums[c].w,
          b: sums[c].b / sums[c].w,
        };
      }
    }
  }

  // Calculate cluster statistics and RGB representations
  const clusterStats = Array.from({ length: k }, () => ({
    r: 0,
    g: 0,
    b: 0,
    weight: 0,
  }));

  for (let i = 0; i < samples.length; i++) {
    const c = assignments[i];
    const s = samples[i];
    clusterStats[c].r += s.rgb.r * s.weight;
    clusterStats[c].g += s.rgb.g * s.weight;
    clusterStats[c].b += s.rgb.b * s.weight;
    clusterStats[c].weight += s.weight;
  }

  const zones: ColorZoneCluster[] = centroids
    .map((lab, idx) => {
      const w = clusterStats[idx].weight;
      const rgb: RGB =
        w > 0
          ? {
              r: Math.max(0, Math.min(1, clusterStats[idx].r / w)),
              g: Math.max(0, Math.min(1, clusterStats[idx].g / w)),
              b: Math.max(0, Math.min(1, clusterStats[idx].b / w)),
            }
          : { r: 0.5, g: 0.5, b: 0.5 };

      return {
        clusterIndex: idx,
        lab,
        rgb,
        hex: rgb01ToHex(rgb),
        weightRatio: w / Math.max(1e-5, totalWeight),
        chroma: Math.hypot(lab.a, lab.b),
      };
    })
    .sort((a, b) => a.lab.L - b.lab.L); // Sort darkest to lightest

  return { zones, rawLuminance };
}

// ============================================================================
// MODULE 2: Delta E Filament Matching (CIEDE2000)
// ============================================================================

/**
 * Matches extracted color zone centroids against the user's filament library using CIEDE2000.
 */
export function matchFilamentRolls(
  zones: ColorZoneCluster[],
  filamentLibrary: FilamentSpool[]
): MatchedFilamentAssignment[] {
  if (filamentLibrary.length === 0 || zones.length === 0) {
    return [];
  }

  const usedSpoolIds = new Set<string>();
  const assignments: MatchedFilamentAssignment[] = [];

  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    let bestSpool: FilamentSpool | null = null;
    let bestScore = Infinity;

    for (const spool of filamentLibrary) {
      if (usedSpoolIds.has(spool.id)) continue;

      const spoolLab = rgbToLab(hexToRgb01(spool.hex));
      const spoolChroma = Math.hypot(spoolLab.a, spoolLab.b);
      const rawD = ciede2000(zone.lab, spoolLab);
      let adjustedD = rawD;

      // Anti-mud & anti-hallucination penalties:
      if (zone.chroma >= 8.0) {
        if (spoolChroma < 6.0) {
          // Neutral spool stealing chromatic cluster -> penalty!
          adjustedD += 18.0;
        } else {
          // Check hue family cosine similarity:
          const cosSim = (zone.lab.a * spoolLab.a + zone.lab.b * spoolLab.b) / (zone.chroma * spoolChroma);
          if (cosSim < 0.20) {
            adjustedD += 25.0; // Alien hue family penalty
          } else if (cosSim >= 0.70) {
            adjustedD -= Math.min(6.0, (cosSim - 0.5) * 8.0); // Hue family affinity bonus
          }
        }
      } else {
        if (spoolChroma >= 12.0) {
          adjustedD += 15.0; // Saturated spool contaminating neutral region
        }
      }

      if (adjustedD < bestScore) {
        bestScore = adjustedD;
        bestSpool = spool;
      }
    }

    // Fallback if all distinct spools were used
    if (!bestSpool) {
      bestSpool = filamentLibrary[0];
    }

    usedSpoolIds.add(bestSpool.id);

    const role: MatchedFilamentAssignment['opticalRole'] =
      i === 0 ? 'shadow-base' : i === zones.length - 1 ? 'highlight' : 'chromatic-midtone';

    const actualDe00 = ciede2000(zone.lab, rgbToLab(hexToRgb01(bestSpool.hex)));

    assignments.push({
      slotIndex: i,
      spool: bestSpool,
      deltaE00: Number(actualDe00.toFixed(2)),
      matchedCluster: zone,
      opticalRole: role,
    });
  }

  return assignments;
}

// ============================================================================
// MODULE 3: Tone-Curve & Contrast Adjustment (Adaptive S-Curve)
// ============================================================================

/**
 * Applies an adaptive S-curve contrast stretch with soft shoulder/knee roll-off.
 * Ensures highlights do not clip/blow out and shadows retain separation.
 */
export function applyAdaptiveSCurve(
  rawLuminance: Float32Array,
  steepness: number = 1.25,
  midpoint: number = 0.48
): Float32Array {
  const total = rawLuminance.length;
  const adjusted = new Float32Array(total);

  // 1. Compute 2nd and 98th percentiles for robust auto-levels stretch
  const sampleStep = Math.max(1, Math.floor(total / 2000));
  const samples: number[] = [];
  for (let i = 0; i < total; i += sampleStep) {
    samples.push(rawLuminance[i]);
  }
  samples.sort((a, b) => a - b);

  const pLow = samples[Math.floor(samples.length * 0.02)] ?? 0.0;
  const pHigh = samples[Math.floor(samples.length * 0.98)] ?? 1.0;
  const dynRange = Math.max(0.15, pHigh - pLow);

  // 2. Parametric S-curve transfer function:
  // Normalizes logistic curve f(x) = 1 / (1 + exp(-k * (x - m))) to span strictly [0..1]
  const sigmoid = (x: number) => 1.0 / (1.0 + Math.exp(-steepness * 5.0 * (x - midpoint)));
  const y0 = sigmoid(0.0);
  const y1 = sigmoid(1.0);
  const ySpan = Math.max(1e-4, y1 - y0);

  for (let i = 0; i < total; i++) {
    // Linear normalization
    const norm = Math.max(0, Math.min(1, (rawLuminance[i] - pLow) / dynRange));

    // Adaptive S-curve with highlight preservation:
    // Uses cubic smoothstep blending to gently roll off highlights above 0.72
    const sCurved = (sigmoid(norm) - y0) / ySpan;

    let finalLum = sCurved;
    if (norm > 0.72) {
      // Soft shoulder compression: compresses upper 28% without hard clipping
      const t = (norm - 0.72) / 0.28;
      const shoulder = 0.72 + 0.28 * Math.sin((t * Math.PI) / 2);
      finalLum = sCurved * (1 - t * 0.5) + shoulder * (t * 0.5);
    } else if (norm < 0.15) {
      // Shadow toe lift: separates near-black details so shadow textures don't merge to mud
      const t = norm / 0.15;
      const lifted = Math.pow(norm, 0.90);
      finalLum = sCurved * t + lifted * (1 - t);
    }

    adjusted[i] = Math.max(0, Math.min(1, finalLum));
  }

  return adjusted;
}

// ============================================================================
// MODULE 4: Optical Layer Ordering (Ascending Transmittance & Luminance)
// ============================================================================

/**
 * Sorts assigned filaments in strict optical order (lowest TD / darkest base to highest TD / lightest highlight)
 * to prevent under-color light bleed and muddy color transitions.
 */
export function orderFilamentStack(assignments: MatchedFilamentAssignment[]): MatchedFilamentAssignment[] {
  if (assignments.length <= 1) return assignments;

  const getOpticalRank = (spool: FilamentSpool): number => {
    const rgb = hexToRgb01(spool.hex);
    const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    const lab = rgbToLab(rgb);
    const chroma = Math.hypot(lab.a, lab.b);

    // Primary Black Base (L < 22, chroma < 8): must always print first (rank 0.0..0.1)
    if (lab.L < 22 && chroma < 8) {
      return lab.L * 0.004 + spool.td * 0.01;
    }

    // Crisp White Highlight (L > 88, chroma < 8): must always print last (rank 0.9..1.0)
    // Higher TD white prints last as top cap for subtle specular highlights (Requirement 2)
    if (lab.L > 88 && chroma < 8) {
      return 0.90 + lab.L * 0.001 + Math.min(0.05, spool.td * 0.005);
    }

    // Chromatics & midtone greys ordered by luminance and TD so dark shades blend into light
    return 0.15 + lum * 0.70 + Math.min(0.08, spool.td * 0.01);
  };

  const sorted = [...assignments].sort((a, b) => getOpticalRank(a.spool) - getOpticalRank(b.spool));

  return sorted.map((item, idx) => ({
    ...item,
    slotIndex: idx,
    opticalRole: idx === 0 ? 'shadow-base' : idx === sorted.length - 1 ? 'highlight' : 'chromatic-midtone',
  }));
}

// ============================================================================
// MODULE 5: Output Generation (Layer Change Height Schedule)
// ============================================================================

/**
 * Generates exact layer swap heights, solid base foundation, and blend depth schedule.
 * Enforces fixed layer height architecture (0.16mm base + 0.08mm micro-layers),
 * blend depth / base thickness physical scaling, and multi-AMS slot mapping.
 */
export function generateLayerSchedule(
  orderedFilaments: MatchedFilamentAssignment[],
  config: HueForgeAutoConfig
): {
  schedule: LayerChangeScheduleEntry[];
  recommendedBaseThicknessMm: number;
  blendDepthMm: number;
  totalHeightMm: number;
  totalLayers: number;
  multiAmsResult: MultiAmsScheduleResult;
  heightLimits: MeshHeightLimitsResult;
} {
  const baseThicknessParam = config.baseThicknessMm ?? config.minBaseThicknessMm ?? 0.48;
  const maxHeightParam = config.maxMeshHeightMm ?? config.totalDepthMm ?? 2.0;

  const heightLimits = computeMeshHeightLimits({
    baseThicknessMm: baseThicknessParam,
    maxMeshHeightMm: maxHeightParam,
    baseLayerMm: config.baseLayerMm ?? STANDARD_INITIAL_LAYER_MM,
    layerHeightMm: config.layerHeightMm ?? STANDARD_MICRO_LAYER_MM,
  });

  const baseLayerMm = heightLimits.baseLayerMm;
  const layerHeightMm = heightLimits.layerHeightMm;
  const totalLayers =
    config.totalDepthMm !== undefined || config.maxMeshHeightMm !== undefined
      ? heightLimits.totalLayers
      : config.totalLayers ?? heightLimits.totalLayers;

  const count = orderedFilaments.length;
  const totalHeightMm = layerToZHeight(totalLayers, baseLayerMm, layerHeightMm);
  const minBaseLayer = heightLimits.baseLayers;
  const recommendedBaseThicknessMm = heightLimits.baseThicknessMm;
  const blendDepthMm = Number((totalHeightMm - recommendedBaseThicknessMm).toFixed(3));

  // Allocate layers across filaments:
  // Base filament gets layers 1..minBaseLayer.
  // Remaining filaments share the remaining blend layers proportionally.
  const remainingLayers = Math.max(count - 1, totalLayers - minBaseLayer);
  const schedule: LayerChangeScheduleEntry[] = [];
  let currentStartLayer = 1;

  for (let i = 0; i < count; i++) {
    const item = orderedFilaments[i];
    let endLayer: number;

    if (i === 0) {
      endLayer = minBaseLayer;
    } else if (i === count - 1) {
      endLayer = totalLayers;
    } else {
      const frac = i / (count - 1);
      endLayer = Math.min(totalLayers - (count - 1 - i), minBaseLayer + Math.round(frac * remainingLayers));
      if (endLayer <= currentStartLayer) {
        endLayer = currentStartLayer + 1;
      }
    }

    const segLayers = endLayer - currentStartLayer + 1;
    const startZMm =
      currentStartLayer === 1
        ? 0
        : layerToZHeight(currentStartLayer - 1, baseLayerMm, layerHeightMm);
    const topZMm = layerToZHeight(endLayer, baseLayerMm, layerHeightMm);
    const thicknessMm = Number((topZMm - startZMm).toFixed(3));

    schedule.push({
      slotIndex: i,
      spool: item.spool,
      startLayer: currentStartLayer,
      endLayer,
      swapAtLayer: endLayer,
      swapAtZHeightMm: topZMm,
      layerCount: segLayers,
      thicknessMm,
      opticalRole: item.opticalRole,
    });

    currentStartLayer = endLayer + 1;
  }

  const segments: FilamentLayerSegment[] = schedule.map((s, idx) => ({
    slotIndex: idx,
    spool: s.spool,
    startLayer: s.startLayer,
    endLayer: s.endLayer,
    layerCount: s.layerCount,
    startZMm: s.startLayer === 1 ? 0 : layerToZHeight(s.startLayer - 1, baseLayerMm, layerHeightMm),
    topZMm: s.swapAtZHeightMm,
    thicknessMm: s.thicknessMm,
  }));

  const multiAmsResult = createMultiAmsSlotMapping(segments, config.maxPalettePool ?? 7);

  return {
    schedule,
    recommendedBaseThicknessMm,
    blendDepthMm,
    totalHeightMm,
    totalLayers,
    multiAmsResult,
    heightLimits,
  };
}

// ============================================================================
// MODULE 6: Input Validation, Guardrails & sRGB Normalization
// ============================================================================

/**
 * Validates and normalizes input image data:
 * - Automatically resizes/downsamples images whose width or height exceeds maxDimension (e.g. 256px)
 *   preserving aspect ratio to prevent memory overflow during multi-pass matrix optimization.
 * - Enforces valid dimensions (> 0) and RGBA buffer consistency.
 * - Converts color inputs to standard sRGB space with gamma transfer before perceptual CIELAB / Delta E.
 */
export function validateAndNormalizeImageData(
  source: ImageData,
  maxDimension: number = 256
): ImageData {
  if (!source || source.width <= 0 || source.height <= 0) {
    throw new Error(
      `Invalid image input: dimensions must be positive (received ${source?.width}x${source?.height})`
    );
  }
  const { width, height, data } = source;
  if (data.length !== width * height * 4) {
    throw new Error(
      `Invalid image data buffer: length ${data.length} does not match ${width}x${height}x4`
    );
  }

  // If already within bounds, return a verified sRGB copy
  if (width <= maxDimension && height <= maxDimension) {
    const cleanData = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      cleanData[i] = Math.max(0, Math.min(255, data[i]));
      cleanData[i + 1] = Math.max(0, Math.min(255, data[i + 1]));
      cleanData[i + 2] = Math.max(0, Math.min(255, data[i + 2]));
      cleanData[i + 3] = 255;
    }
    return { width, height, data: cleanData } as unknown as ImageData;
  }

  // Calculate aspect ratio preserving scaled dimensions
  const scale = Math.min(maxDimension / width, maxDimension / height);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const outData = new Uint8ClampedArray(targetW * targetH * 4);
  const xRatio = width / targetW;
  const yRatio = height / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    const sy = Math.min(height - 1, Math.floor(ty * yRatio));
    for (let tx = 0; tx < targetW; tx++) {
      const sx = Math.min(width - 1, Math.floor(tx * xRatio));
      const srcIdx = (sy * width + sx) * 4;
      const dstIdx = (ty * targetW + tx) * 4;

      outData[dstIdx] = Math.max(0, Math.min(255, data[srcIdx]));
      outData[dstIdx + 1] = Math.max(0, Math.min(255, data[srcIdx + 1]));
      outData[dstIdx + 2] = Math.max(0, Math.min(255, data[srcIdx + 2]));
      outData[dstIdx + 3] = 255;
    }
  }

  return {
    width: targetW,
    height: targetH,
    data: outData,
  } as unknown as ImageData;
}

// ============================================================================
// MODULE 7: Error Handling for Impossible Palettes
// ============================================================================

export class HueForgePaletteError extends Error {
  public readonly diagnostics: {
    minL: number;
    maxL: number;
    minTd: number;
    maxTd: number;
    reasons: string[];
  };

  constructor(
    message: string,
    diagnostics: { minL: number; maxL: number; minTd: number; maxTd: number; reasons: string[] }
  ) {
    super(message);
    this.name = 'HueForgePaletteError';
    this.diagnostics = diagnostics;
    Object.setPrototypeOf(this, HueForgePaletteError.prototype);
  }
}

/**
 * Validates filament inventory feasibility before starting slicing optimization:
 * - Detects palettes lacking dark contrast anchors (e.g. 4 whites and 1 yellow; min L* > 32).
 * - Detects palettes lacking highlight caps (max L* < 60 or max TD < 1.4).
 * - Detects palettes with zero TD spread that would flatten optical stacking.
 */
export function validateFilamentInventory(
  filaments: FilamentSpool[],
  _config?: Partial<HueForgeAutoConfig>
): PaletteFeasibilityReport {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!filaments || filaments.length < 2) {
    errors.push('Filament inventory must contain at least 2 filaments for multi-layer optical slicing.');
    return {
      isFeasible: false,
      warnings,
      errors,
      stats: { minL: 0, maxL: 100, minTd: 0, maxTd: 10 },
    };
  }

  let minL = Infinity;
  let maxL = -Infinity;
  let minTd = Infinity;
  let maxTd = -Infinity;

  for (const f of filaments) {
    const rgb = hexToRgb01(f.hex);
    const lab = rgbToLab(rgb);
    if (lab.L < minL) minL = lab.L;
    if (lab.L > maxL) maxL = lab.L;
    if (f.td < minTd) minTd = f.td;
    if (f.td > maxTd) maxTd = f.td;
  }

  // 1. Dark Shadow Anchor Rule:
  // If inventory lacks any filament with L* < 32.0 (e.g. all filaments are white or yellow),
  // optical stacking cannot anchor shadows and will produce an utterly washed-out print.
  if (minL > 32.0) {
    errors.push(
      `Impossible Palette: The provided filament inventory lacks dark contrast anchors (darkest filament L* is ${minL.toFixed(1)}, but base layer requires L* < 30.0). All filaments are light or pastel, causing a completely washed-out print with zero shadow depth. Provide at least one dark filament (e.g. Black, Charcoal, Navy, or Deep Brown) to anchor the shadows.`
    );
  }

  // 2. High TD Highlight Cap Warning:
  if (maxL < 60.0 || maxTd < 1.4) {
    warnings.push(
      `Warning: Palette lacks a high-transmittance highlight cap (highest L* is ${maxL.toFixed(1)}, highest TD is ${maxTd.toFixed(1)}mm). Highlights and fine specular details will appear muted.`
    );
  }

  // 3. TD Diversity:
  if (maxTd - minTd < 0.4 && filaments.length > 2) {
    warnings.push(
      `Warning: Filaments have nearly identical Transmittance Distances (${minTd.toFixed(1)}–${maxTd.toFixed(1)}mm). Optical layering relies on progressive light transmission; identical TDs will flatten dynamic range.`
    );
  }

  return {
    isFeasible: errors.length === 0,
    warnings,
    errors,
    stats: { minL, maxL, minTd, maxTd },
  };
}

// ============================================================================
// MODULE 8: Export Formats & G-Code / Metadata Generation
// ============================================================================

/**
 * Generates structured HueForge project metadata JSON object.
 */
export function generateHueForgeMetadata(
  result: HueForgeAutoResult,
  projectName: string = 'TailWag Project'
): HueForgeMetadataJSON {
  const pauseHeights = result.layerSchedule
    .filter((_, idx) => idx > 0)
    .map((s) => s.swapAtZHeightMm);

  const filamentSequence = result.layerSchedule.map((entry, idx) => {
    const isFirst = idx === 0;
    const amsAssignment = result.multiAmsResult?.slotAssignments[idx];
    const amsTray = amsAssignment?.trayName;
    const amsPrefix = amsTray ? `[${amsTray}] ` : '';
    const swapNote = isFirst
      ? `Load base spool on build plate (${amsPrefix}${entry.spool.brand} ${entry.spool.name}). Print from Layer 1 (0.00mm) up to Layer ${entry.swapAtLayer} (${entry.swapAtZHeightMm}mm).`
      : `Swap to ${amsPrefix}${entry.spool.brand} ${entry.spool.name} at Layer ${entry.startLayer} (${entry.swapAtZHeightMm}mm). Print up to Layer ${entry.swapAtLayer} (${entry.swapAtZHeightMm}mm).`;

    return {
      order: idx + 1,
      brand: entry.spool.brand,
      name: entry.spool.name,
      material: entry.spool.material,
      hex: entry.spool.hex,
      td: entry.spool.td,
      amsTray,
      opticalRole: entry.opticalRole,
      startLayer: entry.startLayer,
      endLayer: entry.endLayer,
      swapAtLayer: entry.swapAtLayer,
      swapAtZHeightMm: entry.swapAtZHeightMm,
      thicknessMm: entry.thicknessMm,
      pauseGcode: isFirst ? '; Initial base spool' : `M600 ; Filament change to ${entry.spool.name}`,
      instructions: swapNote,
    };
  });

  const pauseLines = filamentSequence
    .filter((_, idx) => idx > 0)
    .map(
      (s) =>
        `- Layer ${s.startLayer} (${s.swapAtZHeightMm}mm): Swap to ${s.amsTray ? `[${s.amsTray}] ` : ''}${s.brand} ${s.name} (TD: ${s.td}mm)`
    )
    .join('\n');

  const multiAmsSummaryLines = result.multiAmsResult
    ? [
        `Hardware: Dual-AMS Slot Mapping (${result.multiAmsResult.slotAssignments.length} spools, ${result.multiAmsResult.purgeEconomy.totalSwaps} swaps, ~${result.multiAmsResult.purgeEconomy.estimatedPurgeVolumeMm3} mm³ purge):`,
        ...result.multiAmsResult.slotAssignments.map(
          (a) => `  - ${a.trayName}: ${a.spool.brand} ${a.spool.name} (${a.spool.hex}, TD: ${a.spool.td}mm)`
        ),
      ]
    : [];

  const summary = [
    `=== HueForge Print Instructions for ${projectName} ===`,
    `Total Print Height: ${result.totalHeightMm}mm (${result.totalLayers} layers)`,
    `Base Layer Thickness: ${result.recommendedBaseThicknessMm}mm (100% rectilinear solid base)`,
    `Blend Depth: ${result.blendDepthMm}mm (Beer-Lambert optical gradient)`,
    ...multiAmsSummaryLines,
    `Filament Swaps (${result.layerSchedule.length} colors):`,
    pauseLines,
  ].join('\n');

  return {
    format: 'HueForge-v1.0',
    generator: 'TailWag Studio v1.0',
    timestamp: new Date().toISOString(),
    projectName,
    printSettings: {
      recommendedTotalPrintHeightMm: result.totalHeightMm,
      baseLayerThicknessMm: result.recommendedBaseThicknessMm,
      firstLayerHeightMm: 0.16,
      layerHeightMm: 0.08,
      totalLayers: result.totalLayers,
      infill: '100% Rectilinear (solid shells)',
    },
    filamentSequence,
    slicerPauseListMm: pauseHeights,
    multiAms: result.multiAmsResult
      ? {
          totalSwaps: result.multiAmsResult.purgeEconomy.totalSwaps,
          estimatedPurgeVolumeMm3: result.multiAmsResult.purgeEconomy.estimatedPurgeVolumeMm3,
          isMonotonicZBand: result.multiAmsResult.purgeEconomy.isMonotonicZBand,
          slots: result.multiAmsResult.slotAssignments.map((a) => ({
            tray: a.trayName,
            filament: `${a.spool.brand} ${a.spool.name}`,
            hex: a.spool.hex,
            td: a.spool.td,
          })),
        }
      : undefined,
    summary,
  };
}

/**
 * Returns formatted JSON string for HueForge metadata export.
 */
export function generateHueForgeMetadataJson(
  result: HueForgeAutoResult,
  projectName: string = 'TailWag Project'
): string {
  return JSON.stringify(generateHueForgeMetadata(result, projectName), null, 2);
}

// ============================================================================
// MODULE 9: Side-by-Side Visual Preview Generator
// ============================================================================

/**
 * Generates the simulated optical stacking image color buffer (RGB 0..1)
 * across the normalized grid matching the layer change schedule.
 */
export function simulateOpticalStackingPreview(
  result: HueForgeAutoResult,
  width: number,
  height: number,
  baseLayerMm: number = 0.16,
  layerHeightMm: number = 0.08
): Float32Array {
  const totalPixels = width * height;
  const rgbOut = new Float32Array(totalPixels * 3);
  const slots: LayerSwapSlot[] = result.layerSchedule.map((entry, idx) => ({
    id: `slot-${idx}`,
    spool: entry.spool,
    upToLayer: entry.swapAtLayer,
  }));

  const lut = buildLayerColorLUT(result.totalLayers, baseLayerMm, layerHeightMm, slots, {
    model: 'kubelka-munk',
  });

  const lumMap = result.adjustedLuminance;

  for (let i = 0; i < totalPixels; i++) {
    const lum = i < lumMap.length ? lumMap[i] : 0.5;
    // Map normalized luminance to active layer index (1..totalLayers)
    const targetLayer = Math.min(
      result.totalLayers,
      Math.max(1, 1 + Math.round(lum * (result.totalLayers - 1)))
    );
    const entry = lut[targetLayer - 1];
    const idx = i * 3;
    rgbOut[idx] = entry.rgb.r;
    rgbOut[idx + 1] = entry.rgb.g;
    rgbOut[idx + 2] = entry.rgb.b;
  }

  return rgbOut;
}

/**
 * Generates a side-by-side comparison image buffer:
 * (Left) Target Original Image, (Center) 2px Dark Border, (Right) Simulated Optical Preview.
 */
export function generateSideBySidePreview(
  targetImage: ImageData,
  simulatedRgb: Float32Array,
  width: number,
  height: number
): SideBySidePreviewResult {
  const dividerWidth = 2;
  const outWidth = width * 2 + dividerWidth;
  const outHeight = height;
  const outBuffer = new Uint8ClampedArray(outWidth * outHeight * 4);

  const srcData = targetImage.data;
  const srcW = targetImage.width;
  const srcH = targetImage.height;

  for (let y = 0; y < outHeight; y++) {
    const srcY = Math.min(srcH - 1, Math.floor((y / outHeight) * srcH));

    for (let x = 0; x < outWidth; x++) {
      const outIdx = (y * outWidth + x) * 4;

      if (x < width) {
        // Left side: Target Image
        const srcX = Math.min(srcW - 1, Math.floor((x / width) * srcW));
        const sIdx = (srcY * srcW + srcX) * 4;
        outBuffer[outIdx] = srcData[sIdx];
        outBuffer[outIdx + 1] = srcData[sIdx + 1];
        outBuffer[outIdx + 2] = srcData[sIdx + 2];
        outBuffer[outIdx + 3] = 255;
      } else if (x < width + dividerWidth) {
        // Center: Dark divider line
        outBuffer[outIdx] = 30;
        outBuffer[outIdx + 1] = 30;
        outBuffer[outIdx + 2] = 30;
        outBuffer[outIdx + 3] = 255;
      } else {
        // Right side: Simulated Optical Stacking Preview
        const simX = x - width - dividerWidth;
        const simIdx = (y * width + simX) * 3;
        outBuffer[outIdx] = Math.max(0, Math.min(255, Math.round(simulatedRgb[simIdx] * 255)));
        outBuffer[outIdx + 1] = Math.max(0, Math.min(255, Math.round(simulatedRgb[simIdx + 1] * 255)));
        outBuffer[outIdx + 2] = Math.max(0, Math.min(255, Math.round(simulatedRgb[simIdx + 2] * 255)));
        outBuffer[outIdx + 3] = 255;
      }
    }
  }

  return {
    width: outWidth,
    height: outHeight,
    data: outBuffer,
    leftLabel: 'Target Image',
    rightLabel: 'Simulated Optical Stacking Preview',
  };
}

// ============================================================================
// MODULE 10: Performance Vectorization
// ============================================================================

/**
 * Vectorized typed-array CIEDE2000 calculation across flat Float32Array buffers.
 * Evaluates ΔE00 for count elements without object allocations inside loops.
 * labA: Float32Array of size (count * 3) [L, a, b, L, a, b, ...]
 * labB: Float32Array of size (count * 3) [L, a, b, L, a, b, ...]
 * outDeltaE: Float32Array of size (count)
 */
export function vectorizedBatchCiede2000(
  labA: Float32Array,
  labB: Float32Array,
  count: number,
  outDeltaE: Float32Array
): void {
  const radToDeg = 180 / Math.PI;
  const degToRad = Math.PI / 180;
  const pow25_7 = 6103515625; // 25^7

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const L1 = labA[idx];
    const a1 = labA[idx + 1];
    const b1 = labA[idx + 2];
    const L2 = labB[idx];
    const a2 = labB[idx + 1];
    const b2 = labB[idx + 2];

    const avgL = (L1 + L2) * 0.5;
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const avgC = (C1 + C2) * 0.5;

    const avgC7 = Math.pow(avgC, 7);
    const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + pow25_7)));

    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const avgCp = (C1p + C2p) * 0.5;

    let h1p = Math.atan2(b1, a1p) * radToDeg;
    if (h1p < 0) h1p += 360;
    let h2p = Math.atan2(b2, a2p) * radToDeg;
    if (h2p < 0) h2p += 360;

    const dLp = L2 - L1;
    const dCp = C2p - C1p;

    let dhp = 0;
    if (C1p * C2p !== 0) {
      if (Math.abs(h2p - h1p) <= 180) {
        dhp = h2p - h1p;
      } else if (h2p - h1p > 180) {
        dhp = h2p - h1p - 360;
      } else {
        dhp = h2p - h1p + 360;
      }
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * 0.5) * degToRad);

    let avgHp = h1p + h2p;
    if (C1p * C2p === 0) {
      avgHp = h1p + h2p;
    } else if (Math.abs(h1p - h2p) <= 180) {
      avgHp = (h1p + h2p) * 0.5;
    } else if (h1p + h2p < 360) {
      avgHp = (h1p + h2p + 360) * 0.5;
    } else {
      avgHp = (h1p + h2p - 360) * 0.5;
    }

    const T =
      1 -
      0.17 * Math.cos((avgHp - 30) * degToRad) +
      0.24 * Math.cos(2 * avgHp * degToRad) +
      0.32 * Math.cos((3 * avgHp + 6) * degToRad) -
      0.20 * Math.cos((4 * avgHp - 63) * degToRad);

    const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
    const avgCp7 = Math.pow(avgCp, 7);
    const RC = 2 * Math.sqrt(avgCp7 / (avgCp7 + pow25_7));

    const avgLm50_2 = Math.pow(avgL - 50, 2);
    const SL = 1 + (0.015 * avgLm50_2) / Math.sqrt(20 + avgLm50_2);
    const SC = 1 + 0.045 * avgCp;
    const SH = 1 + 0.015 * avgCp * T;
    const RT = -Math.sin(2 * dTheta * degToRad) * RC;

    const kL = 1.15;
    const kC = 1.0;
    const kH = 0.85;

    const termL = dLp / (kL * SL);
    const termC = dCp / (kC * SC);
    const termH = dHp / (kH * SH);

    outDeltaE[i] = Math.sqrt(
      Math.max(0, termL * termL + termC * termC + termH * termH + RT * termC * termH)
    );
  }
}

// ============================================================================
// MAIN UNIFIED AUTO-COLOR ENGINE PIPELINE
// ============================================================================

/**
 * Executes the complete HueForge-style auto-color picker, validation, and mapping engine.
 */
export function runHueForgeAutoEngine(
  inputImageData: ImageData,
  filamentDatabase: FilamentSpool[],
  config: HueForgeAutoConfig
): HueForgeAutoResult {
  // 0. Input Validation & Pre-processing Guardrails:
  // Auto-resize to standard aspect ratio and maximum resolution (default: 256px max width/height)
  // to prevent memory overflow during multi-pass matrix optimization, and convert to standard sRGB
  const maxDim = config.maxInputDimension ?? 256;
  const imageData = validateAndNormalizeImageData(inputImageData, maxDim);

  // 0b. Inventory & Palette Feasibility Validation:
  // Throws descriptive HueForgePaletteError if palette lacks dark contrast anchors or is unviable
  if (config.validateInventory !== false) {
    const feasibility = validateFilamentInventory(filamentDatabase, config);
    if (!feasibility.isFeasible) {
      throw new HueForgePaletteError(feasibility.errors.join('\n'), {
        minL: feasibility.stats.minL,
        maxL: feasibility.stats.maxL,
        minTd: feasibility.stats.minTd,
        maxTd: feasibility.stats.maxTd,
        reasons: feasibility.errors,
      });
    }
  }

  // 1. Perceptual Color Extraction
  const { zones, rawLuminance } = extractPerceptualColorZones(imageData, config.colorCount);

  // 2. Delta E Filament Matching
  const matched = matchFilamentRolls(zones, filamentDatabase);

  // 3. Tone-Curve & Contrast Adjustment (with optional CLAHE local histogram equalization)
  const baseLuminance = config.enableClahe
    ? applyCLAHE(rawLuminance, imageData.width, imageData.height, config.claheClipLimit ?? 2.5)
    : rawLuminance;
  const adjustedLuminance = applyAdaptiveSCurve(
    baseLuminance,
    config.sCurveSteepness ?? 1.25,
    config.sCurveMidpoint ?? 0.48
  );

  // 4. Optical Layer Ordering
  const ordered = orderFilamentStack(matched);

  // 5. Output Generation
  const {
    schedule,
    recommendedBaseThicknessMm,
    blendDepthMm,
    totalHeightMm,
    totalLayers,
    multiAmsResult,
    heightLimits,
  } = generateLayerSchedule(ordered, config);

  const result: HueForgeAutoResult = {
    colorZones: zones,
    assignedFilaments: ordered,
    layerSchedule: schedule,
    recommendedBaseThicknessMm,
    blendDepthMm,
    totalHeightMm,
    totalLayers,
    adjustedLuminance,
    normalizedImageData: imageData,
    multiAmsResult,
    heightLimits,
  };

  const metadata = generateHueForgeMetadata(result, config.projectName);
  result.metadata = metadata;
  result.metadataJson = JSON.stringify(metadata, null, 2);

  return result;
}
