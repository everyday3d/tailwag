import { RGB, hexToRgb01, rgb01ToHex, computeLayerOpacity, computeTransmittance } from './opticalTdEngine';

export interface StackLayerInput {
  /** Layer filament color as RGB (0..1) or hex string (e.g. "#C00D1E") */
  color: RGB | string;
  /** Transmittance Distance (TD) in millimeters */
  tdMm: number;
  /** Physical thickness of this layer in millimeters (e.g. 0.08, 0.16, 0.20) */
  thicknessMm: number;
  /** Optional layer or filament identifier */
  label?: string;
}

export interface CumulativeLayerStep {
  layerIndex: number;
  label?: string;
  layerThicknessMm: number;
  cumulativeThicknessMm: number;
  stepOpacity: number;
  stepTransmittance: number;
  cumulativeTransmittance: number;
  cumulativeOpacity: number;
  blendedRgb: RGB;
  blendedHex: string;
}

export interface OpticalBlendResult {
  /** Final perceived color on the top surface */
  finalRgb: RGB;
  finalHex: string;
  /** Total physical thickness of the stacked layers in mm */
  totalThicknessMm: number;
  /** Cumulative single-pass optical transmittance (0.0 = completely blocked, 1.0 = clear) */
  totalTransmittance: number;
  /** Cumulative optical opacity (0.0 = clear, 1.0 = fully opaque) */
  totalOpacity: number;
  /** Cumulative optical density OD = -log10(T) */
  opticalDensity: number;
  /** Step-by-step layer evolution from bottom substrate to top */
  layerSteps: CumulativeLayerStep[];
}

export type OpticalBlendMode = 'reflective-scattering' | 'subtractive-transmittance';

export interface OpticalBlendOptions {
  /**
   * Optical blending model:
   * - 'reflective-scattering': Double-pass front-lit reflection with subsurface scattering (standard for 2.5D filament paintings & HueForge).
   * - 'subtractive-transmittance': Single-pass back-lit Beer-Lambert spectral attenuation (standard for lithophanes & CMYK lightboxes).
   */
  mode?: OpticalBlendMode;
  /** Optional underlying substrate or build plate color (default: { r: 0, g: 0, b: 0 } black) */
  substrateRgb?: RGB | string;
  /** Incident backlight color/radiance for subtractive mode (default: { r: 1, g: 1, b: 1 } white light) */
  backlightRgb?: RGB | string;
  /** Gamma exponent for perceptually uniform optical mixing (default: 1.35 for front-lit, 2.2 for linear radiance) */
  gamma?: number;
}

/**
 * Normalizes RGB or hex color input to RGB (0..1).
 */
function resolveRgb01(color: RGB | string): RGB {
  if (typeof color === 'string') {
    return hexToRgb01(color);
  }
  return {
    r: Math.max(0, Math.min(1, color.r)),
    g: Math.max(0, Math.min(1, color.g)),
    b: Math.max(0, Math.min(1, color.b)),
  };
}

/**
 * Optical Color Blending Engine for Stacked 3D Print Filament Layers.
 * 
 * Accurately simulates the transmission, attenuation, and subsurface reflection of light
 * through sequential plastic layers of varying thickness and Transmittance Distance (TD).
 */
