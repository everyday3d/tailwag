import type { FilamentSpool } from './filamentCatalog';
import { VERIFIED_FILAMENT_CATALOG } from './filamentCatalog';
import { estimateTdFromHex } from '../engine/tdPrior';
import { hexToRgb01, rgbToLab } from '../engine/opticalTdEngine';

/**
 * Bundled manufacturer catalog (versioned, offline).
 *
 * Provenance: colors are approximate values compiled from public manufacturer color charts.
 * They are NOT measurements of a specific spool. TD values are hue/lightness estimates unless an
 * entry already exists in VERIFIED_FILAMENT_CATALOG. Every entry is flagged `confidence: 'approx'`
 * and should be corrected by the user's calibration plate.
 */
export const MANUFACTURER_CATALOG_VERSION = '2026.10.1';
export const MANUFACTURER_CATALOG_SOURCE =
  'Approximate color from public manufacturer charts; verify against your spool.';

export type HueFamily =
  | 'white'
  | 'gray'
  | 'black'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'brown';

export interface CatalogEntry extends FilamentSpool {
  catalogId: string;
  line: string;
  hueFamily: HueFamily;
  confidence: 'approx' | 'verified';
  source: string;
  /** Public manufacturer page to verify the color against, when known */
  sourceUrl?: string;
}

type Row = [brand: string, line: string, material: FilamentSpool['material'], name: string, hex: string];

