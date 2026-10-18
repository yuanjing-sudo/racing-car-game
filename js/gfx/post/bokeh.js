import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * bokeh.js — depth of field with circular/hexagonal bokeh.
 *
 * Two stages:
 *  1. CoC pass — linearises the depth buffer and writes a signed circle of
 *     confusion into the alpha channel of a private render target.
 *  2. Gather pass — samples the colour with a bokeh ring kernel whose radius is
 *     driven by |CoC|, weighted by a brightness term so bright out-of-focus
 *     highlights grow into that big soft disc that sells "filmed with a fast
 *     lens".
 *
 * The focus distance can be driven externally through `ctx.focusDistance`
 * (used by the cinematic director for focus pulls). Runs in linear HDR.
 */

const LINEAR_DEPTH = /* glsl */`
  float linearize( float d, float near, float far ) {
    float z = d * 2.0 - 1.0;
    return ( 2.0 * near * far ) / ( far + near - z * ( far - near ) );
  }
`;

/**
 * Stage 1: circle of confusion.
 * Outputs rgb = scene colour, a = signed CoC in [-1, 1].
 */
class CoCPass extends Pass {
  constructor(width, height) {
    super();
    this.needsSwap = false;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.25 },
        cameraFar: { value: 2000 },
        focusDistance: { value: 30 },
        focalLength: { value: 50 },
        fStop: { value: 2.8 },
        maxCoC: { value: 1.0 },
        resolution: { value: new THREE.Vector2(width, height) },
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
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float focusDistance;
        uniform float focalLength;
        uniform float fStop;
        uniform float maxCoC;
        varying vec2 vUv;
        ${LINEAR_DEPTH}
        void main() {
          vec3 col = texture2D( tDiffuse, vUv ).rgb;
          float depth = linearize( texture2D( tDepth, vUv ).x, cameraNear, cameraFar );
          // Thin-lens approximation: blur grows with |1/focus - 1/depth|.
          float coc = ( depth - focusDistance ) / max( depth, 1e-3 );
          coc = coc * ( focalLength / fStop ) * 0.02 * maxCoC;
          coc = clamp( coc, -1.0, 1.0 );
          gl_FragColor = vec4( col, coc );
        }
      `,
    });

    this.fsQuad = new FullScreenQuad(this.material);
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    this.fsQuad.render(renderer);
  }

  setSize(w, h) {
    this.rt.setSize(w, h);
    this.material.uniforms.resolution.value.set(w, h);
  }

  dispose() {
    this.material.dispose();
    this.rt.dispose();
    this.fsQuad.dispose();
  }
}

/** Stage 2: bokeh gather. */
const GatherShader = {
  name: 'BokehGatherShader',
  uniforms: {
    tDiffuse: { value: null },     // CoC texture (rgb + a = coc)
    resolution: { value: new THREE.Vector2(1, 1) },
    bokehScale: { value: 1.0 },
    maxRadius: { value: 14.0 },
    threshold: { value: 1.0 },
    luminance: { value: 0.65 },
    samples: { value: 24.0 },
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
    uniform float bokehScale;
    uniform float maxRadius;
    uniform float threshold;
    uniform float luminance;
    varying vec2 vUv;

    const int MAX_TAPS = 48;
    const float PI = 3.14159265;

    float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

    // Golden-angle spiral: evenly distributes taps over the disc while taking
    // the density to the edge (avoids the clumping of a plain ring kernel).
    void main() {
      vec4 center = texture2D( tDiffuse, vUv );
      float coc = center.a;
      float radius = min( abs( coc ) * maxRadius * bokehScale, maxRadius );

      if ( radius < 0.5 ) {
        gl_FragColor = vec4( center.rgb, 1.0 );
        return;
      }

      int taps = int( clamp( samples, 4.0, float( MAX_TAPS ) ) );
      vec2 texel = 1.0 / resolution;

      vec3 accum = center.rgb;
      float weight = 1.0;

      float golden = 2.39996323; // golden angle in radians
      for ( int i = 0; i < MAX_TAPS; i++ ) {
        if ( i >= taps ) break;
        float fi = float( i );
        // radius grows with sqrt so samples are area-uniform; jitter per pixel.
        float r = sqrt( ( fi + 0.5 ) / float( taps ) ) * radius;
        float theta = fi * golden + fract( sin( dot( vUv, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * PI;
        vec2 offset = vec2( cos( theta ), sin( theta ) ) * r * texel;

        vec4 s = texture2D( tDiffuse, vUv + offset );
        // Only gather samples on the same side of focus (foreground vs back).
        float side = sign( coc ) * sign( s.a );
        float accept = step( 0.0, side );
        // In-focus samples are pulled in sharply so the focal plane stays crisp.
        float sCoC = abs( s.a );
        float contrib = max( sCoC, step( abs( coc ) < 0.02, 1.0 ) );
        float w = accept * contrib;
        // Bright pixels bloom larger (bokeh discs are brighter than the scene).
        w *= 1.0 + smoothstep( threshold, threshold + 1.5, luma( s.rgb ) ) * luminance * 3.0;
        accum += s.rgb * w;
        weight += w;
      }

      gl_FragColor = vec4( accum / max( weight, 1e-4 ), 1.0 );
    }
  `,
};

