import React, { useState } from 'react';
import { Ruler, Download, Check, Wifi, PlusCircle } from 'lucide-react';
import { Button, Dialog, DialogSection, SliderRow, FOCUS_RING } from './ui';
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
  const [haUrl, setHaUrl] = useState('http://homeassistant.local:8123');
  const [haToken, setHaToken] = useState('');
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

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

  // Reports exactly what happened: nothing is claimed as synced unless trays were read.
  const handleSyncBambuFleetAms = async () => {
    const desktopBridge = (window as any).tailwagDesktop;
    if (!desktopBridge?.fetchHaAms) {
      setSyncStatus({ ok: false, text: 'Reading AMS slots works in the TailWag desktop app only.' });
      return;
    }
    if (!haToken.trim()) {
      setSyncStatus({ ok: false, text: 'Enter a Home Assistant access token first.' });
      return;
    }
    setSyncing(true);
    setSyncStatus(null);
    try {
      const res = await desktopBridge.fetchHaAms({ haUrl, haToken });
      if (!res.ok || !Array.isArray(res.states)) {
        setSyncStatus({ ok: false, text: `Could not reach Home Assistant at ${haUrl} (${res.error || 'no response'}). Nothing was changed.` });
        return;
      }
      const trayStates = res.states.filter((s: any) => s.entity_id?.includes('tray_') || s.entity_id?.includes('ams_'));
      if (trayStates.length === 0) {
        setSyncStatus({ ok: false, text: 'Connected, but no AMS trays were found. Check that the Bambu Fleet Studio integration is set up.' });
        return;
      }
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
      setSyncStatus({ ok: true, text: `Added ${synced.length} AMS tray${synced.length === 1 ? '' : 's'} from ${haUrl}. Their TD is an estimate until you measure them.` });
    } finally {
      setSyncing(false);
    }
  };

  const fieldCls = `h-8 w-full px-2.5 rounded-control bg-tw-ground border border-tw-line text-body text-tw-ink ${FOCUS_RING}`;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      size="lg"
      icon={<Ruler className="w-5 h-5" />}
      title="TD calibrator and AMS"
      subtitle="Measure how see-through a filament is, or read your AMS slots from Home Assistant."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DialogSection title="Measure a filament's TD">
          <p className="m-0 text-small text-tw-ink-2">
            Print the 16-step wedge on top of a black line. Find the first step where the black line has disappeared completely and set it below.
          </p>
          <Button icon={<Download className="w-4 h-4" aria-hidden="true" />} onClick={handleDownloadCalibrationStl}>
            Download the step wedge (.stl)
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-small text-tw-ink-2">
              Brand
              <input value={brand} onChange={(e) => setBrand(e.target.value)} className={fieldCls} />
            </label>
            <label className="flex flex-col gap-1 text-small text-tw-ink-2">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} className={fieldCls} />
            </label>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1 text-small text-tw-ink-2">
              Colour
              <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} className={`w-12 h-8 rounded-control bg-transparent cursor-pointer ${FOCUS_RING}`} />
            </label>
            <div className="flex-1">
              <SliderRow
                label="Line disappears at step"
                valueText={`${opaqueStepNumber} (${(opaqueStepNumber * stepThicknessMm).toFixed(2)} mm)`}
                min={1}
                max={25}
                value={opaqueStepNumber}
                onChange={(e) => setOpaqueStepNumber(parseInt(e.target.value, 10))}
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-control bg-tw-ground/60 border border-tw-line">
            <span className="text-small text-tw-ink-2">Measured TD</span>
            <span className="font-mono text-title text-tw-ink">{calculatedTd} mm</span>
          </div>
          <Button variant="primary" icon={savedToast ? <Check className="w-4 h-4" aria-hidden="true" /> : <PlusCircle className="w-4 h-4" aria-hidden="true" />} onClick={handleSaveCalibratedSpool}>
            {savedToast ? 'Added to my spools' : 'Add to my spools'}
          </Button>
        </DialogSection>

        <DialogSection title="Read AMS slots from Home Assistant">
          <p className="m-0 text-small text-tw-ink-2">
            For Bambu printers connected to Home Assistant with the Bambu Fleet Studio integration. Reads each tray's colour and slot and adds them to your spools.
          </p>
          <label className="flex flex-col gap-1 text-small text-tw-ink-2">
            Home Assistant address
            <input value={haUrl} onChange={(e) => setHaUrl(e.target.value)} placeholder="http://homeassistant.local:8123" className={`${fieldCls} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-small text-tw-ink-2">
            Long-lived access token
            <input type="password" value={haToken} onChange={(e) => setHaToken(e.target.value)} autoComplete="off" className={`${fieldCls} font-mono`} />
            <span className="text-micro text-tw-ink-3">Create one in Home Assistant under your profile, Security tab.</span>
          </label>
          <Button icon={<Wifi className="w-4 h-4" aria-hidden="true" />} onClick={handleSyncBambuFleetAms} disabled={syncing}>
            {syncing ? 'Reading…' : 'Read AMS slots'}
          </Button>
          {syncStatus && (
            <p role="status" className={`m-0 px-2.5 py-1.5 rounded-control border text-small ${syncStatus.ok ? 'bg-tw-ok/10 border-tw-ok/30 text-tw-ok' : 'bg-tw-warn/10 border-tw-warn/30 text-tw-warn'}`}>
              {syncStatus.text}
            </p>
          )}
        </DialogSection>
      </div>
    </Dialog>
  );
};
