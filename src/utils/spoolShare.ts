// Shared spool list between TailWag and Paws and Pennies.
// The same file is copied into both apps (TailWag: src/utils/spoolShare.ts); keep them identical.
//
// Both apps sync with one JSON file. Each record carries every field either app knows about; an app
// only writes the fields it changed since its last sync, so TailWag's TD and Paws and Pennies' price
// never overwrite each other. Deleting a spool leaves a tombstone so the other app removes it too.

export const SHARE_FORMAT = 'boxerdawg-shared-spools';
export const SHARE_VERSION = 1;

export interface SharedSpool {
  id: string;
  brand: string;
  name: string;
  /** Material as TailWag names it ("PLA Matte"); Paws and Pennies maps it to its shorter list. */
  material: string;
  /** #RRGGBB */
  hex: string;
  /** Transmission distance in mm (TailWag). */
  td?: number;
  tdSource?: string;
  stock?: 'ok' | 'low' | 'out';
  /** Price of one spool (Paws and Pennies). */
  price?: number;
  netGrams?: number;
  abrasive?: boolean;
  updatedAt: number;
  updatedBy: string;
  deleted?: boolean;
}

export type SharedFields = Partial<Omit<SharedSpool, 'id' | 'updatedAt' | 'updatedBy' | 'deleted'>>;
export type SharedMap = Map<string, SharedSpool>;

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Read the shared file; anything unreadable gives an empty list (and the next write repairs it). */
export function parseSharedFile(text: string | null | undefined): SharedMap {
  const map: SharedMap = new Map();
  if (!text) return map;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return map;
  }
  const d = data as { format?: unknown; spools?: unknown };
  if (!d || d.format !== SHARE_FORMAT || !Array.isArray(d.spools)) return map;
  for (const raw of d.spools) {
    const r = raw as Record<string, unknown>;
    const id = str(r?.id);
    if (!id) continue;
    const hex = str(r.hex);
    map.set(id, {
      id,
      brand: str(r.brand) ?? '',
      name: str(r.name) ?? id,
      material: str(r.material) ?? 'PLA',
      hex: hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : '#808080',
      td: num(r.td),
      tdSource: str(r.tdSource),
      stock: r.stock === 'ok' || r.stock === 'low' || r.stock === 'out' ? r.stock : undefined,
      price: num(r.price),
      netGrams: num(r.netGrams),
      abrasive: typeof r.abrasive === 'boolean' ? r.abrasive : undefined,
      updatedAt: num(r.updatedAt) ?? 0,
      updatedBy: str(r.updatedBy) ?? '',
      deleted: r.deleted === true ? true : undefined,
    });
  }
  return map;
}

export function serializeSharedFile(map: SharedMap): string {
  const spools = [...map.values()].sort((a, b) => a.id.localeCompare(b.id)).map(clean);
  return JSON.stringify({ format: SHARE_FORMAT, version: SHARE_VERSION, spools }, null, 2);
}

/** Drop undefined fields so comparisons and the file stay tidy. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Stable text for a set of fields, used to notice what changed since the last sync. */
export function fieldsKey(fields: SharedFields): string {
  const c = clean(fields) as Record<string, unknown>;
  return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]]));
}

export interface SyncAdapter<L> {
  /** Who writes: 'tailwag' or 'paws-and-pennies'. */
  app: string;
  idOf: (local: L) => string;
  /** The shared fields this app keeps for a spool. */
  fieldsOf: (local: L) => SharedFields;
  /** Update (or create, when `local` is undefined) a spool from a record; null when this app can't hold it. */
  fromRecord: (record: SharedSpool, local: L | undefined) => L | null;
}

export interface SyncResult<L> {
  file: SharedMap;
  local: L[];
  /** id → fieldsKey at this sync; save it and pass it to the next sync. */
  snapshot: Record<string, string>;
  fileChanged: boolean;
  localChanged: boolean;
}

/**
 * One sync: local edits since the last snapshot go to the file, everything else in the file comes in.
 * Running it again straight away changes nothing, so the apps don't ping-pong on each other's writes.
 */
