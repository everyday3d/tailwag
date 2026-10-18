import { zipSync, strToU8 } from 'fflate';
import { HeightmapGrid, generateBinaryStlFromGrid } from './cadMeshBuilder';
import { LayerSwapSlot } from './opticalTdEngine';
import {
  PrintPlan,
  buildPrintPlan,
  computeBands,
  layerTopZ,
  serializePlanSummary,
  shortPlanHash,
} from './printPlan';
import { buildPrintMetadata, serializePrintMetadata } from './printMetadata';
import { buildColorBandPartMesh } from './bandMesh';
import { PINNED_SLICER_SETTINGS, layerSettingsFor } from './slicerSettings';
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
  // Band boundaries and Z values come from the PrintPlan logic so guides, the 3MF and the viewport agree.
  const bands = computeBands(slots, baseLayerMm, layerHeightMm, totalLayers);
  const items: SwapInstructionItem[] = [];

  bands.forEach((band, idx) => {
    const slot = sorted[idx];
    const amsSlotNumber = (idx % 4) + 1;
    const amsUnitSlot = slot.spool.amsSlot || `AMS Slot A${amsSlotNumber}`;

    let chainingAction: string | undefined;
    if (idx >= 4) {
      const prevSlotIdx = idx - 4;
      const prevSpool = sorted[prevSlotIdx]?.spool.name || `Slot A${amsSlotNumber}`;
      const swapWindowLayer = sorted[prevSlotIdx].upToLayer + 1;
      chainingAction = `Single-AMS Chaining: After Layer ${swapWindowLayer} (${layerTopZ(swapWindowLayer, baseLayerMm, layerHeightMm).toFixed(2)}mm), unload ${prevSpool} from Slot A${amsSlotNumber} and load ${slot.spool.name}.`;
    }

    items.push({
      slotIndex: band.slotIndex,
      spoolName: band.spoolName,
      brand: band.brand,
      hex: band.hex,
      td: band.td,
      startLayer: band.startLayer,
      endLayer: band.endLayer,
      startZMm: band.startZMm,
      endZMm: band.endZMm,
      amsUnitSlot,
      chainingAction,
    });
  });

  return items;
}

/**
 * Generates a human-readable HueForge-compatible + Single-Extruder (No-AMS) & Bambu/Orca instructions file (`TailWag_Swap_Playbook.txt`)
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
  const pauseLayersSummary =
    playbook.length > 1
      ? playbook
          .slice(1)
          .map((p) => `Layer ${p.startLayer} (${p.startZMm.toFixed(2)} mm -> ${p.spoolName})`)
          .join(', ')
      : 'None (Single Color)';

  const lines: string[] = [
    `===================================================================`,
    `🐕 TAILWAG STUDIO — 3D FILAMENT PAINTING & SLICER RECIPE PLAYBOOK`,
    `===================================================================`,
    `Project Name     : ${projectName}`,
    `STL Model File   : ${projectName}_TailWag_rev1.stl`,
    `Physical Size    : ${grid.widthMm.toFixed(1)} mm x ${grid.heightMm.toFixed(1)} mm`,
    `First Layer (Z0) : ${baseLayerMm.toFixed(2)} mm`,
    `Layer Height     : ${layerHeightMm.toFixed(2)} mm`,
    `Total Layers     : ${totalLayers} (Max Relief Z: ${(baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2)} mm)`,
    `Infill           : 100% Aligned Rectilinear | Wall Loops: 1 | Top/Bottom Shells: 999`,
    `IMPORTANT        : Do NOT scale Z-height in your slicer (keep Z at 100%).`,
    `-------------------------------------------------------------------`,
    `FILAMENT PALETTE & TRANSMISSION DISTANCE (TD):`,
    ...playbook.map(
      (p) => `  [#${p.slotIndex}] ${p.brand} - ${p.spoolName} (${p.hex}) | TD: ${p.td.toFixed(1)} mm | Layers ${p.startLayer}–${p.endLayer} (${p.startZMm.toFixed(2)}–${p.endZMm.toFixed(2)} mm)`
    ),
    `-------------------------------------------------------------------`,
    `🛠️ SINGLE-EXTRUDER / NO-AMS MANUAL PAUSE & COLOR CHANGE SCHEDULE:`,
    `  Exact Slicer Pause Layers: ${pauseLayersSummary}`,
    ...playbook.map((p, idx) =>
      idx === 0
        ? `  [START PRINT - Layer 1 (${p.startZMm.toFixed(2)} mm)] Load #1 ${p.brand} ${p.spoolName} (${p.hex}) before starting print -> Prints Layers 1 to ${p.endLayer} (${p.endZMm.toFixed(2)} mm)`
        : `  [PAUSE #${idx} - Layer ${p.startLayer} (${p.startZMm.toFixed(2)} mm)] Add Slicer Pause / Color Change (M600) at Layer ${p.startLayer} -> Unload ${playbook[idx - 1].spoolName}, Load #${p.slotIndex} ${p.brand} ${p.spoolName} (${p.hex}) -> Prints Layers ${p.startLayer} to ${p.endLayer} (${p.endZMm.toFixed(2)} mm)`
    ),
    `-------------------------------------------------------------------`,
    `HOW TO PRINT ON A SINGLE-HEAD PRINTER (NO AMS) USING THE .STL FILE:`,
    `  1. Load "${projectName}_TailWag_rev1.stl" into your slicer (Bambu Studio, OrcaSlicer, PrusaSlicer, or Cura).`,
    `  2. Set First/Initial Layer Height = ${baseLayerMm.toFixed(2)} mm and Layer Height = ${layerHeightMm.toFixed(2)} mm.`,
    `  3. Set Infill = 100% Rectilinear (or 999 Top/Bottom Solid Layers) and Wall Loops = 1.`,
    `  4. Slice the plate, then use the right-hand vertical Layer Preview Slider to add a "Pause" or "Change Filament (M600)" at:`,
    ...playbook
      .slice(1)
      .map(
        (p) =>
          `     -> Layer ${p.startLayer} (Z = ${p.startZMm.toFixed(2)} mm): Swap to ${p.brand} ${p.spoolName} (${p.hex})`
      ),
    `  5. Start the print with ${playbook[0]?.brand || ''} ${playbook[0]?.spoolName || ''} loaded. Each time the printer pauses, swap to the next filament listed above and press Resume!`,
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
 * Generates a self-contained, interactive HTML instruction guide (`${projectName}_Color_Change_Guide.html`)
 * explaining how any user with a Single-Head Printer and NO AMS can print the exported `.STL` file
 * via layer pausing and manual filament color changes in their slicer of choice.
 */
