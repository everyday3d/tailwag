import React, { useEffect, useState } from 'react';
import { RefreshCw, Download, ExternalLink, CheckCircle2, AlertTriangle, Dog, Bug, Check } from 'lucide-react';
import { Button, CheckboxRow, Dialog, DialogSection, FOCUS_RING } from './ui';
import { APP_VERSION } from '../appVersion';
import { useTailWagStore } from '../store/useTailWagStore';
import { buildDebugInfo, getLastError, type SystemInfo } from '../engine/debugInfo';
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
  /** Hash of the print plan the preview shows, for the debug info. */
  planHash?: string;
}

function openUrl(url: string) {
  const bridge = (window as any).tailwagDesktop;
  if (bridge?.openExternal) void bridge.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

export const UpdateModal: React.FC<Props> = ({ isOpen, onClose, result, onResult, planHash }) => {
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(autoCheckEnabled());
  const { matchMode, solverColorMode, manualRelief, slots, totalLayers, baseLayerMm, layerHeightMm } = useTailWagStore();
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const bridge = (window as any).tailwagDesktop;
    if (isOpen && bridge?.systemInfo) bridge.systemInfo().then(setSystem).catch(() => setSystem(null));
  }, [isOpen]);

  const debugText = buildDebugInfo({
    appVersion: APP_VERSION,
    system,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    matchMode,
    solverColorMode,
    manualRelief,
    colourCount: slots.length,
    totalLayers,
    baseLayerMm,
    layerHeightMm,
    planHash,
    lastError: getLastError(),
  });

  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(debugText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowDebug(true);
    }
  };

  if (!isOpen) return null;

  const run = async () => {
    setBusy(true);
    const r = await checkForUpdate(APP_VERSION);
    markChecked();
    onResult(r);
    setBusy(false);
  };

  return (
    <Dialog open={isOpen} onClose={onClose} size="md" icon={<Dog className="w-5 h-5" />} title="TailWag Studio" subtitle={`Version ${APP_VERSION}, part of the BoxerDawg 3D ecosystem`}>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <Button icon={<RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />} onClick={run} disabled={busy}>
            {busy ? 'Checking…' : 'Check for updates'}
          </Button>
          <button type="button" onClick={() => openUrl(RELEASES_PAGE_URL)} className={`flex items-center gap-1 text-small text-tw-ink-2 hover:text-tw-ink underline rounded ${FOCUS_RING}`}>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Release page
          </button>
        </div>

        <div role="status">
          {result?.kind === 'update' && (
            <div className="flex flex-col gap-2 p-3 rounded-control border border-tw-ok/30 bg-tw-ok/10">
              <span className="flex items-center gap-1.5 text-body font-semibold text-tw-ok">
                <Download className="w-4 h-4" aria-hidden="true" /> Version {result.info.version} is available
              </span>
              <span className="text-small text-tw-ink-2">You have {result.current}.</span>
              {result.info.notes && (
                <pre className="m-0 text-small text-tw-ink-2 whitespace-pre-wrap max-h-40 overflow-y-auto font-sans">
                  {result.info.notes.length > 1200 ? result.info.notes.slice(0, 1200) + '…' : result.info.notes}
                </pre>
              )}
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => openUrl(result.info.downloadUrl ?? result.info.pageUrl)}>
                  {result.info.downloadUrl ? 'Download installer' : 'Open release page'}
                </Button>
                {result.info.downloadUrl && (
                  <Button variant="ghost" onClick={() => openUrl(result.info.pageUrl)}>
                    Release notes
                  </Button>
                )}
              </div>
              <span className="text-micro text-tw-ink-3">
                Close TailWag before running the installer. Your library and calibrations are kept. On macOS, right-click the app and choose Open the first time.
              </span>
            </div>
          )}
          {result?.kind === 'up-to-date' && (
            <span className="flex items-center gap-1.5 text-small text-tw-ok">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> You have the latest version ({result.latest}).
            </span>
          )}
          {result?.kind === 'ahead' && (
            <span className="flex items-center gap-1.5 text-small text-tw-ink-2">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> This build ({result.current}) is newer than the latest release ({result.latest}).
            </span>
          )}
          {result?.kind === 'unavailable' && (
            <span className="flex items-start gap-1.5 text-small text-tw-warn">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {result.reason}
            </span>
          )}
        </div>

        <CheckboxRow
          label="Check for updates when TailWag starts"
          description="At most once a day. Only the public release information is requested."
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            setAutoCheck(e.target.checked);
          }}
        />
      </div>

      <DialogSection title="Report a bug">
        <div className="flex items-center gap-3">
          <Button icon={copied ? <Check className="w-4 h-4 text-tw-ok" aria-hidden="true" /> : <Bug className="w-4 h-4" aria-hidden="true" />} onClick={copyDebug}>
            {copied ? 'Copied' : 'Copy debug info'}
          </Button>
          <button type="button" aria-expanded={showDebug} onClick={() => setShowDebug((v) => !v)} className={`text-small text-tw-ink-2 hover:text-tw-ink underline rounded ${FOCUS_RING}`}>
            {showDebug ? 'Hide' : 'Show what is copied'}
          </button>
        </div>
        <p className="m-0 text-micro text-tw-ink-3">Paste it into a bug report. It has no photo, file paths, usernames, access codes or passwords.</p>
        {showDebug && (
          <pre className="m-0 p-2.5 rounded-control bg-tw-ground border border-tw-line font-mono text-micro text-tw-ink-2 whitespace-pre-wrap select-all">{debugText}</pre>
        )}
      </DialogSection>
    </Dialog>
  );
};
