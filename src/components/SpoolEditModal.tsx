import React, { useEffect, useState } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import type { FilamentSpool } from '../data/filamentCatalog';
import { MANUFACTURER_CATALOG } from '../data/manufacturerCatalog';
import {
  TD_SOURCE_LABEL,
  TD_SOURCE_RANK,
  checkTdAgainstPrior,
  estimateTdFromHex,
  type TdSource,
} from '../engine/tdPrior';
import { MY_LIBRARY_ID } from '../utils/myLibrary';

const MATERIALS: FilamentSpool['material'][] = [
  'PLA',
  'PLA Matte',
  'PLA+',
  'PETG',
  'PLA Silk',
  'CMYK Litho',
  'ABS',
  'ASA',
  'TPU',
  'COPE',
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface Props {
  spoolId: string | null;
  onClose: () => void;
}

export const SpoolEditModal: React.FC<Props> = ({ spoolId, onClose }) => {
  const { catalog, updateSpool, removeMySpool } = useTailWagStore();
  const spool = spoolId ? catalog.find((s) => s.id === spoolId) : undefined;

  const [brand, setBrand] = useState('');
  const [line, setLine] = useState('');
  const [material, setMaterial] = useState<FilamentSpool['material']>('PLA');
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#FFFFFF');
  const [td, setTd] = useState('');
  const [tdSource, setTdSource] = useState<TdSource>('user');
  const [ams, setAms] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!spool) return;
    setBrand(spool.brand);
    setLine(spool.line ?? '');
    setMaterial(spool.material);
    setName(spool.name);
    setHex(spool.hex.toUpperCase());
    setTd(String(spool.td));
    setTdSource(spool.tdSource ?? 'catalog');
    setAms(spool.amsSlot ?? '');
    setError(null);
    setConfirmDelete(false);
  }, [spool?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!spoolId || !spool) return null;

  const hexValid = HEX_RE.test(hex);
  const tdNum = Number(td);
  const tdValid = Number.isFinite(tdNum) && tdNum > 0;
  const tdWarning = hexValid && tdValid ? checkTdAgainstPrior(hex, tdNum) : null;
  const estimate = hexValid ? estimateTdFromHex(hex) : null;
  const isMine = spool.libraryId === MY_LIBRARY_ID;
  const originalSource: TdSource = spool.tdSource ?? 'catalog';
  const tdChanged = tdValid && tdNum !== spool.td;
  const lowersSource = TD_SOURCE_RANK[tdSource] < TD_SOURCE_RANK[originalSource];
  const catalogOrigin = spool.catalogId
    ? MANUFACTURER_CATALOG.find((e) => e.catalogId === spool.catalogId)
    : undefined;

  const save = () => {
    if (!brand.trim()) return setError('Brand is required.');
    if (!name.trim()) return setError('Color name is required.');
    if (!hexValid) return setError('Hex must look like #RRGGBB.');
    if (!tdValid) return setError('TD must be a positive number.');
    // A deliberate edit in this dialog is allowed to replace a stronger source (force),
    // but only when the user explicitly chose the source below.
    updateSpool(
      spool.id,
      {
        brand: brand.trim(),
        line: line.trim() || undefined,
        material,
        name: name.trim(),
        hex: hex.toUpperCase(),
        td: Math.round(tdNum * 10) / 10,
        tdSource: tdChanged || tdSource !== originalSource ? tdSource : originalSource,
        amsSlot: ams.trim() || undefined,
      },
      { force: true }
    );
    onClose();
  };

  const inputCls =
    'w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-orange-500';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-[#0f141e] border border-slate-700 rounded-xl w-full max-w-lg flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="text-sm font-bold text-slate-100">Edit filament</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Brand *
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Product line
            <input value={line} onChange={(e) => setLine(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Material
            <select value={material} onChange={(e) => setMaterial(e.target.value as FilamentSpool['material'])} className={inputCls}>
              {MATERIALS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            Color name *
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
          <div className="flex flex-col gap-1 text-[11px] text-slate-400">
            Color *
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexValid ? hex : '#000000'}
                onChange={(e) => setHex(e.target.value.toUpperCase())}
                className="w-8 h-7 bg-transparent border border-slate-700 rounded"
                aria-label="Color picker"
              />
              <input value={hex} onChange={(e) => setHex(e.target.value)} className={`${inputCls} font-mono`} />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            AMS slot
            <input value={ams} onChange={(e) => setAms(e.target.value)} className={inputCls} placeholder="AMS 1 - A1" />
          </label>
          <div className="flex flex-col gap-1 text-[11px] text-slate-400">
            TD (mm)
            <div className="flex items-center gap-2">
              <input value={td} onChange={(e) => setTd(e.target.value)} className={inputCls} inputMode="decimal" />
              <button
                onClick={() => {
                  if (estimate !== null) {
                    setTd(String(estimate));
                    setTdSource('estimate');
                  }
                }}
                disabled={estimate === null}
                className="px-2 py-1 rounded border border-slate-700 text-[10px] text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 shrink-0"
                title="Replace with the hue/lightness estimate"
              >
                Estimate
              </button>
            </div>
            {tdWarning && <span className="text-amber-300 text-[10px]">{tdWarning}</span>}
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-slate-400">
            TD source
            <select value={tdSource} onChange={(e) => setTdSource(e.target.value as TdSource)} className={inputCls}>
              {(Object.keys(TD_SOURCE_LABEL) as TdSource[]).map((s) => (
                <option key={s} value={s}>
                  {TD_SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
            {lowersSource && (
              <span className="text-amber-300 text-[10px]">
                This replaces a stronger source ({TD_SOURCE_LABEL[originalSource]}). Saving will overwrite it.
              </span>
            )}
          </label>
          {catalogOrigin && (
            <div className="col-span-2 text-[10px] text-slate-500">
              From catalog: {catalogOrigin.brand} {catalogOrigin.name} ({catalogOrigin.hex}, TD {catalogOrigin.td.toFixed(1)} mm).
            </div>
          )}
          {error && <div className="col-span-2 text-[11px] px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300">{error}</div>}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-800">
          {isMine ? (
            confirmDelete ? (
              <div className="flex items-center gap-1.5 text-[11px] text-rose-300">
                Delete this filament?
                <button
                  onClick={() => {
                    removeMySpool(spool.id);
                    onClose();
                  }}
                  className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold"
                >
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded border border-slate-700 text-slate-300">
                  Keep
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 px-2 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/15 text-[11px] font-semibold"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            )
          ) : (
            <span className="text-[10px] text-slate-500">Catalog and imported spools cannot be deleted here.</span>
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800">
              Cancel
            </button>
            <button onClick={save} className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-bold text-white flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
