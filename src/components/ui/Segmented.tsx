import React from 'react';
import { FOCUS_RING } from './Button';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  /** Hover text, e.g. the full name when the label is short. */
  title?: string;
  disabled?: boolean;
}

interface Props<T extends string | number> {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Names the group for screen readers ("View", "Method"). */
  label: string;
  size?: 'sm' | 'md';
  /** Stretch segments to fill the width (side panels) or size them to their labels (header). */
  fill?: boolean;
  className?: string;
}

/** A row of mutually exclusive choices. The selected one uses the accent. */
export function Segmented<T extends string | number>({ options, value, onChange, label, size = 'md', fill = true, className = '' }: Props<T>) {
  return (
    <div role="group" aria-label={label} className={`flex gap-0.5 p-[3px] rounded-[9px] bg-tw-ground border border-tw-line ${className}`}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={selected}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`${fill ? 'flex-1' : ''} whitespace-nowrap rounded-[7px] font-medium transition disabled:opacity-40 ${FOCUS_RING} ${
              size === 'sm' ? 'px-2 py-1 text-small' : 'px-2.5 py-[5px] text-small'
            } ${selected ? 'bg-tw-accent/15 text-tw-accent-text shadow-[inset_0_0_0_1px_rgb(var(--twg-accent)/0.4)]' : 'text-tw-ink-2 hover:text-tw-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
