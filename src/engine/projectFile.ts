import { deflateSync, inflateSync } from 'fflate';
import type { CadCutoutConfig } from './cadMeshBuilder';
import type { LayerSwapSlot } from './opticalTdEngine';
import type { FilamentSpool } from '../data/filamentCatalog';
import { FOCUS_SHARE, type FocusStrength, type Mask, type PhotoEdit, isDefaultEdit, maskHasFocus } from './photoEdit';

/** Identifies a TailWag project file and the layout of its JSON. */
export const PROJECT_SCHEMA = 'tailwag-project';
/** Bump when the layout changes in a way older apps cannot read. */
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'tailwag';

const MAX_IMAGE_SIDE = 4096;
const MAX_FILE_BYTES = 60 * 1024 * 1024;

/** The parts of the app state a project keeps. The library and calibrations are global and stay out. */
export interface ProjectSettings {
  widthMm: number;
  heightMm: number;
  lockAspect: boolean;
  baseLayerMm: number;
  baseSolidThicknessMm: number;
  layerHeightMm: number;
  totalLayers: number;
  totalDepthMm: number;
  meshResolution: number;
  gamma: number;
  contrast: number;
  detailEnhance: number;
  invertLuminance: boolean;
  cad: CadCutoutConfig;
  matchMode: 'faithful' | 'vivid';
  solverColorMode: 'natural' | 'cmyk' | 'manual';
  manualRelief: 'rematch' | 'fixed';
  previewShading: 'accuracy' | 'beauty';
  backlitLithoMode: boolean;
  viewportMode: '3d-mesh' | 'split' | 'source' | 'heightmap';
  splitRatio: number;
}

export interface ProjectImage {
  width: number;
  height: number;
  /** Raw RGBA bytes, deflated, as base64. Lossless, so the solver sees exactly the same pixels. */
  rgbaDeflatedBase64: string;
}

export interface ProjectFile {
  schema: typeof PROJECT_SCHEMA;
  version: number;
  /** TailWag version that wrote the file (informational). */
  appVersion: string;
  savedAt: string;
  name: string;
  /** Print plan hash when saved; opening the project should reproduce it. */
  planHash?: string;
  image: ProjectImage;
  settings: ProjectSettings;
  slots: Array<{ id: string; upToLayer: number; locked?: boolean; spool: FilamentSpool }>;
  /**
   * Optional (#46): the whole photo before cropping, how it was cropped and turned, and the
   * focus area. Older TailWag versions ignore these and use `image`, which is already cropped.
   */
  original?: ProjectImage;
  photoEdit?: PhotoEdit;
  focus?: { width: number; height: number; maskDeflatedBase64: string; strength: FocusStrength };
  /** Optional: the subject cutout, lined up with `image` (so reopening does not re-run the model). */
  subject?: { width: number; height: number; maskDeflatedBase64: string };
}

export interface ProjectSnapshotInput extends ProjectSettings {
  projectName: string;
  slots: LayerSwapSlot[];
  sourceImageData: { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  photoOriginal?: { width: number; height: number; data: Uint8ClampedArray | Uint8Array } | null;
  photoEdit?: PhotoEdit;
  focusMask?: Mask | null;
  focusStrength?: FocusStrength;
  subjectMask?: Mask | null;
}

// ---------------------------------------------------------------- base64
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeImage(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): ProjectImage {
  const raw = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return { width: img.width, height: img.height, rgbaDeflatedBase64: bytesToBase64(deflateSync(raw, { level: 6 })) };
}

export function decodeImage(img: ProjectImage): { width: number; height: number; data: Uint8ClampedArray } {
  const raw = inflateSync(base64ToBytes(img.rgbaDeflatedBase64));
  if (raw.length !== img.width * img.height * 4) throw new Error('The picture inside the project is damaged.');
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(raw) };
}

// ---------------------------------------------------------------- build
const SPOOL_FIELDS: Array<keyof FilamentSpool> = [
  'id', 'brand', 'name', 'material', 'hex', 'td', 'tdSource', 'line', 'catalogId', 'amsSlot', 'stock', 'calibration',
];

function slimSpool(s: FilamentSpool): FilamentSpool {
  const out: Record<string, unknown> = {};
  for (const k of SPOOL_FIELDS) if (s[k] !== undefined) out[k] = s[k];
  return out as unknown as FilamentSpool;
}

