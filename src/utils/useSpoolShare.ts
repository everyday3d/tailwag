import { useCallback, useEffect, useRef, useState } from 'react';
import { useTailWagStore } from '../store/useTailWagStore';
import { adoptMatches, parseSharedFile, serializeSharedFile, syncSpools } from './spoolShare';
import { loadShareEnabled, loadShareSnapshot, saveShareEnabled, saveShareSnapshot, twAdapter } from './twShare';

interface ShareBridge {
  shareRead: () => Promise<{ path: string; text: string | null }>;
  shareWrite: (text: string) => Promise<boolean>;
  onShareChanged: (callback: () => void) => () => void;
}

const bridge = (window as unknown as { tailwagDesktop?: Partial<ShareBridge> }).tailwagDesktop;
const share: ShareBridge | null = bridge?.shareRead && bridge.shareWrite && bridge.onShareChanged ? (bridge as ShareBridge) : null;

export interface SpoolShareState {
  /** False on the web, where there is no shared file. */
  available: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  lastSync?: number;
  shared?: number;
  error?: string;
}

const EDIT_DELAY_MS = 400;

/** Keeps My Filaments in step with Paws and Pennies through a shared file, once turned on. */
export function useSpoolShare(): SpoolShareState {
  const catalog = useTailWagStore((s) => s.catalog);
  const applySharedSpools = useTailWagStore((s) => s.applySharedSpools);
  const [enabled, setEnabledState] = useState(loadShareEnabled);
  const [status, setStatus] = useState<{ lastSync?: number; shared?: number; error?: string }>({});
  const latest = useRef(catalog);
  latest.current = catalog;
  const running = useRef(false);
  const again = useRef(false);

  const sync = useCallback(async () => {
    if (!share || !enabled) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const start = latest.current;
        const { path, text } = await share.shareRead();
        if (latest.current !== start) {
          again.current = true;
          continue;
        }
        const owned = start.filter((s) => s.owned);
        const snapshot = loadShareSnapshot();
        const now = Date.now();
        // Joining a list Paws and Pennies already filled: pair our spools with its entries for the same spool.
        const joined = adoptMatches(parseSharedFile(text), owned, snapshot, twAdapter, now);
        const result = syncSpools(joined.file, owned, snapshot, twAdapter, now);
        if ((result.fileChanged || joined.adopted > 0) && !(await share.shareWrite(serializeSharedFile(result.file))))
          throw new Error(`Couldn't write ${path}`);
        if (latest.current === start) {
          saveShareSnapshot(result.snapshot);
          if (result.localChanged) applySharedSpools(result.local);
        } else again.current = true;
        setStatus({ lastSync: Date.now(), shared: [...result.file.values()].filter((r) => !r.deleted).length });
      } while (again.current);
    } catch (e) {
      setStatus((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      running.current = false;
    }
  }, [enabled, applySharedSpools]);

  useEffect(() => {
    if (!share || !enabled) return;
    void sync();
    return share.onShareChanged(() => void sync());
  }, [enabled, sync]);

  useEffect(() => {
    if (!share || !enabled) return;
    const t = setTimeout(() => void sync(), EDIT_DELAY_MS);
    return () => clearTimeout(t);
  }, [catalog, enabled, sync]);

  return {
    available: !!share,
    enabled,
    setEnabled: (on) => {
      saveShareEnabled(on);
      setEnabledState(on);
    },
    ...(enabled ? status : {}),
  };
}
