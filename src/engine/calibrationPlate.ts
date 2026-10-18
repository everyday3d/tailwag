import { srgbToLinear } from './colorScience';
import type { CalibrationObservation } from './calibrationFit';

/**
 * Layout of the printed calibration plate. Plate coordinates are millimeters with the origin at
 * the top-left fiducial center, x right, y down. The same layout drives the geometry generator,
 * the photo sampler and the fit, so a printed plate and its photo cannot disagree.
 */
export const PLATE_STEPS_MM = [0.08, 0.16, 0.24, 0.32, 0.48, 0.64, 0.96, 1.28, 2.4];
export const PATCH_MM = 7;
export const PATCH_GAP_MM = 1.5;
export const ROW_GAP_MM = 2;
/** Backing slab thickness; opaque enough that nothing shows through. */
export const BACKING_THICKNESS_MM = 1.6;
export const PLATE_MARGIN_MM = 6;

export type BackingKind = 'white' | 'black';

export interface PlatePatch {
  /** 'bare' patches are the backing alone (the measured reference for that row). */
  kind: 'bare' | 'step';
  /** Index into the filament list; -1 for bare patches of the shared backings. */
  filament: number;
  backing: BackingKind;
  thicknessMm: number;
  /** Patch center in plate coordinates (mm). */
  x: number;
  y: number;
}

export interface PlateLayout {
  widthMm: number;
  heightMm: number;
  patches: PlatePatch[];
  /** Corner fiducial centers, TL, TR, BR, BL, in plate coordinates. */
  fiducials: Array<{ x: number; y: number }>;
}

/** Rows: for each filament, one row over white and one over black; each row starts with a bare patch. */
export function buildPlateLayout(filamentCount: number): PlateLayout {
  const cols = PLATE_STEPS_MM.length + 1;
  const pitch = PATCH_MM + PATCH_GAP_MM;
  const rowPitch = PATCH_MM + ROW_GAP_MM;
  const rows = filamentCount * 2;
  const innerW = cols * pitch - PATCH_GAP_MM;
  const innerH = rows * rowPitch - ROW_GAP_MM;
  const widthMm = innerW + 2 * PLATE_MARGIN_MM;
  const heightMm = innerH + 2 * PLATE_MARGIN_MM;
  const patches: PlatePatch[] = [];
  let row = 0;
  for (let f = 0; f < filamentCount; f++) {
    for (const backing of ['white', 'black'] as BackingKind[]) {
      const y = PLATE_MARGIN_MM + row * rowPitch + PATCH_MM / 2;
      patches.push({
        kind: 'bare',
        filament: -1,
        backing,
        thicknessMm: 0,
        x: PLATE_MARGIN_MM + PATCH_MM / 2,
        y,
      });
      PLATE_STEPS_MM.forEach((t, i) => {
        patches.push({
          kind: 'step',
          filament: f,
          backing,
          thicknessMm: t,
          x: PLATE_MARGIN_MM + (i + 1) * pitch + PATCH_MM / 2,
          y,
        });
      });
      row++;
    }
  }
  // Fiducials sit in the corner margins and are printed as the first (black-on-white) pairs.
  const fx = PLATE_MARGIN_MM / 2;
  return {
    widthMm,
    heightMm,
    patches,
    fiducials: [
      { x: fx, y: fx },
      { x: widthMm - fx, y: fx },
      { x: widthMm - fx, y: heightMm - fx },
      { x: fx, y: heightMm - fx },
    ],
  };
}

export interface PhotoPoint {
  x: number;
  y: number;
}

/** Projective map from plate millimeters to photo pixels, from the four fiducial positions. */
export function homographyFromFiducials(
  layout: PlateLayout,
  photoCorners: [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint]
): (x: number, y: number) => PhotoPoint {
  const src = layout.fiducials;
  // Solve for h (8 unknowns) with h33 = 1 by Gaussian elimination.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = photoCorners[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      for (let k = col; k < n; k++) A[r][k] -= f * A[col][k];
      b[r] -= f * b[col];
    }
  }
  const h = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return (x, y) => {
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  };
}

