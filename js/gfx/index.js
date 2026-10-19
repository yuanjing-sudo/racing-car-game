import * as THREE from 'three';

import { createSky } from './sky.js';
import { createLightingRig } from './lighting.js';
import { createShadowManager } from './shadows.js';
import { createVolumetrics } from './volumetrics.js';
import { createGraphicsPipeline, QUALITY_PRESETS } from './post/index.js';
import { createProps } from './props.js';
import { createDynamicProps } from './dynamicprops.js';
import { createScreens } from './screens.js';
import { createRoadDetail } from './roaddetail.js';
import { createCrew } from './crew.js';
import { createKerbs } from './kerbs.js';
import { createDecals } from './decals.js';
import { createWeatherFx } from './weatherfx.js';
import { createReflections } from './reflections.js';
import { createCinematic } from './cinematic.js';
import { createSkyline } from './skyline.js';
import { createRural } from './rural.js';
import { createWilds } from './wilds.js';
import { updateMaterials } from './materials.js';

/**
 * gfx/index.js — the graphics engine.
 *
 * One object that owns the whole look of the game:
 *
 *   sky          physically-based atmosphere + sun/moon discs + stars
 *   lighting     global rig, street-light / neon registries, light pools
 *   shadows      cascaded shadow maps for the sun (and blob shadows for props)
 *   volumetrics  height fog + light shafts + god-ray scatter volume
 *   post         the full HDR post chain (GTAO → SSR → godrays → bloom →
 *                lens flare → DOF → motion blur → film grade → AA)
 *
 * The engine is deliberately tolerant: every sub-module is created behind a
 * guard, so a failure in one never takes down the rest of the game. `modules`
 * exposes whatever came up so the caller can inspect/feature-detect.
 *
 * It is also designed to *coexist* with the legacy `WeatherSystem` and
 * `environment.js` lights. `attachLegacy()` hides the old sky dome and hands the
 * old directional light to the cascaded shadow manager, which is the cleanest
 * way to get a big jump in fidelity without relighting the whole game.
 */

export const THEME_PROFILES = {
  alpine: {
    timeOfDay: 10.5,
    sky: { turbidity: 3.2, rayleigh: 1.6, mieCoefficient: 0.008, cloudCoverage: 0.42, sunIntensity: 1.05 },
    volumetrics: { density: 0.5, topHeight: 220, maxDistance: 620, extinction: 1.1 },
    grade: 'cinematic',
    exposure: 1.0,
  },
  coastal: {
    timeOfDay: 17.4,
    sky: { turbidity: 5.0, rayleigh: 2.2, mieCoefficient: 0.014, cloudCoverage: 0.3, sunIntensity: 1.15 },
    volumetrics: { density: 0.72, topHeight: 200, maxDistance: 700, extinction: 0.9 },
    grade: 'golden',
    exposure: 1.02,
  },
  desert: {
    timeOfDay: 13.2,
    sky: { turbidity: 7.5, rayleigh: 0.9, mieCoefficient: 0.02, cloudCoverage: 0.08, sunIntensity: 1.3 },
    volumetrics: { density: 0.42, topHeight: 260, maxDistance: 820, extinction: 1.5 },
    grade: 'bleach',
    exposure: 1.0,
  },
  forest: {
    timeOfDay: 15.6,
    sky: { turbidity: 4.0, rayleigh: 1.4, mieCoefficient: 0.011, cloudCoverage: 0.5, sunIntensity: 0.95 },
    volumetrics: { density: 0.85, topHeight: 180, maxDistance: 560, extinction: 1.2 },
    grade: 'cinematic',
    exposure: 1.0,
  },
  city: {
    timeOfDay: 21.0,
    night: true,
    sky: { turbidity: 6.0, rayleigh: 1.0, mieCoefficient: 0.03, cloudCoverage: 0.62, sunIntensity: 0.2 },
    volumetrics: { density: 1.05, topHeight: 320, maxDistance: 900, extinction: 0.9 },
    grade: 'neon',
    exposure: 1.16,
  },
  tokyo: {
    timeOfDay: 19.6,
    night: true,
    weather: 'rain',
    wetness: 1.0,
    fogScale: 0.35,
    sky: { turbidity: 6.6, rayleigh: 1.1, mieCoefficient: 0.036, cloudCoverage: 0.78, sunIntensity: 0.18 },
    volumetrics: { density: 1.25, topHeight: 340, maxDistance: 950, extinction: 0.8 },
    grade: 'neon',
    exposure: 1.22,
  },
  countryside: {
    timeOfDay: 9.0,
    sky: { turbidity: 3.6, rayleigh: 1.7, mieCoefficient: 0.009, cloudCoverage: 0.38, sunIntensity: 1.05 },
    volumetrics: { density: 0.68, topHeight: 200, maxDistance: 640, extinction: 1.1 },
    grade: 'cinematic',
    exposure: 1.0,
  },
};

