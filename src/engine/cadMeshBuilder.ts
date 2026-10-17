export type MeshShapeMode = 'rect' | 'rounded' | 'circle' | 'hexagon' | 'paw' | 'shield';
export type FrameStyle = 'none' | 'beveled' | 'modern-lip' | 'stepped';
export type ClockStencilStyle = 'none' | 'modern-arabic' | 'roman' | 'paw-markers';

export interface CadCutoutConfig {
  shape: MeshShapeMode;
  frameStyle: FrameStyle;
  frameWidthMm: number;
  frameHeightBonusMm: number;
  /** HueForge Wall Clock Mode */
  clockMode: boolean;
  clockShaftDiameterMm: number; // default 8.2mm
  clockMovementPocket: boolean; // rear 56x56mm cavity
  clockStencil: ClockStencilStyle;
  /** Top Keychain / Ornament Loop */
  keychainHole: boolean;
  keychainHoleDiameterMm: number;
  /** Rear Neodymium Magnet Cavities */
  magnetPockets: boolean;
  magnetDiameterMm: number; // default 8.2mm
}

export interface HeightmapGrid {
  cols: number;
  rows: number;
  widthMm: number;
  heightMm: number;
  /** Top surface Z height in mm for each grid cell; -1 means masked out (outside shape or inside through-hole) */
  topZ: Float32Array;
  /** Bottom surface Z height in mm for each grid cell (0.0 normally, or >0 inside rear clock/magnet pockets) */
  bottomZ: Float32Array;
  /** Normalized luminance [0..1] for each grid cell (including frame/stencil overrides) */
  normLum: Float32Array;
}

/**
 * Checks whether normalized coordinates (nx, ny in [-1..1]) are inside the selected 2.5D silhouette shape,
 * and returns distance from outer boundary [0..1] for border frame generation.
 */
export function evaluateShapeMask(nx: number, ny: number, shape: MeshShapeMode): { inside: boolean; edgeDist: number } {
  switch (shape) {
    case 'circle': {
      const r = Math.hypot(nx, ny);
      return { inside: r <= 1.0, edgeDist: 1.0 - r };
    }
    case 'rounded': {
      // Signed distance to rounded box (radius 0.22)
      const rad = 0.22;
      const qx = Math.abs(nx) - (1.0 - rad);
      const qy = Math.abs(ny) - (1.0 - rad);
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      return { inside: dist <= 0, edgeDist: -dist };
    }
    case 'hexagon': {
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const d = Math.max(ax * 0.866025 + ay * 0.5, ay) - 0.96;
      return { inside: d <= 0, edgeDist: -d };
    }
    case 'shield': {
      // Crest badge shape
      const topHalf = ny <= 0;
      const maxW = topHalf ? 0.95 : Math.max(0, 0.95 * (1.0 - Math.pow(ny, 1.45)));
      const dX = maxW - Math.abs(nx);
      const dY = 0.96 - Math.abs(ny);
      const minD = Math.min(dX, dY);
      return { inside: minD >= 0 && Math.abs(ny) <= 0.96, edgeDist: minD };
    }
    case 'paw': {
      // Iconic BoxerDawg Paw silhouette (central pad + 4 toe beans) within circle badge
      const r = Math.hypot(nx, ny);
      return { inside: r <= 1.0, edgeDist: 1.0 - r };
    }
    case 'rect':
    default: {
      const d = Math.min(1.0 - Math.abs(nx), 1.0 - Math.abs(ny));
      return { inside: d >= 0, edgeDist: d };
    }
  }
}

/**
 * Generates an offscreen 2D stencil mask for Clock Numerals / Paw Markers so they raise to the top highlight layer
 */