export function buildProject(input: ProjectSnapshotInput, appVersion: string, planHash?: string, now = new Date()): ProjectFile {
  const {
    projectName, slots, sourceImageData, photoOriginal, photoEdit, focusMask, focusStrength, subjectMask, ...settings
  } = input;
  const subjectFits = !!subjectMask && subjectMask.width === sourceImageData.width && subjectMask.height === sourceImageData.height;
  const edited = !!photoOriginal && !!photoEdit && !isDefaultEdit(photoEdit);
  const focused = !!photoOriginal && maskHasFocus(focusMask);
  return {
    ...(subjectFits
      ? { subject: { width: subjectMask!.width, height: subjectMask!.height, maskDeflatedBase64: bytesToBase64(deflateSync(subjectMask!.data, { level: 9 })) } }
      : {}),
    ...(edited || focused ? { original: encodeImage(photoOriginal!), photoEdit: photoEdit } : {}),
    ...(focused
      ? {
          focus: {
            width: focusMask!.width,
            height: focusMask!.height,
            maskDeflatedBase64: bytesToBase64(deflateSync(focusMask!.data, { level: 9 })),
            strength: focusStrength ?? 'balanced',
          },
        }
      : {}),
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    appVersion,
    savedAt: now.toISOString(),
    name: projectName,
    planHash,
    image: encodeImage(sourceImageData),
    settings: settings as ProjectSettings,
    slots: slots.map((s) => ({ id: s.id, upToLayer: s.upToLayer, ...(s.locked ? { locked: true } : {}), spool: slimSpool(s.spool) })),
  };
}

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p);
}

// ---------------------------------------------------------------- validate
export type ParseResult = { ok: true; project: ProjectFile } | { ok: false; error: string };

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const HEX = /^#?[0-9a-fA-F]{6}$/;

export function parseProject(text: string): ParseResult {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: 'This file is too large to be a TailWag project.' };
  let raw: any;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, error: 'This is not a TailWag project file (it could not be read).' };
  }
  if (!raw || typeof raw !== 'object' || raw.schema !== PROJECT_SCHEMA) {
    return { ok: false, error: 'This is not a TailWag project file.' };
  }
  if (!isInt(raw.version, 1, 1e6)) return { ok: false, error: 'The project file has no valid version.' };
  if (raw.version > PROJECT_VERSION) {
    return { ok: false, error: `This project was saved by a newer TailWag (file format ${raw.version}). Update TailWag Studio to open it.` };
  }
  if (typeof raw.name !== 'string' || raw.name.length > 200) return { ok: false, error: 'The project name is missing or invalid.' };

  const im = raw.image;
  if (!im || !isInt(im.width, 1, MAX_IMAGE_SIDE) || !isInt(im.height, 1, MAX_IMAGE_SIDE) || typeof im.rgbaDeflatedBase64 !== 'string') {
    return { ok: false, error: 'The picture inside the project is missing or invalid.' };
  }
  try {
    decodeImage(im);
  } catch {
    return { ok: false, error: 'The picture inside the project is damaged.' };
  }

  const s = raw.settings;
  if (!s || typeof s !== 'object') return { ok: false, error: 'The project settings are missing.' };
  const bad = (what: string): ParseResult => ({ ok: false, error: `The project has an invalid value for ${what}.` });
  if (!isNum(s.widthMm, 5, 2000)) return bad('width');
  if (!isNum(s.heightMm, 5, 2000)) return bad('height');
  if (!isBool(s.lockAspect)) return bad('aspect lock');
  if (!isNum(s.baseLayerMm, 0.04, 2)) return bad('the first layer height');
  if (!isNum(s.baseSolidThicknessMm, 0, 20)) return bad('the base thickness');
  if (!isNum(s.layerHeightMm, 0.01, 1)) return bad('the layer height');
  if (!isInt(s.totalLayers, 2, 400)) return bad('the layer count');
  if (!isNum(s.totalDepthMm, 0, 100)) return bad('the total depth');
  if (!isInt(s.meshResolution, 16, 2000)) return bad('the mesh resolution');
  if (!isNum(s.gamma, 0.05, 10)) return bad('gamma');
  if (!isNum(s.contrast, 0.05, 10)) return bad('contrast');
  if (!isNum(s.detailEnhance, 0, 10)) return bad('detail');
  if (!isBool(s.invertLuminance)) return bad('invert');
  if (!s.cad || typeof s.cad !== 'object' || Array.isArray(s.cad)) return bad('the shape settings');
  if (!oneOf(s.matchMode, ['faithful', 'vivid'] as const)) return bad('the match mode');
  if (!oneOf(s.solverColorMode, ['natural', 'cmyk', 'manual'] as const)) return bad('the colour mode');
  if (!oneOf(s.manualRelief, ['rematch', 'fixed'] as const)) return bad('the manual relief choice');
  if (!oneOf(s.previewShading, ['accuracy', 'beauty'] as const)) return bad('the preview lighting');
  if (!isBool(s.backlitLithoMode)) return bad('backlit mode');
  if (!oneOf(s.viewportMode, ['3d-mesh', 'split', 'source', 'heightmap'] as const)) return bad('the view mode');
  if (!isNum(s.splitRatio, 0, 1)) return bad('the split position');

  if (!Array.isArray(raw.slots) || raw.slots.length < 1 || raw.slots.length > 16) {
    return { ok: false, error: 'The project must have between 1 and 16 filaments.' };
  }
  let prev = 0;
  for (let i = 0; i < raw.slots.length; i++) {
    const sl = raw.slots[i];
    if (!sl || typeof sl.id !== 'string' || !sl.spool || typeof sl.spool !== 'object') return { ok: false, error: `Filament ${i + 1} is damaged.` };
    const sp = sl.spool;
    if (typeof sp.hex !== 'string' || !HEX.test(sp.hex)) return { ok: false, error: `Filament ${i + 1} has an invalid colour.` };
    if (!isNum(sp.td, 0, 100)) return { ok: false, error: `Filament ${i + 1} has an invalid TD.` };
    if (typeof sp.name !== 'string' || typeof sp.brand !== 'string' || typeof sp.id !== 'string') return { ok: false, error: `Filament ${i + 1} has no name.` };
    if (!isInt(sl.upToLayer, 1, s.totalLayers) || sl.upToLayer <= prev) return { ok: false, error: `The swap layers are not in order at filament ${i + 1}.` };
    prev = sl.upToLayer;
  }
  if (prev !== s.totalLayers) return { ok: false, error: 'The last filament must end at the top layer.' };

  // Optional crop/focus extras (#46). `image` is already the cropped picture, so a damaged
  // extra is dropped and the project still opens.
  if (!validOriginalAndEdit(raw.original, raw.photoEdit)) {
    delete raw.original;
    delete raw.photoEdit;
    delete raw.focus;
  } else if (raw.focus !== undefined && !decodeFocus(raw as ProjectFile)) {
    delete raw.focus;
  }
  if (raw.subject !== undefined && !decodeSubject(raw as ProjectFile)) delete raw.subject;
  // Recolour rules (optional): keep only well-formed ones
  if (raw.photoEdit && raw.photoEdit.recolor !== undefined) {
    const hex = (v: any) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
    const rules = Array.isArray(raw.photoEdit.recolor) ? raw.photoEdit.recolor : [];
    raw.photoEdit.recolor = rules.filter((r: any) => r && hex(r.from) && hex(r.to) && isNum(r.tolerance, 1, 100)).slice(0, 12);
  }

  return { ok: true, project: raw as ProjectFile };
}

