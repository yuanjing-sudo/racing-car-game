import * as THREE from 'three';

/**
 * kerbs.js — raised, bevelled apex kerbs.
 *
 * The base track draws its kerbs as flat painted strips. This module adds the
 * part you see in every onboard camera: a raised red-and-white rumble strip
 * that the car can actually drive over, with a chamfered edge and a ramped
 * entry and exit so it does not end in a wall.
 *
 * A single extruded cross-section — flat bottom, angled shoulder, flat top —
 * is instanced along the inside of each detected corner. Segments alternate
 * colour through `instanceColor`, so the whole circuit's kerbing is one draw
 * call. Entry and exit segments are squashed vertically to form approach
 * ramps, and heights blend with the corner's severity.
 *
 * The module only decorates: it does not touch the physics surface, and it
 * follows the curve's elevation so kerbs sit correctly on hills.
 */

/* ------------------------------------------------------------------ helpers ---- */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Kerb budget per quality level.
 * `span` is the total length of the strip at each corner, in metres.
 */
const PLAN = {
  low: { corners: 3, span: 16, width: 0.78, height: 0.075, segments: 24 },
  medium: { corners: 4, span: 24, width: 0.88, height: 0.095, segments: 36 },
  high: { corners: 6, span: 32, width: 0.94, height: 0.110, segments: 48 },
  ultra: { corners: 8, span: 40, width: 1.00, height: 0.125, segments: 60 },
};

/**
 * Extruded kerb cross-section.
 *
 * Shape coordinates are (across, up); the extrude runs along +Z, which the
 * instance basis aligns with the track tangent. The bottom is sunk 3 cm below
 * the road so the seam never shows.
 */
function createKerbGeometry(length, width, height) {
  const h = Math.max(0.04, height);
  const bevel = Math.min(width * 0.26, h * 1.4, 0.20);

  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.5, -0.03);
  shape.lineTo(width * 0.5, -0.03);
  shape.lineTo(width * 0.5, h * 0.42);
  shape.lineTo(width * 0.5 - bevel, h);
  shape.lineTo(-width * 0.5 + bevel, h);
  shape.lineTo(-width * 0.5, h * 0.42);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -length * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/* -------------------------------------------------------------------- main ---- */

/**
 * Build 3D apex kerbing for one circuit.
 *
 * @param {object} opts
 * @param {THREE.Curve} opts.curve
 * @param {number} [opts.width=12]      track width
 * @param {number} [opts.seed=42]
 * @param {string} [opts.quality='high']
 * @param {number} [opts.density=1]
 * @param {Array<{tStart:number,tEnd:number}>} [opts.gapZones]
 * @returns {{ group: THREE.Group, stats: object, update: Function, dispose: Function }}
 */
