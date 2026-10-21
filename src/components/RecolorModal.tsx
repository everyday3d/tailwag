import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Palette, Pipette, Trash2 } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { applyPhotoEdit } from '../engine/photoEdit';
import { RECOLOR_TOLERANCE, applyRecolor, hexToLab, recolorWeight, rgbToHex, type RecolorRule } from '../engine/recolor';
import { rgbToLab } from '../engine/colorScience';
import { Button, Dialog, FOCUS_RING, SliderRow } from './ui';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: (rules: RecolorRule[]) => void;
}

const MAX_RULES = 12;
const VIEW_MAX = 520;

/** "This colour in the picture should be that colour": click a colour, pick what it becomes. */
export const RecolorModal: React.FC<Props> = ({ isOpen, onClose, onApply }) => {
  const { photoOriginal, photoEdit, sourceImageData, catalog } = useTailWagStore();
  const [rules, setRules] = useState<RecolorRule[]>([]);
  const [active, setActive] = useState(-1);
  const [showArea, setShowArea] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setRules(photoEdit.recolor ?? []);
    setActive(photoEdit.recolor?.length ? 0 : -1);
    setShowArea(false);
    // Only when the window opens: edits in progress are kept while it is open
  }, [isOpen]);

  // The picture before any recolouring (after crop and Fix photo): what the person clicks on
  const base = useMemo(() => {
    const original = photoOriginal ?? sourceImageData;
    if (!isOpen || !original) return null;
    if (!photoOriginal) return { width: original.width, height: original.height, data: new Uint8ClampedArray(original.data) };
    return applyPhotoEdit(original, { ...photoEdit, recolor: [] });
  }, [isOpen, photoOriginal, photoEdit, sourceImageData]);

  // Your own spools, one swatch per colour: the likeliest things to recolour to
  const swatches = useMemo(() => {
    const seen = new Set<string>();
    return catalog.filter((s) => s.owned && !seen.has(s.hex.toUpperCase()) && seen.add(s.hex.toUpperCase())).slice(0, 24);
  }, [catalog]);

  const scale = base ? Math.min(1, VIEW_MAX / Math.max(base.width, base.height)) : 1;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !base) return;
    cv.width = base.width;
    cv.height = base.height;
    const ctx = cv.getContext('2d')!;
    let img: Uint8ClampedArray;
    if (showArea && rules[active]) {
      // Greyed picture, with what the selected change moves shown in orange (stronger = moved more)
      const r = rules[active];
      const from = hexToLab(r.from);
      img = new Uint8ClampedArray(base.data);
      const weights = new Map<number, number>();
      for (let i = 0; i < img.length; i += 4) {
        const key = (img[i] << 16) | (img[i + 1] << 8) | img[i + 2];
        let w = weights.get(key);
        if (w === undefined) {
          const c = rgbToLab({ r: img[i] / 255, g: img[i + 1] / 255, b: img[i + 2] / 255 });
          w = recolorWeight(Math.hypot(c.L - from.L, c.a - from.a, c.b - from.b), r.tolerance);
          weights.set(key, w);
        }
        const g = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        img[i] = g * 0.45 * (1 - w) + 255 * w;
        img[i + 1] = g * 0.45 * (1 - w) + 140 * w;
        img[i + 2] = g * 0.45 * (1 - w) + 40 * w;
      }
    } else {
      img = applyRecolor(base, rules).data;
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img), base.width, base.height), 0, 0);
  }, [base, rules, showArea, active]);

  if (!isOpen || !base) return null;

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * base.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * base.height);
    // Average a 3 x 3 patch so a noisy pixel doesn't decide the colour
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.min(base.width - 1, Math.max(0, x + dx));
        const yy = Math.min(base.height - 1, Math.max(0, y + dy));
        const i = (yy * base.width + xx) * 4;
        r += base.data[i];
        g += base.data[i + 1];
        b += base.data[i + 2];
        n++;
      }
    }
    const from = rgbToHex(r / n, g / n, b / n);
    if (rules.length >= MAX_RULES) return;
    setRules([...rules, { from, to: from, tolerance: RECOLOR_TOLERANCE.default }]);
    setActive(rules.length);
  };

  const update = (patch: Partial<RecolorRule>) => setRules(rules.map((r, i) => (i === active ? { ...r, ...patch } : r)));
  const remove = (i: number) => {
    setRules(rules.filter((_, k) => k !== i));
    setActive(-1);
  };
  const current = rules[active];

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      size="xl"
      icon={<Palette className="w-5 h-5" />}
      title="Recolour"
      subtitle="Click a colour in the picture, then choose what it should become. Shading stays, so fur and texture still look right."
      footer={
        <>
          <span className="mr-auto text-small text-tw-ink-2">Applying picks the filaments again for the new colours.</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onApply(rules.filter((r) => r.from !== r.to))}>
            Apply
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
        <div className="flex flex-col gap-2 items-center justify-center p-3 rounded-card bg-tw-ground border border-tw-line">
          <canvas
            ref={canvasRef}
            onClick={pick}
            title="Click a colour to change it"
            className="cursor-crosshair rounded"
            style={{ width: base.width * scale, height: base.height * scale, imageRendering: 'auto' }}
          />
          <span className="flex items-center gap-1.5 text-micro text-tw-ink-3">
            <Pipette className="w-3.5 h-3.5" aria-hidden="true" />
            Click the picture to pick a colour ({rules.length}/{MAX_RULES})
          </span>
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          {rules.length === 0 ? (
            <p className="m-0 text-small text-tw-ink-2">
              No changes yet. Click a colour in the picture, for example an orange that should be light brown.
            </p>
          ) : (
            <div role="list" className="flex flex-col gap-1.5">
              {rules.map((r, i) => (
                <div
                  key={i}
                  role="listitem"
                  className={`flex items-center gap-2 p-1.5 rounded-control border ${i === active ? 'border-tw-accent bg-tw-accent/10' : 'border-tw-line'}`}
                >
                  <button type="button" onClick={() => setActive(i)} className={`flex flex-1 items-center gap-2 min-w-0 text-left ${FOCUS_RING}`} aria-pressed={i === active}>
                    <span className="w-6 h-6 rounded-md border border-tw-line-strong shrink-0" style={{ backgroundColor: r.from }} title={`From ${r.from}`} />
                    <ArrowRight className="w-3.5 h-3.5 text-tw-ink-3 shrink-0" aria-hidden="true" />
                    <span className="w-6 h-6 rounded-md border border-tw-line-strong shrink-0" style={{ backgroundColor: r.to }} title={`To ${r.to}`} />
                    <span className="text-small text-tw-ink-2 truncate">
                      {r.from === r.to ? 'Choose a new colour' : `${r.from} → ${r.to}`}
                    </span>
                  </button>
                  <button type="button" onClick={() => remove(i)} aria-label="Remove this change" className={`p-1 rounded-md text-tw-ink-3 hover:text-tw-danger ${FOCUS_RING}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {current && (
            <div className="flex flex-col gap-3 p-3 rounded-control bg-tw-raised/60 border border-tw-line">
              <span className="text-small text-tw-ink-2">Becomes one of your spools</span>
              <div role="group" aria-label="Your spools" className="flex flex-wrap gap-1.5">
                {swatches.map((s) => {
                  const on = s.hex.toUpperCase() === current.to.toUpperCase();
                  return (
                    <button
                      key={s.hex}
                      type="button"
                      title={`${s.brand} ${s.name}`}
                      aria-label={`${s.brand} ${s.name}`}
                      aria-pressed={on}
                      onClick={() => update({ to: s.hex.toUpperCase() })}
                      className={`w-6 h-6 rounded-full border ${on ? 'border-tw-accent ring-2 ring-tw-accent/60' : 'border-tw-line-strong'} ${FOCUS_RING}`}
                      style={{ backgroundColor: s.hex }}
                    />
                  );
                })}
              </div>
              <label className="flex items-center justify-between gap-2 text-small text-tw-ink-2">
                Or any colour
                <input
                  type="color"
                  value={current.to}
                  onChange={(e) => update({ to: e.target.value.toUpperCase() })}
                  className={`h-8 w-20 rounded-control bg-tw-ground border border-tw-line cursor-pointer ${FOCUS_RING}`}
                />
              </label>
              <SliderRow
                label="How similar"
                valueText={current.tolerance <= 12 ? 'Just this shade' : current.tolerance <= 26 ? 'Nearby shades' : 'A wide range'}
                hint="How far from the picked colour still counts."
                min={RECOLOR_TOLERANCE.min}
                max={RECOLOR_TOLERANCE.max}
                step={1}
                value={current.tolerance}
                onChange={(e) => update({ tolerance: Number(e.target.value) })}
              />
              <label className="flex items-center gap-2 text-small text-tw-ink-2 cursor-pointer">
                <input type="checkbox" checked={showArea} onChange={(e) => setShowArea(e.target.checked)} className={`w-4 h-4 accent-tw-accent ${FOCUS_RING}`} />
                Show the area that changes
              </label>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
};
