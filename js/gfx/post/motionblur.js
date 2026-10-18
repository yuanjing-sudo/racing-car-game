import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ==================================================================
 * motionblur.js  —  Camera + radial motion blur
 *
 * The sense of speed in VELOCE GT-R comes almost entirely from blur.
 * Two independent contributors are summed per pixel:
 *
 *   1. Camera motion blur — classic reprojection ("temporal") blur.
 *      For every pixel we rebuild its view-space position from the
 *      depth buffer and its world position through the inverse view-
 *      projection matrix. Projecting that world point with the
 *      PREVIOUS frame's view-projection matrix gives the screen
 *      position the point occupied one frame ago; the 2D difference is
 *      the per-pixel motion vector. We then take N taps along that
 *      vector, weighted by a triangular kernel, which smears moving
 *      geometry in the direction it actually travelled and keeps
 *      camera-static geometry sharp.
 *
 *   2. Radial "speed" blur — an artistic boost that ramps with
 *      `ctx.speed01` (the player's normalised speed). It pushes taps
 *      radially outward from the screen centre with a quadratic ramp so
 *      the frame edges streak hardest while the middle — where the car
 *      and the apex live — stays readable. This is what sells a
 *      250 km/h pass even when the camera itself is nearly steady.
 *
 * Both components are computed in pixels, added, and the combined
 * offset is clamped to `maxVelocity` so a single frame can never smear
 * the whole screen. Sampling happens on the linear HDR scene colour;
 * tone mapping is left to the OutputPass that terminates the chain.
 *
 * The effect is a single `ShaderPass` that renders straight into the
 * composer's write buffer (it *replaces* the scene colour with its
 * blurred version), so it owns no private render targets. The camera
 * history matrix is maintained internally by `update()`.
 *
 * This is a normal `PostEffect` (see gfx/CONVENTIONS.md) and disables
 * itself whenever `ctx.depthTexture` is missing.
 * ================================================================== */

/* Full-screen quad vertex shader. Matches the other post modules so the
 * module-shared FullScreenQuad geometry keeps working unchanged. */
const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/* Depth / reprojection helpers. Self-contained (post modules may not
 * import one another or common.js). The depth texture is the scene's
 * window-space depth in [0,1]; `d >= 1` is the far plane / sky. */
const MOTION_COMMON = /* glsl */`
  uniform sampler2D tDepth;
  uniform mat4 uProjectionMatrixInverse;
  uniform mat4 uInverseViewProjection;
  uniform mat4 uPrevViewProjection;
  uniform float uNear;
  uniform float uFar;

  // Raw depth sample, clamped into the valid window range.
  float depthAt( vec2 uv ) {
    return clamp( texture2D( tDepth, uv ).x, 0.0, 1.0 );
  }

  // Reconstruct the view-space position of a pixel from its depth by
  // pushing uv + depth back through the inverse projection and undoing
  // the perspective divide. Exact for the game's perspective camera.
  vec3 viewPosFromDepth( vec2 uv, float d ) {
    vec4 clip = vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
    vec4 view = uProjectionMatrixInverse * clip;
    return view.xyz / view.w;
  }

  // Reconstruct the world-space position of the same pixel using the
  // inverse of the current view-projection matrix.
  vec3 worldPosFromDepth( vec2 uv, float d ) {
    vec4 clip = vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
    vec4 world = uInverseViewProjection * clip;
    return world.xyz / world.w;
  }

  // Classic near/far linearisation — a cheap positive distance metric
  // used for the sky test and the occlusion weight.
  float linearizeDepth( float d ) {
    float z = d * 2.0 - 1.0;
    return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
  }
`;

/* ------------------------------------------------------------------ *
 * Motion-blur material
 *
 * MOTION_SAMPLES is baked into the fragment source at construction time
 * from the quality-derived `samples` option, giving the compiler a fixed
 * loop bound it can fully unroll. `uSamples` is a runtime cap (<= the
 * define) so quality can be dialled back without a recompile.
 * ------------------------------------------------------------------ */