export function generateSingleExtruderHtmlGuide(
  projectName: string,
  grid: HeightmapGrid,
  baseLayerMm: number,
  layerHeightMm: number,
  totalLayers: number,
  slots: LayerSwapSlot[]
): string {
  const playbook = buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers);
  const maxZ = (baseLayerMm + (totalLayers - 1) * layerHeightMm).toFixed(2);
  const pauseItems = playbook.slice(1);
  const pauseLayersInline =
    pauseItems.length > 0
      ? pauseItems.map((p) => `Layer ${p.startLayer} (${p.startZMm.toFixed(2)}mm)`).join(', ')
      : 'No pauses needed (1 color)';

  const rowsHtml = playbook
    .map((p, idx) => {
      const isStart = idx === 0;
      const prev = idx > 0 ? playbook[idx - 1] : null;
      const layerCount = Math.max(1, p.endLayer - p.startLayer + 1);
      return `
        <tr>
          <td style="text-align:center;">
            <input type="checkbox" style="width:18px;height:18px;accent-color:#f97316;cursor:pointer;" title="Mark step complete" />
          </td>
          <td>
            ${
              isStart
                ? `<span class="badge badge-start">START PRINT • LAYER 1</span>`
                : `<span class="badge badge-pause">PAUSE #${idx} • LAYER ${p.startLayer}</span>`
            }
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;font-family:monospace;">
              Z-Height: <strong style="color:#f8fafc;">${p.startZMm.toFixed(2)} mm</strong>
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="swatch" style="background:${p.hex};"></span>
              <div>
                <div style="font-weight:700;color:#ffffff;font-size:14px;">#${p.slotIndex}: ${p.brand} — ${p.spoolName}</div>
                <div style="font-size:12px;color:#cbd5e1;font-family:monospace;">Hex: ${p.hex} • TD: ${p.td.toFixed(1)} mm</div>
              </div>
            </div>
          </td>
          <td style="font-family:monospace;font-size:13px;color:#34d399;font-weight:700;">
            Layer ${p.startLayer} &rarr; Layer ${p.endLayer}
            <div style="font-size:11px;color:#94a3b8;font-weight:400;">
              ${p.startZMm.toFixed(2)} mm – ${p.endZMm.toFixed(2)} mm (${layerCount} ${layerCount === 1 ? 'layer' : 'layers'})
            </div>
          </td>
          <td style="font-size:13px;color:#e2e8f0;line-height:1.45;">
            ${
              isStart
                ? `<strong>Load before starting print:</strong> Load <strong>${p.brand} ${p.spoolName}</strong> onto your printer and start the print. It will print the base from Layer 1 through Layer ${p.endLayer}.`
                : `<strong>Pause at start of Layer ${p.startLayer} (${p.startZMm.toFixed(2)} mm):</strong> Unload <em>${prev?.spoolName}</em>, load <strong>${p.brand} ${p.spoolName}</strong>, purge until clean, and press <strong>Resume</strong>.`
            }
          </td>
        </tr>`;
    })
    .join('\n');

  const pausePillsHtml = pauseItems
    .map(
      (p) => `
      <div class="pause-pill">
        <span class="swatch-sm" style="background:${p.hex};"></span>
        <span><strong>Pause at Layer ${p.startLayer}</strong> (${p.startZMm.toFixed(2)} mm) &rarr; Switch to <strong>${p.spoolName}</strong> (${p.hex})</span>
      </div>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName} — Single-Extruder (No-AMS) STL Layer Pause & Color Change Guide</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 18px 60px;
      background: #0b0e14;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      line-height: 1.5;
    }
    .container {
      max-width: 980px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 22px;
    }
    .card {
      background: #121722;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 22px;
      box-shadow: 0 12px 28px rgba(0,0,0,0.35);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 22px;
      color: #ffffff;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #fb923c;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 14px;
      margin: 0;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .stat-box {
      background: #181f2e;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
    }
    .stat-value {
      font-size: 17px;
      font-weight: 800;
      color: #f8fafc;
      font-family: monospace;
      margin-top: 2px;
    }
    .warning-banner {
      margin-top: 14px;
      padding: 12px 16px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.4);
      color: #fde68a;
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th, td {
      padding: 13px 12px;
      text-align: left;
      border-bottom: 1px solid #1e293b;
      vertical-align: middle;
    }
    th {
      background: #181f2e;
      color: #94a3b8;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    tr:hover td {
      background: rgba(255,255,255,0.02);
    }
    .swatch {
      display: inline-block;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.45);
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .swatch-sm {
      display: inline-block;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 1.5px solid rgba(255,255,255,0.5);
      flex-shrink: 0;
    }
    .badge {
      display: inline-block;
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 800;
      font-family: monospace;
      letter-spacing: 0.03em;
    }
    .badge-start {
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.45);
    }
    .badge-pause {
      background: rgba(249, 115, 22, 0.22);
      color: #fdba74;
      border: 1px solid rgba(249, 115, 22, 0.5);
    }
    .pause-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }
    .pause-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #181f2e;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
    }
    .slicer-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }
    .slicer-card {
      background: #181f2e;
      border: 1px solid #283548;
      border-radius: 10px;
      padding: 16px;
    }
    .slicer-card h3 {
      margin: 0 0 8px;
      font-size: 14px;
      color: #38bdf8;
    }
    .slicer-card ol {
      margin: 0;
      padding-left: 18px;
      font-size: 13px;
      color: #cbd5e1;
    }
    .slicer-card li {
      margin-bottom: 6px;
    }
    @media print {
      body { background: #ffffff; color: #0f172a; padding: 0; }
      .card, .stat-box, .slicer-card, .pause-pill { background: #ffffff; border-color: #cbd5e1; color: #0f172a; box-shadow: none; }
      h1, .stat-value, td div { color: #0f172a !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>🐕 TailWag Studio — Single-Extruder (No-AMS) .STL Print &amp; Layer Pause Guide</h1>
      <p class="subtitle">
        Project: <strong>${projectName}</strong> • Model File: <code>${projectName}_TailWag_rev1.stl</code> • Print this multi-color 3D filament painting on <strong>any single-head 3D printer without an AMS</strong> by adding layer pauses!
      </p>

      <div class="settings-grid">
        <div class="stat-box">
          <div class="stat-label">First / Initial Layer</div>
          <div class="stat-value" style="color:#fb923c;">${baseLayerMm.toFixed(2)} mm</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Layer Height</div>
          <div class="stat-value" style="color:#fb923c;">${layerHeightMm.toFixed(2)} mm</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Total Layers / Max Z</div>
          <div class="stat-value">${totalLayers} Layers (${maxZ} mm)</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Infill &amp; Perimeters</div>
          <div class="stat-value" style="color:#34d399;">100% Rectilinear • 1 Wall</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Physical Dimensions</div>
          <div class="stat-value">${grid.widthMm.toFixed(1)} &times; ${grid.heightMm.toFixed(1)} mm</div>
        </div>
      </div>

      <div class="warning-banner">
        <strong>⚠️ CRITICAL SLICER RULE:</strong> Set your slicer to <strong>${baseLayerMm.toFixed(2)} mm Initial Layer Height</strong>, <strong>${layerHeightMm.toFixed(2)} mm Layer Height</strong>, <strong>100% Aligned Rectilinear Infill</strong> (or <code>999</code> Top &amp; Bottom Solid Layers), and <strong>NEVER scale the Z-axis height</strong> (keep Z at 100%). You may scale X &amp; Y width/height if desired, but Z must stay untouched so layer numbers match the color swap schedule below.
      </div>
    </div>

    <div class="card">
      <h2>1. Quick Summary — Which Layers to Pause On</h2>
      <p class="subtitle">Add a Pause (or Filament Change <code>M600</code>) at the <strong>start</strong> of each of these layers in your slicer's layer preview bar:</p>
      <div class="pause-list">
        ${pausePillsHtml}
      </div>
    </div>

    <div class="card">
      <h2>2. Complete Layer-by-Layer Color Change Schedule (Interactive Checklist)</h2>
      <p class="subtitle">Check off each step as you add the pauses in your slicer or as you swap filament spools at your printer:</p>
      <table>
        <thead>
          <tr>
            <th style="width:46px;text-align:center;">Done</th>
            <th style="width:190px;">Pause Layer &amp; Z-Height</th>
            <th style="width:250px;">Filament Color to Load</th>
            <th style="width:185px;">Layers Printed</th>
            <th>Action Instructions</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>3. How to Add Layer Pauses &amp; Color Changes in Your Slicer (No AMS Needed)</h2>
      <div class="slicer-grid">
        <div class="slicer-card">
          <h3>Bambu Studio / OrcaSlicer (No AMS / External Spool)</h3>
          <ol>
            <li>Open <code>${projectName}_TailWag_rev1.stl</code>.</li>
            <li>Set <strong>Initial Layer Height = ${baseLayerMm.toFixed(2)} mm</strong>, <strong>Layer Height = ${layerHeightMm.toFixed(2)} mm</strong>, <strong>Sparse Infill = 100%</strong>, and <strong>Top/Bottom Shell Layers = 999</strong>.</li>
            <li>Click <strong>Slice Plate</strong> to switch to the <strong>Preview</strong> tab.</li>
            <li>On the right vertical <strong>Layer Slider</strong>, drag the slider to <strong>${pauseLayersInline}</strong>.</li>
            <li>At each pause layer, <strong>right-click the green <code>(+)</code> icon</strong> on the slider and select <strong>"Add Pause"</strong> (or <strong>"Change Filament"</strong>).</li>
            <li>Click <strong>Slice Plate</strong> again and start the print with <strong>${playbook[0]?.spoolName || 'Slot #1'}</strong> loaded. When the printer pauses at each layer, unload the spool, load the next color from the table above, and press <strong>Resume</strong>!</li>
          </ol>
        </div>

        <div class="slicer-card">
          <h3>PrusaSlicer / SuperSlicer</h3>
          <ol>
            <li>Import <code>${projectName}_TailWag_rev1.stl</code>.</li>
            <li>Set First Layer Height to <strong>${baseLayerMm.toFixed(2)} mm</strong>, Layer Height to <strong>${layerHeightMm.toFixed(2)} mm</strong>, and Infill to <strong>100% Rectilinear</strong>.</li>
            <li>Click <strong>Slice Now</strong>.</li>
            <li>Use the vertical orange layer slider on the right to move to <strong>${pauseLayersInline}</strong>.</li>
            <li>Click the orange <strong><code>+</code> (Add Color Change / M600)</strong> button at each of those layers, re-slice, and export G-code.</li>
          </ol>
        </div>

        <div class="slicer-card">
          <h3>UltiMaker Cura / Creality Print / Anycubic</h3>
          <ol>
            <li>Import <code>${projectName}_TailWag_rev1.stl</code> and slice with <strong>${baseLayerMm.toFixed(2)} mm</strong> Initial Layer Height, <strong>${layerHeightMm.toFixed(2)} mm</strong> Layer Height, and <strong>100% Infill</strong>.</li>
            <li>In Cura, open <strong>Extensions &rarr; Post Processing &rarr; Modify G-Code</strong>.</li>
            <li>Click <strong>Add a Script &rarr; Filament Change</strong> (or <strong>Pause at Height &rarr; By Layer</strong>).</li>
            <li>Add a script for each pause layer: <strong>${pauseItems.map((p) => `Layer ${p.startLayer}`).join(', ')}</strong>, then re-slice!</li>
          </ol>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates a ready-to-print Single-Extruder (No-AMS) `.ZIP` bundle containing:
 * 1. Watertight Binary `.STL` (`${projectName}_TailWag_rev1.stl`)
 * 2. Interactive Visual `.HTML` Layer Pause & Color-Change Guide (`${projectName}_Color_Change_Guide.html`)
 * 3. Plain-Text Layer Swap Playbook (`${projectName}_Swap_Playbook.txt`)
 */
export function generateNoAmsStlPackageZip(params: {
  projectName: string;
  grid: HeightmapGrid;
  baseLayerMm: number;
  layerHeightMm: number;
  totalLayers: number;
  slots: LayerSwapSlot[];
  /** The plan the preview was built from. Built here when omitted. */
  plan?: PrintPlan;
  /** Optional target-vs-predicted comparison image to include in the package. */
  previewPng?: Uint8Array;
  /** Optional predicted-fidelity summary to include in the metadata JSON. */
  fidelity?: Record<string, unknown>;
}): Uint8Array {
  const { projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots } = params;
  const fresh = buildPrintPlan({ grid, slots, baseLayerMm, layerHeightMm, totalLayers });
  const plan = params.plan ?? fresh;
  if (plan.hash !== fresh.hash) {
    throw new Error(
      `Stale PrintPlan (${shortPlanHash(plan)}) does not match the model being exported (${shortPlanHash(fresh)}). Rebuild the plan and export again.`
    );
  }
  const stlBuffer = generateBinaryStlFromGrid(grid, `Plan ${plan.hash}`);
  const htmlGuide = generateSingleExtruderHtmlGuide(
    projectName,
    grid,
    baseLayerMm,
    layerHeightMm,
    totalLayers,
    slots
  );
  const txtPlaybook = generatePlaybookText(
    projectName,
    grid,
    baseLayerMm,
    layerHeightMm,
    totalLayers,
    slots
  );

  return zipSync(
    {
      [`${projectName}_TailWag_rev1.stl`]: new Uint8Array(stlBuffer),
      [`${projectName}_Color_Change_Guide.html`]: strToU8(htmlGuide),
      [`${projectName}_Swap_Playbook.txt`]: strToU8(
        `${txtPlaybook}\n\nPrint Plan ID: ${shortPlanHash(plan)} (full hash ${plan.hash})\n`
      ),
      [`${projectName}_TailWag_PrintPlan.json`]: strToU8(serializePlanSummary(plan, projectName)),
      [`${projectName}_TailWag_PrintMetadata.json`]: strToU8(
        serializePrintMetadata(buildPrintMetadata(plan, slots, projectName, params.fidelity))
      ),
      ...(params.previewPng ? { [`${projectName}_TailWag_Preview.png`]: params.previewPng } : {}),
    },
    { level: 6 }
  );
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
  /** The plan the preview was built from. Built here when omitted. */
  plan?: PrintPlan;
  /** Optional target-vs-predicted comparison image to include in the package. */
  previewPng?: Uint8Array;
  /** Optional predicted-fidelity summary to include in the metadata JSON. */
  fidelity?: Record<string, unknown>;
}): Uint8Array {
  const { projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots } = params;
  const fresh = buildPrintPlan({ grid, slots, baseLayerMm, layerHeightMm, totalLayers });
  const plan = params.plan ?? fresh;
  if (plan.hash !== fresh.hash) {
    throw new Error(
      `Stale PrintPlan (${shortPlanHash(plan)}) does not match the model being exported (${shortPlanHash(fresh)}). Rebuild the plan and export again.`
    );
  }
  const playbook = buildSwapPlaybook(slots, baseLayerMm, layerHeightMm, totalLayers);
  const playbookText =
    generatePlaybookText(projectName, grid, baseLayerMm, layerHeightMm, totalLayers, slots) +
    `\n\nPrint Plan ID: ${shortPlanHash(plan)} (full hash ${plan.hash})\n`;

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
    // Band Z limits come straight from the plan, so they sit exactly on layer boundaries.
    const band = plan.bands[idx];
    const zFloor = band.floorZMm;
    const zCeil = idx === playbook.length - 1 ? maxGridZ + 2.0 : band.ceilZMm;

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
  Object.assign(ps, layerSettingsFor(baseLayerMm, layerHeightMm), PINNED_SLICER_SETTINGS);

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
    'Metadata/TailWag_PrintPlan.json': strToU8(serializePlanSummary(plan, projectName)),
    'Metadata/TailWag_PrintMetadata.json': strToU8(
      serializePrintMetadata(buildPrintMetadata(plan, slots, projectName, params.fidelity))
    ),
    ...(params.previewPng ? { 'Metadata/TailWag_Preview.png': params.previewPng } : {}),
  };

  return zipSync(archiveFiles, { level: 6 });
}
