import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import {
  getPaintMaterial, getChromeMaterial, getCarbonMaterial, getTireMaterial,
  getRimMaterial, getMetalMaterial, getDarkMetalMaterial, getPlasticMaterial,
  getLightBeamMaterial,
} from './materials.js';

/**
 * car.js — the hero asset.
 *
 * A drop-in replacement for the original `js/car.js`: same exports, same
 * `userData` contract, so `main.js`, `ai.js` and `configurator.js` keep working
 * untouched. Underneath it is a proper sculpted car rather than extruded
 * silhouettes:
 *
 *   • the body is a **lofted hull** — fourteen superelliptical cross-sections
 *     swept into one smooth shell, so it has real shoulder lines, a waist and a
 *     tapered nose instead of flat extruded sides;
 *   • the greenhouse is a second loft in tinted glass, with painted A/B/C
 *     pillars and a roof panel, so the cockpit reads as a canopy;
 *   • a full interior (two buckets, wheel, dash, console, cage) sits inside it,
 *     visible through the glass;
 *   • separate sculpted front fenders and rear haunches bulge past the hull, with
 *     side intakes, NACA ducts, hood vents, canards, a multi-element rear wing
 *     and a straked diffuser;
 *   • wheels are built spoke-by-spoke per `WHEEL_STYLES`, with a tyre shoulder,
 *     a barrel, a vented disc and a caliper.
 *
 * Everything is procedural and merged per material, so a fully-detailed car is a
 * couple of dozen draw calls.
 *
 * ── contract kept from the original ─────────────────────────────────────────
 *   car.userData.wheels      → 4 groups, `.userData.steering` on the fronts
 *   car.userData.parts       → body, cabin, spoiler?, headlights, headlightBeams,
 *                              taillights, underglow
 *   car.userData.mats        → headlightMat, taillightMat
 *   car.userData.materials   → paintMat, chromeMat, glassMat, tireMat, rimMat,
 *                              carbonMat
 *   car.userData.config      → { paintColor, wheelStyle, spoilerType, rimColor,
 *                              windowTint }
 *   car.userData.nitro       → { active, timer, cooldown }
 *
 * `config.detail` ('low' | 'medium' | 'high', default 'high') trims the interior,
 * cage, decals and ring resolution so AI fields stay cheap.
 */

/* ================================================================== data ==== */

export const CAR_PAINT_COLORS = [
  { name: 'Rosso Corsa', color: 0xcc0000 },
  { name: 'Midnight Blue', color: 0x003366 },
  { name: 'Pearl White', color: 0xf5f5f5 },
  { name: 'Stealth Black', color: 0x111111 },
  { name: 'Racing Green', color: 0x004422 },
  { name: 'Sunset Orange', color: 0xff6600 },
  { name: 'Electric Yellow', color: 0xffcc00 },
  { name: 'Gunmetal Grey', color: 0x444444 },
  { name: 'Royal Purple', color: 0x6600cc },
  { name: 'Silver Arrow', color: 0xc0c0c0 },
];

export const WHEEL_STYLES = [
  { name: 'Sport 5-Spoke', spokes: 5 },
  { name: 'Racing Mesh', spokes: 10 },
  { name: 'Turbine', spokes: 7 },
  { name: 'Classic Split', spokes: 6 },
  { name: 'GT Blade', spokes: 3 },
];

export const SPOILER_TYPES = [
  { name: 'None', height: 0 },
  { name: 'Lip', height: 0.05 },
  { name: 'Ducktail', height: 0.12 },
  { name: 'GT Wing', height: 0.25 },
  { name: 'Time Attack', height: 0.35 },
];

/** Race-number roundels and sponsor wordmarks, drawn onto transparent planes. */
const LIVERIES = [
  { number: '07', accent: 0xffffff, word: 'VELOCE' },
  { number: '23', accent: 0xffd400, word: 'APEX' },
  { number: '44', accent: 0x00d0ff, word: 'NEXUS' },
  { number: '99', accent: 0xff2e88, word: 'KATANA' },
  { number: '11', accent: 0x9dff00, word: 'VOLT' },
  { number: '55', accent: 0xff6a00, word: 'TITAN' },
];

