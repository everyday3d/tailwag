import React from 'react';
import { useTailWagStore } from '../../store/useTailWagStore';
import { Button, CheckboxRow, Section, SliderRow } from '../ui';

/** Pre-press: tidy the photo before anything is solved. Collapsed on short screens so the library has room. */
export const PhotoAdjustPanel: React.FC = () => {
  const { gamma, contrast, detailEnhance, invertLuminance, setPrePress, lightAzimuthDeg, lightElevationDeg, setLighting, previewShading } = useTailWagStore();
  const shortScreen = typeof window !== 'undefined' && window.innerHeight < 820;
  return (
    <div data-tour="prepress">
      <Section
        title="Photo adjustments"
        collapsible
        defaultOpen={!shortScreen}
        actions={
          <Button
            size="sm"
            variant="ghost"
            className="border-transparent"
            title="Back to the default adjustments"
            onClick={() => setPrePress({ gamma: 1.0, contrast: 1.0, detailEnhance: 0.25, invertLuminance: false })}
          >
            Reset
          </Button>
        }
      >
        <SliderRow
          label="Fur and fine detail"
          valueText={`${Math.round(detailEnhance * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          value={detailEnhance}
          onChange={(e) => setPrePress({ detailEnhance: parseFloat(e.target.value) })}
        />
        <SliderRow
          label="Midtones"
          valueText={gamma.toFixed(2)}
          min={0.4}
          max={2.2}
          step={0.04}
          value={gamma}
          onChange={(e) => setPrePress({ gamma: parseFloat(e.target.value) })}
        />
        <SliderRow
          label="Contrast"
          valueText={`${contrast.toFixed(2)}×`}
          min={0.6}
          max={1.8}
          step={0.04}
          value={contrast}
          onChange={(e) => setPrePress({ contrast: parseFloat(e.target.value) })}
        />
        <CheckboxRow
          label="Invert for a backlit lithophane"
          description="Flips light and dark in the relief, for prints lit from behind."
          checked={invertLuminance}
          onChange={(e) => setPrePress({ invertLuminance: e.target.checked })}
        />
        <SliderRow
          label="Light direction"
          valueText={`${lightAzimuthDeg}°`}
          hint={previewShading === 'beauty' ? 'Moves the key light in the Studio light view.' : 'Only affects the Studio light view.'}
          min={-80}
          max={80}
          step={1}
          value={lightAzimuthDeg}
          onChange={(e) => setLighting(parseInt(e.target.value, 10), lightElevationDeg)}
        />
      </Section>
    </div>
  );
};