export function syncSpools<L>(
  file: SharedMap,
  local: L[],
  snapshot: Record<string, string>,
  adapter: SyncAdapter<L>,
  now: number
): SyncResult<L> {
  const next: SharedMap = new Map(file);
  const out: L[] = [];
  const localIds = new Set<string>();
  let fileChanged = false;
  let localChanged = false;

  for (const item of local) {
    const id = adapter.idOf(item);
    localIds.add(id);
    const fields = adapter.fieldsOf(item);
    const record = next.get(id);

    if (snapshot[id] !== fieldsKey(fields)) {
      // Changed here (or new): write the fields that differ.
      const differs =
        !record || record.deleted || Object.entries(clean(fields)).some(([k, v]) => (record as unknown as Record<string, unknown>)[k] !== v);
      if (differs) {
        next.set(id, { ...(record ?? {}), ...clean(fields), id, deleted: undefined, updatedAt: now, updatedBy: adapter.app } as SharedSpool);
        fileChanged = true;
      }
      out.push(item);
      continue;
    }

    // Unchanged here: take what the other app did.
    if (record?.deleted) {
      localChanged = true;
      continue;
    }
    const updated = record ? adapter.fromRecord(record, item) : item;
    if (updated && fieldsKey(adapter.fieldsOf(updated)) !== fieldsKey(fields)) {
      out.push(updated);
      localChanged = true;
    } else out.push(item);
  }

  // Deleted here since the last sync.
  for (const id of Object.keys(snapshot)) {
    const record = next.get(id);
    if (!localIds.has(id) && record && !record.deleted) {
      next.set(id, { ...record, deleted: true, updatedAt: now, updatedBy: adapter.app });
      fileChanged = true;
    }
  }

  // New from the other app.
  for (const record of next.values()) {
    if (record.deleted || localIds.has(record.id) || record.id in snapshot) continue;
    const created = adapter.fromRecord(record, undefined);
    if (created) {
      out.push(created);
      localChanged = true;
    }
  }

  const nextSnapshot: Record<string, string> = {};
  for (const item of out) nextSnapshot[adapter.idOf(item)] = fieldsKey(adapter.fieldsOf(item));
  return { file: next, local: out, snapshot: nextSnapshot, fileChanged, localChanged };
}

// ---- Pairing the same physical spool when an app joins ----

/** "PLA Matte", "PLA+", "CMYK Litho" → "PLA"; "PETG-CF", "PCTG" → "PETG". */
export function materialFamily(material: string): string {
  const m = material.toUpperCase().trim();
  if (/CMYK|LITHO/.test(m)) return 'PLA';
  if (m.startsWith('PCTG') || m.startsWith('PET')) return 'PETG';
  const head = /^(PLA|ABS|ASA|TPU|TPE|PC|PA|PPA|PVA|BVOH)/.exec(m)?.[1];
  return head === 'TPE' ? 'TPU' : head === 'PPA' ? 'PA' : head === 'BVOH' ? 'PVA' : head ?? m;
}

/** Under this CIE76 ΔE, a slicer's "#FFFFFF" and a measured "#F4F3EE" count as the same filament colour. */
export const SAME_COLOUR_DELTA_E = 8;

function hexToLab(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIE76 distance between two #RRGGBB colours; Infinity when either can't be read. */
export function deltaE(a: string, b: string): number {
  const la = hexToLab(a);
  const lb = hexToLab(b);
  if (!la || !lb) return Infinity;
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** The candidate closest in colour, if it's close enough to be the same filament. */
export function closestColour<T>(hex: string, candidates: T[], hexOf: (c: T) => string | undefined): T | undefined {
  let best: T | undefined;
  let bestDe = SAME_COLOUR_DELTA_E;
  for (const c of candidates) {
    const h = hexOf(c);
    if (!h) continue;
    const de = deltaE(hex, h);
    if (de <= bestDe) {
      best = c;
      bestDe = de;
    }
  }
  return best;
}

/**
 * When this app joins a list the other app already filled, its not-yet-shared spools take over the other
 * app's record for the same physical spool (same material family, near colour): the record moves to our id,
 * keeping the other app's fields such as price, and the old id is retired so the other app swaps it too.
 */
export function adoptMatches<L>(
  file: SharedMap,
  local: L[],
  snapshot: Record<string, string>,
  adapter: SyncAdapter<L>,
  now: number
): { file: SharedMap; adopted: number } {
  const next: SharedMap = new Map(file);
  const localIds = new Set(local.map(adapter.idOf));
  let adopted = 0;
  for (const item of local) {
    const id = adapter.idOf(item);
    if (id in snapshot || next.has(id)) continue;
    const fields = adapter.fieldsOf(item);
    if (!fields.hex || !fields.material) continue;
    const family = materialFamily(fields.material);
    const candidates = [...next.values()].filter(
      (r) => !r.deleted && r.updatedBy !== adapter.app && !(r.id in snapshot) && !localIds.has(r.id) && materialFamily(r.material) === family
    );
    const match = closestColour(fields.hex, candidates, (r) => r.hex);
    if (!match) continue;
    next.set(id, { ...match, id, updatedAt: now, updatedBy: adapter.app });
    next.set(match.id, { ...match, deleted: true, updatedAt: now, updatedBy: adapter.app });
    adopted++;
  }
  return { file: next, adopted };
}
