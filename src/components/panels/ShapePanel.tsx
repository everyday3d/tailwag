import React from 'react';
import { Clock, Download, Key, Loader2, Magnet, Monitor, ScanSearch, Type } from 'lucide-react';
import { PRINT_TEMPLATES, STAND, buildDeskStandGrid, type PrintTemplate } from '../../engine/templates';
import { BACK_PLATE_DEFAULTS, generateBinaryStlFromGrid, solidBaseTopMm } from '../../engine/cadMeshBuilder';
import { MAGNET_DEFAULTS, buildMagnetCupsGrid, magnetCentres, magnetFit } from '../../engine/magnets';
import {
  KEYHOLE_LIP_MM,
  MOVEMENT_DEPTH_MM,
  backPlateThickness,
  buildClockBackPlateGrid,
  keyholePlacement,
} from '../../engine/clockBackPlate';
import { saveBytes } from '../../utils/saveBytes';
import {
  PRINT_FONTS,
  PRINT_FONT_ORDER,
  canListSystemFonts,
  isFontInstalled,
  listSystemFonts,
  systemFamily,
  type PrintFont,
} from '../../engine/printFonts';
import { useTailWagStore } from '../../store/useTailWagStore';
import type { ClockStencilStyle, FrameStyle, MeshShapeMode } from '../../engine/cadMeshBuilder';
import { SUBJECT_DEFAULTS } from '../../engine/subjectCut';
import { findSubjectNow, subjectFinderSupported } from '../../utils/subjectFinder';
import { CAPTION_DEFAULTS, CAPTION_MAX_CHARS, CAPTION_MIN_LETTER_MM, layoutCaption } from '../../engine/caption';
import { Button, CheckboxRow, FOCUS_RING, NumberField, Section, Segmented, SelectField, SliderRow, TextField } from '../ui';

/**
 * Font for printed text: the bundled fonts, and (in the desktop app) the fonts installed on this
 * computer, listed once the person asks for them.
 */
