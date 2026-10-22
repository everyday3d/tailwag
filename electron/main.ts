import { app, BrowserWindow, ipcMain, dialog, shell, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, spawn } from 'child_process';
import {
  SLICERS,
  UNINSTALL_KEYS,
  EXPORT_MAX_AGE_MS,
  detectSlicers,
  isSlicerId,
  launchSlicer,
  parseRegQueryOutput,
  safeExportFileName,
  type SlicerId,
  type UninstallEntry,
} from './slicerLauncher';
import { SUBJECT_INPUT_SIZE, findSubject, subjectModelAvailable } from './subjectCutout';

const logFile = path.join(os.tmpdir(), 'tailwag-startup.log');
function logMsg(msg: string) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

process.on('uncaughtException', (err) => {
  logMsg(`UNCAUGHT: ${err?.stack || err}`);
});

logMsg(`Starting TailWag main.ts. isPackaged=${app?.isPackaged} __dirname=${__dirname}`);

let mainWindow: BrowserWindow | null = null;

// ---- Send to slicer (#50) ----
interface SlicerPrefs {
  customPaths: Partial<Record<SlicerId, string>>;
  last?: SlicerId;
}
const slicerPrefsFile = () => path.join(app.getPath('userData'), 'slicer-prefs.json');
function readSlicerPrefs(): SlicerPrefs {
  try {
    const raw = JSON.parse(fs.readFileSync(slicerPrefsFile(), 'utf8'));
    const customPaths: SlicerPrefs['customPaths'] = {};
    for (const s of SLICERS) if (typeof raw?.customPaths?.[s.id] === 'string') customPaths[s.id] = raw.customPaths[s.id];
    return { customPaths, last: isSlicerId(raw?.last) ? raw.last : undefined };
  } catch {
    return { customPaths: {} };
  }
}
function writeSlicerPrefs(prefs: SlicerPrefs) {
  try {
    fs.writeFileSync(slicerPrefsFile(), JSON.stringify(prefs, null, 2));
  } catch (e) {
    logMsg(`slicer prefs write failed: ${e}`);
  }
}
function readUninstallEntries(): Promise<UninstallEntry[]> {
  const queryKey = (key: string) =>
    new Promise<UninstallEntry[]>((resolve) => {
      execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) =>
        resolve(err ? [] : parseRegQueryOutput(stdout))
      );
    });
  return Promise.all(UNINSTALL_KEYS.map(queryKey)).then((lists) => lists.flat());
}
function findSlicers() {
  return detectSlicers({
    platform: process.platform,
    env: process.env,
    fileExists: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    readUninstallEntries,
    customPaths: readSlicerPrefs().customPaths,
  });
}
const exportDir = () => path.join(os.tmpdir(), 'TailWag Exports');
async function cleanOldExports(dir: string) {
  try {
    const now = Date.now();
    for (const name of await fs.promises.readdir(dir)) {
      if (!name.toLowerCase().endsWith('.3mf')) continue;
      const file = path.join(dir, name);
      const stat = await fs.promises.stat(file);
      if (stat.isFile() && now - stat.mtimeMs > EXPORT_MAX_AGE_MS) await fs.promises.unlink(file);
    }
  } catch {}
}

