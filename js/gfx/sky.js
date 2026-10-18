import * as THREE from 'three';

/* ==================================================================
 * js/gfx/sky.js — physically based atmospheric sky
 *
 * Technique: a single-scattering **Nishita / Preetham-style** analytic
 * atmosphere raymarched inside a camera-locked BackSide sphere.
 *
 *   1. Primary ray  — ray/sphere intersection against the planet and the
 *      atmosphere shell, marched with a uniform step. Per step we
 *      accumulate the Rayleigh and Mie optical depth (`exp(-h/H)` height
 *      profiles) of the view ray.
 *   2. Light ray    — a nested march toward the sun produces the optical
 *      depth shadowed by the atmosphere, which is what gives the
 *      reddening at sunset and the bright aureole around the sun.
 *   3. Phase        — Rayleigh (1+cos²) and Henyey-Greenstein Mie phase
 *      functions weight the in-scattered energy, so the forward Mie lobe
 *      paints the sun glow and the cirrus-lit horizon.
 *
 * On top of that physically motivated core the shader layers the
 * "cinematic" elements a racing shot needs:
 *
 *   - sun disc with an Eddington limb-darkening profile, attenuated by
 *     the same atmospheric transmittance (so it melts into the horizon),
 *   - a moon that computes a real phase from `dot(normal · sunDir)` on a
 *     sphere reconstructed from the disc's local tangent frame,
 *   - a procedural, hash-lattice star field that twinkles and fades in
 *     with a dark-adapted night factor, plus an fBm milky-way band,
 *   - procedural cirrus (anisotropic domain-warped fBm) on a fixed
 *     altitude plane, advected by wind,
 *   - a horizon haze term that scatters toward the viewer and ties the
 *     dome into the scene fog.
 *
 * Everything is one draw call, produces **linear HDR** (no tone mapping)
 * so the post pipeline's OutputPass owns the grade.
 * ================================================================== */

/** @type {Readonly<Record<string, number>>} */
const DEFAULT_PARAMS = Object.freeze({
  turbidity: 2.4,
  rayleigh: 1.0,
  mieCoefficient: 1.0,
  mieDirectionalG: 0.78,
  sunIntensity: 24.0,
  cloudCoverage: 0.34,
  starBrightness: 1.0,
  moonIntensity: 0.55,
  hazeStrength: 0.35,
});

// Per-weather sky recipe. `sun` dims the direct beam, `cover` drives the
// cirrus layer, `turbid`/`mie` thicken the atmosphere, `haze` pushes the
// horizon haze term. Blended with damping so weather flips never pop.
const WEATHER_SKY = {
  clear: { sun: 1.0, cover: 0.14, turbid: 2.2, mie: 0.9, haze: 0.22, stars: 1.0 },
  overcast: { sun: 0.34, cover: 0.9, turbid: 5.0, mie: 1.6, haze: 0.62, stars: 0.25 },
  rain: { sun: 0.26, cover: 0.84, turbid: 4.2, mie: 1.5, haze: 0.7, stars: 0.2 },
  storm: { sun: 0.16, cover: 0.97, turbid: 7.0, mie: 2.1, haze: 0.85, stars: 0.1 },
  fog: { sun: 0.42, cover: 0.62, turbid: 9.0, mie: 2.6, haze: 1.0, stars: 0.15 },
  snow: { sun: 0.46, cover: 0.88, turbid: 6.0, mie: 2.0, haze: 0.78, stars: 0.25 },
  petals: { sun: 0.95, cover: 0.2, turbid: 2.0, mie: 0.85, haze: 0.24, stars: 1.0 },
  leaves: { sun: 0.9, cover: 0.26, turbid: 2.6, mie: 1.0, haze: 0.3, stars: 0.95 },
};

