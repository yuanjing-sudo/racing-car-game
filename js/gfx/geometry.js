import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * geometry.js — procedural geometry toolkit.
 *
 * Everything the props / decals / infrastructure modules build is assembled here
 * so a grandstand, a truss gantry or a catch fence is one merged buffer rather
 * than a few hundred individual meshes. All builders are pure: they take numbers,
 * they return a `BufferGeometry`, and they never touch the scene or the GPU.
 *
 * Conventions (matching the rest of `js/gfx/`):
 *   - +Y is up, +Z is "forward" along a track tangent, +X is the lateral normal;
 *   - "lateral" is positive to the driver's right;
 *   - a "span" is measured along X, a "length" along Z, a "height" along Y.
 */

/* -------------------------------------------------------------------- random ---- */

/**
 * Fast deterministic PRNG (mulberry32). Same seed → same world, which keeps the
 * track looking identical across reloads and lets tests assert on placement.
 */
export function seededRandom(seed = 42) {
  let a = (seed >>> 0) || 1;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an element from an array using a 0..1 random value. */
export function pick(random, list) {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** Random in [min, max). */
export function range(random, min, max) {
  return min + (max - min) * random();
}

/* ---------------------------------------------------------- track sampling ---- */

const _pt = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _norm = new THREE.Vector3();

/**
 * Build a local frame on the track.
 *
 * @param {THREE.Curve<THREE.Vector3>} curve
 * @param {number} t          normalised position along the lap (0..1)
 * @param {number} width      track width, used when `lateral` is a multiple of it
 * @param {number} lateral    offset from the centre line in metres (+ = right)
 * @param {number} yLift      extra height
 * @returns {{ position: THREE.Vector3, tangent: THREE.Vector3, normal: THREE.Vector3, angle: number }}
 */
export function trackFrame(curve, t, width = 12, lateral = 0, yLift = 0) {
  const tt = ((t % 1) + 1) % 1;
  curve.getPointAt(tt, _pt);
  curve.getTangentAt(tt, _tan);
  _norm.set(-_tan.z, 0, _tan.x).normalize();
  _pt.addScaledVector(_norm, lateral);
  _pt.y += yLift;
  return {
    position: _pt.clone(),
    tangent: _tan.clone(),
    normal: _norm.clone(),
    angle: Math.atan2(_tan.x, _tan.z),
  };
}

/* ------------------------------------------------------------- merge helper ---- */

/**
 * Merge a list of geometries, dropping any that failed to build. Returns `null`
 * when nothing survived so callers can skip adding an empty mesh.
 */
export function mergeAll(geometries) {
  const list = (geometries || []).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  try {
    return mergeGeometries(list, false);
  } catch (err) {
    // Attribute mismatch — merge what we can, one bucket at a time.
    const merged = [];
    const buckets = new Map();
    for (const g of list) {
      const key = `${Object.keys(g.attributes).sort().join(',')}|${g.index ? 1 : 0}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(g);
    }
    for (const group of buckets.values()) {
      const m = group.length === 1 ? group[0] : mergeGeometries(group, false);
      if (m) merged.push(m);
    }
    return merged.length === 1 ? merged[0] : mergeAll(merged);
  }
}

/** Bake a matrix into a geometry, returning the same geometry for chaining. */
export function bake(geometry, matrix) {
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** Transform helpers so builders read as a list of parts. */
export function box(w, h, d, x = 0, y = 0, z = 0, ry = 0, rz = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

export function cylinder(rTop, rBottom, h, radial = 8, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, radial, 1, false);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

export function sphere(r, x = 0, y = 0, z = 0, w = 8, hSeg = 6) {
  const g = new THREE.SphereGeometry(r, w, hSeg);
  g.translate(x, y, z);
  return g;
}

/* ------------------------------------------------------------------- trusses ---- */

/**
 * A lattice truss: two chords, verticals and diagonals. Used for gantries,
 * bridges and grandstand roofs where a solid beam would look wrong.
 */
export function createTrussGeometry({
  span = 20,
  height = 1.6,
  depth = 1.0,
  segments = 8,
  chord = 0.14,
  brace = 0.09,
} = {}) {
  const parts = [];
  const y0 = chord * 0.5;
  const y1 = height - chord * 0.5;
  const z0 = -depth * 0.5 + chord * 0.5;
  const z1 = depth * 0.5 - chord * 0.5;

  // four chords (top/bottom × front/back)
  for (const y of [y0, y1]) {
    for (const z of [z0, z1]) {
      parts.push(box(span, chord, chord, 0, y, z));
    }
  }

  const step = span / segments;
  for (let i = 0; i <= segments; i++) {
    const x = -span * 0.5 + i * step;
    for (const z of [z0, z1]) parts.push(box(brace, height - chord, brace, x, height * 0.5, z));
    // diagonals on both faces
    if (i < segments) {
      const len = Math.hypot(step, height - chord);
      const ang = Math.atan2(height - chord, step);
      for (const z of [z0, z1]) {
        const g = new THREE.BoxGeometry(len, brace, brace);
        g.rotateZ(ang * (i % 2 === 0 ? 1 : -1));
        g.translate(x + step * 0.5, height * 0.5, z);
        parts.push(g);
      }
    }
  }
  return mergeAll(parts);
}

/* ------------------------------------------------------------------ gantries ---- */

/**
 * Overhead sponsor gantry that straddles the track. Returns a group-ready
 * geometry plus the banner plane dimensions so the caller can add a sign.
 */
export function createGantryGeometry({
  span = 24,
  height = 8,
  bannerHeight = 2.2,
  bannerWidth = null,
  legRadius = 0.32,
} = {}) {
  const parts = [];
  const bw = bannerWidth != null ? bannerWidth : span * 0.86;

  // two legs with footings
  for (const side of [-1, 1]) {
    const x = side * span * 0.5;
    parts.push(box(1.4, 0.5, 1.4, x, 0.25, 0));
    parts.push(cylinder(legRadius, legRadius * 1.15, height, 10, x, height * 0.5, 0));
  }

  // top beam (truss) carrying the banner
  const beam = createTrussGeometry({ span: span + 1.2, height: 1.1, depth: 1.2, segments: Math.max(6, Math.round(span / 3)) });
  if (beam) {
    beam.translate(0, height - 0.55, 0);
    parts.push(beam);
  }

  // banner frame
  parts.push(box(bw + 0.3, 0.16, 0.4, 0, height - 1.3, 0));
  parts.push(box(bw + 0.3, 0.16, 0.4, 0, height - 1.3 - bannerHeight, 0));
  for (const side of [-1, 1]) {
    parts.push(box(0.16, bannerHeight, 0.4, side * (bw * 0.5 + 0.07), height - 1.3 - bannerHeight * 0.5, 0));
  }

  return {
    geometry: mergeAll(parts),
    banner: { width: bw, height: bannerHeight, center: new THREE.Vector3(0, height - 1.3 - bannerHeight * 0.5, 0) },
    span,
    height,
  };
}

/* -------------------------------------------------------------- grandstands ---- */

/**
 * Tiered grandstand. `rows` seats are stacked away from the track, with a
 * cantilevered roof, railings and a press/commentary box on top.
 *
 * The geometry is built facing +Z (toward the track); the caller rotates it.
 */
export function createGrandstandGeometry({
  width = 40,
  rows = 12,
  rowHeight = 0.85,
  rowDepth = 0.9,
  seatDepth = 0.62,
  backWall = 1.1,
  roofOverhang = 4.5,
  withBox = true,
} = {}) {
  const parts = [];
  const depth = rows * rowDepth;
  const topY = rows * rowHeight;
  const halfW = width * 0.5;

  // stepped seating slab
  for (let r = 0; r < rows; r++) {
    const y = (r + 1) * rowHeight;
    const z = -r * rowDepth - rowDepth * 0.5;
    parts.push(box(width, rowHeight, rowDepth, 0, y - rowHeight * 0.5, z));
  }
  // seat rows drawn as thin slabs slightly proud of the step
  for (let r = 0; r < rows; r++) {
    const y = (r + 1) * rowHeight + 0.02;
    const z = -r * rowDepth - rowDepth * 0.5;
    parts.push(box(width - 1.2, 0.1, seatDepth, 0, y, z + rowDepth * 0.1));
  }

  // side walls
  for (const side of [-1, 1]) {
    parts.push(box(0.5, topY, depth + backWall, side * (halfW + 0.25), topY * 0.5, -depth * 0.5));
  }
  // back wall
  parts.push(box(width + 1, topY + backWall, 0.5, 0, (topY + backWall) * 0.5, -depth - 0.25));

  // front rail
  parts.push(box(width, 0.9, 0.18, 0, rowHeight + 0.45, rowDepth * 0.5 + 0.1));

  // roof: two sloped halves + fascia
  const roofY = topY + backWall + 3.2;
  const slope = 0.18;
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(width * 0.5 + roofOverhang * 0.5, 0.22, depth * 0.5 + roofOverhang);
    g.translate(side * (width * 0.25), 0, 0);
    const m = new THREE.Matrix4().makeRotationX(-slope);
    g.applyMatrix4(m);
    g.translate(0, roofY, -depth * 0.35);
    parts.push(g);
  }
  parts.push(box(width + roofOverhang, 0.35, 0.35, 0, roofY - 1.2, depth * 0.5 + roofOverhang * 0.4));

  // roof supports
  for (let i = -2; i <= 2; i++) {
    const x = i * (width * 0.22);
    parts.push(cylinder(0.16, 0.18, roofY, 6, x, roofY * 0.5, -depth * 0.9));
  }

  // commentary box
  if (withBox) {
    const boxW = Math.min(width * 0.34, 14);
    parts.push(box(boxW, 2.6, 3.2, -width * 0.28, topY + backWall + 1.3, -depth * 0.7));
    parts.push(box(boxW + 0.6, 0.2, 3.8, -width * 0.28, topY + backWall + 2.7, -depth * 0.7));
  }

  return {
    geometry: mergeAll(parts),
    width,
    rows,
    height: roofY,
    depth,
  };
}

/**
 * Backing geometry for the crowd: one low box per seat block so an instanced
 * billboard crowd can be laid on top without a separate collision mesh.
 */
export function createCrowdBackingGeometry({ width = 40, rows = 12, rowHeight = 0.85, rowDepth = 0.9 }) {
  return box(width - 1.4, rows * rowHeight * 0.55, rows * rowDepth * 0.92, 0, rows * rowHeight * 0.5, -rows * rowDepth * 0.5);
}

/* ------------------------------------------------------------- catch fences ---- */

/**
 * Catch fence: vertical posts, a top rail and a curved top section that leans
 * over the track. The mesh texture is applied by the caller.
 */
export function createCatchFenceGeometry({
  length = 24,
  height = 3.4,
  lean = 0.9,
  postEvery = 4,
  postRadius = 0.08,
} = {}) {
  const parts = [];
  const posts = Math.max(2, Math.round(length / postEvery));
  for (let i = 0; i <= posts; i++) {
    const x = -length * 0.5 + (i / posts) * length;
    parts.push(cylinder(postRadius, postRadius, height, 6, x, height * 0.5, 0));
    // leaning top post
    const g = new THREE.BoxGeometry(postRadius * 1.6, lean, postRadius * 1.6);
    g.rotateZ(-Math.PI * 0.35);
    g.translate(x, height + lean * 0.35, -lean * 0.28);
    parts.push(g);
  }
  // top rail
  parts.push(cylinder(postRadius * 1.4, postRadius * 1.4, length, 6, 0, height, 0, 0, Math.PI * 0.5));
  return mergeAll(parts);
}

/* ----------------------------------------------------------------- buildings ---- */

/**
 * A blocky building shell with inset window bands. Cheap, and reads well behind
 * a trackside barrier at speed.
 */
export function createBuildingShellGeometry({
  width = 12,
  height = 20,
  depth = 12,
  floors = 0,
  setbacks = 0,
  roofUnits = true,
  random = Math.random,
} = {}) {
  const parts = [];
  const nFloors = floors || Math.max(3, Math.round(height / 3.4));
  const segHeight = height / nFloors;

  let w = width;
  let d = depth;
  for (let f = 0; f < nFloors; f++) {
    const isSetback = setbacks > 0 && f > 0 && f % Math.max(2, Math.round(nFloors / (setbacks + 1))) === 0;
    if (isSetback) {
      w *= 0.86;
      d *= 0.86;
    }
    const y = f * segHeight + segHeight * 0.5;
    parts.push(box(w, segHeight * 0.72, d, 0, y, 0));
    // window band (slightly proud, inset)
    parts.push(box(w + 0.12, segHeight * 0.2, d + 0.12, 0, f * segHeight + segHeight * 0.82, 0));
  }
  if (roofUnits) {
    parts.push(box(w * 0.3, 1.4, d * 0.3, range(random, -w * 0.2, w * 0.2), height + 0.7, range(random, -d * 0.2, d * 0.2)));
    if (random() > 0.5) parts.push(cylinder(0.12, 0.12, 4, 5, 0, height + 2, 0));
  }
  return { geometry: mergeAll(parts), width: w, height, depth: d, floors: nFloors };
}

/* -------------------------------------------------------------------- tents ---- */

/** Hospitality tent: pitched roof on straight legs. */
export function createTentGeometry({ width = 8, height = 3.2, depth = 6, pitch = 1.6 } = {}) {
  const parts = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(cylinder(0.08, 0.08, height, 5, sx * (width * 0.5 - 0.3), height * 0.5, sz * (depth * 0.5 - 0.3)));
    }
  }
  const half = new THREE.BoxGeometry(width * 0.55, 0.12, depth + 0.4);
  const m = new THREE.Matrix4().makeRotationZ(Math.atan2(pitch, width * 0.5));
  for (const side of [-1, 1]) {
    const g = half.clone();
    g.applyMatrix4(m.clone().multiply(new THREE.Matrix4().makeScale(side, 1, 1)));
    g.translate(side * width * 0.25, height + pitch * 0.5, 0);
    parts.push(g);
  }
  return mergeAll(parts);
}

/* ---------------------------------------------------------------- billboards ---- */

/** A framed advertising panel: frame geometry + a plane for the artwork. */
export function createBillboardGeometry({ width = 6, height = 3, depth = 0.3, legs = 2, legHeight = 2.4 } = {}) {
  const parts = [];
  parts.push(box(width + 0.3, 0.18, depth, 0, height + 0.09, 0));
  parts.push(box(width + 0.3, 0.18, depth, 0, -0.09, 0));
  for (const side of [-1, 1]) {
    parts.push(box(0.18, height + 0.36, depth, side * (width * 0.5 + 0.06), height * 0.5, 0));
  }
  const n = Math.max(1, legs);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -width * 0.5 + (i / (n - 1)) * width;
    parts.push(cylinder(0.12, 0.14, legHeight, 6, x, -legHeight * 0.5, 0));
  }
  return mergeAll(parts);
}

/* -------------------------------------------------------------- tyre walls ---- */

/** A tyre wall: stacked torus-ish rings, staggered, with a low concrete base. */
export function createTyreWallGeometry({ length = 12, rows = 2, tyreRadius = 0.42, random = Math.random } = {}) {
  const parts = [];
  parts.push(box(length, 0.25, tyreRadius * 1.9, 0, 0.12, 0));
  const perRow = Math.max(2, Math.floor(length / (tyreRadius * 1.7)));
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : tyreRadius * 0.85;
    for (let i = 0; i < perRow; i++) {
      const x = -length * 0.5 + tyreRadius + i * (tyreRadius * 1.7) + offset;
      if (x > length * 0.5 - tyreRadius) continue;
      const g = new THREE.TorusGeometry(tyreRadius * 0.72, tyreRadius * 0.34, 6, 10);
      g.rotateY(Math.PI * 0.5);
      g.rotateX(range(random, -0.08, 0.08));
      g.translate(x, 0.32 + r * tyreRadius * 0.72, 0);
      parts.push(g);
    }
  }
  return mergeAll(parts);
}

/* ------------------------------------------------------------------- kerbs ---- */

/** Sausage kerb segment with a bevelled top — the red/white edge strip. */
export function createKerbGeometry({ length = 4, width = 1.0, height = 0.14 } = {}) {
  const parts = [];
  parts.push(box(width, height, length, 0, height * 0.5, 0));
  const bevel = new THREE.BoxGeometry(width, height * 0.7, length);
  bevel.rotateZ(Math.PI * 0.25);
  bevel.translate(-width * 0.55, height * 0.25, 0);
  parts.push(bevel);
  return mergeAll(parts);
}

/* ------------------------------------------------------------------ rocks ---- */

/** Irregular rock from a deformed icosahedron. */
export function createRockGeometry({ radius = 1.5, detail = 1, jitter = 0.35, random = Math.random, flatten = 0.7 } = {}) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + (random() - 0.5) * 2 * jitter;
    v.multiplyScalar(n);
    v.y *= flatten;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------- trees ---- */

/**
 * Stylised tree: tapered trunk plus a few stacked cones/spheres for the canopy.
 * `style` selects the silhouette so a theme can pick deciduous vs conifer.
 */
export function createTreeGeometry({
  height = 7,
  trunkRadius = 0.22,
  style = 'conifer',
  layers = 3,
  random = Math.random,
} = {}) {
  const parts = [];
  const trunkH = height * (style === 'palm' ? 0.62 : 0.38);
  parts.push(cylinder(trunkRadius * 0.7, trunkRadius, trunkH, 6, 0, trunkH * 0.5, 0));

  if (style === 'conifer') {
    for (let i = 0; i < layers; i++) {
      const t = i / layers;
      const r = height * 0.22 * (1 - t * 0.72);
      const h = height * 0.32;
      const g = new THREE.ConeGeometry(r, h, 8);
      g.translate(0, trunkH + h * 0.5 + t * height * 0.26, 0);
      parts.push(g);
    }
  } else if (style === 'palm') {
    const fronds = 7;
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + random() * 0.2;
      const g = new THREE.ConeGeometry(height * 0.06, height * 0.42, 4);
      g.rotateX(Math.PI * 0.5 + 0.35);
      g.rotateY(a);
      g.translate(Math.cos(a) * height * 0.16, trunkH + height * 0.05, Math.sin(a) * height * 0.16);
      parts.push(g);
    }
  } else {
    const crownY = trunkH + height * 0.28;
    const blobs = 3 + Math.floor(random() * 3);
    for (let i = 0; i < blobs; i++) {
      const r = height * 0.24 * (0.7 + random() * 0.6);
      const g = new THREE.SphereGeometry(r, 7, 5);
      g.translate(
        (random() - 0.5) * height * 0.3,
        crownY + (random() - 0.5) * height * 0.24,
        (random() - 0.5) * height * 0.3
      );
      parts.push(g);
    }
  }
  return mergeAll(parts);
}

/* -------------------------------------------------------------------- misc ---- */

/** Braking distance board — big flat panel on a post. */
export function createBrakingBoardGeometry({ width = 1.6, height = 1.6, postHeight = 2.2, stripes = 3 } = {}) {
  const parts = [];
  parts.push(cylinder(0.09, 0.11, postHeight, 6, 0, postHeight * 0.5, 0));
  parts.push(box(width + 0.16, height + 0.16, 0.12, 0, postHeight + height * 0.5, 0));
  for (let i = 0; i < stripes; i++) {
    const h = height / stripes;
    parts.push(box(width, h * 0.9, 0.16, 0, postHeight + h * 0.5 + i * h, 0));
  }
  return mergeAll(parts);
}

/** Flag on a pole (the cloth is a separate dynamic mesh). */
export function createFlagPoleGeometry({ height = 6, radius = 0.06 } = {}) {
  return mergeAll([
    cylinder(radius, radius * 1.4, height, 6, 0, height * 0.5, 0),
    box(0.3, 0.3, 0.3, 0, height, 0),
  ]);
}

/** A simple spectator-lighting mast that street lights can be attached to. */
export function createLightMastGeometry({ height = 9, armLength = 2.4, lamps = 3 } = {}) {
  const parts = [];
  parts.push(box(1.6, 0.4, 1.6, 0, 0.2, 0));
  parts.push(cylinder(0.18, 0.34, height, 8, 0, height * 0.5, 0));
  const top = new THREE.BoxGeometry(armLength, 0.16, 0.3);
  top.translate(armLength * 0.5 - 0.2, height, 0);
  parts.push(top);
  for (let i = 0; i < lamps; i++) {
    const x = -armLength * 0.5 + 0.4 + (i / Math.max(1, lamps - 1)) * (armLength - 0.8);
    const g = new THREE.BoxGeometry(0.55, 0.3, 0.5);
    g.rotateZ(-0.5);
    g.translate(x + 0.1, height - 0.25, 0);
    parts.push(g);
  }
  return { geometry: mergeAll(parts), head: new THREE.Vector3(0, height - 0.4, 0), height };
}

/** Tunnel / bridge portal: two piers and a curved crown over a span. */
export function createPortalGeometry({ span = 16, height = 7, thickness = 2.0, depth = 3 } = {}) {
  const parts = [];
  const sideW = thickness;
  for (const side of [-1, 1]) {
    parts.push(box(sideW, height, depth, side * (span * 0.5 + sideW * 0.5), height * 0.5, 0));
  }
  const crown = new THREE.BoxGeometry(span + sideW * 2, sideW * 1.1, depth);
  crown.translate(0, height + sideW * 0.4, 0);
  parts.push(crown);
  // arch springing
  const arch = new THREE.TorusGeometry(span * 0.5, sideW * 0.5, 6, 14, Math.PI);
  arch.rotateY(Math.PI * 0.5);
  arch.rotateZ(Math.PI * 0.5);
  arch.translate(0, height, 0);
  parts.push(arch);
  return mergeAll(parts);
}

/** Instanced placement helper: returns matrices for `count` items in a ring/grid. */
export function ringMatrices({ count = 12, radius = 20, center = new THREE.Vector3(), y = 0, jitter = 0, random = Math.random, faceCenter = true }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = radius * (1 + (random() - 0.5) * jitter);
    const pos = new THREE.Vector3(center.x + Math.cos(a) * r, y, center.z + Math.sin(a) * r);
    const rot = faceCenter ? Math.atan2(center.x - pos.x, center.z - pos.z) : -a;
    out.push(new THREE.Matrix4().compose(
      pos,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
      new THREE.Vector3(1, 1, 1)
    ));
  }
  return out;
}

/**
 * Distribute items along a track curve while keeping a minimum spacing and
 * avoiding the pit/gap zones. Returns `{ t, lateral, frame }` records.
 */
export function placeAlongTrack({
  curve,
  width = 12,
  count = 10,
  lateral = 14,
  lateralJitter = 0,
  tStart = 0.05,
  tEnd = 0.95,
  gapTest = null,
  random = Math.random,
  avoidStart = 0,
} = {}) {
  const out = [];
  const span = (tEnd - tStart) / Math.max(1, count);
  let t = tStart + (avoidStart > 0 ? span : 0);
  for (let i = 0; i < count; i++, t += span) {
    const tt = ((t % 1) + 1) % 1;
    if (gapTest && gapTest(tt)) continue;
    const lat = lateral + (random() - 0.5) * 2 * lateralJitter;
    out.push({ t: tt, lateral: lat, frame: trackFrame(curve, tt, width, lat) });
  }
  return out;
}

/** Compute a bounding box for a group of matrices (useful for culling data). */
export function matricesBounds(matrices) {
  const box3 = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of matrices) {
    box3.expandByPoint(v.setFromMatrixPosition(m));
  }
  return box3;
}

export default {
  seededRandom,
  pick,
  range,
  trackFrame,
  mergeAll,
  createTrussGeometry,
  createGantryGeometry,
  createGrandstandGeometry,
  createCrowdBackingGeometry,
  createCatchFenceGeometry,
  createBuildingShellGeometry,
  createTentGeometry,
  createBillboardGeometry,
  createTyreWallGeometry,
  createKerbGeometry,
  createRockGeometry,
  createTreeGeometry,
  createBrakingBoardGeometry,
  createFlagPoleGeometry,
  createLightMastGeometry,
  createPortalGeometry,
  placeAlongTrack,
  ringMatrices,
};
