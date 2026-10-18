import { strFromU8, unzipSync } from 'fflate';
import type { HeightmapGrid } from './cadMeshBuilder';
import { PrintPlan, printedLayerForZ, shortPlanHash } from './printPlan';
import { PINNED_SLICER_SETTINGS, layerSettingsFor } from './slicerSettings';

/**
 * Export verification: re-read what was actually written and compare it with the PrintPlan.
 * Errors mean the file does not match the plan and the export must be blocked.
 * Warnings are real-world risks that do not contradict the plan.
 */

export type IssueSeverity = 'error' | 'warning';

export interface VerificationIssue {
  code: string;
  severity: IssueSeverity;
  message: string;
}

export interface VerificationReport {
  ok: boolean;
  errors: VerificationIssue[];
  warnings: VerificationIssue[];
  stats: Record<string, number | string>;
}

export class ExportVerificationError extends Error {
  report: VerificationReport;
  constructor(report: VerificationReport) {
    const head = report.errors.slice(0, 3).map((e) => e.message).join(' | ');
    super(`Export blocked: the written file does not match the print plan. ${head}`);
    this.name = 'ExportVerificationError';
    this.report = report;
  }
}

/** Absolute Z tolerance (mm): vertices are written with 4 decimals. */
const TOL = 5e-4;

class Collector {
  errors: VerificationIssue[] = [];
  warnings: VerificationIssue[] = [];
  stats: Record<string, number | string> = {};
  private counts = new Map<string, number>();

  error(code: string, message: string) {
    this.add('error', code, message);
  }
  warn(code: string, message: string) {
    this.add('warning', code, message);
  }
  private add(severity: IssueSeverity, code: string, message: string) {
    // Keep the first few examples of each code; count the rest.
    const n = (this.counts.get(code) ?? 0) + 1;
    this.counts.set(code, n);
    if (n > 3) return;
    (severity === 'error' ? this.errors : this.warnings).push({ code, severity, message });
  }
  report(): VerificationReport {
    for (const [code, n] of this.counts) if (n > 3) this.stats[`${code}_total`] = n;
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings, stats: this.stats };
  }
}

/** Nodes that belong to at least one valid quad (all four corners have material). */
function expectedNodes(grid: HeightmapGrid): Uint8Array {
  const { cols, rows, topZ } = grid;
  const out = new Uint8Array(cols * rows);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = (r + 1) * cols + c;
      const e = d + 1;
      if (topZ[a] > 0 && topZ[b] > 0 && topZ[d] > 0 && topZ[e] > 0) {
        out[a] = out[b] = out[d] = out[e] = 1;
      }
    }
  }
  return out;
}

function nodeIndexAt(grid: HeightmapGrid, x: number, y: number): number {
  const { cols, rows, widthMm, heightMm } = grid;
  const cf = ((x + widthMm / 2) / widthMm) * (cols - 1);
  const rf = ((heightMm / 2 - y) / heightMm) * (rows - 1);
  const c = Math.round(cf);
  const r = Math.round(rf);
  if (Math.abs(cf - c) > 2e-3 || Math.abs(rf - r) > 2e-3) return -1; // intersection point inside an edge
  if (c < 0 || c >= cols || r < 0 || r >= rows) return -1;
  return r * cols + c;
}

/** Distance (mm) from a surface height to the nearest slicer mid-plane decision boundary. */
function midPlaneDistance(z: number, plan: PrintPlan): number {
  const x = (z - plan.baseLayerMm) / plan.layerHeightMm + 1.5;
  return Math.abs(x - Math.round(x)) * plan.layerHeightMm;
}

function countAmbiguousColumns(grid: HeightmapGrid, plan: PrintPlan, c: Collector) {
  let n = 0;
  for (let i = 0; i < grid.topZ.length; i++) {
    if (grid.topZ[i] > plan.baseLayerMm * 0.5 && midPlaneDistance(grid.topZ[i], plan) < 1e-3) n++;
  }
  c.stats.midPlaneAmbiguousColumns = n;
  if (n > 0) {
    c.warn(
      'MID_PLANE_AMBIGUOUS',
      `${n} column(s) end within 0.001 mm of a layer mid-plane, so a slicer may round them to either neighboring layer.`
    );
  }
}

