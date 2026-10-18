import type { PrintPlan } from './printPlan';

/** Nozzle and line width the lateral-resolution check assumes (0.4 mm nozzle, 0.42 mm lines). */
export const NOZZLE_LINE_WIDTH_MM = 0.42;
/** Typical purge per filament change (mm^3). Bambu Studio's default flush matrix is about 280. */
export const DEFAULT_FLUSH_MM3 = 280;
/** PLA density (g/cm^3) used for the waste weight estimate. */
const DENSITY_G_CM3 = 1.24;

export interface PrintCostReport {
  /** Filament changes after the first color (empty bands are skipped). */
  swapCount: number;
  /** Estimated purged plastic across all changes, in grams. */
  wasteGrams: number;
  /** Grid sample pitch in mm (distance between neighboring height samples). */
  pitchMm: number;
  warnings: string[];
}

export interface PrintCostInput {
  plan: PrintPlan;
  widthMm: number;
  /** Material label per band spool (e.g. 'PLA', 'PETG'). Unknown entries are ignored. */
  materials?: Array<string | undefined>;
  flushMm3?: number;
}

/**
 * Pre-print notes the verifier cannot catch: sample pitch versus the printable line width,
 * filament change count and purge waste, and mixed materials in one print.
 */
export function analyzePrintCost(input: PrintCostInput): PrintCostReport {
  const { plan, widthMm } = input;
  const warnings: string[] = [];
  const bands = plan.bands.filter((b) => b.layerCount > 0);
  const swapCount = Math.max(0, bands.length - 1);
  const flush = input.flushMm3 ?? DEFAULT_FLUSH_MM3;
  const wasteGrams = (swapCount * flush * DENSITY_G_CM3) / 1000;

  const pitchMm = plan.cols > 1 ? widthMm / (plan.cols - 1) : widthMm;
  if (pitchMm < NOZZLE_LINE_WIDTH_MM * 0.95) {
    warnings.push(
      `Height samples are ${pitchMm.toFixed(2)} mm apart, finer than the ${NOZZLE_LINE_WIDTH_MM} mm line the printer lays down. Detail below that width will not print; a coarser grid prints the same result faster.`
    );
  }

  const mats = new Set((input.materials ?? []).filter((m): m is string => !!m).map((m) => m.toUpperCase()));
  if (mats.size > 1) {
    warnings.push(
      `This recipe mixes materials (${[...mats].join(', ')}). They need different temperatures and may not bond; use one material per print.`
    );
  }
  if (swapCount > 0 && wasteGrams > 15) {
    warnings.push(`About ${wasteGrams.toFixed(0)} g of filament will be purged across ${swapCount} changes.`);
  }
  return { swapCount, wasteGrams, pitchMm, warnings };
}
