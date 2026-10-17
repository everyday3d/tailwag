import { FilamentSpool } from '../data/filamentCatalog';

export interface LayerSwapSlot {
  id: string;
  spool: FilamentSpool;
  /** Maximum layer index (1-based) where this filament stops and the next starts */
  upToLayer: number;
  locked?: boolean;
}

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
 * Beer-Lambert + Kubelka-Munk Subsurface Scattering optical transmission curve.
 * In HueForge / filament painting, TD (Transmission Distance in mm) is the thickness
 * where light transmission drops to ~1% (5 steps of 2x attenuation).
 * Each single 0.08mm layer step contributes a controlled perceptual tint over the underlying base layer.
 */
export function computeLayerOpacity(thicknessMm: number, tdMm: number): number {
  if (thicknessMm <= 0) return 0;
  const safeTd = Math.max(0.1, tdMm);
  const ratio = thicknessMm / safeTd;
  // Calibrated Kubelka-Munk scattering constant k = 2.75 for crisp multi-layer transitions
  const raw = 1 - Math.exp(-2.75 * Math.pow(ratio, 0.88));
  return Math.max(0, Math.min(1, raw));
}

/**
 * Computes the exact composite RGB color for every discrete layer index (1..totalLayers)
 * given the baseLayerMm, layerHeightMm, and ordered LayerSwapSlots.
 */
export function buildLayerColorLUT(
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  slots: LayerSwapSlot[]
): { layer: number; zHeightMm: number; rgb: RGB; hex: string; activeSpool: FilamentSpool }[] {
  if (slots.length === 0) return [];

  const sortedSlots = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);
  const lut: { layer: number; zHeightMm: number; rgb: RGB; hex: string; activeSpool: FilamentSpool }[] = [];

  // Start with the first (bottom/base) filament at full saturation on the build plate
  let currentColor = hexToRgb01(sortedSlots[0].spool.hex);

  for (let layer = 1; layer <= totalLayers; layer++) {
    const zHeightMm = Number((baseLayerMm + (layer - 1) * layerHeightMm).toFixed(3));
    const slot = sortedSlots.find((s) => layer <= s.upToLayer) || sortedSlots[sortedSlots.length - 1];
    const filamentRgb = hexToRgb01(slot.spool.hex);

    if (layer === 1) {
      // Base layer provides solid backing
      const baseAlpha = Math.max(0.94, computeLayerOpacity(baseLayerMm, slot.spool.td));
      currentColor = {
        r: filamentRgb.r * baseAlpha,
        g: filamentRgb.g * baseAlpha,
        b: filamentRgb.b * baseAlpha,
      };
    } else {
      // Single layer step blending via Beer-Lambert TD transmission in perceptual sRGB space (gamma 1.35)
      // so dark Brown/Orange layers over Black retain rich warm chroma instead of turning muddy
      const stepAlpha = computeLayerOpacity(layerHeightMm, slot.spool.td);
      const gamma = 1.35;
      const blendChannel = (prev: number, next: number) => {
        const pLin = Math.pow(Math.max(0, prev), gamma);
        const nLin = Math.pow(Math.max(0, next), gamma);
        const mixed = pLin * (1 - stepAlpha) + nLin * stepAlpha;
        return Math.pow(Math.max(0, mixed), 1 / gamma);
      };
      currentColor = {
        r: blendChannel(currentColor.r, filamentRgb.r),
        g: blendChannel(currentColor.g, filamentRgb.g),
        b: blendChannel(currentColor.b, filamentRgb.b),
      };
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

/**
 * Convert RGB (0..1) to CIE LAB for perceptual ΔE color matching in AI Auto-Solver
 */
export function rgbToLab(rgb: RGB): { L: number; a: number; b: number } {
  const toLinear = (c: number) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function deltaE(lab1: { L: number; a: number; b: number }, lab2: { L: number; a: number; b: number }): number {
  const dL = lab1.L - lab2.L;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}
