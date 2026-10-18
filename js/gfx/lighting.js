import * as THREE from 'three';

/* =====================================================================================
 * js/gfx/lighting.js — artistic lighting rig
 *
 * The "look" of VELOCE GT-R is a night-time Tokyo circuit: a low, warm sun or a cool
 * moon, a huge hemisphere fill standing in for the sky dome, and — most importantly — a
 * *colourful scatter* of street lamps, shop signs and car lights that make the wet
 * asphalt sing. Lighting all of those with real engine lights would need hundreds of
 * them and would destroy the frame budget, so this rig does two things:
 *
 *   1. GLOBAL RIG — sun + moon directionals, a sky/ground hemisphere fill, an ambient
 *      term and a cheap "city bounce" light. Every one of them is driven by a keyframed
 *      colour/intensity *ramp* over the 24h clock, so `setTimeOfDay(19.5)` gives you a
 *      gorgeous sunset with no per-frame colour picking from the caller.
 *
 *   2. LOCAL POOL — `addStreetlight()` registers an *unlit* record (position/colour/
 *      range). Each frame we select the **N nearest** records to the camera and map them
 *      onto a small, fixed pool of real `THREE.SpotLight`s (round-robin slot recycling,
 *      plus a smooth distance fade so nothing pops). Unused pool slots are `visible =
 *      false`, and Three.js skips invisible lights entirely, so the shader never pays
 *      for them. Result: an arbitrary number of streetlights at a cost of N.
 *
 * Neon signage is billed by `addNeonGlow()`: additive billboards batched into a single
 * `InstancedMesh` that always faces the camera. Both glows and pooled spots can be given
 * a *flicker* pattern (see FLICKER) and the pooled spots are shaped by a procedural
 * "cookie" texture (the gobo that a real fixture projects), which is what stops a
 * streetlight from looking like a floating white ball.
 *
 * Everything is allocation-free per frame: scratch vectors/quaternions/matrices are
 * module-level, distances live in a preallocated `Float32Array`, and the pool itself is
 * built once in the factory.
 * ===================================================================================== */

/* ---- tiny local maths: gfx modules stay self-contained (import `three` only) -------- */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Deterministic 0..1 hash. Used by the "broken sign" flicker — same input, same output,
 *  so the pattern is stable across frames and needs no RNG state. */
const hash = (n) => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/* =====================================================================================
 * Time-of-day ramp
 *
 * Each key is a full lighting "look": sun/moon colour + intensity, hemisphere top and
 * bottom colours, ambient tint and the fog tint the rig would like the scene to use.
 * We sample the sorted key list and lerp between neighbours, writing into a *reused*
 * record of scratch THREE.Color objects (no allocation, ~10 comparisons per frame).
 * ===================================================================================== */
