import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

import { createGTAOEffect } from './gtao.js';
import { createSSREffect } from './ssr.js';
import { createGodRaysEffect } from './godrays.js';
import { createBloomEffect } from './bloom.js';
import { createLensFlareEffect } from './lensflare.js';
import { createBokehEffect } from './bokeh.js';
import { createMotionBlurEffect } from './motionblur.js';
import { createColorGradeEffect } from './colorgrade.js';
import { createSmaaEffect } from './smaa.js';

/**
 * post/index.js — the advanced post-processing pipeline.
 *
 * Rather than leaning on `EffectComposer` (whose ping-pong buffers make a
 * shared, frame-stable depth texture awkward), this class owns a small render
 * loop:
 *
 *   1. render the scene once into a half-float target that carries a real
 *      `DepthTexture`, so every screen-space effect reads the SAME depth;
 *   2. run the enabled effect passes in a fixed, physically sensible order,
 *      ping-ponging between two colour targets;
 *   3. let the last pass draw to the screen.
 *
 * Effect order is the classic deferred-ish chain:
 *   GTAO → SSR → godrays → bloom → lens flare → DOF → motion blur →
 *   colour grade → tone map (OutputPass) → SMAA.
 *
 * Tone mapping is applied exactly once, by the `OutputPass`, after the grade and
 * before the AA — so the antialiasing operates on perceptual (LDR) values.
 */

/**
 * Quality tiers. Each tier flips effect switches and sets sample counts so the
 * same code scales from a phone to a workstation.
 */
export const QUALITY_PRESETS = {
  low: {
    quality: 'low',
    gtao: false, ssr: false, bloom: true, lensflare: false, godrays: false,
    bokeh: false, motionblur: false, colorgrade: true, smaa: true,
    bloomStrength: 0.5, bloomMipCount: 4, aaStrength: 0.8,
    godraysSamples: 24, motionBlurSamples: 6, bokehRadius: 9,
  },
  medium: {
    quality: 'medium',
    gtao: true, ssr: false, bloom: true, lensflare: true, godrays: true,
    bokeh: false, motionblur: true, colorgrade: true, smaa: true,
    bloomStrength: 0.65, bloomMipCount: 5, aaStrength: 0.82,
    godraysSamples: 32, motionBlurSamples: 8, bokehRadius: 11,
    gtaoSamples: 8, ssrSteps: 12,
  },
  high: {
    quality: 'high',
    gtao: true, ssr: true, bloom: true, lensflare: true, godrays: true,
    bokeh: true, motionblur: true, colorgrade: true, smaa: true,
    bloomStrength: 0.72, bloomMipCount: 6, aaStrength: 0.85,
    godraysSamples: 48, motionBlurSamples: 10, bokehRadius: 14,
    gtaoSamples: 12, ssrSteps: 16, ssrIntensity: 0.55,
  },
  ultra: {
    quality: 'ultra',
    gtao: true, ssr: true, bloom: true, lensflare: true, godrays: true,
    bokeh: true, motionblur: true, colorgrade: true, smaa: true,
    bloomStrength: 0.8, bloomMipCount: 6, aaStrength: 0.9,
    godraysSamples: 64, motionBlurSamples: 14, bokehRadius: 18,
    gtaoSamples: 16, ssrSteps: 24, ssrIntensity: 0.7,
  },
};

const DEFAULT_SETTINGS = {
  ...QUALITY_PRESETS.high,
  exposureGain: 1.0,
  temperature: 0.0,
  filmGrain: 0.02,
  focusDistance: 12,
  focalLength: 50,
  fStop: 2.8,
  maxCoC: 1.0,
  motionBlurScale: 1.0,
  speedBlur: 0.04,
  godraysIntensity: 1.0,
};

/**
 * Build the pipeline.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {object} [settings]
 */
