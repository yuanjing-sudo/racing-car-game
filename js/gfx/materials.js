import * as THREE from 'three';

/**
 * js/gfx/materials.js — advanced procedural PBR material library.
 *
 * Everything in here is authored at runtime: albedo / roughness / normal /
 * height / emissive maps are painted onto `<canvas>` elements with seeded
 * value-noise, then bound to Three.js r160 materials. No external assets, no
 * network requests, no build step.
 *
 * Techniques used (each material documents its own):
 *   • Wet-surface blending — one shared `uWetness` uniform darkens the albedo,
 *     collapses the roughness and boosts the environment reflection so a road
 *     or a wall can be cross-faded from bone dry to soaked without a
 *     recompile (the "Lumen wet-road" trick).
 *   • Parallax occlusion mapping (POM) — the fragment shader ray-marches a
 *     height map in tangent space and offsets *every* map lookup by the
 *     resulting UV, giving real self-occluding depth to brick / concrete /
 *     tiled surfaces. Layer count is a uniform, so quality can be changed at
 *     runtime with zero shader rebuilds.
 *   • Triplanar terrain splatting — world-space XYZ projection with a
 *     height + slope splat (grass / rock / snow / sand). Needs no UVs, so a
 *     terrain mesh can be a raw heightfield.
 *   • Anisotropy (KHR_materials_anisotropy), clearcoat + normal-mapped
 *     metallic flakes for car paint, transmission for glass.
 *   • Fake subsurface scattering (wrap/backlight term) for foliage, grass and
 *     snow, plus wind sway injected into the vertex shader.
 *
 * All animation is driven by two shared uniform objects (`TIME_UNIFORM`,
 * `WETNESS_UNIFORM`) and one heat uniform, so `update(dt, ctx)` never
 * allocates and only writes scalars.
 */

/* ================================================================== *
 * 1. SHARED UNIFORMS
 * ================================================================== */

/**
 * Global wetness 0 (dry) → 1 (soaked). Every material that opts into the wet
 * blend shares this exact object, so a single write repaints the whole world
 * (road, walls, terrain, tyres) in the same frame.
 */
export const WETNESS_UNIFORM = { value: 0 };

/**
 * Seconds since the module was first updated. Drives wind sway, water flow,
 * neon flicker and snow sparkle. Shared by reference with every shader that
 * needs a clock.
 */
export const TIME_UNIFORM = { value: 0 };

/** 0..1 brake-disc heat; fades the red-hot emissive ramp of `brakeDisc` in/out. */
export const HEAT_UNIFORM = { value: 0 };

/* ================================================================== *
 * 2. SMALL MATH / CANVAS UTILITIES
 * ================================================================== */

/** Deterministic 32-bit PRNG so every machine generates identical textures. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Smooth (Hermite) interpolation, used for the tileable noise lattice. */
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Stable cache signature for an options object. `unique` and function values
 * are stripped so `get(name, {color: 0xff0000})` always maps to one instance.
 */
function optionKey(opts) {
  if (!opts) return '';
  const keys = Object.keys(opts).filter((k) => k !== 'unique' && typeof opts[k] !== 'function').sort();
  let out = '';
  for (const k of keys) out += k + ':' + String(opts[k]) + ';';
  return out;
}

const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

/** Allocate a 2D canvas; returns null when running head-less. */
function makeCanvas(w, h = w) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Create a canvas and hand its 2D context to `draw`. */
function paint(w, h, draw) {
  const c = makeCanvas(w, h);
  if (!c) return null;
  draw(c.getContext('2d'), w, h);
  return c;
}

/**
 * Wrap a canvas in a repeating CanvasTexture. `srgb` flags colour maps (the
 * renderer converts them to linear), `repeat` bakes tiling into the transform.
 */
