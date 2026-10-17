import { zipSync, strToU8 } from 'fflate';
import { HeightmapGrid } from './cadMeshBuilder';
import { LayerSwapSlot } from './opticalTdEngine';

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
 * Compiles a native Bambu Studio / OrcaSlicer .3MF Project Archive (.3mf ZIP)
 * with embedded mesh vertices/triangles, filament palette colors, 100% infill overrides,
 * and layer-by-layer swap instructions.
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
  const { cols, rows, widthMm, heightMm, topZ, bottomZ } = grid;

  // Build indexed vertex + triangle arrays for 3D/3dmodel.model XML
  const halfW = widthMm / 2;
  const halfH = heightMm / 2;
  const xAt = (c: number) => (c / (cols - 1)) * widthMm - halfW;
  const yAt = (r: number) => halfH - (r / (rows - 1)) * heightMm;

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
    verticesXml.push(`<vertex x="${xAt(c).toFixed(3)}" y="${yAt(r).toFixed(3)}" z="${topZ[idx].toFixed(3)}" />`);
    return vIdx;
  };

  const ensureBotVertex = (c: number, r: number): number => {
    const idx = r * cols + c;
    if (botVertexIndex[idx] !== -1) return botVertexIndex[idx];
    const vIdx = vCount++;
    botVertexIndex[idx] = vIdx;
    verticesXml.push(`<vertex x="${xAt(c).toFixed(3)}" y="${yAt(r).toFixed(3)}" z="${bottomZ[idx].toFixed(3)}" />`);
    return vIdx;
  };

  const isValidCell = (c: number, r: number) => {
    if (c < 0 || c >= cols - 1 || r < 0 || r >= rows - 1) return false;
    const i00 = r * cols + c;
    const i10 = r * cols + (c + 1);
    const i01 = (r + 1) * cols + c;
    const i11 = (r + 1) * cols + (c + 1);
    return topZ[i00] > 0 && topZ[i10] > 0 && topZ[i01] > 0 && topZ[i11] > 0;
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
      trianglesXml.push(`<triangle v1="${t00}" v2="${t01}" v3="${t10}" />`);
      trianglesXml.push(`<triangle v1="${t10}" v2="${t01}" v3="${t11}" />`);
      // Bottom
      trianglesXml.push(`<triangle v1="${b00}" v2="${b10}" v3="${b01}" />`);
      trianglesXml.push(`<triangle v1="${b10}" v2="${b11}" v3="${b01}" />`);

      // Perimeter / Hole Walls
      if (!isValidCell(c, r - 1)) {
        trianglesXml.push(`<triangle v1="${b00}" v2="${t00}" v3="${t10}" />`);
        trianglesXml.push(`<triangle v1="${b00}" v2="${t10}" v3="${b10}" />`);
      }
      if (!isValidCell(c, r + 1)) {
        trianglesXml.push(`<triangle v1="${b11}" v2="${t11}" v3="${t01}" />`);
        trianglesXml.push(`<triangle v1="${b11}" v2="${t01}" v3="${b01}" />`);
      }
      if (!isValidCell(c - 1, r)) {
        trianglesXml.push(`<triangle v1="${b01}" v2="${t01}" v3="${t00}" />`);
        trianglesXml.push(`<triangle v1="${b01}" v2="${t00}" v3="${b00}" />`);
      }
      if (!isValidCell(c + 1, r)) {
        trianglesXml.push(`<triangle v1="${b10}" v2="${t10}" v3="${t11}" />`);
        trianglesXml.push(`<triangle v1="${b10}" v2="${t11}" v3="${b11}" />`);
      }
    }
  }

  const playbook = buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers);
  const playbookText = generatePlaybookText(projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots);

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="config" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="txt" ContentType="text/plain" />
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
  <metadata name="Application">TailWag Studio v1.0 (BoxerDawg 3D)</metadata>
  <metadata name="Title">${projectName}</metadata>
  <metadata name="Description">${playbookText.replace(/[<>&"]/g, '')}</metadata>
  <resources>
    <object id="1" name="${projectName}" type="model">
      <mesh>
        <vertices>
          ${verticesXml.join('\n          ')}
        </vertices>
        <triangles>
          ${trianglesXml.join('\n          ')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1" />
  </build>
</model>`;

  // Bambu Studio / OrcaSlicer project_settings.config with pre-mapped filament colours & layer height rules
  const projectSettingsJson = JSON.stringify(
    {
      name: projectName,
      generator: 'TailWag Studio v1.0',
      initial_layer_print_height: baseLayerMm.toFixed(2),
      layer_height: layerHeightMm.toFixed(2),
      sparse_infill_density: '100%',
      sparse_infill_pattern: 'alignedrectilinear',
      wall_loops: '1',
      top_shell_layers: '3',
      bottom_shell_layers: '3',
      filament_colour: playbook.map((p) => p.hex),
      filament_type: playbook.map(() => 'PLA'),
      filament_settings_id: playbook.map((p) => `${p.brand} ${p.spoolName} (TD ${p.td}mm)`),
      tailwag_layer_swaps: playbook,
    },
    null,
    2
  );

  // Height range color painting config for Bambu Studio / OrcaSlicer
  const customHeightRangeXml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="${projectName}" />
    <metadata key="extruder" value="1" />
    ${playbook
      .map(
        (p) =>
          `<range min_z="${p.startZMm.toFixed(2)}" max_z="${p.endZMm.toFixed(2)}" extruder="${p.slotIndex}" filament="${p.spoolName}" hex="${p.hex}" td="${p.td}" />`
      )
      .join('\n    ')}
  </object>
</config>`;

  const archiveFiles: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(relsXml),
    '3D/3dmodel.model': strToU8(modelXml),
    'Metadata/project_settings.config': strToU8(projectSettingsJson),
    'Metadata/model_settings.config': strToU8(customHeightRangeXml),
    'Metadata/TailWag_Swap_Playbook.txt': strToU8(playbookText),
  };

  return zipSync(archiveFiles, { level: 6 });
}
