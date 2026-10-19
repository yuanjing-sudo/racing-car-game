import * as THREE from 'three';

import { getRoadMaterial, getRubberMaterial, applyWetness } from './materials.js';

/**
 * roaddetail.js — the surface the racing line actually lives on.
 *
 * `decals.js` paints the *intent* of a circuit (arrows, grid boxes, chevrons);
 * this module adds the wear and repair a real asphalt surface accumulates:
 *
 *  - **Repair patches** — irregular, slightly mismatched rectangles of newer
 *    tarmac, some darker, some sun-bleached, laid down in a single merged mesh.
 *  - **Tar snakes** — the glossy wiggling lines of crack sealant that follow
 *    the joints of a road. Each is a tapered ribbon of quads.
 *  - **Expansion joints** — thin transverse seams cut across the full width at
 *    regular intervals, so the tarmac reads as laid in slabs, not poured.
 *  - **Manhole covers** — instanced iron discs with a cast tread pattern,
 *    dropped at the road edge where services run.
 *  - **Drain grates** — louvred steel rectangles hugging the kerb line.
 *  - **Tyre marbles** — the little black rubber crumbs that collect off-line
 *    at corner exits, one instanced draw for the whole lap.
 *  - **Dust fringes** — a soft, alpha-faded band of grit blown onto the road
 *    from each edge, which breaks the perfect rectangle of the tarmac.
 *
 * Everything is authored procedurally, merged into a handful of draw calls and
 * lifted a few millimetres above the road with polygon offset so it never
 * z-fights with the surface it decorates. Placement is seeded, so a track
 * always wears the same way.
 */

