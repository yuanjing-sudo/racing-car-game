import * as THREE from 'three';
import { createNoise2D } from './utils.js';
import { getGradedTerrainHeight } from './track.js';
import { getTerrainMaterial, applyWindSway } from './materials.js';

export function createScenery(theme = 'alpine', seed = 42, trackCurve = null) {
  const scenery = new THREE.Group();
  const noise = createNoise2D(seed);

  const terrainGeo = createTerrain(theme, noise, trackCurve);
  const terrainMat = getTerrainMaterial(theme);
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scenery.add(terrain);

  // Tokyo shares the downtown DNA (sakura + towers) but layers on its own
  // landmarks: a neon skyline ring, Tokyo Tower and a Mount Fuji silhouette.
  const isUrban = theme === 'city' || theme === 'tokyo';

  if (isUrban) {
    addBlossomTrees(scenery, trackCurve, seed);
  } else {
    addTrees(scenery, theme, noise, trackCurve, seed);
  }
  addRocks(scenery, theme, noise, trackCurve, seed);
  if (theme === 'city') addCityBuildings(scenery, trackCurve, seed);
  if (theme === 'tokyo') {
    addCityBuildings(scenery, trackCurve, seed, {
      count: 190,
      baseHeight: 60,
      heightVar: 240,
      spread: 82,
      winIntensity: 2.5,
      neonGain: 2.4,
      neonPalette: [0x00e5ff, 0xff2d95, 0xffd400, 0x7c4dff, 0x00ff9d, 0xff5a2a, 0xff1f6f],
    });
    addTokyoSkyline(scenery, seed);
    addTokyoTower(scenery);
    addMountFuji(scenery);
    addNeonSigns(scenery, trackCurve, seed);
    addTokyoRailway(scenery, trackCurve, noise, seed);
  }
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
  // Tokyo spreads its skyline ring and Mount Fuji much further out than the
  // other themes, so its ground plane needs to reach them.
  const size = theme === 'tokyo' ? 1800 : 600;
  const res = 128;
  const geo = new THREE.PlaneGeometry(size, size, res, res);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // Graded to the road's own height near the lap, not to y = 0: see
    // getGradedTerrainHeight. The terrain mesh, the scenery and the gfx layer
    // all seat through this, so they agree on where the ground actually is.
    pos.setY(i, getGradedTerrainHeight(pos.getX(i), pos.getZ(i), theme, noise, trackCurve));
  }

  geo.computeVertexNormals();
  return geo;
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

    const y = getGradedTerrainHeight(x, z, theme, noise, trackCurve);
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
  if (theme === 'city' || theme === 'tokyo') return;
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

    const y = getGradedTerrainHeight(x, z, theme, noise, trackCurve);
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

