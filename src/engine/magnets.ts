/**
 * Magnet pockets in the back of the print, sized for the person's own magnets.
 *
 * The print is thin, so a pocket may only go into the solid base, and at least MAGNET_ROOF_MM of the
 * base filament stays over every magnet. That keeps the front's colours unchanged (the base layers
 * behind the colour stack are still there) and the roof solid. A magnet that is too thick for the
 * current Solid base is cut only as deep as allowed, and the panel says how thick the base must be.
 */

import type { HeightmapGrid } from './cadMeshBuilder';

export type MagnetLayout = 'corners' | 'top' | 'centre';

/** Press-fit clearance added to the magnet's size. */
export const MAGNET_CLEARANCE = { diameterMm: 0.3, depthMm: 0.2 };
/** Base filament kept over each magnet. */
export const MAGNET_ROOF_MM = 0.48;
export const MAGNET_DEFAULTS = { diameterMm: 8, thicknessMm: 1, layout: 'corners' as MagnetLayout };

export interface MagnetFit {
  /** Pocket diameter and depth actually cut (mm) */
  holeDiameterMm: number;
  depthMm: number;
  /** True when the whole magnet fits below the back surface */
  fits: boolean;
  /** Solid base needed for the magnet to fit (mm) */
  solidBaseNeededMm: number;
}

/** `solidBaseTopMm` is the height of the solid base's top (the lowest the relief ever goes). */
export function magnetFit(diameterMm: number, thicknessMm: number, solidBaseTopMm: number): MagnetFit {
  const wanted = thicknessMm + MAGNET_CLEARANCE.depthMm;
  const allowed = Math.max(0, solidBaseTopMm - MAGNET_ROOF_MM);
  return {
    holeDiameterMm: diameterMm + MAGNET_CLEARANCE.diameterMm,
    depthMm: Math.min(wanted, allowed),
    fits: wanted <= allowed + 1e-6,
    solidBaseNeededMm: wanted + MAGNET_ROOF_MM,
  };
}

const CUP_WALL_MM = 1.2;
const CUP_FLOOR_MM = 0.6;
const CUP_GAP_MM = 4;

/**
 * Glue-on magnet cups, printed separately, open side up: a ring the magnet pushes into on a thin floor.
 * The floor's underside is glued to the back of the print. One cup per magnet position, in a row.
 */
export function buildMagnetCupsGrid(diameterMm: number, thicknessMm: number, count: number): HeightmapGrid {
  const hole = diameterMm + MAGNET_CLEARANCE.diameterMm;
  const outer = hole + 2 * CUP_WALL_MM;
  const cupH = CUP_FLOOR_MM + thicknessMm + MAGNET_CLEARANCE.depthMm;
  const widthMm = count * outer + (count - 1) * CUP_GAP_MM + 2;
  const heightMm = outer + 2;
  const step = 0.2; // mm per cell, so small rings stay round
  const cols = Math.round(widthMm / step) + 1;
  const rows = Math.round(heightMm / step) + 1;
  const topZ = new Float32Array(cols * rows).fill(-1);
  const bottomZ = new Float32Array(cols * rows);
  const normLum = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y = heightMm / 2 - r * step;
    for (let c = 0; c < cols; c++) {
      const x = c * step - widthMm / 2;
      for (let k = 0; k < count; k++) {
        const cx = -widthMm / 2 + 1 + outer / 2 + k * (outer + CUP_GAP_MM);
        const d = Math.hypot(x - cx, y);
        if (d <= outer / 2) topZ[r * cols + c] = d <= hole / 2 ? CUP_FLOOR_MM : cupH;
      }
    }
  }
  return { cols, rows, widthMm, heightMm, topZ, bottomZ, normLum };
}

/** Pocket centres (mm, +Y up) for a layout on a print of this size. */
export function magnetCentres(layout: MagnetLayout, widthMm: number, heightMm: number, avoidCentre = false): Array<[number, number]> {
  const off = Math.min(widthMm, heightMm) / 2 * 0.55;
  switch (layout) {
    case 'centre':
      // A clock's shaft goes through the middle, so its single magnet moves up
      return [[0, avoidCentre ? off : 0]];
    case 'top':
      return [
        [-off, off],
        [off, off],
      ];
    case 'corners':
    default:
      return [
        [-off, -off],
        [off, -off],
        [-off, off],
        [off, off],
      ];
  }
}
