/** Where releases are published. The check reads the public "latest release" of this repository. */
export const UPDATE_API_URL = 'https://api.github.com/repos/everyday3d/tailwag/releases/latest';
export const RELEASES_PAGE_URL = 'https://github.com/everyday3d/tailwag/releases/latest';

export interface UpdateInfo {
  version: string;
  name: string;
  notes: string;
  pageUrl: string;
  /** Direct installer link when the release has a Windows asset. */
  downloadUrl?: string;
  publishedAt?: string;
}

export type UpdateResult =
  | { kind: 'up-to-date'; current: string; latest: string }
  | { kind: 'update'; current: string; info: UpdateInfo }
  | { kind: 'ahead'; current: string; latest: string }
  | { kind: 'unavailable'; reason: string };

/** Parses "v1.2.3", "1.2.3-beta.1" and similar. Returns null when no x.y.z is found. */
export function parseVersion(text: string): { core: [number, number, number]; pre: string } | null {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(text.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)], pre: m[4] ?? '' };
}

/** Negative when a < b, 0 when equal, positive when a > b. A pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1;
  if (pb.pre === '') return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

interface ReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

/** Reads a GitHub "latest release" response. Returns null for anything unusable (drafts, no version). */
export function parseRelease(payload: unknown, platform?: string): UpdateInfo | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as ReleasePayload;
  if (p.draft) return null;
  const version = parseVersion(p.tag_name ?? p.name ?? '');
  if (!version) return null;
  const text = `${version.core.join('.')}${version.pre ? '-' + version.pre : ''}`;

  const isDarwin = platform === 'darwin' || (typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent));
  const assets = p.assets ?? [];

  let downloadUrl: string | undefined;
  if (isDarwin) {
    const dmg = assets.find((a) => /\.dmg$/i.test(a.name ?? ''));
    const macZip = assets.find((a) => /mac.*\.zip$/i.test(a.name ?? ''));
    downloadUrl = (dmg ?? macZip)?.browser_download_url;
  }
  if (!downloadUrl) {
    const setup = assets.find((a) => /setup.*\.exe$/i.test(a.name ?? ''));
    const anyExe = assets.find((a) => /\.exe$/i.test(a.name ?? ''));
    downloadUrl = (setup ?? anyExe)?.browser_download_url;
  }

  return {
    version: text,
    name: p.name || `TailWag Studio ${text}`,
    notes: (p.body ?? '').trim(),
    pageUrl: p.html_url ?? RELEASES_PAGE_URL,
    downloadUrl,
    publishedAt: p.published_at,
  };
}

/** Result of one network request, as returned by the desktop bridge or a plain fetch. */
export interface RawResponse {
  ok: boolean;
  status: number;
  json?: unknown;
  error?: string;
}

/** Turns a raw response into a user-facing result. Pure, so it can be tested without a network. */
export function interpretResponse(current: string, res: RawResponse, platform?: string): UpdateResult {
  if (res.status === 404) {
    return { kind: 'unavailable', reason: 'No public release was found yet, so there is nothing newer to offer.' };
  }
  if (!res.ok) {
    return {
      kind: 'unavailable',
      reason: res.error ? `Could not reach the update server (${res.error}).` : `The update server answered with an error (HTTP ${res.status}).`,
    };
  }
  const info = parseRelease(res.json, platform);
  if (!info) return { kind: 'unavailable', reason: 'The latest release did not contain a readable version number.' };
  const cmp = compareVersions(info.version, current);
  if (cmp > 0) return { kind: 'update', current, info };
  if (cmp === 0) return { kind: 'up-to-date', current, latest: info.version };
  return { kind: 'ahead', current, latest: info.version };
}

/** Fetches through the desktop bridge when present (no browser restrictions), otherwise directly. */
export async function checkForUpdate(current: string): Promise<UpdateResult> {
  try {
    const bridge = (globalThis as { tailwagDesktop?: { checkForUpdates?: () => Promise<RawResponse> } }).tailwagDesktop;
    if (bridge?.checkForUpdates) return interpretResponse(current, await bridge.checkForUpdates());
    const res = await fetch(UPDATE_API_URL, { headers: { Accept: 'application/vnd.github+json' } });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    return interpretResponse(current, { ok: res.ok, status: res.status, json });
  } catch (e) {
    return interpretResponse(current, { ok: false, status: 0, error: e instanceof Error ? e.message : 'network error' });
  }
}

export const UPDATE_AUTO_KEY = 'tailwag_update_auto';
export const UPDATE_LAST_KEY = 'tailwag_update_last_check';
const DAY_MS = 24 * 60 * 60 * 1000;

export function autoCheckEnabled(): boolean {
  try {
    return window.localStorage.getItem(UPDATE_AUTO_KEY) !== '0';
  } catch {
    return false;
  }
}

export function setAutoCheck(on: boolean): void {
  try {
    window.localStorage.setItem(UPDATE_AUTO_KEY, on ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

/** True when automatic checks are on and the last check was more than a day ago. */
export function shouldAutoCheckNow(now = Date.now()): boolean {
  if (!autoCheckEnabled()) return false;
  try {
    const last = Number(window.localStorage.getItem(UPDATE_LAST_KEY) ?? 0);
    return !(last > 0 && now - last < DAY_MS);
  } catch {
    return false;
  }
}

export function markChecked(now = Date.now()): void {
  try {
    window.localStorage.setItem(UPDATE_LAST_KEY, String(now));
  } catch {
    // ignore storage errors
  }
}
