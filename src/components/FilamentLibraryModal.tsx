import React, { useMemo, useState } from 'react';
import { Search, Plus, Pipette, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { Badge, Button, Dialog, IconButton, Segmented, FOCUS_RING } from './ui';
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
import { CALIBRATION_MODEL_ID, type SpoolCalibration } from '../engine/opticalModel';

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

// How much to trust a TD value: measured is green, a guess from the colour is amber.
const SOURCE_TONE: Record<TdSource, 'ok' | 'neutral' | 'warn'> = {
  measured: 'ok',
  user: 'neutral',
  catalog: 'neutral',
  estimate: 'warn',
};

export function TdSourceBadge({ source, calibration }: { source?: TdSource; calibration?: SpoolCalibration }) {
  const s: TdSource = source ?? 'catalog';
  if (calibration && calibration.modelId === CALIBRATION_MODEL_ID) {
    const q = calibration.meanDeltaE00;
    return (
      <Badge
        tone={q <= 3 ? 'ok' : q <= 6 ? 'neutral' : 'warn'}
        title={`Measured with a calibration plate on ${calibration.date}. Average fit error ${q.toFixed(1)} ΔE (worst ${calibration.maxDeltaE00.toFixed(1)}); under 3 is hard to see.`}
      >
        Calibrated ±{q.toFixed(1)}
      </Badge>
    );
  }
  return (
    <Badge tone={SOURCE_TONE[s]} title="Where this TD value comes from">
      {TD_SOURCE_LABEL[s]}
    </Badge>
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
    setMessage(err ? { kind: 'err', text: err } : { kind: 'ok', text: `Added ${e.brand} ${e.name} to your spools.` });
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
    setMessage({ kind: 'ok', text: `Added ${spool.brand} ${spool.name} to your spools.` });
    setFName('');
    setFTd('');
  };

  const inputCls = `h-8 w-full px-2.5 rounded-control bg-tw-ground border border-tw-line text-body text-tw-ink ${FOCUS_RING}`;
  const labelCls = 'flex flex-col gap-1 text-small text-tw-ink-2';

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      size="lg"
      title="Add a filament"
      subtitle={`From the manufacturer catalog (${MANUFACTURER_CATALOG.length} filaments, version ${MANUFACTURER_CATALOG_VERSION}) or by hand.`}
    >
      <Segmented
        label="How to add"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setMessage(null);
        }}
        options={[
          { value: 'browse', label: 'Browse catalog' },
          { value: 'manual', label: 'Enter by hand' },
        ]}
        className="self-start"
        fill={false}
      />

      {message && (
        <p
          role="status"
          className={`m-0 px-2.5 py-1.5 rounded-control border text-small ${
            message.kind === 'ok' ? 'bg-tw-ok/10 border-tw-ok/30 text-tw-ok' : 'bg-tw-danger/10 border-tw-danger/30 text-tw-danger'
          }`}
        >
          {message.text}
        </p>
      )}

      {tab === 'browse' ? (
        <div className="flex flex-col gap-2.5 min-h-0">
          <label className={`flex items-center gap-2 h-8 px-2.5 rounded-control bg-tw-ground border border-tw-line text-tw-ink-3 focus-within:outline focus-within:outline-2 focus-within:outline-tw-accent`}>
            <Search className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">Search the catalog</span>
            <input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search brand, colour, material or hex"
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-body text-tw-ink placeholder:text-tw-ink-3"
            />
          </label>
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
            <select value={hue} onChange={(e) => setHue(e.target.value as HueFamily | '')} className={inputCls} aria-label="Colour family">
              <option value="">All colours</option>
              {HUE_FAMILIES.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
            <input value={tdMin} onChange={(e) => setTdMin(e.target.value)} placeholder="TD from" aria-label="Lowest TD" className={`${inputCls} font-mono`} inputMode="decimal" />
            <input value={tdMax} onChange={(e) => setTdMax(e.target.value)} placeholder="TD to" aria-label="Highest TD" className={`${inputCls} font-mono`} inputMode="decimal" />
          </div>
          <span className="text-micro text-tw-ink-3" role="status">
            {results.length} match{results.length === 1 ? '' : 'es'}
          </span>
          <ul className="flex flex-col gap-1 m-0 p-0 list-none max-h-[44vh] overflow-y-auto pr-1">
            {results.length === 0 ? (
              <li className="text-center py-6 text-small text-tw-ink-2 rounded-control border border-tw-line">No filaments match. Use "Enter by hand" to add one.</li>
            ) : (
              results.map((e) => {
                const added = inLibrary.has(`${e.brand}|${e.name}|${e.hex}`.toLowerCase());
                return (
                  <li key={e.catalogId} className="flex items-center gap-2.5 px-2.5 py-2 rounded-control bg-tw-raised/50 border border-transparent hover:border-tw-line-strong">
                    <span className="w-6 h-6 rounded-full shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]" style={{ backgroundColor: e.hex }} aria-hidden="true" />
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-body font-medium text-tw-ink truncate">{e.name}</span>
                        <span className="font-mono text-small text-tw-ink shrink-0">TD {e.td.toFixed(1)}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-small text-tw-ink-2 min-w-0">
                        {e.sourceUrl ? (
                          <a href={e.sourceUrl} target="_blank" rel="noreferrer" className={`underline decoration-dotted hover:text-tw-ink rounded ${FOCUS_RING}`} title={`Check against ${e.brand}'s page`}>
                            {e.brand}
                          </a>
                        ) : (
                          <span>{e.brand}</span>
                        )}
                        <span className="truncate">, {e.material}</span>
                        <span className="font-mono text-tw-ink-3 shrink-0">{e.hex}</span>
                        <TdSourceBadge source={e.tdSource} calibration={(e as FilamentSpool).calibration} />
                      </span>
                    </div>
                    <a
                      href={submitFilamentUrl(e)}
                      target="_blank"
                      rel="noreferrer"
                      className={`p-1 text-tw-ink-3 hover:text-tw-ink rounded ${FOCUS_RING}`}
                      title="Report a correction for this filament on GitHub"
                      aria-label={`Report a correction for ${e.brand} ${e.name}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    </a>
                    <Button
                      size="sm"
                      variant={added ? 'ghost' : 'secondary'}
                      icon={added ? <CheckCircle2 className="w-3.5 h-3.5 text-tw-ok" aria-hidden="true" /> : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
                      onClick={() => addFromCatalog(e)}
                      disabled={added}
                    >
                      {added ? 'Added' : 'Add'}
                    </Button>
                  </li>
                );
              })
            )}
          </ul>
          <p className="m-0 flex items-start gap-1.5 text-micro text-tw-ink-3">
            <Info className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
            Colours are approximate values from public manufacturer charts. A TD marked Estimate is predicted from the colour; the calibration plate measures the real value.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>
            Brand (required)
            <input value={fBrand} onChange={(e) => setFBrand(e.target.value)} className={inputCls} list="tw-brand-list" />
            <datalist id="tw-brand-list">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className={labelCls}>
            Product line
            <input value={fLine} onChange={(e) => setFLine(e.target.value)} className={inputCls} placeholder="For example PLA Basic" />
          </label>
          <label className={labelCls}>
            Material
            <select value={fMaterial} onChange={(e) => setFMaterial(e.target.value as FilamentSpool['material'])} className={inputCls}>
              {MATERIALS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Colour name (required)
            <input value={fName} onChange={(e) => setFName(e.target.value)} className={inputCls} />
          </label>
          <div className={labelCls}>
            <span id="tw-new-colour">Colour (required)</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexValid ? fHex : '#000000'}
                onChange={(e) => setFHex(e.target.value.toUpperCase())}
                className={`w-9 h-8 shrink-0 rounded-control bg-transparent cursor-pointer ${FOCUS_RING}`}
                aria-label="Pick a colour"
              />
              <input value={fHex} onChange={(e) => setFHex(e.target.value)} className={`${inputCls} font-mono`} aria-labelledby="tw-new-colour" />
              {eyedropperSupported && (
                <IconButton label="Pick a colour from the screen, for example a photo of the spool" icon={<Pipette className="w-3.5 h-3.5" />} onClick={pickWithEyedropper} />
              )}
            </div>
          </div>
          <div className={labelCls}>
            <span id="tw-new-td">TD (mm): leave empty to use the estimate</span>
            <div className="flex items-center gap-2">
              <input
                value={fTd}
                onChange={(e) => setFTd(e.target.value)}
                className={`${inputCls} font-mono`}
                inputMode="decimal"
                placeholder={estimate !== null ? `Estimate: ${estimate}` : ''}
                aria-labelledby="tw-new-td"
              />
              <Button size="sm" variant="ghost" onClick={() => estimate !== null && setFTd(String(estimate))} disabled={estimate === null}>
                Use estimate
              </Button>
            </div>
            {tdWarning && <span className="text-micro text-tw-warn">{tdWarning}</span>}
          </div>
          <label className={labelCls}>
            AMS slot (optional)
            <input value={fAms} onChange={(e) => setFAms(e.target.value)} className={inputCls} placeholder="AMS 1 - A1" />
          </label>
          <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
            <span className="text-micro text-tw-ink-3">The TD will be saved as {tdNum !== null ? 'entered by you' : 'an estimate'}.</span>
            <Button variant="primary" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={submitManual}>
              Add to my spools
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
