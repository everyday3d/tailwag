import React, { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button, Dialog, FOCUS_RING } from './ui';
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

  const inputCls = `h-8 w-full px-2.5 rounded-control bg-tw-ground border border-tw-line text-body text-tw-ink ${FOCUS_RING}`;
  const labelCls = 'flex flex-col gap-1 text-small text-tw-ink-2';

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Edit filament"
      subtitle={`${spool.brand} ${spool.name}`}
      footer={
        <>
          {isMine ? (
            confirmDelete ? (
              <span className="mr-auto flex items-center gap-2 text-small text-tw-danger">
                Delete this filament?
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    removeMySpool(spool.id);
                    onClose();
                  }}
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="danger" className="mr-auto" icon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )
          ) : (
            <span className="mr-auto text-micro text-tw-ink-3">Catalog and imported spools can't be deleted here.</span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Save className="w-4 h-4" aria-hidden="true" />} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className={labelCls}>
          Brand (required)
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          Product line
          <input value={line} onChange={(e) => setLine(e.target.value)} className={inputCls} />
        </label>
        <label className={labelCls}>
          Material
          <select value={material} onChange={(e) => setMaterial(e.target.value as FilamentSpool['material'])} className={inputCls}>
            {MATERIALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Colour name (required)
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <div className={labelCls}>
          <span id="tw-spool-colour">Colour (required)</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={hexValid ? hex : '#000000'}
              onChange={(e) => setHex(e.target.value.toUpperCase())}
              className={`w-9 h-8 shrink-0 rounded-control bg-transparent cursor-pointer ${FOCUS_RING}`}
              aria-label="Pick a colour"
            />
            <input value={hex} onChange={(e) => setHex(e.target.value)} className={`${inputCls} font-mono`} aria-labelledby="tw-spool-colour" />
          </div>
        </div>
        <label className={labelCls}>
          AMS slot
          <input value={ams} onChange={(e) => setAms(e.target.value)} className={inputCls} placeholder="AMS 1 - A1" />
        </label>
        <div className={labelCls}>
          <span id="tw-spool-td">TD (mm)</span>
          <div className="flex items-center gap-2">
            <input value={td} onChange={(e) => setTd(e.target.value)} className={`${inputCls} font-mono`} inputMode="decimal" aria-labelledby="tw-spool-td" />
            <Button
              size="sm"
              variant="ghost"
              disabled={estimate === null}
              title="Replace with an estimate from the colour"
              onClick={() => {
                if (estimate !== null) {
                  setTd(String(estimate));
                  setTdSource('estimate');
                }
              }}
            >
              Estimate
            </Button>
          </div>
          {tdWarning && <span className="text-micro text-tw-warn">{tdWarning}</span>}
        </div>
        <label className={labelCls}>
          Where the TD comes from
          <select value={tdSource} onChange={(e) => setTdSource(e.target.value as TdSource)} className={inputCls}>
            {(Object.keys(TD_SOURCE_LABEL) as TdSource[]).map((s) => (
              <option key={s} value={s}>
                {TD_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          {lowersSource && (
            <span className="text-micro text-tw-warn">
              This replaces a more reliable source ({TD_SOURCE_LABEL[originalSource]}). Saving overwrites it.
            </span>
          )}
        </label>
        {catalogOrigin && (
          <p className="col-span-2 m-0 text-micro text-tw-ink-3">
            From the catalog: {catalogOrigin.brand} {catalogOrigin.name} ({catalogOrigin.hex}, TD {catalogOrigin.td.toFixed(1)} mm).
          </p>
        )}
        {error && (
          <p role="alert" className="col-span-2 m-0 px-2.5 py-1.5 rounded-control bg-tw-danger/10 border border-tw-danger/30 text-small text-tw-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
};
