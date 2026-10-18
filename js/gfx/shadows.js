import * as THREE from 'three';

/* =====================================================================================
 * js/gfx/shadows.js — shadow management
 *
 * A racing game never has enough shadow resolution: the player can see 5 m of tarmac and
 * 500 m of skyline in the same frame, and a single shadow map big enough to cover both is
 * a shimmering mess. This module solves that with three cheap, battle-tested tricks:
 *
 *   1. TEXEL-SNAPPED FITTING — every frame the shadow camera is re-fitted to a small box
 *      around the player (or the camera). The box centre is snapped to whole shadow-map
 *      texels *in light space*, which is the standard fix for shadow edge crawl: the
 *      projection of the world onto the map can only ever shift by whole texels, so
 *      rasterised edges stop swimming when the camera moves.
 *
 *   2. TEXEL-DENSITY MAP SIZING — instead of hard-coding 2048², the map size is derived
 *      from the fit extent and a target texels-per-metre density, quantised to a power of
 *      two. Tight fit ⇒ smaller map for the same quality; wide fit ⇒ the map grows only
 *      until it hits the quality cap. Changing the fit no longer silently degrades detail.
 *
 *   3. CASCADED SPLITS — `setCascades(1|2|3)` builds a practical split schedule from the
 *      camera frustum and each registered light is fitted to its own slice, so a rig that
 *      registers 2–3 directional lights gets true cascades (each with its own tight fit
 *      and its own map). With a single registered light the schedule still works as a
 *      detail-vs-coverage dial: cascade 0 is the *near* slice, so more cascades ⇒ a
 *      tighter, denser fit around the player.
 *
 *   4. CONTACT / BLOB SHADOWS — cascaded maps still cannot resolve the dark crease under a
 *      tyre. `addBlob()` attaches a soft, multiply-blended ellipse to any object (props,
 *      the car, wheels) which fades out with altitude. One InstancedMesh, one draw call,
 *      and it is what actually makes the car feel glued to the road.
 *
 * All fitting maths is commented; no allocation happens in the per-frame path.
 * ===================================================================================== */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* Quality presets. `density` is the target shadow texels per world metre; `min/maxExtent`
 * bound the fitted box (metres, half-size). Values are tuned for a 0.25/2000 camera. */
const QUALITY = {
  low: { density: 11, minExtent: 26, maxExtent: 88, radius: 2, mapCap: 1024, cascades: 2, bias: -0.0012, normalBias: 0.04 },
  medium: { density: 17, minExtent: 22, maxExtent: 108, radius: 3, mapCap: 2048, cascades: 2, bias: -0.0009, normalBias: 0.03 },
  high: { density: 25, minExtent: 18, maxExtent: 130, radius: 3, mapCap: 2048, cascades: 3, bias: -0.0006, normalBias: 0.022 },
  ultra: { density: 33, minExtent: 16, maxExtent: 150, radius: 4, mapCap: 4096, cascades: 3, bias: -0.0005, normalBias: 0.018 },
};
const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

const DEG2RAD = Math.PI / 180;
const MAX_BLOBS = 64;
const MAX_CASCADES = 3;

/* ---- scratch (module scope: never allocate per frame) ------------------------------- */
const _focus = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _xAxis = new THREE.Vector3();
const _yAxis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _target = new THREE.Vector3();
const _tmpV = new THREE.Vector3();
const _blobPos = new THREE.Vector3();
const _blobScale = new THREE.Vector3();
const _blobMat = new THREE.Matrix4();
const _identity = new THREE.Quaternion();
const _blobColor = new THREE.Color();

/** Next power of two ≥ n, clamped into [512, 8192]. */
function pow2AtLeast(n) {
  let s = 512;
  while (s < n && s < 8192) s <<= 1;
  return s;
}

/**
 * Contact-shadow sprite: a soft grey ellipse, *white* at the edges so that under
 * `MultiplyBlending` the quad corners are a no-op and the core darkens the road.
 * Colour is data-modulating here (not albedo), hence the raw linear ramp.
 */
