import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, RotateCcw, RotateCw, Crop, Crosshair, Eraser, Paintbrush, Trash2 } from 'lucide-react';
import {
  DEFAULT_EDIT,
  FOCUS_SHARE,
  STRAIGHTEN_LIMIT_DEG,
  clampCrop,
  cropPixelSize,
  editSpaceSize,
  editToSource,
  emptyMask,
  maskHasFocus,
  paintMask,
  validCropScale,
  type CropRect,
  type FocusStrength,
  type Mask,
  type PhotoEdit,
} from '../engine/photoEdit';

export interface PhotoEditResult {
  edit: PhotoEdit;
  mask: Mask | null;
  strength: FocusStrength;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: (result: PhotoEditResult) => void;
  original: ImageData;
  edit: PhotoEdit;
  mask: Mask | null;
  strength: FocusStrength;
  /** Focus only changes the result in Faithful match mode with the Natural colour solver. */
  focusApplies: boolean;
}

type Tab = 'crop' | 'focus';
type Aspect = 'free' | '1:1' | '4:3' | '3:4' | 'photo';
const ASPECTS: Array<{ id: Aspect; label: string }> = [
  { id: 'free', label: 'Free' },
  { id: '1:1', label: 'Square' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: 'photo', label: 'Photo' },
];
const STRENGTHS: Array<{ id: FocusStrength; label: string; hint: string }> = [
  { id: 'gentle', label: 'Gentle', hint: 'The focus area counts a little more than the rest.' },
  { id: 'balanced', label: 'Balanced', hint: 'The focus area gets half of the attention, whatever its size.' },
  { id: 'strong', label: 'Strong', hint: 'Most of the attention goes to the focus area. The rest of the photo may lose colour.' },
];

const STAGE_W = 680;
const STAGE_H = 500;
const HANDLE = 9;

