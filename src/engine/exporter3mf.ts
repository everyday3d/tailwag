import { zipSync, strToU8 } from 'fflate';
import { HeightmapGrid } from './cadMeshBuilder';
import { LayerSwapSlot } from './opticalTdEngine';
import bambuProjectTemplate from '../data/bambuProjectTemplate.json';

export interface SwapInstructionItem {
  slotIndex: number;
  spoolName: string;
  brand: string;
  hex: string;
  td: number;
  startLayer: number;
  endLayer: number;
  startZMm: number;
  endZMm: number;
  amsUnitSlot: string;
  chainingAction?: string;
}

/**
 * Generates a structured Layer-Swap Playbook (including >4 Color Single-AMS Chaining instructions)
 */
export function buildSwapPlaybook(
  slots: LayerSwapSlot[],
  baseLayerMm: number,
  layerHeightMm: number,
  totalLayers: number
): SwapInstructionItem[] {
  const sorted = [...slots].sort((a, b) => a.upToLayer - b.upToLayer);
  const items: SwapInstructionItem[] = [];
  let currentStartLayer = 1;

  sorted.forEach((slot, idx) => {
    const startLayer = currentStartLayer;
    const endLayer = idx === sorted.length - 1 ? totalLayers : slot.upToLayer;
    const startZMm = Number((baseLayerMm + (startLayer - 1) * layerHeightMm).toFixed(2));
    const endZMm = Number((baseLayerMm + (endLayer - 1) * layerHeightMm).toFixed(2));
    const amsSlotNumber = (idx % 4) + 1;
    const amsUnitSlot = slot.spool.amsSlot || `AMS Slot A${amsSlotNumber}`;

    let chainingAction: string | undefined;
    if (idx >= 4) {
      const prevSlotIdx = idx - 4;
      const prevSpool = sorted[prevSlotIdx]?.spool.name || `Slot A${amsSlotNumber}`;
      const swapWindowLayer = sorted[prevSlotIdx].upToLayer + 1;
      chainingAction = `Single-AMS Chaining: After Layer ${swapWindowLayer} (${(baseLayerMm + (swapWindowLayer - 1) * layerHeightMm).toFixed(2)}mm), unload ${prevSpool} from Slot A${amsSlotNumber} and load ${slot.spool.name}.`;
    }

    items.push({
      slotIndex: idx + 1,
      spoolName: slot.spool.name,
      brand: slot.spool.brand,
      hex: slot.spool.hex,
      td: slot.spool.td,
      startLayer,
      endLayer,
      startZMm,
      endZMm,
      amsUnitSlot,
      chainingAction,
    });

    currentStartLayer = endLayer + 1;
  });

  return items;
}

/**
 * Generates a human-readable HueForge-compatible + Bambu/Orca enhanced instructions file (`TailWag_Swap_Playbook.txt`)
 */
export function generatePlaybookText(
  projectName: string,
  grid: HeightmapGrid,
  baseLayerMm: number,
  layerHeightMm: number,
  totalLayers: number,
  slots: LayerSwapSlot[]
): string {
  const playbook = buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers);
  const lines: string[] = [
    `===================================================================`,
    `🐕 TAILWAG STUDIO — 3D FILAMENT PAINTING & SLICER RECIPE PLAYBOOK`,
    `===================================================================`,
    `Project Name     : ${projectName}`,
    `Physical Size    : ${grid.widthMm.toFixed(1)} mm x ${grid.heightMm.toFixed(1)} mm`,
    `First Layer (Z0) : ${baseLayerMm.toFixed(2)} mm`,
    `Layer Height     : ${layerHeightMm.toFixed(2)} mm`,
    `Total Layers     : ${totalLayers} (Max Relief Z: ${(baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2)} mm)`,
    `Infill           : 100% Aligned Rectilinear | Wall Loops: 1`,
    `-------------------------------------------------------------------`,
    `FILAMENT PALETTE & TRANSMISSION DISTANCE (TD):`,
    ...playbook.map(
      (p) => `  [${p.slotIndex}] ${p.brand} - ${p.spoolName} (${p.hex}) | TD: ${p.td.toFixed(1)} mm | ${p.amsUnitSlot}`
    ),
    `-------------------------------------------------------------------`,
    `LAYER SWAP SCHEDULE (BAMBU STUDIO / ORCASLICER):`,
    ...playbook.map((p, idx) =>
      idx === 0
        ? `  • Start with ${p.brand} ${p.spoolName} (${p.hex}) at Layer 1 (${p.startZMm.toFixed(2)} mm) -> Print through Layer ${p.endLayer} (${p.endZMm.toFixed(2)} mm)`
        : `  • At Layer ${p.startLayer} (${p.startZMm.toFixed(2)} mm), swap to ${p.brand} ${p.spoolName} (${p.hex}) -> Print through Layer ${p.endLayer} (${p.endZMm.toFixed(2)} mm)`
    ),
  ];

  const chained = playbook.filter((p) => p.chainingAction);
  if (chained.length > 0) {
    lines.push(
      `-------------------------------------------------------------------`,
      `🔄 >4 COLOR SINGLE-AMS CHAINING PLAYBOOK:`,
      ...chained.map((c) => `  * ${c.chainingAction}`)
    );
  }

  lines.push(`===================================================================`);
  return lines.join('\n');
}