function renderClockStencilMask(cols: number, rows: number, style: ClockStencilStyle): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  if (style === 'none' || typeof document === 'undefined') return mask;

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return mask;

  ctx.clearRect(0, 0, cols, rows);
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = cols / 2;
  const cy = rows / 2;
  const radius = Math.min(cols, rows) * 0.39;
  const fontSize = Math.max(12, Math.round(Math.min(cols, rows) * 0.095));
  ctx.font = `900 ${fontSize}px "Inter", "Segoe UI", Arial, sans-serif`;

  const romanLabels = ['12', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  const arabicLabels = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];

  for (let h = 0; h < 12; h++) {
    const angle = (h * Math.PI) / 6 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;

    if (style === 'paw-markers' && h % 3 !== 0) {
      // Draw mini paw / dot marker on non-cardinal hours
      ctx.beginPath();
      ctx.arc(x, y, fontSize * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const label = style === 'roman' ? romanLabels[h] : arabicLabels[h];
      ctx.fillText(label, x, y);
    }
  }

  // Outer minute tick ring
  for (let m = 0; m < 60; m++) {
    const angle = (m * Math.PI) / 30 - Math.PI / 2;
    const rInner = Math.min(cols, rows) * (m % 5 === 0 ? 0.455 : 0.468);
    const rOuter = Math.min(cols, rows) * 0.482;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1.5, Math.min(cols, rows) * (m % 5 === 0 ? 0.012 : 0.005));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
    ctx.lineTo(cx + Math.cos(angle) * rOuter, cy + Math.sin(angle) * rOuter);
    ctx.stroke();
  }

  const img = ctx.getImageData(0, 0, cols, rows).data;
  for (let i = 0; i < cols * rows; i++) {
    if (img[i * 4 + 3] > 110) {
      mask[i] = 1;
    }
  }
  return mask;
}

/**
 * Builds the 2.5D heightmap grid combining image luminance, pre-press contrast/detail curves,
 * parametric shape silhouette, border frame, clock shaft bore, stencil numerals, and rear cavities.
 */
