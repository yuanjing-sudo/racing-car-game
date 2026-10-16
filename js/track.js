import * as THREE from 'three';
import { createNoise2D, fbm, lerp, clamp, randomRange } from './utils.js';

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

  for (let i = 0; i < numPoints; i++) {
    const baseAngle = (i / numPoints) * Math.PI * 2;
    const wobble = Math.sin(i * 0.7) * 0.15 + Math.cos(i * 1.3) * 0.1;
    const angle = baseAngle + wobble;
    const baseRadius = 110 + fbm(noise, i * 0.025, 0) * 90 + Math.sin(i * 0.5) * 20;
    const r = baseRadius + Math.sin(angle * 3) * 25 + Math.cos(angle * 5) * 12;

    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = getTerrainHeight(x, z, theme, noise) * elevation;

    points.push(new THREE.Vector3(x, y, z));
  }

  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  trackData.curve = curve;
  trackData.length = curve.getLength();

  const divisions = 520;
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

  const edgeSegments = buildEdgeSegments(curve, trackWidth, divisions, gapZones);
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
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, getTrackMaterial(theme));
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

function buildEdgeSegments(curve, width, divisions, gapZones) {
  const meshes = [];
  const edgeWidth = 0.5;
  for (const [t0, t1] of segmentRanges(divisions, gapZones)) {
    const segDivisions = Math.max(2, Math.floor(divisions * (t1 - t0)));
    const geo = new THREE.PlaneGeometry(edgeWidth * 2, 1, 1, segDivisions);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const idx = Math.floor(i / 2);
      const rawT = t0 + (t1 - t0) * (idx / Math.max(1, segDivisions - 1));
      const t = isFinite(rawT) ? clamp(rawT, 0, 1) : 0;
      const pt = curve.getPointAt(t) || new THREE.Vector3();
      const tangent = curve.getTangentAt(t) || new THREE.Vector3(0, 0, 1);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const offset = width / 2 + edgeWidth / 2;
      pos.setXYZ(i, pt.x + normal.x * offset, pt.y + 0.01, pt.z + normal.z * offset);
    }
    geo.computeVertexNormals();
    meshes.push(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9 })));
  }
  return meshes;
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

function createTrackGeometry(curve, width, divisions) {
  const shape = new THREE.Shape();
  const halfW = width / 2;
  shape.moveTo(-halfW, 0);
  shape.lineTo(halfW, 0);

  const extrudeSettings = { steps: divisions, bevelEnabled: false };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

  const pos = geo.attributes.position;
  const pts = curve.getSpacedPoints(divisions);

  for (let i = 0; i < pos.count; i++) {
    const idx = Math.floor(i / 2);
    const pt = pts[Math.min(idx, pts.length - 1)];
    const tangent = curve.getTangentAt(idx / divisions);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const isLeft = i % 2 === 0;
    const offset = isLeft ? -halfW : halfW;

    pos.setXYZ(i,
      pt.x + normal.x * offset,
      pt.y,
      pt.z + normal.z * offset
    );
  }

  geo.computeVertexNormals();
  return geo;
}

function createCurbGeometry(curve, width, divisions, theme) {
  const curbWidth = 1.0;
  const halfW = width / 2;

  const geo = new THREE.PlaneGeometry(curbWidth, 1, 1, divisions);
  const pos = geo.attributes.position;
  const pts = curve.getSpacedPoints(divisions);

  for (let i = 0; i < pos.count; i++) {
    const idx = Math.floor((i / 2));
    const pt = pts[Math.min(idx, pts.length - 1)];
    const tangent = curve.getTangentAt(idx / divisions);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const isTop = i % 2 === 0;
    const offset = isTop ? -(halfW + curbWidth / 2) : -(halfW - curbWidth / 2);

    pos.setXYZ(i,
      pt.x + normal.x * offset,
      pt.y + 0.03,
      pt.z + normal.z * offset
    );
  }

  geo.computeVertexNormals();
  return geo;
}

