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
} from 'lucide-react';
import { useTailWagStore } from './store/useTailWagStore';
import { createDefaultPortraitImageData } from './utils/defaultPortrait';
import { buildHeightmapGrid, MeshShapeMode, FrameStyle, ClockStencilStyle } from './engine/cadMeshBuilder';
import { solveOptimalPalettes, solveCmykPalette, SolverRecipe } from './engine/autoSolver';
import { parseFilamentLibraryJson, serializeFilamentLibraryJson } from './utils/filamentJsonIO';
import { Viewport3D } from './components/Viewport3D';
import { LayerTimeline } from './components/LayerTimeline';
import { TdCalibratorModal } from './components/TdCalibratorModal';
import { ExportModal } from './components/ExportModal';

export const App: React.FC = () => {
  const defaultImg = useMemo(() => createDefaultPortraitImageData(320), []);
  const [sourceImageData, setSourceImageData] = useState<ImageData>(defaultImg.imageData);
  const [sourceDataUrl, setSourceDataUrl] = useState<string>(defaultImg.dataUrl);
  const [searchQuery, setSearchQuery] = useState('');
  const [libraryTab, setLibraryTab] = useState<'owned' | 'all'>('owned');
  const [solverPoolMode, setSolverPoolMode] = useState<'owned' | 'shown'>('owned');
  const [solverColorCount, setSolverColorCount] = useState<4 | 8 | 12 | 16>(4);
  const [solverColorMode, setSolverColorMode] = useState<'natural' | 'cmyk'>('natural');
  const [jsonImportBanner, setJsonImportBanner] = useState<string | null>(null);
  const [solverRecipes, setSolverRecipes] = useState<SolverRecipe[]>([]);
  const [isTdModalOpen, setIsTdModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const {
    projectName,
    setProjectName,
    viewportMode,
    setViewportMode,
    lightAzimuthDeg,
    lightElevationDeg,
    setLighting,
    backlitLithoMode,
    setBacklitLithoMode,
    widthMm,
    heightMm,
    setDimensions,
    baseLayerMm,
    layerHeightMm,
    totalLayers,
    setLayerParams,
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
    toggleSpoolOwned,
    importOwnedLibraryJson,
    removeImportedLibrary,
  } = useTailWagStore();

  // Compute 2.5D Heightmap Grid reactively
  const grid = useMemo(
    () =>
      buildHeightmapGrid({
        imageData: sourceImageData,
        gridRes: meshResolution,
        widthMm,
        heightMm,
        baseLayerMm,
        layerHeightMm,
        totalLayers,
        gamma,
        contrast,
        detailEnhance,
        invertLuminance,
        cad,
      }),
    [
      sourceImageData,
      meshResolution,
      widthMm,
      heightMm,
      baseLayerMm,
      layerHeightMm,
      totalLayers,
      gamma,
      contrast,
      detailEnhance,
      invertLuminance,
      cad,
    ]
  );

  // Owned spools are strictly and exclusively the spools loaded from filaments.json
  const ownedSpools = useMemo(() => catalog.filter((s) => Boolean(s.libraryId)), [catalog]);
  const builtInSpools = useMemo(() => catalog.filter((s) => !s.libraryId), [catalog]);
  const hasOwnedLibrary = importedLibraries.length > 0 && ownedSpools.length > 0;
  const effectiveLibraryTab = hasOwnedLibrary ? libraryTab : 'all';
  const effectiveSolverPoolMode = hasOwnedLibrary ? solverPoolMode : 'shown';

  const filteredCatalog = useMemo(() => {
    const baseList = effectiveLibraryTab === 'owned' ? ownedSpools : builtInSpools;
    if (!searchQuery.trim()) return baseList;
    const q = searchQuery.toLowerCase();
    return baseList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.brand.toLowerCase().includes(q) ||
        s.material.toLowerCase().includes(q)
    );
  }, [effectiveLibraryTab, ownedSpools, builtInSpools, searchQuery]);

  const getCandidatePoolForMode = (mode: 'owned' | 'shown', customOwnedList?: typeof catalog) => {
    if (mode === 'owned') {
      const owned = customOwnedList ?? ownedSpools;
      if (owned.length >= 2) return owned;
    }
    return filteredCatalog.length >= 2 ? filteredCatalog : builtInSpools;
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
        setSourceDataUrl(dataUrl);

        // Match physical print aspect ratio to uploaded photo (longest side = 180mm)
        const aspect = img.width / Math.max(1, img.height);
        if (aspect >= 1) {
          setDimensions(180, Math.max(40, Math.round(180 / aspect)));
        } else {
          setDimensions(Math.max(40, Math.round(180 * aspect)), 180);
        }

        // Automatically switch to 3D Filament Painted view and run AI Palette Auto-Solver using active pool mode & color count
        setViewportMode('3d-mesh');
        const effectiveLayers = Math.max(totalLayers, solverColorCount * 2);
        if (effectiveLayers !== totalLayers) {
          setLayerParams(baseLayerMm, layerHeightMm, effectiveLayers);
        }
        const pool = getCandidatePoolForMode(effectiveSolverPoolMode);
        const recipes =
          solverColorMode === 'cmyk'
            ? [solveCmykPalette(newImgData, pool, effectiveLayers, baseLayerMm, layerHeightMm, solverColorCount)]
            : solveOptimalPalettes(
                newImgData,
                pool,
                effectiveLayers,
                baseLayerMm,
                layerHeightMm,
                solverColorCount
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
    colorCountOverride?: 4 | 8 | 12 | 16,
    colorModeOverride?: 'natural' | 'cmyk'
  ) => {
    const activeMode = modeOverride ?? effectiveSolverPoolMode;
    const activeColors = colorCountOverride ?? solverColorCount;
    const activeColorMode = colorModeOverride ?? solverColorMode;
    if (modeOverride) {
      setSolverPoolMode(modeOverride);
    }
    if (colorCountOverride) {
      setSolverColorCount(colorCountOverride);
    }
    if (colorModeOverride) {
      setSolverColorMode(colorModeOverride);
    }
    const effectiveLayers = Math.max(totalLayers, activeColors * 2);
    if (effectiveLayers !== totalLayers) {
      setLayerParams(baseLayerMm, layerHeightMm, effectiveLayers);
    }
    const pool = getCandidatePoolForMode(activeMode);
    const recipes =
      activeColorMode === 'cmyk'
        ? [solveCmykPalette(sourceImageData, pool, effectiveLayers, baseLayerMm, layerHeightMm, activeColors)]
        : solveOptimalPalettes(
            sourceImageData,
            pool,
            effectiveLayers,
            baseLayerMm,
            layerHeightMm,
            activeColors
          );
    setSolverRecipes(recipes);
    if (recipes.length > 0) {
      setSlots(recipes[0].slots);
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
          const recipes = solveOptimalPalettes(
            sourceImageData,
            result.spools,
            effectiveLayers,
            baseLayerMm,
            layerHeightMm,
            solverColorCount
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
                v1.0 • TD Engine + MCP
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

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredCatalog.length === 0 ? (
                <div className="text-center py-6 px-3 text-xs text-slate-400 bg-slate-900/50 rounded-lg border border-slate-800/80">
                  <span>No filaments match "{searchQuery}".</span>
                </div>
              ) : (
                filteredCatalog.map((spool) => (
                  <div
                    key={spool.id}
                    className="bg-[#181f2e] hover:bg-slate-800/80 border border-slate-800 rounded-lg p-2 flex items-center justify-between gap-2 transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
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
                          {spool.amsSlot && (
                            <span className="px-1 rounded bg-sky-500/20 text-sky-300 font-mono">
                              {spool.amsSlot}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => addSlot(spool)}
                      disabled={slots.length >= 16}
                      className="px-2 py-1 rounded bg-slate-900 hover:bg-orange-600 text-[11px] font-semibold text-slate-300 hover:text-white border border-slate-700 transition shrink-0 disabled:opacity-40"
                    >
                      + Stack
                    </button>
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
            <Viewport3D grid={grid} sourceDataUrl={sourceDataUrl} />
          </div>
          <LayerTimeline />
        </main>

        {/* RIGHT SIDEBAR: AI Auto-Solver, Slicer Geometry & 2.5D Parametric CAD Cutouts */}
        <aside className="w-84 bg-[#121722] border-l border-slate-800 flex flex-col min-h-0 overflow-y-auto p-3 gap-3.5 shrink-0">
          {/* 1. AI Palette & Layer-Swap Auto-Solver */}
          <section className="bg-[#181f2e] border border-slate-800 rounded-xl p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-400 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                AI Palette & Swap Solver
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                MCP Ready
              </span>
            </div>

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

            {/* Solver Color Mode: Library Best Match vs CMYK Process */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Solver Color Mode
              </span>
              <div className="grid grid-cols-2 gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => handleRunAiSolver(undefined, undefined, 'natural')}
                  className={`py-1 px-2 rounded-md text-[11px] font-bold transition ${
                    solverColorMode === 'natural'
                      ? 'bg-orange-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Solve using the best matching natural filament colors from your selected library"
                >
                  Library Best Match
                </button>
                <button
                  onClick={() => handleRunAiSolver(undefined, undefined, 'cmyk')}
                  className={`py-1 px-2 rounded-md text-[11px] font-bold transition ${
                    solverColorMode === 'cmyk'
                      ? 'bg-sky-600 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Separate CMYK process stack (Cyan, Magenta, Yellow, White/Black)"
                >
                  CMYK Mode
                </button>
              </div>
            </div>

            {/* Palette Color Count Selector: 4 / 8 / 12 / 16 Colors */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Palette Color Count (AMS Stack)
              </span>
              <div className="grid grid-cols-4 gap-1 bg-slate-900/95 p-1 rounded-lg border border-slate-800">
                {([4, 8, 12, 16] as const).map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => handleRunAiSolver(undefined, cnt)}
                    className={`py-1 px-1.5 rounded-md text-[11px] font-bold transition ${
                      solverColorCount === cnt
                        ? 'bg-orange-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cnt} Colors
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

            {/* Color Count Advisory when >4 colors are not needed */}
            {solverRecipes[0]?.colorCountAdvisory && (
              <div
                className={`p-2 rounded-lg border text-[11px] flex flex-col gap-1.5 ${
                  solverColorCount > (solverRecipes[0].recommendedColors ?? 4)
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                    : 'bg-emerald-500/12 border-emerald-500/30 text-emerald-200'
                }`}
              >
                <div className="font-bold flex items-center justify-between gap-1">
                  <span>
                    {solverColorCount > (solverRecipes[0].recommendedColors ?? 4)
                      ? `Advisory: ${solverRecipes[0].recommendedColors ?? 4} Colors Recommended`
                      : '✓ 4 Colors Optimal (Single AMS)'}
                  </span>
                  {solverRecipes[0].detectedClusterCount && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/30">
                      {solverRecipes[0].detectedClusterCount} Clusters
                    </span>
                  )}
                </div>
                <p className="text-[10px] leading-relaxed opacity-90">
                  {solverRecipes[0].colorCountAdvisory}
                </p>
                {solverColorCount > (solverRecipes[0].recommendedColors ?? 4) && (
                  <button
                    onClick={() =>
                      handleRunAiSolver(undefined, solverRecipes[0].recommendedColors ?? 4)
                    }
                    className="mt-0.5 py-1 px-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] transition self-start shadow"
                  >
                    Switch to {solverRecipes[0].recommendedColors ?? 4} Colors (Recommended)
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
                <select
                  value={baseLayerMm}
                  onChange={(e) => setLayerParams(parseFloat(e.target.value), layerHeightMm, totalLayers)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-white font-mono"
                >
                  <option value={0.16}>0.16mm (HF)</option>
                  <option value={0.20}>0.20mm</option>
                  <option value={0.24}>0.24mm</option>
                  <option value={0.32}>0.32mm</option>
                </select>
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
                  max={48}
                  value={totalLayers}
                  onChange={(e) =>
                    setLayerParams(baseLayerMm, layerHeightMm, Math.max(10, Math.min(48, Number(e.target.value) || 24)))
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono"
                />
              </div>
            </div>

            <div className="px-2 py-1 rounded bg-slate-900/90 border border-slate-800 text-[10px] text-slate-300 font-mono flex items-center justify-between">
              <span>100% Rectilinear Infill • 1 Wall</span>
              <span className="text-orange-400">
                Max Z: {(baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2)}mm
              </span>
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
      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} grid={grid} />
    </div>
  );
};
