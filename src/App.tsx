import React, { useState, useMemo, useRef, useEffect } from 'react';
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
import { findSubjectNow } from './utils/subjectFinder';
import { loadPrintFonts } from './engine/printFonts';
import { squareCrop, templateSize, type PrintTemplate } from './engine/templates';
import { SolverPanel } from './components/panels/SolverPanel';
import { PrintSizePanel } from './components/panels/PrintSizePanel';
import { ShapePanel } from './components/panels/ShapePanel';
import { PhotoPanel } from './components/panels/PhotoPanel';
import { PhotoAdjustPanel } from './components/panels/PhotoAdjustPanel';
import { LibraryPanel } from './components/panels/LibraryPanel';
import {
  DEFAULT_EDIT,
  FOCUS_SHARE,
  ORIGINAL_MAX_SIDE,
  applyPhotoEdit,
  cropPixelSize,
  maskForOutput,
  type PhotoEdit,
} from './engine/photoEdit';
import type { RecolorRule } from './engine/recolor';
import { RecolorModal } from './components/RecolorModal';
import { appHistory } from './store/appHistory';
import { useHistoryStatus } from './store/undoHistory';
import { buildProject, decodeFocus, decodeImage, decodeSubject, parseProject } from './engine/projectFile';
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
import { useSpoolShare } from './utils/useSpoolShare';
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
  const spoolShare = useSpoolShare();
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
  const [isRecolorOpen, setIsRecolorOpen] = useState(false);
  const { photoOriginal, photoEdit, focusMask, focusStrength, setPhotoState, subjectMask } = useTailWagStore();
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

  // Text fonts load lazily; redraw the relief once the chosen ones are ready
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    let live = true;
    void loadPrintFonts([cad.clockFont ?? 'modern', cad.captionFont ?? 'modern']).then(() => live && setFontsLoaded((n) => n + 1));
    return () => {
      live = false;
    };
  }, [cad.clockFont, cad.captionFont]);

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
        // Only a cutout made for this exact picture is used
        subject:
          subjectMask && subjectMask.width === sourceImageData.width && subjectMask.height === sourceImageData.height ? subjectMask : null,
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
      subjectMask,
      fontsLoaded,
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
    setPhotoState({ subjectMask: decodeSubject(project), subjectStatus: { kind: 'idle' } });
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
        subjectMask: s.subjectMask,
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
      // A different picture needs its own cutout; find it again if the print is cut to the subject
      setPhotoState({ subjectMask: null, subjectStatus: { kind: 'idle' } });
      if (useTailWagStore.getState().cad.shape === 'subject') void findSubjectNow();
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

  /** "Fix photo": the same picture, cleaned up (photoEnhance.ts). Keeps the print size and cutout; picks filaments again. */
  const handleFixPhoto = (on: boolean) => applyPictureChange({ enhance: on });

  /** Recolour: "this colour should be that colour" (recolor.ts). Same path as Fix photo. */
  const handleApplyRecolor = (rules: RecolorRule[]) => {
    applyPictureChange({ recolor: rules });
    setIsRecolorOpen(false);
  };

  /** A change to the picture's colours only: keeps the print size and cutout, picks filaments again. */
  const applyPictureChange = (patch: Partial<PhotoEdit>) => {
    const s = useTailWagStore.getState();
    const original = s.photoOriginal ?? sourceImageData;
    const edit = { ...s.photoEdit, ...patch };
    const out = applyPhotoEdit(original, edit);
    setPhotoState({ photoOriginal: original, photoEdit: edit });
    const px = cropPixelSize(original.width, original.height, edit);
    adoptPhoto(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), px.width, px.height, undefined, false);
  };

  /** One click to a coaster, ornament, keychain, fridge magnet or desk stand (templates.ts). */
  const handleApplyTemplate = (t: PrintTemplate) => {
    const s = useTailWagStore.getState();
    // A circle needs a square photo; crop to a centred square first (adjustable in Edit photo)
    if (t.square && Math.abs(s.widthMm / s.heightMm - 1) > 0.01) {
      const original = s.photoOriginal ?? sourceImageData;
      handleApplyPhotoEdit({ edit: squareCrop(s.photoEdit, original.width, original.height), mask: s.focusMask, strength: s.focusStrength });
    }
    // Take out any magnet backing first, so the base is set from a clean state
    setCadConfig({ magnetPockets: false });
    setBaseSolidThicknessMm(t.solidBaseMm);
    const now = useTailWagStore.getState();
    const size = templateSize(t, now.widthMm / now.heightMm);
    setDimensions(size.widthMm, size.heightMm);
    setCadConfig({ ...t.cad, template: t.id });
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
        {/* LEFT: the photo, its adjustments and the filament library */}
        <aside className="w-80 bg-tw-panel border-r border-tw-line flex flex-col min-h-0 shrink-0 p-4 gap-5 overflow-y-auto">
          <PhotoPanel
            sourceDataUrl={sourceDataUrl}
            onEditPhoto={() => setIsPhotoEditorOpen(true)}
            onLoadPhoto={() => fileInputRef.current?.click()}
            onFixPhoto={handleFixPhoto}
            onRecolor={() => setIsRecolorOpen(true)}
          />
          <div className="h-px bg-tw-line shrink-0" aria-hidden="true" />
          <PhotoAdjustPanel />
          <div className="h-px bg-tw-line shrink-0" aria-hidden="true" />
          <LibraryPanel
            spools={filteredCatalog}
            hasOwnedLibrary={hasOwnedLibrary}
            tab={effectiveLibraryTab}
            onTab={setLibraryTab}
            ownedCount={ownedSpools.length}
            catalogCount={builtInSpools.length}
            search={searchQuery}
            onSearch={setSearchQuery}
            amsFilter={amsFilter}
            onAmsFilter={setAmsFilter}
            amsSlotOptions={amsSlotOptions}
            stockFilter={stockFilter}
            onStockFilter={setStockFilter}
            sortMode={sortMode}
            onSortMode={setSortMode}
            onImportJson={handleFilamentJsonUpload}
            onExportJson={handleExportOwnedJson}
            onOpenCatalog={() => setIsLibraryModalOpen(true)}
            onEditSpool={setEditingSpoolId}
            onRemoveLibrary={(id, name) => {
              removeImportedLibrary(id);
              setLibraryTab('all');
              setSolverPoolMode('shown');
              setJsonImportBanner(`Removed "${name}". Showing the catalog.`);
            }}
            message={jsonImportBanner}
            onDismissMessage={() => setJsonImportBanner(null)}
            share={spoolShare}
          />
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
          <ShapePanel onApplyTemplate={handleApplyTemplate} />
        </aside>
      </div>

      {/* Modals */}
      <TdCalibratorModal isOpen={isTdModalOpen} onClose={() => setIsTdModalOpen(false)} />
      <CalibrationPlateModal isOpen={isCalPlateOpen} onClose={() => setIsCalPlateOpen(false)} />
      <OnboardingTour isOpen={isTourOpen} onClose={() => setIsTourOpen(false)} />
      <UpdateModal isOpen={isUpdateOpen} onClose={() => setIsUpdateOpen(false)} result={updateResult} onResult={setUpdateResult} planHash={plan.hash} />
      <FilamentLibraryModal isOpen={isLibraryModalOpen} onClose={() => setIsLibraryModalOpen(false)} />
      <SpoolEditModal spoolId={editingSpoolId} onClose={() => setEditingSpoolId(null)} />
      <RecolorModal isOpen={isRecolorOpen} onClose={() => setIsRecolorOpen(false)} onApply={handleApplyRecolor} />
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
