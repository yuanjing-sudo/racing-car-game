import * as THREE from 'three';
import { createNoise2D, lerp } from './utils.js';
import { getTerrainHeight } from './track.js';
import { getTerrainMaterial, applyWindSway } from './materials.js';

export function createScenery(theme = 'alpine', seed = 42, trackCurve = null) {
  const scenery = new THREE.Group();
  const noise = createNoise2D(seed);

  const terrainGeo = createTerrain(theme, noise, trackCurve);
  const terrainMat = getTerrainMaterial(theme);
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scenery.add(terrain);

  if (theme === 'city') {
    addBlossomTrees(scenery, trackCurve, seed);
  } else {
    addTrees(scenery, theme, noise, trackCurve, seed);
  }
  addRocks(scenery, theme, noise, trackCurve, seed);
  if (theme === 'city') addCityBuildings(scenery, trackCurve, seed);
  if (theme === 'alpine') addSnowParticles(scenery, trackCurve);
  addGrassPatches(scenery, theme, noise, trackCurve, seed);
  addClouds(scenery, theme, seed);
  if (theme === 'desert') addCacti(scenery, noise, trackCurve, seed);
  if (theme === 'coastal') addWaterBody(scenery, trackCurve, theme);
  if (theme === 'forest') addMushrooms(scenery, noise, trackCurve, seed);

  addTrackSideDetails(scenery, theme, trackCurve, seed);
  addFlags(scenery, theme, trackCurve, seed);

  return scenery;
}

function createTerrain(theme, noise, trackCurve) {
  const size = 600;
  const res = 128;
  const geo = new THREE.PlaneGeometry(size, size, res, res);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    let h = getTerrainHeight(x, z, theme, noise);

    if (trackCurve) {
      let minDist = Infinity;
      for (let j = 0; j < 100; j++) {
        const t = j / 100;
        const pt = trackCurve.getPointAt(t);
        const dist = Math.sqrt((x - pt.x) ** 2 + (z - pt.z) ** 2);
        if (dist < minDist) minDist = dist;
      }
      if (minDist < 20) {
        const blend = smoothstep(20, 8, minDist);
        h = lerp(h, 0, blend);
      } else if (minDist < 30) {
        const blend = smoothstep(30, 20, minDist);
        h = lerp(h, 0, blend * 0.5);
      }
    }

    pos.setY(i, h);
  }

  geo.computeVertexNormals();
  return geo;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ *
 * Cherry-blossom trees for the city circuit.
 * Each tree is a trunk plus a cluster of pink canopy blobs, all
 * instanced. The canopy material gets SpeedTree-style wind sway, so
 * the blossom canopies ripple as you tear past.
 * ------------------------------------------------------------------ */
function addBlossomTrees(group, trackCurve, seed) {
  const rng = seededRandom(seed + 100);
  const count = 110;

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 3.2, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x40302a, roughness: 0.88 });

  const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
  const canopyMat = applyWindSway(
    new THREE.MeshStandardMaterial({
      color: 0xffc2d6,
      roughness: 0.85,
      metalness: 0.0,
      emissive: 0x2a0d18,
      flatShading: true,
    }),
    2.2,
    'blossom'
  );

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const canopy = new THREE.InstancedMesh(canopyGeo, canopyMat, count * 4);
  trunks.castShadow = true;
  canopy.castShadow = true;
  canopy.receiveShadow = false;

  const dummy = new THREE.Object3D();
  let ci = 0;

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const pt = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = i % 2 === 0 ? 1 : -1;
    const dist = 14 + rng() * 34;
    const x = pt.x + normal.x * dist * side;
    const z = pt.z + normal.z * dist * side;

    const scale = 0.9 + rng() * 0.9;
    const y = pt.y;

    dummy.position.set(x, y + 1.6 * scale, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    for (let b = 0; b < 4; b++) {
      const r = 1.5 + rng() * 0.9;
      dummy.position.set(
        x + (rng() - 0.5) * 2.2 * scale,
        y + (3.3 + rng() * 1.9) * scale,
        z + (rng() - 0.5) * 2.2 * scale
      );
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      dummy.scale.set(r * scale, r * 0.75 * scale, r * scale);
      dummy.updateMatrix();
      canopy.setMatrixAt(ci++, dummy.matrix);
    }
  }

  trunks.count = count;
  canopy.count = ci;
  trunks.instanceMatrix.needsUpdate = true;
  canopy.instanceMatrix.needsUpdate = true;
  group.add(trunks, canopy);
}

