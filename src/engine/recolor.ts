import { labToRgb, rgbToLab, type Lab } from './colorScience';

/**
 * Recolour: "this colour in the picture should be that colour". Each rule moves every pixel close to
 * `from` towards `to` by the same shift in CIELAB, so shading and texture inside the area survive
 * (a lit and a shaded part of the fur stay lighter and darker). How close counts is `tolerance`
 * (ΔE, CIE76); the shift fades out smoothly just beyond it so no hard edge appears.
 *
 * Runs on the picture the print is made from, after crop and Fix photo, so the colour someone clicks
 * on is the colour that gets moved. Pure, so it runs in tests.
 */

export interface RecolorRule {
  /** The colour picked in the picture, #RRGGBB */
  from: string;
  /** What it should become, #RRGGBB */
  to: string;
  /** How similar a colour must be to count (ΔE). */
  tolerance: number;
}

export const RECOLOR_TOLERANCE = { min: 6, max: 45, default: 20 };
/** The shift fades from full at `tolerance` to nothing at this multiple of it. */
const FADE = 1.5;

export function hexToLab(hex: string): Lab {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgbToLab({ r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 });
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** How much a colour this far (ΔE) from the picked one is moved: 1 inside the tolerance, fading to 0. */
export function recolorWeight(distance: number, tolerance: number): number {
  if (distance <= tolerance) return 1;
  const end = tolerance * FADE;
  if (distance >= end) return 0;
  const t = (distance - tolerance) / (end - tolerance);
  return 1 - t * t * (3 - 2 * t);
}

export function applyRecolor(
  img: { width: number; height: number; data: Uint8ClampedArray },
  rules: RecolorRule[]
): { width: number; height: number; data: Uint8ClampedArray } {
  if (rules.length === 0) return img;
  const prepared = rules.map((r) => {
    const from = hexToLab(r.from);
    const to = hexToLab(r.to);
    return { from, shift: { L: to.L - from.L, a: to.a - from.a, b: to.b - from.b }, tol: Math.max(1, r.tolerance) };
  });
  const out = new Uint8ClampedArray(img.data);
  // Photos repeat colours a lot; cache by RGB so each distinct colour is converted once
  const cache = new Map<number, number>();
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const r = out[i * 4];
    const g = out[i * 4 + 1];
    const b = out[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let packed = cache.get(key);
    if (packed === undefined) {
      const lab = rgbToLab({ r: r / 255, g: g / 255, b: b / 255 });
      let dL = 0;
      let da = 0;
      let db = 0;
      let wSum = 0;
      for (const p of prepared) {
        const d = Math.hypot(lab.L - p.from.L, lab.a - p.from.a, lab.b - p.from.b);
        const w = recolorWeight(d, p.tol);
        if (w <= 0) continue;
        dL += p.shift.L * w;
        da += p.shift.a * w;
        db += p.shift.b * w;
        wSum += w;
      }
      if (wSum === 0) {
        packed = key;
      } else {
        // Where rules overlap, their shifts are blended; a single rule applies in full
        const k = wSum > 1 ? 1 / wSum : 1;
        const rgb = labToRgb({ L: Math.min(100, Math.max(0, lab.L + dL * k)), a: lab.a + da * k, b: lab.b + db * k });
        const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
        packed = (c(rgb.r) << 16) | (c(rgb.g) << 8) | c(rgb.b);
      }
      cache.set(key, packed);
    }
    if (packed !== key) {
      out[i * 4] = (packed >> 16) & 255;
      out[i * 4 + 1] = (packed >> 8) & 255;
      out[i * 4 + 2] = packed & 255;
    }
  }
  return { width: img.width, height: img.height, data: out };
}