function validOriginalAndEdit(original: any, edit: any): boolean {
  if (original === undefined && edit === undefined) return true;
  if (!original || !isInt(original.width, 1, MAX_IMAGE_SIDE) || !isInt(original.height, 1, MAX_IMAGE_SIDE)) return false;
  if (typeof original.rgbaDeflatedBase64 !== 'string') return false;
  try {
    decodeImage(original);
  } catch {
    return false;
  }
  if (!edit || typeof edit !== 'object') return false;
  if (![0, 90, 180, 270].includes(edit.rotate) || !isNum(edit.straighten, -45, 45)) return false;
  const c = edit.crop;
  return (
    !!c &&
    isNum(c.x, 0, 1) && isNum(c.y, 0, 1) && isNum(c.w, 0.01, 1) && isNum(c.h, 0.01, 1) &&
    c.x + c.w <= 1.0001 && c.y + c.h <= 1.0001
  );
}

/** The subject cutout saved in a project, or null if there is none, it is damaged or does not fit the picture. */
export function decodeSubject(p: ProjectFile): Mask | null {
  const s = p.subject;
  if (!s || s.width !== p.image?.width || s.height !== p.image?.height || typeof s.maskDeflatedBase64 !== 'string') return null;
  try {
    const data = inflateSync(base64ToBytes(s.maskDeflatedBase64));
    return data.length === s.width * s.height ? { width: s.width, height: s.height, data } : null;
  } catch {
    return null;
  }
}

/** The focus mask saved in a project, or null if there is none or it is damaged. */
export function decodeFocus(p: ProjectFile): (Mask & { strength: FocusStrength }) | null {
  const f = p.focus;
  if (!f || !p.original || !isInt(f.width, 1, 4096) || !isInt(f.height, 1, 4096) || typeof f.maskDeflatedBase64 !== 'string') return null;
  if (!oneOf(f.strength, Object.keys(FOCUS_SHARE) as FocusStrength[])) return null;
  try {
    const data = inflateSync(base64ToBytes(f.maskDeflatedBase64));
    if (data.length !== f.width * f.height) return null;
    return { width: f.width, height: f.height, data, strength: f.strength };
  } catch {
    return null;
  }
}

/** Slots as the app uses them, rebuilt from a validated project. */
export function projectSlots(p: ProjectFile): LayerSwapSlot[] {
  return p.slots.map((s) => ({
    id: s.id,
    upToLayer: s.upToLayer,
    ...(s.locked ? { locked: true } : {}),
    spool: { ...s.spool, hex: s.spool.hex.startsWith('#') ? s.spool.hex.toUpperCase() : `#${s.spool.hex.toUpperCase()}` },
  }));
}

/** Suggested file name for a project. */
export function projectFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'TailWag_Project';
  return `${safe}.${PROJECT_EXTENSION}`;
}
