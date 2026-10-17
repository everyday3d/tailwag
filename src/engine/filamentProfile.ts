import { FilamentSpool } from '../data/filamentCatalog';
import {
  RGB,
  hexToRgb01,
  rgb01ToHex,
  computeAbsorptionCoefficient,
  computeTransmittance,
  computeSinglePassOpacity,
  computeLayerOpacity,
  blendColorsThroughThickness,
} from './opticalTdEngine';

export interface FilamentColorValue {
  hex: string;
  rgb: { r: number; g: number; b: number };
  rgb01: RGB;
}

export interface FilamentOpticalProperties {
  /** Transmission Distance in millimeters (thickness where light attenuates to ~10% single-pass / 99% double-pass opacity) */
  tdMm: number;
  /** Linear absorption coefficient α = ln(10) / tdMm (mm^-1) */
  absorptionCoeff: number;
  /**
   * Computes linear single-pass transmittance T ∈ [0, 1] through plastic thickness `thicknessMm`.
   * Beer-Lambert Law: T(t) = 10^(-t / TD) = exp(-α * t)
   */
  getTransmittance: (thicknessMm: number) => number;
  /**
   * Computes single-pass absorption opacity O ∈ [0, 1] through plastic thickness `thicknessMm`.
   * O(t) = 1 - T(t) = 1 - 10^(-t / TD)
   */
  getOpacity: (thicknessMm: number) => number;
  /**
   * Computes front-lit reflective double-pass opacity with subsurface scattering across thickness `thicknessMm`.
   */
  getReflectiveOpacity: (thicknessMm: number) => number;
}

export interface FilamentProfile {
  id: string;
  brand: string;
  colorName: string;
  color: FilamentColorValue;
  material: FilamentSpool['material'];
  /** Transmittance Distance (TD) in millimeters */
  tdMm: number;
  optical: FilamentOpticalProperties;
  owned?: boolean;
  amsSlot?: string;
  libraryId?: string;
  libraryName?: string;

  /**
   * Simulates optical blending of this filament printed at thickness `thicknessMm`
   * on top of an underlying substrate color `baseRgb01`.
   */
  blendOver: (baseRgb01: RGB, thicknessMm: number, gamma?: number) => RGB;
}

/**
 * Creates a fully resolved FilamentProfile with precalculated optical parameters
 * and thickness transmission functions.
 */
export function createFilamentProfile(params: {
  id: string;
  brand: string;
  colorName: string;
  hex: string;
  tdMm: number;
  material?: FilamentSpool['material'];
  owned?: boolean;
  amsSlot?: string;
  libraryId?: string;
  libraryName?: string;
}): FilamentProfile {
  const rgb01 = hexToRgb01(params.hex);
  const rgb = {
    r: Math.round(rgb01.r * 255),
    g: Math.round(rgb01.g * 255),
    b: Math.round(rgb01.b * 255),
  };
  const hex = rgb01ToHex(rgb01);
  const tdMm = Math.max(0.1, params.tdMm);
  const absorptionCoeff = computeAbsorptionCoefficient(tdMm);

  const optical: FilamentOpticalProperties = {
    tdMm,
    absorptionCoeff,
    getTransmittance: (tMm: number) => computeTransmittance(tMm, tdMm),
    getOpacity: (tMm: number) => computeSinglePassOpacity(tMm, tdMm),
    getReflectiveOpacity: (tMm: number) => computeLayerOpacity(tMm, tdMm),
  };

  return {
    id: params.id,
    brand: params.brand,
    colorName: params.colorName,
    color: {
      hex,
      rgb,
      rgb01,
    },
    material: params.material || 'PLA',
    tdMm,
    optical,
    owned: params.owned,
    amsSlot: params.amsSlot,
    libraryId: params.libraryId,
    libraryName: params.libraryName,
    blendOver: (baseRgb01: RGB, thicknessMm: number, gamma: number = 1.35) =>
      blendColorsThroughThickness(baseRgb01, rgb01, tdMm, thicknessMm, gamma),
  };
}

/**
 * Converts a legacy/lightweight FilamentSpool into a rich FilamentProfile.
 */
export function spoolToProfile(spool: FilamentSpool): FilamentProfile {
  return createFilamentProfile({
    id: spool.id,
    brand: spool.brand,
    colorName: spool.name,
    hex: spool.hex,
    tdMm: spool.td,
    material: spool.material,
    owned: spool.owned,
    amsSlot: spool.amsSlot,
    libraryId: spool.libraryId,
    libraryName: spool.libraryName,
  });
}

/**
 * Converts a FilamentProfile back into a FilamentSpool for core engine backwards compatibility.
 */
export function profileToSpool(profile: FilamentProfile): FilamentSpool {
  return {
    id: profile.id,
    brand: profile.brand,
    name: profile.colorName,
    material: profile.material,
    hex: profile.color.hex,
    td: profile.tdMm,
    owned: profile.owned,
    amsSlot: profile.amsSlot,
    libraryId: profile.libraryId,
    libraryName: profile.libraryName,
  };
}
