import React, { useRef } from 'react';
import { Download, FileJson, Pencil, Plus, Search, Trash2, X, CheckCircle2 } from 'lucide-react';
import { useTailWagStore } from '../../store/useTailWagStore';
import type { FilamentSpool } from '../../data/filamentCatalog';
import { STOCK_LABEL, nextStock, stockOf, type SortMode, type StockFilter } from '../../utils/libraryView';
import { TdSourceBadge } from '../FilamentLibraryModal';
import { Badge, Button, IconButton, Section, Segmented, FOCUS_RING } from '../ui';

interface Props {
  /** List to show (already filtered and sorted by App, which also feeds it to the solver). */
  spools: FilamentSpool[];
  hasOwnedLibrary: boolean;
  tab: 'owned' | 'all';
  onTab: (tab: 'owned' | 'all') => void;
  ownedCount: number;
  catalogCount: number;
  search: string;
  onSearch: (q: string) => void;
  amsFilter: string;
  onAmsFilter: (v: string) => void;
  amsSlotOptions: string[];
  stockFilter: StockFilter;
  onStockFilter: (v: StockFilter) => void;
  sortMode: SortMode;
  onSortMode: (v: SortMode) => void;
  onImportJson: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExportJson: () => void;
  onOpenCatalog: () => void;
  onEditSpool: (id: string) => void;
  onRemoveLibrary: (id: string, name: string) => void;
  /** App-wide status line (imports, saves, errors); shown here until there is a global toast area. */
  message: string | null;
  onDismissMessage: () => void;
}

const selectCls = `h-8 min-w-0 px-1.5 rounded-control bg-tw-ground border border-tw-line text-small text-tw-ink ${FOCUS_RING}`;