const TOD_KEYS = [
  // h     sun       sunI   moon      moonI  sky       ground    hemiI  ambient   ambI   cityGlow  cityI  fog
  { h: 0.0, sun: 0x1b2a4a, sunI: 0.00, moon: 0x5b74b8, moonI: 0.55, sky: 0x0a1424, ground: 0x07080c, hemiI: 0.22, amb: 0x18203a, ambI: 0.30, city: 0xff4f8b, cityI: 0.55, fog: 0x070a12 },
  { h: 4.5, sun: 0x2a3c60, sunI: 0.00, moon: 0x5b74b8, moonI: 0.45, sky: 0x101c30, ground: 0x08090e, hemiI: 0.25, amb: 0x1d2742, ambI: 0.32, city: 0xff4f8b, cityI: 0.50, fog: 0x0a0f1a },
  { h: 6.0, sun: 0xff7a3c, sunI: 0.55, moon: 0x6a80c0, moonI: 0.18, sky: 0x2b3a63, ground: 0x161318, hemiI: 0.40, amb: 0x2b2b3f, ambI: 0.40, city: 0xff6a5a, cityI: 0.28, fog: 0x2a2733 },
  { h: 7.5, sun: 0xffb066, sunI: 1.60, moon: 0x6a80c0, moonI: 0.00, sky: 0x6f97d8, ground: 0x2c2419, hemiI: 0.75, amb: 0x44506b, ambI: 0.52, city: 0xff8a6a, cityI: 0.12, fog: 0x8a93a8 },
  { h: 12.0, sun: 0xfff2df, sunI: 2.65, moon: 0x6a80c0, moonI: 0.00, sky: 0x7fb2ee, ground: 0x4a4034, hemiI: 1.00, amb: 0x5c6b86, ambI: 0.60, city: 0xffb0a0, cityI: 0.00, fog: 0xb7c6d8 },
  { h: 16.5, sun: 0xffe3bb, sunI: 2.20, moon: 0x6a80c0, moonI: 0.00, sky: 0x84a9dd, ground: 0x453a2c, hemiI: 0.90, amb: 0x566179, ambI: 0.55, city: 0xffb0a0, cityI: 0.00, fog: 0xa8b4c6 },
  { h: 18.5, sun: 0xff8f4a, sunI: 1.15, moon: 0x6a80c0, moonI: 0.05, sky: 0x6b5b8c, ground: 0x2b2028, hemiI: 0.60, amb: 0x453b52, ambI: 0.46, city: 0xff7a6a, cityI: 0.22, fog: 0x554c63 },
  { h: 20.0, sun: 0xff5a2c, sunI: 0.30, moon: 0x6076b8, moonI: 0.30, sky: 0x2a2b52, ground: 0x14121a, hemiI: 0.36, amb: 0x2a2740, ambI: 0.36, city: 0xff5f9a, cityI: 0.45, fog: 0x22243a },
  { h: 21.5, sun: 0x3a2f5e, sunI: 0.00, moon: 0x5b74b8, moonI: 0.50, sky: 0x121a30, ground: 0x0a0a10, hemiI: 0.24, amb: 0x1c2440, ambI: 0.32, city: 0xff4f8b, cityI: 0.52, fog: 0x0b0f1c },
  { h: 24.0, sun: 0x1b2a4a, sunI: 0.00, moon: 0x5b74b8, moonI: 0.55, sky: 0x0a1424, ground: 0x07080c, hemiI: 0.22, amb: 0x18203a, ambI: 0.30, city: 0xff4f8b, cityI: 0.55, fog: 0x070a12 },
];

/** Ramp keyframes with pre-baked THREE colours (sRGB hex → linear working space). */
const RAMP = TOD_KEYS.map((k) => ({
  h: k.h,
  sun: new THREE.Color(k.sun), sunI: k.sunI,
  moon: new THREE.Color(k.moon), moonI: k.moonI,
  sky: new THREE.Color(k.sky), ground: new THREE.Color(k.ground), hemiI: k.hemiI,
  amb: new THREE.Color(k.amb), ambI: k.ambI,
  city: new THREE.Color(k.city), cityI: k.cityI,
  fog: new THREE.Color(k.fog),
}));

/**
 * Look up the lighting state at an hour and lerp it into `out` (a reusable record of
 * magnitudes + THREE.Colors). No allocations; the input hour may be any real number.
 * @param {number} h hour 0..24 (wrapped)
 * @param {object} out destination record
 */
