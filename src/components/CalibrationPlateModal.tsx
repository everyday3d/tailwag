import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Download, Camera, Check } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import type { FilamentSpool } from '../data/filamentCatalog';
import { generateCalibrationPlate3mf } from '../engine/calibrationPlate3mf';
import {
  buildPlateLayout,
  observationsForFilament,
  samplePlatePhoto,
  type PhotoPoint,
} from '../engine/calibrationPlate';
import { fitOpticalProfile, type CalibrationFit } from '../engine/calibrationFit';
import { CALIBRATION_MODEL_ID, profileForSpool } from '../engine/opticalModel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const DISPLAY_W = 560;

export const CalibrationPlateModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { catalog, updateSpool } = useTailWagStore();
  const owned = useMemo(() => {
    const mine = catalog.filter((s) => s.owned);
    return mine.length >= 3 ? mine : catalog;
  }, [catalog]);

  const [whiteId, setWhiteId] = useState('');
  const [blackId, setBlackId] = useState('');
  const [testIds, setTestIds] = useState<string[]>([]);
  const [corners, setCorners] = useState<PhotoPoint[]>([]);
  const [imgInfo, setImgInfo] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [fits, setFits] = useState<Array<{ spool: FilamentSpool; fit: CalibrationFit }> | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<ImageData | null>(null);
  const bitmapRef = useRef<HTMLImageElement | null>(null);

  const byId = (id: string) => catalog.find((s) => s.id === id);

  const redraw = (pts: PhotoPoint[], info = imgInfo) => {
    const cv = canvasRef.current;
    const img = bitmapRef.current;
    if (!cv || !img || !info) return;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ff2d6f';
    ctx.strokeStyle = '#fff';
    pts.forEach((p, i) => {
      const x = p.x * info.scale;
      const y = p.y * info.scale;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), x + 9, y - 9);
      ctx.fillStyle = '#ff2d6f';
    });
  };

  useEffect(() => {
    if (imgInfo) redraw(corners);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corners, imgInfo]);

  if (!isOpen) return null;

  const ready = whiteId && blackId && testIds.length > 0;

  const download = () => {
    const w = byId(whiteId)!;
    const b = byId(blackId)!;
    const tests = testIds.map((id) => byId(id)!);
    const data = generateCalibrationPlate3mf({
      hexColors: [w.hex, b.hex, ...tests.map((t) => t.hex)],
      names: [w.name, b.name, ...tests.map((t) => `${t.brand} ${t.name}`)],
    });
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `TailWag_Calibration_Plate_${testIds.length}filaments_rev1.3mf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, DISPLAY_W / img.width);
      const full = document.createElement('canvas');
      full.width = img.width;
      full.height = img.height;
      const fctx = full.getContext('2d')!;
      fctx.drawImage(img, 0, 0);
      photoRef.current = fctx.getImageData(0, 0, img.width, img.height);
      bitmapRef.current = img;
      const cv = canvasRef.current!;
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      setCorners([]);
      setFits(null);
      setNotes([]);
      setApplied(false);
      setImgInfo({ w: img.width, h: img.height, scale });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imgInfo || corners.length >= 4) return;
    const r = e.currentTarget.getBoundingClientRect();
    const sx = e.currentTarget.width / r.width;
    const x = ((e.clientX - r.left) * sx) / imgInfo.scale;
    const y = ((e.clientY - r.top) * sx) / imgInfo.scale;
    setCorners([...corners, { x, y }]);
  };

  const analyze = () => {
    const photo = photoRef.current;
    if (!photo || corners.length !== 4) return;
    const layout = buildPlateLayout(testIds.length);
    const white = byId(whiteId)!;
    const whiteProfile = profileForSpool(white);
    const whiteRef = (whiteProfile.rInf[0] + whiteProfile.rInf[1] + whiteProfile.rInf[2]) / 3;
    const { patches, warnings } = samplePlatePhoto(
      { width: photo.width, height: photo.height, data: photo.data },
      layout,
      corners as [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint],
      Math.min(0.9, whiteRef)
    );
    const out = testIds.map((id, i) => {
      const spool = byId(id)!;
      return { spool, fit: fitOpticalProfile(observationsForFilament(patches, i), profileForSpool(spool)) };
    });
    setFits(out);
    setNotes(warnings);
    setApplied(false);
  };

  const apply = () => {
    if (!fits) return;
    const date = new Date().toISOString().slice(0, 10);
    fits.forEach(({ spool, fit }) => {
      if (fit.weak) return;
      updateSpool(
        spool.id,
        {
          calibration: {
            rInf: fit.profile.rInf,
            s: fit.profile.s,
            tdMm: fit.profile.tdMm,
            meanDeltaE00: fit.meanDeltaE00,
            maxDeltaE00: fit.maxDeltaE00,
            date,
            modelId: CALIBRATION_MODEL_ID,
          },
          td: Number(fit.profile.tdMm.toFixed(2)),
          tdSource: 'measured',
        },
        { force: true }
      );
    });
    setApplied(true);
  };

  const spoolSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="flex flex-col gap-1 text-[11px] text-slate-300">
      {label}
      <select
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a spool</option>
        {owned.map((s) => (
          <option key={s.id} value={s.id}>
            {s.brand} {s.name} ({s.material})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#10151f] border border-slate-700 rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-4 flex flex-col gap-3 text-slate-200">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Calibration plate: measure your filaments</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          Print one small plate, photograph it, and TailWag fits each filament's real color and transparency. Until you do,
          predicted colors use catalog estimates.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {spoolSelect(whiteId, setWhiteId, '1. White backing spool (opaque white)')}
          {spoolSelect(blackId, setBlackId, '2. Black backing spool')}
        </div>
        <div className="text-[11px] text-slate-300 flex flex-col gap-1">
          3. Filaments to measure (up to 6)
          <div className="flex flex-wrap gap-1">
            {owned.slice(0, 60).map((s) => {
              const on = testIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    setTestIds(on ? testIds.filter((x) => x !== s.id) : testIds.length < 6 ? [...testIds, s.id] : testIds)
                  }
                  className={`px-2 py-0.5 rounded border text-[10px] ${on ? 'bg-sky-500/20 border-sky-400 text-sky-200' : 'border-slate-700 text-slate-400'}`}
                >
                  <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: s.hex }} />
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <button
            disabled={!ready}
            onClick={download}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-sky-600 disabled:opacity-40 text-xs font-bold"
          >
            <Download size={13} /> Download plate (.3mf)
          </button>
          <p className="text-[10px] text-slate-500 mt-1">
            Load it in Bambu Studio or OrcaSlicer without changing settings. Assign the extruders as listed in the file legend
            (1 white, 2 black, then your filaments in order).
          </p>
        </div>

        <div className="border-t border-slate-800 pt-3 flex flex-col gap-2">
          <div className="text-[11px] text-slate-300">
            4. Photograph the finished plate flat in even daylight, then load the photo and click the four black corner marks
            in order: top-left, top-right, bottom-right, bottom-left.
          </div>
          <label className="flex items-center gap-1 px-3 py-1.5 rounded border border-slate-600 text-xs w-fit cursor-pointer">
            <Camera size={13} /> Load photo
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            className="max-w-full rounded border border-slate-800 cursor-crosshair"
            style={{ display: imgInfo ? 'block' : 'none' }}
          />
          {imgInfo && (
            <div className="text-[11px] text-slate-400 flex items-center gap-2">
              {corners.length < 4 ? `Click the ${CORNER_NAMES[corners.length]} mark (${corners.length}/4)` : 'All four corners set.'}
              {corners.length > 0 && (
                <button className="underline" onClick={() => setCorners([])}>
                  Reset
                </button>
              )}
              <button
                disabled={corners.length !== 4}
                onClick={analyze}
                className="ml-auto px-3 py-1 rounded bg-emerald-600 disabled:opacity-40 text-xs font-bold text-white"
              >
                Analyze
              </button>
            </div>
          )}
        </div>

        {notes.length > 0 && (
          <ul className="list-disc pl-4 text-[11px] text-amber-300">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}

        {fits && (
          <div className="flex flex-col gap-1">
            {fits.map(({ spool, fit }) => (
              <div key={spool.id} className="flex items-center gap-2 text-[11px] bg-slate-900 rounded px-2 py-1">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: spool.hex }} />
                <span className="font-bold">{spool.name}</span>
                <span className="text-slate-400">
                  TD {spool.td.toFixed(2)} to {fit.profile.tdMm.toFixed(2)} mm
                </span>
                <span className="text-slate-400">fit error {fit.meanDeltaE00.toFixed(1)} (worst {fit.maxDeltaE00.toFixed(1)})</span>
                {fit.weak && <span className="text-amber-300">not enough usable patches</span>}
                {!fit.weak && fit.meanDeltaE00 > 6 && <span className="text-amber-300">poor fit: check lighting and corners</span>}
              </div>
            ))}
            <button
              onClick={apply}
              disabled={applied || fits.every((f) => f.fit.weak)}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600 disabled:opacity-40 text-xs font-bold text-white w-fit"
            >
              <Check size={13} /> {applied ? 'Applied to your library' : 'Apply to my filaments'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
