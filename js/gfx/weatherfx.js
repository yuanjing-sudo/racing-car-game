import * as THREE from 'three';

/**
 * weatherfx.js — the *effects* half of the weather (the WeatherSystem owns the
 * sky dome, fog colour and the falling rain/snow).
 *
 * Adds:
 *   • **Splash ripples** — instanced-free dynamic quads that bloom and fade where
 *     rain hits the tarmac around the camera. Cheapest convincing wet-road cue
 *     there is, and it is entirely CPU-written into one buffer.
 *   • **Wind streaks** — additive slivers that stream along the wind vector,
 *     brightening with wind speed, so a storm reads as *moving air*.
 *   • **Lightning** — a procedural jagged bolt plus a strobe light, fired on a
 *     stochastic schedule during a storm, with an after-glow that fades out.
 *   • **Speed spray** — a fine translucent veil kicked up when the car is quick,
 *     sold as a single camera-locked quad ribbon.
 *
 * No allocations per frame: every pool is preallocated and written in place.
 */

/* ------------------------------------------------------------------ textures ---- */

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rippleTexture() {
  const s = 64;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(255,255,255,${0.5 - i * 0.14})`;
    ctx.lineWidth = 2.6 - i * 0.6;
    ctx.arc(s / 2, s / 2, 8 + i * 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function streakTexture() {
  const w = 8, h = 64;
  const c = makeCanvas(w, h);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function veilTexture() {
  const s = 128;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const rnd = (() => { let x = 5; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 260; i++) {
    const r = 2 + rnd() * 9;
    ctx.fillStyle = `rgba(220,228,240,${0.05 + rnd() * 0.16})`;
    ctx.beginPath();
    ctx.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/* --------------------------------------------------------- dynamic quad pool ---- */

/**
 * A preallocated, CPU-written quad pool: N quads, each with a position, scale,
 * rotation and alpha, all packed into one BufferGeometry. `write(i, ...)` stamps
 * quad `i`; `commit()` uploads. Used for ripples and wind streaks.
 */
class QuadPool {
  constructor(count, material, { axis = 'y' } = {}) {
    this.count = count;
    this.axis = axis;
    this.alive = new Uint8Array(count);
    this.pos = new Float32Array(count * 3);
    this.size = new Float32Array(count * 2);
    this.rot = new Float32Array(count);
    this.alpha = new Float32Array(count);

    const positions = new Float32Array(count * 4 * 3);
    const uvs = new Float32Array(count * 4 * 2);
    const alphas = new Float32Array(count * 4);
    const indices = new Uint32Array(count * 6);
    for (let q = 0; q < count; q++) {
      const v = q * 4;
      uvs[v * 2] = 0; uvs[v * 2 + 1] = 0;
      uvs[(v + 1) * 2] = 1; uvs[(v + 1) * 2 + 1] = 0;
      uvs[(v + 2) * 2] = 1; uvs[(v + 2) * 2 + 1] = 1;
      uvs[(v + 3) * 2] = 0; uvs[(v + 3) * 2 + 1] = 1;
      const i = q * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
    }
    this.positions = positions;
    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  /** Spawn at slot `i`. */
  set(i, x, y, z, sx, sz, rot, alpha) {
    this.alive[i] = 1;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.size[i * 2] = sx; this.size[i * 2 + 1] = sz;
    this.rot[i] = rot;
    this.alpha[i] = alpha;
  }

  clear(i) { this.alive[i] = 0; this.alpha[i] = 0; }

  /** Rebuild every live quad's vertices and upload. */
  commit() {
    const P = this.positions;
    const A = this.alphaAttr.array;
    let live = 0;
    const flat = this.axis === 'y';
    for (let i = 0; i < this.count; i++) {
      const v = i * 4;
      if (!this.alive[i] || this.alpha[i] <= 0.002) {
        for (let k = 0; k < 4; k++) A[(v + k)] = 0;
        continue;
      }
      live = i + 1;
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const sx = this.size[i * 2] * 0.5, sz = this.size[i * 2 + 1] * 0.5;
      const c = Math.cos(this.rot[i]), s = Math.sin(this.rot[i]);
      const a = this.alpha[i];
      for (let k = 0; k < 4; k++) {
        const ux = (k === 0 || k === 3) ? -sx : sx;
        const uz = (k < 2) ? -sz : sz;
        let ox, oy, oz;
        if (flat) {
          ox = ux * c - uz * s;
          oy = 0;
          oz = ux * s + uz * c;
        } else {
          // billboard-ish: keep in the XZ plane but tilt along Y for streaks
          ox = ux * c;
          oy = uz;
          oz = ux * s;
        }
        P[(v + k) * 3] = x + ox;
        P[(v + k) * 3 + 1] = y + oy;
        P[(v + k) * 3 + 2] = z + oz;
        A[v + k] = a;
      }
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, live * 6);
  }

  dispose() {
    this.geometry.dispose();
    this.material && this.material.dispose();
  }
}

const QUAD_VERTEX = /* glsl */`
  attribute float aAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const QUAD_FRAGMENT = /* glsl */`
  uniform sampler2D tMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 c = texture2D( tMap, vUv );
    float a = c.a * vAlpha * uOpacity;
    if ( a < 0.003 ) discard;
    gl_FragColor = vec4( uColor * c.rgb, a );
  }
`;

/* ============================================================ weather effects === */

/**
 * @param {{ renderer?:THREE.WebGLRenderer, scene?:THREE.Scene, camera?:THREE.Camera, quality?:string }} opts
 */
export function createWeatherFx(opts = {}) {
  const scene = opts.scene || null;
  const quality = opts.quality || 'high';
  const rippleCount = quality === 'low' ? 90 : quality === 'medium' ? 180 : 320;
  const streakCount = quality === 'low' ? 60 : quality === 'medium' ? 140 : 240;

  const group = new THREE.Group();
  group.name = 'WeatherFX';
  const disposables = [];

  /* ------------------------------------------------------------- ripples --- */

  const rippleMat = new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: rippleTexture() },
      uColor: { value: new THREE.Color(0xcfe0f5) },
      uOpacity: { value: 0.55 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: QUAD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ripples = new QuadPool(rippleCount, rippleMat, { axis: 'y' });
  ripples.mesh.name = 'RainRipples';
  ripples.mesh.renderOrder = 3;
  group.add(ripples.mesh);
  disposables.push(rippleMat, ripples);

  /* --------------------------------------------------------------- streaks --- */

  const streakMat = new THREE.ShaderMaterial({
    uniforms: {
      tMap: { value: streakTexture() },
      uColor: { value: new THREE.Color(0xdfe9f7) },
      uOpacity: { value: 0.5 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: QUAD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const streaks = new QuadPool(streakCount, streakMat, { axis: 'x' });
  streaks.mesh.name = 'WindStreaks';
  streaks.mesh.renderOrder = 3;
  group.add(streaks.mesh);
  disposables.push(streakMat, streaks);

  /* ----------------------------------------------------------------- veil --- */

  const veilMat = new THREE.MeshBasicMaterial({
    map: veilTexture(),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), veilMat);
  veil.name = 'SpeedSpray';
  veil.frustumCulled = false;
  veil.renderOrder = 4;
  veil.visible = false;
  group.add(veil);
  disposables.push(veilMat, veil.geometry);

  /* ------------------------------------------------------------- lightning --- */

  const boltMaterial = new THREE.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.0 });
  const BOLT_POINTS = 24;
  const boltGeometry = new THREE.BufferGeometry();
  boltGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const bolt = new THREE.Line(boltGeometry, boltMaterial);
  bolt.name = 'LightningBolt';
  bolt.frustumCulled = false;
  bolt.visible = false;
  group.add(bolt);
  disposables.push(boltMaterial, boltGeometry);

  const flashLight = new THREE.PointLight(0xcfe0ff, 0, 600, 1.4);
  flashLight.name = 'LightningFlash';
  group.add(flashLight);

  /* --------------------------------------------------------------- state --- */

  const state = {
    weather: 'clear',
    wetness: 0,
    wind: 0.4,
    windDirection: 0.6,
    intensity: 1,
    speed01: 0,
    storminess: 0,
  };
  const rng = (() => { let s = 9182; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  // ripple life
  const rippleLife = new Float32Array(rippleCount);
  const rippleMax = new Float32Array(rippleCount);
  const rippleSize = new Float32Array(rippleCount);

  // streak life
  const streakLife = new Float32Array(streakCount);
  const streakMax = new Float32Array(streakCount);

  // lightning schedule
  let boltTimer = 6;
  let boltAlpha = 0;
  let flashAlpha = 0;

  const _camPos = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _wp = new THREE.Vector3();

  function setWeather(name) {
    state.weather = name || 'clear';
    state.storminess = name === 'storm' ? 1 : name === 'rain' ? 0.55 : name === 'snow' ? 0.2 : 0;
  }

  function setParams(p = {}) {
    if (p.wind != null) state.wind = p.wind;
    if (p.windDirection != null) state.windDirection = p.windDirection;
    if (p.intensity != null) state.intensity = p.intensity;
  }

  /* ---------------------------------------------------------------- update --- */

  function update(dt, ctx = {}) {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    if (ctx.weather) setWeather(ctx.weather);
    if (ctx.wetness != null) state.wetness = ctx.wetness;
    if (ctx.speed01 != null) state.speed01 = ctx.speed01;
    if (ctx.wind != null) state.wind = ctx.wind;
    if (ctx.windDirection != null) state.windDirection = ctx.windDirection;

    const camera = ctx.camera || opts.camera;
    if (camera) {
      camera.getWorldPosition(_camPos);
      camera.matrixWorld.extractBasis(_right, _up, _fwd);
      _fwd.negate();
    }

    const raining = state.wetness > 0.25 || state.weather === 'rain' || state.weather === 'storm';
    const groundY = ctx.groundY != null ? ctx.groundY : 0;

    /* ---- ripples ---- */
    ripples.mesh.visible = raining;
    if (raining) {
      // spawn
      const spawnRate = (18 + state.storminess * 60) * state.intensity * step;
      let spawn = spawnRate;
      for (let i = 0; i < rippleCount && spawn > 0; i++) {
        if (rippleLife[i] > 0) continue;
        if (spawn < 1 && rng() > spawn) { spawn = 0; break; }
        spawn -= 1;
        const ang = rng() * Math.PI * 2;
        const dist = 3 + rng() * 26;
        const x = _camPos.x + Math.cos(ang) * dist;
        const z = _camPos.z + Math.sin(ang) * dist;
        const y = groundY + 0.03 + (ctx.groundAt ? ctx.groundAt(x, z) : 0);
        rippleMax[i] = 0.45 + rng() * 0.5;
        rippleLife[i] = rippleMax[i];
        rippleSize[i] = 0.5 + rng() * 0.9;
        ripples.set(i, x, y, z, rippleSize[i], rippleSize[i], rng() * 6.28, 0.9);
      }
      // advance
      for (let i = 0; i < rippleCount; i++) {
        if (rippleLife[i] <= 0) { if (ripples.alive[i]) ripples.clear(i); continue; }
        rippleLife[i] -= step;
        const t = 1 - Math.max(0, rippleLife[i]) / rippleMax[i];
        const grow = rippleSize[i] * (1 + t * 2.6);
        ripples.alive[i] = 1;
        ripples.size[i * 2] = grow;
        ripples.size[i * 2 + 1] = grow;
        ripples.alpha[i] = (1 - t) * (1 - t) * 0.9;
      }
    }
    ripples.commit();

    /* ---- wind streaks ---- */
    const streakTarget = (state.wind * 0.6 + state.speed01 * 0.8) * (raining ? 1.3 : 0.5);
    streaks.mesh.visible = streakTarget > 0.12 && state.intensity > 0.2;
    if (streaks.mesh.visible) {
      const dirX = Math.cos(state.windDirection);
      const dirZ = Math.sin(state.windDirection);
      const spawnRate = (20 + state.wind * 90) * streakTarget * step;
      let spawn = spawnRate;
      for (let i = 0; i < streakCount && spawn > 0; i++) {
        if (streakLife[i] > 0) continue;
        if (spawn < 1 && rng() > spawn) { spawn = 0; break; }
        spawn -= 1;
        const back = 12 + rng() * 30;
        const side = (rng() - 0.5) * 28;
        const h = 1 + rng() * 16;
        const x = _camPos.x - dirX * back - dirZ * side;
        const z = _camPos.z - dirZ * back + dirX * side;
        streakMax[i] = 0.5 + rng() * 0.6;
        streakLife[i] = streakMax[i];
        const len = 2.5 + state.wind * 5 + state.speed01 * 4;
        streaks.set(i, x, h, z, len, 0.35 + rng() * 0.35, Math.atan2(dirZ, dirX), 0.55 * streakTarget);
      }
      for (let i = 0; i < streakCount; i++) {
        if (streakLife[i] <= 0) { if (streaks.alive[i]) streaks.clear(i); continue; }
        streakLife[i] -= step;
        const t = 1 - Math.max(0, streakLife[i]) / streakMax[i];
        // drift with the wind
        streaks.pos[i * 3] += Math.cos(state.windDirection) * state.wind * 16 * step;
        streaks.pos[i * 3 + 2] += Math.sin(state.windDirection) * state.wind * 16 * step;
        streaks.alpha[i] = (1 - t) * 0.55 * streakTarget;
      }
    }
    streaks.commit();

    /* ---- speed spray veil ---- */
    const veilTarget = (state.speed01 > 0.35 && raining ? (state.speed01 - 0.35) * 0.5 : 0) * state.intensity;
    veilMat.opacity += (veilTarget - veilMat.opacity) * Math.min(1, step * 4);
    veil.visible = veilMat.opacity > 0.01;
    if (veil.visible && camera) {
      veil.position.copy(_camPos).addScaledVector(_fwd, 3.2);
      veil.quaternion.copy(camera.quaternion);
      veil.scale.set(26, 16, 1);
      veil.rotateZ(state.speed01 * 0.2);
    }

    /* ---- lightning ---- */
    const stormFactor = state.storminess * state.intensity;
    if (stormFactor > 0.3) {
      boltTimer -= step;
      if (boltTimer <= 0) {
        boltTimer = 4 + rng() * 14;
        flashAlpha = 0.9 + rng() * 0.4;
        // build a jagged bolt from the sky to a random ground point
        const pa = boltGeometry.attributes.position.array;
        const ox = _camPos.x + (rng() - 0.5) * 160;
        const oz = _camPos.z + (rng() - 0.5) * 160;
        let y = 220 + rng() * 80;
        for (let i = 0; i < BOLT_POINTS; i++) {
          const t = i / (BOLT_POINTS - 1);
          const yy = y * (1 - t);
          const jitter = (1 - t) * 34;
          pa[i * 3] = ox + (rng() - 0.5) * jitter;
          pa[i * 3 + 1] = yy;
          pa[i * 3 + 2] = oz + (rng() - 0.5) * jitter;
        }
        boltGeometry.attributes.position.needsUpdate = true;
        bolt.visible = true;
        flashLight.position.set(ox, 120, oz);
      }
    }

    if (flashAlpha > 0) {
      flashAlpha = Math.max(0, flashAlpha - step * 3.4);
      // double-strobe like real lightning
      const strobe = flashAlpha * (0.6 + 0.4 * Math.sin(flashAlpha * 34));
      boltMaterial.opacity = Math.min(1, strobe * 1.4);
      flashLight.intensity = strobe * 900;
      bolt.visible = boltMaterial.opacity > 0.02;
    } else if (bolt.visible) {
      bolt.visible = false;
      boltMaterial.opacity = 0;
      flashLight.intensity = 0;
    }

    if (rippleMat.uniforms.uOpacity) rippleMat.uniforms.uOpacity.value = 0.4 + state.wetness * 0.3;
    if (streakMat.uniforms.uOpacity) streakMat.uniforms.uOpacity.value = 0.35 + state.wind * 0.3;
  }

  function dispose() {
    for (const d of disposables) { if (d && d.dispose) d.dispose(); }
    disposables.length = 0;
    if (group.parent) group.parent.remove(group);
    group.clear();
  }

  return {
    group,
    setWeather,
    setParams,
    update,
    dispose,
    state,
    get flash() { return flashAlpha; },
  };
}

export default { createWeatherFx };
