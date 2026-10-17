import { FilamentSpool } from '../data/filamentCatalog';
import { LayerSwapSlot } from './opticalTdEngine';

export interface LayerSliceConfig {
  /** Initial layer height printed directly on the build plate (e.g. 0.16mm or 0.20mm) */
  baseLayerMm: number;
  /** Subsequent layer height for all upper layers (e.g. 0.08mm, 0.12mm, or 0.16mm) */
  layerHeightMm: number;
  /** Minimum number of solid foundation base layers (default: 1) */
  minBaseLayers?: number;
  /** Maximum allowable print height in mm (optional ceiling) */
  maxHeightMm?: number;
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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const rawH = getHeight(x, y);

      const { layerCount, quantizedHeightMm } = quantizeHeightToLayer(rawH, config);
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
