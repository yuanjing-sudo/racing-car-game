import * as THREE from 'three';

/**
 * reflections.js — image-based lighting for the whole scene.
 *
 * Every `MeshStandardMaterial` / `MeshPhysicalMaterial` in the game (car paint,
 * chrome, glass, wet asphalt, neon signage) samples `scene.environment`. Rather
 * than ship an HDR file, this module *paints* an equirectangular sky — gradient,
 * sun disc, ground haze, horizon band and a neon smear for night themes — and
 * runs it through `PMREMGenerator` to get a properly pre-filtered radiance map
 * with mips for roughness. Metals and clearcoat then reflect something real.
 *
 * Regeneration is throttled: it only re-bakes when the theme, the hour or the
 * weather has moved meaningfully, so the cost is a few milliseconds per change
 * rather than per frame.
 */

const THEME_SKY = {
  alpine: { zenith: [0.22, 0.40, 0.74], horizon: [0.72, 0.80, 0.90], ground: [0.30, 0.32, 0.28], sun: [1.0, 0.96, 0.86] },
  coastal: { zenith: [0.20, 0.42, 0.80], horizon: [0.94, 0.78, 0.62], ground: [0.34, 0.36, 0.34], sun: [1.0, 0.85, 0.62] },
  desert: { zenith: [0.30, 0.48, 0.82], horizon: [0.94, 0.88, 0.74], ground: [0.62, 0.56, 0.44], sun: [1.0, 0.98, 0.92] },
  forest: { zenith: [0.20, 0.36, 0.62], horizon: [0.68, 0.76, 0.72], ground: [0.20, 0.26, 0.18], sun: [1.0, 0.94, 0.80] },
  city: { zenith: [0.05, 0.06, 0.12], horizon: [0.28, 0.16, 0.30], ground: [0.10, 0.10, 0.14], sun: [0.55, 0.42, 0.62] },
  tokyo: { zenith: [0.04, 0.05, 0.11], horizon: [0.34, 0.14, 0.34], ground: [0.09, 0.09, 0.13], sun: [0.62, 0.40, 0.60] },
  countryside: { zenith: [0.22, 0.40, 0.76], horizon: [0.76, 0.82, 0.88], ground: [0.28, 0.34, 0.24], sun: [1.0, 0.96, 0.86] },
};
const DEFAULT_SKY = THEME_SKY.countryside;

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Paint an equirectangular sky: vertical gradient, a sun disc smeared along the
 * horizon, a haze band, and (for night themes) a warm city glow around the
 * horizon plus a few stars.
 *
 * @returns {{canvas: HTMLCanvasElement|null, sunU: number, sunV: number}}
 */
