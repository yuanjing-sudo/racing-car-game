import * as THREE from 'three';

/* ==================================================================
 * js/gfx/volumetrics.js — raymarched height fog + light shafts
 *
 * Technique: an analytic **height-fog volume** raymarched inside a
 * camera-locked box that is rendered with depth test off, so the fog
 * composites over everything the way a post effect would but stays a
 * single scene draw call (the integrator does not have to add a pass).
 *
 *   - The fragment shader intersects the view ray with the box in world
 *     space (slab test) to get [tNear, tFar] — valid even when the camera
 *     is inside the volume — and clamps the far end to the fog draw
 *     distance.
 *   - The march integrates density with the classic Frostbite-style
 *     energy conserving step:  L += T * S * (1 - exp(-σ·dt))
 *     where σ = density · extinction and S is the in-scattered radiance.
 *   - Density uses an exponential height profile exp(-h/H) modulated by a
 *     **tileable 4-channel value-noise DataTexture** (four periodic
 *     octaves packed in RGBA, one fetch per octave bank) advected by wind
 *     — that is the drifting mist.
 *   - Sun in-scattering uses a Henyey-Greenstein phase function and an
 *     analytic transmittance integral along the slanted light ray:
 *         ∫ exp(-y/H) ds  =  exp(-h/H) · H / sunDir.y
 *     which gives correct-looking self-shadowing without a light march.
 *   - Up to 12 pooled light shafts (streetlights, headlights, lightning)
 *     inject both scattered radiance into the fog and an additive cone.
 *
 * Everything is preallocated: no per-frame allocation anywhere.
 * ================================================================== */

const MAX_SHAFTS = 12;

