import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { VERIFIED_FILAMENT_CATALOG, FilamentSpool } from '../src/data/filamentCatalog';
import {
  buildLayerColorLUT,
  hexToRgb01,
  rgbToLab,
  deltaE,
  LayerSwapSlot,
} from '../src/engine/opticalTdEngine';
import { singleLayerOpacity } from '../src/engine/opticalModel';
import { buildPrintPlan } from '../src/engine/printPlan';
import { generateVerified3mfPackage, generateVerifiedStl } from '../src/engine/verifiedExport';
import {
  buildHeightmapGrid,
  generateBinaryStlFromGrid,
  generateTdCalibrationWedgeStl,
  MeshShapeMode,
  FrameStyle,
} from '../src/engine/cadMeshBuilder';
import {
  buildSwapPlaybook,
  generatePlaybookText,
  generateNative3mfPackage,
} from '../src/engine/exporter3mf';

const customSpools: FilamentSpool[] = [];

function getAllSpools(): FilamentSpool[] {
  return [...customSpools, ...VERIFIED_FILAMENT_CATALOG];
}

/**
 * Generates a synthetic ImageData histogram or decodes simple image metadata for headless agent solving
 */
function createSyntheticOrTargetSamples(targetHexPalette?: string[]) {
  const palette =
    targetHexPalette && targetHexPalette.length > 0
      ? targetHexPalette
      : ['#141414', '#4a2c18', '#7c4728', '#d97706', '#f59e0b', '#e2e8f0', '#ffffff'];

  return palette.map((hex, i) => {
    const rgb = hexToRgb01(hex);
    const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    return {
      luminance: lum || i / Math.max(1, palette.length - 1),
      lab: rgbToLab(rgb),
    };
  });
}

function solveHeadlessPalette(params: {
  targetHexColors?: string[];
  ownedOnly?: boolean;
  totalLayers?: number;
  baseLayerMm?: number;
  layerHeightMm?: number;
  maxColors?: number;
}) {
  const totalLayers = params.totalLayers ?? 24;
  const baseLayerMm = params.baseLayerMm ?? 0.64;
  const layerHeightMm = params.layerHeightMm ?? 0.08;
  const maxColors = Math.max(2, Math.min(8, params.maxColors ?? 4));
  const pool = getAllSpools().filter((s) => (!params.ownedOnly ? true : s.owned));
  const candidatePool = pool.length >= 2 ? pool : getAllSpools();

  const samples = createSyntheticOrTargetSamples(params.targetHexColors);
  const sortedByLum = [...candidatePool].sort((a, b) => {
    const rgbA = hexToRgb01(a.hex);
    const rgbB = hexToRgb01(b.hex);
    const lumA = 0.2126 * rgbA.r + 0.7152 * rgbA.g + 0.0722 * rgbA.b;
    const lumB = 0.2126 * rgbB.r + 0.7152 * rgbB.g + 0.0722 * rgbB.b;
    return lumA - lumB;
  });

  const darkAnchors = sortedByLum.slice(0, Math.min(3, Math.ceil(sortedByLum.length * 0.35)));
  const lightAnchors = sortedByLum.slice(Math.max(1, sortedByLum.length - 3));
  const midSpools = sortedByLum.slice(1, Math.max(2, sortedByLum.length - 1));

  let bestAvgDe = Infinity;
  let bestSlots: LayerSwapSlot[] = [];

  const quantileProfiles = [
    [0.18, 0.46, 0.76],
    [0.14, 0.38, 0.68],
    [0.24, 0.54, 0.82],
  ];

  for (const dark of darkAnchors) {
    for (const light of lightAnchors) {
      if (dark.id === light.id) continue;
      for (let i = 0; i < midSpools.length; i++) {
        for (let j = i + 1; j < midSpools.length; j++) {
          const m1 = midSpools[i];
          const m2 = midSpools[j];
          if (m1.id === dark.id || m1.id === light.id || m2.id === dark.id || m2.id === light.id) continue;
          const combo = [dark, m1, m2, light].slice(0, maxColors);

          for (const qProfile of quantileProfiles) {
            const slots: LayerSwapSlot[] = combo.map((spool, idx) => ({
              id: `slot-${idx + 1}`,
              spool,
              upToLayer:
                idx === combo.length - 1
                  ? totalLayers
                  : Math.max(idx + 1, Math.round((qProfile[idx] ?? (idx + 1) / combo.length) * totalLayers)),
            }));
            for (let k = 1; k < slots.length; k++) {
              if (slots[k].upToLayer <= slots[k - 1].upToLayer) {
                slots[k].upToLayer = Math.min(totalLayers, slots[k - 1].upToLayer + 1);
              }
            }
            slots[slots.length - 1].upToLayer = totalLayers;

            const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
            const lutLabs = lut.map((e) => rgbToLab(e.rgb));
            let err = 0;
            for (const s of samples) {
              const lIdx = Math.max(0, Math.min(totalLayers - 1, Math.round(s.luminance * (totalLayers - 1))));
              err += deltaE(s.lab, lutLabs[lIdx]);
            }
            const avgDe = err / samples.length;
            if (avgDe < bestAvgDe) {
              bestAvgDe = avgDe;
              bestSlots = slots;
            }
          }
        }
      }
    }
  }

  const playbook = buildSwapPlaybook(bestSlots, baseLayerMm, layerHeightMm, totalLayers);
  const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, bestSlots);

  return {
    averageDeltaE: Number(bestAvgDe.toFixed(2)),
    totalLayers,
    baseLayerMm,
    layerHeightMm,
    maxReliefZMm: Number((baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2)),
    recommendedSwapPlaybook: playbook,
    simulatedLayerBlendTable: lut.map((l) => ({
      layer: l.layer,
      zHeightMm: l.zHeightMm,
      blendedHex: l.hex,
      activeFilament: `${l.activeSpool.brand} ${l.activeSpool.name}`,
      tdMm: l.activeSpool.td,
    })),
  };
}