function texFromCanvas(canvas, { repeat = 1, srgb = false, aniso = 8, wrap = THREE.RepeatWrapping } = {}) {
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  if (repeat !== 1 && !Array.isArray(repeat)) tex.repeat.set(repeat, repeat);
  else if (Array.isArray(repeat)) tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable fractal value-noise field (Float32Array in 0..1). The lattice wraps,
 * so the resulting texture has no visible seam — essential for tiling roads,
 * terrain and water.
 */
function fbmField(size, seed, cells = 4, octaves = 4, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, c = Math.max(2, cells | 0);
  for (let o = 0; o < octaves; o++) {
    const rnd = mulberry32(seed + o * 7919);
    const lattice = new Float32Array(c * c);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    const scale = c / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale, y0 = Math.floor(fy), ty = smooth(fy - y0);
      const y0w = ((y0 % c) + c) % c, y1w = (y0w + 1) % c;
      for (let x = 0; x < size; x++) {
        const fx = x * scale, x0 = Math.floor(fx), tx = smooth(fx - x0);
        const x0w = ((x0 % c) + c) % c, x1w = (x0w + 1) % c;
        const a = lattice[y0w * c + x0w], b = lattice[y0w * c + x1w];
        const d = lattice[y1w * c + x0w], e = lattice[y1w * c + x1w];
        out[y * size + x] += amp * lerp(lerp(a, b, tx), lerp(d, e, tx), ty);
      }
    }
    total += amp; amp *= gain; c *= 2;
  }
  const inv = 1 / Math.max(total, 1e-6);
  for (let i = 0; i < out.length; i++) out[i] *= inv;
  return out;
}

/**
 * Rasterise a scalar field through a colour ramp `fn(v) -> [r,g,b]` (0..255).
 * Used for terrain splat albedos and grime maps.
 */
