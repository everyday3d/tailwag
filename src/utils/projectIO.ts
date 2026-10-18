import { PROJECT_EXTENSION, projectFileName, serializeProject, type ProjectFile } from '../engine/projectFile';

const LAST_PATH_KEY = 'tailwag_last_project_path';
const LAST_NAME_KEY = 'tailwag_last_project_name';

interface DesktopBridge {
  saveFile?: (o: { defaultPath: string; filters: { name: string; extensions: string[] }[]; dataBase64: string }) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
  openProject?: (path?: string) => Promise<{ canceled: boolean; filePath?: string; text?: string; error?: string }>;
}

const bridge = (): DesktopBridge | undefined => (window as unknown as { tailwagDesktop?: DesktopBridge }).tailwagDesktop;

/** True when running in the desktop app, which can reopen the last project by its path. */
export const canReopenLastProject = (): boolean => !!bridge()?.openProject;

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function getLastProject(): { path: string; name: string } | null {
  try {
    const path = window.localStorage.getItem(LAST_PATH_KEY);
    if (!path) return null;
    return { path, name: window.localStorage.getItem(LAST_NAME_KEY) || 'your last project' };
  } catch {
    return null;
  }
}

function rememberProject(path: string, name: string) {
  try {
    window.localStorage.setItem(LAST_PATH_KEY, path);
    window.localStorage.setItem(LAST_NAME_KEY, name);
  } catch {
    // ignore storage errors
  }
}

export function forgetLastProject() {
  try {
    window.localStorage.removeItem(LAST_PATH_KEY);
    window.localStorage.removeItem(LAST_NAME_KEY);
  } catch {
    // ignore storage errors
  }
}

/** Saves the project through the desktop save dialog, or downloads it in a browser. Returns false if cancelled. */
export async function saveProjectFile(project: ProjectFile): Promise<{ saved: boolean; where?: string }> {
  const text = serializeProject(project);
  const fileName = projectFileName(project.name);
  const b = bridge();
  if (b?.saveFile) {
    const res = await b.saveFile({
      defaultPath: fileName,
      filters: [{ name: 'TailWag project', extensions: [PROJECT_EXTENSION] }],
      dataBase64: textToBase64(text),
    });
    if (res.canceled) return { saved: false };
    if (res.filePath) rememberProject(res.filePath, project.name);
    return { saved: true, where: res.filePath };
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true, where: fileName };
}

/** Asks for a project file (desktop dialog or browser picker) or reads a known path. Null when cancelled. */
export async function readProjectFile(path?: string): Promise<{ text: string; filePath?: string } | { error: string } | null> {
  const b = bridge();
  if (b?.openProject) {
    const res = await b.openProject(path);
    if (res.canceled) return null;
    if (res.error || typeof res.text !== 'string') return { error: res.error || 'The file could not be read.' };
    return { text: res.text, filePath: res.filePath };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${PROJECT_EXTENSION}`;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ text: String(reader.result ?? '') });
      reader.onerror = () => resolve({ error: 'The file could not be read.' });
      reader.readAsText(file);
    };
    input.click();
  });
}

export function noteOpenedProject(path: string | undefined, name: string) {
  if (path) rememberProject(path, name);
}

/** A data URL for the picture, used by the original-photo inset. */
export function imageDataToDataUrl(img: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
