import { FilamentSpool } from '../data/filamentCatalog';

export interface FilamentImportResult {
  spools: FilamentSpool[];
  sourceFormat: 'hueforge' | 'tailwag' | 'generic';
  skippedCount: number;
  libraryId: string;
  libraryName: string;
}

function normalizeMaterial(raw: unknown): FilamentSpool['material'] {
  const s = String(raw || 'PLA').toUpperCase();
  if (s.includes('MATTE')) return 'PLA Matte';
  if (s.includes('SILK')) return 'PLA Silk';
  if (s.includes('PLA+')) return 'PLA+';
  if (s.includes('COPE')) return 'COPE';
  if (s.includes('PETG')) return 'PETG';
  if (s.includes('ABS')) return 'ABS';
  if (s.includes('ASA')) return 'ASA';
  if (s.includes('TPU')) return 'TPU';
  return 'PLA';
}

function normalizeHexColor(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    let clean = raw.trim();
    if (clean.startsWith('0x') || clean.startsWith('0X')) {
      clean = '#' + clean.slice(2);
    } else if (!clean.startsWith('#') && /^[0-9a-fA-F]{6,8}$/.test(clean)) {
      clean = '#' + clean;
    }
    if (/^#[0-9a-fA-F]{8}$/.test(clean)) {
      clean = clean.slice(0, 7);
    }
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
      return clean.toUpperCase();
    }
    if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
      const r = clean[1];
      const g = clean[2];
      const b = clean[3];
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
  } else if (Array.isArray(raw) && raw.length >= 3) {
    const [r, g, b] = raw.map((v) => {
      const num = Number(v);
      const scaled = num <= 1 && raw.every((x) => Number(x) <= 1) ? Math.round(num * 255) : Math.round(num);
      return Math.max(0, Math.min(255, scaled));
    });
    return (
      '#' +
      [r, g, b]
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
    );
  }
  return null;
}

const NAMED_COLOR_ANCHORS: Array<{ name: string; r: number; g: number; b: number }> = [
  { name: 'Jet Black', r: 18, g: 18, b: 20 },
  { name: 'Charcoal Grey', r: 54, g: 58, b: 62 },
  { name: 'Slate Grey', r: 108, g: 115, b: 122 },
  { name: 'Ash Silver', r: 165, g: 170, b: 175 },
  { name: 'Jade White', r: 245, g: 247, b: 248 },
  { name: 'Ivory Cream', r: 235, g: 224, b: 202 },
  { name: 'Warm Beige', r: 215, g: 186, b: 158 },
  { name: 'Desert Tan', r: 175, g: 155, b: 125 },
  { name: 'Caramel Fawn', r: 196, g: 132, b: 78 },
  { name: 'Saddle Brown', r: 125, g: 68, b: 38 },
  { name: 'Dark Cocoa Brown', r: 78, g: 45, b: 28 },
  { name: 'Espresso Brown', r: 48, g: 30, b: 22 },
  { name: 'Terracotta Rust', r: 168, g: 72, b: 44 },
  { name: 'Crimson Red', r: 198, g: 36, b: 42 },
  { name: 'Wine Burgundy', r: 105, g: 24, b: 38 },
  { name: 'Coral Salmon', r: 242, g: 132, b: 116 },
  { name: 'Blush Pink', r: 244, g: 166, b: 184 },
  { name: 'Tangerine Orange', r: 242, g: 112, b: 34 },
  { name: 'Amber Gold', r: 228, g: 162, b: 36 },
  { name: 'Sunflower Yellow', r: 248, g: 214, b: 28 },
  { name: 'Lemon Yellow', r: 246, g: 238, b: 118 },
  { name: 'Olive Drab', r: 78, g: 84, b: 44 },
  { name: 'Deep Forest Green', r: 22, g: 46, b: 36 },
  { name: 'Pine Green', r: 36, g: 82, b: 74 },
  { name: 'Emerald Green', r: 24, g: 156, b: 78 },
  { name: 'Mint Sage', r: 132, g: 188, b: 156 },
  { name: 'Dark Abyssal Teal', r: 16, g: 32, b: 34 },
  { name: 'Deep Ocean Teal', r: 42, g: 94, b: 92 },
  { name: 'Seafoam Teal', r: 64, g: 142, b: 134 },
  { name: 'Turquoise Cyan', r: 38, g: 174, b: 196 },
  { name: 'Sky Blue', r: 96, g: 184, b: 222 },
  { name: 'Cobalt Blue', r: 28, g: 88, b: 178 },
  { name: 'Navy Blue', r: 22, g: 38, b: 86 },
  { name: 'Royal Purple', r: 106, g: 52, b: 156 },
  { name: 'Lavender Lilac', r: 176, g: 146, b: 212 },
];

function inferColorNameFromHex(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;

  let bestName = 'Custom Shade';
  let bestDist = Infinity;
  for (const anchor of NAMED_COLOR_ANCHORS) {
    const dr = r - anchor.r;
    const dg = g - anchor.g;
    const db = b - anchor.b;
    const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (dist < bestDist) {
      bestDist = dist;
      bestName = anchor.name;
    }
  }
  return `${bestName} (${hex.toUpperCase()})`;
}

function isBareHexName(name: string): boolean {
  return /^#?[0-9a-fA-F]{3,8}$/.test(name.trim());
}

/**
 * Parses a user-uploaded .json Filament Library file.
 * Supports:
 * - HueForge JSON format: `{ "Filaments": [{ "Brand", "Name", "Type", "Color", "Transmissivity", ... }] }`
 * - TailWag Studio JSON format: `[{ "id", "brand", "name", "material", "hex", "td", "owned" }]` or `{ "filaments": [...] }`
 */
