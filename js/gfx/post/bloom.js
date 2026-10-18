import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/* ==================================================================
 * js/gfx/post/bloom.js — mip-chained, "physically-ish" HDR bloom
 *
 * Why a hand-rolled chain instead of UnrealBloomPass?
 * UnrealBloom renders **five full-resolution passes per mip**, which on a
 * phone GPU is most of the frame budget. The industry technique (Unity's
 * HDRP, Unreal's `Bloom_5TAP`, COD:AW's "next-gen post") is:
 *
 *   1. Bright-pass prefilter with a **soft knee** — the knee makes the
 *      transition from "not glowing" to "glowing" continuous in luminance
 *      derivative, so a taillight ramping up does not pop.
 *   2. A **downsample chain** of N mips (each half the last) using a
 *      normalised 9-tap tent. Downsampling is where fireflies die: the
 *      filter averages energy instead of point-sampling it.
 *   3. An **upsample chain** that walks back up, each level additively
 *      blended into the level below with a wide tent filter. This is the
 *      standard multi-scale ("dual filter") blur — it produces a smooth,
 *      artifact-free falloff with no visible mip seams.
 *   4. An optional **anamorphic streak**: a long horizontal blur of the
 *      brightest mip, added back at composite for the J.J. lens-flare look.
 *   5. **Lens dirt**: a procedural canvas "smudge" mask that modulates the
 *      bloom, i.e. the bloom is *dirtier where the glass is dirty*.
 *   6. Additive composite back onto the HDR scene buffer.
 *
 * The whole chain runs at 1/2 resolution and below, so the cost is roughly
 * the cost of one full-res blur while looking considerably better.
 *
 * Linear HDR in, linear HDR out — never tone-map here (OutputPass owns it).
 * ================================================================== */

/** Hard ceiling on the mip chain (resolution / 2^MAX_MIPS). */
const MAX_MIPS = 6;

/** Taps in the anamorphic horizontal streak. Must stay a compile-time int. */
const ANAMORPHIC_TAPS = 17;

/** Mips per quality tier — the chain never goes deeper than the target GPU likes. */
const QUALITY_MIPS = { low: 4, medium: 5, high: 6, ultra: 6 };

/** Shared full-screen vertex shader. `vUv` is the only varying we need. */
const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/* ------------------------------------------------------------------
 * Stage 1 — bright-pass prefilter (soft knee)
 * ------------------------------------------------------------------ */
const PREFILTER_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;        // 1 / source (scene) resolution
  uniform float threshold;    // luminance where bloom starts
  uniform float softKnee;     // 0..1 fraction of 'threshold' spent in the knee
  uniform float uFireflyClamp;// hard ceiling, kills single-pixel HDR suns
  varying vec2 vUv;

  vec3 brightPass( vec3 c ) {
    float br = max( c.r, max( c.g, c.b ) );
    // Quadratic knee: C1-continuous in 'br', so slow ramps never pop.
    float knee = max( threshold * softKnee, 1e-5 );
    float soft = clamp( br - threshold + knee, 0.0, 2.0 * knee );
    soft = ( soft * soft ) / ( 4.0 * knee );
    // Pick whichever of the soft/hard contribution is larger, then scale the
    // *whole* colour by it so the bright pass never shifts the hue.
    float contrib = max( soft, br - threshold ) / max( br, 1e-5 );
    return min( c * contrib, vec3( uFireflyClamp ) );
  }

  void main() {
    // 5-tap cross: a cheap pre-average that stops hot pixels from surviving
    // only in one texel of the half-res mip.
    vec3 c = texture2D( tDiffuse, vUv ).rgb * 0.2;
    c += texture2D( tDiffuse, vUv + vec2( uTexel.x, 0.0 ) ).rgb * 0.2;
    c += texture2D( tDiffuse, vUv - vec2( uTexel.x, 0.0 ) ).rgb * 0.2;
    c += texture2D( tDiffuse, vUv + vec2( 0.0, uTexel.y ) ).rgb * 0.2;
    c += texture2D( tDiffuse, vUv - vec2( 0.0, uTexel.y ) ).rgb * 0.2;
    gl_FragColor = vec4( brightPass( c ), 1.0 );
  }
