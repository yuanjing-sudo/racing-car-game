import * as THREE from 'three';

import { seededRandom, pick, range, mergeAll, bake, box, cylinder } from './geometry.js';
import {
  getWoodMaterial,
  getConcreteMaterial,
  getMetalMaterial,
  getDarkMetalMaterial,
  getPaintedMetalMaterial,
  TIME_UNIFORM,
} from './materials.js';
import { getTerrainHeight } from '../track.js';
import { createNoise2D } from '../utils.js';

/**
 * rural.js — the land either side of a country road.
 *
 * `props.js` builds the circuit and `skyline.js` builds the city that replaces
 * the horizon. This module builds the *country*: the patchwork of fields, the
 * hedges and fences that divide them, the farmsteads, and the leaves — both the
 * ones still on the trees and the ones that have fallen on the verge.
 *
 * Why it is its own module
 * ------------------------
 * Farmland is the one theme where the ground is not a backdrop. A field has
 * *rows*, they run in a direction, and they are the same width from the fence to
 * the horizon; get that wrong and the whole thing reads as a green plane. So the
 * fields here are real tessellated surfaces whose vertices are pushed down onto
 * the terrain the game actually renders, with UVs measured in metres so a crop
 * row is a physical width at any distance.
 *
 * The pieces
 * ----------
 *   - **Fields**: strips laid out in lap space on alternating sides, each one
 *     gridded, dropped onto the terrain, and textured with one of six crops
 *     (wheat, pasture, plough, maize, rape, fallow). One texture tile is 8 m of
 *     ground, so the row spacing is a number rather than an accident.
 *   - **Hedgerows and fences**: the boundaries, instanced loaves and
 *     post-and-wire runs, seated on the same terrain sampler so they follow the
 *     hills.
 *   - **Farmsteads**: barns with hip roofs, corrugated silos with ladders, a
 *     farmhouse whose windows light up after dark, and a windpump whose rotor
 *     turns per frame — the animated detail of the theme.
 *   - **Leaves**: canopies built from *leaf clumps* — alpha-cut card clusters
 *     rather than spheres — plus fallen litter along the verge. The canopy and
 *     hedge materials have a two-frequency gust injected into `begin_vertex`,
 *     phased per instance (or per world position for the merged canopies) so a
 *     stand of trees never sways in lock-step.
 *   - **Telegraph poles** along the verge, because no country road has ever
 *     existed without them.
 *
 * Terrain
 * -------
 * Hills come from `getTerrainHeight(x, z, theme, noise)` in `track.js`, using the
 * *track's own seed*, so this module seats its fields on exactly the surface the
 * rest of the game draws. No floating barns. (See the `seed` option: it must be
 * the unmangled track seed, not a per-module one.)
 *
 * Cost
 * ----
 * Six field meshes, five instanced sets, and eight merged meshes: about twenty
 * draw calls for a whole countryside. The per-frame work is a handful of rotor
 * rotations and one uniform write.
 *
 * Not verified visually: written and checked on a phone with no browser. See
 * README.
 */

