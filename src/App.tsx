import React, { useState, useMemo, useRef } from 'react';
import {
  Dog,
  Upload,
  Crop as CropIcon,
  Sparkles,
  Ruler,
  Package,
  Sliders,
  Box,
  Sun,
  Eye,
  Clock,
  Magnet,
  Key,
  Search,
  CheckCircle2,
  Cpu,
  FileJson,
  Download,
  Trash2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Plus,
  Hand,
  Pencil,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
} from 'lucide-react';
import { useTailWagStore } from './store/useTailWagStore';
import { createDefaultPortraitImageData } from './utils/defaultPortrait';
import { buildHeightmapGrid, MeshShapeMode, FrameStyle, ClockStencilStyle } from './engine/cadMeshBuilder';
import {
  solveOptimalPalettes,
  solveCmykPalette,
  optimizeManualSlotBoundaries,
  SolverRecipe,
} from './engine/autoSolver';
import { parseFilamentLibraryJson, serializeFilamentLibraryJson } from './utils/filamentJsonIO';
import { Viewport3D } from './components/Viewport3D';
import { LayerTimeline } from './components/LayerTimeline';
import { TdCalibratorModal } from './components/TdCalibratorModal';
import { CalibrationPlateModal } from './components/CalibrationPlateModal';
import { APP_VERSION } from './appVersion';
import { UpdateModal } from './components/UpdateModal';
import { recordError } from './engine/debugInfo';
import { PhotoEditorModal, type PhotoEditResult } from './components/PhotoEditorModal';
import { AppHeader } from './components/AppHeader';
import { SolverPanel } from './components/panels/SolverPanel';
import { PrintSizePanel } from './components/panels/PrintSizePanel';
import { ShapePanel } from './components/panels/ShapePanel';
import {
  DEFAULT_EDIT,
  FOCUS_SHARE,
  ORIGINAL_MAX_SIDE,
  applyPhotoEdit,
  cropPixelSize,
  maskForOutput,
} from './engine/photoEdit';
import { appHistory } from './store/appHistory';
import { useHistoryStatus } from './store/undoHistory';
import { buildProject, decodeFocus, decodeImage, parseProject } from './engine/projectFile';
import {
  canReopenLastProject,
  forgetLastProject,
  getLastProject,
  imageDataToDataUrl,
  noteOpenedProject,
  readProjectFile,
  saveProjectFile,
} from './utils/projectIO';
import { checkForUpdate, markChecked, shouldAutoCheckNow, type UpdateResult } from './engine/updateCheck';
import { OnboardingTour, hasSeenOnboarding } from './components/OnboardingTour';
import { ExportModal } from './components/ExportModal';
import { buildPrintPlan } from './engine/printPlan';
import { buildLayerColorLUT } from './engine/opticalTdEngine';
import { solveFaithfulPalette } from './engine/faithfulSolver';
import { FilamentLibraryModal, TdSourceBadge } from './components/FilamentLibraryModal';
import { SpoolEditModal } from './components/SpoolEditModal';
import {
  filterAndSortSpools,
  amsSlotsOf,
  solverUsable,
  nextStock,
  stockOf,
  STOCK_LABEL,
  type StockFilter,
  type SortMode,
} from './utils/libraryView';
import {
  computeStandardBedDimensions,
  STANDARD_BUILD_PLATE_MAX_BBOX_MM,
} from './engine/layerSliceConverter';