function addTrees(group, theme, noise, trackCurve, seed) {
  const rng = seededRandom(seed + 100);
  const treeCount = theme === 'forest' ? 500 : theme === 'countryside' ? 350 : 120;

  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 });

  const pineGeo = new THREE.ConeGeometry(1.4, 3.5, 10);
  const leafMat = applyWindSway(
    new THREE.MeshStandardMaterial({
      color: theme === 'forest' ? 0x2e7d32 : theme === 'countryside' ? 0x4caf50 : 0x2d5a27,
      roughness: 0.85,
    }),
    1.2,
    'pine'
  );

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const leafMesh = new THREE.InstancedMesh(pineGeo, leafMat, treeCount * 2);
  trunkMesh.castShadow = true;
  leafMesh.castShadow = true;

  const dummy = new THREE.Object3D();
  let trunkIdx = 0;
  let leafIdx = 0;
  for (let i = 0; i < treeCount; i++) {
    const x = (rng() - 0.5) * 500;
    const z = (rng() - 0.5) * 500;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 25)) continue;

    const y = getTerrainHeight(x, z, theme, noise);
    const scale = 0.6 + rng() * 1.2;

    dummy.position.set(x, y + scale, z);
    dummy.scale.setScalar(scale);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(trunkIdx++, dummy.matrix);

    dummy.position.set(x, y + scale * 2, z);
    dummy.updateMatrix();
    leafMesh.setMatrixAt(leafIdx++, dummy.matrix);

    dummy.position.set(x, y + scale * 3.2, z);
    dummy.scale.setScalar(scale * 0.7);
    dummy.updateMatrix();
    leafMesh.setMatrixAt(leafIdx++, dummy.matrix);
  }

  trunkMesh.count = trunkIdx;
  leafMesh.count = leafIdx;
  trunkMesh.instanceMatrix.needsUpdate = true;
  leafMesh.instanceMatrix.needsUpdate = true;
  group.add(trunkMesh, leafMesh);
}

function addRocks(group, theme, noise, trackCurve, seed) {
  if (theme === 'city') return;
  const rng = seededRandom(seed + 200);
  const rockCount = theme === 'desert' ? 150 : 80;

  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9, metalness: 0.1 });

  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i < rockCount; i++) {
    const x = (rng() - 0.5) * 400;
    const z = (rng() - 0.5) * 400;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 20)) continue;

    const y = getTerrainHeight(x, z, theme, noise);
    const scale = 0.3 + rng() * 2.0;

    dummy.position.set(x, y + scale * 0.3, z);
    dummy.scale.set(scale, scale * (0.5 + rng() * 0.5), scale);
    dummy.rotation.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
    dummy.updateMatrix();
    rocks.setMatrixAt(n++, dummy.matrix);
  }

  rocks.count = n;
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);
}

/* Shared emissive window sheet for the downtown towers. */
function createWindowTexture(rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, 128, 256);

  const warm = ['#ffd48a', '#ffbf5e', '#fff1c9', '#ffae52'];
  const cool = ['#9fd0ff', '#c9e6ff', '#7fb6ff', '#dff0ff'];

  for (let wy = 0; wy < 24; wy++) {
    for (let wx = 0; wx < 12; wx++) {
      if (rng() > 0.42) {
        const pal = rng() > 0.5 ? warm : cool;
        ctx.fillStyle = pal[Math.floor(rng() * pal.length)];
        ctx.globalAlpha = 0.6 + rng() * 0.4;
        ctx.fillRect(4 + wx * 10, 4 + wy * 10, 7, 6);
      }
    }
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function addCityBuildings(group, trackCurve, seed) {
  const rng = seededRandom(seed + 300);
  const buildingCount = 150;

  // --- tower masses (single draw call) --------------------------
  const massMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.4,
    envMapIntensity: 1.35,
  });
  const masses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), massMat, buildingCount);
  masses.castShadow = true;
  masses.receiveShadow = true;

  // --- lit window sheets ---------------------------------------
  const winGeo = new THREE.PlaneGeometry(1, 1);
  const winTex = createWindowTexture(rng);
  const winMat = new THREE.MeshStandardMaterial({
    map: winTex,
    emissive: 0xffffff,
    emissiveMap: winTex,
    emissiveIntensity: 1.9,
    roughness: 0.4,
    metalness: 0.0,
  });
  const windows = new THREE.InstancedMesh(winGeo, winMat, buildingCount);
  windows.castShadow = false;

  // --- rooftop neon --------------------------------------------
  const neonGeo = new THREE.BoxGeometry(1, 1, 1);
  const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  neonMat.vertexColors = false;
  const neon = new THREE.InstancedMesh(neonGeo, neonMat, buildingCount);
  neon.castShadow = false;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const neonPalette = [0x00e5ff, 0xff2d95, 0xffd400, 0x7c4dff, 0x00ff9d];

  for (let i = 0; i < buildingCount; i++) {
    const t = i / buildingCount;
    const pt = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = i % 2 === 0 ? 1 : -1;
    const dist = 20 + rng() * 62;

    const bx = pt.x + normal.x * dist * side;
    const bz = pt.z + normal.z * dist * side;

    const width = 10 + rng() * 26;
    const depth = 10 + rng() * 26;
    const height = 46 + rng() * 190;

    // mass
    dummy.position.set(bx, height / 2, bz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    masses.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.56 + rng() * 0.2, 0.22, 0.13 + rng() * 0.18);
    masses.setColorAt(i, col);

    // window sheet on the face pointing back toward the track
    const toTrack = normal.clone().multiplyScalar(-side);
    dummy.position.set(
      bx + toTrack.x * (depth / 2 + 0.03),
      height * 0.5,
      bz + toTrack.z * (depth / 2 + 0.03)
    );
    dummy.rotation.set(0, Math.atan2(toTrack.x, toTrack.z), 0);
    dummy.scale.set(width * 0.88, height * 0.82, 1);
    dummy.updateMatrix();
    windows.setMatrixAt(i, dummy.matrix);

    // neon band near the crown
    dummy.position.set(bx, height + 1.2, bz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(width * 0.9, 0.9, depth * 0.9);
    dummy.updateMatrix();
    neon.setMatrixAt(i, dummy.matrix);
    col.setHex(neonPalette[Math.floor(rng() * neonPalette.length)]);
    neon.setColorAt(i, col);
  }

  masses.instanceMatrix.needsUpdate = true;
  windows.instanceMatrix.needsUpdate = true;
  neon.instanceMatrix.needsUpdate = true;
  if (masses.instanceColor) masses.instanceColor.needsUpdate = true;
  if (neon.instanceColor) neon.instanceColor.needsUpdate = true;

  group.add(masses, windows, neon);
}

