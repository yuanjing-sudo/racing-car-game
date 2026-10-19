import * as THREE from 'three';

import { seededRandom, pick, range, mergeAll, bake, box, cylinder } from './geometry.js';
import {
  getConcreteMaterial,
  getDarkMetalMaterial,
  getMetalMaterial,
  getPaintedMetalMaterial,
  getNeonMaterial,
  getGlowTexture,
  applyWetness,
} from './materials.js';

/**
 * skyline.js — the city beyond the barriers.
 *
 * `props.js` builds what sits *inside* the fence: gantries, grandstands, marshal
 * posts. This module builds what rises over it. It is the architectural layer for
 * the two urban themes (`city`, `tokyo`) and it is deliberately detailed, because
 * a skyline is most of what you actually look at when the road runs through a
 * downtown: the barrier and the catch fence hide everything below roof height.
 *
 * What a tower is made of
 * -----------------------
 *   - **A podium**: 2–3 storeys, wider than the shaft, with a lit shopfront band
 *     and an awning rim. This is what makes a tower read as *standing on* a
 *     street rather than being extruded from the tarmac.
 *   - **A shaft**, in one of six massings: `slab` (a plain rectangle), `setback`
 *     (déco steps), `tapered` (a frustum), `chamfer` (an octagon), `twinned`
 *     (two shafts on a shared crown) and `spire` (shaft, taper and a mast). Each
 *     step of a setback or a taper gets a proud cornice, because a silhouette
 *     made of plain boxes reads as cardboard at 300 m.
 *   - **A curtain wall**: window sheets on all four faces, each with UVs scaled
 *     so one texture tile is exactly one storey. One 128×128 tile therefore
 *     clothes a 40-storey shaft, and the floor line in the tile *is* the floor
 *     line on the building.
 *   - **Rooftop clutter**: chillers, cooling towers, water tanks, stair
 *     penthouses, dishes and antenna masts. Cheap to merge, and it is the
 *     difference between "a box" and "a building" when you fly past it.
 *   - **Signage**: vertical blade signs and crown bands, plus one entry in the
 *     lighting rig's glow pool per sign so the neon actually spills into the fog.
 *   - **Aviation beacons**: one additive quad per tall tower, blinking on
 *     independent timers — like `crew.js`'s flashguns and the grandstand crowd,
 *     because that is the pattern this codebase already uses for "many small
 *     things that blink".
 *
 * Cost
 * ----
 * Every tower is baked into world space and merged, so a whole skyline — blocks,
 * podiums, clutter, signs — is a handful of draw calls: one per structural
 * material, one per curtain-wall variant, one for the silhouette ring, one for
 * the beacons. The triangle count is a few tens of thousands for the lot.
 *
 * Determinism
 * -----------
 * Placement, massing, clutter and lit windows all come from one seeded PRNG, so
 * a track always grows the same city. The only unseeded randomness is the
 * *timing* of the beacons, which is animation, not layout.
 *
 * Not verified visually: this was written and checked on a phone with no
 * browser. See README.
 */

