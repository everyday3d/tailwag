/** Saves bytes through the desktop app's save dialog, or as a browser download on the web. */
export async function saveBytes(data: Uint8Array | ArrayBuffer, filename: string, ext: string): Promise<void> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const desktopBridge = (window as any).tailwagDesktop;
  if (desktopBridge?.saveFile) {
    await desktopBridge.saveFile({
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      dataBase64: bytesToBase64(bytes),
    });
    return;
  }
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
