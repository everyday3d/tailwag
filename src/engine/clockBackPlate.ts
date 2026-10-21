import { BACK_PLATE_DEFAULTS, evaluateShapeMask, type CadCutoutConfig, type HeightmapGrid } from './cadMeshBuilder';

/**
 * Back plate for a clock with cut-through numerals: a separate, single-colour print.
 *
 * It prints face down: the flat face on the bed is what shows through the numerals. On top (the side
 * facing the wall) a square rim holds a standard quartz movement so it cannot turn. The movement's
 * shaft goes through the plate and the clock face, and its nut clamps the three together.
 */

/** Standard quartz clock movements are 56 x 56 mm. */
export const MOVEMENT_SIZE_MM = 56;
const MOVEMENT_CLEARANCE_MM = 0.6;
const RIM_WALL_MM = 2.4;
/** Tall enough to hold the movement firmly, short enough to leave its battery door and knob clear. */
export const RIM_HEIGHT_MM = 10;
/** The plate is this much smaller than the face all round, so its edge stays hidden. */
const EDGE_INSET_MM = 0.5;

/** Standard quartz movements stand about 16 mm off the plate; the hanger post matches, so both rest on the wall. */
export const MOVEMENT_DEPTH_MM = 16;

/**
 * Keyhole hanger for a screw in the wall (head up to about 9 mm across, shank up to 4.5 mm), on a post
 * as tall as the movement so the clock hangs straight. The head goes in through the round hole, then
 * the clock drops so the shank slides up the slot and the head is caught under a thin lip at the wall
 * end of the post. Under the lip the post is hollow down to the plate's front face, which the clock
 * face covers; printed face down, the lip is a short bridge.
 */
const KEYHOLE = { entryMm: 10, slotMm: 5, channelMm: 10, travelMm: 12, bossW: 22, bossH: 34 };
export const KEYHOLE_LIP_MM = 2.5;

export interface KeyholePlacement {
  /** Centre of the round entry hole (mm, +Y up) */
  entryY: number;
  /** False when the clock is too small to fit it between the movement and the numerals */
  fits: boolean;
}

/** Above the movement rim and below the numerals, so it never shows through a cut "12". */
export function keyholePlacement(widthMm: number, heightMm: number): KeyholePlacement {
  const radius = Math.min(widthMm, heightMm) / 2;
  const rimTop = MOVEMENT_SIZE_MM / 2 + MOVEMENT_CLEARANCE_MM / 2 + RIM_WALL_MM;
  const numeralsBottom = radius * 0.66;
  const room = numeralsBottom - rimTop;
  const bossBottom = rimTop + Math.max(2, (room - KEYHOLE.bossH) / 2);
  return { entryY: bossBottom + 4 + KEYHOLE.entryMm / 2, fits: room >= KEYHOLE.bossH + 2 };
}

export function backPlateThickness(cad: CadCutoutConfig): number {
  return Math.min(6, Math.max(1, cad.backPlateThicknessMm ?? BACK_PLATE_DEFAULTS.thicknessMm));
}

export function buildClockBackPlateGrid(widthMm: number, heightMm: number, cad: CadCutoutConfig, gridRes: number): HeightmapGrid {
  const aspect = widthMm / Math.max(1, heightMm);
  const cols = aspect >= 1 ? gridRes : Math.max(32, Math.round(gridRes * aspect));
  const rows = aspect >= 1 ? Math.max(32, Math.round(gridRes / aspect)) : gridRes;
  const topZ = new Float32Array(cols * rows);
  const bottomZ = new Float32Array(cols * rows);
  const normLum = new Float32Array(cols * rows);

  const plate = backPlateThickness(cad);
  const shape = cad.shape === 'subject' ? 'rect' : cad.shape;
  const inset = (EDGE_INSET_MM * 2) / Math.max(widthMm, heightMm);
  const inner = MOVEMENT_SIZE_MM / 2 + MOVEMENT_CLEARANCE_MM / 2;
  const outer = inner + RIM_WALL_MM;
  const { entryY } = keyholePlacement(widthMm, heightMm);
  const bossY0 = entryY - KEYHOLE.entryMm / 2 - 4;
  const bossY1 = bossY0 + KEYHOLE.bossH;

  for (let r = 0; r < rows; r++) {
    const ny = (r / (rows - 1)) * 2 - 1;
    const yMm = -ny * (heightMm / 2);
    for (let c = 0; c < cols; c++) {
      const nx = (c / (cols - 1)) * 2 - 1;
      const xMm = nx * (widthMm / 2);
      const idx = r * cols + c;
      const m = evaluateShapeMask(nx, ny, shape);
      const shaftHole = Math.hypot(xMm, yMm) <= cad.clockShaftDiameterMm / 2;
      if (!m.inside || m.edgeDist < inset || shaftHole) {
        topZ[idx] = -1;
        continue;
      }
      const ax = Math.abs(xMm);
      const ay = Math.abs(yMm);
      const onRim = Math.max(ax, ay) <= outer && Math.max(ax, ay) > inner;
      topZ[idx] = onRim ? plate + RIM_HEIGHT_MM : plate;
      normLum[idx] = 1;

      // Keyhole hanger: a post as tall as the movement, with the entry hole, the slot and the head channel
      if (ax <= KEYHOLE.bossW / 2 && yMm >= bossY0 && yMm <= bossY1) {
        const postTop = plate + MOVEMENT_DEPTH_MM;
        topZ[idx] = postTop;
        const dy = yMm - entryY;
        const inEntry = Math.hypot(xMm, dy) <= KEYHOLE.entryMm / 2;
        const inSlot = ax <= KEYHOLE.slotMm / 2 && dy >= 0 && dy <= KEYHOLE.travelMm;
        const inChannel =
          (ax <= KEYHOLE.channelMm / 2 && dy >= 0 && dy <= KEYHOLE.travelMm) || Math.hypot(xMm, dy - KEYHOLE.travelMm) <= KEYHOLE.channelMm / 2;
        if (inEntry || inSlot) topZ[idx] = -1;
        else if (inChannel) bottomZ[idx] = postTop - KEYHOLE_LIP_MM;
      }
    }
  }
  return { cols, rows, widthMm, heightMm, topZ, bottomZ, normLum };
}