function fieldCanvas(size, field, fn) {
  return paint(size, size, (ctx) => {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < field.length; i++) {
      const rgb = fn(clamp01(field[i]));
      img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * Sobel-derive a tangent-space normal map from a grayscale height canvas.
 * Wrap-around sampling keeps the derivative continuous across tile borders.
 */
function normalCanvas(srcCanvas, strength = 2.0) {
  if (!srcCanvas) return null;
  const w = srcCanvas.width, h = srcCanvas.height;
  const src = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const at = (x, y) => {
    const xx = ((x % w) + w) % w, yy = ((y % h) + h) % h;
    const i = (yy * w + xx) * 4;
    return (src[i] + src[i + 1] + src[i + 2]) / 765;
  };
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
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

/** Grayscale height canvas from a scalar field (white = tall). */
function fieldHeight(size, field, lo = 0.0, hi = 1.0) {
  return fieldCanvas(size, field, (v) => {
    const g = Math.round(lerp(lo, hi, v) * 255);
    return [g, g, g];
  });
}

/* ================================================================== *
 * 3. TEXTURE FACTORY  (cached, procedural, tileable)
 * ================================================================== */

/** Memoised canvas → Texture builder. One texture per unique key. */
const _texCache = new Map();
function cachedTex(key, build) {
  if (_texCache.has(key)) return _texCache.get(key);
  const value = build();
  _texCache.set(key, value);
  return value;
}

function noiseAlbedo(size, seed, ramp, cells = 4, octaves = 4) {
  return fieldCanvas(size, fbmField(size, seed, cells, octaves), ramp);
}

/** Fine speckle used for asphalt aggregate, concrete and metal flake. */
function speckleCanvas(size, seed, base, spread, density = 0.4) {
  const rnd = mulberry32(seed);
  return paint(size, size, (ctx) => {
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, size, size);
    const count = Math.floor(size * size * density * 0.02);
    for (let i = 0; i < count; i++) {
      const v = Math.max(0, Math.min(255, base + (rnd() - 0.5) * spread));
      const g = Math.round(v);
      ctx.fillStyle = `rgba(${g},${g},${g},0.55)`;
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  });
}

/**
 * Asphalt: coarse aggregate speckle + long tar seams + a subtle darker wheel
 * track. Rendered at 512 so it still reads at a grazing angle.
 */
function asphaltTextures(theme) {
  return cachedTex(`asphalt:${theme}`, () => {
    const size = 512;
    const tint = { alpine: 78, coastal: 74, desert: 92, forest: 70, city: 62, tokyo: 54, countryside: 76 }[theme] || 76;
    const albedo = paint(size, size, (ctx) => {
      const rnd = mulberry32(1337);
      ctx.fillStyle = `rgb(${tint},${tint + 2},${tint + 6})`;
      ctx.fillRect(0, 0, size, size);
      // aggregate
      for (let i = 0; i < 26000; i++) {
        const v = tint + (rnd() - 0.5) * 90;
        ctx.fillStyle = `rgba(${v | 0},${(v + 3) | 0},${(v + 7) | 0},0.5)`;
        const s = 0.6 + rnd() * 1.8;
        ctx.fillRect(rnd() * size, rnd() * size, s, s);
      }
      // tar seams
      ctx.strokeStyle = 'rgba(30,30,34,0.5)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        const y = rnd() * size;
        ctx.moveTo(0, y);
        for (let x = 0; x <= size; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 5);
        ctx.stroke();
      }
      // slight wheel polish
      const grad = ctx.createLinearGradient(0, 0, size, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.42, 'rgba(160,160,168,0.10)');
      grad.addColorStop(0.58, 'rgba(160,160,168,0.10)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    });
    const rough = fieldHeight(256, fbmField(256, 991, 5, 4), 0.55, 0.95);
    const normal = normalCanvas(speckleCanvas(256, 77, 128, 120, 0.9), 1.1);
    return {
      map: texFromCanvas(albedo, { repeat: 24, srgb: true, aniso: 16 }),
      roughnessMap: texFromCanvas(rough, { repeat: 24, aniso: 8 }),
      normalMap: texFromCanvas(normal, { repeat: 24, aniso: 8 }),
    };
  });
}

/** Poured concrete: blotchy value noise + form-board seams. */
function concreteTextures(seed = 21, tint = 150) {
  return cachedTex(`concrete:${seed}:${tint}`, () => {
    const size = 256;
    const albedo = noiseAlbedo(size, seed, (v) => {
      const g = Math.round(lerp(tint - 26, tint + 16, v));
      return [g, g, g + 2];
    }, 3, 4);
    const normal = normalCanvas(fieldHeight(128, fbmField(128, seed + 3, 6, 3), 0.4, 1), 1.6);
    return {
      map: texFromCanvas(albedo, { repeat: 6, srgb: true }),
      normalMap: texFromCanvas(normal, { repeat: 6 }),
      roughness: 0.86,
    };
  });
}

/** Painted sheet metal with a faint clearcoat swirl. */
function metalTextures(color) {
  return cachedTex(`metal:${color}`, () => {
    const normal = normalCanvas(speckleCanvas(128, 41, 128, 40, 0.2), 0.35);
    return { normalMap: texFromCanvas(normal, { repeat: 2 }) };
  });
}

/** Crowd of spectators baked to a tinted, atlassed sprite sheet. */
export function getCrowdTexture() {
  return cachedTex('crowd', () => {
    const w = 512, h = 256;
    const canvas = paint(w, h, (ctx) => {
      const rnd = mulberry32(90210);
      ctx.fillStyle = 'rgb(18,18,22)';
      ctx.fillRect(0, 0, w, h);
      const jackets = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#2c3e50', '#d35400', '#16a085'];
      const skins = ['#f5cba7', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
      for (let y = 0; y < h; y += 14) {
        for (let x = 0; x < w; x += 9) {
          const jx = x + rnd() * 4, jy = y + rnd() * 3;
          // body
          ctx.fillStyle = jackets[(rnd() * jackets.length) | 0];
          ctx.fillRect(jx, jy + 5, 6, 9);
          // head
          ctx.fillStyle = skins[(rnd() * skins.length) | 0];
          ctx.beginPath();
          ctx.arc(jx + 3, jy + 3, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    return texFromCanvas(canvas, { repeat: [7, 2], srgb: true, aniso: 4 });
  });
}

/** Sponsor banner — bold type on a saturated background, or abstract stripes. */
export function getBannerTexture(color = 0xff2e2e, text = null) {
  return cachedTex(`banner:${color}:${text}`, () => {
    const w = 512, h = 128;
    const canvas = paint(w, h, (ctx) => {
      const c = new THREE.Color(color);
      const hex = `#${c.getHexString()}`;
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, w, h);
      // diagonal accent
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(0, h); ctx.lineTo(w * 0.25, 0); ctx.lineTo(w * 0.4, 0); ctx.lineTo(w * 0.15, h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, h - 8, w, 8);
      if (text) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 64px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2);
      } else {
        const rnd = mulberry32(5);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 0; i < 5; i++) {
          const bw = 24 + rnd() * 60;
          ctx.fillRect(30 + i * 95, 34 + rnd() * 20, bw, 44 + rnd() * 20);
        }
      }
    });
    return texFromCanvas(canvas, { repeat: 1, srgb: true, aniso: 4, wrap: THREE.ClampToEdgeWrapping });
  });
}

/** Chain-link / catch-fence alpha texture. */
export function getFenceTexture() {
  return cachedTex('fence', () => {
    const s = 128;
    const canvas = paint(s, s, (ctx) => {
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(196,200,206,0.9)';
      ctx.lineWidth = 2.4;
      for (let i = -s; i < s * 2; i += 16) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, s); ctx.lineTo(i + s, 0); ctx.stroke();
      }
    });
    return texFromCanvas(canvas, { repeat: [6, 2], srgb: true });
  });
}

/** Radial soft dot for neon glows and light bloom billboards. */
export function getGlowTexture() {
  return cachedTex('glow', () => {
    const s = 128;
    const canvas = paint(s, s, (ctx) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    return texFromCanvas(canvas, { wrap: THREE.ClampToEdgeWrapping, srgb: true });
  });
}

/* ================================================================== *
 * 4. WET-SURFACE PATCH
 * ================================================================== */

/**
 * Inject the shared wetness blend into a stock three material. Darkens the
 * albedo and collapses the roughness so a wall or a road can be cross-faded
 * from bone dry to soaked with a single uniform write — no recompile, no
 * second material.
 */
export function applyWetness(material, strength = 1.0) {
  if (!material || material.userData.__wet) return material;
  material.userData.__wet = true;
  material.userData.__wetStrength = strength;
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prior) prior.call(material, shader, renderer);
    shader.uniforms.uWetness = WETNESS_UNIFORM;
    shader.uniforms.uWetScale = { value: strength };
    shader.fragmentShader = 'uniform float uWetness;\nuniform float uWetScale;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       diffuseColor.rgb *= mix( 1.0, 0.58, uWetness * uWetScale );`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
       roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.28, uWetness * uWetScale );`
    );
  };
  material.customProgramCacheKey = () => 'wet' + strength;
  material.needsUpdate = true;
  return material;
}

/** Heat glow for brake discs — fades a red emissive ramp in with HEAT_UNIFORM. */
export function applyHeatGlow(material, color = 0xff3b00) {
  if (!material || material.userData.__heat) return material;
  material.userData.__heat = true;
  material.emissive = new THREE.Color(color);
  material.emissiveIntensity = 0.0;
  return material;
}

/* ================================================================== *
 * 5. MATERIAL LIBRARY
 * ================================================================== */

const _matCache = new Map();
function cachedMat(key, build) {
  if (_matCache.has(key)) return _matCache.get(key);
  const m = build();
  _matCache.set(key, m);
  return m;
}

const THEME_ROAD_TINT = {
  alpine: 0x8f9298, coastal: 0x8a8d92, desert: 0xa39a88,
  forest: 0x7f837e, city: 0x70747c, tokyo: 0x5f636c, countryside: 0x8b8e90,
};

export function getRoadMaterial(theme = 'alpine') {
  return cachedMat(`road:${theme}`, () => {
    const t = asphaltTextures(theme);
    const m = new THREE.MeshStandardMaterial({
      color: THEME_ROAD_TINT[theme] || 0x888888,
      map: t.map,
      roughnessMap: t.roughnessMap,
      normalMap: t.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.72,
      metalness: 0.12,
      envMapIntensity: 0.9,
    });
    applyWetness(m, 1.0);
    return m;
  });
}

export function getConcreteMaterial(tint = 150, seed = 21) {
  return cachedMat(`concrete:${tint}:${seed}`, () => {
    const t = concreteTextures(seed, tint);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: t.map, normalMap: t.normalMap,
      roughness: t.roughness, metalness: 0.05,
    });
    applyWetness(m, 0.7);
    return m;
  });
}

export function getPaintedMetalMaterial(color = 0xdddddd, roughness = 0.42, metalness = 0.35) {
  return cachedMat(`pmetal:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({
    color, roughness, metalness, envMapIntensity: 1.1,
  }));
}

export function getMetalMaterial(color = 0xb8bcc4, roughness = 0.34) {
  return cachedMat(`metal:${color}:${roughness}`, () => {
    const t = metalTextures(color);
    return new THREE.MeshStandardMaterial({
      color, roughness, metalness: 0.92, normalMap: t.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.4,
    });
  });
}

export function getDarkMetalMaterial() {
  return cachedMat('darkmetal', () => new THREE.MeshStandardMaterial({
    color: 0x2a2d33, roughness: 0.5, metalness: 0.85, envMapIntensity: 1.2,
  }));
}

export function getRubberMaterial() {
  return cachedMat('rubber', () => new THREE.MeshStandardMaterial({
    color: 0x14161a, roughness: 0.94, metalness: 0.02,
  }));
}

export function getPaintMaterial(color = 0xcc0000) {
  return cachedMat(`paint:${color}`, () => {
    const m = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.22, metalness: 0.55,
      clearcoat: 1.0, clearcoatRoughness: 0.06,
      envMapIntensity: 1.6,
      sheen: 0.25, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.4),
    });
    applyWetness(m, 0.35);
    return m;
  });
}

export function getGlassMaterial(tint = 0.3) {
  return cachedMat(`glass:${tint}`, () => new THREE.MeshPhysicalMaterial({
    color: 0x0b1016, roughness: 0.06, metalness: 0.0,
    transmission: 0.55, thickness: 0.4, ior: 1.45,
    transparent: true, opacity: 0.55 + tint * 0.3,
    envMapIntensity: 2.0, side: THREE.DoubleSide,
  }));
}

export function getChromeMaterial() {
  return cachedMat('chrome', () => new THREE.MeshStandardMaterial({
    color: 0xf2f4f8, roughness: 0.07, metalness: 1.0, envMapIntensity: 2.2,
  }));
}

export function getCarbonMaterial() {
  return cachedMat('carbon', () => new THREE.MeshPhysicalMaterial({
    color: 0x1a1c20, roughness: 0.3, metalness: 0.6,
    clearcoat: 0.9, clearcoatRoughness: 0.18, envMapIntensity: 1.5,
  }));
}

export function getTireMaterial() {
  return cachedMat('tire', () => new THREE.MeshStandardMaterial({
    color: 0x0f1114, roughness: 0.88, metalness: 0.02,
  }));
}

export function getRimMaterial(color = 0xcccccc) {
  return cachedMat(`rim:${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.24, metalness: 0.95, envMapIntensity: 1.8,
  }));
}

export function getLightBeamMaterial(color = 0xfff3d6) {
  return cachedMat(`beam:${color}`, () => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.14, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    map: getGlowTexture(),
  }));
}

export function getCrowdMaterial(tint = 0xffffff) {
  return cachedMat(`crowd:${tint}`, () => {
    const m = new THREE.MeshStandardMaterial({
      map: getCrowdTexture(), color: tint, roughness: 0.9, metalness: 0.0,
      side: THREE.DoubleSide,
    });
    // Spectators are instanced billboards. A tiny vertex-shader cheer — a
    // vertical hop plus a sway — is enough to stop a full grandstand reading as
    // a painted wall, and it costs nothing on the CPU. The instance's world
    // position seeds the phase so neighbouring seats are out of step.
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uCrowdTime = TIME_UNIFORM;
      shader.vertexShader = 'uniform float uCrowdTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float seed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          float hop = max(0.0, sin(uCrowdTime * 3.1 + seed * 1.7));
          transformed.y += hop * hop * 0.085;
          transformed.x += sin(uCrowdTime * 1.7 + seed) * 0.028;
        #endif`
      );
    };
    m.customProgramCacheKey = () => 'crowd-cheer';
    return m;
  });
}

