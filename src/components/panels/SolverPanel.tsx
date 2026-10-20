import React from 'react';
import { ArrowDown, ArrowUp, GripVertical, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useTailWagStore } from '../../store/useTailWagStore';
import { optimizeManualSlotBoundaries, type SolverRecipe } from '../../engine/autoSolver';
import { Badge, Button, IconButton, Section, Segmented, FOCUS_RING } from '../ui';

export type PoolMode = 'owned' | 'shown';
export type ColorCount = 4 | 7 | 8 | 12 | 16;

interface Props {
  /** Runs the solver; each argument overrides the current setting (as the old buttons did). */
  onSolve: (pool?: PoolMode, count?: ColorCount, colorMode?: 'natural' | 'cmyk' | 'manual') => void;
  hasOwnedLibrary: boolean;
  poolMode: PoolMode;
  ownedCount: number;
  shownCount: number;
  colorCount: ColorCount;
  recipes: SolverRecipe[];
  /** Manual mode drag and drop, owned by App because the library list is a drag source too. */
  manualDrag: {
    overIdx: number | 'append' | null;
    setOverIdx: (v: number | 'append' | null) => void;
    draggingIdx: number | null;
    setDraggingIdx: (v: number | null) => void;
    onDropOnSlot: (e: React.DragEvent, idx: number, replace: boolean) => void;
    onDropAppend: (e: React.DragEvent) => void;
  };
}

const COUNT_HINT: Record<ColorCount, string> = {
  4: 'Fits one AMS.',
  7: 'Two AMS units, with one slot left for support or purge.',
  8: 'Recommended for photos: smoother blends.',
  12: 'Several AMS units: finest colour steps.',
  16: 'Several AMS units: finest colour steps.',
};

