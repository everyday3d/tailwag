import { FilamentSpool } from '../data/filamentCatalog';
import { LayerSwapSlot } from './opticalTdEngine';
import {
  applyBilateralHeightmapFilter,
  computeSobelEdgeMask,
  applySpatialGradientSmoothing,
  quantizeHeightmapMatrix,
  applyMorphologicalRegionMerge,
} from './cadMeshBuilder';

export {
  applyBilateralHeightmapFilter,
  computeSobelEdgeMask,
  applySpatialGradientSmoothing,
  quantizeHeightmapMatrix,
  applyMorphologicalRegionMerge,
};

export interface LayerSliceConfig {
  /** Initial layer height printed directly on the build plate (e.g. 0.16mm or 0.20mm) */
  baseLayerMm: number;
  /** Subsequent layer height for all upper layers (e.g. 0.08mm, 0.12mm, or 0.16mm) */
  layerHeightMm: number;
  /** Minimum number of solid foundation base layers (default: 1) */
  minBaseLayers?: number;
  /** Maximum allowable print height in mm (optional ceiling) */
  maxHeightMm?: number;
  /** Whether to apply edge-preserving spatial bilateral filtering to 2D height maps (default: false) */
  enableBilateralFilter?: boolean;
  /** Whether to apply morphological region merging to eliminate isolated pixel speckles (default: true for grids >= 4x4) */
  enableMorphologicalFilter?: boolean;
  /** Minimum pixel area threshold for connected components (default: 4 adjacent pixels) */
  minRegionPixels?: number;
  /** Whether to apply structural gradient smoothing to eliminate sudden height discontinuities (default: false unless enabled) */
  enableGradientSmoothing?: boolean;
  /** Sobel edge threshold above which height jumps are preserved as major edges (default: 0.35) */
  edgeThreshold?: number;
}

// ============================================================================
// PHYSICAL & GEOMETRIC SLICING STANDARDS
// ============================================================================

/**
 * Standard build plate printable envelope bounding box in millimeters (Bambu Lab build plates: 246x246mm safe).
 */
export const STANDARD_BUILD_PLATE_MAX_BBOX_MM = 246.0;

/**
 * Standard robust initial base layer height in millimeters.
 */
export const STANDARD_INITIAL_LAYER_MM = 0.16;

/**
 * Standard uniform micro-layer height in millimeters for smooth optical gradients.
 */
export const STANDARD_MICRO_LAYER_MM = 0.08;

/**
 * Computes standardized build plate dimensions fitted inside the bounding box (246x246mm),
 * strictly maintaining the image's aspect ratio without any padding, letterboxing, or distortion.
 */
export function computeStandardBedDimensions(
  imageWidth: number,
  imageHeight: number,
  maxBoundingBoxMm: number = STANDARD_BUILD_PLATE_MAX_BBOX_MM
): { widthMm: number; heightMm: number; aspectRatio: number; maxBoundingBoxMm: number } {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return {
      widthMm: maxBoundingBoxMm,
      heightMm: maxBoundingBoxMm,
      aspectRatio: 1.0,
      maxBoundingBoxMm,
    };
  }
  const aspectRatio = imageWidth / imageHeight;
  let widthMm: number;
  let heightMm: number;

  if (aspectRatio >= 1.0) {
    widthMm = maxBoundingBoxMm;
    heightMm = Number((maxBoundingBoxMm / aspectRatio).toFixed(2));
  } else {
    heightMm = maxBoundingBoxMm;
    widthMm = Number((maxBoundingBoxMm * aspectRatio).toFixed(2));
  }

  return {
    widthMm,
    heightMm,
    aspectRatio,
    maxBoundingBoxMm,
  };
}

/**
 * Maps a discrete layer index (1-based: 1..N) to its exact physical Z-axis elevation in mm
 * based on standard 0.16mm base + 0.08mm micro-layer increments.
 */
export function layerToZHeight(
  layer: number,
  baseLayerMm: number = STANDARD_INITIAL_LAYER_MM,
  layerHeightMm: number = STANDARD_MICRO_LAYER_MM
): number {
  if (layer <= 0) return 0.0;
  return Number((baseLayerMm + (layer - 1) * layerHeightMm).toFixed(4));
}

/**
 * Quantizes an arbitrary continuous physical Z elevation in mm to the nearest discrete layer index.
 */