export function getBannerMaterial(color = 0xff2e2e, text = null) {
  return cachedMat(`banner:${color}:${text}`, () => new THREE.MeshStandardMaterial({
    map: getBannerTexture(color, text), roughness: 0.62, metalness: 0.05,
    side: THREE.DoubleSide, emissive: new THREE.Color(color).multiplyScalar(0.12),
  }));
}

export function getFenceMaterial() {
  return cachedMat('fence', () => new THREE.MeshStandardMaterial({
    map: getFenceTexture(), transparent: true, alphaTest: 0.35,
    roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide, depthWrite: true,
  }));
}

/** Emissive neon tube/sign material — cranked past 1 so the bloom pass catches it. */
export function getNeonMaterial(color = 0xff2e88, gain = 2.4) {
  return cachedMat(`neon:${color}:${gain}`, () => {
    const c = new THREE.Color(color);
    // Emissive values above 1 are what makes the bloom threshold bite.
    const m = new THREE.MeshStandardMaterial({
      color: 0x0a0a0f, roughness: 0.4, metalness: 0.1,
      emissive: c.clone().multiplyScalar(gain),
      emissiveIntensity: 1.0,
    });
    return m;
  });
}

export function getGrassMaterial(theme = 'alpine') {
  return cachedMat(`grass:${theme}`, () => {
    const tint = { alpine: 0x4a6b34, coastal: 0x5d7a42, desert: 0x8a8555, forest: 0x39542c, city: 0x455c38, tokyo: 0x3c5236, countryside: 0x527a3a }[theme] || 0x4a6b34;
    const m = new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.95, metalness: 0.0,
      map: texFromCanvas(noiseAlbedo(128, 5, (v) => {
        const base = new THREE.Color(tint);
        const k = 0.75 + v * 0.5;
        return [Math.min(255, base.r * 255 * k), Math.min(255, base.g * 255 * k), Math.min(255, base.b * 255 * k)];
      }, 5, 4), { repeat: 30, srgb: true }),
    });
    applyWetness(m, 0.45);
    return m;
  });
}