const VERTEX_SHADER = /* glsl */`
  // Gap-free horizon: the sphere is centred on the camera and rotated with
  // it, so the world-space offset is exactly the view direction.
  uniform vec3 uCameraPos;
  varying vec3 vWorldDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4( position, 1.0 );
    vWorldDir = worldPos.xyz - uCameraPos;

    vec4 clip = projectionMatrix * viewMatrix * worldPos;
    // Standard skybox trick: clamp to the far plane (z = w) so the huge dome
    // is never clipped by the camera far plane, even on a tight frustum.
    gl_Position = clip.xyww;
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  uniform vec3  uCameraPos;
  uniform float uCameraHeight;      // metres above the planet surface

  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform float uSunSize;           // angular radius, radians

  uniform vec3  uMoonDir;
  uniform vec3  uMoonColor;
  uniform float uMoonIntensity;
  uniform float uMoonSize;
  uniform float uMoonPhaseBias;

  uniform vec3  uGroundColor;
  uniform vec3  uHazeColor;
  uniform vec3  uMilkyNormal;

  uniform float uTurbidity;
  uniform float uRayleigh;          // multiplier on βR
  uniform float uMie;               // multiplier on βM
  uniform float uMieG;              // Henyey-Greenstein anisotropy

  uniform float uTime;
  uniform float uStarBrightness;
  uniform float uNightFactor;       // 1 = fully dark adapted
  uniform float uWeatherHaze;       // 0..1 extra horizon haze
  uniform float uCloudCoverage;
  uniform float uCloudHeight;
  uniform float uCloudWind;
  uniform float uScatterScale;      // artistic HDR gain on the integral

  uniform float uPrimarySteps;
  uniform float uLightSteps;

  varying vec3 vWorldDir;

  const float PI = 3.141592653589793;
  // Planet/atmosphere radii in metres (Earth), used as the scattering model.
  const float R_PLANET = 6360000.0;
  const float R_ATMOS  = 6420000.0;
  const float H_RAYLEIGH = 8000.0;   // Rayleigh scale height
  const float H_MIE = 1200.0;        // Mie (aerosol) scale height
  const int   MAX_PRIMARY = 18;
  const int   MAX_LIGHT = 8;

  // ---- ray / sphere -------------------------------------------------
  bool raySphere( vec3 o, vec3 d, float r, out float t0, out float t1 ) {
    float b = dot( o, d );
    float c = dot( o, o ) - r * r;
    float disc = b * b - c;
    if ( disc < 0.0 ) return false;
    disc = sqrt( disc );
    t0 = -b - disc;
    t1 = -b + disc;
    return true;
  }

  // ---- phase functions ---------------------------------------------
  float rayleighPhase( float cosTheta ) {
    return ( 3.0 / ( 16.0 * PI ) ) * ( 1.0 + cosTheta * cosTheta );
  }
  float miePhase( float cosTheta, float g ) {
    float g2 = g * g;
    float denom = 1.0 - 2.0 * g * cosTheta + g2;
    return ( 1.0 / ( 4.0 * PI ) ) * ( ( 1.0 - g2 ) / pow( max( denom, 1e-4 ), 1.5 ) );
  }

  // ---- light-ray optical depth -------------------------------------
  // Marches from p toward the sun collecting the Rayleigh/Mie density
  // integral. Returns a huge value when the planet blocks the light ray so
  // the resulting transmittance underflows to black (horizon terminator).
  vec2 lightOpticalDepth( vec3 p, vec3 sunDir ) {
    float pt0, pt1;
    if ( raySphere( p, sunDir, R_PLANET, pt0, pt1 ) && pt1 > 0.0 ) {
      return vec2( 1.0e9 );
    }
    float t0, t1;
    if ( !raySphere( p, sunDir, R_ATMOS, t0, t1 ) ) return vec2( 1.0e9 );

    float len = max( t1, 0.0 );
    float ds = len / float( MAX_LIGHT );
    float odR = 0.0;
    float odM = 0.0;
    for ( int i = 0; i < MAX_LIGHT; i++ ) {
      if ( float( i ) >= uLightSteps ) break;
      vec3 sp = p + sunDir * ( ( float( i ) + 0.5 ) * ds );
      float h = max( length( sp ) - R_PLANET, 0.0 );
      odR += exp( -h / H_RAYLEIGH ) * ds;
      odM += exp( -h / H_MIE ) * ds;
    }
    return vec2( odR, odM );
  }

  // ---- cheap procedural noise --------------------------------------
  float hash11( float n ) { return fract( sin( n ) * 43758.5453123 ); }
  float hash21( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }
  float hash31( vec3 p ) {
    p = fract( p * 0.1031 );
    p += dot( p, p.yzx + 33.33 );
    return fract( ( p.x + p.y ) * p.z );
  }
  vec3 hash33( vec3 p ) {
    p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
    p += dot( p, p.yxz + 33.33 );
    return fract( ( p.xxy + p.yxx ) * p.zyx );
  }
  float vnoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    float a = hash21( i );
    float b = hash21( i + vec2( 1.0, 0.0 ) );
    float c = hash21( i + vec2( 0.0, 1.0 ) );
    float d = hash21( i + vec2( 1.0, 1.0 ) );
    return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
  }
  // 5 octaves is plenty for cirrus filaments and costs a fraction of a
  // raymarch step, so it runs after the scattering loop only.
  float fbm5( vec2 p ) {
    float s = 0.0;
    float a = 0.5;
    for ( int i = 0; i < 5; i++ ) {
      s += a * vnoise( p );
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
  // Octahedral mapping so 2D noise can be sampled over the whole sphere.
  vec2 octEncode( vec3 n ) {
    n /= ( abs( n.x ) + abs( n.y ) + abs( n.z ) + 1e-5 );
    vec2 uv = n.xz;
    if ( n.y < 0.0 ) uv = ( 1.0 - abs( n.zx ) ) * sign( uv + 1e-6 );
    return uv;
  }

  // ---- star field ---------------------------------------------------
  // One hash-lattice cell per ~0.5° patch of sky; a sparse fraction of the
  // cells spawn a point sprite with a colour temperature and a twinkle.
  vec3 starField( vec3 dir ) {
    vec3 p = dir * 190.0;
    vec3 id = floor( p );
    vec3 f = fract( p ) - 0.5;

    float spawn = hash31( id );
    float density = mix( 0.62, 1.0, clamp( uNightFactor, 0.0, 1.0 ) );
    if ( spawn < density ) return vec3( 0.0 );

    vec3 off = ( hash33( id + 3.17 ) - 0.5 ) * 0.72;
    float d = length( f - off );
    float core = smoothstep( 0.085, 0.0, d );
    if ( core <= 0.0 ) return vec3( 0.0 );

    float mag = pow( hash31( id + 7.31 ), 3.4 );
    // twinkle: two incommensurate sines per star, phase from its own hash
    float tw = 0.62 + 0.38 * sin( uTime * ( 2.4 + hash31( id + 1.7 ) * 7.0 ) + hash31( id + 9.3 ) * 6.2831 );
    // colour temperature: blue-white giants through amber dwarfs
    vec3 tint = mix(
      vec3( 0.72, 0.82, 1.0 ),
      vec3( 1.0, 0.88, 0.72 ),
      hash31( id + 13.7 )
    );
    return tint * core * mag * tw;
  }

  // ---- main ---------------------------------------------------------
  void main() {
    vec3 dir = normalize( vWorldDir );

    // Rayleigh βR and aerosol βM, both scaled by the artistic multipliers.
    vec3 betaR = vec3( 5.5e-6, 13.0e-6, 22.4e-6 ) * uRayleigh;
    float turb = clamp( ( uTurbidity - 1.4 ) / 8.6, 0.0, 1.0 );
    vec3 betaM = vec3( 21.0e-6 ) * uMie * mix( 0.55, 2.6, turb );

    // The camera rides a hair above the planet surface in world Y.
    vec3 origin = vec3( 0.0, R_PLANET + uCameraHeight, 0.0 );

    float cosTheta = dot( dir, uSunDir );
    float rPhase = rayleighPhase( cosTheta );
    float mPhase = miePhase( cosTheta, clamp( uMieG, 0.0, 0.98 ) );

    // Atmosphere entry/exit, clipped by the planet when the ray hits ground.
    float a0, a1;
    float p0, p1;
    bool hitAtmos = raySphere( origin, dir, R_ATMOS, a0, a1 );
    bool hitPlanet = raySphere( origin, dir, R_PLANET, p0, p1 ) && p1 > 0.0;

    float start = max( a0, 0.0 );
    float end = hitAtmos ? ( hitPlanet ? min( p0, a1 ) : a1 ) : 0.0;
    if ( !hitAtmos ) start = 1.0;                    // nothing to integrate
    end = max( end, start );

    float dt = ( end - start ) / float( MAX_PRIMARY );
    float odR = 0.0;
    float odM = 0.0;
    vec3 sumR = vec3( 0.0 );
    vec3 sumM = vec3( 0.0 );

    for ( int i = 0; i < MAX_PRIMARY; i++ ) {
      if ( float( i ) >= uPrimarySteps ) break;
      vec3 p = origin + dir * ( start + ( float( i ) + 0.5 ) * dt );
      float h = max( length( p ) - R_PLANET, 0.0 );

      float dR = exp( -h / H_RAYLEIGH );
      float dM = exp( -h / H_MIE );
      odR += dR * dt;
      odM += dM * dt;

      // Sun visibility from this sample (atmosphere self-shadowing).
      vec2 lod = lightOpticalDepth( p, uSunDir );
      vec3 tau = betaR * ( odR + lod.x ) + betaM * 1.1 * ( odM + lod.y );
      vec3 trans = exp( -tau );

      sumR += dR * trans * dt;
      sumM += dM * trans * dt;
    }

    vec3 scatter = uSunIntensity * uScatterScale * ( sumR * betaR * rPhase + sumM * betaM * mPhase );

    // ---- ground bounce (only visible through gaps / below the horizon)
    if ( hitPlanet ) {
      vec3 gp = origin + dir * min( p0, 400000.0 );
      vec3 gn = normalize( gp - vec3( 0.0, R_PLANET, 0.0 ) );
      vec2 lod = lightOpticalDepth( gp, uSunDir );
      vec3 gtau = betaR * lod.x + betaM * 1.1 * lod.y;
      float sunUp = max( dot( gn, uSunDir ), 0.0 );
      vec3 ground = uGroundColor * ( 0.05 + 0.95 * sunUp ) * exp( -gtau ) * uSunIntensity * uScatterScale;
      scatter = mix( ground, scatter, 0.42 );
    }

    // ---- milky way: an fBm band along a tilted great circle ----------
    float bandMask = exp( -pow( dot( dir, uMilkyNormal ) * 6.2, 2.0 ) );
    if ( bandMask > 0.002 ) {
      vec2 oct = octEncode( dir );
      float mw = fbm5( oct * 3.1 + 11.0 ) * 0.75 + fbm5( oct * 9.0 ) * 0.25;
      // dark dust lanes carved by a second, higher-frequency octave
      float dust = smoothstep( 0.32, 0.68, fbm5( oct * 4.4 - 5.0 ) );
      scatter += vec3( 0.62, 0.66, 0.86 ) * bandMask * dust * mw
               * 0.09 * uStarBrightness * uNightFactor;
    }

    // ---- stars -------------------------------------------------------
    if ( uNightFactor > 0.01 ) {
      vec3 stars = starField( dir );
      // clouds and haze swallow the fainter stars
      float occl = 1.0 - clamp( uCloudCoverage, 0.0, 1.0 ) * 0.85;
      scatter += stars * uStarBrightness * uNightFactor * occl * 1.6;
    }

    // ---- sun disc with Eddington limb darkening ----------------------
    float sunAng = acos( clamp( cosTheta, -1.0, 1.0 ) );
    if ( sunAng < uSunSize * 1.6 ) {
      vec2 lodSun = lightOpticalDepth( origin + vec3( 0.0, 1.0, 0.0 ), uSunDir );
      vec3 sunT = exp( -( betaR * lodSun.x + betaM * 1.1 * lodSun.y ) );
      float disc = 1.0 - smoothstep( uSunSize * 0.88, uSunSize * 1.02, sunAng );
      // I(mu) ~ 1 - u(1 - mu), the classical Eddington limb profile
      float rho = clamp( sunAng / max( uSunSize, 1e-4 ), 0.0, 1.0 );
      float mu = sqrt( max( 1.0 - rho * rho, 0.0 ) );
      float limb = 0.28 + 0.72 * pow( max( mu, 0.0 ), 0.55 );
      scatter += uSunColor * uSunIntensity * uScatterScale * limb * disc * sunT * 1.6;
    }

    // ---- moon (real phase from the reconstructed sphere) -------------
    float moonCos = dot( dir, uMoonDir );
    float moonAng = acos( clamp( moonCos, -1.0, 1.0 ) );
    if ( moonAng < uMoonSize * 1.8 ) {
      vec3 upRef = abs( uMoonDir.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
      vec3 tx = normalize( cross( upRef, uMoonDir ) );
      vec3 ty = cross( uMoonDir, tx );
      vec2 q = vec2( dot( dir, tx ), dot( dir, ty ) ) / max( uMoonSize, 1e-4 );
      float r2 = dot( q, q );

      // soft halo around the disc
      float halo = exp( -moonAng * 26.0 ) * 0.05;
      scatter += uMoonColor * halo * uMoonIntensity * uNightFactor;

      if ( r2 < 1.0 ) {
        // Rebuild the sphere normal of the moon surface this pixel hits…
        vec3 n = tx * q.x + ty * q.y + uMoonDir * sqrt( max( 1.0 - r2, 0.0 ) );
        // …then light it: the terminator falls where n·sunDir flips sign.
        float lambert = dot( n, uSunDir );
        float lit = smoothstep( -0.045, 0.045, lambert + uMoonPhaseBias );
        float limb = pow( sqrt( max( 1.0 - r2, 0.0 ) ), 0.42 );
        // faint maria via low-frequency noise on the disc
        float maria = 0.74 + 0.26 * vnoise( q * 1.9 + 4.0 );
        scatter += uMoonColor * uMoonIntensity * lit * limb * maria * 0.9;
      }
    }

    // ---- cirrus layer -------------------------------------------------
    // Project the view ray onto a fixed altitude plane; domain-warp + an
    // anisotropic noise stretch yields the filamented cirrus look.
    if ( uCloudCoverage > 0.004 && dir.y > 0.006 ) {
      float t = ( uCloudHeight - uCameraHeight ) / dir.y;
      vec2 planeUv = dir.xz * t * 0.0016;
      vec2 drift = vec2( uTime * uCloudWind, uTime * uCloudWind * 0.31 );
      vec2 uv = planeUv + drift;
      vec2 warp = vec2( fbm5( uv * 0.55 + 3.1 ), fbm5( uv * 0.55 - 7.7 ) ) - 0.5;
      float n = fbm5( ( uv + warp * 0.55 ) * vec2( 1.15, 4.4 ) );
      float cover = smoothstep( 1.28 - uCloudCoverage * 1.25, 1.55 - uCloudCoverage * 1.25, n );

      // fade into the horizon so the plane never shows a hard edge
      float horizonFade = smoothstep( 0.0, 0.16, dir.y ) * ( 1.0 - 0.35 * smoothstep( 0.8, 1.0, dir.y ) );
      float alpha = cover * horizonFade * clamp( uCloudCoverage * 1.35, 0.0, 1.0 );

      vec2 lodSun = lightOpticalDepth( origin + vec3( 0.0, uCloudHeight, 0.0 ), uSunDir );
      vec3 sunT = exp( -( betaR * lodSun.x + betaM * 1.1 * lodSun.y ) );
      float fwd = pow( max( dot( dir, uSunDir ), 0.0 ), 6.0 );
      vec3 cloudLit = uSunColor * uSunIntensity * uScatterScale * sunT * 0.35 * ( 0.35 + 0.65 * fwd );

      // silver lining: thinner edges forward-scatter more, cores stay grey
      vec3 cloudBody = mix( uHazeColor * 1.4, cloudLit, smoothstep( 0.1, 0.9, n ) );
      scatter = mix( scatter, cloudBody, alpha * 0.92 );
    }

    // ---- horizon haze --------------------------------------------------
    // Exponential falloff away from the horizon plane keeps the dome glued
    // to the scene fog without flattening the zenith.
    float hz = exp( -max( dir.y, 0.0 ) * 5.5 ) * uWeatherHaze;
    scatter += uHazeColor * hz * uSunIntensity * uScatterScale * 0.06;

    gl_FragColor = vec4( max( scatter, 0.0 ), 1.0 );
  }
`;

