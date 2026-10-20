/**
 * Crop, rotate and focus region for the photo (#46).
 *
 * Coordinates:
 * - source space: the original photo, as loaded (kept up to ORIGINAL_MAX_SIDE).
 * - edit space: the photo after the 90° turns, then straightened by a small angle about its
 *   centre, on a canvas of the same size. The crop rectangle is normalized (0..1) in this space.
 * - output: the cropped picture the solver and heightmap use (up to OUTPUT_MAX_SIDE).
 *
 * The focus mask is stored in source space, so changing the crop or rotation never moves
 * what was painted. Everything here is pure so it can be tested without a browser.
 */

export interface ImageLike {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface Mask {
  width: number;
  height: number;
  /** 0 = normal, 255 = focus */
  data: Uint8Array;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoEdit {
  /** Clockwise quarter turns */
  rotate: 0 | 90 | 180 | 270;
  /** Small straightening angle in degrees, clockwise positive */
  straighten: number;
  crop: CropRect;
}

export const ORIGINAL_MAX_SIDE = 1600;
export const OUTPUT_MAX_SIDE = 420;
export const MASK_MAX_SIDE = 256;
export const STRAIGHTEN_LIMIT_DEG = 15;
/**
 * Focus strength: the share of the solver's attention the focus area gets, whatever its size.
 * A fixed per-cell weight would make a large area dominate and a tiny one barely count.
 */
export type FocusStrength = 'gentle' | 'balanced' | 'strong';
export const FOCUS_SHARE: Record<FocusStrength, number> = { gentle: 0.35, balanced: 0.5, strong: 0.75 };

export const DEFAULT_EDIT: PhotoEdit = { rotate: 0, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };

export const isDefaultEdit = (e: PhotoEdit): boolean =>
  e.rotate === 0 && e.straighten === 0 && e.crop.x === 0 && e.crop.y === 0 && e.crop.w === 1 && e.crop.h === 1;

/** Size of edit space for a source of w × h. */
export function editSpaceSize(w: number, h: number, rotate: PhotoEdit['rotate']): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * Largest centred rectangle (as a fraction of edit space, same aspect) that holds only real
 * photo after straightening, so no empty corners can be cropped in.
 */
export function validCropScale(width: number, height: number, straightenDeg: number): number {
  const t = (Math.abs(straightenDeg) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.min(1, width / (width * c + height * s), height / (width * s + height * c));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps a crop inside the valid area and at least 5% of each side. */
export function clampCrop(crop: CropRect, scale: number): CropRect {
  const lo = (1 - scale) / 2;
  const hi = (1 + scale) / 2;
  const minSide = 0.05;
  const w = clamp(crop.w, minSide, hi - lo);
  const h = clamp(crop.h, minSide, hi - lo);
  return { x: clamp(crop.x, lo, hi - w), y: clamp(crop.y, lo, hi - h), w, h };
}

/** Maps a point in edit space (pixels) back to source space (pixels). */
export function editToSource(ex: number, ey: number, srcW: number, srcH: number, edit: PhotoEdit): [number, number] {
  const { width: W, height: H } = editSpaceSize(srcW, srcH, edit.rotate);
  // Undo straightening: rotate by -angle about the centre
  const t = (-edit.straighten * Math.PI) / 180;
  const dx = ex - W / 2;
  const dy = ey - H / 2;
  const rx = W / 2 + dx * Math.cos(t) - dy * Math.sin(t);
  const ry = H / 2 + dx * Math.sin(t) + dy * Math.cos(t);
  // Undo the quarter turns
  switch (edit.rotate) {
    case 90:
      return [ry, srcH - rx];
    case 180:
      return [srcW - rx, srcH - ry];
    case 270:
      return [srcW - ry, rx];
    default:
      return [rx, ry];
  }
}

/** Crop size in source pixels (the photo's real resolution inside the crop). */
export function cropPixelSize(srcW: number, srcH: number, edit: PhotoEdit): { width: number; height: number } {
  const { width: W, height: H } = editSpaceSize(srcW, srcH, edit.rotate);
  return { width: Math.max(1, edit.crop.w * W), height: Math.max(1, edit.crop.h * H) };
}

/** Output picture size for an edit, keeping the crop's aspect ratio. */
export function outputSize(srcW: number, srcH: number, edit: PhotoEdit, maxSide = OUTPUT_MAX_SIDE): { width: number; height: number } {
  const c = cropPixelSize(srcW, srcH, edit);
  const scale = Math.min(1, maxSide / Math.max(c.width, c.height));
  return { width: Math.max(16, Math.round(c.width * scale)), height: Math.max(16, Math.round(c.height * scale)) };
}

/** Calls fn(outIndex, sourceX, sourceY) for every output pixel centre. */
function forEachOutputPixel(
  srcW: number,
  srcH: number,
  edit: PhotoEdit,
  outW: number,
  outH: number,
  fn: (i: number, sx: number, sy: number) => void
) {
  const { width: W, height: H } = editSpaceSize(srcW, srcH, edit.rotate);
  const x0 = edit.crop.x * W;
  const y0 = edit.crop.y * H;
  const sxStep = (edit.crop.w * W) / outW;
  const syStep = (edit.crop.h * H) / outH;
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const [sx, sy] = editToSource(x0 + (ox + 0.5) * sxStep, y0 + (oy + 0.5) * syStep, srcW, srcH, edit);
      fn(oy * outW + ox, sx, sy);
    }
  }
}

/** Crops, rotates and straightens the photo with bilinear sampling. */
export function applyPhotoEdit(
  src: ImageLike,
  edit: PhotoEdit,
  maxSide = OUTPUT_MAX_SIDE
): { width: number; height: number; data: Uint8ClampedArray } {
  const { width: outW, height: outH } = outputSize(src.width, src.height, edit, maxSide);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sw = src.width;
  const sh = src.height;
  const d = src.data;
  forEachOutputPixel(sw, sh, edit, outW, outH, (i, sx, sy) => {
    const fx = clamp(sx - 0.5, 0, sw - 1);
    const fy = clamp(sy - 0.5, 0, sh - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(sw - 1, x0 + 1);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ax = fx - x0;
    const ay = fy - y0;
    const p00 = (y0 * sw + x0) * 4;
    const p10 = (y0 * sw + x1) * 4;
    const p01 = (y1 * sw + x0) * 4;
    const p11 = (y1 * sw + x1) * 4;
    for (let k = 0; k < 4; k++) {
      const top = d[p00 + k] * (1 - ax) + d[p10 + k] * ax;
      const bot = d[p01 + k] * (1 - ax) + d[p11 + k] * ax;
      out[i * 4 + k] = top * (1 - ay) + bot * ay;
    }
  });
  return { width: outW, height: outH, data: out };
}

// ---------------------------------------------------------------- focus mask

/** An empty focus mask for a source photo, at most MASK_MAX_SIDE on the long side. */
export function emptyMask(srcW: number, srcH: number): Mask {
  const scale = Math.min(1, MASK_MAX_SIDE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  return { width, height, data: new Uint8Array(width * height) };
}

export function maskHasFocus(mask: Mask | null | undefined): boolean {
  if (!mask) return false;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 127) return true;
  return false;
}

/**
 * Paints (value 255) or erases (value 0) a disc into the mask. Centre and radius are in
 * source pixels; quarter turns and straightening keep circles round, so this matches the brush.
 */
export function paintMask(mask: Mask, srcW: number, srcH: number, cx: number, cy: number, radius: number, value: 0 | 255): Mask {
  const kx = mask.width / srcW;
  const ky = mask.height / srcH;
  const mx = cx * kx;
  const my = cy * ky;
  const rx = Math.max(0.5, radius * kx);
  const ry = Math.max(0.5, radius * ky);
  const data = mask.data.slice();
  const xa = Math.max(0, Math.floor(mx - rx));
  const xb = Math.min(mask.width - 1, Math.ceil(mx + rx));
  const ya = Math.max(0, Math.floor(my - ry));
  const yb = Math.min(mask.height - 1, Math.ceil(my + ry));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = (x + 0.5 - mx) / rx;
      const dy = (y + 0.5 - my) / ry;
      if (dx * dx + dy * dy <= 1) data[y * mask.width + x] = value;
    }
  }
  return { ...mask, data };
}

/** The focus mask lined up with the edited output picture (nearest sampling). */
export function maskForOutput(mask: Mask, srcW: number, srcH: number, edit: PhotoEdit, outW: number, outH: number): Mask {
  const data = new Uint8Array(outW * outH);
  const kx = mask.width / srcW;
  const ky = mask.height / srcH;
  forEachOutputPixel(srcW, srcH, edit, outW, outH, (i, sx, sy) => {
    const mx = Math.floor(sx * kx);
    const my = Math.floor(sy * ky);
    if (mx >= 0 && my >= 0 && mx < mask.width && my < mask.height) data[i] = mask.data[my * mask.width + mx];
  });
  return { width: outW, height: outH, data };
}

/** 1 for grid cells inside the focus area, using the same nearest mapping as sampleGridColors. */
export function focusGridCells(mask: Mask, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const sy = Math.min(mask.height - 1, Math.floor((r / Math.max(1, rows - 1)) * mask.height));
    for (let c = 0; c < cols; c++) {
      const sx = Math.min(mask.width - 1, Math.floor((c / Math.max(1, cols - 1)) * mask.width));
      out[r * cols + c] = mask.data[sy * mask.width + sx] > 127 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Per-cell solver weights so the focus area holds `share` of the total weight
 * (never less than its own area). Cells outside weigh 1.
 */
export function focusGridWeights(mask: Mask, cols: number, rows: number, share = FOCUS_SHARE.balanced): Float32Array {
  const cells = focusGridCells(mask, cols, rows);
  let inside = 0;
  for (let i = 0; i < cells.length; i++) inside += cells[i];
  const outside = cells.length - inside;
  const s = Math.min(0.95, Math.max(0, share));
  const weight = inside === 0 || outside === 0 ? 1 : Math.max(1, (s / (1 - s)) * (outside / inside));
  const out = new Float32Array(cells.length);
  for (let i = 0; i < cells.length; i++) out[i] = cells[i] ? weight : 1;
  return out;
}
