// Finds the main subject of a photo with BiRefNet lite (MIT) on ONNX Runtime (MIT), offline.
// The model ships in the installer's resources (see scripts/fetch-model.mjs); in development it
// is read from the project's models/ folder. Runs in the main process: the native runtime has
// none of the browser's memory limits, and the window stays responsive.
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export const SUBJECT_INPUT_SIZE = 1024;
const MODEL_FILE = 'birefnet-lite.onnx';
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export function subjectModelPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'models', MODEL_FILE) : path.join(app.getAppPath(), 'models', MODEL_FILE);
}

export function subjectModelAvailable(): boolean {
  try {
    return fs.statSync(subjectModelPath()).isFile();
  } catch {
    return false;
  }
}

let sessionPromise: Promise<any> | null = null;
function session(): Promise<any> {
  if (!sessionPromise) {
    // Loaded lazily so TailWag starts normally even if the runtime is missing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ort = require('onnxruntime-node');
    sessionPromise = ort.InferenceSession.create(subjectModelPath(), { executionProviders: ['cpu'], graphOptimizationLevel: 'all' }).catch((e: unknown) => {
      sessionPromise = null;
      throw e;
    });
  }
  return sessionPromise!;
}

/**
 * Takes a SUBJECT_INPUT_SIZE² RGBA picture and returns a SUBJECT_INPUT_SIZE² mask:
 * 0 = background, 255 = subject.
 */
export async function findSubject(rgba: Uint8Array): Promise<Uint8Array> {
  const S = SUBJECT_INPUT_SIZE;
  if (rgba.length !== S * S * 4) throw new Error(`Expected a ${S}x${S} picture.`);
  const ort = require('onnxruntime-node');
  const s = await session();
  const plane = S * S;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) input[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
  const logits: Float32Array = out[s.outputNames[s.outputNames.length - 1]].data;
  const mask = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) mask[i] = Math.round(255 / (1 + Math.exp(-logits[i])));
  return mask;
}
