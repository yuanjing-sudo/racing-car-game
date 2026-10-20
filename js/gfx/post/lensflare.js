import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/* ==================================================================
 * js/gfx/post/lensflare.js — fully procedural screen-space lens flare
 *
 * A real lens flare is not "a sprite near the sun": it is the image of the
 * sun **re-imaged by the glass stack**, which is why the artefacts sit on
 * the straight line running from the sun through the optical centre of the
 * frame. This module reproduces the optical chain analytically:
 *
 *   - **Depth occlusion.** The sun is a point at infinity, so *anything* the
 *     depth buffer reports in front of it is an occluder. We linearise
 *     `ctx.depthTexture` at the sun's screen position and fade the whole
 *     flare out as geometry slides over the sun. This is the single most
 *     important trick — without it a flare happily burns through a tunnel.
 *   - **Ghosts.** Each internal element surface (the 7-9 surfaces of a real
 *     zoom) forms an inverted image of the source. Those images lie along the
 *     sun -> centre axis at parametric positions `t`, alternating polarity —
 *     we render them as soft discs / rings with a radial chromatic split,
 *     because a lens' refractive index varies with wavelength.
 *   - **Hexagonal iris.** A 6-blade diaphragm clips the pupil; the flare
 *     therefore carries a hexagon. We fold the polar angle to 60 degrees and
 *     measure distance to the aperture edge.
 *   - **Halo ring + core.** The airy-ish blaze around the source and the
 *     bright aureole formed by the lens' own aperture.
 *   - **Chromatic streaks.** Anamorphic-ish horizontal flare plus a fainter
 *     vertical one, with a per-channel thickness for the rainbow edge.
 *   - **Starburst.** Diffraction off the blade tips: N-fold spokes.
 *
 * Everything is evaluated in the fragment shader from a handful of analytic
 * shapes — no textures, no geometry, one full-screen pass. The light is
 * added in **linear HDR** and is never tone-mapped here.
 * ================================================================== */

/** Ghost budget per quality tier — clamped into the compiled loop bound. */
const QUALITY_GHOSTS = { low: 4, medium: 6, high: 8, ultra: 12 };

