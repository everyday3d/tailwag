import { describe, it, expect } from 'vitest';
import { VERIFIED_FILAMENT_CATALOG } from '../src/data/filamentCatalog';
import { computeLayerOpacity, buildLayerColorLUT, hexToRgb01, rgbToLab, deltaE } from '../src/engine/opticalTdEngine';
import { buildHeightmapGrid, generateBinaryStlFromGrid, generateTdCalibrationWedgeStl } from '../src/engine/cadMeshBuilder';
import { buildSwapPlaybook, generateNative3mfPackage } from '../src/engine/exporter3mf';
import { parseFilamentLibraryJson, serializeFilamentLibraryJson } from '../src/utils/filamentJsonIO';

describe('TailWag Optical Beer-Lambert TD Engine & 3MF Exporter', () => {
  it('computes monotonic Beer-Lambert layer opacity as thickness increases or TD decreases', () => {
    const lowTdAlpha = computeLayerOpacity(0.08, 0.6); // Black PLA (TD 0.6mm)
    const highTdAlpha = computeLayerOpacity(0.08, 5.0); // Jade White PLA (TD 5.0mm)
    expect(lowTdAlpha).toBeGreaterThan(highTdAlpha);
    expect(computeLayerOpacity(0.6, 0.6)).toBeGreaterThan(0.90);
  });

  it('builds a 24-layer composite RGB LUT from filament swap slots', () => {
    const slots = [
      { id: 's1', spool: VERIFIED_FILAMENT_CATALOG[0], upToLayer: 6 },
      { id: 's2', spool: VERIFIED_FILAMENT_CATALOG[6], upToLayer: 12 },
      { id: 's3', spool: VERIFIED_FILAMENT_CATALOG[9], upToLayer: 18 },
      { id: 's4', spool: VERIFIED_FILAMENT_CATALOG[13], upToLayer: 24 },
    ];
    const lut = buildLayerColorLUT(24, 0.64, 0.08, slots);
    expect(lut).toHaveLength(24);
    expect(lut[0].layer).toBe(1);
    expect(lut[23].layer).toBe(24);
    // Top highlight layer should be brighter than base shadow layer
    const l1 = rgbToLab(lut[0].rgb).L;
    const l24 = rgbToLab(lut[23].rgb).L;
    expect(l24).toBeGreaterThan(l1);
  });

  it('generates watertight Binary STL and Native .3MF archives with 2.5D Clock & Magnet cutouts', () => {
    const size = 32;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(200);
    const grid = buildHeightmapGrid({
      imageData: { data: rgba, width: size, height: size, colorSpace: 'srgb' } as ImageData,
      gridRes: 32,
      widthMm: 180,
      heightMm: 180,
      baseLayerMm: 0.64,
      layerHeightMm: 0.08,
      totalLayers: 24,
      gamma: 1.0,
      contrast: 1.0,
      detailEnhance: 0.2,
      invertLuminance: false,
      cad: {
        shape: 'circle',
        frameStyle: 'beveled',
        frameWidthMm: 5,
        frameHeightBonusMm: 0.48,
        clockMode: true,
        clockShaftDiameterMm: 8.2,
        clockMovementPocket: true,
        clockStencil: 'none',
        keychainHole: false,
        keychainHoleDiameterMm: 4.5,
        magnetPockets: true,
        magnetDiameterMm: 8.2,
      },
    });

    const stl = generateBinaryStlFromGrid(grid);
    expect(stl.byteLength).toBeGreaterThan(84);

    const slots = [
      { id: 's1', spool: VERIFIED_FILAMENT_CATALOG[0], upToLayer: 6 },
      { id: 's2', spool: VERIFIED_FILAMENT_CATALOG[13], upToLayer: 24 },
    ];
    const pkg3mf = generateNative3mfPackage({
      projectName: 'UnitTest_Clock',
      grid,
      baseLayerMm: 0.64,
      layerHeightMm: 0.08,
      totalLayers: 24,
      slots,
    });
    // PK zip magic header (0x50, 0x4b)
    expect(pkg3mf[0]).toBe(0x50);
    expect(pkg3mf[1]).toBe(0x4b);
  });

  it('generates >4 color single-AMS chaining instructions in swap playbook', () => {
    const slots = VERIFIED_FILAMENT_CATALOG.slice(0, 6).map((spool, idx) => ({
      id: `s-${idx}`,
      spool,
      upToLayer: (idx + 1) * 4,
    }));
    const playbook = buildSwapPlaybook(slots, 0.64, 0.08, 24);
    expect(playbook).toHaveLength(6);
    expect(playbook[4].chainingAction).toContain('Single-AMS Chaining');
  });

  it('generates TD calibration step-wedge binary STL', () => {
    const wedge = generateTdCalibrationWedgeStl(12, 0.16);
    expect(wedge.byteLength).toBeGreaterThan(1000);
  });

  it('parses HueForge and TailWag .json filament libraries and marks imported spools as Owned', () => {
    const hueforgeSample = JSON.stringify({
      Filaments: [
        {
          Brand: 'Bambu Lab',
          Name: 'PLA Matte Dark Brown',
          Type: 'PLA Matte',
          Color: '#4D3324',
          Transmissivity: 2.0,
        },
        {
          Brand: 'Polymaker',
          Name: 'PolyTerra Charcoal Black',
          Type: 'PLA',
          Color: '1A1A1A',
          Transmissivity: 0.6,
        },
      ],
    });
    const res = parseFilamentLibraryJson(hueforgeSample);
    expect(res.sourceFormat).toBe('hueforge');
    expect(res.spools).toHaveLength(2);
    expect(res.spools[0].owned).toBe(true);
    expect(res.spools[0].td).toBe(2.0);
    expect(res.spools[1].hex).toBe('#1A1A1A');

    const exported = serializeFilamentLibraryJson(res.spools);
    const roundTrip = parseFilamentLibraryJson(exported);
    expect(roundTrip.spools).toHaveLength(2);
    expect(roundTrip.spools[0].name).toBe('PLA Matte Dark Brown');
  });

  it('solves 4, 8, 12, and 16 color palettes across Owned spools from filaments.json and supports separate CMYK mode', async () => {
    const fs = await import('fs');
    const raw = fs.readFileSync('src/data/userDefaultFilaments.json', 'utf8');
    const parsed = parseFilamentLibraryJson(raw, 'filaments.json');
    expect(parsed.spools.length).toBeGreaterThanOrEqual(30);

    const { solveOptimalPalettes, solveCmykPalette } = await import('../src/engine/autoSolver');
    const size = 48;
    const rgba = new Uint8ClampedArray(size * size * 4);
    // Simulate a Boxer dog portrait: dark background/muzzle, dark earth brown ears, medium brown head, white chest blaze
    for (let i = 0; i < size * size; i++) {
      const f = i / (size * size);
      if (f < 0.25) {
        rgba[i * 4] = 18;
        rgba[i * 4 + 1] = 16;
        rgba[i * 4 + 2] = 15;
      } else if (f < 0.55) {
        rgba[i * 4] = 115;
        rgba[i * 4 + 1] = 78;
        rgba[i * 4 + 2] = 56;
      } else if (f < 0.82) {
        rgba[i * 4] = 162;
        rgba[i * 4 + 1] = 128;
        rgba[i * 4 + 2] = 98;
      } else {
        rgba[i * 4] = 248;
        rgba[i * 4 + 1] = 248;
        rgba[i * 4 + 2] = 248;
      }
      rgba[i * 4 + 3] = 255;
    }
    const imgData = { data: rgba, width: size, height: size, colorSpace: 'srgb' } as ImageData;

    for (const colorCount of [4, 8, 12, 16] as const) {
      const t0 = performance.now();
      const recipes = solveOptimalPalettes(imgData, parsed.spools, 24, 0.16, 0.08, colorCount);
      const elapsed = performance.now() - t0;
      expect(elapsed).toBeLessThan(150);
      expect(recipes[0].slots.length).toBeGreaterThanOrEqual(4);
      expect(recipes[0].slots.length).toBeLessThanOrEqual(colorCount);

      const names = recipes[0].slots.map((s) => `${s.spool.brand} - ${s.spool.name}`).join(' -> ');
      if (colorCount === 4 || colorCount === 8) {
        console.log(`Solved ${colorCount}-Color Model Accurate Stack:`, names);
      }
      // Must NEVER include alien hues (Mint Green, Sakura Pink, Indigo, Metallic Blue) on a brown portrait
      expect(names.toLowerCase()).not.toContain('green');
      expect(names.toLowerCase()).not.toContain('pink');
      expect(names.toLowerCase()).not.toContain('indigo');
      expect(names.toLowerCase()).toContain('brown');

      // Must advise user that more than 4 colors are not needed for this 4-cluster image
      expect(recipes[0].recommendedColors).toBe(4);
      expect(recipes[0].colorCountAdvisory).toContain('4 colors');
    }

    // Also test a real multi-hue Blue & Green nature/logo image to prove universal hue support
    const blueGreenRgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const f = i / (size * size);
      if (f < 0.22) {
        blueGreenRgba[i * 4] = 12;
        blueGreenRgba[i * 4 + 1] = 14;
        blueGreenRgba[i * 4 + 2] = 18;
      } else if (f < 0.52) {
        // Forest Green cluster
        blueGreenRgba[i * 4] = 45;
        blueGreenRgba[i * 4 + 1] = 145;
        blueGreenRgba[i * 4 + 2] = 65;
      } else if (f < 0.80) {
        // Sky / Light Blue cluster
        blueGreenRgba[i * 4] = 80;
        blueGreenRgba[i * 4 + 1] = 210;
        blueGreenRgba[i * 4 + 2] = 245;
      } else {
        blueGreenRgba[i * 4] = 250;
        blueGreenRgba[i * 4 + 1] = 250;
        blueGreenRgba[i * 4 + 2] = 250;
      }
      blueGreenRgba[i * 4 + 3] = 255;
    }
    const bgImgData = { data: blueGreenRgba, width: size, height: size, colorSpace: 'srgb' } as ImageData;
    const bgRecipes = solveOptimalPalettes(bgImgData, parsed.spools, 24, 0.16, 0.08, 4);
    const bgNames = bgRecipes[0].slots.map((s) => `${s.spool.brand} - ${s.spool.name}`).join(' -> ');
    console.log('Solved 4-Color Blue/Green Image Stack:', bgNames);
    expect(bgNames.toLowerCase()).toMatch(/green|blue/);

    const cmyk = solveCmykPalette(imgData, parsed.spools, 24, 0.16, 0.08, 4);
    expect(cmyk.slots).toHaveLength(4);
  });
});
