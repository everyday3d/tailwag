/**
 * Subject cutout (#4 idea): turns the cutout model's mask into a printable outline.
 * Pure functions so they can be tested without the model.
 *
 * The outline is computed on the heightmap grid: largest subject only, holes filled,
 * grown by a margin, smoothed so fur and whiskers do not make spikes, then a distance
 * to the edge for every inside cell in the same units evaluateShapeMask uses
 * (mm divided by half the print's larger side), so frames follow the outline.
 */
import type { Mask } from './photoEdit';

export interface SubjectShape {
  cols: number;
  rows: number;
  /** 1 = printed */
  inside: Uint8Array;
  /** Distance to the outline in evaluateShapeMask units; negative outside */
  edgeDist: Float32Array;
  /** Share of the grid that prints */
  coverage: number;
}

export const SUBJECT_DEFAULTS = { marginMm: 3, smoothMm: 2 };

/** Stretches a square model mask back onto a w × h picture (bilinear). */
export function resampleMask(src: Uint8Array, size: number, w: number, h: number): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(size - 1, Math.max(0, ((y + 0.5) / h) * size - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(size - 1, y0 + 1);
    const ay = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(size - 1, Math.max(0, ((x + 0.5) / w) * size - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(size - 1, x0 + 1);
      const ax = fx - x0;
      const top = src[y0 * size + x0] * (1 - ax) + src[y0 * size + x1] * ax;
      const bot = src[y1 * size + x0] * (1 - ax) + src[y1 * size + x1] * ax;
      data[y * w + x] = Math.round(top * (1 - ay) + bot * ay);
    }
  }
  return { width: w, height: h, data };
}

/** Keeps the largest 4-connected region of 1s. */
export function keepLargestRegion(bin: Uint8Array, cols: number, rows: number): Uint8Array {
  const label = new Int32Array(bin.length).fill(-1);
  const stack: number[] = [];
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || label[start] !== -1) continue;
    let size = 0;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % cols;
      const y = (i / cols) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1];
      for (const j of nb) {
        if (j >= 0 && bin[j] && label[j] === -1) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
    next++;
  }
  const out = new Uint8Array(bin.length);
  if (best >= 0) for (let i = 0; i < bin.length; i++) out[i] = label[i] === best ? 1 : 0;
  return out;
}

/** Fills enclosed holes: background not connected to the border becomes subject. */
export function fillHoles(bin: Uint8Array, cols: number, rows: number): Uint8Array {
  const outside = new Uint8Array(bin.length);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!bin[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < cols; x++) {
    seed(x);
    seed((rows - 1) * cols + x);
  }
  for (let y = 0; y < rows; y++) {
    seed(y * cols);
    seed(y * cols + cols - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % cols;
    const y = (i / cols) | 0;
    if (x > 0) seed(i - 1);
    if (x < cols - 1) seed(i + 1);
    if (y > 0) seed(i - cols);
    if (y < rows - 1) seed(i + cols);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** 1-D squared distance transform (Felzenszwalb and Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s > z[k]) break;
      k--;
      if (k < 0) {
        k = 0;
        break;
      }
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance (in cells) from every cell to the nearest cell where feature = 1. */
export function distanceToFeature(feature: Uint8Array, cols: number, rows: number): Float32Array {
  const INF = 1e12;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const tmp = new Float64Array(cols * rows);
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) f[y] = feature[y * cols + x] ? 0 : INF;
    edt1d(f, rows, d, v, z);
    for (let y = 0; y < rows; y++) tmp[y * cols + x] = d[y];
  }
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) f[x] = tmp[y * cols + x];
    edt1d(f, cols, d, v, z);
    for (let x = 0; x < cols; x++) out[y * cols + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Separable box blur repeated twice (close to a Gaussian), radius in cells. */
function blur(src: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  if (radius < 1) return src;
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < cols) {
            s += a[y * cols + xx];
            c++;
          }
        }
        b[y * cols + x] = s / c;
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0;
        let c = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < rows) {
            s += b[yy * cols + x];
            c++;
          }
        }
        a[y * cols + x] = s / c;
      }
    }
  }
  return a;
}

/**
 * The printable outline on a cols × rows grid from an image-aligned subject mask.
 * Returns null when nothing usable was found.
 */
export function buildSubjectShape(
  mask: Mask,
  cols: number,
  rows: number,
  widthMm: number,
  heightMm: number,
  marginMm = SUBJECT_DEFAULTS.marginMm,
  smoothMm = SUBJECT_DEFAULTS.smoothMm
): SubjectShape | null {
  const n = cols * rows;
  let bin: Uint8Array = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    const sy = Math.min(mask.height - 1, Math.floor((r / Math.max(1, rows - 1)) * mask.height));
    for (let c = 0; c < cols; c++) {
      const sx = Math.min(mask.width - 1, Math.floor((c / Math.max(1, cols - 1)) * mask.width));
      bin[r * cols + c] = mask.data[sy * mask.width + sx] > 127 ? 1 : 0;
    }
  }
  bin = fillHoles(keepLargestRegion(bin, cols, rows), cols, rows);
  if (!bin.some((v) => v)) return null;

  const cellMm = (widthMm / cols + heightMm / rows) / 2;
  if (marginMm > 0) {
    const dist = distanceToFeature(bin, cols, rows);
    const reach = marginMm / cellMm;
    for (let i = 0; i < n; i++) bin[i] = dist[i] <= reach ? 1 : 0;
  }
  const radius = Math.round(smoothMm / cellMm);
  if (radius >= 1) {
    const soft = blur(Float32Array.from(bin), cols, rows, radius);
    for (let i = 0; i < n; i++) bin[i] = soft[i] >= 0.5 ? 1 : 0;
  }
  bin = fillHoles(keepLargestRegion(bin, cols, rows), cols, rows);
  let count = 0;
  for (let i = 0; i < n; i++) count += bin[i];
  if (count === 0) return null;

  // Distance to the nearest outside cell; the area beyond the grid counts as outside.
  const pc = cols + 2;
  const pr = rows + 2;
  const outsidePadded = new Uint8Array(pc * pr).fill(1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) outsidePadded[(r + 1) * pc + c + 1] = bin[r * cols + c] ? 0 : 1;
  const toOutside = distanceToFeature(outsidePadded, pc, pr);
  const insideDist = distanceToFeature(bin, cols, rows);
  const unit = Math.max(widthMm, heightMm) / 2;
  const edgeDist = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      // Half a cell inward: the edge lies between the last inside cell and the first outside one
      edgeDist[i] = bin[i] ? ((toOutside[(r + 1) * pc + c + 1] - 0.5) * cellMm) / unit : (-(insideDist[i] - 0.5) * cellMm) / unit;
    }
  }
  return { cols, rows, inside: bin, edgeDist, coverage: count / n };
}
