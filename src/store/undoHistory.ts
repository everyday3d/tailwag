import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { TailWagState } from './useTailWagStore';

/**
 * Undo and redo for the edits a user makes while building a print: the filament stack and its swap
 * layers, size and layer settings, pre-press sliders, shape options and the colour/match mode.
 * The photo, the library and view-only settings are not part of the history.
 */
export const TRACKED_KEYS = [
  'slots',
  'widthMm',
  'heightMm',
  'lockAspect',
  'baseLayerMm',
  'baseSolidThicknessMm',
  'layerHeightMm',
  'totalLayers',
  'totalDepthMm',
  'meshResolution',
  'gamma',
  'contrast',
  'detailEnhance',
  'invertLuminance',
  'cad',
  'solverColorMode',
  'matchMode',
] as const;

export type Tracked = Pick<TailWagState, (typeof TRACKED_KEYS)[number]>;

/** Edits made within this time of the previous one are one step, so a slider drag is a single undo. */
export const COALESCE_MS = 600;
export const MAX_HISTORY = 100;

const pick = (s: TailWagState): Tracked => {
  const out: Record<string, unknown> = {};
  for (const k of TRACKED_KEYS) out[k] = s[k];
  return out as Tracked;
};

const changed = (a: Tracked, b: Tracked): boolean => TRACKED_KEYS.some((k) => a[k] !== b[k]);

/** Counts for the header buttons. */
export const useHistoryStatus = create<{ undoCount: number; redoCount: number }>(() => ({ undoCount: 0, redoCount: 0 }));

export interface History {
  undo: () => boolean;
  redo: () => boolean;
  /** Forget everything, for example after a new photo or project is loaded. */
  clear: () => void;
  dispose: () => void;
}

export function installHistory(store: UseBoundStore<StoreApi<TailWagState>>): History {
  let undoStack: Tracked[] = [];
  let redoStack: Tracked[] = [];
  let lastChange = 0;
  let restoring = false;

  const publish = () => useHistoryStatus.setState({ undoCount: undoStack.length, redoCount: redoStack.length });

  const unsubscribe = store.subscribe((state, prev) => {
    if (restoring) return;
    const before = pick(prev);
    if (!changed(before, pick(state))) return;
    const now = Date.now();
    if (now - lastChange > COALESCE_MS || undoStack.length === 0) {
      undoStack.push(before);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
    }
    lastChange = now;
    if (redoStack.length) redoStack = [];
    publish();
  });

  const apply = (snap: Tracked) => {
    restoring = true;
    try {
      store.setState((s) => ({
        ...snap,
        slicePreviewMaxLayer: snap.totalLayers,
        slotsAdjusting: false,
        renderVersion: (s.renderVersion ?? 0) + 1,
      }));
    } finally {
      restoring = false;
    }
    lastChange = 0;
  };

  return {
    undo: () => {
      const target = undoStack.pop();
      if (!target) return false;
      redoStack.push(pick(store.getState()));
      apply(target);
      publish();
      return true;
    },
    redo: () => {
      const target = redoStack.pop();
      if (!target) return false;
      undoStack.push(pick(store.getState()));
      apply(target);
      publish();
      return true;
    },
    clear: () => {
      undoStack = [];
      redoStack = [];
      lastChange = 0;
      publish();
    },
    dispose: () => {
      unsubscribe();
      undoStack = [];
      redoStack = [];
      publish();
    },
  };
}
