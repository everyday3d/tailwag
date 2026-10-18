/**
 * Color science used everywhere in TailWag: one sRGB <-> XYZ <-> CIELAB implementation and
 * the standard CIEDE2000 color difference. Nothing else in the codebase should reimplement these.
 */

export interface RGB01 {
  r: number; // 0..1, sRGB-encoded
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** D65 reference white (ASTM E308), Y = 1 */
export const D65_WHITE = { x: 0.95047, y: 1.0, z: 1.08883 } as const;

const EPSILON = 216 / 24389; // 0.008856
const KAPPA = 24389 / 27; // 903.296

/** sRGB transfer function, encoded 0..1 -> linear light 0..1 */
export function srgbToLinear(c: number): number {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Inverse sRGB transfer function, linear light -> encoded 0..1 (clamped) */
export function linearToSrgb(c: number): number {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Linear-light sRGB -> CIE XYZ (D65), IEC 61966-2-1 primaries */
export function linearRgbToXyz(r: number, g: number, b: number): { x: number; y: number; z: number } {
  return {
    x: 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    y: 0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    z: 0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  };
}

export function xyzToLinearRgb(x: number, y: number, z: number): { r: number; g: number; b: number } {
  return {
    r: 3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    g: -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    b: 0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  };
}

const fLab = (t: number) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const fLabInv = (t: number) => {
  const t3 = t * t * t;
  return t3 > EPSILON ? t3 : (116 * t - 16) / KAPPA;
};

/** sRGB (encoded, 0..1) -> CIELAB under D65 */
export function rgbToLab(rgb: RGB01): Lab {
  const { x, y, z } = linearRgbToXyz(srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b));
  const fx = fLab(x / D65_WHITE.x);
  const fy = fLab(y / D65_WHITE.y);
  const fz = fLab(z / D65_WHITE.z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Linear-light RGB (0..1) -> CIELAB under D65 (no transfer function) */
export function linearRgbToLab(r: number, g: number, b: number): Lab {
  const { x, y, z } = linearRgbToXyz(r, g, b);
  const fx = fLab(x / D65_WHITE.x);
  const fy = fLab(y / D65_WHITE.y);
  const fz = fLab(z / D65_WHITE.z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIELAB -> sRGB (encoded, clamped to the sRGB gamut) */
export function labToRgb(lab: Lab): RGB01 {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;
  const x = fLabInv(fx) * D65_WHITE.x;
  const y = (lab.L > KAPPA * EPSILON ? fy * fy * fy : lab.L / KAPPA) * D65_WHITE.y;
  const z = fLabInv(fz) * D65_WHITE.z;
  const lin = xyzToLinearRgb(x, y, z);
  return { r: linearToSrgb(lin.r), g: linearToSrgb(lin.g), b: linearToSrgb(lin.b) };
}

const POW25_7 = 6103515625; // 25^7
const DEG = Math.PI / 180;

/**
 * CIEDE2000 color difference (Sharma, Wu, Dalal 2005).
 *
 * With the default weights kL = kC = kH = 1 this is the standard metric and is what the app
 * reports to users. The solver may pass other weights to bias matching; those are never reported
 * as the ΔE00.
 */
export function deltaE2000(lab1: Lab, lab2: Lab, kL = 1, kC = 1, kH = 1): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const avgC7 = Math.pow(avgC, 7);
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + POW25_7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  let h1p = Math.atan2(b1, a1p) / DEG;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) / DEG;
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) dhp = diff;
    else if (diff > 180) dhp = diff - 360;
    else dhp = diff + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);

  const avgLp = (L1 + L2) / 2;
  const avgCp = (C1p + C2p) / 2;
  let avgHp: number;
  if (C1p * C2p === 0) avgHp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) avgHp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) avgHp = (h1p + h2p + 360) / 2;
  else avgHp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((avgHp - 30) * DEG) +
    0.24 * Math.cos(2 * avgHp * DEG) +
    0.32 * Math.cos((3 * avgHp + 6) * DEG) -
    0.2 * Math.cos((4 * avgHp - 63) * DEG);

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const avgCp7 = Math.pow(avgCp, 7);
  const RC = 2 * Math.sqrt(avgCp7 / (avgCp7 + POW25_7));
  const lm50 = Math.pow(avgLp - 50, 2);
  const SL = 1 + (0.015 * lm50) / Math.sqrt(20 + lm50);
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;
  const RT = -Math.sin(2 * dTheta * DEG) * RC;

  const tL = dLp / (kL * SL);
  const tC = dCp / (kC * SC);
  const tH = dHp / (kH * SH);
  return Math.sqrt(Math.max(0, tL * tL + tC * tC + tH * tH + RT * tC * tH));
}