export function createGraphicsPipeline(renderer, scene, camera, settings = {}) {
  const state = { ...DEFAULT_SETTINGS, ...settings };
  const size = renderer.getSize(new THREE.Vector2());
  let width = Math.max(1, size.x);
  let height = Math.max(1, size.y);

  // --- scene target (owns the shared depth texture) -----------------
  const sceneRT = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(width, height, THREE.UnsignedIntType),
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });
  sceneRT.texture.name = 'gfx.sceneRT';
  sceneRT.depthTexture.format = THREE.DepthFormat;
  sceneRT.depthTexture.name = 'gfx.depth';

  // --- ping-pong colour targets -------------------------------------
  const rtA = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  const rtB = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rtA.texture.name = 'gfx.rtA';
  rtB.texture.name = 'gfx.rtB';

  const copyPass = new ShaderPass(CopyShader);
  copyPass.material.depthTest = false;
  copyPass.material.depthWrite = false;

  // --- effects (created once, toggled at runtime) -------------------
  const effects = [
    createGTAOEffect({ width, height }),
    createSSREffect({ width, height }),
    createGodRaysEffect({ width, height }),
    createBloomEffect({ width, height }),
    createLensFlareEffect({ width, height }),
    createBokehEffect({ width, height }),
    createMotionBlurEffect({ width, height }),
    createColorGradeEffect({ width, height }),
    createSmaaEffect({ width, height }),
  ];

  // A minimal output/tone-map pass. We build it inline so the pipeline has no
  // dependency on OutputPass internals beyond the shader it ships.
  const outputPass = createOutputPass();
  outputPass.material.depthTest = false;
  outputPass.material.depthWrite = false;

  // Flatten the effect passes, keeping a back-reference to the owning effect so
  // we can skip a whole effect when its switch is off.
  /** @type {{ pass: THREE.Pass, effect: object }[]} */
  const chain = [];
  for (const effect of effects) {
    for (const pass of effect.passes) {
      pass.material.depthTest = false;
      pass.material.depthWrite = false;
      chain.push({ pass, effect });
    }
  }
  chain.push({ pass: outputPass, effect: null }); // tone map
  // SMAA must be last, after tone mapping.
  const smaaEffect = effects[effects.length - 1];
  const smaaPasses = new Set(smaaEffect.passes);
  chain.sort((a, b) => (smaaPasses.has(a.pass) ? 1 : 0) - (smaaPasses.has(b.pass) ? 1 : 0));

  function isEffectEnabled(effect) {
    if (!effect) return true; // output pass
    return state[effect.name] !== false;
  }

  /** Push the quality tier into the effect modules. */
  function applyQuality() {
    for (const effect of effects) {
      if (effect.setEnabled) effect.setEnabled(state[effect.name] !== false);
    }
    if (state.bloomMipCount != null) applyUniform('bloom', 'mipCount', state.bloomMipCount);
    if (state.bloomStrength != null) applyUniform('bloom', 'strength', state.bloomStrength);
    if (state.ssrIntensity != null) applyUniform('ssr', 'intensity', state.ssrIntensity);
    if (state.gtaoSamples != null) applyUniform('gtao', 'samples', state.gtaoSamples);
    if (state.aaStrength != null) applyUniform('smaa', 'strength', state.aaStrength);
  }

  function applyUniform(effectName, uniformName, value) {
    const effect = effects.find((e) => e.name === effectName);
    if (!effect) return;
    // Effects may expose a flat `uniforms` bag (ShaderPass-based) or only their
    // passes (multi-stage effects like GTAO), so fall back to scanning passes.
    if (!effect.uniforms || !effect.uniforms[uniformName]) {
      for (const pass of effect.passes) {
        const u = pass.material && pass.material.uniforms;
        if (u && u[uniformName]) { u[uniformName].value = value; return; }
      }
      return;
    }
    effect.uniforms[uniformName].value = value;
  }

  applyQuality();

  /** Resize every render target and effect. */
  function setSize(w, h) {
    width = Math.max(1, w | 0);
    height = Math.max(1, h | 0);
    sceneRT.setSize(width, height);
    rtA.setSize(width, height);
    rtB.setSize(width, height);
    const pr = renderer.getPixelRatio();
    for (const effect of effects) {
      if (effect.setSize) effect.setSize(Math.floor(width * pr), Math.floor(height * pr));
    }
  }
  setSize(width, height);

  /** Per-frame uniform push. */
  function update(dt, ctx = {}) {
    const cam = ctx.camera || camera;
    const sunDir = ctx.sunDirection || state.sunDirection || new THREE.Vector3(0, 1, 0);
    const full = {
      renderer,
      scene,
      camera: cam,
      width,
      height,
      deltaTime: dt,
      elapsed: ctx.elapsed || 0,
      depthTexture: sceneRT.depthTexture,
      cameraNear: cam.near,
      cameraFar: cam.far,
      sunDirection: sunDir,
      sunColor: ctx.sunColor || new THREE.Color(1, 1, 1),
      isNight: !!ctx.isNight,
      wetness: ctx.wetness != null ? ctx.wetness : 0,
      speed01: ctx.speed01 || 0,
      damage01: ctx.damage01 || 0,
      focusDistance: ctx.focusDistance,
      letterbox: ctx.letterbox,
      exposure: renderer.toneMappingExposure,
      settings: state,
    };
    for (const effect of effects) {
      if (effect.update) effect.update(dt, full);
    }
  }

  /** Render one frame. */
  function render(dt) {
    const r = renderer;

    // 1. scene → sceneRT (colour + depth)
    r.setRenderTarget(sceneRT);
    r.clear(true, true, false);
    r.render(scene, camera);

    // 2. build the list of live passes
    const active = [];
    for (const { pass, effect } of chain) {
      if (effect && !isEffectEnabled(effect)) continue;
      active.push(pass);
    }

    // 3. no live effects → straight blit
    if (active.length === 0) {
      copyPass.renderToScreen = true;
      copyPass.render(r, null, sceneRT, dt, false);
      r.setRenderTarget(null);
      return;
    }

    // 4. run the chain
    let read = sceneRT;
    let write = rtA;
    for (let i = 0; i < active.length; i++) {
      const pass = active[i];
      pass.renderToScreen = (i === active.length - 1);
      pass.render(r, write, read, dt, false);
      if (pass.needsSwap !== false) {
        const tmp = read;
        read = write;
        write = tmp;
      }
    }

    // 5. latch any frame-to-frame state (motion blur velocity history)
    for (const effect of effects) {
      if (effect.commit) effect.commit();
    }

    r.setRenderTarget(null);
  }

  function setQuality(name) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    Object.assign(state, preset);
    applyQuality();
  }

  function getSettings() {
    return state;
  }

  function setSetting(key, value) {
    state[key] = value;
    if (key in state && (key === 'bloomStrength' || key === 'ssrIntensity')) applyQuality();
  }

  function dispose() {
    for (const effect of effects) {
      try { effect.dispose && effect.dispose(); } catch (e) { /* ignore */ }
    }
    sceneRT.depthTexture.dispose();
    sceneRT.dispose();
    rtA.dispose();
    rtB.dispose();
    outputPass.dispose();
    copyPass.dispose();
  }

  return {
    sceneRT,
    effects,
    get passes() { return chain.map((c) => c.pass); },
    render,
    update,
    setSize,
    setQuality,
    getSettings,
    setSetting,
    dispose,
  };
}

