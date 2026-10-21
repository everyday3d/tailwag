/**
 * "Fix photo": one-step clean-up for dark, dull, noisy or slightly blurry phone pictures, run on the
 * picture the print is made from (after crop and rotate). In order:
 *
 * 0. Clean up, before anything is brightened: colour speckle smoothed firmly, brightness smoothed
 *    only between similar neighbours so fur, eyes and outlines stay; strength follows the measured noise.
 * 1. Colour balance and contrast: the brightest areas and the average move most of the way to neutral
 *    (takes out a colour cast), then brightness is stretched between its 0.5% and 99.5% points.
 * 2. Even lighting: the light falling on the scene is estimated with a wide blur of the brightness,
 *    and the picture is brightened where that is dark and calmed where it is bright (partly, gain
 *    capped), so shadows open up without the picture going flat. A dark picture also gets a gentle
 *    brightness lift so its middle tones land near mid-grey.
 * 3. Sharpen: an unsharp mask on brightness, ignoring differences at the level of the leftover noise
 *    so it doesn't come back.
 *
 * Brightness changes are applied as one factor per pixel on all three channels, so hues don't shift.
 * Pure (no canvas), so it runs in tests and in the main thread on a ~420 px picture in a few ms.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Value at a fraction through a 256-bin histogram. */
function percentile(hist: Uint32Array, total: number, frac: number): number {
  const target = total * frac;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** Separable box blur of a single-channel float image (radius in pixels), run twice ≈ Gaussian. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h);
  let out = new Float32Array(src);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      let n = 0;
      for (let x = -r; x <= r; x++) {
        if (x >= 0 && x < w) {
          acc += out[y * w + x];
          n++;
        }
      }
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / n;
        const add = x + r + 1;
        const drop = x - r;
        if (add < w) {
          acc += out[y * w + add];
          n++;
        }
        if (drop >= 0) {
          acc -= out[y * w + drop];
          n--;
        }
      }
    }
    const next = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let n = 0;
      for (let y = -r; y <= r; y++) {
        if (y >= 0 && y < h) {
          acc += tmp[y * w + x];
          n++;
        }
      }
      for (let y = 0; y < h; y++) {
        next[y * w + x] = acc / n;
        const add = y + r + 1;
        const drop = y - r;
        if (add < h) {
          acc += tmp[add * w + x];
          n++;
        }
        if (drop >= 0) {
          acc -= tmp[drop * w + x];
          n--;
        }
      }
    }
    out = next;
  }
  return out;
}

/**
 * Clean-up before anything is brightened, while the noise is still small. Phone noise is mostly
 * colour speckle, so colour and brightness are treated apart: colour (Cb, Cr) is smoothed firmly,
 * brightness only between neighbours of a similar brightness, so edges stay. How hard depends on
 * the noise measured in the picture.
 */
function denoise(d: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const Y = new Float32Array(n);
  const Cb = new Float32Array(n);
  const Cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = b - Y[i];
    Cr[i] = r - Y[i];
  }
  // Noise level: median difference from a light blur (most of a photo is smooth)
  const near = boxBlur(Y, w, h, 1);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, Math.round(Math.abs(Y[i] - near[i])))]++;
  const noise = percentile(hist, n, 0.5);
  const sigma = Math.max(4, 4 * noise);
  const inv = 1 / (2 * sigma * sigma);

  const cb = boxBlur(Cb, w, h, 2);
  const cr = boxBlur(Cr, w, h, 2);
  const R = 3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let s = 0;
      let sw = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          const diff = Y[j] - Y[i];
          const wgt = Math.exp(-diff * diff * inv);
          s += Y[j] * wgt;
          sw += wgt;
        }
      }
      const yv = s / sw;
      const r = yv + cr[i];
      const b = yv + cb[i];
      const g = (yv - 0.299 * r - 0.114 * b) / 0.587;
      d[i * 4] = clamp255(r);
      d[i * 4 + 1] = clamp255(g);
      d[i * 4 + 2] = clamp255(b);
    }
  }
}

