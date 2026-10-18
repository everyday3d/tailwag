import React, { useState, useMemo, useRef } from 'react';
import {
  Dog,
  Upload,
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
  const matchLut = useMemo(
    () =>
      matchMode === 'faithful' && slots.length > 0
        ? buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots).map((e) => e.rgb)
        : null,
    [matchMode, slots, totalLayers, baseLayerMm, layerHeightMm]
  );

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
    const faithful = solveFaithfulPalette(image, pool, layers, base, lh, colors ?? 4, baseSolid);
    return faithful.length > 0 ? [...faithful, ...legacy] : legacy;
  };

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
        setSourceImageData(newImgData);
        setStoreSourceImageData(newImgData);
        setSourceDataUrl(dataUrl);

        // Standardized 246x246mm build plate envelope sizing preserving exact aspect ratio
        const { widthMm: stdW, heightMm: stdH } = computeStandardBedDimensions(
          img.width,
          img.height,
          STANDARD_BUILD_PLATE_MAX_BBOX_MM
        );
        setDimensions(stdW, stdH);

        // Automatically switch to 3D Filament Painted view and run AI Palette Auto-Solver using active pool mode & color count
        setViewportMode('3d-mesh');
        if (solverColorMode === 'manual') {
          setSlots(
            optimizeManualSlotBoundaries(
              newImgData,
              slots,
              totalLayers,
              baseLayerMm,
              layerHeightMm,
              baseSolidThicknessMm
            )
          );
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
            : solvePalettes(
                newImgData,
                pool,
                targetLayers,
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
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
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
      {/* Top Studio Header Bar */}
      <header className="h-13 bg-[#121722] border-b border-slate-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-md shadow-orange-500/20">
            <Dog className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-tight text-white">TAILWAG STUDIO</span>
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                v1.0 • TD Engine + MCP (experimental)
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              3D Filament Painting, Beer-Lambert TD Blending & Native Bambu/Orca .3MF Studio
            </p>
          </div>
        </div>

        {/* Center Viewport Mode Switcher */}
        <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setViewportMode('3d-mesh')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
              viewportMode === '3d-mesh' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            3D TD Relief
          </button>
          <button
            onClick={() => setViewportMode('split')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
              viewportMode === 'split' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Split Wipe Compare
          </button>
          <button
            onClick={() => setViewportMode('source')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
              viewportMode === 'source' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Source Photo
          </button>
          <div className="h-4 w-px bg-slate-800 mx-1" />
          <button
            onClick={() => setBacklitLithoMode(!backlitLithoMode)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
              backlitLithoMode
                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Toggle between Front-Lit Filament Painting and Back-Lit Lithophane Transmission"
          >
            <Sun className="w-3.5 h-3.5" />
            {backlitLithoMode ? 'Backlit Litho' : 'Front-Lit TD'}
          </button>
          <button
            onClick={() => setPreviewShading(previewShading === 'accuracy' ? 'beauty' : 'accuracy')}
            disabled={backlitLithoMode}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition disabled:opacity-40 ${
              previewShading === 'accuracy' && !backlitLithoMode
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Accuracy: unlit, shows the predicted print color of every column. Beauty: adds studio lighting and shading."
          >
            <Eye className="w-3.5 h-3.5" />
            {previewShading === 'accuracy' && !backlitLithoMode ? 'Accuracy' : 'Beauty'}
          </button>
          <button
            onClick={() => setMatchMode(matchMode === 'faithful' ? 'vivid' : 'faithful')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition ${
              matchMode === 'faithful'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40'
            }`}
            title="Faithful: match the photo's own colors as closely as the palette allows. Vivid: boost saturation and map brightness to height (the earlier behavior)."
          >
            {matchMode === 'faithful' ? 'Faithful' : 'Vivid'}
          </button>
        </div>

        {/* Right Primary Actions */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition"
          >
            <Upload className="w-3.5 h-3.5 text-orange-400" />
            Load Image
          </button>

          <button
            onClick={() => setIsTdModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition"
          >
            <Ruler className="w-3.5 h-3.5 text-sky-400" />
            TD Calibrator & AMS
          </button>

          <button
            onClick={() => setIsCalPlateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition"
          >
            <Ruler className="w-3.5 h-3.5 text-emerald-400" />
            Calibration Plate
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-bold text-white shadow-md shadow-orange-600/20 transition"
          >
            <Package className="w-4 h-4" />
            Export .3MF / .STL
          </button>
        </div>
      </header>

      {/* Main 3-Column Studio Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR: Filament TD Catalog & Pre-Press Lab */}
        <aside className="w-80 bg-[#121722] border-r border-slate-800 flex flex-col min-h-0 shrink-0">
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
          <div className="p-3 bg-[#0f141e] flex flex-col gap-2.5 shrink-0">
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
          <div className="flex-1 min-h-0 relative">
            <Viewport3D grid={grid} plan={plan} sourceDataUrl={sourceDataUrl} />
          </div>
          <LayerTimeline />
        </main>

        {/* RIGHT SIDEBAR: AI Auto-Solver, Slicer Geometry & 2.5D Parametric CAD Cutouts */}
        <aside className="w-80 max-w-80 bg-[#121722] border-l border-slate-800 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden p-3 gap-3.5 shrink-0">
          {/* 1. AI Palette & Layer-Swap Auto-Solver / Manual Palette Builder */}
          <section
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleManualDropAppend}
            className="bg-[#181f2e] border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5 min-w-0"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                {solverColorMode === 'manual' ? (
                  <>
                    <Hand className="w-4 h-4" />
                    Manual Palette Studio
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    AI Palette & Swap Solver
                  </>
                )}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                MCP (experimental)
              </span>
            </div>

            {/* Solver Color Mode: Library Best Match | CMYK Mode | Manual Mode */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Color Selection Mode
              </span>
              <div className="grid grid-cols-3 gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => handleRunAiSolver(undefined, undefined, 'natural')}
                  className={`py-1 px-1.5 rounded-md text-[10px] font-bold transition truncate ${
                    solverColorMode === 'natural'
                      ? 'bg-orange-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Solve using the best matching natural filament colors from your selected library"
                >
                  Library Best
                </button>
                <button
                  onClick={() => handleRunAiSolver(undefined, undefined, 'cmyk')}
                  className={`py-1 px-1.5 rounded-md text-[10px] font-bold transition truncate ${
                    solverColorMode === 'cmyk'
                      ? 'bg-sky-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Separate CMYK process stack (Cyan, Magenta, Yellow, White/Black)"
                >
                  CMYK Mode
                </button>
                <button
                  onClick={() => setSolverColorMode('manual')}
                  className={`py-1 px-1.5 rounded-md text-[10px] font-bold transition truncate ${
                    solverColorMode === 'manual'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Drag colors from the Filament Library onto the palette and rearrange their lay-down order"
                >
                  Manual Mode
                </button>
              </div>
            </div>

            {solverColorMode === 'manual' ? (
              /* MANUAL LAY-DOWN PALETTE BUILDER */
              <div className="flex flex-col gap-2 min-w-0">
                <div className="flex items-center justify-between text-[10px] text-slate-300">
                  <span className="font-semibold uppercase tracking-wider text-emerald-300">
                    Lay-Down Stack (#1 Base → #{slots.length} Top)
                  </span>
                  <button
                    onClick={() => {
                      const blackSpool =
                        catalog.find((s) => s.name.toLowerCase() === 'black') || catalog[0];
                      const whiteSpool =
                        catalog.find((s) => s.name.toLowerCase().includes('jade white')) ||
                        catalog.find((s) => s.name.toLowerCase().includes('white')) ||
                        catalog[catalog.length - 1];
                      const baseEnd = Math.min(
                        totalLayers - 1,
                        Math.max(1, 1 + Math.round(Math.max(0, baseSolidThicknessMm - baseLayerMm) / layerHeightMm)) + 1
                      );
                      setSlots([
                        { id: `slot-${Date.now()}-base`, spool: blackSpool, upToLayer: baseEnd },
                        { id: `slot-${Date.now()}-top`, spool: whiteSpool, upToLayer: totalLayers },
                      ]);
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition"
                    title="Reset palette to #1 Black Base + #2 White Top so you can drag in custom colors"
                  >
                    Reset to Base+Top
                  </button>
                </div>

                <p className="text-[10px] text-slate-400 leading-snug bg-slate-900/70 border border-slate-800/80 rounded-lg p-2">
                  Drag any filament from the left <strong className="text-slate-200">Filament Library</strong> onto this palette. Drag rows or click <strong className="text-slate-200">↑ / ↓</strong> to rearrange the exact order colors lay down.
                </p>

                {/* Rearrangeable Manual Palette List */}
                <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-0.5 min-w-0">
                  {slots.map((slot, idx) => {
                    const startLayer = idx === 0 ? 1 : slots[idx - 1].upToLayer + 1;
                    const endLayer = idx === slots.length - 1 ? totalLayers : slot.upToLayer;
                    const orderTag =
                      idx === 0
                        ? '#1 Base'
                        : idx === slots.length - 1
                          ? `#${idx + 1} Top`
                          : `#${idx + 1}`;
                    const isOver = manualDragOverIdx === idx;
                    const isDragging = manualDraggingSlotIdx === idx;

                    return (
                      <div
                        key={slot.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-tailwag-slot-index', String(idx));
                          e.dataTransfer.effectAllowed = 'move';
                          setManualDraggingSlotIdx(idx);
                        }}
                        onDragEnd={() => {
                          setManualDraggingSlotIdx(null);
                          setManualDragOverIdx(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (manualDragOverIdx !== idx) setManualDragOverIdx(idx);
                        }}
                        onDragLeave={() => {
                          if (manualDragOverIdx === idx) setManualDragOverIdx(null);
                        }}
                        onDrop={(e) => handleManualDropOnSlot(e, idx, false)}
                        className={`p-1.5 rounded-lg flex items-center justify-between gap-1.5 transition cursor-grab active:cursor-grabbing min-w-0 ${
                          isOver
                            ? 'bg-emerald-500/15 border-2 border-emerald-400'
                            : 'bg-slate-900/90 border border-slate-800 hover:border-slate-700'
                        } ${isDragging ? 'opacity-45' : ''}`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <GripVertical className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-slate-950 text-orange-300 border border-slate-800 shrink-0">
                            {orderTag}
                          </span>
                          <span
                            onDrop={(e) => handleManualDropOnSlot(e, idx, true)}
                            className="w-4 h-4 rounded-full border border-white/30 shrink-0 shadow"
                            style={{ backgroundColor: slot.spool.hex }}
                            title="Drop a library filament on swatch to replace this slot"
                          />
                          <div className="min-w-0 flex-1">
                            <select
                              value={slot.spool.id}
                              onChange={(e) => {
                                const found = catalog.find((c) => c.id === e.target.value);
                                if (found) updateSlotSpool(slot.id, found);
                              }}
                              className="bg-slate-950 border border-slate-700/80 rounded px-1 py-0.5 text-[11px] font-semibold text-white truncate w-full focus:outline-none focus:border-emerald-500 cursor-pointer"
                            >
                              {catalog.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.brand} — {c.name} (TD {c.td}mm)
                                </option>
                              ))}
                            </select>
                            <div className="text-[9px] text-slate-400 font-mono truncate mt-0.5">
                              L{startLayer}–L{endLayer} • TD {slot.spool.td.toFixed(1)}mm
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => reorderSlots(idx, idx - 1)}
                            disabled={idx === 0}
                            className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 transition"
                            title="Move earlier (lays down lower toward Base)"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => reorderSlots(idx, idx + 1)}
                            disabled={idx === slots.length - 1}
                            className="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-25 transition"
                            title="Move later (lays down higher toward Top)"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          {slots.length > 1 && (
                            <button
                              onClick={() => removeSlot(slot.id)}
                              className="p-0.5 rounded text-slate-500 hover:text-rose-400 transition"
                              title="Remove from palette"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Dropzone to Add Filament from Library */}
                {slots.length < 16 && (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (manualDragOverIdx !== 'append') setManualDragOverIdx('append');
                    }}
                    onDragLeave={() => {
                      if (manualDragOverIdx === 'append') setManualDragOverIdx(null);
                    }}
                    onDrop={handleManualDropAppend}
                    onClick={() => {
                      const candidate =
                        catalog.find((c) => !slots.some((s) => s.spool.id === c.id)) || catalog[0];
                      addSlot(candidate);
                    }}
                    className={`py-2 px-2.5 rounded-lg border border-dashed text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition ${
                      manualDragOverIdx === 'append'
                        ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                        : 'border-slate-700 bg-slate-900/50 hover:bg-slate-800/70 text-slate-300'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">
                      Drag Color Here from Library ({slots.length}/16)
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    onClick={() =>
                      setSlots(
                        optimizeManualSlotBoundaries(
                          sourceImageData,
                          slots,
                          totalLayers,
                          baseLayerMm,
                          layerHeightMm,
                          baseSolidThicknessMm
                        )
                      )
                    }
                    className="py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition shadow truncate"
                    title="Optimize layer swap heights for your chosen filaments while keeping your exact manual lay-down order"
                  >
                    Auto-Tune Swap Layers
                  </button>
                  <button
                    onClick={() => distributeSlotsEvenly()}
                    className="py-1.5 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[10px] font-semibold transition truncate"
                    title="Space upper filament layers evenly above the base layer"
                  >
                    Space Layers Evenly
                  </button>
                </div>
              </div>
            ) : (
              /* AUTO-SOLVER CONTROLS (LIBRARY BEST MATCH & CMYK MODE) */
              <>
                {/* Auto-Solve Filament Source Selector */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Auto-Solve Filament Source
                  </span>
                  {hasOwnedLibrary ? (
                    <div className="grid grid-cols-2 gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => handleRunAiSolver('owned')}
                        className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition flex items-center justify-center gap-1 ${
                          effectiveSolverPoolMode === 'owned'
                            ? 'bg-emerald-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Auto-solve strictly using filaments from your filaments.json library"
                      >
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">Owned ({ownedSpools.length})</span>
                      </button>
                      <button
                        onClick={() => handleRunAiSolver('shown')}
                        className={`py-1.5 px-2 rounded-md text-[11px] font-bold transition flex items-center justify-center gap-1 ${
                          effectiveSolverPoolMode === 'shown'
                            ? 'bg-orange-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="Auto-solve using the filaments currently displayed in the active Filament Library tab & search filter"
                      >
                        <span className="truncate">Currently Shown ({filteredCatalog.length})</span>
                      </button>
                    </div>
                  ) : (
                    <div className="bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => handleRunAiSolver('shown')}
                        className="w-full py-1.5 px-2 rounded-md text-[11px] font-bold bg-orange-600 text-white shadow flex items-center justify-center gap-1"
                      >
                        <span className="truncate">Currently Shown ({filteredCatalog.length})</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Palette Color Count Selector: 4 / 7 / 8 / 12 / 16 Colors */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Palette Color Count (AMS Stack)
                  </span>
                  <div className="grid grid-cols-5 gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                    {([4, 7, 8, 12, 16] as const).map((cnt) => (
                      <button
                        key={cnt}
                        onClick={() => handleRunAiSolver(undefined, cnt)}
                        className={`relative py-1.5 px-0.5 rounded-md text-[10px] font-bold transition flex flex-col items-center justify-center ${
                          solverColorCount === cnt
                            ? 'bg-orange-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title={
                          cnt === 4
                            ? 'Standard 4-color single-AMS print'
                            : cnt === 7
                              ? '7-color Dual-AMS configuration (leaving 1 slot open for support/purge)'
                              : cnt === 8
                                ? 'Recommended for best photographic quality and smooth Beer-Lambert layer blending'
                                : `${cnt}-color multi-AMS ultra-high definition stack`
                        }
                      >
                        <span className="leading-tight">{cnt} Colors</span>
                        {cnt === 8 && (
                          <span className="text-[8px] font-extrabold text-amber-300 uppercase tracking-tighter mt-0.5">
                            ★ Best
                          </span>
                        )}
                        {cnt === 7 && (
                          <span className="text-[8px] font-extrabold text-sky-400 uppercase tracking-tighter mt-0.5">
                            2 AMS
                          </span>
                        )}
                        {cnt === 4 && (
                          <span className="text-[8px] font-medium opacity-60 uppercase tracking-tighter mt-0.5">
                            1 AMS
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => handleRunAiSolver()}
                  className="w-full py-1.5 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold transition shadow flex items-center justify-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {solverColorMode === 'cmyk'
                    ? `Auto-Solve CMYK (${solverColorCount} Colors)`
                    : effectiveSolverPoolMode === 'owned'
                      ? `Auto-Solve (${solverColorCount} Colors • Owned ${ownedSpools.length})`
                      : `Auto-Solve (${solverColorCount} Colors • Shown ${filteredCatalog.length})`}
                </button>

                {/* Color Count Advisory & Best-Quality Recommendation */}
                {solverRecipes[0]?.colorCountAdvisory && (
                  <div
                    className={`p-2.5 rounded-lg border text-[11px] flex flex-col gap-1.5 min-w-0 break-words ${
                      solverColorCount < (solverRecipes[0].recommendedColors ?? 8)
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 shadow-sm'
                        : 'bg-emerald-500/12 border-emerald-500/30 text-emerald-200'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between gap-1 min-w-0">
                      <span className="truncate">
                        {solverColorCount < (solverRecipes[0].recommendedColors ?? 8)
                          ? `💡 Best Quality Tip: ${solverRecipes[0].recommendedColors ?? 8} Colors Recommended`
                          : `🌟 Master Quality Active (${solverColorCount} Colors)`}
                      </span>
                      {solverRecipes[0].detectedClusterCount && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/30 shrink-0">
                          {solverRecipes[0].detectedClusterCount} Clusters
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] leading-relaxed opacity-90 break-words">
                      {solverRecipes[0].colorCountAdvisory}
                    </p>
                    {solverColorCount < (solverRecipes[0].recommendedColors ?? 8) && (
                      <button
                        onClick={() =>
                          handleRunAiSolver(undefined, solverRecipes[0].recommendedColors ?? 8)
                        }
                        className="mt-1 py-1.5 px-3 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-extrabold text-[10px] transition shadow flex items-center gap-1.5 self-start cursor-pointer"
                        title={`Upgrade to ${solverRecipes[0].recommendedColors ?? 8} colors for smoother photographic transitions and richer shadow depth`}
                      >
                        <Sparkles className="w-3 h-3 text-slate-950 shrink-0" />
                        Upgrade to {solverRecipes[0].recommendedColors ?? 8} Colors (Best Quality)
                      </button>
                    )}
                  </div>
                )}

                {solverRecipes.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {solverRecipes.map((recipe) => (
                      <button
                        key={recipe.id}
                        onClick={() => setSlots(recipe.slots)}
                        className="w-full text-left p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 transition flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{recipe.name}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-500/20 text-orange-300 font-mono">
                            {recipe.badge}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 line-clamp-2">{recipe.description}</p>
                        <div className="flex items-center gap-1 pt-0.5">
                          {recipe.slots.map((s) => (
                            <span
                              key={s.id}
                              className="h-3 flex-1 rounded-sm border border-white/20"
                              style={{ backgroundColor: s.spool.hex }}
                              title={`${s.spool.name} (Up to L${s.upToLayer})`}
                            />
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* 2. Physical Dimensions & Layer Slicing Parameters */}
          <section className="bg-[#181f2e] border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-sky-400" />
              Print Dimensions & Layer Stack
            </span>

            <div>
              <label className="text-[11px] text-slate-400">Project Title</label>
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-400">Width (mm)</label>
                <input
                  type="number"
                  min={30}
                  max={256}
                  value={widthMm}
                  onChange={(e) => {
                    const v = Math.max(30, Math.min(256, Number(e.target.value) || 180));
                    setDimensions(v, v);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400">Height (mm)</label>
                <input
                  type="number"
                  min={30}
                  max={256}
                  value={heightMm}
                  onChange={(e) => {
                    const v = Math.max(30, Math.min(256, Number(e.target.value) || 180));
                    setDimensions(widthMm, v);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-slate-400">Initial Layer</label>
                <input
                  type="number"
                  min={0.08}
                  max={0.48}
                  step={0.04}
                  value={baseLayerMm}
                  onChange={(e) => {
                    const val = Math.max(0.08, Math.min(0.48, parseFloat(e.target.value) || 0.16));
                    setLayerParams(Number(val.toFixed(2)), layerHeightMm, totalLayers);
                  }}
                  title="Slicer First / Initial Layer Height in mm (default 0.16mm for HueForge)"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400">Layer Height</label>
                <select
                  value={layerHeightMm}
                  onChange={(e) => setLayerParams(baseLayerMm, parseFloat(e.target.value), totalLayers)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-white font-mono"
                >
                  <option value={0.04}>0.04mm (Ultra)</option>
                  <option value={0.08}>0.08mm (HF)</option>
                  <option value={0.12}>0.12mm (Fast)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-400">Total Layers</label>
                <input
                  type="number"
                  min={10}
                  max={64}
                  value={totalLayers}
                  onChange={(e) =>
                    setLayerParams(baseLayerMm, layerHeightMm, Math.max(10, Math.min(64, Number(e.target.value) || 24)))
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono"
                />
              </div>
            </div>

            {/* Configurable Base Layer Thickness (Solid Starting Base in mm) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-semibold text-slate-300">
                  Base Layer Thickness (Solid Base)
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={baseLayerMm}
                    max={2.8}
                    step={layerHeightMm}
                    value={baseSolidThicknessMm}
                    onChange={(e) => setBaseSolidThicknessMm(parseFloat(e.target.value) || 0.48)}
                    className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-orange-400 font-mono text-right"
                  />
                  <span className="text-[10px] text-slate-400 font-mono">mm</span>
                </div>
              </div>
              <input
                type="range"
                min={baseLayerMm}
                max={2.0}
                step={layerHeightMm}
                value={baseSolidThicknessMm}
                onInput={(e) => setBaseSolidThicknessMm(parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => setBaseSolidThicknessMm(parseFloat(e.target.value))}
                className="w-full accent-orange-500 h-1.5 cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>
                  Base: L1–L
                  {Math.max(1, 1 + Math.round(Math.max(0, baseSolidThicknessMm - baseLayerMm) / layerHeightMm))} (
                  {baseSolidThicknessMm.toFixed(2)}mm)
                </span>
                <span className="text-orange-400">
                  Max Z: {(baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2)}mm
                </span>
              </div>
            </div>

            {/* Total Print Depth (Dynamic Height Stretch Control) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] font-semibold text-slate-300">
                  Total Print Depth (Max Height)
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0.8}
                    max={4.0}
                    step={layerHeightMm}
                    value={totalDepthMm}
                    onChange={(e) => setTotalDepthMm(parseFloat(e.target.value) || 2.0)}
                    className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-cyan-400 font-mono text-right"
                  />
                  <span className="text-[10px] text-slate-400 font-mono">mm</span>
                </div>
              </div>
              <input
                type="range"
                min={0.8}
                max={3.6}
                step={layerHeightMm}
                value={totalDepthMm}
                onInput={(e) => setTotalDepthMm(parseFloat((e.target as HTMLInputElement).value))}
                onChange={(e) => setTotalDepthMm(parseFloat(e.target.value))}
                className="w-full accent-cyan-500 h-1.5 cursor-pointer"
              />
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                <span>{totalLayers} Total Layers</span>
                <span className="text-cyan-400 font-semibold">{totalDepthMm.toFixed(2)}mm Depth</span>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Mesh Grid Resolution</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Fast (160)', val: 160 },
                  { label: 'High (240)', val: 240 },
                  { label: 'Ultra (320)', val: 320 },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    onClick={() => setMeshResolution(opt.val)}
                    className={`py-1 rounded text-[11px] font-medium border transition ${
                      meshResolution === opt.val
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* 3. 2.5D Parametric CAD Shapes, Frames, Clock & Magnet Cutouts */}
          <section className="bg-[#181f2e] border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              2.5D CAD Shapes, Clocks & Cutouts
            </span>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-400">Silhouette Shape</label>
                <select
                  value={cad.shape}
                  onChange={(e) => setCadConfig({ shape: e.target.value as MeshShapeMode })}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                >
                  <option value="rect">Rectangle</option>
                  <option value="rounded">Rounded Plaque</option>
                  <option value="circle">Circle / Clock</option>
                  <option value="hexagon">Hexagon Tile</option>
                  <option value="shield">Crest Shield</option>
                  <option value="paw">BoxerDawg Medallion</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400">3D Outer Frame</label>
                <select
                  value={cad.frameStyle}
                  onChange={(e) => setCadConfig({ frameStyle: e.target.value as FrameStyle })}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                >
                  <option value="beveled">Beveled Frame</option>
                  <option value="modern-lip">Modern Raised Lip</option>
                  <option value="stepped">Stepped Gallery</option>
                  <option value="none">Frameless</option>
                </select>
              </div>
            </div>

            {/* Signature HueForge Wall Clock Mode */}
            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
              <label className="flex items-center justify-between text-xs font-semibold text-slate-200 cursor-pointer">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-orange-400" />
                  HueForge Wall Clock Cutout & Stencil
                </span>
                <input
                  type="checkbox"
                  checked={cad.clockMode}
                  onChange={(e) =>
                    setCadConfig({
                      clockMode: e.target.checked,
                      shape: e.target.checked ? 'circle' : cad.shape,
                    })
                  }
                  className="accent-orange-500"
                />
              </label>

              {cad.clockMode && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[10px] text-slate-400">Stencil Numerals</label>
                    <select
                      value={cad.clockStencil}
                      onChange={(e) => setCadConfig({ clockStencil: e.target.value as ClockStencilStyle })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-xs text-white"
                    >
                      <option value="modern-arabic">Modern Stencil 1-12</option>
                      <option value="roman">Roman Numerals</option>
                      <option value="paw-markers">Cardinals + Dots</option>
                      <option value="none">No Numerals</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Shaft Bore (mm)</label>
                    <input
                      type="number"
                      step={0.2}
                      value={cad.clockShaftDiameterMm}
                      onChange={(e) => setCadConfig({ clockShaftDiameterMm: parseFloat(e.target.value) || 8.2 })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Keychain & Rear Neodymium Magnet Booleans */}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cad.keychainHole}
                  onChange={(e) => setCadConfig({ keychainHole: e.target.checked })}
                  className="accent-orange-500"
                />
                <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Keychain Bore</span>
              </label>

              <label className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cad.magnetPockets}
                  onChange={(e) => setCadConfig({ magnetPockets: e.target.checked })}
                  className="accent-orange-500"
                />
                <Magnet className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">Magnet Pockets</span>
              </label>
            </div>
          </section>
        </aside>
      </div>

      {/* Modals */}
      <TdCalibratorModal isOpen={isTdModalOpen} onClose={() => setIsTdModalOpen(false)} />
      <CalibrationPlateModal isOpen={isCalPlateOpen} onClose={() => setIsCalPlateOpen(false)} />
      <FilamentLibraryModal isOpen={isLibraryModalOpen} onClose={() => setIsLibraryModalOpen(false)} />
      <SpoolEditModal spoolId={editingSpoolId} onClose={() => setEditingSpoolId(null)} />
      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} grid={grid} plan={plan} />
    </div>
  );
};
