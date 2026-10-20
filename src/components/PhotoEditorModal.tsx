import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Crop, Eraser, Paintbrush, Trash2 } from 'lucide-react';
import { Button, Dialog, Segmented, SliderRow } from './ui';
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
    <Dialog
      open={isOpen}
      onClose={onClose}
      size="xl"
      icon={<Crop className="w-5 h-5" />}
      title="Edit photo"
      subtitle="Crop, turn or straighten the photo, and mark the area that matters most. The print keeps the crop's shape."
      footer={
        <>
          <span className="mr-auto text-small text-tw-ink-2">Applying picks the filaments again for the edited photo.</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onApply({ edit, mask: maskHasFocus(mask) ? mask : null, strength })}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 flex items-center justify-center bg-tw-ground border border-tw-line rounded-card p-2 min-h-[300px]">
          <canvas
            ref={canvasRef}
            className={`max-w-full h-auto touch-none ${tab === 'focus' ? 'cursor-none' : 'cursor-move'}`}
            style={{ width: dispW }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => setHover(null)}
            aria-label={tab === 'focus' ? 'Photo: paint the focus area' : 'Photo: drag the crop frame or its corners'}
          />
        </div>

        <div className="lg:w-72 flex flex-col gap-4">
          <Segmented
            label="Edit mode"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'crop', label: 'Crop and rotate' },
              { value: 'focus', label: 'Focus area' },
            ]}
          />

          {tab === 'crop' ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button icon={<RotateCcw className="w-4 h-4" aria-hidden="true" />} onClick={() => rotateBy(-90)}>
                  Turn left
                </Button>
                <Button icon={<RotateCw className="w-4 h-4" aria-hidden="true" />} onClick={() => rotateBy(90)}>
                  Turn right
                </Button>
              </div>
              <SliderRow
                label="Straighten"
                valueText={`${edit.straighten.toFixed(1)}°`}
                min={-STRAIGHTEN_LIMIT_DEG}
                max={STRAIGHTEN_LIMIT_DEG}
                step={0.5}
                value={edit.straighten}
                onChange={(e) => setStraighten(parseFloat(e.target.value))}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-small text-tw-ink-2">Crop shape</span>
                <Segmented
                  label="Crop shape"
                  size="sm"
                  value={aspect}
                  onChange={(a) => {
                    setAspect(a);
                    if (a !== 'free') setEdit((e) => ({ ...e, crop: fitAspect(a) }));
                  }}
                  options={ASPECTS.map((a) => ({ value: a.id, label: a.label }))}
                />
              </div>
              <p className="m-0 text-small text-tw-ink-2">Drag inside the frame to move it, or drag a corner to resize it.</p>
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => {
                  setAspect('free');
                  setEdit({ ...DEFAULT_EDIT });
                }}
              >
                Reset crop and rotation
              </Button>
            </>
          ) : (
            <>
              <Segmented
                label="Brush"
                value={erasing ? 'erase' : 'paint'}
                onChange={(v) => setErasing(v === 'erase')}
                options={[
                  { value: 'paint', label: <span className="inline-flex items-center gap-1.5"><Paintbrush className="w-3.5 h-3.5" aria-hidden="true" /> Paint</span> },
                  { value: 'erase', label: <span className="inline-flex items-center gap-1.5"><Eraser className="w-3.5 h-3.5" aria-hidden="true" /> Erase</span> },
                ]}
              />
              <SliderRow label="Brush size" valueText={`${brushPct}%`} min={1} max={20} step={1} value={brushPct} onChange={(e) => setBrushPct(parseInt(e.target.value, 10))} />
              <p className="m-0 text-small text-tw-ink-2">
                Paint over what matters most, such as a face. TailWag weighs it more when it picks filaments and swap layers. It helps most when that area's colours are rare in the rest of the photo; the Export dialog shows how close the focus area gets.
              </p>
              <div className="flex flex-col gap-1.5">
                <span className="text-small text-tw-ink-2">Focus strength</span>
                <Segmented label="Focus strength" value={strength} onChange={setStrength} options={STRENGTHS.map((s) => ({ value: s.id, label: s.label }))} />
                <span className="text-micro text-tw-ink-3">{STRENGTHS.find((s) => s.id === strength)?.hint}</span>
              </div>
              {!focusApplies && (
                <p className="m-0 text-small text-tw-warn">
                  Focus only changes the result with the Best match method in Faithful mode. It is saved and used when you switch back.
                </p>
              )}
              <Button size="sm" variant="ghost" className="self-start" icon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => setMask(null)} disabled={!focusOn}>
                Clear focus area
              </Button>
            </>
          )}

          <p className="m-0 mt-auto pt-2 border-t border-tw-line text-micro text-tw-ink-3">
            Crop: {Math.round(px.width)} × {Math.round(px.height)} px{focusOn ? ', focus area painted' : ''}
          </p>
        </div>
      </div>
    </Dialog>
  );
};
