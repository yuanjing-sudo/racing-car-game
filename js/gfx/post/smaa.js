import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * smaa.js — morphological antialiasing (SMAA-inspired).
 *
 * A compact, self-contained antialiasing pass in the spirit of SMAA/FXAA:
 *  1. luminance-based edge detection with a local contrast threshold;
 *  2. an edge-direction search that walks the edge to find its ends;
 *  3. directional blending, plus a sub-pixel term that softens remaining
 *     single-pixel stair-stepping on high-contrast silhouette edges.
 *
 * It runs as a single ShaderPass (no lookup textures) so it is cheap and cannot
 * break on a missing asset. Works in linear HDR, no tone mapping.
 */

const SmaaShader = {
  name: 'SmaaShader',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    edgeThreshold: { value: 0.0625 },
    edgeThresholdMin: { value: 0.004 },
    strength: { value: 0.85 },
    searchSteps: { value: 6.0 },
    subpixelQuality: { value: 0.72 },
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
    uniform float edgeThreshold;
    uniform float edgeThresholdMin;
    uniform float strength;
    uniform float searchSteps;
    uniform float subpixelQuality;
    varying vec2 vUv;

    const int MAX_SEARCH = 8;

    float luma( vec3 c ) {
      return sqrt( dot( c, vec3( 0.299, 0.587, 0.114 ) ) );
    }

    float sampleLuma( vec2 uv ) {
      return luma( texture2D( tDiffuse, uv ).rgb );
    }

    // Sample the RGB at a UV, or the 2x2 average when the UV is off-screen.
    vec3 sampleRGB( vec2 uv ) {
      if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) return vec3( 0.0 );
      return texture2D( tDiffuse, uv ).rgb;
    }

    void main() {
      vec2 texel = 1.0 / resolution;
      vec3 rgbM = texture2D( tDiffuse, vUv ).rgb;
      float lM = luma( rgbM );

      // --- 3x3 luminance neighbourhood -----------------------------
      float lNW = sampleLuma( vUv + vec2( -1.0, -1.0 ) * texel );
      float lNE = sampleLuma( vUv + vec2(  1.0, -1.0 ) * texel );
      float lSW = sampleLuma( vUv + vec2( -1.0,  1.0 ) * texel );
      float lSE = sampleLuma( vUv + vec2(  1.0,  1.0 ) * texel );
      float lN  = sampleLuma( vUv + vec2(  0.0, -1.0 ) * texel );
      float lS  = sampleLuma( vUv + vec2(  0.0,  1.0 ) * texel );
      float lW  = sampleLuma( vUv + vec2( -1.0,  0.0 ) * texel );
      float lE  = sampleLuma( vUv + vec2(  1.0,  0.0 ) * texel );

      float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
      float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
      float range = lMax - lMin;

      // Contrast-adaptive threshold: skip flat areas entirely.
      if ( range < max( edgeThresholdMin, lMax * edgeThreshold ) ) {
        gl_FragColor = vec4( rgbM, 1.0 );
        return;
      }

      // --- gradient (Sobel-style) ----------------------------------
      float gx = -lNW - 2.0 * lW - lSW + lNE + 2.0 * lE + lSE;
      float gy = -lNW - 2.0 * lN - lNE + lSW + 2.0 * lS + lSE;
      vec2 dir = vec2( gx, gy );

      float gradMag = max( abs( dir.x ), abs( dir.y ) );
      if ( gradMag < 1e-5 ) {
        gl_FragColor = vec4( rgbM, 1.0 );
        return;
      }
      vec2 dirNorm = dir / gradMag;

      // --- directional edge search ---------------------------------
      // Walk along the edge (perpendicular to the gradient) to find its ends.
      vec2 dirA = dirNorm * texel;
      float lA = sampleLuma( vUv + dirA ) * 0.5;
      float lA2 = sampleLuma( vUv + dirA * 2.0 ) * 0.25;
      vec2 dirB = -dirNorm * texel;
      float lB = sampleLuma( vUv + dirB ) * 0.5;
      float lB2 = sampleLuma( vUv + dirB * 2.0 ) * 0.25;

      float gradientA = abs( lA + lA2 - lM );
      float gradientB = abs( lB + lB2 - lM );

      float endA = 0.0;
      float endB = 0.0;
      int steps = int( clamp( searchSteps, 1.0, float( MAX_SEARCH ) ) );

      if ( gradientA >= gradientB ) {
        for ( int i = 0; i < MAX_SEARCH; i++ ) {
          if ( i >= steps ) break;
          float t = float( i ) + 1.0;
          vec2 uv = vUv + dirA * t;
          float l = sampleLuma( uv );
          if ( abs( l - lM ) >= range * 0.45 ) { endA = t; break; }
          endA = t;
        }
      } else {
        for ( int i = 0; i < MAX_SEARCH; i++ ) {
          if ( i >= steps ) break;
          float t = float( i ) + 1.0;
          vec2 uv = vUv + dirB * t;
          float l = sampleLuma( uv );
          if ( abs( l - lM ) >= range * 0.45 ) { endB = t; break; }
          endB = t;
        }
      }

      vec2 offset;
      float totalSpan = endA + endB;
      if ( totalSpan < 2.0 ) {
        // No clear edge endpoints — apply a light sub-pixel blur instead.
        offset = dirNorm * texel * ( subpixelQuality * 0.5 );
      } else {
        // Blend toward the shortest side of the detected edge span.
        float spanA = ( endA + 0.5 ) / ( totalSpan + 1.0 );
        offset = dirNorm * texel * ( 0.5 - spanA ) * 2.0;
      }

      offset *= strength;

      vec3 result = sampleRGB( vUv + offset );
      // Blend with the centre sample so we never over-soften.
      result = mix( rgbM, result, 0.82 );
      gl_FragColor = vec4( result, 1.0 );
    }
  `,
};

/**
 * @param {{ width:number, height:number }} opts
 */
export function createSmaaEffect(opts = {}) {
  const pass = new ShaderPass(SmaaShader);
  pass.uniforms.resolution.value.set(opts.width || 1, opts.height || 1);
  let enabled = true;

  function setSize(w, h) {
    pass.uniforms.resolution.value.set(Math.max(1, w), Math.max(1, h));
  }

  function setEnabled(b) {
    enabled = !!b;
    pass.enabled = enabled;
  }

  function update(dt, ctx = {}) {
    const s = ctx.settings || {};
    pass.enabled = enabled;
    if (!enabled) return;
    // Just-before-tone-mapping is where AA works best; the pipeline keeps this
    // pass last, so all we tune here is strength vs. quality.
    pass.uniforms.strength.value = s.aaStrength != null ? s.aaStrength : 0.85;
    pass.uniforms.searchSteps.value = s.aaSearchSteps || 6;
  }

  function dispose() {
    pass.material.dispose();
  }

  return {
    name: 'smaa',
    passes: [pass],
    setSize,
    update,
    setEnabled,
    dispose,
  };
}
