import React, { useMemo, useState } from 'react';
import { Trash2, Plus, Layers, GripVertical, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { buildLayerColorLUT } from '../engine/opticalTdEngine';

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
  const [sliderActiveSlotId, setSliderActiveSlotId] = useState<string | null>(null);

  const lut = useMemo(
    () => buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots),
    [totalLayers, baseLayerMm, layerHeightMm, slots]
  );

  const handleDropOnSlot = (e: React.DragEvent, targetIdx: number, replaceExisting = false) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);

    const fromSlotStr = e.dataTransfer.getData('application/x-tailwag-slot-index');
    if (fromSlotStr !== '') {
      const fromIdx = parseInt(fromSlotStr, 10);
      if (!Number.isNaN(fromIdx) && fromIdx !== targetIdx) {
        reorderSlots(fromIdx, targetIdx);
      }
      setDraggingSlotIdx(null);
      return;
    }

    const spoolId =
      e.dataTransfer.getData('application/x-tailwag-spool-id') ||
      e.dataTransfer.getData('text/plain');
    if (spoolId) {
      const found = catalog.find((c) => c.id === spoolId);
      if (found) {
        if (replaceExisting || e.shiftKey || slots.length >= 16) {
          updateSlotSpool(slots[targetIdx].id, found);
        } else {
          insertSpoolAt(found, targetIdx);
        }
      }
    }
  };

  const handleDropAppend = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIdx(null);

    const fromSlotStr = e.dataTransfer.getData('application/x-tailwag-slot-index');
    if (fromSlotStr !== '') {
      const fromIdx = parseInt(fromSlotStr, 10);
      if (!Number.isNaN(fromIdx) && fromIdx !== slots.length - 1) {
        reorderSlots(fromIdx, slots.length - 1);
      }
      setDraggingSlotIdx(null);
      return;
    }

    const spoolId =
      e.dataTransfer.getData('application/x-tailwag-spool-id') ||
      e.dataTransfer.getData('text/plain');
    if (spoolId) {
      const found = catalog.find((c) => c.id === spoolId);
      if (found) {
        insertSpoolAt(found);
      }
    }
  };

  return (
    <div
      className="bg-[#121722] border-t border-slate-800 px-4 py-3 flex flex-col gap-2.5 select-none"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={handleDropAppend}
    >
      {/* Header + Continuous Optical TD Blend Strip */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <Layers className="w-4 h-4 text-orange-400" />
          <span>
            BEER-LAMBERT TD LAYER BLEND TIMELINE ({slots.length} COLORS • {totalLayers} LAYERS)
          </span>
          <span className="text-[10px] text-emerald-400 font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 hidden md:inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {solverColorMode === 'manual' ? 'Manual: your layers stay put' : 'Auto-Tune & Re-Render'}
          </span>
          <span className="text-[10px] font-normal text-slate-400 hidden lg:inline">
            • Changing filaments or order re-renders stack immediately
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Layer Slice Scrubber */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>X-Ray Layer Cutaway:</span>
            <input
              type="range"
              min={1}
              max={totalLayers}
              value={slicePreviewMaxLayer}
              onInput={(e) => setSlicePreviewMaxLayer(parseInt((e.target as HTMLInputElement).value, 10))}
              onChange={(e) => setSlicePreviewMaxLayer(parseInt(e.target.value, 10))}
              className="w-28 accent-orange-500 cursor-pointer"
            />
            <span className="font-mono text-orange-400 w-14 text-right">
              L{slicePreviewMaxLayer}/{totalLayers}
            </span>
          </div>

          <button
            onClick={() => {
              const candidate = catalog.find((c) => !slots.some((s) => s.spool.id === c.id)) || catalog[0];
              addSlot(candidate);
            }}
            disabled={slots.length >= 16}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 text-orange-300 text-xs font-medium disabled:opacity-40 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Color Layer ({slots.length}/16)
          </button>
        </div>
      </div>

      {/* Live Beer-Lambert Simulated Layer Color Bar */}
      <div className="w-full h-5 rounded-md overflow-hidden flex border border-slate-700/80 shadow-inner">
        {lut.map((entry) => {
          const isSwapBoundary = slots.some((s) => s.upToLayer === entry.layer && entry.layer < totalLayers);
          return (
            <div
              key={entry.layer}
              style={{ backgroundColor: entry.hex }}
              className={`flex-1 h-full relative group ${isSwapBoundary ? 'border-r-2 border-orange-400' : ''}`}
              title={`Layer ${entry.layer} (${entry.zHeightMm.toFixed(2)}mm) • Blended Hex: ${entry.hex} • Active Filament: ${entry.activeSpool.name} (TD ${entry.activeSpool.td}mm)`}
            />
          );
        })}
      </div>

      {/* Individual Filament Slot Sliders (Draggable & Drop-Targetable) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 max-h-44 overflow-y-auto pr-1">
        {slots.map((slot, idx) => {
          const startLayer = idx === 0 ? 1 : slots[idx - 1].upToLayer + 1;
          const endLayer = idx === slots.length - 1 ? totalLayers : slot.upToLayer;
          const startZ = (baseLayerMm + (startLayer - 1) * layerHeightMm).toFixed(2);
          const endZ = (baseLayerMm + (endLayer - 1) * layerHeightMm).toFixed(2);
          const isTopSlot = idx === slots.length - 1;
          const sliderValue = isTopSlot ? Math.max(1, startLayer - 1) : endLayer;
          const orderLabel =
            idx === 0 ? '#1 Base' : idx === slots.length - 1 ? `#${idx + 1} Top` : `#${idx + 1}`;
          const isDragOver = dragOverIdx === idx;
          const isBeingDragged = draggingSlotIdx === idx;

          return (
            <div
              key={slot.id}
              draggable={sliderActiveSlotId !== slot.id}
              onDragStart={(e) => {
                if (sliderActiveSlotId === slot.id) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData('application/x-tailwag-slot-index', String(idx));
                e.dataTransfer.effectAllowed = 'move';
                setDraggingSlotIdx(idx);
              }}
              onDragEnd={() => {
                setDraggingSlotIdx(null);
                setDragOverIdx(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragOverIdx !== idx) setDragOverIdx(idx);
              }}
              onDragLeave={() => {
                if (dragOverIdx === idx) setDragOverIdx(null);
              }}
              onDrop={(e) => handleDropOnSlot(e, idx, false)}
              className={`bg-[#181f2e] rounded-lg p-2 flex flex-col gap-1.5 transition cursor-grab active:cursor-grabbing ${
                isDragOver
                  ? 'border-2 border-orange-400 bg-orange-500/10 shadow-md shadow-orange-500/10'
                  : 'border border-slate-800 hover:border-slate-700'
              } ${isBeingDragged ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <span
                    className="text-slate-500 hover:text-slate-300 cursor-grab shrink-0"
                    title="Drag to rearrange filament lay-down order"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-900 text-orange-300 border border-slate-700/80 font-mono shrink-0">
                    {orderLabel}
                  </span>
                  <span
                    onDrop={(e) => handleDropOnSlot(e, idx, true)}
                    className="w-4 h-4 rounded-full border border-white/30 shrink-0 shadow"
                    style={{ backgroundColor: slot.spool.hex }}
                    title="Drop a library filament on swatch to replace this slot"
                  />
                  <select
                    value={slot.spool.id}
                    onMouseDown={() => setSliderActiveSlotId(slot.id)}
                    onMouseUp={() => setSliderActiveSlotId(null)}
                    onBlur={() => setSliderActiveSlotId(null)}
                    onChange={(e) => {
                      const found = catalog.find((c) => c.id === e.target.value);
                      if (found) updateSlotSpool(slot.id, found);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-100 truncate flex-1 min-w-0 focus:outline-none focus:border-orange-500 cursor-pointer"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.brand} — {c.name} (TD {c.td}mm)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quick Lay-Down Reorder & Remove Controls */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => reorderSlots(idx, idx - 1)}
                    disabled={idx === 0}
                    className="text-slate-400 hover:text-white disabled:opacity-25 p-0.5 rounded hover:bg-slate-800 transition"
                    title="Move earlier in lay-down order (lower layers)"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => reorderSlots(idx, idx + 1)}
                    disabled={idx === slots.length - 1}
                    className="text-slate-400 hover:text-white disabled:opacity-25 p-0.5 rounded hover:bg-slate-800 transition"
                    title="Move later in lay-down order (upper layers)"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                  {slots.length > 1 && (
                    <button
                      onClick={() => removeSlot(slot.id)}
                      className="text-slate-500 hover:text-rose-400 p-0.5 transition"
                      title="Remove filament layer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>
                  L{startLayer}–L{endLayer} ({startZ}–{endZ}mm)
                </span>
                <span className="text-orange-400">TD {slot.spool.td.toFixed(1)}mm</span>
              </div>

              <input
                type="range"
                min={1}
                max={Math.max(1, totalLayers - 1)}
                value={sliderValue}
                disabled={slots.length <= 1}
                onMouseDown={() => setSliderActiveSlotId(slot.id)}
                onMouseUp={() => setSliderActiveSlotId(null)}
                onMouseLeave={() => setSliderActiveSlotId(null)}
                onTouchStart={() => setSliderActiveSlotId(slot.id)}
                onTouchEnd={() => setSliderActiveSlotId(null)}
                onInput={(e) => updateSlotLayer(slot.id, parseInt((e.target as HTMLInputElement).value, 10))}
                onChange={(e) => updateSlotLayer(slot.id, parseInt(e.target.value, 10))}
                title={
                  isTopSlot
                    ? `Adjust highlight start layer (L${startLayer})`
                    : `Adjust swap layer up to L${endLayer}`
                }
                className="w-full accent-orange-500 h-1.5 cursor-pointer disabled:opacity-40"
              />
            </div>
          );
        })}

        {/* Dedicated Dropzone Card to Drag a Filament from Library onto the Palette */}
        {slots.length < 16 && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragOverIdx !== 'append') setDragOverIdx('append');
            }}
            onDragLeave={() => {
              if (dragOverIdx === 'append') setDragOverIdx(null);
            }}
            onDrop={handleDropAppend}
            onClick={() => {
              const candidate = catalog.find((c) => !slots.some((s) => s.spool.id === c.id)) || catalog[0];
              addSlot(candidate);
            }}
            className={`rounded-lg p-2 flex flex-col items-center justify-center gap-1 border border-dashed transition cursor-pointer min-h-[74px] ${
              dragOverIdx === 'append'
                ? 'border-orange-400 bg-orange-500/15 text-orange-200'
                : 'border-slate-700/80 bg-slate-900/40 hover:bg-slate-800/50 text-slate-400 hover:text-slate-200'
            }`}
            title="Drag any filament from the Filament Library and drop it here, or click to add a color layer"
          >
            <Plus className="w-4 h-4 text-orange-400" />
            <span className="text-[11px] font-semibold text-center">
              Drag Color Here or Click to Add ({slots.length}/16)
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