function addCityBuildings(group, trackCurve, seed, opts = {}) {
  const rng = seededRandom(seed + 300);
  const buildingCount = opts.count || 150;
  const baseHeight = opts.baseHeight || 46;
  const heightVar = opts.heightVar || 190;
  const spread = opts.spread || 62;
  const winIntensity = opts.winIntensity || 1.9;
  const neonPalette = opts.neonPalette || [0x00e5ff, 0xff2d95, 0xffd400, 0x7c4dff, 0x00ff9d];

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
    emissiveIntensity: winIntensity,
    roughness: 0.4,
    metalness: 0.0,
  });
  const windows = new THREE.InstancedMesh(winGeo, winMat, buildingCount);
  windows.castShadow = false;

  // --- rooftop neon --------------------------------------------
  const neonGeo = new THREE.BoxGeometry(1, 1, 1);
  const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  neonMat.vertexColors = false;
  // over-bright multiplier pushes the crowns past the bloom threshold (1.0)
  if (opts.neonGain) neonMat.color.setScalar(opts.neonGain);
  const neon = new THREE.InstancedMesh(neonGeo, neonMat, buildingCount);
  neon.castShadow = false;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  for (let i = 0; i < buildingCount; i++) {
    const t = i / buildingCount;
    const pt = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = i % 2 === 0 ? 1 : -1;
    const dist = 20 + rng() * spread;

    const bx = pt.x + normal.x * dist * side;
    const bz = pt.z + normal.z * dist * side;

    const width = 10 + rng() * 26;
    const depth = 10 + rng() * 26;
    const height = baseHeight + rng() * heightVar;

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
  if (theme === 'city' || theme === 'tokyo' || theme === 'desert') return;
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

    const y = getGradedTerrainHeight(x, z, theme, noise, trackCurve);
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
  if (theme === 'city' || theme === 'tokyo') return;
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

    const y = getGradedTerrainHeight(x, z, 'desert', noise, trackCurve);
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
  // The sea belongs below the lowest point of the lap: a coast the road can run
  // along, not one it can drown in. The land beyond the graded verge still dips
  // under it, so the bays are where the terrain says they are.
  let lowest = Infinity;
  if (trackCurve) {
    for (let i = 0; i <= 200; i++) lowest = Math.min(lowest, trackCurve.getPointAt(i / 200).y);
  }
  water.position.set(0, Number.isFinite(lowest) ? lowest - 1.2 : -3.5, -250);
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

    const y = getGradedTerrainHeight(x, z, 'forest', noise, trackCurve);
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

/* ------------------------------------------------------------------ *
 * Tokyo Dream Circuit landmarks
 * A distant neon skyline ring, a red-and-white broadcast tower, a
 * hazy Mount Fuji on the horizon and vertical neon signage lining the
 * circuit. Signs / windows are emissive and tone-mapping-exempt so the
 * bloom pass smears them the way the real Shuto Expressway glows at
 * night.
 * ------------------------------------------------------------------ */
function addTokyoSkyline(group, seed) {
  const rng = seededRandom(seed + 1100);
  const count = 130;
  const winTex = createWindowTexture(rng);

  const massMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.5,
    envMapIntensity: 1.5,
  });
  const masses = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), massMat, count);
  masses.castShadow = false;
  masses.receiveShadow = false;

  const winMat = new THREE.MeshStandardMaterial({
    map: winTex,
    emissive: 0xffffff,
    emissiveMap: winTex,
    emissiveIntensity: 2.4,
    roughness: 0.4,
    transparent: true,
    opacity: 0.96,
  });
  const windows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), winMat, count * 4);

  const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  neonMat.color.setScalar(2.4);
  const neon = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), neonMat, count);

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const neonPalette = [0x00e5ff, 0xff2d95, 0xffd400, 0x7c4dff, 0x00ff9d, 0xff5a2a];

  const faces = [
    { nx: 0, nz: 1 },
    { nx: 1, nz: 0 },
    { nx: 0, nz: -1 },
    { nx: -1, nz: 0 },
  ];

  let wi = 0;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.06;
    const radius = 380 + rng() * 80;
    const bx = Math.cos(a) * radius;
    const bz = Math.sin(a) * radius;

    const width = 16 + rng() * 34;
    const depth = 16 + rng() * 34;
    const height = 70 + rng() * 230;

    dummy.position.set(bx, height / 2, bz);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    masses.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.6 + rng() * 0.12, 0.25, 0.05 + rng() * 0.07);
    masses.setColorAt(i, col);

    // four lit faces so each tower reads from any approach angle
    for (const f of faces) {
      const off = f.nz !== 0 ? depth / 2 : width / 2;
      const faceWidth = f.nz !== 0 ? width : depth;
      dummy.position.set(bx + f.nx * off, height * 0.5, bz + f.nz * off);
      dummy.rotation.set(0, Math.atan2(f.nx, f.nz), 0);
      dummy.scale.set(faceWidth * 0.86, height * 0.8, 1);
      dummy.updateMatrix();
      windows.setMatrixAt(wi++, dummy.matrix);
    }

    // coloured crown band
    dummy.position.set(bx, height + 1.5, bz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(width * 0.92, 1.2, depth * 0.92);
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

function addTokyoTower(group) {
  const tower = new THREE.Group();

  const towerMat = new THREE.MeshStandardMaterial({
    color: 0xff5522,
    roughness: 0.45,
    metalness: 0.35,
    emissive: 0x8a2200,
    emissiveIntensity: 1.15,
  });
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0xf4f4f4,
    roughness: 0.4,
    metalness: 0.2,
    emissive: 0x2a2a2a,
    emissiveIntensity: 1.0,
  });

  // tapered 4-sided shaft reads as the lattice silhouette from a distance
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(8, 30, 300, 4, 1), towerMat);
  shaft.position.y = 150;
  tower.add(shaft);

  const mainDeck = new THREE.Mesh(new THREE.CylinderGeometry(17, 19, 11, 4, 1), deckMat);
  mainDeck.position.y = 152;
  tower.add(mainDeck);

  const topDeck = new THREE.Mesh(new THREE.CylinderGeometry(10, 12, 9, 4, 1), deckMat);
  topDeck.position.y = 252;
  tower.add(topDeck);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 92, 6), towerMat);
  antenna.position.y = 348;
  tower.add(antenna);

  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  beaconMat.color.setScalar(3.0);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), beaconMat);
  beacon.position.y = 396;
  tower.add(beacon);

  tower.position.set(-330, 0, -260);
  group.add(tower);
}

