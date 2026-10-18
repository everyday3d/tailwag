# 🎨 Creative Projects & Fun Ideas

Filament painting is not limited to flat decorative squares on a desk. By pairing TailWag Studio's multi-color optical engine with simple hardware components, you can create functional art, glowing displays, and personalized gifts.

Here are tested project blueprints to spark your creativity.

---

## ⏰ 1. Functional Quartz Wall Clocks

Transform any portrait, anime artwork, or scenic landscape into a functioning modern wall clock.

```
┌─────────────────────────────────┐
│              12                 │
│         ┌───────────┐           │
│         │  TailWag  │           │
│   9     │  Artpiece │     3     │
│         │   (Center │           │
│         │    Hole)  │           │
│         └─────┬─────┘           │
│               6                 │
└───────────────┼─────────────────┘
                ▼
      [Quartz Silent Sweep]
      [Mechanism on Back]
```

### Blueprint Specifications:
- **Canvas Size**: $200 \times 200\text{ mm}$ (or $220\times 220\text{ mm}$ round).
- **Center Hole**: $8.2\text{ mm}$ diameter hole placed at exact geometric center.
  - *How to create in TailWag*: In the **CAD Shapes** panel, add a cylinder hole primitive ($8.2\text{ mm}$ diameter, full depth) at coordinates $(X: 0, Y: 0)$.
- **Hardware Needed**: Standard high-torque silent sweep quartz clock movement ($8\text{ mm}$ shaft diameter, $12\text{ mm}$ thread length) + 1x AA battery.
- **Assembly**: Insert movement spindle from rear, secure with brass washer and hex nut, press-fit hour, minute, and second hands.

---

## 💡 2. Backlit LED Lightboxes & Nightlights

While traditional filament paintings are front-lit, high-translucency designs make stunning backlit lightboxes.

### Blueprint Specifications:
- **Canvas Size**: $150 \times 150\text{ mm}$ or $180 \times 120\text{ mm}$.
- **Base Layer**: Use **Jade White** ($TD \ge 5.0\text{ mm}$) or **Clear/Translucent PLA** instead of Black for the base layer.
- **Color Sequence**: Start with white base ($0.4\text{ mm}$ thick), then layer Cyan/Yellow/Magenta or Blue/Orange midtones, finishing with ultra-thin Black details on top.
- **Enclosure**: 3D print a 5-sided shadowbox enclosure ($40\text{ mm}$ depth) with an internal lip.
- **Lighting**: Adhere a strip of **5V COB LED strip** ($6000\text{K}$ clean white or warm $3000\text{K}$) around the interior perimeter, powered via USB-C breakout board.

---

## 🧲 3. Collectible Refrigerator Magnets

Small, fast-printing filament art makes great gifts and convention merch:

### Blueprint Specifications:
- **Dimensions**: $65\text{ mm} \times 65\text{ mm}$ (or $70\text{ mm}$ round).
- **Print Time**: Approximately 35–50 minutes per magnet on modern high-speed printers.
- **Magnet Cavities**: Use TailWag CAD shapes or your slicer negative volumes to add two $8.2\text{ mm} \times 2.2\text{ mm}$ cylindrical cavities on the bottom face.
- **Hardware**: Press-fit or superglue two $8\times 2\text{ mm}$ N52 neodymium disc magnets into the cavities.

---

## 🎭 4. Minimalist Duotone & Film Noir Portraits

You do not need 8 spools to create breathtaking art. Some of the most striking prints use only **2 or 3 spools**:

### Classic Monochrome Triad:
- **Layer 1-10**: Jet Black ($TD = 0.3$)
- **Layer 11-18**: Slate Grey ($TD = 1.8$)
- **Layer 19-28**: Cold White ($TD = 4.5$)

### Vintage Sepia Warmth:
- **Layer 1-10**: Espresso Brown ($TD = 0.5$)
- **Layer 11-17**: Caramel / Tan ($TD = 2.2$)
- **Layer 18-28**: Cream / Off-White ($TD = 5.2$)

> [!TIP]
> Use TailWag's **Image Pre-Press Filters** to set **Saturation = 0** and adjust the **Contrast** and **Levels Gamma** curve to create dramatic high-contrast chiaroscuro lighting before running the color optimizer.

---

## 🛡️ 5. Keychains & Wearable Badges with UV Resin Doming

Filament paintings are printed flat, making them ideal for UV resin finishes that protect against keys and pocket wear:

1. Print your design at $45\times 45\text{ mm}$ with a $3.5\text{ mm}$ hole in one corner.
2. Place the finished print on a level silicone mat.
3. Gently squeeze a pool of crystal-clear **UV epoxy resin** onto the center.
4. Use a toothpick to guide the resin to the outer bevel edges (surface tension will hold a high-gloss rounded dome).
5. Pop any air bubbles using a quick pass with a lighter or heat gun.
6. Cure under a $365\text{nm}$ UV lamp for 2–3 minutes. The result is a glossy, water-resistant, glass-like finish that enhances color saturation.

---

## 🌈 6. Multi-Brand Palette Mixing

Don't limit yourself to one filament brand. TailWag Studio allows you to mix and match spools from any manufacturer in a single print:

- **Bambu Lab PLA Basic**: Outstanding high-TD Jade White ($TD \approx 5.0$) and punchy Cyan/Magenta.
- **Polymaker PolyLite PLA**: Known for highly repeatable $TD$ consistency and rich earth tones.
- **eSun PLA+**: Great structural stiffness and deep opaque Black ($TD \approx 0.3$).
- **Overture PLA Matte**: Soft pastel midtones that diffuse interior light gently.

---

## 🔗 Related Wiki Documentation
- [[Getting Started|Getting-Started]]: Setting up your first project.
- [[Studio User Guide|Studio-User-Guide]]: Using CAD shapes and pre-press filters.
- [[Slicer Setup & Print Settings|Slicer-Setup-and-Print-Settings]]: Recommended print parameters.
- [[TD Calibration Guide|TD-Calibration-Guide]]: Adding new custom filament spools to your library.
