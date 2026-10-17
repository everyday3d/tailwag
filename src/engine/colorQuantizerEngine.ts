import { FilamentSpool } from '../data/filamentCatalog';
import { LayerSwapSlot, buildLayerColorLUT, hexToRgb01, rgbToLab } from './opticalTdEngine';

export interface LABColor {
  L: number;
  a: number;
  b: number;
}

export interface ImageColorCluster {
  id: number;
  lab: LABColor;
  rgb: { r: number; g: number; b: number };
  /** Fraction of subject-weighted image area [0..1] */
  weightRatio: number;
  /** Mean normalized luminance [0..1] where this color cluster lives in the 2.5D heightmap */
  meanLuminance: number;
  /** Chroma (saturation) in CIE LAB */
  chroma: number;
  /** Hue sector */
  hueSector: HueSectorName;
  /** Best matching spool from the active library */
  bestSpool?: FilamentSpool;
  bestSpoolDeltaE00?: number;
}

export type HueSectorName =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'magenta'
  | 'neutral';

export function getHueSector(lab: LABColor): { sector: HueSectorName; chroma: number; hueAngle: number } {
  const chroma = Math.hypot(lab.a, lab.b);
  const minChroma = lab.L > 65 ? 11.0 : lab.L < 35 ? (lab.b < 0 ? 16.0 : 8.5) : 7.5;
  if (chroma < minChroma) {
    return { sector: 'neutral', chroma, hueAngle: 0 };
  }
  let deg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (deg < 0) deg += 360;

  let sector: HueSectorName;
  if (deg >= 340 || deg < 50) sector = 'red';
  else if (deg < 75) sector = 'orange';
  else if (deg < 100) sector = 'yellow';
  else if (deg < 170) sector = 'green';
  else if (deg < 220) sector = 'cyan';
  else if (deg < 290) sector = 'blue';
  else if (deg < 320) sector = 'indigo';
  else sector = 'magenta';

  return { sector, chroma, hueAngle: deg };
}

export function isSkinToneLab(lab: LABColor): boolean {
  if (lab.L < 30 || lab.L > 84) return false;
  const chroma = Math.hypot(lab.a, lab.b);
  if (chroma < 7.0 || chroma > 42.0) return false;
  let deg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg >= 20 && deg <= 78 && lab.a >= 3.0 && lab.b >= 7.0;
}

export interface ImageColorAnalysis {
  clusters: ImageColorCluster[];
  /** Number of genuinely distinct color clusters needed to represent >=94% of the subject */
  intrinsicColorCount: number;
  /** Number of distinct spools in the user's library that match the image's clusters */
  distinctMatchedSpoolCount: number;
  /** Whether the midtone clusters are predominantly neutral/achromatic (B&W photo, grey pet, monochrome logo) */
  isMonochromeOrGreySubject: boolean;
  /** Essential chromatic hue sectors with >= 2.5% image area support */
  essentialHues: HueSectorName[];
  /** Saliency-weighted sum across entire image by hue sector */
  hueSectorWeights: Record<HueSectorName, number>;
  /** Whether the image features a prominent human face or skin-tone subject */
  hasSkinToneSubject: boolean;
  /** Estimated luminance range of the skin tone subject [minL, maxL] */
  skinToneLuminanceRange?: [number, number];
}

/**
 * ISO/CIE Standard CIEDE2000 (ΔE00) Perceptual Color Difference Engine.
 * Unlike simple Euclidean RGB or LAB distance, CIEDE2000 models human visual perception
 * across all hues, saturations, and lightness levels without any hardcoded color rules.
 */
