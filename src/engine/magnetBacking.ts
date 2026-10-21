import { solidBaseTopMm, type CadCutoutConfig } from './cadMeshBuilder';
import type { LayerSwapSlot } from './opticalTdEngine';
import { MAGNET_DEFAULTS, magnetFit } from './magnets';

/**
 * Room for magnets: when the pockets need a thicker back than the print has, plain layers of the
 * first filament are added under the picture. Every layer above moves up by the same amount (the
 * filament changes too), so the picture and its colours stay the same; only the back gets thicker.
 * The number added is kept in cad.magnetBackLayers so it can be taken out again exactly.
 */

export interface LayerState {
  baseLayerMm: number;
  layerHeightMm: number;
  totalLayers: number;
  baseSolidThicknessMm: number;
  slots: LayerSwapSlot[];
}

export interface BackingPatch extends Partial<LayerState> {
  totalDepthMm?: number;
  slicePreviewMaxLayer?: number;
  cad: CadCutoutConfig;
}

/** Extra layers the magnets need on top of what the print has without any added backing. */
export function magnetBackLayersNeeded(state: LayerState, cad: CadCutoutConfig, alreadyAdded: number): number {
  if (!cad.magnetPockets || (cad.magnetStyle ?? 'pockets') !== 'pockets') return 0;
  const { baseLayerMm, layerHeightMm, totalLayers, baseSolidThicknessMm } = state;
  const without = solidBaseTopMm(baseLayerMm, layerHeightMm, totalLayers, baseSolidThicknessMm) - alreadyAdded * layerHeightMm;
  const need = magnetFit(cad.magnetDiameterMm || MAGNET_DEFAULTS.diameterMm, cad.magnetThicknessMm ?? MAGNET_DEFAULTS.thicknessMm, 1e9).solidBaseNeededMm;
  return Math.max(0, Math.ceil((need - without) / layerHeightMm - 1e-6));
}

/** The state change that adds or removes backing layers so `nextCad`'s magnets fit. */
export function magnetBackingPatch(state: LayerState, prevCad: CadCutoutConfig, nextCad: CadCutoutConfig): BackingPatch {
  const current = prevCad.magnetBackLayers ?? 0;
  const wanted = magnetBackLayersNeeded(state, nextCad, current);
  const diff = wanted - current;
  if (diff === 0) return { cad: { ...nextCad, magnetBackLayers: wanted } };
  const totalLayers = state.totalLayers + diff;
  const round = (mm: number) => Number(mm.toFixed(2));
  return {
    cad: { ...nextCad, magnetBackLayers: wanted },
    totalLayers,
    baseSolidThicknessMm: round(state.baseSolidThicknessMm + diff * state.layerHeightMm),
    totalDepthMm: round(state.baseLayerMm + (totalLayers - 1) * state.layerHeightMm),
    slicePreviewMaxLayer: totalLayers,
    slots: state.slots.map((s, i) =>
      i === state.slots.length - 1 ? { ...s, upToLayer: totalLayers } : { ...s, upToLayer: Math.max(i + 1, s.upToLayer + diff) }
    ),
  };
}

/** True when a cad change touches anything the backing depends on. */
export function touchesMagnets(partial: Partial<CadCutoutConfig>): boolean {
  return ['magnetPockets', 'magnetDiameterMm', 'magnetThicknessMm', 'magnetStyle'].some((k) => k in partial);
}