function sampleRamp(h, out) {
  const hour = ((h % 24) + 24) % 24;
  let i = 0;
  for (; i < RAMP.length - 1; i++) if (hour < RAMP[i + 1].h) break;
  const a = RAMP[i];
  const b = RAMP[Math.min(i + 1, RAMP.length - 1)];
  const span = b.h - a.h || 1;
  const t = clamp((hour - a.h) / span, 0, 1);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.sunI = lerp(a.sunI, b.sunI, t);
  out.moon.copy(a.moon).lerp(b.moon, t);
  out.moonI = lerp(a.moonI, b.moonI, t);
  out.sky.copy(a.sky).lerp(b.sky, t);
  out.ground.copy(a.ground).lerp(b.ground, t);
  out.hemiI = lerp(a.hemiI, b.hemiI, t);
  out.amb.copy(a.amb).lerp(b.amb, t);
  out.ambI = lerp(a.ambI, b.ambI, t);
  out.city.copy(a.city).lerp(b.city, t);
  out.cityI = lerp(a.cityI, b.cityI, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  return out;
}

/* =====================================================================================
 * Flicker patterns
 *
 * A neon sign that never moves reads as a decal. Cheap, deterministic time functions
 * give the rig "life": mains hum, a dying ballast, a slow breathing shop sign. They all
 * return a multiplier around 0.15..1.15 which is folded into glow colour / spot
 * intensity, so a flicker costs a couple of sin()s and nothing else.
 * ===================================================================================== */
const FLICKER = { steady: 0, pulse: 1, buzz: 2, broken: 3, breathe: 4 };

function flickerGain(pattern, t, speed, phase) {
  switch (pattern) {
    case FLICKER.pulse:
      return 0.78 + 0.24 * Math.sin(t * speed + phase);
    case FLICKER.buzz: {
      // two detuned sines ≈ irregular mains hum without touching the RNG
      const n = Math.sin(t * speed * 13.7 + phase) * Math.sin(t * speed * 7.31 + phase * 1.7);
      return 0.9 + 0.12 * n;
    }
    case FLICKER.broken: {
      // stepped, quantised drop-outs: a fluorescent tube that is about to die
      const step = Math.floor(t * speed + phase);
      const drop = hash(step * 1.37 + phase);
      const gate = drop > 0.78 ? 0.12 : drop > 0.55 ? 0.55 : 1.0;
      return gate * (0.94 + 0.06 * Math.sin(t * speed * 40 + phase));
    }
    case FLICKER.breathe: {
      const s = 0.5 + 0.5 * Math.sin(t * speed + phase);
      return 0.55 + 0.45 * smoothstep(0, 1, s);
    }
    default:
      return 1;
  }
}

/** Normalise a pattern given as a string or as a FLICKER enum. */
function flickerId(name) {
  if (typeof name === 'number') return name;
  if (typeof name === 'string' && name in FLICKER) return FLICKER[name];
  return FLICKER.steady;
}

/* =====================================================================================
 * Procedural textures
 * ===================================================================================== */

/**
 * Light "cookie" (a.k.a. gobo): the pattern a real fixture throws. We bake a soft cone
 * falloff, a ring of spokes (metal-halide reflector) and a little glass grime. Assigned
 * to pooled spot lights via `SpotLight.map`, which projects the texture through the
 * light's own shadow camera — see WebGLLights: `if (light.map) shadow.updateMatrices()`.
 * No shadow map is created, so cookies are essentially free.
 */
function makeCookieTexture(seed) {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;

  g.fillStyle = '#000000';
  g.fillRect(0, 0, size, size);

  const r = size * 0.5;
  const radial = g.createRadialGradient(r, r, 0, r, r, r);
  radial.addColorStop(0.0, 'rgba(255,255,255,1)');
  radial.addColorStop(0.45, 'rgba(238,240,255,0.90)');
  radial.addColorStop(0.80, 'rgba(150,160,200,0.35)');
  radial.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = radial;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();

  // reflector spokes: carved out of the cone with destination-out
  const spokes = 7 + (seed % 5);
  g.globalCompositeOperation = 'destination-out';
  g.lineWidth = size * 0.018;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + seed * 0.37;
    g.strokeStyle = 'rgba(0,0,0,0.34)';
    g.beginPath();
    g.moveTo(r + Math.cos(a) * size * 0.16, r + Math.sin(a) * size * 0.16);
    g.lineTo(r + Math.cos(a) * size * 0.75, r + Math.sin(a) * size * 0.75);
    g.stroke();
  }
  // glass grime / dead bugs: a few soft holes, deterministic per fixture
  for (let i = 0; i < 26; i++) {
    const a = hash(i * 3.1 + seed) * Math.PI * 2;
    const d = 0.15 + hash(i * 5.7 + seed * 2) * 0.75;
    const rr = size * (0.008 + hash(i * 9.3 + seed) * 0.03);
    g.fillStyle = 'rgba(0,0,0,' + (0.35 + hash(i * 1.7) * 0.5).toFixed(3) + ')';
    g.beginPath();
    g.arc(r + Math.cos(a) * d * r, r + Math.sin(a) * d * r, rr, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial sprite used by the additive neon billboards (white core → transparent). */
function makeGlowTexture() {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const r = size * 0.5;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.14, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/* =====================================================================================
 * Scratch state (module scope → never allocated per frame)
 * ===================================================================================== */
const _focus = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();
const _sunDir = new THREE.Vector3();
const _rampA = freshRamp();
const _rampB = freshRamp();
const _rampMix = freshRamp();

function freshRamp() {
  return {
    sun: new THREE.Color(), sunI: 0,
    moon: new THREE.Color(), moonI: 0,
    sky: new THREE.Color(), ground: new THREE.Color(), hemiI: 0,
    amb: new THREE.Color(), ambI: 0,
    city: new THREE.Color(), cityI: 0,
    fog: new THREE.Color(),
  };
}

/** Blend two ramp records into the third (used for the `setNight` cross-fade). */
function blendRamp(a, b, t, out) {
  out.sun.copy(a.sun).lerp(b.sun, t); out.sunI = lerp(a.sunI, b.sunI, t);
  out.moon.copy(a.moon).lerp(b.moon, t); out.moonI = lerp(a.moonI, b.moonI, t);
  out.sky.copy(a.sky).lerp(b.sky, t); out.ground.copy(a.ground).lerp(b.ground, t);
  out.hemiI = lerp(a.hemiI, b.hemiI, t);
  out.amb.copy(a.amb).lerp(b.amb, t); out.ambI = lerp(a.ambI, b.ambI, t);
  out.city.copy(a.city).lerp(b.city, t); out.cityI = lerp(a.cityI, b.cityI, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  return out;
}

const QUALITY_SPOTS = { low: 4, medium: 6, high: 8, ultra: 12 };
const GLOW_CAPACITY = 128;
const MAX_SPOT_POOL = 12;
const RECORD_CAPACITY = 512;
/** Candela per unit of user-supplied streetlight intensity. Chosen so that a default
 *  `intensity: 1` lamp at 8 m reads as a bright but not blown-out pool of light under
 *  ACES tone mapping with the project's 1.05 exposure. */
const SPOT_CANDELA = 180;

/**
 * @param {{ renderer?: THREE.WebGLRenderer, scene: THREE.Scene,
 *           quality?: string, maxSpotlights?: number, followSun?: boolean }} opts
 * @returns {{
 *   update(dt:number, ctx:object):void, group: THREE.Group,
 *   addStreetlight(position:any, color:any, opts?:object):object,
 *   addNeonGlow(position:any, color:any, size?:number, opts?:object):object,
 *   setTimeOfDay(h:number):void, setNight(night:boolean):void,
 *   setQuality(q:string):void, clear():void, dispose():void,
 *   sun: THREE.DirectionalLight, moon: THREE.DirectionalLight,
 *   getSunDirection(out:THREE.Vector3):THREE.Vector3,
 *   getLightingState():object
 * }}
 */
export function createLightingRig({ renderer, scene, quality = 'high', maxSpotlights, followSun = false } = {}) {
  /* ---------------------------------------------------------------- container ------ */
  const group = new THREE.Group();
  group.name = 'LightingRig';
  if (scene) scene.add(group);

  /* ---------------------------------------------------------------- global rig ----- */
  const sun = new THREE.DirectionalLight(0xfff2df, 2.65);
  sun.position.set(60, 120, 40);
  sun.castShadow = true; // the shadow manager may re-register this light
  if (scene && !sun.target.parent) group.add(sun.target);
  group.add(sun);

  const moon = new THREE.DirectionalLight(0x5b74b8, 0.5);
  moon.position.set(-60, 120, -40);
  group.add(moon.target);
  group.add(moon);

  const hemi = new THREE.HemisphereLight(0x7fb2ee, 0x4a4034, 1.0);
  group.add(hemi);

  const ambient = new THREE.AmbientLight(0x5c6b86, 0.6);
  group.add(ambient);

  // "city bounce": a warm/pink directional from *below* so undersides of aero and the
  // road lip pick up the neon haze that a physical sky would never give us.
  const cityGlow = new THREE.DirectionalLight(0xff4f8b, 0.0);
  cityGlow.position.set(4, -100, -6);
  group.add(cityGlow.target);
  group.add(cityGlow);

  /* ---------------------------------------------------------------- neon glows ----- */
  const glowTexture = makeGlowTexture();
  const glowMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
  });
  const glowGeometry = new THREE.PlaneGeometry(1, 1);
  const glowMesh = new THREE.InstancedMesh(glowGeometry, glowMaterial, GLOW_CAPACITY);
  glowMesh.name = 'NeonGlow';
  glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glowMesh.frustumCulled = false; // billboards are re-billboarded every frame
  glowMesh.renderOrder = 4;
  glowMesh.count = 0;
  // pre-build the instance colour buffer so `setColorAt` never allocates on frame 1
  glowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_CAPACITY * 3).fill(1), 3);
  glowMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(glowMesh);

  /* ---------------------------------------------------------------- spot pool ------ */
  const cookies = [makeCookieTexture(1), makeCookieTexture(2), makeCookieTexture(3)].filter(Boolean);
  const poolSize = clamp(Math.round(maxSpotlights || MAX_SPOT_POOL), 1, MAX_SPOT_POOL);
  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    const light = new THREE.SpotLight(0xffffff, 0, 24, Math.PI * 0.28, 0.45, 2);
    light.name = 'PooledSpot' + i;
    light.castShadow = false; // pooled lamps never cast — the sun owns the shadow budget
    light.visible = false;
    if (cookies.length) light.map = cookies[i % cookies.length];
    group.add(light);
    group.add(light.target);
    pool.push({ light, rec: null });
  }
  let rrCursor = 0; // round-robin slot cursor (anti-starvation)

  /* ---------------------------------------------------------------- registry ------- */
  const records = [];      // streetlight records, compacted lazily
  const glows = [];        // neon glow records
  const distBuf = new Float32Array(RECORD_CAPACITY);
  const selRec = new Array(poolSize).fill(null);
  const selDist = new Float32Array(poolSize);
  const selSet = new Set();
  const ownedSet = new Set();
  let recordsDirty = false;
  let glowCursor = 0;

  /* ---------------------------------------------------------------- rig state ------ */
  let activePool = clamp(QUALITY_SPOTS[quality] || QUALITY_SPOTS.high, 1, poolSize);
  let tod = 21.0;
  let nightTarget = 0;     // 0 = follow the clock, 1 = forced night
  let nightBlend = 0;
  let nightExplicit = false;
  const nightHour = 22.5;
  let elapsed = 0;
  const fogColorOut = new THREE.Color(0x0b0f1c);
  let sunElevation = 0;
  let neonGain = 1;

  /** Fill `_sunDir` from the clock. The sun rides a great circle: sunrise at +X, noon
   *  overhead, sunset at -X, with a constant Z tilt so it never sits dead-centre. */
  function computeSunDirection(h) {
    const angle = ((h - 6) / 12) * Math.PI;
    _sunDir.set(Math.cos(angle) * 0.86, Math.sin(angle), 0.36).normalize();
    return _sunDir;
  }

  /* ================================================================ streetlights === */
  function applyFlicker(rec, pattern, opts) {
    const id = flickerId(pattern);
    if (id === FLICKER.steady) {
      rec.flicker = null;
      rec.gain = 1;
      return;
    }
    rec.flicker = {
      id,
      speed: clamp(opts && opts.speed !== undefined ? opts.speed : 1, 0.01, 40),
      phase: (opts && opts.phase !== undefined ? opts.phase : hash(records.length * 7.7) * 6.283) % 6.283,
    };
  }

  function applyRecordColor(rec, c) {
    if (c && c.isColor) rec.color.copy(c);
    else rec.color.set(c === undefined || c === null ? 0xffd9a0 : c);
  }

  /** Same as above but for the lightweight glow records (they own a bare Color). */
  function setColorOf(target, c) {
    if (c && c.isColor) target.copy(c);
    else target.set(c === undefined || c === null ? 0xffd9a0 : c);
  }

  function handleFor(rec) {
    return {
      get position() { return rec.position; },
      get color() { return rec.color; },
      setIntensity(v) { rec.intensity = clamp(v, 0, 40); return this; },
      setRange(v) { rec.range = clamp(v, 1, 400); return this; },
      setFlicker(pattern, opts) { applyFlicker(rec, pattern, opts); return this; },
      setColor(c) { applyRecordColor(rec, c); return this; },
      setEnabled(v) { rec.active = !!v; return this; },
      /** Marks the record dead; the registry compacts itself on the next update. */
      remove() { rec.active = false; rec.dead = true; recordsDirty = true; },
    };
  }

  const REC = {
    position: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    color: new THREE.Color(),
    range: 24,
    angle: Math.PI * 0.28,
    penumbra: 0.45,
    intensity: 1,
    flicker: null,
    gain: 1,
    active: true,
    dead: false,
    useAim: false,
  };

  /**
   * Register a street lamp. Nothing is added to the scene: the lamp is *data*, and the
   * pool decides each frame whether it deserves a real light.
   * @param {THREE.Vector3|number[]} position
   * @param {THREE.Color|number|string} color
   * @param {{range?:number, angle?:number, intensity?:number, aim?:any, penumbra?:number,
   *          flicker?:string|number, speed?:number, phase?:number, enabled?:boolean}} [opts]
   */
  function addStreetlight(position, color, opts = {}) {
    if (records.length >= RECORD_CAPACITY) return null;
    const rec = Object.create(REC);
    rec.position = new THREE.Vector3();
    if (position && position.isVector3) rec.position.copy(position);
    else if (Array.isArray(position)) rec.position.fromArray(position);
    rec.aim = new THREE.Vector3();
    rec.useAim = false;
    if (opts.aim) {
      rec.useAim = true;
      if (opts.aim.isVector3) rec.aim.copy(opts.aim);
      else if (Array.isArray(opts.aim)) rec.aim.fromArray(opts.aim);
    }
    rec.color = new THREE.Color();
    applyRecordColor(rec, color);
    rec.range = clamp(opts.range !== undefined ? opts.range : 24, 1, 400);
    rec.angle = clamp(opts.angle !== undefined ? opts.angle : Math.PI * 0.28, 0.02, Math.PI * 0.49);
    rec.penumbra = clamp(opts.penumbra !== undefined ? opts.penumbra : 0.45, 0, 1);
    rec.intensity = clamp(opts.intensity !== undefined ? opts.intensity : 1, 0, 40);
    rec.flicker = null;
    rec.gain = 1;
    rec.active = opts.enabled !== false;
    rec.dead = false;
    applyFlicker(rec, opts.flicker, opts);
    records.push(rec);
    return handleFor(rec);
  }

  /* ================================================================ neon glows ===== */
  /**
   * Add an additive, camera-facing glow billboard (shop sign, tail light bloom, a lamp's
   * halo). All of them live in one InstancedMesh, so an arbitrary number of signs costs
   * one draw call and one matrix compose each.
   */
  function addNeonGlow(position, color, size = 3, opts = {}) {
    if (glows.length >= GLOW_CAPACITY) return null;
    const rec = {
      position: new THREE.Vector3(),
      color: new THREE.Color(),
      size: clamp(size, 0.05, 200),
      gain: 1,
      flicker: null,
      active: opts.enabled !== false,
      height: 0,
    };
    if (position && position.isVector3) rec.position.copy(position);
    else if (Array.isArray(position)) rec.position.fromArray(position);
    setColorOf(rec.color, color);
    applyFlicker(rec, opts.flicker, opts);
    glows.push(rec);
    glowMesh.count = glows.length;
    return {
      get position() { return rec.position; },
      setSize(s) { rec.size = clamp(s, 0.05, 200); return this; },
      setColor(c) { setColorOf(rec.color, c); return this; },
      setFlicker(p, o) { applyFlicker(rec, p, o); return this; },
      setEnabled(v) { rec.active = !!v; return this; },
      remove() { rec.active = false; }
    };
  }

  /* ================================================================ hour / night === */
  function setTimeOfDay(h) {
    if (Number.isFinite(h)) {
      tod = ((h % 24) + 24) % 24;
      nightExplicit = false;
      nightTarget = 0;
    }
  }

  /** Force the rig to night (or release it back to the clock). Cross-fades smoothly. */
  function setNight(night) {
    nightExplicit = true;
    nightTarget = night ? 1 : 0;
  }

  function setQuality(q) {
    const n = QUALITY_SPOTS[q];
    if (n) activePool = clamp(n, 1, poolSize);
  }

  /* ================================================================ per-frame ====== */
  function resolveRamp(dt) {
    // `nightBlend` is a smoothed blend between "the clock" and "forced midnight".
    nightBlend += (nightTarget - nightBlend) * clamp(dt * 3.0, 0, 1);
    sampleRamp(tod, _rampA);
    sampleRamp(nightHour, _rampB);
    return blendRamp(_rampA, _rampB, clamp(nightBlend, 0, 1), _rampMix);
  }

  function updateDirectionals(ramp, ctx) {
    // Direction from the clock, or from the caller when they ask us to follow their sun.
    if (followSun && ctx && ctx.sunDirection && ctx.sunDirection.isVector3) {
      _sunDir.copy(ctx.sunDirection).normalize();
    } else {
      computeSunDirection(tod + nightBlend * (nightHour - tod));
    }
    sunElevation = _sunDir.y;

    sun.color.copy(ramp.sun);
    sun.intensity = ramp.sunI * (ctx && ctx.sunScale !== undefined ? ctx.sunScale : 1);
    sun.position.copy(_sunDir).multiplyScalar(220);

    moon.color.copy(ramp.moon);
    moon.intensity = ramp.moonI;
    moon.position.copy(_sunDir).multiplyScalar(-220);

    hemi.color.copy(ramp.sky);
    hemi.groundColor.copy(ramp.ground);
    hemi.intensity = ramp.hemiI;

    ambient.color.copy(ramp.amb);
    ambient.intensity = ramp.ambI;

    cityGlow.color.copy(ramp.city);
    cityGlow.intensity = ramp.cityI;
    cityGlow.position.set(6, -100, -8);

    fogColorOut.copy(ramp.fog);
    // Neon is unreadable in daylight and glorious at night; also let the weather dim it.
    const day = clamp(ramp.sunI / 2.65, 0, 1);
    neonGain = (0.22 + 0.78 * (1 - day)) * (ctx && ctx.neonScale !== undefined ? ctx.neonScale : 1);
  }

  /** Compact the registry in place (no allocation) when handles were removed. */
  function compactRecords() {
    let w = 0;
    for (let i = 0; i < records.length; i++) {
      if (records[i].dead) continue;
      records[w++] = records[i];
    }
    records.length = w;
    recordsDirty = false;
  }

  /**
   * Nearest-N selection + pool assignment.
   * Bounded insertion sort into two preallocated arrays: O(records × N), no sort, no GC.
   */
  function updateSpotPool(focus) {
    const n = activePool;
    let count = 0;

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec.active) continue;
      const dx = rec.position.x - focus.x;
      const dy = rec.position.y - focus.y;
      const dz = rec.position.z - focus.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const range2 = rec.range * rec.range;
      if (d2 > range2) continue;                    // outside the lamp's own reach
      let slot;
      if (count < n) {
        slot = count++;
      } else if (d2 >= selDist[n - 1]) {
        continue;                                   // not near enough to make the cut
      } else {
        slot = n - 1;
      }
      while (slot > 0 && selDist[slot - 1] > d2) {
        selDist[slot] = selDist[slot - 1];
        selRec[slot] = selRec[slot - 1];
        slot--;
      }
      selDist[slot] = d2;
      selRec[slot] = rec;
    }

    const cutoff = count > 0 ? Math.sqrt(selDist[count - 1]) : 0;
    const fadeStart = cutoff * 0.78;
    const fadeEnd = cutoff * 1.0;

    selSet.clear();
    for (let i = 0; i < count; i++) selSet.add(selRec[i]);

    // 1. release slots whose lamp fell out of the selection
    ownedSet.clear();
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      if (slot.rec === null) continue;
      if (!selSet.has(slot.rec)) slot.rec = null;
      else ownedSet.add(slot.rec);
    }

    // 2. assign newcomers, walking the ring so no single slot is hammered
    for (let i = 0; i < count; i++) {
      const rec = selRec[i];
      if (ownedSet.has(rec)) continue;
      for (let k = 0; k < pool.length; k++) {
        const slot = pool[rrCursor];
        rrCursor = (rrCursor + 1) % pool.length;
        if (slot.rec === null) {
          slot.rec = rec;
          ownedSet.add(rec);
          break;
        }
      }
    }

    // 3. push parameters into the real lights
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      const light = slot.light;
      if (slot.rec === null) {
        light.visible = false;
        continue;
      }
      const rec = slot.rec;
      const ox = rec.position.x - focus.x;
      const oy = rec.position.y - focus.y;
      const oz = rec.position.z - focus.z;
      const dist = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const fade = 1 - smoothstep(fadeStart, fadeEnd, dist);
      const gain = rec.flicker ? flickerGain(rec.flicker.id, elapsed, rec.flicker.speed, rec.flicker.phase) : 1;
      rec.gain = gain;

      light.visible = true;
      light.position.copy(rec.position);
      if (rec.useAim) light.target.position.copy(rec.aim);
      else light.target.position.set(rec.position.x, rec.position.y - rec.range, rec.position.z);
      light.color.copy(rec.color);
      light.distance = rec.range;
      light.angle = rec.angle;
      light.penumbra = rec.penumbra;
      light.intensity = rec.intensity * SPOT_CANDELA * gain * fade * (0.35 + 0.65 * neonGain);
      light.target.updateMatrixWorld();
    }
  }

  function updateGlows(camera) {
    const mesh = glowMesh;
    const count = glows.length;
    mesh.count = count;
    if (count === 0) return;

    if (camera) {
      camera.updateWorldMatrix(true, false);
      _camQuat.setFromRotationMatrix(_mat4.copy(camera.matrixWorld));
      _camPos.setFromMatrixPosition(camera.matrixWorld);
    } else {
      _camQuat.identity();
      _camPos.set(0, 0, 0);
    }
    const cullNear = 180 * 180;
    const cullFar = 320 * 320;

    for (let i = 0; i < count; i++) {
      const rec = glows[i];
      if (!rec.active) {
        _scale.set(0, 0, 0);
        _mat4.compose(rec.position, _camQuat, _scale);
        mesh.setMatrixAt(i, _mat4);
        continue;
      }
      const dx = rec.position.x - _camPos.x;
      const dy = rec.position.y - _camPos.y;
      const dz = rec.position.z - _camPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > cullFar) {
        _scale.set(0, 0, 0);
        _mat4.compose(rec.position, _camQuat, _scale);
        mesh.setMatrixAt(i, _mat4);
        continue;
      }
      const dist = Math.sqrt(d2);
      const distFade = 1 - smoothstep(Math.sqrt(cullNear), Math.sqrt(cullFar), dist);
      const gain = rec.flicker ? flickerGain(rec.flicker.id, elapsed, rec.flicker.speed, rec.flicker.phase) : 1;
      rec.gain = gain;
      const g = gain * distFade * neonGain;
      const s = rec.size * (0.85 + 0.15 * gain);
      _scale.set(s, s, 1);
      _mat4.compose(rec.position, _camQuat, _scale);
      mesh.setMatrixAt(i, _mat4);
      _color.copy(rec.color).multiplyScalar(clamp(g, 0, 4));
      mesh.setColorAt(i, _color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Per-frame entry point. `ctx` follows the gfx contract; only `camera` / `isNight` /
   * `settings` are consumed here, and every one of them is optional.
   */
  function update(dt, ctx) {
    const step = clamp(Number.isFinite(dt) ? dt : 0.016, 0, 0.1);
    elapsed += step;

    if (recordsDirty) compactRecords();

    const settings = (ctx && ctx.settings) || null;
    const lightingOn = !settings || settings.lighting !== false;

    // Forced-night follows the engine's clock unless the caller pinned it by hand.
    if (!nightExplicit && ctx && ctx.isNight !== undefined) nightTarget = ctx.isNight ? 1 : 0;

    const ramp = resolveRamp(step);
    updateDirectionals(ramp, ctx);

    if (!lightingOn) {
      for (let i = 0; i < pool.length; i++) pool[i].light.visible = false;
      glowMesh.visible = false;
      return;
    }
    glowMesh.visible = true;

    const camera = ctx && ctx.camera ? ctx.camera : null;
    if (ctx && ctx.focus && ctx.focus.isVector3) _focus.copy(ctx.focus);
    else if (camera) {
      camera.updateWorldMatrix(true, false);
      _focus.setFromMatrixPosition(camera.matrixWorld);
    } else _focus.set(0, 0, 0);

    updateSpotPool(_focus);
    updateGlows(camera);
  }

  /** Reset registrations (keeps pooled lights/textures alive for reuse). */
  function clear() {
    records.length = 0;
    glows.length = 0;
    glowMesh.count = 0;
    for (let i = 0; i < pool.length; i++) {
      pool[i].rec = null;
      pool[i].light.visible = false;
    }
    selSet.clear();
    ownedSet.clear();
    rrCursor = 0;
  }

  function dispose() {
    clear();
    glowGeometry.dispose();
    glowMaterial.dispose();
    if (glowTexture) glowTexture.dispose();
    for (let i = 0; i < cookies.length; i++) cookies[i].dispose();
    for (let i = 0; i < pool.length; i++) {
      pool[i].light.dispose();
      pool[i].light.map = null;
    }
    if (scene) scene.remove(group);
    group.clear();
  }

  /* ---------------------------------------------------------------- defaults ------- */
  // Nothing is auto-registered: the props/city modules own the content and call
  // `addStreetlight()` / `addNeonGlow()` as they spawn geometry. The rig ships an empty
  // registry so a scene without props is simply lit by the global rig.

  return {
    group,
    update,
    addStreetlight,
    addNeonGlow,
    setTimeOfDay,
    setNight,
    setQuality,
    clear,
    dispose,
    sun,
    moon,
    hemi,
    ambient,
    cityGlow,
    glow: glowMesh,
    fogColor: fogColorOut,
    getSunDirection(out) { return (out || _toTarget).copy(_sunDir); },
    getMoonDirection(out) { return (out || _toTarget).copy(_sunDir).multiplyScalar(-1); },
    getLightingState() {
      return {
        hour: tod + nightBlend * (nightHour - tod),
        night: nightBlend > 0.5,
        neonGain,
        sunElevation,
        fogColor: fogColorOut,
        activeLights: pool.reduce((n, s) => n + (s.light.visible ? 1 : 0), 0),
      };
    },
  };
}