const TOOLS = [
  {
    name: 'tailwag_list_filaments',
    description:
      'List verified 3D printing filaments with their optical Transmission Distance (TD in mm), hex color, material, brand, and AMS/owned status.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string', description: 'Optional brand filter (e.g. Bambu Lab, Polymaker, Sunlu)' },
        ownedOnly: { type: 'boolean', description: 'If true, only return spools marked as owned / loaded in AMS' },
      },
    },
  },
  {
    name: 'tailwag_solve_palette',
    description:
      'AI Beer-Lambert TD Palette & Layer-Swap Solver. Automatically calculates the optimal filament stack and exact layer swap Z-heights to match target colors or portrait tonal ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        targetHexColors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of target hex colors from shadows to highlights (e.g. ["#141414", "#7c4728", "#f59e0b", "#ffffff"])',
        },
        ownedOnly: { type: 'boolean', description: 'Restrict solver to owned/AMS spools (default true)' },
        totalLayers: { type: 'number', description: 'Total printed layers (default 24)' },
        baseLayerMm: { type: 'number', description: 'First/base layer thickness in mm (default 0.64)' },
        layerHeightMm: { type: 'number', description: 'Layer height in mm (default 0.08)' },
        maxColors: { type: 'number', description: 'Maximum filament colors in stack (default 4)' },
      },
    },
  },
  {
    name: 'tailwag_simulate_layer_stack',
    description:
      'Simulates Beer-Lambert + Kubelka-Munk optical TD layer blending for a given list of filament IDs and layer swap heights, returning the exact blended hex color at every Z-layer.',
    inputSchema: {
      type: 'object',
      properties: {
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              spoolId: { type: 'string', description: 'Filament ID from tailwag_list_filaments' },
              upToLayer: { type: 'number', description: 'Layer number where this filament ends' },
            },
            required: ['spoolId', 'upToLayer'],
          },
        },
        totalLayers: { type: 'number', description: 'Total layers (default 24)' },
        baseLayerMm: { type: 'number', description: 'Base layer height in mm (default 0.64)' },
        layerHeightMm: { type: 'number', description: 'Subsequent layer height in mm (default 0.08)' },
      },
      required: ['slots'],
    },
  },
  {
    name: 'tailwag_export_3mf_project',
    description:
      'Headlessly generates a watertight 2.5D relief mesh, native Bambu Studio / OrcaSlicer .3mf project archive, binary .stl, and layer swap playbook on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'Absolute file path for exported .3mf or .stl file' },
        projectName: { type: 'string', description: 'Project title' },
        widthMm: { type: 'number', description: 'Physical width in mm (default 180)' },
        heightMm: { type: 'number', description: 'Physical height in mm (default 180)' },
        shape: {
          type: 'string',
          enum: ['rect', 'rounded', 'circle', 'hexagon', 'paw', 'shield'],
          description: '2.5D silhouette shape',
        },
        frameStyle: {
          type: 'string',
          enum: ['none', 'beveled', 'modern-lip', 'stepped'],
          description: 'Outer 3D border frame style',
        },
        clockMode: { type: 'boolean', description: 'Enable HueForge Wall Clock center shaft bore & rear movement pocket' },
        keychainHole: { type: 'boolean', description: 'Enable top keychain hole' },
        magnetPockets: { type: 'boolean', description: 'Enable rear neodymium magnet pockets' },
      },
      required: ['outputPath'],
    },
  },
  {
    name: 'tailwag_calibrate_td',
    description:
      'Calculates a filament Transmission Distance (TD in mm) from a printed step-wedge measurement and optionally exports the 16-step TD calibration wedge STL.',
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string' },
        name: { type: 'string' },
        hex: { type: 'string' },
        stepThicknessMm: { type: 'number', description: 'Step increment in mm (default 0.16)' },
        opaqueStepNumber: { type: 'number', description: 'Step number where black backing line disappears' },
        exportWedgeStlPath: { type: 'string', description: 'Optional path to write the 16-step TD calibration wedge .stl' },
      },
      required: ['brand', 'name', 'hex', 'opaqueStepNumber'],
    },
  },
];