/** Absolute ceiling on the ghost loop (compile-time constant). */
const MAX_GHOSTS = 12;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const LENSFLARE_FRAG = /* glsl */ `
  #define PI 3.141592653589793

  uniform sampler2D tDiffuse;      // HDR scene (readBuffer)
  uniform sampler2D tDepth;        // scene depth (ctx.depthTexture)
  uniform vec2 sunScreenPos;       // sun projected to uv space
  uniform float sunVisible;        // 0..1, already faded for off-screen / night
  uniform float intensity;
  uniform float ghosts;            // how many ghost images to draw
  uniform float haloWidth;         // angular size of the halo
  uniform float aspect;            // width / height
  uniform float chroma;            // radial chromatic split of the flare
  uniform vec2 resolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uPerspective;      // 1 = perspective, 0 = orthographic
  uniform float uSkyDistance;      // linear distance of the sky shell
  uniform float uHasDepth;         // 0 when ctx.depthTexture is unavailable
  uniform vec3 uTint;              // sun colour, so the flare matches the sky
  varying vec2 vUv;

  // Depth buffer [0,1] -> positive distance from the camera.
  float linearDepth( float d ) {
    if ( uPerspective > 0.5 ) {
      float viewZ = ( uNear * uFar ) / ( ( uFar - uNear ) * max( d, 1e-6 ) - uFar );
      return clamp( -viewZ, 0.0, uFar * 8.0 );
    }
    return uNear + d * ( uFar - uNear );
  }

  // 1 inside the disc, 0 outside, with a soft edge.
  float softDisc( float r, float radius ) {
    return 1.0 - smoothstep( radius * 0.62, radius, r );
  }

  // Soft annulus of thickness 'width' centred on 'radius'.
  float softRing( float r, float radius, float width ) {
    return 1.0 - smoothstep( 0.0, max( width, 1e-4 ), abs( r - radius ) );
  }

  float hash12( vec2 p ) {
    return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  }

  void main() {
    vec3 scene = texture2D( tDiffuse, vUv ).rgb;

    // ---- depth occlusion -------------------------------------------
    // Only the sky shell (i.e. the sun's own depth) counts as "visible".
    vec2 sunUv = clamp( sunScreenPos, vec2( 0.0 ), vec2( 1.0 ) );
    float sunDistance = linearDepth( texture2D( tDepth, sunUv ).r );
    float occl = smoothstep( uSkyDistance * 0.90, uSkyDistance * 0.995, sunDistance );
    occl = mix( 1.0, occl, uHasDepth );   // no depth texture -> never occlude

    float vis = sunVisible * occl;
    if ( vis <= 0.002 ) {
      gl_FragColor = vec4( scene, 1.0 );
      return;
    }

    // ---- frame-space geometry --------------------------------------
    vec2 asp = vec2( max( aspect, 0.05 ), 1.0 );
    vec2 p = ( vUv - sunScreenPos ) * asp;
    float r = length( p );
    float ang = atan( p.y, p.x );

    // Per-channel radial scale: a cheap, correct-enough model of the way a
    // glass' refractive index disperses the image by wavelength.
    float scaleR = 1.0 + chroma;
    float scaleB = max( 1.0 - chroma, 0.02 );

    // ---- core + halo ------------------------------------------------
    float hw = max( haloWidth, 1e-3 );
    float core = exp( -r * r * 1100.0 );

    float tr = r * scaleR / hw;
    float tg = r / hw;
    float tb = r * scaleB / hw;
    vec3 halo = vec3( exp( -tr * tr ), exp( -tg * tg ), exp( -tb * tb ) );

    // A brighter, tighter aureole hidden inside the halo gives the "blaze"
    // that real glass shows right at the source.
    float blazer = exp( -r * scaleR * 7.0 );
    float blazeg = exp( -r * 7.0 );
    float blazeb = exp( -r * scaleB * 7.0 );
    vec3 blaze = vec3( blazer, blazeg, blazeb ) * 0.55;

    // ---- halo ring --------------------------------------------------
    float ringR = max( hw * 1.55, 1e-3 );
    float ring = softRing( r, ringR, hw * 0.8 ) * 0.40;

    // ---- hexagonal iris (6-blade diaphragm) -------------------------
    // Fold the angle into [0, PI/3) and take the distance to the nearest
    // flat edge of a hexagon: |r * cos(theta - PI/6)|.
    float seg = mod( ang, PI / 3.0 );
    float hexDist = abs( r * cos( seg - PI / 6.0 ) );
    float hexRadius = max( hw * 1.1, 1e-3 );
    float hexEdge = softRing( hexDist, hexRadius, 0.008 ) * 0.55;
    float hexFill = ( 1.0 - smoothstep( hexRadius * 0.55, hexRadius, hexDist ) ) * 0.10;

    // ---- starburst (diffraction off the blade tips) -----------------
    float spokeA = pow( abs( cos( ang * 6.0 ) ), 20.0 );
    float spokeB = pow( abs( cos( ang * 12.0 + 0.4 ) ), 44.0 );
    float starburst = ( spokeA * 0.55 + spokeB * 0.30 ) * exp( -r * 6.5 );

    // ---- anamorphic streaks ----------------------------------------
    vec2 sv = ( vUv - sunScreenPos ) * asp;
    float thin = 95.0;
    vec3 streakH;
    streakH.r = exp( -abs( sv.y ) * thin * scaleR ) * exp( -abs( sv.x ) * 1.7 );
    streakH.g = exp( -abs( sv.y ) * thin ) * exp( -abs( sv.x ) * 1.7 );
    streakH.b = exp( -abs( sv.y ) * thin * scaleB ) * exp( -abs( sv.x ) * 1.7 );
    // fainter vertical flare so the cross is not perfectly symmetric
    vec3 streakV;
    streakV.r = exp( -abs( sv.x ) * thin * scaleR ) * exp( -abs( sv.y ) * 2.4 );
    streakV.g = exp( -abs( sv.x ) * thin ) * exp( -abs( sv.y ) * 2.4 );
    streakV.b = exp( -abs( sv.x ) * thin * scaleB ) * exp( -abs( sv.y ) * 2.4 );

    // ---- ghosts along the sun -> centre axis -------------------------
    vec2 centre = vec2( 0.5, 0.5 );
    vec3 ghostSum = vec3( 0.0 );
    for ( int i = 0; i < MAX_GHOSTS; i ++ ) {
      float fi = float( i );
      if ( fi < ghosts ) {
        // t goes 0 (sun) -> 1 (centre) -> beyond, exactly like the images of
        // a source reflected between the elements of a lens.
        float t = 0.40 + fi * 0.36;
        vec2 gp = mix( sunScreenPos, centre, t );
        vec2 gv = ( vUv - gp ) * asp;
        float gr = length( gv );

        // Golden-ratio radius spread so the ghost train looks natural.
        float radius = 0.030 + 0.030 * fract( fi * 0.6180339 );
        float discR = softDisc( gr, radius * scaleR );
        float discG = softDisc( gr, radius );
        float discB = softDisc( gr, radius * scaleB );

        // Every third ghost is a ring (an element that only reflects a rim).
        float ringAmt = step( 1.0, mod( fi, 3.0 ) );
        float ringR = softRing( gr, radius, radius * 0.32 );
        float ringG = softRing( gr, radius, radius * 0.32 );
        float ringB = softRing( gr, radius, radius * 0.32 );

        vec3 gc = vec3(
          mix( discR, ringR, ringAmt ),
          mix( discG, ringG, ringAmt ),
          mix( discB, ringB, ringAmt )
        );

        // Alternating warm/cool coatings, dimming as the image walks away
        // from the source (each bounce loses energy).
        vec3 tint = mix( vec3( 1.0, 0.55, 0.22 ), vec3( 0.35, 0.70, 1.0 ), fract( fi * 0.37 ) );
        float bright = ( 0.11 + 0.05 * fract( fi * 0.53 ) ) * ( 1.0 - min( t, 1.4 ) * 0.45 );
        ghostSum += gc * tint * bright;
      }
    }

    // ---- assemble ----------------------------------------------------
    vec3 flare = vec3( 0.0 );
    flare += uTint * core * 1.35;
    flare += uTint * ( halo * 0.50 + blaze );
    flare += uTint * ring;
    flare += vec3( 0.62, 0.80, 1.0 ) * ( hexEdge + hexFill );
    flare += vec3( 0.70, 0.82, 1.0 ) * starburst * 0.55;
    flare += vec3( 0.55, 0.68, 1.0 ) * streakH * 0.45;
    flare += vec3( 0.60, 0.72, 1.0 ) * streakV * 0.22;
    flare += ghostSum;

    flare *= vis * intensity;

    // The halo is an extremely smooth, wide gradient: dither it or it bands
    // badly on 8-bit displays once OutputPass has stretched the highlights.
    flare += ( hash12( vUv * resolution ) - 0.5 ) * ( 1.0 / 512.0 ) * vis * intensity;

    gl_FragColor = vec4( scene + max( flare, vec3( 0.0 ) ), 1.0 );
  }
`;