function addSnowParticles(group, trackCurve) {
  const particleCount = 5000;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    const t = Math.random();
    const pt = trackCurve.getPointAt(t);
    positions[i * 3] = pt.x + (Math.random() - 0.5) * 200;
    positions[i * 3 + 1] = pt.y + Math.random() * 30 + 5;
    positions[i * 3 + 2] = pt.z + (Math.random() - 0.5) * 200;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.15,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });

  const snow = new THREE.Points(geo, mat);
  snow.userData.isSnow = true;
  group.add(snow);
}

function addGrassPatches(group, theme, noise, trackCurve, seed) {
  if (theme === 'city' || theme === 'desert') return;
  const rng = seededRandom(seed + 400);
  const sprigCount = theme === 'countryside' ? 900 : theme === 'forest' ? 1200 : 400;

  const grassGeo = new THREE.PlaneGeometry(0.16, 0.55);
  grassGeo.translate(0, 0.275, 0); // base sits on the ground for clean sway
  const grassMat = applyWindSway(
    new THREE.MeshStandardMaterial({
      color: theme === 'forest' ? 0x3a9a3a : 0x6ab04c,
      roughness: 0.95,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    }),
    2.6,
    'grass'
  );

  const mesh = new THREE.InstancedMesh(grassGeo, grassMat, sprigCount);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let n = 0;

  for (let i = 0; i < sprigCount; i++) {
    const x = (rng() - 0.5) * 400;
    const z = (rng() - 0.5) * 400;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 18)) continue;

    const y = getTerrainHeight(x, z, theme, noise);
    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.4, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
    const s = 0.6 + rng() * 1.0;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(n++, dummy.matrix);
  }

  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
}

function addClouds(group, theme, seed) {
  if (theme === 'city') return;
  const rng = seededRandom(seed + 500);
  const cloudCount = 30;

  const cloudGeo = new THREE.SphereGeometry(1, 8, 6);
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
    roughness: 1.0,
  });

  for (let i = 0; i < cloudCount; i++) {
    const cloud = new THREE.Group();
    const puffCount = 3 + Math.floor(rng() * 4);

    for (let j = 0; j < puffCount; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(
        (rng() - 0.5) * 15,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 8
      );
      puff.scale.set(5 + rng() * 8, 2 + rng() * 3, 3 + rng() * 5);
      cloud.add(puff);
    }

    cloud.position.set(
      (rng() - 0.5) * 500,
      60 + rng() * 30,
      (rng() - 0.5) * 500
    );
    cloud.userData.speed = 0.5 + rng() * 1.5;
    group.add(cloud);
  }
}