export interface SampledPatch {
  patch: PlatePatch;
  /** Mean linear-light color of the patch core, white-balanced. */
  linear: [number, number, number];
  /** Per-channel standard deviation inside the patch core (sRGB 0..1 units); high = glare or misalignment. */
  spread: number;
}

export interface PhotoImage {
  width: number;
  height: number;
  /** RGBA bytes */
  data: Uint8ClampedArray | Uint8Array;
}

/**
 * Samples every patch core (the inner half) and white-balances to the bare white backing.
 * `whiteReference` is that patch's true linear reflectance (default 0.85 for a white PLA).
 */
export function samplePlatePhoto(
  image: PhotoImage,
  layout: PlateLayout,
  photoCorners: [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint],
  whiteReference = 0.85
): { patches: SampledPatch[]; warnings: string[] } {
  const map = homographyFromFiducials(layout, photoCorners);
  const raw: SampledPatch[] = [];
  const core = PATCH_MM * 0.25;
  const steps = 5;
  for (const patch of layout.patches) {
    const sums = [0, 0, 0];
    const sv = [0, 0, 0];
    const sq = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const px = patch.x - core + ((i + 0.5) / steps) * core * 2;
        const py = patch.y - core + ((j + 0.5) / steps) * core * 2;
        const p = map(px, py);
        const ix = Math.round(p.x);
        const iy = Math.round(p.y);
        if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
        const o = (iy * image.width + ix) * 4;
        for (let c = 0; c < 3; c++) {
          const v = image.data[o + c] / 255;
          sums[c] += srgbToLinear(v);
          sv[c] += v;
          sq[c] += v * v;
        }
        n++;
      }
    }
    if (n === 0) {
      raw.push({ patch, linear: [0, 0, 0], spread: 1 });
      continue;
    }
    const mean = sums.map((s) => s / n) as [number, number, number];
    const spread = Math.max(...[0, 1, 2].map((c) => Math.sqrt(Math.max(0, sq[c] / n - (sv[c] / n) ** 2))));
    raw.push({ patch, linear: mean, spread });
  }

  const warnings: string[] = [];
  const whites = raw.filter((p) => p.patch.kind === 'bare' && p.patch.backing === 'white');
  const wAvg: [number, number, number] = [0, 0, 0];
  whites.forEach((w) => w.linear.forEach((v, c) => (wAvg[c] += v / whites.length)));
  const gains = wAvg.map((v) => (v > 1e-4 ? whiteReference / v : 1)) as [number, number, number];
  if (gains.some((g) => g > 2.5 || g < 0.4)) {
    warnings.push('The photo is very dark, very bright or strongly tinted. Retake in even daylight without flash.');
  }
  // Keep exposure from the white reference but only a gentle tint correction.
  const balanced = raw.map((p) => ({
    ...p,
    linear: p.linear.map((v, c) => Math.min(1, v * gains[c])) as [number, number, number],
  }));
  if (raw.some((p) => p.spread > 0.12)) {
    warnings.push('Some patches look uneven (glare or a misplaced corner). Check the four corner marks and retake.');
  }
  return { patches: balanced, warnings };
}

/** Pairs each filament's step patches with the measured bare backing of the same row. */
export function observationsForFilament(patches: SampledPatch[], filament: number): CalibrationObservation[] {
  const out: CalibrationObservation[] = [];
  for (const backing of ['white', 'black'] as BackingKind[]) {
    // Bare patch of this backing: rows alternate, so the reference is the nearest bare patch in the same row.
    for (const p of patches) {
      if (p.patch.kind !== 'step' || p.patch.filament !== filament || p.patch.backing !== backing) continue;
      const bare = patches.find(
        (q) => q.patch.kind === 'bare' && q.patch.backing === backing && Math.abs(q.patch.y - p.patch.y) < 0.01
      );
      if (!bare) continue;
      out.push({ thicknessMm: p.patch.thicknessMm, backing: bare.linear, measured: p.linear });
    }
  }
  return out;
}