export function ciede2000(lab1: LABColor, lab2: LABColor): number {
  const L1 = lab1.L;
  const a1 = lab1.a;
  const b1 = lab1.b;
  const L2 = lab2.L;
  const a2 = lab2.a;
  const b2 = lab2.b;

  const avgL = (L1 + L2) * 0.5;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) * 0.5;

  const avgC7 = Math.pow(avgC, 7);
  const pow25_7 = 6103515625; // 25^7
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + pow25_7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) * 0.5;

  const radToDeg = 180 / Math.PI;
  const degToRad = Math.PI / 180;

  let h1p = Math.atan2(b1, a1p) * radToDeg;
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * radToDeg;
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    if (Math.abs(h2p - h1p) <= 180) {
      dhp = h2p - h1p;
    } else if (h2p - h1p > 180) {
      dhp = h2p - h1p - 360;
    } else {
      dhp = h2p - h1p + 360;
    }
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * 0.5) * degToRad);

  let avgHp = h1p + h2p;
  if (C1p * C2p === 0) {
    avgHp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    avgHp = (h1p + h2p) * 0.5;
  } else if (h1p + h2p < 360) {
    avgHp = (h1p + h2p + 360) * 0.5;
  } else {
    avgHp = (h1p + h2p - 360) * 0.5;
  }

  const T =
    1 -
    0.17 * Math.cos((avgHp - 30) * degToRad) +
    0.24 * Math.cos(2 * avgHp * degToRad) +
    0.32 * Math.cos((3 * avgHp + 6) * degToRad) -
    0.20 * Math.cos((4 * avgHp - 63) * degToRad);

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const avgCp7 = Math.pow(avgCp, 7);
  const RC = 2 * Math.sqrt(avgCp7 / (avgCp7 + pow25_7));

  const avgLm50_2 = Math.pow(avgL - 50, 2);
  const SL = 1 + (0.015 * avgLm50_2) / Math.sqrt(20 + avgLm50_2);
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;
  const RT = -Math.sin(2 * dTheta * degToRad) * RC;

  // Weighting factors: slightly prioritize hue & chroma fidelity (kL = 1.15, kC = 1.0, kH = 0.85)
  // so filament color selection never sacrifices hue accuracy for raw brightness
  const kL = 1.15;
  const kC = 1.0;
  const kH = 0.85;

  const termL = dLp / (kL * SL);
  const termC = dCp / (kC * SC);
  const termH = dHp / (kH * SH);

  return Math.sqrt(
    Math.max(0, termL * termL + termC * termC + termH * termH + RT * termC * termH)
  );
}

export interface QuantizedSample {
  luminance: number;
  lab: LABColor;
  rgb: { r: number; g: number; b: number };
  weight: number;
}

/**
 * Extracts spatially-weighted perceptual samples from any image (real photograph or graphic logo).
 * Uses automatic border-ring vs. center-region contrast so background corners (grass, sky, walls)
 * are automatically down-weighted relative to the foreground subject without any hardcoded color rules.
 */
export function extractPerceptualSamples(imageData: ImageData): QuantizedSample[] {
  const { data, width, height } = imageData;
  const stepX = Math.max(1, Math.floor(width / 56));
  const stepY = Math.max(1, Math.floor(height / 56));

  interface RawPixel {
    nx: number;
    ny: number;
    r: number;
    g: number;
    b: number;
    rawLum: number;
    lab: LABColor;
    isBorder: boolean;
    isChromatic: boolean;
  }

  const rawPixels: RawPixel[] = [];

  for (let y = 0; y < height; y += stepY) {
    const ny = (y / Math.max(1, height - 1)) * 2 - 1;
    for (let x = 0; x < width; x += stepX) {
      const nx = (x / Math.max(1, width - 1)) * 2 - 1;
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3] / 255;
      if (alpha < 0.2) continue;

      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      const rawLum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lab = rgbToLab({ r, g, b });

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = maxC - minC;
      const sat = chroma / Math.max(1e-4, maxC);

      const isBorder = Math.abs(nx) > 0.78 || Math.abs(ny) > 0.78;
      const isChromatic = chroma > 0.13 && sat > 0.20 && minC < 0.72;

      rawPixels.push({ nx, ny, r, g, b, rawLum, lab, isBorder, isChromatic });
    }
  }

  if (rawPixels.length === 0) return [];

  // Normalize luminance using 2nd..98.5th percentile matching buildHeightmapGrid
  const sortedLum = rawPixels.map((p) => p.rawLum).sort((a, b) => a - b);
  const pLow = sortedLum[Math.floor(sortedLum.length * 0.02)] ?? 0;
  const pHigh = sortedLum[Math.floor(sortedLum.length * 0.985)] ?? 1;
  const dynRange = Math.max(0.15, pHigh - pLow);

  let hasWhiteHighlights = false;
  for (const p of rawPixels) {
    const normL = Math.max(0, Math.min(1, (p.rawLum - pLow) / dynRange));
    if (normL > 0.75 && !p.isChromatic) {
      hasWhiteHighlights = true;
      break;
    }
  }

  return rawPixels.map((p) => {
    const normL = Math.max(0, Math.min(1, (p.rawLum - pLow) / dynRange));

    // 1. Weighted Regional Sampling with Center-Weighted Mask:
    // Focuses on the primary subject, strongly downweighting peripheral background noise (corners, borders, room walls, sheets)
    const distCenterSq = p.nx * p.nx + (p.ny * 0.88) * (p.ny * 0.88);
    const centerMask = Math.exp(-distCenterSq / (2 * 0.48 * 0.48));
    let weight = Math.max(0.18, centerMask * 1.85);

    if (p.isBorder && !p.isChromatic) {
      weight *= 0.40;
    }

    const labChroma = Math.hypot(p.lab.a, p.lab.b);
    if (labChroma >= 12.0) {
      weight *= 1.40;
    }

    return {
      luminance: normL,
      lab: p.lab,
      rgb: { r: p.r, g: p.g, b: p.b },
      weight,
    };
  });
}