/** Choose filaments and swap layers: automatically (best match or CMYK) or by hand (manual stack). */
export const SolverPanel: React.FC<Props> = ({ onSolve, hasOwnedLibrary, poolMode, ownedCount, shownCount, colorCount, recipes, manualDrag }) => {
  const {
    solverColorMode,
    setSolverColorMode,
    manualRelief,
    setManualRelief,
    slots,
    setSlots,
    catalog,
    totalLayers,
    baseLayerMm,
    layerHeightMm,
    baseSolidThicknessMm,
    sourceImageData,
    matchMode,
    updateSlotSpool,
    reorderSlots,
    removeSlot,
    addSlot,
    distributeSlotsEvenly,
  } = useTailWagStore();
  const manual = solverColorMode === 'manual';
  const top = recipes[0];
  const recommended = top?.recommendedColors ?? 8;

  const resetToBaseAndTop = () => {
    const black = catalog.find((s) => s.name.toLowerCase() === 'black') || catalog[0];
    const white =
      catalog.find((s) => s.name.toLowerCase().includes('jade white')) ||
      catalog.find((s) => s.name.toLowerCase().includes('white')) ||
      catalog[catalog.length - 1];
    const baseEnd = Math.min(totalLayers - 1, Math.max(1, 1 + Math.round(Math.max(0, baseSolidThicknessMm - baseLayerMm) / layerHeightMm)) + 1);
    setSlots([
      { id: `slot-${Date.now()}-base`, spool: black, upToLayer: baseEnd },
      { id: `slot-${Date.now()}-top`, spool: white, upToLayer: totalLayers },
    ]);
  };

  return (
    <section data-tour="solver" onDragOver={(e) => e.preventDefault()} onDrop={manualDrag.onDropAppend} className="flex flex-col gap-3 min-w-0">
      <Section
        title={manual ? 'Build your stack' : 'Pick filaments'}
        actions={
          <Badge title="An experimental MCP server lets AI assistants run the solver and export headlessly.">MCP (experimental)</Badge>
        }
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-small text-tw-ink-2">Method</span>
          <Segmented
            label="Method"
            value={solverColorMode}
            onChange={(m) => (m === 'manual' ? setSolverColorMode('manual') : onSolve(undefined, undefined, m))}
            options={[
              { value: 'natural', label: 'Best match', title: 'Pick the filaments from your library that best match the photo' },
              { value: 'cmyk', label: 'CMYK', title: 'Separate the photo into a cyan, magenta, yellow and white/black process stack' },
              { value: 'manual', label: 'Manual', title: 'Build the stack yourself: drag filaments in and order them' },
            ]}
          />
        </div>

        {manual ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-small text-tw-ink-2">Relief</span>
              <Segmented
                label="Relief in Manual mode"
                value={manualRelief}
                onChange={setManualRelief}
                options={[
                  { value: 'rematch', label: 'Match photo', title: 'After you let go of a slider, every part of the picture re-picks the layer that best matches your photo. The relief holds still while you drag.' },
                  { value: 'fixed', label: 'Fixed relief', title: "The relief keeps the shape from the photo's brightness. Sliders only move where colours change; nothing is re-solved." },
                ]}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-small text-tw-ink-2">From bed (first) to top (last)</span>
              <Button size="sm" variant="ghost" onClick={resetToBaseAndTop} title="Start again from a black base and a white top">
                Reset
              </Button>
            </div>

            <ol className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-0.5 min-w-0 m-0 p-0 list-none" aria-label="Filament stack, bed first">
              {slots.map((slot, idx) => {
                const start = idx === 0 ? 1 : slots[idx - 1].upToLayer + 1;
                const end = idx === slots.length - 1 ? totalLayers : slot.upToLayer;
                const role = idx === 0 ? 'Base' : idx === slots.length - 1 ? 'Top' : `#${idx + 1}`;
                const over = manualDrag.overIdx === idx;
                return (
                  <li
                    key={slot.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-tailwag-slot-index', String(idx));
                      e.dataTransfer.effectAllowed = 'move';
                      manualDrag.setDraggingIdx(idx);
                    }}
                    onDragEnd={() => {
                      manualDrag.setDraggingIdx(null);
                      manualDrag.setOverIdx(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (manualDrag.overIdx !== idx) manualDrag.setOverIdx(idx);
                    }}
                    onDragLeave={() => manualDrag.overIdx === idx && manualDrag.setOverIdx(null)}
                    onDrop={(e) => manualDrag.onDropOnSlot(e, idx, false)}
                    className={`flex items-center gap-2 p-2 rounded-control border cursor-grab active:cursor-grabbing min-w-0 transition ${
                      over ? 'border-tw-accent bg-tw-accent/10' : 'border-tw-line bg-tw-raised/60 hover:border-tw-line-strong'
                    } ${manualDrag.draggingIdx === idx ? 'opacity-45' : ''}`}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-tw-ink-3 shrink-0" aria-hidden="true" />
                    <span
                      onDrop={(e) => manualDrag.onDropOnSlot(e, idx, true)}
                      className="w-4 h-4 rounded-full shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]"
                      style={{ backgroundColor: slot.spool.hex }}
                      title="Drop a library filament here to replace this one"
                    />
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <select
                        aria-label={`Filament for ${role}`}
                        value={slot.spool.id}
                        onChange={(e) => {
                          const found = catalog.find((c) => c.id === e.target.value);
                          if (found) updateSlotSpool(slot.id, found);
                        }}
                        className={`w-full bg-tw-ground border border-tw-line rounded-md px-1.5 py-0.5 text-small text-tw-ink truncate ${FOCUS_RING}`}
                      >
                        {catalog.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.brand}, {c.name} (TD {c.td} mm)
                          </option>
                        ))}
                      </select>
                      <span className="font-mono text-micro text-tw-ink-2">
                        {role}: layers {start}–{end}, TD {slot.spool.td.toFixed(1)} mm
                      </span>
                    </div>
                    <div className="flex items-center shrink-0">
                      <IconButton size="sm" variant="ghost" className="border-transparent" label="Move toward the bed" icon={<ArrowUp className="w-3.5 h-3.5" />} disabled={idx === 0} onClick={() => reorderSlots(idx, idx - 1)} />
                      <IconButton size="sm" variant="ghost" className="border-transparent" label="Move toward the top" icon={<ArrowDown className="w-3.5 h-3.5" />} disabled={idx === slots.length - 1} onClick={() => reorderSlots(idx, idx + 1)} />
                      {slots.length > 1 && (
                        <IconButton size="sm" variant="ghost" className="border-transparent hover:text-tw-danger" label="Remove from the stack" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => removeSlot(slot.id)} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {slots.length < 16 && (
              <button
                type="button"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (manualDrag.overIdx !== 'append') manualDrag.setOverIdx('append');
                }}
                onDragLeave={() => manualDrag.overIdx === 'append' && manualDrag.setOverIdx(null)}
                onDrop={manualDrag.onDropAppend}
                onClick={() => addSlot(catalog.find((c) => !slots.some((s) => s.spool.id === c.id)) || catalog[0])}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-control border border-dashed text-small transition ${FOCUS_RING} ${
                  manualDrag.overIdx === 'append' ? 'border-tw-accent bg-tw-accent/10 text-tw-accent-text' : 'border-tw-line-strong text-tw-ink-2 hover:text-tw-ink hover:bg-tw-raised'
                }`}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Add a filament, or drag one here from the library ({slots.length}/16)
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="primary"
                title="Find the best swap layers for these filaments, keeping your order"
                onClick={() => setSlots(optimizeManualSlotBoundaries(sourceImageData!, slots, totalLayers, baseLayerMm, layerHeightMm, baseSolidThicknessMm, matchMode))}
              >
                Tune swap layers
              </Button>
              <Button title="Space the filaments above the base evenly" onClick={() => distributeSlotsEvenly()}>
                Space evenly
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-small text-tw-ink-2">From</span>
              {hasOwnedLibrary ? (
                <Segmented
                  label="Filaments to choose from"
                  value={poolMode}
                  onChange={(m) => onSolve(m)}
                  options={[
                    { value: 'owned', label: `My spools (${ownedCount})`, title: 'Only filaments from your filaments.json library' },
                    { value: 'shown', label: `Shown (${shownCount})`, title: 'The filaments currently shown in the library list, after its tab and search' },
                  ]}
                />
              ) : (
                <span className="text-small text-tw-ink">The {shownCount} filaments shown in the library</span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-small text-tw-ink-2">How many</span>
              <Segmented
                label="Number of filaments"
                value={colorCount}
                onChange={(n) => onSolve(undefined, n)}
                options={([4, 7, 8, 12, 16] as const).map((n) => ({ value: n, label: String(n), title: COUNT_HINT[n] }))}
              />
              <span className="text-micro text-tw-ink-3">{COUNT_HINT[colorCount]}</span>
            </div>

            <Button variant="primary" size="lg" block icon={<Sparkles className="w-4 h-4" aria-hidden="true" />} onClick={() => onSolve()}>
              {solverColorMode === 'cmyk' ? `Separate into ${colorCount} CMYK filaments` : `Pick ${colorCount} filaments`}
            </Button>

            {top?.colorCountAdvisory && (
              <div className={`flex flex-col gap-1.5 p-2.5 rounded-control border text-small ${colorCount < recommended ? 'bg-tw-warn/10 border-tw-warn/30' : 'bg-tw-ok/10 border-tw-ok/30'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${colorCount < recommended ? 'text-tw-warn' : 'text-tw-ok'}`}>
                    {colorCount < recommended ? `${recommended} filaments would match better` : `${colorCount} filaments: good fit for this photo`}
                  </span>
                  {top.detectedClusterCount && <Badge>{top.detectedClusterCount} colour groups</Badge>}
                </div>
                <p className="m-0 text-tw-ink-2">{top.colorCountAdvisory}</p>
                {colorCount < recommended && (
                  <Button size="sm" className="self-start" onClick={() => onSolve(undefined, recommended as ColorCount)}>
                    Use {recommended} filaments
                  </Button>
                )}
              </div>
            )}

            {recipes.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-small text-tw-ink-2">Results (click one to use it)</span>
                {recipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    type="button"
                    onClick={() => setSlots(recipe.slots)}
                    className={`flex flex-col gap-1.5 p-2.5 rounded-control text-left bg-tw-raised/60 border border-tw-line hover:border-tw-line-strong transition ${FOCUS_RING}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-body font-medium text-tw-ink">{recipe.name}</span>
                      <Badge tone="accent">{recipe.badge}</Badge>
                    </span>
                    <span className="text-small text-tw-ink-2 line-clamp-2">{recipe.description}</span>
                    <span className="flex gap-0.5" aria-hidden="true">
                      {recipe.slots.map((s) => (
                        <span key={s.id} className="h-2.5 flex-1 rounded-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]" style={{ backgroundColor: s.spool.hex }} title={`${s.spool.name} (to layer ${s.upToLayer})`} />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Section>
    </section>
  );
};
