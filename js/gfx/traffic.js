import * as THREE from 'three';

import { bake, box, cylinder, mergeAll, seededRandom, trackFrame } from './geometry.js';

/**
 * traffic.js — the city doesn't stop for the race.
 *
 * A street circuit reads as a closed set until normal life keeps happening
 * behind the barriers. This module adds the two pieces that sell the illusion
 * better than any wall of buildings:
 *
 *  - **Signalised crossings** over the racing line. Two poles, a mast arm,
 *    a three-lamp head facing the oncoming cars, pedestrian heads on both
 *    kerbs, a yellow Japanese-style backboard, a zebra crossing, a stop line,
 *    a green street sign and a pedestrian-crossing warning diamond. The lamps
 *    run a real green → amber → red cycle, and the racers ignore every second
 *    of it. Urban themes get crossings; everywhere else gets portable
 *    road-works signals on a shoulder trailer.
 *
 *  - **Civilian traffic** — painted saloon cars that trundle around the lap at
 *    30–55 km/h in the three road lanes, oblivious to the lights and to the
 *    field bearing down on them. They are the "competing cars" that the player
 *    has to read and dodge at 300 km/h.
 *
 * Everything is batched: one merged mesh for steelwork, one for yellow
 * backboards, one each for the two sign faces, one for road paint, one
 * `InstancedMesh` for every coloured lamp in the world and four more for the
 * whole civilian fleet. The signal timing is a simple clock, so the module
 * costs almost nothing per frame.
 */

/* ------------------------------------------------------------------ helpers ---- */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function isInGap(t, gaps) {
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    if (t >= g.tStart && t <= g.tEnd) return true;
  }
  return false;
}

/** Shortest distance between two normalised lap positions. */
function lapDistance(a, b) {
  let d = Math.abs(a - b) % 1;
  if (d > 0.5) d = 1 - d;
  return d;
}

/** Light plan per quality. `crossings` only applies to urban themes. */
const PLAN = {
  low: { crossings: 3, cars: 4, works: 2 },
  medium: { crossings: 4, cars: 5, works: 2 },
  high: { crossings: 5, cars: 7, works: 2 },
  ultra: { crossings: 5, cars: 9, works: 3 },
};

const CYCLE = 18;
const GREEN_TIME = 7;
const AMBER_TIME = 2;

/** Lamps are HDR (values > 1) and `toneMapped:false`, so bloom smears them. */
const LAMP_OFF = new THREE.Color(0.035, 0.03, 0.025);
const LAMP_RED = new THREE.Color(5.2, 0.22, 0.14);
const LAMP_AMBER = new THREE.Color(5.0, 2.0, 0.08);
const LAMP_GREEN = new THREE.Color(0.18, 4.2, 0.75);
const PED_RED = new THREE.Color(3.6, 0.14, 0.12);
const PED_GREEN = new THREE.Color(0.2, 3.2, 1.2);

const CAR_COLORS = [
  0xf2f3f5, 0x9aa1a9, 0x25282e, 0x1c3f6e,
  0x8f2026, 0xd9b02b, 0x2f6b52, 0xe8e2d6,
];
const HEADLIGHT = new THREE.Color(4.0, 3.6, 2.9);
const TAIL_ON = new THREE.Color(1.5, 0.06, 0.05);
const TAIL_BRAKE = new THREE.Color(6.5, 0.12, 0.08);

const ONE = new THREE.Vector3(1, 1, 1);

/* ---------------------------------------------------------------- textures ---- */

/** Tokyo-style green street blade with a bounding white rule. */
function makeStreetSignTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#0d3a2c';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#eef4ec';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = '#eef4ec';
  ctx.font = 'bold 58px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Yellow diamond pedestrian-crossing warning sign. */
function makeCrossingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, 256, 256);

  ctx.fillStyle = '#f7c51e';
  ctx.beginPath();
  ctx.moveTo(128, 12);
  ctx.lineTo(244, 128);
  ctx.lineTo(128, 244);
  ctx.lineTo(12, 128);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 12;
  ctx.stroke();

  ctx.fillStyle = '#151515';
  ctx.beginPath();
  ctx.arc(128, 84, 15, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(128, 100);
  ctx.lineTo(128, 150);
  ctx.moveTo(128, 150);
  ctx.lineTo(106, 196);
  ctx.moveTo(128, 150);
  ctx.lineTo(150, 196);
  ctx.moveTo(128, 116);
  ctx.lineTo(102, 138);
  ctx.moveTo(128, 116);
  ctx.lineTo(154, 138);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* --------------------------------------------------------------- geometry ---- */

/**
 * Saloon-car geometry, split by material so the whole fleet is four draw calls.
 * The body is white and tinted per instance; the dark parts carry the glass,
 * bumper trim, mirrors and wheels.
 */
function buildCarGeometry() {
  const body = mergeAll([
    box(1.82, 0.50, 4.05, 0, 0.56, 0),
    box(1.70, 0.20, 1.20, 0, 0.90, 1.32),
    box(1.70, 0.20, 0.95, 0, 0.90, -1.48),
    box(1.52, 0.52, 1.90, 0, 1.12, -0.14),
    box(1.36, 0.08, 1.60, 0, 1.42, -0.14),
  ]);

  const dark = mergeAll([
    box(1.40, 0.34, 0.06, 0, 1.16, 0.79),
    box(1.36, 0.30, 0.06, 0, 1.14, -1.07),
    box(0.05, 0.34, 1.35, -0.77, 1.16, -0.14),
    box(0.05, 0.34, 1.35, 0.77, 1.16, -0.14),
    box(1.42, 0.17, 0.07, 0, 0.60, 2.02),
    box(1.80, 0.22, 0.12, 0, 0.42, 2.01),
    box(1.80, 0.22, 0.12, 0, 0.42, -2.01),
    box(0.16, 0.08, 0.10, -0.88, 1.04, 0.52),
    box(0.16, 0.08, 0.10, 0.88, 1.04, 0.52),
    cylinder(0.31, 0.31, 0.24, 10, -0.91, 0.32, 1.26, 0, Math.PI * 0.5),
    cylinder(0.31, 0.31, 0.24, 10, 0.91, 0.32, 1.26, 0, Math.PI * 0.5),
    cylinder(0.31, 0.31, 0.24, 10, -0.91, 0.32, -1.26, 0, Math.PI * 0.5),
    cylinder(0.31, 0.31, 0.24, 10, 0.91, 0.32, -1.26, 0, Math.PI * 0.5),
  ]);

  const head = mergeAll([
    box(0.34, 0.12, 0.06, -0.55, 0.76, 2.03),
    box(0.34, 0.12, 0.06, 0.55, 0.76, 2.03),
    box(0.90, 0.05, 0.04, 0, 0.50, 2.05),
  ]);

  const tail = mergeAll([
    box(0.34, 0.11, 0.06, -0.55, 0.78, -2.03),
    box(0.34, 0.11, 0.06, 0.55, 0.78, -2.03),
    box(0.62, 0.05, 0.04, 0, 0.95, -2.06),
  ]);

  return { body, dark, head, tail };
}

/* ------------------------------------------------------------------- main ---- */

/**
 * Build the street furniture and civilian traffic for one circuit.
 *
 * @param {object} opts
 * @param {THREE.Curve} opts.curve
 * @param {string} [opts.theme='city']
 * @param {number} [opts.seed=42]
 * @param {number} [opts.width=12]
 * @param {string} [opts.quality='high']
 * @param {number} [opts.density=1]
 * @param {Array<{tStart:number,tEnd:number}>} [opts.gapZones]
 * @returns {{group:THREE.Group, stats:object, crossings:Array, cars:Array,
 *            update:Function, collide:Function, getHazards:Function,
 *            reset:Function, dispose:Function}}
 */
export function createTraffic(opts = {}) {
  const curve = opts.curve;
  const theme = opts.theme || 'city';
  const width = opts.width || 12;
  const quality = opts.quality || 'high';
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const density = clamp(opts.density != null ? opts.density : 1, 0.3, 2);
  const gapZones = opts.gapZones || [];
  const random = seededRandom(seed ^ 0x5a17c3);
  const halfW = width * 0.5;

  const urban = theme === 'city' || theme === 'tokyo';

  const group = new THREE.Group();
  group.name = 'StreetTraffic';

  const stats = { crossings: 0, works: 0, signals: 0, lamps: 0, cars: 0, draws: 0, tris: 0 };
  const disposables = [];

  const empty = {
    group, stats, crossings: [], works: [], cars: [],
    update() {},
    collide() { return null; },
    getHazards() { return []; },
    reset() {},
    dispose() {
      while (group.children.length) group.remove(group.children[0]);
      for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
      disposables.length = 0;
      stats.draws = 0;
      stats.tris = 0;
    },
  };

  if (!curve || typeof curve.getPointAt !== 'function') return empty;

  let length = 1000;
  try { length = curve.getLength() || 1000; } catch (e) { length = 1000; }
  if (!isFinite(length) || length < 10) length = 1000;

  const plan = PLAN[quality] || PLAN.high;

  /* ------------------------------------------------------------- materials -- */

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x60666e, roughness: 0.44, metalness: 0.62,
  });
  const backplateMat = new THREE.MeshStandardMaterial({
    color: 0xf2c11e, roughness: 0.52, metalness: 0.18,
  });
  const markingMat = new THREE.MeshStandardMaterial({
    color: 0xe8ecef, roughness: 0.68, metalness: 0.02,
    emissive: 0x24272b, emissiveIntensity: 0.6,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const streetSignMat = new THREE.MeshBasicMaterial({
    map: makeStreetSignTexture(urban && theme === 'tokyo' ? 'TOKYO' : 'VELOCE CITY'),
    side: THREE.DoubleSide, toneMapped: false,
  });
  const crossingMat = new THREE.MeshBasicMaterial({
    map: makeCrossingTexture(),
    transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, toneMapped: false,
  });
  disposables.push(steelMat, backplateMat, markingMat, streetSignMat, crossingMat);
  if (streetSignMat.map) disposables.push(streetSignMat.map);
  if (crossingMat.map) disposables.push(crossingMat.map);

  /* ----------------------------------------------------------- collections -- */
  // All geometries are accumulated in world space (baked through the frame
  // matrix) so the whole circuit's steelwork is one draw call.
  const steelGeos = [];
  const backplateGeos = [];
  const signGeos = [];
  const crossingGeos = [];
  const markingGeos = [];

  const lampRecords = [];   // { owner, kind, slot, matrix, index }
  const lampMatrices = [];
  const crossings = [];
  const works = [];

  const matrixScratch = new THREE.Matrix4();
  const localScratch = new THREE.Matrix4();
  const quatScratch = new THREE.Quaternion();
  const eulerScratch = new THREE.Euler();

  function frameMatrix(frame) {
    quatScratch.setFromEuler(eulerScratch.set(0, frame.angle, 0));
    return new THREE.Matrix4().compose(frame.position, quatScratch, ONE);
  }

  function pushLamp(owner, kind, slot, localMatrix) {
    const index = lampRecords.length;
    matrixScratch.multiplyMatrices(owner.matrix, localMatrix);
    lampMatrices.push(matrixScratch.clone());
    lampRecords.push({ owner, kind, slot, matrix: lampMatrices[index], index });
    owner.lamps.push(lampRecords[index]);
    return index;
  }

  function lampLocal(x, y, z, scale, faceBack = true) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, faceBack ? Math.PI : 0, 0));
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      q,
      new THREE.Vector3(scale, scale, scale)
    );
  }

  /* -------------------------------------------------------- urban crossings -- */

  const crossingCount = urban ? Math.max(1, Math.round(plan.crossings * density)) : 0;
  const chosenT = [];

  function pickT(slot) {
    let t = slot + (random() - 0.5) * 0.03;
    for (let tries = 0; tries < 12; tries++) {
      if (t < 0.06) t += 0.06;
      if (t > 0.94) t -= 0.06;
      if (!isInGap(t, gapZones)) {
        let clash = false;
        for (const other of chosenT) {
          if (lapDistance(t, other) < 0.055) { clash = true; break; }
        }
        if (!clash) return t;
      }
      t = (t + 0.037) % 1;
    }
    return clamp(t, 0.06, 0.94);
  }

  const CROSSING_SLOTS = [0.17, 0.36, 0.55, 0.74, 0.89];

  for (let i = 0; i < crossingCount; i++) {
    const t = pickT(CROSSING_SLOTS[i % CROSSING_SLOTS.length]);
    chosenT.push(t);

    const frame = trackFrame(curve, t, width, 0);
    const owner = {
      t,
      state: null,
      offset: i * 5.3,
      lamps: [],
      matrix: frameMatrix(frame),
      kind: 'crossing',
    };
    crossings.push(owner);

    const side = i % 2 === 0 ? 1 : -1;              // which kerb carries the mast
    const poleX = -side * (halfW + 2.4);             // local +X = -normal
    const headX = -side * 2.5;
    const zHead = 2.6;

    const armLen = Math.abs(headX - poleX);
    const armMid = (poleX + headX) * 0.5;

    // Pole, arm, brace, head housing and back plate.
    steelGeos.push(bake(cylinder(0.10, 0.14, 5.9, 8, poleX, 2.6, zHead), owner.matrix));
    steelGeos.push(bake(box(armLen, 0.11, 0.11, armMid, 5.02, zHead), owner.matrix));
    steelGeos.push(bake(box(armLen * 1.02, 0.055, 0.055, armMid, 4.58, zHead, 0, -side * 0.18), owner.matrix));
    steelGeos.push(bake(box(0.58, 1.40, 0.36, headX, 4.20, zHead), owner.matrix));
    steelGeos.push(bake(box(0.66, 0.07, 0.42, headX, 4.94, zHead), owner.matrix));
    // Three visors.
    steelGeos.push(bake(box(0.46, 0.05, 0.30, headX, 4.78, zHead - 0.13), owner.matrix));
    steelGeos.push(bake(box(0.46, 0.05, 0.30, headX, 4.38, zHead - 0.13), owner.matrix));
    steelGeos.push(bake(box(0.46, 0.05, 0.30, headX, 3.98, zHead - 0.13), owner.matrix));

    // Opposite kerb: a short pole with the pedestrian head.
    const pedPoleX = side * (halfW + 2.4);
    steelGeos.push(bake(cylinder(0.09, 0.12, 3.4, 8, pedPoleX, 1.35, zHead), owner.matrix));
    steelGeos.push(bake(box(0.36, 0.70, 0.26, pedPoleX, 2.82, zHead), owner.matrix));
    steelGeos.push(bake(box(0.44, 0.06, 0.34, pedPoleX, 3.22, zHead), owner.matrix));

    // Bollards either side of the zebra.
    for (const bz of [-1.7, 1.7]) {
      for (const bx of [-(halfW + 1.0), halfW + 1.0]) {
        steelGeos.push(bake(cylinder(0.055, 0.07, 0.85, 6, bx, 0.30, bz), owner.matrix));
      }
    }

    // Yellow backboard behind the head.
    backplateGeos.push(bake(box(0.82, 1.66, 0.06, headX, 4.20, zHead + 0.22), owner.matrix));

    // Green street blade on top of the mast arm.
    signGeos.push(bake(
      new THREE.PlaneGeometry(2.1, 0.52).rotateY(Math.PI).translate(headX + side * 0.5, 5.62, zHead - 0.02),
      owner.matrix
    ));

    // Warning diamond on the mast pole.
    crossingGeos.push(bake(
      new THREE.PlaneGeometry(0.92, 0.92).rotateY(Math.PI).translate(poleX, 3.55, zHead - 0.28),
      owner.matrix
    ));

    // Zebra crossing across the racing line.
    const stripeCount = Math.max(6, Math.round(width / 1.15));
    for (let s = 0; s < stripeCount; s++) {
      const x = -halfW + 0.65 + (s + 0.5) * ((width - 1.3) / stripeCount);
      markingGeos.push(bake(box(0.52, 0.02, 2.8, x, 0.07, 0), owner.matrix));
    }
    // Stop line ahead of the zebra.
    markingGeos.push(bake(box(width - 1.2, 0.02, 0.34, 0, 0.07, -3.1), owner.matrix));

    // Vehicle head lamps.
    pushLamp(owner, 'vehicle', 0, lampLocal(headX, 4.60, zHead - 0.20, 1));
    pushLamp(owner, 'vehicle', 1, lampLocal(headX, 4.20, zHead - 0.20, 1));
    pushLamp(owner, 'vehicle', 2, lampLocal(headX, 3.80, zHead - 0.20, 1));
    // Pedestrian head lamps.
    pushLamp(owner, 'ped', 0, lampLocal(pedPoleX, 3.02, zHead - 0.16, 0.78));
    pushLamp(owner, 'ped', 1, lampLocal(pedPoleX, 2.62, zHead - 0.16, 0.78));

    stats.crossings++;
    stats.signals++;
  }

  /* ----------------------------------------------------- portable road works -- */

  const worksCount = urban ? 0 : Math.max(1, Math.round(plan.works * density));
  const WORKS_SLOTS = [0.29, 0.62, 0.84];

  for (let i = 0; i < worksCount; i++) {
    const t = pickT(WORKS_SLOTS[i % WORKS_SLOTS.length]);
    chosenT.push(t);

    const side = i % 2 === 0 ? 1 : -1;
    const frame = trackFrame(curve, t, width, side * (halfW + 2.7));
    const owner = {
      t,
      state: null,
      offset: i * 4.4,
      lamps: [],
      matrix: frameMatrix(frame),
      kind: 'works',
    };
    works.push(owner);

    // Trailer body, wheels, mast, housing, solar panel and battery.
    steelGeos.push(bake(box(1.15, 0.18, 1.75, 0, -0.06, 0), owner.matrix));
    steelGeos.push(bake(cylinder(0.26, 0.26, 0.18, 10, -0.56, 0.12, -0.28, 0, Math.PI * 0.5), owner.matrix));
    steelGeos.push(bake(cylinder(0.26, 0.26, 0.18, 10, 0.56, 0.12, -0.28, 0, Math.PI * 0.5), owner.matrix));
    steelGeos.push(bake(cylinder(0.07, 0.10, 3.1, 8, 0, 1.55, 0.36), owner.matrix));
    steelGeos.push(bake(box(0.52, 1.16, 0.30, 0, 2.38, 0.36), owner.matrix));
    steelGeos.push(bake(box(0.62, 0.06, 0.36, 0, 2.98, 0.36), owner.matrix));
    steelGeos.push(bake(box(1.24, 0.05, 0.80, 0, 3.18, 0.06, 0, 0, -0.38), owner.matrix));
    steelGeos.push(bake(box(0.36, 0.26, 0.28, 0, -0.18, 0.66), owner.matrix));
    backplateGeos.push(bake(box(0.68, 1.34, 0.05, 0, 2.38, 0.53), owner.matrix));

    for (const vx of [-0.52, 0.52]) {
      steelGeos.push(bake(box(0.03, 0.04, 0.90, vx, 1.42, 0.36), owner.matrix));
    }

    pushLamp(owner, 'vehicle', 0, lampLocal(0, 2.72, 0.18, 1));
    pushLamp(owner, 'vehicle', 1, lampLocal(0, 2.38, 0.18, 1));
    pushLamp(owner, 'vehicle', 2, lampLocal(0, 2.04, 0.18, 1));
    pushLamp(owner, 'beacon', 0, lampLocal(0, 3.58, 0.10, 0.9));

    stats.works++;
    stats.signals++;
  }

  /* --------------------------------------------------------------- batches -- */

  function addMerged(geos, material, name) {
    if (!geos.length) return null;
    const geo = mergeAll(geos);
    if (!geo) return null;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(geo);
    stats.draws++;
    stats.tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    return mesh;
  }

  addMerged(steelGeos, steelMat, 'TrafficSteel');
  addMerged(backplateGeos, backplateMat, 'TrafficBackplates');
  addMerged(signGeos, streetSignMat, 'TrafficStreetSigns');
  addMerged(crossingGeos, crossingMat, 'TrafficCrossingSigns');
  addMerged(markingGeos, markingMat, 'TrafficRoadPaint');

  /* ----------------------------------------------------------- lamp batch --- */

  let lampMesh = null;
  let lampColor = new THREE.Color();

  if (lampRecords.length) {
    const lampGeo = new THREE.CircleGeometry(0.145, 12);
    const lampMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, side: THREE.DoubleSide,
    });
    disposables.push(lampGeo, lampMat);

    lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, lampRecords.length);
    lampMesh.name = 'TrafficLamps';
    lampMesh.frustumCulled = false;
    lampMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < lampRecords.length; i++) {
      lampMesh.setMatrixAt(i, lampMatrices[i]);
    }
    lampMesh.instanceMatrix.needsUpdate = true;

    const colors = new Float32Array(lampRecords.length * 3);
    for (let i = 0; i < lampRecords.length; i++) {
      colors[i * 3] = LAMP_OFF.r;
      colors[i * 3 + 1] = LAMP_OFF.g;
      colors[i * 3 + 2] = LAMP_OFF.b;
    }
    lampMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    lampMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(lampMesh);
    stats.draws++;
    stats.lamps = lampRecords.length;
    stats.tris += (lampGeo.index ? lampGeo.index.count / 3 : lampGeo.attributes.position.count / 3) * lampRecords.length;
  }

  function signalStateAt(phase) {
    const p = ((phase % CYCLE) + CYCLE) % CYCLE;
    if (p < GREEN_TIME) return 'green';
    if (p < GREEN_TIME + AMBER_TIME) return 'amber';
    return 'red';
  }

  function setLampColor(record, on) {
    if (record.kind === 'ped') {
      if (on) lampColor.copy(record.slot === 0 ? PED_RED : PED_GREEN);
      else lampColor.copy(LAMP_OFF);
    } else if (!on) {
      lampColor.copy(LAMP_OFF);
    } else if (record.slot === 0) {
      lampColor.copy(LAMP_RED);
    } else if (record.slot === 1) {
      lampColor.copy(LAMP_AMBER);
    } else {
      lampColor.copy(LAMP_GREEN);
    }
    lampMesh.setColorAt(record.index, lampColor);
  }

  function applyLampStates(force = false) {
    if (!lampMesh) return;
    let dirty = false;
    for (const owner of crossings) {
      const state = signalStateAt(elapsed + owner.offset);
      if (!force && owner.state === state) continue;
      owner.state = state;
      for (const lamp of owner.lamps) {
        if (lamp.kind === 'beacon') continue;
        let on;
        if (lamp.kind === 'ped') {
          on = lamp.slot === 0 ? state !== 'red' : state === 'red';
        } else {
          on = (lamp.slot === 0 && state === 'red')
            || (lamp.slot === 1 && state === 'amber')
            || (lamp.slot === 2 && state === 'green');
        }
        setLampColor(lamp, on);
        dirty = true;
      }
    }
    for (const owner of works) {
      const state = signalStateAt(elapsed + owner.offset);
      if (!force && owner.state === state) continue;
      owner.state = state;
      for (const lamp of owner.lamps) {
        if (lamp.kind === 'beacon') continue;
        const on = (lamp.slot === 0 && state === 'red')
          || (lamp.slot === 1 && state === 'amber')
          || (lamp.slot === 2 && state === 'green');
        setLampColor(lamp, on);
        dirty = true;
      }
    }
    if (dirty) lampMesh.instanceColor.needsUpdate = true;
  }

  /* ------------------------------------------------------------- civilians -- */

  const carPlan = urban ? Math.max(1, Math.round(plan.cars * density)) : 0;
  const cars = [];
  let carMeshes = null;

  if (carPlan > 0) {
    const { body, dark, head, tail } = buildCarGeometry();
    if (body && dark && head && tail) {
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.34, metalness: 0.34,
      });
      const darkMat = new THREE.MeshStandardMaterial({
        color: 0x14171c, roughness: 0.58, metalness: 0.22,
      });
      const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      const tailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      disposables.push(body, dark, head, tail, bodyMat, darkMat, headMat, tailMat);

      const bodyMesh = new THREE.InstancedMesh(body, bodyMat, carPlan);
      const darkMesh = new THREE.InstancedMesh(dark, darkMat, carPlan);
      const headMesh = new THREE.InstancedMesh(head, headMat, carPlan);
      const tailMesh = new THREE.InstancedMesh(tail, tailMat, carPlan);

      for (const m of [bodyMesh, darkMesh, headMesh, tailMesh]) {
        m.name = 'TrafficCars';
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.castShadow = false;
        m.receiveShadow = false;
        group.add(m);
        stats.draws++;
      }

      const initColors = (mesh, r, g, b) => {
        const arr = new Float32Array(carPlan * 3);
        for (let i = 0; i < carPlan; i++) {
          arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b;
        }
        mesh.instanceColor = new THREE.InstancedBufferAttribute(arr, 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      };
      initColors(headMesh, HEADLIGHT.r, HEADLIGHT.g, HEADLIGHT.b);
      initColors(tailMesh, TAIL_ON.r, TAIL_ON.g, TAIL_ON.b);

      const bodyColors = new Float32Array(carPlan * 3);
      const paint = new THREE.Color();
      const used = [];

      for (let i = 0; i < carPlan; i++) {
        let t = random();
        for (let tries = 0; tries < 16; tries++) {
          let clash = false;
          for (const u of used) { if (lapDistance(t, u) < 0.045) { clash = true; break; } }
          if (!clash && !isInGap(t, gapZones) && t > 0.035 && t < 0.965) break;
          t = (t + 0.061) % 1;
        }
        used.push(t);

        const lane = i % 3;
        const lateral = (lane - 1) * (halfW * 0.55);
        const baseSpeed = 7.5 + random() * 7.5;

        const car = {
          index: i,
          t,
          lane,
          lateral,
          baseSpeed,
          speed: baseSpeed,
          scale: 0.92 + random() * 0.16,
          position: new THREE.Vector3(),
          angle: 0,
          radius: 1.55,
          active: true,
          hitCooldown: 0,
          braking: false,
        };

        paint.setHex(CAR_COLORS[Math.floor(random() * CAR_COLORS.length)]);
        bodyColors[i * 3] = paint.r;
        bodyColors[i * 3 + 1] = paint.g;
        bodyColors[i * 3 + 2] = paint.b;

        cars.push(car);
      }

      bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(bodyColors, 3);
      bodyMesh.instanceColor.setUsage(THREE.StaticDrawUsage);

      carMeshes = { bodyMesh, darkMesh, headMesh, tailMesh };
      stats.cars = cars.length;
      const trisOf = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
      stats.tris += (trisOf(body) + trisOf(dark) + trisOf(head) + trisOf(tail)) * cars.length;
    }
  }

  /* ------------------------------------------------------------- car update -- */

  const _dummy = new THREE.Object3D();
  const _p = new THREE.Vector3();
  const _tan = new THREE.Vector3();
  const _tailColor = new THREE.Color();

  function writeCarMatrix(car) {
    _dummy.position.copy(car.position);
    _dummy.rotation.set(0, car.angle, 0);
    _dummy.scale.setScalar(car.scale);
    _dummy.updateMatrix();
    const m = carMeshes;
    m.bodyMesh.setMatrixAt(car.index, _dummy.matrix);
    m.darkMesh.setMatrixAt(car.index, _dummy.matrix);
    m.headMesh.setMatrixAt(car.index, _dummy.matrix);
    m.tailMesh.setMatrixAt(car.index, _dummy.matrix);
  }

  function updateCars(dt) {
    if (!carMeshes || cars.length === 0) return;
    let tailDirty = false;

    for (const car of cars) {
      if (car.hitCooldown > 0) car.hitCooldown = Math.max(0, car.hitCooldown - dt);

      let target = car.baseSpeed;
      for (const other of cars) {
        if (other === car || other.lane !== car.lane) continue;
        let gap = (other.t - car.t + 1) % 1;
        gap *= length;
        if (gap > 0 && gap < 16) target = Math.min(target, other.speed * 0.9);
      }

      const k = 1 - Math.exp(-1.8 * dt);
      car.speed += (target - car.speed) * k;
      car.t = (car.t + car.speed * dt / length) % 1;

      curve.getPointAt(car.t, _p);
      curve.getTangentAt(car.t, _tan);
      const nx = -_tan.z;
      const nz = _tan.x;
      car.position.set(_p.x + nx * car.lateral, _p.y + 0.06, _p.z + nz * car.lateral);
      car.angle = Math.atan2(_tan.x, _tan.z);

      const braking = car.speed < car.baseSpeed * 0.72;
      if (braking !== car.braking) {
        car.braking = braking;
        _tailColor.copy(braking ? TAIL_BRAKE : TAIL_ON);
        carMeshes.tailMesh.setColorAt(car.index, _tailColor);
        tailDirty = true;
      }

      writeCarMatrix(car);
    }

    carMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
    carMeshes.darkMesh.instanceMatrix.needsUpdate = true;
    carMeshes.headMesh.instanceMatrix.needsUpdate = true;
    carMeshes.tailMesh.instanceMatrix.needsUpdate = true;
    if (tailDirty) carMeshes.tailMesh.instanceColor.needsUpdate = true;
  }

  /* ----------------------------------------------------------------- state -- */

  let elapsed = 0;

  // Place the cars on the opening frame before the first update.
  if (carMeshes) {
    for (const car of cars) {
      curve.getPointAt(car.t, _p);
      curve.getTangentAt(car.t, _tan);
      const nx = -_tan.z;
      const nz = _tan.x;
      car.position.set(_p.x + nx * car.lateral, _p.y + 0.06, _p.z + nz * car.lateral);
      car.angle = Math.atan2(_tan.x, _tan.z);
      writeCarMatrix(car);
    }
    carMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
    carMeshes.darkMesh.instanceMatrix.needsUpdate = true;
    carMeshes.headMesh.instanceMatrix.needsUpdate = true;
    carMeshes.tailMesh.instanceMatrix.needsUpdate = true;
  }

  applyLampStates(true);

  /* --------------------------------------------------------------- runtime -- */

  function update(dt) {
    elapsed += dt;
    applyLampStates();
    updateCars(dt);

    if (lampMesh) {
      // The amber beacons pulse on their own clock.
      let dirty = false;
      for (let i = 0; i < lampRecords.length; i++) {
        const rec = lampRecords[i];
        if (rec.kind !== 'beacon') continue;
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * 7.5 + i * 1.7));
        lampColor.copy(LAMP_AMBER).multiplyScalar(pulse);
        lampMesh.setColorAt(i, lampColor);
        dirty = true;
      }
      if (dirty) lampMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Oriented-box collision against the civilian fleet. Returns the struck car
   * (and puts it on a short cooldown) or `null`. Passing `isAI` only changes the
   * cooldown channel that gets used, so a car can be hit by both the player and
   * an opponent without spamming.
   */
  function collide(position, radius = 1.0, isAI = false) {
    if (!cars.length) return null;
    for (const car of cars) {
      if (car.hitCooldown > 0) continue;
      const dx = position.x - car.position.x;
      const dz = position.z - car.position.z;
      const sin = Math.sin(car.angle);
      const cos = Math.cos(car.angle);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const halfWidth = 1.02 + radius * 0.42;
      const halfLength = 2.15 + radius * 0.58;
      if (Math.abs(lx) < halfWidth && Math.abs(lz) < halfLength) {
        car.hitCooldown = isAI ? 0.9 : 1.25;
        return car;
      }
    }
    return null;
  }

  function getHazards() {
    return cars;
  }

  function reset() {
    if (lampMesh) {
      for (const owner of crossings) owner.state = null;
      for (const owner of works) owner.state = null;
      applyLampStates(true);
    }
  }

  function dispose() {
    while (group.children.length) group.remove(group.children[0]);
    for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
    disposables.length = 0;
    cars.length = 0;
    stats.draws = 0;
    stats.tris = 0;
  }

  return {
    group,
    stats,
    crossings,
    works,
    cars,
    update,
    collide,
    getHazards,
    reset,
    dispose,
  };
}

export default { createTraffic };