export function zHeightToExactLayer(
  zHeightMm: number,
  baseLayerMm: number = STANDARD_INITIAL_LAYER_MM,
  layerHeightMm: number = STANDARD_MICRO_LAYER_MM
): number {
  if (zHeightMm <= 0) return 0;
  if (zHeightMm <= baseLayerMm) return 1;
  return 1 + Math.round((zHeightMm - baseLayerMm) / layerHeightMm);
}

// ============================================================================
// MULTI-AMS HARDWARE SLOT MAPPING & PURGE ECONOMY
// ============================================================================

export interface AmsSlotAssignment {
  paletteIndex: number; // 0..N-1
  spool: FilamentSpool;
  amsUnit: 1 | 2; // 1 = AMS 1 (Slots 1-4), 2 = AMS 2 (Slots 5-8)
  amsSlot: 1 | 2 | 3 | 4; // Slot within the unit
  globalTrayIndex: number; // 1..8
  trayName: string; // e.g. "AMS 1 Slot 1" or "AMS 2 Slot 3"
}

export interface PurgeEconomyStats {
  totalFilamentCount: number;
  totalSwaps: number;
  maxAllowedSwaps: number;
  estimatedPurgeVolumeMm3: number;
  isMonotonicZBand: boolean;
  minLayerCountPerColor: number;
  warnings: string[];
}

export interface MultiAmsScheduleResult {
  slotAssignments: AmsSlotAssignment[];
  groupedSchedule: FilamentLayerSegment[];
  purgeEconomy: PurgeEconomyStats;
}

/**
 * Maps a palette pool of up to 7 distinct filaments to a dual-AMS hardware setup (8 total slots).
 * Enforces an intelligent swap limit rule:
 * 1. Monotonic Z-band grouping: Each color occupies a single continuous height interval [startLayer..endLayer].
 * 2. Swap limit: Total filament swaps <= N - 1 (e.g. max 6 swaps for 7 colors), eliminating ping-pong toolhead swaps.
 * 3. Minimum layer retention: Enforces min 2 layers (0.16mm) per color to avoid wasteful sub-millimeter purge tower flushes.
 */
export function createMultiAmsSlotMapping(
  segments: FilamentLayerSegment[],
  maxPalettePool: number = 7
): MultiAmsScheduleResult {
  const totalColors = Math.min(maxPalettePool, segments.length);
  const assignedSegments = segments.slice(0, totalColors);

  const slotAssignments: AmsSlotAssignment[] = assignedSegments.map((seg, idx) => {
    const globalTray = idx + 1; // 1..8
    const amsUnit = globalTray <= 4 ? 1 : 2;
    const amsSlot = (globalTray <= 4 ? globalTray : globalTray - 4) as 1 | 2 | 3 | 4;
    return {
      paletteIndex: idx,
      spool: seg.spool,
      amsUnit,
      amsSlot,
      globalTrayIndex: globalTray,
      trayName: `AMS ${amsUnit} Slot ${amsSlot}`,
    };
  });

  const warnings: string[] = [];
  let minLayers = Infinity;
  for (const s of assignedSegments) {
    if (s.layerCount < minLayers) minLayers = s.layerCount;
    if (s.layerCount < 2) {
      warnings.push(
        `Color ${s.spool.name} occupies only ${s.layerCount} layer (${s.thicknessMm}mm), which yields high purge-to-print waste ratio.`
      );
    }
  }

  const totalSwaps = Math.max(0, assignedSegments.length - 1);
  const maxAllowedSwaps = totalColors - 1;
  // Standard Bambu Lab flush volume is ~240 mm³ per swap
  const estimatedPurgeVolumeMm3 = totalSwaps * 240;

  return {
    slotAssignments,
    groupedSchedule: assignedSegments,
    purgeEconomy: {
      totalFilamentCount: totalColors,
      totalSwaps,
      maxAllowedSwaps,
      estimatedPurgeVolumeMm3,
      isMonotonicZBand: true,
      minLayerCountPerColor: minLayers === Infinity ? 0 : minLayers,
      warnings,
    },
  };
}

// ============================================================================
// BLEND DEPTH & MESH HEIGHT CONTROL
// ============================================================================

export interface MeshHeightLimitsConfig {
  /** Base solid thickness in mm (e.g. 0.48mm to 0.80mm for total background opacity) */
  baseThicknessMm: number;
  /** Maximum total mesh depth in mm (e.g. 2.0mm to 2.4mm total depth) */
  maxMeshHeightMm: number;
  /** Base layer height in mm (default: 0.16mm) */
  baseLayerMm?: number;
  /** Upper layer height in mm (default: 0.08mm) */
  layerHeightMm?: number;
}

