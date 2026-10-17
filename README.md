# 🐕 TailWag Studio — 3D Filament Painting & TD Lithophane Engine (`v1.0.0`)

[![Release](https://img.shields.io/badge/Version-1.0.0-orange?style=flat-square&logo=windows)](CHANGELOG.md)
[![MCP Server](https://img.shields.io/badge/MCP%20Server-Agent%20Ready-emerald?style=flat-square)](#mcp-server-agentic-solving--headless-3mf-generation)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](#)

> **Next-Generation Desktop 3D Filament Painting (Front-Lit Beer-Lambert TD Blending), AI Palette & Layer-Swap Solver, 2.5D Parametric CAD Cutouts, and Native Bambu Studio / OrcaSlicer `.3MF` Exporter + Built-in MCP Server.**

---

## 🌟 Key Features

1. **🔬 Real-Time Beer-Lambert + Kubelka-Munk Optical TD Viewport (`Viewport3D.tsx`)**
   - Interactive Three.js WebGL2 3D relief preview with real-time vertex color transmission blending, studio key-light azimuth/elevation controls, **X-Ray Layer Cutaway Scrubber**, **Split-Screen Source Wipe Compare**, and **Front-Lit vs. Back-Lit Lithophane** toggle.
2. **📦 Native Bambu Studio & OrcaSlicer `.3MF` Project Export (`exporter3mf.ts`)**
   - Exports ready-to-slice `.3mf` project packages pre-configured with `100%` aligned rectilinear infill, base/layer height rules, filament hex palette, height-range color modifiers, and a `>4 Color Single-AMS Chaining Playbook`.
3. **🧠 AI Palette & Layer-Swap Auto-Solver (`autoSolver.ts`)**
   - Optimizes filament combinations and exact layer swap Z-heights in CIE LAB perceptual space ($\Delta E$) across your **Owned / Active AMS Spools** or the full multi-brand catalog.
4. **📏 Built-in TD Calibrator & Live Bambu Fleet Studio AMS Sync (`TdCalibratorModal.tsx`)**
   - Generates a 7-minute **16-Step TD Calibration Step-Wedge (`.STL`)**, calculates exact filament Transmission Distance ($TD$ in mm), and syncs live AMS trays from Home Assistant (`bambu_fleet_studio`).
5. **📐 2.5D Parametric CAD Shapes, Frames, Clocks & Cutouts (`cadMeshBuilder.ts`)**
   - Built-in silhouettes (*Rectangle*, *Rounded Plaque*, *Circle/Clock*, *Hexagon*, *Crest Shield*, *BoxerDawg Medallion*), 3D raised frames (*Beveled*, *Modern Lip*, *Stepped*), **HueForge Wall Clock Mode** (center quartz shaft bore, rear $56\times56\text{mm}$ movement cavity, raised top-layer stencil numerals), **Keychain Bores**, and **Rear Neodymium Magnet Pockets**.
6. **🤖 Built-in TailWag MCP Server (`mcp/server.ts` / `dist-electron/mcp/server.js`)**
   - Standard JSON-RPC 2.0 stdio Model Context Protocol (MCP) server allowing AI agents to autonomously list filaments, solve optimal TD palettes, simulate layer stacks, calibrate TDs, and export `.3mf` / `.stl` projects headlessly.

---

## 🤖 MCP Server (Agentic Solving & Headless 3MF Generation)

Agents can connect to the compiled TailWag MCP server (`node dist-electron/mcp/server.js`) over `stdio`:

| MCP Tool Name | Description |
| :--- | :--- |
| `tailwag_list_filaments` | Lists verified filament spools with brand, hex color, $TD$ (mm), and AMS/owned status. |
| `tailwag_solve_palette` | Solves optimal filament combinations and layer swap heights for target hex colors or portraits. |
| `tailwag_simulate_layer_stack` | Simulates Beer-Lambert TD blending for any filament stack and returns the per-layer hex LUT. |
| `tailwag_export_3mf_project` | Headlessly builds a watertight 2.5D mesh with CAD cutouts and writes `.3mf` + `_Swap_Playbook.txt`. |
| `tailwag_calibrate_td` | Computes filament $TD$ from step-wedge opacity readings and exports the calibration wedge `.stl`. |

