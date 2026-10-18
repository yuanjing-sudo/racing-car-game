import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ==================================================================
 * ssr.js  —  Screen-Space Reflections for the wet road
 *
 * The signature look of the game is rain-soaked asphalt mirroring the
 * sky, neon and headlights. Doing that with a real planar reflection is
 * expensive, so we do it in screen space using only the depth buffer:
 *
 *   1. Copy pass   — blits the composer's read buffer (the HDR scene
 *                    colour for this frame) into a private render
 *                    target that acts as the reflection source.
 *   2. SSR pass    — for each pixel we rebuild the view-space position
 *                    and normal, reflect the view vector and march that
 *                    ray through the depth buffer in screen space until
 *                    it passes behind the scene geometry. The hit is
 *                    refined with a few bisection steps, the source
 *                    colour is fetched and weighted by Fresnel, a
 *                    screen-edge fade and a distance fade.
 *   3. Composite   — the reflection buffer is added to the scene colour,
 *                    scaled by `intensity` and by road `wetness`, so the
 *                    effect only dominates once the track is actually
 *                    wet. Additive, in linear HDR, no tone mapping.
 *
 * As with the other post effects, each custom pass renders into its own
 * target and leaves the composer ping-pong untouched, so the composite
 * still sees the unmodified scene colour.
 * ================================================================== */

const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/* Depth reconstruction helpers (self-contained copy — post modules may
 * not import one another or common.js). */
const DEPTH_COMMON = /* glsl */`
  uniform sampler2D tDepth;
  uniform mat4 uProjectionMatrixInverse;
  uniform float uNear;
  uniform float uFar;

  float depthAt( vec2 uv ) {
    return clamp( texture2D( tDepth, uv ).x, 0.0, 1.0 );
  }

  vec3 viewPosFromDepth( vec2 uv, float d ) {
    vec4 clip = vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
    vec4 view = uProjectionMatrixInverse * clip;
    return view.xyz / view.w;
  }
`;

/* Face normal from three view-space depth taps (same trick as gtao.js). */
const NORMAL_FROM_DEPTH = /* glsl */`
  vec3 reconstructNormal( vec2 uv, vec3 p, vec2 texel ) {
    vec3 px = viewPosFromDepth( uv + vec2( texel.x, 0.0 ), depthAt( uv + vec2( texel.x, 0.0 ) ) );
    vec3 py = viewPosFromDepth( uv + vec2( 0.0, texel.y ), depthAt( uv + vec2( 0.0, texel.y ) ) );
    vec3 n = normalize( cross( px - p, py - p ) );
    if ( dot( n, -normalize( p ) ) < 0.0 ) n = -n;
    return n;
  }
`;

/* ------------------------------------------------------------------ *
 * Render-target pass base (identical contract to the gtao one): a
 * THREE.Pass that draws a full-screen ShaderMaterial into a private
 * WebGLRenderTarget and never swaps the composer buffers.
 * ------------------------------------------------------------------ */