export const PhotoEditorModal: React.FC<Props> = ({ isOpen, onClose, onApply, original, edit: initialEdit, mask: initialMask, strength: initialStrength, focusApplies }) => {
  const [tab, setTab] = useState<Tab>('crop');
  const [edit, setEdit] = useState<PhotoEdit>(initialEdit);
  const [mask, setMask] = useState<Mask | null>(initialMask);
  const [strength, setStrength] = useState<FocusStrength>(initialStrength);
  const [aspect, setAspect] = useState<Aspect>('free');
  const [brushPct, setBrushPct] = useState(6);
  const [erasing, setErasing] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<null | { kind: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'paint'; startX: number; startY: number; crop: CropRect }>(null);

  // Reset to what the app has whenever the dialog opens
  useEffect(() => {
    if (!isOpen) return;
    setEdit(initialEdit);
    setMask(initialMask);
    setStrength(initialStrength);
    setAspect('free');
    setTab('crop');
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const srcW = original.width;
  const srcH = original.height;
  const space = editSpaceSize(srcW, srcH, edit.rotate);
  const k = Math.min(STAGE_W / space.width, STAGE_H / space.height);
  const dispW = Math.round(space.width * k);
  const dispH = Math.round(space.height * k);
  const validScale = validCropScale(space.width, space.height, edit.straighten);

  const photoCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = srcW;
    c.height = srcH;
    c.getContext('2d')!.putImageData(original, 0, 0);
    return c;
  }, [original, srcW, srcH]);

  const maskCanvas = useMemo(() => {
    if (!mask || !maskHasFocus(mask)) return null;
    const c = document.createElement('canvas');
    c.width = mask.width;
    c.height = mask.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] > 127) img.data.set([251, 146, 60, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }, [mask]);

  // Draw: photo in edit space, focus tint, crop shade, crop frame, brush outline
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isOpen || !canvas) return;
    canvas.width = dispW;
    canvas.height = dispH;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, dispW, dispH);
    const inEditSpace = (draw: () => void) => {
      ctx.save();
      ctx.translate(dispW / 2, dispH / 2);
      ctx.rotate((edit.straighten * Math.PI) / 180);
      ctx.rotate((edit.rotate * Math.PI) / 180);
      draw();
      ctx.restore();
    };
    inEditSpace(() => ctx.drawImage(photoCanvas, (-srcW * k) / 2, (-srcH * k) / 2, srcW * k, srcH * k));
    if (maskCanvas) {
      inEditSpace(() => {
        ctx.globalAlpha = 0.45;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(maskCanvas, (-srcW * k) / 2, (-srcH * k) / 2, srcW * k, srcH * k);
      });
    }
    const c = edit.crop;
    const cx = c.x * dispW;
    const cy = c.y * dispH;
    const cw = c.w * dispW;
    const ch = c.h * dispH;
    ctx.fillStyle = 'rgba(8, 11, 18, 0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, dispW, dispH);
    ctx.rect(cx, cy, cw, ch);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
    if (tab === 'crop') {
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + (cw * i) / 3, cy);
        ctx.lineTo(cx + (cw * i) / 3, cy + ch);
        ctx.moveTo(cx, cy + (ch * i) / 3);
        ctx.lineTo(cx + cw, cy + (ch * i) / 3);
        ctx.stroke();
      }
      ctx.fillStyle = '#fb923c';
      for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
        ctx.fillRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
      }
    } else if (hover) {
      ctx.strokeStyle = erasing ? '#e2e8f0' : '#fb923c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, (brushPct / 100) * Math.max(srcW, srcH) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [isOpen, edit, maskCanvas, photoCanvas, dispW, dispH, k, srcW, srcH, tab, hover, brushPct, erasing]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // ---- crop helpers (all in normalized edit space)
  const ratioFor = (a: Aspect): number | null => {
    if (a === 'free') return null;
    if (a === 'photo') return space.width / space.height;
    const [w, h] = a.split(':').map(Number);
    return w / h;
  };
  /** Largest centred crop with this aspect inside the valid area. */
  const fitAspect = (a: Aspect, scale = validScale): CropRect => {
    const r = ratioFor(a);
    if (r === null) return clampCrop({ x: 0, y: 0, w: 1, h: 1 }, scale);
    // normalized w/h for pixel ratio r: (w*W)/(h*H) = r
    let w = scale;
    let h = (w * space.width) / (r * space.height);
    if (h > scale) {
      h = scale;
      w = (h * r * space.height) / space.width;
    }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  };
  const setCrop = (crop: CropRect) => setEdit((e) => ({ ...e, crop: clampCrop(crop, validScale) }));

  const rotateBy = (deg: 90 | -90) =>
    setEdit((e) => {
      const rotate = (((e.rotate + deg) % 360) + 360) % 360 as PhotoEdit['rotate'];
      const s = editSpaceSize(srcW, srcH, rotate);
      const scale = validCropScale(s.width, s.height, e.straighten);
      return { ...e, rotate, crop: clampCrop({ x: 0, y: 0, w: 1, h: 1 }, scale) };
    });
  const setStraighten = (deg: number) =>
    setEdit((e) => {
      const scale = validCropScale(space.width, space.height, deg);
      return { ...e, straighten: deg, crop: clampCrop(e.crop, scale) };
    });

  // ---- pointer handling
  const local = (ev: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) * dispW) / r.width, y: ((ev.clientY - r.top) * dispH) / r.height };
  };
  /** Paints a stroke from the previous point, stamping every third of a brush width so fast drags leave no gaps. */
  const paintAt = (x: number, y: number, fromX = x, fromY = y) => {
    const radius = (brushPct / 100) * Math.max(srcW, srcH);
    const stepPx = Math.max(1, (radius * k) / 3);
    const steps = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / stepPx));
    setMask((m) => {
      let next = m ?? emptyMask(srcW, srcH);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const [sx, sy] = editToSource((fromX + (x - fromX) * t) / k, (fromY + (y - fromY) * t) / k, srcW, srcH, edit);
        next = paintMask(next, srcW, srcH, sx, sy, radius, erasing ? 0 : 255);
      }
      return next;
    });
  };
  const onDown = (ev: React.PointerEvent) => {
    const p = local(ev);
    canvasRef.current!.setPointerCapture(ev.pointerId);
    if (tab === 'focus') {
      drag.current = { kind: 'paint', startX: p.x, startY: p.y, crop: edit.crop };
      paintAt(p.x, p.y);
      return;
    }
    const c = edit.crop;
    const corners = { nw: [c.x, c.y], ne: [c.x + c.w, c.y], sw: [c.x, c.y + c.h], se: [c.x + c.w, c.y + c.h] } as const;
    for (const [kind, [u, v]] of Object.entries(corners)) {
      if (Math.abs(p.x - u * dispW) <= HANDLE && Math.abs(p.y - v * dispH) <= HANDLE) {
        drag.current = { kind: kind as 'nw', startX: p.x, startY: p.y, crop: c };
        return;
      }
    }
    const inside = p.x >= c.x * dispW && p.x <= (c.x + c.w) * dispW && p.y >= c.y * dispH && p.y <= (c.y + c.h) * dispH;
    if (inside) drag.current = { kind: 'move', startX: p.x, startY: p.y, crop: c };
  };
  const onMove = (ev: React.PointerEvent) => {
    const p = local(ev);
    if (tab === 'focus') setHover(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'paint') {
      paintAt(p.x, p.y, d.startX, d.startY);
      d.startX = p.x;
      d.startY = p.y;
      return;
    }
    const dx = (p.x - d.startX) / dispW;
    const dy = (p.y - d.startY) / dispH;
    const c = d.crop;
    if (d.kind === 'move') {
      setCrop({ ...c, x: c.x + dx, y: c.y + dy });
      return;
    }
    // Resize from a corner; the opposite corner stays put
    const left = d.kind === 'nw' || d.kind === 'sw';
    const top = d.kind === 'nw' || d.kind === 'ne';
    let x0 = left ? c.x + dx : c.x;
    let x1 = left ? c.x + c.w : c.x + c.w + dx;
    let y0 = top ? c.y + dy : c.y;
    let y1 = top ? c.y + c.h : c.y + c.h + dy;
    const lo = (1 - validScale) / 2;
    const hi = (1 + validScale) / 2;
    x0 = Math.max(lo, Math.min(x0, x1 - 0.05));
    x1 = Math.min(hi, Math.max(x1, x0 + 0.05));
    y0 = Math.max(lo, Math.min(y0, y1 - 0.05));
    y1 = Math.min(hi, Math.max(y1, y0 + 0.05));
    const r = ratioFor(aspect);
    if (r !== null) {
      // Keep the aspect: width decides, height follows from the fixed corner
      const w = x1 - x0;
      let h = (w * space.width) / (r * space.height);
      const maxH = top ? y1 - lo : hi - y0;
      let w2 = w;
      if (h > maxH) {
        h = maxH;
        w2 = (h * r * space.height) / space.width;
      }
      if (left) x0 = x1 - w2;
      else x1 = x0 + w2;
      if (top) y0 = y1 - h;
      else y1 = y0 + h;
    }
    setCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  };
  const onUp = () => {
    drag.current = null;
  };

  const px = cropPixelSize(srcW, srcH, edit);
  const focusOn = maskHasFocus(mask);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="bg-[#121722] border border-slate-700 rounded-xl w-full max-w-[1040px] p-4 shadow-2xl flex flex-col gap-3 max-h-[94vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Edit photo"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Edit photo</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-lg p-2 min-h-[300px]">
            <canvas
              ref={canvasRef}
              className={`max-w-full h-auto touch-none ${tab === 'focus' ? 'cursor-none' : 'cursor-move'}`}
              style={{ width: dispW }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={() => setHover(null)}
            />
          </div>

          <div className="lg:w-72 flex flex-col gap-3 text-xs text-slate-300">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800" role="tablist">
              {([
                ['crop', 'Crop and rotate', Crop],
                ['focus', 'Focus area', Crosshair],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md font-semibold transition ${
                    tab === id ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {tab === 'crop' ? (
              <>
                <div className="flex gap-2">
                  <button onClick={() => rotateBy(-90)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 font-semibold">
                    <RotateCcw className="w-3.5 h-3.5" /> Turn left
                  </button>
                  <button onClick={() => rotateBy(90)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 font-semibold">
                    <RotateCw className="w-3.5 h-3.5" /> Turn right
                  </button>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="flex justify-between">
                    <span>Straighten</span>
                    <span className="font-mono text-orange-300">{edit.straighten.toFixed(1)}°</span>
                  </span>
                  <input
                    type="range"
                    min={-STRAIGHTEN_LIMIT_DEG}
                    max={STRAIGHTEN_LIMIT_DEG}
                    step={0.5}
                    value={edit.straighten}
                    onChange={(e) => setStraighten(parseFloat(e.target.value))}
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span>Crop shape</span>
                  <div className="grid grid-cols-5 gap-1">
                    {ASPECTS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => {
                          setAspect(a.id);
                          if (a.id !== 'free') setEdit((e) => ({ ...e, crop: fitAspect(a.id) }));
                        }}
                        className={`py-1 rounded border text-[11px] font-semibold ${
                          aspect === a.id ? 'border-orange-500 bg-orange-500/15 text-orange-200' : 'border-slate-700 bg-slate-900 hover:bg-slate-800'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Drag inside the frame to move it, or a corner to resize. The print keeps the crop's shape.
                </p>
                <button
                  onClick={() => {
                    setAspect('free');
                    setEdit({ ...DEFAULT_EDIT });
                  }}
                  className="self-start text-[11px] text-slate-400 hover:text-slate-200 underline"
                >
                  Reset crop and rotation
                </button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setErasing(false)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded border font-semibold ${!erasing ? 'border-orange-500 bg-orange-500/15 text-orange-200' : 'border-slate-700 bg-slate-900'}`}
                  >
                    <Paintbrush className="w-3.5 h-3.5" /> Paint
                  </button>
                  <button
                    onClick={() => setErasing(true)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded border font-semibold ${erasing ? 'border-orange-500 bg-orange-500/15 text-orange-200' : 'border-slate-700 bg-slate-900'}`}
                  >
                    <Eraser className="w-3.5 h-3.5" /> Erase
                  </button>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="flex justify-between">
                    <span>Brush size</span>
                    <span className="font-mono text-orange-300">{brushPct}%</span>
                  </span>
                  <input type="range" min={1} max={20} step={1} value={brushPct} onChange={(e) => setBrushPct(parseInt(e.target.value, 10))} />
                </label>
                <p className="text-[11px] text-slate-400">
                  Paint over what matters most, such as a face. TailWag weighs it more when it picks filaments and swap layers.
                  It helps most when that area's colours are rare in the rest of the photo; the Export dialog shows how close the focus area gets.
                </p>
                <div className="flex flex-col gap-1">
                  <span>Focus strength</span>
                  <div className="grid grid-cols-3 gap-1">
                    {STRENGTHS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStrength(s.id)}
                        className={`py-1 rounded border text-[11px] font-semibold ${
                          strength === s.id ? 'border-orange-500 bg-orange-500/15 text-orange-200' : 'border-slate-700 bg-slate-900 hover:bg-slate-800'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] text-slate-400">{STRENGTHS.find((s) => s.id === strength)?.hint}</span>
                </div>
                {!focusApplies && (
                  <p className="text-[11px] text-amber-300">
                    Focus only changes the result in Faithful match mode with the Natural colour solver. It is saved and used when you switch back.
                  </p>
                )}
                <button
                  onClick={() => setMask(null)}
                  disabled={!focusOn}
                  className="self-start flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 underline disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" /> Clear focus area
                </button>
              </>
            )}

            <div className="mt-auto border-t border-slate-800 pt-2 text-[11px] text-slate-400">
              Crop: {Math.round(px.width)} × {Math.round(px.height)} px{focusOn ? ', focus area painted' : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
          <span className="mr-auto text-[11px] text-slate-400">Applying picks the filaments again for the edited photo.</span>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-600 text-xs font-semibold hover:bg-slate-800">
            Cancel
          </button>
          <button
            onClick={() => onApply({ edit, mask: maskHasFocus(mask) ? mask : null, strength })}
            className="px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