/**
 * A tiny tone-map + sRGB output pass. Mirrors three's OutputPass but is kept
 * local so the pipeline controls the exact encoding order.
 */
function createOutputPass() {
  const shader = {
    name: 'GfxOutputShader',
    uniforms: {
      tDiffuse: { value: null },
      toneMappingExposure: { value: 1.0 },
      mode: { value: 0 }, // 0 = ACES filmic
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float toneMappingExposure;
      uniform int mode;
      varying vec2 vUv;

      // ACES filmic approximation (Stephen Hill fitted curve).
      vec3 RRTAndODTFit( vec3 v ) {
        vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
        vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
        return a / b;
      }

      vec3 ACESFilmicToneMapping( vec3 color ) {
        const mat3 ACESInputMat = mat3(
          0.59719, 0.07600, 0.02840,
          0.35458, 0.90834, 0.13383,
          0.04823, 0.01566, 0.83777
        );
        const mat3 ACESOutputMat = mat3(
           1.60475, -0.10208, -0.00327,
          -0.53108,  1.10813, -0.07276,
          -0.07367, -0.00605,  1.07602
        );
        color *= toneMappingExposure / 0.6;
        color = ACESInputMat * color;
        color = RRTAndODTFit( color );
        color = ACESOutputMat * color;
        return clamp( color, 0.0, 1.0 );
      }

      vec3 linToSRGB( vec3 c ) {
        return mix( c * 12.92, 1.055 * pow( max( c, vec3( 1e-5 ) ), vec3( 0.41666 ) ) - 0.055, step( 0.0031308, c ) );
      }

      void main() {
        vec3 color = texture2D( tDiffuse, vUv ).rgb;
        if ( mode == 0 ) color = ACESFilmicToneMapping( color );
        gl_FragColor = vec4( linToSRGB( color ), 1.0 );
      }
    `,
  };

  const pass = new ShaderPass(shader);
  return pass;
}
