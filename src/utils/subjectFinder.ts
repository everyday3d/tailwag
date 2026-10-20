import { useTailWagStore } from '../store/useTailWagStore';
import { applyPhotoEdit } from '../engine/photoEdit';
import { resampleMask } from '../engine/subjectCut';

const INPUT = 1024;

type Bridge = {
  findSubject?: (rgba: Uint8Array) => Promise<{ ok: boolean; mask?: Uint8Array; size?: number; error?: string }>;
  subjectAvailable?: () => Promise<boolean>;
};
const bridge = (): Bridge | undefined => (window as unknown as { tailwagDesktop?: Bridge }).tailwagDesktop;

export const subjectFinderSupported = () => !!bridge()?.findSubject;

/**
 * Finds the photo's main subject with the cutout model (desktop app) and stores the mask,
 * lined up with the current picture. Uses the larger original when there is one, so the
 * model sees more detail than the 420 px working picture.
 */
export async function findSubjectNow(): Promise<boolean> {
  const set = useTailWagStore.getState().setPhotoState;
  const b = bridge();
  if (!b?.findSubject) {
    set({ subjectStatus: { kind: 'error', message: 'Cutting to the subject works in the TailWag desktop app only.' } });
    return false;
  }
  const { sourceImageData, photoOriginal, photoEdit } = useTailWagStore.getState();
  if (!sourceImageData) return false;
  set({ subjectStatus: { kind: 'busy' } });
  try {
    if (b.subjectAvailable && !(await b.subjectAvailable())) {
      set({ subjectStatus: { kind: 'error', message: 'The subject model is not installed with this copy of TailWag.' } });
      return false;
    }
    // The model takes a 1024 x 1024 picture; the photo is stretched to it and the mask stretched back.
    const detailed = photoOriginal ? applyPhotoEdit(photoOriginal, photoEdit, INPUT) : sourceImageData;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = detailed.width;
    srcCanvas.height = detailed.height;
    srcCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(detailed.data), detailed.width, detailed.height), 0, 0);
    const canvas = document.createElement('canvas');
    canvas.width = INPUT;
    canvas.height = INPUT;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, INPUT, INPUT);
    const rgba = new Uint8Array(ctx.getImageData(0, 0, INPUT, INPUT).data.buffer);

    const res = await b.findSubject(rgba);
    if (!res.ok || !res.mask) {
      set({ subjectStatus: { kind: 'error', message: res.error || 'The subject could not be found.' } });
      return false;
    }
    // The photo may have changed while the model ran; only keep a mask for the current picture.
    const now = useTailWagStore.getState().sourceImageData;
    if (now !== sourceImageData) {
      set({ subjectStatus: { kind: 'idle' } });
      return false;
    }
    const mask = resampleMask(new Uint8Array(res.mask), res.size ?? INPUT, sourceImageData.width, sourceImageData.height);
    let inside = 0;
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 127) inside++;
    if (inside < mask.data.length * 0.01) {
      set({ subjectMask: null, subjectStatus: { kind: 'error', message: 'No clear subject was found in this photo. The print stays a rectangle.' } });
      return false;
    }
    set({ subjectMask: mask, subjectStatus: { kind: 'idle' } });
    return true;
  } catch (e) {
    set({ subjectStatus: { kind: 'error', message: e instanceof Error ? e.message : String(e) } });
    return false;
  }
}
