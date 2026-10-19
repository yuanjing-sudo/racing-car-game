/**
 * `js/gfx/wilds.js` — per-scene detail for the three remote themes.
 *
 * `skyline.js` dresses the city and `rural.js` the farmland. This is the third
 * and last of the specialised scene layers: the places where there is more
 * landscape than civilisation, and where each theme is defined by what the
 * ground itself does.
 *
 *   alpine   rock faces and scree, snow caps on the rock that stands above the
 *            snowline, stands of conifer, timber chalets with snow on their
 *            roofs, dry-stone walls along the verge, roadside snow poles, and a
 *            cable car whose pylons walk up the hillside with gondolas — which
 *            move, per frame — strung between them.
 *   desert   stratified mesas and buttes, saguaro cacti, scrub, boulders,
 *            wind-rippled sand around the road, and an adobe fuel stop: a long
 *            low building with a canopy over the pumps, a water tower and a
 *            neon sign that registers with the lighting rig's glow pool.
 *            Tumbleweeds roll down the verge, per frame.
 *   coastal  a sand strip that follows the shoreline, boulders, palms, timber
 *            piers out into the water, beach huts and parasols, buoys bobbing
 *            on the swell, and a lighthouse whose beam sweeps round.
 *
 * Everything is procedural and asset-free, like the rest of `js/gfx/`.
 *
 * Terrain
 * -------
 * Seated through `getGradedTerrainHeight(x, z, theme, noise, curve)` — the
 * surface the terrain mesh is built from — using the *track's own seed*, so
 * nothing floats. Pass the unmangled track seed, as `rural.js` does.
 *
 * Placement
 * ---------
 * A lap is a closed loop, so it passes near itself: every large item is tested
 * against the whole centreline, not just its local frame, so a mesa or a pylon
 * cannot end up standing on another part of the circuit.
 *
 * Cost
 * ----
 * Budgets are in `BUDGET`, scaled by `density`. At `high` expect 15-17 draws:
 * alpine is about 54k triangles, desert 28k and coastal 21k. Outcrops, rocks,
 * trees, cacti, scrub, poles, walls, huts, parasols and buoys are one instanced
 * draw each; the buildings are merged into a handful of material buckets.
 *
 * Not verified visually: this is written and checked on a phone with no browser
 * and no GL context. See the repository README.
 *
 * @module js/gfx/wilds
 */

import * as THREE from 'three';
import {
  seededRandom, pick, range, mergeAll, bake, box, cylinder, sphere,
  createRockGeometry, createTreeGeometry,
} from './geometry.js';
import {
  getConcreteMaterial, getDarkMetalMaterial, getMetalMaterial,
  getPaintedMetalMaterial, getWoodMaterial, getGlassMaterial, getNeonMaterial,
  getGlowTexture, TIME_UNIFORM,
} from './materials.js';
import { getGradedTerrainHeight } from '../track.js';
import { createNoise2D } from '../utils.js';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

/* ----------------------------------------------------------------- textures ---- */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function textureFrom(canvas, repeat = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

/** Wind-rippled sand: warm grain crossed by the long ridges a dune carries. */
function sandTexture(random) {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8ae7d';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 6000; i++) {
    const v = 150 + Math.floor(random() * 80);
    ctx.fillStyle = `rgba(${v},${v - 18},${v - 58},0.30)`;
    ctx.fillRect(random() * size, random() * size, 1.4, 1.4);
  }
  // Ripples: a wavy band every few pixels, dark on one flank and light on the
  // other, which is what makes sand read as sand rather than as beige noise.
  for (let y = 0; y < size; y += 6) {
    const phase = random() * Math.PI * 2;
    ctx.lineWidth = 1 + random() * 1.4;
    for (const [color, off] of [['rgba(120,100,64,0.30)', 0], ['rgba(238,222,184,0.28)', 2]]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 16) {
        const yy = y + off + Math.sin(x * 0.05 + phase) * 2.6;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }
  return textureFrom(c, 1);
}

/** Coarse rock: mottled grey with darker fissures. */
function rockTexture(random) {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7c7a76';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2200; i++) {
    const v = 96 + Math.floor(random() * 90);
    ctx.fillStyle = `rgba(${v},${v},${v - 4},0.5)`;
    const w = 2 + random() * 7;
    ctx.fillRect(random() * size, random() * size, w, w * (0.5 + random()));
  }
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(${50 + Math.floor(random() * 30)},${50 + Math.floor(random() * 30)},${48 + Math.floor(random() * 30)},0.5)`;
    ctx.beginPath();
    let x = random() * size;
    let y = random() * size;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (random() - 0.5) * 46;
      y += (random() - 0.35) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return textureFrom(c, 1);
}

/** Adobe: hand-plastered walls, so unevenly warm, with the odd straw fleck. */
function adobeTexture(random) {
  const size = 256;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#bc8f5e';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 900; i++) {
    const w = 6 + random() * 26;
    const v = random();
    ctx.fillStyle = v < 0.5
      ? `rgba(${150 + Math.floor(random() * 40)},${112 + Math.floor(random() * 26)},${70 + Math.floor(random() * 20)},0.25)`
      : `rgba(${196 + Math.floor(random() * 30)},${158 + Math.floor(random() * 26)},${110 + Math.floor(random() * 24)},0.22)`;
    ctx.fillRect(random() * size, random() * size, w, w * 0.7);
  }
  for (let i = 0; i < 900; i++) {
    ctx.strokeStyle = 'rgba(246,228,186,0.5)';
    ctx.lineWidth = 1;
    const x = random() * size;
    const y = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 9, y + (random() - 0.5) * 9);
    ctx.stroke();
  }
  return textureFrom(c, 1);
}

/**
 * SpeedTree-style gust, injected into `begin_vertex`. Two sine terms at
 * different rates, phased from the instance matrix when instanced and from the
 * vertex position otherwise, so a stand of palms or a patch of scrub does not
 * sway in lock-step. `yScale`/`yOffset` map the geometry's local height to 0..1,
 * because an instanced palm and an instanced bush share the code but not the
 * shape.
 */
function applySway(material, amount, yScale, yOffset, key) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = TIME_UNIFORM;
    shader.uniforms.uSwayAmount = { value: amount };
    shader.uniforms.uSwayYScale = { value: yScale };
    shader.uniforms.uSwayYOffset = { value: yOffset };
    shader.vertexShader = 'uniform float uSwayTime;\nuniform float uSwayAmount;\nuniform float uSwayYScale;\nuniform float uSwayYOffset;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float swayPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29;
      #else
        float swayPhase = position.x * 0.37 + position.z * 0.29;
      #endif
      float swayH = clamp(transformed.y * uSwayYScale + uSwayYOffset, 0.0, 1.0);
      float gust = sin(uSwayTime * 1.9 + swayPhase) * 0.6 + sin(uSwayTime * 3.7 + swayPhase * 1.7) * 0.4;
      transformed.x += gust * uSwayAmount * swayH;
      transformed.z += gust * uSwayAmount * 0.7 * swayH;
      `);
    material.customProgramCacheKey = () => key;
  };
  material.needsUpdate = true;
}

/* ------------------------------------------------------------------ shapes ---- */

/**
 * A tapered tower of four legs with cross bracing and a head — the shape every
 * cable-car pylon and radio mast shares. Built at unit height so it can be
 * instanced at its real height.
 */
function latticeTowerGeometry(legRadius = 0.13, headWidth = 1.4) {
  const parts = [];
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) {
    const g = cylinder(legRadius * 0.7, legRadius, 1, 4, sx * 0.26, 0.5, sz * 0.26);
    g.rotateZ(sz * 0.055);
    g.rotateX(-sx * 0.055);
    parts.push(g);
  }
  for (let level = 0; level < 4; level++) {
    const y = 0.12 + level * 0.24;
    const inset = 0.26 - level * 0.02;
    parts.push(box(inset * 2, 0.05, 0.05, 0, y, -inset));
    parts.push(box(inset * 2, 0.05, 0.05, 0, y, inset));
    parts.push(box(0.05, 0.05, inset * 2, -inset, y, 0));
    parts.push(box(0.05, 0.05, inset * 2, inset, y, 0));
    parts.push(box(inset * 2.8, 0.04, 0.04, 0, y + 0.12, -inset));
  }
  parts.push(box(headWidth, 0.09, 0.12, 0, 1.0, 0));
  parts.push(box(0.12, 0.09, 0.5, 0, 1.0, 0));
  return mergeAll(parts);
}

