import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ==================================================================
 * gtao.js  —  Ground-Truth-Ambient-Occlusion-style SSAO
 *
 * A screen-space ambient occlusion effect reconstructed entirely from
 * the scene depth buffer (no extra G-buffer pass required):
 *
 *   1. AO pass     — for every pixel we rebuild the view-space position
 *                    and a face normal from neighbouring depth taps,
 *                    then march a handful of rays per screen direction
 *                    and integrate a *horizon* angle per direction.
 *                    The result is a raw, noisy 0..1 visibility term.
 *   2. Blur pass   — a bilateral (depth-aware) 2D blur removes the
 *                    per-pixel ray-march noise while preserving edges
 *                    between objects at different depths.
 *   3. Composite   — the denoised AO is multiplied onto the scene
 *                    colour in linear HDR space. Tone mapping is left
 *                    to the OutputPass that terminates the chain.
 *
 * Every pass writes into its own private render target and leaves the
 * composer's read/write ping-pong buffers untouched, so the original
 * scene colour is still available (and unmodified) for the composite.
 *
 * The effect is a normal `PostEffect` (see gfx/CONVENTIONS.md) and
 * disables itself whenever `ctx.depthTexture` is missing.
 * ================================================================== */

/* Full-screen quad vertex shader, shared by every pass here. */
const FULLSCREEN_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/* GLSL helpers used by both the AO and the blur pass to turn a raw
 * depth-buffer sample into a view-space position / linear depth. */
const DEPTH_COMMON = /* glsl */`
  uniform sampler2D tDepth;
  uniform mat4 uProjectionMatrixInverse;
  uniform float uNear;
  uniform float uFar;

  // Raw depth sample, always clamped to the valid [0,1] window range.
  float depthAt( vec2 uv ) {
    return clamp( texture2D( tDepth, uv ).x, 0.0, 1.0 );
  }

  // Reconstruct the view-space position of a pixel from its depth.
  // We push the 2D uv + depth back through the inverse projection,
  // then divide by w to undo the perspective divide. This is exact
  // for the perspective camera used by the game.
  vec3 viewPosFromDepth( vec2 uv, float d ) {
    vec4 clip = vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
    vec4 view = uProjectionMatrixInverse * clip;
    return view.xyz / view.w;
  }

  // Classic near/far linearisation, used only as a cheap depth metric
  // for the bilateral blur weights.
  float linearDepth( float d ) {
    float z = d * 2.0 - 1.0;
    return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
  }
`;

/**
 * Rebuild a (roughly) smooth surface normal from the depth buffer.
 * Three depth taps (centre, +x, +y) form a triangle whose cross product
 * is the face normal. This avoids the banding you get from derivative-
 * based normals on quantised depth textures and needs no normal buffer.
 */
const NORMAL_FROM_DEPTH = /* glsl */`
  vec3 reconstructNormal( vec2 uv, vec3 p, vec2 texel ) {
    vec3 px = viewPosFromDepth( uv + vec2( texel.x, 0.0 ), depthAt( uv + vec2( texel.x, 0.0 ) ) );
    vec3 py = viewPosFromDepth( uv + vec2( 0.0, texel.y ), depthAt( uv + vec2( 0.0, texel.y ) ) );
    vec3 n = normalize( cross( px - p, py - p ) );
    // In view space the camera sits at the origin looking down -Z, so a
    // surface facing the camera has dot( n, -normalize(p) ) > 0.
    if ( dot( n, -normalize( p ) ) < 0.0 ) n = -n;
    return n;
  }
`;

/* ------------------------------------------------------------------ *
 * Render-target pass base class
 *
 * A THREE.Pass that renders a full-screen ShaderMaterial into a private
 * WebGLRenderTarget instead of the composer's write buffer. `needsSwap`
 * is false so the scene colour survives in `readBuffer` for the final
 * composite. Subclasses may override `updateInputs()` to bind per-frame
 * textures (the render buffer, depth, etc.).
 * ------------------------------------------------------------------ */
