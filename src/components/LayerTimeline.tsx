import React, { useMemo } from 'react';
import { Trash2, Plus, Layers } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { buildLayerColorLUT } from '../engine/opticalTdEngine';

export const LayerTimeline: React.FC = () => {
  const {
    slots,
    catalog,
    totalLayers,
    baseLayerMm,
    layerHeightMm,
    slicePreviewMaxLayer,
    setSlicePreviewMaxLayer,
    updateSlotLayer,
    updateSlotSpool,
    addSlot,
    removeSlot,
  } = useTailWagStore();

  const lut = useMemo(
    () => buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots),
    [totalLayers, baseLayerMm, layerHeightMm, slots]
  );

  return (
    <div className="bg-[#121722] border-t border-slate-800 px-4 py-3 flex flex-col gap-2.5 select-none">
      {/* Header + Continuous Optical TD Blend Strip */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <Layers className="w-4 h-4 text-orange-400" />
          <span>
            BEER-LAMBERT TD LAYER BLEND TIMELINE ({slots.length} COLORS • {totalLayers} LAYERS)
          </span>
        </div>

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
          <span className="font-mono text-orange-400 w-16 text-right">
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

      {/* Individual Filament Slot Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
        {slots.map((slot, idx) => {
          const startLayer = idx === 0 ? 1 : slots[idx - 1].upToLayer + 1;
          const endLayer = idx === slots.length - 1 ? totalLayers : slot.upToLayer;
          const startZ = (baseLayerMm + (startLayer - 1) * layerHeightMm).toFixed(2);
          const endZ = (baseLayerMm + (endLayer - 1) * layerHeightMm).toFixed(2);
          const isTopSlot = idx === slots.length - 1;
          const sliderValue = isTopSlot ? Math.max(1, startLayer - 1) : endLayer;

          return (
            <div
              key={slot.id}
              className="bg-[#181f2e] border border-slate-800 rounded-lg p-2 flex flex-col gap-1.5"
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span
                    className="w-4 h-4 rounded-full border border-white/30 shrink-0 shadow"
                    style={{ backgroundColor: slot.spool.hex }}
                  />
                  <select
                    value={slot.spool.id}
                    onChange={(e) => {
                      const found = catalog.find((c) => c.id === e.target.value);
                      if (found) updateSlotSpool(slot.id, found);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-100 truncate flex-1 focus:outline-none focus:border-orange-500"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.brand} — {c.name} (TD {c.td}mm)
                      </option>
                    ))}
                  </select>
                </div>

                {slots.length > 2 && (
                  <button
                    onClick={() => removeSlot(slot.id)}
                    className="text-slate-500 hover:text-rose-400 p-0.5 transition"
                    title="Remove filament layer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
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
                max={totalLayers - 1}
                value={sliderValue}
                onInput={(e) => updateSlotLayer(slot.id, parseInt((e.target as HTMLInputElement).value, 10))}
                onChange={(e) => updateSlotLayer(slot.id, parseInt(e.target.value, 10))}
                title={
                  isTopSlot
                    ? `Adjust highlight start layer (L${startLayer})`
                    : `Adjust swap layer up to L${endLayer}`
                }
                className="w-full accent-orange-500 h-1.5 cursor-pointer"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
