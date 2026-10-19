import * as THREE from 'three';

/* ==================================================================
 * materials.js
 * Procedural "Substance-style" PBR authoring for the browser.
 * Everything here is generated on a canvas at load time: asphalt
 * with wet puddles, metallic car-paint flakes, blossom sprites and
 * SpeedTree-style wind sway injected into standard materials.
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * Wind animation
 * One shared uniform is read by every foliage material so all leaves,
 * grass and petals sway from the same clock (like a SpeedTree wind
 * system). Call updateWindTime(dt) once per frame.
 * ------------------------------------------------------------------ */
export const windTime = { value: 0 };

export function updateWindTime(dt) {
  windTime.value += dt;
}

export function applyWindSway(material, strength = 1.0, key = 'foliage') {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uWindStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uWindTime;
         uniform float uWindStrength;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           vec4 windWorld = vec4( transformed, 1.0 );
           #ifdef USE_INSTANCING
             windWorld = instanceMatrix * windWorld;
           #endif
           float wPhase = windWorld.x * 0.14 + windWorld.z * 0.18;
           float wSway  = sin( uWindTime * 1.5 + wPhase ) * 0.6
                        + sin( uWindTime * 2.6 + wPhase * 1.7 ) * 0.28;
           float wMask  = max( transformed.y, 0.0 );
           transformed.x += wSway * uWindStrength * wMask * 0.16;
           transformed.z += wSway * uWindStrength * wMask * 0.08;
         }`
      );
  };
  material.customProgramCacheKey = () => `wind_${key}_${strength}`;
  material.needsUpdate = true;
  return material;
}

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CACHE = new Map();
function cached(key, factory) {
  if (!CACHE.has(key)) CACHE.set(key, factory());
  return CACHE.get(key);
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Build a seamless-ish grayscale height canvas. */
function heightCanvas(size, seed) {
  const rnd = mulberry32(seed);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < size * 26; i++) {
    const g = Math.floor(70 + rnd() * 116);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    const s = 0.6 + rnd() * 2.2;
    ctx.fillRect(rnd() * size, rnd() * size, s, s);
  }
  for (let i = 0; i < 90; i++) {
    const g = Math.floor(96 + rnd() * 64);
    ctx.fillStyle = `rgba(${g},${g},${g},0.35)`;
    const w = 6 + rnd() * 40;
    const h = 4 + rnd() * 26;
    ctx.fillRect(rnd() * size, rnd() * size, w, h);
  }
  return c;
}

/** Sobel-derive a tangent-space normal map from a grayscale canvas. */
function normalMapCanvas(srcCanvas, strength = 2.0) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const src = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;

  const out = makeCanvas(w);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);

  const at = (x, y) => {
    const xx = ((x % w) + w) % w;
    const yy = ((y % h) + h) % h;
    const i = (yy * w + xx) * 4;
    return (src[i] + src[i + 1] + src[i + 2]) / 765;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function texFromCanvas(canvas, { repeat = 1, srgb = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ *
 * Wet asphalt  (the "Lumen wet road" cheat)
 * albedo  = dark aggregate
 * roughness = mostly rough, but puddle blobs drop to ~0 so the sky
 *             environment map mirrors off them like standing water.
 * ------------------------------------------------------------------ */
export function getAsphaltMaps() {
  return cached('asphalt', () => {
    const S = 512;
    const rnd = mulberry32(7331);

    // --- albedo -------------------------------------------------
    const albedo = makeCanvas(S);
    {
      const ctx = albedo.getContext('2d');
      ctx.fillStyle = '#141519';
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 24000; i++) {
        const g = 22 + Math.floor(rnd() * 40);
        ctx.fillStyle = `rgba(${g},${g + 2},${g + 5},${0.2 + rnd() * 0.5})`;
        ctx.fillRect(rnd() * S, rnd() * S, 0.6 + rnd() * 1.8, 0.6 + rnd() * 1.8);
      }
      // faint tyre-polished lanes
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.012 + rnd() * 0.02})`;
        ctx.fillRect(rnd() * S, 0, 40 + rnd() * 90, S);
      }
    }

    // --- roughness (dark = wet/smooth) ---------------------------
    const rough = makeCanvas(S);
    {
      const ctx = rough.getContext('2d');
      ctx.fillStyle = '#e2e2e2';
      ctx.fillRect(0, 0, S, S);
      for (let i = 0; i < 30; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 22 + rnd() * 84;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(6,6,6,0.96)');
        g.addColorStop(0.55, 'rgba(38,38,38,0.72)');
        g.addColorStop(1, 'rgba(226,226,226,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 8000; i++) {
        const g = 150 + Math.floor(rnd() * 100);
        ctx.fillStyle = `rgba(${g},${g},${g},0.22)`;
        ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
      }
    }

    const normal = normalMapCanvas(heightCanvas(256, 4242), 1.5);

    const map = texFromCanvas(albedo, { repeat: 6, srgb: true });
    const roughnessMap = texFromCanvas(rough, { repeat: 3 });
    const normalMap = texFromCanvas(normal, { repeat: 5 });
    // The tarmac is viewed at a very grazing angle most of the time. Without
    // anisotropic filtering the 512px maps smear into big blobs and the road
    // reads as cobblestones instead of asphalt.
    for (const t of [map, roughnessMap, normalMap]) t.anisotropy = 8;

    return { map, roughnessMap, normalMap };
  });
}

