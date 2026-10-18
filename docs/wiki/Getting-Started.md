# 🚀 Getting Started & First Print Guide

This guide walks you through setting up TailWag Studio, preparing your printer, and completing your first 4-color filament painting from photo to sliced build plate.

---

## 💻 1. Installation

TailWag Studio is available as a standalone desktop application for **Windows** and **macOS**.

### Windows Installation
- **Standard Installer**: Download and run `TailWag-Setup-1.2.0.exe` from [GitHub Releases](https://github.com/everyday3d/tailwag/releases/latest).
  > **SmartScreen prompt?** Click **More info** -> **Run anyway**. This is standard for new open-source software without an expensive commercial code-signing certificate.
- **Portable**: Download `TailWag-Portable-1.2.0.exe` (runs directly with no installer).
- **Windows Package Manager (WinGet)**:
  ```powershell
  winget install everyday3d.TailWagStudio
  ```

### macOS Installation
- **Apple Silicon (M1/M2/M3/M4)**: Download `TailWag-Setup-1.2.0-mac-arm64.dmg`.
- **Intel Macs**: Download `TailWag-Setup-1.2.0-mac-x64.dmg`.
- Open the `.dmg` image and drag **TailWag Studio.app** to `/Applications`.

> [!IMPORTANT]
> **First Launch on macOS (Gatekeeper)**:
> Unsigned macOS apps are blocked on standard double-click. On first launch:
> 1. Right-click (or Control-click) `TailWag Studio.app` in `/Applications`.
> 2. Select **Open** from the context menu.
> 3. Click **Open** in the dialog prompt.
> Alternatively, open Terminal and run: `xattr -cr /Applications/TailWag\ Studio.app`.

---

## 🛠️ 2. Recommended 3D Printing Hardware

### Printers
- **Bambu Lab** (A1, A1 Mini, P1P, P1S, X1-Carbon) with AMS or AMS Lite for automated filament swapping.
- **Any FDM 3D Printer** (Prusa MK3/MK4, Creality Ender/K1, Voron, Elegoo Neptune, Anycubic) using manual pauses (`M600` filament runout or layer pause).

### Nozzle Sizes
- **0.4 mm Nozzle (Standard)**: Recommended starting point. Prints cleanly with 0.08 mm layer height and rapid print times.
- **0.2 mm Nozzle (High Detail)**: Delivers razor-sharp XY resolution for small portraits, miniature art, or text badges.

### Recommended Starter Filament Palette
The classic 4-color photographic palette:
1. **Black** (Base layer — absorbs all light, defines deep shadows)
2. **Medium Gray / Blue / Red / Earth Tone** (Mid-tone layer)
3. **Light Gray / Amber / Yellow** (Highlight layer)
4. **White / Jade White** (Top highlight layer — diffuse scattering)

---

## ⚡ 3. Your First Print in 5 Minutes

```
[Drop Photo] ➔ [Select Colors] ➔ [Inspect 3D Preview] ➔ [Export 3MF] ➔ [Slice & Print]
```

### Step 1: Import Your Subject Photo
1. Drag and drop any JPG, PNG, or WebP photo into the studio window.
2. In the pre-press adjustments panel:
   - Adjust **Contrast** to emphasize subject details.
   - Adjust **Brightness** so dark areas reach deep blacks without crushing details.
   - Use **Smoothing** if your photo contains digital noise or camera grain.

### Step 2: Choose Your Palette & Color Mode
- **Faithful Mode (Default)**: Automatically searches all available filament spools in your library and calculates the optimal combination that minimizes color error ($\Delta E_{00}$) compared to the original image.
- **Vivid Mode**: Maximizes perceptual separation between colors for bold, vibrant illustrations or posters.
- **Archival Monochrome**: Optimizes transitions between blacks, charcoal, grays, and whites for vintage portraits and monochrome photography.

### Step 3: Inspect the 3D Optical Viewport
- **Rotate / Pan / Zoom**: Click and drag in the 3D viewport to inspect the surface relief contours.
- **X-Ray Layer Scrubber**: Drag the layer slider to inspect the exact internal color boundary steps beneath the surface.
- **Split-Screen Source Wipe**: Toggle the split compare slider to verify predicted blended colors against the original photo side-by-side.

### Step 4: Add Shapes and Frames (Optional)
- Switch silhouette shape from *Rectangle* to *Rounded Plaque*, *Circle*, *Hexagon*, or *Crest Shield*.
- Add a 3D raised border (*Beveled*, *Modern Lip*, or *Stepped*).
- Optional: Enable rear magnet pockets or keychain holes if making gifts or badges.

### Step 5: Export Native `.3MF` Project
1. Click **Export 3MF**.
2. Review the **Fidelity Report** displaying average $\Delta E$ color deviation and layer swap heights.
3. Save the `.3mf` project package. TailWag writes both the watertight mesh model and an accompanying `_Swap_Playbook.txt`.

### Step 6: Slice & Print in Bambu Studio / OrcaSlicer
1. Open the `.3mf` file directly in Bambu Studio or OrcaSlicer.
2. The print project will already be configured with:
   - `100%` infill density
   - `Aligned Rectilinear` infill pattern
   - Layer heights (`0.16mm` or `0.20mm` base, `0.08mm` layers)
   - Color filament assignments and height modifiers
3. Click **Slice plate** and send to your printer!
