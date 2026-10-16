import * as THREE from 'three';
import { createNoise2D, fbm, randomRange, randomInt, lerp } from './utils.js';
import { getTerrainHeight } from './track.js';

export function createScenery(theme = 'alpine', seed = 42, trackCurve = null) {
  const scenery = new THREE.Group();
  const noise = createNoise2D(seed);

  const terrainGeo = createTerrain(theme, noise, trackCurve);
  const terrainMat = getTerrainMaterial(theme);
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scenery.add(terrain);

  addTrees(scenery, theme, noise, trackCurve, seed);
  addRocks(scenery, theme, noise, trackCurve, seed);
  if (theme === 'city') addCityBuildings(scenery, trackCurve, seed);
  if (theme === 'alpine') addSnowParticles(scenery, trackCurve);
  addGrassPatches(scenery, theme, noise, trackCurve, seed);
  addClouds(scenery, theme, seed);
  if (theme === 'desert') addCacti(scenery, noise, trackCurve, seed);
  if (theme === 'coastal') addWaterBody(scenery, trackCurve, theme);
  if (theme === 'forest') addMushrooms(scenery, noise, trackCurve, seed);

  addTrackSideDetails(scenery, theme, trackCurve, seed);

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

function getTerrainMaterial(theme) {
  switch (theme) {
    case 'alpine': return new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.9, metalness: 0.1 });
    case 'coastal': return new THREE.MeshStandardMaterial({ color: 0xc2b280, roughness: 0.95, metalness: 0.0 });
    case 'desert': return new THREE.MeshStandardMaterial({ color: 0xd4a556, roughness: 0.98, metalness: 0.0 });
    case 'forest': return new THREE.MeshStandardMaterial({ color: 0x3d6b35, roughness: 0.95, metalness: 0.0 });
    case 'city': return new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.85, metalness: 0.1 });
    case 'countryside': return new THREE.MeshStandardMaterial({ color: 0x7a9a4a, roughness: 0.9, metalness: 0.0 });
    default: return new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
  }
}

function addTrees(group, theme, noise, trackCurve, seed) {
  const rng = seededRandom(seed + 100);
  const treeCount = theme === 'forest' ? 400 : theme === 'countryside' ? 200 : 100;

  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 2, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.9 });

  const pineGeo = new THREE.ConeGeometry(1.2, 3, 8);
  const leafMat = new THREE.MeshStandardMaterial({
    color: theme === 'forest' ? 0x1a5c1a : 0x2d5a27,
    roughness: 0.85,
  });

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const leafMesh = new THREE.InstancedMesh(pineGeo, leafMat, treeCount * 2);
  trunkMesh.castShadow = true;
  leafMesh.castShadow = true;

  let leafIdx = 0;
  for (let i = 0; i < treeCount; i++) {
    const x = (rng() - 0.5) * 500;
    const z = (rng() - 0.5) * 500;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 25)) continue;

    const y = getTerrainHeight(x, z, theme, noise);
    const scale = 0.6 + rng() * 1.2;

    const dummy = new THREE.Object3D();
    dummy.position.set(x, y + scale, z);
    dummy.scale.setScalar(scale);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, y + scale * 2, z);
    dummy.updateMatrix();
    leafMesh.setMatrixAt(leafIdx++, dummy.matrix);

    dummy.position.set(x, y + scale * 3.2, z);
    dummy.scale.setScalar(scale * 0.7);
    dummy.updateMatrix();
    leafMesh.setMatrixAt(leafIdx++, dummy.matrix);
  }

  trunkMesh.count = treeCount;
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

  for (let i = 0; i < rockCount; i++) {
    const x = (rng() - 0.5) * 400;
    const z = (rng() - 0.5) * 400;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 20)) continue;

    const y = getTerrainHeight(x, z, theme, noise);
    const scale = 0.3 + rng() * 2.0;

    const dummy = new THREE.Object3D();
    dummy.position.set(x, y + scale * 0.3, z);
    dummy.scale.set(scale, scale * (0.5 + rng() * 0.5), scale);
    dummy.rotation.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }

  rocks.count = rockCount;
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);
}

