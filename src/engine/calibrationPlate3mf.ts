import { zipSync, strToU8 } from 'fflate';
import bambuProjectTemplate from '../data/bambuProjectTemplate.json';
import {
  BACKING_THICKNESS_MM,
  PATCH_MM,
  PATCH_GAP_MM,
  PLATE_MARGIN_MM,
  buildPlateLayout,
  type PlateLayout,
} from './calibrationPlate';
import { PINNED_SLICER_SETTINGS, layerSettingsFor } from './slicerSettings';

/** White frame under the whole plate. 0.4 mm = initial 0.16 + 3 x 0.08, so tops sit on layer boundaries. */
export const PLATE_BASE_MM = 0.4;
const FIDUCIAL_SIZE_MM = 4;
const FIDUCIAL_HEIGHT_MM = 0.8;

export interface CalibrationPlateSpools {
  /** Hex colors, in extruder order: [white backing, black backing, ...test filaments]. */
  hexColors: string[];
  names: string[];
}

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  extruder: number;
  name: string;
}

/** Axis-aligned boxes for the plate. Extruder 1 = white backing, 2 = black backing, 3+ = test filaments. */
export function plateBoxes(layout: PlateLayout): Box[] {
  const boxes: Box[] = [];
  boxes.push({
    x0: 0,
    y0: 0,
    z0: 0,
    x1: layout.widthMm,
    y1: layout.heightMm,
    z1: PLATE_BASE_MM,
    extruder: 1,
    name: 'Base_frame',
  });
  for (const f of layout.fiducials) {
    boxes.push({
      x0: f.x - FIDUCIAL_SIZE_MM / 2,
      y0: f.y - FIDUCIAL_SIZE_MM / 2,
      z0: PLATE_BASE_MM,
      x1: f.x + FIDUCIAL_SIZE_MM / 2,
      y1: f.y + FIDUCIAL_SIZE_MM / 2,
      z1: PLATE_BASE_MM + FIDUCIAL_HEIGHT_MM,
      extruder: 2,
      name: 'Corner_mark',
    });
  }
  // One backing slab per row, spanning the bare patch and every step patch.
  const rowYs = [...new Set(layout.patches.map((p) => p.y))].sort((a, b) => a - b);
  const xMin = PLATE_MARGIN_MM - PATCH_GAP_MM / 2;
  const xMax = layout.widthMm - PLATE_MARGIN_MM + PATCH_GAP_MM / 2;
  for (const y of rowYs) {
    const backing = layout.patches.find((p) => p.y === y)!.backing;
    boxes.push({
      x0: xMin,
      y0: y - PATCH_MM / 2 - 0.5,
      z0: PLATE_BASE_MM,
      x1: xMax,
      y1: y + PATCH_MM / 2 + 0.5,
      z1: PLATE_BASE_MM + BACKING_THICKNESS_MM,
      extruder: backing === 'white' ? 1 : 2,
      name: `Backing_${backing}`,
    });
  }
  const top = PLATE_BASE_MM + BACKING_THICKNESS_MM;
  for (const p of layout.patches) {
    if (p.kind !== 'step') continue;
    boxes.push({
      x0: p.x - PATCH_MM / 2,
      y0: p.y - PATCH_MM / 2,
      z0: top,
      x1: p.x + PATCH_MM / 2,
      y1: p.y + PATCH_MM / 2,
      z1: top + p.thicknessMm,
      extruder: 3 + p.filament,
      name: `Filament${p.filament + 1}_${p.thicknessMm.toFixed(2)}mm_on_${p.backing}`,
    });
  }
  return boxes;
}

function boxMeshXml(b: Box, cx: number, cy: number): { verts: string[]; tris: string[] } {
  const xs = [b.x0 - cx, b.x1 - cx];
  const ys = [cy - b.y1, cy - b.y0];
  const zs = [b.z0, b.z1];
  const verts: string[] = [];
  for (const z of zs) for (const y of ys) for (const x of xs) verts.push(`     <vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}"/>`);
  // index = xi + 2*yi + 4*zi
  const quads: Array<[number, number, number, number]> = [
    [0, 2, 3, 1], // bottom (z0), viewed from below
    [4, 5, 7, 6], // top
    [0, 1, 5, 4], // y0 face
    [2, 6, 7, 3], // y1 face
    [0, 4, 6, 2], // x0 face
    [1, 3, 7, 5], // x1 face
  ];
  const tris: string[] = [];
  for (const [a, b2, c, d] of quads) {
    tris.push(`     <triangle v1="${a}" v2="${b2}" v3="${c}"/>`);
    tris.push(`     <triangle v1="${a}" v2="${c}" v3="${d}"/>`);
  }
  return { verts, tris };
}

/**
 * Multi-filament calibration plate as a Bambu/Orca style 3MF: every box is its own part with its own
 * extruder. Print it, photograph it with the four corner marks in view, then load the photo.
 */