/**
 * The single composite pass: reads the HDR scene + depth, writes scene+flare
 * into the composer's write buffer (so it swaps and the chain continues).
 * @private
 */
class LensFlarePass extends Pass {
  /** @param {THREE.ShaderMaterial} material */
  constructor(material) {
    super();
    this.material = material;
    this.fsQuad = new FullScreenQuad(material);
    this.needsSwap = true;
    this.clear = false;
    /** @type {THREE.DepthTexture|null} */
    this.depthTexture = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = this.depthTexture;
    u.uHasDepth.value = this.depthTexture ? 1 : 0;

    // autoClear off: the quad overwrites the whole target anyway, and leaving
    // it on would clear the *write* buffer's alpha needlessly.
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    // Do NOT call fsQuad.dispose(): in three r160 that frees the shared
    // full-screen triangle geometry used by the whole composer.
    this.fsQuad = null;
    if (this.material) this.material.dispose();
    this.material = null;
  }
}

/* Scratch objects — allocated once so `update()` never touches the heap. */
const _sunView = new THREE.Vector3();
const _clip = new THREE.Vector4();

/** GLSL-style smoothstep, for the CPU-side camera fade. @private */
function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Project the (camera-space-infinite) sun direction to screen space using the
 * projection matrix with `w = 0`, which is the correct homogeneous treatment
 * of a direction at infinity and works for both perspective and ortho cameras.
 *
 * @param {THREE.Camera} camera
 * @param {THREE.Vector3} sunDirection normalised, pointing TOWARD the sun
 * @param {THREE.Vector2} outUv receives uv-space position (0..1)
 * @returns {boolean} true when the sun is *behind* the camera
 * @private
 */
