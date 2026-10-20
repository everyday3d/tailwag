import React from 'react';
import { Crop, Upload } from 'lucide-react';
import { useTailWagStore } from '../../store/useTailWagStore';
import { isDefaultEdit, maskHasFocus } from '../../engine/photoEdit';
import { Button, Section } from '../ui';

interface Props {
  sourceDataUrl: string;
  onEditPhoto: () => void;
  onLoadPhoto: () => void;
}

/** The photo being printed, with how it was cropped and whether a focus area is painted (#46). */
export const PhotoPanel: React.FC<Props> = ({ sourceDataUrl, onEditPhoto, onLoadPhoto }) => {
  const { projectName, sourceImageData, photoEdit, focusMask, focusStrength } = useTailWagStore();
  const cropped = !isDefaultEdit(photoEdit);
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
    </Section>
  );
};
