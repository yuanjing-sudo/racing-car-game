import * as THREE from 'three';
import { createNoise2D, fbm, lerp, clamp, randomRange, createRadialTexture } from './utils.js';
import {
  getRoadMaterial,
  getRoadLineMaterial,
  getCurbMaterial,
  getBarrierMaterial,
} from './materials.js';

export const TRACK_THEMES = [
  { id: 'alpine', name: 'Alpine Pass', desc: 'Mountain hairpins with snow peaks' },
  { id: 'coastal', name: 'Coastal Highway', desc: 'Seaside cliffs and ocean views' },
  { id: 'desert', name: 'Desert Storm', desc: 'Sand dunes and canyon sweeps' },
  { id: 'forest', name: 'Forest Rally', desc: 'Dense woodland technical stage' },
  { id: 'city', name: 'City Circuit', desc: 'Night street racing through downtown' },
  { id: 'countryside', name: 'Countryside Sprint', desc: 'Rolling hills and farmland' },
];

export function createTrack(theme = 'alpine', seed = 42) {
  const noise = createNoise2D(seed);
  const trackGroup = new THREE.Group();
  const trackData = { checkpoints: [], sectors: [], length: 0, theme, noise, gapZones: [] };

  const numPoints = 140;
  const points = [];
  const trackWidth = 14 + randomRange(-2, 2);
  const elevation = getTrackElevationFactor(theme) * 1.6;

  // A high-speed circuit needs sweeping, low-curvature corners. The layout is
  // built from integer harmonics of the loop angle so it closes perfectly and
  // stays smooth; the old version stacked a fast radial sine (period ~12
  // points) on top of per-point FBM noise, which produced zero-radius cusps
  // and 47 m median corners that nothing could take above ~60 km/h.
  const baseRadius = 250;

  for (let i = 0; i < numPoints; i++) {
    const t = i / numPoints;
    const angle = t * Math.PI * 2;

    const radius =
      baseRadius +
      Math.sin(angle * 2) * 40 +
      Math.sin(angle * 3 + 0.7) * 22 +
      Math.sin(angle * 5 + 1.3) * 8 +
      Math.sin(angle * 7 + 2.1) * 3;

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = getTerrainHeight(x, z, theme, noise) * elevation;

    points.push(new THREE.Vector3(x, y, z));
  }

  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  trackData.curve = curve;
  trackData.length = curve.getLength();

  // More divisions than before so the tighter corner radii stay smooth.
  const divisions = 800;
  const trackPoints = curve.getSpacedPoints(divisions);
  trackData.trackPoints = trackPoints;

  const gapZones = [];
  const numGaps = theme === 'city' ? 0 : 3;
  for (let g = 0; g < numGaps; g++) {
    const tStart = 0.12 + g * 0.28 + randomRange(-0.02, 0.02);
    const tEnd = Math.min(tStart + 0.055, 0.95);
    gapZones.push({ tStart, tEnd });
  }
  trackData.gapZones = gapZones;

  const roadSegments = buildTrackSegments(curve, trackWidth, divisions, gapZones, theme);
  roadSegments.forEach(mesh => {
    mesh.receiveShadow = true;
    trackGroup.add(mesh);
  });

  const curbSegments = buildCurbSegments(curve, trackWidth, divisions, gapZones, theme);
  curbSegments.forEach(mesh => { mesh.position.y = 0.02; trackGroup.add(mesh); });

  const lineSegments = buildRoadLines(curve, trackWidth, divisions, gapZones);
  lineSegments.forEach(mesh => { mesh.receiveShadow = true; trackGroup.add(mesh); });
  trackGroup.add(buildCenterDashes(curve, divisions, gapZones));

  const edgeSegments = buildEdgeSegments(curve, trackWidth, divisions, gapZones, theme);
  edgeSegments.forEach(mesh => { mesh.position.y = -0.01; trackGroup.add(mesh); });

  createBarriers(trackGroup, curve, trackWidth, divisions, theme, gapZones);
  createStartFinish(trackGroup, curve, trackWidth, theme);
  createTrackDecorations(trackGroup, curve, trackWidth, theme, seed, gapZones);
  createCheckpoints(trackData, curve, theme);

  trackData.group = trackGroup;
  trackData.width = trackWidth;

  return trackData;
}

