import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/* ==================================================================
 * postfx.js
 * A single "cinematic" grade pass that bundles the effects a AAA
 * racing shot relies on for the 342 km/h sensation:
 *   - radial speed blur that ramps in with velocity (motion blur)
 *   - chromatic aberration (also velocity driven)
 *   - film grain + vignette
 *   - contrast / saturation grade
 * It runs before OutputPass so it operates on the HDR linear buffer.
 * ================================================================== */

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uBlur: { value: 0 },
    uAberration: { value: 0.0016 },
    uGrain: { value: 0.03 },
    uVignette: { value: 0.85 },
    uContrast: { value: 1.05 },
    uSaturation: { value: 1.1 },
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
    uniform float uTime;
    uniform float uSpeed;
    uniform float uBlur;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uSaturation;
    varying vec2 vUv;

    void main() {
      vec2 center = vUv - 0.5;

      // --- chromatic aberration (scales with speed) --------------
      vec2 off = center * uAberration * (1.0 + uSpeed * 3.5);
      vec3 col;
      col.r = texture2D( tDiffuse, vUv - off ).r;
      col.g = texture2D( tDiffuse, vUv ).g;
      col.b = texture2D( tDiffuse, vUv + off ).b;

      // --- radial speed blur -------------------------------------
      if ( uBlur > 0.0004 ) {
        vec3 acc = col;
        float w = 1.0;
        for ( int i = 1; i <= 6; i++ ) {
          float t = float( i ) / 6.0;
          vec2 uv = vUv - center * uBlur * t;
          acc += texture2D( tDiffuse, uv ).rgb;
          w += 1.0;
        }
        col = acc / w;
      }

      // --- film grain --------------------------------------------
      float g = fract( sin( dot( vUv * ( 1.0 + fract( uTime ) ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
      col += ( g - 0.5 ) * uGrain * ( 0.5 + uSpeed );

      // --- grade -------------------------------------------------
      float luma = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( luma ), col, uSaturation );
      col = ( col - 0.5 ) * uContrast + 0.5;

      // --- vignette ----------------------------------------------
      float d = distance( vUv, vec2( 0.5 ) );
      col *= 1.0 - uVignette * smoothstep( 0.35, 1.05, d );

      gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const size = renderer.getSize(new THREE.Vector2());

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom is what makes taillights, street lamps and neon read as
  // "Lumen-lit" against the wet asphalt.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.72,
    0.75,
    1.0
  );
  composer.addPass(bloomPass);

  const cinematicPass = new ShaderPass(CinematicShader);
  cinematicPass.uniforms.uAberration.value = 0.0016;
  composer.addPass(cinematicPass);

  const fxaaPass = new ShaderPass(FXAAShader);
  const pixelRatio = renderer.getPixelRatio();
  fxaaPass.material.uniforms.resolution.value.set(1 / (size.x * pixelRatio), 1 / (size.y * pixelRatio));
  composer.addPass(fxaaPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return {
    composer,
    bloomPass,
    cinematicPass,
    fxaaPass,
    renderPass,
    outputPass,
  };
}

export function updatePostFXSize(postFX, width, height, pixelRatio) {
  postFX.fxaaPass.material.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
}

export function setBloomIntensity(postFX, intensity) {
  postFX.bloomPass.strength = intensity;
}

/**
 * Drive the cinematic pass every frame.
 * @param {object} postFX   result of createPostFX
 * @param {number} speed01  normalised speed, 0..1 (1 == flat out)
 * @param {number} dt       frame delta in seconds
 * @param {number} extra    0..1 extra kick (nitro / big crash)
 */
export function setSpeedEffects(postFX, speed01, dt, extra = 0) {
  const pass = postFX.cinematicPass;
  const u = pass.uniforms;

  u.uTime.value += dt;

  const target = Math.min(speed01 + extra, 1.6);
  // ease the blur in only once you are really moving
  const eased = Math.max(0, (target - 0.18) / 0.82);
  const speed = THREE.MathUtils.clamp(eased, 0, 1.3);
  u.uSpeed.value += (speed - u.uSpeed.value) * Math.min(1, dt * 4);
  u.uBlur.value += (speed * 0.11 - u.uBlur.value) * Math.min(1, dt * 3);

  // highlights blow out and saturate as you approach top speed
  postFX.bloomPass.strength = 0.72 + u.uSpeed.value * 0.55;
}
