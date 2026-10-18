/**
 * js/car.js — the car factory the rest of the game talks to.
 *
 * This is a thin façade over `js/gfx/car.js`, the sculpted model that replaced
 * the original extruded-silhouette car. The old implementation is kept in
 * `js/car-legacy.js` and is used automatically if the detailed model ever fails
 * to build, so `main.js`, `ai.js` and `configurator.js` can keep importing from
 * `./car.js` exactly as before and always get *a* car back.
 *
 * The public surface is unchanged:
 *
 *   CAR_PAINT_COLORS, WHEEL_STYLES, SPOILER_TYPES   — the pickers' data
 *   createCarModel(config)                          — build a car
 *   updateCarConfig(car, config)                    — recolour in place
 *   createConfiguratorCar()                         — showroom car
 *
 * `createCarModel` also accepts `detail: 'low' | 'medium' | 'high'` (default
 * 'high') so the AI field can run a trimmed model without touching its config.
 */

import * as Detailed from './gfx/car.js';
import * as Legacy from './car-legacy.js';

export const CAR_PAINT_COLORS = Detailed.CAR_PAINT_COLORS || Legacy.CAR_PAINT_COLORS;
export const WHEEL_STYLES = Detailed.WHEEL_STYLES || Legacy.WHEEL_STYLES;
export const SPOILER_TYPES = Detailed.SPOILER_TYPES || Legacy.SPOILER_TYPES;
export const CAR_LIVERIES = Detailed.CAR_LIVERIES || null;

/** True once the detailed model has failed and we are on the fallback path. */
export let usingLegacyCarModel = false;

/**
 * Build a car. Prefers the detailed lofted model and degrades to the original
 * extruded one if anything goes wrong while assembling it.
 */
export function createCarModel(config = {}) {
  if (!usingLegacyCarModel) {
    try {
      return Detailed.createCarModel(config);
    } catch (err) {
      usingLegacyCarModel = true;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[car] detailed model failed to build; falling back to legacy', err);
      }
    }
  }
  return Legacy.createCarModel(config);
}

/** Recolour / re-tint an existing car in place. */
export function updateCarConfig(car, newConfig = {}) {
  if (car && car.userData && car.userData.detail && Detailed.updateCarConfig) {
    return Detailed.updateCarConfig(car, newConfig);
  }
  return Legacy.updateCarConfig(car, newConfig);
}

/** The showroom car used by the configurator's turntable. */
export function createConfiguratorCar() {
  if (!usingLegacyCarModel) {
    try {
      return Detailed.createConfiguratorCar();
    } catch (err) {
      usingLegacyCarModel = true;
    }
  }
  return Legacy.createConfiguratorCar
    ? Legacy.createConfiguratorCar()
    : Legacy.createCarModel({ spoilerType: 3 });
}

export default {
  createCarModel,
  updateCarConfig,
  createConfiguratorCar,
  CAR_PAINT_COLORS,
  WHEEL_STYLES,
  SPOILER_TYPES,
};