/**
 * @param {{ width:number, height:number }} opts
 */
export function createBokehEffect(opts = {}) {
  const width = opts.width || 1;
  const height = opts.height || 1;

  const cocPass = new CoCPass(width, height);
  const gatherPass = new ShaderPass(GatherShader);
  gatherPass.uniforms.resolution.value.set(width, height);

  let enabled = true;
  let lastDepth = null;

  function setSize(w, h) {
    cocPass.setSize(w, h);
    gatherPass.uniforms.resolution.value.set(Math.max(1, w), Math.max(1, h));
  }

  function setEnabled(b) {
    enabled = !!b;
    cocPass.enabled = enabled;
    gatherPass.enabled = enabled;
  }

  function update(dt, ctx = {}) {
    const depth = ctx.depthTexture || null;
    // The coefficient pass is only useful with a depth buffer available.
    const usable = enabled && !!depth;
    cocPass.enabled = usable;
    gatherPass.enabled = usable;
    if (!usable) return;
    lastDepth = depth;

    const cu = cocPass.material.uniforms;
    cu.tDepth.value = depth;
    cu.cameraNear.value = ctx.cameraNear || 0.25;
    cu.cameraFar.value = ctx.cameraFar || 2000;
    cu.focusDistance.value = ctx.focusDistance != null ? ctx.focusDistance : focusFromSettings(ctx);
    cu.focalLength.value = (ctx.settings && ctx.settings.focalLength) || 50;
    cu.fStop.value = (ctx.settings && ctx.settings.fStop) || 2.8;
    cu.maxCoC.value = (ctx.settings && ctx.settings.maxCoC) || 1.0;

    // Finer bokeh at speed so the world smears behind the car.
    const speed = ctx.speed01 || 0;
    gatherPass.uniforms.bokehScale.value = 0.7 + speed * 0.5;
    gatherPass.uniforms.maxRadius.value = (ctx.settings && ctx.settings.bokehRadius) || 14.0;
    // The gather reads the CoC buffer written by the previous pass.
    gatherPass.uniforms.tDiffuse.value = cocPass.rt.texture;
  }

  function focusFromSettings(ctx) {
    // Default focus sits just ahead of the car (~12 m).
    if (ctx.settings && ctx.settings.focusDistance != null) return ctx.settings.focusDistance;
    return 12.0;
  }

  function dispose() {
    cocPass.dispose();
    gatherPass.material.dispose();
  }

  return {
    name: 'bokeh',
    passes: [cocPass, gatherPass],
    cocPass,
    gatherPass,
    setSize,
    update,
    setEnabled,
    dispose,
    get focusDistance() { return cocPass.material.uniforms.focusDistance.value; },
  };
}