function createEdgeGeometry(curve, width, divisions) {
  const edgeWidth = 0.5;
  const halfW = width / 2;

  const geo = new THREE.PlaneGeometry(edgeWidth * 2, 1, 1, divisions);
  const pos = geo.attributes.position;
  const pts = curve.getSpacedPoints(divisions);

  for (let i = 0; i < pos.count; i++) {
    const idx = Math.floor((i / 2));
    const pt = pts[Math.min(idx, pts.length - 1)];
    const tangent = curve.getTangentAt(idx / divisions);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const offset = halfW + edgeWidth / 2;

    pos.setXYZ(i,
      pt.x + normal.x * offset,
      pt.y + 0.01,
      pt.z + normal.z * offset
    );
  }

  geo.computeVertexNormals();
  return geo;
}

function createBarriers(group, curve, width, divisions, theme, gapZones) {
  const barrierHeight = 0.8;
  const halfW = width / 2 + 1.5;

  const leftGeo = new THREE.BoxGeometry(0.3, barrierHeight, 2);
  const rightGeo = new THREE.BoxGeometry(0.3, barrierHeight, 2);

  const barrierMat = getBarrierMaterial(theme);

  const step = 4;
  for (let i = 0; i < divisions; i += step) {
    const t = i / divisions;
    if (isInGapZone(t, gapZones)) continue;

    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const angle = Math.atan2(tangent.x, tangent.z);

    const leftBarrier = new THREE.Mesh(leftGeo, barrierMat);
    leftBarrier.position.copy(pt).add(normal.clone().multiplyScalar(-halfW));
    leftBarrier.position.y = pt.y + barrierHeight / 2;
    leftBarrier.rotation.y = angle;
    leftBarrier.castShadow = true;
    group.add(leftBarrier);

    const rightBarrier = new THREE.Mesh(rightGeo, barrierMat);
    rightBarrier.position.copy(pt).add(normal.clone().multiplyScalar(halfW));
    rightBarrier.position.y = pt.y + barrierHeight / 2;
    rightBarrier.rotation.y = angle;
    rightBarrier.castShadow = true;
    group.add(rightBarrier);
  }
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
      addLightPole(group, decoPos);
    } else {
      addBanner(group, decoPos, tangent, rng);
    }
  }
}

function addTireStack(group, pos, rng) {
  const count = 3 + Math.floor(rng() * 5);
  const tireGeo = new THREE.TorusGeometry(0.3, 0.12, 8, 16);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });

  for (let i = 0; i < count; i++) {
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.position.set(pos.x, pos.y + 0.12 + i * 0.22, pos.z);
    tire.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.3;
    tire.castShadow = true;
    group.add(tire);
  }
}

function addCone(group, pos) {
  const coneGeo = new THREE.ConeGeometry(0.2, 0.5, 8);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.6 });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.set(pos.x, pos.y + 0.25, pos.z);
  cone.castShadow = true;
  group.add(cone);
}

function addLightPole(group, pos) {
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(pos.x, pos.y + 2.5, pos.z);
  pole.castShadow = true;
  group.add(pole);

  const armGeo = new THREE.BoxGeometry(1.5, 0.08, 0.08);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.position.set(pos.x + 0.7, pos.y + 5, pos.z);
  group.add(arm);

  const lightGeo = new THREE.BoxGeometry(0.4, 0.15, 0.3);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 2 });
  const light = new THREE.Mesh(lightGeo, lightMat);
  light.position.set(pos.x + 1.4, pos.y + 4.9, pos.z);
  group.add(light);

  const pointLight = new THREE.PointLight(0xffffcc, 3, 20);
  pointLight.position.set(pos.x + 1.4, pos.y + 4.8, pos.z);
  group.add(pointLight);
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

function getTrackMaterial(theme) {
  switch (theme) {
    case 'city': return new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.85, metalness: 0.05 });
    case 'desert': return new THREE.MeshStandardMaterial({ color: 0xc2a060, roughness: 0.95, metalness: 0.0 });
    case 'forest': return new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.0 });
    case 'alpine': return new THREE.MeshStandardMaterial({ color: 0x666670, roughness: 0.88, metalness: 0.02 });
    default: return new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9, metalness: 0.0 });
  }
}

function getCurbMaterial(theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#cc0000' : '#ffffff';
    ctx.fillRect(i * 8, 0, 8, 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(20, 1);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
}

function getBarrierMaterial(theme) {
  switch (theme) {
    case 'city': return new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.6 });
    case 'desert': return new THREE.MeshStandardMaterial({ color: 0xaa8844, roughness: 0.8 });
    case 'forest': return new THREE.MeshStandardMaterial({ color: 0x446644, roughness: 0.7 });
    default: return new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.3 });
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
