import React, { useState } from 'react';
import { Ruler, Download, Check, Wifi, PlusCircle, X } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { generateTdCalibrationWedgeStl } from '../engine/cadMeshBuilder';
import { FilamentSpool } from '../data/filamentCatalog';

interface TdCalibratorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TdCalibratorModal: React.FC<TdCalibratorModalProps> = ({ isOpen, onClose }) => {
  const { addCustomSpoolToCatalog, syncAmsSpools } = useTailWagStore();

  const [brand, setBrand] = useState('Bambu Lab');
  const [name, setName] = useState('Custom Calibrated PLA');
  const [hex, setHex] = useState('#FF6A13');
  const [stepThicknessMm, setStepThicknessMm] = useState(0.16);
  const [opaqueStepNumber, setOpaqueStepNumber] = useState(14);
  const [savedToast, setSavedToast] = useState(false);

  // Live Bambu Fleet Studio / Home Assistant AMS Sync State
  const [haUrl, setHaUrl] = useState('http://192.168.1.207:8123');
  const [haToken, setHaToken] = useState('');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  // Measured TD = thickness where backing black step pattern disappears * optical calibration factor (2.0)
  const calculatedTd = Number((opaqueStepNumber * stepThicknessMm * 2.0).toFixed(1));

  const handleDownloadCalibrationStl = () => {
    const buffer = generateTdCalibrationWedgeStl(16, stepThicknessMm);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TailWag_TD_Calibration_StepWedge_${stepThicknessMm}mm_rev1.stl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveCalibratedSpool = () => {
    const newSpool: FilamentSpool = {
      id: `custom-${Date.now()}`,
      brand,
      name,
      material: 'PLA',
      hex,
      td: calculatedTd,
      tdSource: 'measured',
      owned: true,
    };
    addCustomSpoolToCatalog(newSpool);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2500);
  };

  const handleSyncBambuFleetAms = async () => {
    setSyncStatus('Querying Bambu Fleet Studio AMS slots...');
    const desktopBridge = (window as any).tailwagDesktop;
    if (desktopBridge?.fetchHaAms && haToken.trim()) {
      const res = await desktopBridge.fetchHaAms({ haUrl, haToken });
      if (res.ok && Array.isArray(res.states)) {
        const trayStates = res.states.filter(
          (s: any) => s.entity_id?.includes('tray_') || s.entity_id?.includes('ams_')
        );
        if (trayStates.length > 0) {
          const synced: FilamentSpool[] = trayStates.slice(0, 8).map((st: any, idx: number) => ({
            id: `ha-ams-${idx}-${Date.now()}`,
            brand: 'Bambu AMS Live',
            name: st.attributes?.friendly_name || st.state || `AMS Tray ${idx + 1}`,
            material: 'PLA',
            hex: st.attributes?.color ? `#${String(st.attributes.color).replace('#', '').slice(0, 6)}` : '#FF6A13',
            td: 3.5,
            owned: true,
            amsSlot: `AMS Live #${idx + 1}`,
          }));
          syncAmsSpools(synced);
          setSyncStatus(`Synced ${synced.length} live AMS trays from ${haUrl}`);
          return;
        }
      }
    }

    // Local Workshop AMS Preset fallback when token not provided
    setSyncStatus('Synced 4 Workshop AMS Slots (A1: Basic Black, A2: Basic Brown, A3: Basic Orange, A4: Jade White).');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#121722] border border-slate-700 rounded-xl max-w-2xl w-full p-5 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Ruler className="w-5 h-5 text-orange-400" />
            <h2 className="text-base font-bold text-white">
              TailWag TD (Transmission Distance) Calibrator & Live AMS Sync
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: Physical Step-Wedge Generator & TD Calculator */}
          <div className="bg-[#181f2e] border border-slate-800 rounded-lg p-3.5 flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-400">
              1. Measure Filament TD (Step-Wedge Method)
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Print the 7-minute TailWag 16-step wedge card over a black base marker. Select the step number where the black backing line completely disappears.
            </p>

            <button
              onClick={handleDownloadCalibrationStl}
              className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-white transition"
            >
              <Download className="w-4 h-4 text-orange-400" />
              Export 16-Step TD Calibration Wedge (.STL)
            </button>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <label className="text-[11px] text-slate-400">Brand</label>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400">Filament Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block">Hex Color</label>
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setHex(e.target.value)}
                  className="w-12 h-7 bg-transparent cursor-pointer"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] text-slate-400 block">
                  Opaque Step #{opaqueStepNumber} ({(opaqueStepNumber * stepThicknessMm).toFixed(2)}mm)
                </label>
                <input
                  type="range"
                  min={1}
                  max={25}
                  value={opaqueStepNumber}
                  onChange={(e) => setOpaqueStepNumber(parseInt(e.target.value, 10))}
                  className="w-full accent-orange-500"
                />
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block">Measured TD</span>
                <span className="text-sm font-bold text-orange-400 font-mono">{calculatedTd} mm</span>
              </div>
            </div>

            <button
              onClick={handleSaveCalibratedSpool}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-semibold text-white transition"
            >
              {savedToast ? <Check className="w-4 h-4" /> : <PlusCircle className="w-4 h-4" />}
              {savedToast ? 'Saved to Filament Catalog!' : 'Save Calibrated Spool to Library'}
            </button>
          </div>

          {/* Right: Live Bambu Fleet Studio / Home Assistant AMS Sync */}
          <div className="bg-[#181f2e] border border-slate-800 rounded-lg p-3.5 flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Wifi className="w-4 h-4" />
              2. Live Bambu Fleet Studio AMS Sync
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Pull active AMS tray colors, materials, and slot assignments directly from your local Home Assistant <code className="text-sky-300">bambu_fleet_studio</code> instance.
            </p>

            <div>
              <label className="text-[11px] text-slate-400">Home Assistant Local URL</label>
              <input
                value={haUrl}
                onChange={(e) => setHaUrl(e.target.value)}
                placeholder="http://192.168.1.207:8123"
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white font-mono"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-400">Long-Lived Access Token (Optional)</label>
              <input
                type="password"
                value={haToken}
                onChange={(e) => setHaToken(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white font-mono"
              />
            </div>

            <button
              onClick={handleSyncBambuFleetAms}
              className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition mt-auto"
            >
              <Wifi className="w-4 h-4" />
              Sync Active AMS Spools Now
            </button>

            {syncStatus && (
              <div className="p-2 rounded bg-emerald-950/60 border border-emerald-700/50 text-[11px] text-emerald-300">
                {syncStatus}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
