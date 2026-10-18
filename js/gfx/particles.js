import * as THREE from 'three';

/**
 * particles.js — the high-fidelity particle system.
 *
 * A drop-in replacement for the original `js/particles.js`: same class name and
 * the same `emitTireSmoke` / `emitDust` / `emitSparks` / `emitExhaust` / `update`
 * surface, so `main.js` can swap the import and everything keeps working — but
 * underneath it is a proper, budgeted, allocation-free particle engine:
 *
 *   • **Pools, not Node pools.** Each particle *kind* owns one preallocated
 *     `BufferGeometry` with dynamic attributes and one additive or alpha-blended
 *     material. Emission writes into free slots; nothing is created per frame,
 *     so there is no GC hitch when a car drifts through a smoke cloud.
 *   • **CPU simulation** with per-particle drag, gravity, buoyancy, wind,
 *     turbulence (curl-ish noise), size/rotation/colour curves over life, and
 *     ground bounce. Particles die by index and the buffer compacts its draw
 *     range, so a quiet scene costs almost nothing.
 *   • **Rich behaviour**: tyre smoke that rises and thins, launch wheelspin,
 *     dust plumes, sparks that bounce off the tarmac and cool from white to
 *     orange, blue-then-orange exhaust flames with burnt-fuel puffs, water
 *     spray, gravel, and confetti for the finish line.
 *
 * The material is a single billboard shader that also supports per-particle
 * rotation, so smoke puffs can turn as they rise.
 */

