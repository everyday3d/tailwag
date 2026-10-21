import React from 'react';
import { Crop, Palette, Upload, Wand2 } from 'lucide-react';
import { useTailWagStore } from '../../store/useTailWagStore';
import { isDefaultEdit, maskHasFocus } from '../../engine/photoEdit';
import { Button, Section } from '../ui';

interface Props {
  sourceDataUrl: string;
  onEditPhoto: () => void;
  onLoadPhoto: () => void;
  /** Turns "Fix photo" on or off */
  onFixPhoto: (on: boolean) => void;
  /** Opens the Recolour window */
  onRecolor: () => void;
}

/** The photo being printed, with how it was cropped, whether it is fixed and whether a focus area is painted (#46). */
export const PhotoPanel: React.FC<Props> = ({ sourceDataUrl, onEditPhoto, onLoadPhoto, onFixPhoto, onRecolor }) => {
  const { projectName, sourceImageData, photoEdit, focusMask, focusStrength } = useTailWagStore();
  const cropped = !isDefaultEdit({ ...photoEdit, enhance: false, recolor: [] });
  const recolors = photoEdit.recolor?.length ?? 0;
  const fixed = Boolean(photoEdit.enhance);
  const focused = maskHasFocus(focusMask);
  return (
    <Section title="Photo">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onEditPhoto}
          title="Edit photo"
          className="w-[72px] h-[66px] shrink-0 rounded-control overflow-hidden bg-tw-ground border border-tw-line hover:border-tw-line-strong"
        >
          <img src={sourceDataUrl} alt="The photo being printed" className="w-full h-full object-cover" />
        </button>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-body font-medium text-tw-ink truncate" title={projectName}>
            {projectName}
          </span>
          <span className="text-small text-tw-ink-2">
            {sourceImageData ? `${sourceImageData.width} × ${sourceImageData.height} px` : 'No photo'}
            {cropped ? ', cropped' : ''}
            {fixed ? ', fixed' : ''}
          </span>
          <span className={`text-small ${focused ? 'text-tw-accent-text' : 'text-tw-ink-3'}`}>
            {focused ? `Focus area painted (${focusStrength})` : 'No focus area'}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button icon={<Crop className="w-3.5 h-3.5" aria-hidden="true" />} onClick={onEditPhoto}>
          Edit photo
        </Button>
        <Button variant="ghost" icon={<Upload className="w-3.5 h-3.5" aria-hidden="true" />} onClick={onLoadPhoto}>
          Replace
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          aria-pressed={fixed}
          title={
            fixed
              ? 'Photo fixed. Click for the original.'
              : 'For dark, dull or blurry phone photos: balances the colours, evens out the lighting, cleans up noise and sharpens.'
          }
          className={fixed ? 'border-tw-accent text-tw-accent-text' : ''}
          icon={<Wand2 className="w-3.5 h-3.5" aria-hidden="true" />}
          onClick={() => onFixPhoto(!fixed)}
        >
          {fixed ? 'Fixed' : 'Fix photo'}
        </Button>
        <Button
          title="Change a colour in the picture, for example an orange that should be light brown"
          className={recolors > 0 ? 'border-tw-accent text-tw-accent-text' : ''}
          icon={<Palette className="w-3.5 h-3.5" aria-hidden="true" />}
          onClick={onRecolor}
        >
          Recolour
        </Button>
      </div>
      <span className="text-micro text-tw-ink-3">
        {fixed ? 'Fixed: brighter, cleaner and sharper. Click Fixed for the original. ' : 'Fix photo: for dark, dull or blurry phone photos. '}
        {recolors > 0 ? `${recolors} colour${recolors === 1 ? '' : 's'} changed.` : 'Recolour: change a colour, such as orange to light brown.'}
      </span>
    </Section>
  );
};
