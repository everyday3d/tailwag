import React, { useEffect, useMemo, useState } from 'react';
import { Package, FileCode, FileText, Copy, Check, X, Globe, FolderArchive, Image as ImageIcon, Braces } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { HeightmapGrid } from '../engine/cadMeshBuilder';
import { analyzePrintCost } from '../engine/printEconomics';
import { PrintPlan, shortPlanHash } from '../engine/printPlan';
import { buildPrintMetadata, serializePrintMetadata } from '../engine/printMetadata';
import { renderPlanComparisonPng } from '../engine/planPreview';
import {
  buildFidelityReport,
  renderFidelityHeatmapPng,
  summarizeFidelity,
} from '../engine/fidelityReport';
import { ExportVerificationError, type VerificationReport } from '../engine/verifyExport';
import {
  generateVerified3mfPackage,
  generateVerifiedNoAmsBundle,
  generateVerifiedStl,
} from '../engine/verifiedExport';
import {
  buildSwapPlaybook,
  generatePlaybookText,
  generateSingleExtruderHtmlGuide,
} from '../engine/exporter3mf';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: HeightmapGrid;
  /** The plan the preview is showing; exports are verified against it. */
  plan: PrintPlan;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, grid, plan }) => {
  const { projectName, baseLayerMm, layerHeightMm, totalLayers, slots, sourceImageData } = useTailWagStore();
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportIssues, setExportIssues] = useState<string[]>([]);
  const [verifiedNote, setVerifiedNote] = useState<string | null>(null);

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

  // Target vs predicted comparison, rendered from the plan (only while the dialog is open)
  const previewPng = useMemo(
    () => (isOpen && sourceImageData ? renderPlanComparisonPng(plan, sourceImageData) : null),
    [isOpen, plan, sourceImageData]
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewPng) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([previewPng as unknown as BlobPart], { type: 'image/png' }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewPng]);

  // How close the predicted print is to the photo, in standard CIEDE2000
  const fidelity = useMemo(
    () => (isOpen && sourceImageData ? buildFidelityReport({ plan, image: sourceImageData, slots }) : null),
    [isOpen, plan, sourceImageData, slots]
  );
  const printCost = useMemo(
    () =>
      analyzePrintCost({
        plan,
        widthMm: grid.widthMm,
        materials: slots.map((s) => s.spool.material),
      }),
    [plan, grid.widthMm, slots]
  );
  const fidelitySummary = useMemo(() => (fidelity ? summarizeFidelity(fidelity) : undefined), [fidelity]);
  const heatPng = useMemo(() => (fidelity ? renderFidelityHeatmapPng(fidelity) : null), [fidelity]);
  const [heatUrl, setHeatUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!heatPng) {
      setHeatUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([heatPng as unknown as BlobPart], { type: 'image/png' }));
    setHeatUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [heatPng]);

  const metadataJson = useMemo(
    () => (isOpen ? serializePrintMetadata(buildPrintMetadata(plan, slots, projectName, fidelitySummary)) : ''),
    [isOpen, plan, slots, projectName, fidelitySummary]
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

  // Every file is re-read and compared with the print plan before it is saved.
  // A mismatch blocks the export; there is no override.
  const runVerified = <T extends Uint8Array | ArrayBuffer>(
    build: () => { data: T; report: VerificationReport },
    filename: string,
    ext: string
  ) => {
    setExportError(null);
    setExportIssues([]);
    setVerifiedNote(null);
    let result: { data: T; report: VerificationReport };
    try {
      result = build();
    } catch (e) {
      if (e instanceof ExportVerificationError) {
        setExportError(e.message);
        setExportIssues(e.report.errors.map((x) => x.message));
      } else {
        setExportError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    setExportIssues(result.report.warnings.map((w) => w.message));
    setVerifiedNote(`Verified against print plan ${shortPlanHash(plan)}: file matches what the preview shows.`);
    saveUint8OrBuffer(result.data, filename, ext);
  };

  const handleExport3MF = () =>
    runVerified(
      () =>
        generateVerified3mfPackage({
          projectName,
          grid,
          baseLayerMm,
          layerHeightMm,
          totalLayers,
          slots,
          plan,
          previewPng: previewPng ?? undefined,
          fidelity: fidelitySummary,
        }),
      `${projectName}_TailWag_rev1.3mf`,
      '3mf'
    );

  const handleExportNoAmsBundleZip = () =>
    runVerified(
      () =>
        generateVerifiedNoAmsBundle({
          projectName,
          grid,
          baseLayerMm,
          layerHeightMm,
          totalLayers,
          slots,
          plan,
          previewPng: previewPng ?? undefined,
          fidelity: fidelitySummary,
        }),
      `${projectName}_NoAMS_STL_and_Pause_Guide_rev1.zip`,
      'zip'
    );

  const handleExportBinaryStl = () =>
    // The Print Plan ID in the STL header ties a loose STL back to the plan that produced it.
    runVerified(
      () => generateVerifiedStl(grid, plan),
      `${projectName}_TailWag_${shortPlanHash(plan)}_rev1.stl`,
      'stl'
    );

  const handleExportMetadata = () => {
    saveUint8OrBuffer(
      new TextEncoder().encode(metadataJson),
      `${projectName}_TailWag_PrintMetadata.json`,
      'json'
    );
  };

  const handleExportPreview = () => {
    if (previewPng) saveUint8OrBuffer(previewPng, `${projectName}_TailWag_Preview_${shortPlanHash(plan)}.png`, 'png');
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
          <div className="text-xs px-3 py-2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 flex flex-col gap-1">
            <span className="font-bold">Export blocked: nothing was saved.</span>
            <span>{exportError}</span>
            {exportIssues.length > 0 && (
              <ul className="list-disc pl-4 text-[11px] text-rose-200">
                {exportIssues.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!exportError && verifiedNote && (
          <div className="text-xs px-3 py-2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex flex-col gap-1">
            <span>{verifiedNote}</span>
            {exportIssues.length > 0 && (
              <ul className="list-disc pl-4 text-[11px] text-amber-300">
                {exportIssues.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Package className="w-5 h-5 text-orange-400" />
            <div>
              <h2 className="text-base font-bold text-white">
                Export .3MF (Multi-Color AMS) or .STL + Layer-Pause Guide (Single-Head / No-AMS)
              </h2>
              <p className="text-xs text-slate-400">
                Initial Layer: {baseLayerMm.toFixed(2)}mm • Layer Height: {layerHeightMm.toFixed(2)}mm • 100% Rectilinear Infill • Total: {totalLayers} Layers | Print Plan {shortPlanHash(plan)}
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

        {/* Predicted print preview (rendered from the Print Plan) and structured metadata */}
        <div className="bg-[#181f2e] border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-orange-400">
              Target vs. Predicted Print
            </span>
            <span className="text-[10px] font-mono text-slate-400">Print Plan {shortPlanHash(plan)}</span>
          </div>
          {previewUrl ? (
            <div className="flex flex-col gap-1">
              <img
                src={previewUrl}
                alt="Left: target image. Right: predicted print from the exact layers in the export."
                className="w-full max-h-72 object-contain rounded bg-slate-950 border border-slate-800"
                style={{ imageRendering: 'pixelated' }}
              />
              <div className="grid grid-cols-2 text-[10px] text-slate-400 text-center">
                <span>Target image</span>
                <span>Predicted print (exact exported layers)</span>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">Load an image to see the predicted print.</div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handleExportPreview}
              disabled={exporting || !previewPng}
              className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold transition disabled:opacity-40"
              title="Download the side-by-side comparison as a PNG"
            >
              <ImageIcon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span>Preview PNG</span>
            </button>
            <button
              onClick={handleExportMetadata}
              disabled={exporting}
              className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold transition"
              title="Download total height, base layer, filament change heights and filament sequence as JSON"
            >
              <Braces className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>Metadata JSON</span>
            </button>
          </div>
        </div>

        {/* Predicted fidelity: how close the print should be to the photo, and why */}
        {fidelity && fidelity.printedColumns > 0 && (
          <div className="bg-[#181f2e] border border-slate-800 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-400">Predicted Fidelity (CIEDE2000)</span>
              <span className="text-[10px] text-slate-400">Prediction, not a measurement</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ['Mean', fidelity.meanDeltaE00],
                    ['Median', fidelity.medianDeltaE00],
                    ['95th pct', fidelity.p95DeltaE00],
                    ['Worst', fidelity.maxDeltaE00],
                  ].map(([label, v]) => (
                    <div key={label as string} className="bg-slate-950 border border-slate-800 rounded p-1.5">
                      <div className="text-sm font-bold text-white">{(v as number).toFixed(1)}</div>
                      <div className="text-[10px] text-slate-400">{label as string}</div>
                    </div>
                  ))}
                </div>
                <div className="flex h-2.5 rounded overflow-hidden border border-slate-800" title="Share of columns by predicted color difference">
                  <div style={{ width: fidelity.share.imperceptible * 100 + '%', background: '#26aa5a' }} />
                  <div style={{ width: fidelity.share.close * 100 + '%', background: '#8cc83c' }} />
                  <div style={{ width: fidelity.share.noticeable * 100 + '%', background: '#f0a028' }} />
                  <div style={{ width: fidelity.share.clear * 100 + '%', background: '#d22832' }} />
                </div>
                <div className="text-[10px] text-slate-400 flex flex-wrap gap-x-3">
                  <span>{Math.round(fidelity.share.imperceptible * 100)}% imperceptible (2 or less)</span>
                  <span>{Math.round(fidelity.share.close * 100)}% close (5 or less)</span>
                  <span>{Math.round(fidelity.share.noticeable * 100)}% noticeable (10 or less)</span>
                  <span>{Math.round(fidelity.share.clear * 100)}% clearly different</span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {Math.round(fidelity.gamutLimitedShare * 100)}% of the photo is beyond this palette's reach. {fidelity.swapCount} filament change{fidelity.swapCount === 1 ? '' : 's'}.
                </div>
                {(fidelity.warnings.length > 0 || printCost.warnings.length > 0) && (
                  <ul className="list-disc pl-4 text-[11px] text-amber-300">
                    {[...fidelity.warnings, ...printCost.warnings].map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
              {heatUrl && (
                <div className="flex flex-col items-center gap-1">
                  <img src={heatUrl} alt="Heat map: green is accurate, red is clearly different" className="w-40 h-40 object-contain rounded border border-slate-800 bg-slate-950" style={{ imageRendering: 'pixelated' }} />
                  <span className="text-[10px] text-slate-400">Green accurate, red different</span>
                </div>
              )}
            </div>
          </div>
        )}

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

