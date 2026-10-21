/**
 * Fonts for raised or cut-through text (clock numerals, name plates). The bundled ones (OFL, via
 * @fontsource, imported in main.tsx) look the same on every computer and work offline. Fonts installed
 * on this computer can be used too ("system:<family>"); on a computer without that font the text falls
 * back to the plain sans-serif.
 */

export type BundledFont = 'modern' | 'classic' | 'roman' | 'tall' | 'script' | 'slab';
export type PrintFont = BundledFont | `system:${string}`;

export const PRINT_FONTS: Record<BundledFont, { label: string; family: string; weight: number }> = {
  modern: { label: 'Modern', family: 'IBM Plex Sans', weight: 700 },
  classic: { label: 'Classic serif', family: 'Playfair Display', weight: 700 },
  roman: { label: 'Roman capitals', family: 'Cinzel', weight: 700 },
  tall: { label: 'Tall', family: 'Bebas Neue', weight: 400 },
  script: { label: 'Script', family: 'Pacifico', weight: 400 },
  slab: { label: 'Heavy slab', family: 'Alfa Slab One', weight: 400 },
};

export const PRINT_FONT_ORDER: BundledFont[] = ['modern', 'classic', 'roman', 'tall', 'script', 'slab'];

const FALLBACK = '"Segoe UI", Arial, sans-serif';

export function systemFamily(font: PrintFont | undefined): string | null {
  return font && font.startsWith('system:') ? font.slice('system:'.length) : null;
}

/** A canvas font string, with plain fallbacks in case the font has not loaded or is not installed. */
export function fontSpec(font: PrintFont | undefined, px: number): string {
  const family = systemFamily(font);
  if (family) return `400 ${px}px "${family.replace(/"/g, '')}", ${FALLBACK}`;
  const f = PRINT_FONTS[(font as BundledFont) ?? 'modern'] ?? PRINT_FONTS.modern;
  return `${f.weight} ${px}px "${f.family}", ${FALLBACK}`;
}

/** Fonts load lazily; the canvas only uses one once it has loaded. Resolves when they are ready. */
export async function loadPrintFonts(fonts: PrintFont[] = PRINT_FONT_ORDER): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(fonts.map((f) => document.fonts.load(fontSpec(f, 40), '0123456789IVXLC Tucker').catch(() => undefined)));
}

/** True when this app can list the fonts installed on the computer (desktop app, recent Chromium). */
export function canListSystemFonts(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).queryLocalFonts === 'function';
}

let systemFontCache: string[] | null = null;

/** Families of the fonts installed on this computer, sorted. Must be called from a click or choice. */
export async function listSystemFonts(): Promise<string[]> {
  if (systemFontCache) return systemFontCache;
  if (!canListSystemFonts()) return [];
  const fonts: Array<{ family: string }> = await (window as any).queryLocalFonts();
  const bundled = new Set(Object.values(PRINT_FONTS).map((f) => f.family));
  systemFontCache = [...new Set(fonts.map((f) => f.family))].filter((f) => f && !bundled.has(f)).sort((a, b) => a.localeCompare(b));
  return systemFontCache;
}

/** Whether a font family is installed here: text measured in it differs from both generic fallbacks. */
export function isFontInstalled(family: string): boolean {
  if (typeof document === 'undefined') return true;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return true;
  const sample = 'mmmmmmmmmlli 0123456789 WwXx';
  return ['monospace', 'serif'].some((generic) => {
    ctx.font = `40px ${generic}`;
    const plain = ctx.measureText(sample).width;
    ctx.font = `40px "${family.replace(/"/g, '')}", ${generic}`;
    return ctx.measureText(sample).width !== plain;
  });
}