/* ------------------------------------------------------------------ helpers ---- */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function textureFrom(canvas) {
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Draw one leaf as a pair of quadratic curves with a midrib. */
function drawLeaf(ctx, x, y, len, wid, rot, fill, vein) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wid, len * 0.34, 0, len);
  ctx.quadraticCurveTo(-wid, len * 0.34, 0, 0);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (vein) {
    ctx.strokeStyle = vein;
    ctx.lineWidth = Math.max(1, len * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, len * 0.08);
    ctx.lineTo(0, len * 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

/* -------------------------------------------------------------- crop tiles ---- */

/**
 * Crops. `rows` is how many crop rows one tile holds, and one tile is
 * HINT_METRES of ground — so wheat has a row about every metre and pasture has
 * none. Rows run along the tile's V axis, which in lap space is *along the
 * circuit*: the way a farmer would work a field beside a road.
 */
const HINT_METRES = 8;

const CROPS = [
  {
    key: 'wheat', ground: [176, 150, 84], row: [216, 190, 108], shadow: [138, 112, 58],
    rows: 8, jitter: 0.5, stubble: true, roughness: 0.94,
  },
  {
    key: 'pasture', ground: [86, 118, 58], row: [104, 138, 70], shadow: [62, 88, 42],
    rows: 0, jitter: 0, stubble: true, roughness: 0.98,
  },
  {
    key: 'plough', ground: [104, 78, 56], row: [126, 96, 68], shadow: [72, 52, 38],
    rows: 6, jitter: 0.3, stubble: false, roughness: 0.96,
  },
  {
    key: 'maize', ground: [74, 112, 48], row: [96, 140, 58], shadow: [52, 80, 34],
    rows: 7, jitter: 0.7, stubble: true, roughness: 0.9,
  },
  {
    key: 'rape', ground: [196, 188, 66], row: [226, 216, 88], shadow: [156, 146, 48],
    rows: 5, jitter: 0.4, stubble: true, roughness: 0.9,
  },
  {
    key: 'fallow', ground: [138, 130, 96], row: [156, 146, 108], shadow: [108, 100, 74],
    rows: 0, jitter: 0, stubble: false, roughness: 0.97,
  },
];

/**
 * Paint one crop tile: ground, rows, and enough irregularity that eight metres of
 * texture does not read as a pattern when it repeats across a whole field.
 *
 * @param {object} crop entry of CROPS
 * @param {Function} random deterministic
 */
function cropTexture(crop, random) {
  const S = 128;
  const canvas = makeCanvas(S, S);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  const [gr, gg, gb] = crop.ground;
  ctx.fillStyle = `rgb(${gr},${gg},${gb})`;
  ctx.fillRect(0, 0, S, S);

  // Ground mottling, so bare earth is not a flat fill.
  for (let i = 0; i < 320; i++) {
    const x = random() * S;
    const y = random() * S;
    const k = 0.86 + random() * 0.28;
    ctx.fillStyle = `rgba(${Math.round(gr * k)},${Math.round(gg * k)},${Math.round(gb * k)},0.55)`;
    ctx.fillRect(x, y, 2 + random() * 5, 1 + random() * 3);
  }

  if (crop.rows > 0) {
    const pitch = S / crop.rows;
    for (let r = 0; r < crop.rows; r++) {
      const yy = r * pitch;
      ctx.fillStyle = `rgb(${crop.row[0]},${crop.row[1]},${crop.row[2]})`;
      ctx.fillRect(0, yy, S, pitch * 0.42);
      ctx.fillStyle = `rgb(${crop.shadow[0]},${crop.shadow[1]},${crop.shadow[2]})`;
      ctx.fillRect(0, yy + pitch * 0.42, S, pitch * 0.3);
      // broken edges: a crop row is never a ruled line
      const breaks = 6 + Math.floor(random() * 10);
      for (let b = 0; b < breaks; b++) {
        ctx.fillStyle = `rgba(${gr},${gg},${gb},${(0.25 + random() * 0.5).toFixed(2)})`;
        ctx.fillRect(random() * S, yy, 3 + random() * 12, pitch * crop.jitter);
      }
      // individual plants standing proud of the ridge
      for (let p = 0; p < crop.rows * 3; p++) {
        ctx.fillStyle = `rgba(${Math.min(255, crop.row[0] + 26)},${Math.min(255, crop.row[1] + 26)},${Math.min(255, crop.row[2] + 18)},0.8)`;
        ctx.fillRect(random() * S, yy - 1, 1, 2 + random() * 2);
      }
    }
  } else {
    // Pasture and fallow: tussocks and bare patches.
    for (let i = 0; i < 260; i++) {
      const x = random() * S;
      const y = random() * S;
      ctx.strokeStyle = `rgba(${Math.min(255, crop.row[0] + 20)},${Math.min(255, crop.row[1] + 20)},${crop.row[2]},0.75)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 3, y - (2 + random() * 5));
      ctx.stroke();
    }
  }

  if (crop.stubble) {
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = `rgba(232,222,186,${(0.12 + random() * 0.3).toFixed(2)})`;
      ctx.fillRect(random() * S, random() * S, 1, 2 + random() * 3);
    }
  }

  return textureFrom(canvas);
}

/* ------------------------------------------------------------ leaf textures ---- */

const LEAF_PALETTES = {
  summer: [[74, 128, 52], [96, 150, 62], [58, 108, 44], [110, 162, 74], [46, 92, 40]],
  autumn: [[186, 122, 40], [206, 154, 52], [158, 82, 34], [222, 186, 88], [140, 96, 46]],
  hedge: [[46, 86, 40], [58, 100, 48], [38, 74, 34], [70, 112, 54]],
};

/**
 * A clump of leaves on a transparent background, used as an alpha-cut card. Cards
 * of clumps, not of single leaves: a canopy of single leaves is thousands of draws
 * and the difference is invisible at race speed.
 *
 * @param {string} palette key of LEAF_PALETTES
 * @param {number} count leaves in the clump
 * @param {Function} random deterministic
 */
function leafClumpTexture(palette, count, random) {
  const S = 128;
  const canvas = makeCanvas(S, S);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const cols = LEAF_PALETTES[palette] || LEAF_PALETTES.summer;

  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.pow(random(), 0.6) * S * 0.36;
    const len = 20 + random() * 30;
    const col = pick(random, cols);
    const k = 0.85 + random() * 0.35;
    drawLeaf(
      ctx,
      S * 0.5 + Math.cos(a) * r,
      S * 0.5 + Math.sin(a) * r * 0.85,
      len, len * (0.3 + random() * 0.18), random() * Math.PI * 2,
      `rgb(${Math.round(col[0] * k)},${Math.round(col[1] * k)},${Math.round(col[2] * k)})`,
      `rgba(${Math.round(col[0] * 0.55)},${Math.round(col[1] * 0.55)},${Math.round(col[2] * 0.55)},0.9)`
    );
  }

  // Fade the card's rim out, so the alpha cut has a ragged edge, not a square.
  const g = ctx.createRadialGradient(S * 0.5, S * 0.5, S * 0.18, S * 0.5, S * 0.5, S * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';

  return textureFrom(canvas);
}

/* ----------------------------------------------------------------- sway ---- */

/**
 * Inject a two-frequency wind gust into a stock material. The phase comes from the
 * instance matrix when there is one and from the vertex's own position otherwise,
 * so one shader covers both the instanced hedges and the merged canopies. Driven
 * by the shared clock in `materials.js`: one uniform write a frame, however many
 * leaves there are.
 */
function applyLeafSway(material, amount, key) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLeafTime = TIME_UNIFORM;
    shader.uniforms.uLeafSway = { value: amount };
    shader.vertexShader = 'uniform float uLeafTime;\nuniform float uLeafSway;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float leafPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.29;
      #else
        float leafPhase = transformed.x * 0.37 + transformed.z * 0.29;
      #endif
      float leafHeight = clamp(transformed.y * 0.5 + 0.5, 0.0, 1.0);
      float gust = sin(uLeafTime * 1.32 + leafPhase) * 0.62
                 + sin(uLeafTime * 3.07 + leafPhase * 1.7) * 0.38;
      transformed.x += gust * uLeafSway * leafHeight;
      transformed.z += gust * uLeafSway * 0.6 * leafHeight;`
    );
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/* ------------------------------------------------------------------ geometry ---- */

/**
 * A canopy: `cards` alpha-cut quads scattered through an ellipsoid, so the
 * silhouette is made of leaf clumps rather than of a smooth ball.
 */
function canopyGeometry({ radius = 2.6, cards = 18, droop = 0.62, random = Math.random } = {}) {
  const r = radius;
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const a = random() * Math.PI * 2;
    const y = random() * 2 - 1;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const size = r * (0.62 + random() * 0.5);
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateX(-Math.PI * 0.5 + range(random, -0.9, 0.9));
    g.rotateY(random() * Math.PI * 2);
    g.rotateZ(range(random, -0.6, 0.6));
    g.translate(Math.cos(a) * ring * r, y * r * droop, Math.sin(a) * ring * r);
    parts.push(g);
  }
  const merged = mergeAll(parts);
  if (merged) merged.computeVertexNormals();
  return merged;
}

/** A hip roof: a 4-sided pyramid, squashed to the building's footprint. */
function hipRoofGeometry(w, d, roofH) {
  const span = Math.max(w, d);
  const g = new THREE.CylinderGeometry(0, span * Math.SQRT1_2, roofH, 4, 1, false);
  g.rotateY(Math.PI * 0.25);
  g.scale(w / span, 1, d / span);
  g.translate(0, roofH * 0.5, 0);
  return g;
}

/** A hedge: the rounded loaf a hedgerow is built from. */
function hedgeGeometry(length = 3.0, height = 1.7, depth = 1.25, random = Math.random) {
  const parts = [];
  parts.push(box(length, height * 0.62, depth, 0, height * 0.31, 0));
  const crown = new THREE.CylinderGeometry(depth * 0.5, depth * 0.5, length, 8, 1, false);
  crown.rotateZ(Math.PI * 0.5);
  crown.scale(1, 1, height * 0.5 / (depth * 0.5));
  crown.translate(0, height * 0.62, 0);
  parts.push(crown);
  for (let i = 0; i < 2; i++) {
    const s = new THREE.SphereGeometry(depth * (0.42 + random() * 0.2), 7, 5);
    s.translate(range(random, -length * 0.35, length * 0.35), height * 0.6, range(random, -0.12, 0.12));
    parts.push(s);
  }
  return mergeAll(parts);
}

/** Post-and-wire fence: two posts and two wires, instanced along a boundary. */
function fenceGeometry(span = 3.0, height = 1.1) {
  const parts = [];
  parts.push(box(0.12, height, 0.12, -span * 0.5, height * 0.5, 0));
  parts.push(box(0.12, height, 0.12, span * 0.5, height * 0.5, 0));
  for (const y of [height * 0.55, height * 0.92]) {
    parts.push(box(span, 0.035, 0.035, 0, y, 0));
  }
  return mergeAll(parts);
}

/** A classic telegraph pole with two crossarms and their insulators. */
function poleGeometry(height = 8.4) {
  const parts = [];
  parts.push(cylinder(0.13, 0.19, height, 7, 0, height * 0.5, 0));
  for (let i = 0; i < 2; i++) {
    const y = height - 0.5 - i * 0.8;
    parts.push(box(2.1 - i * 0.4, 0.12, 0.12, 0, y, 0));
    for (const sx of [-1, 1]) {
      parts.push(cylinder(0.05, 0.05, 0.2, 5, sx * (0.95 - i * 0.18), y + 0.14, 0));
    }
  }
  return mergeAll(parts);
}

/** A round hay bale, lying on its side and banded. */
function baleGeometry(radius = 0.68, length = 1.25) {
  const parts = [cylinder(radius, radius, length, 12, 0, 0, 0, 0, Math.PI * 0.5)];
  for (const ox of [-0.34, 0.34]) {
    const band = new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, 0.07, 12, 1, true);
    band.rotateZ(Math.PI * 0.5);
    band.translate(ox, 0, 0);
    parts.push(band);
  }
  return mergeAll(parts);
}

/* ------------------------------------------------------------------ factory ---- */

/**
 * Build the countryside (or forest) around one circuit.
 *
 * @param {object} opts
 * @param {string} [opts.theme='countryside']  `countryside` or `forest`
 * @param {number} [opts.seed=42]              the *track* seed, so terrain matches
 * @param {THREE.Curve} opts.curve             centreline
 * @param {number} [opts.width=12]             track width in metres
 * @param {Array} [opts.gapZones]              pit / tunnel spans to keep clear
 * @param {string} [opts.quality='high']       low | medium | high | ultra
 * @param {number} [opts.density=1]            global multiplier
 * @param {boolean} [opts.autumn=false]        orange canopies, heavy leaf fall
 * @returns {{ group: THREE.Group, stats: object, update: Function, dispose: Function }}
 */
export function createRural(opts = {}) {
  const theme = opts.theme || 'countryside';
  const quality = opts.quality || 'high';
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const curve = opts.curve || null;
  const width = opts.width || 12;
  const gapZones = opts.gapZones || [];
  const density = clamp(opts.density != null ? opts.density : 1, 0.2, 2.5);
  const autumn = !!opts.autumn;

  const isRural = theme === 'countryside' || theme === 'forest';
  const forest = theme === 'forest';
  const random = seededRandom(seed ^ 0x7a11f3);

  const group = new THREE.Group();
  group.name = `Rural:${theme}`;

  const stats = {
    fields: 0, trees: 0, hedges: 0, fences: 0, farms: 0, buildings: 0, poles: 0,
    bales: 0, litter: 0, windpumps: 0, meshes: 0, tris: 0,
  };

  const disposables = [];
  const rotors = [];

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

  if (!isRural || !curve || typeof curve.getPointAt !== 'function') return empty;

  /* ------------------------------------------------------------- budget ---- */

  const BUDGET = {
    low: { fields: 5, trees: 55, hedges: 22, fences: 6, farms: 1, poles: 10, bales: 10, litter: 110, windpumps: 1 },
    medium: { fields: 8, trees: 100, hedges: 38, fences: 11, farms: 2, poles: 16, bales: 20, litter: 200, windpumps: 1 },
    high: { fields: 11, trees: 150, hedges: 52, fences: 16, farms: 3, poles: 22, bales: 30, litter: 290, windpumps: 2 },
    ultra: { fields: 15, trees: 210, hedges: 70, fences: 22, farms: 4, poles: 30, bales: 42, litter: 390, windpumps: 2 },
  };
  const budget = BUDGET[quality] || BUDGET.high;

  /* -------------------------------------------------------------- terrain ---- */

  // The same noise the track was built with: `createTrack` does
  // `createNoise2D(seed)` and the terrain mesh is drawn from
  // `getTerrainHeight(..., noise)`, so seeding identically seats everything here
  // on the surface the player is actually looking at.
  const noise = createNoise2D(seed);

  function groundAt(x, z) {
    const y = getTerrainHeight(x, z, theme, noise);
    return Number.isFinite(y) ? y : 0;
  }

  let lapLength = 1000;
  try { lapLength = curve.getLength() || 1000; } catch (e) { lapLength = 1000; }
  if (!isFinite(lapLength) || lapLength < 10) lapLength = 1000;

  const inGap = (t) => gapZones.some((g) => t >= g.tStart && t <= g.tEnd);

  /**
   * A lap is a closed loop, so the road passes near itself: a tower 40 m off the
   * centreline at t = 0.3 can be standing on the road at t = 0.72. Everything
   * large is therefore tested against the whole centreline, not just the local
   * frame. The samples are hashed into 48 m cells, so a query only visits the
   * nine cells that could hold a point within the radius.
   *
   * @returns {Function} (x, z, t, radius) => true when the spot is clear of any
   *   part of the lap other than its own neighbourhood.
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
    const cellOf = (v) => Math.floor(v / CELL);
    return function lapClear(x, z, t, radius) {
      const own = ((t % 1) + 1) % 1;
      const cx = cellOf(x);
      const cz = cellOf(z);
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

  /**
   * A pit lane or a tunnel mouth is a short span, and dropping content into one is
   * right for scattered props but wrong for fields: a countryside with no fields
   * because three slots happened to land in three gaps is a bug, not a look. So
   * field patches nudge outward until they clear the nearest gap. Returns null only
   * if the whole lap is a gap, which cannot happen.
   */
  function nudgeOutOfGap(t) {
    const start = ((t % 1) + 1) % 1;
    if (!inGap(start)) return start;
    for (let k = 1; k <= 40; k++) {
      const d = k * 0.005;
      const a = (start + d) % 1;
      if (!inGap(a)) return a;
      const b = (start - d + 1) % 1;
      if (!inGap(b)) return b;
    }
    return null;
  }

  /* ------------------------------------------------------------ materials ---- */

  const barnWoodMat = getWoodMaterial(0x6d4a2a);
  const houseMat = getConcreteMaterial(196, 33);
  const slateMat = getDarkMetalMaterial();
  const steelMat = getMetalMaterial(0x9aa1a8, 0.42);
  const paintedMat = getPaintedMetalMaterial(0xb8402f, 0.5, 0.25);
  const fenceMat = getWoodMaterial(0x7d6b4f);
  const poleMat = getWoodMaterial(0x5f4a30);

  const baleMat = new THREE.MeshStandardMaterial({ color: 0xd8c37a, roughness: 0.95, metalness: 0.0 });
  disposables.push(baleMat);

  // Farmhouse windows: the only light in the theme that is not the sun.
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x2a2118, emissive: 0xffcf8a, emissiveIntensity: 0.05,
    roughness: 0.3, metalness: 0.0, toneMapped: false,
  });
  disposables.push(windowMat);

  const cropMaterials = CROPS.map((crop, i) => {
    const tex = cropTexture(crop, seededRandom(seed ^ (0x2b1 + i * 131)));
    const m = new THREE.MeshStandardMaterial({
      map: tex, roughness: crop.roughness, metalness: 0.0,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    if (tex) disposables.push(tex);
    disposables.push(m);
    return m;
  });

  const canopyMat = new THREE.MeshStandardMaterial({
    map: leafClumpTexture(autumn ? 'autumn' : 'summer', 26, seededRandom(seed ^ 0x5ab1)),
    color: forest ? 0xcfdcbe : 0xffffff,
    roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide, alphaTest: 0.42,
  });
  applyLeafSway(canopyMat, forest ? 0.14 : 0.19, 'rural-canopy');
  if (canopyMat.map) disposables.push(canopyMat.map);
  disposables.push(canopyMat);

  const litterMat = new THREE.MeshStandardMaterial({
    map: leafClumpTexture('autumn', 9, seededRandom(seed ^ 0x1ca7)),
    roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide, alphaTest: 0.4,
  });
  if (litterMat.map) disposables.push(litterMat.map);
  disposables.push(litterMat);

  const hedgeMat = new THREE.MeshStandardMaterial({
    map: leafClumpTexture('hedge', 30, seededRandom(seed ^ 0x4ed)),
    roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide, alphaTest: 0.4,
  });
  applyLeafSway(hedgeMat, 0.08, 'rural-hedge');
  if (hedgeMat.map) disposables.push(hedgeMat.map);
  disposables.push(hedgeMat);

  /* ------------------------------------------------- shared instance shapes ---- */

  const hedgeGeo = hedgeGeometry(3.0, 1.7, 1.25, random);
  const fenceGeo = fenceGeometry(3.0, 1.1);
  const poleGeo = poleGeometry(8.4);
  const baleGeo = baleGeometry(0.68, 1.25);
  const litterGeo = new THREE.PlaneGeometry(0.42, 0.42);
  litterGeo.rotateX(-Math.PI * 0.5);
  // One canopy card cluster, reused by every tree at its own scale: the whole
  // stand of trees is then a single instanced draw.
  const canopyGeo = canopyGeometry({
    radius: 1,
    cards: quality === 'low' ? 12 : 20,
    droop: 0.62,
    random,
  });

  /* --------------------------------------------------------------- buckets ---- */

  const cropBuckets = CROPS.map(() => []);
  const rest = {
    barn: [], silo: [], house: [], roof: [], window: [], concrete: [], steel: [], painted: [],
  };
  const hedgeBucket = [];
  const fenceBucket = [];
  const poleBucket = [];
  const baleBucket = [];
  const litterBucket = [];
  const trunkParts = [];
  const canopyBucket = [];

  /* ------------------------------------------------------------- placement ---- */

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);

  /**
   * A world point at (t, lateral) seated on the terrain. The curve's lateral
   * normal is used directly, so a negative lateral is the left-hand side.
   */
  function seat(t, lateral, yLift = 0) {
    const tt = ((t % 1) + 1) % 1;
    curve.getPointAt(tt, _p);
    curve.getTangentAt(tt, _t).normalize();
    _n.set(-_t.z, 0, _t.x);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0); else _n.normalize();
    const x = _p.x + _n.x * lateral;
    const z = _p.z + _n.z * lateral;
    return { x, y: groundAt(x, z) + yLift, z, nx: _n.x, nz: _n.z, tx: _t.x, tz: _t.z };
  }

  /** Bake a geometry at a world pose and file it in a bucket for later merging. */
  function placeInto(bucket, geometry, at, yaw = 0, scale = 1) {
    if (!geometry) return;
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _v.set(at.x, at.y, at.z);
    _s.set(scale, scale, scale);
    _m.compose(_v, _q, _s);
    bucket.push(bake(geometry, _m));
  }

  /** Same, but returning the matrix so an InstancedMesh can be filled directly. */
  function poseMatrix(at, yaw = 0, scale = 1) {
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _v.set(at.x, at.y, at.z);
    _s.set(scale, scale, scale);
    return new THREE.Matrix4().compose(_v, _q, _s);
  }

  /* ----------------------------------------------------------------- fields ---- */

  /**
   * One field: a gridded surface in lap space whose vertices are dropped onto the
   * terrain, UV-mapped in metres so one tile of crop is HINT_METRES of ground and
   * the rows are therefore a real width apart.
   */
  function buildField(cropIndex, u0, u1, l0, l1, cellsU, cellsV) {
    const alongSpan = Math.abs(u1 - u0) * lapLength;
    const acrossSpan = Math.abs(l1 - l0);
    const stride = cellsV + 1;
    const positions = new Array(stride * (cellsU + 1) * 3);
    const uvs = new Array(stride * (cellsU + 1) * 2);
    const indices = [];
    const blocked = new Uint8Array(stride * (cellsU + 1));
    const roadClear = width * 0.5 + 5;

    let vi = 0;
    for (let i = 0; i <= cellsU; i++) {
      const u = lerp(u0, u1, i / cellsU);
      for (let j = 0; j <= cellsV; j++) {
        const s = seat(u, lerp(l0, l1, j / cellsV), 0.06);
        positions[vi * 3] = s.x;
        positions[vi * 3 + 1] = s.y;
        positions[vi * 3 + 2] = s.z;
        uvs[vi * 2] = (j / cellsV) * (acrossSpan / HINT_METRES);
        uvs[vi * 2 + 1] = (i / cellsU) * (alongSpan / HINT_METRES);
        // A field is a big surface on a closed lap: drop the cells that fall on
        // some other part of the circuit rather than paving over the road.
        if (!lapClear(s.x, s.z, u, roadClear)) blocked[vi] = 1;
        vi++;
      }
    }
    for (let i = 0; i < cellsU; i++) {
      for (let j = 0; j < cellsV; j++) {
        const a = i * stride + j;
        const b = a + stride;
        if (blocked[a] || blocked[a + 1] || blocked[b] || blocked[b + 1]) continue;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    cropBuckets[cropIndex].push(geo);
    stats.fields++;
  }

  /**
   * A patchwork: a few strips side by side on one side of the road, each with its
   * own crop, separated by a headland the hedgerow then occupies.
   */
  function buildFieldPatch(t, side, maxStrips) {
    const strips = 1 + Math.floor(random() * maxStrips);
    let lat = range(random, width * 0.5 + 7, width * 0.5 + 16);
    for (let s = 0; s < strips; s++) {
      const uLen = range(random, 0.016, 0.05);
      const widthM = range(random, 34, 96);
      const latA = side * lat;
      const latB = side * (lat + widthM);
      const cropIndex = Math.floor(random() * CROPS.length);
      const cellsU = Math.max(2, Math.round((uLen * lapLength) / 12));
      const cellsV = Math.max(2, Math.round(widthM / 12));
      buildField(cropIndex, t, t + uLen, Math.min(latA, latB), Math.max(latA, latB), cellsU, cellsV);
      lat += widthM + range(random, 1.5, 4.5);
      if (lat > 190) break;
    }
  }

  /* ---------------------------------------------------------------- trees ---- */

  /**
   * A broadleaf: a trunk with three branches, and a canopy built from leaf-clump
   * cards. The canopies are instanced from one shared card cluster, so the sway
   * shader can phase them from their own instance matrix and scale them from the
   * ground with the `leafHeight` term in local space.
   */
  function buildTree(at, height) {
    const trunkH = height * 0.42;
    trunkParts.push(bake(
      cylinder(height * 0.022, height * 0.036, trunkH, 6, 0, trunkH * 0.5, 0),
      poseMatrix(at, random() * Math.PI * 2, 1)
    ));
    for (let i = 0; i < 3; i++) {
      const a = random() * Math.PI * 2;
      const b = cylinder(height * 0.012, height * 0.021, height * 0.24, 5);
      b.rotateZ(range(random, 0.5, 0.9));
      b.rotateY(a);
      b.translate(0, height * 0.12, 0);
      trunkParts.push(bake(b, poseMatrix({ x: at.x, y: at.y + trunkH, z: at.z }, random() * Math.PI * 2, 1)));
    }

    const cr = height * (forest ? 0.4 : 0.34);
    canopyBucket.push(poseMatrix(
      { x: at.x, y: at.y + trunkH + height * 0.2, z: at.z },
      random() * Math.PI * 2, cr
    ));
    stats.trees++;
  }

  /* ------------------------------------------------------------ buildings ---- */

  /** A barn: boarded walls under a hip roof, with an apron and a big door. */
  function buildBarn(at, yaw, scale) {
    const w = 13 * scale;
    const h = 5.4 * scale;
    const d = 8.5 * scale;
    const roofH = 3.4 * scale;
    const M = poseMatrix(at, yaw, 1);

    rest.concrete.push(bake(box(w + 3, 0.18, d + 3, 0, 0.09, 0), M));
    rest.barn.push(bake(box(w, h, d, 0, h * 0.5, 0), M));
    rest.roof.push(bake(hipRoofGeometry(w, d, roofH), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, h, 0))));
    // eaves fascia
    rest.roof.push(bake(box(w + 0.5, 0.18, d + 0.5, 0, h + 0.05, 0), M));
    // the big doors, and a hayloft hatch above them
    rest.roof.push(bake(box(w * 0.34, h * 0.72, 0.22, 0, h * 0.36, d * 0.5 + 0.06), M));
    rest.roof.push(bake(box(w * 0.2, h * 0.2, 0.22, 0, h * 0.86, d * 0.5 + 0.06), M));
    if (random() < 0.6) {
      const lw = w * 0.3;
      const sx = random() < 0.5 ? 1 : -1;
      rest.barn.push(bake(box(lw, h * 0.55, d * 0.68, sx * (w * 0.5 + lw * 0.5), h * 0.275, 0), M));
      rest.roof.push(bake(box(lw + 0.5, 0.18, d * 0.72, sx * (w * 0.5 + lw * 0.5), h * 0.56, 0), M));
    }
    stats.buildings++;
    return { x: at.x, z: at.z, yaw, w, d, scale };
  }

  /** A silo: corrugated drum, domed cap, a ladder, and the fill pipe. */
  function buildSilo(at, yaw, scale) {
    const r = 2.3 * scale;
    const h = 11 * scale;
    const M = poseMatrix(at, yaw, 1);

    rest.silo.push(bake(cylinder(r, r, h, 16, 0, h * 0.5, 0), M));
    const dome = new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    dome.translate(0, h, 0);
    rest.silo.push(bake(dome, M));
    for (let i = 1; i < 7; i++) {
      const band = new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.1, 16, 1, true);
      band.translate(0, (h / 7) * i, 0);
      rest.steel.push(bake(band, M));
    }
    for (const sx of [-1, 1]) {
      rest.steel.push(bake(box(0.06, h, 0.06, sx * 0.24, h * 0.5, r + 0.12), M));
    }
    const rungs = Math.round(h / 0.34);
    for (let i = 0; i < rungs; i++) {
      rest.steel.push(bake(box(0.5, 0.05, 0.05, 0, 0.3 + i * 0.34, r + 0.12), M));
    }
    rest.steel.push(bake(cylinder(0.14, 0.14, h * 0.45, 6, r * 0.55, h + 0.3, 0, 0, 0.5), M));
    stats.buildings++;
  }

  /** A farmhouse: two storeys, a hip roof, a chimney, a porch, lit windows. */
  function buildFarmhouse(at, yaw, scale) {
    const w = 9.5 * scale;
    const h = 6.2 * scale;
    const d = 7.4 * scale;
    const roofH = 2.9 * scale;
    const M = poseMatrix(at, yaw, 1);

    rest.house.push(bake(box(w, h, d, 0, h * 0.5, 0), M));
    rest.roof.push(bake(hipRoofGeometry(w, d, roofH), M.clone().multiply(new THREE.Matrix4().makeTranslation(0, h, 0))));
    rest.roof.push(bake(box(w + 0.4, 0.16, d + 0.4, 0, h + 0.04, 0), M));
    rest.concrete.push(bake(box(0.85, roofH + 1.9, 0.85, w * 0.28, h + roofH * 0.35, 0), M));
    rest.house.push(bake(box(2.2, 2.4, 1.5, 0, 1.2, d * 0.5 + 0.6), M));
    rest.roof.push(bake(box(2.8, 0.2, 2.2, 0, 2.5, d * 0.5 + 0.6), M));

    const rows = [h * 0.26, h * 0.7];
    for (const sz of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        const wx = (i - 1) * w * 0.3;
        for (const wy of rows) {
          const pane = new THREE.PlaneGeometry(1.05 * scale, 1.22 * scale);
          pane.rotateY(sz > 0 ? 0 : Math.PI);
          pane.translate(wx, wy, sz * (d * 0.5 + 0.07));
          rest.window.push(bake(pane, M));
        }
      }
      // a door: dark, so it goes with the roofs rather than the glass
      const door = new THREE.PlaneGeometry(1.0 * scale, 2.1 * scale);
      door.rotateY(sz > 0 ? 0 : Math.PI);
      door.translate(-w * 0.3, 1.05 * scale, sz * (d * 0.5 + 0.07));
      rest.roof.push(bake(door, M));
    }
    for (const sx of [1, -1]) {
      for (const wy of rows) {
        const pane = new THREE.PlaneGeometry(1.05 * scale, 1.22 * scale);
        pane.rotateY(sx * Math.PI * 0.5);
        pane.translate(sx * (w * 0.5 + 0.07), wy, 0);
        rest.window.push(bake(pane, M));
      }
    }
    stats.buildings++;
  }

  /**
   * A windpump: a splayed lattice tower, a tail vane, and a rotor that actually
   * turns. The rotor is its own mesh (in a yaw pivot, so the spin axis stays
   * unambiguous) because it is the one thing in this module that moves per frame.
   */
  function buildWindpump(at, yaw, scale) {
    const H = 9.5 * scale;
    const spread = 1.9 * scale;
    const M = poseMatrix(at, yaw, 1);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = cylinder(0.06, 0.1, H, 5);
        leg.rotateZ(-sx * 0.075);
        leg.rotateX(sz * 0.075);
        leg.translate(sx * spread * 0.5, H * 0.5, sz * spread * 0.5);
        rest.steel.push(bake(leg, M));
      }
    }
    for (let i = 1; i <= 5; i++) {
      const y = (H / 6) * i;
      const k = 1 - (y / H) * 0.55;
      rest.steel.push(bake(box(spread * k, 0.05, 0.05, 0, y, 0), M));
      rest.steel.push(bake(box(0.05, 0.05, spread * k, 0, y, 0), M));
    }
    rest.steel.push(bake(cylinder(0.05, 0.05, H, 5, 0, H * 0.5, 0), M));
    rest.steel.push(bake(box(spread * 0.8, 0.08, spread * 0.8, 0, H, 0), M));
    rest.painted.push(bake(box(0.06, 1.5 * scale, 2.2 * scale, 0, H + 0.75 * scale, -1.5 * scale), M));

    const parts = [cylinder(0.22 * scale, 0.22 * scale, 0.3 * scale, 8, 0, 0, 0, Math.PI * 0.5)];
    for (let i = 0; i < 12; i++) {
      const blade = box(0.1 * scale, 0.54 * scale, 0.04 * scale, 0, 0.37 * scale, 0);
      blade.rotateY(0.42);
      blade.rotateZ((i / 12) * Math.PI * 2);
      parts.push(blade);
    }
    const rotorGeo = mergeAll(parts);
    if (rotorGeo) {
      const pivot = new THREE.Group();
      pivot.name = 'WindpumpPivot';
      pivot.position.set(at.x, at.y + H * 0.98, at.z);
      pivot.rotation.y = yaw;
      const rotor = new THREE.Mesh(rotorGeo, steelMat);
      rotor.name = 'WindpumpRotor';
      pivot.add(rotor);
      group.add(pivot);
      stats.meshes++;
      disposables.push(rotorGeo);
      rotors.push({ mesh: rotor, speed: range(random, 0.8, 1.8) * (random() < 0.5 ? 1 : -1) });
      stats.windpumps++;
    }
  }

  /* ================================================================= build ==== */

  // Fields first: they are the ground layer, and everything else is placed on the
  // terrain rather than on the fields, so the order only matters for the stats.
  const patches = Math.max(2, Math.round(budget.fields / 2));
  for (let i = 0; i < patches; i++) {
    const slot = (i + 0.5 + range(random, -0.3, 0.3)) / patches;
    const t = nudgeOutOfGap(slot);
    if (t == null) continue;
    buildFieldPatch(t, i % 2 === 0 ? 1 : -1, 3);
  }

  // Hedgerows: the field boundaries.
  const hedgeCount = Math.round(budget.hedges * density);
  for (let i = 0; i < hedgeCount; i++) {
    const t = range(random, 0.005, 0.995);
    if (inGap(t)) continue;
    const side = random() < 0.5 ? 1 : -1;
    const s = seat(t, side * range(random, width * 0.5 + 5, width * 0.5 + 150));
    if (!lapClear(s.x, s.z, t, width * 0.5 + 6)) continue;
    const yaw = Math.atan2(s.tx, s.tz) + range(random, -0.1, 0.1);
    hedgeBucket.push(poseMatrix({ x: s.x, y: s.y, z: s.z }, yaw, range(random, 0.85, 1.35)));
    stats.hedges++;
  }

  // Fences: short runs, so a boundary reads as a boundary.
  const fenceCount = Math.round(budget.fences * density);
  for (let i = 0; i < fenceCount; i++) {
    const t = range(random, 0.005, 0.995);
    if (inGap(t)) continue;
    const side = random() < 0.5 ? 1 : -1;
    const lat = side * range(random, width * 0.5 + 6, width * 0.5 + 120);
    const probe = seat(t, lat);
    if (!lapClear(probe.x, probe.z, t, width * 0.5 + 6)) continue;
    const run = 3 + Math.floor(random() * 7);
    for (let k = 0; k < run; k++) {
      const s = seat(t + k * 0.0022, lat);
      if (!lapClear(s.x, s.z, t + k * 0.0022, width * 0.5 + 6)) break;
      fenceBucket.push(poseMatrix({ x: s.x, y: s.y, z: s.z }, Math.atan2(s.tx, s.tz) + Math.PI * 0.5, 1));
      stats.fences++;
    }
  }

  // Trees: taller and much denser in the forest, scattered along the verge otherwise.
  const treeCount = Math.round((forest ? budget.trees * 1.7 : budget.trees) * density);
  for (let i = 0; i < treeCount; i++) {
    const t = range(random, 0.002, 0.998);
    if (inGap(t)) continue;
    const side = random() < 0.5 ? 1 : -1;
    const lat = side * range(random, width * 0.5 + (forest ? 6 : 9), width * 0.5 + (forest ? 125 : 95));
    const s = seat(t, lat);
    if (!lapClear(s.x, s.z, t, width * 0.5 + 8)) continue;
    buildTree({ x: s.x, y: s.y, z: s.z }, forest ? range(random, 9, 19) : range(random, 6, 13));
  }

  // Farmsteads: a yard with a barn, silos, a house and a windpump. Too few and too
  // large to drop, so one that lands on another part of the lap is pushed further
  // out of the way instead.
  for (let i = 0; i < Math.round(budget.farms * density); i++) {
    // Farmsteads are too few and too large to drop, so they nudge around a gap.
    const t = nudgeOutOfGap(range(random, 0.02, 0.98));
    if (t == null) continue;
    const side = random() < 0.5 ? 1 : -1;
    let yardAt = null;
    for (let attempt = 0; attempt < 4 && !yardAt; attempt++) {
      const s = seat(t, side * (width * 0.5 + 26 + attempt * 34));
      if (lapClear(s.x, s.z, t, width * 0.5 + 24)) yardAt = s;
    }
    if (!yardAt) continue;
    const base = yardAt;
    const yaw = Math.atan2(base.tx, base.tz) + range(random, -0.6, 0.6);
    const scale = range(random, 0.85, 1.15);
    const yard = buildBarn({ x: base.x, y: base.y, z: base.z }, yaw, scale);

    // Offsets are (along the road, outward from it) — not (right, forward).
    // Outward must stay positive, or the "yard" ends up in the racing line; and
    // every sub-building is re-tested, because a 30 m offset along the tangent
    // can still reach around a hairpin.
    const outX = side * base.nx;
    const outZ = side * base.nz;
    const spot = (along, outward) => {
      const x = yard.x + base.tx * along + outX * outward;
      const z = yard.z + base.tz * along + outZ * outward;
      return { x, y: groundAt(x, z), z };
    };
    const clear = (p) => lapClear(p.x, p.z, t, width * 0.5 + 8);

    const silos = 1 + Math.floor(random() * 2);
    for (let k = 0; k < silos; k++) {
      const p = spot(yard.w * 0.5 + 4.2 + k * 5.6, range(random, 0.5, 3.5));
      if (clear(p)) buildSilo(p, yaw, scale);
    }
    const house = spot(range(random, 18, 30) * (random() < 0.5 ? 1 : -1), range(random, 9, 17));
    if (clear(house)) buildFarmhouse(house, yaw + Math.PI * 0.5, scale);
    if (stats.windpumps < Math.round(budget.windpumps * density) && random() < 0.75) {
      const pump = spot(-range(random, 10, 22), range(random, 7, 17));
      if (clear(pump)) buildWindpump(pump, yaw, scale);
    }
    stats.farms++;
  }

  // Telegraph poles along the verge.
  const poleCount = Math.round(budget.poles * density);
  for (let i = 0; i < poleCount; i++) {
    const t = (i + 0.5) / poleCount + range(random, -0.004, 0.004);
    if (inGap(t)) continue;
    const side = i % 3 === 0 ? -1 : 1;
    const s = seat(t, side * range(random, width * 0.5 + 3.5, width * 0.5 + 6.5));
    if (!lapClear(s.x, s.z, t, width * 0.5 + 2.5)) continue;
    poleBucket.push(poseMatrix({ x: s.x, y: s.y, z: s.z }, Math.atan2(s.tx, s.tz), range(random, 0.92, 1.08)));
    stats.poles++;
  }

  // Hay bales in the fields.
  const baleCount = Math.round(budget.bales * density);
  for (let i = 0; i < baleCount; i++) {
    const t = range(random, 0.01, 0.99);
    if (inGap(t)) continue;
    const side = random() < 0.5 ? 1 : -1;
    const s = seat(t, side * range(random, width * 0.5 + 18, width * 0.5 + 110), 0.68);
    if (!lapClear(s.x, s.z, t, width * 0.5 + 6)) continue;
    baleBucket.push(poseMatrix({ x: s.x, y: s.y, z: s.z }, random() * Math.PI * 2, range(random, 0.9, 1.1)));
    stats.bales++;
  }

  // Fallen leaves, along the verge where the wind actually drops them.
  const litterCount = Math.round((autumn ? budget.litter * 1.6 : budget.litter * (forest ? 0.8 : 0.55)) * density);
  for (let i = 0; i < litterCount; i++) {
    const t = range(random, 0.002, 0.998);
    const side = random() < 0.5 ? 1 : -1;
    const s = seat(t, side * range(random, width * 0.5 - 0.5, width * 0.5 + 9), 0.03);
    litterBucket.push(poseMatrix({ x: s.x, y: s.y, z: s.z }, 0, range(random, 0.6, 1.35)));
    stats.litter++;
  }

  /* ============================================================== assemble ==== */

  /**
   * One InstancedMesh per (geometry, material) pair. `tint` is a [base, spread]
   * pair used for per-instance colour variation, which is what stops thirty
   * identical bales looking like thirty identical bales.
   */
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
        col.setRGB(k, k * (options.tint[2] || 1), k * (options.tint[3] || 1));
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

  /** One merged mesh for a whole bucket of world-baked geometry. */
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

  // Fields: one mesh per crop, whole fields merged into each.
  for (let i = 0; i < CROPS.length; i++) {
    const geo = mergeAll(cropBuckets[i]);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, cropMaterials[i]);
    mesh.name = `Field:${CROPS[i].key}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    group.add(mesh);
    stats.meshes++;
    stats.tris += geo.index ? geo.index.count / 3 : 0;
    disposables.push(geo);
  }

  // Foliage does not cast: an alpha-cut card in the depth pass is a black square,
  // and thirty black squares moving across the road is worse than no shadow.
  addInstanced(hedgeGeo, hedgeMat, hedgeBucket, 'Hedgerows', { cast: false, tint: [0.84, 0.3] });
  addInstanced(fenceGeo, fenceMat, fenceBucket, 'Fences', { tint: [0.86, 0.26] });
  addInstanced(poleGeo, poleMat, poleBucket, 'TelegraphPoles', { tint: [0.88, 0.24] });
  addInstanced(baleGeo, baleMat, baleBucket, 'HayBales', { tint: [0.88, 0.24] });
  addInstanced(litterGeo, litterMat, litterBucket, 'LeafLitter', { cast: false, tint: [0.8, 0.45] });
  addInstanced(canopyGeo, canopyMat, canopyBucket, 'TreeCanopies', { cast: false, tint: [0.84, 0.32] });

  addMerged(trunkParts, barnWoodMat, 'TreeTrunks');

  addMerged(rest.barn, barnWoodMat, 'Barns');
  addMerged(rest.silo, steelMat, 'Silos');
  addMerged(rest.house, houseMat, 'Farmhouses');
  addMerged(rest.roof, slateMat, 'FarmRoofs');
  addMerged(rest.concrete, houseMat, 'FarmChimneys');
  addMerged(rest.steel, steelMat, 'FarmSteel');
  addMerged(rest.painted, paintedMat, 'FarmVanes');
  addMerged(rest.window, windowMat, 'FarmWindows', false);

  /* --------------------------------------------------------------- update ---- */

  /**
   * Per-frame: turn the windpump rotors and bring the farmhouse windows up after
   * dark. Both are O(1) object counts; everything else sways in the shader.
   */
  function update(dt, ctx = {}) {
    const step = Math.min(Math.max(dt || 0, 0), 0.25);

    for (let i = 0; i < rotors.length; i++) {
      rotors[i].mesh.rotation.z += rotors[i].speed * step;
    }

    const isNight = ctx && ctx.isNight != null ? !!ctx.isNight : false;
    const want = isNight ? 1.15 : 0.04;
    windowMat.emissiveIntensity += (want - windowMat.emissiveIntensity) * Math.min(1, step * 1.2);
  }

  function dispose() {
    while (group.children.length) group.remove(group.children[0]);
    for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
    disposables.length = 0;
    rotors.length = 0;
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
    get windpumps() { return rotors.length; },
  };
}

export default { createRural };