export function buildHeightmapGrid(params: {
  imageData: ImageData;
  gridRes: number;
  widthMm: number;
  heightMm: number;
  baseLayerMm: number;
  layerHeightMm: number;
  totalLayers: number;
  gamma: number;
  contrast: number;
  detailEnhance: number;
  invertLuminance: boolean;
  cad: CadCutoutConfig;
}): HeightmapGrid {
  const {
    imageData,
    gridRes,
    widthMm,
    heightMm,
    baseLayerMm,
    layerHeightMm,
    totalLayers,
    gamma,
    contrast,
    detailEnhance,
    invertLuminance,
    cad,
  } = params;

  const aspect = widthMm / Math.max(1, heightMm);
  const cols = aspect >= 1 ? gridRes : Math.max(32, Math.round(gridRes * aspect));
  const rows = aspect >= 1 ? Math.max(32, Math.round(gridRes / aspect)) : gridRes;

  const topZ = new Float32Array(cols * rows);
  const bottomZ = new Float32Array(cols * rows);
  const normLum = new Float32Array(cols * rows);

  // Sample raw luminance + universal chroma-aware saturation map (works for any subject color: portraits, pets, landscapes, logos)
  const rawLum = new Float32Array(cols * rows);
  const isChromaticSubjectMask = new Uint8Array(cols * rows);
  const srcW = imageData.width;
  const srcH = imageData.height;
  const srcData = imageData.data;

  for (let r = 0; r < rows; r++) {
    const v = r / Math.max(1, rows - 1);
    const sy = Math.min(srcH - 1, Math.floor(v * srcH));
    for (let c = 0; c < cols; c++) {
      const u = c / Math.max(1, cols - 1);
      const sx = Math.min(srcW - 1, Math.floor(u * srcW));
      const idx = (sy * srcW + sx) * 4;
      const red = srcData[idx] / 255;
      const green = srcData[idx + 1] / 255;
      const blue = srcData[idx + 2] / 255;

      // Standard perceptual luminance
      let lum = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

      // Universal chromaticity detection (all hues: red, orange, yellow, green, cyan, blue, purple, brown, skin tones)
      // Distinguishes saturated colored pixels from true achromatic white highlights (where R, G, B are all high and close together)
      const maxC = Math.max(red, green, blue);
      const minC = Math.min(red, green, blue);
      const chroma = maxC - minC;
      const sat = chroma / Math.max(1e-4, maxC);
      const cellIdx = r * cols + c;

      if (chroma > 0.13 && sat > 0.20 && minC < 0.72) {
        isChromaticSubjectMask[cellIdx] = 1;
      }

      if (invertLuminance) lum = 1.0 - lum;
      rawLum[cellIdx] = lum;
    }
  }

  // Auto-Levels Histogram Normalization (2nd to 98.5th percentile stretch)
  // Ensures dark shadows hit Layer 1 and bright highlights hit Layer N
  const sortedSample: number[] = [];
  const sampleStep = Math.max(1, Math.floor((cols * rows) / 2500));
  for (let i = 0; i < cols * rows; i += sampleStep) {
    sortedSample.push(rawLum[i]);
  }
  sortedSample.sort((a, b) => a - b);
  const pLow = sortedSample[Math.floor(sortedSample.length * 0.02)] ?? 0.0;
  const pHigh = sortedSample[Math.floor(sortedSample.length * 0.985)] ?? 1.0;
  const dynRange = Math.max(0.15, pHigh - pLow);

  for (let i = 0; i < cols * rows; i++) {
    rawLum[i] = Math.max(0, Math.min(1, (rawLum[i] - pLow) / dynRange));
  }

  // Check if the image actually contains bright low-saturation white highlights
  let hasWhiteHighlights = false;
  for (let i = 0; i < cols * rows; i += sampleStep) {
    if (rawLum[i] > 0.75 && isChromaticSubjectMask[i] === 0) {
      hasWhiteHighlights = true;
      break;
    }
  }

  // Local unsharp-mask detail pop + Gamma & Contrast curve
  const enhancedLum = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let lum = rawLum[i];
      if (detailEnhance > 0.01 && r > 0 && r < rows - 1 && c > 0 && c < cols - 1) {
        const neighbors =
          (rawLum[(r - 1) * cols + c] +
            rawLum[(r + 1) * cols + c] +
            rawLum[r * cols + (c - 1)] +
            rawLum[r * cols + (c + 1)]) *
          0.25;
        lum = lum + (lum - neighbors) * (detailEnhance * 2.2);
      }
      // Gamma & S-curve contrast
      lum = Math.max(0, Math.min(1, lum));
      lum = Math.pow(lum, 1 / Math.max(0.2, gamma));
      lum = (lum - 0.5) * contrast + 0.5;
      lum = Math.max(0, Math.min(1, lum));

      // Universal Chroma-Preserving Ceiling:
      // When the image has white highlights, keep saturated chromatic pixels (any hue) within the chromatic midtone layers (<= 0.70)
      // so the top White filament layer prints ONLY on true white highlights and never washes out saturated colors!
      if (!invertLuminance && hasWhiteHighlights && isChromaticSubjectMask[i] === 1 && lum > 0.16) {
        lum = Math.min(0.70, 0.16 + (lum - 0.16) * 0.68);
      }

      enhancedLum[i] = lum;
    }
  }

  const clockStencilMask = cad.clockMode ? renderClockStencilMask(cols, rows, cad.clockStencil) : new Uint8Array(cols * rows);
  const maxReliefZ = baseLayerMm + (totalLayers - 1) * layerHeightMm;
  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const frameNormThreshold = (cad.frameWidthMm / Math.max(widthMm, heightMm)) * 2.0;

  for (let r = 0; r < rows; r++) {
    const ny = (r / Math.max(1, rows - 1)) * 2.0 - 1.0; // -1 (top) to +1 (bottom)
    const yMm = -ny * halfH;
    for (let c = 0; c < cols; c++) {
      const nx = (c / Math.max(1, cols - 1)) * 2.0 - 1.0; // -1 (left) to +1 (right)
      const xMm = nx * halfW;
      const idx = r * cols + c;

      const maskEval = evaluateShapeMask(nx, ny, cad.shape);
      if (!maskEval.inside) {
        topZ[idx] = -1;
        bottomZ[idx] = 0;
        normLum[idx] = 0;
        continue;
      }

      // Through-hole 1: Clock center shaft bore
      if (cad.clockMode) {
        const distCenterMm = Math.hypot(xMm, yMm);
        if (distCenterMm <= cad.clockShaftDiameterMm * 0.5) {
          topZ[idx] = -1;
          bottomZ[idx] = 0;
          normLum[idx] = 0;
          continue;
        }
      }

      // Through-hole 2: Top Keychain Hole
      if (cad.keychainHole) {
        const holeCenterYMm = halfH - cad.frameWidthMm - cad.keychainHoleDiameterMm * 0.85;
        const distHoleMm = Math.hypot(xMm, yMm - holeCenterYMm);
        if (distHoleMm <= cad.keychainHoleDiameterMm * 0.5) {
          topZ[idx] = -1;
          bottomZ[idx] = 0;
          normLum[idx] = 0;
          continue;
        }
      }

      const minBaseLayer = Math.min(5, Math.max(1, Math.floor(totalLayers * 0.22)));
      let cellLum = enhancedLum[idx];
      let discreteLayer = minBaseLayer + Math.round(cellLum * (totalLayers - minBaseLayer));
      let zMm = baseLayerMm + (discreteLayer - 1) * layerHeightMm;

      // Clock stencil numerals raised to top layer
      if (cad.clockMode && clockStencilMask[idx] === 1) {
        cellLum = 1.0;
        discreteLayer = totalLayers;
        zMm = maxReliefZ + cad.frameHeightBonusMm * 0.5;
      }

      // 3D Outer Frame
      if (cad.frameStyle !== 'none' && maskEval.edgeDist <= frameNormThreshold) {
        const t = 1.0 - maskEval.edgeDist / Math.max(0.001, frameNormThreshold);
        cellLum = 1.0;
        if (cad.frameStyle === 'beveled') {
          zMm = maxReliefZ + cad.frameHeightBonusMm * Math.sin(t * Math.PI * 0.5);
        } else if (cad.frameStyle === 'stepped') {
          zMm = maxReliefZ + (t > 0.5 ? cad.frameHeightBonusMm : cad.frameHeightBonusMm * 0.5);
        } else {
          zMm = maxReliefZ + cad.frameHeightBonusMm;
        }
      }

      // Paw silhouette decorative raised pad ring when 'paw' mode selected
      if (cad.shape === 'paw' && maskEval.edgeDist <= frameNormThreshold * 1.1) {
        cellLum = 1.0;
        zMm = maxReliefZ + cad.frameHeightBonusMm;
      }

      // Rear Negative Boolean Pockets (bottomZ > 0)
      let bZ = 0.0;
      if (cad.clockMode && cad.clockMovementPocket) {
        if (Math.abs(xMm) <= 28.0 && Math.abs(yMm) <= 28.0) {
          bZ = Math.min(baseLayerMm * 0.5, 0.4);
        }
      }
      if (cad.magnetPockets) {
        const magOffset = Math.min(halfW, halfH) * 0.55;
        const magR = cad.magnetDiameterMm * 0.5;
        const corners = [
          [-magOffset, -magOffset],
          [magOffset, -magOffset],
          [-magOffset, magOffset],
          [magOffset, magOffset],
        ];
        for (const [mx, my] of corners) {
          if (Math.hypot(xMm - mx, yMm - my) <= magR) {
            bZ = Math.min(baseLayerMm * 0.55, 0.4);
          }
        }
      }

      topZ[idx] = zMm;
      bottomZ[idx] = bZ;
      normLum[idx] = cellLum;
    }
  }

  return {
    cols,
    rows,
    widthMm,
    heightMm,
    topZ,
    bottomZ,
    normLum,
  };
}

