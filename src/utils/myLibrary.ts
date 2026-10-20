import type { FilamentSpool } from '../data/filamentCatalog';
import type { ImportedLibraryMeta } from '../store/useTailWagStore';
import { TD_SOURCE_RANK, type TdSource } from '../engine/tdPrior';

export const MY_LIBRARY_ID = 'lib-my-filaments';
export const MY_LIBRARY_NAME = 'My Filaments';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Duplicate = same brand, name and hex among spools already in My Filaments. */
export function findDuplicateSpool(catalog: FilamentSpool[], spool: FilamentSpool): FilamentSpool | undefined {
  return catalog.find(
    (s) =>
      s.libraryId === MY_LIBRARY_ID &&
      s.id !== spool.id &&
      norm(s.brand) === norm(spool.brand) &&
      norm(s.name) === norm(spool.name) &&
      s.hex.toUpperCase() === spool.hex.toUpperCase()
  );
}

function syncMyLibraryMeta(catalog: FilamentSpool[], libs: ImportedLibraryMeta[]): ImportedLibraryMeta[] {
  const count = catalog.filter((s) => s.libraryId === MY_LIBRARY_ID).length;
  const others = libs.filter((l) => l.id !== MY_LIBRARY_ID);
  return count === 0 ? others : [...others, { id: MY_LIBRARY_ID, name: MY_LIBRARY_NAME, count }];
}

export interface LibraryMutation {
  catalog: FilamentSpool[];
  importedLibraries: ImportedLibraryMeta[];
  /** Set when the add was rejected (duplicate). */
  rejected?: string;
}

/** Adds a spool to "My Filaments" (marked owned). Rejects exact duplicates. */
export function addSpoolToMyLibrary(
  catalog: FilamentSpool[],
  libs: ImportedLibraryMeta[],
  spool: FilamentSpool
): LibraryMutation {
  const prepared: FilamentSpool = {
    ...spool,
    id: spool.id.startsWith('my-') ? spool.id : `my-${spool.id}-${Date.now().toString(36)}`,
    owned: true,
    libraryId: MY_LIBRARY_ID,
    libraryName: MY_LIBRARY_NAME,
    hex: spool.hex.toUpperCase(),
  };
  if (findDuplicateSpool(catalog, prepared)) {
    return {
      catalog,
      importedLibraries: libs,
      rejected: `"${prepared.brand} ${prepared.name}" (${prepared.hex}) is already in your spools.`,
    };
  }
  const next = [prepared, ...catalog];
  return { catalog: next, importedLibraries: syncMyLibraryMeta(next, libs) };
}

/**
 * Edits a spool in place. A TD edit with a weaker source than the stored one is ignored, so an
 * estimate can never overwrite a measured value.
 */
export function updateSpoolInCatalog(
  catalog: FilamentSpool[],
  spoolId: string,
  patch: Partial<FilamentSpool>,
  opts: { force?: boolean } = {}
): FilamentSpool[] {
  return catalog.map((s) => {
    if (s.id !== spoolId) return s;
    const next: FilamentSpool = { ...s, ...patch, id: s.id };
    if (patch.td !== undefined || patch.tdSource !== undefined) {
      const incoming: TdSource = patch.tdSource ?? 'user';
      const existing: TdSource = s.tdSource ?? 'catalog';
      if (!opts.force && TD_SOURCE_RANK[incoming] < TD_SOURCE_RANK[existing]) {
        next.td = s.td;
        next.tdSource = s.tdSource;
      } else {
        next.tdSource = incoming;
      }
    }
    if (patch.hex) next.hex = patch.hex.toUpperCase();
    return next;
  });
}

export function removeSpoolFromMyLibrary(
  catalog: FilamentSpool[],
  libs: ImportedLibraryMeta[],
  spoolId: string
): LibraryMutation {
  const next = catalog.filter((s) => !(s.id === spoolId && s.libraryId === MY_LIBRARY_ID));
  return { catalog: next, importedLibraries: syncMyLibraryMeta(next, libs) };
}

/** Library id of the bundled default library (the project owner's own TDS1-measured TDs). */
export const SEED_LIBRARY_ID = 'lib-user-filaments-json';

/**
 * Fills in a missing tdSource for legacy data. The bundled personal library was measured with a
 * TDS1, other imported libraries are user-supplied, and bundled catalog spools are only estimates.
 */
export function withTdSource(spool: FilamentSpool): FilamentSpool {
  if (spool.tdSource) return spool;
  const tdSource: TdSource = spool.libraryId === SEED_LIBRARY_ID ? 'measured' : spool.libraryId ? 'user' : 'estimate';
  return { ...spool, tdSource };
}
