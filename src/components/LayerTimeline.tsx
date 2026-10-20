import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { buildLayerColorLUT } from '../engine/opticalTdEngine';
import { Button, IconButton, FOCUS_RING } from './ui';

/**
 * The filament stack: the signature element of the studio. The bar shows the predicted colour of
 * every printed layer, bed on the left and top on the right, grouped into one band per filament.
 * The handles between bands are the swap layers; drag them (or use the arrow keys) to move a
 * colour change. Cards below edit each filament. Library spools can be dropped on the bar or a card.
 */
export const LayerTimeline: React.FC = () => {
  const {
    slots,
    solverColorMode,
    catalog,
    totalLayers,
    baseLayerMm,
    layerHeightMm,
    slicePreviewMaxLayer,
    setSlicePreviewMaxLayer,
    updateSlotLayer,
    updateSlotSpool,
    addSlot,
    insertSpoolAt,
    reorderSlots,
    removeSlot,
  } = useTailWagStore();

  const [dragOverIdx, setDragOverIdx] = useState<number | 'append' | null>(null);
  const [draggingSlotIdx, setDraggingSlotIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [handleActive, setHandleActive] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  const lut = useMemo(() => buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots), [totalLayers, baseLayerMm, layerHeightMm, slots]);
  const mm = (layer: number) => (baseLayerMm + (layer - 1) * layerHeightMm).toFixed(2);
  const bands = slots.map((slot, idx) => {
    const start = idx === 0 ? 1 : slots[idx - 1].upToLayer + 1;
    const end = idx === slots.length - 1 ? totalLayers : slot.upToLayer;
    return { slot, idx, start, end, count: Math.max(0, end - start + 1), role: idx === 0 ? 'Base' : idx === slots.length - 1 ? 'Top' : `#${idx + 1}` };
  });

  // ---- drag and drop from the library or between cards (unchanged behaviour)
  const spoolFrom = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-tailwag-spool-id') || e.dataTransfer.getData('text/plain');
    return id ? catalog.find((c) => c.id === id) : undefined;
  };
  const handleDropOnSlot = (e: React.DragEvent, targetIdx: number, replaceExisting = false) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);
    const fromSlot = e.dataTransfer.getData('application/x-tailwag-slot-index');
    if (fromSlot !== '') {
      const fromIdx = parseInt(fromSlot, 10);
      if (!Number.isNaN(fromIdx) && fromIdx !== targetIdx) reorderSlots(fromIdx, targetIdx);
      setDraggingSlotIdx(null);
      return;
    }
    const found = spoolFrom(e);
    if (found) {
      if (replaceExisting || e.shiftKey || slots.length >= 16) updateSlotSpool(slots[targetIdx].id, found);
      else insertSpoolAt(found, targetIdx);
    }
  };
  const handleDropAppend = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);
    const fromSlot = e.dataTransfer.getData('application/x-tailwag-slot-index');
    if (fromSlot !== '') {
      const fromIdx = parseInt(fromSlot, 10);
      if (!Number.isNaN(fromIdx) && fromIdx !== slots.length - 1) reorderSlots(fromIdx, slots.length - 1);
      setDraggingSlotIdx(null);
      return;
    }
    const found = spoolFrom(e);
    if (found) insertSpoolAt(found);
  };
  const addNext = () => addSlot(catalog.find((c) => !slots.some((s) => s.spool.id === c.id)) || catalog[0]);

  // ---- swap handles: the handle after band i is slots[i].upToLayer
  const layerAtX = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.round(((clientX - r.left) / r.width) * totalLayers);
  };
  // Capture on the handle itself (currentTarget), not whichever inner element was hit.
  const dragging = useRef<number | null>(null);
  const onHandleDown = (i: number) => (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    dragging.current = i;
    setHandleActive(true);
  };
  const onHandleMove = (i: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (dragging.current !== i) return;
    const layer = layerAtX(e.clientX);
    const current = useTailWagStore.getState().slots[i];
    if (current && layer !== current.upToLayer) updateSlotLayer(current.id, layer);
  };
  const onHandleUp = (e: React.PointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = null;
    setHandleActive(false);
  };
  const onHandleKey = (i: number) => (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    // Read the live value so fast repeated presses each count
    const current = useTailWagStore.getState().slots[i];
    if (current) updateSlotLayer(current.id, current.upToLayer + step);
  };
  const selectBand = (idx: number) => {
    setSelected(idx);
    cardRefs.current[idx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  return (
    <div
      className="bg-tw-panel border-t border-tw-line px-4 py-3 flex flex-col gap-2.5 select-none"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropAppend}
    >
      {/* Heading, cutaway and add */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className="m-0 text-title text-tw-ink">Filament stack</h2>
          <span className="text-small text-tw-ink-2 truncate">
            {slots.length} filament{slots.length === 1 ? '' : 's'}, {totalLayers} layers.{' '}
            {solverColorMode === 'manual' ? 'Manual: your swap layers stay put.' : 'Drag a handle to move a colour change.'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-small text-tw-ink-2">
            <span title="Hide the layers above this one in the 3D view">Show up to</span>
            <input
              type="range"
              min={1}
              max={totalLayers}
              value={slicePreviewMaxLayer}
              onChange={(e) => setSlicePreviewMaxLayer(parseInt(e.target.value, 10))}
              className={`w-24 accent-tw-accent ${FOCUS_RING}`}
              aria-label="Show layers up to"
            />
            <span className="font-mono text-tw-ink w-14 text-right">
              {slicePreviewMaxLayer}/{totalLayers}
            </span>
          </label>
          <Button size="sm" icon={<Plus className="w-3.5 h-3.5" aria-hidden="true" />} onClick={addNext} disabled={slots.length >= 16}>
            Add filament
          </Button>
        </div>
      </div>

      {/* The bar: predicted colour of every layer, one band per filament, swap handles between */}
      <div ref={barRef} className="relative flex h-10 gap-[3px]" role="group" aria-label="Layer colours, bed to top">
        {bands.map((b) => (
          <button
            key={b.slot.id}
            type="button"
            onClick={() => selectBand(b.idx)}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragOverIdx !== b.idx) setDragOverIdx(b.idx);
            }}
            onDragLeave={() => dragOverIdx === b.idx && setDragOverIdx(null)}
            onDrop={(e) => handleDropOnSlot(e, b.idx, true)}
            aria-pressed={selected === b.idx}
            aria-label={`${b.slot.spool.name}: layers ${b.start} to ${b.end}`}
            title={`${b.role}: ${b.slot.spool.name}, layers ${b.start}–${b.end} (${mm(b.start)}–${mm(b.end)} mm). Drop a library filament here to replace it.`}
            style={{ flexGrow: b.count, flexBasis: 0 }}
            className={`flex gap-px p-[2px] rounded-[7px] min-w-[10px] transition ${FOCUS_RING} ${
              dragOverIdx === b.idx
                ? 'bg-tw-accent'
                : selected === b.idx
                  ? 'bg-tw-raised shadow-[0_0_0_2px_rgb(var(--twg-accent))]'
                  : 'bg-tw-raised hover:bg-tw-hover'
            }`}
          >
            {lut.slice(b.start - 1, b.end).map((entry) => (
              <span
                key={entry.layer}
                // Explicit height: Electron 33's Chromium does not stretch flex items inside a <button>
                className={`flex-1 h-[36px] self-center rounded-[3px] transition-opacity ${entry.layer > slicePreviewMaxLayer ? 'opacity-25' : ''}`}
                style={{ backgroundColor: entry.hex }}
                title={`Layer ${entry.layer} (${entry.zHeightMm.toFixed(2)} mm): predicted ${entry.hex}`}
              />
            ))}
          </button>
        ))}
        {/* Swap handles, positioned at the boundary after each band except the top one */}
        {bands.slice(0, -1).map((b) => {
          const left = (b.end / totalLayers) * 100;
          return (
            <span
              key={`h-${b.slot.id}`}
              role="slider"
              tabIndex={0}
              aria-label={`Swap from ${b.slot.spool.name} to ${slots[b.idx + 1].spool.name}`}
              aria-valuemin={1}
              aria-valuemax={totalLayers - 1}
              aria-valuenow={b.end}
              aria-valuetext={`after layer ${b.end}, at ${mm(b.end)} mm`}
              title={`Swap after layer ${b.end} (${mm(b.end)} mm). Drag, or focus and use the arrow keys.`}
              onPointerDown={onHandleDown(b.idx)}
              onPointerMove={onHandleMove(b.idx)}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              onKeyDown={onHandleKey(b.idx)}
              style={{ left: `calc(${left}% - 6px)` }}
              className={`absolute -top-1 -bottom-1 w-3 cursor-ew-resize flex justify-center group ${FOCUS_RING} rounded`}
            >
              <span className={`w-1 h-full rounded-full shadow-[0_0_0_1px_rgb(var(--twg-ground))] ${handleActive ? 'bg-tw-accent' : 'bg-tw-ink group-hover:bg-tw-accent'}`} />
            </span>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-micro text-tw-ink-3">
        <span>Layer 1, {mm(1)} mm (bed)</span>
        <span>
          Layer {totalLayers}, {mm(totalLayers)} mm (top)
        </span>
      </div>

      {/* One card per filament */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2 max-h-36 overflow-y-auto pr-1">
        {bands.map((b) => (
          <div
            key={b.slot.id}
            ref={(el) => (cardRefs.current[b.idx] = el)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-tailwag-slot-index', String(b.idx));
              e.dataTransfer.effectAllowed = 'move';
              setDraggingSlotIdx(b.idx);
            }}
            onDragEnd={() => {
              setDraggingSlotIdx(null);
              setDragOverIdx(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragOverIdx !== b.idx) setDragOverIdx(b.idx);
            }}
            onDragLeave={() => dragOverIdx === b.idx && setDragOverIdx(null)}
            onDrop={(e) => handleDropOnSlot(e, b.idx, false)}
            onClick={() => setSelected(b.idx)}
            className={`flex flex-col gap-1 p-2 rounded-card border cursor-grab active:cursor-grabbing transition ${
              dragOverIdx === b.idx || selected === b.idx ? 'border-tw-accent bg-tw-accent/5' : 'border-tw-line bg-tw-ground/60 hover:border-tw-line-strong'
            } ${draggingSlotIdx === b.idx ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                onDrop={(e) => handleDropOnSlot(e, b.idx, true)}
                className="w-3.5 h-3.5 rounded-full shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
                style={{ backgroundColor: b.slot.spool.hex }}
                title="Drop a library filament here to replace this one"
              />
              <span className="text-micro text-tw-ink-2 shrink-0">{b.role}</span>
              <span className="flex-1" />
              <IconButton size="sm" variant="ghost" className="border-transparent w-6 h-6" label="Move toward the bed" icon={<ArrowLeft className="w-3 h-3" />} disabled={b.idx === 0} onClick={() => reorderSlots(b.idx, b.idx - 1)} />
              <IconButton size="sm" variant="ghost" className="border-transparent w-6 h-6" label="Move toward the top" icon={<ArrowRight className="w-3 h-3" />} disabled={b.idx === slots.length - 1} onClick={() => reorderSlots(b.idx, b.idx + 1)} />
              {slots.length > 1 && (
                <IconButton size="sm" variant="ghost" className="border-transparent w-6 h-6 hover:text-tw-danger" label={`Remove ${b.slot.spool.name}`} icon={<Trash2 className="w-3 h-3" />} onClick={() => removeSlot(b.slot.id)} />
              )}
            </div>
            <select
              aria-label={`Filament for ${b.role}`}
              value={b.slot.spool.id}
              onChange={(e) => {
                const found = catalog.find((c) => c.id === e.target.value);
                if (found) updateSlotSpool(b.slot.id, found);
              }}
              className={`w-full bg-tw-ground border border-tw-line rounded-md px-1.5 py-0.5 text-small text-tw-ink truncate ${FOCUS_RING}`}
            >
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.brand}, {c.name} (TD {c.td} mm)
                </option>
              ))}
            </select>
            <div className="flex justify-between gap-2 font-mono text-micro text-tw-ink-2">
              <span>
                Layers {b.start}–{b.end}
              </span>
              <span>TD {b.slot.spool.td.toFixed(1)} mm</span>
            </div>
          </div>
        ))}

        {slots.length < 16 && (
          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragOverIdx !== 'append') setDragOverIdx('append');
            }}
            onDragLeave={() => dragOverIdx === 'append' && setDragOverIdx(null)}
            onDrop={handleDropAppend}
            onClick={addNext}
            title="Drag a filament here from the library, or click to add one"
            className={`flex flex-col items-center justify-center gap-1 min-h-[86px] rounded-card border border-dashed text-small transition ${FOCUS_RING} ${
              dragOverIdx === 'append' ? 'border-tw-accent bg-tw-accent/10 text-tw-accent-text' : 'border-tw-line-strong text-tw-ink-2 hover:text-tw-ink hover:bg-tw-raised'
            }`}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add a filament ({slots.length}/16)
          </button>
        )}
      </div>
    </div>
  );
};