/* ------------------------------------------------------------------ helpers ---- */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** 2D canvas for procedural textures; `null` where there is no DOM (tests). */
function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function textureFrom(canvas, { wrap = THREE.RepeatWrapping, srgb = true, repeat = null } = {}) {
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.anisotropy = 4;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------ the curtain wall ---- */

/**
 * Facade recipes. Each entry draws one storey of glazing: a floor slab band at
 * the bottom of the tile, the mullion grid, and a fraction of bays left lit.
 * Because the tile repeats once per storey, `floorLine` is the real floor line.
 *
 * `lit` is the night fraction of lit bays; the daytime albedo stays glass-dark
 * because the day look comes from the sky reflection, not from painted windows.
 */
const FACADES = [
  { bays: 6, floorLine: 0.16, mullion: 0.06, lit: 0.30, warmth: 0.55, glass: [16, 20, 28], pane: [30, 38, 52] },
  { bays: 4, floorLine: 0.22, mullion: 0.09, lit: 0.46, warmth: 0.30, glass: [12, 15, 22], pane: [26, 34, 46] },
  { bays: 8, floorLine: 0.12, mullion: 0.04, lit: 0.22, warmth: 0.75, glass: [18, 21, 30], pane: [34, 40, 52] },
  { bays: 5, floorLine: 0.30, mullion: 0.12, lit: 0.55, warmth: 0.15, glass: [10, 13, 20], pane: [22, 30, 44] },
];

/**
 * Paint one facade variant: an albedo (dark glass grid, for the day look) and an
 * emissive (the lit bays only, for the night look). Two textures rather than one
 * so the dark panes do not glow at night.
 *
 * @param {object} spec one entry of FACADES
 * @param {Function} random deterministic
 * @returns {{ albedo: THREE.Texture|null, emissive: THREE.Texture|null }}
 */
function facadeTextures(spec, random) {
  const S = 128;
  const albedo = makeCanvas(S, S);
  const emissive = makeCanvas(S, S);
  if (!albedo || !emissive) return { albedo: null, emissive: null };

  const a = albedo.getContext('2d');
  const e = emissive.getContext('2d');

  a.fillStyle = `rgb(${spec.glass[0]},${spec.glass[1]},${spec.glass[2]})`;
  a.fillRect(0, 0, S, S);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, S, S);

  const floorPx = Math.round(S * spec.floorLine);
  const mullionPx = Math.max(1, Math.round(S * spec.mullion));
  const bayW = (S - mullionPx) / spec.bays;
  const paneY = floorPx + 1;
  const paneH = S - paneY - 1;

  for (let b = 0; b < spec.bays; b++) {
    const x = b * bayW;
    const w = Math.max(2, bayW - mullionPx);

    // Panes: a touch of vertical shading so a wall is not a flat colour.
    const tint = spec.pane;
    const k = 0.82 + random() * 0.36;
    a.fillStyle = `rgb(${Math.round(tint[0] * k)},${Math.round(tint[1] * k)},${Math.round(tint[2] * k)})`;
    a.fillRect(Math.round(x), paneY, Math.round(w), paneH);

    // Every pane is split into two lights in a real curtain wall.
    a.fillStyle = 'rgba(0,0,0,0.35)';
    a.fillRect(Math.round(x + w * 0.5), paneY, 1, paneH);

    // Some bays are lit. Warm office light, a few cool ones.
    if (random() < spec.lit) {
      const warm = random() < (1 - spec.warmth);
      const g = 0.72 + random() * 0.28;
      const col = warm
        ? [255, Math.round(214 * g), Math.round(150 * g)]
        : [Math.round(198 * g), Math.round(224 * g), 255];
      a.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      a.fillRect(Math.round(x), paneY, Math.round(w), paneH);
      e.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      e.fillRect(Math.round(x), paneY, Math.round(w), paneH);
      // a dark band at the top of a lit pane: a ceiling, a blind, a sill
      if (random() < 0.45) {
        e.fillStyle = 'rgba(0,0,0,0.55)';
        const band = Math.round(paneH * (0.18 + random() * 0.3));
        e.fillRect(Math.round(x), paneY, Math.round(w), band);
      }
    }
  }

  // The floor slab: a solid band across the tile at the bottom.
  a.fillStyle = 'rgb(58,60,66)';
  a.fillRect(0, S - floorPx, S, floorPx);
  a.fillStyle = 'rgba(255,255,255,0.10)';
  a.fillRect(0, S - floorPx, S, 1);

  return {
    albedo: textureFrom(albedo, { repeat: [1, 1] }),
    emissive: textureFrom(emissive, { repeat: [1, 1] }),
  };
}

/* ------------------------------------------------------------ tower plans ---- */

const MASSINGS = ['slab', 'setback', 'setback', 'tapered', 'chamfer', 'twinned', 'spire'];

/**
 * Describe one tower before any geometry exists: how tall, how wide, how it is
 * massed, and what sits on the roof. Keeping the plan separate from the build
 * means the silhouette ring can reuse a plan without its windows.
 *
 * @param {Function} random deterministic
 * @param {{ minFloors:number, maxFloors:number, minFoot:number, maxFoot:number, spireChance:number }} limits
 */
function towerPlan(random, limits) {
  const floors = Math.round(range(random, limits.minFloors, limits.maxFloors) * (limits.heightScale || 1));
  const floorH = range(random, 3.3, 4.5);
  const height = floors * floorH;
  const foot = range(random, limits.minFoot, limits.maxFoot);

  const style = pick(random, MASSINGS);
  const slender = style === 'spire' || style === 'twinned';
  const width = slender ? foot * range(random, 0.6, 0.8) : foot;
  const depth = slender ? foot * range(random, 0.6, 0.8) : foot * range(random, 0.78, 1.15);

  return {
    style,
    floors,
    floorH,
    height,
    width,
    depth,
    /** Fraction of the shaft that each successive step keeps. */
    step: range(random, 0.66, 0.86),
    /** How many stepped blocks a setback tower has. */
    steps: 2 + Math.floor(random() * 3),
    podium: random() < 0.82,
    podiumHeight: range(random, 5.5, 9.5),
    crown: style === 'spire' ? 1 : random(),
    mast: (style === 'spire' || style === 'twinned') ? true : random() < limits.spireChance,
    beacon: height > 34 ? true : random() < 0.2,
    sign: random() < limits.signChance,
    clutter: 2 + Math.floor(random() * 5),
    facade: Math.floor(random() * FACADES.length),
    /** Rotation about Y of the shaft, so a block never reads as a grid. */
    twist: range(random, -0.22, 0.22),
  };
}

/* --------------------------------------------------------------- geometry ---- */