export function generateCalibrationPlate3mf(spools: CalibrationPlateSpools): Uint8Array {
  const testCount = spools.hexColors.length - 2;
  if (testCount < 1) throw new Error('Pick at least one filament to calibrate.');
  const layout = buildPlateLayout(testCount);
  const boxes = plateBoxes(layout);
  const cx = layout.widthMm / 2;
  const cy = layout.heightMm / 2;

  const objBlocks: string[] = [];
  const compEntries: string[] = [];
  const partConfigs: string[] = [];
  const parentId = boxes.length + 1;
  let faces = 0;
  boxes.forEach((b, idx) => {
    const pid = idx + 1;
    const m = boxMeshXml(b, cx, cy);
    faces += 12;
    const h = pid.toString(16).padStart(4, '0');
    objBlocks.push(
      [
        `  <object id="${pid}" p:UUID="0001${h}-81cb-4c03-9d28-80fed5dfa1dc" type="model">`,
        '   <mesh>',
        '    <vertices>',
        ...m.verts,
        '    </vertices>',
        '    <triangles>',
        ...m.tris,
        '    </triangles>',
        '   </mesh>',
        '  </object>',
      ].join('\n')
    );
    compEntries.push(
      `    <component p:path="/3D/Objects/object_1.model" objectid="${pid}" p:UUID="0001${(idx).toString(16).padStart(4, '0')}-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`
    );
    partConfigs.push(
      [
        `    <part id="${pid}" subtype="normal_part" uuid="0001${h}-7e6d-4931-9a9f-7218cba9de1c">`,
        `      <metadata key="name" value="${b.name}"/>`,
        '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>',
        `      <metadata key="extruder" value="${b.extruder}"/>`,
        '      <mesh_stat face_count="12" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>',
        '    </part>',
      ].join('\n')
    );
  });

  const ns =
    'unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';
  const objectModelXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model ${ns}>`,
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ' <resources>',
    ...objBlocks,
    ' </resources>',
    ' <build/>',
    '</model>',
  ].join('\n');
  const rootModelXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model ${ns}>`,
    ' <metadata name="Application">BambuStudio-02.08.02.61</metadata>',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ' <metadata name="Title">TailWag Calibration Plate</metadata>',
    ' <resources>',
    `  <object id="${parentId}" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">`,
    '   <components>',
    ...compEntries,
    '   </components>',
    '  </object>',
    ' </resources>',
    ' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">',
    `  <item objectid="${parentId}" p:UUID="00000005-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 128.0000 128.0000 0" printable="1"/>`,
    ' </build>',
    '</model>',
  ].join('\n');

  const filamentMaps = spools.hexColors.map(() => '1').join(' ');
  const modelSettingsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    `  <object id="${parentId}">`,
    '    <metadata key="name" value="TailWag Calibration Plate"/>',
    '    <metadata key="extruder" value="1"/>',
    `    <metadata face_count="${faces}"/>`,
    ...partConfigs,
    '  </object>',
    '  <plate>',
    '    <metadata key="plater_id" value="1"/>',
    '    <metadata key="plater_name" value="TailWag Calibration Plate"/>',
    '    <metadata key="locked" value="false"/>',
    '    <metadata key="filament_map_mode" value="Auto For Flush"/>',
    `    <metadata key="filament_maps" value="${filamentMaps}"/>`,
    '    <model_instance>',
    `      <metadata key="object_id" value="${parentId}"/>`,
    '      <metadata key="instance_id" value="0"/>',
    '      <metadata key="identify_id" value="72"/>',
    '    </model_instance>',
    '  </plate>',
    '</config>',
  ].join('\n');

  const ps: Record<string, any> = JSON.parse(JSON.stringify(bambuProjectTemplate));
  const n = spools.hexColors.length;
  for (const key of Object.keys(ps)) {
    if (Array.isArray(ps[key]) && ps[key].length === 4 && n !== 4) {
      const base = ps[key];
      ps[key] = Array.from({ length: n }, (_, i) => base[i % base.length]);
    }
  }
  ps.filament_colour = spools.hexColors;
  if ('default_filament_colour' in ps) ps.default_filament_colour = spools.hexColors;
  Object.assign(ps, layerSettingsFor(0.16, 0.08), PINNED_SLICER_SETTINGS);
  // The plate is small; park the prime tower in a corner clear of it.
  ps.wipe_tower_x = ['20'];
  ps.wipe_tower_y = ['20'];

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    ' <Default Extension="png" ContentType="image/png"/>',
    '</Types>',
  ].join('\n');
  const rel = (target: string) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      ` <Relationship Target="${target}" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`,
      '</Relationships>',
    ].join('\n');

  const legend = [
    'TailWag calibration plate',
    `Extruder 1: white backing (${spools.names[0]})`,
    `Extruder 2: black backing (${spools.names[1]})`,
    ...spools.names.slice(2).map((nm, i) => `Extruder ${i + 3}: ${nm}`),
    '',
    'Rows alternate: filament over white, filament over black. Left patch of each row is the bare backing.',
    'Print with the pinned TailWag settings, then photograph the plate flat in even daylight with the four corner marks visible.',
  ].join('\n');

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypesXml),
      '_rels/.rels': strToU8(rel('/3D/3dmodel.model')),
      '3D/3dmodel.model': strToU8(rootModelXml),
      '3D/_rels/3dmodel.model.rels': strToU8(rel('/3D/Objects/object_1.model')),
      '3D/Objects/object_1.model': strToU8(objectModelXml),
      'Metadata/project_settings.config': strToU8(JSON.stringify(ps, null, 4)),
      'Metadata/model_settings.config': strToU8(modelSettingsXml),
      'Metadata/TailWag_Calibration_Legend.txt': strToU8(legend),
    },
    { level: 6 }
  );
}
