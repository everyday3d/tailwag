# 🖨️ Slicer Setup & Print Settings Guide

Filament painting relies on continuous, 100% solid plastic density across micro-thin layers. Unlike standard 3D prints where internal infill voids are hidden inside a shell, a filament painting is an optical optical filter: light passes into the print, reflects off the substrate, and returns through multiple translucent plastic layers.

Any micro-gap, infill void, purge residue, or layer variance will disrupt the light path and alter the perceived color. This guide details the mandatory slicer configurations for Bambu Studio, OrcaSlicer, PrusaSlicer, and Cura.

---

## ⚙️ Quick Reference Settings Matrix

| Parameter | Recommended Value | Why It Matters |
| :--- | :--- | :--- |
| **First Layer Height** | `0.16 mm` or `0.20 mm` | Must match your TailWag base layer height configuration. Ensures solid bed adhesion. |
| **Layer Height (Subsequent)** | `0.08 mm` (or `0.04 mm` for ultra-fine) | Optical blending matches TailWag's discrete color layers ($0.08\text{ mm}$ is standard). |
| **Infill Density** | `100%` | Prevents interior air pockets that refract light and create dark blotches. |
| **Infill Pattern** | `Aligned Rectilinear` or `Monotonic` | Parallel extrusion paths ensure uniform light transmission. Never use Grid, Honeycomb, or Gyroid. |
| **Wall Loops / Perimeters** | `1` (or max `2`) | Keeps outer perimeter lines from bleeding inwards across fine color boundaries. |
| **Top / Bottom Shell Layers** | Default (solid prism at 100% infill) | All layers are continuous passes. |
| **First Layer Speed** | `25 - 35 mm/s` | Critical for smooth, flat glass-like foundation with zero rippling. |
| **Print Speed (Subsequent)** | `100 - 200 mm/s` | Moderate speeds prevent pressure spikes that cause micro-ridge height inconsistencies. |
| **Flush Volume Multiplier** | `1.0x` - `1.25x` | Eliminates pigment contamination when transitioning from dark/dense to light/translucent filaments. |
| **Prime Tower** | **Enabled** | Equalizes nozzle chamber pressure before drawing the visible canvas. |

> [!IMPORTANT]
> **Never print filament paintings with less than 100% infill.** At 15% or 20% infill, the air pockets act as light traps and optical diffusers, destroying color depth and contrast.

---

## 🛠️ Step-by-Step Slicer Configuration

### 1. Bambu Studio & OrcaSlicer

Bambu Studio and OrcaSlicer provide native multi-material and layer-range support.

#### Step A: Base Profile Selection
1. Select your printer and nozzle size (standard `0.4 mm` nozzle works well; `0.2 mm` nozzle enables ultra-sharp detail).
2. Start with the default **0.08mm Extra Fine** system profile.
3. In **Quality**:
   - Set **Layer height** = `0.08 mm`.
   - Set **First layer height** = `0.16 mm` (or match the `Base Layer Height` set in TailWag).

#### Step B: Strength & Infill
1. Go to the **Strength** tab.
2. In **Walls**:
   - Set **Wall loops**: `1` or `2`.
3. In **Infill**:
   - Set **Sparse infill density**: `100%`.
   - Set **Sparse infill pattern**: `Aligned Rectilinear` (or `Monotonic`).
   - Set **Top surface pattern**: `Monotonic` or `Monotonic Line`.

#### Step C: Purge & Flushing Volumes
When swapping from high-pigment filaments (e.g. Jet Black, TD 0.3) to high-translucency filaments (e.g. Jade White, TD 5.0), residual pigment in the hotend chamber causes **muddiness**:
1. Click the **Flushing volumes** button above the filament list.
2. Set the global flushing multiplier to **1.1x** or **1.2x**.
3. Inspect the matrix cell for your darkest filament switching to your lightest filament: ensure purge volume is at least **400–600 mm³**.
4. Enable the **Prime Tower** in the **Others** tab:
   - Width: `25 - 35 mm`.
   - Prime volume: `35 - 45 mm³`.

---

## 🔄 Single-AMS Multi-Color Chaining (>4 Colors)

If your artwork uses 5, 6, 7, or 8 colors and you own a single 4-slot Bambu AMS, you can still print the entire piece using **Layer-Pause Spool Swapping**:

```
[Layer 1-12: Slots 1, 2, 3, 4 active]
       │
       ▼  (Color #1 finishes at Layer 12)
[Pause at Layer 13] ──► Swap Slot 1 physical spool to Color #5
       │
       ▼  (Color #2 finishes at Layer 18)
[Pause at Layer 19] ──► Swap Slot 2 physical spool to Color #6
       │
       ▼  (Continue through remaining layers)
```

### Chaining Playbook:
1. Open TailWag's **Layer Timeline** and observe the layer span for each color.
2. Identify when the earliest color is completely finished (e.g., Black ceases printing after Layer 14).
3. In your slicer's layer preview slider:
   - Right-click the plus icon at Layer 15 and select **Add Pause** (`M400 U1` or standard pause).
4. When the printer pauses at Layer 15:
   - Remove the finished Black spool from Slot 1 in the AMS.
   - Insert Color 5 (e.g. Yellow) into Slot 1.
   - Allow the AMS to load and detect/assign the spool.
   - Resume the print.

---

## 🛑 Manual Filament Swaps (No AMS / Single Extruder)

If your 3D printer has a single manual extruder (e.g. Ender 3, Neptune 4, Prusa MK3/MK4 without MMU):

1. Export the layer swap instructions from TailWag (e.g., `Color 1 to Layer 12`, `Color 2 to Layer 22`, etc.).
2. In **PrusaSlicer**, **OrcaSlicer**, or **Cura**:
   - Slice the model at `0.08 mm` layer height with `0.16 mm` first layer.
   - Drag the layer slider to the target swap layer.
   - Right-click the layer bar and click **Add Color Change (`M600`)**.
3. When the printer encounters `M600`:
   - The toolhead parks in the purge corner and beeps.
   - Manually unload the current filament and insert the next color indicated in TailWag.
   - Extrude until all traces of the previous color are purged out cleanly.
   - Clear the nozzle tip with tweezers and press Resume.

---

## 🎯 Bed Surface Selection & First Layer Quality

The bed plate texture directly affects the optical reflection of your base layers:

- **Smooth PEI / High-Temp Smooth Sheet (Recommended)**: Produces a mirror-flat, uniform foundation. Best for high-contrast prints and art intended for wall framing.
- **Textured PEI**: Creates a matte, frosted finish that scatters surface reflections. Softens glare, but slightly reduces maximum black depth ($L^*$ increases).
- **Engineering / SuperTack Plate**: Outstanding for PLA warp prevention on large $200 \times 200\text{ mm}$ canvas prints.

> [!TIP]
> Always clean your build plate with warm dish soap (Dawn) and hot water before large filament paintings. Fingerprint oils prevent 100% infill adhesion, causing edge curls that collide with the nozzle.

---

## 🔗 Related Wiki Documentation
- [[Getting Started|Getting-Started]]: Quick start and workflow overview.
- [[Filament Painting Science|Filament-Painting-Science]]: Physics of Beer-Lambert light transmission and TD.
- [[TD Calibration Guide|TD-Calibration-Guide]]: How to measure Transmission Distance for custom filaments.
- [[Troubleshooting & Defect Resolution|Troubleshooting-and-Defect-Resolution]]: Fix color bleed, warping, and stringing.