/**
 * A plane already UV-scaled so one texture tile is one storey and one bay run.
 * Three's PlaneGeometry is +Z facing; callers rotate it onto a wall.
 */
function sheet(w, h, uRepeat, vRepeat) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const a = uv.array;
  for (let i = 0; i < a.length; i += 2) {
    a[i] *= uRepeat;
    a[i + 1] *= vRepeat;
  }
  uv.needsUpdate = true;
  return g;
}

/** Push a geometry into a bucket, baked into world space. */
function push(bucket, geometry, matrix) {
  if (!geometry) return;
  bucket.push(matrix ? bake(geometry, matrix) : geometry);
}

/* --------------------------------------------------------------- factory ---- */

/**
 * Build the city skyline for one circuit.
 *
 * @param {object} opts
 * @param {string} [opts.theme='city']      `city` or `tokyo`; anything else gets an empty group
 * @param {number} [opts.seed=42]            deterministic placement seed
 * @param {THREE.Curve} opts.curve           centreline
 * @param {number} [opts.width=12]           track width in metres
 * @param {Array} [opts.gapZones]            pit / tunnel spans to keep clear
 * @param {string} [opts.quality='high']     low | medium | high | ultra
 * @param {number} [opts.density=1]          global multiplier
 * @param {object} [opts.lighting]           glow pool (optional)
 * @param {Function} [opts.terrainHeight]    (x, z) => y, when the world is not flat
 * @returns {{ group: THREE.Group, stats: object, update: Function, dispose: Function }}
 */