function addMountFuji(group) {
  const fuji = new THREE.Group();

  // fog opted out + hand-hazed colour so the silhouette always sits on the
  // horizon instead of being swallowed by the exponential fog.
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x35406b,
    emissive: 0x121833,
    emissiveIntensity: 1.0,
    roughness: 1.0,
    metalness: 0.0,
    fog: false,
  });
  const base = new THREE.Mesh(new THREE.ConeGeometry(210, 250, 40, 1), baseMat);
  base.position.y = 125;
  fuji.add(base);

  const capMat = new THREE.MeshStandardMaterial({
    color: 0xe8edff,
    emissive: 0x2b3760,
    emissiveIntensity: 0.9,
    roughness: 0.75,
    metalness: 0.0,
    fog: false,
  });
  const cap = new THREE.Mesh(new THREE.ConeGeometry(78, 96, 40, 1), capMat);
  cap.position.y = 202; // snow cap overlapping the summit
  fuji.add(cap);

  fuji.position.set(200, 0, -560);
  fuji.rotation.y = 0.5;
  group.add(fuji);
}

function makeNeonSignTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, 128, 384);

  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.strokeRect(12, 12, 104, 360);

  ctx.fillStyle = color;
  ctx.font = 'bold 60px "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = Array.from(text);
  const step = 350 / Math.max(chars.length, 1);
  chars.forEach((ch, i) => {
    ctx.fillText(ch, 64, 30 + step * (i + 0.5));
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const neonSigns = [
  { text: '東京', color: '#ff2d95' },
  { text: 'ドリーム', color: '#00e5ff' },
  { text: 'サーキット', color: '#ffd400' },
  { text: 'ネオン', color: '#7c4dff' },
  { text: 'スピード', color: '#00ff9d' },
  { text: '夜景', color: '#ff5a2a' },
];

function addNeonSigns(group, trackCurve, seed) {
  const rng = seededRandom(seed + 1300);
  const count = 72;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.8, roughness: 0.35 });

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const pt = trackCurve.getPointAt(t);
    const tangent = trackCurve.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const side = i % 2 === 0 ? 1 : -1;
    const dist = 10.5 + rng() * 3.5;
    const px = pt.x + normal.x * dist * side;
    const pz = pt.z + normal.z * dist * side;

    const sign = neonSigns[Math.floor(rng() * neonSigns.length)];
    const h = 4.5 + rng() * 5.5;
    const w = h * 0.34;
    const clearance = 2.4 + rng() * 1.6;

    // mounting pole
    const poleH = clearance + h * 0.5;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, poleH, 0.16), poleMat);
    pole.position.set(px, pt.y + poleH / 2, pz);
    group.add(pole);

    const tex = makeNeonSignTexture(sign.text, sign.color);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    // over-bright so the sign bleeds through the bloom pass
    mat.color.setRGB(1.9, 1.9, 1.9);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    board.position.set(px, pt.y + clearance + h / 2, pz);
    // face back toward the racing line
    board.rotation.y = Math.atan2(-normal.x * side, -normal.z * side);
    group.add(board);
  }
}

/* ------------------------------------------------------------------ *
 * Elevated railway — the commuter line that threads between the towers.
 *
 * A concrete viaduct follows the outside of the circuit for a third of a
 * lap, with pillars dropping onto the graded ground and a lit six-car
 * train running along it.  The train is animated from `onBeforeRender` on
 * the first deck section, so it needs no update hook in the game loop.
 * ------------------------------------------------------------------ */