function projectSunToScreen(camera, sunDirection, outUv) {
  _sunView.copy(sunDirection).transformDirection(camera.matrixWorldInverse);
  _clip.set(_sunView.x, _sunView.y, _sunView.z, 0.0).applyMatrix4(camera.projectionMatrix);

  const w = _clip.w;
  if (Math.abs(w) < 1e-6) {
    // Orthographic projection: row 3 is (0,0,0,1), so no w divide is needed.
    outUv.set(_clip.x * 0.5 + 0.5, _clip.y * 0.5 + 0.5);
    return false;
  }
  const inv = 1 / w;
  outUv.set(_clip.x * inv * 0.5 + 0.5, _clip.y * inv * 0.5 + 0.5);
  // A negative w means the sun is behind the camera plane; the projection
  // mirrors it, so it must be reported as invisible rather than drawn.
  return w < 0;
}

/**
 * Procedural screen-space lens flare: depth-occluded ghost train, hex iris,
 * chromatic streaks, halo and starburst, all evaluated analytically in one
 * full-screen additive pass. Skips itself at night.
 *
 * @param {{
 *   width?: number, height?: number, quality?: string, settings?: object,
 *   intensity?: number, ghosts?: number, haloWidth?: number, chroma?: number,
 *   skyDistance?: number, tint?: THREE.Color|number,
 * }} [opts]
 * @returns {{
 *   name: string,
 *   passes: THREE.Pass[],
 *   uniforms: Record<string, { value: any }>,
 *   setSize: (w: number, h: number) => void,
 *   update: (dt: number, ctx: object) => void,
 *   setEnabled: (enabled: boolean) => void,
 *   dispose: () => void,
 * }}
 */