/**
 * Builds a single horizontal Z-band watertight sub-mesh (zFloor .. min(topZ, zCeil))
 * so each filament layer range in the 3MF is a true pre-colored Bambu Studio AMS part!
 */
function buildColorBandPartMesh(
  grid: HeightmapGrid,
  zFloor: number,
  zCeil: number,
  centerZ: number
): { verticesXml: string[]; trianglesXml: string[]; faceCount: number } {
  const { cols, rows, widthMm, heightMm, topZ, bottomZ } = grid;
  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const xAt = (c: number) => (c / (cols - 1)) * widthMm - halfW;
  const yAt = (r: number) => halfH - (r / (rows - 1)) * heightMm;

  // Compute clamped top and bottom Z for each grid cell within this horizontal filament band
  const bandTop = new Float32Array(cols * rows);
  const bandBot = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    if (topZ[i] <= 0) {
      bandTop[i] = -1;
      bandBot[i] = 0;
      continue;
    }
    const b = Math.max(bottomZ[i], zFloor);
    const t = Math.min(topZ[i], zCeil);
    if (t > b + 0.001) {
      bandBot[i] = b;
      bandTop[i] = t;
    } else {
      bandTop[i] = -1;
      bandBot[i] = 0;
    }
  }

  const topVertexIndex = new Int32Array(cols * rows).fill(-1);
  const botVertexIndex = new Int32Array(cols * rows).fill(-1);
  const verticesXml: string[] = [];
  const trianglesXml: string[] = [];
  let vCount = 0;

  const ensureTopVertex = (c: number, r: number): number => {
    const idx = r * cols + c;
    if (topVertexIndex[idx] !== -1) return topVertexIndex[idx];
    const vIdx = vCount++;
    topVertexIndex[idx] = vIdx;
    verticesXml.push(
      `     <vertex x="${xAt(c).toFixed(4)}" y="${yAt(r).toFixed(4)}" z="${(bandTop[idx] - centerZ).toFixed(4)}"/>`
    );
    return vIdx;
  };

  const ensureBotVertex = (c: number, r: number): number => {
    const idx = r * cols + c;
    if (botVertexIndex[idx] !== -1) return botVertexIndex[idx];
    const vIdx = vCount++;
    botVertexIndex[idx] = vIdx;
    verticesXml.push(
      `     <vertex x="${xAt(c).toFixed(4)}" y="${yAt(r).toFixed(4)}" z="${(bandBot[idx] - centerZ).toFixed(4)}"/>`
    );
    return vIdx;
  };

  const isValidCell = (c: number, r: number) => {
    if (c < 0 || c >= cols - 1 || r < 0 || r >= rows - 1) return false;
    const i00 = r * cols + c;
    const i10 = r * cols + (c + 1);
    const i01 = (r + 1) * cols + c;
    const i11 = (r + 1) * cols + (c + 1);
    return bandTop[i00] > 0 && bandTop[i10] > 0 && bandTop[i01] > 0 && bandTop[i11] > 0;
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (!isValidCell(c, r)) continue;

      const t00 = ensureTopVertex(c, r);
      const t10 = ensureTopVertex(c + 1, r);
      const t01 = ensureTopVertex(c, r + 1);
      const t11 = ensureTopVertex(c + 1, r + 1);

      const b00 = ensureBotVertex(c, r);
      const b10 = ensureBotVertex(c + 1, r);
      const b01 = ensureBotVertex(c, r + 1);
      const b11 = ensureBotVertex(c + 1, r + 1);

      // Top
      trianglesXml.push(`     <triangle v1="${t00}" v2="${t01}" v3="${t10}"/>`);
      trianglesXml.push(`     <triangle v1="${t10}" v2="${t01}" v3="${t11}"/>`);
      // Bottom
      trianglesXml.push(`     <triangle v1="${b00}" v2="${b10}" v3="${b01}"/>`);
      trianglesXml.push(`     <triangle v1="${b10}" v2="${b11}" v3="${b01}"/>`);

      // Perimeter / Hole Walls
      if (!isValidCell(c, r - 1)) {
        trianglesXml.push(`     <triangle v1="${b00}" v2="${t00}" v3="${t10}"/>`);
        trianglesXml.push(`     <triangle v1="${b00}" v2="${t10}" v3="${b10}"/>`);
      }
      if (!isValidCell(c, r + 1)) {
        trianglesXml.push(`     <triangle v1="${b11}" v2="${t11}" v3="${t01}"/>`);
        trianglesXml.push(`     <triangle v1="${b11}" v2="${t01}" v3="${b01}"/>`);
      }
      if (!isValidCell(c - 1, r)) {
        trianglesXml.push(`     <triangle v1="${b01}" v2="${t01}" v3="${t00}"/>`);
        trianglesXml.push(`     <triangle v1="${b01}" v2="${t00}" v3="${b00}"/>`);
      }
      if (!isValidCell(c + 1, r)) {
        trianglesXml.push(`     <triangle v1="${b10}" v2="${t10}" v3="${t11}"/>`);
        trianglesXml.push(`     <triangle v1="${b10}" v2="${t11}" v3="${b11}"/>`);
      }
    }
  }

  return {
    verticesXml,
    trianglesXml,
    faceCount: trianglesXml.length,
  };
}