class RenderTargetPass extends Pass {
  constructor(material, renderTarget, scale = 1) {
    super();
    this.material = material;
    this.fsQuad = new FullScreenQuad(material);
    this.renderTarget = renderTarget;
    this.scale = scale;
    this.needsSwap = false; // never touch the composer ping-pong buffers
  }

  /** Resize the private target and keep the resolution uniform in sync. */
  setSize(width, height) {
    const w = Math.max(1, Math.floor(width * this.scale));
    const h = Math.max(1, Math.floor(height * this.scale));
    this.renderTarget.setSize(w, h);
    const u = this.material.uniforms;
    if (u.uResolution) u.uResolution.value.set(w, h);
  }

  /** Bind inputs for the current frame; subclasses extend this. */
  updateInputs(/* readBuffer */) {}

  render(renderer, writeBuffer, readBuffer) {
    this.updateInputs(writeBuffer, readBuffer);
    renderer.setRenderTarget(this.renderTarget);
    this.fsQuad.render(renderer);
  }

  dispose() {
    if (this.material) this.material.dispose();
    // NOTE: FullScreenQuad shares one module-level triangle geometry, so
    // it must NOT be disposed here or every other pass would break.
    if (this.renderTarget) this.renderTarget.dispose();
  }
}

/* ------------------------------------------------------------------ *
 * 1) AO pass
 *
 * Horizon-based ambient occlusion. For each of AO_DIRS screen-space
 * directions we march AO_STEPS samples along the depth buffer and track
 * the *hiding angle* the occluder subtends (the tangent of its elevation
 * above the pixel's tangent plane). We convert that horizon to a
 * visibility weight with v = 1 - cos(horizon) so a flat neighbourhood
 * (horizon = 0) yields no occlusion and a fully vertical wall
 * (horizon -> 90 deg) yields full occlusion.
 * ------------------------------------------------------------------ */
