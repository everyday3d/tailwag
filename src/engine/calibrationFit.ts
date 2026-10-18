import { deltaE2000, linearToSrgb, rgbToLab } from './colorScience';
import {
  OpticalProfile,
  kmLayerReflectance,
  scatteringForTd,
} from './opticalModel';

/**
 * One measured calibration patch: `thicknessMm` of the filament printed over a backing whose
 * linear-light reflectance was itself measured (a bare white or black patch on the same plate).
 * All colors are linear light, white-balanced against the plate's reference patch.
 */
export interface CalibrationObservation {
  thicknessMm: number;
  backing: [number, number, number];
  measured: [number, number, number];
}

export interface CalibrationFit {
  profile: OpticalProfile;
  /** ΔE00 between measured and refit patches. */
  meanDeltaE00: number;
  maxDeltaE00: number;
  observations: number;
  /** True when too few or too uniform patches were given to trust the scattering fit. */
  weak: boolean;
}

const toLab = (lin: [number, number, number]) =>
  rgbToLab({ r: linearToSrgb(lin[0]), g: linearToSrgb(lin[1]), b: linearToSrgb(lin[2]) });

function predict(obs: CalibrationObservation, rInf: [number, number, number], s: number): [number, number, number] {
  return [0, 1, 2].map((c) => kmLayerReflectance(obs.backing[c], rInf[c], s, obs.thicknessMm)) as [
    number,
    number,
    number,
  ];
}

function cost(obs: CalibrationObservation[], rInf: [number, number, number], s: number) {
  let sum = 0;
  let max = 0;
  for (const o of obs) {
    const d = deltaE2000(toLab(predict(o, rInf, s)), toLab(o.measured));
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / obs.length, max };
}

/** Golden-section minimum of a unimodal f on [lo, hi]. */
function golden(f: (x: number) => number, lo: number, hi: number, iters = 40): number {
  const g = 0.6180339887;
  let a = lo;
  let b = hi;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < iters; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * Fits one filament's optical profile (per-channel Rinf and the shared scattering s) to measured
 * patches by alternating 1-D searches on a log scale. The result keeps the filament's TD as a
 * quantity derived from the fit, so the library shows the optically measured TD.
 */
export function fitOpticalProfile(
  observations: CalibrationObservation[],
  initial: OpticalProfile
): CalibrationFit {
  if (observations.length === 0) {
    return { profile: initial, meanDeltaE00: 0, maxDeltaE00: 0, observations: 0, weak: true };
  }
  const rInf: [number, number, number] = [...initial.rInf];
  let s = initial.s;

  // The thickest patch over a dark backing is the best first guess for Rinf.
  const thick = [...observations].sort((a, b) => b.thicknessMm - a.thicknessMm)[0];
  if (thick.thicknessMm * initial.s > 2) {
    for (let c = 0; c < 3; c++) rInf[c] = Math.max(0.003, Math.min(0.97, thick.measured[c]));
  }

  for (let round = 0; round < 6; round++) {
    s = Math.exp(
      golden((x) => cost(observations, rInf, Math.exp(x)).mean, Math.log(initial.s / 30), Math.log(initial.s * 30))
    );
    for (let c = 0; c < 3; c++) {
      const x = golden(
        (v) => {
          const r: [number, number, number] = [...rInf];
          r[c] = Math.exp(v);
          return cost(observations, r, s).mean;
        },
        Math.log(0.003),
        Math.log(0.97)
      );
      rInf[c] = Math.exp(x);
    }
  }

  const { mean, max } = cost(observations, rInf, s);
  const lum = 0.2126729 * rInf[0] + 0.7151522 * rInf[1] + 0.072175 * rInf[2];
  // Invert scatteringForTd (monotonic in TD) to report the optically measured TD.
  const tdMm = golden((t) => Math.abs(scatteringForTd(lum, t) - s), 0.05, 20, 60);
  const thicknesses = new Set(observations.map((o) => o.thicknessMm.toFixed(2)));
  return {
    profile: { rInf, s, tdMm, source: 'calibrated' },
    meanDeltaE00: mean,
    maxDeltaE00: max,
    observations: observations.length,
    weak: observations.length < 6 || thicknesses.size < 3,
  };
}
