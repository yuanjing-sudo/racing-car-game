import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * godrays.js — volumetric light shafts from the sun.
 *
 * Classic screen-space radial scattering: from every pixel we march a ray
 * toward the sun's projected screen position, accumulating scene colour only
 * where the sampled depth belongs to the sky (or far geometry). Buildings,
 * trees, gantries and the car therefore cut dark wedges out of the beam and the
 * gaps glow — the shafts you see blasting between skyscrapers at dusk.
 *
 * The sun's screen position is projected on the CPU from `ctx.sunDirection`; the
 * pass fades out when the sun leaves the frame, when night falls, or when the
 * sun is fully occluded.
 */

const GodRaysShader = {
  name: 'GodRaysShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    sunScreenPos: { value: new THREE.Vector2(0.5, 1.2) },
    density: { value: 0.92 },
    decay: { value: 0.955 },
    weight: { value: 0.32 },
    exposure: { value: 0.72 },
    samples: { value: 48.0 },
    tint: { value: new THREE.Color(1.0, 0.82, 0.58) },
    skyThreshold: { value: 0.9995 },
    near: { value: 0.25 },
    far: { value: 2000 },
    intensity: { value: 1.0 },
    // Computed each frame on the CPU.
    visibility: { value: 0.0 },
    screenEdge: { value: 0.0 },
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
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform vec2 sunScreenPos;
    uniform float density;
    uniform float decay;
    uniform float weight;
    uniform float exposure;
    uniform float samples;
    uniform vec3 tint;
    uniform float skyThreshold;
    uniform float intensity;
    uniform float visibility;
    uniform float screenEdge;
    varying vec2 vUv;

    const int MAX_SAMPLES = 64;

    void main() {
      vec4 scene = texture2D( tDiffuse, vUv );

      if ( visibility <= 0.001 || intensity <= 0.001 ) {
        gl_FragColor = scene;
        return;
      }

      int taps = int( clamp( samples, 4.0, float( MAX_SAMPLES ) ) );

      // Ray from this pixel toward the sun, spaced by density.
      vec2 delta = ( vUv - sunScreenPos ) / ( float( taps ) * density );

      vec2 coord = vUv;
      float illumination = 1.0;
      vec3 accum = vec3( 0.0 );
      float norm = 0.0;

      for ( int i = 0; i < MAX_SAMPLES; i++ ) {
        if ( i >= taps ) break;
        coord -= delta;

        // Only sky/far samples scatter; geometry blocks the beam.
        float d = texture2D( tDepth, coord ).x;
        float sky = smoothstep( skyThreshold, 1.0, d );

        vec3 s = texture2D( tDiffuse, coord ).rgb;
        // Weight bright samples more so the shafts follow the light source.
        float luma = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );

        accum += s * sky * illumination * ( 0.35 + luma );
        norm += sky * illumination;
        illumination *= decay;
      }

      vec3 shafts = accum / max( norm, 1e-4 ) * weight * exposure * intensity * visibility * screenEdge;
      shafts *= tint;

      // Screen-blend the shafts over the scene so highlights stay highlights.
      vec3 result = 1.0 - ( 1.0 - scene.rgb ) * ( 1.0 - shafts );
      gl_FragColor = vec4( result, scene.a );
    }
  `,
};

/**
 * @param {{ width:number, height:number }} opts
 */
export function createGodRaysEffect(opts = {}) {
  const pass = new ShaderPass(GodRaysShader);
  pass.uniforms.resolution.value.set(opts.width || 1, opts.height || 1);

  const sunWorld = new THREE.Vector3();
  const projected = new THREE.Vector3();
  let enabled = true;

  function setSize(w, h) {
    pass.uniforms.resolution.value.set(Math.max(1, w), Math.max(1, h));
  }

  function setEnabled(b) {
    enabled = !!b;
    pass.enabled = enabled;
  }

  function update(dt, ctx = {}) {
    const depth = ctx.depthTexture || null;
    const night = !!ctx.isNight;
    const usable = enabled && !!depth && !night;
    pass.enabled = usable;
    if (!enabled) return;
    if (!usable) {
      pass.uniforms.visibility.value = 0;
      return;
    }

    const cam = ctx.camera;
    const u = pass.uniforms;
    u.tDepth.value = depth;
    u.near.value = cam ? cam.near : (ctx.cameraNear || 0.25);
    u.far.value = cam ? cam.far : (ctx.cameraFar || 2000);

    const dir = ctx.sunDirection;
    if (dir && cam) {
      // Place the sun far along its direction, then project to screen space.
      sunWorld.copy(dir).multiplyScalar(2000).add(cam.position);
      projected.copy(sunWorld).project(cam);

      const sx = projected.x * 0.5 + 0.5;
      const sy = projected.y * 0.5 + 0.5;
      const behind = projected.z > 1.0;
      u.sunScreenPos.value.set(sx, sy);

      // Fade with the sun's distance from screen centre / off-screen margins.
      const margin = 0.15;
      const edge = THREE.MathUtils.smoothstep(1.0, 1.0 - margin, Math.abs(sx - 0.5) * 2.0) *
                   THREE.MathUtils.smoothstep(1.0, 1.0 - margin, Math.abs(sy - 0.5) * 2.0);
      u.screenEdge.value = behind ? 0.0 : edge;

      // The sun only casts shafts when it is above the horizon.
      const above = THREE.MathUtils.clamp(dir.y * 4.0, 0.0, 1.0);
      u.visibility.value = above * (1.0 - (ctx.wetness || 0) * 0.35);
    } else {
      u.visibility.value = 0;
    }

    u.intensity.value = (ctx.settings && ctx.settings.godraysIntensity) != null
      ? ctx.settings.godraysIntensity : 1.0;
    u.samples.value = (ctx.settings && ctx.settings.godraysSamples) || 48;
  }

  function dispose() {
    pass.material.dispose();
  }

  return {
    name: 'godrays',
    passes: [pass],
    setSize,
    update,
    setEnabled,
    dispose,
  };
}
