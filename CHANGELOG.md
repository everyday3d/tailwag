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

### Fixed
- **Bambu Studio 2.x `.3MF` Config Validation & Pre-Colored Z-Band Assembly Schema** (`src/engine/exporter3mf.ts`, `src/data/bambuProjectTemplate.json`): Resolved `"The 3mf file has invalid config, load geometry data only"` warning in Bambu Studio by embedding the full Bambu Studio 2.x `project_settings.config` schema (`02.08.02.61`), `Metadata/slice_info.config`, `Metadata/cut_information.xml`, `Metadata/filament_sequence.json`, and splitting the 2.5D relief mesh into watertight horizontal Z-band sub-parts (`/3D/Objects/object_1.model`) pre-assigned to AMS extruders `1..N` (Fixes #2).
- **Auto-Painted 3D Relief Preview + Picture-in-Picture (PiP) Original Photo Inset on Upload** (`src/components/Viewport3D.tsx`, `src/App.tsx`): Uploading a photo now automatically switches to the 3D Filament Painted TD view, fits the physical build dimensions to the photo's aspect ratio, runs the AI Palette Auto-Solver so the painted filament layers appear immediately, and adds a collapsible/resizable **Original Photo PiP Inset Card** in the bottom-left corner alongside **Top-Down Paint View** and **3D Relief Angle** camera buttons (Fixes #3).

