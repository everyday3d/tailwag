import { FilamentSpool } from '../data/filamentCatalog';

export interface FilamentImportResult {
  spools: FilamentSpool[];
  sourceFormat: 'hueforge' | 'tailwag' | 'generic';
  skippedCount: number;
}

function normalizeMaterial(raw: unknown): FilamentSpool['material'] {
  const s = String(raw || 'PLA').toUpperCase();
  if (s.includes('MATTE')) return 'PLA Matte';
  if (s.includes('SILK')) return 'PLA Silk';
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
    // Strip alpha channel if 8-digit hex (#RRGGBBAA -> #RRGGBB)
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
      // Handle 0..1 float RGB arrays as well as 0..255 int arrays
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

/**
 * Parses a user-uploaded .json Filament Library file.
 * Supports:
 * - HueForge JSON format: `{ "Filaments": [{ "Brand", "Name", "Type", "Color", "Transmissivity", ... }] }`
 * - TailWag Studio JSON format: `[{ "id", "brand", "name", "material", "hex", "td", "owned" }]` or `{ "filaments": [...] }`
 * - Generic key-value or array filament JSON dumps
 */
export function parseFilamentLibraryJson(jsonText: string): FilamentImportResult {
  const parsed = JSON.parse(jsonText);

  let rawList: Record<string, unknown>[] = [];
  let sourceFormat: FilamentImportResult['sourceFormat'] = 'generic';

  if (Array.isArray(parsed)) {
    rawList = parsed;
    if (rawList.length > 0 && ('Transmissivity' in rawList[0] || 'Brand' in rawList[0])) {
      sourceFormat = 'hueforge';
    } else if (rawList.length > 0 && ('td' in rawList[0] && 'hex' in rawList[0])) {
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
      // Check if it's a dictionary of filament objects keyed by ID/name
      const values = Object.values(obj).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
      if (values.length > 0) {
        rawList = values as Record<string, unknown>[];
      }
    }
  }

  const spools: FilamentSpool[] = [];
  let skippedCount = 0;
  const seenIds = new Set<string>();

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') {
      skippedCount++;
      continue;
    }

    const brand = String(
      item.brand ?? item.Brand ?? item.Manufacturer ?? item.manufacturer ?? item.vendor ?? 'Custom'
    ).trim();

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
    const material = normalizeMaterial(item.material ?? item.Type ?? item.type ?? item.Material ?? rawName);

    // Build a clean display name that includes brand/material context if not already present
    const displayName = rawName || `${brand} ${material} ${finalHex}`;

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
      owned: true, // All filaments from the user's imported .json library are placed in Owned
      amsSlot: typeof item.amsSlot === 'string' ? item.amsSlot : undefined,
    });
  }

  return {
    spools,
    sourceFormat,
    skippedCount,
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
      // HueForge compatibility keys
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
      id: s.id,
      brand: s.brand,
      name: s.name,
      material: s.material,
      hex: s.hex,
      td: s.td,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
