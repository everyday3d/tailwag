import type { FilamentSpool } from '../data/filamentCatalog';
import { Lab, rgbToLab } from './colorScience';
import { LayerSwapSlot, hexToRgb01 } from './opticalTdEngine';
import { OpticalProfile, profileFromColor } from './opticalModel';
import {
  TargetBuckets,
  buildTargetBuckets,
  bestMatchScore,
  fastDeltaE,
  layerLabsForEnds,
  pruneBuckets,
  sampleGridColors,
  searchSlotBoundaries,
} from './colorMatch';
import type { SolverRecipe } from './autoSolver';

/**
 * Faithful palette search: chooses WHICH spools, in WHAT order, and WHERE they swap so the mean
 * best-match color difference to the photo is as small as possible.
 *
 * The search space is too large to enumerate (ordered subsets of a spool library times swap
 * layers), so it uses simulated annealing over (spool order, swap layers), ranked by a fast color
 * metric on the photo's heaviest color buckets. The best states are then refined with the exact
 * boundary search and decided with standard ΔE00. Everything is deterministic for a given seed.
 */

export interface FaithfulSolveOptions {
  /** Annealing steps per restart (default 1500) */
  iterations?: number;
  restarts?: number;
  seed?: number;
  /** Fewest layers a filament prints before the next swap (default 2) */
  minBandLayers?: number;
  /** Spools to keep from a large library before searching (default 40) */
  shortlistSize?: number;
}

