import type { LayerSwapSlot } from './opticalTdEngine';
import { rgbToLab, deltaE2000 } from './colorScience';
import { PrintPlan, planLayerRgb } from './printPlan';
import { buildTargetBuckets, lutToLab, matchCostTable, sampleGridColors } from './colorMatch';
import { encodePng } from '../utils/pngEncode';
import { type Mask, focusGridCells, maskHasFocus } from './photoEdit';

/**
 * Fidelity report: how close the predicted print is to the photo, in standard ΔE00, per column,
 * and why. Everything is derived from the same PrintPlan the exports use.
 *
 * "Predicted" means predicted by the optical model with estimated or calibrated filament
 * parameters (see tdSource); it is a prediction, not a measurement of a printed object.
 */

export interface FidelityReport {
  printedColumns: number;
  meanDeltaE00: number;
  medianDeltaE00: number;
  p95DeltaE00: number;
  maxDeltaE00: number;
  /** Share of printed columns by predicted difference */
  share: { imperceptible: number; close: number; noticeable: number; clear: number };
  /** Share of columns whose best possible color in this stack is still far from the photo */
  gamutLimitedShare: number;
  /** Mean ΔE lost to placing columns at a layer other than their best match (smoothness etc.) */
  placementLoss: number;
  swapCount: number;
  /** Filaments whose TD is still an estimate or unrecorded */
  estimatedTdCount: number;
  filamentCount: number;
  warnings: string[];
  /** ΔE00 per grid cell, -1 where nothing prints */
  cellDeltaE: Float32Array;
  cols: number;
  rows: number;
  /** The same figures for the focus area only, when one is painted (#46) */
  focus?: { printedColumns: number; meanDeltaE00: number; p95DeltaE00: number; imperceptibleShare: number };
}

/** ΔE00 bands used for the shares: ≤2 imperceptible, ≤5 close, ≤10 noticeable, >10 clearly different */
export const FIDELITY_BANDS = { imperceptible: 2, close: 5, noticeable: 10 } as const;

const percentile = (sorted: Float32Array, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

export function buildFidelityReport(params: {
  plan: PrintPlan;
  image: { width: number; height: number; data: ArrayLike<number> };
  slots: LayerSwapSlot[];
  /** Focus region lined up with the image; adds a separate score for it. */
  focus?: Mask | null;
}): FidelityReport {
  const { plan, image, slots } = params;
  const n = plan.cols * plan.rows;
  const mask = new Uint8Array(n);
  let minPrinted = Infinity;
  for (let i = 0; i < n; i++) {
    if (plan.layerGrid[i] > 0) {
      mask[i] = 1;
      if (plan.layerGrid[i] < minPrinted) minPrinted = plan.layerGrid[i];
    }
  }
  const cellDeltaE = new Float32Array(n).fill(-1);
  const warnings: string[] = [];
  const sortedSlots = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);

  const estimatedTdCount = sortedSlots.filter((s) => (s.spool.tdSource ?? 'catalog') !== 'measured' && s.spool.tdSource !== 'user').length;
  const nonEmptyBands = plan.bands.filter((b) => b.layerCount > 0);
  const swapCount = Math.max(0, nonEmptyBands.length - 1);

  if (!Number.isFinite(minPrinted)) {
    return {
      printedColumns: 0,
      meanDeltaE00: 0,
      medianDeltaE00: 0,
      p95DeltaE00: 0,
      maxDeltaE00: 0,
      share: { imperceptible: 0, close: 0, noticeable: 0, clear: 0 },
      gamutLimitedShare: 0,
      placementLoss: 0,
      swapCount,
      estimatedTdCount,
      filamentCount: sortedSlots.length,
      warnings: ['Nothing prints: the model has no material.'],
      cellDeltaE,
      cols: plan.cols,
      rows: plan.rows,
    };
  }

  const rgb = sampleGridColors(image, plan.cols, plan.rows);
  const buckets = buildTargetBuckets(rgb, n, { mask });
  const lutLab = lutToLab(plan.layerRgb);
  const from = Math.max(1, Math.min(plan.totalLayers, minPrinted));
  const costs = matchCostTable(buckets, lutLab, from, plan.totalLayers, 'ciede2000');
  const nl = plan.totalLayers - from + 1;
  const bestPerBucket = new Float32Array(buckets.labs.length).fill(Infinity);
  for (let b = 0; b < buckets.labs.length; b++) {
    for (let l = 0; l < nl; l++) if (costs[b * nl + l] < bestPerBucket[b]) bestPerBucket[b] = costs[b * nl + l];
  }

  const values: number[] = [];
  let gamutLimited = 0;
  let placementLoss = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    // Columns above the stack (frames, numerals) use the top filament color
    const layer = Math.max(from, Math.min(plan.totalLayers, plan.layerGrid[i]));
    const b = buckets.pixelBucket[i];
    // Exact per-column difference (bucket costs are representative; use the column's own color)
    const target = rgbToLab({ r: rgb[i * 3], g: rgb[i * 3 + 1], b: rgb[i * 3 + 2] });
    const pred = rgbToLab(planLayerRgb(plan, layer));
    const d = deltaE2000(target, pred);
    cellDeltaE[i] = d;
    values.push(d);
    if (bestPerBucket[b] > 8) gamutLimited++;
    placementLoss += Math.max(0, d - bestPerBucket[b]);
  }

  const sorted = Float32Array.from(values).sort();
  const total = sorted.length;
  let sum = 0;
  let imp = 0;
  let close = 0;
  let noticeable = 0;
  for (const v of values) {
    sum += v;
    if (v <= FIDELITY_BANDS.imperceptible) imp++;
    else if (v <= FIDELITY_BANDS.close) close++;
    else if (v <= FIDELITY_BANDS.noticeable) noticeable++;
  }
  const clear = total - imp - close - noticeable;

  const mean = sum / total;
  const gamutShare = gamutLimited / total;

  if (estimatedTdCount > 0) {
    warnings.push(
      `${estimatedTdCount} of ${sortedSlots.length} filaments use an estimated TD, so predicted colors are approximate until the filament is measured or calibrated.`
    );
  }
  const first = sortedSlots[0];
  if (first) {
    const thickness = plan.baseLayerMm + (Math.min(plan.bands[0]?.endLayer ?? 1, from) - 1) * plan.layerHeightMm;
    const seeThrough = Math.pow(10, -thickness / Math.max(0.05, first.spool.td));
    if (seeThrough > 0.35) {
      warnings.push(
        `The base filament ${first.spool.name} is translucent at the base thickness, so the print will show whatever it is mounted on.`
      );
    }
  }
  if (gamutShare > 0.25) {
    warnings.push(
      `${Math.round(gamutShare * 100)}% of the photo is outside what this palette can reach (best possible ΔE00 above 8). Adding a filament in the missing hue range would help most.`
    );
  }
  if (swapCount > 6) {
    warnings.push(`${swapCount} filament changes: each one needs a pause or a purge, which costs time and filament.`);
  }

  let focus: FidelityReport['focus'];
  if (maskHasFocus(params.focus)) {
    const inFocus = focusGridCells(params.focus!, plan.cols, plan.rows);
    const fv: number[] = [];
    for (let i = 0; i < n; i++) if (inFocus[i] && cellDeltaE[i] >= 0) fv.push(cellDeltaE[i]);
    if (fv.length > 0) {
      const fs = Float32Array.from(fv).sort();
      focus = {
        printedColumns: fv.length,
        meanDeltaE00: fv.reduce((a, b) => a + b, 0) / fv.length,
        p95DeltaE00: percentile(fs, 0.95),
        imperceptibleShare: fv.filter((v) => v <= FIDELITY_BANDS.imperceptible).length / fv.length,
      };
    }
  }

  return {
    focus,
    printedColumns: total,
    meanDeltaE00: mean,
    medianDeltaE00: percentile(sorted, 0.5),
    p95DeltaE00: percentile(sorted, 0.95),
    maxDeltaE00: sorted[total - 1],
    share: { imperceptible: imp / total, close: close / total, noticeable: noticeable / total, clear: clear / total },
    gamutLimitedShare: gamutShare,
    placementLoss: placementLoss / total,
    swapCount,
    estimatedTdCount,
    filamentCount: sortedSlots.length,
    warnings,
    cellDeltaE,
    cols: plan.cols,
    rows: plan.rows,
  };
}

