import React, { useMemo, useState } from 'react';
import { X, Search, Plus, Pipette, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import type { FilamentSpool } from '../data/filamentCatalog';
import {
  MANUFACTURER_CATALOG,
  MANUFACTURER_CATALOG_VERSION,
  catalogBrands,
  catalogMaterials,
  searchManufacturerCatalog,
  type CatalogEntry,
  type HueFamily,
} from '../data/manufacturerCatalog';
import {
  TD_SOURCE_LABEL,
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
  'ABS',
  'ASA',
  'TPU',
  'COPE',
];

const HUE_FAMILIES: HueFamily[] = [
  'white',
  'gray',
  'black',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
  'brown',
];

const SOURCE_BADGE: Record<TdSource, string> = {
  measured: 'bg-emerald-500/20 text-emerald-300',
  user: 'bg-sky-500/20 text-sky-300',
  catalog: 'bg-slate-700 text-slate-200',
  estimate: 'bg-amber-500/20 text-amber-300',
};

export function TdSourceBadge({ source }: { source?: TdSource }) {
  const s: TdSource = source ?? 'catalog';
  return (
    <span className={`px-1 rounded text-[9px] font-semibold ${SOURCE_BADGE[s]}`} title="Where this TD value came from">
      {TD_SOURCE_LABEL[s]}
    </span>
  );
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function submitFilamentUrl(e: CatalogEntry | FilamentSpool): string {
  const title = `filament-data: ${e.brand} ${e.name}`;
  const body = [
    `Brand: ${e.brand}`,
    `Name: ${e.name}`,
    `Material: ${e.material}`,
    `Hex: ${e.hex}`,
    `TD (mm): ${e.td}`,
    `TD source: ${e.tdSource ?? 'catalog'}`,
    '',
    'How was the color/TD obtained? (manufacturer chart, own measurement, other)',
  ].join('\n');
  return `https://github.com/everyday3d/tailwag/issues/new?labels=filament-data&title=${encodeURIComponent(
    title
  )}&body=${encodeURIComponent(body)}`;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const FilamentLibraryModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { catalog, addSpoolToMyFilaments } = useTailWagStore();
  const [tab, setTab] = useState<'browse' | 'manual'>('browse');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Browse filters
  const [text, setText] = useState('');
  const [brand, setBrand] = useState('');
  const [material, setMaterial] = useState('');
  const [hue, setHue] = useState<HueFamily | ''>('');
  const [tdMin, setTdMin] = useState('');
  const [tdMax, setTdMax] = useState('');

  // Manual form
  const [fBrand, setFBrand] = useState('');
  const [fLine, setFLine] = useState('');
  const [fMaterial, setFMaterial] = useState<FilamentSpool['material']>('PLA');
  const [fName, setFName] = useState('');
  const [fHex, setFHex] = useState('#FF6A13');
  const [fTd, setFTd] = useState('');
  const [fAms, setFAms] = useState('');

  const brands = useMemo(() => catalogBrands(), []);
  const materials = useMemo(() => catalogMaterials(), []);

  const results = useMemo(
    () =>
      searchManufacturerCatalog({
        text,
        brand: brand || undefined,
        material: material || undefined,
        hueFamily: hue || undefined,
        tdMin: tdMin !== '' && Number.isFinite(Number(tdMin)) ? Number(tdMin) : undefined,
        tdMax: tdMax !== '' && Number.isFinite(Number(tdMax)) ? Number(tdMax) : undefined,
      }),
    [text, brand, material, hue, tdMin, tdMax]
  );

  const inLibrary = useMemo(() => {
    const keys = new Set<string>();
    for (const s of catalog) {
      if (s.libraryId === MY_LIBRARY_ID) keys.add(`${s.brand}|${s.name}|${s.hex}`.toLowerCase());
    }
    return keys;
  }, [catalog]);

  if (!isOpen) return null;

  const addFromCatalog = (e: CatalogEntry) => {
    const spool: FilamentSpool = {
      id: e.catalogId,
      brand: e.brand,
      name: e.name,
      material: e.material,
      hex: e.hex,
      td: e.td,
      tdSource: e.tdSource,
      line: e.line,
      catalogId: e.catalogId,
    };
    const err = addSpoolToMyFilaments(spool);
    setMessage(err ? { kind: 'err', text: err } : { kind: 'ok', text: `Added ${e.brand} ${e.name} to My Filaments.` });
  };

  const hexValid = HEX_RE.test(fHex);
  const estimate = hexValid ? estimateTdFromHex(fHex) : null;
  const tdNum = fTd.trim() === '' ? null : Number(fTd);
  const tdWarning =
    hexValid && tdNum !== null && Number.isFinite(tdNum) ? checkTdAgainstPrior(fHex, tdNum) : null;
  const formError =
    !fBrand.trim() ? 'Brand is required.' : !fName.trim() ? 'Color name is required.' : !hexValid ? 'Hex must look like #RRGGBB.' : tdNum !== null && (!Number.isFinite(tdNum) || tdNum <= 0) ? 'TD must be a positive number.' : null;

  const eyedropperSupported = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pickWithEyedropper = async () => {
    try {
      // EyeDropper is not in all TS lib versions
      const Ctor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
      const res = await new Ctor().open();
      setFHex(res.sRGBHex.toUpperCase());
    } catch {
      /* user cancelled */
    }
  };

  const submitManual = () => {
    if (formError) {
      setMessage({ kind: 'err', text: formError });
      return;
    }
    const userTd = tdNum !== null;
    const td = userTd ? (tdNum as number) : (estimate as number);
    const spool: FilamentSpool = {
      id: `${fBrand}-${fName}-${fHex}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      brand: fBrand.trim(),
      line: fLine.trim() || undefined,
      name: fName.trim(),
      material: fMaterial,
      hex: fHex.toUpperCase(),
      td,
      tdSource: userTd ? 'user' : 'estimate',
      amsSlot: fAms.trim() || undefined,
    };
    const err = addSpoolToMyFilaments(spool);
    if (err) {
      setMessage({ kind: 'err', text: err });
      return;
    }
    setMessage({ kind: 'ok', text: `Added ${spool.brand} ${spool.name} to My Filaments.` });
    setFName('');
    setFTd('');
  };

  const inputCls =
    'w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-orange-500';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-[#0f141e] border border-slate-700 rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <div className="text-sm font-bold text-slate-100">Filament Library</div>
            <div className="text-[10px] text-slate-400">Catalog v{MANUFACTURER_CATALOG_VERSION} • {MANUFACTURER_CATALOG.length} filaments</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 px-4 pt-3">
          {(['browse', 'manual'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setMessage(null);
              }}
              className={`px-3 py-1 rounded-md text-xs font-bold transition ${
                tab === t ? 'bg-orange-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'browse' ? 'Browse catalog' : 'Add manually'}
            </button>
          ))}
        </div>

        {message && (
          <div
            className={`mx-4 mt-2 text-[11px] px-2 py-1 rounded ${
              message.kind === 'ok'
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {tab === 'browse' ? (
          <div className="p-4 flex flex-col gap-2 min-h-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Search brand, color name, material, hex..."
                className={`${inputCls} pl-8`}
              />
            </div>
            <div className="grid grid-cols-5 gap-2">
              <select value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} aria-label="Brand">
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <select value={material} onChange={(e) => setMaterial(e.target.value)} className={inputCls} aria-label="Material">
                <option value="">All materials</option>
                {materials.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <select value={hue} onChange={(e) => setHue(e.target.value as HueFamily | '')} className={inputCls} aria-label="Hue family">
                <option value="">All hues</option>
                {HUE_FAMILIES.map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
              <input value={tdMin} onChange={(e) => setTdMin(e.target.value)} placeholder="TD min" className={inputCls} inputMode="decimal" />
              <input value={tdMax} onChange={(e) => setTdMax(e.target.value)} placeholder="TD max" className={inputCls} inputMode="decimal" />
            </div>
            <div className="text-[10px] text-slate-500">{results.length} match{results.length === 1 ? '' : 'es'}</div>
            <div className="overflow-y-auto space-y-1.5 pr-1 min-h-0">
              {results.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400 bg-slate-900/50 rounded-lg border border-slate-800/80">
                  No filaments match. Use "Add manually" to enter one.
                </div>
              ) : (
                results.map((e) => {
                  const added = inLibrary.has(`${e.brand}|${e.name}|${e.hex}`.toLowerCase());
                  return (
                    <div key={e.catalogId} className="bg-[#181f2e] border border-slate-800 rounded-lg p-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="block w-6 h-6 rounded-full border border-white/30 shrink-0" style={{ backgroundColor: e.hex }} />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-100 truncate">{e.name}</div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                            {e.sourceUrl ? (
                              <a
                                href={e.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-300 font-medium hover:text-orange-300 underline decoration-dotted"
                                title={`Verify against ${e.brand}'s page`}
                              >
                                {e.brand}
                              </a>
                            ) : (
                              <span className="text-slate-300 font-medium">{e.brand}</span>
                            )}
                            <span>•</span>
                            <span className="px-1 rounded bg-slate-800 text-slate-300">{e.material}</span>
                            <span>•</span>
                            <span className="text-orange-400 font-mono">TD {e.td.toFixed(1)}mm</span>
                            <TdSourceBadge source={e.tdSource} />
                            <span className="font-mono text-slate-500">{e.hex}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={submitFilamentUrl(e)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-slate-200"
                          title="Report a correction for this filament on GitHub"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => addFromCatalog(e)}
                          disabled={added}
                          className="px-2 py-1 rounded bg-slate-900 hover:bg-orange-600 text-[11px] font-semibold text-slate-300 hover:text-white border border-slate-700 transition flex items-center gap-1 disabled:opacity-50 disabled:hover:bg-slate-900"
                        >
                          {added ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Plus className="w-3 h-3" />}
                          {added ? 'In library' : 'Add'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex items-start gap-1.5 text-[10px] text-slate-500">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>Colors are approximate values from public manufacturer charts. TD marked Estimate is predicted from the color; calibrate for exact values.</span>
            </div>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 gap-3 overflow-y-auto">
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Brand *
              <input value={fBrand} onChange={(e) => setFBrand(e.target.value)} className={inputCls} list="tw-brand-list" />
              <datalist id="tw-brand-list">
                {brands.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Product line
              <input value={fLine} onChange={(e) => setFLine(e.target.value)} className={inputCls} placeholder="e.g. PLA Basic" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Material
              <select value={fMaterial} onChange={(e) => setFMaterial(e.target.value as FilamentSpool['material'])} className={inputCls}>
                {MATERIALS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              Color name *
              <input value={fName} onChange={(e) => setFName(e.target.value)} className={inputCls} />
            </label>
            <div className="flex flex-col gap-1 text-[11px] text-slate-400">
              Color *
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={hexValid ? fHex : '#000000'}
                  onChange={(e) => setFHex(e.target.value.toUpperCase())}
                  className="w-8 h-7 bg-transparent border border-slate-700 rounded"
                  aria-label="Color picker"
                />
                <input value={fHex} onChange={(e) => setFHex(e.target.value)} className={`${inputCls} font-mono`} />
                {eyedropperSupported && (
                  <button onClick={pickWithEyedropper} className="p-1.5 rounded border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800" title="Pick a color from the screen (e.g., a photo of the spool)">
                    <Pipette className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1 text-[11px] text-slate-400">
              TD (mm) — leave blank to use the estimate
              <div className="flex items-center gap-2">
                <input value={fTd} onChange={(e) => setFTd(e.target.value)} className={inputCls} inputMode="decimal" placeholder={estimate !== null ? `Estimate: ${estimate}` : ''} />
                <button
                  onClick={() => estimate !== null && setFTd(String(estimate))}
                  disabled={estimate === null}
                  className="px-2 py-1 rounded border border-slate-700 text-[10px] text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 shrink-0"
                >
                  Use estimate
                </button>
              </div>
              {tdWarning && <span className="text-amber-300 text-[10px]">{tdWarning}</span>}
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-slate-400">
              AMS slot (optional)
              <input value={fAms} onChange={(e) => setFAms(e.target.value)} className={inputCls} placeholder="AMS 1 - A1" />
            </label>
            <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
              <span className="text-[10px] text-slate-500">
                TD source will be saved as {tdNum !== null ? 'User-entered' : 'Estimate'}.
              </span>
              <button
                onClick={submitManual}
                className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-xs font-bold text-white flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add to My Filaments
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