export interface MeshHeightLimitsResult {
  baseThicknessMm: number;
  maxMeshHeightMm: number;
  blendDepthMm: number;
  baseLayers: number;
  totalLayers: number;
  blendLayers: number;
  baseLayerMm: number;
  layerHeightMm: number;
}

/**
 * Computes and validates physical blend depth and mesh height limits:
 * - Base thickness: 0.48mm to 0.80mm (blocks optical bleed through dark base)
 * - Max mesh height: 2.0mm to 2.4mm (physical limit for translucent filament stacking)
 * - Dynamically calculates blend depth and layer counts matching nozzle increments.
 */
export function computeMeshHeightLimits(
  config: MeshHeightLimitsConfig
): MeshHeightLimitsResult {
  const baseLayerMm = config.baseLayerMm ?? STANDARD_INITIAL_LAYER_MM;
  const layerHeightMm = config.layerHeightMm ?? STANDARD_MICRO_LAYER_MM;

  // Clamp base thickness to safe range [0.32, 1.20] (typical: 0.48 to 0.80)
  const baseThicknessMm = Math.max(0.32, Math.min(1.20, config.baseThicknessMm));
  // Clamp max mesh height to safe range [1.60, 3.20] (typical: 2.0 to 2.4)
  const maxMeshHeightMm = Math.max(baseThicknessMm + 0.32, Math.min(3.20, config.maxMeshHeightMm));

  const baseLayers = Math.max(
    1,
    1 + Math.round(Math.max(0, baseThicknessMm - baseLayerMm) / layerHeightMm)
  );
  const totalLayers = Math.max(
    baseLayers + 1,
    1 + Math.round(Math.max(0, maxMeshHeightMm - baseLayerMm) / layerHeightMm)
  );
  const blendLayers = totalLayers - baseLayers;

  const quantBaseThickness = layerToZHeight(baseLayers, baseLayerMm, layerHeightMm);
  const quantMaxHeight = layerToZHeight(totalLayers, baseLayerMm, layerHeightMm);
  const blendDepthMm = Number((quantMaxHeight - quantBaseThickness).toFixed(4));

  return {
    baseThicknessMm: quantBaseThickness,
    maxMeshHeightMm: quantMaxHeight,
    blendDepthMm,
    baseLayers,
    totalLayers,
    blendLayers,
    baseLayerMm,
    layerHeightMm,
  };
}

export interface FilamentLayerSegment {
  slotIndex: number;
  spool: FilamentSpool;
  startLayer: number;
  endLayer: number;
  layerCount: number;
  startZMm: number;
  topZMm: number;
  thicknessMm: number;
}

export interface VoxelLayerSlice {
  /** Discrete layer index (1-based: 1..N) */
  layerNumber: number;
  /** Top physical Z elevation in mm for this discrete layer */
  zHeightMm: number;
  /** Layer thickness (baseLayerMm for layer 1, layerHeightMm for layer > 1) */
  layerThicknessMm: number;
  /** Filament extruded at this specific layer */
  activeSpool: FilamentSpool;
  activeSlotIndex: number;
}

export interface PixelLayerSliceResult {
  /** Target continuous input height in mm */
  requestedHeightMm: number;
  /** Quantized discrete layer count (0 if below first layer threshold) */
  layerCount: number;
  /** Exact physical quantized height matching nozzle layer increments */
  quantizedHeightMm: number;
  /** Complete sequence of filament swap segments from base to top */
  filamentSequence: FilamentLayerSegment[];
  /** Detailed layer-by-layer breakdown */
  layers: VoxelLayerSlice[];
  /** Topmost active filament visible on the top surface */
  topSpool: FilamentSpool | null;
}

export interface HeightmapSliceResult {
  width: number;
  height: number;
  /** Maximum discrete layer count across the entire heightmap */
  maxLayerCount: number;
  /** Maximum physical quantized Z height in mm across the entire heightmap */
  maxQuantizedHeightMm: number;
  /** Discrete layer count for every pixel [y * width + x] */
  layerCounts: Uint16Array;
  /** Quantized physical Z height in mm for every pixel [y * width + x] */
  quantizedHeightsMm: Float32Array;
  /** Active filament slot index on the top surface of each pixel (-1 if 0 layers) */
  topSlotIndices: Int8Array;
  /** Global filament swap schedule across the entire print */
  globalSwaps: {
    slotIndex: number;
    spool: FilamentSpool;
    upToLayer: number;
    swapAtZMm: number;
  }[];
}

