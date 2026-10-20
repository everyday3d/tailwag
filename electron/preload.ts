import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tailwagDesktop', {
  isDesktop: true,
  saveFile: (options: { defaultPath: string; filters: { name: string; extensions: string[] }[]; dataBase64: string }) =>
    ipcRenderer.invoke('tailwag:save-file', options),
  fetchHaAms: (config: { haUrl: string; haToken: string }) =>
    ipcRenderer.invoke('tailwag:fetch-ha-ams', config),
  checkForUpdates: () => ipcRenderer.invoke('tailwag:check-update'),
  openExternal: (url: string) => ipcRenderer.invoke('tailwag:open-external', url),
  appVersion: () => ipcRenderer.invoke('tailwag:app-version'),
  openProject: (path?: string) => ipcRenderer.invoke('tailwag:open-project', path),
  listSlicers: () => ipcRenderer.invoke('tailwag:list-slicers'),
  chooseSlicer: (slicerId: string) => ipcRenderer.invoke('tailwag:choose-slicer', slicerId),
  sendToSlicer: (options: { slicerId: string | null; fileName: string; dataBase64: string }) =>
    ipcRenderer.invoke('tailwag:send-to-slicer', options),
  showExportInFolder: (filePath?: string) => ipcRenderer.invoke('tailwag:show-export-in-folder', filePath),
});