/** Maps ΔE00 to a green (accurate) to red (clearly different) color. */
export function heatColor(d: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [38, 170, 90]],
    [3, [140, 200, 60]],
    [6, [240, 200, 50]],
    [10, [240, 130, 40]],
    [16, [210, 40, 50]],
  ];
  if (d <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (d <= stops[i][0]) {
      const [d0, c0] = stops[i - 1];
      const [d1, c1] = stops[i];
      const t = (d - d0) / (d1 - d0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

/** PNG heat map of the per-column ΔE00 (transparent where nothing prints). */
export function renderFidelityHeatmapPng(report: FidelityReport, maxPx = 360): Uint8Array {
  const scale = Math.max(1, Math.floor(maxPx / Math.max(report.cols, report.rows)));
  const w = report.cols * scale;
  const h = report.rows * scale;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < report.rows; r++) {
    for (let c = 0; c < report.cols; c++) {
      const d = report.cellDeltaE[r * report.cols + c];
      const [cr, cg, cb] = d < 0 ? [18, 23, 34] : heatColor(d);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = ((r * scale + dy) * w + c * scale + dx) * 4;
          px[o] = cr;
          px[o + 1] = cg;
          px[o + 2] = cb;
          px[o + 3] = 255;
        }
      }
    }
  }
  return encodePng(px, w, h);
}

/** Compact, serializable form for the metadata JSON. */
export function summarizeFidelity(report: FidelityReport) {
  return {
    meanDeltaE00: Number(report.meanDeltaE00.toFixed(2)),
    medianDeltaE00: Number(report.medianDeltaE00.toFixed(2)),
    p95DeltaE00: Number(report.p95DeltaE00.toFixed(2)),
    maxDeltaE00: Number(report.maxDeltaE00.toFixed(2)),
    share: {
      imperceptible: Number(report.share.imperceptible.toFixed(4)),
      close: Number(report.share.close.toFixed(4)),
      noticeable: Number(report.share.noticeable.toFixed(4)),
      clear: Number(report.share.clear.toFixed(4)),
    },
    gamutLimitedShare: Number(report.gamutLimitedShare.toFixed(4)),
    placementLoss: Number(report.placementLoss.toFixed(3)),
    estimatedTdCount: report.estimatedTdCount,
    filamentCount: report.filamentCount,
    ...(report.focus
      ? {
          focus: {
            meanDeltaE00: Number(report.focus.meanDeltaE00.toFixed(2)),
            p95DeltaE00: Number(report.focus.p95DeltaE00.toFixed(2)),
            imperceptibleShare: Number(report.focus.imperceptibleShare.toFixed(4)),
          },
        }
      : {}),
    swapCount: report.swapCount,
    bands: '<=2 imperceptible, <=5 close, <=10 noticeable, >10 clearly different (CIEDE2000)',
    warnings: report.warnings,
    note: 'Predicted by the optical model from estimated or calibrated filament parameters; not a measurement of a printed object.',
  };
}