export function blendFilamentStack(
  layers: StackLayerInput[],
  options: OpticalBlendOptions = {}
): OpticalBlendResult {
  const {
    mode = 'reflective-scattering',
    substrateRgb = { r: 0, g: 0, b: 0 },
    backlightRgb = { r: 1, g: 1, b: 1 },
    gamma = mode === 'reflective-scattering' ? 1.35 : 2.2,
  } = options;

  if (layers.length === 0) {
    const base = resolveRgb01(substrateRgb);
    return {
      finalRgb: base,
      finalHex: rgb01ToHex(base),
      totalThicknessMm: 0,
      totalTransmittance: 1.0,
      totalOpacity: 0.0,
      opticalDensity: 0.0,
      layerSteps: [],
    };
  }

  const layerSteps: CumulativeLayerStep[] = [];
  let cumThickness = 0;
  let cumTransmittance = 1.0;

  if (mode === 'subtractive-transmittance') {
    // -------------------------------------------------------------
    // BACKLIT SUBTRACTIVE BEER-LAMBERT TRANSMITTANCE MODEL
    // -------------------------------------------------------------
    // Each layer acts as a spectral attenuation filter:
    // T_layer(λ) = (Color_layer)^((t / TD) * scale) * 10^(-t / TD)
    let currentRadiance = resolveRgb01(backlightRgb);

    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      const t = Math.max(0, l.thicknessMm);
      const safeTd = Math.max(0.01, l.tdMm);
      cumThickness += t;

      const layerColor = resolveRgb01(l.color);
      const singlePassT = computeTransmittance(t, safeTd);
      cumTransmittance *= singlePassT;

      // Subtractive attenuation: Pigment absorbency scales with thickness relative to TD
      const opticalExponent = t / safeTd;
      const transR = Math.pow(layerColor.r, opticalExponent) * singlePassT;
      const transG = Math.pow(layerColor.g, opticalExponent) * singlePassT;
      const transB = Math.pow(layerColor.b, opticalExponent) * singlePassT;

      currentRadiance = {
        r: currentRadiance.r * transR,
        g: currentRadiance.g * transG,
        b: currentRadiance.b * transB,
      };

      const stepRgb: RGB = {
        r: Math.max(0, Math.min(1, currentRadiance.r)),
        g: Math.max(0, Math.min(1, currentRadiance.g)),
        b: Math.max(0, Math.min(1, currentRadiance.b)),
      };

      layerSteps.push({
        layerIndex: i + 1,
        label: l.label,
        layerThicknessMm: t,
        cumulativeThicknessMm: Number(cumThickness.toFixed(4)),
        stepOpacity: 1.0 - singlePassT,
        stepTransmittance: singlePassT,
        cumulativeTransmittance: cumTransmittance,
        cumulativeOpacity: 1.0 - cumTransmittance,
        blendedRgb: stepRgb,
        blendedHex: rgb01ToHex(stepRgb),
      });
    }

    const finalRgb: RGB = {
      r: Math.max(0, Math.min(1, currentRadiance.r)),
      g: Math.max(0, Math.min(1, currentRadiance.g)),
      b: Math.max(0, Math.min(1, currentRadiance.b)),
    };

    const opticalDensity = cumTransmittance > 0 ? -Math.log10(Math.max(1e-7, cumTransmittance)) : 7.0;

    return {
      finalRgb,
      finalHex: rgb01ToHex(finalRgb),
      totalThicknessMm: Number(cumThickness.toFixed(4)),
      totalTransmittance: cumTransmittance,
      totalOpacity: Math.max(0, Math.min(1, 1.0 - cumTransmittance)),
      opticalDensity: Number(opticalDensity.toFixed(3)),
      layerSteps,
    };
  }

  // ---------------------------------------------------------------
  // FRONT-LIT REFLECTIVE SUBSURFACE SCATTERING MODEL (HueForge Standard)
  // ---------------------------------------------------------------
  // Light penetrates through upper layers, reflects off the substrate, and scatters back up.
  // Each layer's effective opacity alters the cumulative optical color in gamma-space.
  let currentColor = resolveRgb01(substrateRgb);

  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const t = Math.max(0, l.thicknessMm);
    const safeTd = Math.max(0.01, l.tdMm);
    cumThickness += t;

    const layerColor = resolveRgb01(l.color);
    const stepAlpha = computeLayerOpacity(t, safeTd);
    const stepT = computeTransmittance(t, safeTd);
    cumTransmittance *= stepT;

    // Optical gamma-space linear mixing
    const blendChannel = (prev: number, next: number) => {
      const pLin = Math.pow(Math.max(0, prev), gamma);
      const nLin = Math.pow(Math.max(0, next), gamma);
      const mixed = pLin * (1 - stepAlpha) + nLin * stepAlpha;
      return Math.pow(Math.max(0, mixed), 1 / gamma);
    };

    currentColor = {
      r: blendChannel(currentColor.r, layerColor.r),
      g: blendChannel(currentColor.g, layerColor.g),
      b: blendChannel(currentColor.b, layerColor.b),
    };

    layerSteps.push({
      layerIndex: i + 1,
      label: l.label,
      layerThicknessMm: t,
      cumulativeThicknessMm: Number(cumThickness.toFixed(4)),
      stepOpacity: stepAlpha,
      stepTransmittance: stepT,
      cumulativeTransmittance: cumTransmittance,
      cumulativeOpacity: Math.max(0, Math.min(1, 1.0 - cumTransmittance)),
      blendedRgb: { ...currentColor },
      blendedHex: rgb01ToHex(currentColor),
    });
  }

  const opticalDensity = cumTransmittance > 0 ? -Math.log10(Math.max(1e-7, cumTransmittance)) : 7.0;

  return {
    finalRgb: currentColor,
    finalHex: rgb01ToHex(currentColor),
    totalThicknessMm: Number(cumThickness.toFixed(4)),
    totalTransmittance: cumTransmittance,
    totalOpacity: Math.max(0, Math.min(1, 1.0 - cumTransmittance)),
    opticalDensity: Number(opticalDensity.toFixed(3)),
    layerSteps,
  };
}
