import { FilamentSpool } from '../data/filamentCatalog';
import { deltaE2000 } from './colorScience';
import {
  OpticalProfile,
  LinearRgb,
  DEFAULT_BACKING_LINEAR,
  layerOver,
  profileForSpool,
  toDisplayRgb,
} from './opticalModel';

export interface LayerSwapSlot {
  id: string;
  spool: FilamentSpool;
  /** Maximum layer index (1-based) where this filament stops and the next starts */
  upToLayer: number;
  locked?: boolean;
}

export { blendFilamentStack } from './opticalBlendEngine';
export type {
  StackLayerInput,
  CumulativeLayerStep,
  OpticalBlendResult,
  OpticalBlendMode,
  OpticalBlendOptions,
} from './opticalBlendEngine';

export interface RGB {
  r: number; // 0..1
  g: number; // 0..1
  b: number; // 0..1
}

export function hexToRgb01(hex: string): RGB {
  const clean = hex.replace('#', '').trim();
  const num = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

export function rgb01ToHex(rgb: RGB): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${toByte(rgb.r)}${toByte(rgb.g)}${toByte(rgb.b)}`.toUpperCase();
}

/**
 * Computes the Beer-Lambert linear absorption coefficient α (in mm^-1).
 * α = ln(10) / TD ≈ 2.302585 / TD
 */
export function computeAbsorptionCoefficient(tdMm: number): number {
  const safeTd = Math.max(0.01, tdMm);
  return Math.log(10) / safeTd;
}

/**
 * Computes single-pass linear light transmittance T ∈ [0, 1] through plastic thickness t.
 * Beer-Lambert Law: T(t) = 10^(-t / TD) = exp(-α * t)
 */
export function computeTransmittance(thicknessMm: number, tdMm: number): number {
  if (thicknessMm <= 0) return 1.0;
  const safeTd = Math.max(0.01, tdMm);
  return Math.pow(10, -thicknessMm / safeTd);
}

/**
 * Computes single-pass light absorption opacity O ∈ [0, 1] through plastic thickness t.
 * O(t) = 1 - T(t) = 1 - 10^(-t / TD)
 */
export function computeSinglePassOpacity(thicknessMm: number, tdMm: number): number {
  return 1.0 - computeTransmittance(thicknessMm, tdMm);
}

/**
 * Beer-Lambert + Kubelka-Munk Subsurface Scattering optical transmission curve.
 * In HueForge / 2.5D filament painting (0.16mm initial layer + 0.08mm layer height at 100% infill),
 * incident light passes through each 0.08mm layer, reflects off the underlying pigment, and passes
 * back through the upper layers (double-pass front-lit transmission + scattering).
 * This allows a filament with a given TD to produce a continuous gradient of intermediate shades
 * as successive 0.08mm layers are stacked on top of an under-color.
 */
// Legacy heuristic: not used by the layer color table. See opticalModel.ts for the single model.
export function computeLayerOpacity(thicknessMm: number, tdMm: number): number {
  if (thicknessMm <= 0) return 0;
  const safeTd = Math.max(0.1, tdMm);
  const effectiveTd = 0.16 + 0.18 * safeTd;
  const ratio = thicknessMm / effectiveTd;
  const raw = 1 - Math.exp(-2.2 * Math.pow(ratio, 0.85));
  return Math.max(0, Math.min(1, raw));
}

/**
 * Blends an underlying plastic color with an overlay plastic layer of thickness t.
 * Uses gamma-corrected optical mixing with thickness-dependent opacity.
 */
// Legacy heuristic: not used by the layer color table. See opticalModel.ts for the single model.
export function blendColorsThroughThickness(
  baseRgb01: RGB,
  topColor01: RGB,
  topTdMm: number,
  thicknessMm: number,
  gamma: number = 1.35
): RGB {
  const alpha = computeLayerOpacity(thicknessMm, topTdMm);
  const blendChannel = (base: number, top: number) => {
    const baseLin = Math.pow(Math.max(0, base), gamma);
    const topLin = Math.pow(Math.max(0, top), gamma);
    const mixed = baseLin * (1 - alpha) + topLin * alpha;
    return Math.pow(Math.max(0, mixed), 1 / gamma);
  };
  return {
    r: blendChannel(baseRgb01.r, topColor01.r),
    g: blendChannel(baseRgb01.g, topColor01.g),
    b: blendChannel(baseRgb01.b, topColor01.b),
  };
}

/**
 * Computes the spectral reflectance R(t) of a polymer layer of thickness t over a substrate Rg
 * using the Kubelka-Munk two-flux light transport equation.
 * Models real-world physical pigment density and organic non-linear color shifting in melted plastics.
 */
// Legacy gamma-space Kubelka-Munk: not used by the layer color table. See opticalModel.ts (linear light).
export function computeKubelkaMunkReflectance(
  rg: number,
  rInf: number,
  thicknessMm: number,
  tdMm: number
): number {
  if (thicknessMm <= 0) return Math.max(0, Math.min(1, rg));
  const safeRg = Math.max(0.001, Math.min(0.999, rg));
  const safeRInf = Math.max(0.001, Math.min(0.999, rInf));
  const safeTd = Math.max(0.05, tdMm);

  // Kubelka-Munk auxiliary coefficients
  const a = 0.5 * (safeRInf + 1.0 / safeRInf);
  const b = 0.5 * (1.0 / safeRInf - safeRInf);

  // Scattering coefficient S calibrated to polymer Transmittance Distance (TD):
  // In 3D filaments, S relates inversely to TD (high-TD translucent filaments scatter light over larger depths)
  const s = 2.65 / safeTd;
  const u = b * s * thicknessMm;

  let bc: number;
  if (u > 14.0) {
    bc = b;
  } else if (u < 1e-4) {
    // Exact asymptotic limit as u -> 0 (or b -> 0 for low absorption white)
    bc = 1.0 / Math.max(1e-7, s * thicknessMm);
  } else {
    const expPos = Math.exp(u);
    const expNeg = Math.exp(-u);
    const cothVal = (expPos + expNeg) / Math.max(1e-7, expPos - expNeg);
    bc = b * cothVal;
  }

  const numerator = 1.0 - safeRg * (a - bc);
  const denominator = a + bc - safeRg;
  const r = numerator / Math.max(1e-7, denominator);

  return Math.max(0.0, Math.min(1.0, r));
}

/**
 * Blends an underlying plastic color with an overlay pigment layer using the
 * physical Kubelka-Munk two-flux model, simulating real melted polymer interactions.
 */
// Legacy gamma-space Kubelka-Munk: not used by the layer color table. See opticalModel.ts (linear light).
export function blendPigmentsKubelkaMunk(
  baseRgb01: RGB,
  topColor01: RGB,
  topTdMm: number,
  thicknessMm: number
): RGB {
  return {
    r: computeKubelkaMunkReflectance(baseRgb01.r, topColor01.r, thicknessMm, topTdMm),
    g: computeKubelkaMunkReflectance(baseRgb01.g, topColor01.g, thicknessMm, topTdMm),
    b: computeKubelkaMunkReflectance(baseRgb01.b, topColor01.b, thicknessMm, topTdMm),
  };
}

/**
 * Computes the physical lateral subsurface scattering radius in millimeters.
 * Increases with the square root of Transmittance Distance and height above opaque base.
 */
export function computeScatteringRadiusMm(tdMm: number, heightAboveBaseMm: number): number {
  if (heightAboveBaseMm <= 0 || tdMm <= 0) return 0;
  const beta = 0.28; // Empirical polymer lateral diffusion factor for PLA/PETG
  return Number((beta * Math.sqrt(Math.max(0.1, tdMm) * heightAboveBaseMm)).toFixed(3));
}

/**
 * 2D Subsurface Light Diffusion Matrix.
 * Accurately models lateral light scattering inside high-TD translucent polymer layers.
 * When translucent highlights sit above dark under-bases, light scatters outward horizontally,
 * softening harsh digital stair-stepping pixelation on fine details (eyes, edges, micro-contrast).
 */
export function applySubsurfaceLightDiffusion2D(
  colorsRgb: Float32Array,
  heightsAboveBaseMm: Float32Array,
  activeTdsMm: Float32Array,
  cols: number,
  rows: number,
  pixelPitchMm: number
): Float32Array {
  const output = new Float32Array(colorsRgb.length);
  const pitch = Math.max(0.05, pixelPitchMm);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const h = heightsAboveBaseMm[idx];
      const td = activeTdsMm[idx];
      const radiusMm = computeScatteringRadiusMm(td, h);
      // Determine local effective scattering radius from this cell and its immediate neighbors
      let effRadiusMm = radiusMm;
      for (let dy = -1; dy <= 1; dy++) {
        const nr = r + dy;
        if (nr < 0 || nr >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nc = c + dx;
          if (nc < 0 || nc >= cols) continue;
          const nIdx = nr * cols + nc;
          const nR = computeScatteringRadiusMm(activeTdsMm[nIdx], heightsAboveBaseMm[nIdx]);
          if (nR > effRadiusMm) effRadiusMm = nR;
        }
      }
      const radiusPx = effRadiusMm / pitch;

      const outIdx = idx * 3;

      // If scattering radius is sub-pixel (< 0.5px), preserve crisp verbatim value
      if (radiusPx < 0.5) {
        output[outIdx] = colorsRgb[outIdx];
        output[outIdx + 1] = colorsRgb[outIdx + 1];
        output[outIdx + 2] = colorsRgb[outIdx + 2];
        continue;
      }

      // Discrete 2D kernel radius (1 to 2 cells maximum for high performance)
      const kRadius = Math.min(2, Math.round(radiusPx));
      const sigma = Math.max(0.6, radiusPx * 0.75);
      const twoSigmaSq = 2 * sigma * sigma;

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let wSum = 0;

      for (let dy = -kRadius; dy <= kRadius; dy++) {
        const nr = r + dy;
        if (nr < 0 || nr >= rows) continue;
        for (let dx = -kRadius; dx <= kRadius; dx++) {
          const nc = c + dx;
          if (nc < 0 || nc >= cols) continue;

          const nIdx = nr * cols + nc;
          const distSq = dx * dx + dy * dy;
          const weight = Math.exp(-distSq / twoSigmaSq);

          const nRgbIdx = nIdx * 3;
          rSum += colorsRgb[nRgbIdx] * weight;
          gSum += colorsRgb[nRgbIdx + 1] * weight;
          bSum += colorsRgb[nRgbIdx + 2] * weight;
          wSum += weight;
        }
      }

      output[outIdx] = wSum > 0 ? rSum / wSum : colorsRgb[outIdx];
      output[outIdx + 1] = wSum > 0 ? gSum / wSum : colorsRgb[outIdx + 1];
      output[outIdx + 2] = wSum > 0 ? bSum / wSum : colorsRgb[outIdx + 2];
    }
  }

  return output;
}

/**
 * Computes the composite color for every discrete layer index (1..totalLayers) given the
 * baseLayerMm (initial layer), layerHeightMm and the ordered LayerSwapSlots.
 *
 * The default 'physical' model is the single optical model used by the solver, the viewport,
 * the print plan and every export (see opticalModel.ts). 'kubelka-munk' is accepted as an alias.
 * 'hybrid-gamma' is the earlier heuristic blend, kept only to compare against.
 */
export function buildLayerColorLUT(
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  slots: LayerSwapSlot[],
  options?: { model?: 'physical' | 'kubelka-munk' | 'hybrid-gamma'; backing?: number }
): { layer: number; zHeightMm: number; rgb: RGB; hex: string; activeSpool: FilamentSpool }[] {
  if (slots.length === 0) return [];

  const sortedSlots = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);
  const lut: { layer: number; zHeightMm: number; rgb: RGB; hex: string; activeSpool: FilamentSpool }[] = [];
  const model = options?.model ?? 'physical';
  const legacy = model === 'hybrid-gamma';

  const profiles = new Map<string, OpticalProfile>();
  const profileOf = (spool: FilamentSpool): OpticalProfile => {
    const key = `${spool.hex}|${spool.td}|${spool.calibration?.date ?? ''}`;
    let p = profiles.get(key);
    if (!p) {
      p = profileForSpool(spool);
      profiles.set(key, p);
    }
    return p;
  };

  let currentColor = hexToRgb01(sortedSlots[0].spool.hex);
  let currentLinear: LinearRgb = { r: 0, g: 0, b: 0 };

  for (let layer = 1; layer <= totalLayers; layer++) {
    const zHeightMm = Number((baseLayerMm + (layer - 1) * layerHeightMm).toFixed(3));
    const slot = sortedSlots.find((s) => layer <= s.upToLayer) || sortedSlots[sortedSlots.length - 1];
    const filamentRgb = hexToRgb01(slot.spool.hex);

    if (legacy) {
      if (layer === 1) {
        currentColor = { ...filamentRgb };
      } else {
        const stepAlpha = computeLayerOpacity(layerHeightMm, slot.spool.td);
        const gamma = 1.35;
        const blendChannel = (prev: number, next: number) => {
          const pLin = Math.pow(Math.max(0, prev), gamma);
          const nLin = Math.pow(Math.max(0, next), gamma);
          return Math.pow(Math.max(0, pLin * (1 - stepAlpha) + nLin * stepAlpha), 1 / gamma);
        };
        currentColor = {
          r: blendChannel(currentColor.r, filamentRgb.r),
          g: blendChannel(currentColor.g, filamentRgb.g),
          b: blendChannel(currentColor.b, filamentRgb.b),
        };
      }
    } else {
      const profile = profileOf(slot.spool);
      if (layer === 1) {
        // The initial layer is a translucent layer over the backing, not a solid color by decree
        const b = options?.backing ?? DEFAULT_BACKING_LINEAR;
        currentLinear = layerOver({ r: b, g: b, b: b }, profile, baseLayerMm);
      } else {
        currentLinear = layerOver(currentLinear, profile, layerHeightMm);
      }
      currentColor = toDisplayRgb(currentLinear);
    }

    lut.push({
      layer,
      zHeightMm,
      rgb: { ...currentColor },
      hex: rgb01ToHex(currentColor),
      activeSpool: slot.spool,
    });
  }

  return lut;
}

/** sRGB (0..1) to CIELAB (D65). Single implementation lives in colorScience.ts. */
export { rgbToLab } from './colorScience';

/**
 * Perceptual color difference. This is CIEDE2000 (kL = kC = kH = 1); the earlier CIE76
 * Euclidean distance was removed so the metric that selects colors is the one that is reported.
 */
export const deltaE = deltaE2000;
