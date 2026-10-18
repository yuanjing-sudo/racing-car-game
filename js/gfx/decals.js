import * as THREE from 'three';

/**
 * decals.js — rubber, skid marks and surface markings.
 *
 * Two independent systems share this module:
 *
 *  1. **Skid marks** — a preallocated ring buffer of quads laid down as a car
 *     drifts or locks its wheels. Vertices are written in place (no allocation
 *     per frame, no geometry churn), and the whole trail is a single draw call.
 *     The brush texture is a soft streaked band, and vertex alpha fades the
 *     older parts of a trail out so long slides do not leave a permanent mat of
 *     black.
 *
 *  2. **Surface decals** — instanced, alpha-tested planes projected onto the
 *     ground: painted arrows, chevrons, grid boxes, distance numbers, oil
 *     patches and sponsor logos. Each *kind* is one InstancedMesh, so a track
 *     full of markings still costs a handful of draws.
 *
 * Everything is authored procedurally; no assets are fetched.
 */

/* ------------------------------------------------------------------ textures ---- */

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Soft, streaked brush used for a single skid band. */
function skidTexture() {
  const c = makeCanvas(64, 64);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  // vertical soft band, darker at the edges, streaky in the middle
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // streaks
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * 64;
    ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.18})`;
    ctx.fillRect(0, y, 64, 1 + Math.random() * 1.6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Draw a marking kind into a 256×256 atlas cell. */
function markingTexture(kind, color) {
  const size = 256;
  const c = makeCanvas(size, size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const hex = `#${new THREE.Color(color).getHexString()}`;
  const S = size / 2;
  ctx.fillStyle = hex;
  ctx.strokeStyle = hex;
  ctx.lineJoin = 'miter';

  switch (kind) {
    case 'arrow':
      ctx.beginPath();
      ctx.moveTo(S, size * 0.06);
      ctx.lineTo(size * 0.82, size * 0.46);
      ctx.lineTo(size * 0.6, size * 0.46);
      ctx.lineTo(size * 0.6, size * 0.94);
      ctx.lineTo(size * 0.4, size * 0.94);
      ctx.lineTo(size * 0.4, size * 0.46);
      ctx.lineTo(size * 0.18, size * 0.46);
      ctx.closePath();
      ctx.fill();
      break;
    case 'chevron':
      for (let i = 0; i < 3; i++) {
        const y = size * (0.2 + i * 0.26);
        ctx.lineWidth = size * 0.1;
        ctx.beginPath();
        ctx.moveTo(size * 0.16, y + size * 0.16);
        ctx.lineTo(S, y);
        ctx.lineTo(size * 0.84, y + size * 0.16);
        ctx.stroke();
      }
      break;
    case 'number': {
      ctx.font = `bold ${size * 0.62}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('50', S, S * 1.02);
      break;
    }
    case 'oil': {
      ctx.clearRect(0, 0, size, size);
      const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
      for (let i = 0; i < 26; i++) {
        const r = size * (0.05 + rnd() * 0.16);
        ctx.fillStyle = `rgba(12,10,8,${0.35 + rnd() * 0.45})`;
        ctx.beginPath();
        ctx.ellipse(size * (0.2 + rnd() * 0.6), size * (0.2 + rnd() * 0.6), r, r * (0.6 + rnd() * 0.6), rnd() * 6.28, 0, 6.28);
        ctx.fill();
      }
      break;
    }
    case 'rubber': {
      const rnd = (() => { let s = 99; return () => (s = (s * 48271) % 2147483647) / 2147483647; })();
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(18,18,20,${0.25 + rnd() * 0.5})`;
        ctx.fillRect(rnd() * size, rnd() * size, 3 + rnd() * 14, 2 + rnd() * 5);
      }
      break;
    }
    case 'grate':
      ctx.lineWidth = size * 0.045;
      for (let i = -8; i < 16; i++) {
        ctx.beginPath();
        ctx.moveTo(i * size * 0.09 - size * 0.3, 0);
        ctx.lineTo(i * size * 0.09 + size * 0.3, size);
        ctx.stroke();
      }
      break;
    case 'grid': {
      const cells = 10;
      ctx.lineWidth = size * 0.03;
      for (let i = 0; i <= cells; i++) {
        ctx.beginPath(); ctx.moveTo((i / cells) * size, 0); ctx.lineTo((i / cells) * size, size); ctx.stroke();
      }
      // alternate checker
      for (let r = 0; r < cells; r++) {
        for (let c2 = 0; c2 < cells; c2++) {
          if ((r + c2) % 2 === 0) continue;
          ctx.fillRect((c2 / cells) * size, (r / cells) * size, size / cells, size / cells);
        }
      }
      break;
    }
    case 'sponsor': {
      ctx.fillStyle = hex;
      ctx.fillRect(size * 0.06, size * 0.2, size * 0.88, size * 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `bold ${size * 0.24}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('GP', S, S);
      break;
    }
    default:
      ctx.fillRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ---------------------------------------------------------------- skid trails ---- */

const SKID_VERTEX = /* glsl */`
  attribute float aAlpha;
  attribute float aRoad;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vUv = uv;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
  }
`;

const SKID_FRAGMENT = /* glsl */`
  uniform sampler2D tBrush;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float a = texture2D( tBrush, vUv ).a * vAlpha * uOpacity;
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( uColor, a );
  }