function makeMotionBlurMaterial(samples) {
  return new THREE.ShaderMaterial({
    name: 'MotionBlur',
    // MOTION_SAMPLES is baked into the fragment source below via
    // `#define`; passing `defines` as well would emit a duplicate,
    // conflicting definition.
    uniforms: {
      tDiffuse: { value: null },                  // composer read buffer (HDR)
      tDepth: { value: null },                    // scene depth
      uProjectionMatrixInverse: { value: new THREE.Matrix4() },
      uInverseViewProjection: { value: new THREE.Matrix4() },
      uPrevViewProjection: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uVelocityScale: { value: 1.0 },   // camera-vector strength
      uSamples: { value: samples },     // runtime cap, <= MOTION_SAMPLES
      uSpeedBlur: { value: 0.0 },       // radial pixels at full speed (speed01 already folded in)
      uMaxVelocity: { value: 48.0 },    // hard clamp on the tap offset, in pixels
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uVelocityScale;
      uniform float uSamples;
      uniform float uSpeedBlur;
      uniform float uMaxVelocity;

      ${MOTION_COMMON}

      #define MOTION_SAMPLES ${samples}

      void main() {
        vec2 uv = vUv;

        float d = depthAt( uv );
        // Sky / far-plane pixels carry no meaningful world position (the
        // far plane is at infinity), so reprojection would be garbage.
        // They still get the radial speed streak, which is exactly where
        // racing blur reads best.
        bool isSky = d >= 0.999999;

        vec3 pView = viewPosFromDepth( uv, d );
        float centerLin = linearizeDepth( d );

        // ---- camera motion vector (reprojection) -----------------------
        // Project this pixel's world position with the previous frame's
        // view-projection matrix; the difference is where it was on
        // screen one frame ago.
        vec2 velUV = vec2( 0.0 );
        if ( !isSky ) {
          vec3 pWorld = worldPosFromDepth( uv, d );
          vec4 prevClip = uPrevViewProjection * vec4( pWorld, 1.0 );
          if ( prevClip.w > 1e-5 ) {
            vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
            velUV = uv - prevUv;
          }
        }

        // ---- radial speed vector --------------------------------------
        // Work in pixels so the streak is resolution independent. The
        // radius is normalised against the frame diagonal and ramped
        // with a blend of linear and quadratic falloff: gentle near the
        // centre, strongest at the corners.
        vec2 centeredPx = ( uv - 0.5 ) * uResolution;
        float rPx = length( centeredPx );
        float diag = max( 0.5 * length( uResolution ), 1.0 );
        float rNorm = clamp( rPx / diag, 0.0, 1.0 );
        vec2 radialDir = rPx > 1e-4 ? centeredPx / rPx : vec2( 0.0 );
        float radialRamp = rNorm * ( 0.35 + 0.65 * rNorm );
        vec2 speedPx = radialDir * radialRamp * uSpeedBlur;

        // ---- combine + clamp ------------------------------------------
        // uVelocityScale lets quality trim the temporal part without
        // disabling the artistic radial part.
        vec2 velPx = velUV * uResolution * uVelocityScale;
        vec2 offsetPx = velPx + speedPx;

        float len = length( offsetPx );
        if ( len > uMaxVelocity ) offsetPx *= uMaxVelocity / len;

        // ---- per-pixel dither -----------------------------------------
        // Breaks up the banding you get from a handful of taps without
        // any temporal accumulation.
        float jitter = fract( sin( dot( uv * uResolution, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );

        // ---- gather taps ----------------------------------------------
        // Sample symmetrically around the centre (t in [-0.5, 0.5]) so
        // the blur is centred, and weight with a triangular kernel that
        // leans on the current pixel — the frame stays sharp when there
        // is no motion.
        float count = max( uSamples, 2.0 );
        vec2 texel = 1.0 / uResolution;
        vec3 sum = vec3( 0.0 );
        float wsum = 0.0;

        for ( int i = 0; i < MOTION_SAMPLES; i++ ) {
          if ( float( i ) >= count ) break;

          float t = ( float( i ) + jitter ) / ( count - 1.0 ) - 0.5;
          vec2 suv = uv + offsetPx * t * texel;

          // Occlusion weight: if a tapped pixel is much nearer than the
          // centre (a foreground occluder), damp its contribution so a
          // distant background cannot smear *over* the car.
          float sLin = linearizeDepth( depthAt( suv ) );
          float occl = 1.0 - smoothstep( 0.0, max( centerLin * 0.15, 0.5 ), centerLin - sLin );
          float occW = mix( 0.2, 1.0, occl );

          float w = ( 1.0 - abs( t ) * 2.0 ) * occW;
          sum += texture2D( tDiffuse, suv ).rgb * w;
          wsum += w;
        }

        vec3 color = wsum > 1e-5 ? sum / wsum : texture2D( tDiffuse, uv ).rgb;

        // Linear HDR out; OutputPass tone-maps later.
        gl_FragColor = vec4( color, 1.0 );
      }
    `,
  });
}

/* Small numeric sanitiser for the opts bag (mirrors the sibling effects). */
function num(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

/* Map a quality string to a compile-time tap budget. Only used when the
 * caller did not pass an explicit `samples`. */
function samplesForQuality(quality) {
  switch (quality) {
    case 'low': return 6;
    case 'medium': return 10;
    case 'ultra': return 24;
    case 'high':
    default: return 16;
  }
}

/**
 * Create a camera + radial motion-blur effect.
 *
 * Reconstructs each pixel's view-space position from `ctx.depthTexture`,
 * reprojects it with the previous frame's view-projection matrix to get a
 * per-pixel motion vector, adds a radial streak that ramps with
 * `ctx.speed01`, clamps the combined offset to `maxVelocity` and gathers
 * a handful of weighted taps along it. The previous camera matrix is
 * maintained internally by `update()`; no render targets are allocated.
 * Returns a `PostEffect` whose `passes` are a single [motion blur] entry.
 *
 * @param {{
 *   width?: number, height?: number,
 *   samples?: number,        // compile-time tap count (MOTION_SAMPLES)
 *   quality?: string,        // 'low'|'medium'|'high'|'ultra' when samples omitted
 *   velocityScale?: number,  // camera motion-vector strength (0..4)
 *   speedBlur?: number,      // radial streak length in pixels at full speed
 *   maxVelocity?: number,    // hard clamp on the tap offset, in pixels
 *   scale?: number,          // accepted for parity; motion blur runs full-res
 *   near?: number, far?: number
 * }} [opts]
 * @returns {{ name:string, passes:THREE.Pass[], setSize:Function, update:Function, setEnabled:Function, dispose:Function, pass:THREE.ShaderPass }}
 */
export function createMotionBlurEffect(opts = {}) {
  const width = Math.max(1, Math.floor(num(opts.width, 1)));
  const height = Math.max(1, Math.floor(num(opts.height, 1)));

  // Compile-time tap count. Explicit `samples` wins; otherwise derive it
  // from the quality tier. Clamped so the unrolled loop stays sane.
  const samples = THREE.MathUtils.clamp(
    Math.round(num(opts.samples, samplesForQuality(opts.quality))),
    3,
    32,
  );

  const material = makeMotionBlurMaterial(samples);
  const pass = new ShaderPass(material);
  pass.renderToScreen = false;
  // The pass replaces the scene colour with its blurred version, so the
  // composer must swap its ping-pong buffers after it runs.
  pass.needsSwap = true;

  const passes = [pass];

  // ---- quality knobs -------------------------------------------------
  // Base radial length before the per-frame speed01 ramp is folded in.
  const speedBlurBase = THREE.MathUtils.clamp(num(opts.speedBlur, 26), 0, 240);
  material.uniforms.uVelocityScale.value = THREE.MathUtils.clamp(num(opts.velocityScale, 1.0), 0, 4);
  material.uniforms.uMaxVelocity.value = THREE.MathUtils.clamp(num(opts.maxVelocity, 48), 1, 512);
  material.uniforms.uSpeedBlur.value = 0; // fully ramped until the first update()

  // ---- internal camera history --------------------------------------
  // Allocated once; never touched on the hot path until update().
  const currentVP = new THREE.Matrix4();
  const inverseVP = new THREE.Matrix4();
  const prevVP = new THREE.Matrix4();
  let hasPrev = false;

  // ---- runtime state -------------------------------------------------
  let userEnabled = true;  // setEnabled()
  let available = false;   // depth texture present this frame?
  let near = num(opts.near, 0.1);
  let far = num(opts.far, 1000);

  function applyEnabled() {
    const on = userEnabled && available;
    for (let i = 0; i < passes.length; i++) passes[i].enabled = on;
  }

  function setSize(w, h) {
    const ww = Math.max(1, Math.floor(num(w, width)));
    const hh = Math.max(1, Math.floor(num(h, height)));
    material.uniforms.uResolution.value.set(ww, hh);
  }

  function update(dt, ctx) {
    const depth = ctx && ctx.depthTexture ? ctx.depthTexture : null;
    available = !!depth;

    if (!available) {
      // No depth => no reprojection => nothing trustworthy to do.
      applyEnabled();
      return;
    }

    // Quality settings can force the effect off independently of the
    // caller's own enable flag.
    const settings = (ctx && ctx.settings) || {};
    const settingOn = settings.motionblur !== false;

    // ---- camera matrices + history ---------------------------------
    // Build this frame's view-projection, refresh the inverse used by the
    // shader, hand the shader LAST frame's matrix, then roll history
    // forward. On the first frame previous == current, so the reprojected
    // velocity is exactly zero (no startup smear).
    const camera = ctx.camera;
    if (camera && camera.projectionMatrix && camera.matrixWorldInverse) {
      currentVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

      if (!hasPrev) {
        prevVP.copy(currentVP);
        hasPrev = true;
      }

      inverseVP.copy(currentVP).invert();
      material.uniforms.uInverseViewProjection.value.copy(inverseVP);
      material.uniforms.uPrevViewProjection.value.copy(prevVP);

      if (camera.projectionMatrixInverse) {
        material.uniforms.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      }

      // Age the history for the next frame.
      prevVP.copy(currentVP);
    }

    // ---- clip planes ------------------------------------------------
    if (typeof ctx.cameraNear === 'number') near = ctx.cameraNear;
    if (typeof ctx.cameraFar === 'number') far = ctx.cameraFar;
    material.uniforms.uNear.value = near;
    material.uniforms.uFar.value = far;

    // ---- radial speed ramp -----------------------------------------
    // Fold ctx.speed01 into the radial length each frame so the streak
    // grows with the player's speed (0 parked .. 1 flat out).
    const speed01 = THREE.MathUtils.clamp(num(ctx.speed01, 0), 0, 1);
    material.uniforms.uSpeedBlur.value = speedBlurBase * speed01;

    // ---- bindings ---------------------------------------------------
    // ShaderPass owns tDiffuse; only the depth binding needs refreshing
    // in case the composer swapped targets between frames.
    material.uniforms.tDepth.value = depth;

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
    // Dispose the material by hand — calling ShaderPass.dispose() would
    // also dispose the module-shared FullScreenQuad geometry used by
    // every other pass in the composer. There are no private render
    // targets to release (the pass writes straight into the composer's
    // write buffer).
    if (material) material.dispose();
  }

  // Initialise sizes / uniforms.
  setSize(width, height);
  applyEnabled();

  return {
    name: 'motionblur',
    passes,
    setSize,
    update,
    setEnabled,
    dispose,
    // Expose the pass for integrators that want to tweak uniforms.
    pass,
  };
}
