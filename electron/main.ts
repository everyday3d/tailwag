import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1640,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: 'TailWag Studio — 3D Filament Painting & TD Lithophane Engine',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5188';
  if (!app.isPackaged && process.argv.includes('--dev')) {
    mainWindow.loadURL(devUrl);
  } else if (fs.existsSync(path.join(__dirname, '../dist/index.html'))) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL(devUrl);
  }

  mainWindow.on('closed', () => {
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
