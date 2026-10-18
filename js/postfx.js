import * as THREE from 'three';
import { createGraphicsEngine, THEME_PROFILES } from './gfx/index.js';

/* ==================================================================
 * postfx.js  (compatibility layer)
 *
 * The old CinematicShader + UnrealBloomPass + FXAA stack has been
 * superseded by the advanced pipeline in `gfx/post/`. This module is kept
 * so existing imports keep working; it simply builds a graphics engine in
 * post-only mode and forwards the legacy calls to it.
 *
 * New code should import `createGraphicsEngine` from `./gfx/index.js`
 * directly.
 * ================================================================== */

/**
 * @deprecated use createGraphicsEngine from ./gfx/index.js
 */
export function createPostFX(renderer, scene, camera) {
  const engine = createGraphicsEngine({
    renderer, scene, camera,
    settings: { sky: false, lighting: false, shadows: false, volumetric: false, post: true },
  });

  const post = engine.post;

  // A `composer`-shaped facade so legacy `postFX.composer.setSize()` /
  // `postFX.composer.render()` calls keep working.
  const composer = {
    setSize(w, h) { engine.setSize(w, h); },
    render() { engine.render(0.016); },
    get renderTarget() { return post ? post.sceneRT : null; },
    passes: post ? post.passes : [],
  };

  return {
    engine,
    post,
    composer,
    speed: { value: 0 },
    setSpeed(speed01, dt, extra = 0) {
      this.speed.value = Math.min(speed01 + extra, 1.6);
      engine.update(dt || 0.016, { speed01: this.speed.value });
    },
    update(dt, ctx) { engine.update(dt, ctx); },
    render(dt, ctx) { if (ctx) engine.update(dt, ctx); engine.render(dt); },
    setSize(w, h) { engine.setSize(w, h); },
    setQuality(q) { engine.setQuality(q); },
    setBloomIntensity(i) { engine.settings.bloomStrength = i; engine.post && engine.post.setQuality(engine.settings.quality); },
    dispose() { engine.dispose(); },
  };
}

/** @deprecated the pipeline manages its own sizing. */
export function updatePostFXSize(postFX) {
  void postFX;
}

/** @deprecated use engine.settings.bloomStrength. */
export function setBloomIntensity(postFX, intensity) {
  if (postFX.setBloomIntensity) postFX.setBloomIntensity(intensity);
}

/** @deprecated pass `speed01` in the frame context instead. */
export function setSpeedEffects(postFX, speed01, dt, extra = 0) {
  if (postFX.setSpeed) postFX.setSpeed(speed01, dt, extra);
}

export { THEME_PROFILES };
export { createGraphicsEngine };
