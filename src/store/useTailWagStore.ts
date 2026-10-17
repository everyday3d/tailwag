import { create } from 'zustand';
import { FilamentSpool, VERIFIED_FILAMENT_CATALOG } from '../data/filamentCatalog';
import { LayerSwapSlot } from '../engine/opticalTdEngine';
import { CadCutoutConfig } from '../engine/cadMeshBuilder';
import { parseFilamentLibraryJson } from '../utils/filamentJsonIO';
import userDefaultFilamentsRaw from '../data/userDefaultFilaments.json';

export type ViewportMode = '3d-mesh' | 'split' | 'source' | 'heightmap';

export interface ImportedLibraryMeta {
  id: string;
  name: string;
  count: number;
}

export interface TailWagState {
  projectName: string;
  viewportMode: ViewportMode;
  splitRatio: number; // 0..1
  lightAzimuthDeg: number;
  lightElevationDeg: number;
  backlitLithoMode: boolean;
  slicePreviewMaxLayer: number;

  // Physical & Slicer Layer Parameters
  widthMm: number;
  heightMm: number;
  lockAspect: boolean;
  baseLayerMm: number;
  baseSolidThicknessMm: number;
  layerHeightMm: number;
  totalLayers: number;
  totalDepthMm: number;
  meshResolution: number;

  // Pre-Press Image Enhancement Parameters
  gamma: number;
  contrast: number;
  detailEnhance: number;
  invertLuminance: boolean;

  // 2.5D Parametric CAD & Cutouts
  cad: CadCutoutConfig;

  // Filament Catalog, Imported Libraries & Active Layer Swap Stack
  catalog: FilamentSpool[];
  importedLibraries: ImportedLibraryMeta[];
  slots: LayerSwapSlot[];

  // Actions
  setProjectName: (name: string) => void;
  setViewportMode: (mode: ViewportMode) => void;
  setSplitRatio: (ratio: number) => void;
  setLighting: (azimuth: number, elevation: number) => void;
  setBacklitLithoMode: (backlit: boolean) => void;
  setSlicePreviewMaxLayer: (layer: number) => void;
  setDimensions: (widthMm: number, heightMm: number) => void;
  setLayerParams: (baseLayerMm: number, layerHeightMm: number, totalLayers: number) => void;
  setTotalDepthMm: (depthMm: number) => void;
  setBaseSolidThicknessMm: (thicknessMm: number) => void;
  setMeshResolution: (res: number) => void;
  setPrePress: (partial: Partial<{ gamma: number; contrast: number; detailEnhance: number; invertLuminance: boolean }>) => void;
  setCadConfig: (partial: Partial<CadCutoutConfig>) => void;
  setSlots: (slots: LayerSwapSlot[]) => void;
  updateSlotLayer: (slotId: string, upToLayer: number) => void;
  updateSlotSpool: (slotId: string, spool: FilamentSpool) => void;
  addSlot: (spool: FilamentSpool) => void;
  insertSpoolAt: (spool: FilamentSpool, targetIndex?: number) => void;
  reorderSlots: (fromIndex: number, toIndex: number) => void;
  distributeSlotsEvenly: () => void;
  removeSlot: (slotId: string) => void;
  addCustomSpoolToCatalog: (spool: FilamentSpool) => void;
  toggleSpoolOwned: (spoolId: string) => void;
  syncAmsSpools: (amsSpools: FilamentSpool[]) => void;
  importOwnedLibraryJson: (
    importedSpools: FilamentSpool[],
    mode?: 'replace' | 'merge',
    libraryMeta?: ImportedLibraryMeta
  ) => void;
  removeImportedLibrary: (libraryId: string) => void;
  clearAllImportedLibraries: () => void;
}

const CATALOG_STORAGE_KEY = 'tailwag_catalog_v4';
const LIBS_STORAGE_KEY = 'tailwag_imported_libs_v4';