function addTokyoRailway(group, trackCurve, noise, seed) {
  const rng = seededRandom(seed + 1500);
  const t0 = 0.54;
  const t1 = 0.80;
  const samples = 36;
  const offset = 24 + rng() * 4;
  const side = rng() < 0.5 ? 1 : -1;
  const deckTop = 12.0 + rng() * 1.5; // metres above the road at that point

  const deckPts = [];
  const trainPts = [];
  for (let i = 0; i <= samples; i++) {
    const t = t0 + (t1 - t0) * (i / samples);
    const p = trackCurve.getPointAt(t);
    const tan = trackCurve.getTangentAt(t);
    const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const x = p.x + n.x * offset * side;
    const z = p.z + n.z * offset * side;
    const top = p.y + deckTop;
    deckPts.push(new THREE.Vector3(x, top - 0.5, z));
    trainPts.push(new THREE.Vector3(x, top + 1.55, z));
  }

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x767b83,
    roughness: 0.88,
    metalness: 0.08,
  });
  const parapetMat = new THREE.MeshStandardMaterial({
    color: 0x5d626a,
    roughness: 0.9,
    metalness: 0.05,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x2c3038,
    roughness: 0.45,
    metalness: 0.85,
  });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x646972,
    roughness: 0.92,
    metalness: 0.05,
  });

  const dummy = new THREE.Object3D();

  // --- deck, parapets and rails (three instanced draws) -------------
  const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(5.4, 1.0, 1), concreteMat, samples);
  const parapets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.95, 1), parapetMat, samples * 2);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.14, 1), railMat, samples * 2);
  deck.castShadow = true;
  deck.receiveShadow = true;
  parapets.castShadow = false;
  deck.name = 'TokyoRailwayDeck';

  let pi = 0;
  let ri = 0;
  for (let i = 0; i < samples; i++) {
    const a = deckPts[i];
    const b = deckPts[i + 1];
    const mx = (a.x + b.x) * 0.5;
    const mz = (a.z + b.z) * 0.5;
    const my = (a.y + b.y) * 0.5;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) + 0.3;
    const yaw = Math.atan2(dx, dz);
    const nx = Math.cos(yaw);
    const nz = -Math.sin(yaw);

    dummy.position.set(mx, my, mz);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, len);
    dummy.updateMatrix();
    deck.setMatrixAt(i, dummy.matrix);

    for (const lateral of [-2.72, 2.72]) {
      dummy.position.set(mx + nx * lateral, my + 0.95, mz + nz * lateral);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, len);
      dummy.updateMatrix();
      parapets.setMatrixAt(pi++, dummy.matrix);
    }
    for (const lateral of [-1.35, 1.35]) {
      dummy.position.set(mx + nx * lateral, my + 0.57, mz + nz * lateral);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, len);
      dummy.updateMatrix();
      rails.setMatrixAt(ri++, dummy.matrix);
    }
  }
  deck.instanceMatrix.needsUpdate = true;
  parapets.instanceMatrix.needsUpdate = true;
  rails.instanceMatrix.needsUpdate = true;
  group.add(deck, parapets, rails);

  // --- pillars -------------------------------------------------------
  const pillarCount = Math.floor(samples / 3) + 1;
  const pillars = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1.05, 1.35, 1, 8),
    pillarMat,
    pillarCount,
  );
  pillars.castShadow = true;
  pillars.receiveShadow = true;
  let pj = 0;
  for (let i = 0; i <= samples; i += 3) {
    const p = deckPts[i];
    const ground = getGradedTerrainHeight(p.x, p.z, 'tokyo', noise, trackCurve);
    const h = Math.max(2, (p.y - 0.5) - ground);
    dummy.position.set(p.x, ground + h / 2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    pillars.setMatrixAt(pj++, dummy.matrix);
  }
  pillars.count = pj;
  pillars.instanceMatrix.needsUpdate = true;
  group.add(pillars);

  // --- catenary masts ------------------------------------------------
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x454a52, roughness: 0.6, metalness: 0.7 });
  for (let i = 4; i < samples; i += 7) {
    const p = deckPts[i];
    const next = deckPts[Math.min(i + 1, samples)];
    const yaw = Math.atan2(next.x - p.x, next.z - p.z);
    const nx = Math.cos(yaw);
    const nz = -Math.sin(yaw);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.16, 6.6, 0.16), mastMat);
    mast.position.set(p.x + nx * 3.1, p.y + 3.2, p.z + nz * 3.1);
    group.add(mast);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.12, 0.12), mastMat);
    arm.position.set(p.x + nx * 0.05, p.y + 6.35, p.z + nz * 0.05);
    arm.rotation.y = yaw + Math.PI / 2;
    group.add(arm);
  }

  // --- the train -----------------------------------------------------
  const trainCurve = new THREE.CatmullRomCurve3(trainPts, false, 'catmullrom', 0.5);
  const trainLength = trainCurve.getLength();
  const carLength = 18.6;
  const carGap = 1.1;
  const carStep = (carLength + carGap) / trainLength;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xd7dde6,
    roughness: 0.36,
    metalness: 0.55,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0xaeb6c1,
    roughness: 0.5,
    metalness: 0.6,
  });
  const underMat = new THREE.MeshStandardMaterial({
    color: 0x22262d,
    roughness: 0.7,
    metalness: 0.4,
  });
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0x3bd6a0, toneMapped: false });
  stripeMat.color.setScalar(1.35);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, toneMapped: false });
  headMat.color.setScalar(2.4);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });
  tailMat.color.setScalar(2.0);

  const bodyGeo = new THREE.BoxGeometry(2.9, 2.75, carLength);
  const roofGeo = new THREE.BoxGeometry(2.55, 0.34, carLength - 0.35);
  const underGeo = new THREE.BoxGeometry(2.55, 0.55, carLength - 1.4);
  const bogieGeo = new THREE.BoxGeometry(1.9, 0.55, 2.4);
  const windowGeo = new THREE.PlaneGeometry(carLength - 1.5, 1.15);
  const stripeGeo = new THREE.PlaneGeometry(carLength - 1.5, 0.2);
  const lampGeo = new THREE.BoxGeometry(0.42, 0.24, 0.1);

  const windowsMat = new THREE.MeshBasicMaterial({
    map: makeTrainWindowTexture(),
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const cars = [];
  for (let i = 0; i < 6; i++) {
    const car = new THREE.Group();
    car.name = `TokyoRailwayCar${i}`;

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0;
    body.castShadow = true;
    body.receiveShadow = true;
    car.add(body);

    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 1.5;
    car.add(roof);

    const under = new THREE.Mesh(underGeo, underMat);
    under.position.y = -1.55;
    car.add(under);

    for (const z of [-carLength * 0.31, carLength * 0.31]) {
      const bogie = new THREE.Mesh(bogieGeo, underMat);
      bogie.position.set(0, -1.75, z);
      bogie.castShadow = true;
      car.add(bogie);
    }

    for (const s of [-1, 1]) {
      const windows = new THREE.Mesh(windowGeo, windowsMat);
      windows.position.set(s * 1.47, 0.38, 0);
      windows.rotation.y = s * Math.PI / 2;
      car.add(windows);

      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(s * 1.472, -0.58, 0);
      stripe.rotation.y = s * Math.PI / 2;
      car.add(stripe);
    }

    for (const x of [-0.82, 0.82]) {
      const head = new THREE.Mesh(lampGeo, headMat);
      head.position.set(x, -0.55, carLength * 0.5 + 0.06);
      car.add(head);
      const tail = new THREE.Mesh(lampGeo, tailMat);
      tail.position.set(x, -0.62, -carLength * 0.5 - 0.06);
      car.add(tail);
    }

    // A folded pantograph on the leading car, just enough to read at speed.
    if (i === 0) {
      const armMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.8 });
      const armA = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.7, 0.09), armMat);
      armA.position.set(0, 2.5, -2.2);
      armA.rotation.x = 0.55;
      car.add(armA);
      const armB = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.4, 0.09), armMat);
      armB.position.set(0, 3.35, -1.25);
      armB.rotation.x = -0.7;
      car.add(armB);
    }

    car.frustumCulled = false;
    car.visible = false;
    cars.push(car);
    group.add(car);
  }

  const clock = new THREE.Clock();
  const passSeconds = 34;
  const gapSeconds = 9;
  const cycleSeconds = passSeconds + gapSeconds;

  function updateTrain() {
    const cycle = clock.getElapsedTime() % cycleSeconds;
    const u = cycle < passSeconds ? (cycle / passSeconds) * 1.2 - 0.1 : -2;
    for (let i = 0; i < cars.length; i++) {
      const cu = u - i * carStep;
      const on = cu >= 0 && cu <= 1;
      cars[i].visible = on;
      if (!on) continue;
      const p = trainCurve.getPointAt(cu);
      const tan = trainCurve.getTangentAt(cu);
      cars[i].position.copy(p);
      cars[i].rotation.set(0, Math.atan2(tan.x, tan.z), 0);
    }
    group.updateMatrixWorld(true);
  }

  // The first deck section is the ticker: it is rendered whenever the
  // viaduct is on screen, which is exactly when the train can be seen.
  deck.onBeforeRender = updateTrain;
  updateTrain();
}

function makeTrainWindowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0e15';
  ctx.fillRect(0, 0, 256, 64);

  for (let i = 0; i < 8; i++) {
    const x = 8 + i * 31;
    const warm = i % 4 === 0;
    ctx.fillStyle = warm ? '#ffe7ba' : '#d4e8ff';
    ctx.fillRect(x, 14, 21, 32);
    ctx.fillStyle = 'rgba(4, 7, 12, 0.55)';
    ctx.fillRect(x + 10, 14, 1.5, 32);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  tex.needsUpdate = true;
  return tex;
}

function seededRandom(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