function paintSky(theme, { timeOfDay = 12, isNight = false, sunDirection = null, weather = 'clear' } = {}) {
  const W = 512, H = 256;
  const canvas = makeCanvas(W, H);
  if (!canvas) return { canvas: null, sunU: 0.5, sunV: 0.25 };
  const ctx = canvas.getContext('2d');
  const p = THEME_SKY[theme] || DEFAULT_SKY;

  // Vertical gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  const night = isNight ? 1 : 0;
  const mix = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const zc = night ? mix(p.zenith, 0.22) : p.zenith;
  const hc = night ? mix(p.horizon, 0.5) : p.horizon;
  const gc = night ? mix(p.ground, 0.25) : p.ground;
  grad.addColorStop(0.0, rgb(zc));
  grad.addColorStop(0.44, rgb(mixBlend(zc, hc, 0.6)));
  grad.addColorStop(0.5, rgb(hc));
  grad.addColorStop(0.58, rgb(mixBlend(hc, gc, 0.5)));
  grad.addColorStop(1.0, rgb(gc));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Sun position: u from the direction's yaw, v from elevation (equirect).
  let sunU = 0.5, sunV = 0.25, sunUp = 0;
  if (sunDirection) {
    const d = sunDirection.clone().normalize();
    sunU = (Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5);
    sunV = 0.5 - Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI;
    sunUp = THREE.MathUtils.clamp(d.y * 6 + 0.25, 0, 1);
  }

  // Sun glow (smeared horizontally, like a real horizon bloom).
  if (sunUp > 0.01 && !isNight) {
    const sx = sunU * W;
    const sy = sunV * H;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.22);
    const c = p.sun;
    g.addColorStop(0, `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},0.95)`);
    g.addColorStop(0.12, `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},0.42)`);
    g.addColorStop(0.5, `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},0.10)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Night: city glow band + moon + stars.
  if (isNight) {
    const band = ctx.createLinearGradient(0, H * 0.42, 0, H * 0.56);
    band.addColorStop(0, 'rgba(0,0,0,0)');
    band.addColorStop(0.6, 'rgba(255,120,80,0.22)');
    band.addColorStop(1, 'rgba(255,60,140,0.10)');
    ctx.fillStyle = band;
    ctx.fillRect(0, H * 0.42, W, H * 0.16);

    // stars (deterministic)
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 220; i++) {
      const x = rnd() * W;
      const y = rnd() * H * 0.46;
      const a = 0.25 + rnd() * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // moon
    const mx = (1 - sunU) * W;
    const my = H * 0.18;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 26);
    mg.addColorStop(0, 'rgba(226,234,255,0.95)');
    mg.addColorStop(0.35, 'rgba(200,214,255,0.35)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(mx - 30, my - 30, 60, 60);
  }

  // Weather: desaturate and lift overcast/rain.
  if (weather === 'overcast' || weather === 'rain' || weather === 'storm' || weather === 'fog') {
    const k = weather === 'fog' ? 0.55 : weather === 'storm' ? 0.45 : 0.35;
    ctx.fillStyle = `rgba(150,155,165,${k})`;
    ctx.fillRect(0, 0, W, H);
  }

  return { canvas, sunU, sunV };
}

function rgb(c) {
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`;
}
function mixBlend(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * @param {{ renderer:THREE.WebGLRenderer, scene:THREE.Scene, quality?:string }} opts
 */
export function createReflections(opts = {}) {
  const renderer = opts.renderer;
  const scene = opts.scene;
  const quality = opts.quality || 'high';
  const size = quality === 'low' ? 128 : quality === 'medium' ? 192 : 256;

  let pmrem = null;
  let sourceTexture = null;
  let envMap = null;
  let available = false;

  const last = { theme: null, hour: -99, weather: null, night: null };
  let disposed = false;

  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    available = true;
  } catch (err) {
    available = false;
    pmrem = null;
  }

  /**
   * Re-bake the environment map. Safe to call often — it early-outs unless the
   * lighting state has actually changed.
   */
  function bake({ theme = 'countryside', timeOfDay = 12, isNight = false, weather = 'clear', sunDirection = null, force = false } = {}) {
    if (!available || disposed) return false;
    const hourChanged = Math.abs(timeOfDay - last.hour) > 0.75;
    if (!force && last.theme === theme && !hourChanged && last.weather === weather && last.night === isNight) {
      return false;
    }
    last.theme = theme; last.hour = timeOfDay; last.weather = weather; last.night = isNight;

    const painted = paintSky(theme, { timeOfDay, isNight, weather, sunDirection });
    if (!painted.canvas) return false;

    const tex = new THREE.CanvasTexture(painted.canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    try {
      const target = pmrem.fromEquirectangular(tex);
      // Release the previous bake.
      if (envMap) envMap.dispose();
      if (sourceTexture) sourceTexture.dispose();
      sourceTexture = tex;
      envMap = target.texture;
      if (scene) {
        scene.environment = envMap;
        // three r160 exposes environmentIntensity on the scene; guard anyway.
        if ('environmentIntensity' in scene) {
          scene.environmentIntensity = isNight ? 1.25 : 1.0;
        }
      }
      return true;
    } catch (err) {
      tex.dispose();
      available = false;
      return false;
    }
  }

  /**
   * Optional: draw the sky *as* the background too. Off by default because the
   * game already renders a raymarched sky dome.
   */
  function setAsBackground(on) {
    if (!scene) return;
    scene.background = on ? envMap : (scene.background === envMap ? null : scene.background);
  }

  function update(dt, ctx = {}) {
    if (!available) return;
    bake({
      theme: ctx.theme,
      timeOfDay: ctx.timeOfDay,
      isNight: ctx.isNight,
      weather: ctx.weather,
      sunDirection: ctx.sunDirection,
    });
  }

  function dispose() {
    disposed = true;
    if (scene && scene.environment === envMap) scene.environment = null;
    if (envMap) envMap.dispose();
    if (sourceTexture) sourceTexture.dispose();
    if (pmrem) pmrem.dispose();
    envMap = null;
    sourceTexture = null;
    pmrem = null;
  }

  return {
    get available() { return available; },
    get envMap() { return envMap; },
    bake,
    update,
    setAsBackground,
    dispose,
  };
}

export const REFLECTION_THEMES = Object.keys(THEME_SKY);
export default { createReflections, REFLECTION_THEMES };
