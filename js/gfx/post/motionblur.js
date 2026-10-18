import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * motionblur.js — camera + radial per-pixel motion blur.
 *
 * For every pixel the shader reconstructs the view-space position from the
 * depth buffer, projects it with the PREVIOUS frame's view-projection matrix to
 * obtain a motion vector, and then integrates the colour along that vector with
 * a small number of jittered taps. On top of the true reprojection velocity it
 * adds a radial "speed" term that ramps with `ctx.speed01`, which is what gives
 * a racing game that aggressive warp when you floor it.
 *
 * The module keeps the previous camera matrix internally — the integrator only
 * has to call `update(dt, ctx)` once per frame before rendering.
 */

const MotionBlurShader = {
  name: 'MotionBlurShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.25 },
    cameraFar: { value: 2000 },
    inverseProjection: { value: new THREE.Matrix4() },
    cameraMatrixWorld: { value: new THREE.Matrix4() },
    prevViewProjection: { value: new THREE.Matrix4() },
    velocityScale: { value: 1.0 },
    speedBlur: { value: 0.0 },
    maxVelocity: { value: 32.0 },
    samples: { value: 10.0 },
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
    uniform float cameraNear;
    uniform float cameraFar;
    uniform mat4 inverseProjection;
    uniform mat4 cameraMatrixWorld;
    uniform mat4 prevViewProjection;
    uniform float velocityScale;
    uniform float speedBlur;
    uniform float maxVelocity;
    uniform float samples;
    varying vec2 vUv;

    const int MAX_TAPS = 16;

    // Reconstruct the view-space position of a pixel from its depth.
    vec3 viewPosition( vec2 uv, float depth ) {
      vec4 clip = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
      vec4 view = inverseProjection * clip;
      return view.xyz / view.w;
    }

    void main() {
      vec4 center = texture2D( tDiffuse, vUv );
      float depth = texture2D( tDepth, vUv ).x;

      vec3 viewPos = viewPosition( vUv, depth );
      vec4 world = cameraMatrixWorld * vec4( viewPos, 1.0 );
      vec4 prevClip = prevViewProjection * world;

      vec2 prevUv = vUv;
      if ( abs( prevClip.w ) > 1e-5 ) {
        prevUv = ( prevClip.xy / prevClip.w ) * 0.5 + 0.5;
      }

      // True reprojection velocity, plus a radial component for the racing feel.
      vec2 velocity = ( vUv - prevUv ) * velocityScale;
      velocity += ( vUv - 0.5 ) * speedBlur;

      // Clamp so disocclusion at the screen edge does not smear across frame.
      float vlen = length( velocity * resolution );
      if ( vlen > maxVelocity ) velocity *= maxVelocity / vlen;

      int taps = int( clamp( samples, 1.0, float( MAX_TAPS ) ) );
      vec3 accum = center.rgb;
      float weight = 1.0;

      for ( int i = 1; i < MAX_TAPS; i++ ) {
        if ( i >= taps ) break;
        float fi = float( i );
        float t = ( fi / float( taps ) ) - 0.5;
        // Slight per-pixel jitter removes the banding of a fixed tap pattern.
        float jitter = fract( sin( dot( vUv + fi, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
        vec2 offset = velocity * ( t + jitter / float( taps ) );
        vec2 uv = clamp( vUv + offset, vec2( 0.0 ), vec2( 1.0 ) );

        vec3 s = texture2D( tDiffuse, uv ).rgb;
        // Reject taps whose depth differs wildly (background bleeding onto car).
        float sd = texture2D( tDepth, uv ).x;
        float valid = 1.0 - smoothstep( 0.0, 0.02, abs( sd - depth ) );
        float w = mix( 0.25, 1.0, valid );
        accum += s * w;
        weight += w;
      }

      gl_FragColor = vec4( accum / max( weight, 1e-4 ), 1.0 );
    }
  `,
};

/**
 * @param {{ width:number, height:number }} opts
 */
export function createMotionBlurEffect(opts = {}) {
  const pass = new ShaderPass(MotionBlurShader);
  pass.uniforms.resolution.value.set(opts.width || 1, opts.height || 1);

  // Scratch matrices (never allocate in update()).
  const viewProjection = new THREE.Matrix4();
  const identity = new THREE.Matrix4();
  let hasPrev = false;
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
    const usable = enabled && !!depth;
    pass.enabled = usable;
    if (!usable) {
      hasPrev = false;
      return;
    }

    const cam = ctx.camera;
    const u = pass.uniforms;

    u.tDepth.value = depth;
    u.cameraNear.value = cam ? cam.near : (ctx.cameraNear || 0.25);
    u.cameraFar.value = cam ? cam.far : (ctx.cameraFar || 2000);
    u.inverseProjection.value.copy(cam ? cam.projectionMatrixInverse : identity);
    u.cameraMatrixWorld.value.copy(cam ? cam.matrixWorld : identity);

    if (cam) {
      viewProjection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      if (!hasPrev) u.prevViewProjection.value.copy(viewProjection);
      // First frame has no history: keep it to avoid a full-frame smear.
      hasPrev = true;
    }

    u.velocityScale.value = (ctx.settings && ctx.settings.motionBlurScale) || 1.0;
    u.speedBlur.value = (ctx.speed01 || 0) * ((ctx.settings && ctx.settings.speedBlur) != null
      ? ctx.settings.speedBlur : 0.04);
    u.samples.value = (ctx.settings && ctx.settings.motionBlurSamples) || 10;
  }

  /** Called by the pipeline AFTER render to latch this frame's matrix. */
  function commit() {
    pass.uniforms.prevViewProjection.value.copy(viewProjection);
  }

  function dispose() {
    pass.material.dispose();
  }

  return {
    name: 'motionblur',
    passes: [pass],
    commit,
    setSize,
    update,
    setEnabled,
    dispose,
  };
}