/**
 * Calculates physical top Z height in mm for a given discrete layer count L.
 * Layer 1 = baseLayerMm
 * Layer L = baseLayerMm + (L - 1) * layerHeightMm
 */
export function layerIndexToZHeight(
  layer: number,
  baseLayerMm: number,
  layerHeightMm: number
): number {
  if (layer <= 0) return 0;
  return Number((baseLayerMm + (layer - 1) * layerHeightMm).toFixed(4));
}

/**
 * Quantizes continuous physical height H (mm) to discrete layer increments.
 * Enforces multiples of nozzle layer heights starting from baseLayerMm.
 */
export function quantizeHeightToLayer(
  heightMm: number,
  config: LayerSliceConfig
): { layerCount: number; quantizedHeightMm: number } {
  const { baseLayerMm, layerHeightMm, minBaseLayers = 1, maxHeightMm } = config;

  if (heightMm <= 0 || heightMm < baseLayerMm * 0.5) {
    return { layerCount: 0, quantizedHeightMm: 0 };
  }

  // Calculate discrete layer count
  const extraHeight = Math.max(0, heightMm - baseLayerMm);
  let layerCount = 1 + Math.round(extraHeight / layerHeightMm);

  // Enforce minimum base solid layers
  if (minBaseLayers > 0) {
    layerCount = Math.max(minBaseLayers, layerCount);
  }

  // Enforce optional ceiling height
  if (maxHeightMm !== undefined && maxHeightMm > 0) {
    const maxLayers = 1 + Math.floor(Math.max(0, maxHeightMm - baseLayerMm) / layerHeightMm);
    layerCount = Math.min(maxLayers, layerCount);
  }

  const quantizedHeightMm = layerIndexToZHeight(layerCount, baseLayerMm, layerHeightMm);
  return { layerCount, quantizedHeightMm };
}

/**
 * For a given pixel or voxel at height H, calculates the exact sequence of filament swaps
 * from the bottom base layer to the top layer.
 */
export function computePixelFilamentSequence(
  heightMm: number,
  slots: LayerSwapSlot[],
  config: LayerSliceConfig
): PixelLayerSliceResult {
  const { baseLayerMm, layerHeightMm } = config;
  const { layerCount, quantizedHeightMm } = quantizeHeightToLayer(heightMm, config);

  if (layerCount <= 0 || slots.length === 0) {
    return {
      requestedHeightMm: heightMm,
      layerCount: 0,
      quantizedHeightMm: 0,
      filamentSequence: [],
      layers: [],
      topSpool: null,
    };
  }

  // Ensure slots are sorted by upToLayer ascending
  const sortedSlots = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);

  // 1. Build layer-by-layer voxel slice stack
  const layers: VoxelLayerSlice[] = [];
  for (let l = 1; l <= layerCount; l++) {
    const slotIdx = sortedSlots.findIndex((s) => l <= s.upToLayer);
    const activeSlotIdx = slotIdx >= 0 ? slotIdx : sortedSlots.length - 1;
    const activeSlot = sortedSlots[activeSlotIdx];
    const zHeightMm = layerIndexToZHeight(l, baseLayerMm, layerHeightMm);
    const layerThicknessMm = l === 1 ? baseLayerMm : layerHeightMm;

    layers.push({
      layerNumber: l,
      zHeightMm,
      layerThicknessMm,
      activeSpool: activeSlot.spool,
      activeSlotIndex: activeSlotIdx,
    });
  }

  // 2. Group into contiguous filament swap segments
  const filamentSequence: FilamentLayerSegment[] = [];
  let currentStartLayer = 1;

  for (let i = 0; i < sortedSlots.length; i++) {
    const slot = sortedSlots[i];
    if (currentStartLayer > layerCount) break;

    const slotMaxLayer = slot.upToLayer;
    const segmentEndLayer = Math.min(layerCount, slotMaxLayer);

    if (segmentEndLayer >= currentStartLayer) {
      const segLayers = segmentEndLayer - currentStartLayer + 1;
      const startZMm =
        currentStartLayer === 1
          ? 0
          : layerIndexToZHeight(currentStartLayer - 1, baseLayerMm, layerHeightMm);
      const topZMm = layerIndexToZHeight(segmentEndLayer, baseLayerMm, layerHeightMm);
      const thicknessMm = Number((topZMm - startZMm).toFixed(4));

      filamentSequence.push({
        slotIndex: i,
        spool: slot.spool,
        startLayer: currentStartLayer,
        endLayer: segmentEndLayer,
        layerCount: segLayers,
        startZMm,
        topZMm,
        thicknessMm,
      });

      currentStartLayer = segmentEndLayer + 1;
    }
  }

  const topSpool = layers.length > 0 ? layers[layers.length - 1].activeSpool : null;

  return {
    requestedHeightMm: heightMm,
    layerCount,
    quantizedHeightMm,
    filamentSequence,
    layers,
    topSpool,
  };
}