/**
 * Deterministic Weighted K-Means++ Color Quantization Engine in CIE LAB space.
 * Discovers the true dominant colors of any uploaded photograph or logo and matches them
 * to the user's filament library using CIEDE2000.
 */
export function analyzeImageColorClusters(
  samples: QuantizedSample[],
  candidateSpools: FilamentSpool[],
  maxClusters: number = 8
): ImageColorAnalysis {
  if (samples.length === 0) {
    return {
      clusters: [],
      intrinsicColorCount: 4,
      distinctMatchedSpoolCount: 4,
      isMonochromeOrGreySubject: false,
      essentialHues: [],
      hueSectorWeights: {
        red: 0,
        orange: 0,
        yellow: 0,
        green: 0,
        cyan: 0,
        blue: 0,
        indigo: 0,
        magenta: 0,
        neutral: 0,
      },
      hasSkinToneSubject: false,
    };
  }

  const totalWeight = samples.reduce((acc, s) => acc + s.weight, 0);
  const k = Math.min(maxClusters, Math.max(2, samples.length));

  // 1. Segment samples into luminance zones (Shadows, Midtones, Highlights)
  // Ensures background noise is ignored and primary subject's color distribution dictates the palette
  const shadowSamples = samples.filter((s) => s.lab.L < 32);
  const midtoneSamples = samples.filter((s) => s.lab.L >= 32 && s.lab.L <= 72);
  const highlightSamples = samples.filter((s) => s.lab.L > 72);

  const centroids: LABColor[] = [];

  // Seed 1-2 centroids in Shadows (darkest sample)
  if (shadowSamples.length > 0) {
    let darkest = shadowSamples[0];
    for (const s of shadowSamples) {
      if (s.lab.L < darkest.lab.L) darkest = s;
    }
    centroids.push({ ...darkest.lab });
  } else {
    centroids.push({ ...samples[0].lab });
  }

  // Seed 1 centroid in Highlights (brightest / highest luminance)
  if (highlightSamples.length > 0 && centroids.length < k) {
    let brightest = highlightSamples[0];
    for (const s of highlightSamples) {
      if (s.lab.L > brightest.lab.L) brightest = s;
    }
    centroids.push({ ...brightest.lab });
  }

  // Seed remaining centroids predominantly in Midtones (where subject, skin, core chromatic elements live)
  const midPool = midtoneSamples.length >= 4 ? midtoneSamples : samples;
  while (centroids.length < k) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < midPool.length; i++) {
      const s = midPool[i];
      let minDist = Infinity;
      for (const c of centroids) {
        const d = ciede2000(s.lab, c);
        if (d < minDist) minDist = d;
      }
      const score = minDist * minDist * s.weight;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    centroids.push({ ...midPool[bestIdx].lab });
  }

  // 2. Run 10 iterations of weighted K-Means in CIE LAB
  const assignments = new Int32Array(samples.length);
  for (let iter = 0; iter < 10; iter++) {
    const sumL = new Float64Array(k);
    const sumA = new Float64Array(k);
    const sumB = new Float64Array(k);
    const sumW = new Float64Array(k);

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = ciede2000(s.lab, centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      assignments[i] = bestC;
      sumL[bestC] += s.lab.L * s.weight;
      sumA[bestC] += s.lab.a * s.weight;
      sumB[bestC] += s.lab.b * s.weight;
      sumW[bestC] += s.weight;
    }

    for (let c = 0; c < k; c++) {
      if (sumW[c] > 0) {
        centroids[c] = {
          L: sumL[c] / sumW[c],
          a: sumA[c] / sumW[c],
          b: sumB[c] / sumW[c],
        };
      }
    }
  }

  // 3. Build raw clusters and merge perceptually indistinguishable clusters (ΔE00 < 6.5)
  interface RawCluster {
    lab: LABColor;
    r: number;
    g: number;
    b: number;
    lum: number;
    weight: number;
  }

  const rawClusters: RawCluster[] = Array.from({ length: k }, (_, c) => ({
    lab: centroids[c],
    r: 0,
    g: 0,
    b: 0,
    lum: 0,
    weight: 0,
  }));

  for (let i = 0; i < samples.length; i++) {
    const c = assignments[i];
    const s = samples[i];
    rawClusters[c].r += s.rgb.r * s.weight;
    rawClusters[c].g += s.rgb.g * s.weight;
    rawClusters[c].b += s.rgb.b * s.weight;
    rawClusters[c].lum += s.luminance * s.weight;
    rawClusters[c].weight += s.weight;
  }

  const validRaw = rawClusters
    .filter((c) => {
      const wRatio = c.weight / Math.max(1e-5, totalWeight);
      const cChroma = Math.hypot(c.lab.a, c.lab.b);
      // Keep clusters with >= 1.0% area, or small high-chroma accent elements (>= 0.35% area with chroma >= 14)
      // so small red hearts, red lips, eye accents, or graphic icons are never erased
      return wRatio >= 0.010 || (cChroma >= 14 && wRatio >= 0.0035);
    })
    .map((c) => ({
      lab: c.lab,
      rgb: { r: c.r / c.weight, g: c.g / c.weight, b: c.b / c.weight },
      lum: c.lum / c.weight,
      weight: c.weight,
    }))
    .sort((a, b) => b.weight - a.weight);

  const merged: typeof validRaw = [];
  for (const rc of validRaw) {
    const existing = merged.find((m) => ciede2000(m.lab, rc.lab) < 7.0);
    if (existing) {
      const wTotal = existing.weight + rc.weight;
      existing.lab = {
        L: (existing.lab.L * existing.weight + rc.lab.L * rc.weight) / wTotal,
        a: (existing.lab.a * existing.weight + rc.lab.a * rc.weight) / wTotal,
        b: (existing.lab.b * existing.weight + rc.lab.b * rc.weight) / wTotal,
      };
      existing.rgb = {
        r: (existing.rgb.r * existing.weight + rc.rgb.r * rc.weight) / wTotal,
        g: (existing.rgb.g * existing.weight + rc.rgb.g * rc.weight) / wTotal,
        b: (existing.rgb.b * existing.weight + rc.rgb.b * rc.weight) / wTotal,
      };
      existing.lum = (existing.lum * existing.weight + rc.lum * rc.weight) / wTotal;
      existing.weight = wTotal;
    } else {
      merged.push({ ...rc });
    }
  }

  // Sort clusters from darkest to lightest
  merged.sort((a, b) => a.lum - b.lum);

  // 4. Compute global hue sector distribution across all sampled pixels
  const hueSectorWeights: Record<HueSectorName, number> = {
    red: 0,
    orange: 0,
    yellow: 0,
    green: 0,
    cyan: 0,
    blue: 0,
    indigo: 0,
    magenta: 0,
    neutral: 0,
  };
  for (const s of samples) {
    const { sector } = getHueSector(s.lab);
    hueSectorWeights[sector] += s.weight;
  }
  const essentialHues: HueSectorName[] = (Object.keys(hueSectorWeights) as HueSectorName[]).filter((sec) => {
    if (sec === 'neutral') return false;
    const wRatio = hueSectorWeights[sec] / Math.max(1e-5, totalWeight);

    // 1. High-chroma vivid accents (red hearts, lips, logos, flowers) with chroma >= 16 and area >= 0.4%
    const hasAccentCluster = merged.some(
      (c) =>
        getHueSector(c.lab).sector === sec &&
        Math.hypot(c.lab.a, c.lab.b) >= 16.0 &&
        c.weight / Math.max(1e-5, totalWeight) >= 0.0035
    );
    if (hasAccentCluster) return true;

    // 2. Strong chromatic subject (chroma >= 12 and area >= 1.5%)
    const hasSubjectCluster = merged.some(
      (c) =>
        getHueSector(c.lab).sector === sec &&
        Math.hypot(c.lab.a, c.lab.b) >= 12.0 &&
        c.weight / Math.max(1e-5, totalWeight) >= 0.012
    );
    if (hasSubjectCluster && wRatio >= 0.010) return true;

    // 3. Broad background zone (e.g. lawn grass, blue sky) with area >= 6%
    return wRatio >= 0.06;
  });
  essentialHues.sort((a, b) => (hueSectorWeights[b] ?? 0) - (hueSectorWeights[a] ?? 0));

  const matchedHexSet = new Set<string>();
  let midtoneGreyWeight = 0;
  let midtoneTotalWeight = 0;

  const clusters: ImageColorCluster[] = merged.map((m, idx) => {
    const chroma = Math.hypot(m.lab.a, m.lab.b);
    const { sector } = getHueSector(m.lab);

    if (m.lum >= 0.16 && m.lum <= 0.80) {
      midtoneTotalWeight += m.weight;
      if (chroma < 7.5) midtoneGreyWeight += m.weight;
    }

    let bestSpool: FilamentSpool | undefined;
    let bestD = Infinity;

    for (const s of candidateSpools) {
      const sLab = rgbToLab(hexToRgb01(s.hex));
      const sChroma = Math.hypot(sLab.a, sLab.b);
      const rawD = ciede2000(m.lab, sLab);
      let adjustedD = rawD;

      if (chroma >= 11.0) {
        // Cluster is genuinely chromatic (green grass, blue sky, red suit, warm skin)
        if (sChroma < 6.0) {
          // Candidate spool is neutral (gray/black/white) -> penalty scales smoothly with cluster chroma
          adjustedD += Math.min(20.0, (chroma - 8.0) * 2.5);
        } else {
          // Both are chromatic: check angular hue alignment
          const cosSim = (m.lab.a * sLab.a + m.lab.b * sLab.b) / (chroma * sChroma);
          if (cosSim < 0.25) {
            // Alien hue family (e.g. green vs purple, blue vs red, green vs skin) -> HEAVY PENALTY!
            adjustedD += 30.0;
          } else if (cosSim >= 0.65) {
            // Same hue family (e.g. grass to green spool, sky to blue spool)
            // Under Beer-Lambert transmission, translucent filaments thin out and desaturate,
            // so give a healthy bonus to true hue matches even if spool is more saturated
            adjustedD -= Math.min(8.0, (cosSim - 0.5) * 12.0);
          }
        }
      } else {
        // Cluster is neutral/achromatic (B&W fur, grey rock, white shirt)
        if (sChroma >= 12.0) {
          // Candidate spool is saturated -> penalize to avoid contaminating neutral regions
          adjustedD += 15.0;
        }
      }

      if (adjustedD < bestD) {
        bestD = adjustedD;
        bestSpool = s;
      }
    }

    if (bestSpool && bestD < 24) {
      matchedHexSet.add(bestSpool.hex.toLowerCase());
    }

    return {
      id: idx,
      lab: m.lab,
      rgb: m.rgb,
      weightRatio: m.weight / Math.max(1e-5, totalWeight),
      meanLuminance: m.lum,
      chroma,
      hueSector: sector,
      bestSpool,
      bestSpoolDeltaE00: bestD,
    };
  });

  // Calculate how many top clusters are needed to cover >= 92% of the subject weight
  const byWeight = [...clusters].sort((a, b) => b.weightRatio - a.weightRatio);
  let cumWeight = 0;
  let intrinsicColorCount = 0;
  for (const c of byWeight) {
    cumWeight += c.weightRatio;
    intrinsicColorCount++;
    if (cumWeight >= 0.92) break;
  }

  // 5. Detect face & human skin-tone subject presence and protected luminance range
  let skinToneWeight = 0;
  let minSkinL = 100;
  let maxSkinL = 0;
  for (const s of samples) {
    if (isSkinToneLab(s.lab)) {
      skinToneWeight += s.weight;
      if (s.lab.L < minSkinL) minSkinL = s.lab.L;
      if (s.lab.L > maxSkinL) maxSkinL = s.lab.L;
    }
  }
  const skinWeightRatio = skinToneWeight / Math.max(1e-5, totalWeight);
  const hasSkinToneSubject = skinWeightRatio >= 0.035;
  const skinToneLuminanceRange: [number, number] | undefined = hasSkinToneSubject
    ? [Math.max(32, minSkinL), Math.min(80, maxSkinL)]
    : undefined;

  return {
    clusters,
    intrinsicColorCount: Math.max(2, intrinsicColorCount),
    distinctMatchedSpoolCount: Math.max(2, matchedHexSet.size),
    isMonochromeOrGreySubject: essentialHues.length === 0 && midtoneGreyWeight / Math.max(1e-5, midtoneTotalWeight) >= 0.58,
    essentialHues,
    hueSectorWeights,
    hasSkinToneSubject,
    skinToneLuminanceRange,
  };
}