const FontSelect: React.FC<{ value?: PrintFont; onChange: (f: PrintFont) => void }> = ({ value, onChange }) => {
  const [systemFonts, setSystemFonts] = React.useState<string[] | null>(null);
  const [listError, setListError] = React.useState(false);
  const current = value ?? 'modern';
  const family = systemFamily(current);
  const missing = family !== null && !isFontInstalled(family);

  const pick = (v: string) => {
    if (v !== '__more') return onChange(v as PrintFont);
    listSystemFonts()
      .then((list) => setSystemFonts(list))
      .catch(() => setListError(true));
  };

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <SelectField label="Font" value={current} onChange={(e) => pick(e.target.value)}>
        <optgroup label="Bundled with TailWag">
          {PRINT_FONT_ORDER.map((f) => (
            <option key={f} value={f} style={{ fontFamily: `"${PRINT_FONTS[f].family}"` }}>
              {PRINT_FONTS[f].label}
            </option>
          ))}
        </optgroup>
        {family && !systemFonts?.includes(family) && <option value={current}>{family}</option>}
        {systemFonts && systemFonts.length > 0 && (
          <optgroup label="On this computer">
            {systemFonts.map((f) => (
              <option key={f} value={`system:${f}`} style={{ fontFamily: `"${f}"` }}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
        {!systemFonts && canListSystemFonts() && <option value="__more">Fonts on this computer…</option>}
      </SelectField>
      {family && (
        <span className={`text-micro ${missing ? 'text-tw-warn' : 'text-tw-ink-3'}`}>
          {missing
            ? `${family} isn't installed on this computer, so a plain font is used instead.`
            : 'A font on this computer: on another computer without it, a plain font is used.'}
        </span>
      )}
      {listError && <span className="text-micro text-tw-warn">Couldn't list the fonts on this computer.</span>}
    </div>
  );
};

/** The desk stand: sized to the print's thickness and width, printed on its side. */
const StandBox: React.FC = () => {
  const { cad, widthMm, baseLayerMm, layerHeightMm, totalLayers, projectName } = useTailWagStore();
  const [saving, setSaving] = React.useState(false);
  // The bottom edge sits in the slot: a frame is at its tallest right at the edge
  const thickness = baseLayerMm + (totalLayers - 1) * layerHeightMm + (cad.frameStyle !== 'none' ? cad.frameHeightBonusMm : 0);
  const length = Math.round(Math.min(150, Math.max(40, widthMm * 0.6)));

  const download = async () => {
    setSaving(true);
    try {
      const stl = generateBinaryStlFromGrid(buildDeskStandGrid(thickness, length), 'TailWag desk stand');
      await saveBytes(stl, `${projectName || 'TailWag'}_Desk_Stand.stl`, 'stl');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-control bg-tw-raised/60 border border-tw-line">
      <span className="text-micro text-tw-ink-3">
        {length} mm long with a slot for a print {thickness.toFixed(1)} mm thick, leaning back {STAND.leanDeg}°. Print it on its side as it
        downloads: no supports needed. Any colour.
      </span>
      <Button size="sm" className="self-start" icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />} disabled={saving} onClick={() => void download()}>
        Download stand (.stl)
      </Button>
    </div>
  );
};

/** Magnet size, how many, and whether they fit in the solid base. */
const MagnetBox: React.FC = () => {
  const { cad, setCadConfig, baseLayerMm, layerHeightMm, totalLayers, baseSolidThicknessMm, projectName } = useTailWagStore();
  const diameter = cad.magnetDiameterMm || MAGNET_DEFAULTS.diameterMm;
  const thickness = cad.magnetThicknessMm ?? MAGNET_DEFAULTS.thicknessMm;
  const base = solidBaseTopMm(baseLayerMm, layerHeightMm, totalLayers, baseSolidThicknessMm);
  const fit = magnetFit(diameter, thickness, base);
  const style = cad.magnetStyle ?? 'pockets';
  const added = cad.magnetBackLayers ?? 0;
  const layout = cad.magnetLayout ?? MAGNET_DEFAULTS.layout;
  const [saving, setSaving] = React.useState(false);

  const downloadCups = async () => {
    setSaving(true);
    try {
      const grid = buildMagnetCupsGrid(diameter, thickness, magnetCentres(layout, 100, 100).length);
      await saveBytes(generateBinaryStlFromGrid(grid, 'TailWag magnet cups'), `${projectName || 'TailWag'}_Magnet_Cups.stl`, 'stl');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 rounded-control bg-tw-raised/60 border border-tw-line">
      <span className="text-body text-tw-ink">Magnets</span>
      <Segmented
        label="How the magnets are held"
        size="sm"
        value={style}
        onChange={(magnetStyle) => setCadConfig({ magnetStyle })}
        options={[
          { value: 'pockets', label: 'Pockets in the back', title: 'Push the magnets into pockets in the back of the print' },
          { value: 'cups', label: 'Glue-on cups', title: 'Small cups printed separately and glued to the back; the print stays thin' },
        ]}
      />
      <Segmented
        label="Magnet positions"
        size="sm"
        value={cad.magnetLayout ?? MAGNET_DEFAULTS.layout}
        onChange={(magnetLayout) => setCadConfig({ magnetLayout })}
        options={[
          { value: 'corners', label: '4 corners' },
          { value: 'top', label: '2 at the top' },
          { value: 'centre', label: '1 in the middle' },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Diameter"
          unit="mm"
          step={0.5}
          min={2}
          max={30}
          value={diameter}
          onChange={(e) => setCadConfig({ magnetDiameterMm: Math.max(2, parseFloat(e.target.value) || MAGNET_DEFAULTS.diameterMm) })}
        />
        <NumberField
          label="Thickness"
          unit="mm"
          step={0.5}
          min={0.5}
          max={10}
          value={thickness}
          onChange={(e) => setCadConfig({ magnetThicknessMm: Math.max(0.5, parseFloat(e.target.value) || MAGNET_DEFAULTS.thicknessMm) })}
        />
      </div>
      {style === 'cups' ? (
        <>
          <span className="text-micro text-tw-ink-3">
            {magnetCentres(layout, 100, 100).length} cups for {diameter} × {thickness} mm magnets, printed open side up. Push the magnets
            in and glue the cups to the back of the print. The print itself stays as it is.
          </span>
          <Button size="sm" className="self-start" icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />} disabled={saving} onClick={() => void downloadCups()}>
            Download magnet cups (.stl)
          </Button>
        </>
      ) : fit.fits ? (
        <span className="text-micro text-tw-ink-3">
          Pockets {fit.holeDiameterMm.toFixed(1)} mm across and {fit.depthMm.toFixed(1)} mm deep; push the magnets in from the back.
          {added > 0
            ? ` To make room, the back is ${(added * layerHeightMm).toFixed(2)} mm thicker: ${added} plain layers under the picture, and every filament change moved up ${added} layers. The picture is unchanged.`
            : ' The front is unchanged.'}
        </span>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-micro text-tw-warn">
            The back is too thin for these magnets now (Solid base was lowered). The pockets are only {fit.depthMm.toFixed(2)} mm deep.
          </span>
          <Button size="sm" className="self-start" onClick={() => setCadConfig({ magnetThicknessMm: thickness })}>
            Make room again
          </Button>
        </div>
      )}
    </div>
  );
};

/** The separate back plate behind cut-through clock numerals: colour preview, thickness and download. */
const BackPlateBox: React.FC = () => {
  const { cad, setCadConfig, widthMm, heightMm, meshResolution, projectName, baseLayerMm, layerHeightMm, totalLayers, catalog } = useTailWagStore();
  const [saving, setSaving] = React.useState(false);
  const plateHex = (cad.backPlateHex ?? BACK_PLATE_DEFAULTS.hex).toUpperCase();
  // Ideas for the plate colour: your own spools, one swatch per colour
  const swatches = React.useMemo(() => {
    const seen = new Set<string>();
    return catalog
      .filter((s) => s.owned)
      .filter((s) => {
        const hex = s.hex.toUpperCase();
        if (seen.has(hex)) return false;
        seen.add(hex);
        return true;
      })
      .slice(0, 18);
  }, [catalog]);
  const picked = swatches.find((s) => s.hex.toUpperCase() === plateHex);
  const plate = backPlateThickness(cad);
  const face = baseLayerMm + (totalLayers - 1) * layerHeightMm + (cad.frameStyle !== 'none' ? cad.frameHeightBonusMm : 0);
  const keyhole = keyholePlacement(widthMm, heightMm);

  const download = async () => {
    setSaving(true);
    try {
      const grid = buildClockBackPlateGrid(widthMm, heightMm, cad, meshResolution);
      const stl = generateBinaryStlFromGrid(grid, 'TailWag clock back plate');
      await saveBytes(stl, `${projectName || 'TailWag'}_Clock_Back_Plate.stl`, 'stl');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 rounded-control bg-tw-raised/60 border border-tw-line">
      <span className="text-body text-tw-ink">Back plate</span>
      <span className="text-small text-tw-ink-2">
        A separate print in one colour: the colour that shows through the numerals. Print it face down; the rim that holds the clock
        movement and a keyhole for hanging it on the wall print on top.
      </span>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="tw-backplate-colour" className="text-small text-tw-ink-2">
            Colour (preview)
          </label>
          <input
            id="tw-backplate-colour"
            type="color"
            value={plateHex}
            onChange={(e) => setCadConfig({ backPlateHex: e.target.value.toUpperCase() })}
            className={`h-8 w-full rounded-control bg-tw-ground border border-tw-line cursor-pointer ${FOCUS_RING}`}
          />
        </div>
        <NumberField
          label="Thickness"
          unit="mm"
          step={0.5}
          min={1}
          max={6}
          value={plate}
          onChange={(e) => setCadConfig({ backPlateThicknessMm: parseFloat(e.target.value) || BACK_PLATE_DEFAULTS.thicknessMm })}
        />
      </div>
      {swatches.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-small text-tw-ink-2">
            Try one of your spools{picked ? `: ${picked.brand} ${picked.name}` : ''}
          </span>
          <div role="group" aria-label="Back plate colour from your spools" className="flex flex-wrap gap-1.5">
            {swatches.map((s) => {
              const on = s.hex.toUpperCase() === plateHex;
              return (
                <button
                  key={s.hex}
                  type="button"
                  title={`${s.brand} ${s.name}`}
                  aria-label={`${s.brand} ${s.name}`}
                  aria-pressed={on}
                  onClick={() => setCadConfig({ backPlateHex: s.hex.toUpperCase() })}
                  className={`w-6 h-6 rounded-full border ${on ? 'border-tw-accent ring-2 ring-tw-accent/60' : 'border-tw-line-strong'} ${FOCUS_RING}`}
                  style={{ backgroundColor: s.hex }}
                />
              );
            })}
          </div>
        </div>
      )}
      <span className="text-micro text-tw-ink-3">
        The movement's shaft goes through the plate and the face ({(plate + face).toFixed(1)} mm together) and its nut holds them together.
        Choose a movement made for a dial at least that thick.
        {keyhole.fits
          ? ` To hang it, use a screw with a head up to 9 mm across and a shank up to 4.5 mm, standing out of the wall by its head plus ${KEYHOLE_LIP_MM} mm. The hanger post is as tall as the movement (${MOVEMENT_DEPTH_MM} mm), so the clock hangs straight.`
          : ' This clock is small, so the keyhole may show through the numerals; the hook on the movement or a sticky hook works too.'}
      </span>
      <Button size="sm" className="self-start" icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />} disabled={saving} onClick={() => void download()}>
        Download back plate (.stl)
      </Button>
    </div>
  );
};

/** Outline shape, frame, wall clock and mounting extras. Optional; collapsed by default. */
export const ShapePanel: React.FC<{ onApplyTemplate: (t: PrintTemplate) => void }> = ({ onApplyTemplate }) => {
  const { cad, setCadConfig, subjectMask, subjectStatus, widthMm, heightMm } = useTailWagStore();
  const canFind = subjectFinderSupported();
  const isSubject = cad.shape === 'subject';
  const hasCaption = Boolean(cad.captionText?.trim());
  const captionLayout = layoutCaption(cad, widthMm, heightMm, cad.frameStyle !== 'none' ? cad.frameWidthMm : 0);
  const letterMm = captionLayout ? captionLayout.letterMm[0] : 0;

  const chooseShape = (shape: MeshShapeMode) => {
    setCadConfig({ shape });
    if (shape === 'subject' && !subjectMask && subjectStatus.kind !== 'busy') void findSubjectNow();
  };

  return (
    <div data-tour="cad">
      <Section
        title="Shape and extras"
        collapsible
        defaultOpen={isSubject || hasCaption}
        meta={
          isSubject
            ? 'Cut to the subject'
            : hasCaption
              ? 'With a name plate'
              : cad.shape === 'rect' && cad.frameStyle === 'none'
                ? 'Plain rectangle'
                : undefined
        }
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-small text-tw-ink-2">Start from a template</span>
          <div role="group" aria-label="Templates" className="flex flex-wrap gap-1.5">
            {PRINT_TEMPLATES.map((t) => (
              <Button
                key={t.id}
                size="sm"
                title={t.blurb}
                aria-pressed={cad.template === t.id}
                className={cad.template === t.id ? 'border-tw-accent text-tw-accent-text' : ''}
                onClick={() => onApplyTemplate(t)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <span className="text-micro text-tw-ink-3">
            {PRINT_TEMPLATES.find((t) => t.id === cad.template)?.blurb ??
              'Sets the size, shape, holes and depth for you. Your photo, filaments and name plate stay.'}
          </span>
        </div>

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

        <div className="flex flex-col gap-3 p-3 rounded-control bg-tw-raised/60 border border-tw-line" data-tour="caption">
          <span className="flex items-center gap-1.5 text-body text-tw-ink">
            <Type className="w-3.5 h-3.5 text-tw-ink-2" aria-hidden="true" />
            Name plate or caption
          </span>
          <TextField
            label="Text"
            placeholder="Tucker"
            maxLength={CAPTION_MAX_CHARS}
            value={cad.captionText ?? ''}
            onChange={(e) => setCadConfig({ captionText: e.target.value })}
          />
          {hasCaption && (
            <>
              <TextField
                label="Second line (optional, smaller)"
                placeholder="2019 – 2026"
                maxLength={CAPTION_MAX_CHARS}
                value={cad.captionLine2 ?? ''}
                onChange={(e) => setCadConfig({ captionLine2: e.target.value })}
              />
              <FontSelect value={cad.captionFont} onChange={(captionFont) => setCadConfig({ captionFont })} />
              <Segmented
                label="Caption style"
                size="sm"
                value={cad.captionStyle ?? CAPTION_DEFAULTS.style}
                onChange={(captionStyle) => setCadConfig({ captionStyle })}
                options={[
                  { value: 'plate', label: 'Name plate', title: 'A flat bar along the edge with raised letters' },
                  { value: 'photo', label: 'On the photo', title: 'Raised letters straight on the picture, with a thin outline' },
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <Segmented
                  label="Caption position"
                  size="sm"
                  value={cad.captionPosition ?? CAPTION_DEFAULTS.position}
                  onChange={(captionPosition) => setCadConfig({ captionPosition })}
                  options={[
                    { value: 'bottom', label: 'Bottom' },
                    { value: 'top', label: 'Top' },
                  ]}
                />
                <Segmented
                  label="Letter size"
                  size="sm"
                  value={cad.captionSize ?? CAPTION_DEFAULTS.size}
                  onChange={(captionSize) => setCadConfig({ captionSize })}
                  options={[
                    { value: 'small', label: 'S', title: 'Small letters' },
                    { value: 'medium', label: 'M', title: 'Medium letters' },
                    { value: 'large', label: 'L', title: 'Large letters' },
                  ]}
                />
              </div>
              <span className="text-micro text-tw-ink-3">
                {(cad.captionStyle ?? CAPTION_DEFAULTS.style) === 'plate'
                  ? `Letters about ${letterMm.toFixed(0)} mm tall, raised in your top filament on a bar in your first filament.`
                  : `Letters about ${letterMm.toFixed(0)} mm tall, raised in your top filament with a thin outline in your first filament.`}
                {letterMm < CAPTION_MIN_LETTER_MM + 1 ? ' Long text gets smaller to fit; under 5 mm it may not print cleanly.' : ''}
              </span>
            </>
          )}
        </div>

        <CheckboxRow
          label="Wall clock"
          description="Cuts a shaft hole for a quartz movement and adds numerals."
          icon={<Clock className="w-3.5 h-3.5 text-tw-ink-2" aria-hidden="true" />}
          checked={cad.clockMode}
          onChange={(e) =>
            // A clock face reads best edge to edge, so it starts without a frame (one can still be picked)
            setCadConfig(
              e.target.checked ? { clockMode: true, shape: 'circle', frameStyle: 'none' } : { clockMode: false }
            )
          }
        />
        {cad.clockMode && (
          <Segmented
            label="Clock numerals"
            size="sm"
            value={cad.clockNumerals ?? 'raised'}
            onChange={(clockNumerals) => setCadConfig({ clockNumerals })}
            options={[
              { value: 'raised', label: 'Raised numerals', title: 'Numerals stand up in your top filament' },
              { value: 'cut', label: 'Cut through', title: 'Numerals go right through, with a coloured back plate behind them' },
            ]}
          />
        )}
        {cad.clockMode && (
          <div className="grid grid-cols-2 gap-2">
            <SelectField label="Numerals" value={cad.clockStencil} onChange={(e) => setCadConfig({ clockStencil: e.target.value as ClockStencilStyle })}>
              <option value="modern-arabic">1 to 12</option>
              <option value="roman">Roman</option>
              <option value="paw-markers">Quarters and dots</option>
              <option value="none">None</option>
            </SelectField>
            <FontSelect value={cad.clockFont} onChange={(clockFont) => setCadConfig({ clockFont })} />
            <NumberField
              label="Shaft hole"
              unit="mm"
              step={0.2}
              value={cad.clockShaftDiameterMm}
              onChange={(e) => setCadConfig({ clockShaftDiameterMm: parseFloat(e.target.value) || 8.2 })}
            />
          </div>
        )}
        {cad.clockMode && (
          <CheckboxRow
            label="Minute marks"
            description="The ring of small marks around the edge."
            checked={cad.clockMinuteMarks !== false}
            onChange={(e) => setCadConfig({ clockMinuteMarks: e.target.checked })}
          />
        )}
        {cad.clockMode && cad.clockNumerals === 'cut' && <BackPlateBox />}

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
        {cad.magnetPockets && <MagnetBox />}
        <CheckboxRow
          label="Desk stand"
          description="A separate stand that holds the print at a slight lean."
          icon={<Monitor className="w-3.5 h-3.5 text-tw-ink-2" aria-hidden="true" />}
          checked={Boolean(cad.deskStand)}
          onChange={(e) => setCadConfig({ deskStand: e.target.checked })}
        />
        {cad.deskStand && <StandBox />}
      </Section>
    </div>
  );
};
