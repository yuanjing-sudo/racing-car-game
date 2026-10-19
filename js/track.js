import * as THREE from 'three';
import { createNoise2D, fbm, lerp, clamp, createRadialTexture, smoothstep } from './utils.js';
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
  { id: 'tokyo', name: 'Tokyo Dream Circuit', desc: 'Rain-slicked neon night through Tokyo' },
  { id: 'countryside', name: 'Countryside Sprint', desc: 'Rolling hills and farmland' },
];

export function createTrack(theme = 'alpine', seed = 42) {
  const noise = createNoise2D(seed);
  // Width and gap placement used to come from `randomRange()`, i.e. from
  // Math.random(), so the same seed gave a different circuit every load — the
  // car was tuned against a 14 m road and sometimes got 16 m. Draw them from the
  // seed too, so `createTrack(theme, seed)` is fully reproducible.
  const rng = mulberry32(seed);
  const trackGroup = new THREE.Group();
  const trackData = { checkpoints: [], sectors: [], length: 0, theme, noise, gapZones: [] };

  const numPoints = 140;
  const points = [];
  const trackWidth = 14 + (rng() * 4 - 2);
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
  curve.userData = { roadHalfWidth: trackWidth / 2 };
  trackData.curve = curve;
  trackData.length = curve.getLength();

  // More divisions than before so the tighter corner radii stay smooth.
  const divisions = 800;
  const trackPoints = curve.getSpacedPoints(divisions);
  trackData.trackPoints = trackPoints;

  const gapZones = [];
  const numGaps = theme === 'city' || theme === 'tokyo' ? 0 : 3;
  for (let g = 0; g < numGaps; g++) {
    const tStart = 0.12 + g * 0.28 + (rng() * 0.04 - 0.02);
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
  const halfW = width / 2;
  const vertCount = (segDivisions + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = new Uint32Array(segDivisions * 6);
  const pt = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i <= segDivisions; i++) {
    const rawT = t0 + (t1 - t0) * (i / segDivisions);
    const t = isFinite(rawT) ? clamp(rawT, 0, 1) : 0;
    curve.getPointAt(t, pt);
    curve.getTangentAt(t, tangent);
    normal.set(-tangent.z, 0, tangent.x).normalize();

    // Two vertices per cross-section: left then right.  The old version
    // remapped an ExtrudeGeometry that was built from an open line; the
    // extrusion's vertex order did not match this indexing, so the road
    // rendered as a zig-zag of disconnected triangles.  Building the strip
    // explicitly keeps the surface watertight and lets us pick the winding.
    const left = i * 2;
    positions[left * 3] = pt.x + normal.x * halfW;
    positions[left * 3 + 1] = pt.y;
    positions[left * 3 + 2] = pt.z + normal.z * halfW;
    positions[(left + 1) * 3] = pt.x - normal.x * halfW;
    positions[(left + 1) * 3 + 1] = pt.y;
    positions[(left + 1) * 3 + 2] = pt.z - normal.z * halfW;

    // Deterministic UVs so the wet-asphalt maps tile correctly:
    // u across the width, v along the length of the lap.
    const v = t * 260;
    uvs[left * 2] = 0;
    uvs[left * 2 + 1] = v;
    uvs[(left + 1) * 2] = width * 0.25;
    uvs[(left + 1) * 2 + 1] = v;

    if (i < segDivisions) {
      const a = left;
      const b = left + 1;
      const c = left + 2;
      const d = left + 3;
      const o = i * 6;
      // Up-facing winding: (left, next-left, right) and (right, next-left,
      // next-right).
      indices[o] = a;
      indices[o + 1] = c;
      indices[o + 2] = b;
      indices[o + 3] = b;
      indices[o + 4] = c;
      indices[o + 5] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, getRoadMaterial(theme));
  mesh.name = 'TrackRoad';
  return mesh;
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
    case 'tokyo': return 0.03;
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
    case 'tokyo': return 0;
    case 'countryside': return base * 12 + 1;
    default: return base * 15;
  }
}

/**
 * The closed lap sampled along its length, cached per curve.
 *
 * `getGradedTerrainHeight` walks this every time it runs, and the terrain plane
 * alone asks for it 16 641 times, so it is built once per track rather than once
 * per call. 256 points is about 6.5 m apart on these laps: fine enough that the
 * chord is within centimetres of the curve vertically.
 */
const LAP_LINE_CACHE = new WeakMap();
function lapLine(curve) {
  let line = LAP_LINE_CACHE.get(curve);
  if (!line) {
    line = [];
    const N = 256;
    for (let j = 0; j < N; j++) line.push(curve.getPointAt(j / N));
    LAP_LINE_CACHE.set(curve, line);
  }
  return line;
}

/**
 * The surface the world is actually built on: the raw terrain graded flat to the
 * **road's own height** within 30 m of the centreline, so the ground meets the
 * tarmac at the road edge instead of slicing through it.
 *
 * The road does not follow the raw terrain: `createTrack` puts it at
 * `getTerrainHeight * elevation`, which is 0.48x for the countryside and 1.28x
 * for the alpine. Grading the ground toward y = 0 (as this used to) therefore
 * buried the tarmac — by up to 8.5 m on the alpine, 3.1 m in the forest, and by
 * more than a metre on 96% of the coastal lap. Grading toward the nearest point
 * of the lap fixes that for every theme, and is a no-op for city and tokyo, where
 * road and terrain are both 0.
 *
 * Distance is measured to the nearest *point* on the centreline, not the nearest
 * sample: snapping to samples leaves the road's own climb (a metre or two per
 * sample on the alpine) as error in the graded height.
 *
 * Anything placed off the road should use this rather than `getTerrainHeight`, or
 * it will float or sink by the difference. Pass the same curve the track was
 * built from.
 *
 * @param {number} x world X
 * @param {number} z world Z
 * @param {string} theme track theme
 * @param {Function} [noise] the track's own noise, from `createTrack`
 * @param {THREE.Curve} [curve] the track centreline
 * @returns {number} ground height in metres
 */
export function getGradedTerrainHeight(x, z, theme, noise, curve) {
  const raw = getTerrainHeight(x, z, theme, noise);
  if (!curve) return raw;

  const line = lapLine(curve);
  const n = line.length;
  if (n < 2) return raw;

  let best = Infinity;
  let roadY = 0;
  for (let j = 0; j < n; j++) {
    const a = line[j];
    const b = line[j + 1 === n ? 0 : j + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    let u = 0;
    if (len2 > 1e-9) {
      u = ((x - a.x) * ex + (z - a.z) * ez) / len2;
      u = u < 0 ? 0 : (u > 1 ? 1 : u);
    }
    const dx = x - (a.x + ex * u);
    const dz = z - (a.z + ez * u);
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      roadY = a.y + (b.y - a.y) * u;
    }
  }

  const dist = Math.sqrt(best);
  // Keep the drawn ground below the tarmac across the whole road width.  The
  // terrain grid is coarse (one vertex every few metres), so grading it merely
  // *to* the road height lets a triangle bridge over the road and bury it.
  // The clearance tapers out over the shoulder so the verge still meets the
  // tarmac.
  const halfW = (curve.userData && curve.userData.roadHalfWidth) || 7;
  const clearance = 0.25 * (1 - smoothstep(halfW, halfW + 2, dist));
  const gradeY = roadY - clearance;
  if (dist < 20) return lerp(raw, gradeY, smoothstep(20, 8, dist));
  if (dist < 30) return lerp(raw, gradeY, smoothstep(30, 20, dist) * 0.5);
  return raw;
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