/** Your spools and the catalog. Rows can be dragged onto the stack or added with the + button. */
export const LibraryPanel: React.FC<Props> = (p) => {
  const { importedLibraries, slots, addSlot, toggleSpoolOwned, updateSpool } = useTailWagStore();
  const jsonInput = useRef<HTMLInputElement>(null);
  const isError = !!p.message && /^(Rejected|Error|JSON Parse Error)/.test(p.message);

  return (
    <div data-tour="library" className="flex flex-col gap-2.5 flex-1 min-h-0">
      <Section
        title="Filaments"
        actions={
          <>
            <input ref={jsonInput} type="file" accept=".json,application/json" onChange={p.onImportJson} className="hidden" />
            <IconButton size="sm" label="Add a filament from the manufacturer catalog or by hand" icon={<Plus className="w-3.5 h-3.5" />} onClick={p.onOpenCatalog} />
            <IconButton size="sm" label="Import your library (filaments.json)" icon={<FileJson className="w-3.5 h-3.5" />} onClick={() => jsonInput.current?.click()} />
            <IconButton size="sm" label="Export your spools to filaments.json" icon={<Download className="w-3.5 h-3.5" />} onClick={p.onExportJson} />
          </>
        }
      >
        {p.hasOwnedLibrary ? (
          <Segmented
            label="Library"
            value={p.tab}
            onChange={p.onTab}
            options={[
              { value: 'owned', label: `My spools (${p.ownedCount})` },
              { value: 'all', label: `Catalog (${p.catalogCount})` },
            ]}
          />
        ) : (
          <span className="text-small text-tw-ink-2">
            Catalog ({p.catalogCount}). Import your filaments.json to choose only from spools you own.
          </span>
        )}

        {p.hasOwnedLibrary && p.tab === 'owned' &&
          importedLibraries.map((lib) => (
            <div key={lib.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-control bg-tw-raised/60 border border-tw-line text-small">
              <span className="flex items-center gap-1.5 min-w-0 text-tw-ink">
                <FileJson className="w-3.5 h-3.5 text-tw-ink-2 shrink-0" aria-hidden="true" />
                <span className="truncate">{lib.name}</span>
                <span className="text-tw-ink-3 font-mono shrink-0">{lib.count}</span>
              </span>
              <Button size="sm" variant="danger" icon={<Trash2 className="w-3 h-3" aria-hidden="true" />} title={`Remove ${lib.name}`} onClick={() => p.onRemoveLibrary(lib.id, lib.name)}>
                Remove
              </Button>
            </div>
          ))}

        {p.message && (
          <div
            role="status"
            className={`flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-control border text-small ${
              isError ? 'bg-tw-danger/10 border-tw-danger/30 text-tw-danger' : 'bg-tw-ok/10 border-tw-ok/30 text-tw-ok'
            }`}
          >
            <span className="min-w-0 break-words">{p.message}</span>
            <IconButton size="sm" variant="ghost" className="border-transparent -my-1 -mr-1.5" label="Dismiss" icon={<X className="w-3.5 h-3.5" />} onClick={p.onDismissMessage} />
          </div>
        )}

        <label className={`flex items-center gap-2 h-8 px-2.5 rounded-control bg-tw-ground border border-tw-line text-tw-ink-3 focus-within:outline focus-within:outline-2 focus-within:outline-tw-accent`}>
          <Search className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search filaments</span>
          <input
            type="search"
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            placeholder={p.tab === 'owned' && p.hasOwnedLibrary ? 'Search your spools' : 'Search brand, colour or TD'}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-small text-tw-ink placeholder:text-tw-ink-3"
          />
        </label>

        <div className="grid grid-cols-3 gap-1.5">
          <select value={p.amsFilter} onChange={(e) => p.onAmsFilter(e.target.value)} className={selectCls} aria-label="Filter by AMS slot" title="Filter by AMS slot">
            <option value="all">All slots</option>
            <option value="loaded">In the AMS</option>
            <option value="none">Not in AMS</option>
            {p.amsSlotOptions.map((slot) => (
              <option key={slot} value={slot}>
                {slot}
              </option>
            ))}
          </select>
          <select value={p.stockFilter} onChange={(e) => p.onStockFilter(e.target.value as StockFilter)} className={selectCls} aria-label="Filter by stock" title="Filter by stock">
            <option value="all">Any stock</option>
            <option value="available">Available</option>
            <option value="ok">In stock</option>
            <option value="low">Low</option>
            <option value="out">Out</option>
          </select>
          <select value={p.sortMode} onChange={(e) => p.onSortMode(e.target.value as SortMode)} className={selectCls} aria-label="Sort filaments" title="Sort filaments">
            <option value="default">Default</option>
            <option value="td-asc">TD low to high</option>
            <option value="td-desc">TD high to low</option>
            <option value="lightness">Dark to light</option>
            <option value="name">Name</option>
            <option value="brand">Brand</option>
          </select>
        </div>
      </Section>

      <ul className="flex-1 min-h-[120px] overflow-y-auto flex flex-col gap-1 pr-1 m-0 p-0 list-none" aria-label="Filaments">
        {p.spools.length === 0 ? (
          <li className="text-center py-6 px-3 text-small text-tw-ink-2 rounded-control border border-tw-line">
            {p.search ? `No filaments match "${p.search}".` : 'No filaments match these filters.'}
          </li>
        ) : (
          p.spools.map((spool) => {
            const stock = stockOf(spool);
            return (
              <li
                key={spool.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-tailwag-spool-id', spool.id);
                  e.dataTransfer.setData('text/plain', spool.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title="Drag onto the stack, or use the + button"
                className="group flex items-center gap-2 px-2 py-1.5 rounded-control bg-tw-raised/50 border border-transparent hover:border-tw-line-strong cursor-grab active:cursor-grabbing"
              >
                <button
                  type="button"
                  onClick={() => toggleSpoolOwned(spool.id)}
                  aria-pressed={!!spool.owned}
                  title={spool.owned ? 'Owned: click to unmark' : 'Click to mark as owned'}
                  aria-label={`${spool.owned ? 'Owned' : 'Not owned'}: ${spool.name}`}
                  className={`relative shrink-0 rounded-full ${FOCUS_RING}`}
                >
                  <span className="block w-[22px] h-[22px] rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" style={{ backgroundColor: spool.hex }} />
                  {spool.owned && <CheckCircle2 className="w-3 h-3 text-tw-ok bg-tw-ground rounded-full absolute -bottom-0.5 -right-0.5" aria-hidden="true" />}
                </button>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-body font-medium text-tw-ink truncate">{spool.name}</span>
                    <span className="font-mono text-small text-tw-ink shrink-0" title="Transmission distance">
                      TD {spool.td.toFixed(1)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-small text-tw-ink-2 min-w-0">
                    <span className="truncate">
                      {spool.brand}, {spool.material}
                    </span>
                    <span className="shrink-0 flex items-center gap-1">
                      <TdSourceBadge source={spool.tdSource} calibration={spool.calibration} />
                      {stock !== 'ok' && <Badge tone={stock === 'low' ? 'warn' : 'danger'}>{STOCK_LABEL[stock]}</Badge>}
                      {spool.amsSlot && <Badge>{spool.amsSlot}</Badge>}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateSpool(spool.id, { stock: nextStock(spool.stock) })}
                    title="Stock: click to cycle In stock, Low, Out (Out is skipped when picking filaments)"
                    aria-label={`Stock for ${spool.name}: ${STOCK_LABEL[stock]}. Click to change.`}
                    className={`hidden group-hover:inline-flex group-focus-within:inline-flex text-micro px-1.5 py-0.5 rounded-md border border-tw-line text-tw-ink-3 hover:text-tw-ink ${FOCUS_RING}`}
                  >
                    Stock
                  </button>
                  <IconButton size="sm" variant="ghost" className="border-transparent" label={`Edit ${spool.name}`} icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => p.onEditSpool(spool.id)} />
                  <IconButton size="sm" label={`Add ${spool.name} to the stack`} icon={<Plus className="w-3.5 h-3.5" />} disabled={slots.length >= 16} onClick={() => addSlot(spool)} />
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
};