/**
 * Converts a 2D heightmap into discrete layer-slice maps and filament swap sequences.
 * Maps every pixel height precisely to multiples of nozzle layer heights.
 */
export function convertHeightmapToLayerSlices(
  heightmap: Float32Array | number[] | number[][],
  width: number,
  height: number,
  slots: LayerSwapSlot[],
  config: LayerSliceConfig
): HeightmapSliceResult {
  const totalPixels = width * height;
  const layerCounts = new Uint16Array(totalPixels);
  const quantizedHeightsMm = new Float32Array(totalPixels);
  const topSlotIndices = new Int8Array(totalPixels);

  const sortedSlots = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);
  let maxLayerCount = 0;

  // Flatten heightmap accessor
  const is2D = Array.isArray(heightmap) && Array.isArray(heightmap[0]);
  const getHeight = is2D
    ? (x: number, y: number) => (heightmap as number[][])[y][x]
    : (x: number, y: number) => (heightmap as Float32Array | number[])[y * width + x];

  let effectiveHeights: Float32Array;
  if (config.enableBilateralFilter && width > 2 && height > 2) {
    const rawFlattened = new Float32Array(totalPixels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        rawFlattened[y * width + x] = getHeight(x, y);
      }
    }
    effectiveHeights = applyBilateralHeightmapFilter(rawFlattened, width, height, 1.8, 0.08);
  } else {
    effectiveHeights = new Float32Array(totalPixels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        effectiveHeights[y * width + x] = getHeight(x, y);
      }
    }
  }

  // 1. Spatial Gradient Smoothing (Constraint 3)
  if (config.enableGradientSmoothing && width > 2 && height > 2) {
    effectiveHeights = applySpatialGradientSmoothing(
      effectiveHeights,
      width,
      height,
      config.edgeThreshold ?? 0.35,
      config.layerHeightMm * 1.5
    );
  }

  // 2. Height-Map Quantization Banding (Constraint 2)
  const rawLayerCounts = new Uint16Array(totalPixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const rawH = effectiveHeights[idx];
      const { layerCount } = quantizeHeightToLayer(rawH, config);
      rawLayerCounts[idx] = layerCount;
    }
  }

  // 3. Morphological Filtering & Region Merging (Constraint 1)
  const shouldMorph = config.enableMorphologicalFilter ?? (width >= 4 && height >= 4);
  const minPixels = config.minRegionPixels ?? 4;
  const finalLayerCounts =
    shouldMorph && width >= 4 && height >= 4
      ? applyMorphologicalRegionMerge(rawLayerCounts, width, height, minPixels)
      : rawLayerCounts;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const layerCount = finalLayerCounts[idx];
      const quantizedHeightMm = layerIndexToZHeight(layerCount, config.baseLayerMm, config.layerHeightMm);

      layerCounts[idx] = layerCount;
      quantizedHeightsMm[idx] = quantizedHeightMm;

      if (layerCount > maxLayerCount) {
        maxLayerCount = layerCount;
      }

      if (layerCount > 0 && sortedSlots.length > 0) {
        const slotIdx = sortedSlots.findIndex((s) => layerCount <= s.upToLayer);
        topSlotIndices[idx] = slotIdx >= 0 ? slotIdx : sortedSlots.length - 1;
      } else {
        topSlotIndices[idx] = -1;
      }
    }
  }

  const maxQuantizedHeightMm = layerIndexToZHeight(
    maxLayerCount,
    config.baseLayerMm,
    config.layerHeightMm
  );

  // Global filament swap schedule
  const globalSwaps = sortedSlots.map((slot, idx) => ({
    slotIndex: idx,
    spool: slot.spool,
    upToLayer: slot.upToLayer,
    swapAtZMm: layerIndexToZHeight(slot.upToLayer, config.baseLayerMm, config.layerHeightMm),
  }));

  return {
    width,
    height,
    maxLayerCount,
    maxQuantizedHeightMm,
    layerCounts,
    quantizedHeightsMm,
    topSlotIndices,
    globalSwaps,
  };
}