export function createSkyline(opts = {}) {
  const theme = opts.theme || 'city';
  const quality = opts.quality || 'high';
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const curve = opts.curve || null;
  const width = opts.width || 12;
  const gapZones = opts.gapZones || [];
  const lighting = opts.lighting || null;
  const density = clamp(opts.density != null ? opts.density : 1, 0.2, 2.5);
  const terrainHeight = typeof opts.terrainHeight === 'function' ? opts.terrainHeight : null;

  const urban = theme === 'city' || theme === 'tokyo';
  const random = seededRandom(seed ^ 0x5cd1e77);

  const group = new THREE.Group();
  group.name = `Skyline:${theme}`;

  const stats = {
    towers: 0, blocks: 0, silhouette: 0, signs: 0, beacons: 0,
    meshes: 0, tris: 0,
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

  if (!urban || !curve || typeof curve.getPointAt !== 'function') return empty;

  /* ------------------------------------------------------------- budget ---- */

  const BUDGET = {
    low: { blocks: 5, towersPer: 3, silhouette: 16, clutter: 0.6, maxFloors: 22 },
    medium: { blocks: 8, towersPer: 4, silhouette: 26, clutter: 0.85, maxFloors: 30 },
    high: { blocks: 11, towersPer: 5, silhouette: 36, clutter: 1.0, maxFloors: 38 },
    ultra: { blocks: 15, towersPer: 6, silhouette: 48, clutter: 1.25, maxFloors: 46 },
  };
  const budget = BUDGET[quality] || BUDGET.high;

  const night = theme === 'tokyo' || theme === 'city';
  const tokyo = theme === 'tokyo';

  /* ---------------------------------------------------------- materials ---- */

  const concrete = getConcreteMaterial(178, 9);
  const dark = getDarkMetalMaterial();
  const steel = getMetalMaterial(0x8d949c, 0.36);
  const painted = getPaintedMetalMaterial(0x59606b, 0.5, 0.3);

  // The curtain wall: one material per facade variant, each with its own slow
  // flicker phase so a block of towers does not pulse in lock-step.
  const facadeMats = [];
  const facadeTex = [];
  for (let i = 0; i < FACADES.length; i++) {
    const tex = facadeTextures(FACADES[i], seededRandom(seed ^ (0x3f1 + i * 977)));
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex.albedo,
      emissive: 0xffffff,
      emissiveMap: tex.emissive,
      emissiveIntensity: 0.0,
      roughness: 0.18,
      metalness: 0.55,
      envMapIntensity: 1.5,
    });
    // Rain on a curtain wall is most of what a Tokyo night looks like.
    if (theme === 'tokyo') applyWetness(mat, 0.55);
    facadeMats.push(mat);
    facadeTex.push(tex);
    disposables.push(mat);
    if (tex.albedo) disposables.push(tex.albedo);
    if (tex.emissive) disposables.push(tex.emissive);
  }
  const facadePhase = FACADES.map((_, i) => i * 1.7);

  // The distant ring is deliberately unlit and untextured: with fog on, a dark
  // mass at 400 m reads as a building, and it costs one draw call for all of them.
  const silhouetteMat = new THREE.MeshStandardMaterial({
    color: 0x1b2028, roughness: 0.9, metalness: 0.0, fog: true,
  });
  disposables.push(silhouetteMat);

  // Blade signs, one shared cached neon material per colour so the signs bucket
  // per material and still merge into a handful of draws.
  const SIGN_COLORS = [0xff2bd0, 0x21e6ff, 0xfff35a, 0xff4a3d];
  const signMats = SIGN_COLORS.map((c) => getNeonMaterial(c, 2.2));
  const signBuckets = SIGN_COLORS.map(() => []);

  /* ------------------------------------------------------------- buckets ---- */
  const buckets = {
    structure: [],
    dark: [],
    steel: [],
    painted: [],
    windows: FACADES.map(() => []),
    silhouette: [],
  };
  const beaconSpots = [];

  /* ----------------------------------------------------------- placement ---- */

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);

  const inGap = (t) => gapZones.some((g) => t >= g.tStart && t <= g.tEnd);

  /**
   * A lap is a closed loop, so a tower placed 40 m off the centreline at t = 0.3
   * can be standing on the road at t = 0.72. Everything large is therefore tested
   * against the whole centreline, not just the local frame: 512 samples hashed
   * into 48 m cells, so a query only visits the nine cells that could hold a
   * point within the radius.
   *
   * @returns {Function} (x, z, t, radius) => true when the spot is clear of every
   *   part of the lap except its own neighbourhood.
   */
  function makeLapProbe() {
    const N = 512;
    const CELL = 48;
    const pts = [];
    for (let i = 0; i < N; i++) pts.push(curve.getPointAt(i / N));
    const grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = `${Math.floor(pts[i].x / CELL)},${Math.floor(pts[i].z / CELL)}`;
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
    }
    return function lapClear(x, z, t, radius) {
      const own = ((t % 1) + 1) % 1;
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      const r2 = radius * radius;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          const arr = grid.get(`${cx + a},${cz + b}`);
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const i = arr[k];
            const dt = Math.abs(i / N - own);
            if (Math.min(dt, 1 - dt) < 0.055) continue; // its own stretch of road
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

  function groundAt(x, z, fallback) {
    if (!terrainHeight) return fallback;
    const y = terrainHeight(x, z);
    return Number.isFinite(y) ? y : fallback;
  }

  /**
   * Build one tower at a world transform. Everything is pushed into the shared
   * buckets in world space, so the merge at the end collapses the whole city.
   *
   * @param {object} plan from towerPlan()
   * @param {THREE.Matrix4} matrix world transform (position + yaw)
   */
  function buildTower(plan, matrix) {
    const halfW = plan.width * 0.5;
    const halfD = plan.depth * 0.5;
    const facade = plan.facade;
    let y = 0;
    let w = plan.width;
    let d = plan.depth;

    /* --- podium ---------------------------------------------------------- */
    if (plan.podium) {
      const pw = plan.width * range(random, 1.18, 1.4);
      const pd = plan.depth * range(random, 1.15, 1.4);
      push(buckets.structure, box(pw, plan.podiumHeight, pd, 0, plan.podiumHeight * 0.5, 0), matrix);
      // an awning rim over the shopfront, then the glazing behind it
      push(buckets.dark, box(pw + 0.5, 0.35, pd + 0.5, 0, plan.podiumHeight - 0.2, 0), matrix);
      const shopH = plan.podiumHeight - 1.1;
      for (const [sx, sz, sw] of [[0, 1, pw], [0, -1, pw], [1, 0, pd], [-1, 0, pd]]) {
        const rot = sx === 0 ? (sz > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
        const geo = sheet(sw - 0.3, shopH, (sw - 0.3) / 4.2, shopH / plan.floorH);
        geo.rotateY(rot);
        geo.translate(sx * (sx ? pw * 0.5 + 0.03 : 0), shopH * 0.5 + 0.55, sz * (sz ? pd * 0.5 + 0.03 : 0));
        push(buckets.windows[facade], geo, matrix);
      }
      y = plan.podiumHeight;
    }

    /* --- shaft ----------------------------------------------------------- */
    const shaftTop = plan.height;
    const useSteps = plan.style === 'setback';
    const stepCount = useSteps ? plan.steps : 1;
    const stepHeight = (shaftTop - y) / stepCount;

    for (let s = 0; s < stepCount; s++) {
      const k = Math.pow(plan.step, s);
      const sw = w * (useSteps ? k : 1);
      const sd = d * (useSteps ? k : 1);
      const y0 = y + s * stepHeight;
      const cx = range(random, -1.1, 1.1);
      const cz = range(random, -1.1, 1.1);

      if (plan.style === 'tapered') {
        // A frustum: a 4-sided cylinder is a square prism, rotated 45° to sit flat.
        const taper = 0.62;
        const g = new THREE.CylinderGeometry(
          Math.SQRT1_2 * sw * taper, Math.SQRT1_2 * sw, stepHeight, 4, 1, false
        );
        g.rotateY(Math.PI * 0.25);
        g.translate(0, stepHeight * 0.5, 0);
        push(buckets.structure, g, _m.clone().copy(matrix).multiply(new THREE.Matrix4().makeTranslation(0, y0, 0)));
      } else if (plan.style === 'chamfer') {
        const g = new THREE.CylinderGeometry(Math.SQRT1_2 * sw, Math.SQRT1_2 * sw, stepHeight, 8, 1, false);
        g.translate(0, stepHeight * 0.5, 0);
        push(buckets.structure, g, _m.clone().copy(matrix).multiply(new THREE.Matrix4().makeTranslation(0, y0, 0)));
      } else if (plan.style === 'twinned') {
        const gap = sw * 0.42;
        for (const dirX of [-1, 1]) {
          const tw = sw * 0.55;
          push(buckets.structure, box(tw, stepHeight, sd, dirX * (gap * 0.5 + tw * 0.5), y0 + stepHeight * 0.5, 0), matrix);
          push(buckets.dark, box(tw + 0.35, 0.4, sd + 0.35, dirX * (gap * 0.5 + tw * 0.5), y0 + 0.2, 0), matrix);
          for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const faceW = sz === 0 ? sd : tw;
            const rot = sx === 0 ? (sz > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
            const geo = sheet(faceW - 0.4, stepHeight - 0.9, (faceW - 0.4) / 4.0, (stepHeight - 0.9) / plan.floorH);
            geo.rotateY(rot);
            geo.translate(
              dirX * (gap * 0.5 + tw * 0.5) + sx * (sx ? tw * 0.5 + 0.04 : 0),
              y0 + stepHeight * 0.5 + 0.2,
              sz * (sz ? sd * 0.5 + 0.04 : 0),
            );
            push(buckets.windows[facade], geo, matrix);
          }
        }
      } else {
        push(buckets.structure, box(sw, stepHeight, sd, cx, y0 + stepHeight * 0.5, cz), matrix);
        // A proud cornice at the foot and head of every step: the single detail
        // that does most of the work at distance.
        push(buckets.dark, box(sw + 0.6, 0.45, sd + 0.6, cx, y0 + 0.22, cz), matrix);
        push(buckets.dark, box(sw + 0.5, 0.4, sd + 0.5, cx, y0 + stepHeight - 0.2, cz), matrix);

        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const faceW = sz === 0 ? sd : sw;
          const rot = sx === 0 ? (sz > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
          const h = stepHeight - 1.0;
          const geo = sheet(faceW - 0.5, h, (faceW - 0.5) / 4.0, h / plan.floorH);
          geo.rotateY(rot);
          geo.translate(
            cx + sx * (sx ? sw * 0.5 + 0.05 : 0),
            y0 + stepHeight * 0.5 + 0.1,
            cz + sz * (sz ? sd * 0.5 + 0.05 : 0),
          );
          push(buckets.windows[facade], geo, matrix);
        }
      }

      // Setbacks: the next block is narrower, so a ledge appears for free.
      if (useSteps) { w *= plan.step; d *= plan.step; }
    }

    /* --- crown ----------------------------------------------------------- */
    let roofY = shaftTop;
    let crownW = plan.style === 'setback' ? w : plan.width;
    let crownD = plan.style === 'setback' ? d : plan.depth;

    if (plan.style === 'spire') {
      const h = plan.height * range(random, 0.16, 0.26);
      const g = new THREE.CylinderGeometry(crownW * 0.06, Math.SQRT1_2 * crownW * 0.62, h, 4, 1, false);
      g.rotateY(Math.PI * 0.25);
      g.translate(0, roofY + h * 0.5, 0);
      push(buckets.structure, g, matrix);
      roofY += h;
    } else if (plan.crown > 0.62) {
      // A stepped crown: two or three diminishing setbacks with lit bands.
      let cw = crownW * 0.86;
      let cd = crownD * 0.86;
      for (let i = 0; i < 2; i++) {
        const h = plan.floorH * range(random, 2.4, 4.2) * (1 - i * 0.35);
        const cxo = range(random, -1.0, 1.0);
        push(buckets.structure, box(cw, h, cd, cxo, roofY + h * 0.5, 0), matrix);
        push(buckets.dark, box(cw + 0.5, 0.4, cd + 0.5, cxo, roofY + h - 0.18, 0), matrix);
        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const faceW = sz === 0 ? cd : cw;
          const rot = sx === 0 ? (sz > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
          const geo = sheet(faceW - 0.4, h - 0.8, (faceW - 0.4) / 4.0, (h - 0.8) / plan.floorH);
          geo.rotateY(rot);
          geo.translate(cxo + sx * (sx ? cw * 0.5 + 0.05 : 0), roofY + h * 0.5, sz * (sz ? cd * 0.5 + 0.05 : 0));
          push(buckets.windows[facade], geo, matrix);
        }
        roofY += h;
        cw *= 0.72;
        cd *= 0.72;
      }
      crownW = cw / 0.72;
      crownD = cd / 0.72;
    } else {
      // A parapet, and a plant room behind it. Flat roofs are not flat.
      push(buckets.dark, box(crownW + 0.5, 0.9, crownD + 0.5, 0, roofY + 0.35, 0), matrix);
      roofY += 0.8;
    }

    /* --- rooftop clutter -------------------------------------------------- */
    const clutter = Math.round(plan.clutter * budget.clutter * density);
    for (let i = 0; i < clutter; i++) {
      const cx = range(random, -crownW * 0.32, crownW * 0.32);
      const cz = range(random, -crownD * 0.32, crownD * 0.32);
      const kind = random();
      if (kind < 0.34) {
        // chiller / AC bank
        const bw = range(random, 1.8, 3.6);
        const bh = range(random, 1.2, 2.4);
        push(buckets.steel, box(bw, bh, bw * range(random, 0.7, 1.1), cx, roofY + bh * 0.5, cz), matrix);
      } else if (kind < 0.55) {
        // cooling tower
        const r = range(random, 0.9, 1.7);
        const h = range(random, 2.0, 3.4);
        push(buckets.steel, cylinder(r * 0.82, r, h, 8, cx, roofY + h * 0.5, cz), matrix);
      } else if (kind < 0.72) {
        // water tank on legs
        const r = range(random, 0.7, 1.2);
        const h = range(random, 1.6, 2.4);
        const legs = 1.2;
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          push(buckets.steel, cylinder(0.07, 0.07, legs, 5, cx + ox * r * 0.6, roofY + legs * 0.5, cz + oz * r * 0.6), matrix);
        }
        push(buckets.steel, cylinder(r, r, h, 10, cx, roofY + legs + h * 0.5, cz), matrix);
      } else if (kind < 0.87) {
        // stair penthouse
        const bw = range(random, 2.2, 4.0);
        const bh = range(random, 2.4, 3.6);
        push(buckets.structure, box(bw, bh, bw * 0.8, cx, roofY + bh * 0.5, cz), matrix);
        push(buckets.dark, box(bw + 0.4, 0.3, bw * 0.8 + 0.4, cx, roofY + bh, cz), matrix);
      } else {
        // satellite dishes: a bowl tipped at the sky
        const r = range(random, 0.5, 1.0);
        const dish = new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45);
        dish.rotateX(-1.05);
        dish.translate(cx, roofY + r * 0.7, cz);
        push(buckets.painted, dish, matrix);
      }
    }

    /* --- mast + beacon ---------------------------------------------------- */
    if (plan.mast) {
      const mh = range(random, 4, 13);
      push(buckets.steel, cylinder(0.11, 0.2, mh, 5, 0, roofY + mh * 0.5, 0), matrix);
      for (let i = 0; i < 3; i++) {
        const y = roofY + mh * (0.45 + i * 0.18);
        push(buckets.steel, cylinder(0.03, 0.03, mh * 0.16, 4, 0, y, 0, 0, Math.PI * 0.5), matrix);
      }
      roofY += mh;
    }

    if (plan.beacon) {
      _v.set(0, roofY + 1.2, 0).applyMatrix4(matrix);
      beaconSpots.push({ x: _v.x, y: _v.y, z: _v.z, phase: random() });
      stats.beacons++;
    }

    /* --- signage ---------------------------------------------------------- */
    if (plan.sign && night) {
      const signH = plan.height * range(random, 0.22, 0.46);
      const sy = plan.height - signH * 0.5 - 1.5;
      const side = pick(random, [-1, 1]);
      const ci = Math.floor(random() * SIGN_COLORS.length);
      // A vertical blade standing off the face, seen edge-on from the road.
      const bw = range(random, 1.1, 2.0);
      push(signBuckets[ci], box(bw, signH, bw * 0.5, 0, sy, side * (halfD + bw * 0.6)), matrix);
      push(buckets.dark, box(0.16, signH, 0.16, 0, sy, side * (halfD + 0.1)), matrix);
      if (lighting && lighting.addNeonGlow) {
        _v.set(0, sy, side * (halfD + bw * 0.9)).applyMatrix4(matrix);
        lighting.addNeonGlow(_v, SIGN_COLORS[ci], 14 + signH * 0.4);
      }
      stats.signs++;
    }

    stats.towers++;
  }

  /* ---------------------------------------------------------- city blocks ---- */

  /**
   * A city block: a grid of towers on the outward side of the circuit, sharing a
   * street pitch so the gaps line up. This is what makes a skyline read as a
   * city rather than a fence of single boxes.
   */
  function buildBlock(t, lateral, band) {
    const frame = trackFrameLocal(t, lateral);
    const axis = frame.tangent;
    const side = lateral >= 0 ? 1 : -1;
    // The block grows outward, away from the circuit, so `out` follows the side
    // the block was placed on rather than the curve's own lateral normal.
    const out = frame.normal.clone().multiplyScalar(side);
    const inwardYaw = Math.atan2(-out.x, -out.z);
    const count = Math.max(2, Math.round(band.towersPer * density));
    const cols = count <= 3 ? 2 : 3;
    const rows = Math.ceil(count / cols);
    let placed = 0;

    for (let j = 0; j < rows && placed < count; j++) {
      for (let i = 0; i < cols && placed < count; i++) {
        const tower = towerPlan(random, {
          minFloors: band.minFloors,
          maxFloors: band.maxFloors,
          minFoot: band.minFoot,
          maxFoot: band.maxFoot,
          spireChance: band.spireChance,
          heightScale: band.heightScale,
          signChance: band.signChance,
        });
        const pitchX = band.pitch;
        const pitchZ = band.pitch * 1.1;
        const along = (i - (cols - 1) * 0.5) * pitchX + range(random, -2.5, 2.5);
        const away = j * pitchZ + range(random, -2, 2);

        _v.set(frame.position.x, 0, frame.position.z)
          .addScaledVector(axis, along)
          .addScaledVector(out, away);
        const gy = groundAt(_v.x, _v.z, frame.position.y) - 0.5;

        _e.set(0, inwardYaw + tower.twist, 0);
        _q.setFromEuler(_e);
        _p.set(_v.x, gy, _v.z);
        _m.compose(_p, _q, _s);
        buildTower(tower, _m);
        placed++;
      }
    }
    stats.blocks++;
  }

  /* --------------------------------------------------------- silhouette ring ---- */

  /**
   * The far ring: tall, dark, untextured, and very cheap. It exists to give the
   * horizon a profile and to catch the fog, not to be looked at directly.
   */
  function buildSilhouette(count) {
    for (let i = 0; i < count; i++) {
      const t = (i / count + range(random, -0.012, 0.012) + 0.004) % 1;
      if (inGap(t)) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const dist = range(random, 300, 620);
      const frame = trackFrameLocal(t, side * (width * 0.5 + dist));
      // A far tower is 300 m out, but on a folded lap that can still be the
      // infield of another corner: keep the ones that are genuinely clear.
      if (!lapClear(frame.position.x, frame.position.z, t, 90)) continue;
      const floors = Math.round(range(random, 16, 58) * (tokyo ? 1.35 : 1));
      const floorH = range(random, 3.6, 5.0);
      const h = floors * floorH;
      const w = range(random, 16, 44);
      const d = w * range(random, 0.7, 1.3);
      const gy = groundAt(frame.position.x, frame.position.z, frame.position.y);

      const yaw = Math.atan2(-side * frame.normal.x, -side * frame.normal.z) + range(random, -0.3, 0.3);
      _e.set(0, yaw, 0);
      _q.setFromEuler(_e);
      _p.set(frame.position.x, gy - 1, frame.position.z);
      _m.compose(_p, _q, _s);

      push(buckets.silhouette, box(w, h, d, 0, h * 0.5, 0), _m);
      // a second, slimmer mass on top so the profile is not a rectangle
      if (random() < 0.6) {
        const t2 = range(random, 0.4, 0.75);
        push(buckets.silhouette, box(w * t2, h * range(random, 0.15, 0.4), d * t2, 0, h + h * 0.1, 0), _m);
      }
      if (h > 120) {
        _v.set(0, h * 1.25, 0).applyMatrix4(_m);
        beaconSpots.push({ x: _v.x, y: _v.y, z: _v.z, phase: random() });
        stats.beacons++;
      }
      stats.silhouette++;
    }
  }

  /* --------------------------------------------------------------- frame ---- */

  function trackFrameLocal(t, lateral) {
    const tt = ((t % 1) + 1) % 1;
    curve.getPointAt(tt, _p);
    const px = _p.x, py = _p.y, pz = _p.z;
    curve.getTangentAt(tt, _t).normalize();
    _n.set(-_t.z, 0, _t.x);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0); else _n.normalize();
    return {
      position: new THREE.Vector3(px + _n.x * lateral, py, pz + _n.z * lateral),
      tangent: new THREE.Vector3(_t.x, 0, _t.z).normalize(),
      normal: _n.clone(),
    };
  }

  /* --------------------------------------------------------------- build ---- */

  const bandNear = {
    towersPer: budget.towersPer, pitch: 26,
    minFloors: 5, maxFloors: Math.round(budget.maxFloors * 0.42),
    minFoot: 15, maxFoot: 26, spireChance: 0.08,
    heightScale: tokyo ? 1.3 : 1, signChance: tokyo ? 0.6 : 0.34,
  };
  const bandMid = {
    towersPer: Math.max(2, Math.round(budget.towersPer * 0.8)), pitch: 34,
    minFloors: Math.round(budget.maxFloors * 0.35), maxFloors: budget.maxFloors,
    minFoot: 20, maxFoot: 34, spireChance: 0.26,
    heightScale: tokyo ? 1.3 : 1, signChance: tokyo ? 0.6 : 0.34,
  };

  for (let i = 0; i < Math.round(budget.blocks * density); i++) {
    const t = range(random, 0.01, 0.99);
    if (inGap(t)) continue;
    const side = random() < 0.5 ? 1 : -1;
    // Alternate between the near ring and a mid ring, so the city has depth:
    // low-rise against the fence, towers behind it.
    const mid = i % 2 === 1;
    const band = mid ? bandMid : bandNear;
    const base = mid ? range(random, 120, 210) : range(random, 30, 54);
    // A block that would stand on another part of the lap is pushed further out;
    // if even that is not enough, the block is dropped.
    for (let attempt = 0; attempt < 3; attempt++) {
      const distance = base + attempt * 70;
      const probe = trackFrameLocal(t, side * (width * 0.5 + distance));
      if (lapClear(probe.position.x, probe.position.z, t, width * 0.5 + 26)) {
        buildBlock(t, side * (width * 0.5 + distance), band);
        break;
      }
    }
  }

  buildSilhouette(Math.round(budget.silhouette * density));

  /* --------------------------------------------------------------- merge ---- */

  function attach(list, material, name, cast = true) {
    const geo = mergeAll(list);
    if (!geo) return null;
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

  attach(buckets.structure, concrete, 'TowerShafts');
  attach(buckets.dark, dark, 'TowerCornices');
  attach(buckets.steel, steel, 'RooftopPlant');
  attach(buckets.painted, painted, 'RooftopDishes');
  for (let i = 0; i < FACADES.length; i++) attach(buckets.windows[i], facadeMats[i], `CurtainWall${i}`);
  for (let i = 0; i < SIGN_COLORS.length; i++) attach(signBuckets[i], signMats[i], `BladeSigns${i}`);
  attach(buckets.silhouette, silhouetteMat, 'DistantSkyline', false);

  /* -------------------------------------------------------------- beacons ---- */

  let beaconMesh = null;
  if (beaconSpots.length) {
    const tex = getGlowTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xff3524,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(7, 7);
    beaconMesh = new THREE.InstancedMesh(geo, mat, beaconSpots.length);
    beaconMesh.name = 'AviationBeacons';
    beaconMesh.frustumCulled = false;
    beaconMesh.renderOrder = 3;
    group.add(beaconMesh);
    disposables.push(geo, mat);
    stats.meshes++;
  }

  /* --------------------------------------------------------------- update ---- */

  let elapsed = 0;
  const _bm = new THREE.Matrix4();
  const _bp = new THREE.Vector3();
  const _bs = new THREE.Vector3();
  const _bup = new THREE.Vector3(0, 1, 0);
  let _haveCam = false;

  /**
   * Per-frame: ramp the lit windows with the hour, twinkle the facade variants
   * out of phase, and blink the aviation beacons. No allocation.
   */
  function update(dt, ctx = {}) {
    const step = Math.min(Math.max(dt || 0, 0), 0.25);
    elapsed += step;

    const isNight = ctx && ctx.isNight != null ? !!ctx.isNight : night;
    const target = isNight ? 1.25 : 0.05;
    for (let i = 0; i < facadeMats.length; i++) {
      const m = facadeMats[i];
      const flicker = isNight ? 1 + Math.sin(elapsed * 0.6 + facadePhase[i]) * 0.06 : 1;
      const want = target * flicker;
      m.emissiveIntensity += (want - m.emissiveIntensity) * Math.min(1, step * 1.6);
    }

    if (beaconMesh) {
      // A beacon is a billboard, so it needs the camera; without one the quads
      // simply stay in their last orientation rather than pointing at nothing.
      const cam = ctx && ctx.camera ? ctx.camera : null;
      if (cam && cam.position) _haveCam = true;

      for (let i = 0; i < beaconSpots.length; i++) {
        const b = beaconSpots[i];
        const phase = (b.phase + elapsed / 1.9) % 1;
        // a hard flash, then dark: an aviation beacon is a strobe, not a glow
        const lit = phase < 0.1 ? 1 : (phase < 0.16 ? 0.35 : 0);
        _bp.set(b.x, b.y, b.z);
        if (_haveCam) _bm.lookAt(_bp, cam.position, _bup);
        else _bm.identity();
        const s = (0.35 + lit) * 1.4;
        _bs.set(s, s, s);
        _bm.scale(_bs);
        _bm.setPosition(_bp);
        beaconMesh.setMatrixAt(i, _bm);
      }
      beaconMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* -------------------------------------------------------------- dispose ---- */

  function dispose() {
    while (group.children.length) group.remove(group.children[0]);
    for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
    disposables.length = 0;
    stats.meshes = 0;
    stats.tris = 0;
  }

  return {
    group,
    stats,
    update,
    dispose,
    setQuality(name) { void name; },
    setTheme(name) { void name; },
    get beacons() { return beaconSpots.length; },
  };
}

export default { createSkyline };
