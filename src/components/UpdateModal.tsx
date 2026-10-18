import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Download, ExternalLink, CheckCircle2, AlertTriangle, Dog } from 'lucide-react';
import { APP_VERSION } from '../appVersion';
import {
  RELEASES_PAGE_URL,
  autoCheckEnabled,
  checkForUpdate,
  markChecked,
  setAutoCheck,
  type UpdateResult,
} from '../engine/updateCheck';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Latest result known to the app (from the startup check), so the dialog opens with it. */
  result: UpdateResult | null;
  onResult: (r: UpdateResult) => void;
}

function openUrl(url: string) {
  const bridge = (window as any).tailwagDesktop;
  if (bridge?.openExternal) void bridge.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

export const UpdateModal: React.FC<Props> = ({ isOpen, onClose, result, onResult }) => {
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(autoCheckEnabled());

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const run = async () => {
    setBusy(true);
    const r = await checkForUpdate(APP_VERSION);
    markChecked();
    onResult(r);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#10151f] border border-slate-700 rounded-xl w-full max-w-md p-4 flex flex-col gap-3 text-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="About and updates"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white">
              <Dog size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-tight">TailWag Studio</h2>
              <div className="text-[11px] text-slate-400">Version {APP_VERSION} · part of the BoxerDawg 3D ecosystem</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-bold text-white"
          >
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Checking...' : 'Check for updates'}
          </button>
          <button
            onClick={() => openUrl(RELEASES_PAGE_URL)}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 underline"
          >
            <ExternalLink size={11} /> Release page
          </button>
        </div>

        {result?.kind === 'update' && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-300">
              <Download size={14} /> Version {result.info.version} is available
            </div>
            <div className="text-[11px] text-slate-400">You have {result.current}.</div>
            {result.info.notes && (
              <pre className="text-[11px] text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto font-sans">
                {result.info.notes.length > 1200 ? result.info.notes.slice(0, 1200) + '...' : result.info.notes}
              </pre>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => openUrl(result.info.downloadUrl ?? result.info.pageUrl)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white"
              >
                {result.info.downloadUrl ? 'Download installer' : 'Open release page'}
              </button>
              {result.info.downloadUrl && (
                <button
                  onClick={() => openUrl(result.info.pageUrl)}
                  className="px-3 py-1.5 rounded-lg border border-slate-600 text-xs font-semibold"
                >
                  Release notes
                </button>
              )}
            </div>
            <div className="text-[10px] text-slate-500">
              Close TailWag before running the installer. Your library and calibrations are kept. On macOS, right-click and choose Open on first launch.
            </div>
          </div>
        )}
        {result?.kind === 'up-to-date' && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-300">
            <CheckCircle2 size={14} /> You are on the latest version ({result.latest}).
          </div>
        )}
        {result?.kind === 'ahead' && (
          <div className="flex items-center gap-1.5 text-xs text-sky-300">
            <CheckCircle2 size={14} /> This build ({result.current}) is newer than the latest release ({result.latest}).
          </div>
        )}
        {result?.kind === 'unavailable' && (
          <div className="flex items-start gap-1.5 text-xs text-amber-300">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {result.reason}
          </div>
        )}

        <label className="flex items-center gap-2 text-[11px] text-slate-400 border-t border-slate-800 pt-2">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              setAutoCheck(e.target.checked);
            }}
          />
          Check for updates automatically when TailWag starts (once a day). Only the public release info is requested.
        </label>
      </div>
    </div>
  );
};
