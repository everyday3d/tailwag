import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One line under the title: what this dialog is about, in plain words. */
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** Sticky bottom row, usually Cancel and the main action. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const WIDTH = { md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' };
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one dialog frame every modal uses: title row with a close button, scrolling body,
 * optional sticky footer. Escape closes; Tab stays inside; focus returns where it was.
 */
export const Dialog: React.FC<Props> = ({ open, onClose, title, subtitle, icon, size = 'lg', footer, children }) => {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${WIDTH[size]} max-h-[92vh] flex flex-col bg-tw-panel border border-tw-line-strong rounded-card shadow-2xl outline-none text-tw-ink`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-tw-line">
          <div className="flex items-start gap-3 min-w-0">
            {icon && <span className="mt-0.5 text-tw-ink-2 shrink-0" aria-hidden="true">{icon}</span>}
            <div className="min-w-0">
              <h2 id={titleId} className="m-0 text-heading text-tw-ink">
                {title}
              </h2>
              {subtitle && <p className="m-0 mt-0.5 text-small text-tw-ink-2">{subtitle}</p>}
            </div>
          </div>
          <IconButton label="Close" variant="ghost" className="border-transparent -mr-2 -mt-1" icon={<X className="w-4 h-4" />} onClick={onClose} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-tw-line">{footer}</div>}
      </div>
    </div>
  );
};

/** A titled group inside a dialog body. */
export const DialogSection: React.FC<{ title: string; meta?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, meta, actions, children }) => (
  <section className="flex flex-col gap-2.5">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2.5 min-w-0">
        <h3 className="m-0 text-body font-semibold text-tw-ink">{title}</h3>
        {meta && <span className="text-small text-tw-ink-2 truncate">{meta}</span>}
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
    {children}
  </section>
);
