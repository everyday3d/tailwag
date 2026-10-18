# 💻 Studio User Guide & Workflow

TailWag Studio is engineered for real-time control, deterministic optical simulation, and rapid iteration. This guide covers every control, panel, and feature in the application.

---

## 🎛️ 1. Photo Pre-Press Adjustments

Before light is simulated through filament, the source image must be optimized for physical 3D relief reproduction.

| Slider | Function | Best Practices |
| :--- | :--- | :--- |
| **Brightness** | Shifts image exposure up or down | Ensure shadows reach near-zero without blowing out highlights. |
| **Contrast** | Expands or compresses tonal dynamic range | Higher contrast gives cleaner color step separation in 4-color palettes. |
| **Gamma** | Non-linear midpoint tone curve adjustment | Lower gamma ($< 1.0$) brings out mid-tone face details in portraits. |
| **Sharpness** | High-pass edge enhancement | Accentuates hair, fur, eyes, and fine lines for 0.4mm/0.2mm nozzles. |
| **Smoothing** | Bilateral filter noise reduction | Eliminates JPEG artifacts and camera sensor ISO noise that cause jagged relief spikes. |

---

## 🎨 2. Color Selection Modes

### 🔬 Faithful Mode (Recommended for Portraits & Photos)
Uses a heuristic palette search to test millions of filament combinations and layer swap heights against your active filament library. It selects the exact stack that achieves the lowest overall **CIEDE2000 ($\Delta E_{00}$)** perceptual error.

### 🌈 Vivid Mode (Recommended for Artwork, Logos & Posters)
Optimizes for maximum saturation, contrast, and distinct color separation. Rather than striving for absolute photorealism, it emphasizes bold, punchy hues.

### 🏛️ Archival Monochrome
Specifically tuned for black-and-white photography, charcoal sketches, and historical portraits. Uses neutral gray spools (Black, Charcoal, Slate Gray, Light Gray, Jade White) with smooth tonal transitions.

### 🖐️ Manual Mode (Full User Control)
When you want exact control over every layer swap point:
- **Relief in Manual Mode Switch**:
  - **Match photo**: Whenever you finish dragging a swap slider, TailWag calculates which layer in your stack best represents each pixel's color in the original photo.
  - **Fixed relief**: The 3D surface geometry remains strictly anchored to the photo's grayscale luminance; moving sliders only shifts where colors transition across existing height contours without re-solving the relief geometry.
- **Stable Boundaries**: Dragging sliders, reordering slots, or replacing spools in Manual mode never moves boundaries you set by hand.

---

## ⏱️ 3. Layer Timeline (`LayerTimeline.tsx`)

The timeline at the bottom of the screen displays your active filament stack in printing order (from bottom layer #1 up to the top surface):

```
[Layer 1: Black] ===> [Layer 12: Red] ===> [Layer 18: Orange] ===> [Layer 24: White]
       0.00 mm              0.96 mm                1.44 mm               1.92 mm
```

- **Drag Swap Handles**: Click and slide boundaries to change the transition Z-height for any filament.
- **Reorder Filaments**: Click and drag slot headers to change printing order.
- **Change Spool**: Click any color pill to open the spool selection picker and choose a different filament from your owned library or public catalog.
- **Add / Remove Slot**: Click `+` to add up to 16 color slots, or trash can to remove.
- **Auto-Tune Swap Layers**: Recalculates mathematically optimal swap heights for your current chosen spools.

---

## 🕹️ 4. 3D Viewport Navigation & Studio Tools

### Camera Controls
- **Orbit**: Left-click and drag anywhere on the canvas.
- **Pan**: Right-click and drag, or hold Shift + Left-click.
- **Zoom**: Mouse wheel scroll.

### Studio Inspection Tools
- **Studio Light Rig (Azimuth & Elevation)**: Drag the directional light widget in the viewport corner to simulate room lighting from different angles and inspect surface specular reflections.
- **Accuracy vs. Beauty Mode**:
  - *Accuracy*: Flat, unshaded optical Beer-Lambert simulation showing true printed color transmission.
  - *Beauty*: Realistic 3D studio lighting with soft specular highlights and ambient occlusion.
- **X-Ray Layer Scrubber**: Drag through individual slice heights to see where inner colors live beneath the top surface.
- **Split-Screen Wipe Compare**: Drag the vertical split bar to compare predicted 3D printed colors with the original source photo side-by-side.

---

## 💾 5. Project Saving, History & Desktop Features

- **Save Project (`Ctrl+S`)**: Saves a `.tailwag` compressed project bundle containing your lossless photo, filament stack, swap layers, pre-press sliders, shape settings, and color mode.
- **Open Project (`Ctrl+O`)**: Restores any `.tailwag` file. Projects save full filament definitions (hex, TD, brand), ensuring the project opens identically on any computer even if the user's filament library is different.
- **100-Step Undo & Redo (`Ctrl+Z` / `Ctrl+Y`)**: Complete history stack covering spool changes, slider moves, color modes, and parametric shapes. Continuous slider drags are coalesced into a single undo step.
- **Automatic Reopen**: On launch, TailWag Studio detects if you had an active project and offers to reopen it with one click.

---

## 📐 6. Parametric CAD Shapes & Cutouts

TailWag Studio builds watertight 2.5D solid geometry with integrated cutouts:

| Shape Option | Description | Application |
| :--- | :--- | :--- |
| **Rectangle** | Standard 4:3, 16:9, or square canvas | Framed prints, art cards |
| **Rounded Plaque** | Soft corner radii with uniform bezel | Desk art, awards, memorials |
| **Circle / Clock** | Circular disc with optional center shaft bore ($8\text{ mm}$) and rear movement cavity ($56\times56\text{ mm}$) | Working quartz wall clocks |
| **Hexagon** | Regular 6-sided tile geometry | Modular wall mosaics |
| **Crest Shield** | Heraldic curved shield silhouette | Badges, team logos, family crests |
| **BoxerDawg Medallion**| Signature paw-shaped outer profile | Ornaments, pet tags |
| **Frames (Beveled / Lip / Stepped)** | Raised 3D border around the print | Finished display look without needing an external picture frame |
| **Rear Magnet Pockets** | Recessed circular blind cavities ($10\text{ mm} \times 2.2\text{ mm}$) | Refrigerator magnets |
| **Keychain Bore** | $3.5\text{ mm}$ reinforced through-hole | Backpack charms, keychains |