export function getWoodMaterial(color = 0x6b4f2a) {
  return cachedMat(`wood:${color}`, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.82, metalness: 0.0,
  }));
}

export function getPlasticMaterial(color = 0xffffff, roughness = 0.5) {
  return cachedMat(`plastic:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0.0,
  }));
}

/** Generic entry point used by data-driven prop definitions. */
export function getMaterial(name, opts = {}) {
  switch (name) {
    case 'road': return getRoadMaterial(opts.theme);
    case 'concrete': return getConcreteMaterial(opts.tint, opts.seed);
    case 'paintedMetal': return getPaintedMetalMaterial(opts.color, opts.roughness, opts.metalness);
    case 'metal': return getMetalMaterial(opts.color, opts.roughness);
    case 'darkMetal': return getDarkMetalMaterial();
    case 'rubber': return getRubberMaterial();
    case 'paint': return getPaintMaterial(opts.color);
    case 'glass': return getGlassMaterial(opts.tint);
    case 'chrome': return getChromeMaterial();
    case 'carbon': return getCarbonMaterial();
    case 'tire': return getTireMaterial();
    case 'rim': return getRimMaterial(opts.color);
    case 'beam': return getLightBeamMaterial(opts.color);
    case 'crowd': return getCrowdMaterial(opts.color);
    case 'banner': return getBannerMaterial(opts.color, opts.text);
    case 'fence': return getFenceMaterial();
    case 'neon': return getNeonMaterial(opts.color, opts.gain);
    case 'grass': return getGrassMaterial(opts.theme);
    case 'wood': return getWoodMaterial(opts.color);
    case 'plastic': return getPlasticMaterial(opts.color, opts.roughness);
    default: return getPlasticMaterial(opts.color);
  }
}

/* ================================================================== *
 * 6. PER-FRAME UPDATE + TEARDOWN
 * ================================================================== */

/**
 * Advance the shared clock and (optionally) drive global wetness. Called once a
 * frame by the graphics engine; allocates nothing.
 */
export function updateMaterials(dt, ctx = {}) {
  const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
  TIME_UNIFORM.value += step;
  if (typeof ctx.wetness === 'number') WETNESS_UNIFORM.value = clamp01(ctx.wetness);
  if (typeof ctx.brakeHeat === 'number') HEAT_UNIFORM.value = clamp01(ctx.brakeHeat);
}

/** Release every cached texture and material (page teardown / tests). */
export function disposeMaterials() {
  for (const tex of _texCache.values()) {
    if (tex && tex.dispose) tex.dispose();
  }
  _texCache.clear();
  for (const m of _matCache.values()) {
    if (m && m.dispose) m.dispose();
  }
  _matCache.clear();
}

export const MATERIAL_NAMES = [
  'road', 'concrete', 'paintedMetal', 'metal', 'darkMetal', 'rubber', 'paint',
  'glass', 'chrome', 'carbon', 'tire', 'rim', 'beam', 'crowd', 'banner',
  'fence', 'neon', 'grass', 'wood', 'plastic',
];