const DEFAULT_SETTINGS = {
  quality: 'high',
  post: true,
  sky: true,
  lighting: true,
  shadows: true,
  volumetric: true,
  props: true,
  dynamic: true,
  dynamicDensity: 1,
  screens: true,
  roaddetail: true,
  crew: true,
  kerbs: true,
  skyline: true,
  rural: true,
  wilds: true,
  decals: true,
  weatherfx: true,
  reflections: true,
  cinematic: true,
  filmGrain: 0.02,
  exposureGain: 1.0,
  temperature: 0.0,
  ...QUALITY_PRESETS.high,
};

const EMPTY_V3 = new THREE.Vector3(0, 1, 0);

function safe(fn, label, report) {
  try {
    const value = fn();
    return value;
  } catch (err) {
    report.push({ label, error: err });
    if (typeof console !== 'undefined') {
      console.warn(`[gfx] module "${label}" failed to initialise:`, err && err.message ? err.message : err);
    }
    return null;
  }
}

export function createGraphicsEngine(opts = {}) {
  const renderer = opts.renderer;
  const scene = opts.scene;
  const camera = opts.camera;
  const settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
  const failures = [];

  const state = {
    theme: opts.theme || 'countryside',
    timeOfDay: 12,
    weather: 'clear',
    isNight: false,
    wetness: 0,
    speed01: 0,
    elapsed: 0,
    fogScale: 1,
    volumetricDensity: 0.05,
  };

  /* ------------------------------------------------------------------ modules ---- */
  const modules = {};

  modules.post = settings.post
    ? safe(() => createGraphicsPipeline(renderer, scene, camera, settings), 'post', failures)
    : null;

  modules.sky = settings.sky
    ? safe(() => createSky({ renderer, scene }), 'sky', failures)
    : null;

  modules.lighting = settings.lighting
    ? safe(() => createLightingRig({ renderer, scene, quality: settings.quality }), 'lighting', failures)
    : null;

  modules.shadows = settings.shadows
    ? safe(() => createShadowManager({
        renderer, scene, quality: settings.quality, maxFar: settings.shadowFar || 340,
      }), 'shadows', failures)
    : null;

  modules.volumetrics = settings.volumetric
    ? safe(() => createVolumetrics({ renderer, scene, camera }), 'volumetrics', failures)
    : null;

  // Track-content modules. Props and decals are rebuilt whenever a new track is
  // loaded (see buildTrackContent); weather FX lives for the whole session.
  let props = null;
  let dynamicProps = null;
  let screens = null;
  let roadDetail = null;
  let crew = null;
  let kerbs = null;
  let skyline = null;
  let rural = null;
  let wilds = null;
  let decals = null;
  let weatherfx = null;

  modules.weatherfx = settings.weatherfx
    ? safe(() => {
        const fx = createWeatherFx({ renderer, scene, camera, quality: settings.quality });
        if (scene) scene.add(fx.group);
        return fx;
      }, 'weatherfx', failures)
    : null;
  weatherfx = modules.weatherfx;

  modules.decals = settings.decals
    ? safe(() => {
        const d = createDecals({ quality: settings.quality });
        if (scene) scene.add(d.group);
        return d;
      }, 'decals', failures)
    : null;
  decals = modules.decals;

  // Image-based lighting: bakes a procedural sky into scene.environment so the
  // car paint, chrome, glass and wet asphalt have something to reflect.
  modules.reflections = settings.reflections
    ? safe(() => createReflections({ renderer, scene, quality: settings.quality }), 'reflections', failures)
    : null;

  // The camera director. It never takes the camera unless a sequence is playing;
  // otherwise it only contributes auto-focus, a lens punch and impact shake.
  modules.cinematic = settings.cinematic
    ? safe(() => createCinematic({ camera, seed: 7 }), 'cinematic', failures)
    : null;

  /**
   * (Re)build the trackside content for a theme. Called from `setTheme` when the
   * caller supplies a track curve; safe to call with no curve to tear down.
   */
  function buildTrackContent(theme = {}) {
    if (props) {
      if (props.group.parent) props.group.parent.remove(props.group);
      try { props.dispose(); } catch (e) { /* ignore */ }
      props = null;
      modules.props = null;
    }
    if (dynamicProps) {
      if (dynamicProps.group.parent) dynamicProps.group.parent.remove(dynamicProps.group);
      try { dynamicProps.dispose(); } catch (e) { /* ignore */ }
      dynamicProps = null;
      modules.dynamicprops = null;
    }
    if (screens) {
      if (screens.group.parent) screens.group.parent.remove(screens.group);
      try { screens.dispose(); } catch (e) { /* ignore */ }
      screens = null;
      modules.screens = null;
    }
    if (roadDetail) {
      if (roadDetail.group.parent) roadDetail.group.parent.remove(roadDetail.group);
      try { roadDetail.dispose(); } catch (e) { /* ignore */ }
      roadDetail = null;
      modules.roaddetail = null;
    }
    if (crew) {
      if (crew.group.parent) crew.group.parent.remove(crew.group);
      try { crew.dispose(); } catch (e) { /* ignore */ }
      crew = null;
      modules.crew = null;
    }
    if (kerbs) {
      if (kerbs.group.parent) kerbs.group.parent.remove(kerbs.group);
      try { kerbs.dispose(); } catch (e) { /* ignore */ }
      kerbs = null;
      modules.kerbs = null;
    }
    if (skyline) {
      if (skyline.group.parent) skyline.group.parent.remove(skyline.group);
      try { skyline.dispose(); } catch (e) { /* ignore */ }
      skyline = null;
      modules.skyline = null;
    }
    if (rural) {
      if (rural.group.parent) rural.group.parent.remove(rural.group);
      try { rural.dispose(); } catch (e) { /* ignore */ }
      rural = null;
      modules.rural = null;
    }
    if (wilds) {
      if (wilds.group.parent) wilds.group.parent.remove(wilds.group);
      try { wilds.dispose(); } catch (e) { /* ignore */ }
      wilds = null;
      modules.wilds = null;
    }
    if (theme.decals !== false && decals) decals.clearDecals();

    const curve = theme.curve;
    if (!curve || settings.props === false) return;

    props = safe(() => {
      const p = createProps({
        theme: theme.theme,
        seed: theme.seed != null ? theme.seed : 42,
        curve,
        width: theme.width || 12,
        gapZones: theme.gapZones || [],
        quality: settings.quality,
        lighting: modules.lighting,
        density: settings.propDensity != null ? settings.propDensity : 1,
      });
      if (scene) scene.add(p.group);
      return p;
    }, 'props', failures);
    modules.props = props;

    // The animated half of the world — air traffic, turbines, fountains and
    // searchlights. Same inputs as `props`, plus the recruiting rigs.
    if (settings.dynamic !== false) {
      dynamicProps = safe(() => {
        const d = createDynamicProps({
          theme: theme.theme,
          seed: (theme.seed != null ? theme.seed : 42) ^ 0x1f2e3d,
          curve,
          width: theme.width || 12,
          gapZones: theme.gapZones || [],
          quality: settings.quality,
          lighting: modules.lighting,
          volumetrics: modules.volumetrics,
          density: settings.dynamicDensity != null ? settings.dynamicDensity : 1,
        });
        if (scene) scene.add(d.group);
        return d;
      }, 'dynamicprops', failures);
      modules.dynamicprops = dynamicProps;
    }

    // Animated trackside media: jumbotrons, ribbon boards and a timing tower.
    if (settings.screens !== false) {
      screens = safe(() => {
        const s = createScreens({
          theme: theme.theme,
          seed: (theme.seed != null ? theme.seed : 42) ^ 0x77aa11,
          curve,
          width: theme.width || 12,
          gapZones: theme.gapZones || [],
          quality: settings.quality,
          lighting: modules.lighting,
          density: settings.screenDensity != null ? settings.screenDensity : settings.dynamicDensity || 1,
        });
        if (scene) scene.add(s.group);
        return s;
      }, 'screens', failures);
      modules.screens = screens;
    }

    // Surface wear: repair patches, tar snakes, seams, drains, marbles.
    if (settings.roaddetail !== false) {
      roadDetail = safe(() => {
        const r = createRoadDetail({
          theme: theme.theme,
          seed: (theme.seed != null ? theme.seed : 42) ^ 0x2b9,
          curve,
          width: theme.width || 12,
          quality: settings.quality,
          density: settings.roadDensity != null ? settings.roadDensity : 1,
        });
        if (scene) scene.add(r.group);
        return r;
      }, 'roaddetail', failures);
      modules.roaddetail = roadDetail;
    }

    // Marshals, camera operators and photographers along the bank.
    if (settings.crew !== false) {
      crew = safe(() => {
        const c = createCrew({
          theme: theme.theme,
          seed: (theme.seed != null ? theme.seed : 42) ^ 0x4c1e,
          curve,
          width: theme.width || 12,
          gapZones: theme.gapZones || [],
          quality: settings.quality,
          lighting: modules.lighting,
          density: settings.crewDensity != null ? settings.crewDensity : 1,
        });
        if (scene) scene.add(c.group);
        return c;
      }, 'crew', failures);
      modules.crew = crew;
    }

    // Raised red-and-white apex kerbing.
    if (settings.kerbs !== false) {
      kerbs = safe(() => {
        const k = createKerbs({
          theme: theme.theme,
          seed: (theme.seed != null ? theme.seed : 42) ^ 0x77c1,
          curve,
          width: theme.width || 12,
          gapZones: theme.gapZones || [],
          quality: settings.quality,
          density: settings.kerbDensity != null ? settings.kerbDensity : 1,
        });
        if (scene) scene.add(k.group);
        return k;
      }, 'kerbs', failures);
      modules.kerbs = kerbs;
    }

    // The detailed city beyond the barriers. `skyline.js` is a no-op outside the
    // urban themes, so this runs for every track and only city/tokyo grow towers.
    if (settings.skyline !== false) {
      skyline = safe(() => {
        const s = createSkyline({
          theme: theme.theme,
          seed: (theme.seed != null ? theme.seed : 42) ^ 0x5cd107,
          curve,
          width: theme.width || 12,
          gapZones: theme.gapZones || [],
          quality: settings.quality,
          lighting: modules.lighting,
          density: settings.skylineDensity != null ? settings.skylineDensity : (settings.dynamicDensity || 1),
        });
        if (scene) scene.add(s.group);
        return s;
      }, 'skyline', failures);
      modules.skyline = skyline;
    }

    // Farmland, hedgerows, farmsteads and leaves. Note the seed is passed
    // **unmangled**: `rural.js` rebuilds the track's own terrain noise from it, so
    // its fields and buildings sit on the exact hills the rest of the game draws
    // rather than floating over them.
    if (settings.rural !== false) {
      rural = safe(() => {
        const r = createRural({
          theme: theme.theme,
          seed: theme.seed != null ? theme.seed : 42,
          curve,
          width: theme.width || 12,
          gapZones: theme.gapZones || [],
          quality: settings.quality,
          density: settings.ruralDensity != null ? settings.ruralDensity : 1,
        });
        if (scene) scene.add(r.group);
        return r;
      }, 'rural', failures);
      modules.rural = rural;
    }

    // The three remote themes: alpine rock and snow, desert mesas and saguaro,
    // coastal sand and lighthouses. Like `rural.js` this rebuilds the track's
    // terrain noise, so it needs the **unmangled** track seed; a no-op for the
    // themes that have their own layer above.
    if (settings.wilds !== false) {
      wilds = safe(() => {
        const w = createWilds({
          theme: theme.theme,
          seed: theme.seed != null ? theme.seed : 42,
          curve,
          width: theme.width || 12,
          gapZones: theme.gapZones || [],
          quality: settings.quality,
          density: settings.wildsDensity != null ? settings.wildsDensity : 1,
          lighting: modules.lighting,
        });
        if (scene && w.group.children.length) scene.add(w.group);
        return w;
      }, 'wilds', failures);
      modules.wilds = wilds;
    }
  }

  // The legacy sky dome is hidden once ours is live (see attachLegacy).
  let legacySky = null;
  let attachedSun = null;

  /* -------------------------------------------------------------- public API ---- */

  function setQuality(name) {
    if (!QUALITY_PRESETS[name]) return;
    settings.quality = name;
    Object.assign(settings, QUALITY_PRESETS[name]);
    modules.post && modules.post.setQuality(name);
    modules.lighting && modules.lighting.setQuality(name);
    modules.shadows && modules.shadows.setQuality(name);
    modules.sky && modules.sky.setQuality(name);
    modules.volumetrics && modules.volumetrics.setParams({ quality: name });
  }

  /**
   * Apply a track's art direction: sky recipe, atmosphere density, grade preset
   * and exposure. Called when a race/scene starts.
   *
   * @param {{theme?:string, timeOfDay?:number, weather?:string, isNight?:boolean,
   *          wetness?:number, fogScale?:number}} theme
   */
  function setTheme(theme = {}) {
    const name = theme.theme || 'countryside';
    const profile = opts.ignoreProfiles ? {} : (THEME_PROFILES[name] || THEME_PROFILES.countryside);
    state.theme = name;

    const timeOfDay = theme.timeOfDay != null ? theme.timeOfDay : (profile.timeOfDay != null ? profile.timeOfDay : 12);
    state.timeOfDay = timeOfDay;
    state.weather = theme.weather || profile.weather || 'clear';
    state.wetness = theme.wetness != null ? theme.wetness : (profile.wetness || 0);
    state.fogScale = theme.fogScale != null ? theme.fogScale : (profile.fogScale != null ? profile.fogScale : 1);

    // Lift the hour past the horizon into a night flag when not supplied.
    const night = theme.isNight != null
      ? theme.isNight
      : (profile.night != null ? profile.night : (timeOfDay < 6.4 || timeOfDay > 18.6));
    state.isNight = night;

    if (modules.sky) {
      if (profile.sky) modules.sky.setParams(profile.sky);
      modules.sky.setQuality(settings.quality);
    }
    if (modules.volumetrics) {
      const v = { ...(profile.volumetrics || {}) };
      // Theme densities are artistic 0..1 scales. The shader integrates
      // optical density per metre, where ~0.05 is a light haze. Feeding the
      // raw 0.5–1.25 values straight in made the air opaque within a few
      // metres, blacking out the entire lower half of the screen.
      const base = v.density != null ? v.density : 0.7;
      state.volumetricDensity = base * 0.05;
      v.density = state.volumetricDensity * state.fogScale;
      if (v.maxDistance != null) v.maxDistance *= 0.4 + 0.6 * state.fogScale;
      modules.volumetrics.setParams(v);
    }
    if (modules.post && profile.grade) {
      const gradeEffect = modules.post.effects.find((e) => e.name === 'colorgrade');
      if (gradeEffect && gradeEffect.setPreset) gradeEffect.setPreset(profile.grade);
    }
    if (profile.exposure != null) settings.exposureGain = profile.exposure;

    // Night sky leans cold; the grade handles the rest.
    settings.temperature = night ? -0.12 : 0.0;

    // Rebuild the trackside content for the new theme (only when a track curve
    // was supplied — theme colour changes alone do not need a rebuild).
    if (theme.curve) buildTrackContent(theme);
    if (modules.cinematic) {
      modules.cinematic.setTrack({ curve: theme.curve || null, width: theme.width });
    }
    if (modules.weatherfx) modules.weatherfx.setWeather(state.weather);

    // Re-bake the environment probe for the new lighting conditions.
    if (modules.reflections) {
      modules.reflections.bake({
        theme: state.theme,
        timeOfDay: state.timeOfDay,
        isNight: state.isNight,
        weather: state.weather,
        sunDirection: modules.sky ? modules.sky.sunDirection : null,
        force: true,
      });
    }
  }

  /**
   * Adopt the legacy weather sky + directional light:
   *  - hide the old sky dome so it does not fight our atmosphere;
   *  - register the old sun with the cascaded shadow manager (much tighter,
   *    higher-resolution shadows across the whole view distance).
   *
   * Passing `null` restores the legacy behaviour.
   */
  function attachLegacy({ sky, sunLight, disableLights = false } = {}) {
    if (legacySky && modules.sky && !sky) legacySky.visible = true;
    legacySky = sky || null;
    if (legacySky && modules.sky) legacySky.visible = false;

    if (attachedSun && modules.shadows) {
      // Nothing to unregister: the manager keeps the entry, but flipping
      // castShadow off is enough to hand control back.
      attachedSun.castShadow = false;
      attachedSun = null;
    }
    if (sunLight && modules.shadows) {
      modules.shadows.register(sunLight);
      attachedSun = sunLight;
      if (renderer && renderer.shadowMap) renderer.shadowMap.enabled = true;
    }

    if (disableLights && sunLight) {
      // If the engine owns lighting instead, mute the legacy directional so the
      // two suns do not double up.
      sunLight.intensity = 0;
    }
  }

  /** Register a street light (props call this as they spawn lamps). */
  function addStreetlight(position, color, opts2) {
    return modules.lighting ? modules.lighting.addStreetlight(position, color, opts2) : null;
  }

  /** Register an additive neon bloom billboard. */
  function addNeonGlow(position, color, size, opts2) {
    return modules.lighting ? modules.lighting.addNeonGlow(position, color, size, opts2) : null;
  }

  /** Register a light shaft (helicopter, search light, fireworks). */
  function addLightShaft(position, color, intensity, radius) {
    return modules.volumetrics
      ? modules.volumetrics.addLightShaft(position, color, intensity, radius)
      : null;
  }

  function setSize(width, height) {
    const pr = renderer && renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    modules.post && modules.post.setSize(width, height);
    modules.volumetrics && modules.volumetrics.setSize(Math.floor(width * pr), Math.floor(height * pr));
  }

  /**
   * Advance every sub-system. `ctx` is optional and merged over the engine's own
   * state, so callers can pass only what changed.
   */
  function update(dt, ctx = {}) {
    state.elapsed += dt;
    if (ctx.timeOfDay != null) state.timeOfDay = ctx.timeOfDay;
    if (ctx.weather) state.weather = ctx.weather;
    if (ctx.isNight != null) state.isNight = ctx.isNight;
    if (ctx.wetness != null) state.wetness = ctx.wetness;
    if (ctx.fogScale != null) state.fogScale = ctx.fogScale;
    if (ctx.speed01 != null) state.speed01 = ctx.speed01;

    const sunDirection = ctx.sunDirection || (modules.sky && modules.sky.sunDirection) || EMPTY_V3;

    const full = {
      renderer, scene, camera,
      deltaTime: dt,
      elapsed: state.elapsed,
      timeOfDay: state.timeOfDay,
      weather: state.weather,
      isNight: state.isNight,
      wetness: state.wetness,
      speed01: state.speed01,
      sunDirection,
      sunColor: ctx.sunColor,
      camera: ctx.camera || camera,
      focus: ctx.focus,
      heading: ctx.heading,
      gForceLat: ctx.gForceLat,
      settings,
      letterbox: ctx.letterbox,
      damage01: ctx.damage01,
      focusDistance: ctx.focusDistance,
      racePhase: ctx.racePhase,
      groundY: ctx.groundY,
    };

    modules.sky && modules.sky.update(dt, full);
    if (modules.lighting) {
      // Keep the rig's clock in lock-step with the weather system's hour.
      modules.lighting.setTimeOfDay(state.timeOfDay);
      modules.lighting.update(dt, full);
    }
    modules.shadows && modules.shadows.update(dt, full);
    if (modules.volumetrics) {
      // Keep the current theme's base density and only modulate it with the
      // weather. This used to overwrite it with `fogScale * 0.9 + 0.1` (≈1.0
      // on a clear day), which is dense enough to hide the car and the road.
      full.wetness = state.wetness;
      modules.volumetrics.setParams({
        density: (state.volumetricDensity != null ? state.volumetricDensity : 0.05) * state.fogScale,
        groundY: ctx.groundY != null ? ctx.groundY : 0,
      });
      modules.volumetrics.update(dt, full);
    }
    // The camera director runs after the host has placed the camera for the
    // frame: it may drive a shot outright, or just add auto-focus and a lens
    // kick. Either way it fills focusDistance/letterbox for the post chain
    // below, unless the caller supplied its own.
    if (modules.cinematic) {
      modules.cinematic.update(dt, full);
      modules.cinematic.applyToCamera(dt, full);
      if (ctx.letterbox == null) {
        full.letterbox = modules.cinematic.letterbox > 0.002 ? modules.cinematic.letterbox : undefined;
      }
      if (ctx.focusDistance == null) full.focusDistance = modules.cinematic.focusDistance;
    }

    if (modules.post) {
      full.exposure = settings.exposureGain;
      modules.post.update(dt, full);
    }

    // World content + shared material clock.
    if (props) props.update(dt, full);
    if (dynamicProps) dynamicProps.update(dt, full);
    if (screens) screens.update(dt, full);
    if (roadDetail) roadDetail.update(dt, full);
    if (crew) crew.update(dt, full);
    if (kerbs) kerbs.update(dt, full);
    if (skyline) skyline.update(dt, full);
    if (rural) rural.update(dt, full);
    if (wilds) wilds.update(dt, full);
    if (decals) decals.update(dt, full);
    if (modules.weatherfx) {
      full.groundY = ctx.groundY != null ? ctx.groundY : 0;
      modules.weatherfx.update(dt, full);
    }
    updateMaterials(dt, full);

    // Keep the IBL probe in step with the sky (cheap: it early-outs unless the
    // hour/weather/theme actually moved).
    if (modules.reflections) {
      full.theme = state.theme;
      modules.reflections.update(dt, full);
    }
  }

  /** Render one frame through the advanced post pipeline. */
  function render(dt) {
    if (modules.post) modules.post.render(dt);
    else if (renderer) renderer.render(scene, camera);
  }

  function dispose() {
    if (legacySky) legacySky.visible = true;
    // Track content lives in the caller's scene, not this engine's: take it back
    // out before releasing its buffers, or a disposed engine leaves a ghost
    // circuit (and a skyline) parented behind it.
    for (const m of [props, dynamicProps, screens, roadDetail, crew, kerbs, skyline, rural, wilds]) {
      if (m && m.group && m.group.parent) m.group.parent.remove(m.group);
    }
    if (props) { try { props.dispose(); } catch (e) { /* ignore */ } props = null; }
    if (dynamicProps) { try { dynamicProps.dispose(); } catch (e) { /* ignore */ } dynamicProps = null; }
    if (screens) { try { screens.dispose(); } catch (e) { /* ignore */ } screens = null; }
    if (roadDetail) { try { roadDetail.dispose(); } catch (e) { /* ignore */ } roadDetail = null; }
    if (crew) { try { crew.dispose(); } catch (e) { /* ignore */ } crew = null; }
    if (kerbs) { try { kerbs.dispose(); } catch (e) { /* ignore */ } kerbs = null; }
    if (skyline) { try { skyline.dispose(); } catch (e) { /* ignore */ } skyline = null; }
    if (rural) { try { rural.dispose(); } catch (e) { /* ignore */ } rural = null; }
    if (wilds) { try { wilds.dispose(); } catch (e) { /* ignore */ } wilds = null; }
    for (const key of Object.keys(modules)) {
      const m = modules[key];
      if (m && m.dispose) {
        try { m.dispose(); } catch (e) { /* ignore */ }
      }
      modules[key] = null;
    }
  }

  return {
    modules,
    failures,
    settings,
    state,
    setQuality,
    setTheme,
    buildTrackContent,
    attachLegacy,
    addStreetlight,
    addNeonGlow,
    addLightShaft,
    setSize,
    update,
    render,
    dispose,
    get sky() { return modules.sky; },
    get lighting() { return modules.lighting; },
    get shadows() { return modules.shadows; },
    get volumetrics() { return modules.volumetrics; },
    get post() { return modules.post; },
    get props() { return props || modules.props; },
    get dynamicprops() { return dynamicProps || modules.dynamicprops; },
    get screens() { return screens || modules.screens; },
    get roaddetail() { return roadDetail || modules.roaddetail; },
    get crew() { return crew || modules.crew; },
    get kerbs() { return kerbs || modules.kerbs; },
    get skyline() { return skyline || modules.skyline; },
    get rural() { return rural || modules.rural; },
    get wilds() { return wilds || modules.wilds; },
    get decals() { return decals; },
    get weatherfx() { return modules.weatherfx; },
    get reflections() { return modules.reflections; },
    get cinematic() { return modules.cinematic; },
    get ownsSky() { return !!modules.sky; },
  };
}

export default { createGraphicsEngine, THEME_PROFILES };
