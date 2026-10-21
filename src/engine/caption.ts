/**
 * Name plates and captions: raised text on the print ("Tucker", "2019 – 2026").
 *
 * 'plate'  : a flat bar along the bottom (or top) edge, printed at the solid-base height in the first
 *            filament, with the letters raised to the top in the last filament, like a memorial plaque.
 * 'photo'  : the letters are raised straight on the picture, with a thin base-height outline around
 *            them so they stay readable on a busy photo.
 *
 * The layout is plain geometry (testable); the letter shapes are drawn on a canvas at grid resolution.
 */

import { fontSpec, type PrintFont } from './printFonts';

export type CaptionStyle = 'plate' | 'photo';
export type CaptionPosition = 'bottom' | 'top';
export type CaptionSize = 'small' | 'medium' | 'large';

export interface CaptionConfig {
  captionFont?: PrintFont;
  captionText?: string;
  captionLine2?: string;
  captionStyle?: CaptionStyle;
  captionPosition?: CaptionPosition;
  captionSize?: CaptionSize;
}

export const CAPTION_DEFAULTS = { style: 'plate' as CaptionStyle, position: 'bottom' as CaptionPosition, size: 'medium' as CaptionSize };
export const CAPTION_MAX_CHARS = 40;

/** Letter (capital) height as a share of the print's shorter side. */
const SIZE_SHARE: Record<CaptionSize, number> = { small: 0.05, medium: 0.07, large: 0.1 };
/** Below this a nozzle cannot draw letters cleanly. */
export const CAPTION_MIN_LETTER_MM = 5;
const LINE2_SCALE = 0.6;

export interface CaptionLayout {
  style: CaptionStyle;
  position: CaptionPosition;
  lines: string[];
  /** Capital-letter height of each line (mm), before any shrinking to fit the width */
  letterMm: number[];
  /** Vertical centre of each line, in print coordinates (mm, +Y is the top edge) */
  centerYMm: number[];
  /** Widest a line may be (mm) */
  maxWidthMm: number;
  /** The plate bar's lower and upper edge (mm, +Y up); null for the 'photo' style */
  band: { y0: number; y1: number; radiusMm: number } | null;
}

export function captionLines(c: CaptionConfig): string[] {
  const clean = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, CAPTION_MAX_CHARS);
  const first = clean(c.captionText);
  if (!first) return [];
  const second = clean(c.captionLine2);
  return second ? [first, second] : [first];
}

/**
 * Where the caption goes. `insetMm` is the frame width when a frame runs along the edge,
 * so the text sits inside it.
 */
export function layoutCaption(c: CaptionConfig, widthMm: number, heightMm: number, insetMm: number): CaptionLayout | null {
  const lines = captionLines(c);
  if (lines.length === 0) return null;
  const style = c.captionStyle ?? CAPTION_DEFAULTS.style;
  const position = c.captionPosition ?? CAPTION_DEFAULTS.position;
  const size = c.captionSize ?? CAPTION_DEFAULTS.size;

  const l1 = Math.max(CAPTION_MIN_LETTER_MM, Math.min(widthMm, heightMm) * SIZE_SHARE[size]);
  const letterMm = lines.length === 2 ? [l1, Math.max(CAPTION_MIN_LETTER_MM * 0.8, l1 * LINE2_SCALE)] : [l1];
  const gap = lines.length === 2 ? l1 * 0.45 : 0;
  const pad = l1 * 0.55;
  const blockH = letterMm.reduce((a, b) => a + b, 0) + gap;
  const inner = blockH + 2 * pad;

  // Distance from the chosen edge: the frame first, then the plate's padding
  const edge = position === 'bottom' ? -heightMm / 2 : heightMm / 2;
  const dir = position === 'bottom' ? 1 : -1; // towards the middle of the print
  const blockStart = edge + dir * (insetMm + pad);

  // Lines run top to bottom in reading order whichever edge the plate is on
  const topOfBlock = position === 'bottom' ? blockStart + blockH : blockStart;
  const centerYMm = [topOfBlock - letterMm[0] / 2];
  if (lines.length === 2) centerYMm.push(topOfBlock - letterMm[0] - gap - letterMm[1] / 2);

  const bandFar = edge + dir * (insetMm + inner);
  const band =
    style === 'plate'
      ? { y0: Math.min(edge, bandFar), y1: Math.max(edge, bandFar), radiusMm: Math.min(inner * 0.35, 8) }
      : null;

  return { style, position, lines, letterMm, centerYMm, maxWidthMm: Math.max(10, widthMm - 2 * insetMm - 2 * pad), band };
}

/**
 * Signed distance (mm, positive inside) to the plate bar: a rounded rectangle across the full width.
 * Rounding applies only to the corners on the inner side, so the bar meets the print's edge squarely.
 */
