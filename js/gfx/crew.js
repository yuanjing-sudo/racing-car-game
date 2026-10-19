import * as THREE from 'three';

import { getMetalMaterial, getPaintMaterial } from './materials.js';
import { box, cylinder, mergeAll, trackFrame } from './geometry.js';

/**
 * crew.js — the people who make a circuit feel inhabited.
 *
 * A track full of barriers and grandstands still reads as a diorama until
 * somebody stands in the gravel waving a flag. This module populates the
 * working edge of the circuit:
 *
 *  - **Marshals** at selected corners, in hi-vis vests, one per station
 *    waving a cloth flag (yellow, blue or red) and one standing by with a
 *    extinguisher.
 *  - **Camera operators** behind tripods that physically pivot to follow the
 *    player's car around the corner.
 *  - **Photographers** along the fence line, whose flashguns pop at random
 *    intervals — brighter and more frequent after dark.
 *
 * The whole population is drawn from a handful of `InstancedMesh` batches:
 * one for torsos, legs, heads, caps and each arm, plus poles, flags, tripods,
 * camera bodies and flashes. That keeps the module at roughly a dozen draw
 * calls regardless of how many people are on the bank.
 *
 * Flag cloth ripples in a small vertex-shader injection rather than on the
 * CPU, so even twenty flags cost nothing per frame.
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

/** Populations by quality. People are cheap; tripods and flashes are not. */
const PLAN = {
  low: { stations: 3, perStation: 1, cameras: 1, photographers: 2 },
  medium: { stations: 4, perStation: 2, cameras: 3, photographers: 4 },
  high: { stations: 6, perStation: 2, cameras: 4, photographers: 6 },
  ultra: { stations: 8, perStation: 3, cameras: 5, photographers: 9 },
};

const FLAG_COLORS = [0xffd21e, 0xffd21e, 0xffd21e, 0x2b7bff, 0xff2a22, 0xf2f2f2];

const SKIN_COLORS = [0xf1c7a5, 0xd9a273, 0xa8714c, 0x8a5a3b, 0xe8b48f];

/* -------------------------------------------------------------- geometry ---- */

/** Torso with a slight taper, plus a hi-vis collar. */
function torsoGeometry() {
  return mergeAll([
    cylinder(0.19, 0.23, 0.64, 8, 0, 1.04, 0),
    cylinder(0.235, 0.235, 0.05, 8, 0, 1.36, 0), // collar / shoulder line
  ]);
}

/** Both legs and a pair of boots, merged around the hip. */
function legsGeometry() {
  return mergeAll([
    box(0.15, 0.72, 0.17, -0.10, 0.40, 0),
    box(0.15, 0.72, 0.17, 0.10, 0.40, 0),
    box(0.17, 0.10, 0.26, -0.10, 0.05, 0.04),
    box(0.17, 0.10, 0.26, 0.10, 0.05, 0.04),
  ]);
}

/** A single arm hanging from a shoulder pivot at the origin. */
function armGeometry() {
  return mergeAll([
    box(0.085, 0.46, 0.085, 0, -0.23, 0),
    box(0.075, 0.12, 0.075, 0, -0.51, 0.015), // glove
  ]);
}

/** Flag pole, origin at the foot so it can simply stand in the ground. */
function poleGeometry() {
  const g = new THREE.CylinderGeometry(0.016, 0.02, 1.95, 6);
  g.translate(0, 0.975, 0);
  return g;
}

/** Extinguisher: a squat red bottle with a black nozzle. */
function extinguisherGeometry() {
  return mergeAll([
    cylinder(0.085, 0.095, 0.5, 8, 0.36, 0.25, 0.02),
    cylinder(0.025, 0.025, 0.14, 5, 0.36, 0.56, 0.02),
    box(0.06, 0.06, 0.2, 0.36, 0.60, 0.08),
  ]);
}

/** Camera tripod: three splayed legs and a levelling head. */
function tripodGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.017, 0.022, 1.18, 5);
    leg.translate(0, 0.59, 0);
    leg.rotateX(0.20);
    leg.rotateY(a);
    leg.translate(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
    parts.push(leg);
  }
  parts.push(cylinder(0.075, 0.075, 0.09, 8, 0, 1.18, 0));
  return mergeAll(parts);
}

