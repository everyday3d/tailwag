import { PrintPlan, planLayerRgb } from './printPlan';
import { encodePng } from '../utils/pngEncode';

export interface PlanPreview {
  width: number;
  height: number;
  /** RGBA, target on the left and the plan's predicted print on the right */
  data: Uint8ClampedArray;
  /** Size of each panel in pixels */
  panelWidth: number;
  panelHeight: number;
}

const BG = [18, 23, 34];

const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * Renders a side-by-side comparison from the PrintPlan: the target image (left) and the
 * simulated optical stacking result (right). The right panel uses exactly the layers the exports
 * contain, so it is a prediction of the print, not of the 3D viewport's lighting.
 *
 * The target is resampled to the plan grid with a box filter, then both panels are enlarged by the
 * same integer factor with nearest-neighbor so individual print columns stay visible.
 */
export function renderPlanComparison(
  plan: PrintPlan,
  target: { width: number; height: number; data: ArrayLike<number> },
  options: { maxPanelPx?: number; gapPx?: number } = {}
): PlanPreview {
  const { cols, rows } = plan;
  const maxPanel = options.maxPanelPx ?? 480;
  const gap = options.gapPx ?? 12;
  const scale = Math.max(1, Math.floor(maxPanel / Math.max(cols, rows)));
  const pw = cols * scale;
  const ph = rows * scale;
  const width = pw * 2 + gap;
  const height = ph;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = BG[0];
    out[i * 4 + 1] = BG[1];
    out[i * 4 + 2] = BG[2];
    out[i * 4 + 3] = 255;
  }

  // Resample target to the grid with a box filter
  const cell = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r / rows) * target.height);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) / rows) * target.height));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c / cols) * target.width);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) / cols) * target.width));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < target.height; y++) {
        for (let x = x0; x < x1 && x < target.width; x++) {
          const p = (y * target.width + x) * 4;
          sr += target.data[p];
          sg += target.data[p + 1];
          sb += target.data[p + 2];
          n++;
        }
      }
      const k = (r * cols + c) * 3;
      const d = Math.max(1, n);
      cell[k] = sr / d;
      cell[k + 1] = sg / d;
      cell[k + 2] = sb / d;
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const L = plan.layerGrid[idx];
      const masked = L <= 0;
      const k = idx * 3;
      const pred = masked ? null : planLayerRgb(plan, L);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const y = r * scale + dy;
          const xL = c * scale + dx;
          const xR = pw + gap + c * scale + dx;
          // Masked columns (outside the silhouette or through-holes) stay background on both sides
          if (!masked) {
            const pl = (y * width + xL) * 4;
            out[pl] = cell[k];
            out[pl + 1] = cell[k + 1];
            out[pl + 2] = cell[k + 2];
            const pr = (y * width + xR) * 4;
            out[pr] = to8(pred!.r);
            out[pr + 1] = to8(pred!.g);
            out[pr + 2] = to8(pred!.b);
          }
        }
      }
    }
  }

  return { width, height, data: out, panelWidth: pw, panelHeight: ph };
}

export function renderPlanComparisonPng(
  plan: PrintPlan,
  target: { width: number; height: number; data: ArrayLike<number> },
  options?: { maxPanelPx?: number; gapPx?: number }
): Uint8Array {
  const img = renderPlanComparison(plan, target, options);
  return encodePng(img.data, img.width, img.height);
}