export function enhancePhoto(img: RgbaImage): RgbaImage {
  const { width: w, height: h } = img;
  const n = w * h;
  const d = new Uint8ClampedArray(img.data);

  // 0. Clean up first, so brightening doesn't blow the noise up
  denoise(d, w, h);

  // 1a. Colour balance: the brightest areas (a white chest, a lit wall) should be neutral, and so
  //     should the average; the gains move most of the way there (capped) to take out a colour cast
  const sum = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += d[i * 4 + c];
  const mean = sum.map((s) => Math.max(1, s / n));
  const lHist = new Uint32Array(256);
  for (let i = 0; i < n; i++) lHist[Math.round(lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]))]++;
  const brightCut = Math.min(250, percentile(lHist, n, 0.97));
  const bright = [0, 0, 0];
  let brightN = 0;
  for (let i = 0; i < n; i++) {
    const l = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    if (l >= brightCut && l < 252) {
      for (let c = 0; c < 3; c++) bright[c] += d[i * 4 + c];
      brightN++;
    }
  }
  // Only trust the bright areas when they are nearly neutral under the cast (a white chest or wall);
  // a fawn dog can be the brightest thing in the photo and must not be turned grey
  const brightRef = bright.map((b) => Math.max(1, b / Math.max(1, brightN)));
  const brightNeutral = Math.max(...brightRef) / Math.min(...brightRef) < 1.6;
  const ref = brightN > n * 0.005 && brightNeutral ? brightRef : mean;
  const refGrey = (ref[0] + ref[1] + ref[2]) / 3;
  const meanGrey = (mean[0] + mean[1] + mean[2]) / 3;
  const wb = [0, 1, 2].map((c) =>
    Math.min(1.6, Math.max(0.6, Math.pow(refGrey / ref[c], 0.55) * Math.pow(meanGrey / mean[c], 0.25)))
  );
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp255(d[i * 4 + c] * wb[c]);

  // 1b. Contrast: stretch brightness between its 0.5% and 99.5% points (half-way, gain capped)
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.round(lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]))]++;
  const lo = percentile(hist, n, 0.005);
  const hi = percentile(hist, n, 0.995);
  const gain = Math.min(2.5, 255 / Math.max(24, hi - lo));
  for (let i = 0; i < n; i++) {
    const l = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    if (l < 0.5) continue;
    const target = 0.5 * l + 0.5 * clamp255((l - lo) * gain);
    const f = target / l;
    for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp255(d[i * 4 + c] * f);
  }

  // 2. Even lighting (on brightness, applied as a factor so colours keep their hue)
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  // Wide on purpose: only broad changes count as lighting, so the subject itself isn't flattened
  const light = boxBlur(L, w, h, Math.max(w, h) / 5);
  let meanLight = 0;
  for (let i = 0; i < n; i++) meanLight += light[i];
  meanLight /= n;
  let meanL = 0;
  for (let i = 0; i < n; i++) meanL += L[i];
  meanL /= n;
  // Gentle lift for dark pictures: a gamma that moves the average towards mid-grey
  const gamma = meanL < 110 ? Math.max(0.6, Math.log(118 / 255) / Math.log(Math.max(8, meanL) / 255)) : 1;
  const factor = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const even = Math.min(2.2, Math.max(0.6, Math.pow(meanLight / Math.max(4, light[i]), 0.7)));
    const l1 = Math.min(255, L[i] * even);
    const l2 = 255 * Math.pow(l1 / 255, gamma);
    factor[i] = L[i] > 0.5 ? l2 / L[i] : 1;
  }
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp255(d[i * 4 + c] * factor[i]);
  }

  // 3. Sharpen brightness detail, skipping differences small enough to be leftover noise
  const L2 = new Float32Array(n);
  for (let i = 0; i < n; i++) L2[i] = lum(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  const soft = boxBlur(L2, w, h, Math.max(2, Math.max(w, h) / 200));
  // Leftover noise level: most pixels are flat, so the median detail is about the noise
  const detailHist = new Uint32Array(256);
  for (let i = 0; i < n; i++) detailHist[Math.min(255, Math.round(Math.abs(L2[i] - soft[i])))]++;
  const threshold = Math.max(3, 3 * percentile(detailHist, n, 0.5));
  for (let i = 0; i < n; i++) {
    const detail = L2[i] - soft[i];
    if (Math.abs(detail) < threshold || L2[i] < 0.5) continue;
    const target = Math.min(255, Math.max(0, L2[i] + 1.0 * detail));
    const f = target / L2[i];
    for (let c = 0; c < 3; c++) d[i * 4 + c] = clamp255(d[i * 4 + c] * f);
  }

  return { width: w, height: h, data: d };
}
