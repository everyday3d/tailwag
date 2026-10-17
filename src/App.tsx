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
} from 'lucide-react';
import { useTailWagStore } from './store/useTailWagStore';
import { createDefaultPortraitImageData } from './utils/defaultPortrait';
import { buildHeightmapGrid, MeshShapeMode, FrameStyle, ClockStencilStyle } from './engine/cadMeshBuilder';
import { solveOptimalPalettes, SolverRecipe } from './engine/autoSolver';
import { Viewport3D } from './components/Viewport3D';
import { LayerTimeline } from './components/LayerTimeline';
import { TdCalibratorModal } from './components/TdCalibratorModal';
import { ExportModal } from './components/ExportModal';

export const App: React.FC = () => {
  const defaultImg = useMemo(() => createDefaultPortraitImageData(320), []);
  const [sourceImageData, setSourceImageData] = useState<ImageData>(defaultImg.imageData);
  const [sourceDataUrl, setSourceDataUrl] = useState<string>(defaultImg.dataUrl);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOwnedOnly, setFilterOwnedOnly] = useState(false);
  const [solverRecipes, setSolverRecipes] = useState<SolverRecipe[]>([]);
  const [isTdModalOpen, setIsTdModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    slots,
    setSlots,
    addSlot,
    toggleSpoolOwned,
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

  const filteredCatalog = useMemo(() => {
    return catalog.filter((s) => {
      if (filterOwnedOnly && !s.owned) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.brand.toLowerCase().includes(q) ||
        s.material.toLowerCase().includes(q)
      );
    });
  }, [catalog, filterOwnedOnly, searchQuery]);

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
        setSourceImageData(ctx.getImageData(0, 0, w, h));
        setSourceDataUrl(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleRunAiSolver = (ownedOnly: boolean) => {
    const pool = ownedOnly ? catalog.filter((c) => c.owned) : catalog;
    const recipes = solveOptimalPalettes(
      sourceImageData,
      pool.length >= 3 ? pool : catalog,
      totalLayers,
      baseLayerMm,
      layerHeightMm,
      4
    );
    setSolverRecipes(recipes);
    if (recipes.length > 0) {
      setSlots(recipes[0].slots);
    }
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
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Filament TD Library ({filteredCatalog.length})
              </span>
              <button
                onClick={() => setFilterOwnedOnly(!filterOwnedOnly)}
                className={`text-[11px] px-2 py-0.5 rounded font-medium border transition ${
                  filterOwnedOnly
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
              >
                {filterOwnedOnly ? 'Owned / AMS Only' : 'All Spools'}
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Bambu, Polymaker, Sunlu, TD..."
                className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {filteredCatalog.map((spool) => (
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
                      <div className="text-xs font-semibold text-slate-100 truncate">{spool.name}</div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                        <span>{spool.brand}</span>
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
                    disabled={slots.length >= 8}
                    className="px-2 py-1 rounded bg-slate-900 hover:bg-orange-600 text-[11px] font-semibold text-slate-300 hover:text-white border border-slate-700 transition shrink-0"
                  >
                    + Stack
                  </button>
                </div>
              ))}
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
                onChange={(e) => setPrePress({ detailEnhance: parseFloat(e.target.value) })}
                className="w-full accent-orange-500 h-1.5"
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
                onChange={(e) => setPrePress({ gamma: parseFloat(e.target.value) })}
                className="w-full accent-orange-500 h-1.5"
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
                onChange={(e) => setPrePress({ contrast: parseFloat(e.target.value) })}
                className="w-full accent-orange-500 h-1.5"
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
                    onChange={(e) => setLighting(parseInt(e.target.value, 10), lightElevationDeg)}
                    className="w-16 accent-orange-500 h-1"
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

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleRunAiSolver(true)}
                className="py-1.5 px-2.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold transition shadow"
              >
                Solve (My AMS / Owned)
              </button>
              <button
                onClick={() => handleRunAiSolver(false)}
                className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs font-semibold transition"
              >
                Solve (All Brands)
              </button>
            </div>

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
                <label className="text-[10px] text-slate-400">Base Z (mm)</label>
                <select
                  value={baseLayerMm}
                  onChange={(e) => setLayerParams(parseFloat(e.target.value), layerHeightMm, totalLayers)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-white font-mono"
                >
                  <option value={0.48}>0.48mm</option>
                  <option value={0.64}>0.64mm</option>
                  <option value={0.80}>0.80mm</option>
                  <option value={1.00}>1.00mm</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-400">Layer (mm)</label>
                <select
                  value={layerHeightMm}
                  onChange={(e) => setLayerParams(baseLayerMm, parseFloat(e.target.value), totalLayers)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-white font-mono"
                >
                  <option value={0.04}>0.04mm (Ultra)</option>
                  <option value={0.08}>0.08mm (Std)</option>
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