/**
 * Build a camera-locked atmospheric sky dome.
 *
 * @param {{ renderer?: THREE.WebGLRenderer, scene?: THREE.Scene }} deps
 * @returns {{
 *   mesh: THREE.Mesh,
 *   material: THREE.ShaderMaterial,
 *   sunDirection: THREE.Vector3,
 *   moonDirection: THREE.Vector3,
 *   update(dt: number, ctx?: object): void,
 *   setParams(p: object): void,
 *   setQuality(q: string): void,
 *   dispose(): void,
 * }}
 */
export function createSky({ renderer, scene } = {}) {
  const params = { ...DEFAULT_PARAMS };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uCameraHeight: { value: 42 },
      uSunDir: { value: new THREE.Vector3(0.3, 0.5, 0.2).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.94, 0.86) },
      uSunIntensity: { value: params.sunIntensity },
      uSunSize: { value: 0.0085 },
      uMoonDir: { value: new THREE.Vector3(-0.3, -0.5, -0.2).normalize() },
      uMoonColor: { value: new THREE.Color(0.82, 0.87, 1.0) },
      uMoonIntensity: { value: params.moonIntensity },
      uMoonSize: { value: 0.014 },
      uMoonPhaseBias: { value: 0 },
      uGroundColor: { value: new THREE.Color(0.16, 0.15, 0.14) },
      uHazeColor: { value: new THREE.Color(0.66, 0.72, 0.82) },
      uMilkyNormal: { value: new THREE.Vector3(0.42, 0.78, -0.46).normalize() },
      uTurbidity: { value: params.turbidity },
      uRayleigh: { value: params.rayleigh },
      uMie: { value: params.mieCoefficient },
      uMieG: { value: params.mieDirectionalG },
      uTime: { value: 0 },
      uStarBrightness: { value: params.starBrightness },
      uNightFactor: { value: 0 },
      uWeatherHaze: { value: params.hazeStrength },
      uCloudCoverage: { value: params.cloudCoverage },
      uCloudHeight: { value: 2200 },
      uCloudWind: { value: 0.004 },
      uScatterScale: { value: 0.85 },
      uPrimarySteps: { value: 12 },
      uLightSteps: { value: 5 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    fog: false,
  });

  // Small camera-locked dome + the depth-less material above means the
  // vertex shader can never be clipped and the shader owns every pixel.
  const geometry = new THREE.SphereGeometry(60, 32, 20);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'gfxSky';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = true;
  // Drawn before anything else so the rest of the scene composites on top.
  mesh.renderOrder = -1000;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  if (scene) scene.add(mesh);

  const u = material.uniforms;

  // ---- transient state (all scalars, nothing allocated per frame) ----
  const sunDirection = new THREE.Vector3(0.3, 0.5, 0.2).normalize();
  const moonDirection = new THREE.Vector3(-0.3, -0.5, -0.2).normalize();
  const weatherNow = { sun: 1, cover: params.cloudCoverage, turbid: params.turbidity, mie: params.mieCoefficient, haze: params.hazeStrength, stars: 1 };
  const weatherWant = { ...weatherNow };

  let time = 0;
  let timeOfDay = 10;
  let exposure = renderer ? renderer.toneMappingExposure : 1.05;
  let starBrightness = params.starBrightness;
  let userOverrides = false;

  // Empty context so `update(dt)` without a ctx object is safe.
  const EMPTY_CTX = {};

  /**
   * Resolve the sun/moon direction from a 0..24 clock. Matches the path
   * used by the legacy weather system (same azimuth plane, z = +0.30) so
   * the two skies never fight over where the sun is.
   */
  function updateDirections() {
    const sunAngle = ((timeOfDay - 6) / 12) * Math.PI;
    const sx = Math.cos(sunAngle);
    const sy = Math.sin(sunAngle);
    sunDirection.set(sx, sy, 0.3).normalize();

    const moonAngle = sunAngle + Math.PI;
    moonDirection.set(Math.cos(moonAngle), Math.sin(moonAngle), -0.35).normalize();
  }

  function applyWeatherRecipe(name) {
    const r = WEATHER_SKY[name] || WEATHER_SKY.clear;
    weatherWant.sun = r.sun;
    weatherWant.cover = r.cover;
    weatherWant.turbid = r.turbid;
    weatherWant.mie = r.mie;
    weatherWant.haze = r.haze;
    weatherWant.stars = r.stars;
  }

  /**
   * @param {object} p overrides: turbidity, rayleigh, mieCoefficient,
   *   mieDirectionalG, sunIntensity, cloudCoverage, starBrightness
   */
  function setParams(p) {
    if (!p) return;
    const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

    if (p.turbidity !== undefined) params.turbidity = num(p.turbidity, 1, 20, params.turbidity);
    if (p.rayleigh !== undefined) params.rayleigh = num(p.rayleigh, 0, 4, params.rayleigh);
    if (p.mieCoefficient !== undefined) params.mieCoefficient = num(p.mieCoefficient, 0, 6, params.mieCoefficient);
    if (p.mieDirectionalG !== undefined) params.mieDirectionalG = num(p.mieDirectionalG, 0, 0.98, params.mieDirectionalG);
    if (p.sunIntensity !== undefined) params.sunIntensity = num(p.sunIntensity, 0, 120, params.sunIntensity);
    if (p.cloudCoverage !== undefined) params.cloudCoverage = num(p.cloudCoverage, 0, 1, params.cloudCoverage);
    if (p.starBrightness !== undefined) {
      params.starBrightness = num(p.starBrightness, 0, 4, params.starBrightness);
      starBrightness = params.starBrightness;
    }
    if (p.moonIntensity !== undefined) params.moonIntensity = num(p.moonIntensity, 0, 4, params.moonIntensity);
    if (p.hazeStrength !== undefined) params.hazeStrength = num(p.hazeStrength, 0, 1.5, params.hazeStrength);

    // Explicit artistic values win over the weather recipe until the next
    // weather change, so calling code can dial the sky directly.
    if (p.cloudCoverage !== undefined || p.turbidity !== undefined || p.mieCoefficient !== undefined) {
      userOverrides = true;
      weatherNow.cover = params.cloudCoverage;
      weatherNow.turbid = params.turbidity;
      weatherNow.mie = params.mieCoefficient;
    }
  }

  /** Scale the raymarch resolution with the GPU budget. */
  function setQuality(q) {
    const table = {
      low: { primary: 8, light: 3 },
      medium: { primary: 12, light: 4 },
      high: { primary: 16, light: 6 },
      ultra: { primary: 18, light: 8 },
    };
    const t = table[q] || table.high;
    u.uPrimarySteps.value = t.primary;
    u.uLightSteps.value = t.light;
  }

  // Pick a sane starting budget from the device pixel ratio.
  try {
    const pr = renderer && renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    setQuality(pr > 1.5 ? 'medium' : 'high');
  } catch (e) {
    setQuality('medium');
  }

  function update(dt, ctx) {
    const c = ctx || EMPTY_CTX;
    const step = Math.min(Math.max(dt || 0, 0), 0.25);
    time += step;

    if (typeof c.timeOfDay === 'number' && isFinite(c.timeOfDay)) {
      timeOfDay = ((c.timeOfDay % 24) + 24) % 24;
    }

    updateDirections();

    // Weather recipe (damped so a weather flip ramps instead of popping).
    const name = typeof c.weather === 'string' ? c.weather : null;
    if (name) applyWeatherRecipe(name);

    const k = 1 - Math.exp(-1.6 * step);
    weatherNow.sun += (weatherWant.sun - weatherNow.sun) * k;
    weatherNow.haze += (weatherWant.haze - weatherNow.haze) * k;
    weatherNow.stars += (weatherWant.stars - weatherNow.stars) * k;
    if (!userOverrides) {
      weatherNow.cover += (weatherWant.cover - weatherNow.cover) * k;
      weatherNow.turbid += (weatherWant.turbid - weatherNow.turbid) * k;
      weatherNow.mie += (weatherWant.mie - weatherNow.mie) * k;
    }

    // Intensity-weighted recipe numbers, with explicit ctx overrides.
    let turbidity = params.turbidity * (weatherNow.turbid / Math.max(DEFAULT_PARAMS.turbidity, 1e-3));
    let mie = params.mieCoefficient * weatherNow.mie;
    let cover = userOverrides ? params.cloudCoverage : weatherNow.cover;
    let haze = params.hazeStrength * weatherNow.haze;

    if (typeof c.turbidity === 'number' && isFinite(c.turbidity)) turbidity = c.turbidity;
    if (typeof c.mieCoefficient === 'number' && isFinite(c.mieCoefficient)) mie = c.mieCoefficient;

    if (typeof c.exposure === 'number' && isFinite(c.exposure) && c.exposure > 0) exposure = c.exposure;

    // Night factor: 1 when the sun is well below the horizon.
    const sunElev = sunDirection.y;
    const night = 1 - THREE.MathUtils.smoothstep(sunElev, -0.14, 0.06);

    u.uCameraPos.value.copy(c.camera ? c.camera.position : mesh.position);
    u.uCameraHeight.value = Math.max(u.uCameraHeight.value, 8);
    u.uSunDir.value.copy(sunDirection);
    u.uMoonDir.value.copy(moonDirection);
    u.uSunIntensity.value = params.sunIntensity * weatherNow.sun
      // fade the direct beam out below the horizon and let the moon take over
      * (0.25 + 0.75 * THREE.MathUtils.smoothstep(sunElev, -0.08, 0.18));
    u.uMoonIntensity.value = params.moonIntensity * (0.35 + 0.65 * night);
    u.uTurbidity.value = THREE.MathUtils.clamp(turbidity, 1, 20);
    u.uRayleigh.value = params.rayleigh;
    u.uMie.value = THREE.MathUtils.clamp(mie, 0, 6);
    u.uMieG.value = params.mieDirectionalG;
    u.uCloudCoverage.value = THREE.MathUtils.clamp(cover, 0, 1);
    u.uStarBrightness.value = starBrightness;
    u.uNightFactor.value = night;
    u.uWeatherHaze.value = THREE.MathUtils.clamp(haze, 0, 1.5);
    u.uTime.value = time;

    // Exposure compensation: the post pipeline applies the real exposure at
    // the very end, but a night sky that is pushed up by auto-exposure needs
    // a matching, gentle lift here so the stars do not go pitch black.
    u.uScatterScale.value = 0.85 * Math.pow(THREE.MathUtils.clamp(exposure, 0.3, 3.0), 0.45);

    // Moon phase bias tracks the sun/moon geometry: the disc's terminator is
    // driven by dot(n, sunDir), so nothing else is needed — this only nudges
    // the terminator softness as the pair drifts apart over the night.
    const sep = THREE.MathUtils.clamp(sunDirection.dot(moonDirection), -1, 1);
    u.uMoonPhaseBias.value = 0.02 * sep;

    // Keep the dome welded to the camera.
    if (c.camera) mesh.position.copy(c.camera.position);
  }

  updateDirections();

  function dispose() {
    if (mesh.parent) mesh.parent.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return {
    mesh,
    material,
    sunDirection,
    moonDirection,
    update,
    setParams,
    setQuality,
    dispose,
  };
}