/* ------------------------------------------------------------------ helpers ---- */

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Small, fast, deterministic PRNG (mulberry32). */
function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function textureFrom(canvas, srgb = true) {
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** A cast-iron manhole: rim, cast tread and six bolts. */
function manholeTexture() {
  const c = makeCanvas(128, 128);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const mid = 64;

  ctx.fillStyle = '#26282b';
  ctx.fillRect(0, 0, 128, 128);

  // outer rim
  ctx.beginPath();
  ctx.arc(mid, mid, 62, 0, Math.PI * 2);
  ctx.fillStyle = '#3a3d42';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(mid, mid, 56, 0, Math.PI * 2);
  ctx.fillStyle = '#232528';
  ctx.fill();

  // cast tread — a field of short raised dashes, clipped by radius by hand
  for (let y = 12; y < 118; y += 8) {
    for (let x = 12; x < 118; x += 8) {
      const dx = x - mid, dy = y - mid;
      if (dx * dx + dy * dy > 51 * 51) continue;
      ctx.fillStyle = (x + y) % 16 === 0 ? '#4a4e54' : '#2f3236';
      ctx.fillRect(x, y, 4, 2);
    }
  }

  // six bolts around the rim
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.arc(mid + Math.cos(a) * 51, mid + Math.sin(a) * 51, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#5d626a';
    ctx.fill();
  }

  // faint rim highlight so the disc catches the sun
  ctx.beginPath();
  ctx.arc(mid, mid, 59, Math.PI * 1.1, Math.PI * 1.9);
  ctx.strokeStyle = 'rgba(190,198,210,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  return textureFrom(c, true);
}

/** A louvred steel drain grate set in a concrete collar. */
function grateTexture() {
  const c = makeCanvas(128, 128);
  if (!c) return null;
  const ctx = c.getContext('2d');

  // concrete collar
  ctx.fillStyle = '#77736c';
  ctx.fillRect(0, 0, 128, 128);
  // recessed steel frame
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(12, 12, 104, 104);
  // louvres
  for (let y = 20; y < 112; y += 12) {
    ctx.fillStyle = '#43474d';
    ctx.fillRect(20, y, 88, 5);
    ctx.fillStyle = '#15171a';
    ctx.fillRect(20, y + 5, 88, 4);
  }
  // frame highlight
  ctx.strokeStyle = '#5a5f66';
  ctx.lineWidth = 2;
  ctx.strokeRect(13, 13, 102, 102);

  return textureFrom(c, true);
}

/**
 * Dust blown onto the tarmac from the verge. Alpha falls off to the left
 * (the inside of the strip) so the band dissolves into the road.
 *
 * @param {function(): number} [random] seeded source for the grit speckles
 */
function fringeTexture(random = Math.random) {
  const c = makeCanvas(64, 32);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 32);

  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0.0, 'rgba(74,62,46,0)');
  g.addColorStop(0.45, 'rgba(80,68,50,0.20)');
  g.addColorStop(0.82, 'rgba(88,75,56,0.46)');
  g.addColorStop(1.0, 'rgba(96,82,60,0.58)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 32);

  // grit speckles, denser toward the outer edge
  for (let i = 0; i < 220; i++) {
    const x = random() * 64;
    const a = (x / 64) * 0.5 * random();
    ctx.fillStyle = `rgba(40,34,26,${a.toFixed(3)})`;
    ctx.fillRect(x, random() * 32, 1 + random() * 1.6, 1);
  }

  const tex = textureFrom(c, true);
  if (tex) tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/* ------------------------------------------------------------- mesh builder ---- */

/**
 * Merge flat lap-space geometry into one buffer.
 *
 * Every helper takes lap coordinates — `u` along the curve, `lateral` across
 * it in metres — so callers can think in terms of "a patch 2 m long, 0.8 m off
 * the centre" instead of building world-space transforms by hand.
 *
 * @param {THREE.Curve} curve
 * @param {number} width track width in metres
 */
function createBuilder(curve, width) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let verts = 0;

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _up = new THREE.Vector3();

  function sample(u, lateral, lift) {
    const t = clamp(u, 0, 1);
    curve.getPointAt(t, _p);
    curve.getTangentAt(t, _t);
    _n.set(-_t.z, 0, _t.x);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0); else _n.normalize();
    _up.crossVectors(_n, _t).normalize();
    if (_up.y < 0) _up.negate();

    positions.push(_p.x + _n.x * lateral, _p.y + lift, _p.z + _n.z * lateral);
    normals.push(_up.x, _up.y, _up.z);
    uvs.push((lateral + width * 0.5) * 0.25, t * 260);
    return verts++;
  }

  /**
   * Convex polygon in lap space, fan-triangulated.
   * @param {number[][]} ring array of [u, lateral] pairs
   */
  function poly(ring, lift = 0.008) {
    if (!ring || ring.length < 3) return;
    let cu = 0;
    let cl = 0;
    for (const q of ring) { cu += q[0]; cl += q[1]; }
    cu /= ring.length;
    cl /= ring.length;

    const base = verts;
    sample(cu, cl, lift);
    for (const q of ring) sample(q[0], q[1], lift);
    for (let i = 0; i < ring.length; i++) {
      indices.push(base, base + 1 + i, base + 1 + ((i + 1) % ring.length));
    }
  }

  /**
   * A tapered ribbon along a lap-space centreline, used for tar snakes.
   * @param {number[][]} points [u, lateral] centreline samples
   * @param {number[]} halfWidths matching half-widths in metres
   */
  function ribbon(points, halfWidths, lift = 0.008) {
    if (!points || points.length < 2) return;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const hw = halfWidths[i] != null ? halfWidths[i] : 0.05;
      sample(p[0], p[1] - hw, lift);
      sample(p[0], p[1] + hw, lift);
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  function build(material) {
    if (!positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = 1;
    return mesh;
  }

  return {
    poly,
    ribbon,
    build,
    get empty() { return positions.length === 0; },
    get triangles() { return indices.length / 3; },
  };
}

/* ------------------------------------------------------------------- budget ---- */

/**
 * Detail counts per quality level. Numbers are deliberately modest: the whole
 * point is that the road keeps its existing draw-call budget while gaining a
 * lot of close-up texture.
 */
const PLAN = {
  low: { patches: 10, snakes: 5, joints: 12, manholes: 3, drains: 6, marbles: 70, fringe: false, segs: 110 },
  medium: { patches: 22, snakes: 11, joints: 22, manholes: 7, drains: 13, marbles: 170, fringe: true, segs: 200 },
  high: { patches: 38, snakes: 18, joints: 34, manholes: 11, drains: 22, marbles: 270, fringe: true, segs: 300 },
  ultra: { patches: 54, snakes: 26, joints: 46, manholes: 16, drains: 32, marbles: 400, fringe: true, segs: 420 },
};

/* -------------------------------------------------------------------- main ---- */

/**
 * Build the road-surface detail layer for one circuit.
 *
 * @param {object} opts
 * @param {string} [opts.theme='alpine']  selects the asphalt texture set
 * @param {number} [opts.seed=42]         deterministic placement seed
 * @param {THREE.Curve} opts.curve        centreline
 * @param {number} [opts.width=12]        track width in metres
 * @param {string} [opts.quality='high']  low | medium | high | ultra
 * @param {number} [opts.density=1]       global multiplier
 * @returns {{ group: THREE.Group, stats: object, update: Function, dispose: Function }}
 */
export function createRoadDetail(opts = {}) {
  const quality = opts.quality || 'high';
  const theme = opts.theme || 'alpine';
  const curve = opts.curve;
  const width = opts.width || 12;
  const halfW = width * 0.5;
  const density = clamp(opts.density != null ? opts.density : 1, 0.2, 2.5);
  const seed = (opts.seed != null ? opts.seed : 42) | 0;
  const random = mulberry32(seed ^ 0x5bd1e995);

  const group = new THREE.Group();
  group.name = 'RoadDetail';

  const stats = {
    patches: 0, snakes: 0, joints: 0, manholes: 0, drains: 0,
    marbles: 0, fringe: false, meshes: 0, tris: 0,
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

  if (!curve || typeof curve.getPointAt !== 'function') return empty;

  let length = 1000;
  try { length = curve.getLength() || 1000; } catch (e) { length = 1000; }
  if (!isFinite(length) || length < 10) length = 1000;

  const plan = PLAN[quality] || PLAN.high;
  const count = (base) => Math.max(1, Math.round(base * density));

  /* ------------------------------------------------------------ materials -- */

  const road = getRoadMaterial(theme);

  function asphalt(color, roughness, metalness) {
    const m = new THREE.MeshStandardMaterial({
      color,
      map: road.map || null,
      normalMap: road.normalMap || null,
      roughnessMap: road.roughnessMap || null,
      normalScale: road.normalScale ? road.normalScale.clone() : new THREE.Vector2(1, 1),
      roughness,
      metalness,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    applyWetness(m, 0.85);
    disposables.push(m);
    return m;
  }

  const darkPatchMat = asphalt(0x5a5b60, 0.76, 0.10);
  const lightPatchMat = asphalt(0xa8a49b, 0.68, 0.08);
  const tarMat = asphalt(0x1d1d20, 0.34, 0.22);
  const jointMat = asphalt(0x26272a, 0.88, 0.06);

  /* -------------------------------------------------------------- patches -- */

  const darkPatches = createBuilder(curve, width);
  const lightPatches = createBuilder(curve, width);

  const patchCount = count(plan.patches);
  for (let i = 0; i < patchCount; i++) {
    // Keep the start/finish grid and the first metres of the lap clean.
    let u = 0.02 + random() * 0.96;
    if (u < 0.035) u += 0.04;

    const lateral = (random() * 2 - 1) * (halfW - 1.35);
    const halfLength = 0.35 + random() * 1.05;   // metres along the road
    const halfAcross = 0.22 + random() * 0.55;   // metres across

    const corners = 6 + Math.floor(random() * 5);
    const ring = [];
    for (let k = 0; k < corners; k++) {
      const a = (k / corners) * Math.PI * 2;
      const wobble = 0.68 + random() * 0.48;
      const du = Math.cos(a) * halfLength * wobble / length;
      const dl = Math.sin(a) * halfAcross * wobble;
      ring.push([u + du, clamp(lateral + dl, -halfW + 0.25, halfW - 0.25)]);
    }

    // A few patches are split by a dark seam of older tarmac underneath.
    if (random() < 0.35) {
      const under = ring.map(([pu, pl]) => [
        u + (pu - u) * 1.10,
        clamp(lateral + (pl - lateral) * 1.10, -halfW + 0.2, halfW - 0.2),
      ]);
      darkPatches.poly(under, 0.0074);
    }

    (random() < 0.5 ? darkPatches : lightPatches).poly(ring, 0.0082);
    stats.patches++;
  }

  /* ---------------------------------------------------------- tar snakes -- */

  const snakes = createBuilder(curve, width);
  const snakeCount = count(plan.snakes);

  for (let i = 0; i < snakeCount; i++) {
    let u = 0.04 + random() * 0.72;
    let lateral = (random() * 2 - 1) * (halfW - 1.2);
    const forward = random() < 0.5 ? 1 : -1;
    const steps = 7 + Math.floor(random() * 8);

    const points = [];
    const widths = [];
    for (let k = 0; k < steps; k++) {
      points.push([u, lateral]);
      widths.push(0.035 + random() * 0.045);

      const step = (0.35 + random() * 0.65) / length;
      u += forward * step;
      lateral = clamp(lateral + (random() * 2 - 1) * 0.24, -halfW + 0.4, halfW - 0.4);
      if (u > 0.94 || u < 0.02) break;
    }

    if (points.length > 2) {
      snakes.ribbon(points, widths, 0.0085);
      stats.snakes++;
    }
  }

  /* ----------------------------------------------------- expansion joints -- */

  const joints = createBuilder(curve, width);
  const jointCount = count(plan.joints);
  const jointWidth = 0.018 + random() * 0.014; // half-thickness in metres

  for (let i = 0; i < jointCount; i++) {
    const u = (i + 0.5) / jointCount + (random() * 2 - 1) * 0.004;
    const du = jointWidth / length;
    const inset = 0.5 + random() * 0.7;

    joints.poly([
      [u - du, -halfW + inset],
      [u + du, -halfW + inset],
      [u + du, halfW - inset],
      [u - du, halfW - inset],
    ], 0.0081);
    stats.joints++;
  }

  /* ------------------------------------------------------------ assemble -- */

  function attach(builder, material, name) {
    const mesh = builder.build(material);
    if (!mesh) return null;
    mesh.name = name;
    group.add(mesh);
    stats.meshes++;
    stats.tris += builder.triangles;
    disposables.push(mesh.geometry);
    return mesh;
  }

  attach(darkPatches, darkPatchMat, 'RoadPatchesDark');
  attach(lightPatches, lightPatchMat, 'RoadPatchesLight');
  attach(snakes, tarMat, 'TarSnakes');
  attach(joints, jointMat, 'ExpansionJoints');

  /* -------------------------------------------------------------- fringe -- */

  if (plan.fringe) {
    const fringeTex = fringeTexture(random);
    if (fringeTex) {
      const positions = [];
      const normals = [];
      const uv = [];
      const indices = [];
      const segs = Math.round(plan.segs);

      const _p = new THREE.Vector3();
      const _t = new THREE.Vector3();
      const _n = new THREE.Vector3();
      const _up = new THREE.Vector3();

      function pushFringe(u, lateral, v) {
        curve.getPointAt(clamp(u, 0, 1), _p);
        curve.getTangentAt(clamp(u, 0, 1), _t);
        _n.set(-_t.z, 0, _t.x);
        if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0); else _n.normalize();
        _up.crossVectors(_n, _t).normalize();
        if (_up.y < 0) _up.negate();
        positions.push(_p.x + _n.x * lateral, _p.y + 0.004, _p.z + _n.z * lateral);
        normals.push(_up.x, _up.y, _up.z);
        uv.push(u * 44, v);
      }

      for (let side = -1; side <= 1; side += 2) {
        const base = positions.length / 3;
        for (let i = 0; i <= segs; i++) {
          const u = i / segs;
          const wobble = Math.sin(u * 211 + side * 1.7) * 0.10
            + Math.sin(u * 47 + side) * 0.16;
          const inner = side * (halfW - 1.05 + wobble);
          const outer = side * (halfW + 0.10 + wobble * 0.5);
          pushFringe(u, inner, 0);
          pushFringe(u, outer, 1);
        }
        for (let i = 0; i < segs; i++) {
          const a = base + i * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(indices);
      geo.computeBoundingSphere();

      const mat = new THREE.MeshStandardMaterial({
        map: fringeTex,
        color: 0x8c7c63,
        roughness: 0.98,
        metalness: 0.0,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      applyWetness(mat, 0.6);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'VergeDust';
      mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      disposables.push(geo);
      disposables.push(mat, fringeTex);
      stats.fringe = true;
      stats.meshes++;
      stats.tris += indices.length / 3;
    }
  }

  /* ------------------------------------------------------- flat instances -- */

  const _instP = new THREE.Vector3();
  const _instT = new THREE.Vector3();
  const _instN = new THREE.Vector3();
  const _instUp = new THREE.Vector3();
  const _instX = new THREE.Vector3();
  const _basis = new THREE.Matrix4();
  const _dummy = new THREE.Object3D();
  const _yawQuat = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);

  /**
   * Seat a flat instance on the road: local +Y runs with the track, local +Z
   * is the road normal, so planes and discs lie dead flat.
   */
  function placeFlat(mesh, index, u, lateral, lift, sx, sy, sz, yaw) {
    curve.getPointAt(clamp(u, 0, 1), _instP);
    curve.getTangentAt(clamp(u, 0, 1), _instT);
    _instN.set(-_instT.z, 0, _instT.x);
    if (_instN.lengthSq() < 1e-8) _instN.set(1, 0, 0); else _instN.normalize();
    _instUp.crossVectors(_instN, _instT).normalize();
    if (_instUp.y < 0) _instUp.negate();
    _instX.crossVectors(_instT, _instUp);

    _basis.makeBasis(_instX, _instT, _instUp);
    _dummy.quaternion.setFromRotationMatrix(_basis);
    _yawQuat.setFromAxisAngle(_zAxis, yaw || 0);
    _dummy.quaternion.multiply(_yawQuat);

    _dummy.position.set(
      _instP.x + _instN.x * lateral,
      _instP.y + lift,
      _instP.z + _instN.z * lateral,
    );
    _dummy.scale.set(sx, sy, sz);
    _dummy.updateMatrix();
    mesh.setMatrixAt(index, _dummy.matrix);
  }

  /* ------------------------------------------------------------ manholes -- */

  const manholeCount = count(plan.manholes);
  if (manholeCount > 0) {
    const tex = manholeTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x8e949c,
      roughness: 0.46,
      metalness: 0.72,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    applyWetness(mat, 0.7);

    const geo = new THREE.CircleGeometry(0.42, 20);
    const mesh = new THREE.InstancedMesh(geo, mat, manholeCount);
    mesh.name = 'ManholeCovers';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    for (let i = 0; i < manholeCount; i++) {
      const u = (i + 0.2 + random() * 0.6) / manholeCount;
      // Covers live in the gutter or over the crown, not scattered across the
      // lane: a manhole in the middle of the racing line reads as a mistake,
      // and the tarmac pattern makes it obvious.
      const side = random() < 0.5 ? -1 : 1;
      const lateral = random() < 0.78
        ? side * halfW * (0.66 + random() * 0.26)
        : side * halfW * (0.04 + random() * 0.14);
      const s = 0.92 + random() * 0.14;
      placeFlat(mesh, i, u, lateral, 0.009, s, s, 1, random() * Math.PI * 2);
      mesh.setColorAt(i, new THREE.Color().setHSL(0.09, 0.05 + random() * 0.06, 0.52 + random() * 0.1));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    group.add(mesh);
    if (tex) disposables.push(tex);
    disposables.push(geo, mat);
    stats.manholes = manholeCount;
    stats.meshes++;
    stats.tris += 20 * manholeCount;
  }

  /* -------------------------------------------------------------- drains -- */

  const drainCount = count(plan.drains);
  if (drainCount > 0) {
    const tex = grateTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0x9aa0a6,
      roughness: 0.38,
      metalness: 0.8,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    applyWetness(mat, 0.75);

    const geo = new THREE.PlaneGeometry(0.42, 0.78);
    const mesh = new THREE.InstancedMesh(geo, mat, drainCount);
    mesh.name = 'DrainGrates';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    for (let i = 0; i < drainCount; i++) {
      const u = (i + 0.35 + random() * 0.3) / drainCount;
      const side = i % 2 === 0 ? 1 : -1;
      const lateral = side * (halfW - 0.42 - random() * 0.22);
      placeFlat(mesh, i, u, lateral, 0.010, 1, 1, 1, (random() * 2 - 1) * 0.03);
    }
    mesh.instanceMatrix.needsUpdate = true;

    group.add(mesh);
    if (tex) disposables.push(tex);
    disposables.push(geo, mat);
    stats.drains = drainCount;
    stats.meshes++;
    stats.tris += 2 * drainCount;
  }

  /* -------------------------------------------------------------- marbles -- */

  const marbleCount = Math.round(plan.marbles * density);
  if (marbleCount > 0) {
    // Weight placement toward corners, where rubber actually collects.
    const samples = 180;
    const weight = new Float32Array(samples);
    const tanA = new THREE.Vector3();
    const tanB = new THREE.Vector3();
    let total = 0;
    for (let i = 0; i < samples; i++) {
      const u = i / samples;
      curve.getTangentAt(u, tanA);
      curve.getTangentAt(Math.min(1, u + 1 / samples), tanB);
      const bend = Math.acos(clamp(tanA.dot(tanB), -1, 1));
      weight[i] = bend + 0.012;
      total += weight[i];
    }

    function pickCornerU() {
      let r = random() * total;
      for (let i = 0; i < samples; i++) {
        r -= weight[i];
        if (r <= 0) return (i + random()) / samples;
      }
      return random();
    }

    const geo = new THREE.IcosahedronGeometry(0.045, 0);
    const mat = getRubberMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, marbleCount);
    mesh.name = 'TyreMarbles';
    mesh.frustumCulled = false;

    const marbleColor = new THREE.Color();
    for (let i = 0; i < marbleCount; i++) {
      const u = pickCornerU();
      const side = random() < 0.5 ? -1 : 1;
      // Off the racing line, but still on the asphalt.
      const lateral = side * (halfW * (0.42 + random() * 0.5));

      curve.getPointAt(u, _instP);
      curve.getTangentAt(u, _instT);
      _instN.set(-_instT.z, 0, _instT.x);
      if (_instN.lengthSq() < 1e-8) _instN.set(1, 0, 0); else _instN.normalize();

      const scale = 0.45 + random() * 1.05;
      _dummy.position.set(
        _instP.x + _instN.x * lateral,
        _instP.y + 0.045 * scale * 0.5,
        _instP.z + _instN.z * lateral,
      );
      _dummy.rotation.set(random() * 3.14, random() * 6.28, random() * 3.14);
      _dummy.scale.set(scale, scale * (0.45 + random() * 0.3), scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      const shade = 0.10 + random() * 0.09;
      marbleColor.setRGB(shade, shade, shade * 1.02);
      mesh.setColorAt(i, marbleColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    group.add(mesh);
    disposables.push(geo);
    stats.marbles = marbleCount;
    stats.meshes++;
    stats.tris += 20 * marbleCount;
  }

  return {
    group,
    stats,

    /**
     * Road wear is static; the per-frame hook exists so the module satisfies
     * the graphics contract and can be extended without rewiring the engine.
     */
    update() {},

    dispose() {
      while (group.children.length) group.remove(group.children[0]);
      for (const d of disposables) {
        try { d.dispose(); } catch (e) { /* ignore */ }
      }
      disposables.length = 0;
      stats.meshes = 0;
      stats.tris = 0;
    },
  };
}

export default { createRoadDetail };
