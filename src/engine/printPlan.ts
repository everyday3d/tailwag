import type { HeightmapGrid } from './cadMeshBuilder';
import { LayerSwapSlot, RGB, buildLayerColorLUT } from './opticalTdEngine';

/**
 * PrintPlan: the single source of truth for what will be printed.
 *
 * Every consumer (3D viewport, STL, 3MF, swap guides, metadata) reads the same plan, so the
 * preview cannot drift from the exported files. The plan answers three questions exactly:
 *   1. Which layer does each pixel column reach when sliced?        -> `layerGrid`
 *   2. Which filament prints which layers, at which Z?              -> `bands`
 *   3. What color does the model predict for each layer?            -> `layerRgb`
 * and carries a stable `hash` of all of it for later verification.
 */

/** Z values are snapped to this many decimals so every export agrees bit-for-bit. */
export const Z_DECIMALS = 4;

export const snapZ = (z: number): number => Number(z.toFixed(Z_DECIMALS));

/** Top surface Z (mm) of 1-based layer L. Layer 1 is the initial layer. 0 for L <= 0. */
export function layerTopZ(layer: number, baseLayerMm: number, layerHeightMm: number): number {
  if (layer <= 0) return 0;
  return snapZ(baseLayerMm + (layer - 1) * layerHeightMm);
}

/**
 * Number of layers a slicer prints for a column whose top surface is at `topZ`.
 *
 * Slicers (Bambu Studio, OrcaSlicer, PrusaSlicer) slice each layer at its mid-plane: a layer is
 * printed only when the surface is above that mid-plane. Layer 1 spans [0, base], layer k >= 2
 * spans [base + (k-2)h, base + (k-1)h]. Returns 0 for empty or masked columns (topZ <= 0).
 */
export function printedLayerForZ(topZ: number, baseLayerMm: number, layerHeightMm: number): number {
  if (!(topZ > baseLayerMm * 0.5 + 1e-9)) return 0;
  const x = (topZ - baseLayerMm) / layerHeightMm + 1.5;
  const k = Math.ceil(x - 1e-6) - 1;
  return Math.max(1, k);
}

export interface PrintPlanBand {
  /** 1-based position in print order; also the AMS extruder number in the 3MF */
  slotIndex: number;
  extruder: number;
  spoolId: string;
  spoolName: string;
  brand: string;
  hex: string;
  td: number;
  startLayer: number;
  endLayer: number;
  /** 0 when the band is empty (two swap points on the same layer) */
  layerCount: number;
  /** Z of the bottom of the band (top of the previous band's last layer; 0 for the first) */
  floorZMm: number;
  /** Z of the top of the band's last layer */
  ceilZMm: number;
  /** Top Z of the band's first layer (kept for the playbook/guide formats) */
  startZMm: number;
  /** Same as ceilZMm */
  endZMm: number;
}

export interface PrintPlan {
  cols: number;
  rows: number;
  baseLayerMm: number;
  layerHeightMm: number;
  totalLayers: number;
  /** Highest printed layer over all columns (can exceed totalLayers for frames and numerals) */
  maxPrintedLayer: number;
  /** Printed layer count per grid cell (0 = no material) */
  layerGrid: Uint16Array;
  bands: PrintPlanBand[];
  /** Predicted top-surface color for layers 1..totalLayers (index = layer - 1) */
  layerRgb: RGB[];
  /** Stable hash of parameters, bands and layer grid */
  hash: string;
}

/**
 * Orders swap slots and turns them into contiguous layer bands with exact Z ranges.
 * The last slot always extends to `totalLayers`.
 */
export function computeBands(
  slots: LayerSwapSlot[],
  baseLayerMm: number,
  layerHeightMm: number,
  totalLayers: number
): PrintPlanBand[] {
  const sorted = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);
  const bands: PrintPlanBand[] = [];
  let currentStart = 1;
  sorted.forEach((slot, idx) => {
    const startLayer = currentStart;
    const endLayer = idx === sorted.length - 1 ? totalLayers : slot.upToLayer;
    bands.push({
      slotIndex: idx + 1,
      extruder: idx + 1,
      spoolId: slot.spool.id,
      spoolName: slot.spool.name,
      brand: slot.spool.brand,
      hex: slot.spool.hex,
      td: slot.spool.td,
      startLayer,
      endLayer,
      layerCount: Math.max(0, endLayer - startLayer + 1),
      floorZMm: layerTopZ(startLayer - 1, baseLayerMm, layerHeightMm),
      ceilZMm: layerTopZ(endLayer, baseLayerMm, layerHeightMm),
      startZMm: layerTopZ(startLayer, baseLayerMm, layerHeightMm),
      endZMm: layerTopZ(endLayer, baseLayerMm, layerHeightMm),
    });
    currentStart = endLayer + 1;
  });
  return bands;
}

