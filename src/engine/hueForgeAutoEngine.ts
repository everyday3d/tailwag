import { FilamentSpool } from '../data/filamentCatalog';
import { RGB, hexToRgb01, rgb01ToHex, rgbToLab } from './opticalTdEngine';
import { ciede2000, LABColor } from './colorQuantizerEngine';

export interface HueForgeAutoConfig {
  /** Target number of filament colors (e.g. 4, 5, or 6) */
  colorCount: number;
  /** First layer height on build plate in mm (default: 0.16mm) */
  baseLayerMm?: number;
  /** Subsequent layer height in mm (default: 0.08mm) */
  layerHeightMm?: number;
  /** Total number of layers (default: 24 layers = 2.00mm) */
  totalLayers?: number;
  /** Total physical print depth in mm (e.g. 2.0mm to 2.4mm max height) */
  totalDepthMm?: number;
  /** Contrast intensity parameter for adaptive S-curve (default: 1.25) */
  sCurveSteepness?: number;
  /** S-curve midpoint bias (default: 0.48) */
  sCurveMidpoint?: number;
  /** Minimum solid base thickness in mm (default: 0.48mm) */
  minBaseThicknessMm?: number;
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
} {
  const {
    baseLayerMm = 0.16,
    layerHeightMm = 0.08,
    totalDepthMm,
    minBaseThicknessMm = 0.48,
  } = config;

  const totalLayers =
    totalDepthMm !== undefined
      ? Math.max(4, 1 + Math.round(Math.max(0, totalDepthMm - baseLayerMm) / layerHeightMm))
      : config.totalLayers ?? 24;

  const count = orderedFilaments.length;
  const totalHeightMm = Number((baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(3));

  // Minimum solid base foundation layers (e.g. 0.48mm = Layer 1 (0.16) + 4 layers (0.08) = 5 layers)
  const baseLayersCount = Math.max(
    1,
    1 + Math.round(Math.max(0, minBaseThicknessMm - baseLayerMm) / layerHeightMm)
  );
  const minBaseLayer = Math.min(Math.max(1, totalLayers - count), baseLayersCount);
  const recommendedBaseThicknessMm = Number((baseLayerMm + (minBaseLayer - 1) * layerHeightMm).toFixed(3));
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
      const frac = (i) / (count - 1);
      endLayer = Math.min(totalLayers - (count - 1 - i), minBaseLayer + Math.round(frac * remainingLayers));
      if (endLayer <= currentStartLayer) {
        endLayer = currentStartLayer + 1;
      }
    }

    const segLayers = endLayer - currentStartLayer + 1;
    const startZMm =
      currentStartLayer === 1
        ? 0
        : Number((baseLayerMm + (currentStartLayer - 2) * layerHeightMm).toFixed(3));
    const topZMm = Number((baseLayerMm + (endLayer - 1) * layerHeightMm).toFixed(3));
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

  return {
    schedule,
    recommendedBaseThicknessMm,
    blendDepthMm,
    totalHeightMm,
    totalLayers,
  };
}

// ============================================================================
// MAIN UNIFIED AUTO-COLOR ENGINE PIPELINE
// ============================================================================

/**
 * Executes the complete 5-stage HueForge-style auto-color picker and mapping engine.
 */
export function runHueForgeAutoEngine(
  imageData: ImageData,
  filamentDatabase: FilamentSpool[],
  config: HueForgeAutoConfig
): HueForgeAutoResult {
  // 1. Perceptual Color Extraction
  const { zones, rawLuminance } = extractPerceptualColorZones(imageData, config.colorCount);

  // 2. Delta E Filament Matching
  const matched = matchFilamentRolls(zones, filamentDatabase);

  // 3. Tone-Curve & Contrast Adjustment
  const adjustedLuminance = applyAdaptiveSCurve(
    rawLuminance,
    config.sCurveSteepness ?? 1.25,
    config.sCurveMidpoint ?? 0.48
  );

  // 4. Optical Layer Ordering
  const ordered = orderFilamentStack(matched);

  // 5. Output Generation
  const { schedule, recommendedBaseThicknessMm, blendDepthMm, totalHeightMm, totalLayers } =
    generateLayerSchedule(ordered, config);

  return {
    colorZones: zones,
    assignedFilaments: ordered,
    layerSchedule: schedule,
    recommendedBaseThicknessMm,
    blendDepthMm,
    totalHeightMm,
    totalLayers,
    adjustedLuminance,
  };
}