export const App: React.FC = () => {
  const defaultImg = useMemo(() => createDefaultPortraitImageData(320), []);
  const [sourceImageData, setSourceImageData] = useState<ImageData>(defaultImg.imageData);
  const [sourceDataUrl, setSourceDataUrl] = useState<string>(defaultImg.dataUrl);
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryTab, setLibraryTab] = useState<'owned' | 'all'>('owned');
  const [solverPoolMode, setSolverPoolMode] = useState<'owned' | 'shown'>('owned');
  const [amsFilter, setAmsFilter] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [solverColorCount, setSolverColorCount] = useState<4 | 7 | 8 | 12 | 16>(4);
  const [manualDragOverIdx, setManualDragOverIdx] = useState<number | 'append' | null>(null);
  const [manualDraggingSlotIdx, setManualDraggingSlotIdx] = useState<number | null>(null);
  const [jsonImportBanner, setJsonImportBanner] = useState<string | null>(null);
  const [solverRecipes, setSolverRecipes] = useState<SolverRecipe[]>([]);
  const [isTdModalOpen, setIsTdModalOpen] = useState(false);
  const [isCalPlateOpen, setIsCalPlateOpen] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [isPhotoEditorOpen, setIsPhotoEditorOpen] = useState(false);
  const { photoOriginal, photoEdit, focusMask, focusStrength, setPhotoState } = useTailWagStore();
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  // Keep the last error for "Copy debug info" (#49): banner errors and uncaught errors.
  React.useEffect(() => {
    if (jsonImportBanner && /^(Rejected|Error|JSON Parse Error)/.test(jsonImportBanner)) recordError('Project/library', jsonImportBanner);
  }, [jsonImportBanner]);
  React.useEffect(() => {
    const onError = (e: ErrorEvent) => recordError('App', e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => recordError('App', e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  React.useEffect(() => {
    // Quiet startup check (at most once a day, can be turned off in the About dialog).
    if (!shouldAutoCheckNow()) return;
    const t = setTimeout(async () => {
      const r = await checkForUpdate(APP_VERSION);
      markChecked();
      if (r.kind === 'update') setUpdateResult(r);
    }, 6000);
    return () => clearTimeout(t);
  }, []);
  React.useEffect(() => {
    // First launch only; the ? button in the header replays it.
    if (!hasSeenOnboarding()) {
      const t = setTimeout(() => setIsTourOpen(true), 3600);
      return () => clearTimeout(t);
    }
  }, []);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [editingSpoolId, setEditingSpoolId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const {
    projectName,
    setProjectName,
    viewportMode,
    setViewportMode,
    solverColorMode,
    setSolverColorMode,
    manualRelief,
    setManualRelief,
    slotsAdjusting,
    setSourceImageData: setStoreSourceImageData,
    lightAzimuthDeg,
    lightElevationDeg,
    setLighting,
    backlitLithoMode,
    setBacklitLithoMode,
    previewShading,
    setPreviewShading,
    matchMode,
    setMatchMode,
    widthMm,
    heightMm,
    setDimensions,
    baseLayerMm,
    baseSolidThicknessMm,
    setBaseSolidThicknessMm,
    layerHeightMm,
    totalLayers,
    totalDepthMm,
    setTotalDepthMm,
    setLayerParams,
    setSlicePreviewMaxLayer,
    meshResolution,
    setMeshResolution,
    gamma,
    contrast,
    detailEnhance,
    invertLuminance,
    setPrePress,
    cad,
    setCadConfig,
    catalog,
    importedLibraries,
    slots,
    setSlots,
    addSlot,
    insertSpoolAt,
    reorderSlots,
    distributeSlotsEvenly,
    updateSlotSpool,
    removeSlot,
    toggleSpoolOwned,
    updateSpool,
    importOwnedLibraryJson,
    removeImportedLibrary,
  } = useTailWagStore();

  // Synchronize initial default portrait image with store for automatic boundary tuning
  React.useEffect(() => {
    setStoreSourceImageData(defaultImg.imageData);
  }, [defaultImg, setStoreSourceImageData]);

  // Faithful mode picks each column's depth by color match against the current stack's layer colors
  // In Manual mode the user can choose a fixed, brightness-based relief; otherwise the relief is re-matched.
  const wantMatch = matchMode === 'faithful' && slots.length > 0 && !(solverColorMode === 'manual' && manualRelief === 'fixed');
  const liveMatchLut = useMemo(
    () => (wantMatch ? buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots).map((e) => e.rgb) : null),
    [wantMatch, slots, totalLayers, baseLayerMm, layerHeightMm]
  );
  // While a layer slider is being dragged the relief holds still, then re-matches once on release.
  const heldMatchLut = useRef(liveMatchLut);
  if (!slotsAdjusting || liveMatchLut === null || heldMatchLut.current === null) heldMatchLut.current = liveMatchLut;
  const matchLut = heldMatchLut.current;

  // Compute 2.5D Heightmap Grid reactively
  const grid = useMemo(
    () =>
      buildHeightmapGrid({
        imageData: sourceImageData,
        gridRes: meshResolution,
        widthMm,
        heightMm,
        baseLayerMm,
        baseSolidThicknessMm,
        layerHeightMm,
        totalLayers,
        gamma,
        contrast,
        detailEnhance,
        invertLuminance,
        cad,
        colorMatch: matchLut ? { lutRgb: matchLut } : undefined,
      }),
    [
      sourceImageData,
      meshResolution,
      widthMm,
      heightMm,
      baseLayerMm,
      baseSolidThicknessMm,
      layerHeightMm,
      totalLayers,
      gamma,
      contrast,
      detailEnhance,
      invertLuminance,
      cad,
      matchLut,
    ]
  );

  // Single source of truth for what will be printed: the viewport and every export read this plan.
  const plan = useMemo(
    () => buildPrintPlan({ grid, slots, baseLayerMm, layerHeightMm, totalLayers }),
    [grid, slots, baseLayerMm, layerHeightMm, totalLayers]
  );

  // Owned spools are strictly and exclusively the spools loaded from filaments.json
  const ownedSpools = useMemo(() => catalog.filter((s) => Boolean(s.libraryId)), [catalog]);
  const builtInSpools = useMemo(() => catalog.filter((s) => !s.libraryId), [catalog]);
  const hasOwnedLibrary = importedLibraries.length > 0 && ownedSpools.length > 0;
  const effectiveLibraryTab = hasOwnedLibrary ? libraryTab : 'all';
  const effectiveSolverPoolMode = hasOwnedLibrary ? solverPoolMode : 'shown';

  const amsSlotOptions = useMemo(() => amsSlotsOf(catalog), [catalog]);

  const filteredCatalog = useMemo(() => {
    const baseList = effectiveLibraryTab === 'owned' ? ownedSpools : builtInSpools;
    return filterAndSortSpools(baseList, {
      query: searchQuery,
      ams: amsFilter,
      stock: stockFilter,
      sort: sortMode,
    });
  }, [effectiveLibraryTab, ownedSpools, builtInSpools, searchQuery, amsFilter, stockFilter, sortMode]);

  // Spools marked "Out" are never offered to the auto-solver.
  const getCandidatePoolForMode = (mode: 'owned' | 'shown', customOwnedList?: typeof catalog) => {
    if (mode === 'owned') {
      const owned = solverUsable(customOwnedList ?? ownedSpools);
      if (owned.length >= 2) return owned;
    }
    const shown = solverUsable(filteredCatalog);
    return shown.length >= 2 ? shown : solverUsable(builtInSpools);
  };

  // Faithful mode searches spools, order and swap layers for the closest match to the photo's own
  // colors; the earlier saturation-boosted recipes are kept after it so they stay selectable.
  const solvePalettes = (...args: Parameters<typeof solveOptimalPalettes>): SolverRecipe[] => {
    const [image, pool, layers, base, lh, colors, baseSolid] = args;
    const legacy = solveOptimalPalettes(...args);
    if (matchMode !== 'faithful') return legacy;
    // The focus area (#46) is lined up with the current picture, which is what the solver gets here
    const { focusImageMask, focusStrength } = useTailWagStore.getState();
    const focus = focusImageMask && focusImageMask.width === image.width && focusImageMask.height === image.height ? focusImageMask : null;
    const faithful = solveFaithfulPalette(image, pool, layers, base, lh, colors ?? 4, baseSolid, {
      focus,
      focusShare: FOCUS_SHARE[focusStrength],
    });
    return faithful.length > 0 ? [...faithful, ...legacy] : legacy;
  };

  // ---- Projects: save and open a whole piece of work ------------------------------------------
  const planRef = useRef(plan);
  planRef.current = plan;
  const history = useHistoryStatus();
  const [lastProject, setLastProject] = useState(() => (canReopenLastProject() ? getLastProject() : null));

  const applyProjectText = (text: string, filePath?: string) => {
    const parsed = parseProject(text);
    if (!parsed.ok) {
      setJsonImportBanner(`Rejected: ${parsed.error}`);
      return;
    }
    const project = parsed.project;
    const decoded = decodeImage(project.image);
    const image = new ImageData(new Uint8ClampedArray(decoded.data), decoded.width, decoded.height);
    setSourceImageData(image);
    setSourceDataUrl(imageDataToDataUrl(image));
    useTailWagStore.getState().loadProject(project, image);
    // Crop and focus extras (#46); projects without them start from the saved picture
    const focus = decodeFocus(project);
    if (project.original && project.photoEdit) {
      const o = decodeImage(project.original);
      const original = new ImageData(new Uint8ClampedArray(o.data), o.width, o.height);
      const mask = focus ? { width: focus.width, height: focus.height, data: focus.data } : null;
      setPhotoState({
        photoOriginal: original,
        photoEdit: project.photoEdit,
        focusMask: mask,
        focusStrength: focus?.strength ?? 'balanced',
        focusImageMask: mask ? maskForOutput(mask, o.width, o.height, project.photoEdit, image.width, image.height) : null,
      });
    } else {
      setPhotoState({ photoOriginal: image, photoEdit: DEFAULT_EDIT, focusMask: null, focusStrength: 'balanced', focusImageMask: null });
    }
    appHistory.clear();
    noteOpenedProject(filePath, project.name);
    setLastProject(null);
    setJsonImportBanner(`Opened project "${project.name}"`);
    // The same picture and settings must give the same print plan; say so if they do not.
    if (project.planHash) {
      window.setTimeout(() => {
        if (planRef.current.hash !== project.planHash) {
          setJsonImportBanner(
            `Opened "${project.name}", but it now builds a slightly different model than when it was saved (TailWag was updated). Check the preview before printing.`
          );
        }
      }, 2500);
    }
  };

  const handleSaveProject = async () => {
    const s = useTailWagStore.getState();
    const project = buildProject(
      {
        projectName: s.projectName,
        widthMm: s.widthMm,
        heightMm: s.heightMm,
        lockAspect: s.lockAspect,
        baseLayerMm: s.baseLayerMm,
        baseSolidThicknessMm: s.baseSolidThicknessMm,
        layerHeightMm: s.layerHeightMm,
        totalLayers: s.totalLayers,
        totalDepthMm: s.totalDepthMm,
        meshResolution: s.meshResolution,
        gamma: s.gamma,
        contrast: s.contrast,
        detailEnhance: s.detailEnhance,
        invertLuminance: s.invertLuminance,
        cad: s.cad,
        matchMode: s.matchMode,
        solverColorMode: s.solverColorMode,
        manualRelief: s.manualRelief,
        previewShading: s.previewShading,
        backlitLithoMode: s.backlitLithoMode,
        viewportMode: s.viewportMode,
        splitRatio: s.splitRatio,
        slots: s.slots,
        sourceImageData,
        photoOriginal: s.photoOriginal,
        photoEdit: s.photoEdit,
        focusMask: s.focusMask,
        focusStrength: s.focusStrength,
      },
      APP_VERSION,
      planRef.current.hash
    );
    try {
      const res = await saveProjectFile(project);
      if (res.saved) setJsonImportBanner(`Saved project "${project.name}"`);
    } catch (e) {
      setJsonImportBanner(`Rejected: The project could not be saved (${e instanceof Error ? e.message : 'unknown error'}).`);
    }
  };

  const handleOpenProject = async (path?: string) => {
    const res = await readProjectFile(path);
    if (!res) return;
    if ('error' in res) {
      setJsonImportBanner(`Rejected: ${res.error}`);
      if (path) {
        forgetLastProject();
        setLastProject(null);
      }
      return;
    }
    applyProjectText(res.text, res.filePath);
  };

  const projectActionsRef = useRef({ save: handleSaveProject, open: handleOpenProject });
  projectActionsRef.current = { save: handleSaveProject, open: handleOpenProject };
  React.useEffect(() => {
    const inTextField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
      if (el.tagName !== 'INPUT') return false;
      const type = (el as HTMLInputElement).type;
      return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button';
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!e.shiftKey && k === 's') {
        e.preventDefault();
        void projectActionsRef.current.save();
      } else if (!e.shiftKey && k === 'o') {
        e.preventDefault();
        void projectActionsRef.current.open();
      } else if (k === 'z' && !inTextField(e.target)) {
        e.preventDefault();
        if (e.shiftKey) appHistory.redo();
        else appHistory.undo();
      } else if (k === 'y' && !e.shiftKey && !inTextField(e.target)) {
        e.preventDefault();
        appHistory.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    setProjectName(baseName);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const maxDim = 420;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(64, Math.round(img.width * scale));
        const h = Math.max(64, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        const newImgData = ctx.getImageData(0, 0, w, h);

        // Keep a larger copy of the whole photo so it can be cropped later without losing detail (#46)
        const oScale = Math.min(1, ORIGINAL_MAX_SIDE / Math.max(img.width, img.height));
        const ow = Math.max(1, Math.round(img.width * oScale));
        const oh = Math.max(1, Math.round(img.height * oScale));
        const oCanvas = document.createElement('canvas');
        oCanvas.width = ow;
        oCanvas.height = oh;
        const octx = oCanvas.getContext('2d')!;
        octx.drawImage(img, 0, 0, ow, oh);
        setPhotoState({
          photoOriginal: octx.getImageData(0, 0, ow, oh),
          photoEdit: DEFAULT_EDIT,
          focusMask: null,
          focusImageMask: null,
        });

        adoptPhoto(newImgData, img.width, img.height, dataUrl);
        setIsPhotoEditorOpen(true);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  /**
   * Uses a new or edited picture: sizes the print to its shape and picks the filaments again,
   * exactly as loading a photo does. pixelW/H are the photo's real size (for the aspect ratio).
   */
  const adoptPhoto = (newImgData: ImageData, pixelW: number, pixelH: number, dataUrl?: string, resize = true) => {
    setSourceImageData(newImgData);
    setStoreSourceImageData(newImgData);
    appHistory.clear(); // undo must never carry edits from the old photo onto the new one
    setSourceDataUrl(dataUrl ?? imageDataToDataUrl(newImgData));

    if (resize) {
      // Standardized 246x246mm build plate envelope sizing preserving exact aspect ratio
      const { widthMm: stdW, heightMm: stdH } = computeStandardBedDimensions(pixelW, pixelH, STANDARD_BUILD_PLATE_MAX_BBOX_MM);
      setDimensions(stdW, stdH);
    }

    // Automatically switch to 3D Filament Painted view and run AI Palette Auto-Solver using active pool mode & color count
    setViewportMode('3d-mesh');
    if (solverColorMode === 'manual') {
      setSlots(optimizeManualSlotBoundaries(newImgData, slots, totalLayers, baseLayerMm, layerHeightMm, baseSolidThicknessMm));
      return;
    }
    const targetLayers = Math.max(24, solverColorCount * 2);
    if (targetLayers !== totalLayers) {
      setLayerParams(baseLayerMm, layerHeightMm, targetLayers);
    } else {
      setSlicePreviewMaxLayer(targetLayers);
    }
    const pool = getCandidatePoolForMode(effectiveSolverPoolMode);
    const recipes =
      solverColorMode === 'cmyk'
        ? [solveCmykPalette(newImgData, pool, targetLayers, baseLayerMm, layerHeightMm, solverColorCount)]
        : solvePalettes(newImgData, pool, targetLayers, baseLayerMm, layerHeightMm, solverColorCount, baseSolidThicknessMm, totalDepthMm);
    setSolverRecipes(recipes);
    if (recipes.length > 0) {
      setSlots(recipes[0].slots);
    }
  };

  const handleApplyPhotoEdit = ({ edit, mask, strength }: PhotoEditResult) => {
    const s = useTailWagStore.getState();
    const original = s.photoOriginal ?? sourceImageData;
    const sameGeometry = JSON.stringify(edit) === JSON.stringify(s.photoEdit);
    // Untouched geometry keeps the exact picture the app already has; only the focus changes
    let image = sourceImageData;
    if (!sameGeometry) {
      const out = applyPhotoEdit(original, edit);
      image = new ImageData(new Uint8ClampedArray(out.data), out.width, out.height);
    }
    setPhotoState({
      photoOriginal: original,
      photoEdit: edit,
      focusMask: mask,
      focusStrength: strength,
      focusImageMask: mask ? maskForOutput(mask, original.width, original.height, edit, image.width, image.height) : null,
    });
    const px = cropPixelSize(original.width, original.height, edit);
    adoptPhoto(image, px.width, px.height, sameGeometry ? sourceDataUrl : undefined, !sameGeometry);
    setIsPhotoEditorOpen(false);
  };

  const handleRunAiSolver = (
    modeOverride?: 'owned' | 'shown',
    colorCountOverride?: 4 | 7 | 8 | 12 | 16,
    colorModeOverride?: 'natural' | 'cmyk' | 'manual'
  ) => {
    const activeMode = modeOverride ?? effectiveSolverPoolMode;
    const activeColors = colorCountOverride ?? solverColorCount;
    let activeColorMode = colorModeOverride ?? solverColorMode;

    if (modeOverride) {
      setSolverPoolMode(modeOverride);
    }
    if (colorCountOverride) {
      setSolverColorCount(colorCountOverride);
      // Auto-switch to natural AI solver mode if in manual mode so selecting 4/8/12/16 colors always re-solves and re-renders!
      if (activeColorMode === 'manual') {
        activeColorMode = 'natural';
        setSolverColorMode('natural');
      }
    }
    if (colorModeOverride) {
      setSolverColorMode(colorModeOverride);
    }
    if (activeColorMode === 'manual') {
      return;
    }

    // Adapt totalLayers: keep 24 standard unless 16 colors requires 32 layers
    const targetLayers = Math.max(24, activeColors * 2);
    if (targetLayers !== totalLayers) {
      setLayerParams(baseLayerMm, layerHeightMm, targetLayers);
    } else {
      setSlicePreviewMaxLayer(targetLayers);
    }

    const pool = getCandidatePoolForMode(activeMode);
    const recipes =
      activeColorMode === 'cmyk'
        ? [solveCmykPalette(sourceImageData, pool, targetLayers, baseLayerMm, layerHeightMm, activeColors)]
        : solvePalettes(
            sourceImageData,
            pool,
            targetLayers,
            baseLayerMm,
            layerHeightMm,
            activeColors,
            baseSolidThicknessMm,
            totalDepthMm
          );
    setSolverRecipes(recipes);
    if (recipes.length > 0) {
      setSlots(recipes[0].slots);
    }
    // Ensure 3D painted relief view is active and visible
    if (viewportMode === 'source') {
      setViewportMode('3d-mesh');
    }
  };

  const handleManualDropOnSlot = (e: React.DragEvent, targetIdx: number, replaceExisting = false) => {
    e.preventDefault();
    e.stopPropagation();
    setManualDragOverIdx(null);

    const fromSlotStr = e.dataTransfer.getData('application/x-tailwag-slot-index');
    if (fromSlotStr !== '') {
      const fromIdx = parseInt(fromSlotStr, 10);
      if (!Number.isNaN(fromIdx) && fromIdx !== targetIdx) {
        reorderSlots(fromIdx, targetIdx);
      }
      setManualDraggingSlotIdx(null);
      return;
    }

    const spoolId =
      e.dataTransfer.getData('application/x-tailwag-spool-id') ||
      e.dataTransfer.getData('text/plain');
    if (spoolId) {
      const found = catalog.find((c) => c.id === spoolId);
      if (found) {
        if (solverColorMode !== 'manual') setSolverColorMode('manual');
        if (replaceExisting || e.shiftKey || slots.length >= 16) {
          updateSlotSpool(slots[targetIdx].id, found);
        } else {
          insertSpoolAt(found, targetIdx);
        }
      }
    }
  };

  const handleManualDropAppend = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setManualDragOverIdx(null);

    const fromSlotStr = e.dataTransfer.getData('application/x-tailwag-slot-index');
    if (fromSlotStr !== '') {
      const fromIdx = parseInt(fromSlotStr, 10);
      if (!Number.isNaN(fromIdx) && fromIdx !== slots.length - 1) {
        reorderSlots(fromIdx, slots.length - 1);
      }
      setManualDraggingSlotIdx(null);
      return;
    }

    const spoolId =
      e.dataTransfer.getData('application/x-tailwag-spool-id') ||
      e.dataTransfer.getData('text/plain');
    if (spoolId) {
      const found = catalog.find((c) => c.id === spoolId);
      if (found) {
        if (solverColorMode !== 'manual') setSolverColorMode('manual');
        insertSpoolAt(found);
      }
    }
  };

  const handleFilamentJsonUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Strictly require the uploaded file to be named filaments.json
    if (file.name.toLowerCase() !== 'filaments.json') {
      setJsonImportBanner('Error: Imported file must be named "filaments.json".');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = String(ev.target?.result || '');
        const result = parseFilamentLibraryJson(text, 'filaments.json');
        if (result.spools.length === 0) {
          setJsonImportBanner('No valid filament entries found in filaments.json.');
          return;
        }
        importOwnedLibraryJson(result.spools, 'replace', {
          id: result.libraryId,
          name: 'filaments.json',
          count: result.spools.length,
        });
        setLibraryTab('owned');
        setSolverPoolMode('owned');
        setJsonImportBanner(
          `Loaded ${result.spools.length} spools from filaments.json (${result.sourceFormat.toUpperCase()})`
        );

        // Immediately re-solve active image against the newly imported Owned library
        if (result.spools.length >= 2) {
          const effectiveLayers = Math.max(totalLayers, solverColorCount * 2);
          const recipes = solvePalettes(
            sourceImageData,
            result.spools,
            effectiveLayers,
            baseLayerMm,
            layerHeightMm,
            solverColorCount,
            baseSolidThicknessMm,
            totalDepthMm
          );
          setSolverRecipes(recipes);
          if (recipes.length > 0) {
            setSlots(recipes[0].slots);
          }
        }
      } catch (err) {
        setJsonImportBanner(
          `JSON Parse Error: ${err instanceof Error ? err.message : 'Invalid filaments.json file'}`
        );
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportOwnedJson = () => {
    const jsonStr = serializeFilamentLibraryJson(ownedSpools);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filaments.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0b0e14] text-slate-100 overflow-hidden">
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
      <AppHeader
        updateResult={updateResult}
        canUndo={history.undoCount > 0}
        canRedo={history.redoCount > 0}
        onUndo={() => appHistory.undo()}
        onRedo={() => appHistory.redo()}
        onOpenProject={() => void handleOpenProject()}
        onSaveProject={() => void handleSaveProject()}
        onLoadPhoto={() => fileInputRef.current?.click()}
        onEditPhoto={() => setIsPhotoEditorOpen(true)}
        onOpenAbout={() => setIsUpdateOpen(true)}
        onOpenTdCalibrator={() => setIsTdModalOpen(true)}
        onOpenCalibrationPlate={() => setIsCalPlateOpen(true)}
        onOpenTour={() => setIsTourOpen(true)}
        onExport={() => setIsExportModalOpen(true)}
      />

      {lastProject && (
        <div className="px-4 py-1.5 bg-sky-500/10 border-b border-sky-500/30 text-[11px] text-sky-200 flex items-center gap-3">
          <span className="truncate">Reopen your last project, "{lastProject.name}"?</span>
          <button
            onClick={() => void handleOpenProject(lastProject.path)}
            className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-bold"
          >
            Reopen
          </button>
          <button
            onClick={() => {
              forgetLastProject();
              setLastProject(null);
            }}
            className="hover:text-white underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Main 3-Column Studio Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR: Filament TD Catalog & Pre-Press Lab */}
        <aside data-tour="library" className="w-80 bg-[#121722] border-r border-slate-800 flex flex-col min-h-0 shrink-0">
          {/* Verified Filament TD Library */}
          <div className="p-3 border-b border-slate-800 flex flex-col gap-2 flex-1 min-h-0">
            {/* Header & .JSON Library Import / Export */}
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Filament Library
              </span>
              <div className="flex items-center gap-1">
                <input
                  ref={jsonInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFilamentJsonUpload}
                  className="hidden"
                />
                <button
                  onClick={() => setIsLibraryModalOpen(true)}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 font-semibold transition"
                  title="Browse the manufacturer catalog or add a filament manually"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
                <button
                  onClick={() => jsonInputRef.current?.click()}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-orange-600/20 hover:bg-orange-600/35 border border-orange-500/40 text-orange-300 font-semibold transition"
                  title="Import your Owned Filament Library (file must be named filaments.json)"
                >
                  <FileJson className="w-3 h-3" />
                  Import filaments.json
                </button>
                <button
                  onClick={handleExportOwnedJson}
                  className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition"
                  title="Export Owned Filaments to filaments.json"
                >
                  <Download className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Top Tab Bar: Owned tab only exists when filaments.json is loaded */}
            {hasOwnedLibrary ? (
              <div className="grid grid-cols-2 gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setLibraryTab('owned')}
                  className={`py-1 px-2 rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    effectiveLibraryTab === 'owned'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Owned ({ownedSpools.length})
                </button>
                <button
                  onClick={() => setLibraryTab('all')}
                  className={`py-1 px-2 rounded-md text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    effectiveLibraryTab === 'all'
                      ? 'bg-orange-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Catalog ({builtInSpools.length})
                </button>
              </div>
            ) : (
              <div className="bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setLibraryTab('all')}
                  className="w-full py-1 px-2 rounded-md text-xs font-bold bg-orange-600 text-white shadow flex items-center justify-center gap-1.5"
                >
                  All Catalog ({builtInSpools.length})
                </button>
              </div>
            )}

            {/* Loaded filaments.json Library with Remove option (only shown on Owned tab or when loaded) */}
            {hasOwnedLibrary && effectiveLibraryTab === 'owned' && (
              <div className="flex flex-col gap-1">
                {importedLibraries.map((lib) => (
                  <div
                    key={lib.id}
                    className="text-[11px] px-2 py-1 rounded-md bg-slate-900/90 border border-slate-700/80 text-slate-200 flex items-center justify-between gap-1.5"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileJson className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate font-medium">{lib.name}</span>
                      <span className="text-[10px] text-emerald-400 font-mono shrink-0">
                        ({lib.count})
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        removeImportedLibrary(lib.id);
                        setLibraryTab('all');
                        setSolverPoolMode('shown');
                        setJsonImportBanner(`Removed "${lib.name}" — Owned tab closed`);
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[10px] font-semibold transition shrink-0"
                      title={`Remove ${lib.name} and close Owned tab`}
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {jsonImportBanner && (
              <div
                className={`text-[10px] px-2 py-1 rounded flex items-center justify-between gap-1 ${
                  jsonImportBanner.startsWith('Rejected:')
                    ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                    : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                }`}
              >
                <span className="truncate">{jsonImportBanner}</span>
                <button
                  onClick={() => setJsonImportBanner(null)}
                  className="hover:text-white font-bold px-1"
                >
                  ×
                </button>
              </div>
            )}

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  effectiveLibraryTab === 'owned'
                    ? 'Search your filaments.json spools...'
                    : 'Search Bambu, Polymaker, Sunlu, TD...'
                }
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <select
                value={amsFilter}
                onChange={(e) => setAmsFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-orange-500"
                aria-label="Filter by AMS slot"
                title="Filter by AMS slot"
              >
                <option value="all">All slots</option>
                <option value="loaded">Loaded in AMS</option>
                <option value="none">Not in AMS</option>
                {amsSlotOptions.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
              <select
                value={stockFilter}
                onChange={(e) => setStockFilter(e.target.value as StockFilter)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-orange-500"
                aria-label="Filter by stock"
                title="Filter by stock"
              >
                <option value="all">Any stock</option>
                <option value="available">Available</option>
                <option value="ok">In stock</option>
                <option value="low">Low</option>
                <option value="out">Out</option>
              </select>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-orange-500"
                aria-label="Sort filaments"
                title="Sort filaments"
              >
                <option value="default">Default order</option>
                <option value="td-asc">TD low → high</option>
                <option value="td-desc">TD high → low</option>
                <option value="lightness">Dark → light</option>
                <option value="name">Name</option>
                <option value="brand">Brand</option>
              </select>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredCatalog.length === 0 ? (
                <div className="text-center py-6 px-3 text-xs text-slate-400 bg-slate-900/50 rounded-lg border border-slate-800/80">
                  <span>No filaments match "{searchQuery}".</span>
                </div>
              ) : (
                filteredCatalog.map((spool) => (
                  <div
                    key={spool.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-tailwag-spool-id', spool.id);
                      e.dataTransfer.setData('text/plain', spool.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title="Drag this filament onto the Palette or Layer Timeline, or click + Stack"
                    className="bg-[#181f2e] hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-lg p-2 flex items-center justify-between gap-2 transition cursor-grab active:cursor-grabbing"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-slate-500 hover:text-slate-300 shrink-0">
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <button
                        onClick={() => toggleSpoolOwned(spool.id)}
                        className="relative shrink-0"
                        title="Toggle Owned in Workshop Inventory"
                      >
                        <span
                          className="block w-5 h-5 rounded-full border border-white/30 shadow"
                          style={{ backgroundColor: spool.hex }}
                        />
                        {spool.owned && (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 bg-slate-950 rounded-full absolute -bottom-0.5 -right-0.5" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100 truncate">
                          {spool.name}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                          <span className="text-slate-300 font-medium">{spool.brand}</span>
                          <span>•</span>
                          <span className="px-1 rounded bg-slate-800 text-slate-300">{spool.material}</span>
                          <span>•</span>
                          <span className="text-orange-400 font-mono">TD {spool.td.toFixed(1)}mm</span>
                          <TdSourceBadge source={spool.tdSource} calibration={spool.calibration} />
                          <button
                            onClick={() => updateSpool(spool.id, { stock: nextStock(spool.stock) })}
                            title="Click to cycle stock: In stock → Low → Out (Out is skipped by the auto-solver)"
                            className={`px-1 rounded text-[9px] font-semibold border ${
                              stockOf(spool) === 'ok'
                                ? 'border-slate-700 text-slate-400 hover:text-slate-200'
                                : stockOf(spool) === 'low'
                                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                                  : 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                            }`}
                          >
                            {STOCK_LABEL[stockOf(spool)]}
                          </button>
                          {spool.amsSlot && (
                            <span className="px-1 rounded bg-sky-500/20 text-sky-300 font-mono">
                              {spool.amsSlot}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditingSpoolId(spool.id)}
                        className="p-1 rounded bg-slate-900 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition"
                        title="Edit this filament (name, color, TD, AMS slot)"
                        aria-label={`Edit ${spool.name}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => addSlot(spool)}
                        disabled={slots.length >= 16}
                        className="px-2 py-1 rounded bg-slate-900 hover:bg-orange-600 text-[11px] font-semibold text-slate-300 hover:text-white border border-slate-700 transition disabled:opacity-40"
                      >
                        + Stack
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Pre-Press Photo & Fur Detail Enhancement Lab */}
          <div data-tour="prepress" className="p-3 bg-[#0f141e] flex flex-col gap-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                Pre-Press Photo & Fur Lab
              </span>
              <button
                onClick={() =>
                  setPrePress({ gamma: 1.0, contrast: 1.0, detailEnhance: 0.25, invertLuminance: false })
                }
                className="text-[10px] text-slate-400 hover:text-white"
              >
                Reset
              </button>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Fur & Whisker Micro-Contrast</span>
                <span className="font-mono text-orange-400">{Math.round(detailEnhance * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={detailEnhance}
                onInput={(e) => setPrePress({ detailEnhance: parseFloat((e.target as HTMLInputElement).value) })}
                onChange={(e) => setPrePress({ detailEnhance: parseFloat(e.target.value) })}
                className="w-full accent-orange-500 h-1.5 cursor-pointer"
              />

              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Midtone Gamma Curve</span>
                <span className="font-mono text-orange-400">{gamma.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.4}
                max={2.2}
                step={0.04}
                value={gamma}
                onInput={(e) => setPrePress({ gamma: parseFloat((e.target as HTMLInputElement).value) })}
                onChange={(e) => setPrePress({ gamma: parseFloat(e.target.value) })}
                className="w-full accent-orange-500 h-1.5 cursor-pointer"
              />

              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Dynamic Range Contrast</span>
                <span className="font-mono text-orange-400">{contrast.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.6}
                max={1.8}
                step={0.04}
                value={contrast}
                onInput={(e) => setPrePress({ contrast: parseFloat((e.target as HTMLInputElement).value) })}
                onChange={(e) => setPrePress({ contrast: parseFloat(e.target.value) })}
                className="w-full accent-orange-500 h-1.5 cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={invertLuminance}
                    onChange={(e) => setPrePress({ invertLuminance: e.target.checked })}
                    className="accent-orange-500"
                  />
                  Invert Negative / Backlit Litho
                </label>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Eye className="w-3 h-3" />
                  <input
                    type="range"
                    min={-80}
                    max={80}
                    value={lightAzimuthDeg}
                    onInput={(e) => setLighting(parseInt((e.target as HTMLInputElement).value, 10), lightElevationDeg)}
                    onChange={(e) => setLighting(parseInt(e.target.value, 10), lightElevationDeg)}
                    className="w-16 accent-orange-500 h-1 cursor-pointer"
                    title="Rotate Studio Key Light Azimuth"
                  />
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER: 3D Beer-Lambert Viewport + Bottom Layer Swap Timeline */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div data-tour="viewport" className="flex-1 min-h-0 relative">
            <Viewport3D grid={grid} plan={plan} sourceDataUrl={sourceDataUrl} />
          </div>
          <div data-tour="timeline" className="shrink-0"><LayerTimeline /></div>
        </main>

        {/* RIGHT: pick filaments, print size, shape and extras */}
        <aside className="w-80 max-w-80 bg-tw-panel border-l border-tw-line flex flex-col min-h-0 overflow-y-auto overflow-x-hidden p-4 gap-5 shrink-0">
          <SolverPanel
            onSolve={handleRunAiSolver}
            hasOwnedLibrary={hasOwnedLibrary}
            poolMode={effectiveSolverPoolMode}
            ownedCount={ownedSpools.length}
            shownCount={filteredCatalog.length}
            colorCount={solverColorCount}
            recipes={solverRecipes}
            manualDrag={{
              overIdx: manualDragOverIdx,
              setOverIdx: setManualDragOverIdx,
              draggingIdx: manualDraggingSlotIdx,
              setDraggingIdx: setManualDraggingSlotIdx,
              onDropOnSlot: handleManualDropOnSlot,
              onDropAppend: handleManualDropAppend,
            }}
          />
          <div className="h-px bg-tw-line shrink-0" aria-hidden="true" />
          <PrintSizePanel />
          <div className="h-px bg-tw-line shrink-0" aria-hidden="true" />
          <ShapePanel />
        </aside>
      </div>

      {/* Modals */}
      <TdCalibratorModal isOpen={isTdModalOpen} onClose={() => setIsTdModalOpen(false)} />
      <CalibrationPlateModal isOpen={isCalPlateOpen} onClose={() => setIsCalPlateOpen(false)} />
      <OnboardingTour isOpen={isTourOpen} onClose={() => setIsTourOpen(false)} />
      <UpdateModal isOpen={isUpdateOpen} onClose={() => setIsUpdateOpen(false)} result={updateResult} onResult={setUpdateResult} planHash={plan.hash} />
      <FilamentLibraryModal isOpen={isLibraryModalOpen} onClose={() => setIsLibraryModalOpen(false)} />
      <SpoolEditModal spoolId={editingSpoolId} onClose={() => setEditingSpoolId(null)} />
      <PhotoEditorModal
        isOpen={isPhotoEditorOpen}
        onClose={() => setIsPhotoEditorOpen(false)}
        onApply={handleApplyPhotoEdit}
        original={photoOriginal ?? sourceImageData}
        edit={photoEdit}
        mask={focusMask}
        strength={focusStrength}
        focusApplies={matchMode === 'faithful' && solverColorMode === 'natural'}
      />
      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} grid={grid} plan={plan} />
    </div>
  );
};