/* ------------------------------------------------------------------ *
 * Road materials
 * ------------------------------------------------------------------ */
const roadMaterials = {};

export function getRoadMaterial(theme = 'alpine') {
  if (roadMaterials[theme]) return roadMaterials[theme];

  const maps = getAsphaltMaps();
  const presets = {
    city: { color: 0x1b1d22, metalness: 0.55, envMapIntensity: 1.9 },
    // Tokyo: soaked tarmac that mirrors the neon signage. High metalness +
    // strongest env reflection of any theme so the puddle roughness map
    // turns the road into a wet mirror of the skyline.
    tokyo: { color: 0x121419, metalness: 0.66, envMapIntensity: 2.35 },
    alpine: { color: 0x2a2c31, metalness: 0.38, envMapIntensity: 1.4 },
    forest: { color: 0x24262a, metalness: 0.35, envMapIntensity: 1.3 },
    desert: { color: 0x4a3f31, metalness: 0.18, envMapIntensity: 0.9 },
    coastal: { color: 0x2c2e33, metalness: 0.42, envMapIntensity: 1.5 },
    countryside: { color: 0x303236, metalness: 0.34, envMapIntensity: 1.3 },
  };
  const p = presets[theme] || presets.alpine;

  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    map: maps.map,
    roughnessMap: maps.roughnessMap,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 1.0,
    metalness: p.metalness,
    envMapIntensity: p.envMapIntensity,
    // The lane markings, grid boxes and start line are coplanar with the
    // tarmac. Push the road a hair away from the camera so those details win
    // the depth test instead of z-fighting.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  roadMaterials[theme] = mat;
  return mat;
}

export function getRoadLineMaterial() {
  return cached('roadline', () => new THREE.MeshStandardMaterial({
    color: 0xf2f2f2,
    roughness: 0.45,
    metalness: 0.1,
    emissive: 0x222222,
    envMapIntensity: 1.2,
  }));
}

export function getCurbMaterial(theme = 'alpine') {
  return cached(`curb_${theme}`, () => {
    const canvas = makeCanvas(128);
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const a = theme === 'city' || theme === 'tokyo' ? '#e8e8e8' : '#cc0000';
    const b = '#f5f5f5';
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 === 0 ? a : b;
      ctx.fillRect(i * 8, 0, 8, 16);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(24, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.55,
      metalness: 0.15,
      envMapIntensity: 1.3,
    });
  });
}

export function getBarrierMaterial(theme = 'alpine') {
  return cached(`barrier_${theme}`, () => {
    switch (theme) {
      case 'city':
        return new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.85, envMapIntensity: 1.8 });
      case 'tokyo':
        return new THREE.MeshStandardMaterial({ color: 0xc6ccd4, roughness: 0.18, metalness: 0.9, envMapIntensity: 2.1 });
      case 'desert':
        return new THREE.MeshStandardMaterial({ color: 0xaa8844, roughness: 0.8 });
      case 'forest':
        return new THREE.MeshStandardMaterial({ color: 0x446644, roughness: 0.7 });
      default:
        return new THREE.MeshStandardMaterial({ color: 0x8d9199, roughness: 0.35, metalness: 0.6, envMapIntensity: 1.5 });
    }
  });
}