/** Broadcast camera: body, lens and a top-mounted viewfinder. */
function cameraGeometry() {
  return mergeAll([
    box(0.26, 0.22, 0.34, 0, 1.34, 0),
    box(0.12, 0.10, 0.22, 0, 1.48, -0.16),
    cylinder(0.085, 0.085, 0.20, 8, 0, 1.34, 0.26, Math.PI / 2),
    cylinder(0.055, 0.055, 0.06, 8, 0, 1.34, 0.38, Math.PI / 2),
  ]);
}

/** Flag cloth, authored from the pole outward so the shader can taper it. */
function flagGeometry() {
  const g = new THREE.PlaneGeometry(0.95, 0.58, 10, 4);
  g.translate(0.50, 0, 0);
  return g;
}

/* --------------------------------------------------------------- material ---- */

/**
 * Cloth material with a two-frequency wave injected into `begin_vertex`.
 * Instance translation seeds the phase, so flags do not flap in lockstep.
 */
function createFlagMaterial(timeUniform) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCrewTime = timeUniform;
    shader.vertexShader = 'uniform float uCrewTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase = instanceMatrix[3].x * 0.63 + instanceMatrix[3].z * 0.41;
      #else
        float phase = 0.0;
      #endif
      float edge = clamp(position.x, 0.0, 1.0);
      transformed.z += (
        sin(position.x * 6.5 + uCrewTime * 5.5 + phase) * 0.075 +
        sin(position.x * 14.0 - uCrewTime * 8.0 + phase * 1.7) * 0.020
      ) * edge;`
    );
  };
  mat.customProgramCacheKey = () => 'crew-flag';
  return mat;
}

/* ------------------------------------------------------------------- main ---- */

/**
 * Build the trackside crew for one circuit.
 *
 * @param {object} opts
 * @param {string} [opts.theme='alpine']
 * @param {number} [opts.seed=42]
 * @param {THREE.Curve} opts.curve
 * @param {number} [opts.width=12]
 * @param {string} [opts.quality='high']
 * @param {number} [opts.density=1]
 * @param {object} [opts.lighting] optional lighting rig (unused, kept for parity)
 * @returns {{ group: THREE.Group, stats: object, update: Function, dispose: Function, people: object[] }}
 */
export function createCrew(opts = {}) {
  const curve = opts.curve;
  const width = opts.width || 12;
  const quality = opts.quality || 'high';
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const random = mulberry32(seed ^ 0x639c5b);
  const density = clamp(opts.density != null ? opts.density : 1, 0.3, 2);

  const group = new THREE.Group();
  group.name = 'TracksideCrew';

  const stats = { stations: 0, marshals: 0, cameras: 0, photographers: 0, people: 0, draws: 0, tris: 0 };
  const disposables = [];
  const geometries = [];

  const empty = {
    group, stats, people: [],
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
  const stationCount = Math.max(1, Math.round(plan.stations * density));
  const cameraCount = Math.max(0, Math.round(plan.cameras * density));
  const photoCount = Math.max(0, Math.round(plan.photographers * density));

  const people = [];

  /* ---------------------------------------------------------- corner picking -- */

  function findCorners(count, samples) {
    const tanA = new THREE.Vector3();
    const tanB = new THREE.Vector3();
    const bend = new Float32Array(samples);
    const side = new Int8Array(samples);

    for (let i = 0; i < samples; i++) {
      const u = i / samples;
      curve.getTangentAt(u, tanA);
      curve.getTangentAt(Math.min(1, u + 1 / samples), tanB);
      bend[i] = Math.acos(clamp(tanA.dot(tanB), -1, 1));
      const cross = tanA.x * tanB.z - tanA.z * tanB.x;
      side[i] = cross >= 0 ? 1 : -1;
    }

    const peaks = [];
    for (let i = 0; i < samples; i++) {
      const prev = bend[(i + samples - 1) % samples];
      const next = bend[(i + 1) % samples];
      if (bend[i] >= prev && bend[i] >= next && bend[i] > 0.008) {
        peaks.push({ u: i / samples, weight: bend[i], side: side[i] });
      }
    }
    peaks.sort((a, b) => b.weight - a.weight);

    const chosen = [];
    for (const p of peaks) {
      let tooClose = false;
      for (const c of chosen) {
        let d = Math.abs(c.u - p.u);
        if (d > 0.5) d = 1 - d;
        if (d < 0.05) { tooClose = true; break; }
      }
      if (!tooClose) chosen.push(p);
      if (chosen.length >= count) break;
    }

    // A perfectly straight test track still deserves company.
    let n = 0;
    while (chosen.length < count) {
      chosen.push({ u: (n + 0.5) / count * 0.9 + 0.02, weight: 0.01, side: n % 2 ? -1 : 1 });
      n++;
      if (n > count * 2) break;
    }
    return chosen;
  }

  const corners = findCorners(stationCount, 200);

  /* ---------------------------------------------------- marshal population -- */

  for (let s = 0; s < corners.length; s++) {
    const corner = corners[s];
    // Marshals stand outside the corner, well beyond the barrier line.
    const lateral = corner.side * (width * 0.5 + 4.2 + random() * 1.8);
    const base = trackFrame(curve, corner.u, width, lateral);
    const outside = corner.side === 1 ? 1 : -1;
    const yaw = Math.atan2(-outside * base.normal.x, -outside * base.normal.z);

    const per = Math.max(1, Math.round(plan.perStation * density));
    for (let m = 0; m < per; m++) {
      const spread = (m - (per - 1) * 0.5) * 1.5;
      const px = base.position.x + Math.cos(yaw + Math.PI * 0.5) * spread;
      const pz = base.position.z - Math.sin(yaw + Math.PI * 0.5) * spread;

      people.push({
        role: 'marshal',
        x: px, y: base.position.y, z: pz,
        yaw: yaw + (random() * 2 - 1) * 0.35,
        scale: 0.92 + random() * 0.16,
        phase: random() * Math.PI * 2,
        flagColor: s === 0 ? 0xf2f2f2 : FLAG_COLORS[Math.floor(random() * FLAG_COLORS.length)],
        hasFlag: m % 2 === 0,
        skin: SKIN_COLORS[Math.floor(random() * SKIN_COLORS.length)],
        vest: random() < 0.7 ? 0xff6b12 : 0xffc21a,
        armSwing: 0.1 + random() * 0.12,
        flash: 0, flashTimer: 0,
      });
    }
    stats.stations++;
  }

  /* ------------------------------------------------------------ camera ops -- */

  const cameraSlots = [];
  for (let i = 0; i < cameraCount; i++) {
    const c = corners[i % Math.max(1, corners.length)] || { u: 0.25, side: 1 };
    const lateral = c.side * (width * 0.5 + 3.0 + random() * 1.4);
    const base = trackFrame(curve, c.u + (random() * 2 - 1) * 0.012, width, lateral);
    const outside = c.side === 1 ? 1 : -1;
    const yaw = Math.atan2(-outside * base.normal.x, -outside * base.normal.z);

    const person = {
      role: 'camera',
      x: base.position.x - Math.sin(yaw) * 0.62,
      y: base.position.y,
      z: base.position.z - Math.cos(yaw) * 0.62,
      tripodX: base.position.x, tripodZ: base.position.z,
      yaw,
      aimYaw: yaw,
      pitch: 0,
      scale: 0.95 + random() * 0.1,
      phase: random() * Math.PI * 2,
      skin: SKIN_COLORS[Math.floor(random() * SKIN_COLORS.length)],
      vest: 0x2a2e36,
      hasFlag: false,
      armSwing: 0,
      flash: 0, flashTimer: 0,
    };
    people.push(person);
    cameraSlots.push({ person, index: cameraSlots.length });
    stats.cameras++;
  }

  /* --------------------------------------------------------- photographers -- */

  for (let i = 0; i < photoCount; i++) {
    const c = corners[(i + 1) % Math.max(1, corners.length)] || { u: 0.4, side: -1 };
    const lateral = c.side * (width * 0.5 + 2.6 + random() * 2.6);
    const base = trackFrame(curve, c.u + (random() * 2 - 1) * 0.035, width, lateral);
    const outside = c.side === 1 ? 1 : -1;
    const yaw = Math.atan2(-outside * base.normal.x, -outside * base.normal.z);

    people.push({
      role: 'photo',
      x: base.position.x, y: base.position.y, z: base.position.z,
      yaw: yaw + (random() * 2 - 1) * 0.5,
      scale: 0.9 + random() * 0.14,
      phase: random() * Math.PI * 2,
      skin: SKIN_COLORS[Math.floor(random() * SKIN_COLORS.length)],
      vest: 0x353a42,
      hasFlag: false,
      armSwing: 0,
      flash: 0,
      flashTimer: 0.4 + random() * 3.5,
      flashGap: 1.6 + random() * 4.5,
    });
    stats.photographers++;
  }

  for (let i = 0; i < people.length; i++) people[i].index = i;

  stats.marshals = people.filter((p) => p.role === 'marshal').length;
  stats.people = people.length;

  if (people.length === 0) return empty;

  /* --------------------------------------------------------------- batches -- */

  const vestMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.02 });
  const legsMat = new THREE.MeshStandardMaterial({ color: 0x242832, roughness: 0.9, metalness: 0.0 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.0 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.0 });
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const timeUniform = { value: 0 };
  const flagMat = createFlagMaterial(timeUniform);
  const metalMat = getMetalMaterial();
  const extMat = getPaintMaterial(0xc2261c);

  const torsoGeo = torsoGeometry();
  const legsGeo = legsGeometry();
  const headGeo = new THREE.SphereGeometry(0.115, 10, 8);
  headGeo.translate(0, 1.49, 0);
  const capGeo = new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  capGeo.translate(0, 1.52, 0);
  const armGeo = armGeometry();
  const poleGeo = poleGeometry();
  const flagGeo = flagGeometry();
  const extGeo = extinguisherGeometry();
  const tripodGeo = tripodGeometry();
  const broadcastGeo = cameraGeometry();
  const flashGeo = new THREE.PlaneGeometry(0.42, 0.30);

  for (const g of [torsoGeo, legsGeo, headGeo, capGeo, armGeo, poleGeo, flagGeo, extGeo, tripodGeo, broadcastGeo, flashGeo]) {
    if (g) geometries.push(g);
  }

  function instanced(geo, mat, count, name) {
    if (!geo || count <= 0) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
    stats.draws++;
    const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    stats.tris += Math.round(tris * count);
    return mesh;
  }

  const N = people.length;
  const torsoMesh = instanced(torsoGeo, vestMat, N, 'CrewTorsos');
  const legsMesh = instanced(legsGeo, legsMat, N, 'CrewLegs');
  const headMesh = instanced(headGeo, skinMat, N, 'CrewHeads');
  const capMesh = instanced(capGeo, capMat, N, 'CrewCaps');
  const armLMesh = instanced(armGeo, vestMat, N, 'CrewArmL');
  const armRMesh = instanced(armGeo, vestMat, N, 'CrewArmR');

  const flagPeople = people.filter((p) => p.hasFlag);
  const extPeople = people.filter((p) => p.role === 'marshal' && !p.hasFlag);
  const poleMesh = instanced(poleGeo, metalMat, flagPeople.length, 'CrewFlagPoles');
  const flagMesh = instanced(flagGeo, flagMat, flagPeople.length, 'CrewFlags');
  const extMesh = instanced(extGeo, extMat, extPeople.length, 'CrewExtinguishers');
  const tripodMesh = instanced(tripodGeo, metalMat, cameraSlots.length, 'CameraTripods');
  const broadcastMesh = instanced(broadcastGeo, metalMat, cameraSlots.length, 'BroadcastCameras');
  const flashMesh = instanced(flashGeo, flashMat, stats.photographers, 'PhotoFlashes');

  /* -------------------------------------------------------------- placement -- */

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _pos = new THREE.Vector3();
  const _scale = new THREE.Vector3();
  const _color = new THREE.Color();

  function writeStatic(mesh, index, x, y, z, yaw, s) {
    if (!mesh) return;
    _pos.set(x, y, z);
    _q.setFromEuler(_e.set(0, yaw, 0));
    _scale.set(s, s, s);
    _m4.compose(_pos, _q, _scale);
    mesh.setMatrixAt(index, _m4);
  }

  // Bodies, heads and legs never move; write them once.
  for (let i = 0; i < N; i++) {
    const p = people[i];
    writeStatic(torsoMesh, i, p.x, p.y, p.z, p.yaw, p.scale);
    writeStatic(legsMesh, i, p.x, p.y, p.z, p.yaw, p.scale);
    writeStatic(headMesh, i, p.x, p.y, p.z, p.yaw, p.scale);
    writeStatic(capMesh, i, p.x, p.y, p.z, p.yaw, p.scale);

    if (torsoMesh) torsoMesh.setColorAt(i, _color.setHex(p.vest));
    if (armLMesh) armLMesh.setColorAt(i, _color.setHex(p.vest));
    if (armRMesh) armRMesh.setColorAt(i, _color.setHex(p.vest));
    if (headMesh) headMesh.setColorAt(i, _color.setHex(p.skin));
    if (capMesh) capMesh.setColorAt(i, _color.setHex(p.role === 'marshal' ? p.vest : 0x1d2026));
  }

  // Poles, flags and extinguishers.
  for (let i = 0; i < flagPeople.length; i++) {
    const p = flagPeople[i];
    const sideX = Math.cos(p.yaw) * 0.42;
    const sideZ = -Math.sin(p.yaw) * 0.42;
    writeStatic(poleMesh, i, p.x + sideX, p.y + 0.18, p.z + sideZ, p.yaw, p.scale);
    writeStatic(flagMesh, i, p.x + sideX, p.y + 1.92 * p.scale, p.z + sideZ, p.yaw, p.scale);
    if (flagMesh) flagMesh.setColorAt(i, _color.setHex(p.flagColor));
  }
  for (let i = 0; i < extPeople.length; i++) {
    writeStatic(extMesh, i, extPeople[i].x, extPeople[i].y, extPeople[i].z, extPeople[i].yaw, extPeople[i].scale);
  }
  for (let i = 0; i < cameraSlots.length; i++) {
    const p = cameraSlots[i].person;
    writeStatic(tripodMesh, i, p.tripodX, p.y, p.tripodZ, p.yaw, p.scale);
  }

  if (torsoMesh && torsoMesh.instanceColor) torsoMesh.instanceColor.needsUpdate = true;
  if (armLMesh && armLMesh.instanceColor) armLMesh.instanceColor.needsUpdate = true;
  if (armRMesh && armRMesh.instanceColor) armRMesh.instanceColor.needsUpdate = true;
  if (headMesh && headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
  if (capMesh && capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
  if (flagMesh && flagMesh.instanceColor) flagMesh.instanceColor.needsUpdate = true;
  for (const m of [torsoMesh, legsMesh, headMesh, capMesh, armLMesh, armRMesh, poleMesh, flagMesh, extMesh, tripodMesh, broadcastMesh, flashMesh]) {
    if (m) m.instanceMatrix.needsUpdate = true;
  }

  disposables.push(vestMat, legsMat, skinMat, capMat, flashMat, flagMat);
  for (const g of geometries) disposables.push(g);

  /* ---------------------------------------------------------------- update -- */

  let time = 0;
  const _shoulder = new THREE.Vector3();
  const _target = new THREE.Vector3();
  const _armQ = new THREE.Quaternion();

  /**
   * Pose one arm. The arm geometry hangs from a pivot at the origin, so the
   * instance is simply placed at the shoulder and rotated.
   */
  function poseArm(mesh, index, p, sideSign, pitch, roll) {
    if (!mesh) return;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    _shoulder.set(
      p.x + c * 0.235 * sideSign * p.scale,
      p.y + 1.30 * p.scale,
      p.z - s * 0.235 * sideSign * p.scale,
    );
    _q.setFromEuler(_e.set(0, p.yaw, 0));
    _armQ.setFromEuler(_e.set(pitch, 0, roll * sideSign));
    _q.multiply(_armQ);
    _scale.set(p.scale, p.scale, p.scale);
    _m4.compose(_shoulder, _q, _scale);
    mesh.setMatrixAt(index, _m4);
  }

  function update(dt, ctx = {}) {
    time += dt;
    timeUniform.value = time;

    // Hi-vis catches the scene light and glows faintly at night so the marshals
    // do not vanish into the dark.
    const night = ctx.isNight === true;
    vestMat.emissive.setHex(0xff5a00);
    vestMat.emissiveIntensity = night ? 0.22 : 0.03;

    // Everyone's arms.
    for (let i = 0; i < N; i++) {
      const p = people[i];
      if (p.role === 'marshal') {
        if (p.hasFlag) {
          // Flag arm raised, rolling through a slow wave.
          const roll = Math.sin(time * 2.2 + p.phase) * 0.32;
          poseArm(armRMesh, i, p, 1, -2.55, 0.25 + roll);
          poseArm(armLMesh, i, p, -1, -0.18, Math.sin(time * 1.4 + p.phase) * 0.08);
        } else {
          poseArm(armRMesh, i, p, 1, -0.30 + Math.sin(time * 1.7 + p.phase) * 0.10, 0.08);
          poseArm(armLMesh, i, p, -1, -0.22 + Math.sin(time * 1.5 + p.phase + 1.1) * 0.08, -0.08);
        }
      } else if (p.role === 'camera') {
        poseArm(armRMesh, i, p, 1, -1.35, 0.28);
        poseArm(armLMesh, i, p, -1, -1.35, -0.28);
      } else {
        // Photographers hold a camera to the eye.
        const jitter = Math.sin(time * 2.6 + p.phase) * 0.02;
        poseArm(armRMesh, i, p, 1, -1.95 + jitter, 0.30);
        poseArm(armLMesh, i, p, -1, -1.95 - jitter, -0.30);
      }
    }

    if (armLMesh) armLMesh.instanceMatrix.needsUpdate = true;
    if (armRMesh) armRMesh.instanceMatrix.needsUpdate = true;

    // Camera operators track the player; fall back to the lens position.
    const focus = ctx.focus;
    const fallback = ctx.camera ? ctx.camera.position : null;
    for (let i = 0; i < cameraSlots.length; i++) {
      const p = cameraSlots[i].person;
      _target.copy(focus || fallback || _target.set(p.x, p.y + 1.3, p.z + 1));
      const dx = _target.x - p.x;
      const dz = _target.z - p.z;
      const dist = Math.max(0.5, Math.hypot(dx, dz));
      const wantYaw = Math.atan2(dx, dz);
      const wantPitch = clamp(Math.atan2(_target.y - (p.y + 1.3), dist), -0.5, 0.25);

      // Ease toward the target so the head does not snap.
      let diff = wantYaw - p.aimYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.aimYaw += diff * Math.min(1, dt * 6);
      p.pitch += (wantPitch - p.pitch) * Math.min(1, dt * 5);

      if (broadcastMesh) {
        _pos.set(p.x, p.y + 0.02, p.z);
        _q.setFromEuler(_e.set(p.pitch, p.aimYaw, 0, 'YXZ'));
        _scale.set(p.scale, p.scale, p.scale);
        _m4.compose(_pos, _q, _scale);
        broadcastMesh.setMatrixAt(i, _m4);
      }

      // The operator's body turns with the camera.
      p.yaw = p.aimYaw;
      writeStatic(torsoMesh, p.index, p.x, p.y, p.z, p.yaw, p.scale);
      writeStatic(legsMesh, p.index, p.x, p.y, p.z, p.yaw, p.scale);
      writeStatic(headMesh, p.index, p.x, p.y, p.z, p.yaw, p.scale);
      writeStatic(capMesh, p.index, p.x, p.y, p.z, p.yaw, p.scale);
    }
    if (broadcastMesh) broadcastMesh.instanceMatrix.needsUpdate = true;
    if (torsoMesh) torsoMesh.instanceMatrix.needsUpdate = true;
    if (legsMesh) legsMesh.instanceMatrix.needsUpdate = true;
    if (headMesh) headMesh.instanceMatrix.needsUpdate = true;
    if (capMesh) capMesh.instanceMatrix.needsUpdate = true;

    // Photographers' flashguns.
    if (flashMesh) {
      let photoIndex = 0;
      for (let i = 0; i < N; i++) {
        const p = people[i];
        if (p.role !== 'photo') continue;
        p.flashTimer -= dt;
        if (p.flash >= 0) p.flash = Math.max(0, p.flash - dt * 9);
        if (p.flashTimer <= 0) {
          p.flash = 1;
          p.flashTimer = p.flashGap * (night ? 0.55 : 1) * (0.6 + Math.random() * 0.9);
        }

        if (p.flash > 0.01) {
          const s = p.scale * (0.7 + p.flash * 0.8);
          _pos.set(
            p.x + Math.sin(p.yaw) * 0.22,
            p.y + 1.58 * p.scale,
            p.z + Math.cos(p.yaw) * 0.22,
          );
          _q.setFromEuler(_e.set(0, p.yaw, 0));
          _scale.set(s, s, s);
          _m4.compose(_pos, _q, _scale);
        } else {
          _m4.makeScale(0, 0, 0);
        }
        flashMesh.setMatrixAt(photoIndex++, _m4);
      }
      flashMesh.instanceMatrix.needsUpdate = true;
      flashMat.opacity = night ? 1 : 0.85;
    }
  }

  return { group, stats, people, update, dispose: empty.dispose };
}

export default { createCrew };
