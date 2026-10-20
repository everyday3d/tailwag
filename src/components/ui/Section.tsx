import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FOCUS_RING } from './Button';

interface Props {
  title: string;
  /** Extra controls on the right of the heading (an Import link, a Reset button). */
  actions?: React.ReactNode;
  /** Short context next to the title ("4 filaments, 24 layers"). */
  meta?: React.ReactNode;
  /** When set, the heading opens and closes the section. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** 'panel' for side columns, 'title' for larger centre sections. */
  tone?: 'panel' | 'title';
  className?: string;
  children: React.ReactNode;
}

/** A titled block inside a panel. Headings are sentence case; never all caps. */
export const Section: React.FC<Props> = ({ title, actions, meta, collapsible, defaultOpen = true, tone = 'panel', className = '', children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const heading = (
    <h2 className={`m-0 text-tw-ink ${tone === 'title' ? 'text-title' : 'text-body font-semibold'}`}>{title}</h2>
  );
  return (
    <section className={`flex flex-col gap-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
            className={`flex flex-1 items-center justify-between gap-2 text-left rounded ${FOCUS_RING}`}
          >
            <span className="flex items-baseline gap-2.5">
              {heading}
              {meta && <span className="text-small text-tw-ink-2">{meta}</span>}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-tw-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        ) : (
          <div className="flex items-baseline gap-2.5 min-w-0">
            {heading}
            {meta && <span className="text-small text-tw-ink-2 truncate">{meta}</span>}
          </div>
        )}
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </div>
      {(!collapsible || open) && (
        <div id={bodyId} className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </section>
  );
};
