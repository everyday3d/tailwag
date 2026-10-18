import type { LayerSwapSlot } from './opticalTdEngine';
import { PrintPlan, layerTopZ, planBandForLayer, shortPlanHash } from './printPlan';

/**
 * Structured print metadata generated from the PrintPlan, so every number matches the preview
 * and the exported geometry.
 */
export interface PrintMetadata {
  schema: 'tailwag-print-metadata-v1';
  project: string;
  printPlanId: string;
  printPlanHash: string;
  /** Total height of the tallest column, snapped to the layer grid */
  recommendedTotalPrintHeightMm: number;
  baseLayerThicknessMm: number;
  layerHeightMm: number;
  totalLayers: number;
  /** Highest printed layer; exceeds totalLayers when a frame or numerals stand above the relief */
  maxPrintedLayer: number;
  /** Z heights (top of the last layer of the previous filament) where the filament changes */
  filamentChangeStopHeightsMm: number[];
  /** First layer printed with the new filament, per change */
  filamentChangeStartLayers: number[];
  filamentSequence: Array<{
    order: number;
    extruder: number;
    brand: string;
    name: string;
    hex: string;
    tdMm: number;
    tdSource: string;
    startLayer: number;
    endLayer: number;
    layerCount: number;
    startZMm: number;
    endZMm: number;
    /** Share of printed columns whose top surface ends inside this filament's band */
    columnShare: number;
  }>;
  swapCount: number;
}

export function buildPrintMetadata(
  plan: PrintPlan,
  slots: LayerSwapSlot[],
  projectName: string
): PrintMetadata {
  const sorted = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);

  // How many printed columns end in each band
  const counts = new Array(plan.bands.length).fill(0) as number[];
  let printed = 0;
  for (let i = 0; i < plan.layerGrid.length; i++) {
    const L = plan.layerGrid[i];
    if (L <= 0) continue;
    printed++;
    const band = planBandForLayer(plan, L);
    if (band) counts[band.slotIndex - 1]++;
  }

  // Empty bands (two swap points on one layer) print nothing, so they cause no filament change.
  const nonEmpty = plan.bands.filter((b) => b.layerCount > 0);
  const changeBands = nonEmpty.slice(1);

  return {
    schema: 'tailwag-print-metadata-v1',
    project: projectName,
    printPlanId: shortPlanHash(plan),
    printPlanHash: plan.hash,
    recommendedTotalPrintHeightMm: layerTopZ(plan.maxPrintedLayer, plan.baseLayerMm, plan.layerHeightMm),
    baseLayerThicknessMm: plan.baseLayerMm,
    layerHeightMm: plan.layerHeightMm,
    totalLayers: plan.totalLayers,
    maxPrintedLayer: plan.maxPrintedLayer,
    filamentChangeStopHeightsMm: changeBands.map((b) => b.floorZMm),
    filamentChangeStartLayers: changeBands.map((b) => b.startLayer),
    filamentSequence: plan.bands.map((b, i) => ({
      order: b.slotIndex,
      extruder: b.extruder,
      brand: b.brand,
      name: b.spoolName,
      hex: b.hex,
      tdMm: b.td,
      tdSource: sorted[i]?.spool.tdSource ?? 'catalog',
      startLayer: b.startLayer,
      endLayer: b.endLayer,
      layerCount: b.layerCount,
      startZMm: b.startZMm,
      endZMm: b.endZMm,
      columnShare: printed > 0 ? Number((counts[i] / printed).toFixed(4)) : 0,
    })),
    swapCount: changeBands.length,
  };
}

export function serializePrintMetadata(meta: PrintMetadata): string {
  return JSON.stringify(meta, null, 2);
}