const VERTEX_SHADER = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  precision highp float;

  #define MAX_SHAFTS ${MAX_SHAFTS}
  #define MAX_STEPS 72

  uniform vec3  uCameraPos;
  uniform vec3  uBoxMin;
  uniform vec3  uBoxMax;
  uniform vec2  uScreenSize;
  uniform float uFrameJitter;

  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uFogColor;
  uniform vec3  uAmbientColor;
  uniform float uSunIntensity;
  uniform float uAmbient;
  uniform float uMieG;

  uniform float uGroundY;
  uniform float uHeightFalloff;
  uniform float uDensity;
  uniform float uExtinction;
  uniform float uMaxDistance;
  uniform vec3  uAbsorption;        // per-channel extinction of light in fog
  uniform float uNoiseScale;
  uniform float uNoiseAmount;
  uniform float uNoiseSpeed;
  uniform vec2  uWind;
  uniform float uTime;
  uniform float uSteps;
  uniform float uFarFade;

  uniform sampler2D uNoiseTex;

  uniform vec4 uShaftPos[ MAX_SHAFTS ];    // xyz = world position, w = radius
  uniform vec4 uShaftColor[ MAX_SHAFTS ];  // rgb = linear colour, w = intensity

  varying vec3 vWorldPos;

  // ---- slab test against the world-space fog box ---------------------
  vec2 intersectBox( vec3 ro, vec3 rd, vec3 bmin, vec3 bmax ) {
    vec3 inv = 1.0 / ( rd + vec3( 1e-6 ) );
    vec3 t0 = ( bmin - ro ) * inv;
    vec3 t1 = ( bmax - ro ) * inv;
    vec3 tmin = min( t0, t1 );
    vec3 tmax = max( t0, t1 );
    return vec2( max( max( tmin.x, tmin.y ), tmin.z ),
                 min( min( tmax.x, tmax.y ), tmax.z ) );
  }

  float hgPhase( float cosTheta, float g ) {
    float g2 = g * g;
    float d = 1.0 + g2 - 2.0 * g * cosTheta;
    return ( 1.0 - g2 ) / ( 4.0 * 3.14159265 * pow( max( d, 1e-4 ), 1.5 ) );
  }

  float hash13( vec3 p ) {
    p = fract( p * 0.1031 );
    p += dot( p, p.yzx + 33.33 );
    return fract( ( p.x + p.y ) * p.z );
  }

  // ---- drifting mist density ----------------------------------------
  float densityAt( vec3 p ) {
    float h = max( p.y - uGroundY, 0.0 );
    float base = uDensity * exp( -h / uHeightFalloff );

    vec3 np = vec3( p.x, p.y * 0.42, p.z ) * uNoiseScale;
    vec2 wind = uWind * uTime * uNoiseSpeed;
    // two fetches: the base band and a half-scale parallax band
    vec4 n = texture2D( uNoiseTex, np.xz + wind );
    vec4 m = texture2D( uNoiseTex, np.xz * 0.47 - wind * 0.37 + np.y * 0.11 );
    float noise = dot( n, vec4( 0.45, 0.28, 0.17, 0.10 ) );
    noise = mix( noise, dot( m, vec4( 0.45, 0.28, 0.17, 0.10 ) ), 0.45 );

    base *= mix( 1.0, noise * 2.05, uNoiseAmount );

    // fade the top of the volume so the box lid is never visible
    float topFade = 1.0 - smoothstep( 0.65, 1.0, h / ( uHeightFalloff * 4.0 ) );
    return max( base * topFade, 0.0 );
  }

  void main() {
    vec3 rd = normalize( vWorldPos - uCameraPos );
    vec2 hitT = intersectBox( uCameraPos, rd, uBoxMin, uBoxMax );
    float tNear = max( hitT.x, 0.0 );
    float tFar = min( hitT.y, uMaxDistance );
    if ( tFar <= tNear ) discard;

    float steps = uSteps;
    float dt = ( tFar - tNear ) / steps;

    // --- dithered start kills slice banding on a coarse step count ----
    float dither = hash13( vec3( gl_FragCoord.xy / uScreenSize, uFrameJitter ) );
    float tStart = tNear + dt * dither;

    float cosTheta = dot( rd, uSunDir );
    float phase = hgPhase( cosTheta, uMieG );
    float sunSlope = max( uSunDir.y, 0.06 );

    // ---- pooled light shafts -------------------------------------------
    // Rather than marching every shaft inside the density loop (O(steps x
    // shafts)), each shaft is integrated once at the point of closest
    // approach of the view ray, then attenuated by the fog in front of it.
    vec3 shaftScatter = vec3( 0.0 );
    for ( int i = 0; i < MAX_SHAFTS; i++ ) {
      float intensity = uShaftColor[ i ].w;
      if ( intensity <= 0.002 ) continue;
      vec3 lp = uShaftPos[ i ].xyz;
      float r = max( uShaftPos[ i ].w, 0.25 );

      float tc = clamp( dot( lp - uCameraPos, rd ), tStart, tFar );
      vec3 cp = uCameraPos + rd * tc;
      float dist = length( cp - lp );
      float att = ( r * r ) / ( r * r + dist * dist );
      float dens = densityAt( cp );
      float sunAngleTerm = 0.35 + 0.65 * hgPhase( dot( rd, normalize( lp - cp + 1e-4 ) ), 0.45 );
      // optical depth between the camera and the shaft sample
      float od = dens * uExtinction * tc;
      shaftScatter += uShaftColor[ i ].rgb * intensity * att * att * sunAngleTerm
                    * min( dens * 34.0, 1.0 ) * exp( -od * 0.35 );
    }

    vec3 baseScatter = uFogColor * uAmbient * uAmbientColor;
    vec3 color = vec3( 0.0 );
    float transmittance = 1.0;

    for ( int i = 0; i < MAX_STEPS; i++ ) {
      if ( float( i ) >= steps ) break;
      vec3 p = uCameraPos + rd * ( tStart + float( i ) * dt );
      float d = densityAt( p );

      if ( d > 1e-4 ) {
        // Analytic transmittance of the exponential height fog toward the
        // sun:  ∫ exp(-y/H) ds = exp(-h/H) · H / sunDir.y  along the
        // slanted light ray. Gives correct-looking fog self-shadowing
        // without a nested light march.
        float h = max( p.y - uGroundY, 0.0 );
        float sunPath = exp( -h / uHeightFalloff ) * uHeightFalloff / sunSlope;
        vec3 sunT = exp( -uAbsorption * d * sunPath * uExtinction * 0.55 );

        vec3 S = baseScatter
               + uSunColor * uSunIntensity * phase * sunT
               + shaftScatter;

        float sigma = d * uExtinction;
        float sampleT = exp( -sigma * dt );
        // energy conserving single-scatter integration over the step
        color += transmittance * S * ( 1.0 - sampleT );
        transmittance *= sampleT;
        if ( transmittance < 0.01 ) break;
      }
    }

    // Distance ramp: fade the volume out toward the draw limit so the box
    // never terminates with a visible wall of fog.
    float farFade = 1.0 - smoothstep( uMaxDistance * uFarFade, uMaxDistance, tFar );
    transmittance = mix( 1.0, transmittance, farFade );
    color *= farFade;

    gl_FragColor = vec4( color, 1.0 - transmittance );
  }
