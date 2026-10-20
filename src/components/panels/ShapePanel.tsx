import React from 'react';
import { Clock, Key, Magnet } from 'lucide-react';
import { useTailWagStore } from '../../store/useTailWagStore';
import type { ClockStencilStyle, FrameStyle, MeshShapeMode } from '../../engine/cadMeshBuilder';
import { CheckboxRow, NumberField, Section, SelectField } from '../ui';

/** Outline shape, frame, wall clock and mounting extras. Optional; collapsed by default. */
export const ShapePanel: React.FC = () => {
  const { cad, setCadConfig } = useTailWagStore();
  return (
    <div data-tour="cad">
      <Section title="Shape and extras" collapsible defaultOpen={false} meta={cad.shape === 'rect' && cad.frameStyle === 'none' ? 'Plain rectangle' : undefined}>
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Shape" value={cad.shape} onChange={(e) => setCadConfig({ shape: e.target.value as MeshShapeMode })}>
            <option value="rect">Rectangle</option>
            <option value="rounded">Rounded plaque</option>
            <option value="circle">Circle or clock</option>
            <option value="hexagon">Hexagon tile</option>
            <option value="shield">Crest shield</option>
            <option value="paw">BoxerDawg medallion</option>
          </SelectField>
          <SelectField label="Frame" value={cad.frameStyle} onChange={(e) => setCadConfig({ frameStyle: e.target.value as FrameStyle })}>
            <option value="beveled">Bevelled</option>
            <option value="modern-lip">Raised lip</option>
            <option value="stepped">Stepped gallery</option>
            <option value="none">No frame</option>
          </SelectField>
        </div>

        <CheckboxRow
          label="Wall clock"
          description="Cuts a shaft hole for a quartz movement and adds numerals."
          icon={<Clock className="w-3.5 h-3.5 text-tw-ink-2" aria-hidden="true" />}
          checked={cad.clockMode}
          onChange={(e) => setCadConfig({ clockMode: e.target.checked, shape: e.target.checked ? 'circle' : cad.shape })}
        />
        {cad.clockMode && (
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Numerals" value={cad.clockStencil} onChange={(e) => setCadConfig({ clockStencil: e.target.value as ClockStencilStyle })}>
              <option value="modern-arabic">1 to 12</option>
              <option value="roman">Roman</option>
              <option value="paw-markers">Quarters and dots</option>
              <option value="none">None</option>
            </SelectField>
            <NumberField
              label="Shaft hole"
              unit="mm"
              step={0.2}
              value={cad.clockShaftDiameterMm}
              onChange={(e) => setCadConfig({ clockShaftDiameterMm: parseFloat(e.target.value) || 8.2 })}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <CheckboxRow
            label="Keychain hole"
            icon={<Key className="w-3.5 h-3.5 text-tw-ink-2" aria-hidden="true" />}
            checked={cad.keychainHole}
            onChange={(e) => setCadConfig({ keychainHole: e.target.checked })}
          />
          <CheckboxRow
            label="Magnet pockets"
            icon={<Magnet className="w-3.5 h-3.5 text-tw-ink-2" aria-hidden="true" />}
            checked={cad.magnetPockets}
            onChange={(e) => setCadConfig({ magnetPockets: e.target.checked })}
          />
        </div>
      </Section>
    </div>
  );
};