class RenderTargetPass extends Pass {
  constructor(material, renderTarget, scale = 1) {
    super();
    this.material = material;
    this.fsQuad = new FullScreenQuad(material);
    this.renderTarget = renderTarget;
    this.scale = scale;
    this.needsSwap = false;
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width * this.scale));
    const h = Math.max(1, Math.floor(height * this.scale));
    this.renderTarget.setSize(w, h);
    const u = this.material.uniforms;
    if (u.uResolution) u.uResolution.value.set(w, h);
  }

  updateInputs(/* writeBuffer, readBuffer */) {}

  render(renderer, writeBuffer, readBuffer) {
    this.updateInputs(writeBuffer, readBuffer);
    renderer.setRenderTarget(this.renderTarget);
    this.fsQuad.render(renderer);
  }

  dispose() {
    if (this.material) this.material.dispose();
    // FullScreenQuad shares one module-level geometry: never dispose it.
    if (this.renderTarget) this.renderTarget.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * Copy material — samples the scene colour straight into the reflection
 * source target so the SSR pass always reflects a stable snapshot of
 * this frame's rendering.
 * ------------------------------------------------------------------ */
const CopyShader = {
  name: 'SSR-Copy',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D( tDiffuse, vUv );
    }
  `,
};

/* ------------------------------------------------------------------ *
 * Screen-space ray-marching material
 * ------------------------------------------------------------------ */
function makeSSRMaterial(steps) {
  return new THREE.ShaderMaterial({
    name: 'SSR-March',
    // SSR_STEPS is baked into the fragment source below via `#define`.
    uniforms: {
      uSource: { value: null },
      tDepth: { value: null },
      uProjectionMatrix: { value: new THREE.Matrix4() },
      uProjectionMatrixInverse: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uMaxDistance: { value: 30.0 },   // ray length in metres (view space)
      uThickness: { value: 0.5 },      // max depth error counted as a hit
      uSteps: { value: steps },        // runtime cap (<= SSR_STEPS)
      uWetness: { value: 0.0 },
      uRoughnessCutoff: { value: 0.55 },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D uSource;
      uniform mat4 uProjectionMatrix;
      uniform vec2 uResolution;
      uniform float uMaxDistance;
      uniform float uThickness;
      uniform float uSteps;
      uniform float uWetness;
      uniform float uRoughnessCutoff;

      ${DEPTH_COMMON}
      ${NORMAL_FROM_DEPTH}

      #define SSR_STEPS ${steps}

      void main() {
        vec2 uv = vUv;

        float d0 = depthAt( uv );
        // Nothing reflects off the sky.
        if ( d0 >= 0.999999 ) {
          gl_FragColor = vec4( 0.0 );
          return;
        }

        vec3 p = viewPosFromDepth( uv, d0 );
        vec2 texel = 1.0 / uResolution;
        vec3 n = reconstructNormal( uv, p, texel );

        vec3 V = normalize( p );        // camera -> surface (view space)
        vec3 R = reflect( V, n );        // mirrored view ray, marched forward

        // ---- wetness-derived roughness ---------------------------------
        // There is no roughness buffer, so we approximate the road's
        // micro-roughness from the wetness value: dry asphalt is rough and
        // barely mirrors, standing water is glossy. uRoughnessCutoff
        // throws away anything rougher, which is what makes the effect
        // only switch on for the wet parts of the track.
        float roughness = mix( 1.0, 0.10, uWetness );
        float roughFade = 1.0 - smoothstep( uRoughnessCutoff * 0.5, uRoughnessCutoff, roughness );
        if ( roughFade <= 0.001 ) {
          gl_FragColor = vec4( 0.0 );
          return;
        }

        // Rougher surfaces cannot focus a reflection, so they get fewer
        // rays. The compile-time SSR_STEPS is the ceiling.
        float budget = min( uSteps, mix( 4.0, float( SSR_STEPS ), uWetness ) );

        // ---- Schlick Fresnel ------------------------------------------
        float NdotV = max( dot( -V, n ), 0.0 );
        float F0 = mix( 0.03, 0.045, uWetness );
        float fresnel = F0 + ( 1.0 - F0 ) * pow( 1.0 - NdotV, 5.0 );

        // ---- screen-space march ----------------------------------------
        // Step along the reflected ray in view space, project every sample
        // back to screen space and compare its depth against the depth
        // buffer. A sample that sits *behind* the stored geometry (but no
        // further than uThickness) is an intersection.
        float stepLen = uMaxDistance / float( SSR_STEPS );
        vec2 prevUv = uv;
        vec2 hitUv = vec2( 0.0 );
        float prevRayZ = -p.z;
        float hitRayZ = 0.0;
        float travelled = 0.0;
        bool hit = false;

        for ( int i = 1; i <= SSR_STEPS; i++ ) {
          if ( float( i ) > budget ) break;

          travelled = float( i ) * stepLen;
          vec3 rp = p + R * travelled;
          float rayZ = -rp.z;

          // Ray crossed behind the near plane / camera: stop.
          if ( rayZ <= uNear ) break;

          vec4 clip = uProjectionMatrix * vec4( rp, 1.0 );
          if ( clip.w <= 0.0 ) break;

          vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
          // Ray left the screen: there is nothing to sample.
          if ( suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 ) break;

          float sd = depthAt( suv );
          float sceneZ = -viewPosFromDepth( suv, sd ).z;
          float diff = rayZ - sceneZ;    // > 0 => ray is behind geometry

          if ( diff > 0.0 && diff < uThickness ) {
            hit = true;
            hitUv = suv;
            hitRayZ = rayZ;
            break;
          }

          // Dove well behind a solid surface without a valid hit: the ray
          // is tunnelling, so abort instead of reflecting garbage.
          if ( diff > uThickness * 4.0 ) break;

          prevUv = suv;
          prevRayZ = rayZ;
        }

        if ( !hit ) {
          gl_FragColor = vec4( 0.0 );
          return;
        }

        // ---- bisection refinement --------------------------------------
        // The ray is a straight line, so we can interpolate both its uv
        // and its depth between the last miss and the first hit and narrow
        // the intersection with a handful of bisections.
        vec2 a = prevUv;
        vec2 b = hitUv;
        float za = prevRayZ;
        float zb = hitRayZ;
        for ( int k = 0; k < 5; k++ ) {
          vec2 midUv = mix( a, b, 0.5 );
          float midRayZ = mix( za, zb, 0.5 );
          float midSceneZ = -viewPosFromDepth( midUv, depthAt( midUv ) ).z;
          if ( midRayZ > midSceneZ ) {
            // Already behind the geometry: the crossing is nearer to a.
            b = midUv;
            zb = midRayZ;
          } else {
            a = midUv;
            za = midRayZ;
          }
        }
        hitUv = b;

        // ---- fades ------------------------------------------------------
        // Kill reflections that land against the frame border and gently
        // fade long, low-confidence rays out with distance.
        float edge = smoothstep( 0.0, 0.10, hitUv.x ) * ( 1.0 - smoothstep( 0.90, 1.0, hitUv.x ) )
                   * smoothstep( 0.0, 0.10, hitUv.y ) * ( 1.0 - smoothstep( 0.90, 1.0, hitUv.y ) );
        float distFade = 1.0 - smoothstep( uMaxDistance * 0.5, uMaxDistance, travelled );
        float weight = fresnel * edge * distFade * roughFade;

        vec3 refl = texture2D( uSource, hitUv ).rgb;
        gl_FragColor = vec4( refl * weight, 1.0 );
      }
    `,
  });
}

/* ------------------------------------------------------------------ *
 * Additive composite. `uWetness` is refreshed from ctx every frame so
 * the mirror only appears when the road is actually wet, and
 * `uIntensity` (also settable from settings.ssrIntensity) trims it.
 * ------------------------------------------------------------------ */
const SSRCompositeShader = {
  name: 'SSR-Composite',
  uniforms: {
    tDiffuse: { value: null },
    tSSR: { value: null },
    uIntensity: { value: 1.0 },
    uWetness: { value: 0.0 },
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tSSR;
    uniform float uIntensity;
    uniform float uWetness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D( tDiffuse, vUv );
      vec3 refl = texture2D( tSSR, vUv ).rgb;
      // Additive blend in linear HDR; wetness gates the whole effect.
      gl_FragColor = vec4( color.rgb + refl * uIntensity * uWetness, color.a );
    }
  `,
};

function num(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function makeRT(width, height) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  rt.texture.colorSpace = THREE.NoColorSpace; // linear HDR source
  return rt;
}

/**
 * Create a screen-space reflection effect for the wet road.
 *
 * Ray-marches the depth buffer per pixel, samples a render-target copy of
 * the scene colour at the hit, weights it by Fresnel / edge / distance and
 * adds it back scaled by `intensity` and `ctx.wetness`. Returns a
 * `PostEffect` whose `passes` are [copy, SSR march, additive composite].
 *
 * @param {{
 *   width?: number, height?: number,
 *   steps?: number,           // compile-time march steps (SSR_STEPS)
 *   intensity?: number,       // reflection strength
 *   maxDistance?: number,     // ray length in metres
 *   thickness?: number,       // depth error tolerated as a hit
 *   roughnessCutoff?: number, // reject surfaces rougher than this
 *   scale?: number            // internal SSR resolution scale (0.25..1)
 * }} [opts]
 * @returns {{ name:string, passes:THREE.Pass[], setSize:Function, update:Function, setEnabled:Function, dispose:Function }}
 */
export function createSSREffect(opts = {}) {
  const width = Math.max(1, Math.floor(num(opts.width, 1)));
  const height = Math.max(1, Math.floor(num(opts.height, 1)));

  const steps = THREE.MathUtils.clamp(Math.round(num(opts.steps, 24)), 4, 64);
  const scale = THREE.MathUtils.clamp(num(opts.scale, 1), 0.25, 1);

  // The source copy is always full resolution so reflections stay sharp;
  // only the ray-march target is optionally downscaled (linear filtered).
  const sourceRT = makeRT(width, height);
  const ssrRT = makeRT(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)));

  const copyPass = new RenderTargetPass(new THREE.ShaderMaterial({
    name: 'SSR-Copy',
    uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
    vertexShader: CopyShader.vertexShader,
    fragmentShader: CopyShader.fragmentShader,
  }), sourceRT, 1);

  const ssrMaterial = makeSSRMaterial(steps);
  const ssrPass = new RenderTargetPass(ssrMaterial, ssrRT, scale);
  const compositePass = new ShaderPass(SSRCompositeShader);
  compositePass.renderToScreen = false;

  // Static bindings.
  ssrMaterial.uniforms.uSource.value = sourceRT.texture;
  ssrMaterial.uniforms.tDepth.value = null;
  compositePass.uniforms.tSSR.value = ssrRT.texture;

  // Quality knobs.
  ssrMaterial.uniforms.uMaxDistance.value = THREE.MathUtils.clamp(num(opts.maxDistance, 30), 1, 500);
  ssrMaterial.uniforms.uThickness.value = THREE.MathUtils.clamp(num(opts.thickness, 0.5), 0.01, 10);
  ssrMaterial.uniforms.uRoughnessCutoff.value = THREE.MathUtils.clamp(num(opts.roughnessCutoff, 0.55), 0.05, 1);
  compositePass.uniforms.uIntensity.value = THREE.MathUtils.clamp(num(opts.intensity, 1.0), 0, 4);

  const passes = [copyPass, ssrPass, compositePass];

  // Runtime state (no allocation in the hot path).
  let userEnabled = true;
  let available = false;
  let near = num(opts.near, 0.1);
  let far = num(opts.far, 1000);

  function applyEnabled() {
    const on = userEnabled && available;
    for (let i = 0; i < passes.length; i++) passes[i].enabled = on;
  }

  function setSize(w, h) {
    const ww = Math.max(1, Math.floor(num(w, width)));
    const hh = Math.max(1, Math.floor(num(h, height)));
    copyPass.setSize(ww, hh); // scale 1 -> full resolution snapshot
    ssrPass.setSize(ww, hh);  // honours its own resolution scale
  }

  function update(dt, ctx) {
    const depth = ctx && ctx.depthTexture ? ctx.depthTexture : null;
    available = !!depth;

    if (!available) {
      applyEnabled();
      return;
    }

    const settings = ctx.settings || {};
    const settingOn = settings.ssr !== false;

    // Camera matrices + clip planes.
    const camera = ctx.camera;
    if (camera) {
      if (camera.projectionMatrix) {
        ssrMaterial.uniforms.uProjectionMatrix.value.copy(camera.projectionMatrix);
      }
      if (camera.projectionMatrixInverse) {
        ssrMaterial.uniforms.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      }
    }
    if (typeof ctx.cameraNear === 'number') near = ctx.cameraNear;
    if (typeof ctx.cameraFar === 'number') far = ctx.cameraFar;
    ssrMaterial.uniforms.uNear.value = near;
    ssrMaterial.uniforms.uFar.value = far;

    // Road wetness drives both the reflection amount and the ray budget.
    const wetness = THREE.MathUtils.clamp(num(ctx.wetness, 0), 0, 1);
    ssrMaterial.uniforms.uWetness.value = wetness;
    compositePass.uniforms.uWetness.value = wetness;

    // A settings-level intensity override wins if provided.
    if (typeof settings.ssrIntensity === 'number' && isFinite(settings.ssrIntensity)) {
      compositePass.uniforms.uIntensity.value = THREE.MathUtils.clamp(settings.ssrIntensity, 0, 4);
    }

    ssrMaterial.uniforms.tDepth.value = depth;

    applyEnabled();
    if (!settingOn) {
      for (let i = 0; i < passes.length; i++) passes[i].enabled = false;
    }
  }

  function setEnabled(enabled) {
    userEnabled = !!enabled;
    applyEnabled();
  }

  function dispose() {
    copyPass.dispose();
    ssrPass.dispose();
    // Avoid ShaderPass.dispose() because it frees the shared quad geometry.
    if (compositePass.material) compositePass.material.dispose();
  }

  copyPass.setSize(width, height);
  ssrPass.setSize(width, height);
  applyEnabled();

  return {
    name: 'ssr',
    passes,
    setSize,
    update,
    setEnabled,
    dispose,
    copyPass,
    ssrPass,
    compositePass,
  };
}
