import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

function createWindow() {
  const iconPath = fs.existsSync(path.join(__dirname, '../dist/icon.png'))
    ? path.join(__dirname, '../dist/icon.png')
    : path.join(__dirname, '../public/icon.png');
  logMsg(`createWindow() called. iconPath=${iconPath} exists=${fs.existsSync(iconPath)}`);

  mainWindow = new BrowserWindow({
    width: 1640,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
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

    // If saving a .3mf and Bambu Studio is installed locally, run native CLI validation/normalization
    if (result.filePath.toLowerCase().endsWith('.3mf')) {
      const bambuExe = 'C:\\Program Files\\Bambu Studio\\bambu-studio.exe';
      if (fs.existsSync(bambuExe)) {
        try {
          const { execFileSync } = require('child_process');
          const tmpValidated = `${result.filePath}.validated.3mf`;
          execFileSync(bambuExe, ['--export-3mf', tmpValidated, result.filePath], { timeout: 25000 });
          if (fs.existsSync(tmpValidated) && fs.statSync(tmpValidated).size > 1000) {
            fs.renameSync(tmpValidated, result.filePath);
          }
        } catch (e) {
          logMsg(`Optional Bambu CLI pass skipped: ${e}`);
        }
      }
    }

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

  // Opens release pages in the default browser. Only this project's GitHub pages are allowed.
  ipcMain.handle('tailwag:open-external', async (_event, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://github.com/everyday3d/')) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('tailwag:app-version', () => app.getVersion());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