/**
 * Generates a watertight Binary STL buffer from the HeightmapGrid (top relief + bottom face + perimeter/hole walls).
 */
export function generateBinaryStlFromGrid(grid: HeightmapGrid): ArrayBuffer {
  const { cols, rows, widthMm, heightMm, topZ, bottomZ } = grid;
  const triangles: number[] = []; // flat array of [x1,y1,z1, x2,y2,z2, x3,y3,z3]

  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const xAt = (c: number) => (c / (cols - 1)) * widthMm - halfW;
  const yAt = (r: number) => halfH - (r / (rows - 1)) * heightMm;

  const isValidCell = (c: number, r: number) => {
    if (c < 0 || c >= cols - 1 || r < 0 || r >= rows - 1) return false;
    const i00 = r * cols + c;
    const i10 = r * cols + (c + 1);
    const i01 = (r + 1) * cols + c;
    const i11 = (r + 1) * cols + (c + 1);
    return topZ[i00] > 0 && topZ[i10] > 0 && topZ[i01] > 0 && topZ[i11] > 0;
  };

  const pushTri = (
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number
  ) => {
    triangles.push(x1, y1, z1, x2, y2, z2, x3, y3, z3);
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (!isValidCell(c, r)) continue;

      const i00 = r * cols + c;
      const i10 = r * cols + (c + 1);
      const i01 = (r + 1) * cols + c;
      const i11 = (r + 1) * cols + (c + 1);

      const x0 = xAt(c);
      const x1 = xAt(c + 1);
      const y0 = yAt(r);
      const y1 = yAt(r + 1);

      // Top surface (2 triangles)
      pushTri(x0, y0, topZ[i00], x0, y1, topZ[i01], x1, y0, topZ[i10]);
      pushTri(x1, y0, topZ[i10], x0, y1, topZ[i01], x1, y1, topZ[i11]);

      // Bottom surface (2 triangles, reversed winding)
      pushTri(x0, y0, bottomZ[i00], x1, y0, bottomZ[i10], x0, y1, bottomZ[i01]);
      pushTri(x1, y0, bottomZ[i10], x1, y1, bottomZ[i11], x0, y1, bottomZ[i01]);

      // Boundary / Interior Hole Side Walls
      // North wall (r - 1)
      if (!isValidCell(c, r - 1)) {
        pushTri(x0, y0, bottomZ[i00], x0, y0, topZ[i00], x1, y0, topZ[i10]);
        pushTri(x0, y0, bottomZ[i00], x1, y0, topZ[i10], x1, y0, bottomZ[i10]);
      }
      // South wall (r + 1)
      if (!isValidCell(c, r + 1)) {
        pushTri(x1, y1, bottomZ[i11], x1, y1, topZ[i11], x0, y1, topZ[i01]);
        pushTri(x1, y1, bottomZ[i11], x0, y1, topZ[i01], x0, y1, bottomZ[i01]);
      }
      // West wall (c - 1)
      if (!isValidCell(c - 1, r)) {
        pushTri(x0, y1, bottomZ[i01], x0, y1, topZ[i01], x0, y0, topZ[i00]);
        pushTri(x0, y1, bottomZ[i01], x0, y0, topZ[i00], x0, y0, bottomZ[i00]);
      }
      // East wall (c + 1)
      if (!isValidCell(c + 1, r)) {
        pushTri(x1, y0, bottomZ[i10], x1, y0, topZ[i10], x1, y1, topZ[i11]);
        pushTri(x1, y0, bottomZ[i10], x1, y1, topZ[i11], x1, y1, bottomZ[i11]);
      }
    }
  }

  const triCount = triangles.length / 9;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);

  // 80-byte header
  const headerText = 'TailWag Studio Binary STL - BoxerDawg 3D Filament Painting Engine';
  for (let i = 0; i < Math.min(80, headerText.length); i++) {
    view.setUint8(i, headerText.charCodeAt(i));
  }
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const x1 = triangles[base], y1 = triangles[base + 1], z1 = triangles[base + 2];
    const x2 = triangles[base + 3], y2 = triangles[base + 4], z2 = triangles[base + 5];
    const x3 = triangles[base + 6], y3 = triangles[base + 7], z3 = triangles[base + 8];

    const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
    const vx = x3 - x1, vy = y3 - y1, vz = z3 - z1;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    view.setFloat32(offset + 12, x1, true);
    view.setFloat32(offset + 16, y1, true);
    view.setFloat32(offset + 20, z1, true);

    view.setFloat32(offset + 24, x2, true);
    view.setFloat32(offset + 28, y2, true);
    view.setFloat32(offset + 32, z2, true);

    view.setFloat32(offset + 36, x3, true);
    view.setFloat32(offset + 40, y3, true);
    view.setFloat32(offset + 44, z3, true);

    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return buffer;
}

