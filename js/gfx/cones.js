import * as THREE from 'three';

import { bake, box, cylinder, mergeAll, seededRandom, trackFrame } from './geometry.js';

/**
 * cones.js — the hazards that make a street circuit feel hostile.
 *
 * A cone is the cheapest object in racing: a piece of plastic that a car can
 * flatten and drive on. That is exactly why it works as a hazard — it is
 * legible from 200 m away, it never kills the run, and knocking one over
 * *feels* like a mistake. This module scatters three kinds of work zones
 * across the lap:
 *
 *  - **Edge runs** taper a line of cones in from the verge, closing half a
 *    lane and forcing the player to commit to the open side.
 *  - **Slaloms** alternate six cones down the middle of the road, so the
 *    driver has to weave instead of just lifting.
 *  - **Gates** put one cone wall across the track with a single car-width gap
 *    offset to one side. Miss the gap and you take the wall.
 *
 * Each zone gets a flashing amber beacon on a warning-sign tripod, built from
 * one merged pole mesh and one instanced beacon batch. The cones themselves
 * are one `InstancedMesh` with baked vertex colours (orange body, white
 * reflective band, black base). A hit tips the cone into a short ballistic
 * tumble, then it pops back upright on a timer so the hazard outlives the
 * mistake.
 *
 * Collision is an oriented-box test against the car's centre and heading, so
 * clipping a cone with the nose counts even though the physics body is a
 * point at the middle.
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

const ZONE_PLAN = {
  low: { zones: 3 },
  medium: { zones: 4 },
  high: { zones: 5 },
  ultra: { zones: 6 },
};

const CONE_GROUND_OFFSET = 0.02;
const CONE_RADIUS = 0.38;
const RESPAWN_TIME = 7.5;

const AMBER = new THREE.Color(6.0, 2.4, 0.12);
const ONE = new THREE.Vector3(1, 1, 1);

/* ---------------------------------------------------------------- geometry ---- */

/** Attach a flat vertex colour so the cone can be one merged, one-material mesh. */
function paint(geometry, hex) {
  const count = geometry.attributes.position ? geometry.attributes.position.count : 0;
  if (!count) return geometry;
  const color = new THREE.Color(hex);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Orange cone + white reflective band + black base, merged with vertex colours. */
function buildConeGeometry() {
  const base = paint(box(0.46, 0.06, 0.46, 0, 0.03, 0), 0x16181b);
  const body = paint(new THREE.ConeGeometry(0.24, 0.62, 10, 1, false).translate(0, 0.37, 0), 0xf05a16);
  const band = paint(
    new THREE.CylinderGeometry(0.095, 0.162, 0.17, 10, 1, true).translate(0, 0.36, 0),
    0xeef2f2
  );
  const tip = paint(new THREE.CylinderGeometry(0.055, 0.075, 0.06, 8, 1, false).translate(0, 0.64, 0), 0xf05a16);
  return mergeAll([base, body, band, tip]);
}

/** Warning-sign face: orange triangle with a black exclamation mark. */
function makeWarningTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, 256, 256);

  ctx.fillStyle = '#f27a1a';
  ctx.beginPath();
  ctx.moveTo(128, 14);
  ctx.lineTo(242, 224);
  ctx.lineTo(14, 224);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 14;
  ctx.stroke();

  ctx.fillStyle = '#151515';
  ctx.font = 'bold 150px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 128, 168);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------- main ---- */

/**
 * Scatter work zones and collidable cones along one circuit.
 *
 * @param {object} opts
 * @param {THREE.Curve} opts.curve
 * @param {string} [opts.theme='alpine']
 * @param {number} [opts.seed=42]
 * @param {number} [opts.width=12]
 * @param {string} [opts.quality='high']
 * @param {number} [opts.density=1]
 * @param {Array<{tStart:number,tEnd:number}>} [opts.gapZones]
 * @returns {{group:THREE.Group, stats:object, cones:Array,
 *            update:Function, collide:Function, getHazards:Function,
 *            reset:Function, dispose:Function}}
 */