interface ParsedMesh {
  verts: Array<[number, number, number]>;
  tris: Array<[number, number, number]>;
}

function parseObjectMeshes(xml: string): Map<number, ParsedMesh> {
  const out = new Map<number, ParsedMesh>();
  const chunks = xml.split('<object ').slice(1);
  for (const chunk of chunks) {
    const id = Number(/^id="(\d+)"/.exec(chunk)?.[1]);
    if (!Number.isFinite(id)) continue;
    const verts: Array<[number, number, number]> = [];
    for (const m of chunk.matchAll(/<vertex x="(-?[\d.]+)" y="(-?[\d.]+)" z="(-?[\d.]+)"\/>/g)) {
      verts.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
    const tris: Array<[number, number, number]> = [];
    for (const m of chunk.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)) {
      tris.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
    out.set(id, { verts, tris });
  }
  return out;
}

function checkManifold(mesh: ParsedMesh, label: string, c: Collector) {
  const directed = new Map<string, number>();
  for (const [a, b, d] of mesh.tris) {
    for (const [u, v] of [[a, b], [b, d], [d, a]] as Array<[number, number]>) {
      const k = `${u}>${v}`;
      directed.set(k, (directed.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  let touching = 0;
  for (const [k, n] of directed) {
    const [u, v] = k.split('>');
    const back = directed.get(`${v}>${u}`) ?? 0;
    if (n !== back) open++; // open edge or flipped triangle
    else if (n > 1 && Number(u) < Number(v)) touching++; // two solids meeting along a line: valid
  }
  if (touching > 0) c.stats[`touchingEdges_${label}`] = touching;
  if (open > 0) {
    c.warn(
      'NON_MANIFOLD',
      `${label} has ${open} open or flipped edge(s); the slicer may need to repair it.`
    );
  }
}

function readPlanJson(files: Record<string, Uint8Array>, name: string, plan: PrintPlan, c: Collector) {
  const raw = files[name];
  if (!raw) {
    c.error('PLAN_JSON_MISSING', `${name} is missing from the package.`);
    return;
  }
  try {
    const j = JSON.parse(strFromU8(raw));
    if (j.hash !== plan.hash) {
      c.error('PLAN_HASH_MISMATCH', `Embedded plan ${String(j.hash).slice(0, 8)} differs from plan ${shortPlanHash(plan)}.`);
    }
    if (!Array.isArray(j.bands) || j.bands.length !== plan.bands.length) {
      c.error('PLAN_BANDS_MISMATCH', 'Embedded plan has a different number of filament bands.');
    } else {
      plan.bands.forEach((b, i) => {
        const e = j.bands[i];
        if (e.startLayer !== b.startLayer || e.endLayer !== b.endLayer || String(e.hex).toUpperCase() !== b.hex.toUpperCase()) {
          c.error('PLAN_BANDS_MISMATCH', `Embedded band ${i + 1} differs from the plan.`);
        }
      });
    }
  } catch {
    c.error('PLAN_JSON_MISSING', `${name} is not valid JSON.`);
  }
}

/** Verifies a written .3mf by re-reading it and comparing it with the plan and heightmap. */
export function verify3mfAgainstPlan(bytes: Uint8Array, plan: PrintPlan, grid: HeightmapGrid): VerificationReport {
  const c = new Collector();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    c.error('ZIP_UNREADABLE', 'The 3MF archive cannot be read back.');
    return c.report();
  }

  const required = [
    '[Content_Types].xml',
    '_rels/.rels',
    '3D/3dmodel.model',
    '3D/Objects/object_1.model',
    'Metadata/project_settings.config',
    'Metadata/model_settings.config',
  ];
  for (const f of required) if (!files[f]) c.error('MISSING_FILE', `Required file ${f} is missing.`);
  if (c.errors.length > 0) return c.report();

  readPlanJson(files, 'Metadata/TailWag_PrintPlan.json', plan, c);

  // Filament list and slicer settings
  try {
    const ps = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    const colours: string[] = ps.filament_colour ?? [];
    if (colours.length !== plan.bands.length || plan.bands.some((b, i) => String(colours[i]).toUpperCase() !== b.hex.toUpperCase())) {
      c.error(
        'FILAMENT_COLOURS_MISMATCH',
        `Filament colors in the project (${colours.join(', ')}) do not match the plan's filament order (${plan.bands.map((b) => b.hex).join(', ')}).`
      );
    }
    for (const [k, v] of Object.entries({ ...layerSettingsFor(plan.baseLayerMm, plan.layerHeightMm), ...PINNED_SLICER_SETTINGS })) {
      if (String(ps[k]) !== v) c.error('SETTING_MISMATCH', `Slicer setting ${k} is "${String(ps[k])}" but the plan requires "${v}".`);
    }
  } catch {
    c.error('SETTINGS_PARSE', 'project_settings.config cannot be parsed.');
    return c.report();
  }

  // Parts: extruder assignment, face counts, offset
  const modelSettings = strFromU8(files['Metadata/model_settings.config']);
  const partInfo = new Map<number, { extruder: number; faces: number; offsetZ: number }>();
  for (const m of modelSettings.matchAll(/<part id="(\d+)"[\s\S]*?<\/part>/g)) {
    const id = Number(m[1]);
    const body = m[0];
    partInfo.set(id, {
      extruder: Number(/key="extruder" value="(\d+)"/.exec(body)?.[1]),
      faces: Number(/face_count="(\d+)"/.exec(body)?.[1]),
      offsetZ: Number(/key="source_offset_z" value="(-?[\d.]+)"/.exec(body)?.[1]),
    });
  }
  const fm = /key="filament_maps" value="([^"]*)"/.exec(modelSettings)?.[1] ?? '';
  if (fm.trim().split(/\s+/).filter(Boolean).length !== plan.bands.length) {
    c.error('FILAMENT_MAPS_LENGTH', 'The per-filament map length does not match the number of filaments.');
  }

  const meshes = parseObjectMeshes(strFromU8(files['3D/Objects/object_1.model']));
  c.stats.parts = meshes.size;

  const nodeIntervals: Array<Array<{ band: number; lo: number; hi: number }> | undefined> = new Array(grid.cols * grid.rows);
  const lastBand = plan.bands.length - 1;

  for (const [id, mesh] of meshes) {
    const bandIdx = id - 1;
    const band = plan.bands[bandIdx];
    const info = partInfo.get(id);
    if (!band || !info) {
      c.error('PART_UNKNOWN_BAND', `Part ${id} has no matching filament band in the plan.`);
      continue;
    }
    if (info.extruder !== band.extruder) {
      c.error('PART_EXTRUDER_MISMATCH', `Part ${id} is assigned to extruder ${info.extruder}, the plan says ${band.extruder}.`);
    }
    if (info.faces !== mesh.tris.length) {
      c.error('FACE_COUNT_MISMATCH', `Part ${id} declares ${info.faces} faces but contains ${mesh.tris.length}.`);
    }
    if (mesh.tris.some((t) => t.some((v) => v < 0 || v >= mesh.verts.length))) {
      c.error('BAD_TRIANGLE_INDEX', `Part ${id} references a vertex that does not exist.`);
      continue;
    }
    checkManifold(mesh, `Part ${id}`, c);

    const centerZ = info.offsetZ;
    const perNode = new Map<number, { lo: number; hi: number }>();
    for (const [x, y, zRel] of mesh.verts) {
      const z = zRel + centerZ;
      if (z < band.floorZMm - TOL) c.error('BAND_Z_RANGE', `Part ${id} has geometry at ${z.toFixed(3)} mm, below its band floor ${band.floorZMm} mm.`);
      if (bandIdx !== lastBand && z > band.ceilZMm + TOL) {
        c.error('BAND_Z_RANGE', `Part ${id} has geometry at ${z.toFixed(3)} mm, above its band ceiling ${band.ceilZMm} mm.`);
      }
      const n = nodeIndexAt(grid, x, y);
      if (n < 0) continue;
      const cur = perNode.get(n);
      if (cur) {
        cur.lo = Math.min(cur.lo, z);
        cur.hi = Math.max(cur.hi, z);
      } else perNode.set(n, { lo: z, hi: z });
    }
    for (const [n, iv] of perNode) {
      (nodeIntervals[n] ??= []).push({ band: bandIdx, lo: iv.lo, hi: iv.hi });
    }
  }

  // Reconstruct the solid at every node and compare with the heightmap and the plan
  const expected = expectedNodes(grid);
  let missing = 0;
  let extra = 0;
  let checked = 0;
  for (let n = 0; n < expected.length; n++) {
    const ivs = nodeIntervals[n];
    if (!expected[n]) {
      if (ivs && ivs.some((v) => v.hi - v.lo > TOL)) extra++;
      continue;
    }
    if (!ivs) {
      missing++;
      continue;
    }
    const thick = ivs.filter((v) => v.hi - v.lo > 5e-5).sort((a, b) => a.band - b.band);
    if (thick.length === 0) {
      missing++;
      continue;
    }
    checked++;
    if (Math.abs(thick[0].lo - grid.bottomZ[n]) > TOL) {
      c.error('NODE_BOTTOM_MISMATCH', `Column ${n}: material starts at ${thick[0].lo.toFixed(3)} mm, expected ${grid.bottomZ[n].toFixed(3)} mm.`);
    }
    for (let i = 1; i < thick.length; i++) {
      if (Math.abs(thick[i].lo - thick[i - 1].hi) > TOL) {
        c.error(
          'NODE_NOT_CONTIGUOUS',
          `Column ${n}: gap or overlap between filament bands ${thick[i - 1].band + 1} and ${thick[i].band + 1} (${thick[i - 1].hi.toFixed(3)} vs ${thick[i].lo.toFixed(3)} mm).`
        );
      }
    }
    const top = thick[thick.length - 1].hi;
    if (Math.abs(top - grid.topZ[n]) > TOL) {
      c.error('NODE_TOP_MISMATCH', `Column ${n}: printed top is ${top.toFixed(3)} mm but the model says ${grid.topZ[n].toFixed(3)} mm.`);
    } else {
      const got = printedLayerForZ(top, plan.baseLayerMm, plan.layerHeightMm);
      if (got !== plan.layerGrid[n] && midPlaneDistance(grid.topZ[n], plan) >= 1e-3) {
        c.error('LAYER_MISMATCH', `Column ${n}: the file prints ${got} layers, the plan says ${plan.layerGrid[n]}.`);
      }
    }
  }
  if (missing > 0) c.error('NODE_SET_MISMATCH', `${missing} column(s) from the plan are missing from the 3MF geometry.`);
  if (extra > 0) c.error('NODE_SET_MISMATCH', `${extra} column(s) in the 3MF should not have material.`);
  c.stats.columnsChecked = checked;

  countAmbiguousColumns(grid, plan, c);
  return c.report();
}

/** Verifies a binary STL: header ties to the plan and every column's height matches the heightmap. */
export function verifyStlAgainstPlan(stl: ArrayBuffer | Uint8Array, plan: PrintPlan, grid: HeightmapGrid, c = new Collector()): VerificationReport {
  const bytes = stl instanceof Uint8Array ? stl : new Uint8Array(stl);
  if (bytes.length < 84) {
    c.error('STL_UNREADABLE', 'The STL is too short to be valid.');
    return c.report();
  }
  const header = String.fromCharCode(...bytes.subarray(0, 80));
  if (!header.includes(plan.hash)) c.error('STL_HEADER_PLAN_MISMATCH', 'The STL header does not carry this print plan.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = dv.getUint32(80, true);
  if (bytes.length !== 84 + triCount * 50) {
    c.error('STL_SIZE_MISMATCH', 'The STL size does not match its triangle count.');
    return c.report();
  }
  const maxZ = new Float64Array(grid.cols * grid.rows).fill(-Infinity);
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const o = base + v * 12;
      const n = nodeIndexAt(grid, dv.getFloat32(o, true), dv.getFloat32(o + 4, true));
      if (n < 0) continue;
      const z = dv.getFloat32(o + 8, true);
      if (z > maxZ[n]) maxZ[n] = z;
    }
  }
  const expected = expectedNodes(grid);
  let missing = 0;
  let checked = 0;
  for (let n = 0; n < expected.length; n++) {
    if (!expected[n]) continue;
    if (maxZ[n] === -Infinity) {
      missing++;
      continue;
    }
    checked++;
    if (Math.abs(maxZ[n] - grid.topZ[n]) > TOL) {
      c.error('NODE_TOP_MISMATCH', `Column ${n}: the STL top is ${maxZ[n].toFixed(3)} mm but the model says ${grid.topZ[n].toFixed(3)} mm.`);
    } else {
      const got = printedLayerForZ(maxZ[n], plan.baseLayerMm, plan.layerHeightMm);
      if (got !== plan.layerGrid[n] && midPlaneDistance(grid.topZ[n], plan) >= 1e-3) {
        c.error('LAYER_MISMATCH', `Column ${n}: the STL prints ${got} layers, the plan says ${plan.layerGrid[n]}.`);
      }
    }
  }
  if (missing > 0) c.error('NODE_SET_MISMATCH', `${missing} column(s) from the plan are missing from the STL.`);
  c.stats.stlColumnsChecked = checked;
  countAmbiguousColumns(grid, plan, c);
  return c.report();
}

/** Verifies the no-AMS bundle: STL, plan JSON, metadata JSON and the pause schedule in the guides. */
export function verifyNoAmsBundleAgainstPlan(bytes: Uint8Array, plan: PrintPlan, grid: HeightmapGrid): VerificationReport {
  const c = new Collector();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    c.error('ZIP_UNREADABLE', 'The bundle cannot be read back.');
    return c.report();
  }
  const find = (suffix: string) => Object.keys(files).find((k) => k.endsWith(suffix));
  const planKey = find('_TailWag_PrintPlan.json');
  if (planKey) readPlanJson(files, planKey, plan, c);
  else c.error('PLAN_JSON_MISSING', 'The bundle has no print plan file.');

  const metaKey = find('_TailWag_PrintMetadata.json');
  if (!metaKey) c.error('METADATA_MISSING', 'The bundle has no metadata file.');
  else {
    try {
      if (JSON.parse(strFromU8(files[metaKey])).printPlanHash !== plan.hash) {
        c.error('METADATA_PLAN_MISMATCH', 'The metadata file belongs to a different plan.');
      }
    } catch {
      c.error('METADATA_MISSING', 'The metadata file is not valid JSON.');
    }
  }

  const stlKey = find('.stl');
  if (!stlKey) c.error('STL_MISSING', 'The bundle has no STL.');
  else verifyStlAgainstPlan(files[stlKey], plan, grid, c);

  // Pause schedule: every filament change must appear at the plan's layer and Z
  const txtKey = find('_Swap_Playbook.txt');
  const htmlKey = find('_Color_Change_Guide.html');
  const txt = txtKey ? strFromU8(files[txtKey]) : '';
  const html = htmlKey ? strFromU8(files[htmlKey]) : '';
  if (!txt.includes(plan.hash)) c.error('GUIDE_PLAN_MISMATCH', 'The text guide does not carry this print plan ID.');
  plan.bands.forEach((b, i) => {
    if (b.layerCount <= 0) return;
    const z = `Layer ${b.startLayer} (${b.startZMm.toFixed(2)} mm)`;
    if (!txt.includes(z)) c.error('GUIDE_SWAP_MISMATCH', `The text guide has no entry "${z}" for filament ${i + 1}.`);
    if (i > 0 && !new RegExp(`PAUSE #\\d+[^<]{0,12}LAYER ${b.startLayer}\\b`).test(html)) {
      c.error('GUIDE_SWAP_MISMATCH', `The HTML guide has no pause at layer ${b.startLayer}.`);
    }
  });
  return c.report();
}