function segmentRanges(divisions, gapZones) {
  const ranges = [];
  let lastEnd = 0;
  const sorted = [...gapZones].sort((a, b) => a.tStart - b.tStart);
  for (const gz of sorted) {
    if (gz.tStart > lastEnd + 0.005) ranges.push([lastEnd, gz.tStart]);
    lastEnd = Math.max(lastEnd, gz.tEnd);
  }
  if (lastEnd < 0.995) ranges.push([lastEnd, 1]);
  return ranges;
}

function buildTrackSegments(curve, width, divisions, gapZones, theme) {
  const meshes = [];
  for (const [t0, t1] of segmentRanges(divisions, gapZones)) {
    meshes.push(createTrackMesh(curve, t0, t1, width, divisions, theme));
  }
  return meshes;
}

function createTrackMesh(curve, t0, t1, width, divisions, theme) {
  const segDivisions = Math.max(2, Math.floor(divisions * (t1 - t0)));
  const shape = new THREE.Shape();
  const halfW = width / 2;
  shape.moveTo(-halfW, 0);
  shape.lineTo(halfW, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { steps: segDivisions, bevelEnabled: false });
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    const idx = Math.floor(i / 2);
    const rawT = t0 + (t1 - t0) * (idx / Math.max(1, segDivisions - 1));
    const t = isFinite(rawT) ? clamp(rawT, 0, 1) : 0;
    const pt = curve.getPointAt(t) || new THREE.Vector3();
    const tangent = curve.getTangentAt(t) || new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const isLeft = i % 2 === 0;
    const offset = isLeft ? -halfW : halfW;
    pos.setXYZ(i, pt.x + normal.x * offset, pt.y, pt.z + normal.z * offset);

    // Deterministic UVs so the wet-asphalt maps tile correctly:
    // u across the width, v along the length of the lap.
    if (uv) {
      uv.setXY(i, isLeft ? 0 : width * 0.25, t * 260);
    }
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, getRoadMaterial(theme));
}

function buildCurbSegments(curve, width, divisions, gapZones, theme) {
  const meshes = [];
  const curbWidth = 1.0;
  for (const [t0, t1] of segmentRanges(divisions, gapZones)) {
    const segDivisions = Math.max(2, Math.floor(divisions * (t1 - t0)));
    const geo = new THREE.PlaneGeometry(curbWidth, 1, 1, segDivisions);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const idx = Math.floor(i / 2);
      const rawT = t0 + (t1 - t0) * (idx / Math.max(1, segDivisions - 1));
      const t = isFinite(rawT) ? clamp(rawT, 0, 1) : 0;
      const pt = curve.getPointAt(t) || new THREE.Vector3();
      const tangent = curve.getTangentAt(t) || new THREE.Vector3(0, 0, 1);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const isTop = i % 2 === 0;
      const offset = isTop ? -(width / 2 + curbWidth / 2) : -(width / 2 - curbWidth / 2);
      pos.setXYZ(i, pt.x + normal.x * offset, pt.y + 0.03, pt.z + normal.z * offset);
    }
    geo.computeVertexNormals();
    meshes.push(new THREE.Mesh(geo, getCurbMaterial(theme)));
  }
  return meshes;
}

/**
 * Build a flat strip that follows the curve at a fixed lateral offset.
 * The plane's local X carries the strip width, which we preserve so the
 * strip actually has area (the old implementation collapsed it to a line).
 */
