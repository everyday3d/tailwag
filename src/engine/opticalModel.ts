import { RGB01, linearToSrgb, srgbToLinear, rgbToLab, deltaE2000 } from './colorScience';

/**
 * The one optical model: a two-flux (Kubelka-Munk) layer model evaluated per color channel in
 * LINEAR light, replacing the earlier mix of gamma-space blends and magic constants.
 *
 * A filament is described by:
 *   - rInf[c]  reflectance of an infinitely thick layer, linear light, per channel (its color)
 *   - s        scattering coefficient (1/mm), shared by all channels (pigments absorb, the
 *              polymer scatters)
 *   - tdMm     the Transmission Distance the user knows
 *
 * `s` is calibrated so that TD means what a TD reading means: light passing through a layer of
 * thickness TD is reduced to TD_TRANSMITTANCE (10%). Phase C (printed calibration plate + photo)
 * replaces these defaults with fitted values per filament; until then every profile is flagged
 * as an estimate.
 */

/** Diffuse transmittance of a layer of thickness TD (the definition of Transmission Distance). */
export const TD_TRANSMITTANCE = 0.1;

/** Keeps b = (1/Rinf - Rinf)/2 finite and positive for pure black and pure white inputs. */
const R_INF_MIN = 0.003;
const R_INF_MAX = 0.97;

/**
 * Linear reflectance of whatever is behind the print (a dark surface by default). Translucent base
 * filaments show it through, so a clear or white base looks gray rather than white. Treated as an
 * estimate until calibration.
 */
export const DEFAULT_BACKING_LINEAR = 0.05;

export interface OpticalProfile {
  /** Linear-light infinite-thickness reflectance per channel [r, g, b] */
  rInf: [number, number, number];
  /** Scattering coefficient, 1/mm */
  s: number;
  tdMm: number;
  /** 'estimate' until a calibration fit replaces the defaults */
  source: 'estimate' | 'calibrated';
}

const clampR = (r: number) => Math.max(R_INF_MIN, Math.min(R_INF_MAX, r));

function kmAB(rInf: number): { a: number; b: number } {
  const r = clampR(rInf);
  return { a: 0.5 * (r + 1 / r), b: 0.5 * (1 / r - r) };
}

/** b * coth(x) with correct limits for tiny and huge x. */
function bCoth(b: number, x: number): number {
  if (x > 20) return b;
  if (x < 1e-6) return b / x;
  const e = Math.exp(-2 * x);
  return (b * (1 + e)) / (1 - e);
}

/**
 * Reflectance of a layer (thickness tMm, scattering s, infinite-thickness reflectance rInf)
 * lying on a substrate of reflectance rg. All values linear light, one channel.
 */
export function kmLayerReflectance(rg: number, rInf: number, s: number, tMm: number): number {
  if (tMm <= 0) return Math.max(0, Math.min(1, rg));
  const { a, b } = kmAB(rInf);
  const bc = bCoth(b, b * s * tMm);
  const out = (1 - rg * (a - bc)) / (a - rg + bc);
  return Math.max(0, Math.min(1, out));
}

/**
 * Scattering coefficient that makes `tdMm` mean what a TD reading means: the diffuse
 * transmittance of the layer falls to TD_TRANSMITTANCE (10%) at t = TD.
 *
 * With the Kubelka-Munk substitution a = cosh(phi), b = sinh(phi), Rinf = exp(-phi), the
 * transmittance of a layer on a perfect absorber is T = sinh(phi) / sinh(b*S*t + phi), so
 * b*S*TD = asinh(sinh(phi) / T) - phi has a closed form.
 */
export function scatteringForTd(rInfLuminance: number, tdMm: number): number {
  const td = Math.max(0.05, tdMm);
  const r = clampR(rInfLuminance);
  const phi = -Math.log(r);
  const sinhPhi = Math.sinh(phi);
  const x = Math.asinh(sinhPhi / TD_TRANSMITTANCE) - phi;
  return x / (sinhPhi * td);
}

/** Builds a profile from a spool's display color (sRGB hex or 0..1) and its TD. */
export function profileFromColor(color: RGB01, tdMm: number): OpticalProfile {
  const lin: [number, number, number] = [srgbToLinear(color.r), srgbToLinear(color.g), srgbToLinear(color.b)];
  const lum = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];
  return {
    rInf: lin,
    s: scatteringForTd(Math.max(lum, R_INF_MIN), tdMm),
    tdMm,
    source: 'estimate',
  };
}

export interface LinearRgb {
  r: number;
  g: number;
  b: number;
}

/** One layer of `profile` with thickness `tMm` placed on top of a linear-light substrate. */
export function layerOver(substrate: LinearRgb, profile: OpticalProfile, tMm: number): LinearRgb {
  return {
    r: kmLayerReflectance(substrate.r, profile.rInf[0], profile.s, tMm),
    g: kmLayerReflectance(substrate.g, profile.rInf[1], profile.s, tMm),
    b: kmLayerReflectance(substrate.b, profile.rInf[2], profile.s, tMm),
  };
}

export function toDisplayRgb(lin: LinearRgb): RGB01 {
  return { r: linearToSrgb(lin.r), g: linearToSrgb(lin.g), b: linearToSrgb(lin.b) };
}

export interface StackLayer {
  profile: OpticalProfile;
  thicknessMm: number;
}

/**
 * Color seen from above for a stack listed bottom to top.
 * By default the first layer is NOT opaque: every layer, including the first, is a translucent
 * layer over the backing, so a translucent base filament is not credited with a solid color it
 * does not have. Pass opaqueBase to force the old behavior.
 */
export function compositeStack(
  layers: StackLayer[],
  options: { substrate?: LinearRgb; opaqueBase?: boolean } = {}
): LinearRgb {
  const opaqueBase = options.opaqueBase ?? false;
  let current: LinearRgb = options.substrate ?? {
    r: DEFAULT_BACKING_LINEAR,
    g: DEFAULT_BACKING_LINEAR,
    b: DEFAULT_BACKING_LINEAR,
  };
  layers.forEach((layer, i) => {
    if (i === 0 && opaqueBase) {
      current = { r: layer.profile.rInf[0], g: layer.profile.rInf[1], b: layer.profile.rInf[2] };
    } else {
      current = layerOver(current, layer.profile, layer.thicknessMm);
    }
  });
  return current;
}

/**
 * Opacity of a single layer over black as a fraction of full reflectance, for a neutral
 * mid-bright reference color. Used to give users an intuitive "per-layer opacity" figure.
 */
export function singleLayerOpacity(thicknessMm: number, tdMm: number): number {
  const ref = profileFromColor({ r: 0.9, g: 0.9, b: 0.9 }, tdMm);
  const over = kmLayerReflectance(0, ref.rInf[0], ref.s, thicknessMm);
  return over / ref.rInf[0];
}

/** ΔE00 between two stack results, both given linear. Convenience for tests and reports. */
export function stackDeltaE(a: LinearRgb, b: LinearRgb): number {
  return deltaE2000(rgbToLab(toDisplayRgb(a)), rgbToLab(toDisplayRgb(b)));
}