export function plateDistanceMm(
  layout: CaptionLayout,
  xMm: number,
  yMm: number,
  widthMm: number
): number {
  if (!layout.band) return -Infinity;
  const { y0, y1, radiusMm } = layout.band;
  const halfW = widthMm / 2;
  const dx = halfW - Math.abs(xMm);
  const dy = Math.min(yMm - y0, y1 - yMm);
  if (dx < 0 || dy < 0) return Math.max(-Math.hypot(Math.min(dx, 0), Math.min(dy, 0)), Math.min(dx, dy));
  // Round the two corners away from the print's edge
  const innerY = layout.position === 'bottom' ? y1 : y0;
  const cornerX = halfW - radiusMm;
  const cornerY = layout.position === 'bottom' ? innerY - radiusMm : innerY + radiusMm;
  const inCornerZone = Math.abs(xMm) > cornerX && (layout.position === 'bottom' ? yMm > cornerY : yMm < cornerY);
  if (inCornerZone) return radiusMm - Math.hypot(Math.abs(xMm) - cornerX, yMm - cornerY);
  return Math.min(dx, dy);
}

export interface CaptionMasks {
  layout: CaptionLayout;
  /** 1 where a letter is raised */
  letters: Uint8Array;
  /** 1 where the flat plate (or the outline around letters on the photo) sits at base height */
  backing: Uint8Array;
  /** Plate distance per cell (mm, positive inside); null for the 'photo' style */
  plateDist: Float32Array | null;
  /** True when the text had to shrink to fit and is now under the size a nozzle draws cleanly */
  tooSmall: boolean;
}

/** Draws the letters at grid resolution. Returns null without a caption or without a canvas (tests, MCP). */
export function renderCaptionMasks(
  c: CaptionConfig,
  cols: number,
  rows: number,
  widthMm: number,
  heightMm: number,
  insetMm: number
): CaptionMasks | null {
  const layout = layoutCaption(c, widthMm, heightMm, insetMm);
  if (!layout || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const pxPerMmX = (cols - 1) / widthMm;
  const pxPerMmY = (rows - 1) / heightMm;
  const toPx = (yMm: number) => (heightMm / 2 - yMm) * pxPerMmY;
  const font = (px: number) => fontSpec(c.captionFont, px);

  // Find the font size whose capital height matches the wanted letter height, then shrink to fit
  const fontFor = (letterMm: number) => {
    ctx.font = font(100);
    const capPx = ctx.measureText('H').actualBoundingBoxAscent || 72;
    return (letterMm * pxPerMmY * 100) / capPx;
  };
  const sizes = layout.letterMm.map(fontFor);
  let scale = 1;
  layout.lines.forEach((line, i) => {
    ctx.font = font(sizes[i]);
    const w = ctx.measureText(line).width / pxPerMmX;
    if (w > layout.maxWidthMm) scale = Math.min(scale, layout.maxWidthMm / w);
  });

  const draw = (stroke: number) => {
    ctx.clearRect(0, 0, cols, rows);
    ctx.fillStyle = ctx.strokeStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    layout.lines.forEach((line, i) => {
      const px = sizes[i] * scale;
      ctx.font = font(px);
      const cap = layout.letterMm[i] * scale * pxPerMmY;
      const baseline = toPx(layout.centerYMm[i]) + cap / 2;
      ctx.fillText(line, (cols - 1) / 2, baseline);
      if (stroke > 0) {
        ctx.lineWidth = stroke;
        ctx.strokeText(line, (cols - 1) / 2, baseline);
      }
    });
    const data = ctx.getImageData(0, 0, cols, rows).data;
    const out = new Uint8Array(cols * rows);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] > 110 ? 1 : 0;
    return out;
  };

  const letters = draw(0);
  let backing: Uint8Array;
  let plateDist: Float32Array | null = null;
  if (layout.band) {
    backing = new Uint8Array(cols * rows);
    plateDist = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const yMm = heightMm / 2 - (r / (rows - 1)) * heightMm;
      for (let col = 0; col < cols; col++) {
        const xMm = (col / (cols - 1)) * widthMm - widthMm / 2;
        const d = plateDistanceMm(layout, xMm, yMm, widthMm);
        plateDist[r * cols + col] = d;
        if (d >= 0) backing[r * cols + col] = 1;
      }
    }
  } else {
    // Outline around the letters: about 1.2 mm, never thinner than two grid cells
    const outlinePx = Math.max(2, 1.2 * pxPerMmX) * 2;
    backing = draw(outlinePx);
  }

  const tooSmall = layout.letterMm[layout.letterMm.length - 1] * scale < CAPTION_MIN_LETTER_MM * 0.8;
  return { layout, letters, backing, plateDist, tooSmall };
}
