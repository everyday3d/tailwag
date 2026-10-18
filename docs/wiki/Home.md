# 🐕 TailWag Studio Wiki

Welcome to the **TailWag Studio Knowledge Base and 3D Printing Handbook**.

TailWag Studio is a desktop application for multi-filament 3D painting and lithophane creation. This wiki covers everything from optical color-blending physics and Transmission Distance ($TD$) to print settings, slicing workflows, calibration, and defect troubleshooting.

---

## 📚 Table of Contents

### 🚀 Getting Started
- [[Getting-Started|Getting Started & First Print Guide]] — Installation, first-launch setup, and your first 4-color print in under 5 minutes.
- [[Studio-User-Guide|Studio User Guide & Workflow]] — Step-by-step walkthrough of photo pre-press, color modes, timeline editing, 3D viewport controls, and project saving.

### 🔬 Optical Science & TD Theory
- [[Filament-Painting-Science|The Science of Filament Painting]] — How Beer-Lambert absorption, Kubelka-Munk scattering, and Transmission Distance ($TD$) predict real-world blended colors.
- [[TD-Calibration-Guide|Filament TD Calibration Guide]] — How to print the built-in 16-step test wedge, measure opacity, and calibrate your spools.

### 🖨️ Slicing & 3D Printing
- [[Slicer-Setup-and-Print-Settings|Slicer Setup & Print Rules]] — Slicer configurations for **Bambu Studio** and **OrcaSlicer**: 100% rectilinear infill, layer heights, flush volumes, and single-AMS chaining playbooks.
- [[Troubleshooting-and-Defect-Resolution|Troubleshooting & Print Defects]] — Fixing color bleed, layer banding, warping, purge contamination, and nozzle stringing.

### 🎨 Creative Applications & Fun Projects
- [[Creative-Projects-and-Fun-Ideas|Creative Projects & Fun Ideas]] — Making working wall clocks, backlit LED lithophanes, fridge magnets, keychains, and custom dual-tone art palettes.

---

## ⚡ Quick Cheat Sheet

| Setting | Required Value | Why |
| :--- | :--- | :--- |
| **Infill Density** | `100%` | Prevents infill patterns from showing through translucent layers |
| **Infill Pattern** | `Aligned Rectilinear` | Keeps filament strands parallel for uniform optical transmission |
| **First Layer Height** | `0.16 mm` or `0.20 mm` | Ensures strong bed adhesion |
| **Layer Height** | `0.08 mm` (recommended) | Finer layer resolution allows subtle color transitions and accurate TD blending |
| **Top Surface Pattern** | `Monotonic Line` | Avoids directional gloss changes across the relief face |
| **Flush / Purge Multiplier** | `1.0` to `1.2` | Guarantees complete color purging (especially Black to White) |

---

> [!TIP]
> Found a bug or have a suggestion? Open an issue on our [GitHub Issue Tracker](https://github.com/everyday3d/tailwag/issues).