`;

/* ---------------------------------------------------------------- decal kinds ---- */

const DECAL_KINDS = {
  arrow: { color: 0xf2f2f2, size: [1.6, 3.4], alphaTest: 0.35, polygonOffset: true },
  chevron: { color: 0xf5f5f5, size: [1.8, 4.0], alphaTest: 0.35, polygonOffset: true },
  number: { color: 0xffffff, size: [2.0, 2.0], alphaTest: 0.35, polygonOffset: true },
  oil: { color: 0x0e0c0a, size: [2.4, 2.4], alphaTest: 0.02, transparent: true, polygonOffset: true },
  rubber: { color: 0x17181c, size: [3.0, 2.0], alphaTest: 0.02, transparent: true, polygonOffset: true },
  grate: { color: 0x2b2f36, size: [1.2, 2.4], alphaTest: 0.35, polygonOffset: true },
  grid: { color: 0xffffff, size: [6.0, 6.0], alphaTest: 0.35, polygonOffset: true },
  sponsor: { color: 0xff2e88, size: [3.0, 3.0], alphaTest: 0.35, polygonOffset: true },
};

/**
 * @param {{ quality?:string, maxSkidQuads?:number, scene?:THREE.Object3D }} opts
 */
export function createDecals(opts = {}) {
  const quality = opts.quality || 'high';
  const maxQuads = opts.maxSkidQuads || (quality === 'low' ? 900 : quality === 'medium' ? 2000 : 4000);

  const group = new THREE.Group();
  group.name = 'Decals';
  const disposables = [];

  /* ------------------------------------------------------------ skid trails -- */

  const positions = new Float32Array(maxQuads * 4 * 3);
  const uvs = new Float32Array(maxQuads * 4 * 2);
  const alphas = new Float32Array(maxQuads * 4);
  const offsets = new Float32Array(maxQuads * 4); // per-vertex age for fading
  const indices = new Uint32Array(maxQuads * 6);

  for (let q = 0; q < maxQuads; q++) {
    const v = q * 4;
    const i = q * 6;
    indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
    indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
    uvs[v * 2] = 0; uvs[v * 2 + 1] = 0;
    uvs[(v + 1) * 2] = 0; uvs[(v + 1) * 2 + 1] = 1;
    uvs[(v + 2) * 2] = 1; uvs[(v + 2) * 2 + 1] = 1;
    uvs[(v + 3) * 2] = 1; uvs[(v + 3) * 2 + 1] = 0;
  }

  const skidGeometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(uvs, 2);
  const alphaAttr = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  const ageAttr = new THREE.BufferAttribute(offsets, 1).setUsage(THREE.DynamicDrawUsage);
  skidGeometry.setAttribute('position', posAttr);
  skidGeometry.setAttribute('uv', uvAttr);
  skidGeometry.setAttribute('aAlpha', alphaAttr);
  skidGeometry.setAttribute('aRoad', ageAttr);
  skidGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  skidGeometry.setDrawRange(0, 0);

  const brush = skidTexture();
  const skidMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tBrush: { value: brush },
      uColor: { value: new THREE.Color(0x111114) },
      uOpacity: { value: 0.85 },
    },
    vertexShader: SKID_VERTEX,
    fragmentShader: SKID_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  disposables.push(skidMaterial, skidGeometry);

  const skidMesh = new THREE.Mesh(skidGeometry, skidMaterial);
  skidMesh.name = 'SkidMarks';
  skidMesh.frustumCulled = false;
  skidMesh.renderOrder = 2;
  group.add(skidMesh);

  let head = 0;        // next quad to write
  let liveQuads = 0;   // total quads ever written (capped at maxQuads)
  const lanes = new Map();

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _p = new THREE.Vector3();

  function writeQuad(p0, p1, w0, w1, strength) {
    // perpendicular (in XZ) of the segment
    _d.subVectors(p1, p0);
    _d.y = 0;
    const len = _d.length();
    if (len < 1e-4) return;
    _d.multiplyScalar(1 / len);
    const px = -_d.z;
    const pz = _d.x;

    const v = head * 4;
    const s = strength;
    // 4 corners: left/right at p0 and p1
    positions[v * 3] = p0.x + px * w0; positions[v * 3 + 1] = p0.y; positions[v * 3 + 2] = p0.z + pz * w0;
    positions[(v + 1) * 3] = p0.x - px * w0; positions[(v + 1) * 3 + 1] = p0.y; positions[(v + 1) * 3 + 2] = p0.z - pz * w0;
    positions[(v + 2) * 3] = p1.x - px * w1; positions[(v + 2) * 3 + 1] = p1.y; positions[(v + 2) * 3 + 2] = p1.z - pz * w1;
    positions[(v + 3) * 3] = p1.x + px * w1; positions[(v + 3) * 3 + 1] = p1.y; positions[(v + 3) * 3 + 2] = p1.z + pz * w1;

    alphas[v] = s; alphas[v + 1] = s; alphas[v + 2] = s; alphas[v + 3] = s;
    offsets[v] = 0; offsets[v + 1] = 0; offsets[v + 2] = 0; offsets[v + 3] = 0;

    head = (head + 1) % maxQuads;
    liveQuads = Math.min(liveQuads + 1, maxQuads);
    skidGeometry.setDrawRange(0, liveQuads * 6);
    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    ageAttr.needsUpdate = true;
  }

  /**
   * Lay a skid band. `key` groups successive calls into one continuous trail
   * (e.g. 'fl', 'fr', 'rl', 'rr'); passing a new position each frame builds the
   * ribbon. Returns nothing.
   */
  function emitSkid(key, position, width = 0.28, strength = 1) {
    const lane = lanes.get(key);
    if (!lane) {
      lanes.set(key, { pos: position.clone(), width });
      return;
    }
    // only emit once we have moved a meaningful distance
    if (lane.pos.distanceToSquared(position) < 0.09) return;
    _a.copy(lane.pos);
    _b.copy(position);
    _a.y += 0.02;
    _b.y += 0.02;
    writeQuad(_a, _b, lane.width, width, THREE.MathUtils.clamp(strength, 0, 1));
    lane.pos.copy(position);
    lane.width = width;
  }

  function breakSkid(key) { lanes.delete(key); }
  function clearSkid() { lanes.clear(); skidGeometry.setDrawRange(0, 0); liveQuads = 0; head = 0; }

  /* ------------------------------------------------------------ surface decals */

  const decalMeshes = new Map();

  function kindMesh(kind) {
    if (decalMeshes.has(kind)) return decalMeshes.get(kind);
    const def = DECAL_KINDS[kind] || DECAL_KINDS.arrow;
    const tex = markingTexture(kind, def.color);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: def.transparent !== false,
      alphaTest: def.alphaTest,
      roughness: 0.72,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      depthWrite: def.transparent !== true,
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI * 0.5); // lie flat, facing up (+Y)
    // Pre-allocate a generous instance budget; grow on demand.
    const mesh = new THREE.InstancedMesh(geo, mat, 256);
    mesh.name = `Decal:${kind}`;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.userData.capacity = 256;
    group.add(mesh);
    disposables.push(mat, geo);
    decalMeshes.set(kind, mesh);
    return mesh;
  }

  const _m = new THREE.Matrix4();
  const _qq = new THREE.Quaternion();
  const _ee = new THREE.Euler();
  const _vv = new THREE.Vector3();
  const _ss = new THREE.Vector3();

  /**
   * Stamp a surface marking.
   *
   * @param {string} kind       one of DECAL_KINDS
   * @param {THREE.Vector3} position world position on the surface
   * @param {number} yaw        rotation around Y (radians)
   * @param {number} scale      uniform scale multiplier
   * @param {number} [sx]       extra X scale
   * @param {number} [sz]       extra Z scale
   */
  function addDecal(kind, position, yaw = 0, scale = 1, sx = 1, sz = 1) {
    const def = DECAL_KINDS[kind] || DECAL_KINDS.arrow;
    const mesh = kindMesh(kind);
    if (mesh.count >= mesh.userData.capacity) return null; // capacity reached
    _ee.set(0, yaw, 0);
    _qq.setFromEuler(_ee);
    _vv.set(position.x, position.y + 0.015, position.z);
    _ss.set(def.size[0] * scale * sx, 1, def.size[1] * scale * sz);
    _m.compose(_vv, _qq, _ss);
    mesh.setMatrixAt(mesh.count, _m);
    mesh.count += 1;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh.count - 1;
  }

  /** Lay a run of markings along a track frame series. */
  function addDecalRun(kind, frames, { every = 1, scale = 1 } = {}) {
    let n = 0;
    for (let i = 0; i < frames.length; i += every) {
      const f = frames[i];
      if (!f) continue;
      if (addDecal(kind, f.position, f.angle, scale) != null) n++;
    }
    return n;
  }

  function clearDecals(kind) {
    if (kind) {
      const m = decalMeshes.get(kind);
      if (m) { m.count = 0; m.instanceMatrix.needsUpdate = true; }
      return;
    }
    for (const m of decalMeshes.values()) { m.count = 0; m.instanceMatrix.needsUpdate = true; }
  }

  /* --------------------------------------------------------------- runtime -- */

  let age = 0;

  function update(dt, ctx = {}) {
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    age += step;

    // Fade old skid marks very slowly so trails linger but never saturate.
    const fade = ctx.skidFade != null ? ctx.skidFade : 0.0;
    if (fade > 0 && liveQuads > 0) {
      let dirty = false;
      for (let i = 0; i < liveQuads * 4; i += 4) {
        // sample the head of each quad only (4 verts share the value)
        const cur = offsets[i];
        if (cur >= 1) continue;
        const next = Math.min(1, cur + fade * step);
        for (let k = 0; k < 4; k++) {
          const idx = i + k;
          offsets[idx] = next;
          alphas[idx] = Math.max(0, alphas[idx] - fade * step * 0.5);
        }
        dirty = true;
      }
      if (dirty) { ageAttr.needsUpdate = true; alphaAttr.needsUpdate = true; }
    }

    if (skidMaterial.uniforms.uOpacity) {
      skidMaterial.uniforms.uOpacity.value = ctx.skidOpacity != null ? ctx.skidOpacity : 0.85;
    }
  }

  function dispose() {
    for (const d of disposables) { if (d && d.dispose) d.dispose(); }
    disposables.length = 0;
    if (group.parent) group.parent.remove(group);
    group.clear();
    decalMeshes.clear();
    lanes.clear();
  }

  return {
    group,
    mesh: skidMesh,
    addDecal,
    addDecalRun,
    clearDecals,
    emitSkid,
    breakSkid,
    clearSkid,
    update,
    dispose,
    get quadCount() { return liveQuads; },
    get decalKinds() { return [...decalMeshes.keys()]; },
  };
}

export const DECAL_KIND_NAMES = Object.keys(DECAL_KINDS);
export default { createDecals, DECAL_KIND_NAMES };