/**
 * Compiles a 100% Bambu Studio 2.x / OrcaSlicer compliant Multi-Color .3MF Project Archive (.3mf ZIP)
 * using the exact Production Extension (`3D/Objects/object_1.model` + `Metadata/project_settings.config` +
 * `Metadata/model_settings.config` + `Metadata/slice_info.config` + `Metadata/cut_information.xml`)
 * with each horizontal TD color band pre-assigned to its AMS extruder slot!
 */
export function generateNative3mfPackage(params: {
  projectName: string;
  grid: HeightmapGrid;
  baseLayerMm: number;
  layerHeightMm: number;
  totalLayers: number;
  slots: LayerSwapSlot[];
}): Uint8Array {
  const { projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots } = params;
  const playbook = buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers);
  const playbookText = generatePlaybookText(projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots);

  // Compute max Z across the entire grid
  let maxGridZ = baseLayerMm + (totalLayers - 1) * layerHeightMm;
  for (let i = 0; i < grid.topZ.length; i++) {
    if (grid.topZ[i] > maxGridZ) maxGridZ = grid.topZ[i];
  }
  const halfZ = maxGridZ * 0.5;

  const objBlocks: string[] = [];
  const compEntries: string[] = [];
  const partConfigs: string[] = [];
  const assembleVolEntries: string[] = [];
  let totalFaces = 0;

  playbook.forEach((p, idx) => {
    const pid = idx + 1;
    const zFloor = idx === 0 ? 0.0 : playbook[idx - 1].endZMm;
    const zCeil = idx === playbook.length - 1 ? maxGridZ + 2.0 : p.endZMm;

    const bandMesh = buildColorBandPartMesh(grid, zFloor, zCeil, halfZ);
    if (bandMesh.faceCount === 0) return;

    totalFaces += bandMesh.faceCount;
    const uuidObj = `0001${pid.toString(16).padStart(4, '0')}-81cb-4c03-9d28-80fed5dfa1dc`;
    const uuidComp = `0001${idx.toString(16).padStart(4, '0')}-b206-40ff-9872-83e8017abed1`;
    const uuidPart = `0001${pid.toString(16).padStart(4, '0')}-7e6d-4931-9a9f-7218cba9de1c`;
    const safePartName = `Layer_${p.startLayer}_to_${p.endLayer}_${p.spoolName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    objBlocks.push(
      [
        `  <object id="${pid}" p:UUID="${uuidObj}" type="model">`,
        `   <mesh>`,
        `    <vertices>`,
        ...bandMesh.verticesXml,
        `    </vertices>`,
        `    <triangles>`,
        ...bandMesh.trianglesXml,
        `    </triangles>`,
        `   </mesh>`,
        `  </object>`,
      ].join('\n')
    );

    compEntries.push(
      `    <component p:path="/3D/Objects/object_1.model" objectid="${pid}" p:UUID="${uuidComp}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`
    );

    partConfigs.push(
      [
        `    <part id="${pid}" subtype="normal_part" uuid="${uuidPart}">`,
        `      <metadata key="name" value="${safePartName}"/>`,
        `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>`,
        `      <metadata key="source_file" value="${projectName}.3mf"/>`,
        `      <metadata key="source_object_id" value="0"/>`,
        `      <metadata key="source_volume_id" value="${idx}"/>`,
        `      <metadata key="source_offset_x" value="0.00000"/>`,
        `      <metadata key="source_offset_y" value="0.00000"/>`,
        `      <metadata key="source_offset_z" value="${halfZ.toFixed(5)}"/>`,
        `      <metadata key="extruder" value="${pid}"/>`,
        `      <mesh_stat face_count="${bandMesh.faceCount}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>`,
        `    </part>`,
      ].join('\n')
    );

    assembleVolEntries.push(
      `   <assemble_item object_id="${playbook.length + 1}" volume_id="${idx}" transform="1 0 0 0 1 0 0 0 1 0 0 0" />`
    );
  });

  const parentId = playbook.length + 1;
  const cleanTitle = projectName.replace(/[<>&"]/g, '');

  const objectModelXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ' <resources>',
    ...objBlocks,
    ' </resources>',
    ' <build/>',
    '</model>',
  ].join('\n');

  const rootModelXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">',
    ' <metadata name="Application">BambuStudio-02.08.02.61</metadata>',
    ' <metadata name="BambuStudio:3mfVersion">1</metadata>',
    ' <metadata name="CreationDate">2026-10-16</metadata>',
    ` <metadata name="Description">TailWag Studio 3D Filament Painting (${cleanTitle})</metadata>`,
    ' <metadata name="Designer">TailWag Studio / BoxerDawg 3D</metadata>',
    ' <metadata name="ModificationDate">2026-10-16</metadata>',
    ` <metadata name="ProfileTitle">${layerHeightMm.toFixed(2)}mm TailWag 100% Rectilinear TD Profile</metadata>`,
    ` <metadata name="Title">${cleanTitle}</metadata>`,
    ' <resources>',
    `  <object id="${parentId}" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">`,
    '   <components>',
    ...compEntries,
    '   </components>',
    '  </object>',
    ' </resources>',
    ' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">',
    `  <item objectid="${parentId}" p:UUID="00000005-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 128.0000 128.0000 ${halfZ.toFixed(5)}" printable="1"/>`,
    ' </build>',
    '</model>',
  ].join('\n');

  const filamentMapsStr = playbook.map(() => '1').join(' ');
  const filamentVolMapsStr = playbook.map(() => '0').join(' ');

  const modelSettingsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    `  <object id="${parentId}">`,
    `    <metadata key="name" value="${cleanTitle}"/>`,
    '    <metadata key="extruder" value="1"/>',
    `    <metadata face_count="${totalFaces}"/>`,
    ...partConfigs,
    '  </object>',
    '  <plate>',
    '    <metadata key="plater_id" value="1"/>',
    `    <metadata key="plater_name" value="${cleanTitle}"/>`,
    '    <metadata key="locked" value="false"/>',
    '    <metadata key="filament_map_mode" value="Auto For Flush"/>',
    `    <metadata key="filament_maps" value="${filamentMapsStr}"/>`,
    `    <metadata key="filament_volume_maps" value="${filamentVolMapsStr}"/>`,
    '    <model_instance>',
    `      <metadata key="object_id" value="${parentId}"/>`,
    '      <metadata key="instance_id" value="0"/>',
    '      <metadata key="identify_id" value="72"/>',
    '    </model_instance>',
    '  </plate>',
    '  <assemble>',
    `   <assemble_item object_id="${parentId}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0.0000 0.0000 ${halfZ.toFixed(5)}" offset="0 0 0" />`,
    ...assembleVolEntries,
    '  </assemble>',
    '</config>',
  ].join('\n');

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    ' <Default Extension="png" ContentType="image/png"/>',
    ' <Default Extension="gcode" ContentType="text/x.gcode"/>',
    '</Types>',
  ].join('\n');

  const rootRelsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    '</Relationships>',
  ].join('\n');

  const modelRelsXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ' <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    '</Relationships>',
  ].join('\n');

  const sliceInfoXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    '  <header>',
    '    <header_item key="X-BBL-Client-Type" value="slicer"/>',
    '    <header_item key="X-BBL-Client-Version" value="02.08.02.61"/>',
    '  </header>',
    '</config>',
  ].join('\n');

  const cutInfoXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<objects>',
    ' <object id="1">',
    '  <cut_id id="0" check_sum="1" connectors_cnt="0"/>',
    ' </object>',
    '</objects>',
  ].join('\n');

  const filamentSeqJson = JSON.stringify({
    plate_1: { nozzle_sequence: [], optimal_assignment: [], sequence: [] },
  });

  // Clone complete Bambu Studio 2.x project_settings.config template and apply filament palette & TD slicer rules
  const ps: Record<string, any> = JSON.parse(JSON.stringify(bambuProjectTemplate));
  const hexColors = playbook.map((p) => p.hex);
  const numFilaments = hexColors.length;

  // Resize all per-filament array properties in project_settings.config to match numFilaments
  for (const key of Object.keys(ps)) {
    if (Array.isArray(ps[key]) && ps[key].length === 4 && numFilaments !== 4) {
      const baseArr = ps[key];
      const resized: any[] = [];
      for (let i = 0; i < numFilaments; i++) {
        resized.push(baseArr[i % baseArr.length]);
      }
      ps[key] = resized;
    }
  }

  ps.filament_colour = hexColors;
  if ('default_filament_colour' in ps) {
    ps.default_filament_colour = hexColors;
  }
  ps.initial_layer_print_height = baseLayerMm.toFixed(2);
  ps.layer_height = layerHeightMm.toFixed(2);
  ps.sparse_infill_density = '100%';
  ps.sparse_infill_pattern = 'alignedrectilinear';
  ps.wall_loops = '1';
  ps.top_shell_layers = '3';
  ps.bottom_shell_layers = '3';
  ps.enable_support = '0';
  ps.brim_type = 'no_brim';
  ps.enable_prime_tower = '1';

  const archiveFiles: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(rootRelsXml),
    '3D/3dmodel.model': strToU8(rootModelXml),
    '3D/_rels/3dmodel.model.rels': strToU8(modelRelsXml),
    '3D/Objects/object_1.model': strToU8(objectModelXml),
    'Metadata/project_settings.config': strToU8(JSON.stringify(ps, null, 4)),
    'Metadata/model_settings.config': strToU8(modelSettingsXml),
    'Metadata/slice_info.config': strToU8(sliceInfoXml),
    'Metadata/cut_information.xml': strToU8(cutInfoXml),
    'Metadata/filament_sequence.json': strToU8(filamentSeqJson),
    'Metadata/TailWag_Swap_Playbook.txt': strToU8(playbookText),
  };

  return zipSync(archiveFiles, { level: 6 });
}