/** A saguaro: trunk plus arms, each arm an elbow that turns upward. */
function saguaroGeometry(random, height = 6) {
  const parts = [];
  const r = height * 0.062;
  parts.push(cylinder(r * 0.86, r, height, 8, 0, height * 0.5, 0));
  const arms = 2 + Math.floor(random() * 2);
  for (let i = 0; i < arms; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const armY = height * (0.32 + random() * 0.3);
    const out = r * (2.1 + random() * 0.7);
    const bend = box(r * 1.7, r * 1.7, r * 1.7, side * out * 0.5, armY, 0);
    parts.push(bake(bend, new THREE.Matrix4().makeRotationY(random() * 0.6 - 0.3)));
    const rise = cylinder(r * 0.82, r * 0.92, height * (0.3 + random() * 0.24), 8, side * out, armY, 0);
    rise.rotateZ(-side * 0.06);
    parts.push(rise);
  }
  return mergeAll(parts);
}

/** A stratified mesa: a tapered prism with a talus skirt and a flat cap. */
function mesaGeometry(random) {
  const parts = [];
  const h = 1;
  const body = new THREE.CylinderGeometry(0.58, 0.78, h, 9, 3);
  const pos = body.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // strata: step the radius in bands so the cliff reads as layered rock
    const band = Math.floor((v.y + h * 0.5) / (h * 0.25));
    v.x *= 1 + band * 0.02;
    v.z *= 1 + band * 0.02;
    v.x += (random() - 0.5) * 0.05;
    v.z += (random() - 0.5) * 0.05;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  body.computeVertexNormals();
  body.translate(0, h * 0.5, 0);
  parts.push(body);
  const skirt = new THREE.CylinderGeometry(0.72, 1.25, h * 0.3, 12, 1);
  skirt.translate(0, h * 0.15, 0);
  parts.push(skirt);
  return mergeAll(parts);
}

/** A roadside snow pole: white post with a red band near the top. */
function snowPoleGeometry(height = 2.1) {
  return cylinder(0.055, 0.065, height, 5, 0, height * 0.5, 0);
}
function snowPoleBandGeometry(height = 2.1) {
  return cylinder(0.075, 0.075, 0.26, 5, 0, height - 0.34, 0);
}

/** A dry-stone wall segment, capped, as it runs along the outside of a bend. */
function wallGeometry(span = 2.4) {
  const parts = [];
  parts.push(box(span, 0.72, 0.42, 0, 0.36, 0));
  parts.push(box(span * 1.04, 0.12, 0.5, 0, 0.78, 0));
  for (let i = 0; i < 3; i++) {
    parts.push(box(span * 0.22, 0.16, 0.46, (i - 1) * span * 0.3, 0.2 + (i % 2) * 0.22, 0));
  }
  return mergeAll(parts);
}

/** A beach hut: bright painted box with a pitched roof over a small deck. */
function hutGeometry(width = 3.0, depth = 2.4, height = 2.2) {
  const parts = [];
  parts.push(box(width, height, depth, 0, height * 0.5, 0));
  const roofA = box(width * 0.62, 0.1, depth * 1.12, -width * 0.26, height + 0.36, 0);
  roofA.rotateZ(0.52);
  const roofB = box(width * 0.62, 0.1, depth * 1.12, width * 0.26, height + 0.36, 0);
  roofB.rotateZ(-0.52);
  parts.push(roofA, roofB);
  parts.push(box(width * 1.2, 0.08, depth * 0.34, 0, 0.06, depth * 0.72));
  return mergeAll(parts);
}

/** A parasol: pole and a canopy, the canopy leaning the way the wind blows. */
function parasolGeometry(height = 2.3, radius = 1.35) {
  const parts = [];
  parts.push(cylinder(0.045, 0.055, height, 6, 0, height * 0.5, 0));
  const canopy = new THREE.ConeGeometry(radius, 0.5, 10, 1, true);
  canopy.translate(0, height + 0.16, 0);
  parts.push(canopy);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = box(0.04, 0.04, radius * 0.96, 0, 0, 0);
    rib.rotateX(0.34);
    rib.rotateY(a);
    rib.translate(-Math.sin(a) * radius * 0.48, height + 0.1, -Math.cos(a) * radius * 0.48);
    parts.push(rib);
  }
  return mergeAll(parts);
}

/** A buoy: float, conical body, mast and lamp. */
function buoyGeometry(radius = 0.62) {
  const parts = [];
  parts.push(sphere(radius, 0, 0, 0, 8, 6));
  const body = new THREE.ConeGeometry(radius * 0.9, radius * 1.5, 8, 1);
  body.translate(0, radius * 0.75, 0);
  parts.push(body);
  parts.push(cylinder(0.05, 0.06, radius * 1.6, 5, 0, radius * 2.0, 0));
  parts.push(sphere(radius * 0.16, 0, radius * 2.8, 0, 6, 4));
  return mergeAll(parts);
}

/* ==================================================================== module === */

const BUDGET = {
  low: { outcrops: 12, rocks: 60, flora: 70, buildings: 2, clutter: 60, shore: 2 },
  medium: { outcrops: 22, rocks: 120, flora: 130, buildings: 3, clutter: 130, shore: 3 },
  high: { outcrops: 34, rocks: 190, flora: 200, buildings: 4, clutter: 200, shore: 4 },
  ultra: { outcrops: 48, rocks: 280, flora: 280, buildings: 6, clutter: 290, shore: 5 },
};

const THEME_KEYS = {
  alpine: { flora: 1.5, rocks: 1.1, outcrops: 1.0 },
  desert: { flora: 1.2, rocks: 0.8, outcrops: 0.7 },
  coastal: { flora: 0.9, rocks: 0.9, outcrops: 0.2 },
};

/**
 * Create the per-scene detail layer for the remote themes.
 *
 * A no-op (an empty group) for every other theme, so it can be built
 * unconditionally alongside `skyline.js` and `rural.js`.
 *
 * @param {object} opts
 * @param {string} [opts.theme='alpine']   `alpine`, `desert` or `coastal`
 * @param {number} [opts.seed=42]          the *track* seed, so terrain matches
 * @param {THREE.Curve} opts.curve         the track centreline
 * @param {number} [opts.width=12]         track width in metres
 * @param {Array}  [opts.gapZones]         pit / tunnel spans to keep clear of
 * @param {string} [opts.quality='high']   low | medium | high | ultra
 * @param {number} [opts.density=1]        global multiplier, clamped to 0.2..2.5
 * @param {object} [opts.lighting]         the lighting rig, for sign glow
 * @returns {{ group: THREE.Group, stats: object, update: Function, dispose: Function }}
 */
