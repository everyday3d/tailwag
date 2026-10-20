import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  // The accent is reserved for the main action on a screen (Export, Pick filaments, Apply).
  primary: 'bg-tw-accent text-tw-accent-ink font-semibold hover:brightness-110 border border-transparent',
  secondary: 'bg-tw-raised text-tw-ink font-medium border border-tw-line-strong hover:bg-tw-hover',
  ghost: 'bg-transparent text-tw-ink-2 border border-tw-line hover:text-tw-ink hover:bg-tw-raised',
  danger: 'bg-transparent text-tw-danger border border-tw-danger/40 hover:bg-tw-danger/10',
};

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-small gap-1.5',
  md: 'h-8 px-3 text-body gap-1.5',
  lg: 'h-10 px-4 text-body gap-2',
};

export const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tw-accent';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Icon shown before the label (a lucide icon element). */
  icon?: React.ReactNode;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, block, className = '', type = 'button', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-control transition disabled:opacity-40 disabled:pointer-events-none ${FOCUS_RING} ${VARIANT[variant]} ${SIZE[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: what the button does, read by screen readers and shown on hover. */
  label: string;
  icon: React.ReactNode;
  variant?: Exclude<Variant, 'primary'>;
  size?: 'sm' | 'md';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className = '', type = 'button', title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex items-center justify-center shrink-0 rounded-control transition disabled:opacity-40 disabled:pointer-events-none ${FOCUS_RING} ${VARIANT[variant]} ${size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'} ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
});