function addCacti(group, noise, trackCurve, seed) {
  const rng = seededRandom(seed + 600);
  const cactusCount = 60;

  const cactusGeo = new THREE.CylinderGeometry(0.15, 0.2, 2, 8);
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.8 });

  const cacti = new THREE.InstancedMesh(cactusGeo, cactusMat, cactusCount);
  cacti.castShadow = true;

  const dummy = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i < cactusCount; i++) {
    const x = (rng() - 0.5) * 400;
    const z = (rng() - 0.5) * 400;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 20)) continue;

    const y = getTerrainHeight(x, z, 'desert', noise);
    const scale = 0.5 + rng() * 1.5;

    dummy.position.set(x, y + scale, z);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    cacti.setMatrixAt(n++, dummy.matrix);
  }

  cacti.count = n;
  cacti.instanceMatrix.needsUpdate = true;
  group.add(cacti);
}

function addWaterBody(group, trackCurve, theme) {
  const waterGeo = new THREE.PlaneGeometry(600, 200);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x0066aa,
    metalness: 0.1,
    roughness: 0.0,
    transparent: true,
    opacity: 0.8,
    transmission: 0.3,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.5, -250);
  group.add(water);
}

function addMushrooms(group, noise, trackCurve, seed) {
  const rng = seededRandom(seed + 700);
  const count = 80;

  const stemGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.3, 6);
  const capGeo = new THREE.SphereGeometry(0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xeeddcc });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.7 });

  const stems = new THREE.InstancedMesh(stemGeo, stemMat, count);
  const caps = new THREE.InstancedMesh(capGeo, capMat, count);

  const dummy = new THREE.Object3D();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 300;
    const z = (rng() - 0.5) * 300;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 18)) continue;

    const y = getTerrainHeight(x, z, 'forest', noise);
    const scale = 0.5 + rng() * 1.5;

    dummy.scale.setScalar(scale);
    dummy.position.set(x, y + 0.15 * scale, z);
    dummy.updateMatrix();
    stems.setMatrixAt(n, dummy.matrix);

    dummy.position.y += 0.25 * scale;
    dummy.updateMatrix();
    caps.setMatrixAt(n, dummy.matrix);
    n++;
  }

  stems.count = n;
  caps.count = n;
  stems.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  group.add(stems, caps);
}

function addTrackSideDetails(group, theme, trackCurve, seed) {
  if (!trackCurve) return;
  const rng = seededRandom(seed + 800);

  for (let i = 0; i < 40; i++) {
    const t = rng();
    const pt = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = rng() > 0.5 ? 1 : -1;
    const dist = 12 + rng() * 5;

    const px = pt.x + normal.x * dist * side;
    const pz = pt.z + normal.z * dist * side;
    const py = pt.y;

    const postGeo = new THREE.BoxGeometry(0.1, 1.2, 0.1);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, py + 0.6, pz);
    group.add(post);

    const refGeo = new THREE.BoxGeometry(0.3, 0.4, 0.05);
    const refMat = new THREE.MeshStandardMaterial({
      color: side > 0 ? 0xffffff : 0xcc0000,
      emissive: side > 0 ? 0x333333 : 0x330000,
    });
    const reflector = new THREE.Mesh(refGeo, refMat);
    reflector.position.set(px, py + 1.0, pz);
    reflector.rotation.y = Math.atan2(tangent.x, tangent.z);
    group.add(reflector);
  }
}

function isTooCloseToTrack(x, z, trackCurve, threshold) {
  for (let j = 0; j < 50; j++) {
    const t = j / 50;
    const pt = trackCurve.getPointAt(t);
    const dist = Math.sqrt((x - pt.x) ** 2 + (z - pt.z) ** 2);
    if (dist < threshold) return true;
  }
  return false;
}

function addFlags(group, theme, trackCurve, seed) {
  const rng = seededRandom(seed + 900);
  const flagCount = 40;

  const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.3 });

  for (let i = 0; i < flagCount; i++) {
    const t = i / flagCount;
    const pt = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = i % 2 === 0 ? 1 : -1;
    const dist = 6 + rng() * 4;

    const px = pt.x + normal.x * dist * side;
    const pz = pt.z + normal.z * dist * side;
    const py = pt.y;

    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(px, py + 1.1, pz);
    pole.rotation.z = Math.atan2(tangent.x, tangent.z) - Math.PI / 2;
    group.add(pole);

    const flagGeo = new THREE.PlaneGeometry(0.9, 0.5);
    const hue = 0.55 + rng() * 0.4;
    const flagMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, 0.8, 0.55),
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(px, py + 2.0, pz);
    flag.rotation.z = Math.atan2(tangent.x, tangent.z) - Math.PI / 2;
    flag.rotation.x = Math.sin(Date.now() * 0.002 + i) * 0.1;
    group.add(flag);
  }
}

function seededRandom(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
