import { create } from 'zustand';
import { FilamentSpool, VERIFIED_FILAMENT_CATALOG } from '../data/filamentCatalog';
import { LayerSwapSlot } from '../engine/opticalTdEngine';
import { CadCutoutConfig } from '../engine/cadMeshBuilder';

export type ViewportMode = '3d-mesh' | 'split' | 'source' | 'heightmap';

export interface TailWagState {
  projectName: string;
  viewportMode: ViewportMode;
  splitRatio: number; // 0..1
  lightAzimuthDeg: number;
  lightElevationDeg: number;
  backlitLithoMode: boolean;
  slicePreviewMaxLayer: number; // allows scrubbing down through individual printed layers

  // Physical & Slicer Layer Parameters
  widthMm: number;
  heightMm: number;
  lockAspect: boolean;
  baseLayerMm: number;
  layerHeightMm: number;
  totalLayers: number;
  meshResolution: number; // 180 (fast) | 280 (high) | 400 (ultra)

  // Pre-Press Image Enhancement Parameters
  gamma: number;
  contrast: number;
  detailEnhance: number;
  invertLuminance: boolean;

  // 2.5D Parametric CAD & Cutouts
  cad: CadCutoutConfig;

  // Filament Catalog & Active Layer Swap Stack
  catalog: FilamentSpool[];
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
  setMeshResolution: (res: number) => void;
  setPrePress: (partial: Partial<{ gamma: number; contrast: number; detailEnhance: number; invertLuminance: boolean }>) => void;
  setCadConfig: (partial: Partial<CadCutoutConfig>) => void;
  setSlots: (slots: LayerSwapSlot[]) => void;
  updateSlotLayer: (slotId: string, upToLayer: number) => void;
  updateSlotSpool: (slotId: string, spool: FilamentSpool) => void;
  addSlot: (spool: FilamentSpool) => void;
  removeSlot: (slotId: string) => void;
  addCustomSpoolToCatalog: (spool: FilamentSpool) => void;
  toggleSpoolOwned: (spoolId: string) => void;
  syncAmsSpools: (amsSpools: FilamentSpool[]) => void;
  importOwnedLibraryJson: (importedSpools: FilamentSpool[], mode?: 'replace' | 'merge') => void;
}

const STORAGE_KEY = 'tailwag_catalog_v1';

function loadInitialCatalog(): FilamentSpool[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return VERIFIED_FILAMENT_CATALOG;
}

function saveCatalogToStorage(catalog: FilamentSpool[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
    }
  } catch {
    // ignore storage errors
  }
}

const defaultSpools = [
  VERIFIED_FILAMENT_CATALOG.find((s) => s.id === 'bambu-pla-black')!,
  VERIFIED_FILAMENT_CATALOG.find((s) => s.id === 'bambu-pla-brown')!,
  VERIFIED_FILAMENT_CATALOG.find((s) => s.id === 'bambu-pla-orange')!,
  VERIFIED_FILAMENT_CATALOG.find((s) => s.id === 'bambu-pla-jade-white')!,
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
  baseLayerMm: 0.64,
  layerHeightMm: 0.08,
  totalLayers: 24,
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

  catalog: loadInitialCatalog(),
  slots: [
    { id: 'slot-1', spool: defaultSpools[0], upToLayer: 5 },
    { id: 'slot-2', spool: defaultSpools[1], upToLayer: 11 },
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
      return {
        baseLayerMm,
        layerHeightMm,
        totalLayers,
        slicePreviewMaxLayer: totalLayers,
        slots: updatedSlots,
      };
    }),
  setMeshResolution: (meshResolution) => set({ meshResolution }),
  setPrePress: (partial) => set((state) => ({ ...state, ...partial })),
  setCadConfig: (partial) => set((state) => ({ cad: { ...state.cad, ...partial } })),
  setSlots: (slots) => set({ slots }),
  updateSlotLayer: (slotId, upToLayer) =>
    set((state) => {
      const idx = state.slots.findIndex((s) => s.id === slotId);
      if (idx === -1 || idx === state.slots.length - 1) return state;
      const minLayer = idx === 0 ? 1 : state.slots[idx - 1].upToLayer + 1;
      const maxLayer = state.slots[idx + 1].upToLayer - 1;
      const clamped = Math.max(minLayer, Math.min(maxLayer, upToLayer));
      const next = [...state.slots];
      next[idx] = { ...next[idx], upToLayer: clamped };
      return { slots: next };
    }),
  updateSlotSpool: (slotId, spool) =>
    set((state) => ({
      slots: state.slots.map((s) => (s.id === slotId ? { ...s, spool } : s)),
    })),
  addSlot: (spool) =>
    set((state) => {
      if (state.slots.length >= 8) return state;
      const prevSlots = [...state.slots];
      const lastIdx = prevSlots.length - 1;
      const prevEnd = lastIdx > 0 ? prevSlots[lastIdx - 1].upToLayer : 2;
      const midLayer = Math.max(prevEnd + 1, Math.floor((prevEnd + state.totalLayers) / 2));
      prevSlots[lastIdx] = { ...prevSlots[lastIdx], upToLayer: midLayer };
      prevSlots.push({
        id: `slot-${Date.now()}`,
        spool,
        upToLayer: state.totalLayers,
      });
      return { slots: prevSlots };
    }),
  removeSlot: (slotId) =>
    set((state) => {
      if (state.slots.length <= 2) return state;
      const filtered = state.slots.filter((s) => s.id !== slotId);
      filtered[filtered.length - 1] = {
        ...filtered[filtered.length - 1],
        upToLayer: state.totalLayers,
      };
      return { slots: filtered };
    }),
  addCustomSpoolToCatalog: (spool) =>
    set((state) => {
      const next = [spool, ...state.catalog];
      saveCatalogToStorage(next);
      return { catalog: next };
    }),
  toggleSpoolOwned: (spoolId) =>
    set((state) => {
      const next = state.catalog.map((s) => (s.id === spoolId ? { ...s, owned: !s.owned } : s));
      saveCatalogToStorage(next);
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
      saveCatalogToStorage(merged);
      return { catalog: merged };
    }),
  importOwnedLibraryJson: (importedSpools, mode = 'replace') =>
    set((state) => {
      const normalizedImported = importedSpools.map((s) => ({ ...s, owned: true }));
      const baseCatalog = state.catalog.map((s) =>
        mode === 'replace' ? { ...s, owned: false } : s
      );

      const merged: FilamentSpool[] = [...normalizedImported];
      for (const existing of baseCatalog) {
        const isDuplicate = merged.some(
          (m) =>
            m.id === existing.id ||
            (m.brand.toLowerCase() === existing.brand.toLowerCase() &&
              m.name.toLowerCase() === existing.name.toLowerCase() &&
              m.hex.toLowerCase() === existing.hex.toLowerCase())
        );
        if (!isDuplicate) {
          merged.push(existing);
        }
      }
      saveCatalogToStorage(merged);
      return { catalog: merged };
    }),
}));
