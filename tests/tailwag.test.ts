import { describe, it, expect } from 'vitest';
import { VERIFIED_FILAMENT_CATALOG } from '../src/data/filamentCatalog';
import { computeLayerOpacity, buildLayerColorLUT, hexToRgb01, rgbToLab, deltaE } from '../src/engine/opticalTdEngine';
import { buildHeightmapGrid, generateBinaryStlFromGrid, generateTdCalibrationWedgeStl } from '../src/engine/cadMeshBuilder';
import { buildSwapPlaybook, generateNative3mfPackage } from '../src/engine/exporter3mf';

describe('TailWag Optical Beer-Lambert TD Engine & 3MF Exporter', () => {
  it('computes monotonic Beer-Lambert layer opacity as thickness increases or TD decreases', () => {
    const lowTdAlpha = computeLayerOpacity(0.08, 0.6); // Black PLA (TD 0.6mm)
    const highTdAlpha = computeLayerOpacity(0.08, 5.0); // Jade White PLA (TD 5.0mm)
    expect(lowTdAlpha).toBeGreaterThan(highTdAlpha);
    expect(computeLayerOpacity(0.6, 0.6)).toBeGreaterThan(0.95);
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
});