const ROWS: Row[] = [
  // Bambu Lab — PLA Basic
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Pink', '#F55A74'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Magenta', '#EC008C'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Purple', '#5E43B7'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Turquoise', '#00B1B7'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Sunflower Yellow', '#FEC600'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Pumpkin Orange', '#FF9016'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Bright Green', '#BECF00'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Cocoa Brown', '#6F5034'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Gray', '#8E9089'],
  ['Bambu Lab', 'PLA Basic', 'PLA', 'Beige', '#E4BD68'],
  // Bambu Lab — PLA Matte
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Lilac Purple', '#AE96D4'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Sakura Pink', '#E8AFCF'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Lemon Yellow', '#F7D959'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Apple Green', '#C2E189'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Ice Blue', '#A3D8E1'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Dark Blue', '#042F56'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Dark Red', '#BB3D43'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Plum', '#851A52'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Grass Green', '#61C680'],
  ['Bambu Lab', 'PLA Matte', 'PLA Matte', 'Terracotta', '#A25A37'],
  // Polymaker
  ['Polymaker', 'PolyTerra', 'PLA Matte', 'Lavender Purple', '#B5A5D5'],
  ['Polymaker', 'PolyTerra', 'PLA Matte', 'Fossil Grey', '#A2A5A3'],
  ['Polymaker', 'PolyTerra', 'PLA Matte', 'Banana', '#F4E58B'],
  ['Polymaker', 'PolyTerra', 'PLA Matte', 'Forest Green', '#3E6B48'],
  ['Polymaker', 'PolyTerra', 'PLA Matte', 'Cherry Red', '#B3262C'],
  ['Polymaker', 'PolyTerra', 'PLA Matte', 'Pink', '#E6A6B8'],
  ['Polymaker', 'PolyTerra', 'PLA Matte', 'Teal', '#2F8F8B'],
  ['Polymaker', 'PolyLite', 'PLA', 'Black', '#1C1C1C'],
  ['Polymaker', 'PolyLite', 'PLA', 'White', '#F4F4F2'],
  ['Polymaker', 'PolyLite', 'PLA', 'Red', '#C62828'],
  ['Polymaker', 'PolyLite', 'PLA', 'Blue', '#1E4FA0'],
  ['Polymaker', 'PolyLite', 'PLA', 'Yellow', '#F2CF1B'],
  // eSun
  ['eSun', 'PLA+', 'PLA+', 'Black', '#1A1A1A'],
  ['eSun', 'PLA+', 'PLA+', 'Blue', '#1F4FA3'],
  ['eSun', 'PLA+', 'PLA+', 'Yellow', '#F5D90A'],
  ['eSun', 'PLA+', 'PLA+', 'Orange', '#F28C28'],
  ['eSun', 'PLA+', 'PLA+', 'Green', '#2E8B57'],
  ['eSun', 'PLA+', 'PLA+', 'Grey', '#8A8D8F'],
  ['eSun', 'PLA+', 'PLA+', 'Skin', '#EBC9A6'],
  ['eSun', 'PLA+', 'PLA+', 'Silver', '#BFC1C2'],
  // Elegoo
  ['Elegoo', 'PLA', 'PLA', 'Grey', '#8E9196'],
  ['Elegoo', 'PLA', 'PLA', 'Red', '#D32F2F'],
  ['Elegoo', 'PLA', 'PLA', 'Blue', '#1E5AA8'],
  ['Elegoo', 'PLA', 'PLA', 'Yellow', '#F2D027'],
  ['Elegoo', 'PLA', 'PLA', 'Green', '#2E9E4F'],
  ['Elegoo', 'PLA', 'PLA', 'Orange', '#F28A1E'],
  ['Elegoo', 'PLA', 'PLA', 'Skin', '#F0C8A0'],
  // Sunlu
  ['Sunlu', 'PLA+', 'PLA+', 'Red', '#C9252C'],
  ['Sunlu', 'PLA+', 'PLA+', 'Blue', '#1F55A8'],
  ['Sunlu', 'PLA+', 'PLA+', 'Yellow', '#F4D21E'],
  ['Sunlu', 'PLA+', 'PLA+', 'Green', '#2F9D52'],
  ['Sunlu', 'PLA+', 'PLA+', 'Orange', '#F2862A'],
  // Hatchbox
  ['Hatchbox', 'PLA', 'PLA', 'Black', '#1B1B1B'],
  ['Hatchbox', 'PLA', 'PLA', 'White', '#F4F4F2'],
  ['Hatchbox', 'PLA', 'PLA', 'Red', '#C62828'],
  ['Hatchbox', 'PLA', 'PLA', 'Blue', '#1E4FA0'],
  ['Hatchbox', 'PLA', 'PLA', 'Yellow', '#F2CF1B'],
  ['Hatchbox', 'PLA', 'PLA', 'Orange', '#EF7D1A'],
  ['Hatchbox', 'PLA', 'PLA', 'Green', '#2F8F46'],
  ['Hatchbox', 'PLA', 'PLA', 'Gray', '#8B8E91'],
  ['Hatchbox', 'PLA', 'PLA', 'Silver', '#B8BABD'],
  ['Hatchbox', 'PLA', 'PLA', 'Gold', '#C9A227'],
  // Overture
  ['Overture', 'PLA', 'PLA', 'Black', '#1D1D1F'],
  ['Overture', 'PLA', 'PLA', 'White', '#F3F3F1'],
  ['Overture', 'PLA', 'PLA', 'Red', '#C7262D'],
  ['Overture', 'PLA', 'PLA', 'Blue', '#1F57A6'],
  ['Overture', 'PLA', 'PLA', 'Grey', '#8D9094'],
  ['Overture', 'PLA', 'PLA', 'Yellow', '#F3D01E'],
  ['Overture', 'PLA', 'PLA', 'Orange', '#F28A22'],
  ['Overture', 'PLA', 'PLA', 'Green', '#2F9B50'],
  // Prusament
  ['Prusament', 'PLA', 'PLA', 'Prusa Orange', '#FA6831'],
  ['Prusament', 'PLA', 'PLA', 'Galaxy Black', '#2A2B2E'],
  ['Prusament', 'PLA', 'PLA', 'Jet Black', '#0D0D0D'],
  ['Prusament', 'PLA', 'PLA', 'Lipstick Red', '#B0202A'],
  ['Prusament', 'PLA', 'PLA', 'Azure Blue', '#2C6FBB'],
  ['Prusament', 'PLA', 'PLA', 'Galaxy Silver', '#8F9498'],
  // Creality
  ['Creality', 'Hyper PLA', 'PLA', 'Black', '#1C1C1C'],
  ['Creality', 'Hyper PLA', 'PLA', 'White', '#F5F5F5'],
  ['Creality', 'Hyper PLA', 'PLA', 'Grey', '#8C8F92'],
  ['Creality', 'Hyper PLA', 'PLA', 'Red', '#CF2A2A'],
  ['Creality', 'Hyper PLA', 'PLA', 'Blue', '#1F5FBF'],
  ['Creality', 'Hyper PLA', 'PLA', 'Yellow', '#F5D327'],
  ['Creality', 'Hyper PLA', 'PLA', 'Green', '#2FA84F'],
  ['Creality', 'Hyper PLA', 'PLA', 'Orange', '#F28C1E'],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Public manufacturer pages each brand's colors were compiled against. Colors are still
 * approximate (see MANUFACTURER_CATALOG_SOURCE); the URL tells a reviewer where to verify.
 * Every brand present in the catalog must have an entry (enforced by a test).
 */
export const BRAND_SOURCES: Record<string, string> = {
  'Bambu Lab': 'https://bambulab.com/en/filament',
  Polymaker: 'https://polymaker.com',
  eSun: 'https://www.esun3d.com',
  Elegoo: 'https://www.elegoo.com',
  Sunlu: 'https://www.sunlu.com',
  Hatchbox: 'https://www.hatchbox3d.com',
  Overture: 'https://overturebrand.com',
  Prusament: 'https://www.prusa3d.com/category/prusament/',
  Creality: 'https://www.creality.com',
};

/** Classifies a hex color into a coarse family for filtering. */
export function hueFamilyOf(hex: string): HueFamily {
  const lab = rgbToLab(hexToRgb01(hex));
  const chroma = Math.hypot(lab.a, lab.b);
  if (chroma < 9) {
    if (lab.L > 88) return 'white';
    if (lab.L < 22) return 'black';
    return 'gray';
  }
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  if (h >= 20 && h < 85 && lab.L < 55 && chroma < 45) return 'brown';
  if (h >= 340 || h < 20) return lab.L > 65 ? 'pink' : 'red';
  if (h < 50) return 'orange';
  if (h < 105) return 'yellow';
  if (h < 175) return 'green';
  if (h < 235) return 'cyan';
  if (h < 295) return 'blue';
  if (h < 330) return 'purple';
  return lab.L > 60 ? 'pink' : 'red';
}

function buildCatalog(): CatalogEntry[] {
  const verifiedKeys = new Set(
    VERIFIED_FILAMENT_CATALOG.map((s) => `${s.brand}|${s.name}`.toLowerCase())
  );
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];

  for (const v of VERIFIED_FILAMENT_CATALOG) {
    const catalogId = `cat-${v.id}`;
    out.push({
      ...v,
      owned: false,
      amsSlot: undefined,
      catalogId,
      line: v.material,
      hueFamily: hueFamilyOf(v.hex),
      tdSource: 'catalog',
      confidence: 'verified',
      source: 'Bundled verified catalog',
      sourceUrl: BRAND_SOURCES[v.brand],
    });
    seen.add(catalogId);
  }

  for (const [brand, line, material, name, hex] of ROWS) {
    if (verifiedKeys.has(`${brand}|${name}`.toLowerCase())) continue;
    const catalogId = `cat-${slug(brand)}-${slug(line)}-${slug(name)}`;
    if (seen.has(catalogId)) continue;
    seen.add(catalogId);
    out.push({
      id: catalogId,
      catalogId,
      brand,
      line,
      name: `${line} ${name}`,
      material,
      hex: hex.toUpperCase(),
      td: estimateTdFromHex(hex),
      tdSource: 'estimate',
      hueFamily: hueFamilyOf(hex),
      confidence: 'approx',
      source: MANUFACTURER_CATALOG_SOURCE,
      sourceUrl: BRAND_SOURCES[brand],
    });
  }
  return out;
}