const CLEAN_BUILTIN_CATALOG: FilamentSpool[] = VERIFIED_FILAMENT_CATALOG.map((s) => ({
  ...s,
  owned: false,
  libraryId: undefined,
  libraryName: undefined,
}));

function buildSeededDefaultState(): { catalog: FilamentSpool[]; importedLibraries: ImportedLibraryMeta[] } {
  try {
    const parsedSeed = parseFilamentLibraryJson(
      JSON.stringify(userDefaultFilamentsRaw),
      'filaments.json',
      'lib-user-filaments-json'
    );
    if (parsedSeed.spools.length > 0) {
      const merged: FilamentSpool[] = [...parsedSeed.spools, ...CLEAN_BUILTIN_CATALOG];
      return {
        catalog: merged,
        importedLibraries: [
          {
            id: parsedSeed.libraryId,
            name: 'filaments.json',
            count: parsedSeed.spools.length,
          },
        ],
      };
    }
  } catch {
    // fallback to built-in catalog
  }
  return { catalog: CLEAN_BUILTIN_CATALOG, importedLibraries: [] };
}

function loadInitialStoreData(): { catalog: FilamentSpool[]; importedLibraries: ImportedLibraryMeta[] } {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedCat = window.localStorage.getItem(CATALOG_STORAGE_KEY);
      const savedLibs = window.localStorage.getItem(LIBS_STORAGE_KEY);
      if (savedCat && savedLibs) {
        const parsedCat = JSON.parse(savedCat) as FilamentSpool[];
        const parsedLibs = JSON.parse(savedLibs) as ImportedLibraryMeta[];
        if (Array.isArray(parsedCat) && Array.isArray(parsedLibs)) {
          // Enforce that only spools belonging to an active imported library are marked owned
          const activeLibIds = new Set(parsedLibs.map((l) => l.id));
          const normalizedCat = parsedCat
            .filter((s) => !s.libraryId || activeLibIds.has(s.libraryId))
            .map((s) => ({
              ...s,
              owned: Boolean(s.libraryId && activeLibIds.has(s.libraryId)),
            }));
          if (normalizedCat.length > 0) {
            return {
              catalog: normalizedCat,
              importedLibraries: parsedLibs,
            };
          }
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return buildSeededDefaultState();
}

function saveStoreDataToStorage(catalog: FilamentSpool[], importedLibraries: ImportedLibraryMeta[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
      window.localStorage.setItem(LIBS_STORAGE_KEY, JSON.stringify(importedLibraries));
    }
  } catch {
    // ignore storage errors
  }
}

const initialStoreData = loadInitialStoreData();

const findOwnedOrBuiltIn = (predicate: (s: FilamentSpool) => boolean, fallbackId: string): FilamentSpool => {
  return (
    initialStoreData.catalog.find((s) => Boolean(s.libraryId) && predicate(s)) ||
    VERIFIED_FILAMENT_CATALOG.find((s) => s.id === fallbackId)!
  );
};

const defaultSpools = [
  findOwnedOrBuiltIn((s) => s.name.toLowerCase() === 'black', 'bambu-pla-black'),
  findOwnedOrBuiltIn((s) => s.name.toLowerCase().includes('earth brown'), 'bambu-pla-brown'),
  findOwnedOrBuiltIn((s) => s.name.toLowerCase().includes('light brown'), 'bambu-pla-latte-brown'),
  findOwnedOrBuiltIn((s) => s.name.toLowerCase().includes('jade white'), 'bambu-pla-jade-white'),
];

export const useTailWagStore = create<TailWagState>((set) => ({
  projectName: 'Tucker_Boxer_Portrait',
  viewportMode: '3d-mesh',
  splitRatio: 0.5,
  lightAzimuthDeg: 38,
  lightElevationDeg: 58,
  backlitLithoMode: false,
  slicePreviewMaxLayer: 24,

  widthMm: 180,
  heightMm: 180,
  lockAspect: true,
  baseLayerMm: 0.16,
  baseSolidThicknessMm: 0.48,
  layerHeightMm: 0.08,
  totalLayers: 24,
  totalDepthMm: 2.00,
  meshResolution: 240,

  gamma: 1.08,
  contrast: 1.12,
  detailEnhance: 0.35,
  invertLuminance: false,

  cad: {
    shape: 'rounded',
    frameStyle: 'beveled',
    frameWidthMm: 5.0,
    frameHeightBonusMm: 0.48,
    clockMode: false,
    clockShaftDiameterMm: 8.2,
    clockMovementPocket: true,
    clockStencil: 'modern-arabic',
    keychainHole: false,
    keychainHoleDiameterMm: 4.5,
    magnetPockets: false,
    magnetDiameterMm: 8.2,
  },

  catalog: initialStoreData.catalog,
  importedLibraries: initialStoreData.importedLibraries,
  slots: [
    { id: 'slot-1', spool: defaultSpools[0], upToLayer: 6 },
    { id: 'slot-2', spool: defaultSpools[1], upToLayer: 12 },
    { id: 'slot-3', spool: defaultSpools[2], upToLayer: 17 },
    { id: 'slot-4', spool: defaultSpools[3], upToLayer: 24 },
  ],

  setProjectName: (projectName) => set({ projectName }),
  setViewportMode: (viewportMode) => set({ viewportMode }),
  setSplitRatio: (splitRatio) => set({ splitRatio }),
  setLighting: (lightAzimuthDeg, lightElevationDeg) => set({ lightAzimuthDeg, lightElevationDeg }),
  setBacklitLithoMode: (backlitLithoMode) => set({ backlitLithoMode }),
  setSlicePreviewMaxLayer: (slicePreviewMaxLayer) => set({ slicePreviewMaxLayer }),
  setDimensions: (widthMm, heightMm) => set({ widthMm, heightMm }),
  setLayerParams: (baseLayerMm, layerHeightMm, totalLayers) =>
    set((state) => {
      const updatedSlots = state.slots.map((s, idx) =>
        idx === state.slots.length - 1
          ? { ...s, upToLayer: totalLayers }
          : { ...s, upToLayer: Math.min(totalLayers - 1, s.upToLayer) }
      );
      const totalDepthMm = Number((baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2));
      return {
        baseLayerMm,
        layerHeightMm,
        totalLayers,
        totalDepthMm,
        slicePreviewMaxLayer: totalLayers,
        slots: updatedSlots,
      };
    }),
  setTotalDepthMm: (depthMm) =>
    set((state) => {
      const clampedMm = Math.max(0.6, Math.min(6.0, Number(depthMm) || 2.0));
      const nextTotalLayers = Math.max(
        4,
        1 + Math.round(Math.max(0, clampedMm - state.baseLayerMm) / state.layerHeightMm)
      );
      const snappedMm = Number((state.baseLayerMm + (nextTotalLayers - 1) * state.layerHeightMm).toFixed(2));
      const updatedSlots = state.slots.map((s, idx) =>
        idx === state.slots.length - 1
          ? { ...s, upToLayer: nextTotalLayers }
          : { ...s, upToLayer: Math.min(nextTotalLayers - 1, s.upToLayer) }
      );
      return {
        totalDepthMm: snappedMm,
        totalLayers: nextTotalLayers,
        slicePreviewMaxLayer: nextTotalLayers,
        slots: updatedSlots,
      };
    }),
  setBaseSolidThicknessMm: (thicknessMm) =>
    set((state) => {
      const clampedMm = Math.max(state.baseLayerMm, Math.min(3.2, Number(thicknessMm) || state.baseLayerMm));
      const baseLayers = Math.max(
        1,
        1 + Math.round(Math.max(0, clampedMm - state.baseLayerMm) / state.layerHeightMm)
      );
      const snappedMm = Number((state.baseLayerMm + (baseLayers - 1) * state.layerHeightMm).toFixed(2));
      const N = state.slots.length;
      const nextTotalLayers = Math.max(state.totalLayers, baseLayers + Math.max(8, N * 2));
      const nextTotalDepthMm = Number((state.baseLayerMm + (nextTotalLayers - 1) * state.layerHeightMm).toFixed(2));
      const nextSlots = state.slots.map((s) => ({ ...s }));
      if (N > 1) {
        const baseSlotEnd = Math.max(1, Math.min(nextTotalLayers - (N - 1), baseLayers + 1));
        nextSlots[0].upToLayer = baseSlotEnd;
        for (let i = 1; i < N - 1; i++) {
          if (nextSlots[i].upToLayer <= nextSlots[i - 1].upToLayer) {
            nextSlots[i].upToLayer = Math.min(
              nextTotalLayers - (N - 1 - i),
              nextSlots[i - 1].upToLayer + 1
            );
          }
        }
        nextSlots[N - 1].upToLayer = nextTotalLayers;
      } else if (N === 1) {
        nextSlots[0].upToLayer = nextTotalLayers;
      }
      return {
        baseSolidThicknessMm: snappedMm,
        totalLayers: nextTotalLayers,
        totalDepthMm: nextTotalDepthMm,
        slicePreviewMaxLayer: nextTotalLayers,
        slots: nextSlots,
      };
    }),
  setMeshResolution: (meshResolution) => set({ meshResolution }),
  setPrePress: (partial) => set((state) => ({ ...state, ...partial })),
  setCadConfig: (partial) => set((state) => ({ cad: { ...state.cad, ...partial } })),
  setSlots: (slots) => set({ slots }),
  updateSlotLayer: (slotId, upToLayer) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.id === slotId);
      if (idx === -1) return state;
      const next = state.slots.map((s) => ({ ...s }));
      const N = next.length;

      // If dragging the top/last slot's slider, adjust the boundary of the slot right below it (its start layer - 1)
      const targetIdx = idx === N - 1 ? Math.max(0, N - 2) : idx;
      const minAllowed = targetIdx + 1;
      const maxAllowed = state.totalLayers - (N - 1 - targetIdx);
      const clamped = Math.max(minAllowed, Math.min(maxAllowed, upToLayer));
      next[targetIdx].upToLayer = clamped;

      // Cascade downward if earlier slots overlap
      for (let i = targetIdx - 1; i >= 0; i--) {
        if (next[i].upToLayer >= next[i + 1].upToLayer) {
          next[i].upToLayer = Math.max(i + 1, next[i + 1].upToLayer - 1);
        }
      }
      // Cascade upward if later slots overlap
      for (let i = targetIdx + 1; i < N - 1; i++) {
        if (next[i].upToLayer <= next[i - 1].upToLayer) {
          next[i].upToLayer = Math.min(state.totalLayers - (N - 1 - i), next[i - 1].upToLayer + 1);
        }
      }
      next[N - 1].upToLayer = state.totalLayers;
      return { slots: next };
    }),
  updateSlotSpool: (slotId, spool) =>
    set((state) => ({
      slots: state.slots.map((s) => (s.id === slotId ? { ...s, spool } : s)),
    })),
  addSlot: (spool) =>
    set((state) => {
      if (state.slots.length >= 16) return state;
      const nextSlots = [
        ...state.slots,
        {
          id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          spool,
          upToLayer: state.totalLayers,
        },
      ];
      const count = nextSlots.length;
      const nextTotalLayers = Math.max(state.totalLayers, count * 2);
      const minBaseLayer = Math.min(Math.max(2, Math.floor(nextTotalLayers / count)), 6);
      const distributed = nextSlots.map((s, idx) => {
        if (idx === count - 1) return { ...s, upToLayer: nextTotalLayers };
        if (idx === 0) return { ...s, upToLayer: minBaseLayer };
        const frac = idx / (count - 1);
        const targetL = Math.round(minBaseLayer + frac * (nextTotalLayers - minBaseLayer));
        const clampedL = Math.max(idx + 1, Math.min(nextTotalLayers - (count - 1 - idx), targetL));
        return { ...s, upToLayer: clampedL };
      });
      for (let i = 1; i < count; i++) {
        if (distributed[i].upToLayer <= distributed[i - 1].upToLayer) {
          distributed[i] = { ...distributed[i], upToLayer: Math.min(nextTotalLayers, distributed[i - 1].upToLayer + 1) };
        }
      }
      distributed[count - 1] = { ...distributed[count - 1], upToLayer: nextTotalLayers };
      return {
        totalLayers: nextTotalLayers,
        slicePreviewMaxLayer: nextTotalLayers,
        slots: distributed,
      };
    }),
  insertSpoolAt: (spool, targetIndex) =>
    set((state) => {
      if (state.slots.length >= 16) return state;
      const nextSlots = [...state.slots];
      const insertIdx =
        targetIndex === undefined
          ? nextSlots.length
          : Math.max(0, Math.min(nextSlots.length, targetIndex));
      nextSlots.splice(insertIdx, 0, {
        id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        spool,
        upToLayer: state.totalLayers,
      });
      const count = nextSlots.length;
      const nextTotalLayers = Math.max(state.totalLayers, count * 2);
      const minBaseLayer = Math.min(Math.max(2, Math.floor(nextTotalLayers / count)), 6);
      const distributed = nextSlots.map((s, idx) => {
        if (idx === count - 1) return { ...s, upToLayer: nextTotalLayers };
        if (idx === 0) return { ...s, upToLayer: minBaseLayer };
        const frac = idx / (count - 1);
        const targetL = Math.round(minBaseLayer + frac * (nextTotalLayers - minBaseLayer));
        const clampedL = Math.max(idx + 1, Math.min(nextTotalLayers - (count - 1 - idx), targetL));
        return { ...s, upToLayer: clampedL };
      });
      for (let i = 1; i < count; i++) {
        if (distributed[i].upToLayer <= distributed[i - 1].upToLayer) {
          distributed[i] = { ...distributed[i], upToLayer: Math.min(nextTotalLayers, distributed[i - 1].upToLayer + 1) };
        }
      }
      distributed[count - 1] = { ...distributed[count - 1], upToLayer: nextTotalLayers };
      return {
        totalLayers: nextTotalLayers,
        slicePreviewMaxLayer: nextTotalLayers,
        slots: distributed,
      };
    }),
  reorderSlots: (fromIndex, toIndex) =>
    set((state) => {
      const N = state.slots.length;
      if (
        fromIndex < 0 ||
        fromIndex >= N ||
        toIndex < 0 ||
        toIndex >= N ||
        fromIndex === toIndex
      ) {
        return state;
      }
      // Capture current monotonic layer boundaries before reordering spools
      const layerBoundaries = state.slots.map((s) => s.upToLayer).sort((a, b) => a - b);
      layerBoundaries[N - 1] = state.totalLayers;
      for (let i = 1; i < N; i++) {
        if (layerBoundaries[i] <= layerBoundaries[i - 1]) {
          layerBoundaries[i] = Math.min(state.totalLayers, layerBoundaries[i - 1] + 1);
        }
      }

      const reordered = [...state.slots];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      const updated = reordered.map((slot, idx) => ({
        ...slot,
        upToLayer: layerBoundaries[idx],
      }));
      return { slots: updated };
    }),
  distributeSlotsEvenly: () =>
    set((state) => {
      const count = state.slots.length;
      if (count === 0) return state;
      if (count === 1) {
        return { slots: [{ ...state.slots[0], upToLayer: state.totalLayers }] };
      }
      const minBaseLayer = Math.min(Math.max(2, Math.floor(state.totalLayers / count)), 6);
      const distributed = state.slots.map((s, idx) => {
        if (idx === count - 1) return { ...s, upToLayer: state.totalLayers };
        if (idx === 0) return { ...s, upToLayer: minBaseLayer };
        const frac = idx / (count - 1);
        const targetL = Math.round(minBaseLayer + frac * (state.totalLayers - minBaseLayer));
        const clampedL = Math.max(idx + 1, Math.min(state.totalLayers - (count - 1 - idx), targetL));
        return { ...s, upToLayer: clampedL };
      });
      for (let i = 1; i < count; i++) {
        if (distributed[i].upToLayer <= distributed[i - 1].upToLayer) {
          distributed[i] = { ...distributed[i], upToLayer: Math.min(state.totalLayers, distributed[i - 1].upToLayer + 1) };
        }
      }
      distributed[count - 1] = { ...distributed[count - 1], upToLayer: state.totalLayers };
      return { slots: distributed };
    }),
  removeSlot: (slotId) =>
    set((state) => {
      if (state.slots.length <= 1) return state;
      const filtered = state.slots.filter((s) => s.id !== slotId);
      const count = filtered.length;
      for (let i = 0; i < count - 1; i++) {
        const maxAllowed = state.totalLayers - (count - 1 - i);
        const minAllowed = i === 0 ? 1 : filtered[i - 1].upToLayer + 1;
        filtered[i] = {
          ...filtered[i],
          upToLayer: Math.max(minAllowed, Math.min(maxAllowed, filtered[i].upToLayer)),
        };
      }
      filtered[count - 1] = {
        ...filtered[count - 1],
        upToLayer: state.totalLayers,
      };
      return { slots: filtered };
    }),
  addCustomSpoolToCatalog: (spool) =>
    set((state) => {
      const next = [spool, ...state.catalog];
      saveStoreDataToStorage(next, state.importedLibraries);
      return { catalog: next };
    }),
  toggleSpoolOwned: (spoolId) =>
    set((state) => {
      const next = state.catalog.map((s) => (s.id === spoolId ? { ...s, owned: !s.owned } : s));
      saveStoreDataToStorage(next, state.importedLibraries);
      return { catalog: next };
    }),
  syncAmsSpools: (amsSpools) =>
    set((state) => {
      const merged = [...amsSpools];
      for (const existing of state.catalog) {
        if (!merged.some((m) => m.id === existing.id)) {
          merged.push(existing);
        }
      }
      saveStoreDataToStorage(merged, state.importedLibraries);
      return { catalog: merged };
    }),
  importOwnedLibraryJson: (importedSpools, mode = 'replace', libraryMeta) =>
    set((state) => {
      const normalizedImported = importedSpools.map((s) => ({ ...s, owned: true }));
      const baseCatalog =
        mode === 'replace'
          ? CLEAN_BUILTIN_CATALOG
          : state.catalog;

      const merged: FilamentSpool[] = [...normalizedImported, ...baseCatalog];

      const nextLibs: ImportedLibraryMeta[] = libraryMeta
        ? mode === 'replace'
          ? [libraryMeta]
          : [...state.importedLibraries.filter((l) => l.id !== libraryMeta.id), libraryMeta]
        : state.importedLibraries;

      saveStoreDataToStorage(merged, nextLibs);
      return { catalog: merged, importedLibraries: nextLibs };
    }),
  removeImportedLibrary: (libraryId) =>
    set((state) => {
      const nextLibs = state.importedLibraries.filter((l) => l.id !== libraryId);
      const remainingCatalog = state.catalog
        .filter((s) => s.libraryId !== libraryId)
        .map((s) => (nextLibs.length === 0 ? { ...s, owned: false, libraryId: undefined } : s));

      const finalCatalog =
        nextLibs.length === 0 ? CLEAN_BUILTIN_CATALOG : remainingCatalog;

      saveStoreDataToStorage(finalCatalog, nextLibs);
      return { catalog: finalCatalog, importedLibraries: nextLibs };
    }),
  clearAllImportedLibraries: () =>
    set(() => {
      saveStoreDataToStorage(CLEAN_BUILTIN_CATALOG, []);
      return { catalog: CLEAN_BUILTIN_CATALOG, importedLibraries: [] };
    }),
}));
