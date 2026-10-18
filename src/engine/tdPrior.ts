import { hexToRgb01, rgbToLab } from './opticalTdEngine';

/**
 * Where a spool's Transmittance Distance (TD) value came from.
 * Resolution order, strongest first: measured > user > catalog > estimate.
 */
export type TdSource = 'measured' | 'user' | 'catalog' | 'estimate';

export const TD_SOURCE_RANK: Record<TdSource, number> = {
  measured: 4,
  user: 3,
  catalog: 2,
  estimate: 1,
};

export const TD_SOURCE_LABEL: Record<TdSource, string> = {
  measured: 'Measured',
  user: 'User-entered',
  catalog: 'Catalog',
  estimate: 'Estimate',
};

export const TD_MIN_MM = 0.3;
export const TD_MAX_MM = 8.0;

/** Relative hue multiplier on the chromatic TD term (dyes in warm hues stay translucent longer). */
function hueFactor(hueDeg: number): number {
  // Smooth piecewise-linear table over the hue circle (CIELAB hue angle, degrees).
  const table: Array<[number, number]> = [
    [0, 0.85], // red / pink
    [60, 1.0], // orange
    [95, 1.1], // yellow
    [140, 0.8], // green
    [200, 0.8], // cyan
    [265, 0.55], // blue
    [310, 0.6], // purple
    [360, 0.85],
  ];
  const h = ((hueDeg % 360) + 360) % 360;
  for (let i = 1; i < table.length; i++) {
    const [h1, f1] = table[i];
    const [h0, f0] = table[i - 1];
    if (h <= h1) {
      const t = (h - h0) / Math.max(1e-6, h1 - h0);
      return f0 + (f1 - f0) * t;
    }
  }
  return table[table.length - 1][1];
}

/**
 * Hue/lightness prior for TD (mm), used only when a spool has no measured, user or catalog TD.
 *
 * Fitted by eye and checked against the verified catalog (see tests): dark pigments absorb
 * quickly (low TD), light neutrals are the most opaque-looking but scatter well (TD up to ~6),
 * and saturated dyes in warm hues stay translucent longest.
 */
export function estimateTdFromLab(lab: { L: number; a: number; b: number }): number {
  const L = Math.max(0, Math.min(100, lab.L));
  const chroma = Math.hypot(lab.a, lab.b);
  let hueDeg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (hueDeg < 0) hueDeg += 360;

  const lightnessTerm = 0.4 + 5.0 * Math.pow(L / 100, 1.6);
  const chromaTerm = chroma < 6 ? 0 : 0.045 * chroma * hueFactor(hueDeg);
  const td = lightnessTerm + chromaTerm;
  return Math.round(Math.max(TD_MIN_MM, Math.min(TD_MAX_MM, td)) * 10) / 10;
}

export function estimateTdFromHex(hex: string): number {
  return estimateTdFromLab(rgbToLab(hexToRgb01(hex)));
}

/**
 * Sanity check for a user-entered TD against the prior. Returns a warning string when the value
 * is far outside what is typical for that color, otherwise null.
 */
export function checkTdAgainstPrior(hex: string, td: number): string | null {
  if (!Number.isFinite(td) || td <= 0) return 'TD must be a positive number of millimeters.';
  if (td < TD_MIN_MM || td > 30) return `TD ${td} mm is outside the plausible range (${TD_MIN_MM}–30 mm).`;
  const prior = estimateTdFromHex(hex);
  const ratio = td / prior;
  if (ratio > 2.5 || ratio < 0.4) {
    return `TD ${td} mm is far from the typical ~${prior} mm for this color. Double-check the value.`;
  }
  return null;
}

/** True when a new TD source may overwrite the existing one. */
export function canOverrideTdSource(existing: TdSource | undefined, incoming: TdSource): boolean {
  if (!existing) return true;
  return TD_SOURCE_RANK[incoming] >= TD_SOURCE_RANK[existing];
}
