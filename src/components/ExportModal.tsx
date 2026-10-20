import React, { useEffect, useMemo, useState } from 'react';
import { Package, FileCode, FileText, Copy, Check, X, Globe, FolderArchive, Image as ImageIcon, Braces, Send, FolderOpen } from 'lucide-react';
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
import { recordError } from '../engine/debugInfo';
import { Button, Dialog, DialogSection, FOCUS_RING } from './ui';
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

interface DetectedSlicer {
  id: string;
  name: string;
  exePath: string;
  source: 'custom' | 'registry' | 'folder';
}
interface SupportedSlicer {
  id: string;
  name: string;
  installUrl: string;
}
type SlicerStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; slicerName: string; filePath: string }
  | { kind: 'saved'; filePath: string }
  | { kind: 'failed'; error: string; filePath?: string };

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: HeightmapGrid;
  /** The plan the preview is showing; exports are verified against it. */
  plan: PrintPlan;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, grid, plan }) => {
  const { projectName, baseLayerMm, layerHeightMm, totalLayers, slots, sourceImageData, focusImageMask } = useTailWagStore();
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportIssues, setExportIssues] = useState<string[]>([]);
  const [verifiedNote, setVerifiedNote] = useState<string | null>(null);

  // Send to slicer (desktop only): installed slicers, the selected one, and the last result.
  const desktop = (window as any).tailwagDesktop;
  const canSendToSlicer = !!desktop?.sendToSlicer;
  const [slicers, setSlicers] = useState<DetectedSlicer[] | null>(null);
  const [supportedSlicers, setSupportedSlicers] = useState<SupportedSlicer[]>([]);
  const [slicerId, setSlicerId] = useState<string>('');
  const [slicerStatus, setSlicerStatus] = useState<SlicerStatus>({ kind: 'idle' });

  const refreshSlicers = async (prefer?: string) => {
    if (!desktop?.listSlicers) return;
    const res = await desktop.listSlicers();
    const found: DetectedSlicer[] = res?.slicers ?? [];
    setSlicers(found);
    setSupportedSlicers(res?.supported ?? []);
    const pick = [prefer, res?.last].find((id) => id && found.some((s) => s.id === id)) ?? found[0]?.id ?? '';
    setSlicerId(pick);
  };

  useEffect(() => {
    if (isOpen && canSendToSlicer) {
      setSlicerStatus({ kind: 'idle' });
      refreshSlicers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, canSendToSlicer]);

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
    () => (isOpen && sourceImageData ? buildFidelityReport({ plan, image: sourceImageData, slots, focus: focusImageMask }) : null),
    [isOpen, plan, sourceImageData, slots, focusImageMask]
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
        await desktopBridge.saveFile({
          defaultPath: filename,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
          dataBase64: bytesToBase64(bytes),
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
    ext: string,
    deliver: (data: T) => void = (data) => saveUint8OrBuffer(data, filename, ext)
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
        recordError('Export blocked', [e.message, ...e.report.errors.map((x) => x.message)].join(' | '));
      } else {
        setExportError(e instanceof Error ? e.message : String(e));
        recordError('Export', e);
      }
      return;
    }
    setExportIssues(result.report.warnings.map((w) => w.message));
    setVerifiedNote(`Verified against print plan ${shortPlanHash(plan)}: file matches what the preview shows.`);
    deliver(result.data);
  };

  const build3mf = () =>
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
    });
  const threeMfName = `${projectName}_TailWag_rev1.3mf`;

  const handleExport3MF = () => runVerified(build3mf, threeMfName, '3mf');

  // Same verified .3mf as Export, handed straight to the slicer. A failed check blocks it
  // before anything is written. With no slicer (targetId null) the file is only saved
  // to the export folder and shown there.
  const handleSendToSlicer = (targetId: string | null) => {
    setSlicerStatus({ kind: 'idle' });
    runVerified(build3mf, threeMfName, '3mf', async (data) => {
      setExporting(true);
      setSlicerStatus({ kind: 'sending' });
      try {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const res = await desktop.sendToSlicer({ slicerId: targetId, fileName: threeMfName, dataBase64: bytesToBase64(bytes) });
        if (!res?.ok) {
          setSlicerStatus({ kind: 'failed', error: res?.error || 'The slicer could not be started.', filePath: res?.filePath });
          recordError('Send to slicer', res?.error || 'The slicer could not be started.');
        } else if (targetId === null) {
          setSlicerStatus({ kind: 'saved', filePath: res.filePath });
          desktop.showExportInFolder(res.filePath);
        } else {
          setSlicerStatus({ kind: 'sent', slicerName: res.slicerName, filePath: res.filePath });
        }
      } catch (e) {
        setSlicerStatus({ kind: 'failed', error: e instanceof Error ? e.message : String(e) });
        recordError('Send to slicer', e);
      } finally {
        setExporting(false);
      }
    });
  };

  const handleLocateSlicer = async (id: string) => {
    const res = await desktop.chooseSlicer(id);
    if (!res?.canceled) await refreshSlicers(id);
  };

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

  const shareColours = { imperceptible: '#26aa5a', close: '#8cc83c', noticeable: '#f0a028', clear: '#d22832' };
  const selectedSlicer = slicers?.find((s) => s.id === slicerId);
  const linkBtn = `underline text-tw-ink-2 hover:text-tw-ink rounded ${FOCUS_RING}`;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      size="xl"
      icon={<Package className="w-5 h-5" />}
      title="Export"
      subtitle={`First layer ${baseLayerMm.toFixed(2)} mm, then ${layerHeightMm.toFixed(2)} mm layers, ${totalLayers} layers, 100% infill. Print plan ${shortPlanHash(plan)}.`}
    >
      {exportError && (
        <div role="alert" className="flex flex-col gap-1 px-3 py-2 rounded-control bg-tw-danger/10 border border-tw-danger/30 text-small text-tw-danger">
          <span className="font-semibold">Export blocked: nothing was saved.</span>
          <span>{exportError}</span>
          {exportIssues.length > 0 && (
            <ul className="list-disc pl-4 m-0">
              {exportIssues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!exportError && verifiedNote && (
        <div role="status" className="flex flex-col gap-1 px-3 py-2 rounded-control bg-tw-ok/10 border border-tw-ok/30 text-small text-tw-ok">
          <span>{verifiedNote}</span>
          {exportIssues.length > 0 && (
            <ul className="list-disc pl-4 m-0 text-tw-warn">
              {exportIssues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The two ways to print, main action first */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-2.5 p-4 rounded-card bg-tw-ground/60 border border-tw-line">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-body font-semibold">Multi-colour printer with an AMS</h3>
            <p className="m-0 text-small text-tw-ink-2">
              A Bambu Studio or OrcaSlicer project. Each colour band is already assigned to an AMS slot, and your layer heights and 100% infill are set.
            </p>
          </div>
          <Button variant="primary" size="lg" icon={<Package className="w-4 h-4" aria-hidden="true" />} onClick={handleExport3MF} disabled={exporting}>
            Export .3MF project
          </Button>

          {canSendToSlicer && slicers && (
            <div className="flex flex-col gap-2 pt-2.5 border-t border-tw-line">
              {slicers.length > 0 ? (
                <>
                  <div className="flex gap-2">
                    {slicers.length > 1 && (
                      <select
                        value={slicerId}
                        onChange={(e) => setSlicerId(e.target.value)}
                        aria-label="Slicer"
                        className={`h-8 px-2 rounded-control bg-tw-ground border border-tw-line text-small text-tw-ink ${FOCUS_RING}`}
                      >
                        {slicers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <Button
                      className="flex-1"
                      icon={<Send className="w-3.5 h-3.5" aria-hidden="true" />}
                      onClick={() => handleSendToSlicer(slicerId)}
                      disabled={exporting || !slicerId}
                      title={selectedSlicer?.exePath}
                    >
                      Open in {selectedSlicer?.name ?? 'slicer'}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-micro text-tw-ink-3">
                    <span>Exports the same checked .3MF and opens it as a project.</span>
                    {supportedSlicers.map((s) => (
                      <button key={s.id} type="button" onClick={() => handleLocateSlicer(s.id)} className={linkBtn}>
                        {slicers.some((d) => d.id === s.id) ? `Change ${s.name} location` : `Locate ${s.name}`}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2 text-small text-tw-ink-2">
                  <span>No Bambu Studio or OrcaSlicer found on this computer.</span>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-micro">
                    {supportedSlicers.map((s) => (
                      <React.Fragment key={s.id}>
                        <button type="button" onClick={() => desktop.openExternal(s.installUrl)} className={linkBtn}>
                          Get {s.name}
                        </button>
                        <button type="button" onClick={() => handleLocateSlicer(s.id)} className={linkBtn}>
                          Locate {s.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                  <Button icon={<FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => handleSendToSlicer(null)} disabled={exporting}>
                    Save .3MF and show in folder
                  </Button>
                </div>
              )}

              <div role="status" className="text-small">
                {slicerStatus.kind === 'sending' && <span className="text-tw-ink-2">Opening…</span>}
                {slicerStatus.kind === 'sent' && (
                  <span className="text-tw-ok">
                    Opened in {slicerStatus.slicerName}.{' '}
                    <button type="button" onClick={() => desktop.showExportInFolder(slicerStatus.filePath)} className={linkBtn}>
                      Show in folder
                    </button>
                  </span>
                )}
                {slicerStatus.kind === 'saved' && <span className="text-tw-ok">Saved to the export folder.</span>}
                {slicerStatus.kind === 'failed' && (
                  <span className="text-tw-danger">
                    {slicerStatus.error}{' '}
                    {slicerStatus.filePath && (
                      <button type="button" onClick={() => desktop.showExportInFolder(slicerStatus.filePath)} className={linkBtn}>
                        Show in folder
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 p-4 rounded-card bg-tw-ground/60 border border-tw-line">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-body font-semibold">Single-colour printer</h3>
            <p className="m-0 text-small text-tw-ink-2">
              The model as an STL for any slicer, plus a guide with the exact layers to pause at and which filament to load.
            </p>
          </div>
          <Button size="lg" icon={<FolderArchive className="w-4 h-4" aria-hidden="true" />} onClick={handleExportNoAmsBundleZip} disabled={exporting}>
            Export STL and pause guide (.zip)
          </Button>
          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" variant="ghost" icon={<FileCode className="w-3.5 h-3.5" aria-hidden="true" />} onClick={handleExportBinaryStl} disabled={exporting} title="Only the STL model">
              STL only
            </Button>
            <Button size="sm" variant="ghost" icon={<Globe className="w-3.5 h-3.5" aria-hidden="true" />} onClick={handleExportHtmlGuide} disabled={exporting} title="The pause guide as a web page you can open in any browser">
              Guide (web page)
            </Button>
            <Button size="sm" variant="ghost" icon={<FileText className="w-3.5 h-3.5" aria-hidden="true" />} onClick={handleExportPlaybookTxt} disabled={exporting} title="The pause guide as plain text">
              Guide (text)
            </Button>
          </div>
        </div>
      </div>

      {/* When to change filament */}
      <DialogSection
        title="Filament changes"
        meta={`${playbook.length} filament${playbook.length === 1 ? '' : 's'}`}
        actions={
          <Button size="sm" variant="ghost" icon={copied ? <Check className="w-3.5 h-3.5 text-tw-ok" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />} onClick={handleCopyPlaybook}>
            {copied ? 'Copied' : 'Copy as text'}
          </Button>
        }
      >
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 m-0 p-0 list-none">
          {playbook.map((item, idx) => (
            <li key={item.slotIndex} className="flex flex-col gap-1 p-2.5 rounded-control bg-tw-ground/60 border border-tw-line">
              <span className={`text-small font-medium ${idx === 0 ? 'text-tw-ok' : 'text-tw-accent-text'}`}>
                {idx === 0 ? 'Start the print' : `Pause at layer ${item.startLayer}`}
              </span>
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" style={{ backgroundColor: item.hex }} aria-hidden="true" />
                <span className="text-body text-tw-ink truncate">Load {item.spoolName}</span>
              </span>
              <span className="font-mono text-micro text-tw-ink-2">
                Layers {item.startLayer}–{item.endLayer}, {item.startZMm.toFixed(2)}–{item.endZMm.toFixed(2)} mm, TD {item.td} mm
              </span>
            </li>
          ))}
        </ol>
        <details className="text-small">
          <summary className={`cursor-pointer text-tw-ink-2 hover:text-tw-ink rounded ${FOCUS_RING}`}>Show the guide as text</summary>
          <pre className="mt-2 p-3 rounded-control bg-tw-ground border border-tw-line font-mono text-micro text-tw-ink-2 overflow-x-auto max-h-48 whitespace-pre">{playbookText}</pre>
        </details>
      </DialogSection>

      {/* What the print should look like */}
      <DialogSection title="Predicted result" meta="A prediction from the filament data, not a measurement">
        {previewUrl ? (
          <figure className="m-0 flex flex-col gap-1">
            <img
              src={previewUrl}
              alt="Left: your photo. Right: the predicted print from the exact layers in the export."
              className="w-full max-h-72 object-contain rounded-control bg-tw-ground border border-tw-line"
              style={{ imageRendering: 'pixelated' }}
            />
            <figcaption className="grid grid-cols-2 text-micro text-tw-ink-2 text-center">
              <span>Your photo</span>
              <span>Predicted print</span>
            </figcaption>
          </figure>
        ) : (
          <p className="m-0 text-small text-tw-ink-2">Load a photo to see the predicted print.</p>
        )}

        {fidelity && fidelity.printedColumns > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-4 gap-2">
                {([
                  ['Average', fidelity.meanDeltaE00],
                  ['Median', fidelity.medianDeltaE00],
                  ['Worst 5%', fidelity.p95DeltaE00],
                  ['Worst', fidelity.maxDeltaE00],
                ] as const).map(([label, v]) => (
                  <div key={label} className="flex flex-col gap-0.5 p-2 rounded-control bg-tw-ground/60 border border-tw-line">
                    <span className="font-mono text-title text-tw-ink">{v.toFixed(1)}</span>
                    <span className="text-micro text-tw-ink-2">{label} ΔE</span>
                  </div>
                ))}
              </div>
              <p className="m-0 text-micro text-tw-ink-3">ΔE is the colour difference: under 2 is too small to see, over 10 is clearly different.</p>
              <div className="flex h-2.5 rounded overflow-hidden border border-tw-line" title="Share of the print by predicted colour difference">
                {(Object.keys(shareColours) as Array<keyof typeof shareColours>).map((k) => (
                  <div key={k} style={{ width: fidelity.share[k] * 100 + '%', background: shareColours[k] }} />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 m-0 p-0 list-none text-micro text-tw-ink-2">
                {([
                  ['imperceptible', 'look identical'],
                  ['close', 'very close'],
                  ['noticeable', 'noticeable'],
                  ['clear', 'clearly different'],
                ] as const).map(([k, label]) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: shareColours[k] }} aria-hidden="true" />
                    {Math.round(fidelity.share[k] * 100)}% {label}
                  </li>
                ))}
              </ul>
              {fidelity.focus && (
                <p className="m-0 px-2.5 py-1.5 rounded-control bg-tw-accent/10 border border-tw-accent/30 text-small text-tw-accent-text">
                  Focus area: average ΔE {fidelity.focus.meanDeltaE00.toFixed(1)}, worst 5% {fidelity.focus.p95DeltaE00.toFixed(1)},{' '}
                  {Math.round(fidelity.focus.imperceptibleShare * 100)}% look identical.
                </p>
              )}
              <p className="m-0 text-small text-tw-ink-2">
                {Math.round(fidelity.gamutLimitedShare * 100)}% of the photo is beyond what these filaments can reach. {fidelity.swapCount} filament change
                {fidelity.swapCount === 1 ? '' : 's'}.
              </p>
              {(fidelity.warnings.length > 0 || printCost.warnings.length > 0) && (
                <ul className="list-disc pl-4 m-0 text-small text-tw-warn">
                  {[...fidelity.warnings, ...printCost.warnings].map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
            {heatUrl && (
              <figure className="m-0 flex flex-col items-center gap-1">
                <img src={heatUrl} alt="Colour difference map: green matches the photo, red is clearly different" className="w-40 h-40 object-contain rounded-control bg-tw-ground border border-tw-line" style={{ imageRendering: 'pixelated' }} />
                <figcaption className="text-micro text-tw-ink-2">Green matches, red differs</figcaption>
              </figure>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />} onClick={handleExportPreview} disabled={exporting || !previewPng} title="The side-by-side comparison as a PNG">
            Save comparison image
          </Button>
          <Button size="sm" variant="ghost" icon={<Braces className="w-3.5 h-3.5" aria-hidden="true" />} onClick={handleExportMetadata} disabled={exporting} title="Total height, base layer, swap heights and filament order as JSON">
            Save print data (JSON)
          </Button>
        </div>
      </DialogSection>
    </Dialog>
  );
};

