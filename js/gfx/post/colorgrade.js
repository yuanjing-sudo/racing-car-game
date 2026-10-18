import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * colorgrade.js — the film grade.
 *
 * A single ShaderPass that turns the flat linear-HDR render into something that
 * looks photographed: exposure, temperature, filmic contrast, lift/gain, split
 * toning (warm highlights / cool shadows), saturation + vibrance, lifted blacks,
 * halation, a filmic vignette, radial chromatic aberration, animated grain, an
 * unsharp sharpen and a cinematic letterbox.
 *
 * Everything is driven through uniforms so the quality settings and the game
 * state (speed, night, damage) can push it around at runtime. The pass works in
 * linear HDR and deliberately does NOT tone-map — the pipeline's OutputPass does.
 */

const ColorGradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },

    // --- camera / film response ------------------------------------
    exposure: { value: 1.0 },
    temperature: { value: 0.0 },   // -1 cool .. +1 warm
    contrast: { value: 1.04 },
    pivot: { value: 0.18 },        // contrast pivot in linear light
    fade: { value: 0.045 },        // lifted blacks (film stock)

    // --- colour shaping --------------------------------------------
    lift: { value: new THREE.Vector3(0.006, 0.004, 0.012) },
    gain: { value: new THREE.Vector3(1.02, 1.0, 0.98) },
    shadowTint: { value: new THREE.Color(0.16, 0.24, 0.42) },
    highlightTint: { value: new THREE.Color(0.46, 0.36, 0.22) },
    splitAmount: { value: 0.16 },
    saturation: { value: 1.08 },
    vibrance: { value: 0.18 },

    // --- lens ------------------------------------------------------
    vignette: { value: 0.34 },
    vignetteSoftness: { value: 0.62 },
    chroma: { value: 0.0016 },
    grain: { value: 0.02 },
    sharpen: { value: 0.32 },
    halation: { value: 0.14 },

    // --- framing ---------------------------------------------------
    letterbox: { value: 0.0 },
    letterboxAspect: { value: 2.39 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float exposure;
    uniform float temperature;
    uniform float contrast;
    uniform float pivot;
    uniform float fade;
    uniform vec3 lift;
    uniform vec3 gain;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;
    uniform float splitAmount;
    uniform float saturation;
    uniform float vibrance;
    uniform float vignette;
    uniform float vignetteSoftness;
    uniform float chroma;
    uniform float grain;
    uniform float sharpen;
    uniform float halation;
    uniform float letterbox;
    uniform float letterboxAspect;
    varying vec2 vUv;

    const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

    float luminance( vec3 c ) { return dot( c, LUMA ); }

    // Fast, stable 2D hash for the film grain.
    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r2 = dot( center, center );

      // --- radial chromatic aberration ------------------------------
      // Sample the three channels at slightly different radii so highlights
      // smear into rainbow edges away from the centre of frame.
      vec2 ca = center * chroma * ( 1.0 + r2 * 3.0 );
      vec3 col;
      col.r = texture2D( tDiffuse, uv - ca ).r;
      col.g = texture2D( tDiffuse, uv ).g;
      col.b = texture2D( tDiffuse, uv + ca ).b;

      // --- unsharp mask --------------------------------------------
      vec2 texel = 1.0 / resolution;
      vec3 blur = (
        texture2D( tDiffuse, uv + vec2( texel.x, 0.0 ) ).rgb +
        texture2D( tDiffuse, uv - vec2( texel.x, 0.0 ) ).rgb +
        texture2D( tDiffuse, uv + vec2( 0.0, texel.y ) ).rgb +
        texture2D( tDiffuse, uv - vec2( 0.0, texel.y ) ).rgb
      ) * 0.25;
      col += ( col - blur ) * sharpen;

      // --- halation (bright light bleeding warm) --------------------
      float lum = luminance( col );
      float bright = smoothstep( 0.55, 1.6, lum );
      vec3 halo = vec3( 0.0 );
      halo += texture2D( tDiffuse, uv + vec2( texel.x * 6.0, 0.0 ) ).rgb;
      halo += texture2D( tDiffuse, uv - vec2( texel.x * 6.0, 0.0 ) ).rgb;
      halo += texture2D( tDiffuse, uv + vec2( 0.0, texel.y * 6.0 ) ).rgb;
      halo += texture2D( tDiffuse, uv - vec2( 0.0, texel.y * 6.0 ) ).rgb;
      halo *= 0.25 * haloWeight( luminance( halo ) );
      col += halo * bright * halation * vec3( 1.0, 0.55, 0.35 );

      // --- exposure & white balance ---------------------------------
      col *= exposure;
      col += vec3( temperature * 0.035, temperature * 0.008, -temperature * 0.035 );

      // --- filmic contrast around the pivot -------------------------
      col = ( col - pivot ) * contrast + pivot;

      // --- lift / gain ----------------------------------------------
      col = col * gain + lift;

      // --- split toning ---------------------------------------------
      float t = smoothstep( 0.0, 0.8, luminance( col ) );
      vec3 toned = mix( shadowTint, highlightTint, t ) * 2.0;
      col = mix( col, col * toned + toned * 0.04, splitAmount );

      // --- saturation & vibrance ------------------------------------
      float l = luminance( col );
      col = mix( vec3( l ), col, saturation );
      float maxc = max( col.r, max( col.g, col.b ) );
      float sat = maxc - min( col.r, min( col.g, col.b ) );
      float vib = vibrance * ( 1.0 - sat );
      col = mix( vec3( l ), col, 1.0 + vib );

      // --- lifted blacks (film fade) --------------------------------
      col = col * ( 1.0 - fade ) + fade * vec3( 0.02, 0.024, 0.035 );

      // --- vignette --------------------------------------------------
      float vig = smoothstep( 0.85, vignetteSoftness, length( center ) * ( 1.0 + vignette ) );
      col *= mix( 1.0, vig, clamp( vignette, 0.0, 1.0 ) );

      // --- animated grain -------------------------------------------
      float g = hash12( uv * resolution + fract( time ) * 173.0 ) - 0.5;
      col += g * grain * ( 1.0 - luminance( col ) * 0.5 );

      // --- letterbox -------------------------------------------------
      if ( letterbox > 0.0 ) {
        float aspect = resolution.x / max( resolution.y, 1.0 );
        float target = letterboxAspect;
        float bar = 0.0;
        if ( aspect > target ) {
          // pillarbox (unlikely on landscape) — keep it robust anyway
          float w = target / aspect;
          bar = ( 1.0 - w ) * 0.5;
          if ( uv.x < bar * letterbox || uv.x > 1.0 - bar * letterbox ) col = vec3( 0.0 );
        } else {
          float h = aspect / target;
          bar = ( 1.0 - h ) * 0.5;
          if ( uv.y < bar * letterbox || uv.y > 1.0 - bar * letterbox ) col = vec3( 0.0 );
        }
      }

      gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
    }
  `,
};

/**
 * The halation weight is kept out of main() to keep the shader readable.
 * It is injected as a preprocessor define-free helper by string patching.
 */
ColorGradeShader.fragmentShader = ColorGradeShader.fragmentShader.replace(
  'float luminance( vec3 c ) { return dot( c, LUMA ); }',
  `float luminance( vec3 c ) { return dot( c, LUMA ); }
   float haloWeight( float l ) { return smoothstep( 0.2, 1.4, l ); }`
);

const PRESETS = {
  neutral: {},
  cinematic: { contrast: 1.1, saturation: 1.06, splitAmount: 0.2, vignette: 0.38, grain: 0.02, halation: 0.16 },
  golden: { temperature: 0.35, contrast: 1.06, highlightTint: new THREE.Color(0.6, 0.44, 0.22) },
  neon: { splitAmount: 0.42, shadowTint: new THREE.Color(0.1, 0.3, 0.6), highlightTint: new THREE.Color(0.7, 0.2, 0.45), saturation: 1.16, vibrance: 0.3, grain: 0.028 },
  bleach: { saturation: 0.72, contrast: 1.22, fade: 0.09, vignette: 0.44 },
};

/**
 * @param {{ width:number, height:number, preset?:string }} opts
 * @returns {{
 *   name:string, passes:THREE.Pass[], uniforms:object,
 *   setSize(w:number,h:number):void,
 *   update(dt:number, ctx:object):void,
 *   setEnabled(b:boolean):void,
 *   setPreset(name:string):void,
 *   setUniform(name:string, value:any):void,
 *   dispose():void
 * }}
 */
export function createColorGradeEffect(opts = {}) {
  const pass = new ShaderPass(ColorGradeShader);
  pass.renderToScreen = false;
  const u = pass.uniforms;
  let enabled = true;

  const defaults = {};
  for (const key of Object.keys(u)) {
    if (u[key].value && u[key].value.clone) defaults[key] = u[key].value.clone();
    else defaults[key] = u[key].value;
  }

  function applyPreset(name) {
    const p = PRESETS[name] || {};
    for (const key of Object.keys(u)) {
      const base = defaults[key];
      if (base && base.clone) u[key].value.copy(base);
      else u[key].value = base;
    }
    for (const key of Object.keys(p)) {
      const v = p[key];
      if (u[key] && u[key].value && u[key].value.copy) u[key].value.copy(v);
      else if (u[key]) u[key].value = v;
    }
  }

  if (opts.preset) applyPreset(opts.preset);

  function setSize(w, h) {
    u.resolution.value.set(Math.max(1, w), Math.max(1, h));
  }
  setSize(opts.width || 1, opts.height || 1);

  function setEnabled(b) {
    enabled = !!b;
    pass.enabled = enabled;
  }

  function update(dt, ctx = {}) {
    if (ctx.elapsed != null) u.time.value = ctx.elapsed;

    const s = ctx.settings || {};

    // Cinematic letterbox can be forced by the cinematic director through the
    // ctx (used by photo/replay mode) otherwise it follows the settings toggle.
    if (ctx.letterbox != null) u.letterbox.value = THREE.MathUtils.clamp(ctx.letterbox, 0, 1);

    // Night leans cooler and desaturated; the car's speed adds a touch of
    // contrast and vignette so fast laps feel more intense.
    if (ctx.isNight) {
      u.exposure.value = (s.exposureGain || 1.0) * 1.12;
      u.temperature.value = -0.12;
      u.saturation.value = 1.02;
    } else {
      u.exposure.value = (s.exposureGain || 1.0);
      u.temperature.value = (s.temperature || 0.0);
      u.saturation.value = 1.08;
    }

    const speed = ctx.speed01 || 0;
    u.vignette.value = 0.32 + speed * 0.22;
    u.chroma.value = 0.0012 + speed * 0.0026;
    u.halation.value = 0.12 + (ctx.isNight ? 0.12 : 0.0);
    u.grain.value = (s.filmGrain != null ? s.filmGrain : 0.02) + speed * 0.012;

    // Damage / crash feedback: desaturate and darken hard impacts.
    if (ctx.damage01 != null && ctx.damage01 > 0.01) {
      u.saturation.value *= (1.0 - ctx.damage01 * 0.4);
      u.vignette.value += ctx.damage01 * 0.3;
    }
  }

  function setUniform(name, value) {
    if (!u[name]) return;
    if (u[name].value && u[name].value.copy && value && value.isColor !== undefined) u[name].value.copy(value);
    else u[name].value = value;
  }

  function dispose() {
    pass.material.dispose();
  }

  return {
    name: 'colorgrade',
    passes: [pass],
    uniforms: u,
    get pass() { return pass; },
    setSize,
    update,
    setEnabled,
    setPreset: applyPreset,
    setUniform,
    dispose,
  };
}

export const COLOR_GRADE_PRESETS = Object.keys(PRESETS);
