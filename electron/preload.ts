import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tailwagDesktop', {
  isDesktop: true,
  saveFile: (options: { defaultPath: string; filters: { name: string; extensions: string[] }[]; dataBase64: string }) =>
    ipcRenderer.invoke('tailwag:save-file', options),
  fetchHaAms: (config: { haUrl: string; haToken: string }) =>
    ipcRenderer.invoke('tailwag:fetch-ha-ams', config),
});
