import { create } from 'zustand';
import { FilamentSpool, VERIFIED_FILAMENT_CATALOG } from '../data/filamentCatalog';
import { LayerSwapSlot } from '../engine/opticalTdEngine';
import { CadCutoutConfig } from '../engine/cadMeshBuilder';
import { magnetBackingPatch, touchesMagnets } from '../engine/magnetBacking';
import { parseFilamentLibraryJson } from '../utils/filamentJsonIO';
import { optimizeManualSlotBoundaries } from '../engine/autoSolver';
import { createDefaultPortraitImageData } from '../utils/defaultPortrait';
import { projectSlots, type ProjectFile } from '../engine/projectFile';
import { DEFAULT_EDIT, type FocusStrength, type Mask, type PhotoEdit } from '../engine/photoEdit';
import userDefaultFilamentsRaw from '../data/userDefaultFilaments.json';
import {
  addSpoolToMyLibrary,
  updateSpoolInCatalog,
  removeSpoolFromMyLibrary,
  withTdSource,
  syncMyLibraryMeta,
  SEED_LIBRARY_ID,
  MY_LIBRARY_ID,
} from '../utils/myLibrary';

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
  /** 'accuracy' shows the predicted sRGB color of every column unlit; 'beauty' adds studio lighting. */
  previewShading: 'accuracy' | 'beauty';
  /** 'faithful' matches the photo's own colors; 'vivid' keeps the boosted-saturation luminance mapping. */
  matchMode: 'faithful' | 'vivid';
  slicePreviewMaxLayer: number;
  renderVersion: number;
  solverColorMode: 'natural' | 'cmyk' | 'manual';
  /** Manual mode relief: re-match the photo after a slider is released, or keep the brightness-based relief fixed. */
  manualRelief: 'rematch' | 'fixed';
  /** True while a layer slider is being dragged; the relief holds still until it ends. */
  slotsAdjusting: boolean;
  sourceImageData: ImageData | null;

  // Crop, rotate and focus (#46). sourceImageData is the edited picture; these keep how it was made.
  /** The whole photo before cropping (up to ORIGINAL_MAX_SIDE) */
  photoOriginal: ImageData | null;
  photoEdit: PhotoEdit;
  /** Focus area in the original photo's coordinates */
  focusMask: Mask | null;
  focusStrength: FocusStrength;
  /** The focus area lined up with sourceImageData, for the solver and the fidelity report */
  focusImageMask: Mask | null;
  /** Subject found by the cutout model, lined up with sourceImageData (0..255) */
  subjectMask: Mask | null;
  subjectStatus: { kind: 'idle' | 'busy' | 'error'; message?: string };

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
  setPreviewShading: (mode: 'accuracy' | 'beauty') => void;
  setMatchMode: (mode: 'faithful' | 'vivid') => void;
  setSlicePreviewMaxLayer: (layer: number) => void;
  setSourceImageData: (imageData: ImageData | null) => void;
  setPhotoState: (
    partial: Partial<
      Pick<TailWagState, 'photoOriginal' | 'photoEdit' | 'focusMask' | 'focusStrength' | 'focusImageMask' | 'subjectMask' | 'subjectStatus'>
    >
  ) => void;
  setSolverColorMode: (mode: 'natural' | 'cmyk' | 'manual') => void;
  setManualRelief: (mode: 'rematch' | 'fixed') => void;
  /** Replaces the whole project (picture, stack, settings) with a validated project file. */
  loadProject: (project: ProjectFile, image: ImageData) => void;
  triggerReRender: () => void;
  setDimensions: (widthMm: number, heightMm: number) => void;
  setLayerParams: (baseLayerMm: number, layerHeightMm: number, totalLayers: number) => void;
  setLockAspect: (lock: boolean) => void;
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
  /** Adds to "My Filaments" (owned). Returns an error message when rejected, else null. */
  addSpoolToMyFilaments: (spool: FilamentSpool) => string | null;
  updateSpool: (spoolId: string, patch: Partial<FilamentSpool>, opts?: { force?: boolean }) => void;
  removeMySpool: (spoolId: string) => void;
  toggleSpoolOwned: (spoolId: string) => void;
  syncAmsSpools: (amsSpools: FilamentSpool[]) => void;
  importOwnedLibraryJson: (
    importedSpools: FilamentSpool[],
    mode?: 'replace' | 'merge',
    libraryMeta?: ImportedLibraryMeta
  ) => void;
  removeImportedLibrary: (libraryId: string) => void;
  clearAllImportedLibraries: () => void;
  /** Replaces the owned spools with the list after a sync with Paws and Pennies. */
  applySharedSpools: (owned: FilamentSpool[]) => void;
}