/* ============================================================== textures ==== */

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTexture(canvas, { repeat = 1, srgb = true, wrap = THREE.RepeatWrapping } = {}) {
  if (!canvas) return null;
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = wrap;
  if (Array.isArray(repeat)) t.repeat.set(repeat[0], repeat[1]);
  else t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Tyre tread: blocks + longitudinal grooves, as a normal map. */
function tyreNormalTexture() {
  const s = 256;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, s, s);
  const rnd = (() => { let x = 11; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  // grooves run around the tyre (horizontal bands)
  let y = 0;
  while (y < s) {
    const h = 10 + rnd() * 8;
    ctx.fillStyle = `rgba(${70 + rnd() * 40},128,255,0.85)`;
    ctx.fillRect(0, y, s, h * 0.5);
    y += h;
  }
  // sipe blocks
  for (let i = 0; i < 260; i++) {
    const bx = rnd() * s;
    const by = rnd() * s;
    ctx.fillStyle = `rgba(${190 + rnd() * 50},128,${200 + rnd() * 40},0.7)`;
    ctx.fillRect(bx, by, 3 + rnd() * 5, 2 + rnd() * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 1);
  tex.needsUpdate = true;
  return tex;
}

/** Drilled brake disc face. */
function discFaceTexture() {
  const s = 128;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(120,120,124)';
  ctx.fillRect(0, 0, s, s);
  const rnd = (() => { let x = 23; return () => (x = (x * 48271) % 2147483647) / 2147483647; })();
  // drilled holes in concentric rings
  for (const ring of [0.42, 0.6, 0.78]) {
    const n = Math.round(ring * 22);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = s / 2 + Math.cos(a) * s * 0.5 * ring;
      const y = s / 2 + Math.sin(a) * s * 0.5 * ring;
      ctx.fillStyle = 'rgba(40,40,44,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // heat-sheen
  ctx.strokeStyle = 'rgba(150,120,190,0.25)';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 8 + rnd() * (s * 0.44), 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvasTexture(c, { wrap: THREE.ClampToEdgeWrapping });
}

/** Livery panel: transparent, with a number roundel + sponsor wordmark. */
function liveryTexture(livery, accentHex) {
  const w = 256, h = 256;
  const c = makeCanvas(w, h);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // accent slash behind the number
  ctx.fillStyle = `rgba(${(accentHex >> 16) & 255},${(accentHex >> 8) & 255},${accentHex & 255},0.92)`;
  ctx.beginPath();
  ctx.moveTo(w * 0.06, h * 0.62);
  ctx.lineTo(w * 0.5, h * 0.16);
  ctx.lineTo(w * 0.78, h * 0.16);
  ctx.lineTo(w * 0.34, h * 0.62);
  ctx.closePath();
  ctx.fill();

  // number
  ctx.fillStyle = '#111111';
  ctx.font = `bold ${Math.round(h * 0.46)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(livery.number, w * 0.46, h * 0.4);

  // wordmark
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = `bold ${Math.round(h * 0.13)}px sans-serif`;
  ctx.letterSpacing = '3px';
  ctx.fillText(livery.word, w * 0.5, h * 0.8);

  return canvasTexture(c, { repeat: 1, wrap: THREE.ClampToEdgeWrapping });
}

/** A vent/louvre grille, transparent so it reads as holes over dark backing. */
function louvreTexture() {
  const s = 128;
  const c = makeCanvas(s, s);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(8,8,10,0.92)';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(120,126,136,0.85)';
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(0, i * (s / 9) + 1, s, s / 9 * 0.42);
  }
  return canvasTexture(c, { repeat: [3, 1] });
}

/** Headlight lens with projector rings + a DRL bar. */
function headlightTexture() {
  const w = 256, h = 128;
  const c = makeCanvas(w, h);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.98)');
  g.addColorStop(1, 'rgba(190,205,230,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // two projector lenses
  for (const cx of [w * 0.32, w * 0.68]) {
    const rg = ctx.createRadialGradient(cx, h * 0.5, 2, cx, h * 0.5, h * 0.36);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.5, 'rgba(150,190,255,0.6)');
    rg.addColorStop(0.85, 'rgba(60,80,120,0.5)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, h * 0.5, h * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(c, { repeat: 1, wrap: THREE.ClampToEdgeWrapping });
}

/* ================================================================ hull ====== */

/**
 * One cross-section of the hull: a superellipse of half-width `w/2` spanning
 * `y0`..`y1`. `power` controls squareness (2 = ellipse, 4+ = rounded box).
 */
function sectionPoints({ w, y0, y1, power = 3.4 }, segments) {
  const pts = [];
  const halfW = w * 0.5;
  const yc = (y0 + y1) * 0.5;
  const halfH = (y1 - y0) * 0.5;
  const e = 2 / power;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const x = halfW * Math.sign(ct) * Math.abs(ct) ** e;
    const y = yc + halfH * Math.sign(st) * Math.abs(st) ** e;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Loft a list of `{ z, w, y0, y1, power }` sections into one closed shell.
 * Returns a non-indexed-with-index BufferGeometry with smooth normals.
 */
function loftHull(sections, segments) {
  const rings = sections.map((s) => sectionPoints(s, segments));
  const verts = [];
  const idx = [];
  const n = segments;

  for (let s = 0; s < sections.length; s++) {
    const z = sections[s].z;
    for (let i = 0; i < n; i++) {
      verts.push(rings[s][i][0], rings[s][i][1], z);
    }
  }
  for (let s = 0; s < sections.length - 1; s++) {
    const a = s * n;
    const b = (s + 1) * n;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      idx.push(a + i, b + i, b + i2);
      idx.push(a + i, b + i2, a + i2);
    }
  }
  // caps
  const capStart = verts.length / 3;
  const first = sections[0];
  const last = sections[sections.length - 1];
  verts.push(0, (first.y0 + first.y1) * 0.5, first.z);
  verts.push(0, (last.y0 + last.y1) * 0.5, last.z);
  const cA = capStart;
  const cB = capStart + 1;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    idx.push(cA, i2, i);
    const base = (sections.length - 1) * n;
    idx.push(cB, base + i, base + i2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Merge a list of already-transformed geometries, dropping failures. */
function merge(parts) {
  const list = parts.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  try {
    return mergeGeometries(list, false);
  } catch (err) {
    return list[0];
  }
}

/** Quick transformed-box helper. */
function boxG(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function cylG(rTop, rBot, h, radial, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, radial, 1, false);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/* =============================================================== wheels ===== */

/**
 * Build one wheel. All spinning geometry is pre-oriented so the axle is X, which
 * is what `main.js`/`ai.js` drive: they write `child.rotation.x` on every direct
 * child of the wheel group.
 *
 * Returns `{ spinGeo, discGeo, caliperGeo }` (spokes/barrel, disc, caliper).
 */
function buildWheelGeometry(style, detail) {
  const segments = detail === 'low' ? 12 : detail === 'medium' ? 18 : 24;
  const R = 0.35;           // tyre outer radius
  const tube = 0.085;       // tyre section
  const rimR = R - tube - 0.01;
  const barrelHalf = 0.115; // half the wheel width

  const tyreParts = [];
  const rimParts = [];
  const discParts = [];
  const caliperParts = [];

  // --- tyre: a torus (axle along X) + shoulder walls ------------------------
  const tyre = new THREE.TorusGeometry(R - tube, tube, Math.max(8, segments / 2), segments);
  tyre.rotateY(Math.PI / 2);
  tyreParts.push(tyre);

  // shoulder rings give the sidewall a rounded profile
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.TorusGeometry(R - tube * 0.55, tube * 0.42, 8, segments);
    shoulder.rotateY(Math.PI / 2);
    shoulder.translate(sx * (barrelHalf - 0.005), 0, 0);
    tyreParts.push(shoulder);
  }

  // --- rim barrel -----------------------------------------------------------
  const barrel = new THREE.CylinderGeometry(rimR, rimR, barrelHalf * 2, segments, 1, true);
  barrel.rotateZ(Math.PI / 2);
  rimParts.push(barrel);

  // outer lip
  for (const sx of [-1, 1]) {
    const lip = new THREE.TorusGeometry(rimR, 0.022, 6, segments);
    lip.rotateY(Math.PI / 2);
    lip.translate(sx * barrelHalf, 0, 0);
    rimParts.push(lip);
  }

  // --- spokes ---------------------------------------------------------------
  const spokes = style.spokes || 5;
  const spokeFace = barrelHalf + 0.012;
  const styleName = style.name || '';
  const isBlade = styleName === 'GT Blade';
  const isMesh = styleName === 'Racing Mesh';
  const isTurbine = styleName === 'Turbine';
  const spokeLen = rimR - 0.06;

  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const axial = isBlade ? 0.07 : 0.05;                 // thickness along the axle
    const width = isBlade ? 0.12 : isMesh ? 0.028 : 0.055; // tangential width

    // built along +Z (radial), then laid into the wheel plane and swept round
    const g = new THREE.BoxGeometry(axial, width, spokeLen);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const pz = pos.getZ(v) + spokeLen * 0.5;           // 0 at the hub, spokeLen at the rim
      const k = 0.72 + 0.5 * Math.min(1, Math.max(0, pz / spokeLen));
      pos.setY(v, pos.getY(v) * k);
    }
    g.computeVertexNormals();
    if (isTurbine) g.rotateX(0.3);                        // blended blade twist
    g.translate(0, 0, spokeLen * 0.5 + 0.05);
    g.rotateX(-Math.PI / 2);                             // radius now runs along +Y
    g.rotateX(a);                                        // sweep around the axle
    g.translate(spokeFace, 0, 0);
    rimParts.push(g);

    if (isMesh) {
      const g2 = g.clone();
      g2.translate(-0.022, 0, 0);
      rimParts.push(g2);
    }
    if (styleName === 'Classic Split') {
      const g3 = g.clone();
      g3.rotateX(0.24);
      rimParts.push(g3);
    }
  }

  // hub + centre cap + lug nuts
  rimParts.push(cylG(0.062, 0.062, barrelHalf * 2.1, 12, 0, 0, 0, 0, 0, Math.PI / 2));
  rimParts.push(cylG(0.052, 0.052, 0.02, 12, barrelHalf * 1.12, 0, 0, 0, 0, Math.PI / 2));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    rimParts.push(cylG(0.012, 0.012, 0.03, 6, barrelHalf * 1.05, Math.sin(a) * 0.082, Math.cos(a) * 0.082, 0, 0, Math.PI / 2));
  }

  // --- brake disc (spins with the wheel, like the real thing) ---------------
  const dR = rimR - 0.075;
  discParts.push(cylG(dR, dR, 0.026, segments, -0.055, 0, 0, 0, 0, Math.PI / 2));
  discParts.push(cylG(dR * 0.45, dR * 0.45, 0.03, 12, -0.055, 0, 0, 0, 0, Math.PI / 2));

  // --- caliper (its own child, so it stays put when the wheel spins) --------
  caliperParts.push(boxG(0.05, 0.09, 0.15, -0.055, 0.15, 0.02));

  return {
    tyreGeo: merge(tyreParts),
    rimGeo: merge(rimParts),
    discGeo: merge(discParts),
    caliperGeo: merge(caliperParts),
  };
}

/* ============================================================ car builder === */

export function createCarModel(config = {}) {
  const {
    paintColor = 0xcc0000,
    wheelStyle = 0,
    spoilerType = 0,
    rimColor = 0xcccccc,
    windowTint = 0.3,
    detail = 'high',
    livery = null,
  } = config;

  const hi = detail === 'high';
  const mid = detail !== 'low';
  const segments = detail === 'low' ? 16 : detail === 'medium' ? 22 : 28;

  const car = new THREE.Group();
  car.name = 'Car';
  car.userData.wheels = [];
  car.userData.parts = {};

  /* ------------------------------------------------------------ materials -- */
  // Clone so `updateCarConfig` and the paint picker only ever touch this car.
  const paintMat = getPaintMaterial(paintColor).clone();
  const chromeMat = getChromeMaterial().clone();
  const carbonMat = getCarbonMaterial().clone();
  const tireMat = getTireMaterial().clone();
  const rimMat = getRimMaterial(rimColor).clone();
  const metalMat = getMetalMaterial(0xb9bec7, 0.3).clone();
  const darkMat = getDarkMetalMaterial().clone();
  const rubberMat = getPlasticMaterial(0x14161a, 0.92).clone();
  const plasticMat = getPlasticMaterial(0x1b1d22, 0.65).clone();

  if (tireMat.normalMap == null) {
    tireMat.normalMap = tyreNormalTexture();
    if (tireMat.normalMap) tireMat.normalScale = new THREE.Vector2(0.7, 0.7);
  }

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a0e14,
    roughness: 0.05,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.5 + windowTint * 0.35,
    envMapIntensity: 2.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const liveryDef = livery || LIVERIES[(wheelStyle * 3 + spoilerType) % LIVERIES.length];

  /* ---------------------------------------------------------------- hull --- */
  const bodySections = [
    { z: -2.30, w: 1.16, y0: 0.20, y1: 0.50, power: 2.8 },
    { z: -2.12, w: 1.78, y0: 0.12, y1: 0.80, power: 3.2 },
    { z: -1.86, w: 2.00, y0: 0.12, y1: 0.96, power: 3.4 },
    { z: -1.44, w: 2.08, y0: 0.12, y1: 1.00, power: 3.8 },
    { z: -0.92, w: 2.06, y0: 0.12, y1: 0.98, power: 3.8 },
    { z: -0.34, w: 2.00, y0: 0.12, y1: 0.92, power: 3.4 },
    { z: 0.30, w: 2.03, y0: 0.12, y1: 0.86, power: 3.4 },
    { z: 0.86, w: 2.08, y0: 0.12, y1: 0.80, power: 3.4 },
    { z: 1.34, w: 2.06, y0: 0.12, y1: 0.74, power: 3.4 },
    { z: 1.78, w: 1.92, y0: 0.12, y1: 0.66, power: 3.2 },
    { z: 2.12, w: 1.64, y0: 0.14, y1: 0.54, power: 3.0 },
    { z: 2.32, w: 1.10, y0: 0.20, y1: 0.42, power: 2.6 },
  ];
  const bodyGeo = loftHull(bodySections, segments);
  const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
  bodyMesh.name = 'CarBody';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  car.add(bodyMesh);
  car.userData.parts.body = bodyMesh;

  /* ------------------------------------------------------- fenders/haunches */
  // Front fenders: shallow domes over the wheels, bulging past the hull.
  const aeroFender = (() => {
    const parts = [];
    for (const sx of [-1, 1]) {
      const dome = new THREE.SphereGeometry(0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
      dome.scale(0.5, 0.55, 1.15);
      dome.translate(sx * 0.92, 0.62, 1.34);
      parts.push(dome);
      // haunch over the rear wheel
      const haunch = new THREE.SphereGeometry(0.68, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
      haunch.scale(0.48, 0.5, 1.2);
      haunch.translate(sx * 0.94, 0.66, -1.36);
      parts.push(haunch);
    }
    return merge(parts);
  })();
  if (aeroFender) {
    const m = new THREE.Mesh(aeroFender, paintMat);
    m.name = 'CarFenders';
    m.castShadow = true;
    car.add(m);
  }

  /* --------------------------------------------------------- side intakes -- */
  if (mid) {
    const louvre = louvreTexture();
    const intakeGeo = merge([
      boxG(0.06, 0.30, 0.86, -1.03, 0.55, -0.55),
      boxG(0.06, 0.30, 0.86, 1.03, 0.55, -0.55),
      boxG(0.05, 0.16, 0.2, -1.02, 0.62, 1.55),
      boxG(0.05, 0.16, 0.2, 1.02, 0.62, 1.55),
    ]);
    const intakeMat = louvre
      ? new THREE.MeshStandardMaterial({ map: louvre, color: 0x2a2d33, roughness: 0.6, metalness: 0.4 })
      : darkMat;
    const intake = new THREE.Mesh(intakeGeo, intakeMat);
    intake.name = 'CarIntakes';
    car.add(intake);
  }

  /* ------------------------------------------------------------ underbody -- */
  const underbody = new THREE.Mesh(
    merge([
      boxG(1.9, 0.10, 4.3, 0, 0.06, 0),
      boxG(0.06, 0.12, 2.4, -1.02, 0.18, 0),
      boxG(0.06, 0.12, 2.4, 1.02, 0.18, 0),
    ]),
    darkMat
  );
  underbody.name = 'CarUnderbody';
  car.add(underbody);

  /* ------------------------------------------------------------- splitter -- */
  const splitter = new THREE.Mesh(
    merge([
      boxG(0.34, 0.05, 1.9, -0.9, 0.10, 2.28),
      boxG(0.34, 0.05, 1.9, 0.9, 0.10, 2.28),
      boxG(1.94, 0.04, 1.0, 0, 0.08, 2.42),
    ]),
    carbonMat
  );
  splitter.name = 'CarSplitter';
  splitter.castShadow = true;
  car.add(splitter);

  // canards on the front corners
  if (mid) {
    const canards = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const g = boxG(0.30, 0.02, 0.22, sx * 1.0, 0.22 + i * 0.085, 2.0 - i * 0.06, 0, 0, sx * -0.13);
        canards.push(g);
      }
    }
    const cn = new THREE.Mesh(merge(canards), carbonMat);
    cn.name = 'CarCanards';
    car.add(cn);
  }

  /* ------------------------------------------------------------- diffuser -- */
  const diffParts = [
    boxG(1.9, 0.12, 0.95, 0, 0.14, -2.28, -0.18),
    boxG(1.94, 0.05, 1.05, 0, 0.30, -2.34, -0.18),
  ];
  for (let i = -2; i <= 2; i++) {
    const x = i * 0.34;
    diffParts.push(boxG(0.05, 0.26, 0.9, x, 0.17, -2.30, -0.18));
  }
  const diffuser = new THREE.Mesh(merge(diffParts), carbonMat);
  diffuser.name = 'CarDiffuser';
  car.add(diffuser);

  // side skirts with a leading scoop
  const skirts = [];
  for (const sx of [-1, 1]) {
    skirts.push(boxG(0.09, 0.10, 2.6, sx * 1.04, 0.14, 0));
    skirts.push(boxG(0.16, 0.06, 0.5, sx * 1.02, 0.13, 1.45, 0, 0, sx * 0.18));
  }
  const skirtMesh = new THREE.Mesh(merge(skirts), carbonMat);
  skirtMesh.name = 'CarSkirts';
  car.add(skirtMesh);

  /* ------------------------------------------------------------ hood vent -- */
  if (mid) {
    const vents = [];
    for (const sx of [-1, 1]) {
      vents.push(boxG(0.36, 0.05, 0.5, sx * 0.44, 0.80, 1.62, -0.16));
      vents.push(boxG(0.30, 0.04, 0.42, sx * 0.60, 0.70, 0.35, -0.12));
    }
    const ventMat = new THREE.MeshStandardMaterial({
      map: louvreTexture(), color: 0x22252b, roughness: 0.55, metalness: 0.5,
    });
    const v = new THREE.Mesh(merge(vents), ventMat);
    v.name = 'CarHoodVents';
    car.add(v);
  }

  /* --------------------------------------------------------------- grille -- */
  const grille = new THREE.Mesh(
    merge([
      boxG(1.0, 0.20, 0.07, 0, 0.34, 2.30),
      boxG(0.34, 0.16, 0.08, -0.66, 0.30, 2.26),
      boxG(0.34, 0.16, 0.08, 0.66, 0.30, 2.26),
    ]),
    new THREE.MeshStandardMaterial({
      map: louvreTexture(), color: 0x191b20, roughness: 0.5, metalness: 0.6,
    })
  );
  grille.name = 'CarGrille';
  car.add(grille);

  /* -------------------------------------------------------------- canopy --- */
  const canopySections = [
    { z: 0.52, w: 1.06, y0: 0.80, y1: 0.88, power: 2.2 },
    { z: 0.16, w: 1.22, y0: 0.82, y1: 1.14, power: 2.2 },
    { z: -0.28, w: 1.30, y0: 0.84, y1: 1.24, power: 2.4 },
    { z: -0.78, w: 1.30, y0: 0.84, y1: 1.24, power: 2.4 },
    { z: -1.14, w: 1.24, y0: 0.84, y1: 1.16, power: 2.2 },
    { z: -1.44, w: 1.06, y0: 0.82, y1: 0.94, power: 2.0 },
  ];
  const canopyGeo = loftHull(canopySections, Math.max(14, segments - 6));
  const cabinMesh = new THREE.Mesh(canopyGeo, glassMat);
  cabinMesh.name = 'CarCanopy';
  cabinMesh.castShadow = false;
  car.add(cabinMesh);
  car.userData.parts.cabin = cabinMesh;

  // painted roof panel + pillars sitting just proud of the glass
  const roofParts = [];
  const roofPanel = new THREE.SphereGeometry(0.9, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
  roofPanel.scale(0.62, 0.26, 0.78);
  roofPanel.translate(0, 1.20, -0.52);
  roofParts.push(roofPanel);
  for (const sx of [-1, 1]) {
    // A-pillar
    roofParts.push(boxG(0.09, 0.09, 0.62, sx * 0.58, 1.06, 0.30, -0.52, 0, 0));
    // C-pillar / flying buttress
    roofParts.push(boxG(0.11, 0.11, 0.5, sx * 0.56, 1.08, -1.24, 0.44, 0, 0));
  }
  const roofMesh = new THREE.Mesh(merge(roofParts), paintMat);
  roofMesh.name = 'CarRoof';
  roofMesh.castShadow = true;
  car.add(roofMesh);

  /* -------------------------------------------------------------- interior - */
  if (mid) {
    const cockpit = new THREE.Group();
    cockpit.name = 'CarCockpit';
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x18191d, roughness: 0.85, metalness: 0.05 });
    const dashMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.9, metalness: 0.02 });

    for (const sx of [-1, 1]) {
      const seatParts = [
        boxG(0.42, 0.12, 0.46, sx * 0.32, 0.78, -0.46),                 // base
        boxG(0.42, 0.52, 0.10, sx * 0.32, 1.02, -0.66, 0.12),           // back
        boxG(0.16, 0.20, 0.08, sx * 0.32, 1.24, -0.70, 0.12),           // headrest
        boxG(0.06, 0.22, 0.44, sx * 0.13, 0.92, -0.48),                 // bolster L/R
        boxG(0.06, 0.22, 0.44, sx * 0.51, 0.92, -0.48),
      ];
      const seat = new THREE.Mesh(merge(seatParts), seatMat);
      cockpit.add(seat);
    }

    // dashboard + centre console
    cockpit.add(new THREE.Mesh(
      merge([
        boxG(1.6, 0.22, 0.30, 0, 0.86, 0.34, -0.30),
        boxG(0.34, 0.30, 0.7, 0, 0.72, 0.05),
      ]),
      dashMat
    ));

    // steering wheel on a column
    const wheel = new THREE.Group();
    const rim = new THREE.TorusGeometry(0.14, 0.018, 8, 20);
    rim.rotateX(Math.PI * 0.32);
    wheel.add(new THREE.Mesh(rim, plasticMat));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      wheel.add(new THREE.Mesh(
        boxG(0.13, 0.02, 0.02, Math.sin(a) * 0.07, Math.cos(a) * 0.07, 0, 0, 0, -a),
        plasticMat
      ));
    }
    wheel.position.set(-0.32, 0.97, 0.24);
    wheel.rotation.x = -0.35;
    cockpit.add(wheel);
    car.userData.parts.steeringWheel = wheel;

    // gear lever + handbrake
    cockpit.add(new THREE.Mesh(cylG(0.02, 0.02, 0.22, 6, 0, 0.9, -0.06), plasticMat));

    // roll cage
    if (hi) {
      const cage = [];
      const tube = 0.028;
      for (const sx of [-1, 1]) {
        cage.push(cylG(tube, tube, 0.72, 8, sx * 0.56, 1.06, -1.02, 0, 0, sx * 0.16));   // main hoop
        cage.push(cylG(tube, tube, 0.9, 8, sx * 0.5, 1.02, 0.0, Math.PI * 0.42, 0, 0));  // A-pillar bar
        cage.push(cylG(tube, tube, 0.62, 8, sx * 0.52, 1.0, -1.05, 0, 0, Math.PI * 0.5)); // door bar
      }
      cage.push(cylG(tube, tube, 1.14, 8, 0, 1.34, -1.02, 0, 0, Math.PI * 0.5));          // top cross
      cage.push(cylG(tube, tube, 1.02, 8, 0, 1.26, -1.22, 0, 0, Math.PI * 0.5));
      const cageMesh = new THREE.Mesh(merge(cage), metalMat);
      cageMesh.name = 'CarCage';
      cockpit.add(cageMesh);
    }

    car.add(cockpit);
    car.userData.parts.cockpit = cockpit;
  }

  /* ---------------------------------------------------------------- wing --- */
  const spoilerInfo = SPOILER_TYPES[spoilerType] || SPOILER_TYPES[0];
  if (spoilerInfo.height > 0) {
    const wingGroup = new THREE.Group();
    wingGroup.name = 'CarWing';
    const chord = 0.34 + spoilerInfo.height * 0.5;
    const span = 1.9;

    // multi-element main plane (a thin airfoil-ish box with a tapered trailing edge)
    const planeGeo = new THREE.BoxGeometry(span, 0.045, chord, 8, 1, 2);
    const pp = planeGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const px = pp.getX(i);
      const pz = pp.getZ(i);
      // thinner at the tips (elliptical span loading, made visible)
      const k = 1 - Math.pow(Math.abs(px) / (span * 0.5), 3) * 0.55;
      pp.setX(i, px);
      pp.setY(i, pp.getY(i) * k);
      pp.setZ(i, pz);
    }
    planeGeo.computeVertexNormals();
    const plane = new THREE.Mesh(planeGeo, carbonMat);
    plane.castShadow = true;
    wingGroup.add(plane);

    // endplates
    for (const sx of [-1, 1]) {
      const ep = boxG(0.03, 0.30, chord * 1.05, sx * (span * 0.5 + 0.015), 0.06, 0);
      wingGroup.add(new THREE.Mesh(ep, paintMat));
    }

    // swan-neck mounts
    for (const sx of [-1, 1]) {
      const leg = boxG(0.05, spoilerInfo.height + 0.20, 0.10, sx * 0.68, -(spoilerInfo.height + 0.20) * 0.5, 0.02);
      wingGroup.add(new THREE.Mesh(leg, chromeMat));
    }

    // lower beam element
    const beam = new THREE.Mesh(boxG(span * 0.92, 0.03, chord * 0.5, 0, -0.11, 0.05), carbonMat);
    wingGroup.add(beam);

    wingGroup.position.set(0, 1.06 + spoilerInfo.height / 2, -2.02);
    wingGroup.rotation.x = 0.10 + spoilerInfo.height * 0.2;
    car.add(wingGroup);
    car.userData.parts.spoiler = wingGroup;
  }

  /* ----------------------------------------------------------- exhausts --- */
  const exhaustPositions = [
    { x: -0.55, y: 0.30, z: -2.30 },
    { x: -0.35, y: 0.30, z: -2.30 },
    { x: 0.35, y: 0.30, z: -2.30 },
    { x: 0.55, y: 0.30, z: -2.30 },
  ];
  const exhaustParts = [];
  const exhaustInnerParts = [];
  for (const pos of exhaustPositions) {
    exhaustParts.push(cylG(0.065, 0.08, 0.36, 14, pos.x, pos.y, pos.z, Math.PI / 2));
    exhaustInnerParts.push(cylG(0.05, 0.05, 0.37, 14, pos.x, pos.y, pos.z + 0.005, Math.PI / 2));
  }
  const exhaustMesh = new THREE.Mesh(merge(exhaustParts), chromeMat);
  exhaustMesh.name = 'CarExhaust';
  car.add(exhaustMesh);
  const exhaustInner = new THREE.Mesh(
    merge(exhaustInnerParts),
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.7, metalness: 0.3 })
  );
  car.add(exhaustInner);

  /* -------------------------------------------------------------- lights --- */
  // headlight clusters: housing + lens plane + DRL blade
  const headlightMat = new THREE.MeshStandardMaterial({
    map: headlightTexture(),
    color: 0xffffff,
    emissive: 0xffffe0,
    emissiveIntensity: 4.0,
    transparent: true,
    opacity: 0.96,
    toneMapped: false,
    roughness: 0.2,
    metalness: 0.1,
  });
  const headlights = [];
  for (const sx of [-1, 1]) {
    const lens = new THREE.PlaneGeometry(0.44, 0.17);
    lens.rotateY(sx * 0.22);
    lens.translate(sx * 0.66, 0.60, 2.28);
    const mesh = new THREE.Mesh(lens, headlightMat);
    mesh.name = 'CarHeadlight';
    car.add(mesh);
    headlights.push(mesh);
  }
  car.userData.parts.headlights = headlights;
  car.userData.mats = car.userData.mats || {};
  car.userData.mats.headlightMat = headlightMat;

  // DRL blades
  const drlMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xbfd8ff, emissiveIntensity: 3.2, toneMapped: false,
  });
  const drls = [];
  for (const sx of [-1, 1]) {
    const g = boxG(0.30, 0.035, 0.03, sx * 0.66, 0.50, 2.30, 0, 0, sx * -0.16);
    drls.push(g);
  }
  car.add(new THREE.Mesh(merge(drls), drlMat));

  // forward beams. Real SpotLights are expensive in the shader's light loop, so
  // only the hero car carries them — the field gets the glowing lenses plus a
  // cheap volumetric cone, which is all you can see from behind anyway.
  const beams = [];
  const coneLen = hi ? 26 : mid ? 16 : 11;
  for (const sx of [-1, 1]) {
    if (hi) {
      const spot = new THREE.SpotLight(0xfff2cf, 0, 70, Math.PI / 6.5, 0.55, 1.1);
      spot.position.set(sx * 0.62, 0.66, 2.20);
      spot.castShadow = false;
      const target = new THREE.Object3D();
      target.position.set(sx * 0.62, 0.1, 40);
      car.add(target);
      spot.target = target;
      car.add(spot);
      beams.push(spot);
    }

    const coneGeo = new THREE.ConeGeometry(Math.tan(Math.PI / 9) * coneLen, coneLen, 18, 1, true);
    coneGeo.translate(0, -coneLen / 2, 0);
    coneGeo.rotateX(-Math.PI / 2);
    const cone = new THREE.Mesh(coneGeo, getLightBeamMaterial());
    cone.name = 'CarHeadlightBeam';
    cone.position.set(sx * 0.62, 0.64, 2.28);
    cone.renderOrder = 2;
    car.add(cone);
  }
  car.userData.parts.headlightBeams = beams;

  // taillights: full-width LED bar + two clusters
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xff1a1a,
    emissive: 0xff0a0a,
    emissiveIntensity: 2.5,
    transparent: true,
    opacity: 0.92,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const taillights = [];
  for (const sx of [-1, 1]) {
    const g = merge([
      boxG(0.40, 0.13, 0.05, sx * 0.66, 0.66, -2.30),
      boxG(0.34, 0.06, 0.05, sx * 0.63, 0.55, -2.30),
    ]);
    const mesh = new THREE.Mesh(g, taillightMat);
    mesh.name = 'CarTaillight';
    car.add(mesh);
    taillights.push(mesh);
  }
  car.userData.parts.taillights = taillights;
  car.userData.mats.taillightMat = taillightMat;

  // connecting LED strip + centre element
  const strip = new THREE.Mesh(
    merge([
      boxG(0.86, 0.035, 0.03, 0, 0.66, -2.32),
      boxG(0.10, 0.10, 0.04, 0, 0.52, -2.33),
    ]),
    taillightMat
  );
  strip.name = 'CarTailStrip';
  car.add(strip);

  // rain light (F1-style) under the diffuser
  const rainLight = new THREE.Mesh(
    boxG(0.12, 0.07, 0.03, 0, 0.30, -2.42),
    new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 1.4, toneMapped: false })
  );
  car.add(rainLight);
  car.userData.parts.rainLight = rainLight;

  /* ------------------------------------------------------------- mirrors --- */
  const mirrors = [];
  const mirrorMat = paintMat;
  for (const sx of [-1, 1]) {
    const pod = new THREE.SphereGeometry(0.09, 10, 8);
    pod.scale(1.5, 0.75, 0.9);
    pod.translate(sx * 0.98, 0.86, 0.30);
    mirrors.push(pod);
    mirrors.push(cylG(0.012, 0.012, 0.16, 6, sx * 0.88, 0.86, 0.30, 0, 0, Math.PI / 2));
  }
  car.add(new THREE.Mesh(merge(mirrors), mirrorMat));

  /* ------------------------------------------------------------ wipers ---- */
  if (mid) {
    const wipers = [];
    for (const sx of [-1, 1]) {
      wipers.push(boxG(0.42, 0.014, 0.02, sx * 0.28, 0.885, 0.62, 0, 0, sx * 0.22));
    }
    car.add(new THREE.Mesh(merge(wipers), plasticMat));
  }

  /* ------------------------------------------------------------ livery ---- */
  if (mid) {
    const liveryTex = liveryTexture(liveryDef, liveryDef.accent);
    if (liveryTex) {
      const liveryMat = new THREE.MeshStandardMaterial({
        map: liveryTex, transparent: true, roughness: 0.4, metalness: 0.15,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const panel = new THREE.PlaneGeometry(0.95, 0.95);
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(panel, liveryMat);
        p.position.set(sx * 1.045, 0.52, 0.20);
        p.rotation.y = sx * Math.PI * 0.5;
        p.name = 'CarLivery';
        car.add(p);
      }
      // bonnet stripe
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.5), new THREE.MeshStandardMaterial({
        map: liveryTex, transparent: true, roughness: 0.4, metalness: 0.15,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      }));
      stripe.rotation.x = -Math.PI * 0.5;
      stripe.position.set(0, 0.815, 1.05);
      car.add(stripe);
    }
  }

  /* -------------------------------------------------------------- wheels --- */
  const wheelStyleInfo = WHEEL_STYLES[wheelStyle] || WHEEL_STYLES[0];
  const wheelPositions = [
    { x: -0.95, y: 0.35, z: 1.35, steering: true },
    { x: 0.95, y: 0.35, z: 1.35, steering: true },
    { x: -0.95, y: 0.35, z: -1.35, steering: false },
    { x: 0.95, y: 0.35, z: -1.35, steering: false },
  ];
  const wheelGeo = buildWheelGeometry(wheelStyleInfo, detail);
  rimMat.roughness = Math.min(rimMat.roughness, 0.26);
  rimMat.envMapIntensity = Math.max(rimMat.envMapIntensity || 1, 1.7);

  // brake discs get the drilled face texture
  const discMat = new THREE.MeshStandardMaterial({
    color: 0x8c8f96, roughness: 0.35, metalness: 0.95,
    map: discFaceTexture(), envMapIntensity: 1.4,
  });
  const caliperMat = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.5, roughness: 0.35 });

  wheelPositions.forEach((wPos, idx) => {
    const wheelGroup = new THREE.Group();
    wheelGroup.name = `Wheel${idx}`;

    // every direct child gets `rotation.x` written by the game loop, so each
    // one must be pre-oriented with its axle along X
    if (wheelGeo.tyreGeo) wheelGroup.add(new THREE.Mesh(wheelGeo.tyreGeo, tireMat));
    const rimMesh = wheelGeo.rimGeo ? new THREE.Mesh(wheelGeo.rimGeo, rimMat) : null;
    if (rimMesh) {
      // dish the rims: fronts sit slightly proud, rears slightly recessed
      rimMesh.position.x = wPos.steering ? -0.008 : 0.008;
      wheelGroup.add(rimMesh);
    }
    const discMesh = wheelGeo.discGeo ? new THREE.Mesh(wheelGeo.discGeo, discMat) : null;
    if (discMesh) wheelGroup.add(discMesh);
    const calMesh = wheelGeo.caliperGeo ? new THREE.Mesh(wheelGeo.caliperGeo, caliperMat) : null;
    if (calMesh) wheelGroup.add(calMesh);

    wheelGroup.position.set(wPos.x, wPos.y, wPos.z);
    wheelGroup.userData.steering = wPos.steering;
    wheelGroup.userData.brakeDisc = discMesh;
    wheelGroup.userData.caliper = calMesh;
    wheelGroup.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    car.add(wheelGroup);
    car.userData.wheels.push(wheelGroup);
  });

  /* ------------------------------------------------------------- underglow - */
  const underglow = new THREE.PointLight(paintColor, 0.5, 4.2, 2);
  underglow.position.set(0, 0.06, 0);
  car.add(underglow);
  car.userData.parts.underglow = underglow;

  /* ---------------------------------------------------------------- state - */
  car.userData.config = { paintColor, wheelStyle, spoilerType, rimColor, windowTint, detail };
  car.userData.materials = { paintMat, chromeMat, glassMat, tireMat, rimMat, carbonMat };
  car.userData.livery = liveryDef;
  car.userData.nitro = { active: false, timer: 0, cooldown: 0 };
  car.userData.detail = detail;

  // keep the shadow frustum tight around the car
  car.traverse((o) => {
    if (o.isMesh && o.castShadow) o.frustumCulled = true;
  });

  return car;
}

/* ============================================================ car config === */

/**
 * Apply a configuration change in place. Kept API-compatible with the original:
 * it only handles paint, rims and window tint (wheel/spoiler swaps need a
 * rebuild, which the configurator does by recreating the model).
 */
export function updateCarConfig(car, newConfig = {}) {
  const { paintColor, rimColor, windowTint, livery } = newConfig;
  const mats = car.userData.materials;
  const parts = car.userData.parts;
  if (!mats) return car;

  if (paintColor !== undefined) {
    mats.paintMat.color.setHex(paintColor);
    if (mats.paintMat.emissive) mats.paintMat.emissive.setHex(paintColor).multiplyScalar(0.02);
    if (parts.underglow) parts.underglow.color.setHex(paintColor);
  }

  if (rimColor !== undefined) {
    mats.rimMat.color.setHex(rimColor);
  }

  if (windowTint !== undefined) {
    mats.glassMat.opacity = 0.5 + windowTint * 0.35;
  }

  if (livery !== undefined) car.userData.livery = livery;

  car.userData.config = { ...car.userData.config, ...newConfig };
  return car;
}

/* ====================================================== configurator car === */

/**
 * The showroom car: fully detailed, extra glossy, parked with the steering
 * straight so the configurator turntable reads well.
 */
export function createConfiguratorCar() {
  const car = createCarModel({
    paintColor: 0xcc0000,
    wheelStyle: 0,
    spoilerType: 3,
    rimColor: 0xcccccc,
    windowTint: 0.3,
    detail: 'high',
    livery: LIVERIES[0],
  });
  car.position.y = 0;
  if (car.userData.materials.paintMat) {
    car.userData.materials.paintMat.envMapIntensity = 1.8;
  }
  return car;
}

export const CAR_LIVERIES = LIVERIES;
export default {
  createCarModel,
  updateCarConfig,
  createConfiguratorCar,
  CAR_PAINT_COLORS,
  WHEEL_STYLES,
  SPOILER_TYPES,
};