function makeAOMaterial(steps, dirs) {
  return new THREE.ShaderMaterial({
    name: 'GTAO-AO',
    // NOTE: AO_STEPS / AO_DIRS are baked into the fragment source below
    // via `#define`, so no `defines` object is used here (that would
    // emit a duplicate, conflicting #define).
    uniforms: {
      tDepth: { value: null },
      uProjectionMatrixInverse: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uRadius: { value: 1.2 },   // world-space sampling radius (metres)
      uBias: { value: 0.02 },    // self-occlusion bias along the normal
      uSamples: { value: steps }, // runtime cap, <= AO_STEPS
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform vec2 uResolution;
      uniform float uRadius;
      uniform float uBias;
      uniform float uSamples;

      ${DEPTH_COMMON}
      ${NORMAL_FROM_DEPTH}

      #define AO_STEPS ${steps}
      #define AO_DIRS ${dirs}
      const float TWO_PI = 6.28318530718;

      void main() {
        vec2 uv = vUv;

        float d0 = depthAt( uv );
        // Sky / background pixels are never occluded; bail out early so
        // we never smear AO halos across silhouettes.
        if ( d0 >= 0.999999 ) {
          gl_FragColor = vec4( 1.0 );
          return;
        }

        vec3 p = viewPosFromDepth( uv, d0 );
        vec2 texel = 1.0 / uResolution;
        vec3 n = reconstructNormal( uv, p, texel );

        // Convert the world-space radius into screen pixels using the
        // projection scale: projScale = 0.5 * height * P[1][1], and
        // P[1][1] == 1 / P^-1[1][1]. Perspective motion means the
        // screen radius shrinks with distance, exactly as we want.
        float tanHalfFov = uProjectionMatrixInverse[ 1 ][ 1 ];
        float projScale = uResolution.y * 0.5 / max( tanHalfFov, 1e-4 );
        float viewZ = max( -p.z, uNear );
        float radiusPx = clamp( uRadius * projScale / viewZ, 1.0, 128.0 );

        // Deterministic per-pixel rotation so the tiny ray count does not
        // produce visible banding without any temporal noise.
        float jitter = fract( sin( dot( uv * uResolution, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );

        float occlusion = 0.0;

        for ( int dr = 0; dr < AO_DIRS; dr++ ) {
          float ang = ( float( dr ) + jitter ) * TWO_PI / float( AO_DIRS );
          vec2 dir = vec2( cos( ang ), sin( ang ) );
          float best = 0.0;

          for ( int i = 1; i <= AO_STEPS; i++ ) {
            if ( float( i ) > uSamples ) break;
            float t = float( i ) / float( AO_STEPS );

            vec2 suv = uv + dir * ( radiusPx * t ) * texel;
            if ( suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 ) break;

            float sd = depthAt( suv );
            if ( sd >= 0.999999 ) continue;

            vec3 sp = viewPosFromDepth( suv, sd );
            vec3 diff = sp - p;

            // Signed height of the sample above the tangent plane and its
            // distance within the plane. Only samples above the plane can
            // occlude the centre pixel.
            float along = dot( diff, n );
            float height = along - uBias;
            if ( height <= 0.0 ) continue;

            float horiz = length( diff - n * along );
            float tanA = height / max( horiz, 1e-4 );

            // Visibility this horizon removes from the hemisphere:
            // cos(atan(tanA)) = inversesqrt(1 + tanA^2). Fall off with
            // distance so far-away geometry cannot darken large areas.
            float cosA = inversesqrt( 1.0 + tanA * tanA );
            float vis = ( 1.0 - cosA ) * ( 1.0 - t );
            best = max( best, vis );
          }

          occlusion += best;
        }

        occlusion /= float( AO_DIRS );
        float ao = clamp( 1.0 - occlusion, 0.0, 1.0 );
        gl_FragColor = vec4( ao, ao, ao, 1.0 );
      }
    `,
  });
}

/* ------------------------------------------------------------------ *
 * 2) Bilateral blur pass
 *
 * A separable-in-spirit 2D Gaussian that is additionally weighted by the
 * depth difference between the centre and the tapped pixel. Pixels on a
 * different surface (e.g. the car in front of the road) therefore do not
 * bleed their AO into the centre pixel, keeping contact shadows crisp.
 * ------------------------------------------------------------------ */
function makeBlurMaterial(radius) {
  return new THREE.ShaderMaterial({
    name: 'GTAO-Blur',
    // BLUR_R is baked into the source below; see note on the AO material.
    uniforms: {
      tAO: { value: null },
      tDepth: { value: null },
      uProjectionMatrixInverse: { value: new THREE.Matrix4() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uDepthSigma: { value: 1.5 },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform sampler2D tAO;
      uniform vec2 uResolution;
      uniform float uDepthSigma;

      ${DEPTH_COMMON}

      #define BLUR_R ${radius}

      void main() {
        vec2 texel = 1.0 / uResolution;
        float centerD = linearDepth( depthAt( vUv ) );

        float sigma = float( BLUR_R ) * 0.5 + 0.5;
        float inv2s2 = 1.0 / ( 2.0 * sigma * sigma );

        float sum = 0.0;
        float wsum = 0.0;

        for ( int j = -BLUR_R; j <= BLUR_R; j++ ) {
          for ( int i = -BLUR_R; i <= BLUR_R; i++ ) {
            vec2 off = vec2( float( i ), float( j ) );
            vec2 suv = vUv + off * texel;

            float d = depthAt( suv );
            float ao = texture2D( tAO, suv ).r;

            // Spatial gaussian * depth similarity (bilateral term).
            float spatial = exp( -dot( off, off ) * inv2s2 );
            float depthW = exp( -abs( linearDepth( d ) - centerD ) / max( uDepthSigma, 1e-3 ) );
            if ( d >= 0.999999 ) depthW = 0.0; // never blur toward the sky

            float w = spatial * depthW;
            sum += ao * w;
            wsum += w;
          }
        }

        float ao = wsum > 0.0 ? sum / wsum : texture2D( tAO, vUv ).r;
        gl_FragColor = vec4( ao, ao, ao, 1.0 );
      }
    `,
  });
}

/* ------------------------------------------------------------------ *
 * 3) Composite pass
 *
 * Multiply the denoised AO onto the linear HDR scene colour. `uPower`
 * shapes the contrast of the occlusion and `uIntensity` lets the quality
 * settings dial the effect back (or off) without touching the pipeline.
 * No tone mapping happens here — that is OutputPass's job.
 * ------------------------------------------------------------------ */
const GTAOCompositeShader = {
  name: 'GTAO-Composite',
  uniforms: {
    tDiffuse: { value: null },
    tAO: { value: null },
    uIntensity: { value: 1.0 },
    uPower: { value: 1.0 },
  },
  vertexShader: FULLSCREEN_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tAO;
    uniform float uIntensity;
    uniform float uPower;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D( tDiffuse, vUv );
      float ao = clamp( texture2D( tAO, vUv ).r, 0.0, 1.0 );
      ao = pow( ao, uPower );
      vec3 col = color.rgb * mix( 1.0, ao, uIntensity );
      gl_FragColor = vec4( col, color.a );
    }
  `,
};

/* Small numeric sanitiser for the opts bag. */
function num(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

/* Half-float, non-depth target suited to small linear values like AO. */
function makeAORT(width, height) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.generateMipmaps = false;
  rt.texture.colorSpace = THREE.NoColorSpace; // stay in linear HDR space
  return rt;
}

/**
 * Create a GTAO (horizon-based SSAO) post-processing effect.
 *
 * Reconstructs view-space position + normals from `ctx.depthTexture`,
 * ray-marches `samples` steps per pixel, denoises with a bilateral blur
 * and multiplies the result onto the scene colour in linear HDR space.
 * Returns a `PostEffect` whose `passes` are [AO, blur, composite].
 *
 * @param {{
 *   width?: number, height?: number,
 *   samples?: number,       // ray-march steps per direction (compile-time)
 *   radius?: number,        // world-space sample radius in metres
 *   bias?: number,          // normal self-occlusion bias
 *   intensity?: number,     // 0..1 blend of the AO onto the scene
 *   power?: number,         // contrast shaping of the AO term
 *   blurRadius?: number,    // bilateral kernel radius in pixels
 *   depthSigma?: number,    // bilateral depth-similarity falloff
 *   scale?: number          // internal resolution scale (0.25..1)
 * }} [opts]
 * @returns {{ name:string, passes:THREE.Pass[], setSize:Function, update:Function, setEnabled:Function, dispose:Function }}
 */
export function createGTAOEffect(opts = {}) {
  const width = Math.max(1, Math.floor(num(opts.width, 1)));
  const height = Math.max(1, Math.floor(num(opts.height, 1)));

  // AO_STEPS is baked into the shader; AO_DIRS is derived from it so a
  // higher `samples` also fans the rays out over more directions.
  const samples = THREE.MathUtils.clamp(Math.round(num(opts.samples, 8)), 2, 32);
  const dirs = THREE.MathUtils.clamp(Math.round(samples / 2), 2, 8);
  const blurRadius = THREE.MathUtils.clamp(Math.round(num(opts.blurRadius, 3)), 1, 6);
  const scale = THREE.MathUtils.clamp(num(opts.scale, 1), 0.25, 1);

  // Initial (possibly downscaled) target size.
  const rtW = Math.max(1, Math.floor(width * scale));
  const rtH = Math.max(1, Math.floor(height * scale));

  const aoRT = makeAORT(rtW, rtH);
  const blurRT = makeAORT(rtW, rtH);

  const aoMaterial = makeAOMaterial(samples, dirs);
  const blurMaterial = makeBlurMaterial(blurRadius);

  const aoPass = new RenderTargetPass(aoMaterial, aoRT, scale);
  const blurPass = new RenderTargetPass(blurMaterial, blurRT, scale);
  const compositePass = new ShaderPass(GTAOCompositeShader);
  compositePass.renderToScreen = false;

  // Pre-wire the static uniform inputs. The blur reads the raw AO target
  // and writes into its own target; the composite reads the blurred one.
  aoMaterial.uniforms.tDepth.value = null;
  blurMaterial.uniforms.tAO.value = aoRT.texture;
  compositePass.uniforms.tAO.value = blurRT.texture;
  blurMaterial.uniforms.tDepth.value = null;

  // Quality knobs exposed as uniforms.
  aoMaterial.uniforms.uRadius.value = THREE.MathUtils.clamp(num(opts.radius, 1.2), 0.05, 20);
  aoMaterial.uniforms.uBias.value = THREE.MathUtils.clamp(num(opts.bias, 0.02), 0, 1);
  blurMaterial.uniforms.uDepthSigma.value = THREE.MathUtils.clamp(num(opts.depthSigma, 1.5), 0.01, 50);
  compositePass.uniforms.uIntensity.value = THREE.MathUtils.clamp(num(opts.intensity, 1.0), 0, 1);
  compositePass.uniforms.uPower.value = THREE.MathUtils.clamp(num(opts.power, 1.0), 0.1, 4.0);

  const passes = [aoPass, blurPass, compositePass];

  // Runtime state — no allocation on the hot path.
  let userEnabled = true;   // setEnabled()
  let available = false;    // depth texture present this frame?
  let near = num(opts.near, 0.1);
  let far = num(opts.far, 1000);

  function applyEnabled() {
    const on = userEnabled && available;
    for (let i = 0; i < passes.length; i++) passes[i].enabled = on;
  }

  function setSize(w, h) {
    const ww = Math.max(1, Math.floor(num(w, width)));
    const hh = Math.max(1, Math.floor(num(h, height)));
    // Each private pass applies its own resolution scale internally, so
    // both this call and EffectComposer.setSize() stay consistent.
    aoPass.setSize(ww, hh);
    blurPass.setSize(ww, hh);
  }

  function update(dt, ctx) {
    const depth = ctx && ctx.depthTexture ? ctx.depthTexture : null;
    available = !!depth;

    if (!available) {
      applyEnabled();
      return;
    }

    // Quality settings can force the effect off independently of the
    // caller's own enable flag.
    const settingOn = !ctx.settings || ctx.settings.gtao !== false;

    // Camera data (guard: the integrator may pass a bare ctx in tests).
    const camera = ctx.camera;
    if (camera && camera.projectionMatrixInverse) {
      aoMaterial.uniforms.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      blurMaterial.uniforms.uProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    }
    if (typeof ctx.cameraNear === 'number') near = ctx.cameraNear;
    if (typeof ctx.cameraFar === 'number') far = ctx.cameraFar;
    aoMaterial.uniforms.uNear.value = near;
    aoMaterial.uniforms.uFar.value = far;
    blurMaterial.uniforms.uNear.value = near;
    blurMaterial.uniforms.uFar.value = far;

    // Keep the depth binding fresh in case the composer swaps targets.
    aoMaterial.uniforms.tDepth.value = depth;
    blurMaterial.uniforms.tDepth.value = depth;

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
    aoPass.dispose();
    blurPass.dispose();
    // Dispose the composite material by hand — calling ShaderPass.dispose()
    // would also dispose the module-shared FullScreenQuad geometry used by
    // every other pass in the composer.
    if (compositePass.material) compositePass.material.dispose();
  }

  // Initialise sizes / uniforms.
  aoPass.setSize(width, height);
  blurPass.setSize(width, height);
  applyEnabled();

  return {
    name: 'gtao',
    passes,
    setSize,
    update,
    setEnabled,
    dispose,
    // Expose the passes for integrators that want to tweak uniforms.
    aoPass,
    blurPass,
    compositePass,
  };
}
