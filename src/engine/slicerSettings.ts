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
  enable_prime_tower: '1',
};

/** Layer-height settings derived from the plan, as written to project_settings.config. */
export function layerSettingsFor(baseLayerMm: number, layerHeightMm: number): Record<string, string> {
  return {
    initial_layer_print_height: baseLayerMm.toFixed(2),
    layer_height: layerHeightMm.toFixed(2),
  };
}
