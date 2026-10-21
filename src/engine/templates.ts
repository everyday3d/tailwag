import type { CadCutoutConfig, HeightmapGrid } from './cadMeshBuilder';
import type { PhotoEdit } from './photoEdit';
import { editSpaceSize } from './photoEdit';

/**
 * Ready-made starting points: size, shape, frame, holes and depth for a kind of object.
 * Applying one keeps the photo, the filaments and any name plate; it sets everything else.
 */

export type TemplateId = 'coaster' | 'ornament' | 'keychain' | 'magnet' | 'stand';

export interface PrintTemplate {
  id: TemplateId;
  label: string;
  /** One line under the button */
  blurb: string;
  /** Longest side (mm) */
  sizeMm: number;
  /** Circle shapes need a square photo; the photo is cropped to a centred square */
  square: boolean;
  /** Solid base (mm): thicker for things that get handled */
  solidBaseMm: number;
  cad: Partial<CadCutoutConfig>;
}

const NO_EXTRAS: Partial<CadCutoutConfig> = {
  clockMode: false,
  keychainHole: false,
  magnetPockets: false,
  deskStand: false,
};

export const PRINT_TEMPLATES: PrintTemplate[] = [
  {
    id: 'coaster',
    label: 'Coaster',
    blurb: '95 mm circle with a raised lip, stiff base. PETG copes with hot mugs better than PLA.',
    sizeMm: 95,
    square: true,
    solidBaseMm: 1.2,
    cad: { ...NO_EXTRAS, shape: 'circle', frameStyle: 'modern-lip', frameWidthMm: 4 },
  },
  {
    id: 'ornament',
    label: 'Ornament',
    blurb: '80 mm circle with a hanging hole at the top.',
    sizeMm: 80,
    square: true,
    solidBaseMm: 0.8,
    cad: { ...NO_EXTRAS, shape: 'circle', frameStyle: 'beveled', frameWidthMm: 3, keychainHole: true, keychainHoleDiameterMm: 4 },
  },
  {
    id: 'keychain',
    label: 'Keychain',
    blurb: '45 mm rounded tag with a key-ring hole and a strong base.',
    sizeMm: 45,
    square: false,
    solidBaseMm: 1.0,
    cad: { ...NO_EXTRAS, shape: 'rounded', frameStyle: 'beveled', frameWidthMm: 2.5, keychainHole: true, keychainHoleDiameterMm: 4 },
  },
  {
    id: 'magnet',
    label: 'Fridge magnet',
    blurb: '70 mm with one magnet in the middle, sized for your magnet.',
    sizeMm: 70,
    square: false,
    solidBaseMm: 0.48,
    cad: { ...NO_EXTRAS, shape: 'rounded', frameStyle: 'beveled', frameWidthMm: 3, magnetPockets: true, magnetStyle: 'pockets', magnetLayout: 'centre' },
  },
  {
    id: 'stand',
    label: 'Desk stand',
    blurb: '100 mm plaque and a stand that holds it at a slight lean. A phone can lean on it too.',
    sizeMm: 100,
    square: false,
    solidBaseMm: 0.8,
    cad: { ...NO_EXTRAS, shape: 'rounded', frameStyle: 'beveled', frameWidthMm: 3, deskStand: true },
  },
];

/** Print size for a template: the longest side becomes `sizeMm`, keeping the photo's shape. */
export function templateSize(t: PrintTemplate, aspect: number): { widthMm: number; heightMm: number } {
  if (t.square) return { widthMm: t.sizeMm, heightMm: t.sizeMm };
  const round = (v: number) => Math.round(v * 10) / 10;
  return aspect >= 1 ? { widthMm: t.sizeMm, heightMm: round(t.sizeMm / aspect) } : { widthMm: round(t.sizeMm * aspect), heightMm: t.sizeMm };
}

/** The largest centred square inside the current crop (so a circle print doesn't squash the photo). */
export function squareCrop(edit: PhotoEdit, srcW: number, srcH: number): PhotoEdit {
  const { width: W, height: H } = editSpaceSize(srcW, srcH, edit.rotate);
  const side = Math.min(edit.crop.w * W, edit.crop.h * H);
  const w = side / W;
  const h = side / H;
  return { ...edit, crop: { x: edit.crop.x + (edit.crop.w - w) / 2, y: edit.crop.y + (edit.crop.h - h) / 2, w, h } };
}

/** Desk stand dimensions (mm). */
export const STAND = { leanDeg: 12, clearanceMm: 0.4, depthMm: 46, baseMm: 6, holderMm: 16, wallMm: 4, slotFloorMm: 1.5 };

/**
 * The desk stand, printed on its side: its side view (the profile) lies on the bed and is lifted
 * straight up by `lengthMm`, so it needs no supports. A base, and a holder with a slot leaning back
 * by STAND.leanDeg that the print slides into; the slot fits a print `printThicknessMm` thick.
 */
export function buildDeskStandGrid(printThicknessMm: number, lengthMm: number): HeightmapGrid {
  const slot = printThicknessMm + STAND.clearanceMm;
  const lean = (STAND.leanDeg * Math.PI) / 180;
  const widthMm = STAND.depthMm; // front to back
  const heightMm = STAND.baseMm + STAND.holderMm; // bottom to top of the stand
  const step = 0.25;
  const cols = Math.round(widthMm / step) + 1;
  const rows = Math.round(heightMm / step) + 1;
  const topZ = new Float32Array(cols * rows).fill(-1);
  const bottomZ = new Float32Array(cols * rows);
  const normLum = new Float32Array(cols * rows);
  // The slot's centre line starts a little above the base, a third of the way back, and leans back
  const x0 = widthMm * 0.36;
  const y0 = STAND.baseMm + STAND.slotFloorMm;
  for (let r = 0; r < rows; r++) {
    const y = heightMm - r * step; // 0 = bottom of the stand
    for (let c = 0; c < cols; c++) {
      const x = c * step;
      // Distance across the leaning slot's centre line
      const across = (x - x0) * Math.cos(lean) - (y - y0) * Math.sin(lean);
      const inBase = y <= STAND.baseMm;
      const inHolder = y > STAND.baseMm && y <= heightMm && Math.abs(across) <= slot / 2 + STAND.wallMm;
      const inSlot = y >= y0 && Math.abs(across) <= slot / 2;
      if ((inBase || inHolder) && !inSlot) topZ[r * cols + c] = lengthMm;
    }
  }
  return { cols, rows, widthMm, heightMm, topZ, bottomZ, normLum };
}