export function createCones(opts = {}) {
  const curve = opts.curve;
  const width = opts.width || 12;
  const quality = opts.quality || 'high';
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const density = clamp(opts.density != null ? opts.density : 1, 0.3, 2);
  const gapZones = opts.gapZones || [];
  const random = seededRandom(seed ^ 0x3c0f17);
  const halfW = width * 0.5;

  const group = new THREE.Group();
  group.name = 'TrackCones';

  const stats = { zones: 0, cones: 0, hits: 0, draws: 0, tris: 0 };
  const disposables = [];

  const empty = {
    group, stats, cones: [],
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

  const plan = ZONE_PLAN[quality] || ZONE_PLAN.high;
  const zoneCount = Math.max(1, Math.round(plan.zones * density));
  const zoneTypes = ['edge', 'slalom', 'gate', 'slalom', 'edge'];

  const cones = [];
  const signPoles = [];
  const signPlates = [];
  const beacons = [];

  const coneGeo = buildConeGeometry();
  const coneMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.02,
    emissive: 0x2a0800,
    emissiveIntensity: 0.45,
    side: THREE.DoubleSide,
  });
  disposables.push(coneGeo, coneMat);

  const _dummy = new THREE.Object3D();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _vec = new THREE.Vector3();

  function addCone(u, lateral, yawOffset = 0) {
    if (isInGap(u, gapZones)) return null;
    const frame = trackFrame(curve, u, width, lateral);
    const base = frame.position.clone();
    base.y += CONE_GROUND_OFFSET;

    const record = {
      index: cones.length,
      t: u,
      base,
      pos: base.clone(),
      yaw: frame.angle + yawOffset,
      rot: new THREE.Euler(0, frame.angle + yawOffset, 0),
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      scale: 1,
      active: true,
      hitTimer: 0,
      respawn: RESPAWN_TIME,
      respawnAnim: 0,
      radius: CONE_RADIUS,
      position: null,
    };
    record.position = record.pos;
    cones.push(record);
    return record;
  }

  function writeConeMatrix(record) {
    _dummy.position.copy(record.pos);
    _dummy.rotation.copy(record.rot);
    _dummy.scale.setScalar(record.scale);
    _dummy.updateMatrix();
    coneMesh.setMatrixAt(record.index, _dummy.matrix);
  }

  /* --------------------------------------------------------------- zones ---- */

  const startT = 0.085;
  const spanT = 0.80;

  for (let z = 0; z < zoneCount; z++) {
    let t = startT + (z + 0.4) * (spanT / zoneCount) + (random() - 0.5) * 0.02;
    for (let tries = 0; tries < 10 && isInGap(t, gapZones); tries++) t = (t + 0.043) % 1;
    t = clamp(t, 0.05, 0.94);

    const type = zoneTypes[z % zoneTypes.length];
    const side = random() < 0.5 ? 1 : -1;

    if (type === 'edge') {
      // A taper of cones closing half a lane, plus a second short row.
      const count = 5 + Math.floor(random() * 3);
      const lenT = 0.012;
      for (let j = 0; j < count; j++) {
        const u = t + (j / Math.max(1, count - 1)) * lenT;
        const lateral = side * (halfW - 0.55 - (j / Math.max(1, count - 1)) * (halfW * 0.62));
        addCone(u, lateral, (random() - 0.5) * 0.35);
      }
    } else if (type === 'slalom') {
      const count = 4 + Math.floor(random() * 3);
      const lenT = 0.019;
      for (let j = 0; j < count; j++) {
        const u = t + (j / Math.max(1, count - 1)) * lenT;
        const lateral = (j % 2 === 0 ? -1 : 1) * (1.75 + random() * 0.55);
        addCone(u, lateral, (random() - 0.5) * 0.3);
      }
    } else {
      // Gate: one wall with a single car-width gap offset to one side.
      const gapCenter = (random() < 0.5 ? -1 : 1) * 2.3;
      const gapHalf = 2.15;
      const count = 7;
      for (let j = 0; j < count; j++) {
        const lateral = -halfW + 0.75 + (j / (count - 1)) * (width - 1.5);
        if (Math.abs(lateral - gapCenter) < gapHalf) continue;
        addCone(t + (j % 2) * 0.0007, lateral, (random() - 0.5) * 0.25);
      }
    }

    // Warning tripod at the head of the zone, on the verge.
    const signT = t - 0.0035;
    const signFrame = trackFrame(curve, signT, width, side * (halfW + 1.25));
    const signPos = signFrame.position.clone();
    const signAngle = signFrame.angle + Math.PI;
    const signMatrix = new THREE.Matrix4().compose(
      signPos,
      _quat.setFromEuler(_euler.set(0, signAngle, 0)),
      ONE
    );

    signPoles.push(bake(cylinder(0.035, 0.045, 1.9, 6, 0, 0.95, 0), signMatrix));
    signPlates.push(bake(new THREE.PlaneGeometry(1.25, 1.25), signMatrix).translate(0, 2.18, 0.02));

    beacons.push({
      index: beacons.length,
      matrix: new THREE.Matrix4().compose(
        _vec.set(signPos.x, signPos.y + 2.78, signPos.z),
        _quat.setFromEuler(_euler.set(0, signAngle, 0)),
        ONE
      ),
    });

    stats.zones++;
  }

  // Start-line furniture: a tidy row of cones just off the grid.
  for (let i = 0; i < 4; i++) {
    const u = 0.972 + i * 0.006;
    addCone(u, halfW + 0.55, (random() - 0.5) * 0.25);
    addCone(u, -(halfW + 0.55), (random() - 0.5) * 0.25);
  }

  if (!cones.length) {
    // Nothing survived the gap filter; release the sign parts built above so a
    // gap-heavy theme cannot leak geometry through the empty façade.
    for (const g of signPoles) { try { g.dispose(); } catch (e) { /* ignore */ } }
    for (const g of signPlates) { try { g.dispose(); } catch (e) { /* ignore */ } }
    return empty;
  }

  const coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, cones.length);
  coneMesh.name = 'HazardCones';
  coneMesh.frustumCulled = false;
  coneMesh.castShadow = true;
  coneMesh.receiveShadow = false;
  coneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (const record of cones) writeConeMatrix(record);
  coneMesh.instanceMatrix.needsUpdate = true;
  group.add(coneMesh);
  disposables.push(coneMesh);
  stats.cones = cones.length;
  stats.draws++;
  stats.tris += (coneGeo.index ? coneGeo.index.count / 3 : coneGeo.attributes.position.count / 3) * cones.length;

  /* --------------------------------------------------------------- signs ---- */

  if (signPoles.length) {
    const poleGeo = mergeAll(signPoles);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.5, metalness: 0.6 });
    const poleMesh = new THREE.Mesh(poleGeo, poleMat);
    poleMesh.name = 'ConeSignPoles';
    poleMesh.frustumCulled = false;
    group.add(poleMesh);
    disposables.push(poleGeo, poleMat);
    stats.draws++;

    const plateGeo = mergeAll(signPlates);
    const plateMat = new THREE.MeshBasicMaterial({
      map: makeWarningTexture(),
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.name = 'ConeSignPlates';
    plateMesh.frustumCulled = false;
    group.add(plateMesh);
    disposables.push(plateGeo, plateMat);
    if (plateMat.map) disposables.push(plateMat.map);
    stats.draws++;
  }

  if (beacons.length) {
    const beaconGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const beaconMesh = new THREE.InstancedMesh(beaconGeo, beaconMat, beacons.length);
    beaconMesh.name = 'ConeBeacons';
    beaconMesh.frustumCulled = false;
    for (let i = 0; i < beacons.length; i++) beaconMesh.setMatrixAt(i, beacons[i].matrix);
    beaconMesh.instanceMatrix.needsUpdate = true;

    const colors = new Float32Array(beacons.length * 3);
    for (let i = 0; i < beacons.length; i++) {
      colors[i * 3] = AMBER.r; colors[i * 3 + 1] = AMBER.g; colors[i * 3 + 2] = AMBER.b;
    }
    beaconMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    beaconMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(beaconMesh);
    disposables.push(beaconGeo, beaconMat, beaconMesh);
    stats.draws++;
    beacons.mesh = beaconMesh;
  }

  /* ------------------------------------------------------------- runtime ---- */

  let elapsed = 0;
  let disposed = false;
  const _color = new THREE.Color();

  function knock(record, velocity) {
    record.active = false;
    record.hitTimer = 0;
    record.respawn = RESPAWN_TIME + random() * 2.5;
    const vx = velocity ? velocity.x : 0;
    const vz = velocity ? velocity.z : 0;
    const speed = velocity ? Math.hypot(vx, vz) : 0;
    record.vel.set(
      vx * 0.30 + (random() - 0.5) * 2.6,
      2.4 + Math.min(5.5, speed * 0.045),
      vz * 0.30 + (random() - 0.5) * 2.6
    );
    record.spin.set((random() - 0.5) * 16, (random() - 0.5) * 10, (random() - 0.5) * 16);
    record.rot.set(0, record.yaw, 0);
    record.scale = 1;
    stats.hits++;
  }

  function update(dt) {
    if (disposed || !Number.isFinite(dt)) return;
    elapsed += dt;
    let dirty = false;

    for (const record of cones) {
      if (!record.active) {
        record.hitTimer += dt;
        if (record.hitTimer < record.respawn) {
          record.vel.y -= 9.81 * dt;
          record.pos.addScaledVector(record.vel, dt);
          if (record.pos.y < record.base.y) {
            record.pos.y = record.base.y;
            record.vel.y *= -0.26;
            record.vel.x *= 0.72;
            record.vel.z *= 0.72;
            record.spin.multiplyScalar(0.72);
          }
          record.rot.x += record.spin.x * dt;
          record.rot.y += record.spin.y * dt;
          record.rot.z += record.spin.z * dt;
          writeConeMatrix(record);
          dirty = true;
        } else {
          record.active = true;
          record.pos.copy(record.base);
          record.rot.set(0, record.yaw, 0);
          record.vel.set(0, 0, 0);
          record.spin.set(0, 0, 0);
          record.scale = 0.25;
          record.respawnAnim = 0.4;
          writeConeMatrix(record);
          dirty = true;
        }
      } else if (record.respawnAnim > 0) {
        record.respawnAnim = Math.max(0, record.respawnAnim - dt);
        record.scale = 1 - (record.respawnAnim / 0.4) * 0.75;
        writeConeMatrix(record);
        dirty = true;
      }
    }

    if (dirty) coneMesh.instanceMatrix.needsUpdate = true;

    if (beacons.mesh) {
      for (let i = 0; i < beacons.length; i++) {
        const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(elapsed * 6.5 + i * 1.9));
        _color.copy(AMBER).multiplyScalar(pulse);
        beacons.mesh.setColorAt(i, _color);
      }
      beacons.mesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Oriented-box test against one car. `heading` is optional — without it the
   * test degrades to a sphere, which is what non-car callers want. The first
   * cone inside the box is knocked away and returned.
   */
  function collide(position, radius = 0.9, velocity = null, heading = null) {
    if (disposed || !position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
    const useHeading = Number.isFinite(heading);
    const sin = useHeading ? Math.sin(heading) : 0;
    const cos = useHeading ? Math.cos(heading) : 1;

    for (const record of cones) {
      if (!record.active) continue;

      const dy = (position.y - 0.35) - record.base.y;
      if (dy < -1.2 || dy > 1.6) continue;

      const dx = position.x - record.pos.x;
      const dz = position.z - record.pos.z;

      let hit;
      if (useHeading) {
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        hit = Math.abs(lx) < 1.02 + radius * 0.42 && Math.abs(lz) < 2.15 + radius * 0.58;
      } else {
        const r = radius + record.radius;
        hit = dx * dx + dz * dz < r * r;
      }

      if (hit) {
        knock(record, velocity);
        return record;
      }
    }
    return null;
  }

  function getHazards() {
    return cones;
  }

  function reset() {
    if (disposed) return;
    for (const record of cones) {
      record.active = true;
      record.pos.copy(record.base);
      record.rot.set(0, record.yaw, 0);
      record.vel.set(0, 0, 0);
      record.spin.set(0, 0, 0);
      record.scale = 1;
      record.hitTimer = 0;
      record.respawnAnim = 0;
      writeConeMatrix(record);
    }
    coneMesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    while (group.children.length) group.remove(group.children[0]);
    for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
    disposables.length = 0;
    cones.length = 0;
    signPoles.length = 0;
    signPlates.length = 0;
    beacons.length = 0;
    beacons.mesh = null;
    stats.draws = 0;
    stats.tris = 0;
  }

  return {
    group,
    stats,
    cones,
    update,
    collide,
    getHazards,
    reset,
    dispose,
  };
}

export default { createCones };