function addCityBuildings(group, trackCurve, seed) {
  const rng = seededRandom(seed + 300);
  const buildingCount = 60;

  for (let i = 0; i < buildingCount; i++) {
    const t = i / buildingCount;
    const pt = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = i % 2 === 0 ? 1 : -1;
    const dist = 20 + rng() * 40;

    const bx = pt.x + normal.x * dist * side;
    const bz = pt.z + normal.z * dist * side;

    const width = 8 + rng() * 15;
    const depth = 8 + rng() * 15;
    const height = 15 + rng() * 50;

    const buildGeo = new THREE.BoxGeometry(width, height, depth);
    const buildMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.6, 0.1, 0.15 + rng() * 0.2),
      roughness: 0.7,
      metalness: 0.3,
    });
    const building = new THREE.Mesh(buildGeo, buildMat);
    building.position.set(bx, height / 2, bz);
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);

    const windowGeo = new THREE.PlaneGeometry(width * 0.8, height * 0.7);
    const windowCanvas = document.createElement('canvas');
    windowCanvas.width = 128; windowCanvas.height = 256;
    const wCtx = windowCanvas.getContext('2d');
    wCtx.fillStyle = '#111122';
    wCtx.fillRect(0, 0, 128, 256);
    for (let wy = 0; wy < 20; wy++) {
      for (let wx = 0; wx < 10; wx++) {
        if (rng() > 0.4) {
          wCtx.fillStyle = rng() > 0.5 ? '#ffee88' : '#88ccff';
          wCtx.fillRect(4 + wx * 12, 4 + wy * 12, 8, 8);
        }
      }
    }
    const windowTex = new THREE.CanvasTexture(windowCanvas);
    const windowMat = new THREE.MeshBasicMaterial({ map: windowTex });
    const windowMesh = new THREE.Mesh(windowGeo, windowMat);
    windowMesh.position.set(bx, height * 0.5, bz + depth / 2 + 0.01);
    group.add(windowMesh);
  }
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
  const patchCount = 200;

  const grassGeo = new THREE.PlaneGeometry(0.5, 0.8);
  const grassMat = new THREE.MeshStandardMaterial({
    color: theme === 'forest' ? 0x2d7a2d : 0x5a8a3a,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });

  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, patchCount);

  for (let i = 0; i < patchCount; i++) {
    const x = (rng() - 0.5) * 400;
    const z = (rng() - 0.5) * 400;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 18)) continue;

    const y = getTerrainHeight(x, z, theme, noise);
    const dummy = new THREE.Object3D();
    dummy.position.set(x, y + 0.3, z);
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.scale.setScalar(0.5 + rng() * 1.5);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);
  }

  grassMesh.count = patchCount;
  grassMesh.instanceMatrix.needsUpdate = true;
  group.add(grassMesh);
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

  for (let i = 0; i < cactusCount; i++) {
    const x = (rng() - 0.5) * 400;
    const z = (rng() - 0.5) * 400;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 20)) continue;

    const y = getTerrainHeight(x, z, 'desert', noise);
    const scale = 0.5 + rng() * 1.5;

    const dummy = new THREE.Object3D();
    dummy.position.set(x, y + scale, z);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    cacti.setMatrixAt(i, dummy.matrix);
  }

  cacti.count = cactusCount;
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

  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 300;
    const z = (rng() - 0.5) * 300;

    if (trackCurve && isTooCloseToTrack(x, z, trackCurve, 18)) continue;

    const y = getTerrainHeight(x, z, 'forest', noise);
    const scale = 0.5 + rng() * 1.5;

    const dummy = new THREE.Object3D();
    dummy.position.set(x, y + 0.15 * scale, z);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);

    dummy.position.y += 0.25 * scale;
    dummy.updateMatrix();
    caps.setMatrixAt(i, dummy.matrix);
  }

  stems.count = count;
  caps.count = count;
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

function seededRandom(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