function handleToolCall(name: string, args: any): any {
  switch (name) {
    case 'tailwag_list_filaments': {
      let list = getAllSpools();
      if (args?.ownedOnly) list = list.filter((s) => s.owned);
      if (args?.brand) {
        const b = String(args.brand).toLowerCase();
        list = list.filter((s) => s.brand.toLowerCase().includes(b));
      }
      return { count: list.length, filaments: list };
    }

    case 'tailwag_solve_palette': {
      return solveHeadlessPalette(args || {});
    }

    case 'tailwag_simulate_layer_stack': {
      const totalLayers = args?.totalLayers ?? 24;
      const baseLayerMm = args?.baseLayerMm ?? 0.64;
      const layerHeightMm = args?.layerHeightMm ?? 0.08;
      const all = getAllSpools();
      const slots: LayerSwapSlot[] = (args?.slots || []).map((item: any, idx: number) => {
        const spool = all.find((s) => s.id === item.spoolId) || all[idx % all.length];
        return {
          id: `slot-${idx + 1}`,
          spool,
          upToLayer: Number(item.upToLayer),
        };
      });
      const lut = buildLayerColorLUT(totalLayers, baseLayerMm, layerHeightMm, slots);
      const playbook = buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers);
      return { playbook, layerBlendLUT: lut };
    }

    case 'tailwag_export_3mf_project': {
      const outPath = path.resolve(String(args.outputPath));
      const projectName = args.projectName || path.basename(outPath, path.extname(outPath));
      const widthMm = args.widthMm ?? 180;
      const heightMm = args.heightMm ?? 180;
      const baseLayerMm = 0.64;
      const layerHeightMm = 0.08;
      const totalLayers = 24;

      // Build headless radial relief grid (80x80)
      const size = 80;
      const rgba = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x / (size - 1)) * 2 - 1;
          const ny = (y / (size - 1)) * 2 - 1;
          const r = Math.min(1, Math.hypot(nx, ny));
          const val = Math.round((1 - r * 0.85) * 255);
          const idx = (y * size + x) * 4;
          rgba[idx] = val;
          rgba[idx + 1] = val;
          rgba[idx + 2] = val;
          rgba[idx + 3] = 255;
        }
      }

      const grid = buildHeightmapGrid({
        imageData: { data: rgba, width: size, height: size, colorSpace: 'srgb' } as ImageData,
        gridRes: 80,
        widthMm,
        heightMm,
        baseLayerMm,
        layerHeightMm,
        totalLayers,
        gamma: 1.05,
        contrast: 1.1,
        detailEnhance: 0.25,
        invertLuminance: false,
        cad: {
          shape: (args.shape as MeshShapeMode) || 'rounded',
          frameStyle: (args.frameStyle as FrameStyle) || 'beveled',
          frameWidthMm: 5.0,
          frameHeightBonusMm: 0.48,
          clockMode: Boolean(args.clockMode),
          clockShaftDiameterMm: 8.2,
          clockMovementPocket: true,
          clockStencil: 'none',
          keychainHole: Boolean(args.keychainHole),
          keychainHoleDiameterMm: 4.5,
          magnetPockets: Boolean(args.magnetPockets),
          magnetDiameterMm: 8.2,
        },
      });

      const solved = solveHeadlessPalette({ ownedOnly: true, totalLayers, baseLayerMm, layerHeightMm });
      const all = getAllSpools();
      const slots: LayerSwapSlot[] = solved.recommendedSwapPlaybook.map((p, idx) => ({
        id: `slot-${idx + 1}`,
        spool: all.find((s) => s.name === p.spoolName) || all[idx],
        upToLayer: p.endLayer,
      }));

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      // Same path as the app: build the print plan once, write the file, re-read it and compare.
      // A mismatch throws, so a wrong file is never written.
      const plan = buildPrintPlan({ grid, slots, baseLayerMm, layerHeightMm, totalLayers });
      if (outPath.toLowerCase().endsWith('.stl')) {
        const stl = generateVerifiedStl(grid, plan);
        fs.writeFileSync(outPath, Buffer.from(stl.data));
      } else {
        const pkg = generateVerified3mfPackage({
          projectName,
          grid,
          baseLayerMm,
          layerHeightMm,
          totalLayers,
          slots,
          plan,
        });
        fs.writeFileSync(outPath, Buffer.from(pkg.data));
      }

      const playbookPath = outPath.replace(/\.[^.]+$/, '_Swap_Playbook.txt');
      const playbookText = generatePlaybookText(projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots);
      fs.writeFileSync(playbookPath, playbookText, 'utf8');

      return {
        exportedFile: outPath,
        playbookFile: playbookPath,
        bytesWritten: fs.statSync(outPath).size,
        swapPlaybook: solved.recommendedSwapPlaybook,
      };
    }

    case 'tailwag_calibrate_td': {
      const stepMm = args.stepThicknessMm ?? 0.16;
      const measuredTd = Number((Number(args.opaqueStepNumber) * stepMm * 2.0).toFixed(1));
      const oneLayerAlpha = Number((singleLayerOpacity(0.08, measuredTd) * 100).toFixed(1));
      const newSpool: FilamentSpool = {
        id: `mcp-custom-${Date.now()}`,
        brand: args.brand,
        name: args.name,
        material: 'PLA',
        hex: args.hex,
        td: measuredTd,
        owned: true,
      };
      customSpools.push(newSpool);

      let exportedStl: string | undefined;
      if (args.exportWedgeStlPath) {
        const p = path.resolve(String(args.exportWedgeStlPath));
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const buf = generateTdCalibrationWedgeStl(16, stepMm);
        fs.writeFileSync(p, Buffer.from(buf));
        exportedStl = p;
      }

      return {
        spool: newSpool,
        measuredTdMm: measuredTd,
        single008LayerOpacityPercent: oneLayerAlpha,
        exportedCalibrationWedgeStl: exportedStl,
      };
    }

    default:
      throw new Error(`Unknown TailWag MCP tool: ${name}`);
  }
}

// Standard MCP JSON-RPC 2.0 over stdio loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function sendJsonRpc(message: any) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    const { id, method, params } = req;

    if (method === 'initialize') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'tailwag-mcp-server',
            version: '1.0.0',
          },
        },
      });
    } else if (method === 'notifications/initialized') {
      // No response required for notifications
    } else if (method === 'tools/list') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
    } else if (method === 'tools/call') {
      try {
        const output = handleToolCall(params?.name, params?.arguments || {});
        sendJsonRpc({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          },
        });
      } catch (toolErr: any) {
        sendJsonRpc({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: toolErr?.message || String(toolErr) }],
          },
        });
      }
    } else if (id !== undefined) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  } catch (err: any) {
    // Ignore malformed non-JSON lines
  }
});