export function createWilds(opts = {}) {
  const theme = opts.theme || 'alpine';
  const quality = opts.quality || 'high';
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const curve = opts.curve || null;
  const width = opts.width || 12;
  const gapZones = opts.gapZones || [];
  const density = clamp(opts.density != null ? opts.density : 1, 0.2, 2.5);
  const lighting = opts.lighting || null;

  const isWild = theme === 'alpine' || theme === 'desert' || theme === 'coastal';
  const alpine = theme === 'alpine';
  const desert = theme === 'desert';
  const coastal = theme === 'coastal';
  const random = seededRandom(seed ^ 0x3f1b77);

  const group = new THREE.Group();
  group.name = `Wilds:${theme}`;

  const stats = {
    outcrops: 0, rocks: 0, flora: 0, buildings: 0, clutter: 0, surfaces: 0,
    animated: 0, meshes: 0, tris: 0,
  };

  const disposables = [];
  const empty = {
    group,
    stats,
    update() {},
    dispose() {
      while (group.children.length) group.remove(group.children[0]);
      for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
      disposables.length = 0;
    },
  };

  if (!isWild || !curve || typeof curve.getPointAt !== 'function') return empty;

  const budget = BUDGET[quality] || BUDGET.high;
  const mix = THEME_KEYS[theme];

  /* ---------------------------------------------------------------- terrain --- */

  const noise = createNoise2D(seed);

  function groundAt(x, z) {
    const y = getGradedTerrainHeight(x, z, theme, noise, curve);
    return Number.isFinite(y) ? y : 0;
  }

  let lapLength = 1200;
  try { lapLength = curve.getLength() || 1200; } catch (e) { lapLength = 1200; }
  if (!Number.isFinite(lapLength) || lapLength < 10) lapLength = 1200;

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _dummy = new THREE.Object3D();
  const _neon = new THREE.Vector3();
  const _seat = { x: 0, y: 0, z: 0, nx: 0, nz: 0, tx: 0, tz: 0, roadY: 0 };

  /** Fill `out` with the frame at `lateral` metres off the centreline at `t`. */
  function fillSeat(out, t, lateral, yLift = 0) {
    const tt = ((t % 1) + 1) % 1;
    curve.getPointAt(tt, _p);
    curve.getTangentAt(tt, _t).normalize();
    _n.set(-_t.z, 0, _t.x);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0); else _n.normalize();
    const x = _p.x + _n.x * lateral;
    const z = _p.z + _n.z * lateral;
    out.x = x;
    out.y = groundAt(x, z) + yLift;
    out.z = z;
    out.nx = _n.x;
    out.nz = _n.z;
    out.tx = _t.x;
    out.tz = _t.z;
    out.roadY = _p.y;
    return out;
  }

  /**
   * Frame at `lateral` metres off the centreline at `t`, seated on the ground.
   * Returns a fresh object, so callers may hold it across other calls; the
   * per-frame paths use `fillSeat` into a scratch instead.
   */
  function seat(t, lateral, yLift = 0) {
    return fillSeat({ x: 0, y: 0, z: 0, nx: 0, nz: 0, tx: 0, tz: 0, roadY: 0 }, t, lateral, yLift);
  }

  /**
   * The whole centreline, hashed into 48 m cells. A lap passes near itself, and
   * a mesa 200 m off the road can still land on another leg of the circuit, so
   * everything large is tested against this rather than against its own frame.
   */
  const LAP_N = 512;
  const LAP_CELL = 48;
  function makeLapProbe() {
    const pts = [];
    for (let i = 0; i < LAP_N; i++) pts.push(curve.getPointAt(i / LAP_N));
    const grid = new Map();
    for (let i = 0; i < LAP_N; i++) {
      const k = `${Math.floor(pts[i].x / LAP_CELL)},${Math.floor(pts[i].z / LAP_CELL)}`;
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
    }
    return function lapClear(x, z, t, radius) {
      const own = ((t % 1) + 1) % 1;
      const cx = Math.floor(x / LAP_CELL);
      const cz = Math.floor(z / LAP_CELL);
      const r2 = radius * radius;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const arr = grid.get(`${cx + a},${cz + b}`);
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const i = arr[k];
            const dt = Math.abs(i / LAP_N - own);
            // Skip the item's own stretch (it is always "near" the road) but
            // still test the rest of the lap, which is the point of the probe.
            if (Math.min(dt, 1 - dt) < 0.02) continue;
            const dx = pts[i].x - x;
            const dz = pts[i].z - z;
            if (dx * dx + dz * dz < r2) return false;
          }
        }
      }
      return true;
    };
  }
  const lapClear = makeLapProbe();

  const inGap = (t) => gapZones.some((g) => t >= g.tStart && t <= g.tEnd);

  function poseMatrix(at, yaw = 0, scale = 1) {
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _v.set(at.x, at.y, at.z);
    _s.set(scale, scale, scale);
    return new THREE.Matrix4().compose(_v, _q, _s);
  }

  function poseMatrixScale(at, yaw, sx, sy, sz) {
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _v.set(at.x, at.y, at.z);
    _s.set(sx, sy, sz);
    return new THREE.Matrix4().compose(_v, _q, _s);
  }

  function placeInto(bucket, geometry, at, yaw = 0, scale = 1, tilt = 0) {
    if (!geometry) return;
    _e.set(tilt, yaw, 0);
    _q.setFromEuler(_e);
    _v.set(at.x, at.y, at.z);
    _s.set(scale, scale, scale);
    _m.compose(_v, _q, _s);
    bucket.push(bake(geometry, _m));
  }

  /* -------------------------------------------------------------- materials --- */

  const sandMat = new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 0.96, metalness: 0 });
  sandMat.map = sandTexture(random);
  disposables.push(sandMat.map, sandMat);

  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8e8b86, roughness: 0.9, metalness: 0.02 });
  rockMat.map = rockTexture(random);
  disposables.push(rockMat.map, rockMat);

  const adobeMat = new THREE.MeshStandardMaterial({ color: 0xd2a878, roughness: 0.88, metalness: 0 });
  adobeMat.map = adobeTexture(random);
  disposables.push(adobeMat.map, adobeMat);

  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.72, metalness: 0 });
  disposables.push(snowMat);

  const floraMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, flatShading: true });
  disposables.push(floraMat);

  const palmMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
  disposables.push(palmMat);

  const concreteMat = getConcreteMaterial(196, 17);
  const woodMat = getWoodMaterial(0x7a5a34);
  const darkMat = getDarkMetalMaterial();
  const steelMat = getMetalMaterial(0x9aa0a8, 0.4);
  const paintMat = getPaintedMetalMaterial(0xffffff, 0.45, 0.2);
  const glassMat = getGlassMaterial(0.25);
  const neonMat = getNeonMaterial(0xff6a2a, 2.6);

  let windowMat = null;
  if (alpine || desert) {
    windowMat = new THREE.MeshStandardMaterial({
      color: 0x120d08, emissive: new THREE.Color(0xffb765), emissiveIntensity: 0,
      roughness: 0.32, metalness: 0,
    });
    disposables.push(windowMat);
  }

  /* ---------------------------------------------------------------- buckets --- */

  const rest = {
    stone: [], timber: [], roof: [], steel: [], dark: [], paint: [],
    glass: [], window: [], neon: [], snow: [],
  };
  const outcropBucket = [];
  const capBucket = [];
  const rockBucket = [];
  const floraBucket = [];

  /* ------------------------------------------------------------------ alpine --- */

  const cablePylons = [];
  let cabins = null;
  let cabinSpan = 0;

  function buildChalet(at, yaw, scale) {
    const w = 7.4 * scale;
    const d = 5.6 * scale;
    const h = 3.1 * scale;
    rest.stone.push(bake(box(w, h * 0.62, d, 0, h * 0.31, 0), poseMatrix(at, yaw, 1)));
    rest.timber.push(bake(box(w * 0.98, h * 0.52, d * 0.98, 0, h * 0.62 + h * 0.26, 0), poseMatrix(at, yaw, 1)));
    // gabled roof: two slabs meeting on the ridge, running the long way
    for (const sgn of [-1, 1]) {
      const slab = box(w * 0.72, 0.16, d * 1.16, 0, 0, 0);
      slab.rotateZ(sgn * 0.62);
      slab.translate(sgn * w * 0.28, h * 1.14 + 0.5, 0);
      rest.roof.push(bake(slab, poseMatrix(at, yaw, 1)));
    }
    rest.snow.push(bake(box(w * 0.74, 0.16, d * 1.06, 0, h * 1.14 + 0.62, 0), poseMatrix(at, yaw, 1)));
    // balcony along the downhill face
    rest.timber.push(bake(box(w * 1.06, 0.12, 1.3, 0, h * 0.66, d * 0.62), poseMatrix(at, yaw, 1)));
    for (const sx of [-1, 0, 1]) {
      rest.timber.push(bake(box(0.12, 0.86, 0.12, sx * w * 0.44, h * 1.12, d * 0.62), poseMatrix(at, yaw, 1)));
    }
    // windows on the long faces and a lit one on each
    for (const sz of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        const pane = new THREE.PlaneGeometry(0.92 * scale, 1.05 * scale);
        pane.rotateY(sz > 0 ? 0 : Math.PI);
        pane.translate((i - 1) * w * 0.28, h * 0.78, sz * (d * 0.5 + 0.06));
        rest.window.push(bake(pane, poseMatrix(at, yaw, 1)));
      }
    }
    // a stone chimney
    rest.stone.push(bake(box(0.62, 1.5 * scale, 0.62, w * 0.3, h * 1.2, -d * 0.28), poseMatrix(at, yaw, 1)));
    stats.buildings++;
  }

  function buildAlpine() {
    const near = width * 0.5;

    // Rock faces and outcrops, wandering the hillside, with snow on top of the
    // ones that stand above the snowline.
    const snowline = 7;
    const outcropCount = Math.round(budget.outcrops * mix.outcrops * density);
    for (let i = 0; i < outcropCount; i++) {
      const t = range(random, 0.004, 0.996);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const r = range(random, 3.4, 9.5);
      // the rock reaches r * 1.5 horizontally, so keep its edge off the verge
      const s = seat(t, side * range(random, near + 12 + r * 1.5, near + 240));
      if (!lapClear(s.x, s.z, t, near + 10 + r)) continue;
      const m = poseMatrixScale(s, random() * Math.PI * 2, r * range(random, 0.85, 1.5), r * range(random, 0.55, 1.05), r);
      outcropBucket.push(m);
      if (s.y > snowline) capBucket.push(m.clone());
      stats.outcrops++;
    }

    // Scree: boulders tumbled below the faces.
    const rockCount = Math.round(budget.rocks * mix.rocks * density);
    for (let i = 0; i < rockCount; i++) {
      const t = range(random, 0.002, 0.998);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 7, near + 190), -0.12);
      if (!lapClear(s.x, s.z, t, near + 2)) continue;
      rockBucket.push(poseMatrix(s, random() * Math.PI * 2, range(random, 0.4, 1.7)));
      stats.rocks++;
    }

    // Conifers in stands rather than evenly, because a mountainside has trees in
    // it where it has trees, and bare rock everywhere else.
    const stands = 5;
    const perStand = Math.round((budget.flora * mix.flora * density) / stands);
    for (let b = 0; b < stands; b++) {
      const t0 = range(random, 0, 1);
      const side = random() < 0.5 ? 1 : -1;
      const lat0 = side * range(random, near + 12, near + 120);
      const spread = range(random, 34, 96);
      for (let i = 0; i < perStand; i++) {
        const t = t0 + (random() - 0.5) * (spread / lapLength);
        if (inGap(t)) continue;
        const lat = lat0 + (random() - 0.5) * spread * 1.4;
        if (Math.abs(lat) < near + 8) continue;
        const s = seat(t, lat);
        if (!lapClear(s.x, s.z, t, near + 3)) continue;
        floraBucket.push(poseMatrix(s, random() * Math.PI * 2, range(random, 0.7, 1.35)));
        stats.flora++;
      }
    }

    // Snow poles: the alpine answer to a kerb, both verges, evenly.
    const poleStep = 24;
    const poles = Math.round(lapLength / poleStep);
    for (let i = 0; i < poles; i++) {
      const t = i / poles;
      if (inGap(t)) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const s = seat(t, side * (near + 1.6), 0.02);
      if (!lapClear(s.x, s.z, t, near + 2)) continue;
      const m = poseMatrix(s, Math.atan2(s.tx, s.tz), range(random, 0.94, 1.06));
      poleBucket.push(m);
      stats.clutter++;
    }

    // Dry-stone wall outside the bends.
    const wallCount = Math.round(budget.clutter * 0.25 * density);
    for (let i = 0; i < wallCount; i++) {
      const t = range(random, 0.005, 0.995);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const lat = side * (near + range(random, 4.5, 11));
      const run = 3 + Math.floor(random() * 6);
      const probe = seat(t, lat);
      if (!lapClear(probe.x, probe.z, t, near + 2)) continue;
      for (let k = 0; k < run; k++) {
        const s = seat(t + k * 0.0021, lat, 0.01);
        if (!lapClear(s.x, s.z, t + k * 0.0021, near + 2)) break;
        wallBucket.push(poseMatrix(s, Math.atan2(s.tx, s.tz) + Math.PI * 0.5, 1));
        stats.clutter++;
      }
    }

    // Chalets: a few small hamlets, seated together on the quieter side.
    const hamlets = Math.max(1, Math.round(budget.buildings * 0.6));
    for (let i = 0; i < hamlets; i++) {
      const t0 = range(random, 0.02, 0.98);
      if (inGap(t0)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const lat0 = side * range(random, near + 26, near + 90);
      const probe = seat(t0, lat0);
      if (!lapClear(probe.x, probe.z, t0, near + 20)) continue;
      const n = 3 + Math.floor(random() * 4);
      for (let k = 0; k < n; k++) {
        const s = seat(t0 + (random() - 0.5) * 0.02, lat0 + (random() - 0.5) * 46);
        if (!lapClear(s.x, s.z, t0, near + 6)) continue;
        buildChalet(s, Math.atan2(s.tx, s.tz) + range(random, -0.7, 0.7), range(random, 0.85, 1.2));
      }
    }

    // The cable car: pylons up the hillside with a sagging cable strung between
    // them, and gondolas that travel the line in update().
    const pylonCount = 6 + Math.floor(random() * 3);
    const lineSide = random() < 0.5 ? 1 : -1;
    const startT = range(random, 0, 0.5);
    for (let i = 0; i < pylonCount; i++) {
      const t = startT + i * 0.035;
      const s = seat(t, lineSide * range(random, near + 40, near + 74));
      if (!lapClear(s.x, s.z, t, near + 10)) continue;
      const h = range(random, 16, 30);
      pylonBucket.push(poseMatrixScale(s, Math.atan2(s.tx, s.tz), 1, h, 1));
      cablePylons.push({ x: s.x, y: s.y, z: s.z, h, t });
      stats.clutter++;
    }
    for (let i = 0; i + 1 < cablePylons.length; i++) {
      const a = cablePylons[i];
      const b = cablePylons[i + 1];
      const top = (p) => ({ x: p.x, y: p.y + p.h, z: p.z });
      const a0 = top(a);
      const b0 = top(b);
      const segs = 4;
      for (let k = 0; k < segs; k++) {
        const u0 = k / segs;
        const u1 = (k + 1) / segs;
        const sag = (u) => -Math.sin(u * Math.PI) * 1.6;
        const p0 = { x: lerp(a0.x, b0.x, u0), y: lerp(a0.y, b0.y, u0) + sag(u0), z: lerp(a0.z, b0.z, u0) };
        const p1 = { x: lerp(a0.x, b0.x, u1), y: lerp(a0.y, b0.y, u1) + sag(u1), z: lerp(a0.z, b0.z, u1) };
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const dz = p1.z - p0.z;
        const len = Math.hypot(dx, dy, dz);
        const mid = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5, z: (p0.z + p1.z) * 0.5 };
        const yaw = Math.atan2(dx, dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        const g = box(0.09, 0.09, len, 0, 0, 0);
        rest.steel.push(bake(g, poseMatrix(mid, yaw, 1).multiply(new THREE.Matrix4().makeRotationX(-pitch))));
      }
    }
    if (cablePylons.length >= 2) cabinSpan = cablePylons.length - 1;
  }

  /* ------------------------------------------------------------------- desert --- */

  let tumbleweeds = null;
  let tumbleMesh = null;

  function buildDesert() {
    const near = width * 0.5;

    // Mesas and buttes: big, far, and stratified.
    const mesaCount = Math.max(2, Math.round(budget.outcrops * 0.35 * density));
    for (let i = 0; i < mesaCount; i++) {
      const t = range(random, 0.01, 0.99);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      // A mesa's talus skirt reaches about 1.5x its width. Keep the whole skirt
      // clear of every leg of the lap, not just the one it was placed from.
      const w = range(random, 18, 52);
      const reach = w * 1.6;
      const s = seat(t, side * range(random, near + reach, near + 380), -1.2);
      if (!lapClear(s.x, s.z, t, reach)) continue;
      mesaBucket.push(poseMatrixScale(s, random() * Math.PI * 2, w, range(random, 14, 40), w * range(random, 0.7, 1.2)));
      stats.outcrops++;
    }

    // Boulders and spires.
    const rockCount = Math.round(budget.rocks * mix.rocks * density);
    for (let i = 0; i < rockCount; i++) {
      const t = range(random, 0.002, 0.998);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 6, near + 220), -0.16);
      if (!lapClear(s.x, s.z, t, near + 2)) continue;
      rockBucket.push(poseMatrixScale(s, random() * Math.PI * 2, range(random, 0.4, 2.2), range(random, 0.3, 1.6), range(random, 0.4, 2.2)));
      stats.rocks++;
    }

    // Saguaro, standing about in ones and twos.
    const cacti = Math.round(budget.flora * mix.flora * density);
    for (let i = 0; i < cacti; i++) {
      const t = range(random, 0.002, 0.998);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 8, near + 170), -0.1);
      if (!lapClear(s.x, s.z, t, near + 2)) continue;
      cactusBucket.push(poseMatrix(s, random() * Math.PI * 2, range(random, 0.6, 1.3)));
      stats.flora++;
    }

    // Scrub: the low olive haze that covers everything between the rocks.
    const scrubCount = Math.round(budget.clutter * 0.6 * density);
    for (let i = 0; i < scrubCount; i++) {
      const t = range(random, 0.001, 0.999);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 3.5, near + 150), -0.18);
      if (!lapClear(s.x, s.z, t, near + 1.5)) continue;
      scrubBucket.push(poseMatrix(s, random() * Math.PI * 2, range(random, 0.5, 1.5)));
      stats.clutter++;
    }

    // Wind-rippled sand along the verge, where the ground is low and flat.
    const ripples = Math.max(2, Math.round(budget.shore));
    for (let i = 0; i < ripples; i++) {
      const t0 = (i + 0.5) / ripples + range(random, -0.03, 0.03);
      if (inGap(t0)) continue;
      const side = random() < 0.5 ? 1 : -1;
      buildSurface(t0, side, 3, 'sand');
    }

    // The fuel stop: an adobe block with a canopy over the pumps, a water tower
    // and a neon sign. The only lit thing for miles.
    const stops = Math.max(1, Math.round(budget.buildings * 0.5));
    for (let i = 0; i < stops; i++) {
      const t = range(random, 0.05, 0.95);
      if (inGap(t)) continue;
      const side = (i % 2 === 0) ? 1 : -1;
      const s = seat(t, side * range(random, near + 18, near + 40));
      if (!lapClear(s.x, s.z, t, near + 12)) continue;
      buildFuelStop(s, Math.atan2(s.tx, s.tz));
    }

    // Tumbleweeds: a handful, rolling down the verge.
    const weeds = 3 + Math.floor(random() * 4);
    tumbleweeds = [];
    for (let i = 0; i < weeds; i++) {
      tumbleweeds.push({
        t: random(),
        lat: (random() < 0.5 ? 1 : -1) * range(random, near + 3, near + 26),
        speed: range(random, 3.5, 9),
        spin: range(random, 0.7, 1.4),
        r: range(random, 0.55, 1.1),
      });
    }
  }

  function buildFuelStop(at, yaw) {
    const M = poseMatrix(at, yaw, 1);
    // the long low block
    rest.stone.push(bake(box(21, 3.6, 7, 0, 1.8, 0), M));
    rest.roof.push(bake(box(21.6, 0.34, 7.6, 0, 3.75, 0), M));
    // parapet
    for (const sz of [1, -1]) rest.stone.push(bake(box(21.6, 0.55, 0.4, 0, 4.1, sz * 3.6), M));
    // window band + door, lit
    for (const sz of [1, -1]) {
      const pane = new THREE.PlaneGeometry(17, 1.5);
      pane.rotateY(sz > 0 ? 0 : Math.PI);
      pane.translate(0, 2.2, sz * 3.56);
      rest.window.push(bake(pane, M));
    }
    const door = new THREE.PlaneGeometry(1.5, 2.4);
    door.translate(-8.4, 1.2, 3.56);
    rest.dark.push(bake(door, M));
    // canopy on four pillars, standing clear of the building
    rest.paint.push(bake(box(15, 0.3, 8, 0, 5.2, 11.5), M));
    for (const sx of [-6.6, 6.6]) {
      for (const sz of [8, 15]) {
        rest.steel.push(bake(cylinder(0.16, 0.2, 5.1, 6, sx, 2.55, sz), M));
      }
    }
    // pumps under it
    for (const sx of [-4.4, 0, 4.4]) {
      rest.paint.push(bake(box(1.1, 1.5, 0.7, sx, 0.75, 11.5), M));
      rest.dark.push(bake(box(1.3, 0.28, 0.9, sx, 1.66, 11.5), M));
    }
    // water tower
    const tx = 15.5;
    for (const [sx, sz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) {
      rest.steel.push(bake(cylinder(0.12, 0.15, 6.4, 5, tx + sx, 3.2, sz), M));
      rest.steel.push(bake(box(4.2, 0.1, 0.1, tx, 4.4 + sz * 0.5, sz), M));
    }
    rest.paint.push(bake(cylinder(2.5, 2.5, 3.2, 12, tx, 7.9, 0), M));
    rest.paint.push(bake(new THREE.ConeGeometry(2.6, 1.1, 12, 1), M.clone().multiply(new THREE.Matrix4().makeTranslation(tx, 10.05, 0))));
    // neon sign on a pole
    const sign = new THREE.PlaneGeometry(4.6, 1.7);
    sign.translate(0, 8.2, 0);
    rest.neon.push(bake(sign, M.clone().multiply(new THREE.Matrix4().makeTranslation(-14.5, 0, 3.8))));
    rest.steel.push(bake(cylinder(0.14, 0.18, 7.4, 6, -14.5, 3.7, 3.8), M));
    if (lighting && typeof lighting.addNeonGlow === 'function') {
      _v.set(at.x, at.y, at.z);
      _e.set(0, yaw, 0);
      _q.setFromEuler(_e);
      _v.add(_neon.set(-14.5, 8.2, 3.8).applyQuaternion(_q));
      lighting.addNeonGlow(_v.clone(), 0xff6a2a, 7, { intensity: 0.9 });
    }
    stats.buildings++;
  }

  /* ------------------------------------------------------------------ coastal --- */

  let buoys = null;
  let buoyMesh = null;
  let lighthouse = null;

  function buildCoastal() {
    const near = width * 0.5;
    // The sea sits below the lowest point of the lap (see `scenery.js`), so the
    // sand line and anything floating are measured from the same place.
    let lowestRoad = Infinity;
    for (let i = 0; i <= 200; i++) lowestRoad = Math.min(lowestRoad, curve.getPointAt(i / 200).y);
    const seaY = Number.isFinite(lowestRoad) ? lowestRoad - 1.2 : -3.5;

    // Sand where the ground is at or just above the waterline.
    const beaches = Math.max(2, Math.round(budget.shore * 1.6));
    for (let i = 0; i < beaches; i++) {
      const t0 = (i + 0.5) / beaches + range(random, -0.04, 0.04);
      if (inGap(t0)) continue;
      const side = random() < 0.5 ? 1 : -1;
      buildSurface(t0, side, 2, 'beach', seaY + 2.2);
    }

    // Boulders and a breakwater of tumbled rock.
    const rockCount = Math.round(budget.rocks * mix.rocks * density);
    for (let i = 0; i < rockCount; i++) {
      const t = range(random, 0.002, 0.998);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 5, near + 150), -0.14);
      if (!lapClear(s.x, s.z, t, near + 2)) continue;
      rockBucket.push(poseMatrix(s, random() * Math.PI * 2, range(random, 0.35, 2.0)));
      stats.rocks++;
    }

    // Palms leaning over the road and the beach.
    const palms = Math.round(budget.flora * mix.flora * density);
    for (let i = 0; i < palms; i++) {
      const t = range(random, 0.002, 0.998);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 5, near + 90), -0.1);
      if (!lapClear(s.x, s.z, t, near + 3)) continue;
      floraBucket.push(poseMatrix(s, random() * Math.PI * 2, range(random, 0.55, 1.25)));
      stats.flora++;
    }

    // Low scrub between the palms.
    const scrubCount = Math.round(budget.clutter * 0.35 * density);
    for (let i = 0; i < scrubCount; i++) {
      const t = range(random, 0.001, 0.999);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 3.5, near + 110), -0.2);
      if (!lapClear(s.x, s.z, t, near + 1.5)) continue;
      scrubBucket.push(poseMatrix(s, random() * Math.PI * 2, range(random, 0.4, 1.2)));
      stats.clutter++;
    }

    // Piers out into the water.
    const piers = Math.max(1, Math.round(budget.buildings * 0.5));
    for (let i = 0; i < piers; i++) {
      const t = (i + 0.5) / piers + range(random, -0.06, 0.06);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * (near + 2));
      if (!lapClear(s.x, s.z, t, near + 4)) continue;
      buildPier(s, side, seaY);
      stats.buildings++;
    }

    // Beach huts and parasols on the sand.
    const huts = Math.max(2, Math.round(budget.clutter * 0.06 * density));
    for (let i = 0; i < huts; i++) {
      const t = range(random, 0.01, 0.99);
      if (inGap(t)) continue;
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 12, near + 46));
      if (!lapClear(s.x, s.z, t, near + 3)) continue;
      hutBucket.push(poseMatrix(s, Math.atan2(s.tx, s.tz) + range(random, -0.5, 0.5), range(random, 0.85, 1.15)));
      parasolBucket.push(poseMatrix(seat(t + range(random, -0.004, 0.004), side * range(random, near + 14, near + 40)), random() * Math.PI * 2, range(random, 0.8, 1.15)));
      stats.clutter += 2;
    }

    // A lighthouse on the highest ground it can find, and buoys on the swell.
    let best = null;
    for (let i = 0; i < 26; i++) {
      const t = range(random, 0.02, 0.98);
      const side = random() < 0.5 ? 1 : -1;
      const s = seat(t, side * range(random, near + 30, near + 70));
      if (!lapClear(s.x, s.z, t, near + 6)) continue;
      if (!best || s.y > best.y) best = s;
    }
    if (best) {
      lighthouse = buildLighthouse(best, seaY);
      stats.buildings++;
    }

    const buoyCount = Math.round(8 + budget.clutter * 0.03);
    buoys = [];
    for (let i = 0; i < buoyCount; i++) {
      const t = random();
      const side = random() < 0.5 ? 1 : -1;
      const lat = side * range(random, near + 30, near + 240);
      const s = seat(t, lat);
      if (s.y > seaY + 0.6) continue; // that is dry land, not sea
      if (!lapClear(s.x, s.z, t, near + 2)) continue;
      buoys.push({ x: s.x, z: s.z, phase: random() * Math.PI * 2, y: seaY, scale: range(random, 0.7, 1.2) });
    }
    stats.animated = buoys.length;
  }

  function buildPier(at, side, seaY) {
    const M = poseMatrix(at, Math.atan2(at.nx, at.nz) + (side > 0 ? 0 : Math.PI), 1);
    const len = range(random, 18, 34);
    const deckY = seaY + 2.4;
    // deck: planks across, running out from the shore
    const planks = Math.floor(len / 0.55);
    for (let i = 0; i < planks; i++) {
      rest.timber.push(bake(box(3.4, 0.16, 0.44, 0, deckY - at.y, 1.2 + i * 0.55), M));
    }
    // pilings down to whatever is there, in pairs
    for (let i = 0; i <= Math.floor(len / 3.2); i++) {
      const z = 1.4 + i * 3.2;
      for (const sx of [-1.5, 1.5]) {
        const px = at.x + (M.elements[0] * sx) + (M.elements[8] * z);
        const pz = at.z + (M.elements[2] * sx) + (M.elements[10] * z);
        const bed = groundAt(px, pz);
        const h = Math.max(0.8, deckY - bed);
        rest.timber.push(bake(cylinder(0.19, 0.22, h, 6, sx, bed - at.y + h * 0.5, z), M));
      }
    }
    // rails on both sides and a hut at the end
    for (const sx of [-1.65, 1.65]) {
      rest.timber.push(bake(box(0.1, 0.1, len, sx, deckY - at.y + 1.0, 1.2 + len * 0.5), M));
      for (let i = 0; i <= Math.floor(len / 3); i++) {
        rest.timber.push(bake(box(0.12, 1.0, 0.12, sx, deckY - at.y + 0.5, 1.4 + i * 3), M));
      }
    }
    rest.paint.push(bake(hutGeometry(3.0, 2.6, 2.2), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, deckY - at.y + 0.16, 2.4 + len - 2.2))));
  }

  function buildLighthouse(at, seaY) {
    const M = poseMatrix(at, random() * Math.PI, 1);
    const H = 16;
    rest.paint.push(bake(new THREE.CylinderGeometry(1.5, 2.6, H, 14, 1), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, H * 0.5 - 0.4, 0))));
    for (const [y, r] of [[3.4, 2.35], [7.2, 1.95], [11.0, 1.68], [14.4, 1.5]]) {
      rest.paint.push(bake(box(0.42, 0.42, 0.42, 0, 0, 0), M.clone().multiply(new THREE.Matrix4().makeTranslation(r + 0.12, y, 0))));
      rest.paint.push(bake(box(0.42, 0.42, 0.42, 0, 0, 0), M.clone().multiply(new THREE.Matrix4().makeTranslation(-(r + 0.12), y, 0))));
    }
    rest.paint.push(bake(new THREE.CylinderGeometry(2.3, 2.3, 0.4, 14, 1), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, H - 0.4, 0))));
    rest.steel.push(bake(new THREE.CylinderGeometry(1.5, 1.5, 0.14, 14, 1), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, H + 0.1, 0))));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      rest.steel.push(bake(cylinder(0.05, 0.05, 0.9, 4, Math.sin(a) * 1.45, 0, Math.cos(a) * 1.45), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, H + 0.55, 0))));
    }
    // lantern: glass box with a painted cap
    rest.glass.push(bake(box(2.2, 1.9, 2.2, 0, H + 1.05, 0), M));
    rest.paint.push(bake(new THREE.ConeGeometry(1.85, 1.2, 10, 1), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, H + 2.5, 0))));
    // base rock, so it is not a tower standing on a lawn
    rest.stone.push(bake(box(5.6, 1.2, 5.6, 0, -0.2, 0), M));

    // The beam: a long emissive wedge that turns. It pivots on a node of its
    // own so update() only has to spin a rotation.
    const pivot = new THREE.Group();
    pivot.position.copy(at);
    const beamGeo = new THREE.ConeGeometry(1.6, 46, 8, 1, true);
    beamGeo.rotateX(Math.PI * 0.5);
    beamGeo.translate(0, 0, 23);
    const beamMat = getNeonMaterial(0xfff0c4, 3.2);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(0, H + 1.05, 0);
    pivot.add(beam);
    group.add(pivot);
    stats.meshes++;

    if (lighting && typeof lighting.addNeonGlow === 'function') {
      _v.set(at.x, at.y + H + 1.05, at.z);
      lighting.addNeonGlow(_v.clone(), 0xfff0c4, 9, { intensity: 0.8 });
    }
    return { pivot, beam, speed: 0.55 };
  }

  /* ------------------------------------------------------------- surfaces ---- */

  /**
   * A gridded surface in lap space, dropped onto the graded terrain — sand
   * ripples, a beach. Vertices are culled individually rather than whole strips,
   * so a beach can follow a shoreline that cuts across the patch; `keepBelow`
   * drops anything above the sand line, and anything that falls near another part
   * of the lap is dropped too, because a sand sheet laid over the road is worse
   * than no sand sheet.
   */
  function buildSurface(t, side, strips, kind, keepBelow) {
    const near = width * 0.5;
    const cellsU = 10;
    const cellsV = 4;
    const positions = [];
    const uvs = [];
    const indices = [];
    const run = kind === 'beach' ? 34 : 30;
    let lat = side * (near + (kind === 'beach' ? 3 : 5));
    let built = 0;

    for (let s = 0; s < strips; s++) {
      const widthM = kind === 'beach' ? range(random, 26, 54) : range(random, 24, 52);
      const cols = cellsV + 1;
      const base = positions.length / 3;
      const ok = new Uint8Array((cellsU + 1) * cols);
      const heights = new Float32Array((cellsU + 1) * cols);
      for (let i = 0; i <= cellsU; i++) {
        const u = t + (i / cellsU - 0.5) * (widthM / lapLength);
        for (let j = 0; j <= cellsV; j++) {
          const l = lat + side * (j / cellsV) * run;
          const p = seat(u, l, 0.045);
          const vi = i * cols + j;
          positions.push(p.x, p.y, p.z);
          uvs.push((j / cellsV) * 3.4, (i / cellsU) * 4.6);
          const low = keepBelow == null || p.y <= keepBelow;
          ok[vi] = low && lapClear(p.x, p.z, u, near + 1.5) ? 1 : 0;
          heights[vi] = p.y;
        }
      }
      let used = 0;
      for (let i = 0; i < cellsU; i++) {
        for (let j = 0; j < cellsV; j++) {
          const a = i * cols + j;
          const b = a + cols;
          if (!ok[a] || !ok[a + 1] || !ok[b] || !ok[b + 1]) continue;
          // corners that disagree wildly in height are a cliff, not sand
          if (Math.abs(heights[a] - heights[b + 1]) > 7) continue;
          indices.push(base + a, base + b, base + a + 1, base + a + 1, base + b, base + b + 1);
          used++;
        }
      }
      if (used) built++;
      lat += side * run;
      if (Math.abs(lat) > 260) break;
    }
    if (!indices.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, sandMat);
    mesh.name = kind === 'beach' ? 'BeachSand' : 'SandRipples';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    sandMat.polygonOffset = true;
    sandMat.polygonOffsetFactor = -1;
    sandMat.polygonOffsetUnits = -1;
    group.add(mesh);
    disposables.push(geo);
    stats.meshes++;
    stats.surfaces += built;
    stats.tris += indices.length / 3;
  }

  /* --------------------------------------------------------------- geometry --- */

  // Only what this theme actually draws, so an alpine pass does not build a
  // saguaro or a buoy. Each is instanced, so once built it costs one draw call.
  const geos = {};
  if (alpine) {
    // two outcrop silhouettes so a hillside is not one rock repeated
    geos.outcrops = [
      createRockGeometry({ radius: 1, detail: 1, jitter: 0.34, random, flatten: 1.15 }),
      createRockGeometry({ radius: 1, detail: 0, jitter: 0.42, random, flatten: 0.85 }),
    ];
    geos.cap = createRockGeometry({ radius: 0.82, detail: 0, jitter: 0.2, random, flatten: 0.42 });
    geos.rock = createRockGeometry({ radius: 1, detail: 1, jitter: 0.38, random, flatten: 0.66 });
    geos.conifer = createTreeGeometry({ height: 11, trunkRadius: 0.26, style: 'conifer', layers: 4, random });
    geos.pole = snowPoleGeometry();
    geos.poleBand = snowPoleBandGeometry();
    geos.wall = wallGeometry();
    geos.tower = latticeTowerGeometry();
  } else if (desert) {
    geos.mesa = mesaGeometry(random);
    geos.rock = createRockGeometry({ radius: 1, detail: 1, jitter: 0.38, random, flatten: 0.66 });
    geos.cactus = saguaroGeometry(random);
    geos.scrub = createRockGeometry({ radius: 1, detail: 0, jitter: 0.5, random, flatten: 0.62 });
    geos.tumble = createRockGeometry({ radius: 0.6, detail: 1, jitter: 0.45, random, flatten: 0.9 });
  } else if (coastal) {
    geos.rock = createRockGeometry({ radius: 1, detail: 1, jitter: 0.38, random, flatten: 0.66 });
    geos.palm = createTreeGeometry({ height: 8.5, trunkRadius: 0.28, style: 'palm', random });
    geos.scrub = createRockGeometry({ radius: 1, detail: 0, jitter: 0.5, random, flatten: 0.62 });
    geos.hut = hutGeometry();
    geos.parasol = parasolGeometry();
    geos.buoy = buoyGeometry();
  }

  const mesaBucket = [];
  const cactusBucket = [];
  const scrubBucket = [];
  const poleBucket = [];
  const wallBucket = [];
  const pylonBucket = [];
  const hutBucket = [];
  const parasolBucket = [];

  /* ------------------------------------------------------------------ build --- */

  if (alpine) buildAlpine();
  else if (desert) buildDesert();
  else if (coastal) buildCoastal();

  /* ------------------------------------------------------------- assembly --- */

  function addInstanced(geometry, material, bucket, name, options = {}) {
    if (!geometry || !material || bucket.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length);
    mesh.name = name;
    mesh.castShadow = options.cast !== false && quality !== 'low';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < bucket.length; i++) {
      mesh.setMatrixAt(i, bucket[i]);
      if (options.tint) {
        const k = options.tint[0] + random() * options.tint[1];
        col.setRGB(k * (options.tint[2] || 1), k * (options.tint[3] || 1), k * (options.tint[4] || 1));
        mesh.setColorAt(i, col);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    stats.meshes++;
    stats.tris += (geometry.index ? geometry.index.count / 3 : 0) * bucket.length;
    disposables.push(geometry);
    return mesh;
  }

  function addMerged(list, material, name, cast = true) {
    const geo = mergeAll(list);
    if (!geo || !material) return null;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = cast && quality !== 'low';
    mesh.receiveShadow = true;
    group.add(mesh);
    stats.meshes++;
    stats.tris += geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
    disposables.push(geo);
    return mesh;
  }

  applySway(palmMat, 0.16, 1 / 8.5, 0, 'wilds-palm');
  applySway(floraMat, 0.05, 0.5, 0.4, 'wilds-flora');

  // Rocks: two outcrop variants so a hillside is not one silhouette repeated.
  if (alpine) {
    for (let v = 0; v < 2; v++) {
      const sub = [];
      for (let i = v; i < outcropBucket.length; i += 2) sub.push(outcropBucket[i]);
      addInstanced(geos.outcrops[v], rockMat, sub, `Outcrops${v}`, { tint: [0.76, 0.4] });
    }
    addInstanced(geos.cap, snowMat, capBucket, 'SnowCaps', { cast: false });
  }

  addInstanced(geos.rock, rockMat, rockBucket, 'Boulders', { tint: [0.72, 0.46] });
  if (mesaBucket.length) addInstanced(geos.mesa, rockMat, mesaBucket, 'Mesas', { tint: [0.8, 0.42, 1.0, 0.9, 0.78] });
  if (cactusBucket.length) addInstanced(geos.cactus, floraMat, cactusBucket, 'Saguaro', { tint: [0.42, 0.34, 0.85, 1.12, 0.72] });
  if (scrubBucket.length) addInstanced(geos.scrub, floraMat, scrubBucket, 'Scrub', { tint: [0.5, 0.46, 1.06, 1.0, 0.72] });
  if (floraBucket.length) {
    addInstanced(alpine ? geos.conifer : geos.palm, alpine ? floraMat : palmMat, floraBucket, alpine ? 'Conifers' : 'Palms', {
      tint: alpine ? [0.5, 0.4, 0.72, 1.05, 0.7] : [0.66, 0.34, 0.82, 1.1, 0.66],
    });
  }
  if (hutBucket.length) addInstanced(geos.hut, paintMat, hutBucket, 'BeachHuts', { tint: [0.72, 0.6, 1.25, 1.05, 1.05] });
  if (parasolBucket.length) addInstanced(geos.parasol, paintMat, parasolBucket, 'Parasols', { tint: [0.7, 0.6, 1.3, 1.05, 1.0] });
  if (poleBucket.length) {
    addInstanced(geos.pole, paintMat, poleBucket, 'SnowPoles', { tint: [0.94, 0.1] });
    addInstanced(geos.poleBand, getPaintedMetalMaterial(0xcc2222, 0.5, 0.1), poleBucket, 'SnowPoleBands', { cast: false });
  }
  addInstanced(geos.wall, concreteMat, wallBucket, 'StoneWalls', { tint: [0.86, 0.24] });
  addInstanced(geos.tower, steelMat, pylonBucket, 'CablePylons');

  addMerged(rest.stone, alpine || coastal ? concreteMat : adobeMat, alpine || coastal ? 'Stonework' : 'AdobeBuildings');
  addMerged(rest.timber, woodMat, 'Timber');
  addMerged(rest.roof, darkMat, 'Roofs');
  addMerged(rest.steel, steelMat, 'Steelwork');
  addMerged(rest.dark, darkMat, 'DarkFittings');
  addMerged(rest.paint, paintMat, 'PaintedWork');
  addMerged(rest.glass, glassMat, 'Glazing', false);
  addMerged(rest.window, windowMat, 'LitWindows', false);
  addMerged(rest.neon, neonMat, 'NeonSigns', false);
  addMerged(rest.snow, snowMat, 'RoofSnow', false);

  /* --------------------------------------------------------------- animated --- */

  // Alpine: gondolas travelling the cable. Desert: tumbleweeds rolling down the
  // verge. Coastal: buoys on the swell and a beam going round.
  if (alpine && cablePylons.length >= 2) {
    const cabinGeo = (() => {
      const parts = [];
      parts.push(box(2.4, 2.0, 2.8, 0, -1.0, 0));
      parts.push(box(2.7, 0.16, 3.1, 0, -1.9, 0));
      parts.push(cylinder(0.06, 0.06, 1.7, 5, 0, 0.85, 0));
      parts.push(box(1.1, 0.16, 0.2, 0, 1.7, 0));
      return mergeAll(parts);
    })();
    const n = Math.min(4, Math.max(2, Math.round(cabinSpan)));
    cabins = { mesh: new THREE.InstancedMesh(cabinGeo, paintMat, n), items: [], n, geo: cabinGeo };
    for (let i = 0; i < n; i++) {
      cabins.items.push({ u: i / n, speed: range(random, 0.012, 0.02) * (random() < 0.5 ? 1 : -1) });
    }
    cabins.mesh.name = 'CableCars';
    cabins.mesh.castShadow = quality !== 'low';
    cabins.mesh.frustumCulled = false;
    group.add(cabins.mesh);
    stats.meshes++;
    stats.animated += n;
    stats.tris += (cabinGeo.index ? cabinGeo.index.count / 3 : 0) * n;
    disposables.push(cabinGeo);
  }

  if (desert && tumbleweeds && tumbleweeds.length) {
    tumbleMesh = new THREE.InstancedMesh(geos.tumble, floraMat, tumbleweeds.length);
    tumbleMesh.name = 'Tumbleweeds';
    tumbleMesh.castShadow = false;
    tumbleMesh.frustumCulled = false;
    group.add(tumbleMesh);
    stats.animated += tumbleweeds.length;
    stats.tris += (geos.tumble.index ? geos.tumble.index.count / 3 : 0) * tumbleweeds.length;
    disposables.push(geos.tumble);
  }

  if (coastal && buoys && buoys.length) {
    buoyMesh = new THREE.InstancedMesh(geos.buoy, paintMat, buoys.length);
    buoyMesh.name = 'Buoys';
    buoyMesh.castShadow = false;
    buoyMesh.frustumCulled = false;
    group.add(buoyMesh);
    stats.animated += buoys.length;
    stats.tris += (geos.buoy.index ? geos.buoy.index.count / 3 : 0) * buoys.length;
    disposables.push(geos.buoy);
  }

  stats.meshes = group.children.length;

  /* ----------------------------------------------------------------- update --- */

  let elapsed = 0;

  /**
   * Advance the scene's own animation: gondolas on the cable, tumbleweeds on the
   * verge, buoys on the swell and the lighthouse beam. Lights the windows after
   * dark. Allocates nothing.
   *
   * @param {number} dt seconds since the last frame
   * @param {object} [ctx] the host context; `ctx.isNight` lights the buildings
   */
  function update(dt, ctx) {
    if (windowMat) windowMat.emissiveIntensity = ctx && ctx.isNight ? 1.7 : 0;
    if (!Number.isFinite(dt) || dt === 0) return;
    const step = clamp(dt, 0, 0.1);
    elapsed += step;

    if (cabins && cablePylons.length >= 2) {
      for (let i = 0; i < cabins.n; i++) {
        const c = cabins.items[i];
        c.u += c.speed * step;
        if (c.u > 1) c.u -= 1;
        if (c.u < 0) c.u += 1;
        const along = c.u * cabinSpan;
        const seg = Math.min(cabinSpan - 1, Math.floor(along));
        const f = along - seg;
        const a = cablePylons[seg];
        const b = cablePylons[seg + 1];
        if (!a || !b) continue;
        const x = lerp(a.x, b.x, f);
        const z = lerp(a.z, b.z, f);
        const y = lerp(a.y + a.h, b.y + b.h, f) - Math.sin(f * Math.PI) * 1.6 - 1.1;
        _dummy.position.set(x, y, z);
        _dummy.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
        _dummy.scale.setScalar(1);
        _dummy.updateMatrix();
        cabins.mesh.setMatrixAt(i, _dummy.matrix);
      }
      cabins.mesh.instanceMatrix.needsUpdate = true;
    }

    if (tumbleMesh && tumbleweeds) {
      for (let i = 0; i < tumbleweeds.length; i++) {
        const w = tumbleweeds[i];
        w.t += (w.speed * step) / lapLength;
        if (w.t > 1) w.t -= 1;
        const s = fillSeat(_seat, w.t, w.lat, w.r * 0.7);
        _dummy.position.set(s.x, s.y, s.z);
        _dummy.rotation.set(elapsed * w.speed * w.spin / w.r, Math.atan2(s.tx, s.tz), elapsed * w.speed * w.spin * 0.6 / w.r);
        _dummy.scale.setScalar(w.r);
        _dummy.updateMatrix();
        tumbleMesh.setMatrixAt(i, _dummy.matrix);
      }
      tumbleMesh.instanceMatrix.needsUpdate = true;
    }

    if (buoyMesh && buoys) {
      for (let i = 0; i < buoys.length; i++) {
        const b = buoys[i];
        const wave = Math.sin(elapsed * 0.9 + b.phase);
        const wave2 = Math.sin(elapsed * 0.51 + b.phase * 1.7);
        _dummy.position.set(b.x, b.y + wave * 0.22 + 0.25, b.z);
        _dummy.rotation.set(wave2 * 0.11, b.phase, wave * 0.14);
        _dummy.scale.setScalar(b.scale);
        _dummy.updateMatrix();
        buoyMesh.setMatrixAt(i, _dummy.matrix);
      }
      buoyMesh.instanceMatrix.needsUpdate = true;
    }

    if (lighthouse) lighthouse.pivot.rotation.y = elapsed * lighthouse.speed;
  }

  /* ---------------------------------------------------------------- dispose --- */

  /** Release the geometries and textures this module made, and empty the group. */
  function dispose() {
    while (group.children.length) group.remove(group.children[0]);
    for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
    disposables.length = 0;
    cabins = null;
    buoys = null;
    tumbleweeds = null;
    lighthouse = null;
  }

  return { group, stats, update, dispose };
}
