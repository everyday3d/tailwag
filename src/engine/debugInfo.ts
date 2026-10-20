/**
 * "Copy debug info" for bug reports (#49).
 * Only fixed fields are reported. The one free-text field (the last error) is scrubbed,
 * so the text never carries the photo, file paths, usernames, access codes or passwords.
 */

export interface SystemInfo {
  platform: string;
  /** os.release(), e.g. "10.0.26200" */
  release: string;
  arch: string;
  electron?: string;
}

export interface DebugInfoInput {
  appVersion: string;
  system?: SystemInfo | null;
  /** Used when there is no desktop bridge (browser build). */
  userAgent?: string;
  matchMode: string;
  solverColorMode: string;
  manualRelief: string;
  colourCount: number;
  totalLayers: number;
  baseLayerMm: number;
  layerHeightMm: number;
  planHash?: string;
  lastError?: LastError | null;
}

export interface LastError {
  source: string;
  message: string;
  at: Date;
}

const MAX_ERROR_LENGTH = 300;

/** Removes anything personal or secret from free text. Over-redacting is fine; leaking is not. */
export function scrubText(text: string): string {
  return (
    text
      // file:// URLs
      .replace(/file:\/\/[^\s"'`<>()]*/gi, '<path>')
      // Windows drive paths (may contain spaces) and UNC paths
      .replace(/[A-Za-z]:[\\/][^"'`<>|()\r\n]*/g, '<path>')
      .replace(/\\\\[^"'`<>|()\r\n]+/g, '<path>')
      // macOS / Linux paths that can hold a username or project name
      .replace(/(?:~|\/(?:Users|home|root|private|var|tmp|Volumes|opt|Applications|mnt|media))\/[^"'`<>|()\r\n]*/g, '<path>')
      // e-mail addresses (and user@host)
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g, '<redacted>')
      // secrets introduced by a keyword
      .replace(/\b(access[ _-]?code|password|passwd|pwd|token|secret|api[ _-]?key|authorization|bearer)\b\s*[:=]?\s*\S+/gi, '$1 <redacted>')
      // long token-like strings
      .replace(/\b[A-Za-z0-9_\-]{24,}\b/g, '<redacted>')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

let lastError: LastError | null = null;

/** Remembers the most recent error shown to the user, already scrubbed. */
export function recordError(source: string, message: unknown, at: Date = new Date()) {
  const raw = message instanceof Error ? message.message : String(message ?? '');
  const clean = scrubText(raw);
  if (!clean) return;
  lastError = {
    source: scrubText(source),
    message: clean.length > MAX_ERROR_LENGTH ? clean.slice(0, MAX_ERROR_LENGTH) + '...' : clean,
    at,
  };
}

export function getLastError(): LastError | null {
  return lastError;
}

/** Test helper. */
export function clearLastError() {
  lastError = null;
}

/** "Windows 11 (build 26200), x64" from os.release(); other platforms by name. */
export function describeSystem(sys: SystemInfo | null | undefined, userAgent?: string): string {
  if (!sys) return userAgent ? `Browser: ${scrubText(userAgent).slice(0, 160)}` : 'unknown';
  const release = scrubText(sys.release);
  const arch = scrubText(sys.arch);
  let name: string;
  if (sys.platform === 'win32') {
    const build = Number(release.split('.')[2]);
    name = Number.isFinite(build) ? `Windows ${build >= 22000 ? '11' : '10'} (build ${build})` : `Windows ${release}`;
  } else if (sys.platform === 'darwin') {
    name = `macOS (Darwin ${release})`;
  } else {
    name = `${scrubText(sys.platform)} ${release}`;
  }
  return `${name}, ${arch}${sys.electron ? `, Electron ${scrubText(sys.electron)}` : ''}`;
}

export function buildDebugInfo(input: DebugInfoInput): string {
  const err = input.lastError;
  const lines = [
    'TailWag Studio debug info',
    `Version: ${scrubText(input.appVersion)}`,
    `System: ${describeSystem(input.system, input.userAgent)}`,
    `Match mode: ${input.matchMode}`,
    `Colour mode: ${input.solverColorMode}${input.solverColorMode === 'manual' ? ` (relief: ${input.manualRelief})` : ''}`,
    `Colours: ${input.colourCount}`,
    `Layers: ${input.totalLayers} (first layer ${input.baseLayerMm.toFixed(2)} mm, then ${input.layerHeightMm.toFixed(2)} mm)`,
    `Print plan: ${input.planHash ? `${input.planHash.slice(0, 8).toUpperCase()} (${input.planHash})` : 'none'}`,
    `Last error: ${err ? `[${err.source}] ${err.message} (${err.at.toISOString()})` : 'none'}`,
  ];
  return lines.join('\n');
}
