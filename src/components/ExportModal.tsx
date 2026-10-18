import React, { useMemo, useState } from 'react';
import { Package, FileCode, FileText, Copy, Check, X, Globe, FolderArchive } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { HeightmapGrid, generateBinaryStlFromGrid } from '../engine/cadMeshBuilder';
import { PrintPlan, shortPlanHash } from '../engine/printPlan';
import {
  buildSwapPlaybook,
  generatePlaybookText,
  generateSingleExtruderHtmlGuide,
  generateNoAmsStlPackageZip,
  generateNative3mfPackage,
} from '../engine/exporter3mf';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: HeightmapGrid;
  /** The plan the preview is showing; exports are verified against it. */
  plan: PrintPlan;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, grid, plan }) => {
  const { projectName, baseLayerMm, layerHeightMm, totalLayers, slots } = useTailWagStore();
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const playbook = useMemo(
    () => buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers),
    [slots, baseLayerMm, layerHeightMm, totalLayers]
  );

  const playbookText = useMemo(
    () =>
      generatePlaybookText(projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots) +
      `\n\nPrint Plan ID: ${shortPlanHash(plan)} (full hash ${plan.hash})\n`,
    [projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots, plan]
  );

  const htmlGuide = useMemo(
    () =>
      generateSingleExtruderHtmlGuide(projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots).replace(
        '</body>',
        `<p style="font:12px monospace;color:#888;text-align:center">Print Plan ID: ${shortPlanHash(plan)}</p></body>`
      ),
    [projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots, plan]
  );

  if (!isOpen) return null;

  const saveUint8OrBuffer = async (data: Uint8Array | ArrayBuffer, filename: string, ext: string) => {
    setExporting(true);
    try {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const desktopBridge = (window as any).tailwagDesktop;
      if (desktopBridge?.saveFile) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        await desktopBridge.saveFile({
          defaultPath: filename,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
          dataBase64: btoa(binary),
        });
      } else {
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleExport3MF = () => {
    setExportError(null);
    let pkg: Uint8Array;
    try {
    pkg = generateNative3mfPackage({
      projectName,
      grid,
      baseLayerMm,
      layerHeightMm,
      totalLayers,
      slots,
      plan,
    });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
      return;
    }
    saveUint8OrBuffer(pkg, `${projectName}_TailWag_rev1.3mf`, '3mf');
  };

  const handleExportNoAmsBundleZip = () => {
    setExportError(null);
    let zipBytes: Uint8Array;
    try {
    zipBytes = generateNoAmsStlPackageZip({
      projectName,
      grid,
      baseLayerMm,
      layerHeightMm,
      totalLayers,
      slots,
      plan,
    });
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
      return;
    }
    saveUint8OrBuffer(zipBytes, `${projectName}_NoAMS_STL_and_Pause_Guide_rev1.zip`, 'zip');
  };

  const handleExportBinaryStl = () => {
    const stl = generateBinaryStlFromGrid(grid);
    saveUint8OrBuffer(stl, `${projectName}_TailWag_rev1.stl`, 'stl');
  };

  const handleExportHtmlGuide = () => {
    const enc = new TextEncoder().encode(htmlGuide);
    saveUint8OrBuffer(enc, `${projectName}_Color_Change_Guide.html`, 'html');
  };

  const handleExportPlaybookTxt = () => {
    const enc = new TextEncoder().encode(playbookText);
    saveUint8OrBuffer(enc, `${projectName}_Swap_Playbook.txt`, 'txt');
  };

  const handleCopyPlaybook = () => {
    navigator.clipboard.writeText(playbookText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121722] border border-slate-700 rounded-xl max-w-4xl w-full p-5 shadow-2xl flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        {exportError && (
          <div className="text-xs px-3 py-2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300">Export blocked: {exportError}</div>
        )}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Package className="w-5 h-5 text-orange-400" />
            <div>
              <h2 className="text-base font-bold text-white">
                Export .3MF (Multi-Color AMS) or .STL + Layer-Pause Guide (Single-Head / No-AMS)
              </h2>
              <p className="text-xs text-slate-400">
                Initial Layer: {baseLayerMm.toFixed(2)}mm • Layer Height: {layerHeightMm.toFixed(2)}mm • 100% Rectilinear Infill • Total: {totalLayers} Layers � Print Plan {shortPlanHash(plan)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Visual Layer Pause & Color Swap Schedule Cards */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-orange-400">
            Exact Layer Pause &amp; Color-Change Schedule ({playbook.length} Colors)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {playbook.map((item, idx) => (
              <div
                key={item.slotIndex}
                className="bg-[#181f2e] border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between text-[10px]">
                  {idx === 0 ? (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold font-mono">
                      START PRINT (L1)
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/40 font-bold font-mono">
                      PAUSE @ LAYER {item.startLayer}
                    </span>
                  )}
                  <span className="font-mono text-slate-400">TD {item.td}mm</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full border border-white/30 shrink-0 shadow"
                    style={{ backgroundColor: item.hex }}
                  />
                  <span className="text-xs font-semibold text-white truncate">
                    #{item.slotIndex} {item.spoolName}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-emerald-400">
                  L{item.startLayer} → L{item.endLayer} ({item.startZMm.toFixed(2)}–{item.endZMm.toFixed(2)}mm)
                </div>
                <div className="text-[10px] text-slate-400 leading-tight">
                  {idx === 0
                    ? `Load ${item.spoolName} before starting print`
                    : `Pause at L${item.startLayer} (${item.startZMm.toFixed(2)}mm) & swap to ${item.spoolName}`}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Printable Recipe Text Preview */}
        <div className="relative">
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48 leading-relaxed">
            {playbookText}
          </pre>
          <button
            onClick={handleCopyPlaybook}
            className="absolute top-2.5 right-2.5 flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs text-slate-200 transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Playbook'}
          </button>
        </div>

        {/* Primary Export Sections: Single-Extruder (No-AMS) vs Multi-Color AMS */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Option A: Single-Head Printer / No AMS */}
          <div className="bg-[#181f2e] border border-sky-500/30 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-sky-300 uppercase tracking-wider">
                Single-Head Printer (No AMS)
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono">
                .STL + Layer Pause Guide
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Exports the watertight <code>.STL</code> model plus an easy-to-follow <code>.HTML</code> &amp; <code>.TXT</code> instruction guide showing exact pause layers and filament swaps for any slicer.
            </p>
            <button
              onClick={handleExportNoAmsBundleZip}
              disabled={exporting}
              className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow transition"
            >
              <FolderArchive className="w-4 h-4" />
              Export .STL + HTML Pause Guide (.ZIP)
            </button>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={handleExportBinaryStl}
                disabled={exporting}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold transition"
                title="Download only the watertight binary .STL file"
              >
                <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>.STL File</span>
              </button>
              <button
                onClick={handleExportHtmlGuide}
                disabled={exporting}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold transition"
                title="Download the interactive visual .HTML layer-pause & color-change guide"
              >
                <Globe className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>.HTML Guide</span>
              </button>
              <button
                onClick={handleExportPlaybookTxt}
                disabled={exporting}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold transition"
                title="Download the plain-text layer swap playbook (.TXT)"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>.TXT Guide</span>
              </button>
            </div>
          </div>

          {/* Option B: Multi-Color AMS (.3MF) */}
          <div className="bg-[#181f2e] border border-orange-500/30 rounded-xl p-3 flex flex-col justify-between gap-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-orange-300 uppercase tracking-wider">
                  Multi-Color AMS Printer (.3MF)
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 font-mono">
                  Bambu Studio / OrcaSlicer
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Exports a native Bambu Studio / OrcaSlicer <code>.3MF</code> project with pre-sliced horizontal color bands mapped to AMS slots, <code>0.16mm</code> initial layer, <code>0.08mm</code> layer height, and <code>100%</code> rectilinear infill.
              </p>
            </div>
            <button
              onClick={handleExport3MF}
              disabled={exporting}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-lg shadow-orange-600/20 transition"
            >
              <Package className="w-4 h-4" />
              Export Native .3MF Project (AMS Pre-Mapped)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

