import type { FilamentSpool } from '../data/filamentCatalog';
import { estimateTdFromHex, type TdSource } from '../engine/tdPrior';
import { MY_LIBRARY_ID, MY_LIBRARY_NAME } from './myLibrary';
import type { SharedSpool, SyncAdapter } from './spoolShare';

// How TailWag's owned spools map onto the list shared with Paws and Pennies.

type Material = FilamentSpool['material'];
const MATERIALS: readonly Material[] = ['PLA', 'PLA Matte', 'PLA+', 'PETG', 'PLA Silk', 'CMYK Litho', 'ABS', 'ASA', 'TPU', 'COPE'];
const TD_SOURCES: readonly TdSource[] = ['measured', 'user', 'catalog', 'estimate'];

/** TailWag's material for a shared one; null for materials it doesn't paint with (PC, nylon, PVA…). */
export function twMaterial(shared: string): Material | null {
  return (MATERIALS as readonly string[]).includes(shared) ? (shared as Material) : null;
}

export const twAdapter: SyncAdapter<FilamentSpool> = {
  app: 'tailwag',
  idOf: (s) => s.id,
  fieldsOf: (s) => ({
    brand: s.brand,
    name: s.name,
    material: s.material,
    hex: s.hex.toUpperCase(),
    td: s.td,
    tdSource: s.tdSource,
    stock: s.stock,
  }),
  fromRecord: (r: SharedSpool, local) => {
    const material = twMaterial(r.material);
    if (!material) return null;
    // A spool added in Paws and Pennies has no TD yet: estimate it from the colour, marked as an estimate.
    const td = r.td ?? local?.td ?? estimateTdFromHex(r.hex);
    const tdSource: TdSource =
      r.td !== undefined ? (TD_SOURCES.includes(r.tdSource as TdSource) ? (r.tdSource as TdSource) : 'user') : local?.tdSource ?? 'estimate';
    return {
      ...(local ?? { libraryId: MY_LIBRARY_ID, libraryName: MY_LIBRARY_NAME }),
      id: r.id,
      brand: r.brand,
      name: r.name,
      material,
      hex: r.hex.toUpperCase(),
      td,
      tdSource,
      stock: r.stock,
      owned: true,
    };
  },
};

const ENABLED_KEY = 'tailwag_share_spools';
const SNAPSHOT_KEY = 'tailwag_share_snapshot';

export function loadShareEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveShareEnabled(on: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

export function loadShareSnapshot(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function saveShareSnapshot(snapshot: Record<string, string>) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Without a snapshot the next sync treats every spool as changed here, which is safe.
  }
}