function makeBlobTexture() {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const r = size * 0.5;
  const grad = g.createRadialGradient(r, r, 0, r, r, r * 0.98);
  grad.addColorStop(0.0, 'rgb(112,112,112)');
  grad.addColorStop(0.35, 'rgb(168,168,168)');
  grad.addColorStop(0.72, 'rgb(232,232,232)');
  grad.addColorStop(1.0, 'rgb(255,255,255)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {{ renderer?: THREE.WebGLRenderer, scene: THREE.Scene, quality?: string,
 *           cascades?: number, maxFar?: number, splitLambda?: number }} opts
 * @returns {{
 *   update(dt:number, ctx:object):void, group: THREE.Group,
 *   register(light:THREE.DirectionalLight, opts?:object):object,
 *   addBlob(object3D:THREE.Object3D, radius?:number, opts?:object):object,
 *   setFocus(target:any):void, setQuality(q:string):void,
 *   setGroundY(y:number):void, setCascades(n:number):void,
 *   splits: Float32Array, dispose():void
 * }}
 */
export function createShadowManager({ renderer, scene, quality = 'high', cascades, maxFar = 320, splitLambda = 0.62 } = {}) {
  if (renderer && renderer.shadowMap) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // soft edge samples in the shader
  }

  /* ---------------------------------------------------------------- container ------ */
  const group = new THREE.Group();
  group.name = 'ShadowManager';
  if (scene) scene.add(group);

  /* ---------------------------------------------------------------- state ---------- */
  let preset = QUALITY[quality] || QUALITY.high;
  let configuredCascades = clamp(Math.round(cascades || preset.cascades), 1, MAX_CASCADES);
  const splitFar = clamp(maxFar, 40, 2000);
  const splits = new Float32Array(MAX_CASCADES);   // world distance of each slice's FAR plane
  let focusObject = null;
  let groundY = 0.02;
  let shadowEnabled = true;

  const entries = []; // registered directional lights + their per-light fit state

  /* ================================================================ blob shadows === */
  const blobGeometry = new THREE.PlaneGeometry(1, 1);
  blobGeometry.rotateX(-Math.PI / 2); // lay the quad flat on the road (XZ plane)

  const blobTexture = makeBlobTexture();
  const blobMaterial = new THREE.MeshBasicMaterial({
    map: blobTexture,
    color: 0xffffff,
    transparent: true,
    blending: THREE.MultiplyBlending, // dst * src → a true darkening, keeps road detail
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const blobMesh = new THREE.InstancedMesh(blobGeometry, blobMaterial, MAX_BLOBS);
  blobMesh.name = 'ContactShadows';
  blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOBS * 3).fill(1), 3);
  blobMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  blobMesh.frustumCulled = false;
  blobMesh.renderOrder = 3;
  blobMesh.count = 0;
  group.add(blobMesh);

  const blobs = [];

  /**
   * Attach a contact shadow to any object. The blob tracks the object's world position,
   * fades out as it rises off the ground and never writes depth.
   * @param {THREE.Object3D|THREE.Vector3} object3D
   * @param {number} [radius] radius in metres
   * @param {{strength?:number, lift?:number, offsetY?:number, cullDistance?:number, enabled?:boolean}} [opts]
   */
  function addBlob(object3D, radius = 0.8, opts = {}) {
    if (blobs.length >= MAX_BLOBS) return null;
    const state = {
      object: object3D && !object3D.isVector3 ? object3D : null,
      vector: object3D && object3D.isVector3 ? object3D : null,
      radius: clamp(radius, 0.05, 40),
      strength: clamp(opts.strength !== undefined ? opts.strength : 0.62, 0, 1),
      lift: opts.lift !== undefined ? opts.lift : 0.012,
      offsetY: opts.offsetY || 0,
      cullDistance: opts.cullDistance || 140,
      enabled: opts.enabled !== false,
    };
    blobs.push(state);
    blobMesh.count = blobs.length;
    return {
      get radius() { return state.radius; },
      setRadius(r) { state.radius = clamp(r, 0.05, 40); return this; },
      setStrength(s) { state.strength = clamp(s, 0, 1); return this; },
      setEnabled(v) { state.enabled = !!v; return this; },
      setOffsetY(y) { state.offsetY = y; return this; },
    };
  }

  function updateBlobs(focusX, focusZ) {
    const count = blobs.length;
    blobMesh.count = count;
    if (count === 0) return;
    const cull2Base = 1;

    for (let i = 0; i < count; i++) {
      const b = blobs[i];
      if (!b.enabled) {
        _blobScale.set(0, 0, 0);
        _blobMat.compose(_blobPos.set(0, groundY, 0), _identity, _blobScale);
        blobMesh.setMatrixAt(i, _blobMat);
        continue;
      }
      if (b.vector) _tmpV.copy(b.vector);
      else if (b.object) b.object.getWorldPosition(_tmpV);
      else _tmpV.set(0, groundY, 0);

      const dx = _tmpV.x - focusX;
      const dz = _tmpV.z - focusZ;
      const distToFocus = Math.sqrt(dx * dx + dz * dz);
      const cullDist = b.cullDistance;
      if (distToFocus > cullDist) {
        _blobScale.set(0, 0, 0);
        _blobMat.compose(_blobPos.set(0, groundY, 0), _identity, _blobScale);
        blobMesh.setMatrixAt(i, _blobMat);
        continue;
      }

      // Altitude above the ground plane decides how "detached" the object is.
      const altitude = Math.max(_tmpV.y + b.offsetY - groundY, 0);
      const fade = 1 - clamp(altitude / (b.radius * 1.7), 0, 1);
      if (fade <= 0.001) {
        _blobScale.set(0, 0, 0);
        _blobMat.compose(_blobPos.set(0, groundY, 0), _identity, _blobScale);
        blobMesh.setMatrixAt(i, _blobMat);
        continue;
      }
      // The blob spreads a little as the object lifts, like a real soft sun shadow.
      const grow = 1 + clamp(altitude / (b.radius * 3), 0, 0.8) * 0.5;
      const r = b.radius * grow;
      const edgeFade = 1 - clamp((distToFocus - cullDist * 0.75) / (cullDist * 0.25), 0, 1);

      _blobPos.set(_tmpV.x, groundY + b.lift, _tmpV.z);
      _blobScale.set(r * 2, 1, r * 2); // PlaneGeometry is 1×1 → scale by diameter
      _blobMat.compose(_blobPos, _identity, _blobScale);
      blobMesh.setMatrixAt(i, _blobMat);

      // Multiply-blending: 1 = no darkening, lower = darker. Approach 1 as it lifts.
      const g = 1 - b.strength * fade * edgeFade;
      blobMesh.setColorAt(i, _blobColor.setScalar(clamp(g, 0, 1)));
    }
    blobMesh.instanceMatrix.needsUpdate = true;
    if (blobMesh.instanceColor) blobMesh.instanceColor.needsUpdate = true;
    void cull2Base;
  }

  /* ================================================================ cascade splits == */
  /**
   * Practical split scheme (Zhang et al., the one the CSM addon uses):
   *   split_i = lerp( uniform_i, logarithmic_i, lambda )
   * with uniform_i = near + (far-near)·i/n and log_i = near·(far/near)^(i/n).
   * lambda=1 → purely logarithmic (dense near the camera), 0 → purely uniform.
   * We store the *far* distance of each slice in world units.
   */
  function computeSplits(cameraNear, cameraFar) {
    const near = Math.max(cameraNear || 0.25, 0.01);
    const far = Math.max(cameraFar, near * 8);
    const n = configuredCascades;
    for (let i = 0; i < MAX_CASCADES; i++) {
      const idx = Math.min(i, n - 1);
      const p = (idx + 1) / n;
      const uni = near + (far - near) * p;
      const log = near * Math.pow(far / near, p);
      splits[i] = uni + (log - uni) * splitLambda;
    }
    splits[MAX_CASCADES - 1] = far;
  }

  /* ================================================================ fitting ======== */
  const _lightShadowFit = {
    /** @param {THREE.DirectionalLight} light @param {number} sliceFar */
    apply(light, entry, sliceFar, camera, dt) {
      // --- 1. how big is the box? derive from the slice the light owns ---------------
      const vFov = (camera && camera.fov ? camera.fov : 50) * DEG2RAD;
      const aspect = camera && camera.aspect ? camera.aspect : 16 / 9;
      const halfH = Math.tan(vFov * 0.5) * sliceFar;
      const halfW = halfH * aspect;
      const rawExtent = clamp(Math.max(halfW, halfH) * 0.95, preset.minExtent, preset.maxExtent);

      // smooth the extent so quality changes / split changes do not pop the shadows
      if (entry.extent < 0) entry.extent = rawExtent;
      else entry.extent += (rawExtent - entry.extent) * clamp(dt * 6, 0, 1);
      const extent = entry.extent;

      // --- 2. texel-density map sizing (power-of-two, capped) ------------------------
      const desired = pow2AtLeast(Math.round(2 * extent * preset.density));
      const mapSize = clamp(desired, 512, preset.mapCap);
      if (mapSize !== entry.mapSize) {
        entry.mapSize = mapSize;
        light.shadow.mapSize.set(mapSize, mapSize);
        // three only rebuilds the map when the old one is gone
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
      const texel = (2 * extent) / entry.mapSize;

      // --- 3. light-space basis ------------------------------------------------------
      // _zAxis points from the shadow target back toward the light (i.e. toward the sun).
      _zAxis.subVectors(light.position, light.target.position);
      if (_zAxis.lengthSq() < 1e-8) _zAxis.set(0.4, 0.85, 0.35);
      _zAxis.normalize();
      // Stable lateral basis: world up unless the sun is (nearly) straight overhead.
      if (Math.abs(_zAxis.y) > 0.999) _up.set(0, 0, 1);
      else _up.set(0, 1, 0);
      _xAxis.crossVectors(_up, _zAxis).normalize();
      _yAxis.crossVectors(_zAxis, _xAxis).normalize();

      // --- 4. texel snapping --------------------------------------------------------
      // Express the focus in the basis above, round the two lateral components to whole
      // texels, then rebuild the world-space centre. Because the basis and the projection
      // extents are constant across frames, this quantises the whole shadow map's
      // translation to one-texel steps and removes edge shimmer entirely.
      const cx = Math.round(_focus.dot(_xAxis) / texel) * texel;
      const cy = Math.round(_focus.dot(_yAxis) / texel) * texel;
      const cz = _focus.dot(_zAxis);
      _target.copy(_xAxis).multiplyScalar(cx)
        .addScaledVector(_yAxis, cy)
        .addScaledVector(_zAxis, cz);

      // --- 5. place light + target, size the ortho frustum --------------------------
      // Enough slack along the light direction to catch towers/overpasses above the car.
      const depthRoom = Math.max(extent * 1.5, 70);
      const lightDist = depthRoom + extent;
      light.position.copy(_target).addScaledVector(_zAxis, lightDist);
      light.target.position.copy(_target);
      light.target.updateMatrixWorld();

      const cam = light.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.near = Math.max(0.5, lightDist - depthRoom - extent);
      cam.far = lightDist + depthRoom + extent;
      cam.updateProjectionMatrix();

      light.shadow.radius = preset.radius; // PCF kernel radius → soft penumbra
      light.shadow.bias = preset.bias;
      light.shadow.normalBias = preset.normalBias;
    },
  };

  /**
   * Take over a directional light: the manager owns its position, target and shadow
   * camera from now on. Registering 2–3 lights (one per cascade) gives true cascades.
   */
  function register(light, opts = {}) {
    if (!light || !light.isDirectionalLight) return null;
    light.castShadow = true;
    light.shadow.mapSize.set(light.shadow.mapSize.x || 1024, light.shadow.mapSize.y || 1024);
    if (scene && light.target.parent !== scene && !light.target.parent) scene.add(light.target);
    const entry = {
      light,
      cascade: clamp(Math.round(opts.cascade !== undefined ? opts.cascade : entries.length), 0, MAX_CASCADES - 1),
      extent: -1,
      mapSize: light.shadow.mapSize.x,
    };
    entries.push(entry);
    return {
      get cascade() { return entry.cascade; },
      setCascade(i) { entry.cascade = clamp(Math.round(i), 0, MAX_CASCADES - 1); return this; },
      get extent() { return entry.extent; },
      get mapSize() { return entry.mapSize; },
    };
  }

  /** Usually the player's car. Accepts an Object3D or a Vector3. */
  function setFocus(target) {
    if (target && target.isVector3) {
      focusObject = target;
    } else if (target && target.isObject3D) {
      focusObject = target;
    } else {
      focusObject = null;
    }
  }

  function setGroundY(y) {
    groundY = clamp(y, -50, 50);
  }

  function setCascades(n) {
    configuredCascades = clamp(Math.round(n), 1, MAX_CASCADES);
  }

  function setQuality(q) {
    const next = QUALITY[q];
    if (!next) return;
    preset = next;
    if (renderer && renderer.shadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // force a re-fit on the next update
    for (let i = 0; i < entries.length; i++) entries[i].extent = -1;
  }

  /* ================================================================ per-frame ====== */
  function update(dt, ctx) {
    const step = clamp(Number.isFinite(dt) ? dt : 0.016, 0, 0.1);
    const settings = (ctx && ctx.settings) || null;
    const wantShadows = !settings || settings.shadows !== false;

    if (wantShadows !== shadowEnabled) {
      shadowEnabled = wantShadows;
      for (let i = 0; i < entries.length; i++) entries[i].light.castShadow = wantShadows;
      blobMesh.visible = wantShadows;
    }
    if (!shadowEnabled) return;

    const camera = ctx && ctx.camera ? ctx.camera : null;

    // --- focus ---------------------------------------------------------------------
    if (focusObject && focusObject.isVector3) _focus.copy(focusObject);
    else if (focusObject && focusObject.isObject3D) focusObject.getWorldPosition(_focus);
    else if (ctx && ctx.focus && ctx.focus.isVector3) _focus.copy(ctx.focus);
    else if (camera) {
      camera.updateWorldMatrix(true, false);
      _focus.setFromMatrixPosition(camera.matrixWorld);
      // Bias the box a little ahead of the camera: that is where the player looks.
      const fwd = camera.getWorldDirection(_tmpV);
      _focus.addScaledVector(fwd, 12);
    } else _focus.set(0, 0, 0);

    // --- splits + per-light fits ---------------------------------------------------
    const cameraFar = Math.min(camera && camera.far ? camera.far : 400, splitFar);
    computeSplits(camera && camera.near ? camera.near : 0.25, cameraFar);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      _lightShadowFit.apply(entry.light, entry, splits[entry.cascade], camera, step);
    }

    updateBlobs(_focus.x, _focus.z);
  }

  function dispose() {
    for (let i = 0; i < entries.length; i++) {
      const light = entries[i].light;
      light.castShadow = false;
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }
    entries.length = 0;
    blobGeometry.dispose();
    blobMaterial.dispose();
    if (blobTexture) blobTexture.dispose();
    if (group.parent) group.remove(blobMesh);
    if (scene) scene.remove(group);
    group.clear();
  }

  return {
    group,
    update,
    register,
    addBlob,
    setFocus,
    setQuality,
    setGroundY,
    setCascades,
    splits,
    blobs,
    getCascades() { return configuredCascades; },
    getPreset() { return preset; },
    dispose,
  };
}
