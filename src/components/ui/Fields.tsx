import React, { useId } from 'react';
import { FOCUS_RING } from './Button';

interface SliderRowProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  /** The formatted current value shown on the right ("35%", "1.08", "0.48 mm"). */
  valueText: string;
  hint?: string;
}

/** A labelled slider with its value; the whole row is one label so clicking the text focuses it. */
export const SliderRow: React.FC<SliderRowProps> = ({ label, valueText, hint, className = '', ...input }) => {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="flex justify-between gap-2 text-small text-tw-ink">
        <span>{label}</span>
        <span className="font-mono text-tw-ink-2">{valueText}</span>
      </label>
      <input id={id} type="range" className={`w-full accent-tw-accent ${FOCUS_RING}`} {...input} />
      {hint && <span className="text-micro text-tw-ink-3">{hint}</span>}
    </div>
  );
};

interface NumberFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  unit?: string;
}

/** A labelled number input; numbers use the mono face so digits line up. */
export const NumberField: React.FC<NumberFieldProps> = ({ label, unit, className = '', ...input }) => {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-small text-tw-ink-2">
        {label}
        {unit && <span className="text-tw-ink-3"> ({unit})</span>}
      </label>
      <input
        id={id}
        type="number"
        className={`h-8 w-full px-2.5 rounded-control bg-tw-ground border border-tw-line text-tw-ink font-mono text-body ${FOCUS_RING}`}
        {...input}
      />
    </div>
  );
};

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
const TONE: Record<Tone, string> = {
  neutral: 'bg-tw-raised text-tw-ink-2 border-tw-line',
  accent: 'bg-tw-accent/15 text-tw-accent-text border-tw-accent/30',
  ok: 'bg-tw-ok/15 text-tw-ok border-tw-ok/30',
  warn: 'bg-tw-warn/15 text-tw-warn border-tw-warn/30',
  danger: 'bg-tw-danger/15 text-tw-danger border-tw-danger/30',
};

/** A small status label ("Measured", "In stock", "Experimental"). */
export const Badge: React.FC<{ tone?: Tone; className?: string; title?: string; children: React.ReactNode }> = ({
  tone = 'neutral',
  className = '',
  title,
  children,
}) => (
  <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-px rounded-md border text-micro font-medium whitespace-nowrap ${TONE[tone]} ${className}`}>
    {children}
  </span>
);
