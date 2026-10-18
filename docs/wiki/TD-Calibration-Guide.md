# 📏 Transmission Distance (TD) Calibration Guide

Transmission Distance ($TD$) is the single most important parameter in filament painting. It dictates how many micro-layers of plastic light can penetrate before being absorbed or scattered. 

Without an accurate $TD$, color blending calculations in TailWag Studio will not match physical reality on your build plate.

---

## 🔬 Understanding the TD Spectrum

Filaments range from dense light-blockers to glass-like transmitters:

```
[0.2 mm ── 0.6 mm] ──► [1.0 mm ── 2.5 mm] ──► [3.0 mm ── 6.0 mm] ──► [7.0 mm ── 15.0+ mm]
   High Pigment              Standard                Translucent            Ultra Translucent
 (Jet Black, Charcoal)   (Red, Blue, Forest Green)  (Pastels, Jade White)   (Clear, Neon, Fluorescent)
```

| TD Range | Characteristics | Typical Filaments | Role in Filament Art |
| :--- | :--- | :--- | :--- |
| **0.2 – 0.6 mm** | Extremely opaque; blocks all light within 3–5 layers. | Jet Black, Pitch Black, Dark Grey | Forms crisp dark outlines, deep shadows, and high-contrast base plates. |
| **0.8 – 2.0 mm** | Semi-opaque; shifts tone rapidly across thin layers. | Royal Blue, Cherry Red, Walnut Brown | Midtone anchors; establishes dominant hues. |
| **2.5 – 5.5 mm** | Highly translucent; requires 20–40 layers to reach full opacity. | Jade White, Bright Yellow, Mint Green | Smooth gradient transitions, skin tones, highlights. |
| **6.0 – 15.0+ mm** | Very low pigment load; acts almost like stained glass. | Transparent PLA, Neon Yellow, Flesh tint | Soft glaze layering and photographic tonal blending. |

---

## 🖨️ Step 1: Print the 16-Step Test Wedge

To measure an unknown filament, print a standardized calibration step-wedge:

### Step-Wedge Specifications
- **Steps**: 16 steps, each $10\text{ mm} \times 10\text{ mm}$.
- **Base Step 1**: $0.08\text{ mm}$ thickness (1 layer).
- **Step 2**: $0.16\text{ mm}$ (2 layers).
- **Step 3**: $0.24\text{ mm}$ (3 layers).
- ...
- **Step 16**: $1.28\text{ mm}$ (16 layers).
- **Print Settings**: `0.08 mm` layer height, `100% infill`, `Aligned Rectilinear`, `0.4 mm nozzle`.

> [!TIP]
> You can download the TailWag calibration step-wedge STL directly from the `models/calibration/` folder in the repository or generate one using the CAD generator inside TailWag Studio.

---

## 📐 Step 2: Measurement Methods

### Method A: Optical Backlight Inspection (Fast & Practical)

1. Place your printed test step-wedge directly on top of a stark black-and-white grid pattern (or high-contrast printed text).
2. Look through the steps under uniform, bright ambient lighting.
3. Identify the **Opacity Threshold Step** ($S_{op}$): the thinnest step where the underlying black mark is 95–99% invisible.
4. Measure the physical thickness of this step using digital calipers (e.g. $0.48\text{ mm}$).
5. **Estimate TD**: For standard diffuse PLA, the effective $TD$ is approximately equal to the thickness at 90% opacity threshold.

---

### Method B: Lux Meter / Smartphone Light Sensor (Scientifically Accurate)

Using Beer-Lambert's attenuation law:

$$I(t) = I_0 \cdot e^{-\frac{t}{TD}}$$

Rearranging for $TD$:

$$TD = \frac{t}{\ln\left(\frac{I_0}{I_t}\right)}$$

Where:
- $I_0$: Baseline light intensity (lux) directly from light source.
- $I_t$: Light intensity measured through a step of known thickness $t$ (in mm).
- $TD$: Resulting Transmission Distance (in mm).

#### Step-by-Step Measurement:
1. Open a smartphone light meter app (or physical lux meter) placed in a dark box with a constant LED light source.
2. Measure baseline intensity: $I_0 = 1000\text{ lux}$.
3. Place a $0.80\text{ mm}$ step of your test wedge over the sensor.
4. Read attenuated intensity: $I_{0.80} = 220\text{ lux}$.
5. Calculate:
   $$\frac{I_0}{I} = \frac{1000}{220} \approx 4.545$$
   $$\ln(4.545) \approx 1.514$$
   $$TD = \frac{0.80}{1.514} \approx 0.528\text{ mm}$$

---

## 🎨 Step 3: Measuring Filament Color (Hex / LAB)

In addition to $TD$, TailWag requires the true solid base color:

1. Print a solid test swatch at least $2.0\text{ mm}$ thick (to ensure 100% opacity).
2. In TailWag Studio, open **Filament Manager** and click **+ Add Filament**.
3. **Determine Hex Code**:
   - *Option 1*: Use a digital colorimeter / spectrophotometer (e.g. Datacolor ColorReader, Nix Color Sensor).
   - *Option 2*: Photograph the 2.0 mm solid swatch under neutral 5000K daylight next to a white card, and sample the RGB values with an image editor.
   - *Option 3*: Reference official manufacturer swatch hex tables (e.g. Bambu Lab, Polymaker, eSun).

---

## 💾 Step 4: Saving to TailWag Filament Library

Once measured, add your spool to TailWag:

```json
{
  "id": "bambu_pla_basic_jade_white",
  "brand": "Bambu Lab",
  "material": "PLA Basic",
  "name": "Jade White",
  "hex": "#FFFFFF",
  "td": 5.0,
  "costPerKg": 19.99
}
```

1. Click **Filament Library** in the left sidebar.
2. Click **Add Custom Filament**.
3. Enter Brand, Name, Material Type, Hex Color, and measured $TD$.
4. Click **Save**. Your custom filament is now immediately available in the Color Mapping palette and auto-matching engines.

---

## 💡 Troubleshooting Calibration Anomalies

- **Silk Filaments**: Contain polyester or TPU modifiers that cause intense specular sheen. Silk filaments typically exhibit higher apparent translucency when illuminated from angles. Measure them under perpendicular diffuse light.
- **Matte Filaments**: Contain mineral chalk or diatomaceous earth fillers. They have lower internal reflection and scatter light heavily, resulting in lower $TD$ (0.5–1.2 mm).
- **Printing Temperature Variance**: Printing 10–15°C hotter than normal melts polymer crystals more uniformly, slightly increasing translucency and bumping $TD$ by 5–10%. Calibrate at the exact nozzle temperature you intend to print with.

---

## 🔗 Related Wiki Documentation
- [[Filament Painting Science|Filament-Painting-Science]]: Beer-Lambert and optical physics behind TD.
- [[Slicer Setup & Print Settings|Slicer-Setup-and-Print-Settings]]: Recommended slice heights and infills.
- [[Studio User Guide|Studio-User-Guide]]: Managing palettes and running the Color Optimizer.
