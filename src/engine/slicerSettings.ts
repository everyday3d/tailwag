/**
 * Slicer settings the exporter writes into the project and the verifier checks.
 * One definition, so the export and its verification cannot disagree.
 */
export const PINNED_SLICER_SETTINGS: Record<string, string> = {
  sparse_infill_density: '100%',
  sparse_infill_pattern: 'alignedrectilinear',
  wall_loops: '1',
  top_shell_layers: '999',
  bottom_shell_layers: '999',
  enable_support: '0',
  brim_type: 'no_brim',
  ironing_type: 'no ironing',
  enable_prime_tower: '1',
};

/** Layer-height settings derived from the plan, as written to project_settings.config. */
export function layerSettingsFor(baseLayerMm: number, layerHeightMm: number): Record<string, string> {
  return {
    initial_layer_print_height: baseLayerMm.toFixed(2),
    layer_height: layerHeightMm.toFixed(2),
  };
}

/**
 * Writes settings into project_settings.config and lists them as overrides of the process preset.
 * Bambu Studio and OrcaSlicer keep only the keys named in `different_settings_to_system[0]`
 * when they open a project; any other value is reset to the system preset
 * (for example layer height back to 0.20 mm and infill back to 15%).
 * The array holds one entry for the process, one per filament, then one for the printer.
 */
export function applyProcessOverrides(ps: Record<string, any>, settings: Record<string, string>, numFilaments: number) {
  Object.assign(ps, settings);
  const existing: string[] = Array.isArray(ps.different_settings_to_system) ? ps.different_settings_to_system : [];
  const processKeys = new Set(String(existing[0] ?? '').split(';').filter(Boolean));
  for (const k of Object.keys(settings)) processKeys.add(k);
  ps.different_settings_to_system = [
    [...processKeys].sort().join(';'),
    ...Array.from({ length: numFilaments }, (_, i) => String(existing[i + 1] ?? '')),
    String(existing.length > 1 ? existing[existing.length - 1] : ''),
  ];
}

/** Process-preset override keys listed in a project_settings.config. */
export function listedProcessOverrides(ps: Record<string, any>): Set<string> {
  const first = Array.isArray(ps.different_settings_to_system) ? ps.different_settings_to_system[0] : '';
  return new Set(String(first ?? '').split(';').filter(Boolean));
}
