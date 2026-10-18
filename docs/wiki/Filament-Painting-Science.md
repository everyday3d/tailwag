# 🔬 The Science of Filament Painting & Optical TD Blending

Unlike 2D paper printing (which deposits ink droplets that chemically absorb light) or digital screens (which emit additive RGB light), **3D filament painting is an optical transmission phenomenon**.

When light strikes the surface of a multi-color 3D relief, it penetrates translucent plastic layers, undergoes wavelength-dependent absorption and scattering, reflects off lower opaque layers, and emerges back to the viewer's eye.

TailWag Studio calculates this behavior in real time using the **Beer-Lambert Law**, **Kubelka-Munk scattering theory**, and **CIE LAB perceptual color spaces ($\Delta E_{00}$)**.

---

## 📏 1. What is Transmission Distance ($TD$)?

**Transmission Distance ($TD$)** is the fundamental optical metric of 3D printing filament.

> [!NOTE]
> **Definition**: Transmission Distance is the thickness of printed filament (in millimeters) required for light to drop to $1/e$ ($\approx 36.8\%$) of its incident intensity, or practically, the thickness where a translucent color completely blocks the visibility of a contrasting color beneath it.

- **Low $TD$ (0.1 mm – 0.6 mm)**: Extremely opaque filament (e.g. Matte Black, Deep Navy, Dark Brown). These filaments block underlying light almost immediately within 1 to 3 layers.
- **Medium $TD$ (1.0 mm – 3.0 mm)**: Semi-translucent colors (e.g. Red, Orange, Green, Blue). Light passes through 5 to 15 layers ($0.4\text{ mm} - 1.2\text{ mm}$), creating smooth tonal transitions as thickness increases.
- **High $TD$ (4.0 mm – 8.0+ mm)**: High translucency filaments (e.g. White, Jade White, Yellow, Clear). Light penetrates deeply, allowing dark underlayers to show through as subtle tints.

---

## 💡 2. The Optical Physics Models

### Beer-Lambert Absorption Law
Light attenuation through a translucent layer of thickness $z$ and absorption coefficient $\alpha$:

$$I(z) = I_0 \cdot e^{-\alpha \cdot z}$$

Where:
- $I_0$ = Incident light intensity
- $z$ = Physical layer thickness (sum of layer heights, e.g. $N \times 0.08\text{ mm}$)
- $\alpha = \frac{1}{TD}$ = Wavelength-specific absorption coefficient of the filament material

When stacking multiple filament layers ($F_1, F_2, \dots, F_k$) each with thickness $z_k$ and color transmission spectra $T_k(\lambda)$:

$$T_{\text{total}}(\lambda) = \prod_{k=1}^m \exp\left(-\frac{z_k}{TD_k} \cdot [1 - T_k(\lambda)]\right)$$

### Kubelka-Munk Scattering Model
For diffuse scattering materials like PLA with titanium dioxide ($\text{TiO}_2$) white pigment or carbon black, Beer-Lambert alone is insufficient because light scatters forward and backward between layers.

Kubelka-Munk calculates absorption ($K$) and scattering ($S$):

$$\frac{K}{S} = \frac{(1 - R_\infty)^2}{2 R_\infty}$$

Where $R_\infty$ is the reflectance of an infinitely thick sample. TailWag Studio combines forward Beer-Lambert transmission with Kubelka-Munk reflectance matrices to predict exact RGB values on the screen.

---

## 👁️ 3. Perceptual Color Matching: CIEDE2000 ($\Delta E_{00}$)

Human eyes do not perceive color differences linearly in RGB space. A unit change in green is perceived very differently from a unit change in blue or yellow.

TailWag Studio converts all filament spectra and source pixels into **CIE $L^*a^*b^*$** color space and evaluates matching accuracy using the **CIEDE2000 ($\Delta E_{00}$)** formula:

$$\Delta E_{00} = \sqrt{\left(\frac{\Delta L'}{k_L S_L}\right)^2 + \left(\frac{\Delta C'}{k_C S_C}\right)^2 + \left(\frac{\Delta H'}{k_H S_H}\right)^2 + R_T \left(\frac{\Delta C'}{k_C S_C}\right)\left(\frac{\Delta H'}{k_H S_H}\right)}$$

### Interpreting $\Delta E$ Values

| $\Delta E_{00}$ Range | Perceptual Difference | Quality Assessment in TailWag |
| :--- | :--- | :--- |
| **$0.0 - 1.0$** | Imperceptible to the human eye | Flawless match |
| **$1.0 - 2.5$** | Noticeable only by trained eyes on close inspection | Excellent fidelity |
| **$2.5 - 5.0$** | Noticeable color shift, but acceptable in print art | Good artistic reproduction |
| **$> 5.0$** | Distinctly different hue or tone | Requires additional filament or manual tuning |

---

## 🖼️ 4. Front-Lit (Filament Painting) vs. Back-Lit (Lithophanes)

TailWag Studio supports both optical modalities with a single toggle:

```
+-------------------------------------------------------+
|  FRONT-LIT (Filament Painting)                        |
|  Light Source ===> Surface ==> [Reflected to Eye]     |
|                    Black Base Layer (Absorbs All)     |
+-------------------------------------------------------+
|  BACK-LIT (Traditional Lithophane)                    |
|  Backlight Source ===> [Transmitted Through] ===> Eye |
|                        Varying Thickness Modulates    |
+-------------------------------------------------------+
```

1. **Front-Lit Filament Painting**:
   - Best for wall art, framed portraits, plaques, and decorative tiles.
   - Requires a black or dark base layer to act as an optical black hole, absorbing all un-reflected light.
   - Viewed in normal room lighting.
2. **Back-Lit Lithophane**:
   - Best for nightlights, lamp shades, and window ornaments.
   - Thicker regions appear dark; thinner regions appear bright when illuminated from behind.
