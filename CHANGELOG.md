# Changelog

All notable changes to **TailWag Studio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-16

### Added
- **Core Beer-Lambert + Kubelka-Munk Optical TD Engine** (`src/engine/opticalTdEngine.ts`) with real-time per-layer composite color lookup tables and CIE LAB $\Delta E$ perceptual metrics (Fixes #1).
- **Interactive Three.js 3D Filament Painting Viewport** (`src/components/Viewport3D.tsx`) featuring split-screen source wipe comparison, studio key-light azimuth/elevation controls, X-ray layer cutaway scrubber, and Front-Lit vs. Back-Lit Lithophane mode (Fixes #1).
- **AI Palette & Layer-Swap Auto-Solver** (`src/engine/autoSolver.ts`) generating optimal true-tone, BoxerDawg warm portrait pop, and archival monochrome recipes from owned AMS spools or full brand catalog (Fixes #1).
- **2.5D Parametric CAD Shape, Frame, Clock & Cutout Engine** (`src/engine/cadMeshBuilder.ts`) supporting circular/rounded/hexagonal/shield/medallion silhouettes, beveled/stepped 3D frames, HueForge Wall Clock shaft bores + rear movement pockets + raised stencil numerals, keychain holes, and rear neodymium magnet pockets (Fixes #1).
- **Native Bambu Studio / OrcaSlicer `.3MF` Exporter & Single-AMS Swap Playbook** (`src/engine/exporter3mf.ts`) packaging watertight meshes, filament hex palettes, 100% rectilinear infill settings, height-range modifiers, and `>4 Color Single-AMS Chaining` instructions (Fixes #1).
- **Built-in TD Calibrator & Live Bambu Fleet Studio AMS Sync** (`src/components/TdCalibratorModal.tsx`) with 16-step calibration wedge `.STL` export and Home Assistant `bambu_fleet_studio` AMS tray synchronization (Fixes #1).
- **TailWag Model Context Protocol (MCP) Server** (`mcp/server.ts`) exposing `tailwag_list_filaments`, `tailwag_solve_palette`, `tailwag_simulate_layer_stack`, `tailwag_export_3mf_project`, and `tailwag_calibrate_td` for autonomous AI agent solving (Fixes #1).