export function createLensFlareEffect(opts = {}) {
  const settings = opts.settings || {};
  const quality = String(opts.quality || settings.quality || 'high');
  const width = Math.max(1, Math.floor(opts.width || 1));
  const height = Math.max(1, Math.floor(opts.height || 1));

  const maxGhosts = THREE.MathUtils.clamp(
    Math.floor(opts.ghosts || QUALITY_GHOSTS[quality] || 8),
    1,
    MAX_GHOSTS
  );

  const tint = new THREE.Color(1.0, 0.92, 0.78);
  if (opts.tint !== undefined) tint.set(opts.tint);

  // Public uniform surface. Shared holder objects: assigning the same object
  // into the material's uniform map means one write drives the shader.
  const uniforms = {
    sunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
    sunVisible: { value: 0 },
    intensity: { value: opts.intensity !== undefined ? opts.intensity : 0.85 },
    ghosts: { value: maxGhosts },
    haloWidth: { value: opts.haloWidth !== undefined ? opts.haloWidth : 0.16 },
    aspect: { value: width / height },
    chroma: { value: opts.chroma !== undefined ? opts.chroma : 0.035 },
    resolution: { value: new THREE.Vector2(width, height) },
  };

  const material = new THREE.ShaderMaterial({
    name: 'lensflare',
    defines: { MAX_GHOSTS: maxGhosts },
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      sunScreenPos: uniforms.sunScreenPos,
      sunVisible: uniforms.sunVisible,
      intensity: uniforms.intensity,
      ghosts: uniforms.ghosts,
      haloWidth: uniforms.haloWidth,
      aspect: uniforms.aspect,
      chroma: uniforms.chroma,
      resolution: uniforms.resolution,
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uPerspective: { value: 1 },
      uSkyDistance: { value: opts.skyDistance !== undefined ? opts.skyDistance : 700 },
      uHasDepth: { value: 0 },
      uTint: { value: tint },
    },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: LENSFLARE_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const pass = new LensFlarePass(material);
  const passes = [pass];

  let userEnabled = true;
  let settingsEnabled = true;
  let sceneWidth = width;
  let sceneHeight = height;
  // Eased visibility so a building sliding off the sun does not pop the flare.
  let smoothVisible = 0;
  // Sky shell distance is only recomputed when the camera's far plane moves.
  let skyDistance = uniforms.haloWidth ? (opts.skyDistance || 0) : 0;

  function applyEnabled() {
    pass.enabled = userEnabled && settingsEnabled;
  }

  /**
   * @param {number} w @param {number} h
   */
  function setSize(w, h) {
    sceneWidth = Math.max(1, Math.floor(w));
    sceneHeight = Math.max(1, Math.floor(h));
    uniforms.aspect.value = sceneWidth / sceneHeight;
    uniforms.resolution.value.set(sceneWidth, sceneHeight);
  }

  /** @param {boolean} enabled */
  function setEnabled(enabled) {
    userEnabled = enabled !== false;
    applyEnabled();
  }

  /**
   * Per-frame: project the sun, work out how occluded it is, push uniforms.
   * Allocates nothing.
   * @param {number} dt seconds
   * @param {object} ctx
   */
  function update(dt, ctx) {
    if (!ctx) return;
    const s = ctx.settings || {};
    const camera = ctx.camera;
    const delta = Math.min(Math.max(dt || 0, 0), 0.1);

    if (typeof s.lensflare === 'boolean') {
      settingsEnabled = s.lensflare;
      applyEnabled();
    }

    if (!camera) return;

    // Depth / near / far requirements. A missing depth texture only disables
    // occlusion, never the flare itself.
    pass.depthTexture = ctx.depthTexture || null;
    material.uniforms.uHasDepth.value = pass.depthTexture ? 1 : 0;
    material.uniforms.uNear.value = typeof ctx.cameraNear === 'number' ? ctx.cameraNear : camera.near;
    material.uniforms.uFar.value = typeof ctx.cameraFar === 'number' ? ctx.cameraFar : camera.far;
    material.uniforms.uPerspective.value = camera.isPerspectiveCamera ? 1 : 0;

    // The sky shell sits at a fixed fraction of the far plane (this project's
    // sky dome is a 1400-unit sphere under a 2000-unit far plane).
    if (opts.skyDistance === undefined) {
      const far = material.uniforms.uFar.value;
      skyDistance = far * 0.70;
      material.uniforms.uSkyDistance.value = skyDistance;
    }

    // --- project the sun ------------------------------------------------
    const sunDir = ctx.sunDirection;
    if (sunDir && typeof sunDir.x === 'number') {
      const behind = projectSunToScreen(camera, sunDir, uniforms.sunScreenPos.value);

      // Fade in as the sun crosses the frame edge; the flare peaks when the
      // sun is inside the middle ~70% of the view.
      const u = uniforms.sunScreenPos.value;
      const ndcX = u.x * 2 - 1;
      const ndcY = u.y * 2 - 1;
      const radial = Math.sqrt(ndcX * ndcX * 0.85 + ndcY * ndcY);
      const screenFade = smoothstep(1.35, 0.75, radial);

      // A low sun reads as a softer, redder blaze: fade slightly near the
      // horizon and let the tint (pushed by the integrator) do the rest.
      const elevation = THREE.MathUtils.clamp((sunDir.y || 0) * 2.2, 0, 1);
      const sunStrength = 0.35 + 0.65 * elevation;

      let target = behind ? 0 : screenFade * sunStrength;
      if (ctx.isNight) target = 0;
      if (typeof ctx.sunVisible === 'number') target *= THREE.MathUtils.clamp(ctx.sunVisible, 0, 1);

      smoothVisible += (target - smoothVisible) * Math.min(1, delta * 9);
      uniforms.sunVisible.value = smoothVisible;

      // Keep the flare's colour locked to the sun so dusk shots sit right.
      if (ctx.sunColor && typeof ctx.sunColor.r === 'number') {
        tint.copy(ctx.sunColor).multiplyScalar(1.6).lerp(new THREE.Color(1, 1, 1), 0.35);
      }
    } else {
      smoothVisible += (0 - smoothVisible) * Math.min(1, delta * 9);
      uniforms.sunVisible.value = smoothVisible;
    }

    // Integrator overrides (published settings) win over the defaults.
    if (typeof s.lensflareIntensity === 'number') {
      uniforms.intensity.value = THREE.MathUtils.clamp(s.lensflareIntensity, 0, 4);
    }
    if (!userEnabled || !settingsEnabled) uniforms.sunVisible.value = 0;

    uniforms.resolution.value.set(sceneWidth, sceneHeight);
  }

  /** Release the pass material. */
  function dispose() {
    pass.dispose();
  }

  setSize(width, height);
  applyEnabled();

  return {
    name: 'lensflare',
    passes,
    uniforms,
    setSize,
    update,
    setEnabled,
    dispose,
  };
}