function createWindow() {
  const iconPath = fs.existsSync(path.join(__dirname, '../dist/icon.png'))
    ? path.join(__dirname, '../dist/icon.png')
    : path.join(__dirname, '../public/icon.png');
  logMsg(`createWindow() called. iconPath=${iconPath} exists=${fs.existsSync(iconPath)}`);

  // Fit the screen: at 150% scaling a 1080p display is only 1280 x 720 for apps, smaller than
  // the preferred size, so the window would hang off both edges. Small screens open maximized.
  const work = screen.getPrimaryDisplay().workAreaSize;
  const PREFERRED = { width: 1640, height: 980 };
  const fitsPreferred = work.width >= PREFERRED.width && work.height >= PREFERRED.height;
  mainWindow = new BrowserWindow({
    width: Math.min(PREFERRED.width, work.width),
    height: Math.min(PREFERRED.height, work.height),
    minWidth: Math.min(1100, work.width),
    minHeight: Math.min(640, work.height),
    show: false,
    title: 'TailWag Studio — 3D Filament Painting & TD Lithophane Engine',
    icon: iconPath,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  logMsg('BrowserWindow constructed.');

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5188';
  const distIndex = path.join(__dirname, '../dist/index.html');
  logMsg(`Checking distIndex=${distIndex} exists=${fs.existsSync(distIndex)}`);
  if (!app.isPackaged && process.argv.includes('--dev')) {
    mainWindow.loadURL(devUrl);
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex).then(() => logMsg('loadFile resolved')).catch((e) => logMsg(`loadFile error: ${e}`));
  } else {
    mainWindow.loadURL(devUrl);
  }

  mainWindow.once('ready-to-show', () => {
    logMsg('ready-to-show fired');
    if (!mainWindow) return;
    if (!fitsPreferred) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(false);
      }
    }, 1200);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logMsg(`render-process-gone: ${JSON.stringify(details)}`);
  });

  mainWindow.on('closed', () => {
    logMsg('window closed');
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('tailwag:save-file', async (_event, options: { defaultPath: string; filters: { name: string; extensions: string[] }[]; dataBase64: string }) => {
    if (!mainWindow) return { canceled: true };
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const buffer = Buffer.from(options.dataBase64, 'base64');
    await fs.promises.writeFile(result.filePath, buffer);

    // The saved file is written exactly as verified; it is not re-exported by any external tool.

    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('tailwag:fetch-ha-ams', async (_event, config: { haUrl: string; haToken: string }) => {
    try {
      const url = `${config.haUrl.replace(/\/+$/, '')}/api/states`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.haToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      const states = await res.json();
      return { ok: true, states };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Failed to connect to Home Assistant' };
    }
  });

  // Update check: read the public "latest release" JSON. Done here so the renderer needs no network access.
  ipcMain.handle('tailwag:check-update', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch('https://api.github.com/repos/everyday3d/tailwag/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `TailWag-Studio/${app.getVersion()}` },
        signal: controller.signal,
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json };
    } catch (err: any) {
      return { ok: false, status: 0, error: err?.name === 'AbortError' ? 'timed out' : err?.message || 'network error' };
    } finally {
      clearTimeout(timer);
    }
  });

  // Lists installed slicers (detected or picked by hand) and the one used last.
  ipcMain.handle('tailwag:list-slicers', async () => {
    const slicers = await findSlicers();
    return {
      slicers: slicers.map(({ id, name, exePath, source }) => ({ id, name, exePath, source })),
      last: readSlicerPrefs().last,
      supported: SLICERS.map(({ id, name, installUrl }) => ({ id, name, installUrl })),
    };
  });

  // The user points at a slicer by hand. The path is chosen in a main-process dialog,
  // so the renderer can never name the program that gets started.
  ipcMain.handle('tailwag:choose-slicer', async (_event, slicerId: unknown) => {
    if (!mainWindow || !isSlicerId(slicerId)) return { canceled: true };
    const def = SLICERS.find((s) => s.id === slicerId)!;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: `Locate ${def.name}`,
      filters: process.platform === 'win32' ? [{ name: def.name, extensions: ['exe'] }] : [],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const prefs = readSlicerPrefs();
    prefs.customPaths[slicerId] = res.filePaths[0];
    writeSlicerPrefs(prefs);
    return { canceled: false, exePath: res.filePaths[0] };
  });

  // Writes the already-verified .3mf to the export folder and opens it in the chosen slicer
  // (slicerId null: write only, for the "Show in folder" fallback).
  // The bytes are written as they are; nothing here changes or re-exports the file.
  ipcMain.handle('tailwag:send-to-slicer', async (_event, options: { slicerId: unknown; fileName: unknown; dataBase64: unknown }) => {
    if (typeof options?.dataBase64 !== 'string' || (options.slicerId !== null && !isSlicerId(options.slicerId))) {
      return { ok: false, error: 'Invalid request.' };
    }
    const slicer = options.slicerId === null ? null : (await findSlicers()).find((s) => s.id === options.slicerId);
    if (slicer === undefined) return { ok: false, error: 'That slicer was not found on this computer.' };

    const dir = exportDir();
    let filePath: string;
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await cleanOldExports(dir);
      filePath = path.join(dir, safeExportFileName(options.fileName));
      await fs.promises.writeFile(filePath, Buffer.from(options.dataBase64, 'base64'));
    } catch (err: any) {
      return { ok: false, error: `The file could not be written: ${err?.message || err}` };
    }

    if (!slicer) return { ok: true, filePath };

    const prefs = readSlicerPrefs();
    prefs.last = slicer.id;
    writeSlicerPrefs(prefs);

    const launched = await launchSlicer(spawn, slicer.exePath, filePath);
    if (!launched.ok) {
      logMsg(`send-to-slicer launch failed: ${launched.error}`);
      return { ok: false, filePath, error: `${slicer.name} could not be started (${launched.error}). The file was kept.` };
    }
    return { ok: true, filePath, slicerName: slicer.name };
  });

  // Shows an exported file in Explorer/Finder. Only files in the export folder.
  ipcMain.handle('tailwag:show-export-in-folder', async (_event, filePath: unknown) => {
    const dir = exportDir();
    if (typeof filePath === 'string') {
      const resolved = path.resolve(filePath);
      if (path.dirname(resolved) === dir && fs.existsSync(resolved)) {
        shell.showItemInFolder(resolved);
        return { ok: true };
      }
    }
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
    await shell.openPath(dir);
    return { ok: true };
  });

  // Opens release pages in the default browser. Only this project's GitHub pages
  // and the supported slicers' download pages are allowed.
  ipcMain.handle('tailwag:open-external', async (_event, url: string) => {
    const allowed =
      typeof url === 'string' && (url.startsWith('https://github.com/everyday3d/') || SLICERS.some((s) => s.installUrl === url));
    if (!allowed) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('tailwag:app-version', () => app.getVersion());

  // Spools shared with Paws and Pennies (src/utils/spoolShare.ts). Both apps read and write this file.
  const sharedSpoolsFile = path.join(app.getPath('appData'), 'BoxerDawg 3D', 'shared-spools.json');
  ipcMain.handle('tailwag:share-read', () => {
    try {
      return { path: sharedSpoolsFile, text: fs.readFileSync(sharedSpoolsFile, 'utf8') };
    } catch {
      return { path: sharedSpoolsFile, text: null };
    }
  });
  ipcMain.handle('tailwag:share-write', (_event, text: unknown) => {
    if (typeof text !== 'string' || text.length > 5_000_000) return false;
    try {
      fs.mkdirSync(path.dirname(sharedSpoolsFile), { recursive: true });
      // Write beside it and swap in, so the other app never reads half a file.
      const tmp = `${sharedSpoolsFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, sharedSpoolsFile);
      return true;
    } catch (e) {
      logMsg(`shared spools write failed: ${e}`);
      return false;
    }
  });
  // watchFile polls, which also works before the file exists and across apps on Windows.
  fs.watchFile(sharedSpoolsFile, { interval: 1500 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs) mainWindow?.webContents.send('tailwag:share-changed');
  });

  // Subject cutout: is the model installed, and run it on a 1024 x 1024 RGBA picture.
  ipcMain.handle('tailwag:subject-available', () => subjectModelAvailable());
  ipcMain.handle('tailwag:find-subject', async (_event, rgba: unknown) => {
    if (!(rgba instanceof Uint8Array) || rgba.length !== SUBJECT_INPUT_SIZE * SUBJECT_INPUT_SIZE * 4) {
      return { ok: false, error: 'Invalid picture.' };
    }
    if (!subjectModelAvailable()) return { ok: false, error: 'The subject model is not installed with this copy of TailWag.' };
    try {
      const started = Date.now();
      const mask = await findSubject(rgba);
      logMsg(`find-subject done in ${Date.now() - started} ms`);
      return { ok: true, mask, size: SUBJECT_INPUT_SIZE };
    } catch (err: any) {
      logMsg(`find-subject failed: ${err?.stack || err}`);
      return { ok: false, error: err?.message || 'The subject could not be found.' };
    }
  });

  // For "Copy debug info" (#49): OS and runtime only. No hostname, username or paths.
  ipcMain.handle('tailwag:system-info', () => ({
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    electron: process.versions.electron,
  }));

  // Opens a TailWag project: a file dialog, or a known path (only .tailwag files are read).
  ipcMain.handle('tailwag:open-project', async (_event, knownPath?: string) => {
    try {
      let target = typeof knownPath === 'string' && knownPath ? knownPath : undefined;
      if (target) {
        if (!target.toLowerCase().endsWith('.tailwag')) return { canceled: false, error: 'That is not a TailWag project file.' };
      } else {
        if (!mainWindow) return { canceled: true };
        const res = await dialog.showOpenDialog(mainWindow, {
          filters: [{ name: 'TailWag project', extensions: ['tailwag'] }],
          properties: ['openFile'],
        });
        if (res.canceled || !res.filePaths[0]) return { canceled: true };
        target = res.filePaths[0];
      }
      const stat = await fs.promises.stat(target);
      if (stat.size > 60 * 1024 * 1024) return { canceled: false, error: 'That file is too large to be a TailWag project.' };
      const text = await fs.promises.readFile(target, 'utf8');
      return { canceled: false, filePath: target, text };
    } catch (err: any) {
      return { canceled: false, error: err?.code === 'ENOENT' ? 'The project file was moved or deleted.' : err?.message || 'The file could not be read.' };
    }
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
