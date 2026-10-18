# 🛠️ Troubleshooting & Defect Resolution

Because filament paintings consist of dozens of solid micro-layers ($0.08\text{ mm}$), minor 3D printer calibration flaws that are invisible in decorative figurines become glaring optical defects.

This guide provides diagnostic root causes, step-by-step remedies, and preventative settings for the most common print issues.

---

## 🔍 Diagnostic Matrix

| Symptom / Defect | Root Cause | Solution |
| :--- | :--- | :--- |
| **Muddy / Dirty Highlights** (White looks gray or tinted) | Incomplete nozzle purge after black/dark color. | Increase flush volume multiplier to $1.2\text{x}$ or $1.3\text{x}$; enable Prime Tower. |
| **Washed Out / Low Contrast** | Infill density is $< 100\%$, or filament $TD$ is set too low in software. | Re-slice with $100\%$ `Aligned Rectilinear` infill; recalibrate filament $TD$. |
| **Cross-Hatch Shadow Pattern** | Slicer used `Grid`, `Gyroid`, or `Cubic` infill. | Change infill pattern strictly to `Aligned Rectilinear` or `Monotonic`. |
| **Plate Warping / Corner Lifting** | High thermal contraction stress from dense solid plastic. | Wash plate with dish soap; lower bed temp to $55^\circ\text{C}$ after layer 3; use 5mm brim. |
| **Nozzle Drag Marks / Rough Surface** | Cumulative over-extrusion across 20+ solid layers. | Reduce extrusion multiplier / flow rate by $2 - 4\%$ (e.g. $0.98 \to 0.96$). |
| **Visible Horizontal Color Stepping** | Insufficient layer budget or coarse z-resolution. | Reduce layer height from $0.12\text{ mm}$ to $0.08\text{ mm}$; increase max layer count in TailWag. |
| **Stringing / Spiderweb Wisps** | Wet filament or excessive nozzle temperature. | Dry spool at $45 - 50^\circ\text{C}$ for 6 hours; reduce nozzle temperature by $5 - 10^\circ\text{C}$. |
| **Layer Shift Mid-Print** | Nozzle collided with curled corner or over-extruded ridge. | Lower flow rate, enable Z-hop ($0.4\text{ mm}$), tighten stepper belts. |

---

## 🧪 Deep-Dive Defect Solutions

### 1. Color Bleed & Purge Contamination
**Problem**: After swapping from Black or Red to White or Yellow, the first 5–10 layers of light filament appear muddy, dirty, or greenish-gray.

**Root Cause**: Modern hotends have internal melt zones holding 20–40 mm³ of molten polymer. Highly concentrated carbon black or phthalocyanine pigments cling to the interior barrel walls and dissolve gradually into the incoming plastic.

**Resolution**:
1. **Calibrate Flush Volumes**: In Bambu Studio/OrcaSlicer, open the **Flushing Volumes** dialog.
2. For transitions from **Dark $\to$ Light**:
   - Set flush volume to **500 – 700 mm³**.
3. For transitions from **Light $\to$ Dark**:
   - Set flush volume to **150 – 200 mm³** (light colors are easily masked by dark pigment).
4. **Prime Tower**: Always enable a prime tower with at least $35\text{ mm}^3$ prime volume so pressure equalizes before laying down the canvas.

---

### 2. Cumulative Over-Extrusion & Surface Scarring
**Problem**: The bottom layers look great, but as the print reaches layer 20–30, the nozzle begins scraping across the plastic, leaving rough ridges, bumps, or scraping noises.

**Root Cause**: In standard hollow prints with 15% infill, minor over-extrusion ($+1\%$) bleeds into the internal voids unnoticed. In a **100% solid filament painting**, excess plastic has nowhere to escape. Over 30 layers, a $2\%$ excess compounds into a $+0.048\text{ mm}$ ridge above the nominal Z-height, colliding with the nozzle tip.

**Resolution**:
1. Calibrate your filament's **Extrusion Multiplier (Flow Rate)**:
   - For standard PLA, set flow to **`0.96` – `0.98`** (never `1.02`+).
2. Set **Top Surface Flow** to **`0.95`**.
3. In Slicer Quality settings, enable **Z-hop on retract** ($0.2\text{ mm} - 0.4\text{ mm}$, Spiral or Auto).

---

### 3. Bed Warping & Corner Lifting
**Problem**: The edges of large flat lithophanes or paintings curl upward off the build plate mid-print, causing deformed corners or nozzle strikes.

**Root Cause**: Large solid sheets of polymer experience high tensile contraction as they cool from $210^\circ\text{C}$ to $60^\circ\text{C}$.

**Resolution**:
1. **Chemical Bed Clean**: Wash the PEI plate thoroughly with dish soap (Dawn) and warm water to strip all fingerprint grease. Follow with 99% isopropyl alcohol.
2. **Bed Temperature Profile**:
   - First layer: $60^\circ\text{C} - 65^\circ\text{C}$ for initial bite.
   - Subsequent layers: Drop to $50^\circ\text{C} - 55^\circ\text{C}$ to prevent thermal softening under contraction stress.
3. **Turn Off Auxiliary Chamber Fans**: High-velocity cross-drafts from side chamber fans cool one edge of the print faster than the rest, inducing curl. Set chamber/aux fan to **0%**.
4. **Mouse Ears / Brim**: Add a $5\text{ mm}$ outer brim with $0.1\text{ mm}$ brim-object gap for easy peeling.

---

### 4. Banding / Quantization in Soft Gradients
**Problem**: Skin tones or sky gradients look like sharp, discrete stair-steps instead of smooth photographic blending.

**Root Cause**: Too few optical layers allocated to that specific tonal range, or the chosen filaments have $TD$ values that are too low to blend smoothly across 1–2 layers.

**Resolution**:
1. In TailWag Studio, examine the **Color Timeline**.
2. If a color only prints for 1 or 2 layers, light cannot blend effectively.
3. Replace the transition filament with a higher-$TD$ alternative (e.g. swap an opaque Red $TD=1.0$ for a translucent Coral $TD=3.5$).
4. Increase total project layers by reducing layer height to $0.04\text{ mm}$ or bumping the model depth from $2.0\text{ mm}$ to $2.8\text{ mm}$.

---

## 🔗 Related Wiki Documentation
- [[Slicer Setup & Print Settings|Slicer-Setup-and-Print-Settings]]: Recommended layer heights and infill configuration.
- [[TD Calibration Guide|TD-Calibration-Guide]]: Accurate measurement to eliminate color drift.
- [[Filament Painting Science|Filament-Painting-Science]]: Understanding transmission physics and pigment saturation.