`;

/** Deterministic 32-bit PRNG so procedural placement is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tileable multi-octave value noise packed into RGBA: four channels hold
 * four periodic lattices (periods 4/8/16/32), so a single fetch yields a
 * 4-octave fBm and the fog march stays cheap. Mipmapped to keep the
 * distance aliasing down.
 */
function createNoiseTexture(size = 128, seed = 20240) {
  const rnd = mulberry32(seed);
  const data = new Uint8Array(size * size * 4);
  const periods = [4, 8, 16, 32];

  for (let ch = 0; ch < 4; ch++) {
    const p = periods[ch];
    const grid = new Float32Array(p * p);
    for (let i = 0; i < p * p; i++) grid[i] = rnd();

    for (let y = 0; y < size; y++) {
      const fy = (y / size) * p;
      const y0 = Math.floor(fy);
      const ya = y0 % p;
      const yb = (y0 + 1) % p;
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);

      for (let x = 0; x < size; x++) {
        const fx = (x / size) * p;
        const x0 = Math.floor(fx);
        const xa = x0 % p;
        const xb = (x0 + 1) % p;
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);

        const v00 = grid[ya * p + xa];
        const v10 = grid[ya * p + xb];
        const v01 = grid[yb * p + xa];
        const v11 = grid[yb * p + xb];
        const top = v00 + (v10 - v00) * tx;
        const bot = v01 + (v11 - v01) * tx;
        const v = top + (bot - top) * ty;
        data[(y * size + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }

  let tex = null;
  try {
    tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
  } catch (e) {
    tex = null;
  }
  return tex;
}

/** Soft vertical gradient for the additive light-shaft cones. */
function createShaftTexture() {
  let tex = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 128);
    tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
  } catch (e) {
    tex = null;
  }
  return tex;
}

/**
 * Build the volumetric fog volume and its light-shaft pool.
 *
 * @param {{ renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera }} deps
 * @returns {{
 *   group: THREE.Group,
 *   mesh: THREE.Mesh,
 *   update(dt: number, ctx?: object): void,
 *   addLightShaft(position: THREE.Vector3, color: THREE.ColorRepresentation, intensity?: number, radius?: number): number,
 *   setParams(p: object): void,
 *   setSize(w: number, h: number): void,
 *   dispose(): void,
 * }}
 */
export function createVolumetrics({ renderer, scene, camera } = {}) {
  const params = {
    density: 0.055,
    heightFalloff: 26,
    extinction: 1.0,
    maxDistance: 340,
    steps: 46,
    noiseScale: 0.017,
    noiseAmount: 0.55,
    noiseSpeed: 0.35,
    mieg: 0.52,
    sunIntensity: 1.6,
    ambient: 0.16,
    groundY: 0,
    topHeight: 90,
    windSpeed: 1.6,
    windDirection: 0.7,
    farFade: 0.72,
  };

  const group = new THREE.Group();
  group.name = 'gfxVolumetrics';
  group.matrixAutoUpdate = false;
  if (scene) scene.add(group);

  const noiseTexture = createNoiseTexture(128, 20240);
  const shaftTexture = createShaftTexture();

  const uniforms = {
    uCameraPos: { value: new THREE.Vector3() },
    uBoxMin: { value: new THREE.Vector3(-200, -10, -200) },
    uBoxMax: { value: new THREE.Vector3(200, 90, 200) },
    uScreenSize: { value: new THREE.Vector2(1280, 720) },
    uFrameJitter: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.5, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.95, 0.86) },
    uFogColor: { value: new THREE.Color(0.58, 0.64, 0.72) },
    uAmbientColor: { value: new THREE.Color(0.55, 0.62, 0.74) },
    uSunIntensity: { value: params.sunIntensity },
    uAmbient: { value: params.ambient },
    uMieG: { value: params.mieg },
    uGroundY: { value: params.groundY },
    uHeightFalloff: { value: params.heightFalloff },
    uDensity: { value: params.density },
    uExtinction: { value: params.extinction },
    uMaxDistance: { value: params.maxDistance },
    uAbsorption: { value: new THREE.Vector3(0.9, 1.06, 1.38) },
    uNoiseScale: { value: params.noiseScale },
    uNoiseAmount: { value: params.noiseAmount },
    uNoiseSpeed: { value: params.noiseSpeed },
    uWind: { value: new THREE.Vector2(1, 0.3) },
    uTime: { value: 0 },
    uSteps: { value: params.steps },
    uFarFade: { value: params.farFade },
    uNoiseTex: { value: noiseTexture },
    uShaftPos: { value: [] },
    uShaftColor: { value: [] },
  };
  for (let i = 0; i < MAX_SHAFTS; i++) {
    uniforms.uShaftPos.value.push(new THREE.Vector4(0, 0, 0, 1));
    uniforms.uShaftColor.value.push(new THREE.Vector4(0, 0, 0, 0));
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    // depth test off => the fog always composites over the scene, exactly
    // like a screen-space volume, without needing the depth texture.
    depthTest: false,
    depthWrite: false,
    transparent: true,
    fog: false,
    // Premultiplied-alpha blending: our shader already integrates the
    // transmittance, so out = inscatter + dst * (1 - alpha).
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(boxGeometry, material);
  mesh.name = 'gfxFogVolume';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6; // after opaque geometry, among the transparents
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);

  // ---- additive light shaft cones (one instanced draw call) ----------
  const coneGeometry = new THREE.CylinderGeometry(0.12, 1, 1, 10, 1, true);
  const coneMaterial = new THREE.MeshBasicMaterial({
    map: shaftTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    opacity: 0.5,
  });
  const shafts = new THREE.InstancedMesh(coneGeometry, coneMaterial, MAX_SHAFTS);
  shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shafts.frustumCulled = false;
  shafts.count = 0;
  shafts.renderOrder = 7;
  group.add(shafts);

  // ---- pooled shaft state -------------------------------------------
  const shaftPool = [];
  for (let i = 0; i < MAX_SHAFTS; i++) {
    shaftPool.push({
      active: false,
      life: 0,
      ttl: 0.35,
      pos: new THREE.Vector3(),
      color: new THREE.Color(1, 1, 1),
      intensity: 0,
      radius: 1,
    });
  }
  let shaftCursor = 0;

  const dummy = new THREE.Object3D();
  const scratchColor = new THREE.Color();

  let time = 0;
  let frame = 0;
  let width = 1280;
  let height = 720;
  let quality = 'high';

  /** Pixel-count driven step budget; keeps fill rate stable across devices. */
  function recomputeSteps() {
    const px = width * height;
    let s = params.steps;
    if (quality === 'low') s = 26;
    else if (quality === 'medium') s = 36;
    else if (quality === 'ultra') s = 60;
    else s = 46;
    if (px > 2600000) s = Math.round(s * 0.72);
    uniforms.uSteps.value = Math.max(16, Math.min(72, s));
  }

  /**
   * Inject a light shaft. Pooled and bounded: when all slots are busy the
   * oldest one is recycled, so an emitter can call this every frame.
   * @param {THREE.Vector3} position world-space emitter position
   * @param {THREE.ColorRepresentation} color linear-ish shaft colour
   * @param {number} intensity 0..8
   * @param {number} radius shaft radius in metres
   * @returns {number} pool slot index, or -1 when the shaft was rejected
   */
  function addLightShaft(position, color, intensity = 1, radius = 2) {
    if (!position) return -1;
    const clamped = Math.min(Math.max(intensity, 0), 8);
    if (clamped <= 0.002) return -1;

    let slot = null;
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const idx = (shaftCursor + i) % MAX_SHAFTS;
      if (!shaftPool[idx].active) { slot = shaftPool[idx]; break; }
    }
    if (!slot) slot = shaftPool[shaftCursor];
    shaftCursor = (shaftCursor + 1) % MAX_SHAFTS;

    slot.active = true;
    slot.pos.copy(position);
    slot.color.set(color === undefined ? 0xffffff : color);
    slot.intensity = clamped;
    slot.radius = Math.min(Math.max(radius, 0.15), 60);
    slot.ttl = 0.42;
    slot.life = slot.ttl;
    return shaftPool.indexOf(slot);
  }

  const EMPTY_CTX = {};
  const WEATHER_FOG = {
    clear: 0.75, overcast: 1.25, rain: 1.7, storm: 2.3,
    fog: 3.6, snow: 1.9, petals: 0.9, leaves: 1.05,
  };

  let fogMul = 1;
  let fogMulTarget = 1;

  function update(dt, ctx) {
    const c = ctx || EMPTY_CTX;
    const step = Math.min(Math.max(dt || 0, 0), 0.25);
    time += step;
    frame = (frame + 1) % 1024;

    const cam = c.camera || camera;
    if (cam) uniforms.uCameraPos.value.setFromMatrixPosition(cam.matrixWorld);

    // --- weather driven density ---------------------------------------
    const weatherName = typeof c.weather === 'string' ? c.weather : null;
    if (weatherName) fogMulTarget = WEATHER_FOG[weatherName] || 1;
    // night air settles: a touch more mist after dark
    if (c.isNight) fogMulTarget *= 1.15;
    // wet asphalt gives the classic spray haze
    if (typeof c.wetness === 'number') fogMulTarget *= 1 + c.wetness * 0.25;
    // fast driving thins the volume ahead of the car
    if (typeof c.speed01 === 'number') fogMulTarget *= 1 - c.speed01 * 0.12;
    fogMul += (fogMulTarget - fogMul) * (1 - Math.exp(-1.2 * step));

    // --- wind ----------------------------------------------------------
    const windAngle = typeof c.windDirection === 'number' ? c.windDirection : params.windDirection;
    const windSpeed = typeof c.windSpeed === 'number' ? c.windSpeed : params.windSpeed;
    uniforms.uWind.value.set(Math.cos(windAngle), Math.sin(windAngle)).multiplyScalar(windSpeed);

    // --- sun -----------------------------------------------------------
    if (c.sunDirection) uniforms.uSunDir.value.copy(c.sunDirection);
    else if (c.timeOfDay !== undefined) {
      const a = ((c.timeOfDay - 6) / 12) * Math.PI;
      uniforms.uSunDir.value.set(Math.cos(a), Math.sin(a), 0.3).normalize();
    }
    if (c.sunColor) uniforms.uSunColor.value.copy(c.sunColor);

    const sunElev = uniforms.uSunDir.value.y;
    uniforms.uSunIntensity.value = params.sunIntensity * THREE.MathUtils.smoothstep(sunElev, -0.05, 0.25);
    uniforms.uDensity.value = params.density * fogMul;
    uniforms.uMieG.value = params.mieg;
    uniforms.uNoiseAmount.value = params.noiseAmount;
    uniforms.uTime.value = time;
    uniforms.uFrameJitter.value = frame * 0.6180339887 % 1;

    // --- camera-locked box --------------------------------------------
    const g = params.groundY;
    const topExtra = Math.max(params.topHeight, uniforms.uCameraPos.value.y - g + 10);
    uniforms.uBoxMin.value.set(
      uniforms.uCameraPos.value.x - params.maxDistance,
      g - 6,
      uniforms.uCameraPos.value.z - params.maxDistance
    );
    uniforms.uBoxMax.value.set(
      uniforms.uCameraPos.value.x + params.maxDistance,
      g + topExtra,
      uniforms.uCameraPos.value.z + params.maxDistance
    );

    group.position.set(0, 0, 0);
    mesh.position.set(
      uniforms.uCameraPos.value.x,
      (uniforms.uBoxMin.value.y + uniforms.uBoxMax.value.y) * 0.5,
      uniforms.uCameraPos.value.z
    );
    mesh.scale.set(
      params.maxDistance * 2,
      uniforms.uBoxMax.value.y - uniforms.uBoxMin.value.y,
      params.maxDistance * 2
    );
    mesh.updateMatrix();

    // --- shafts: decay, then push to uniforms + cones ------------------
    let active = 0;
    for (let i = 0; i < MAX_SHAFTS; i++) {
      const s = shaftPool[i];
      const pos = uniforms.uShaftPos.value[i];
      const col = uniforms.uShaftColor.value[i];
      if (!s.active) {
        col.w = 0;
        continue;
      }
      s.life -= step;
      if (s.life <= 0) {
        s.active = false;
        col.w = 0;
        continue;
      }
      // fast attack, exponential release => light flickers read naturally
      const t = s.life / s.ttl;
      const envelope = t > 0.9 ? (1 - t) * 10 : t * t;
      const intensity = s.intensity * envelope;

      pos.set(s.pos.x, s.pos.y, s.pos.z, s.radius);
      col.set(s.color.r, s.color.g, s.color.b, intensity);

      dummy.position.set(s.pos.x, s.pos.y - 5.5, s.pos.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(s.radius * 2.6, 11, s.radius * 2.6);
      dummy.updateMatrix();
      shafts.setMatrixAt(active, dummy.matrix);
      scratchColor.copy(s.color).multiplyScalar(intensity * 0.5);
      shafts.setColorAt(active, scratchColor);
      active++;
    }
    shafts.count = active;
    shafts.instanceMatrix.needsUpdate = true;
    if (shafts.instanceColor) shafts.instanceColor.needsUpdate = true;
    shafts.visible = active > 0;
  }

  function setParams(p) {
    if (!p) return;
    const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

    if (p.density !== undefined) params.density = num(p.density, 0, 2, params.density);
    if (p.heightFalloff !== undefined) params.heightFalloff = num(p.heightFalloff, 1, 400, params.heightFalloff);
    if (p.extinction !== undefined) params.extinction = num(p.extinction, 0.05, 6, params.extinction);
    if (p.maxDistance !== undefined) params.maxDistance = num(p.maxDistance, 40, 1500, params.maxDistance);
    if (p.steps !== undefined) params.steps = num(p.steps, 16, 72, params.steps);
    if (p.noiseScale !== undefined) params.noiseScale = num(p.noiseScale, 0.0005, 0.4, params.noiseScale);
    if (p.noiseAmount !== undefined) params.noiseAmount = num(p.noiseAmount, 0, 1, params.noiseAmount);
    if (p.noiseSpeed !== undefined) params.noiseSpeed = num(p.noiseSpeed, 0, 8, params.noiseSpeed);
    if (p.mieDirectionalG !== undefined || p.mieg !== undefined) {
      params.mieg = num(p.mieg !== undefined ? p.mieg : p.mieDirectionalG, 0, 0.95, params.mieg);
    }
    if (p.sunIntensity !== undefined) params.sunIntensity = num(p.sunIntensity, 0, 12, params.sunIntensity);
    if (p.ambient !== undefined) params.ambient = num(p.ambient, 0, 2, params.ambient);
    if (p.groundY !== undefined) params.groundY = num(p.groundY, -500, 500, params.groundY);
    if (p.topHeight !== undefined) params.topHeight = num(p.topHeight, 5, 900, params.topHeight);
    if (p.windDirection !== undefined) params.windDirection = num(p.windDirection, -Math.PI * 4, Math.PI * 4, params.windDirection);
    if (p.windSpeed !== undefined) params.windSpeed = num(p.windSpeed, 0, 40, params.windSpeed);
    if (p.farFade !== undefined) params.farFade = num(p.farFade, 0, 0.99, params.farFade);
    if (p.fogColor) uniforms.uFogColor.value.set(p.fogColor);
    if (p.ambientColor) uniforms.uAmbientColor.value.set(p.ambientColor);
    if (p.quality) {
      quality = p.quality;
      recomputeSteps();
    }

    uniforms.uHeightFalloff.value = params.heightFalloff;
    uniforms.uExtinction.value = params.extinction;
    uniforms.uMaxDistance.value = params.maxDistance;
    uniforms.uNoiseScale.value = params.noiseScale;
    uniforms.uAmbient.value = params.ambient;
    uniforms.uGroundY.value = params.groundY;
    uniforms.uFarFade.value = params.farFade;
  }

  function setSize(w, h) {
    width = Math.max(1, w | 0);
    height = Math.max(1, h | 0);
    uniforms.uScreenSize.value.set(width, height);
    recomputeSteps();
  }

  function dispose() {
    for (let i = 0; i < MAX_SHAFTS; i++) shaftPool[i].active = false;
    if (group.parent) group.parent.remove(group);
    boxGeometry.dispose();
    material.dispose();
    coneGeometry.dispose();
    coneMaterial.dispose();
    if (noiseTexture) noiseTexture.dispose();
    if (shaftTexture) shaftTexture.dispose();
    shafts.dispose();
  }

  setSize(width, height);

  return {
    group,
    mesh,
    update,
    addLightShaft,
    setParams,
    setSize,
    dispose,
  };
}
