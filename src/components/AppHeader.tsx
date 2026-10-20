import React, { useEffect, useRef, useState } from 'react';
import { Dog, Undo2, Redo2, FolderOpen, Save, Upload, Crop, Ruler, Package, Sun, Eye, Blend, HelpCircle } from 'lucide-react';
import { useTailWagStore } from '../store/useTailWagStore';
import { APP_VERSION } from '../appVersion';
import type { UpdateResult } from '../engine/updateCheck';
import { Button, IconButton, Segmented, FOCUS_RING } from './ui';

interface Props {
  updateResult: UpdateResult | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onLoadPhoto: () => void;
  onEditPhoto: () => void;
  onOpenAbout: () => void;
  onOpenTdCalibrator: () => void;
  onOpenCalibrationPlate: () => void;
  onOpenTour: () => void;
  onExport: () => void;
}

/** Header in three groups: view settings, file actions, then Load photo and Export. */
export const AppHeader: React.FC<Props> = (p) => {
  const {
    viewportMode,
    setViewportMode,
    backlitLithoMode,
    setBacklitLithoMode,
    previewShading,
    setPreviewShading,
    matchMode,
    setMatchMode,
  } = useTailWagStore();

  const accuracy = previewShading === 'accuracy' && !backlitLithoMode;
  const toggle = 'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-control border border-tw-line text-small text-tw-ink-2 hover:text-tw-ink hover:bg-tw-raised transition disabled:opacity-40';

  return (
    <header className="flex items-center justify-between gap-3 px-3 min-[1500px]:px-4 py-2.5 bg-tw-panel border-b border-tw-line shrink-0 whitespace-nowrap">
      {/* Brand and version (the version opens About and updates) */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-[30px] h-[30px] rounded-control bg-tw-accent flex items-center justify-center" aria-hidden="true">
          <Dog className="w-[18px] h-[18px] text-tw-accent-ink" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-tw-ink hidden min-[1360px]:inline">TailWag Studio</span>
        <button
          type="button"
          onClick={p.onOpenAbout}
          title="About TailWag and check for updates"
          className={`font-mono text-micro text-tw-ink-2 border border-tw-line-strong rounded-md px-1.5 py-0.5 hover:text-tw-ink ${FOCUS_RING}`}
        >
          {APP_VERSION}
        </button>
        {p.updateResult?.kind === 'update' && (
          <button
            type="button"
            onClick={p.onOpenAbout}
            className={`text-micro font-medium px-1.5 py-0.5 rounded-md bg-tw-ok/15 text-tw-ok border border-tw-ok/30 ${FOCUS_RING}`}
          >
            Update: {p.updateResult.info.version}
          </button>
        )}
      </div>

      {/* View settings */}
      <div className="flex items-center gap-2 shrink-0">
        <div data-tour="view-modes">
          <Segmented
            label="View"
            fill={false}
            value={viewportMode === 'heightmap' ? '3d-mesh' : viewportMode}
            onChange={(v) => setViewportMode(v)}
            options={[
              { value: '3d-mesh', label: '3D', title: '3D relief of the predicted print' },
              { value: 'split', label: 'Split', title: 'Wipe between the photo and the print' },
              { value: 'source', label: 'Photo', title: 'The photo on its own' },
            ]}
          />
        </div>
        <button
          type="button"
          onClick={() => setBacklitLithoMode(!backlitLithoMode)}
          title="Front-lit: how the print looks on a wall. Backlit: how light shines through it as a lithophane."
          aria-pressed={backlitLithoMode}
          className={`${toggle} ${FOCUS_RING} ${backlitLithoMode ? 'text-tw-warn border-tw-warn/40' : ''}`}
        >
          <Sun className="w-3.5 h-3.5" aria-hidden="true" />
          {backlitLithoMode ? 'Backlit' : 'Front-lit'}
        </button>
        <button
          type="button"
          onClick={() => setPreviewShading(previewShading === 'accuracy' ? 'beauty' : 'accuracy')}
          disabled={backlitLithoMode}
          title="True colour: unlit, the predicted colour of every column. Studio light: adds lighting and shading."
          className={`${toggle} ${FOCUS_RING}`}
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          {accuracy ? 'True colour' : 'Studio light'}
        </button>
        <button
          type="button"
          data-tour="match-mode"
          onClick={() => setMatchMode(matchMode === 'faithful' ? 'vivid' : 'faithful')}
          title="Faithful: match the photo's own colours as closely as the filaments allow. Vivid: boost saturation and map brightness to height."
          className={`${toggle} ${FOCUS_RING}`}
        >
          <Blend className="w-3.5 h-3.5" aria-hidden="true" />
          {matchMode === 'faithful' ? 'Faithful' : 'Vivid'}
        </button>
      </div>

      {/* File actions, then the main actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <IconButton label="Undo (Ctrl+Z)" icon={<Undo2 className="w-4 h-4" />} onClick={p.onUndo} disabled={!p.canUndo} />
        <IconButton label="Redo (Ctrl+Y)" icon={<Redo2 className="w-4 h-4" />} onClick={p.onRedo} disabled={!p.canRedo} />
        <span data-tour="project" className="flex items-center gap-1.5">
          <IconButton label="Open a project (Ctrl+O)" icon={<FolderOpen className="w-4 h-4" />} onClick={p.onOpenProject} />
          <IconButton label="Save this project (Ctrl+S)" icon={<Save className="w-4 h-4" />} onClick={p.onSaveProject} />
        </span>
        <div className="w-px h-[22px] bg-tw-line mx-1" aria-hidden="true" />
        <Button data-tour="load-image" icon={<Upload className="w-4 h-4" />} onClick={p.onLoadPhoto}>
          Load photo
        </Button>
        <IconButton label="Edit photo: crop, turn, straighten and mark a focus area" icon={<Crop className="w-4 h-4" />} onClick={p.onEditPhoto} />
        <ToolsMenu onTdCalibrator={p.onOpenTdCalibrator} onCalibrationPlate={p.onOpenCalibrationPlate} />
        <IconButton label="Replay the guided tour" icon={<HelpCircle className="w-4 h-4" />} onClick={p.onOpenTour} />
        <Button data-tour="export" variant="primary" icon={<Package className="w-4 h-4" />} onClick={p.onExport}>
          Export
        </Button>
      </div>
    </header>
  );
};

/** The two calibration tools share one button with a small menu. */
const ToolsMenu: React.FC<{ onTdCalibrator: () => void; onCalibrationPlate: () => void }> = ({ onTdCalibrator, onCalibrationPlate }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = `w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-md text-left hover:bg-tw-hover ${FOCUS_RING}`;
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <span ref={wrap} className="relative" data-tour="calibration">
      <IconButton
        label="Calibration tools"
        icon={<Ruler className="w-4 h-4" />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-50 w-64 p-1 rounded-card bg-tw-panel border border-tw-line-strong shadow-2xl whitespace-normal">
          <button ref={firstItem} role="menuitem" type="button" className={item} onClick={pick(onCalibrationPlate)}>
            <span className="text-body font-medium text-tw-ink">Calibration plate</span>
            <span className="text-small text-tw-ink-2">Print one plate, photograph it, and measure each filament's real colour and TD.</span>
          </button>
          <button role="menuitem" type="button" className={item} onClick={pick(onTdCalibrator)}>
            <span className="text-body font-medium text-tw-ink">TD calibrator and AMS</span>
            <span className="text-small text-tw-ink-2">Measure TD from a step wedge, and read AMS slots from Home Assistant.</span>
          </button>
        </div>
      )}
    </span>
  );
};