function getInitialImageData(): ImageData | null {
  try {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      return createDefaultPortraitImageData(320).imageData;
    }
  } catch {
    // fallback if canvas or 2d context unavailable
  }
  return null;
}

const CATALOG_STORAGE_KEY = 'tailwag_catalog_v4';
const LIBS_STORAGE_KEY = 'tailwag_imported_libs_v4';

const CLEAN_BUILTIN_CATALOG: FilamentSpool[] = VERIFIED_FILAMENT_CATALOG.map((s) => ({
  ...s,
  owned: false,
  libraryId: undefined,
  libraryName: undefined,
  tdSource: 'estimate' as const,
}));

function buildSeededDefaultState(): { catalog: FilamentSpool[]; importedLibraries: ImportedLibraryMeta[] } {
  try {
    const parsedSeed = parseFilamentLibraryJson(
      JSON.stringify(userDefaultFilamentsRaw),
      'filaments.json',
      SEED_LIBRARY_ID
    );
    if (parsedSeed.spools.length > 0) {
      const merged: FilamentSpool[] = [...parsedSeed.spools.map(withTdSource), ...CLEAN_BUILTIN_CATALOG];
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
              ...withTdSource(s),
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

const MANUAL_RELIEF_KEY = 'tailwag_manual_relief';

/** How the relief behaves in Manual mode: 'rematch' re-picks each depth after you let go, 'fixed' keeps the photo-brightness relief. */
function loadManualRelief(): 'rematch' | 'fixed' {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(MANUAL_RELIEF_KEY) === 'fixed' ? 'fixed' : 'rematch';
  } catch {
    return 'rematch';
  }
}

/** Once the user is in Manual mode their swap layers are theirs: nothing re-solves them. */
const isManual = (state: { solverColorMode: string }): boolean => state.solverColorMode === 'manual';

/** Keeps boundaries the user chose, changing them only where needed to stay valid. */
function clampEnds(slots: LayerSwapSlot[], totalLayers: number): LayerSwapSlot[] {
  const N = slots.length;
  const out = slots.map((s) => ({ ...s }));
  for (let i = 0; i < N - 1; i++) {
    const min = i === 0 ? 1 : out[i - 1].upToLayer + 1;
    const max = totalLayers - (N - 1 - i);
    out[i].upToLayer = Math.max(min, Math.min(max, out[i].upToLayer));
  }
  if (N > 0) out[N - 1].upToLayer = totalLayers;
  return out;
}

/**
 * Makes room for a newly added slot by splitting its neighbour's range, leaving every other
 * boundary where the user put it. Returns null when there is no room to split.
 */
function splitForNewSlot(prev: LayerSwapSlot[], next: LayerSwapSlot[], newIdx: number, total: number): LayerSwapSlot[] | null {
  const N = next.length;
  const out = next.map((s) => ({ ...s }));
  const oldEnds = prev.map((s) => s.upToLayer);
  if (newIdx === N - 1) {
    const start = (N >= 3 ? oldEnds[N - 3] : 0) + 1;
    if (total - start < 1) return null;
    out[N - 2].upToLayer = start + Math.floor((total - start) / 2);
    out[N - 1].upToLayer = total;
    return out;
  }
  const prevEnd = newIdx === 0 ? 0 : oldEnds[newIdx - 1];
  const nextEnd = oldEnds[newIdx];
  if (nextEnd - prevEnd < 2) return null;
  for (let i = 0; i < N; i++) {
    if (i < newIdx) out[i].upToLayer = oldEnds[i];
    else if (i > newIdx) out[i].upToLayer = oldEnds[i - 1];
  }
  out[newIdx].upToLayer = prevEnd + Math.max(1, Math.floor((nextEnd - prevEnd) / 2));
  return out;
}

let adjustTimer: ReturnType<typeof setTimeout> | undefined;

/** Marks a slider drag as in progress and ends it shortly after the last movement. */
function scheduleAdjustEnd(set: (partial: { slotsAdjusting: boolean }) => void) {
  if (adjustTimer) clearTimeout(adjustTimer);
  adjustTimer = setTimeout(() => set({ slotsAdjusting: false }), 350);
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

export const useTailWagStore = create<TailWagState>((set, get) => ({
  projectName: 'Tucker_Boxer_Portrait',
  viewportMode: '3d-mesh',
  splitRatio: 0.5,
  lightAzimuthDeg: 38,
  lightElevationDeg: 58,
  backlitLithoMode: false,
  previewShading: 'accuracy',
  matchMode: 'faithful',
  slicePreviewMaxLayer: 24,
  renderVersion: 0,
  solverColorMode: 'natural',
  manualRelief: loadManualRelief(),
  slotsAdjusting: false,
  sourceImageData: getInitialImageData(),
  photoOriginal: null,
  photoEdit: DEFAULT_EDIT,
  focusMask: null,
  focusStrength: 'balanced',
  focusImageMask: null,
  subjectMask: null,
  subjectStatus: { kind: 'idle' },

  setPhotoState: (partial) => set(partial),
  setSourceImageData: (imageData) =>
    set((state) => ({
      sourceImageData: imageData,
      renderVersion: (state.renderVersion ?? 0) + 1,
    })),
  setSolverColorMode: (mode) => set({ solverColorMode: mode }),
  setManualRelief: (manualRelief) => {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(MANUAL_RELIEF_KEY, manualRelief);
    } catch {
      // ignore storage errors
    }
    set((state) => ({ manualRelief, renderVersion: (state.renderVersion ?? 0) + 1 }));
  },
  loadProject: (project, image) =>
    set((state) => ({
      ...project.settings,
      cad: { ...state.cad, ...project.settings.cad },
      projectName: project.name,
      slots: projectSlots(project),
      sourceImageData: image,
      slicePreviewMaxLayer: project.settings.totalLayers,
      slotsAdjusting: false,
      renderVersion: (state.renderVersion ?? 0) + 1,
    })),  triggerReRender: () =>
    set((state) => ({
      renderVersion: (state.renderVersion ?? 0) + 1,
    })),

  widthMm: 246,
  heightMm: 246,
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
    magnetDiameterMm: 8,
    magnetThicknessMm: 1,
    magnetLayout: 'corners',
    subjectMarginMm: 3,
    subjectSmoothMm: 2,
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
  setPreviewShading: (previewShading) => set({ previewShading }),
  setMatchMode: (matchMode) =>
    set((state) => {
      // Re-tune the swap layers for the new objective so the stack stays consistent with the mode
      let slots = state.slots;
      if (state.sourceImageData && state.slots.length > 1) {
        slots = optimizeManualSlotBoundaries(
          state.sourceImageData,
          state.slots,
          state.totalLayers,
          state.baseLayerMm,
          state.layerHeightMm,
          state.baseSolidThicknessMm,
          matchMode
        );
      }
      return { matchMode, slots, renderVersion: (state.renderVersion ?? 0) + 1 };
    }),
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
  setLockAspect: (lockAspect) => set({ lockAspect }),
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
      const nextSlots = isManual(state) ? clampEnds(state.slots, nextTotalLayers) : state.slots.map((s) => ({ ...s }));
      if (isManual(state)) {
        // Manual mode: keep the boundaries the user set.
      } else if (N > 1) {
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
  setCadConfig: (partial) =>
    set((state) => {
      const cad = { ...state.cad, ...partial };
      // Magnets that don't fit get plain backing layers in the same step, so one undo takes both back
      return touchesMagnets(partial) ? magnetBackingPatch(state, state.cad, cad) : { cad };
    }),
  setSlots: (slots) =>
    set((state) => ({
      slots,
      renderVersion: (state.renderVersion ?? 0) + 1,
    })),
  updateSlotLayer: (slotId, upToLayer) => {
    scheduleAdjustEnd(set);
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
      return {
        slots: next,
        slotsAdjusting: true,
        solverColorMode: 'manual',
        renderVersion: (state.renderVersion ?? 0) + 1,
      };
    });
  },
  updateSlotSpool: (slotId, spool) =>
    set((state) => {
      const nextSlots = state.slots.map((s) => (s.id === slotId ? { ...s, spool } : s));
      let tuned = nextSlots;
      if (isManual(state)) {
        tuned = clampEnds(nextSlots, state.totalLayers);
      } else if (state.sourceImageData) {
        tuned = optimizeManualSlotBoundaries(
          state.sourceImageData,
          nextSlots,
          state.totalLayers,
          state.baseLayerMm,
          state.layerHeightMm,
          state.baseSolidThicknessMm,
          state.matchMode
        );
      }
      return {
        slots: tuned,
        solverColorMode: 'manual',
        viewportMode: state.viewportMode === 'source' ? '3d-mesh' : state.viewportMode,
        renderVersion: (state.renderVersion ?? 0) + 1,
      };
    }),
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
      const manualAdd =
        isManual(state) && nextTotalLayers === state.totalLayers
          ? splitForNewSlot(state.slots, nextSlots, nextSlots.length - 1, state.totalLayers)
          : null;
      let tuned = nextSlots;
      if (manualAdd) {
        tuned = manualAdd;
      } else if (state.sourceImageData) {
        tuned = optimizeManualSlotBoundaries(
          state.sourceImageData,
          nextSlots,
          nextTotalLayers,
          state.baseLayerMm,
          state.layerHeightMm,
          state.baseSolidThicknessMm,
          state.matchMode
        );
      } else {
        const minBaseLayer = Math.min(Math.max(2, Math.floor(nextTotalLayers / count)), 6);
        tuned = nextSlots.map((s, idx) => {
          if (idx === count - 1) return { ...s, upToLayer: nextTotalLayers };
          if (idx === 0) return { ...s, upToLayer: minBaseLayer };
          const frac = idx / (count - 1);
          const targetL = Math.round(minBaseLayer + frac * (nextTotalLayers - minBaseLayer));
          const clampedL = Math.max(idx + 1, Math.min(nextTotalLayers - (count - 1 - idx), targetL));
          return { ...s, upToLayer: clampedL };
        });
        for (let i = 1; i < count; i++) {
          if (tuned[i].upToLayer <= tuned[i - 1].upToLayer) {
            tuned[i] = { ...tuned[i], upToLayer: Math.min(nextTotalLayers, tuned[i - 1].upToLayer + 1) };
          }
        }
        tuned[count - 1] = { ...tuned[count - 1], upToLayer: nextTotalLayers };
      }
      return {
        totalLayers: nextTotalLayers,
        slicePreviewMaxLayer: nextTotalLayers,
        slots: tuned,
        solverColorMode: 'manual',
        viewportMode: state.viewportMode === 'source' ? '3d-mesh' : state.viewportMode,
        renderVersion: (state.renderVersion ?? 0) + 1,
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
      const manualAdd =
        isManual(state) && nextTotalLayers === state.totalLayers
          ? splitForNewSlot(state.slots, nextSlots, insertIdx, state.totalLayers)
          : null;
      let tuned = nextSlots;
      if (manualAdd) {
        tuned = manualAdd;
      } else if (state.sourceImageData) {
        tuned = optimizeManualSlotBoundaries(
          state.sourceImageData,
          nextSlots,
          nextTotalLayers,
          state.baseLayerMm,
          state.layerHeightMm,
          state.baseSolidThicknessMm,
          state.matchMode
        );
      } else {
        const minBaseLayer = Math.min(Math.max(2, Math.floor(nextTotalLayers / count)), 6);
        tuned = nextSlots.map((s, idx) => {
          if (idx === count - 1) return { ...s, upToLayer: nextTotalLayers };
          if (idx === 0) return { ...s, upToLayer: minBaseLayer };
          const frac = idx / (count - 1);
          const targetL = Math.round(minBaseLayer + frac * (nextTotalLayers - minBaseLayer));
          const clampedL = Math.max(idx + 1, Math.min(nextTotalLayers - (count - 1 - idx), targetL));
          return { ...s, upToLayer: clampedL };
        });
        for (let i = 1; i < count; i++) {
          if (tuned[i].upToLayer <= tuned[i - 1].upToLayer) {
            tuned[i] = { ...tuned[i], upToLayer: Math.min(nextTotalLayers, tuned[i - 1].upToLayer + 1) };
          }
        }
        tuned[count - 1] = { ...tuned[count - 1], upToLayer: nextTotalLayers };
      }
      return {
        totalLayers: nextTotalLayers,
        slicePreviewMaxLayer: nextTotalLayers,
        slots: tuned,
        solverColorMode: 'manual',
        viewportMode: state.viewportMode === 'source' ? '3d-mesh' : state.viewportMode,
        renderVersion: (state.renderVersion ?? 0) + 1,
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
      const reordered = [...state.slots];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      let tuned = reordered;
      if (isManual(state)) {
        // Boundaries are positions the user chose: they stay put and the filaments move between them.
        tuned = reordered.map((slot, idx) => ({ ...slot, upToLayer: state.slots[idx].upToLayer }));
      } else if (state.sourceImageData) {
        tuned = optimizeManualSlotBoundaries(
          state.sourceImageData,
          reordered,
          state.totalLayers,
          state.baseLayerMm,
          state.layerHeightMm,
          state.baseSolidThicknessMm,
          state.matchMode
        );
      } else {
        const layerBoundaries = state.slots.map((s) => s.upToLayer).sort((a, b) => a - b);
        layerBoundaries[N - 1] = state.totalLayers;
        for (let i = 1; i < N; i++) {
          if (layerBoundaries[i] <= layerBoundaries[i - 1]) {
            layerBoundaries[i] = Math.min(state.totalLayers, layerBoundaries[i - 1] + 1);
          }
        }
        tuned = reordered.map((slot, idx) => ({
          ...slot,
          upToLayer: layerBoundaries[idx],
        }));
      }

      return {
        slots: tuned,
        solverColorMode: 'manual',
        viewportMode: state.viewportMode === 'source' ? '3d-mesh' : state.viewportMode,
        renderVersion: (state.renderVersion ?? 0) + 1,
      };
    }),
  distributeSlotsEvenly: () =>
    set((state) => {
      const count = state.slots.length;
      if (count === 0) return state;
      if (count === 1) {
        return {
          slots: [{ ...state.slots[0], upToLayer: state.totalLayers }],
          solverColorMode: 'manual',
          renderVersion: (state.renderVersion ?? 0) + 1,
        };
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
      return {
        slots: distributed,
        solverColorMode: 'manual',
        renderVersion: (state.renderVersion ?? 0) + 1,
      };
    }),
  removeSlot: (slotId) =>
    set((state) => {
      if (state.slots.length <= 1) return state;
      const filtered = state.slots.filter((s) => s.id !== slotId);
      let tuned = filtered;
      if (isManual(state)) {
        tuned = clampEnds(filtered, state.totalLayers);
      } else if (state.sourceImageData) {
        tuned = optimizeManualSlotBoundaries(
          state.sourceImageData,
          filtered,
          state.totalLayers,
          state.baseLayerMm,
          state.layerHeightMm,
          state.baseSolidThicknessMm,
          state.matchMode
        );
      } else {
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
        tuned = filtered;
      }
      return {
        slots: tuned,
        solverColorMode: 'manual',
        viewportMode: state.viewportMode === 'source' ? '3d-mesh' : state.viewportMode,
        renderVersion: (state.renderVersion ?? 0) + 1,
      };
    }),
  addCustomSpoolToCatalog: (spool) =>
    set((state) => {
      const next = [spool, ...state.catalog];
      saveStoreDataToStorage(next, state.importedLibraries);
      return { catalog: next };
    }),
  addSpoolToMyFilaments: (spool) => {
    const state = get();
    const result = addSpoolToMyLibrary(state.catalog, state.importedLibraries, spool);
    if (result.rejected) return result.rejected;
    saveStoreDataToStorage(result.catalog, result.importedLibraries);
    set({ catalog: result.catalog, importedLibraries: result.importedLibraries });
    return null;
  },
  updateSpool: (spoolId, patch, opts) =>
    set((state) => {
      const next = updateSpoolInCatalog(state.catalog, spoolId, patch, opts);
      saveStoreDataToStorage(next, state.importedLibraries);
      const edited = next.find((s) => s.id === spoolId);

      // Slots hold copies of spools: keep them in sync, and re-tune swap layers when an
      // edited spool is actually in the stack (its color/TD changes the optical result).
      const usedInStack = !!edited && state.slots.some((s) => s.spool.id === spoolId);
      let slots = state.slots;
      if (edited && usedInStack) {
        slots = state.slots.map((s) => (s.spool.id === spoolId ? { ...s, spool: edited } : s));
        if (!isManual(state) && state.sourceImageData && (patch.hex !== undefined || patch.td !== undefined || patch.calibration !== undefined)) {
          slots = optimizeManualSlotBoundaries(
            state.sourceImageData,
            slots,
            state.totalLayers,
            state.baseLayerMm,
            state.layerHeightMm,
            state.baseSolidThicknessMm,
            state.matchMode
          );
        }
      }
      return { catalog: next, slots, renderVersion: (state.renderVersion ?? 0) + 1 };
    }),
  removeMySpool: (spoolId) =>
    set((state) => {
      const result = removeSpoolFromMyLibrary(state.catalog, state.importedLibraries, spoolId);
      saveStoreDataToStorage(result.catalog, result.importedLibraries);
      return { catalog: result.catalog, importedLibraries: result.importedLibraries };
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
  applySharedSpools: (owned) =>
    set((state) => {
      const byId = new Map(owned.map((s) => [s.id, s]));
      const known = new Set(state.catalog.map((s) => s.id));
      // Spools removed in Paws and Pennies leave My Filaments, and stop being owned if they came from elsewhere.
      const kept = state.catalog.flatMap((s) => {
        const shared = byId.get(s.id);
        if (shared) return [shared];
        if (!s.owned) return [s];
        return s.libraryId === MY_LIBRARY_ID ? [] : [{ ...s, owned: false }];
      });
      const catalog = [...owned.filter((s) => !known.has(s.id)), ...kept];
      const importedLibraries = syncMyLibraryMeta(catalog, state.importedLibraries);
      saveStoreDataToStorage(catalog, importedLibraries);
      // The stack holds copies of spools: keep their colour and TD current.
      const slots = state.slots.map((slot) => (byId.has(slot.spool.id) ? { ...slot, spool: byId.get(slot.spool.id)! } : slot));
      return { catalog, importedLibraries, slots };
    }),
}));