/** Two independent FNV-1a 32-bit passes, concatenated: 64 bits is plenty for change detection. */
function hash64(parts: Array<string | Uint16Array>): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  const mix = (byte: number) => {
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ byte, 0x85ebca6b) >>> 0;
  };
  for (const p of parts) {
    if (typeof p === 'string') {
      for (let i = 0; i < p.length; i++) {
        const c = p.charCodeAt(i);
        mix(c & 0xff);
        mix(c >> 8);
      }
    } else {
      for (let i = 0; i < p.length; i++) {
        mix(p[i] & 0xff);
        mix(p[i] >> 8);
      }
    }
    mix(0xff); // part separator
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function buildPrintPlan(params: {
  grid: HeightmapGrid;
  slots: LayerSwapSlot[];
  baseLayerMm: number;
  layerHeightMm: number;
  totalLayers: number;
}): PrintPlan {
  const { grid, slots, baseLayerMm, layerHeightMm, totalLayers } = params;
  const n = grid.cols * grid.rows;
  const layerGrid = new Uint16Array(n);
  let maxPrintedLayer = 0;
  for (let i = 0; i < n; i++) {
    const L = printedLayerForZ(grid.topZ[i], baseLayerMm, layerHeightMm);
    layerGrid[i] = L;
    if (L > maxPrintedLayer) maxPrintedLayer = L;
  }

  const bands = computeBands(slots, baseLayerMm, layerHeightMm, totalLayers);
  const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
  const layerRgb = lut.map((e) => ({ ...e.rgb }));

  const hash = hash64([
    `v1|${grid.cols}x${grid.rows}|${baseLayerMm}|${layerHeightMm}|${totalLayers}`,
    bands
      .map((b) => `${b.extruder}:${b.spoolId}:${b.hex}:${b.td}:${b.startLayer}-${b.endLayer}`)
      .join(';'),
    layerGrid,
  ]);

  return {
    cols: grid.cols,
    rows: grid.rows,
    baseLayerMm,
    layerHeightMm,
    totalLayers,
    maxPrintedLayer,
    layerGrid,
    bands,
    layerRgb,
    hash,
  };
}

/** Predicted color for a printed layer; layers above the stack (frames) use the top color. */
export function planLayerRgb(plan: PrintPlan, layer: number): RGB {
  const arr = plan.layerRgb;
  if (arr.length === 0) return { r: 0, g: 0, b: 0 };
  const i = Math.max(1, Math.min(arr.length, layer)) - 1;
  return arr[i];
}

/** The band (filament) that prints `layer`. Layers above the stack belong to the last band. */
export function planBandForLayer(plan: PrintPlan, layer: number): PrintPlanBand | undefined {
  if (plan.bands.length === 0) return undefined;
  return plan.bands.find((b) => layer >= b.startLayer && layer <= b.endLayer) ?? plan.bands[plan.bands.length - 1];
}

/** Compact, human-checkable form of the hash for UI and filenames. */
export const shortPlanHash = (plan: PrintPlan): string => plan.hash.slice(0, 8).toUpperCase();

/** JSON written into exports so a file can be tied back to the plan that produced it. */
export function serializePlanSummary(plan: PrintPlan, projectName: string): string {
  return JSON.stringify(
    {
      schema: 'tailwag-print-plan-v1',
      project: projectName,
      hash: plan.hash,
      grid: { cols: plan.cols, rows: plan.rows },
      baseLayerMm: plan.baseLayerMm,
      layerHeightMm: plan.layerHeightMm,
      totalLayers: plan.totalLayers,
      maxPrintedLayer: plan.maxPrintedLayer,
      bands: plan.bands,
    },
    null,
    2
  );
}
