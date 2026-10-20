import React from 'react';
import { Clock, Key, Loader2, Magnet, ScanSearch } from 'lucide-react';
import { useTailWagStore } from '../../store/useTailWagStore';
import type { ClockStencilStyle, FrameStyle, MeshShapeMode } from '../../engine/cadMeshBuilder';
import { SUBJECT_DEFAULTS } from '../../engine/subjectCut';
import { findSubjectNow, subjectFinderSupported } from '../../utils/subjectFinder';
import { Button, CheckboxRow, NumberField, Section, SelectField, SliderRow } from '../ui';

/** Outline shape, frame, wall clock and mounting extras. Optional; collapsed by default. */
export const ShapePanel: React.FC = () => {
  const { cad, setCadConfig, subjectMask, subjectStatus } = useTailWagStore();
  const canFind = subjectFinderSupported();
  const isSubject = cad.shape === 'subject';

  const chooseShape = (shape: MeshShapeMode) => {
    setCadConfig({ shape });
    if (shape === 'subject' && !subjectMask && subjectStatus.kind !== 'busy') void findSubjectNow();
  };

  return (
    <div data-tour="cad">
      <Section
        title="Shape and extras"
        collapsible
        defaultOpen={isSubject}
        meta={isSubject ? 'Cut to the subject' : cad.shape === 'rect' && cad.frameStyle === 'none' ? 'Plain rectangle' : undefined}
      >
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Shape" value={cad.shape} onChange={(e) => chooseShape(e.target.value as MeshShapeMode)}>
            <option value="subject" disabled={!canFind}>
              {canFind ? 'Subject (automatic)' : 'Subject (desktop app only)'}
            </option>
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

        {isSubject && (
          <div className="flex flex-col gap-3 p-3 rounded-control bg-tw-raised/60 border border-tw-line">
            <div role="status" className="text-small">
              {subjectStatus.kind === 'busy' ? (
                <span className="flex items-center gap-2 text-tw-ink-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Finding the subject… about 5 to 10 seconds.
                </span>
              ) : subjectStatus.kind === 'error' ? (
                <span className="text-tw-warn">{subjectStatus.message}</span>
              ) : subjectMask ? (
                <span className="text-tw-ink-2">The print is cut to the outline of the subject, found automatically on this computer.</span>
              ) : (
                <span className="text-tw-ink-2">No subject found yet. The print stays a rectangle until one is.</span>
              )}
            </div>
            {subjectMask && (
              <>
                <SliderRow
                  label="Space around the subject"
                  valueText={`${(cad.subjectMarginMm ?? SUBJECT_DEFAULTS.marginMm).toFixed(1)} mm`}
                  min={0}
                  max={12}
                  step={0.5}
                  value={cad.subjectMarginMm ?? SUBJECT_DEFAULTS.marginMm}
                  onChange={(e) => setCadConfig({ subjectMarginMm: parseFloat(e.target.value) })}
                />
                <SliderRow
                  label="Smooth the outline"
                  valueText={`${(cad.subjectSmoothMm ?? SUBJECT_DEFAULTS.smoothMm).toFixed(1)} mm`}
                  hint="Rounds off fur and whiskers so the edge prints cleanly."
                  min={0}
                  max={8}
                  step={0.5}
                  value={cad.subjectSmoothMm ?? SUBJECT_DEFAULTS.smoothMm}
                  onChange={(e) => setCadConfig({ subjectSmoothMm: parseFloat(e.target.value) })}
                />
              </>
            )}
            <Button
              size="sm"
              className="self-start"
              icon={<ScanSearch className="w-3.5 h-3.5" aria-hidden="true" />}
              disabled={subjectStatus.kind === 'busy'}
              onClick={() => void findSubjectNow()}
            >
              {subjectMask ? 'Find the subject again' : 'Find the subject'}
            </Button>
          </div>
        )}

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