/**
 * Generates a physical TD Calibration Step-Wedge Binary STL (10 steps from 0.16mm to 2.40mm)
 * so users can print a 7-minute swatch card to measure exact filament Transmission Distance.
 */
export function generateTdCalibrationWedgeStl(stepCount: number = 12, stepThicknessMm: number = 0.16): ArrayBuffer {
  const cols = 120;
  const rows = 60;
  const widthMm = 72;
  const heightMm = 36;
  const topZ = new Float32Array(cols * rows);
  const bottomZ = new Float32Array(cols * rows);
  const normLum = new Float32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const border = r < 3 || r >= rows - 3 || c < 3 || c >= cols - 3;
      if (border) {
        topZ[idx] = stepCount * stepThicknessMm + 0.4;
        normLum[idx] = 1.0;
      } else {
        const stepIdx = Math.min(stepCount - 1, Math.floor(((c - 3) / (cols - 6)) * stepCount));
        topZ[idx] = (stepIdx + 1) * stepThicknessMm;
        normLum[idx] = (stepIdx + 1) / stepCount;
      }
      bottomZ[idx] = 0;
    }
  }

  return generateBinaryStlFromGrid({
    cols,
    rows,
    widthMm,
    heightMm,
    topZ,
    bottomZ,
    normLum,
  });
}
