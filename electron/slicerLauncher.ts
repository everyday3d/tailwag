// Finds installed slicers and opens an exported .3mf in one of them (issue #50).
// Kept free of Electron imports so detection and launch can be tested with fakes.
import * as path from 'path';
import type { ChildProcess, SpawnOptions } from 'child_process';

export type SlicerId = 'bambu' | 'orca';

export interface SlicerDef {
  id: SlicerId;
  name: string;
  /** Executable file name inside the install folder. */
  exeName: string;
  /** Install folder names under Program Files / Local AppData. */
  folderNames: string[];
  /** Uninstall-registry DisplayName must contain this (case-insensitive). */
  displayNameMatch: string;
  installUrl: string;
}

export const SLICERS: SlicerDef[] = [
  {
    id: 'bambu',
    name: 'Bambu Studio',
    exeName: 'bambu-studio.exe',
    folderNames: ['Bambu Studio', 'BambuStudio'],
    displayNameMatch: 'bambu studio',
    installUrl: 'https://bambulab.com/en/download/studio',
  },
  {
    id: 'orca',
    name: 'OrcaSlicer',
    exeName: 'orca-slicer.exe',
    folderNames: ['OrcaSlicer', 'Orca Slicer'],
    displayNameMatch: 'orcaslicer',
    installUrl: 'https://github.com/SoftFever/OrcaSlicer/releases',
  },
];

export function isSlicerId(value: unknown): value is SlicerId {
  return SLICERS.some((s) => s.id === value);
}

export interface DetectedSlicer {
  id: SlicerId;
  name: string;
  exePath: string;
  source: 'custom' | 'registry' | 'folder';
}

/** One entry from the Windows uninstall registry. */
export interface UninstallEntry {
  displayName: string;
  displayIcon?: string;
  installLocation?: string;
  uninstallString?: string;
}

export interface DetectDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fileExists: (p: string) => boolean;
  readUninstallEntries: () => Promise<UninstallEntry[]>;
  /** Paths the user picked by hand; they win over anything detected. */
  customPaths: Partial<Record<SlicerId, string>>;
}

const stripQuotes = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');

/** Candidate exe paths from one registry entry, most specific first. */
function exeCandidatesFromEntry(entry: UninstallEntry, def: SlicerDef): string[] {
  const out: string[] = [];
  if (entry.displayIcon) {
    // DisplayIcon may carry an icon index: "C:\...\bambu-studio.exe,0"
    const icon = stripQuotes(entry.displayIcon.replace(/,\s*-?\d+$/, ''));
    if (path.win32.basename(icon).toLowerCase() === def.exeName) out.push(icon);
  }
  if (entry.installLocation) out.push(path.win32.join(stripQuotes(entry.installLocation), def.exeName));
  if (entry.uninstallString) {
    const exe = stripQuotes(entry.uninstallString.split(/\s+\/|\s+-/)[0]);
    out.push(path.win32.join(path.win32.dirname(exe), def.exeName));
  }
  return out;
}

function windowsFolderCandidates(def: SlicerDef, env: DetectDeps['env']): string[] {
  const roots = [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs')];
  const out: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    for (const folder of def.folderNames) out.push(path.win32.join(root, folder, def.exeName));
  }
  return out;
}

/**
 * Lists the slicers that can be launched. Only Windows is detected for now;
 * other platforms return only custom paths so the macOS build (#48) can add its own lookup here.
 */
export async function detectSlicers(deps: DetectDeps): Promise<DetectedSlicer[]> {
  let entries: UninstallEntry[] | null = null;
  const found: DetectedSlicer[] = [];
  for (const def of SLICERS) {
    const custom = deps.customPaths[def.id];
    if (custom && deps.fileExists(custom)) {
      found.push({ id: def.id, name: def.name, exePath: custom, source: 'custom' });
      continue;
    }
    if (deps.platform !== 'win32') continue;

    if (entries === null) {
      try {
        entries = await deps.readUninstallEntries();
      } catch {
        entries = [];
      }
    }
    const fromRegistry = entries
      .filter((e) => e.displayName.toLowerCase().includes(def.displayNameMatch))
      .flatMap((e) => exeCandidatesFromEntry(e, def))
      .find((p) => deps.fileExists(p));
    if (fromRegistry) {
      found.push({ id: def.id, name: def.name, exePath: fromRegistry, source: 'registry' });
      continue;
    }
    const fromFolder = windowsFolderCandidates(def, deps.env).find((p) => deps.fileExists(p));
    if (fromFolder) found.push({ id: def.id, name: def.name, exePath: fromFolder, source: 'folder' });
  }
  return found;
}

/** Parses `reg query <key> /s` output into uninstall entries. */
export function parseRegQueryOutput(output: string): UninstallEntry[] {
  const entries: UninstallEntry[] = [];
  let current: Record<string, string> | null = null;
  const flush = () => {
    if (current?.DisplayName) {
      entries.push({
        displayName: current.DisplayName,
        displayIcon: current.DisplayIcon,
        installLocation: current.InstallLocation,
        uninstallString: current.UninstallString,
      });
    }
  };
  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      flush();
      current = {};
      continue;
    }
    const m = /^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (m && current) current[m[1]] = m[2].trim();
  }
  flush();
  return entries;
}

export const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

// Variables that belong to TailWag's own runtime (Electron, Node, the tool that started it)
// or that change how TLS works. The slicer must not inherit them: an SSLKEYLOGFILE set by
// antivirus or developer tools broke Bambu Studio's cloud connection (#51).
const DROPPED_ENV_NAMES = new Set(['SSLKEYLOGFILE', 'NODEFAULTCURRENTDIRECTORYINEXEPATH', 'CLAUDECODE', 'VITE_DEV_SERVER_URL']);
const DROPPED_ENV_PREFIXES = ['NODE_', 'NPM_', 'ELECTRON_', 'CHROME_', 'CLAUDE_', 'VSCODE_'];

/** The environment to start the slicer with: TailWag's, minus its runtime-only variables. */
export function slicerEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (DROPPED_ENV_NAMES.has(upper) || DROPPED_ENV_PREFIXES.some((p) => upper.startsWith(p))) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Starts the slicer with the .3mf as its only argument, from its own install folder and
 * with a cleaned environment, the way Explorer starts it. No shell is involved,
 * so nothing in the file name can be run as a command.
 */
export function launchSlicer(
  spawnFn: SpawnFn,
  exePath: string,
  filePath: string,
  env: Record<string, string | undefined> = process.env
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(exePath, [filePath], {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: path.dirname(exePath),
        env: slicerEnv(env),
      });
    } catch (err: any) {
      resolve({ ok: false, error: err?.message || 'The slicer could not be started.' });
      return;
    }
    child.once('error', (err) => resolve({ ok: false, error: err?.message || 'The slicer could not be started.' }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

/** Keeps the export file name to one plain .3mf name inside the export folder. */
export function safeExportFileName(name: unknown): string {
  const base = path.win32.basename(path.posix.basename(typeof name === 'string' ? name : ''));
  const cleaned = base.replace(/\.3mf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
  return `${cleaned || 'TailWag_export'}.3mf`;
}

export const EXPORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
