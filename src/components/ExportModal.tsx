import React, { useMemo, useState } from 'react';
import { Package, FileCode, FileText, Copy, Check, X } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { HeightmapGrid, generateBinaryStlFromGrid } from '../engine/cadMeshBuilder';
import { buildSwapPlaybook, generatePlaybookText, generateNative3mfPackage } from '../engine/exporter3mf';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: HeightmapGrid;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, grid }) => {
  const { projectName, baseLayerMm, layerHeightMm, totalLayers, slots } = useTailWagStore();
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const playbook = useMemo(
    () => buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers),
    [slots, baseLayerMm, layerHeightMm, totalLayers]
  );

  const playbookText = useMemo(
    () => generatePlaybookText(projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots),
    [projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots]
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
    const pkg = generateNative3mfPackage({
      projectName,
      grid,
      baseLayerMm,
      layerHeightMm,
      totalLayers,
      slots,
    });
    saveUint8OrBuffer(pkg, `${projectName}_TailWag_rev1.3mf`, '3mf');
  };

  const handleExportBinaryStl = () => {
    const stl = generateBinaryStlFromGrid(grid);
    saveUint8OrBuffer(stl, `${projectName}_TailWag_rev1.stl`, 'stl');
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
      <div className="bg-[#121722] border border-slate-700 rounded-xl max-w-3xl w-full p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Package className="w-5 h-5 text-orange-400" />
            <h2 className="text-base font-bold text-white">
              Export Native Bambu Studio / OrcaSlicer .3MF & Swap Playbook
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Visual AMS Layer Swap Schedule Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {playbook.map((item) => (
            <div
              key={item.slotIndex}
              className="bg-[#181f2e] border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1"
            >
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-bold text-orange-400">{item.amsUnitSlot}</span>
                <span className="font-mono">TD {item.td}mm</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="w-4 h-4 rounded-full border border-white/30 shrink-0"
                  style={{ backgroundColor: item.hex }}
                />
                <span className="text-xs font-semibold text-white truncate">{item.spoolName}</span>
              </div>
              <div className="text-[11px] font-mono text-emerald-400 mt-1">
                L{item.startLayer} → L{item.endLayer} ({item.startZMm.toFixed(2)}–{item.endZMm.toFixed(2)}mm)
              </div>
            </div>
          ))}
        </div>

        {/* Printable Recipe Text Preview */}
        <div className="relative">
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-56 leading-relaxed">
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

        {/* Export Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <button
            onClick={handleExport3MF}
            disabled={exporting}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-lg shadow-orange-600/20 transition"
          >
            <Package className="w-4 h-4" />
            Export Native .3MF (Pre-Mapped)
          </button>

          <button
            onClick={handleExportBinaryStl}
            disabled={exporting}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-xs font-semibold transition"
          >
            <FileCode className="w-4 h-4 text-sky-400" />
            Export Watertight Binary .STL
          </button>

          <button
            onClick={handleExportPlaybookTxt}
            disabled={exporting}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-xs font-semibold transition"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            Save Swap Playbook (.TXT)
          </button>
        </div>
      </div>
    </div>
  );
};
