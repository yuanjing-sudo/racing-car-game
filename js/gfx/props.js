import * as THREE from 'three';

import {
  seededRandom, range, pick, trackFrame, mergeAll,
  createGantryGeometry, createGrandstandGeometry, createCrowdBackingGeometry,
  createCatchFenceGeometry, createBuildingShellGeometry, createTentGeometry,
  createBillboardGeometry, createTyreWallGeometry, createBrakingBoardGeometry,
  createFlagPoleGeometry, createLightMastGeometry, createRockGeometry,
  createTreeGeometry, box, cylinder,
} from './geometry.js';
import {
  getMaterial, getNeonMaterial, getBannerMaterial, getCrowdMaterial,
  getFenceMaterial, getConcreteMaterial, getPaintedMetalMaterial,
  getDarkMetalMaterial, getMetalMaterial, getPlasticMaterial,
} from './materials.js';

/**
 * props.js — trackside race infrastructure.
 *
 * `createTrack()` already builds the road, kerbs and the primary barriers, and
 * `scenery.js` owns the terrain and the theme's nature. This module adds the
 * *motorsport* furniture those two deliberately leave out: the start-light
 * gantry, sponsor gantries, grandstands with a real crowd, the pit building,
 * catch fencing, tyre walls, marshal posts, braking boards, hospitality tents,
 * billboards and floodlight masts.
 *
 * Everything is placed in a track-local frame (see `geometry.trackFrame`), so
 * props sit correctly however the spline is shaped, and every repeated object is
 * either merged into one mesh or instanced, keeping the draw-call count sane.
 *
 * At night the module also feeds the lighting rig: floodlight masts register
 * street lights and signs register neon glows, so the infrastructure actually
 * lights the track instead of just being visible.
 */

const THEMES_WITH_GRANDSTANDS = ['alpine', 'coastal', 'desert', 'forest', 'city', 'tokyo', 'countryside'];

/** Rough curvature of the spline at t (0 = dead straight, 1 = hairpin). */
function curvatureAt(curve, t, span = 0.02) {
  const a = curve.getTangentAt(((t - span) % 1 + 1) % 1);
  const b = curve.getTangentAt((t + span) % 1);
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  return Math.acos(dot);
}