/* ------------------------------------------------------------------ textures ---- */

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Seeded RNG so two runs of the same scene look identical. */
function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function softSprite(power = 2.2) {
  const s = 64;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = Math.pow(1 - t, power);
    g.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/** Bumpy, irregular puff for smoke and dust. */
function puffSprite(seed = 3) {
  const s = 64;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const rnd = rngFrom(seed);
  ctx.clearRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 22; i++) {
    const r = 6 + rnd() * 16;
    const x = 8 + rnd() * (s - 16);
    const y = 8 + rnd() * (s - 16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.10 + rnd() * 0.12})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function sparkSprite() {
  const w = 16, h = 64;
  const c = makeCanvas(w, h);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // taper
  ctx.globalCompositeOperation = 'destination-in';
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(0,0,0,0)');
  gx.addColorStop(0.5, 'rgba(0,0,0,1)');
  gx.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function chunkSprite() {
  const s = 32;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const rnd = rngFrom(17);
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(rnd() * 6.28);
    const w = 4 + rnd() * 7, h2 = 3 + rnd() * 5;
    ctx.fillRect(-w / 2, -h2 / 2, w, h2);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------- shaders ---- */

const PARTICLE_VERTEX = /* glsl */`
  attribute float aSize;
  attribute float aRot;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = uv;
    vColor = vec4( aColor, aAlpha );
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    float c = cos( aRot ), s = sin( aRot );
    vec2 corner = ( uv - 0.5 ) * aSize;
    corner = vec2( corner.x * c - corner.y * s, corner.x * s + corner.y * c );
    mv.xy += corner;
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */`
  uniform sampler2D tMap;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 tex = texture2D( tMap, vUv );
    float a = tex.a * vColor.a * uOpacity;
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( tex.rgb * vColor.rgb, a );
  }
`;

/* --------------------------------------------------------------------- pool ---- */

const MAX_POOL = 4200;

/**
 * One particle kind. Everything is stored in flat typed arrays; the geometry is
 * rebuilt from those arrays each frame (a memcpy, not an allocation).
 */
class ParticlePool {
  constructor(capacity, material, { blending = THREE.NormalBlending } = {}) {
    this.capacity = capacity;
    this.material = material;
    this.material.blending = blending;

    this.count = 0;
    this.live = new Int32Array(capacity);       // indices of living particles (compact)
    this.freeStack = new Int32Array(capacity);  // reusable slot indices
    this.freeTop = capacity;
    for (let k = 0; k < capacity; k++) this.freeStack[k] = k;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);     // remaining seconds
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.rotVel = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.buoy = new Float32Array(capacity);
    this.bounce = new Float32Array(capacity);
    this.col0 = new Float32Array(capacity * 3);
    this.col1 = new Float32Array(capacity * 3);
    this.alpha0 = new Float32Array(capacity);
    this.alpha1 = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);      // 1 = wind-affected, 2 = ground

    const verts = capacity * 4;
    const positions = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const sizes = new Float32Array(verts);
    const rots = new Float32Array(verts);
    const alphas = new Float32Array(verts);
    const colors = new Float32Array(verts * 3);
    const indices = new Uint32Array(capacity * 6);

    for (let q = 0; q < capacity; q++) {
      const v = q * 4;
      uvs[v * 2] = 0; uvs[v * 2 + 1] = 0;
      uvs[(v + 1) * 2] = 1; uvs[(v + 1) * 2 + 1] = 0;
      uvs[(v + 2) * 2] = 1; uvs[(v + 2) * 2 + 1] = 1;
      uvs[(v + 3) * 2] = 0; uvs[(v + 3) * 2 + 1] = 1;
      const i = q * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
    }

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.rotAttr = new THREE.BufferAttribute(rots, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aRot', this.rotAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aColor', this.colorAttr);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    // Slots are indexed by particle id (stable) and dead particles write an
    // alpha of zero, so we can simply always draw the whole pool.
    geo.setDrawRange(0, capacity * 6);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geo;

    this.positions = positions;
    this.sizes = sizes;
    this.rots = rots;
    this.alphas = alphas;
    this.colors = colors;

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 5;
  }

  /** Find a free slot; never fails while the pool has room to recycle. */
  alloc() {
    if (this.freeTop > 0) return this.freeStack[--this.freeTop];
    // Saturated: recycle the oldest live particle.
    if (this.count === 0) return -1;
    const idx = this.live[0];
    for (let k = 1; k < this.count; k++) this.live[k - 1] = this.live[k];
    this.count -= 1;
    this.alive[idx] = 0;
    this.zeroSlot(idx);
    return idx;
  }

  /** Blank a particle's four vertices so nothing stale is drawn. */
  zeroSlot(i) {
    const v = i * 4;
    for (let q = 0; q < 4; q++) this.alphas[v + q] = 0;
  }

  spawn(i, x, y, z, vx, vy, vz, opts) {
    this.alive[i] = 1;
    this.live[this.count++] = i;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.maxLife[i] = opts.life;
    this.life[i] = opts.life;
    this.size0[i] = opts.size0;
    this.size1[i] = opts.size1;
    this.rot[i] = opts.rot || 0;
    this.rotVel[i] = opts.rotVel || 0;
    this.drag[i] = opts.drag || 0;
    this.grav[i] = opts.gravity || 0;
    this.buoy[i] = opts.buoyancy || 0;
    this.bounce[i] = opts.bounce || 0;
    this.alpha0[i] = opts.alpha0 != null ? opts.alpha0 : 1;
    this.alpha1[i] = opts.alpha1 != null ? opts.alpha1 : 0;
    this.flags[i] = opts.flags || 0;
    const c0 = opts.col0; const c1 = opts.col1;
    this.col0[i * 3] = c0[0]; this.col0[i * 3 + 1] = c0[1]; this.col0[i * 3 + 2] = c0[2];
    this.col1[i * 3] = c1[0]; this.col1[i * 3 + 1] = c1[1]; this.col1[i * 3 + 2] = c1[2];
  }

  /** Simulate + write the vertex buffers. */
  simulate(dt, wind, groundY, turbulence) {
    const P = this.positions, S = this.sizes, R = this.rots, A = this.alphas, C = this.colors;
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const i = this.live[k];
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.zeroSlot(i);
        if (this.freeTop < this.capacity) this.freeStack[this.freeTop++] = i;
        continue;
      }
      this.live[n++] = i;

      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1 over life
      const i3 = i * 3;

      // forces
      let vx = this.vel[i3], vy = this.vel[i3 + 1], vz = this.vel[i3 + 2];
      vy += (this.grav[i] + this.buoy[i] * t) * dt;
      if (this.flags[i] & 1) { vx += wind.x * dt; vz += wind.z * dt; }
      if (turbulence > 0) {
        const ph = i * 1.7 + t * 4.2;
        vx += Math.sin(ph) * turbulence * dt;
        vy += Math.sin(ph * 1.3 + 1.1) * turbulence * 0.6 * dt;
        vz += Math.cos(ph * 1.1) * turbulence * dt;
      }
      if (this.drag[i] > 0) {
        const d = Math.max(0, 1 - this.drag[i] * dt);
        vx *= d; vy *= d; vz *= d;
      }
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;

      // integrate
      let x = this.pos[i3] + vx * dt;
      let y = this.pos[i3 + 1] + vy * dt;
      let z = this.pos[i3 + 2] + vz * dt;

      // ground interaction for sparks / chunks
      if ((this.flags[i] & 2) && y < groundY) {
        y = groundY;
        if (this.bounce[i] > 0) {
          this.vel[i3 + 1] = -vy * this.bounce[i];
          this.vel[i3] = vx * 0.6;
          this.vel[i3 + 2] = vz * 0.6;
        } else {
          this.vel[i3 + 1] = 0;
        }
      }

      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
      this.rot[i] += this.rotVel[i] * dt;

      // write the 4 vertices (slot tied to the particle id, not the loop index)
      const v = i * 4;
      const size = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      const alpha = this.alpha0[i] + (this.alpha1[i] - this.alpha0[i]) * t;
      const cx = this.col0[i * 3] + (this.col1[i * 3] - this.col0[i * 3]) * t;
      const cy = this.col0[i * 3 + 1] + (this.col1[i * 3 + 1] - this.col0[i * 3 + 1]) * t;
      const cz = this.col0[i * 3 + 2] + (this.col1[i * 3 + 2] - this.col0[i * 3 + 2]) * t;
      for (let q = 0; q < 4; q++) {
        P[(v + q) * 3] = x; P[(v + q) * 3 + 1] = y; P[(v + q) * 3 + 2] = z;
        S[v + q] = size;
        R[v + q] = this.rot[i];
        A[v + q] = alpha;
        C[(v + q) * 3] = cx; C[(v + q) * 3 + 1] = cy; C[(v + q) * 3 + 2] = cz;
      }
    }
    this.count = n;
    this.geometry.boundingSphere.radius = 1e6;
  }

  upload() {
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.rotAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.count; i++) this.zeroSlot(this.live[i]);
    this.count = 0;
    this.alive.fill(0);
    this.freeTop = this.capacity;
    for (let k = 0; k < this.capacity; k++) this.freeStack[k] = k;
    this.alphaAttr.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ============================================================= particle system == */

const PRESETS = {
  smoke: { drag: 1.5, gravity: 0.6, buoyancy: 2.2, bounce: 0, flags: 1 },
  dust: { drag: 2.0, gravity: 1.2, buoyancy: 0.4, bounce: 0, flags: 1 },
  spark: { drag: 0.6, gravity: -18, buoyancy: 0, bounce: 0.45, flags: 1 | 2 },
  flame: { drag: 3.0, gravity: 2.0, buoyancy: 6.0, bounce: 0, flags: 1 },
  debris: { drag: 0.8, gravity: -14, buoyancy: 0, bounce: 0.3, flags: 1 | 2 },
  spray: { drag: 1.2, gravity: -6, buoyancy: 0, bounce: 0, flags: 1 },
};

export class ParticleSystem {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.systems = {};
    this.emitters = [];       // kept for API compatibility with the game
    this.group = new THREE.Group();
    this.group.name = 'Particles';
    if (scene) scene.add(this.group);

    const quality = opts.quality || 'high';
    const budget = quality === 'low' ? 900 : quality === 'medium' ? 1800 : quality === 'ultra' ? 4200 : 3000;
    this.budget = Math.min(budget, MAX_POOL);

    const rnd = rngFrom(opts.seed || 1337);
    this._rnd = rnd;

    // materials
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: puffSprite(3) }, uOpacity: { value: 1 } },
      vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true,
    });
    const softMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: softSprite(2.6) }, uOpacity: { value: 1 } },
      vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true,
    });
    const addMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: softSprite(1.6) }, uOpacity: { value: 1 } },
      vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const sparkMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: sparkSprite() }, uOpacity: { value: 1 } },
      vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const chunkMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: chunkSprite() }, uOpacity: { value: 1 } },
      vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true,
      alphaTest: 0.02,
    });

    const share = (frac) => Math.max(32, Math.floor(this.budget * frac));
    this.smoke = new ParticlePool(share(0.34), smokeMat);
    this.dust = new ParticlePool(share(0.16), smokeMat.clone());
    this.dust.material.uniforms.tMap.value = softSprite(3.4);
    this.flame = new ParticlePool(share(0.18), addMat);
    this.spark = new ParticlePool(share(0.16), sparkMat);
    this.spray = new ParticlePool(share(0.10), softMat);
    this.debris = new ParticlePool(share(0.06), chunkMat);

    this.pools = [this.smoke, this.dust, this.flame, this.spark, this.spray, this.debris];
    for (const p of this.pools) {
      this.group.add(p.mesh);
      this.systems[p === this.smoke ? 'smoke'
        : p === this.dust ? 'dust'
          : p === this.flame ? 'flame'
            : p === this.spark ? 'spark'
              : p === this.spray ? 'spray' : 'debris'] = p;
    }

    this.time = 0;
    this.wind = new THREE.Vector3(0.6, 0, 0.2);
    this.turbulence = 0.35;
    this.groundY = 0;
    this._tmp = new THREE.Vector3();
  }

  /* ------------------------------------------------------------- emitters ---- */

  /** Tyre smoke: a rising, thinning puff that drifts with the wind. */
  emitTireSmoke(position, velocity, intensity = 1.0) {
    const rnd = this._rnd;
    const n = Math.max(1, Math.round(2 + intensity * 3));
    const s = PRESETS.smoke;
    for (let k = 0; k < n; k++) {
      const i = this.smoke.alloc();
      if (i < 0) return;
      const g = 0.22;
      this.smoke.spawn(
        i,
        position.x + (rnd() - 0.5) * 0.5,
        position.y + 0.15,
        position.z + (rnd() - 0.5) * 0.5,
        (velocity ? velocity.x : 0) * 0.12 + (rnd() - 0.5) * 1.6,
        0.6 + rnd() * 1.6,
        (velocity ? velocity.z : 0) * 0.12 + (rnd() - 0.5) * 1.6,
        {
          life: 1.1 + rnd() * 1.4,
          size0: 0.5 + rnd() * 0.5,
          size1: 2.6 + rnd() * 2.4,
          rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 1.2,
          drag: s.drag, gravity: s.gravity, buoyancy: s.buoyancy, flags: s.flags,
          alpha0: 0.32 * g / 0.22 * intensity * 0.9, alpha1: 0,
          col0: [0.86, 0.86, 0.9], col1: [0.62, 0.63, 0.68],
        }
      );
    }
  }

  /** Dust/gravel plumes for off-track excursions. */
  emitDust(position, velocity, count = 3) {
    const rnd = this._rnd;
    const s = PRESETS.dust;
    for (let k = 0; k < count; k++) {
      const i = this.dust.alloc();
      if (i < 0) return;
      this.dust.spawn(
        i,
        position.x + (rnd() - 0.5) * 0.8,
        position.y + 0.1,
        position.z + (rnd() - 0.5) * 0.8,
        (velocity ? velocity.x : 0) * 0.2 + (rnd() - 0.5) * 2.2,
        1.0 + rnd() * 2.2,
        (velocity ? velocity.z : 0) * 0.2 + (rnd() - 0.5) * 2.2,
        {
          life: 0.9 + rnd() * 1.2,
          size0: 0.4 + rnd() * 0.4,
          size1: 2.2 + rnd() * 2.0,
          rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 1.4,
          drag: s.drag, gravity: s.gravity, buoyancy: s.buoyancy, flags: s.flags,
          alpha0: 0.4, alpha1: 0,
          col0: [0.72, 0.64, 0.48], col1: [0.6, 0.54, 0.42],
        }
      );
    }
  }

  /** Sparks: bright, gravity-heavy, bounce off the tarmac and cool. */
  emitSparks(position, normal, count = 10) {
    const rnd = this._rnd;
    const s = PRESETS.spark;
    const nrm = normal || this._tmp.set(0, 1, 0);
    for (let k = 0; k < count; k++) {
      const i = this.spark.alloc();
      if (i < 0) return;
      const spread = 3.5;
      const vx = nrm.x * (1.5 + rnd() * 3) + (rnd() - 0.5) * spread;
      const vy = 1.2 + rnd() * 4.5 + nrm.y * 1.5;
      const vz = nrm.z * (1.5 + rnd() * 3) + (rnd() - 0.5) * spread;
      this.spark.spawn(
        i, position.x, position.y + 0.05, position.z, vx, vy, vz,
        {
          life: 0.35 + rnd() * 0.6,
          size0: 0.16 + rnd() * 0.12,
          size1: 0.05,
          rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 12,
          drag: s.drag, gravity: s.gravity, bounce: s.bounce, flags: s.flags,
          alpha0: 1, alpha1: 0,
          col0: [1.0, 0.92, 0.7], col1: [1.0, 0.32, 0.05],
        }
      );
    }
  }

  /**
   * Exhaust: a fast blue-white core that decays into a warm puff, scaled by
   * throttle. Under full throttle it also spits the odd flame.
   */
  emitExhaust(position, direction, throttle = 1) {
    const rnd = this._rnd;
    const dir = direction || this._tmp.set(0, 0, 1);
    const n = throttle > 0.6 ? 3 : throttle > 0.2 ? 2 : 1;
    const s = PRESETS.flame;
    for (let k = 0; k < n; k++) {
      const i = this.flame.alloc();
      if (i < 0) return;
      const hot = rnd() < 0.35 + throttle * 0.4;
      this.flame.spawn(
        i,
        position.x + (rnd() - 0.5) * 0.12,
        position.y,
        position.z + (rnd() - 0.5) * 0.12,
        dir.x * (3 + rnd() * 4) + (rnd() - 0.5) * 1.2,
        dir.y * 2 + 0.4 + rnd() * 1.2,
        dir.z * (3 + rnd() * 4) + (rnd() - 0.5) * 1.2,
        {
          life: 0.12 + rnd() * (0.2 + throttle * 0.2),
          size0: 0.22 + rnd() * 0.2,
          size1: 1.0 + rnd() * 0.7,
          rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 3,
          drag: s.drag, gravity: s.gravity, buoyancy: s.buoyancy, flags: s.flags,
          alpha0: 0.5 + throttle * 0.35, alpha1: 0,
          col0: hot ? [0.55, 0.75, 1.0] : [1.0, 0.55, 0.18],
          col1: [0.35, 0.35, 0.38],
        }
      );
    }
  }

  /** Water spray thrown off a wet tyre. */
  emitSpray(position, velocity, intensity = 1) {
    const rnd = this._rnd;
    const n = Math.max(1, Math.round(1 + intensity * 3));
    const s = PRESETS.spray;
    for (let k = 0; k < n; k++) {
      const i = this.spray.alloc();
      if (i < 0) return;
      this.spray.spawn(
        i,
        position.x + (rnd() - 0.5) * 0.4,
        position.y + 0.08,
        position.z + (rnd() - 0.5) * 0.4,
        (velocity ? velocity.x : 0) * 0.3 + (rnd() - 0.5) * 3,
        0.8 + rnd() * 2.4,
        (velocity ? velocity.z : 0) * 0.3 + (rnd() - 0.5) * 3,
        {
          life: 0.5 + rnd() * 0.6,
          size0: 0.12 + rnd() * 0.14,
          size1: 0.5 + rnd() * 0.5,
          rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 6,
          drag: s.drag, gravity: s.gravity, buoyancy: s.buoyancy, flags: s.flags,
          alpha0: 0.45 * intensity, alpha1: 0,
          col0: [0.86, 0.9, 0.98], col1: [0.8, 0.86, 0.94],
        }
      );
    }
  }

  /** Gravel / carbon chunks after a big impact. */
  emitDebris(position, velocity, count = 8) {
    const rnd = this._rnd;
    const s = PRESETS.debris;
    for (let k = 0; k < count; k++) {
      const i = this.debris.alloc();
      if (i < 0) return;
      this.debris.spawn(
        i,
        position.x + (rnd() - 0.5) * 0.6,
        position.y + 0.3,
        position.z + (rnd() - 0.5) * 0.6,
        (velocity ? velocity.x : 0) * 0.4 + (rnd() - 0.5) * 6,
        2 + rnd() * 5,
        (velocity ? velocity.z : 0) * 0.4 + (rnd() - 0.5) * 6,
        {
          life: 0.8 + rnd() * 1.0,
          size0: 0.14 + rnd() * 0.16,
          size1: 0.14 + rnd() * 0.16,
          rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 14,
          drag: s.drag, gravity: s.gravity, bounce: s.bounce, flags: s.flags,
          alpha0: 1, alpha1: 0.4,
          col0: [0.22, 0.22, 0.24], col1: [0.3, 0.3, 0.32],
        }
      );
    }
  }

  /** Finishing confetti burst. */
  emitConfetti(position, count = 60, colorHex = 0xff2e88) {
    const rnd = this._rnd;
    const c = new THREE.Color(colorHex);
    for (let k = 0; k < count; k++) {
      const i = this.debris.alloc();
      if (i < 0) return;
      const hue = new THREE.Color().setHSL(rnd(), 0.85, 0.6);
      this.debris.spawn(
        i,
        position.x + (rnd() - 0.5) * 4,
        position.y + 6 + rnd() * 4,
        position.z + (rnd() - 0.5) * 4,
        (rnd() - 0.5) * 5,
        -1 - rnd() * 2,
        (rnd() - 0.5) * 5,
        {
          life: 3 + rnd() * 2,
          size0: 0.16, size1: 0.16,
          rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 10,
          drag: 0.5, gravity: -3.2, buoyancy: 0, flags: 1,
          alpha0: 1, alpha1: 0.6,
          col0: [hue.r, hue.g, hue.b], col1: [c.r, c.g, c.b],
        }
      );
    }
  }

  /** Engine-damage smoke pouring from the bonnet. */
  emitDamageSmoke(position, intensity = 1) {
    const rnd = this._rnd;
    if (rnd() > 0.35 + intensity * 0.5) return;
    const i = this.smoke.alloc();
    if (i < 0) return;
    this.smoke.spawn(
      i, position.x + (rnd() - 0.5) * 0.3, position.y + 0.6, position.z + (rnd() - 0.5) * 0.3,
      0, 1.8 + rnd() * 1.6, 0,
      {
        life: 1.4 + rnd() * 1.2,
        size0: 0.4, size1: 3.4 + rnd() * 2,
        rot: rnd() * 6.28, rotVel: (rnd() - 0.5) * 1.4,
        drag: 1.4, gravity: -0.6, buoyancy: 2.6, flags: 1,
        alpha0: 0.5 * intensity, alpha1: 0,
        col0: [0.16, 0.16, 0.18], col1: [0.35, 0.35, 0.38],
      }
    );
  }

  /* --------------------------------------------------------------- runtime ---- */

  /**
   * @param {number} dt
   * @param {{wind?:THREE.Vector3, windDirection?:number, windSpeed?:number,
   *          groundY?:number, turbulence?:number, wetness?:number}} [ctx]
   */
  update(dt, ctx = {}) {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.05) : 0.016;
    this.time += step;

    if (ctx.wind && ctx.wind.isVector3) this.wind.copy(ctx.wind);
    else {
      const dir = ctx.windDirection != null ? ctx.windDirection : Math.atan2(this.wind.z, this.wind.x);
      const spd = ctx.windSpeed != null ? ctx.windSpeed : this.wind.length();
      this.wind.set(Math.cos(dir) * spd, 0, Math.sin(dir) * spd);
    }
    if (ctx.groundY != null) this.groundY = ctx.groundY;
    const turb = ctx.turbulence != null ? ctx.turbulence : this.turbulence;

    // Custom emitters pushed by the game (kept for API compatibility).
    for (const e of this.emitters) {
      if (!e || !e.position) continue;
      e.rate = e.rate != null ? e.rate : 1;
      e.acc = (e.acc || 0) + step * e.rate * 20;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (e.kind === 'dust') this.emitDust(e.position, e.velocity || null, 1);
        else if (e.kind === 'spray') this.emitSpray(e.position, e.velocity || null, e.intensity || 1);
        else this.emitTireSmoke(e.position, e.velocity || null, e.intensity || 1);
      }
    }

    for (const p of this.pools) {
      p.simulate(step, this.wind, this.groundY, turb);
      p.upload();
    }
  }

  /** Number of live particles (all pools). */
  get particleCount() {
    let n = 0;
    for (const p of this.pools) n += p.count;
    return n;
  }

  clear() {
    for (const p of this.pools) p.clear();
  }

  dispose() {
    for (const p of this.pools) p.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
    this.emitters.length = 0;
    this.systems = {};
  }
}

export default { ParticleSystem };