`;

/* ------------------------------------------------------------------
 * Stage 2 — downsample (normalised 9-tap tent)
 *
 * Kernel weights 1-2-1 in each axis, /16. Because each tap lands on a
 * bilinear footprint that already averages 2x2 source texels, the effective
 * footprint is ~4x4 — plenty to suppress bloom fireflies, and the tent
 * shape keeps the mip chain a smooth Gaussian instead of a box.
 * ------------------------------------------------------------------ */
const DOWNSAMPLE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;        // 1 / source mip resolution
  varying vec2 vUv;

  void main() {
    vec2 o = uTexel;
    vec3 s = texture2D( tDiffuse, vUv ).rgb * 4.0;

    s += texture2D( tDiffuse, vUv + vec2(  o.x, 0.0 ) ).rgb * 2.0;
    s += texture2D( tDiffuse, vUv + vec2( -o.x, 0.0 ) ).rgb * 2.0;
    s += texture2D( tDiffuse, vUv + vec2( 0.0,  o.y ) ).rgb * 2.0;
    s += texture2D( tDiffuse, vUv + vec2( 0.0, -o.y ) ).rgb * 2.0;

    s += texture2D( tDiffuse, vUv + vec2(  o.x,  o.y ) ).rgb;
    s += texture2D( tDiffuse, vUv + vec2( -o.x,  o.y ) ).rgb;
    s += texture2D( tDiffuse, vUv + vec2(  o.x, -o.y ) ).rgb;
    s += texture2D( tDiffuse, vUv + vec2( -o.x, -o.y ) ).rgb;

    gl_FragColor = vec4( s * ( 1.0 / 16.0 ), 1.0 );
  }
`;

/* ------------------------------------------------------------------
 * Stage 3 — upsample (wide tent, additive into the level below)
 *
 * `radius` scales the tent footprint: >1 spreads each mip further, which is
 * what gives the bloom its "bleed". The pass writes with ONE/ONE blending
 * *into the already-populated larger mip*, so no ping-pong targets and no
 * clear are required.
 * ------------------------------------------------------------------ */
const UPSAMPLE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;        // 1 / *smaller* mip resolution
  uniform float radius;       // tent filter radius
  varying vec2 vUv;

  void main() {
    vec2 o = uTexel * radius;
    vec3 s = texture2D( tDiffuse, vUv ).rgb * 4.0;

    s += texture2D( tDiffuse, vUv + vec2(  o.x, 0.0 ) ).rgb * 2.0;
    s += texture2D( tDiffuse, vUv + vec2( -o.x, 0.0 ) ).rgb * 2.0;
    s += texture2D( tDiffuse, vUv + vec2( 0.0,  o.y ) ).rgb * 2.0;
    s += texture2D( tDiffuse, vUv + vec2( 0.0, -o.y ) ).rgb * 2.0;

    s += texture2D( tDiffuse, vUv + vec2(  o.x,  o.y ) ).rgb;
    s += texture2D( tDiffuse, vUv + vec2( -o.x,  o.y ) ).rgb;
    s += texture2D( tDiffuse, vUv + vec2(  o.x, -o.y ) ).rgb;
    s += texture2D( tDiffuse, vUv + vec2( -o.x, -o.y ) ).rgb;

    gl_FragColor = vec4( s * ( 1.0 / 16.0 ), 1.0 );
  }