export const MANUFACTURER_CATALOG: CatalogEntry[] = buildCatalog();

export interface CatalogQuery {
  text?: string;
  brand?: string;
  material?: string;
  hueFamily?: HueFamily;
  tdMin?: number;
  tdMax?: number;
}

export function searchManufacturerCatalog(
  query: CatalogQuery,
  catalog: CatalogEntry[] = MANUFACTURER_CATALOG
): CatalogEntry[] {
  const q = (query.text ?? '').trim().toLowerCase();
  const tokens = q.length > 0 ? q.split(/\s+/) : [];
  return catalog.filter((e) => {
    if (query.brand && e.brand !== query.brand) return false;
    if (query.material && e.material !== query.material) return false;
    if (query.hueFamily && e.hueFamily !== query.hueFamily) return false;
    if (query.tdMin !== undefined && e.td < query.tdMin) return false;
    if (query.tdMax !== undefined && e.td > query.tdMax) return false;
    if (tokens.length === 0) return true;
    const hay = `${e.brand} ${e.line} ${e.name} ${e.material} ${e.hex} ${e.hueFamily}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export function catalogBrands(catalog: CatalogEntry[] = MANUFACTURER_CATALOG): string[] {
  return Array.from(new Set(catalog.map((e) => e.brand))).sort((a, b) => a.localeCompare(b));
}

export function catalogMaterials(catalog: CatalogEntry[] = MANUFACTURER_CATALOG): string[] {
  return Array.from(new Set(catalog.map((e) => e.material))).sort((a, b) => a.localeCompare(b));
}