export function parseFilamentLibraryJson(
  jsonText: string,
  libraryName: string = 'filaments.json',
  customLibraryId?: string
): FilamentImportResult {
  const parsed = JSON.parse(jsonText);
  const libraryId =
    customLibraryId ||
    `lib-${libraryName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;

  let rawList: Record<string, unknown>[] = [];
  let sourceFormat: FilamentImportResult['sourceFormat'] = 'generic';

  if (Array.isArray(parsed)) {
    rawList = parsed;
    if (rawList.length > 0 && ('Transmissivity' in rawList[0] || 'Brand' in rawList[0])) {
      sourceFormat = 'hueforge';
    } else if (rawList.length > 0 && 'td' in rawList[0] && 'hex' in rawList[0]) {
      sourceFormat = 'tailwag';
    }
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.Filaments)) {
      rawList = obj.Filaments as Record<string, unknown>[];
      sourceFormat = 'hueforge';
    } else if (Array.isArray(obj.filaments)) {
      rawList = obj.filaments as Record<string, unknown>[];
      sourceFormat = 'tailwag';
    } else if (Array.isArray(obj.spools)) {
      rawList = obj.spools as Record<string, unknown>[];
      sourceFormat = 'tailwag';
    } else if (Array.isArray(obj.data)) {
      rawList = obj.data as Record<string, unknown>[];
    } else {
      const values = Object.values(obj).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
      if (values.length > 0) {
        rawList = values as Record<string, unknown>[];
      }
    }
  }

  // Check if the library has real non-IMAGE spools; if so, filter out HueForge "Type": "IMAGE" pseudo-entries
  const hasRealSpools = rawList.some((item) => {
    if (!item || typeof item !== 'object') return false;
    const t = String(item.Type ?? item.type ?? item.material ?? '').trim().toUpperCase();
    const b = String(item.Brand ?? item.brand ?? '').trim();
    return t !== 'IMAGE' && b.length > 0;
  });

  const spools: FilamentSpool[] = [];
  let skippedCount = 0;
  const seenIds = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') {
      skippedCount++;
      continue;
    }

    const rawType = String(item.material ?? item.Type ?? item.type ?? item.Material ?? '').trim();
    const isImageSwatch = rawType.toUpperCase() === 'IMAGE';

    if (hasRealSpools && isImageSwatch) {
      skippedCount++;
      continue;
    }

    const rawBrand = String(
      item.brand ?? item.Brand ?? item.Manufacturer ?? item.manufacturer ?? item.vendor ?? ''
    ).trim();
    const brand = rawBrand || (isImageSwatch ? 'Imported Image' : 'Custom');

    const rawName = String(
      item.name ?? item.Name ?? item.color_name ?? item.ColorName ?? item.title ?? ''
    ).trim();

    const hex = normalizeHexColor(
      item.hex ?? item.Hex ?? item.Color ?? item.color ?? item.rgb ?? item.RGB ?? item.hexColor
    );

    const rawTd =
      item.td ??
      item.TD ??
      item.Transmissivity ??
      item.transmissivity ??
      item.transmission_distance ??
      item.transmissionDistance ??
      item.td_mm;

    const tdNum = Number(rawTd);
    const td = Number.isFinite(tdNum) && tdNum > 0 ? Math.max(0.1, Math.min(30, tdNum)) : 3.0;

    if (!hex && !rawName) {
      skippedCount++;
      continue;
    }

    const finalHex = hex || '#CCCCCC';
    const material = normalizeMaterial(rawType || rawName);
    const displayName =
      !rawName || isBareHexName(rawName)
        ? inferColorNameFromHex(finalHex)
        : rawName;

    const baseSlug = `${brand}-${displayName}-${finalHex}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let id = String(item.id ?? item.uuid ?? item.ID ?? `json-${baseSlug || i}`);
    if (seenIds.has(id)) {
      id = `${id}-${i}`;
    }
    seenIds.add(id);

    spools.push({
      id,
      brand,
      name: displayName,
      material,
      hex: finalHex,
      td: Math.round(td * 10) / 10,
      owned: true,
      amsSlot: typeof item.amsSlot === 'string' ? item.amsSlot : undefined,
      stock: item.stock === 'low' || item.stock === 'out' ? item.stock : undefined,
      tdSource:
        item.tdSource === 'measured' || item.tdSource === 'user' || item.tdSource === 'estimate'
          ? item.tdSource
          : 'user',
      libraryId,
      libraryName,
    });
  }

  return {
    spools,
    sourceFormat,
    skippedCount,
    libraryId,
    libraryName,
  };
}

/**
 * Serializes a list of FilamentSpool objects into a dual-compatible JSON string
 * (works natively in both TailWag Studio and HueForge).
 */
export function serializeFilamentLibraryJson(spools: FilamentSpool[]): string {
  const payload = {
    schema: 'tailwag-filament-library-v1',
    exportedAt: new Date().toISOString(),
    count: spools.length,
    filaments: spools.map((s) => ({
      id: s.id,
      brand: s.brand,
      name: s.name,
      material: s.material,
      hex: s.hex,
      td: s.td,
      owned: s.owned,
      amsSlot: s.amsSlot,
      stock: s.stock,
      tdSource: s.tdSource,
      Brand: s.brand,
      Name: s.name,
      Type: s.material,
      Color: s.hex,
      Transmissivity: s.td,
      Owned: s.owned,
    })),
    Filaments: spools.map((s) => ({
      Brand: s.brand,
      Name: s.name,
      Type: s.material,
      Color: s.hex,
      Transmissivity: s.td,
      Owned: s.owned,
      uuid: s.id,
      amsSlot: s.amsSlot,
      stock: s.stock,
      tdSource: s.tdSource,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
