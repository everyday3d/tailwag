import type { FilamentSpool } from '../data/filamentCatalog';

export type StockStatus = 'ok' | 'low' | 'out';
export type AmsFilter = 'all' | 'loaded' | 'none' | string; // string = exact slot label
export type StockFilter = 'all' | 'available' | StockStatus;
export type SortMode = 'default' | 'td-asc' | 'td-desc' | 'name' | 'brand' | 'lightness';

export interface LibraryViewOptions {
  query?: string;
  ams?: AmsFilter;
  stock?: StockFilter;
  sort?: SortMode;
}

export const STOCK_LABEL: Record<StockStatus, string> = {
  ok: 'In stock',
  low: 'Low',
  out: 'Out',
};

export const stockOf = (s: FilamentSpool): StockStatus => s.stock ?? 'ok';

/** Next status when the user taps the stock chip: ok -> low -> out -> ok. */
export function nextStock(current: StockStatus | undefined): StockStatus {
  const c = current ?? 'ok';
  return c === 'ok' ? 'low' : c === 'low' ? 'out' : 'ok';
}

/** Spools the solver may use: anything not marked out of stock. */
export function solverUsable(spools: FilamentSpool[]): FilamentSpool[] {
  return spools.filter((s) => stockOf(s) !== 'out');
}

/** Distinct AMS slot labels present, naturally sorted ("AMS 1 - A2" before "AMS 1 - A10"). */
export function amsSlotsOf(spools: FilamentSpool[]): string[] {
  const set = new Set<string>();
  for (const s of spools) if (s.amsSlot && s.amsSlot.trim()) set.add(s.amsSlot.trim());
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function approxLightness(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function filterAndSortSpools(spools: FilamentSpool[], opts: LibraryViewOptions): FilamentSpool[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const ams = opts.ams ?? 'all';
  const stock = opts.stock ?? 'all';

  let list = spools.filter((s) => {
    if (q) {
      const hay = `${s.name} ${s.brand} ${s.material} ${s.amsSlot ?? ''}`.toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    if (ams === 'loaded' && !s.amsSlot) return false;
    if (ams === 'none' && s.amsSlot) return false;
    if (ams !== 'all' && ams !== 'loaded' && ams !== 'none' && s.amsSlot !== ams) return false;
    const st = stockOf(s);
    if (stock === 'available' && st === 'out') return false;
    if ((stock === 'ok' || stock === 'low' || stock === 'out') && st !== stock) return false;
    return true;
  });

  const by = (cmp: (a: FilamentSpool, b: FilamentSpool) => number) => {
    // stable copy sort
    list = list.map((s, i) => ({ s, i })).sort((x, y) => cmp(x.s, y.s) || x.i - y.i).map((x) => x.s);
  };
  switch (opts.sort) {
    case 'td-asc':
      by((a, b) => a.td - b.td);
      break;
    case 'td-desc':
      by((a, b) => b.td - a.td);
      break;
    case 'name':
      by((a, b) => a.name.localeCompare(b.name));
      break;
    case 'brand':
      by((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));
      break;
    case 'lightness':
      by((a, b) => approxLightness(a.hex) - approxLightness(b.hex));
      break;
    default:
      break;
  }
  return list;
}