`;

/* ------------------------------------------------------------------
 * Stage 4 — anamorphic streak (long horizontal blur of the bright mip)
 * ------------------------------------------------------------------ */
const ANAMORPHIC_FRAG = /* glsl */ `
  #define TAPS ${ANAMORPHIC_TAPS}
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;        // 1 / mip resolution
  uniform float uLength;      // half-length of the streak, in texels
  varying vec2 vUv;

  void main() {
    vec3 acc = vec3( 0.0 );
    float wsum = 0.0;
    // Weighted 1-D blur with a raised-cosine-ish falloff: the tails fade so
    // the streak has no visible end cap.
    for ( int i = 0; i < TAPS; i ++ ) {
      float t = ( float( i ) / float( TAPS - 1 ) ) * 2.0 - 1.0;   // -1 .. 1
      float w = 1.0 - abs( t );
      w = w * w;
      acc += texture2D( tDiffuse, vUv + vec2( t * uLength * uTexel.x, 0.0 ) ).rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4( acc / max( wsum, 1e-4 ), 1.0 );
  }
`;

/* ------------------------------------------------------------------
 * Stage 5 — composite (scene + bloom*(1+dirt) + anamorphic)
 * ------------------------------------------------------------------ */
const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;   // HDR scene (readBuffer)
  uniform sampler2D tBloom;     // resolved 1/2-res bloom
  uniform sampler2D tStreak;    // anamorphic streak
  uniform sampler2D tDirt;      // procedural lens-dirt mask
  uniform float uIntensity;     // effective = intensity * exposure fade
  uniform float dirtIntensity;
  uniform float anamorphic;
  uniform vec2 resolution;
  varying vec2 vUv;

  void main() {
    vec3 scene = texture2D( tDiffuse, vUv ).rgb;
    vec3 bloom = texture2D( tBloom, vUv ).rgb;

    // Anamorphic adds a wide, cool, horizontal flare on top of the round bloom.
    bloom += texture2D( tStreak, vUv ).rgb * anamorphic * vec3( 0.42, 0.62, 1.0 );

    // Lens dirt multiplies the bloom: smudges on the front element scatter
    // the light that is already there, they do not emit their own.
    vec3 dirt = texture2D( tDirt, vUv ).rgb;
    bloom *= 1.0 + dirt * dirtIntensity;

    // Ordered-ish dither at 1/512 amplitude: the bloom tail is very low
    // frequency, and without this it bands on 8-bit panels after tonemapping.
    vec2 frag = vUv * resolution;
    float dither = fract( sin( dot( frag, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
    bloom += dither * ( 1.0 / 512.0 );

    gl_FragColor = vec4( max( scene + bloom * uIntensity, vec3( 0.0 ) ), 1.0 );
  }
`;

/**
 * Base class for every stage: owns one `ShaderMaterial` + one `FullScreenQuad`
 * and knows how to draw it into an explicit render target without clearing it.
 * @private
 */
class BloomStage extends Pass {
  /** @param {THREE.ShaderMaterial} material */
  constructor(material) {
    super();
    this.material = material;
    this.fsQuad = new FullScreenQuad(material);
    this.needsSwap = false;
    this.clear = false;
  }

  /**
   * Draw the quad into `target` (or the canvas when `null`) preserving whatever
   * is already in the target — the upsample stages depend on this.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget|null} target
   */
  draw(renderer, target) {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    this.fsQuad.render(renderer);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    // NOTE: deliberately *not* calling `fsQuad.dispose()` — in three r160 that
    // frees the module-level `_geometry` shared by every FullScreenQuad in the
    // whole app, which would break the rest of the composer. We only own the
    // material, so that is all we release.
    this.fsQuad = null;
    if (this.material) this.material.dispose();
    this.material = null;
  }
}

/* ------------------------------------------------------------------
 * Concrete stages
 * ------------------------------------------------------------------ */

/** Bright-pass prefilter: scene HDR -> `mips[0]`. @private */
class BloomPrefilterPass extends BloomStage {
  constructor(material) {
    super(material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.draw(renderer, this.target);
  }
}

/** One link of the downsample chain: `mips[i]` -> `mips[i+1]`. @private */
class BloomDownsamplePass extends BloomStage {
  render(renderer) {
    this.material.uniforms.tDiffuse.value = this.source ? this.source.texture : null;
    this.draw(renderer, this.target);
  }
}

/** One link of the upsample chain: `mips[i+1]` -> `mips[i]`, additively. @private */
class BloomUpsamplePass extends BloomStage {
  render(renderer) {
    this.material.uniforms.tDiffuse.value = this.source ? this.source.texture : null;
    this.draw(renderer, this.target);
  }
}

/** Anamorphic horizontal streak: `mips[1]` -> streak target. @private */
class BloomAnamorphicPass extends BloomStage {
  render(renderer) {
    this.material.uniforms.tDiffuse.value = this.source ? this.source.texture : null;
    this.draw(renderer, this.target);
  }
}

/** Final additive composite back onto the HDR buffer (swaps buffers). @private */
class BloomCompositePass extends BloomStage {
  constructor(material) {
    super(material);
    this.needsSwap = true;
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget} writeBuffer
   * @param {THREE.WebGLRenderTarget} readBuffer
   */
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tBloom.value = this.srcBloom ? this.srcBloom.texture : null;
    u.tStreak.value = this.srcStreak ? this.srcStreak.texture : null;
    this.draw(renderer, this.renderToScreen ? null : writeBuffer);
  }
}

/* ------------------------------------------------------------------
 * Procedural lens-dirt mask
 * ------------------------------------------------------------------ */

/**
 * Build the lens-dirt mask on a 2D canvas: a black field speckled with soft
 * radial smudges and a couple of directional wipe streaks. This is the same
 * trick every AAA engine uses — the "dirt" is just a greyscale multiplier on
 * the bloom, so it needs no colour space and no mipmaps.
 * @param {number} size
 * @returns {THREE.Texture}
 */
function createLensDirtTexture(size = 256) {
  // Node / no-DOM: hand back a 1x1 mid-grey so the uniform is still valid.
  if (typeof document === 'undefined' || !document.createElement) {
    const data = new Uint8Array([0, 0, 0, 255]);
    const fallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    fallback.needsUpdate = true;
    return fallback;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);

  // Deterministic LCG so every reload gets the same (art-directed) smudges.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  g.globalCompositeOperation = 'lighter';

  // Soft round smudges — the bulk of the dirt.
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.015 + rnd() * 0.085);
    const a = 0.04 + rnd() * 0.22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${(a * 0.34).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // A few elongated "wipe" streaks, slightly rotated, like a wiped lens.
  for (let i = 0; i < 5; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = size * (0.25 + rnd() * 0.5);
    const thick = size * (0.01 + rnd() * 0.03);
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI);
    const grad = g.createLinearGradient(-len * 0.5, 0, len * 0.5, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, `rgba(255,255,255,${(0.05 + rnd() * 0.1).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(-len * 0.5, -thick * 0.5, len, thick);
    g.restore();
  }

  // Faint dust specks so the mask is never perfectly smooth.
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 140; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 0.4 + rnd() * 1.4;
    g.fillStyle = `rgba(255,255,255,${(0.05 + rnd() * 0.18).toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  // It is a multiplier, not a colour — keep it out of any sRGB decode.
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Allocate an HDR (RGBA16F) render target with no depth/stencil. @private */
function createHDRTarget(width, height) {
  const rt = new THREE.WebGLRenderTarget(Math.max(1, width | 0), Math.max(1, height | 0), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

/** @private */
function makeMaterial(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial(Object.assign({
    name: 'bloom-stage',
    uniforms,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  }, extra));
}

/**
 * Multi-scale mip-chain bloom with soft-knee prefilter, tent upsample
 * accumulation, procedural lens dirt and an optional anamorphic streak.
 *
 * @param {{
 *   width?: number, height?: number, quality?: string, settings?: object,
 *   threshold?: number, softKnee?: number, radius?: number, intensity?: number,
 *   dirtIntensity?: number, anamorphic?: number, anamorphicLength?: number,
 *   mips?: number,
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
export function createBloomEffect(opts = {}) {
  const settings = opts.settings || {};
  const quality = String(opts.quality || settings.quality || 'high');
  const width = Math.max(1, Math.floor(opts.width || 1));
  const height = Math.max(1, Math.floor(opts.height || 1));

  // ---- tunables -------------------------------------------------------
  const mipCount = THREE.MathUtils.clamp(
    Math.floor(opts.mips || QUALITY_MIPS[quality] || 6),
    3,
    MAX_MIPS
  );

  /**
   * Shared uniform holders. Every stage material references these *same*
   * objects, so the integrator can drive the whole chain through
   * `effect.uniforms` without hunting through individual passes.
   */
  const uniforms = {
    threshold: { value: opts.threshold !== undefined ? opts.threshold : 0.85 },
    softKnee: { value: opts.softKnee !== undefined ? opts.softKnee : 0.6 },
    radius: { value: opts.radius !== undefined ? opts.radius : 1.0 },
    intensity: { value: opts.intensity !== undefined ? opts.intensity : 0.8 },
    dirtIntensity: { value: opts.dirtIntensity !== undefined ? opts.dirtIntensity : 0.55 },
    anamorphic: { value: opts.anamorphic !== undefined ? opts.anamorphic : 0.35 },
    resolution: { value: new THREE.Vector2(width, height) },
  };

  const dirtTexture = createLensDirtTexture(256);

  // ---- render targets -------------------------------------------------
  /** @type {THREE.WebGLRenderTarget[]} */
  const mips = [];
  /** @type {THREE.Vector2[]} reusable size bookkeeping (no per-frame allocs) */
  const mipSizes = [];
  for (let i = 0; i < mipCount; i++) {
    mips.push(createHDRTarget(1, 1));
    mipSizes.push(new THREE.Vector2(1, 1));
  }
  // The anamorphic streak lives at mip[1] resolution: cheap, and wide enough
  // that a 1-D blur reads as a long streak when it is scaled back up.
  const streakTarget = createHDRTarget(1, 1);

  // ---- stages ---------------------------------------------------------

  // 1) prefilter
  const prefilterMaterial = makeMaterial(PREFILTER_FRAG, {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    threshold: uniforms.threshold,
    softKnee: uniforms.softKnee,
    uFireflyClamp: { value: 48.0 },
  });
  const prefilterPass = new BloomPrefilterPass(prefilterMaterial);
  prefilterPass.target = mips[0];

  // 2) downsample chain mips[0] -> mips[n-1]
  /** @type {BloomDownsamplePass[]} */
  const downsamplePasses = [];
  for (let i = 0; i < mipCount - 1; i++) {
    const material = makeMaterial(DOWNSAMPLE_FRAG, {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
    });
    const pass = new BloomDownsamplePass(material);
    pass.source = mips[i];
    pass.target = mips[i + 1];
    downsamplePasses.push(pass);
  }

  // 3) upsample chain mips[n-1] -> mips[0], additively. Additive blending is
  //    what merges the scales; the destination mip keeps its own downsample.
  /** @type {BloomUpsamplePass[]} */
  const upsamplePasses = [];
  for (let i = mipCount - 2; i >= 0; i--) {
    const material = makeMaterial(UPSAMPLE_FRAG, {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      radius: uniforms.radius,
    }, {
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    const pass = new BloomUpsamplePass(material);
    pass.source = mips[i + 1];
    pass.target = mips[i];
    upsamplePasses.push(pass);
  }

  // 4) anamorphic streak
  const anamorphicMaterial = makeMaterial(ANAMORPHIC_FRAG, {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uLength: { value: opts.anamorphicLength !== undefined ? opts.anamorphicLength : 26.0 },
  });
  const anamorphicPass = new BloomAnamorphicPass(anamorphicMaterial);
  anamorphicPass.source = mips[Math.min(1, mipCount - 1)];
  anamorphicPass.target = streakTarget;

  // 5) composite
  const compositeMaterial = makeMaterial(COMPOSITE_FRAG, {
    tDiffuse: { value: null },
    tBloom: { value: null },
    tStreak: { value: null },
    tDirt: { value: dirtTexture },
    // Private holder: the effective strength after the exposure fade. The
    // *public* knob is `uniforms.intensity`, which the integrator drives.
    uIntensity: { value: uniforms.intensity.value },
    dirtIntensity: uniforms.dirtIntensity,
    anamorphic: uniforms.anamorphic,
    resolution: uniforms.resolution,
  });
  const compositePass = new BloomCompositePass(compositeMaterial);
  compositePass.srcBloom = mips[0];
  compositePass.srcStreak = streakTarget;

  /** @type {THREE.Pass[]} */
  const passes = [
    prefilterPass,
    ...downsamplePasses,
    ...upsamplePasses,
    anamorphicPass,
    compositePass,
  ];

  // ---- state ----------------------------------------------------------
  let userEnabled = true;
  let settingsEnabled = true;
  let sceneWidth = width;
  let sceneHeight = height;

  /** Combine the manual toggle with the quality-settings gate. @private */
  function applyEnabled() {
    const on = userEnabled && settingsEnabled;
    for (let i = 0; i < passes.length; i++) passes[i].enabled = on;
  }

  /**
   * Resize every internal target. All targets are powers-of-two-agnostic, and
   * every mip is derived from the *scene* size so a resize stays consistent.
   * @param {number} w @param {number} h
   */
  function setSize(w, h) {
    sceneWidth = Math.max(1, Math.floor(w));
    sceneHeight = Math.max(1, Math.floor(h));

    // mip 0 runs at half resolution — the single biggest bloom optimisation.
    let mw = Math.max(1, sceneWidth >> 1);
    let mh = Math.max(1, sceneHeight >> 1);
    for (let i = 0; i < mips.length; i++) {
      mips[i].setSize(mw, mh);
      mipSizes[i].set(mw, mh);
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
    }
    streakTarget.setSize(mipSizes[Math.min(1, mipCount - 1)].x, mipSizes[Math.min(1, mipCount - 1)].y);

    // Drive each stage's texel size from the *source* it reads this frame.
    prefilterMaterial.uniforms.uTexel.value.set(1 / sceneWidth, 1 / sceneHeight);
    for (let i = 0; i < downsamplePasses.length; i++) {
      downsamplePasses[i].material.uniforms.uTexel.value.set(1 / mipSizes[i].x, 1 / mipSizes[i].y);
    }
    // upsamplePasses[k] reads mip `k+1` (they were pushed smallest-first, and
    // the push order is mirrored exactly by the index arithmetic below).
    for (let k = 0; k < upsamplePasses.length; k++) {
      const srcIndex = mipCount - 1 - k;
      const size = mipSizes[Math.max(0, srcIndex)];
      upsamplePasses[k].material.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    }
    anamorphicMaterial.uniforms.uTexel.value.set(
      1 / mipSizes[Math.min(1, mipCount - 1)].x,
      1 / mipSizes[Math.min(1, mipCount - 1)].y
    );

    uniforms.resolution.value.set(sceneWidth, sceneHeight);
  }

  /** @param {boolean} enabled */
  function setEnabled(enabled) {
    userEnabled = enabled !== false;
    applyEnabled();
  }

  /**
   * Push per-frame uniforms. Bloom does not need depth, but it does respect
   * the quality settings and the renderer exposure so a night shot does not
   * bloom as hard as noon.
   * @param {number} dt
   * @param {object} ctx
   */
  function update(dt, ctx) {
    if (!ctx) return;
    const s = ctx.settings || {};

    // Quality gate — the pass chain stays installed, it simply stops drawing.
    if (typeof s.bloom === 'boolean') {
      settingsEnabled = s.bloom;
      applyEnabled();
    }

    if (typeof opts.bloomStrength !== 'number') {
      if (typeof s.bloomStrength === 'number') {
        uniforms.intensity.value = THREE.MathUtils.clamp(s.bloomStrength, 0, 4);
      } else if (typeof s.bloomIntensity === 'number') {
        uniforms.intensity.value = THREE.MathUtils.clamp(s.bloomIntensity, 0, 4);
      }
    }

    // High exposure should not double-dip: fade the bloom a touch as exposure
    // climbs so blown highlights stay readable instead of clipping to flat.
    let exposureScale = 1;
    if (typeof ctx.exposure === 'number' && ctx.exposure > 0) {
      exposureScale = THREE.MathUtils.clamp(1.15 / (0.55 + ctx.exposure), 0.5, 1.35);
    }
    compositeMaterial.uniforms.uIntensity.value = uniforms.intensity.value * exposureScale;
  }

  /** Release every GPU resource this effect owns. */
  function dispose() {
    for (let i = 0; i < passes.length; i++) {
      if (typeof passes[i].dispose === 'function') passes[i].dispose();
    }
    for (let i = 0; i < mips.length; i++) mips[i].dispose();
    mips.length = 0;
    streakTarget.dispose();
    if (dirtTexture.dispose) dirtTexture.dispose();
  }

  setSize(width, height);
  setEnabled(true);

  return {
    name: 'bloom',
    passes,
    uniforms,
    get mipCount() { return mipCount; },
    setSize,
    update,
    setEnabled,
    dispose,
  };
}