function buildLineStrip(curve, t0, t1, divisions, offset, halfWidth, material, yLift) {
  const segDivisions = Math.max(2, Math.floor(divisions * (t1 - t0)));
  const geo = new THREE.PlaneGeometry(halfWidth * 2, 1, 1, segDivisions);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const idx = Math.floor(i / 2);
    const rawT = t0 + (t1 - t0) * (idx / Math.max(1, segDivisions - 1));
    const t = isFinite(rawT) ? clamp(rawT, 0, 1) : 0;
    const pt = curve.getPointAt(t) || new THREE.Vector3();
    const tangent = curve.getTangentAt(t) || new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const lateral = offset + pos.getX(i);
    pos.setXYZ(i, pt.x + normal.x * lateral, pt.y + yLift, pt.z + normal.z * lateral);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

function buildEdgeSegments(curve, width, divisions, gapZones, theme) {
  const meshes = [];
  const mat = getRoadMaterial(theme);
  for (const [t0, t1] of segmentRanges(divisions, gapZones)) {
    meshes.push(buildLineStrip(curve, t0, t1, divisions, width / 2 + 0.55, 0.3, mat, 0.01));
  }
  return meshes;
}

/** Solid painted lane edges running just inside the tarmac. */
function buildRoadLines(curve, width, divisions, gapZones) {
  const meshes = [];
  const mat = getRoadLineMaterial();
  for (const [t0, t1] of segmentRanges(divisions, gapZones)) {
    meshes.push(buildLineStrip(curve, t0, t1, divisions, width / 2 - 0.55, 0.09, mat, 0.02));
    meshes.push(buildLineStrip(curve, t0, t1, divisions, -(width / 2 - 0.55), 0.09, mat, 0.02));
  }
  return meshes;
}

/** Dashed centre line, instanced for a single draw call. */
function buildCenterDashes(curve, divisions, gapZones) {
  const step = 6;
  const mats = [];
  for (let i = 0; i < divisions; i += step) {
    const t = i / divisions;
    if (isInGapZone(t, gapZones)) continue;
    mats.push(t);
  }

  const geo = new THREE.PlaneGeometry(0.18, 2.4);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, getRoadLineMaterial(), Math.max(1, mats.length));
  const dummy = new THREE.Object3D();

  mats.forEach((t, i) => {
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    dummy.position.set(pt.x, pt.y + 0.022, pt.z);
    dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.count = mats.length;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function getTrackElevationFactor(theme) {
  switch (theme) {
    case 'alpine': return 0.8;
    case 'coastal': return 0.2;
    case 'desert': return 0.4;
    case 'forest': return 0.5;
    case 'city': return 0.05;
    case 'countryside': return 0.3;
    default: return 0.5;
  }
}

export function getTerrainHeight(x, z, theme, noise) {
  const base = fbm(noise || createNoise2D(42), x * 0.005, z * 0.005, 5, 2, 0.5);
  switch (theme) {
    case 'alpine': return base * 40 + 5;
    case 'coastal': return base * 8 - 2;
    case 'desert': return base * 15;
    case 'forest': return base * 20 + 2;
    case 'city': return 0;
    case 'countryside': return base * 12 + 1;
    default: return base * 15;
  }
}

function createBarriers(group, curve, width, divisions, theme, gapZones) {
  const barrierHeight = 0.8;
  const halfW = width / 2 + 1.5;
  const step = 4;

  const slots = [];
  for (let i = 0; i < divisions; i += step) {
    const t = i / divisions;
    if (isInGapZone(t, gapZones)) continue;
    slots.push(t);
  }

  const geo = new THREE.BoxGeometry(0.32, barrierHeight, 2);
  const mesh = new THREE.InstancedMesh(geo, getBarrierMaterial(theme), Math.max(1, slots.length * 2));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let n = 0;
  for (const t of slots) {
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const angle = Math.atan2(tangent.x, tangent.z);

    dummy.rotation.set(0, angle, 0);

    dummy.position.copy(pt).add(normal.clone().multiplyScalar(-halfW));
    dummy.position.y = pt.y + barrierHeight / 2;
    dummy.updateMatrix();
    mesh.setMatrixAt(n++, dummy.matrix);

    dummy.position.copy(pt).add(normal.clone().multiplyScalar(halfW));
    dummy.position.y = pt.y + barrierHeight / 2;
    dummy.updateMatrix();
    mesh.setMatrixAt(n++, dummy.matrix);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

function createStartFinish(group, curve, width, theme) {
  const startGeo = new THREE.BoxGeometry(width + 4, 0.1, 3);
  const startMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.3,
  });
  const startMesh = new THREE.Mesh(startGeo, startMat);

  const startPt = curve.getPointAt(0);
  const startTan = curve.getTangentAt(0);
  startMesh.position.copy(startPt);
  startMesh.position.y += 0.05;
  startMesh.rotation.y = Math.atan2(startTan.x, startTan.z);
  group.add(startMesh);

  const stripeGeo = new THREE.PlaneGeometry(width + 4, 1.5);
  const stripeCanvas = document.createElement('canvas');
  stripeCanvas.width = 256; stripeCanvas.height = 32;
  const sCtx = stripeCanvas.getContext('2d');
  for (let x = 0; x < 32; x++) {
    for (let y = 0; y < 4; y++) {
      sCtx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#000000';
      sCtx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const stripeTex = new THREE.CanvasTexture(stripeCanvas);
  stripeTex.wrapS = THREE.RepeatWrapping;
  const stripeMat = new THREE.MeshBasicMaterial({ map: stripeTex });
  const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
  stripeMesh.position.copy(startPt);
  stripeMesh.position.y += 0.06;
  stripeMesh.rotation.x = -Math.PI / 2;
  stripeMesh.rotation.z = Math.atan2(startTan.x, startTan.z);
  group.add(stripeMesh);

  const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 6, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 });
  const leftPole = new THREE.Mesh(poleGeo, poleMat);
  leftPole.position.set(startPt.x - width / 2 - 2, startPt.y + 3, startPt.z);
  const rightPole = new THREE.Mesh(poleGeo, poleMat);
  rightPole.position.set(startPt.x + width / 2 + 2, startPt.y + 3, startPt.z);
  group.add(leftPole, rightPole);

  const bannerGeo = new THREE.PlaneGeometry(width + 4, 1.5);
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 512; bannerCanvas.height = 64;
  const bCtx = bannerCanvas.getContext('2d');
  bCtx.fillStyle = '#111111';
  bCtx.fillRect(0, 0, 512, 64);
  bCtx.fillStyle = '#ff6600';
  bCtx.font = 'bold 36px sans-serif';
  bCtx.textAlign = 'center';
  bCtx.fillText('VELOCE GT-R', 256, 44);
  const bannerTex = new THREE.CanvasTexture(bannerCanvas);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide });
  const bannerMesh = new THREE.Mesh(bannerGeo, bannerMat);
  bannerMesh.position.copy(startPt);
  bannerMesh.position.y += 5;
  bannerMesh.rotation.y = Math.atan2(startTan.x, startTan.z) + Math.PI / 2;
  group.add(bannerMesh);
}

function createTrackDecorations(group, curve, width, theme, seed, gapZones) {
  const rng = mulberry32(seed);

  for (let i = 0; i < 80; i++) {
    const t = rng();
    if (isInGapZone(t, gapZones)) continue;

    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = rng() > 0.5 ? 1 : -1;
    const dist = width / 2 + 3 + rng() * 15;

    const decoPos = pt.clone().add(normal.clone().multiplyScalar(dist * side));
    decoPos.y = pt.y;

    const decoType = rng();
    if (decoType < 0.3) {
      addTireStack(group, decoPos, rng);
    } else if (decoType < 0.5) {
      addCone(group, decoPos);
    } else if (decoType < 0.7) {
      addLightPole(group, decoPos, normal.clone().multiplyScalar(-side));
    } else {
      addBanner(group, decoPos, tangent, rng);
    }
  }
}

/* Shared resources for track-side props (built once, reused). */
const DECO = {};

function deco() {
  if (DECO.ready) return DECO;
  DECO.tireGeo = new THREE.TorusGeometry(0.3, 0.12, 8, 16);
  DECO.tireMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.92 });
  DECO.coneGeo = new THREE.ConeGeometry(0.2, 0.5, 10);
  DECO.coneMat = new THREE.MeshStandardMaterial({ color: 0xff5f1f, roughness: 0.55, emissive: 0x180600 });
  DECO.poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 8);
  DECO.poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.85, roughness: 0.35 });
  DECO.lampGeo = new THREE.BoxGeometry(0.5, 0.16, 0.34);
  DECO.lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d0,
    emissive: 0xffe9b0,
    emissiveIntensity: 6.0,
    toneMapped: false,
  });
  DECO.poolGeo = new THREE.PlaneGeometry(11, 11);
  DECO.poolGeo.rotateX(-Math.PI / 2);
  DECO.poolMat = new THREE.MeshBasicMaterial({
    map: createRadialTexture(128, 'rgba(255,236,190,0.5)', 'rgba(255,236,190,0)'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  DECO.ready = true;
  return DECO;
}

function addTireStack(group, pos, rng) {
  const d = deco();
  const count = 3 + Math.floor(rng() * 5);

  for (let i = 0; i < count; i++) {
    const tire = new THREE.Mesh(d.tireGeo, d.tireMat);
    tire.position.set(pos.x, pos.y + 0.12 + i * 0.22, pos.z);
    tire.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.3;
    tire.castShadow = true;
    group.add(tire);
  }
}

function addCone(group, pos) {
  const d = deco();
  const cone = new THREE.Mesh(d.coneGeo, d.coneMat);
  cone.position.set(pos.x, pos.y + 0.25, pos.z);
  cone.castShadow = true;
  group.add(cone);
}

/**
 * Street lamp. The emissive head is picked up by the bloom pass so it
 * reads as a real light source, and an additive pool decal fakes the
 * glow spilling onto the wet tarmac (the classic Lumen look) without
 * paying for a real point light per pole.
 */
function addLightPole(group, pos, toTrack) {
  const d = deco();
  const dir = (toTrack || new THREE.Vector3(1, 0, 0)).clone().normalize();

  const pole = new THREE.Mesh(d.poleGeo, d.poleMat);
  pole.position.set(pos.x, pos.y + 2.5, pos.z);
  pole.castShadow = true;
  group.add(pole);

  const arm = new THREE.Mesh(d.poleGeo, d.poleMat);
  arm.scale.set(0.6, 0.6, 0.6);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(pos.x + dir.x * 0.75, pos.y + 4.9, pos.z + dir.z * 0.75);
  arm.rotation.y = Math.atan2(dir.x, dir.z);
  arm.scale.set(0.16, 1.4, 0.16);
  group.add(arm);

  const lamp = new THREE.Mesh(d.lampGeo, d.lampMat);
  lamp.position.set(pos.x + dir.x * 1.45, pos.y + 4.85, pos.z + dir.z * 1.45);
  lamp.rotation.y = Math.atan2(dir.x, dir.z);
  group.add(lamp);

  const pool = new THREE.Mesh(d.poolGeo, d.poolMat);
  pool.position.set(pos.x + dir.x * 1.45, pos.y + 0.05, pos.z + dir.z * 1.45);
  group.add(pool);
}

function addBanner(group, pos, tangent, rng) {
  const bannerGeo = new THREE.PlaneGeometry(3, 0.8);
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 256; bannerCanvas.height = 64;
  const ctx = bannerCanvas.getContext('2d');
  const colors = ['#ff6600', '#0066ff', '#ffcc00', '#00cc66', '#cc00ff'];
  ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  const texts = ['VELOCE', 'TURBO', 'RACING', 'GT-R', 'APEX'];
  ctx.fillText(texts[Math.floor(rng() * texts.length)], 128, 42);
  const tex = new THREE.CanvasTexture(bannerCanvas);
  const bannerMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(pos.x, pos.y + 1.2, pos.z);
  banner.rotation.y = Math.atan2(tangent.x, tangent.z) + (rng() - 0.5);
  group.add(banner);
}

function createCheckpoints(trackData, curve, theme) {
  const numCheckpoints = 20;
  for (let i = 0; i < numCheckpoints; i++) {
    const t = i / numCheckpoints;
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    trackData.checkpoints.push({
      index: i,
      position: pt.clone(),
      tangent: tangent.clone(),
      normal: normal.clone(),
      angle: Math.atan2(tangent.x, tangent.z),
      sector: Math.floor(i / 5),
    });
  }

  for (let s = 0; s < 4; s++) {
    trackData.sectors.push({
      index: s,
      startCheckpoint: s * 5,
      endCheckpoint: (s + 1) * 5 - 1,
      bestTime: null,
      targetTime: 15 + s * 3,
    });
  }
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isInGapZone(t, gapZones) {
  for (const gz of gapZones) {
    if (t >= gz.tStart && t <= gz.tEnd) return true;
  }
  return false;
}