export function getTerrainMaterial(theme = 'alpine') {
  return cached(`terrain_${theme}`, () => {
    switch (theme) {
      case 'alpine':
        return new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.85, metalness: 0.12, envMapIntensity: 1.1 });
      case 'coastal':
        return new THREE.MeshStandardMaterial({ color: 0xd4c49e, roughness: 0.92, metalness: 0.05, envMapIntensity: 1.0 });
      case 'desert':
        return new THREE.MeshStandardMaterial({ color: 0xe8c98a, roughness: 0.96, metalness: 0.0 });
      case 'forest':
        return new THREE.MeshStandardMaterial({ color: 0x4a8a3a, roughness: 0.92, metalness: 0.02 });
      case 'city': {
        // wet downtown concrete: low roughness so the sky mirrors off it
        const maps = getAsphaltMaps();
        return new THREE.MeshStandardMaterial({
          color: 0x2b2d33,
          map: maps.map,
          roughnessMap: maps.roughnessMap,
          normalMap: maps.normalMap,
          normalScale: new THREE.Vector2(0.35, 0.35),
          roughness: 1.0,
          metalness: 0.5,
          envMapIntensity: 1.6,
        });
      }
      case 'tokyo': {
        // darker, glossier wet concrete for the neon reflections
        const maps = getAsphaltMaps();
        return new THREE.MeshStandardMaterial({
          color: 0x1c1f26,
          map: maps.map,
          roughnessMap: maps.roughnessMap,
          normalMap: maps.normalMap,
          normalScale: new THREE.Vector2(0.3, 0.3),
          roughness: 1.0,
          metalness: 0.58,
          envMapIntensity: 1.9,
        });
      }
      case 'countryside':
        return new THREE.MeshStandardMaterial({ color: 0x5aa02e, roughness: 0.88, metalness: 0.02 });
      default:
        return new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
    }
  });
}

/* ------------------------------------------------------------------ *
 * Car paint / glass / lights
 * ------------------------------------------------------------------ */
export function getCarFlakeNormal() {
  return cached('flake', () => {
    const canvas = normalMapCanvas(heightCanvas(256, 909), 2.2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(26, 26);
    tex.anisotropy = 4;
    return tex;
  });
}

export function getPaintMaterial(color = 0xcc0000) {
  const flake = getCarFlakeNormal();
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.24,
    clearcoat: 1.0,
    clearcoatRoughness: 0.035,
    clearcoatNormalMap: flake,
    clearcoatNormalScale: new THREE.Vector2(0.14, 0.14),
    normalMap: flake,
    normalScale: new THREE.Vector2(0.06, 0.06),
    envMapIntensity: 1.8,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xffffff),
  });
}

export function getGlassMaterial(tint = 0.3) {
  return new THREE.MeshPhysicalMaterial({
    color: 0x0b0d14,
    metalness: 0.0,
    roughness: 0.02,
    transmission: 0.9,
    thickness: 0.45,
    ior: 1.52,
    transparent: true,
    opacity: Math.min(0.35 + tint * 0.45, 0.92),
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
  });
}

export function getChromeMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1.0,
    roughness: 0.04,
    envMapIntensity: 2.2,
  });
}

export function getCarbonMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1c1c1e,
    metalness: 0.4,
    roughness: 0.32,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.4,
  });
}

export function getTireMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95, metalness: 0.0 });
}

export function getRimMaterial(color = 0xcccccc) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 1.0,
    roughness: 0.13,
    clearcoat: 0.5,
    envMapIntensity: 2.0,
  });
}

/** Additive cone used to fake volumetric headlight beams. */
export function getLightBeamMaterial(color = 0xfff3d6) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.055,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/* ------------------------------------------------------------------ *
 * Petal sprite (used by the cherry-blossom weather particles)
 * ------------------------------------------------------------------ */
export function getBlossomSprite() {
  return cached('blossom', () => {
    const S = 64;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);

    const petal = (cx, cy, rx, ry, rot, inner, outer) => {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, inner);
      g.addColorStop(0.6, outer);
      g.addColorStop(1, 'rgba(255,150,185,0)');
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    petal(S * 0.5, S * 0.42, S * 0.34, S * 0.22, -0.5, 'rgba(255,246,250,1)', 'rgba(255,190,214,0.95)');
    petal(S * 0.38, S * 0.62, S * 0.28, S * 0.18, 0.7, 'rgba(255,240,247,1)', 'rgba(255,176,205,0.9)');

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
}
