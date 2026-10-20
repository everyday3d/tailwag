import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Camera, Check } from 'lucide-react';
import { Button, Dialog, DialogSection, SelectField, FOCUS_RING } from './ui';
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
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a spool</option>
      {owned.map((s) => (
        <option key={s.id} value={s.id}>
          {s.brand} {s.name} ({s.material})
        </option>
      ))}
    </SelectField>
  );

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      size="lg"
      icon={<Camera className="w-5 h-5" />}
      title="Calibration plate"
      subtitle="Print one small plate, photograph it, and TailWag measures each filament's real colour and transparency. Until then, colours use catalog estimates."
    >
      <DialogSection title="1. Choose the backing spools">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {spoolSelect(whiteId, setWhiteId, 'White backing (opaque white)')}
          {spoolSelect(blackId, setBlackId, 'Black backing')}
        </div>
      </DialogSection>

      <DialogSection title="2. Choose the filaments to measure" meta={`${testIds.length} of 6 chosen`}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filaments to measure">
          {owned.slice(0, 60).map((s) => {
            const on = testIds.includes(s.id);
            const full = !on && testIds.length >= 6;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => setTestIds(on ? testIds.filter((x) => x !== s.id) : [...testIds, s.id])}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-control border text-small transition disabled:opacity-40 ${FOCUS_RING} ${
                  on ? 'bg-tw-accent/15 border-tw-accent/40 text-tw-accent-text' : 'border-tw-line text-tw-ink-2 hover:text-tw-ink hover:border-tw-line-strong'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" style={{ background: s.hex }} aria-hidden="true" />
                {s.name}
              </button>
            );
          })}
        </div>
      </DialogSection>

      <DialogSection title="3. Print the plate">
        <Button variant="primary" className="self-start" icon={<Download className="w-4 h-4" aria-hidden="true" />} disabled={!ready} onClick={download}>
          Download plate (.3mf)
        </Button>
        <p className="m-0 text-small text-tw-ink-2">
          {ready
            ? 'Open it in Bambu Studio or OrcaSlicer without changing the settings. Load filament 1 white, 2 black, then your filaments in the order chosen.'
            : 'Choose both backing spools and at least one filament first.'}
        </p>
      </DialogSection>

      <DialogSection title="4. Photograph it and mark the corners">
        <p className="m-0 text-small text-tw-ink-2">
          Photograph the finished plate flat, in even daylight and without flash. Load the photo, then click the four black corner marks in order: top-left, top-right, bottom-right, bottom-left.
        </p>
        <label className={`inline-flex items-center gap-1.5 self-start h-8 px-3 rounded-control bg-tw-raised border border-tw-line-strong text-body font-medium cursor-pointer hover:bg-tw-hover focus-within:outline focus-within:outline-2 focus-within:outline-tw-accent`}>
          <Camera className="w-4 h-4" aria-hidden="true" /> Load photo
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          className="max-w-full rounded-control border border-tw-line cursor-crosshair"
          style={{ display: imgInfo ? 'block' : 'none' }}
          aria-label="Plate photo: click the four corner marks"
        />
        {imgInfo && (
          <div className="flex items-center gap-3 text-small text-tw-ink-2">
            <span role="status">{corners.length < 4 ? `Click the ${CORNER_NAMES[corners.length]} mark (${corners.length} of 4)` : 'All four corners set.'}</span>
            {corners.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setCorners([])}>
                Start again
              </Button>
            )}
            <Button variant="primary" size="sm" className="ml-auto" disabled={corners.length !== 4} onClick={analyze}>
              Measure
            </Button>
          </div>
        )}
      </DialogSection>

      {(notes.length > 0 || fits) && (
        <DialogSection title="5. Results">
          {notes.length > 0 && (
            <ul className="list-disc pl-4 m-0 text-small text-tw-warn">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {fits && (
            <>
              <ul className="flex flex-col gap-1 m-0 p-0 list-none">
                {fits.map(({ spool, fit }) => (
                  <li key={spool.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1.5 rounded-control bg-tw-ground/60 border border-tw-line text-small">
                    <span className="w-3 h-3 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" style={{ background: spool.hex }} aria-hidden="true" />
                    <span className="font-medium text-tw-ink">{spool.name}</span>
                    <span className="font-mono text-tw-ink-2">
                      TD {spool.td.toFixed(2)} → {fit.profile.tdMm.toFixed(2)} mm
                    </span>
                    <span className="text-tw-ink-2">
                      fit error {fit.meanDeltaE00.toFixed(1)} ΔE (worst {fit.maxDeltaE00.toFixed(1)})
                    </span>
                    {fit.weak && <span className="text-tw-warn">Not enough usable patches: this one is skipped.</span>}
                    {!fit.weak && fit.meanDeltaE00 > 6 && <span className="text-tw-warn">Poor fit: check the lighting and the corners.</span>}
                  </li>
                ))}
              </ul>
              <Button variant="primary" className="self-start" icon={<Check className="w-4 h-4" aria-hidden="true" />} onClick={apply} disabled={applied || fits.every((f) => f.fit.weak)}>
                {applied ? 'Saved to your filaments' : 'Save to my filaments'}
              </Button>
            </>
          )}
        </DialogSection>
      )}
    </Dialog>
  );
};
