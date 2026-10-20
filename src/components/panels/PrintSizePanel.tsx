import React from 'react';
import { Lock, Unlock } from 'lucide-react';
import { useTailWagStore } from '../../store/useTailWagStore';
import { IconButton, NumberField, SelectField, Section, Segmented, SliderRow, FOCUS_RING } from '../ui';

const MIN_MM = 30;
const MAX_MM = 256;
const clampMm = (v: number) => Math.max(MIN_MM, Math.min(MAX_MM, v));
const round2 = (v: number) => Number(v.toFixed(2));

/** Print size, layers, base and depth. Everything here is stored settings; nothing is solved. */
export const PrintSizePanel: React.FC = () => {
  const {
    projectName,
    setProjectName,
    widthMm,
    heightMm,
    lockAspect,
    setLockAspect,
    setDimensions,
    baseLayerMm,
    layerHeightMm,
    totalLayers,
    setLayerParams,
    baseSolidThicknessMm,
    setBaseSolidThicknessMm,
    totalDepthMm,
    setTotalDepthMm,
    meshResolution,
    setMeshResolution,
  } = useTailWagStore();

  // With the lock on, the other side follows so the print keeps the photo's shape (#46 crops).
  const setWidth = (raw: number) => {
    const w = clampMm(raw || 180);
    setDimensions(w, lockAspect && widthMm > 0 ? clampMm(round2((w * heightMm) / widthMm)) : heightMm);
  };
  const setHeight = (raw: number) => {
    const h = clampMm(raw || 180);
    setDimensions(lockAspect && heightMm > 0 ? clampMm(round2((h * widthMm) / heightMm)) : widthMm, h);
  };

  const baseLayers = Math.max(1, 1 + Math.round(Math.max(0, baseSolidThicknessMm - baseLayerMm) / layerHeightMm));
  const maxZ = baseLayerMm + (totalLayers - 1) * layerHeightMm;

  return (
    <div data-tour="dims">
      <Section title="Print size">
        <div className="flex flex-col gap-1">
          <label htmlFor="tw-project-title" className="text-small text-tw-ink-2">
            Project name
          </label>
          <input
            id="tw-project-title"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className={`h-8 w-full px-2.5 rounded-control bg-tw-ground border border-tw-line text-tw-ink text-body ${FOCUS_RING}`}
          />
        </div>

        <div className="flex items-end gap-2">
          <NumberField label="Width" unit="mm" min={MIN_MM} max={MAX_MM} value={widthMm} onChange={(e) => setWidth(Number(e.target.value))} className="flex-1" />
          <IconButton
            label={lockAspect ? 'Shape locked: width and height change together' : 'Shape unlocked: width and height change separately'}
            icon={lockAspect ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            aria-pressed={lockAspect}
            onClick={() => setLockAspect(!lockAspect)}
            className={lockAspect ? 'text-tw-accent-text' : ''}
          />
          <NumberField label="Height" unit="mm" min={MIN_MM} max={MAX_MM} value={heightMm} onChange={(e) => setHeight(Number(e.target.value))} className="flex-1" />
        </div>

        <div className="grid grid-cols-[1fr_1.3fr_0.9fr] gap-2">
          <NumberField
            label="First layer"
            min={0.08}
            max={0.48}
            step={0.04}
            value={baseLayerMm}
            title="First layer height in mm (default 0.16)"
            onChange={(e) => {
              const v = Math.max(0.08, Math.min(0.48, parseFloat(e.target.value) || 0.16));
              setLayerParams(round2(v), layerHeightMm, totalLayers);
            }}
          />
          <SelectField label="Layers" value={layerHeightMm} onChange={(e) => setLayerParams(baseLayerMm, parseFloat(e.target.value), totalLayers)}>
            <option value={0.04}>0.04 mm</option>
            <option value={0.08}>0.08 mm</option>
            <option value={0.12}>0.12 mm</option>
          </SelectField>
          <NumberField
            label="Count"
            min={10}
            max={64}
            value={totalLayers}
            title="Total number of layers"
            onChange={(e) => setLayerParams(baseLayerMm, layerHeightMm, Math.max(10, Math.min(64, Number(e.target.value) || 24)))}
          />
        </div>

        <SliderRow
          label="Solid base"
          valueText={`${baseSolidThicknessMm.toFixed(2)} mm`}
          hint={`Layers 1–${baseLayers} print the base filament everywhere.`}
          min={baseLayerMm}
          max={2.0}
          step={layerHeightMm}
          value={baseSolidThicknessMm}
          onChange={(e) => setBaseSolidThicknessMm(parseFloat(e.target.value))}
        />
        <SliderRow
          label="Total depth"
          valueText={`${totalDepthMm.toFixed(2)} mm`}
          hint={`${totalLayers} layers, top at ${maxZ.toFixed(2)} mm. Deeper prints blend colours over more layers.`}
          min={0.8}
          max={3.6}
          step={layerHeightMm}
          value={totalDepthMm}
          onChange={(e) => setTotalDepthMm(parseFloat(e.target.value))}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-small text-tw-ink-2">Model detail (preview and export)</span>
          <Segmented
            label="Model detail"
            value={meshResolution}
            onChange={setMeshResolution}
            options={[
              { value: 160, label: 'Fast', title: '160 columns across: quickest to preview' },
              { value: 240, label: 'High', title: '240 columns across' },
              { value: 320, label: 'Ultra', title: '320 columns across: finest detail, slowest' },
            ]}
          />
        </div>
      </Section>
    </div>
  );
};