export function createKerbs(opts = {}) {
  const curve = opts.curve;
  const width = opts.width || 12;
  const quality = opts.quality || 'high';
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const random = mulberry32(seed ^ 0x2f9a17);
  const density = clamp(opts.density != null ? opts.density : 1, 0.3, 2);
  const gapZones = opts.gapZones || [];

  const group = new THREE.Group();
  group.name = 'ApexKerbs';
  const stats = { corners: 0, segments: 0, tris: 0, draws: 0 };
  const disposables = [];

  const empty = {
    group, stats,
    update() {},
    dispose() {
      while (group.children.length) group.remove(group.children[0]);
      for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
      disposables.length = 0;
      stats.draws = 0;
      stats.tris = 0;
    },
  };

  if (!curve || typeof curve.getPointAt !== 'function') return empty;

  const plan = PLAN[quality] || PLAN.high;
  const halfW = width * 0.5;

  let length = 1000;
  try { length = curve.getLength() || 1000; } catch (e) { length = 1000; }
  if (!isFinite(length) || length < 10) length = 1000;

  const inGap = (t) => gapZones.some((g) => t >= g.tStart && t <= g.tEnd);

  /* --------------------------------------------------------------- corners -- */

  const samples = 200;
  const tanA = new THREE.Vector3();
  const tanB = new THREE.Vector3();
  const bend = new Float32Array(samples);
  const sideOf = new Int8Array(samples);

  for (let i = 0; i < samples; i++) {
    const u = i / samples;
    curve.getTangentAt(u, tanA);
    curve.getTangentAt(Math.min(1, u + 1 / samples), tanB);
    bend[i] = Math.acos(clamp(tanA.dot(tanB), -1, 1));
    // Signed bend: positive = normal points to the inside of the turn.
    sideOf[i] = tanA.x * tanB.z - tanA.z * tanB.x >= 0 ? 1 : -1;
  }

  const corners = [];
  for (let i = 0; i < samples; i++) {
    const prev = bend[(i + samples - 1) % samples];
    const next = bend[(i + 1) % samples];
    if (bend[i] >= prev && bend[i] >= next && bend[i] > 0.008) {
      const t = i / samples;
      if (!inGap(t)) corners.push({ t, weight: bend[i], side: sideOf[i] });
    }
  }
  corners.sort((a, b) => b.weight - a.weight);

  const chosen = [];
  const minSeparation = 0.055;
  for (const c of corners) {
    let close = false;
    for (const o of chosen) {
      let d = Math.abs(o.t - c.t);
      if (d > 0.5) d = 1 - d;
      if (d < minSeparation) { close = true; break; }
    }
    if (!close) chosen.push(c);
    if (chosen.length >= Math.round(plan.corners * density)) break;
  }

  if (chosen.length === 0) return empty;
  stats.corners = chosen.length;

  /* --------------------------------------------------------------- assembly -- */

  const segmentLength = 2.0;
  const instanced = [];

  // Build one run per corner, collecting matrices first so we can size the
  // InstancedMesh exactly.
  for (const corner of chosen) {
    // Severity controls how tall and how long the strip is.
    const severity = clamp(corner.weight / 0.12, 0.45, 1.25);
    const span = plan.span * (0.75 + severity * 0.35);
    const kerbWidth = plan.width * (0.92 + severity * 0.12);
    const kerbHeight = plan.height * (0.72 + severity * 0.35);
    const count = Math.max(4, Math.round(span / segmentLength));
    const stepU = (span / count) / length;
    const startU = corner.t - (count * stepU) * 0.5;

    for (let i = 0; i < count; i++) {
      const u = ((startU + i * stepU) % 1 + 1) % 1;
      if (inGap(u)) continue;

      // Entry/exit ramps: the first and last two segments rise from the road.
      let rise = 1;
      if (i === 0 || i === count - 1) rise = 0.28;
      else if (i === 1 || i === count - 2) rise = 0.62;

      // The inner edge tucks just under the painted track edge.
      const lateral = corner.side * (halfW + kerbWidth * 0.5 - 0.12);
      instanced.push({
        u, lateral, rise, index: i,
        w: kerbWidth / plan.width,
        h: kerbHeight / plan.height,
      });
    }
  }

  if (instanced.length === 0) return empty;

  const geo = createKerbGeometry(segmentLength * 1.04, plan.width, plan.height);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0.06,
    side: THREE.DoubleSide,
  });
  disposables.push(geo, mat);

  const mesh = new THREE.InstancedMesh(geo, mat, instanced.length);
  mesh.name = 'ApexKerbStrips';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.receiveShadow = true;

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _dummy = new THREE.Object3D();
  const _color = new THREE.Color();

  const RED = 0xc41f24;
  const WHITE = 0xf2f0ea;

  for (let k = 0; k < instanced.length; k++) {
    const it = instanced[k];
    const t = clamp(it.u, 0, 1);

    curve.getPointAt(t, _p);
    curve.getTangentAt(t, _t);
    _n.set(-_t.z, 0, _t.x);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0); else _n.normalize();
    _up.crossVectors(_n, _t).normalize();
    if (_up.y < 0) _up.negate();
    _x.crossVectors(_up, _t);

    _basis.makeBasis(_x, _up, _t);
    _dummy.quaternion.setFromRotationMatrix(_basis);
    _dummy.position.set(
      _p.x + _n.x * it.lateral,
      _p.y,
      _p.z + _n.z * it.lateral,
    );
    // Width and height follow the corner's severity; ramp segments are
    // squashed vertically so the strip rises out of the tarmac.
    _dummy.scale.set(it.w, Math.max(0.06, it.rise * it.h), 1);
    _dummy.updateMatrix();
    mesh.setMatrixAt(k, _dummy.matrix);

    // Alternate red / white, with a touch of wear so the field is not plastic.
    const base = it.index % 2 === 0 ? RED : WHITE;
    _color.setHex(base);
    const shift = (random() * 2 - 1) * 0.05;
    _color.offsetHSL(0, 0, shift);
    mesh.setColorAt(k, _color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  group.add(mesh);

  stats.segments = instanced.length;
  stats.draws = 1;
  stats.tris = Math.round((geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3) * instanced.length);

  return {
    group,
    stats,
    update() {},
    dispose: empty.dispose,
  };
}

export default { createKerbs };
