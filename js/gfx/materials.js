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

/* __PART2__ */