export function createProps(opts = {}) {
  const theme = opts.theme || 'countryside';
  const seed = opts.seed != null ? opts.seed : 42;
  const curve = opts.curve || null;
  const width = opts.width || 12;
  const gapZones = opts.gapZones || [];
  const quality = opts.quality || 'high';
  const lighting = opts.lighting || null;
  const density = opts.density != null ? opts.density : 1;
  const random = seededRandom(seed ^ 0x9e3779b9);

  const group = new THREE.Group();
  group.name = `Props:${theme}`;

  const disposables = [];
  const stats = { meshes: 0, instances: 0, lights: 0, glows: 0 };
  const animated = { flags: [], neons: [], startLights: [], crowd: null };

  /* --------------------------------------------------------------- helpers ---- */

  const inGap = (t) => gapZones.some((g) => t >= g.tStart && t <= g.tEnd);

  function addMesh(geometry, material, matrix = null, name = 'prop') {
    if (!geometry) return null;
    const mesh = new THREE.Mesh(geometry, material);
    if (matrix) mesh.applyMatrix4(matrix);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    if (mesh.matrix.equals) mesh.updateMatrixWorld(true);
    group.add(mesh);
    stats.meshes++;
    return mesh;
  }

  function addInstanced(geometry, material, matrices, name = 'prop') {
    if (!geometry || !matrices || matrices.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    mesh.name = name;
    mesh.frustumCulled = true;
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    stats.instances += matrices.length;
    return mesh;
  }

  /** Compose a placement matrix from a track frame. */
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3(1, 1, 1);
  function placeAt(frame, dx = 0, dy = 0, dz = 0, yawOffset = 0, scale = 1) {
    _e.set(0, frame.angle + yawOffset, 0);
    _q.setFromEuler(_e);
    _s.setScalar(scale);
    _m4.compose(
      new THREE.Vector3(frame.position.x + dx, frame.position.y + dy, frame.position.z + dz),
      _q,
      _s
    );
    return _m4.clone();
  }

  function trackGeometry(geometry, frame) {
    const m = placeAt(frame);
    const g = geometry.clone();
    g.applyMatrix4(m);
    return g;
  }

  if (!curve) {
    // Without a spline there is nothing to place against — return an empty rig
    // so the caller can keep going (configurator / menu scenes, tests).
    return { group, update() {}, dispose() {}, stats, setQuality() {}, setNight() {} };
  }

  /* --------------------------------------------------- start / sponsor gantries */

  const metals = getDarkMetalMaterial();
  const steel = getMetalMaterial(0xa8adb6, 0.4);
  const concrete = getConcreteMaterial(148, 11);
  const plasticRed = getPaintedMetalMaterial(0xc0392b, 0.45, 0.1);
  const plasticWhite = getPaintedMetalMaterial(0xe8e8ea, 0.5, 0.08);
  const rubber = getMaterial('rubber');

  function buildStartGantry() {
    const t = 0.995;
    const frame = trackFrame(curve, t, width, 0);
    const { geometry, banner } = createGantryGeometry({ span: width + 8, height: 8.4, bannerHeight: 2.4 });
    addMesh(trackGeometry(geometry, frame), metals, null, 'start-gantry');

    // banner with a sponsor
    const bannerGeo = new THREE.PlaneGeometry(banner.width, banner.height);
    bannerGeo.translate(0, banner.center.y, -0.26);
    addMesh(trackGeometry(bannerGeo, frame), getBannerMaterial(0xd21f3c, 'GRAND PRIX'), null, 'start-banner');

    // five start lights across the beam: four red, one green (centre)
    const lampGeo = new THREE.SphereGeometry(0.26, 10, 8);
    const housingGeo = new THREE.BoxGeometry(0.8, 0.55, 0.5);
    const redMat = new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: 0xff1010, emissiveIntensity: 0.0, roughness: 0.4 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x051a08, emissive: 0x22ff55, emissiveIntensity: 0.0, roughness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 1.4;
      const isGreen = i === 2;
      const h = housingGeo.clone();
      h.translate(x, 7.1, 0);
      addMesh(trackGeometry(h, frame), metals, null, 'start-light-housing');
      const lamp = lampGeo.clone();
      lamp.translate(x, 7.1, 0);
      const mesh = new THREE.Mesh(lamp, isGreen ? greenMat : redMat);
      mesh.applyMatrix4(placeAt(frame));
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      animated.startLights.push({ mesh, color: isGreen ? 'green' : 'red' });
    }

    // neon number boards either side of the gantry
    for (const side of [-1, 1]) {
      const f2 = trackFrame(curve, t, width, side * (width * 0.5 + 3.4));
      const sign = new THREE.BoxGeometry(3.2, 1.0, 0.2);
      sign.translate(0, 5.4, 0);
      const mesh = addMesh(trackGeometry(sign, f2), getNeonMaterial(0xff2e88, 2.6), null, 'start-neon');
      if (mesh) animated.neons.push({ material: mesh.material, phase: random() * 6.28 });
    }
  }

  function buildSponsorGantries(count) {
    const ts = [0.18, 0.44, 0.7];
    for (let i = 0; i < Math.min(count, ts.length); i++) {
      const t = ts[i];
      if (inGap(t)) continue;
      const f = trackFrame(curve, t, width, 0);
      const { geometry, banner } = createGantryGeometry({ span: width + 7, height: 7.6, bannerHeight: 2.0 });
      addMesh(trackGeometry(geometry, f), steel, null, 'sponsor-gantry');
      const bannerGeo = new THREE.PlaneGeometry(banner.width, banner.height);
      bannerGeo.translate(0, banner.center.y, -0.26);
      const color = pick(random, [0x0b6efd, 0xff8a00, 0x00b894, 0xd21f3c]);
      addMesh(trackGeometry(bannerGeo, f), getBannerMaterial(color), null, 'sponsor-banner');
    }
  }

  /* -------------------------------------------------------------- grandstands */

  function buildGrandstands(count) {
    const T = [0.06, 0.27, 0.52, 0.78];
    for (let i = 0; i < Math.min(count, T.length); i++) {
      const t = T[i];
      if (inGap(t)) continue;
      // usually the outside of the corner
      const side = random() > 0.3 ? 1 : -1;
      const lateral = side * (width * 0.5 + 11 + random() * 6);
      const f = trackFrame(curve, t, width, lateral);
      const gs = createGrandstandGeometry({
        width: 30 + random() * 18,
        rows: quality === 'low' ? 8 : 12,
        withBox: quality !== 'low',
      });
      // face the track: the model faces +Z, and the frame's -normal points back
      addMesh(trackGeometry(gs.geometry, f), concrete, null, 'grandstand');

      // crowd: instanced planes on the seating slab
      const crowdMat = getCrowdMaterial();
      const crowdGeo = new THREE.PlaneGeometry(1.0, 1.5);
      const mats = [];
      const cols = Math.floor(gs.width / 1.15);
      const rows = gs.rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (random() > 0.82) continue; // empty seats
          const x = -gs.width * 0.5 + 0.6 + c * 1.15;
          const y = (r + 1) * gs.rowHeight + 0.75;
          const z = -(r * gs.rowDepth) + 0.1;
          const local = new THREE.Matrix4().compose(
            new THREE.Vector3(x, y, z),
            new THREE.Quaternion(),
            new THREE.Vector3(0.9, 0.9, 1)
          );
          const world = placeAt(f).multiply(local);
          mats.push(world);
        }
      }
      addInstanced(crowdGeo, crowdMat, mats, 'crowd');

      // a few light masts at the corners of the stand
      if (quality !== 'low') {
        for (const sx of [-1, 1]) {
          const lm = createLightMastGeometry({ height: 10 });
          const ff = trackFrame(curve, t, width, lateral + sx * (gs.width * 0.5 + 3));
          addMesh(trackGeometry(lm.geometry, ff), steel, null, 'light-mast');
          registerLight(ff, 0xbfd4ff, 46, 3.2);
        }
      }
    }
  }

  /* ------------------------------------------------------------- pit building */

  function buildPitBuilding() {
    const t = 0.965;
    const lateral = -(width * 0.5 + 9);
    const f = trackFrame(curve, t, width, lateral);
    const shell = createBuildingShellGeometry({ width: 30, height: 9, depth: 11, floors: 3, setbacks: 0, random });
    addMesh(trackGeometry(shell.geometry, f), concrete, null, 'pit-building');

    // glass strip along the pit lane
    const glass = new THREE.BoxGeometry(28, 2.2, 0.3);
    glass.translate(0, 6.4, 5.7);
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x101a22, roughness: 0.08, metalness: 0.1, transmission: 0.5, transparent: true, opacity: 0.75 });
    addMesh(trackGeometry(glass, f), glassMat, null, 'pit-glass');

    // neon sign on the roof
    const board = new THREE.BoxGeometry(12, 1.6, 0.25);
    board.translate(0, 10.4, 5.9);
    const signMesh = addMesh(trackGeometry(board, f), getNeonMaterial(0x35d0ff, 2.2), null, 'pit-sign');
    if (signMesh) animated.neons.push({ material: signMesh.material, phase: 1.4 });
    registerGlow(trackFrame(curve, t, width, lateral), 0x35d0ff, 6, 10.6);
  }

  /* -------------------------------------------------------------- catch fence */

  function buildCatchFences(panelCount) {
    const fenceMat = getFenceMaterial();
    const panelLen = 8;
    const geo = createCatchFenceGeometry({ length: panelLen, height: 3.0, lean: 0.7 });
    const matrices = [];
    const step = 1 / panelCount;
    for (let i = 0; i < panelCount; i++) {
      const t = i * step;
      if (inGap(t)) continue;
      const straight = curvatureAt(curve, t) < 0.09;
      for (const side of [-1, 1]) {
        // only fence the straights and the outside of gentle corners
        if (!straight && side === -1) continue;
        const f = trackFrame(curve, t, width, side * (width * 0.5 + 2.4));
        matrices.push(placeAt(f, 0, 0, 0, Math.PI * 0.5));
      }
    }
    const inst = addInstanced(geo, fenceMat, matrices, 'catch-fence');
    if (inst) inst.castShadow = false;
  }

  /* ---------------------------------------------------------------- tyre walls */

  function buildTyreWalls() {
    const geo = createTyreWallGeometry({ length: 10, rows: 2, random });
    const matrices = [];
    const samples = 220;
    for (let i = 0; i < samples; i++) {
      const t = i / samples;
      if (inGap(t)) continue;
      const c = curvatureAt(curve, t, 0.012);
      if (c < 0.16) continue;
      if (random() > 0.35) continue;
      // outside of the corner
      const f = trackFrame(curve, t, width, width * 0.5 + 2.9);
      matrices.push(placeAt(f, 0, 0, 0, Math.PI * 0.5));
    }
    addInstanced(geo, rubber, matrices, 'tyre-wall');
  }

  /* -------------------------------------------------------------- marshal posts */

  function buildMarshalPosts(count) {
    const poleGeo = createFlagPoleGeometry({ height: 5 });
    const hutGeo = mergeAll([
      box(1.6, 1.1, 1.4, 0, 0.55, 0),
      box(1.9, 0.14, 1.7, 0, 1.34, 0),
    ]);
    const flagGeo = new THREE.PlaneGeometry(1.2, 0.8);
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, side: THREE.DoubleSide, roughness: 0.9 });
    const flagMat2 = new THREE.MeshStandardMaterial({ color: 0x2ecc71, side: THREE.DoubleSide, roughness: 0.9 });
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      if (inGap(t)) continue;
      const side = random() > 0.5 ? 1 : -1;
      const f = trackFrame(curve, t, width, side * (width * 0.5 + 5.5));
      addMesh(trackGeometry(hutGeo, f), concrete, null, 'marshal-hut');
      addMesh(trackGeometry(poleGeo, f), steel, null, 'marshal-pole');
      const flag = new THREE.Mesh(flagGeo, i % 2 === 0 ? flagMat : flagMat2);
      const m = placeAt(f, 1.0, 4.4, 0);
      flag.applyMatrix4(m);
      flag.matrixAutoUpdate = false;
      group.add(flag);
      animated.flags.push({ mesh: flag, phase: random() * 6.28 });
    }
  }

  /* ------------------------------------------------------- braking / billboards */

  function buildBrakingBoards(count) {
    const geo = createBrakingBoardGeometry();
    for (let i = 0; i < count; i++) {
      const t = i / count + 0.03;
      if (inGap(t)) continue;
      // place just before a corner entry
      if (curvatureAt(curve, t + 0.05) < 0.09) continue;
      const side = random() > 0.5 ? 1 : -1;
      const f = trackFrame(curve, t, width, side * (width * 0.5 + 4.2));
      addMesh(trackGeometry(geo, f), plasticWhite, null, 'braking-board');
    }
  }

  function buildBillboards(count) {
    const geo = createBillboardGeometry({ width: 7, height: 3.2 });
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      if (inGap(t)) continue;
      const side = random() > 0.5 ? 1 : -1;
      const f = trackFrame(curve, t, width, side * (width * 0.5 + 8 + random() * 4));
      addMesh(trackGeometry(geo, f), metals, null, 'billboard-frame');
      const panel = new THREE.PlaneGeometry(6.6, 2.9);
      panel.translate(0, 4.0, -0.18);
      const color = pick(random, [0xff2e2e, 0x1f8fff, 0x00c48c, 0xffb400, 0xff2e88]);
      addMesh(trackGeometry(panel, f), getBannerMaterial(color), null, 'billboard-panel');
    }
  }

  /* ------------------------------------------------------------------- tents */

  function buildTents(count) {
    const geo = createTentGeometry({ width: 8, height: 3.2, depth: 6 });
    const canvasMat = getPlasticMaterial(0xf3f4f6, 0.85);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      if (inGap(t)) continue;
      const side = random() > 0.5 ? 1 : -1;
      const f = trackFrame(curve, t, width, side * (width * 0.5 + 16 + random() * 8));
      addMesh(trackGeometry(geo, f), canvasMat, null, 'tent');
    }
  }

  /* ----------------------------------------------------------- nature accents */

  function buildAccents(count) {
    const style = { forest: 'conifer', alpine: 'conifer', coastal: 'palm', countryside: 'broadleaf', desert: 'broadleaf', city: 'broadleaf', tokyo: 'broadleaf' }[theme] || 'broadleaf';
    const treeGeo = createTreeGeometry({ height: 7.5, style, layers: 3, random });
    const treeMat = new THREE.MeshStandardMaterial({
      color: style === 'palm' ? 0x4d7a3a : 0x3f6b35, roughness: 0.9, metalness: 0.0, flatShading: true,
    });
    const rockGeo = createRockGeometry({ radius: 1.4, detail: 1, random });
    const matrices = [];
    const rocks = [];
    for (let i = 0; i < count; i++) {
      const t = random();
      if (inGap(t)) continue;
      const side = random() > 0.5 ? 1 : -1;
      const f = trackFrame(curve, t, width, side * (width * 0.5 + 20 + random() * 30));
      f.position.y += range(random, -0.3, 0.3);
      if (random() > 0.6) rocks.push(placeAt(f, 0, 0.2, 0, random() * 6.28, range(random, 0.7, 1.6)));
      else matrices.push(placeAt(f, 0, 0, 0, random() * 6.28, range(random, 0.7, 1.4)));
    }
    addInstanced(treeGeo, treeMat, matrices, 'accent-tree');
    addInstanced(rockGeo, concrete, rocks, 'accent-rock');
  }

  /* ------------------------------------------------------- lighting integration */

  function registerLight(frame, color, rangeM, intensity) {
    if (!lighting || !lighting.addStreetlight) return;
    const pos = new THREE.Vector3(frame.position.x, frame.position.y + 9.6, frame.position.z);
    const aim = new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z);
    lighting.addStreetlight(pos, color, { range: rangeM, intensity, aim, angle: Math.PI * 0.3, penumbra: 0.5 });
    stats.lights++;
  }

  function registerGlow(frame, color, size, y) {
    if (!lighting || !lighting.addNeonGlow) return;
    const pos = new THREE.Vector3(frame.position.x, frame.position.y + y, frame.position.z);
    lighting.addNeonGlow(pos, color, size);
    stats.glows++;
  }

  /* -------------------------------------------------------------------- build */

  const big = quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
  buildStartGantry();
  buildSponsorGantries(density > 0.85 ? 3 : 2);
  if (THEMES_WITH_GRANDSTANDS.includes(theme)) {
    buildGrandstands(Math.max(2, Math.round(4 * big * density)));
  }
  buildPitBuilding();
  buildCatchFences(Math.max(24, Math.round(120 * big * density)));
  buildTyreWalls();
  buildMarshalPosts(Math.max(4, Math.round(10 * big)));
  buildBrakingBoards(Math.max(3, Math.round(8 * big)));
  buildBillboards(Math.max(4, Math.round(14 * big * density)));
  buildTents(Math.max(2, Math.round(6 * density)));
  buildAccents(Math.max(20, Math.round(90 * big * density)));

  // A few floodlight masts around the lap light the racing line at night.
  if (quality !== 'low') {
    const mastGeo = createLightMastGeometry({ height: 11 }).geometry;
    const mastCount = Math.max(3, Math.round(8 * big));
    for (let i = 0; i < mastCount; i++) {
      const t = (i + 0.5) / mastCount;
      if (inGap(t)) continue;
      const side = i % 2 === 0 ? 1 : -1;
      const f = trackFrame(curve, t, width, side * (width * 0.5 + 12));
      addMesh(trackGeometry(mastGeo, f), steel, null, 'floodlight-mast');
      registerLight(f, 0xd8e6ff, 55, 3.4);
    }
  }

  /* ------------------------------------------------------------------ runtime */

  let time = 0;
  let startPhase = 0; // 0 idle, 1 counting, 2 green
  let startTimer = 0;

  function setQuality(q) {
    void q;
  }

  /** Drive the start-light sequence from the race director. */
  function setStartLights(mode) {
    startPhase = mode === 'countdown' ? 1 : mode === 'go' ? 2 : 0;
    startTimer = 0;
  }

  function update(dt, ctx = {}) {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    time += step;

    // flags ripple
    for (const f of animated.flags) {
      f.mesh.rotation.z = Math.sin(time * 3 + f.phase) * 0.18;
    }

    // neon flicker: slow breathing with an occasional stutter
    for (const n of animated.neons) {
      if (!n.material) continue;
      const base = 2.2;
      const breathe = 0.86 + 0.14 * Math.sin(time * 1.7 + n.phase);
      const stutter = Math.sin(time * 21 + n.phase * 3) > 0.965 ? 0.4 : 1;
      const gain = ctx.isNight === false ? 0.35 : 1;
      n.material.emissiveIntensity = base * breathe * stutter * gain;
    }

    // start lights
    if (ctx.racePhase === 'countdown') setStartLights('countdown');
    else if (ctx.racePhase === 'go') setStartLights('go');
    startTimer += step;
    for (let i = 0; i < animated.startLights.length; i++) {
      const sl = animated.startLights[i];
      const mat = sl.mesh.material;
      if (startPhase === 2 && sl.color === 'green') {
        mat.emissiveIntensity = 4.2;
      } else if (startPhase === 1 && sl.color === 'red') {
        // fill one lamp per second, then all out
        mat.emissiveIntensity = startTimer > i * 0.9 ? 3.6 : 0.0;
      } else if (startPhase === 0) {
        mat.emissiveIntensity = sl.color === 'red' ? 0.7 + 0.3 * Math.sin(time * 2) : 0.0;
      } else {
        mat.emissiveIntensity = Math.max(0, mat.emissiveIntensity - step * 6);
      }
    }
  }

  function dispose() {
    for (const d of disposables) { if (d && d.dispose) d.dispose(); }
    disposables.length = 0;
    if (group.parent) group.parent.remove(group);
    group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        // Shared cached materials are owned by materials.js; only dispose
        // geometry that this module created per-instance.
        if (o.userData && o.userData.ownGeometry && o.geometry) o.geometry.dispose();
      }
    });
    group.clear();
  }

  return {
    group,
    stats,
    update,
    dispose,
    setQuality,
    setStartLights,
    get startLightCount() { return animated.startLights.length; },
  };
}

export default { createProps };