/** Small deterministic PRNG (mulberry32) so results are repeatable. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candidate {
  spool: FilamentSpool;
  profile: OpticalProfile;
  lab: Lab;
}

/** Keeps the spools most likely to matter: nearest to heavy photo colors, plus the extremes. */
function shortlist(pool: FilamentSpool[], buckets: TargetBuckets, size: number): Candidate[] {
  const all: Candidate[] = pool.map((spool) => {
    const rgb = hexToRgb01(spool.hex);
    return { spool, profile: profileFromColor(rgb, spool.td), lab: rgbToLab(rgb) };
  });
  if (all.length <= size) return all;

  const votes = new Float64Array(all.length);
  for (let b = 0; b < buckets.labs.length; b++) {
    // The three nearest spool colors each get a share of this bucket's weight
    const ranked = all
      .map((c, i) => ({ i, d: fastDeltaE(buckets.labs[b], c.lab) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 3);
    ranked.forEach((r, k) => {
      votes[r.i] += buckets.weights[b] / (k + 1);
    });
  }
  const keep = new Set<number>();
  const byLight = all.map((c, i) => ({ i, L: c.lab.L })).sort((a, b) => a.L - b.L);
  byLight.slice(0, 3).forEach((x) => keep.add(x.i));
  byLight.slice(-3).forEach((x) => keep.add(x.i));
  const byVote = all.map((_, i) => i).sort((a, b) => votes[b] - votes[a]);
  for (const i of byVote) {
    if (keep.size >= size) break;
    keep.add(i);
  }
  return Array.from(keep).map((i) => all[i]);
}

interface State {
  order: number[]; // indices into candidates
  ends: number[];
}

export function solveFaithfulPalette(
  imageData: ImageData,
  pool: FilamentSpool[],
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  colorCount: number,
  baseSolidThicknessMm?: number,
  options: FaithfulSolveOptions = {}
): SolverRecipe[] {
  const minBand = Math.max(1, options.minBandLayers ?? 2);
  const iterations = options.iterations ?? 1500;
  const restarts = options.restarts ?? 2;
  const rng = makeRng(options.seed ?? 1337);

  const unique = new Map<string, FilamentSpool>();
  for (const s of pool) if (s.stock !== 'out' && !unique.has(s.id)) unique.set(s.id, s);
  const spools = Array.from(unique.values());
  if (spools.length < 2) return [];

  const K = Math.max(2, Math.min(colorCount, spools.length, Math.floor(totalLayers / minBand)));
  const minLayer = Math.min(
    Math.max(1, totalLayers - 2),
    baseSolidThicknessMm !== undefined
      ? Math.max(1, 1 + Math.round(Math.max(0, baseSolidThicknessMm - baseLayerMm) / layerHeightMm))
      : 1
  );

  const cols = 56;
  const rows = Math.max(16, Math.round((cols * imageData.height) / Math.max(1, imageData.width)));
  const rgb = sampleGridColors(imageData, cols, rows);
  const fullBuckets = buildTargetBuckets(rgb, cols * rows, { step: { L: 4, a: 6, b: 6 } });
  const searchBuckets = pruneBuckets(fullBuckets, 0.99);
  const cands = shortlist(spools, fullBuckets, options.shortlistSize ?? 40);
  const N = cands.length;
  const K2 = Math.min(K, N);

  // A translucent base shows whatever the print is mounted on, so it is discouraged: the predicted
  // color would depend on the backing, which the user controls.
  const baseSeeThrough = (spool: FilamentSpool, firstEnd: number): number => {
    const thickness = baseLayerMm + (Math.min(firstEnd, minLayer) - 1) * layerHeightMm;
    return Math.pow(10, -thickness / Math.max(0.05, spool.td));
  };
  const BASE_SEE_THROUGH_PENALTY = 8;

  const score = (s: State): number => {
    const profiles = s.order.map((i) => cands[i].profile);
    const labs = layerLabsForEnds(profiles, s.ends, totalLayers, layerHeightMm, baseLayerMm);
    let sc = bestMatchScore(searchBuckets, labs, minLayer, totalLayers, 'fast');
    sc += BASE_SEE_THROUGH_PENALTY * baseSeeThrough(cands[s.order[0]].spool, s.ends[0]);
    // Two filaments that look the same waste a slot (and a swap when adjacent)
    for (let i = 0; i < K2; i++) {
      for (let j = i + 1; j < K2; j++) {
        if (fastDeltaE(cands[s.order[i]].lab, cands[s.order[j]].lab) < 4) sc += j === i + 1 ? 1.5 : 1.0;
      }
    }
    return sc;
  };

  const evenEnds = (n: number = K2): number[] =>
    Array.from({ length: n }, (_, i) =>
      i === n - 1 ? totalLayers : Math.round(minLayer + ((i + 1) / n) * (totalLayers - minLayer))
    );
  // Strictly increasing swap layers at least minBand apart, ending at the top, for n filaments
  const fixEnds = (ends: number[], n: number = K2): number[] => {
    const out = [...ends];
    out[n - 1] = totalLayers;
    for (let i = 0; i < n - 1; i++) {
      const lo = (i === 0 ? 0 : out[i - 1]) + minBand;
      const hi = totalLayers - (n - 1 - i) * minBand;
      out[i] = Math.max(lo, Math.min(hi, out[i]));
    }
    return out;
  };

  // Greedy start: darkest spool first, then add whichever spool lowers the score most
  const greedyStart = (): State => {
    const byL = cands.map((c, i) => ({ i, L: c.lab.L })).sort((a, b) => a.L - b.L);
    const chosen: number[] = [byL[0].i];
    while (chosen.length < K2) {
      let best = -1;
      let bestSc = Infinity;
      for (let i = 0; i < N; i++) {
        if (chosen.includes(i)) continue;
        const trial = [...chosen, i].sort((a, b) => cands[a].lab.L - cands[b].lab.L);
        // score the partial stack as if it were complete
        const ends = fixEnds(evenEnds(trial.length), trial.length);
        const labs = layerLabsForEnds(trial.map((t) => cands[t].profile), ends, totalLayers, layerHeightMm, baseLayerMm);
        const sc = bestMatchScore(searchBuckets, labs, minLayer, totalLayers, 'fast');
        if (sc < bestSc) {
          bestSc = sc;
          best = i;
        }
      }
      chosen.push(best);
    }
    chosen.sort((a, b) => cands[a].lab.L - cands[b].lab.L);
    return { order: chosen, ends: fixEnds(evenEnds()) };
  };

  const found: Array<{ state: State; score: number }> = [];
  for (let r = 0; r < restarts; r++) {
    let cur = greedyStart();
    if (r > 0) {
      // Diversify: shuffle which non-base spools are used
      for (let k = 1; k < K2; k++) {
        if (rng() < 0.5) {
          const pick = Math.floor(rng() * N);
          if (!cur.order.includes(pick)) cur.order[k] = pick;
        }
      }
    }
    let curSc = score(cur);
    let best = { state: { order: [...cur.order], ends: [...cur.ends] }, score: curSc };
    for (let it = 0; it < iterations; it++) {
      const T = 0.8 * Math.pow(0.02 / 0.8, it / Math.max(1, iterations - 1));
      const next: State = { order: [...cur.order], ends: [...cur.ends] };
      const m = rng();
      if (m < 0.4 && K2 > 1) {
        const i = Math.floor(rng() * (K2 - 1));
        next.ends[i] += rng() < 0.5 ? -1 : 1;
        if (rng() < 0.25) next.ends[i] += rng() < 0.5 ? -1 : 1;
        next.ends = fixEnds(next.ends);
      } else if (m < 0.7) {
        const i = Math.floor(rng() * K2);
        const pick = Math.floor(rng() * N);
        if (next.order.includes(pick)) continue;
        next.order[i] = pick;
      } else if (m < 0.9 && K2 > 1) {
        const i = Math.floor(rng() * K2);
        const j = Math.floor(rng() * K2);
        if (i === j) continue;
        [next.order[i], next.order[j]] = [next.order[j], next.order[i]];
      } else if (K2 > 1) {
        const i = Math.floor(rng() * (K2 - 1));
        const lo = (i === 0 ? 0 : next.ends[i - 1]) + minBand;
        const hi = totalLayers - (K2 - 1 - i) * minBand;
        if (hi > lo) next.ends[i] = lo + Math.floor(rng() * (hi - lo + 1));
        next.ends = fixEnds(next.ends);
      }
      const sc = score(next);
      if (sc < curSc || rng() < Math.exp((curSc - sc) / T)) {
        cur = next;
        curSc = sc;
        if (sc < best.score) best = { state: { order: [...next.order], ends: [...next.ends] }, score: sc };
      }
    }
    found.push(best);
  }

  // Refine the best distinct orders with the exact boundary search and decide with ΔE00
  found.sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  let winner: { slots: LayerSwapSlot[]; exact: number; adjusted: number } | null = null;
  for (const f of found) {
    const key = f.state.order.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const slots: LayerSwapSlot[] = f.state.order.map((ci, i) => ({
      id: `faithful-${i}`,
      spool: cands[ci].spool,
      upToLayer: f.state.ends[i],
    }));
    const res = searchSlotBoundaries({
      slots,
      totalLayers,
      baseLayerMm,
      layerHeightMm,
      minLayer,
      buckets: fullBuckets,
      minBandLayers: minBand,
    });
    const adjusted = res.scoreDeltaE00 + BASE_SEE_THROUGH_PENALTY * baseSeeThrough(slots[0].spool, res.ends[0]);
    if (!winner || adjusted < winner.adjusted) {
      winner = {
        slots: slots.map((s, i) => ({ ...s, upToLayer: res.ends[i] })),
        exact: res.scoreDeltaE00,
        adjusted,
      };
    }
  }
  if (!winner) return [];

  const baseSpool = winner.slots[0].spool;
  const seeThrough = baseSeeThrough(baseSpool, winner.slots[0].upToLayer);
  const baseWarning =
    seeThrough > 0.35
      ? ` Note: the base filament ${baseSpool.name} is translucent (TD ${baseSpool.td} mm), so the print will show what it is mounted on.`
      : '';

  return [
    {
      id: 'faithful-match',
      name: 'Faithful Match',
      badge: 'Faithful',
      description: `Closest match to the photo's own colors: spools, order and swap layers chosen to minimize the mean color difference (ΔE00 ${winner.exact.toFixed(1)}).${baseWarning}`,
      scoreDeltaE: winner.exact,
      slots: winner.slots,
    },
  ];
}

/** Standard ΔE00 between a photo and the predicted print for a stack, per the best-match rule. */
export function faithfulScoreForSlots(
  imageData: ImageData,
  slots: LayerSwapSlot[],
  totalLayers: number,
  baseLayerMm: number,
  layerHeightMm: number,
  minLayer: number
): number {
  const cols = 56;
  const rows = Math.max(16, Math.round((cols * imageData.height) / Math.max(1, imageData.width)));
  const buckets = buildTargetBuckets(sampleGridColors(imageData, cols, rows), cols * rows, { step: { L: 4, a: 6, b: 6 } });
  const ends = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);
  const labs = layerLabsForEnds(
    ends.map((s) => profileFromColor(hexToRgb01(s.spool.hex), s.spool.td)),
    ends.map((s, i) => (i === ends.length - 1 ? totalLayers : s.upToLayer)),
    totalLayers,
    layerHeightMm,
    baseLayerMm
  );
  return bestMatchScore(buckets, labs, minLayer, totalLayers, 'ciede2000');
}

