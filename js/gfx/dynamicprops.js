import * as THREE from 'three';

import {
  getMetalMaterial, getDarkMetalMaterial, getPaintMaterial, getPlasticMaterial,
  getRubberMaterial, getGlowTexture,
} from './materials.js';

/**
 * dynamicprops.js — the animated world.
 *
 * `props.js` builds the static trackside furniture (barriers, stands, lamps).
 * This module owns everything that *moves*: the machines and the air traffic
 * that make a circuit feel inhabited and alive.
 *
 *   helicopter   patrols above the circuit, banks into the corners, main and
 *                tail rotors turning at a physically-linked rate, navigation
 *                strobes, and a belly searchlight that is registered with the
 *                lighting rig and the volumetrics so it actually paints the
 *                track and pulls a god-ray through the fog
 *   blimp        slowly orbits the venue with a scrolling sponsor banner, the
 *                banner being an animated texture *offset* so it costs one
 *                uniform write per frame
 *   balloons     hot-air balloons drifting up and down, burners flickering
 *   turbines     wind turbines whose blade rate rises and falls with the wind,
 *                upgrading to instanced blades at low settings
 *   birds        a flock on one InstancedMesh, wings flapping in the instance
 *                matrix so the whole flock is a single draw call
 *   drones       night-time camera drones, rotors spinning, LEDs strobing
 *   fountains    water jets with per-jet phase, plus a splash disc
 *   dishes       radar dishes scanning back and forth
 *   beacons      sweeping searchlights (registered as light shafts)
 *
 * Nothing here allocates in the per-frame path: every object keeps its own
 * scratch vectors, and the flock/drone matrices are rewritten in place.
 *
 * @param {{theme?:string, seed?:number, curve:THREE.Curve, width?:number,
 *          gapZones?:Array, quality?:string, density?:number,
 *          lighting?:object, volumetrics?:object}} opts
 * @returns {{group:THREE.Group, update:Function, setWeather:Function,
 *            setQuality:Function, setSize:Function, dispose:Function,
 *            stats:object, animated:object}}
 */

/* ============================================================== utilities ==== */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Scrolling sponsor banner for the blimp / the trackside LED boards. */
function bannerTexture(words, fg = '#ffffff', bg = '#0b0f18') {
  const w = 1024;
  const h = 128;
  const c = makeCanvas(w, h);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // LED pixel grid
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);

  const list = words && words.length ? words : ['VELOCE', 'APEX', 'NEXUS', 'KATANA'];
  const slot = w / list.length;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(h * 0.5)}px sans-serif`;
  for (let i = 0; i < list.length; i++) {
    const hue = (i * 360) / list.length;
    ctx.fillStyle = `hsl(${hue}, 85%, 62%)`;
    ctx.fillText(list[i], slot * (i + 0.5), h * 0.5);
  }
  // a couple of accent bars
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, w, 3);
  ctx.fillRect(0, h - 3, w, 3);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A balloon envelope print. */
function balloonTexture(hexA, hexB) {
  const w = 256;
  const h = 128;
  const c = makeCanvas(w, h);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hexA;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = hexB;
  for (let i = 0; i < 8; i++) {
    if (i % 2) continue;
    ctx.fillRect((i / 8) * w, 0, w / 8, h);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(0, h * 0.42, w, h * 0.16);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ================================================================ factory ==== */

export function createDynamicProps(opts = {}) {
  const theme = opts.theme || 'countryside';
  const seed = opts.seed != null ? opts.seed : 42;
  const curve = opts.curve || null;
  const width = opts.width || 12;
  const gapZones = opts.gapZones || [];
  const quality = opts.quality || 'high';
  const density = opts.density != null ? opts.density : 1;
  const lighting = opts.lighting || null;
  const volumetrics = opts.volumetrics || null;

  const random = mulberry32((seed >>> 0) ^ 0x5bf03635);
  const range = (a, b) => a + random() * (b - a);
  const inGap = (t) => gapZones.some((g) => t >= g.tStart && t <= g.tEnd);

  const group = new THREE.Group();
  group.name = `Dynamic:${theme}`;

  const disposables = new Set();
  const stats = { objects: 0, meshes: 0, instances: 0, tris: 0, shafts: 0, glows: 0 };
  const animated = {
    helicopters: [], blimps: [], balloons: [], turbines: [],
    drones: [], fountains: [], dishes: [], beacons: [], birds: null,
  };

  /* ------------------------------------------------------------ art direction */

  /** Per-theme population budget, so Tokyo looks nothing like the Alps. */
  const PLAN = {
    alpine: { heli: 1, blimp: 0, balloon: 3, turbine: 0, birds: 2, drones: 0, fountain: 1, dish: 1, beacon: 0 },
    coastal: { heli: 1, blimp: 1, balloon: 2, turbine: 0, birds: 3, drones: 0, fountain: 1, dish: 0, beacon: 1 },
    desert: { heli: 1, blimp: 0, balloon: 2, turbine: 2, birds: 1, drones: 0, fountain: 0, dish: 1, beacon: 0 },
    forest: { heli: 1, blimp: 0, balloon: 2, turbine: 1, birds: 4, drones: 0, fountain: 1, dish: 0, beacon: 0 },
    city: { heli: 2, blimp: 1, balloon: 0, turbine: 0, birds: 1, drones: 3, fountain: 2, dish: 1, beacon: 2 },
    tokyo: { heli: 2, blimp: 1, balloon: 0, turbine: 0, birds: 0, drones: 4, fountain: 1, dish: 1, beacon: 2 },
    countryside: { heli: 1, blimp: 0, balloon: 3, turbine: 2, birds: 4, drones: 0, fountain: 1, dish: 0, beacon: 0 },
  };
  const plan = PLAN[theme] || PLAN.countryside;
  const budget = (n) => {
    if (quality === 'low') return Math.min(n, 1);
    if (quality === 'medium') return Math.min(n, 2);
    return Math.ceil(n * Math.min(1.4, density));
  };
  const nightPlan = { city: 1, tokyo: 1, coastal: 0.4 };
  const isNightTheme = (nightPlan[theme] || 0) >= 1;

  /* ------------------------------------------------------------- materials -- */

  const metalMat = getMetalMaterial(0xaeb4bd, 0.32);
  const darkMat = getDarkMetalMaterial();
  const rubberMat = getRubberMaterial();
  const plasticMat = getPlasticMaterial(0x20232a, 0.6);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1016, roughness: 0.06, metalness: 0.0,
    clearcoat: 1, clearcoatRoughness: 0.05,
    transparent: true, opacity: 0.42, envMapIntensity: 2.2,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const glowTex = getGlowTexture();
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xfff3d6, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  for (const m of [glassMat, beaconMat]) disposables.add(m);

  /** Emissive marker light (nav strobes, LED beacons). */
  function markerMaterial(hex, intensity = 4) {
    const m = new THREE.MeshStandardMaterial({
      color: hex, emissive: hex, emissiveIntensity: intensity,
      toneMapped: false, roughness: 0.4,
    });
    disposables.add(m);
    return m;
  }

  function sprite(color, size) {
    if (!glowTex) return null;
    const m = new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    disposables.add(m);
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    return s;
  }

  /* ------------------------------------------------------------- curve math -- */

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _r = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  /**
   * An orthonormal frame on the circuit at parameter `t`, in-track-relative
   * coordinates: lateral offsets are measured along `r` (positive = right).
   */
  function frameAt(t) {
    const tt = ((t % 1) + 1) % 1;
    const p = curve ? curve.getPointAt(tt, _p) : _p.set(0, 0, 0);
    const tan = curve ? curve.getTangentAt(tt, _t).normalize() : _t.set(0, 0, 1);
    const right = _r.crossVectors(tan, _up).normalize();
    return { p, tan, right };
  }

  /** True when this band of the circuit is free of tunnels/bridges. */
  function clearAt(t) {
    for (let i = 0; i < 24; i++) {
      if (inGap(((t % 1) + 1) % 1)) return false;
      t += 1 / 24;
    }
    return true;
  }

  /** A spot `lateral` metres off the circuit, `up` metres in the air. */
  function place(out, t, lateral, up) {
    const f = frameAt(t);
    out.copy(f.p)
      .addScaledVector(f.right, lateral)
      .addScaledVector(_up, up);
    return out;
  }

  /* =========================================================== helicopter === */

  const heliBodyMat = getPaintMaterial(0x1b3a5c);
  const heliBladeMat = getDarkMetalMaterial();
  const heliLightMat = markerMaterial(0xffd9a0, 5.0);
  const heliRedMat = markerMaterial(0xff2b2b, 5.0);

  function buildHelicopter() {
    const heli = new THREE.Group();
    heli.name = 'Helicopter';

    // fuselage: a lofted egg with a tapered nose
    const fuse = [];
    const sections = [
      { z: -1.05, w: 0.30, h: 0.30, y: 0.36 },
      { z: -0.72, w: 0.56, h: 0.52, y: 0.40 },
      { z: -0.28, w: 0.86, h: 0.80, y: 0.42 },
      { z: 0.22, w: 0.92, h: 0.86, y: 0.42 },
      { z: 0.72, w: 0.78, h: 0.70, y: 0.40 },
      { z: 1.12, w: 0.50, h: 0.44, y: 0.36 },
      { z: 1.34, w: 0.26, h: 0.24, y: 0.34 },
    ];
    for (const s of sections) {
      const g = new THREE.SphereGeometry(0.5, 14, 10);
      g.scale(s.w, s.h, 0.42);
      g.translate(0, s.y, s.z);
      fuse.push(g);
    }
    // the shells overlap into one smooth silhouette
    for (const g of fuse) heli.add(new THREE.Mesh(g, heliBodyMat));

    // tail boom + fin + tail rotor
    const boom = new THREE.CylinderGeometry(0.075, 0.11, 2.1, 10);
    boom.rotateX(Math.PI / 2);
    boom.translate(0, 0.46, -2.0);
    heli.add(new THREE.Mesh(boom, heliBodyMat));

    const fin = new THREE.BoxGeometry(0.06, 0.55, 0.42);
    fin.translate(0, 0.72, -2.94);
    heli.add(new THREE.Mesh(fin, heliBodyMat));

    const tailPlane = new THREE.BoxGeometry(0.86, 0.05, 0.30);
    tailPlane.translate(0, 0.62, -2.7);
    heli.add(new THREE.Mesh(tailPlane, heliBodyMat));

    const tailRotor = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const b = new THREE.BoxGeometry(0.03, 0.62, 0.075);
      b.rotateZ((i / 2) * Math.PI);
      tailRotor.add(new THREE.Mesh(b, heliBladeMat));
    }
    tailRotor.position.set(0.08, 0.72, -3.05);
    heli.add(tailRotor);

    // skids
    for (const sx of [-1, 1]) {
      const skid = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8);
      skid.rotateX(Math.PI / 2);
      skid.translate(sx * 0.42, 0.06, -0.1);
      heli.add(new THREE.Mesh(skid, metalMat));
      const strut = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6);
      strut.translate(sx * 0.42, 0.26, 0.35);
      heli.add(new THREE.Mesh(strut, metalMat));
      const strut2 = strut.clone();
      strut2.translate(0, 0, -0.9);
      heli.add(new THREE.Mesh(strut2, metalMat));
    }

    // cockpit glass
    const glass = new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
    glass.scale(0.78, 0.66, 0.7);
    glass.translate(0, 0.56, 0.95);
    heli.add(new THREE.Mesh(glass, glassMat));

    // main rotor: mast, hub, four blades with a slight coning angle
    const rotor = new THREE.Group();
    const hub = new THREE.CylinderGeometry(0.12, 0.14, 0.16, 12);
    hub.translate(0, 0.04, 0);
    rotor.add(new THREE.Mesh(hub, metalMat));
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.BoxGeometry(6.4, 0.035, 0.28);
      // taper + a little twist
      const pos = blade.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const px = pos.getX(v);
        const k = 1 - Math.min(1, Math.abs(px) / 3.2) * 0.4;
        pos.setZ(v, pos.getZ(v) * k);
        pos.setY(v, pos.getY(v) + Math.abs(px) * 0.012);
      }
      blade.computeVertexNormals();
      blade.rotateY((i / 4) * Math.PI * 2);
      rotor.add(new THREE.Mesh(blade, heliBladeMat));
    }
    rotor.position.set(0, 1.02, -0.1);
    heli.add(rotor);

    // nav strobes
    const port = sprite(0xff2222, 0.7);
    if (port) { port.position.set(-0.9, 0.55, -0.2); heli.add(port); }
    const star = sprite(0x22ff44, 0.7);
    if (star) { star.position.set(0.9, 0.55, -0.2); heli.add(star); }
    const strobe = sprite(0xffffff, 0.9);
    if (strobe) { strobe.position.set(0, 0.75, -3.1); heli.add(strobe); }

    const noseLight = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), heliLightMat);
    noseLight.position.set(0, 0.34, 1.32);
    heli.add(noseLight);

    // belly searchlight: a cone of additive geometry plus the real Light
    const coneLen = 60;
    const coneGeo = new THREE.ConeGeometry(Math.tan(0.16) * coneLen, coneLen, 20, 1, true);
    coneGeo.translate(0, -coneLen / 2, 0);
    coneGeo.rotateX(Math.PI / 2);
    const beam = new THREE.Mesh(coneGeo, beaconMat);
    beam.name = 'HeliSearchlight';
    beam.position.set(0, 0.12, 0.3);
    beam.renderOrder = 3;
    heli.add(beam);

    const spot = new THREE.SpotLight(0xfff0d0, 0, 90, 0.19, 0.6, 1.0);
    spot.position.set(0, 0.05, 0.3);
    spot.castShadow = false;
    const target = new THREE.Object3D();
    target.position.set(0, -30, 18);
    heli.add(target);
    spot.target = target;
    heli.add(spot);

    heli.traverse((o) => { if (o.isMesh) o.castShadow = false; });

    return {
      object: heli, rotor, tailRotor, strobe, spot, beam, target,
      phase: range(0, 1), speed: range(0.0055, 0.009), altitude: range(38, 58),
      lateral: range(-26, -14), chase: 0, bank: 0,
      prev: new THREE.Vector3(), worldPos: new THREE.Vector3(), glow: null,
    };
  }

  /* ================================================================ blimp === */

  const blimpSkinMat = new THREE.MeshStandardMaterial({
    color: 0xe8ecf2, roughness: 0.42, metalness: 0.05, envMapIntensity: 1.4,
  });
  disposables.add(blimpSkinMat);

  function buildBlimp() {
    const blimp = new THREE.Group();
    blimp.name = 'Blimp';

    const hull = new THREE.SphereGeometry(1, 24, 16);
    hull.scale(2.6, 2.6, 9.5);
    blimp.add(new THREE.Mesh(hull, blimpSkinMat));

    // banner band: a slightly larger open cylinder with the scrolling texture
    const tex = bannerTexture(['VELOCE', 'APEX', 'NEXUS', 'KATANA', 'TITAN', 'VOLT']);
    const bannerMat = new THREE.MeshStandardMaterial({
      map: tex, side: THREE.DoubleSide, transparent: true,
      roughness: 0.5, metalness: 0.05, emissive: 0xffffff,
      emissiveMap: tex, emissiveIntensity: 0.55, toneMapped: false,
    });
    disposables.add(bannerMat);
    const band = new THREE.CylinderGeometry(2.68, 2.68, 3.0, 40, 1, true);
    band.rotateZ(Math.PI / 2);
    blimp.add(new THREE.Mesh(band, bannerMat));

    // tail fins in a cross
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.BoxGeometry(0.16, 3.2, 2.4);
      fin.translate(0, 1.5, -7.6);
      fin.rotateX((i / 4) * Math.PI * 2);
      blimp.add(new THREE.Mesh(fin, blimpSkinMat));
    }

    // gondola
    const gond = new THREE.SphereGeometry(0.8, 12, 8);
    gond.scale(1.0, 0.65, 1.6);
    gond.translate(0, -2.7, 0.5);
    blimp.add(new THREE.Mesh(gond, darkMat));
    for (const sx of [-1, 1]) {
      const propG = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8);
      propG.rotateZ(Math.PI / 2);
      propG.translate(sx * 1.4, -2.7, -0.6);
      blimp.add(new THREE.Mesh(propG, metalMat));
    }

    const lamp = sprite(0xffd7a0, 3.2);
    if (lamp) { lamp.position.set(0, -3.3, 0.5); blimp.add(lamp); }

    return {
      object: blimp, bannerMat, tex,
      phase: range(0, 1), orbitSpeed: range(0.0016, 0.0026),
      altitude: range(78, 110), radius: range(60, 95), bob: range(0, Math.PI * 2),
    };
  }

  /* ============================================================= balloons === */

  const BALLOON_SKINS = [
    ['#d43a2f', '#f2c14e'], ['#2f6fd4', '#f5f5f5'], ['#2fae5e', '#f2c14e'],
    ['#8e44ad', '#f5f5f5'], ['#e8613c', '#2f6fd4'],
  ];

  function buildBalloon(skinIdx) {
    const g = new THREE.Group();
    g.name = 'Balloon';
    const [a, b] = BALLOON_SKINS[skinIdx % BALLOON_SKINS.length];
    const tex = balloonTexture(a, b);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.62, metalness: 0.02,
      side: THREE.DoubleSide, envMapIntensity: 0.9,
    });
    disposables.add(mat);

    const env = new THREE.SphereGeometry(5, 20, 14);
    const pos = env.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 5;                        // -1..1
      // teardrop: fat above the equator, pinched below
      const k = y > 0 ? 1 - y * y * 0.35 : 1 - y * y * 0.72;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
      pos.setY(i, pos.getY(i) * 1.08 - (y < 0 ? y * y * 1.2 : 0));
    }
    env.computeVertexNormals();
    g.add(new THREE.Mesh(env, mat));

    // burners + basket
    const basket = new THREE.BoxGeometry(1.3, 1.0, 1.3);
    basket.translate(0, -6.0, 0);
    g.add(new THREE.Mesh(basket, getPlasticMaterial(0x6b4a2a, 0.9)));
    const ropeG = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6);
    for (let i = 0; i < 4; i++) {
      const a2 = (i / 4) * Math.PI * 2 + 0.78;
      const r = ropeG.clone();
      r.translate(Math.cos(a2) * 0.5, -4.6, Math.sin(a2) * 0.5);
      g.add(new THREE.Mesh(r, metalMat));
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 1.1, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    flame.position.set(0, -5.0, 0);
    g.add(flame);
    const light = new THREE.PointLight(0xffb050, 0, 22, 2);
    light.position.set(0, -5.0, 0);
    g.add(light);

    return {
      object: g, flame, light,
      t: range(0, 1), lateral: range(-120, 120), altitude: range(60, 130),
      bobSpeed: range(0.08, 0.2), bobPhase: range(0, Math.PI * 2),
      burnPhase: range(0, 1), burnRate: range(0.12, 0.30),
      spin: range(-0.05, 0.05), drift: range(0.6, 1.8),
    };
  }

  /* ============================================================= turbines === */

  function buildTurbine() {
    const g = new THREE.Group();
    g.name = 'Turbine';
    const hubH = range(26, 44);

    const tower = new THREE.CylinderGeometry(0.5, 1.1, hubH, 12);
    tower.translate(0, hubH / 2, 0);
    g.add(new THREE.Mesh(tower, new THREE.MeshStandardMaterial({ color: 0xe7e9ec, roughness: 0.55, metalness: 0.1 })));

    const nacelle = new THREE.BoxGeometry(1.6, 1.5, 4.0);
    nacelle.translate(0, hubH + 0.4, 0.6);
    g.add(new THREE.Mesh(nacelle, metalMat));

    const blades = new THREE.Group();
    blades.position.set(0, hubH + 0.4, 2.8);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.BoxGeometry(0.5, hubH * 0.46, 0.14);
      const pos = b.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const py = pos.getY(v) / (hubH * 0.23);
        pos.setX(v, pos.getX(v) * (1 - Math.min(1, Math.abs(py)) * 0.55));
        pos.setZ(v, pos.getZ(v) + py * 0.4);
      }
      b.computeVertexNormals();
      b.translate(0, hubH * 0.23, 0);
      b.rotateZ((i / 3) * Math.PI * 2);
      blades.add(new THREE.Mesh(b, new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.45, metalness: 0.08 })));
    }
    g.add(blades);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), markerMaterial(0xff2b2b, 4));
    beacon.position.set(0, hubH + 1.2, 0.6);
    g.add(beacon);

    return { object: g, blades, beacon, rate: 0, windPhase: range(0, Math.PI * 2), hubH };
  }

  /* ================================================================ drones === */

  function buildDrone() {
    const g = new THREE.Group();
    g.name = 'Drone';
    const body = new THREE.BoxGeometry(0.42, 0.16, 0.42);
    g.add(new THREE.Mesh(body, plasticMat));
    const rotors = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const arm = new THREE.BoxGeometry(0.5, 0.03, 0.05);
      arm.rotateY(sx * sz * Math.PI * 0.25);
      arm.translate(sx * 0.22, 0, sz * 0.22);
      g.add(new THREE.Mesh(arm, darkMat));
      const r = new THREE.Group();
      for (let i = 0; i < 2; i++) {
        const bl = new THREE.BoxGeometry(0.42, 0.008, 0.03);
        bl.rotateY((i / 2) * Math.PI);
        r.add(new THREE.Mesh(bl, darkMat));
      }
      r.position.set(sx * 0.32, 0.05, sz * 0.32);
      g.add(r);
      rotors.push(r);
    }
    const leds = [];
    for (const [sx, c] of [[-1, 0xff2020], [1, 0x20ff60]]) {
      const m = markerMaterial(c, 6);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), m);
      led.position.set(sx * 0.2, 0.08, -0.2);
      g.add(led);
      leds.push({ mesh: led, mat: m });
    }
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glassMat);
    cam.position.set(0, -0.12, 0.08);
    g.add(cam);

    return {
      object: g, rotors, leds,
      t: range(0, 1), lateral: range(-16, 16), altitude: range(12, 26),
      wobble: range(0, Math.PI * 2), strobe: range(0, 1),
    };
  }

  /* ============================================================= fountains === */

  function buildFountain() {
    const g = new THREE.Group();
    g.name = 'Fountain';

    const basin = new THREE.CylinderGeometry(2.4, 2.8, 0.7, 22);
    basin.translate(0, 0.35, 0);
    g.add(new THREE.Mesh(basin, new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.7 })));
    const water = new THREE.CylinderGeometry(2.2, 2.2, 0.1, 22);
    water.translate(0, 0.62, 0);
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x2f6f9f, roughness: 0.05, metalness: 0.0,
      transparent: true, opacity: 0.72, envMapIntensity: 2.0, clearcoat: 1,
    });
    disposables.add(waterMat);
    g.add(new THREE.Mesh(water, waterMat));

    const pillar = new THREE.CylinderGeometry(0.45, 0.7, 1.2, 14);
    pillar.translate(0, 1.0, 0);
    g.add(new THREE.Mesh(pillar, new THREE.MeshStandardMaterial({ color: 0xd8dce1, roughness: 0.72 })));

    // jets: thin cones that stretch and fade, each with its own phase
    const jetMat = new THREE.MeshBasicMaterial({
      color: 0xbfe4ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    disposables.add(jetMat);
    const jets = [];
    const rings = [
      { n: 8, r: 1.5, base: 1.6, len: 2.6, tilt: 0.55 },
      { n: 5, r: 0.7, base: 1.5, len: 3.4, tilt: 0.2 },
    ];
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2;
        const geo = new THREE.ConeGeometry(0.09, ring.len, 7, 1, true);
        geo.translate(0, ring.len / 2, 0);
        const m = new THREE.Mesh(geo, jetMat);
        m.position.set(Math.cos(a) * ring.r, ring.base, Math.sin(a) * ring.r);
        m.rotation.set(0, 0, 0);
        m.rotation.z = -Math.cos(a) * ring.tilt;
        m.rotation.x = Math.sin(a) * ring.tilt;
        g.add(m);
        jets.push({ mesh: m, phase: range(0, 1), baseLen: ring.len, base: ring.base });
      }
    }
    return { object: g, jets, waterMat };
  }

  /* ================================================================ dishes === */

  function buildDish() {
    const g = new THREE.Group();
    g.name = 'Dish';
    const mast = new THREE.CylinderGeometry(0.22, 0.35, 9, 10);
    mast.translate(0, 4.5, 0);
    g.add(new THREE.Mesh(mast, metalMat));

    const head = new THREE.Group();
    head.position.set(0, 9.2, 0);
    const dishGeo = new THREE.SphereGeometry(2.2, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42);
    dishGeo.rotateX(Math.PI * 0.62);
    head.add(new THREE.Mesh(dishGeo, new THREE.MeshStandardMaterial({
      color: 0xdcdfe4, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide,
    })));
    const feed = new THREE.CylinderGeometry(0.06, 0.06, 1.9, 6);
    feed.rotateX(Math.PI * 0.38);
    feed.translate(0, 0.7, 0.7);
    head.add(new THREE.Mesh(feed, metalMat));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), markerMaterial(0xff3b3b, 3.4));
    tip.position.set(0, 1.35, 1.35);
    head.add(tip);
    g.add(head);

    return { object: g, head, sweep: range(0.25, 0.5), phase: range(0, Math.PI * 2), range: range(0.5, 1.1) };
  }

  /* =============================================================== beacons === */

  function buildBeacon() {
    const g = new THREE.Group();
    g.name = 'Beacon';
    const tower = new THREE.CylinderGeometry(0.18, 0.3, 13, 8);
    tower.translate(0, 6.5, 0);
    g.add(new THREE.Mesh(tower, metalMat));

    const head = new THREE.Group();
    head.position.set(0, 13, 0);
    const housing = new THREE.CylinderGeometry(0.46, 0.46, 0.7, 12);
    head.add(new THREE.Mesh(housing, darkMat));

    const coneLen = 70;
    const coneGeo = new THREE.ConeGeometry(Math.tan(0.12) * coneLen, coneLen, 16, 1, true);
    coneGeo.translate(0, -coneLen / 2, 0);
    coneGeo.rotateX(Math.PI / 2);
    const beam = new THREE.Mesh(coneGeo, beaconMat);
    beam.renderOrder = 3;
    head.add(beam);
    g.add(head);

    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), markerMaterial(0xfff0cc, 6));
    lens.position.set(0, 0, 0.35);
    head.add(lens);

    return {
      object: g, head, beam, lens,
      sweep: range(0.10, 0.26), phase: range(0, Math.PI * 2), tilt: range(0.10, 0.3),
      worldPos: new THREE.Vector3(),
    };
  }

  /* ================================================================= flock === */

  /** One InstancedMesh for the whole flock: a two-triangle gull wing. */
  function buildFlock(count) {
    const verts = new Float32Array([
      // left wing (swept back)
      0, 0, 0.16, -1.0, 0.28, -0.34, 0, 0, -0.42,
      // right wing
      0, 0, 0.16, 0, 0, -0.42, 1.0, 0.28, -0.34,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2f36, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
    });
    disposables.add(mat);

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = 'BirdFlock';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;

    const birds = [];
    for (let i = 0; i < count; i++) {
      birds.push({
        t: range(0, 1),
        lateral: range(-70, 70),
        altitude: range(28, 74),
        flap: range(0, Math.PI * 2),
        flapRate: range(4.5, 7.5),
        scale: range(0.7, 1.5),
        swirl: range(0, Math.PI * 2),
        swirlR: range(1.5, 12),
        speed: range(0.010, 0.020),
      });
    }
    return { mesh, birds, dummy: new THREE.Object3D(), color: new THREE.Color() };
  }

  /* ============================================================ population === */

  const placed = [];
  function spawn(tMin, tMax) {
    for (let i = 0; i < 40; i++) {
      const t = range(tMin, tMax);
      if (clearAt(t)) return t;
    }
    return range(tMin, tMax);
  }

  function addGround(object, t, lateral, name) {
    const f = frameAt(t);
    object.position.copy(f.p).addScaledVector(f.right, lateral);
    object.rotation.y = Math.atan2(f.tan.x, f.tan.z);
    group.add(object);
    placed.push({ t, lateral, object, name });
    stats.objects++;
    return object;
  }

  function countTris(root) {
    let tris = 0;
    root.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        stats.meshes++;
        const g = o.geometry;
        if (g && g.attributes && g.attributes.position) {
          const n = g.index ? g.index.count : g.attributes.position.count;
          tris += (n / 3) * (o.isInstancedMesh ? o.count : 1);
          if (o.isInstancedMesh) stats.instances += o.count;
        }
      }
    });
    stats.tris += Math.round(tris);
  }

  // The curve is optional: with no circuit there is nothing to populate.
  if (curve) {
    for (let i = 0; i < budget(plan.heli); i++) {
      const h = buildHelicopter();
      h.phase = range(0, 1);
      h.altitude = range(38, 58);
      h.lateral = (i % 2 === 0 ? -1 : 1) * range(12, 34);
      group.add(h.object);
      animated.helicopters.push(h);
      stats.objects++;
      countTris(h.object);
      if (lighting && lighting.addNeonGlow) {
        // a soft halo around the tail strobe so it blooms after dark; the
        // handle's `position` is a live vector that update() drives
        const glow = lighting.addNeonGlow(new THREE.Vector3(), 0xffffff, 1.8, { enabled: false });
        if (glow) {
          h.glow = glow;
          h.glowOffset = new THREE.Vector3(0, 0.75, -3.1);
          stats.glows++;
        }
      }
    }

    for (let i = 0; i < budget(plan.blimp); i++) {
      const b = buildBlimp();
      b.orbitPhase = range(0, Math.PI * 2);
      group.add(b.object);
      animated.blimps.push(b);
      stats.objects++;
      countTris(b.object);
    }

    for (let i = 0; i < budget(plan.balloon); i++) {
      const b = buildBalloon(Math.floor(random() * BALLOON_SKINS.length));
      b.place = new THREE.Vector3();
      group.add(b.object);
      animated.balloons.push(b);
      stats.objects++;
      countTris(b.object);
    }

    for (let i = 0; i < budget(plan.turbine); i++) {
      const t = buildTurbine();
      addGround(t.object, spawn(0.05, 0.95), (i % 2 === 0 ? -1 : 1) * range(55, 130), 'turbine');
      animated.turbines.push(t);
      countTris(t.object);
    }

    for (let i = 0; i < budget(plan.fountain); i++) {
      const f = buildFountain();
      addGround(f.object, spawn(0.1, 0.9), (i % 2 === 0 ? -1 : 1) * range(width * 0.5 + 14, width * 0.5 + 30), 'fountain');
      animated.fountains.push(f);
      countTris(f.object);
    }

    for (let i = 0; i < budget(plan.dish); i++) {
      const d = buildDish();
      addGround(d.object, spawn(0.05, 0.95), (i % 2 === 0 ? -1 : 1) * range(34, 70), 'dish');
      animated.dishes.push(d);
      countTris(d.object);
    }

    // Searchlights only read at night, so they are gated on the theme's hour.
    const beaconCount = isNightTheme ? budget(plan.beacon) : 0;
    for (let i = 0; i < beaconCount; i++) {
      const b = buildBeacon();
      addGround(b.object, spawn(0.05, 0.95), (i % 2 === 0 ? -1 : 1) * range(26, 58), 'beacon');
      animated.beacons.push(b);
      countTris(b.object);
    }

    const droneCount = isNightTheme ? budget(plan.drones) : 0;
    for (let i = 0; i < droneCount; i++) {
      const d = buildDrone();
      group.add(d.object);
      animated.drones.push(d);
      stats.objects++;
      countTris(d.object);
    }

    const birdCount = plan.birds > 0 ? Math.round(budget(plan.birds) * 14) : 0;
    if (birdCount > 0) {
      const flock = buildFlock(Math.min(140, birdCount));
      group.add(flock.mesh);
      animated.birds = flock;
      countTris(flock.mesh);
    }
  }

  /* =============================================================== animation */

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  let wind = 0.5;
  let elapsed = 0;

  function updateHelicopters(dt, ctx) {
    const focus = ctx && ctx.focus;
    for (const h of animated.helicopters) {
      // advance along the circuit, or hold station over the player
      h.phase = ((h.phase + h.speed * dt * (0.6 + (ctx.speed01 || 0))) % 1 + 1) % 1;
      const t = h.phase;
      const f = frameAt(t);
      _v1.copy(f.p).addScaledVector(f.right, h.lateral);
      _v1.y = h.altitude + Math.sin(elapsed * 0.35 + h.phase * 9) * 2.5;

      if (focus) {
        // gently lean towards the player so the heli reads as "filming" the car
        _v2.set(focus.x, h.altitude, focus.z);
        h.chase = Math.min(1, h.chase + dt * 0.25);
        _v1.lerp(_v2, h.chase * 0.55);
      }

      if (!h.prev.lengthSq || h.prev.lengthSq() === 0) h.prev.copy(_v1);
      _v2.subVectors(_v1, h.prev);
      const speed = _v2.length() / Math.max(dt, 1e-4);
      h.prev.copy(_v1);
      h.object.position.copy(_v1);

      // nose along travel, bank into the turn
      if (speed > 0.01) {
        h.object.rotation.y = Math.atan2(_v2.x, _v2.z);
        const turn = _v2.x * f.right.x + _v2.z * f.right.z;
        h.bank += ((turn * 0.06) - h.bank) * Math.min(1, dt * 2);
        h.object.rotation.z = THREE.MathUtils.clamp(h.bank, -0.42, 0.42);
      }
      h.object.rotation.x = -0.05;

      h.rotor.rotation.y += dt * (16 + (ctx.speed01 || 0) * 10);
      h.tailRotor.rotation.x += dt * 42;

      // strobe: a sharp off/on cycle, not a sine
      const blink = (elapsed * 1.4 + h.phase * 7) % 1;
      if (h.strobe) h.strobe.material.opacity = blink < 0.07 ? 1 : 0;
      if (h.strobe) h.strobe.visible = blink < 0.07;

      const night = !!(ctx && ctx.isNight);
      if (h.spot) h.spot.intensity = night ? 900 : 220;
      if (h.beam) h.beam.material.opacity = night ? 0.13 : 0.035;
      // aim the searchlight slightly ahead of the nose
      if (h.target) {
        h.target.position.set(0, -30, 16);
      }

      // keep a volumetric shaft under the belly at night (pooled, ~0.4s TTL)
      if (night && volumetrics && volumetrics.addLightShaft) {
        h.object.updateMatrixWorld();
        h.worldPos.set(0, 0, 0.3).applyMatrix4(h.object.matrixWorld);
        if (volumetrics.addLightShaft(h.worldPos, 0xfff0d0, 1.1, 10) >= 0) stats.shafts++;
      }
      if (h.glow) {
        h.glow.position.copy(h.object.position).add(h.glowOffset || _up);
        h.glow.setEnabled(night);
      }
    }
  }

  function updateBlimps(dt, ctx) {
    for (const b of animated.blimps) {
      b.orbitPhase += b.orbitSpeed * dt;
      const radius = b.radius;
      const cx = Math.cos(b.orbitPhase) * radius;
      const cz = Math.sin(b.orbitPhase) * radius;
      b.object.position.set(cx, b.altitude + Math.sin(elapsed * 0.12 + b.bob) * 3.5, cz);
      // always faces along its own orbit
      b.object.rotation.y = -b.orbitPhase + Math.PI * 0.5;
      b.object.rotation.z = Math.sin(elapsed * 0.2 + b.bob) * 0.03;
      b.tex.offset.x = (b.tex.offset.x + dt * 0.035) % 1;

      const night = !!(ctx && ctx.isNight);
      b.bannerMat.emissiveIntensity = night ? 1.5 : 0.35;
    }
  }

  function updateBalloons(dt, ctx) {
    for (const b of animated.balloons) {
      b.t += b.drift * dt * 0.002;
      const t = ((b.t % 1) + 1) % 1;
      const f = frameAt(t);
      b.object.position.copy(f.p).addScaledVector(f.right, b.lateral);
      b.object.position.y = b.altitude + Math.sin(elapsed * b.bobSpeed + b.bobPhase) * 9;
      b.object.rotation.y += b.spin * dt;

      // burner: a short, rhythmic flare with a matching light
      b.burnPhase = (b.burnPhase + dt * b.burnRate) % 1;
      const on = b.burnPhase < 0.18;
      const flick = on ? 0.75 + Math.random() * 0.25 : 0;
      b.flame.scale.setScalar(on ? 1 + Math.random() * 0.3 : 0.001);
      b.flame.visible = on;
      b.light.intensity = flick * 26;
    }
  }

  function updateTurbines(dt, ctx) {
    // wind breathes: a slow, seeded wander between roughly 0.3 and 1.0
    wind = 0.62 + Math.sin(elapsed * 0.07) * 0.22 + Math.sin(elapsed * 0.19 + 1.7) * 0.12;
    const wet = ctx && ctx.wetness ? 1.15 : 1.0;
    for (const t of animated.turbines) {
      const target = wind * 2.4 * wet;
      t.rate += (target - t.rate) * Math.min(1, dt * 0.35);
      t.blades.rotation.z += dt * t.rate;
      const blink = (elapsed * 0.9 + t.windPhase) % 1;
      t.beacon.visible = blink < 0.5;
    }
  }

  function updateDrones(dt, ctx) {
    for (const d of animated.drones) {
      d.t = ((d.t + dt * 0.03) % 1 + 1) % 1;
      const f = frameAt(d.t);
      const lat = d.lateral + Math.sin(elapsed * 0.5 + d.wobble) * 3;
      d.object.position.copy(f.p).addScaledVector(f.right, lat);
      d.object.position.y = d.altitude + Math.sin(elapsed * 0.8 + d.wobble) * 1.4;
      d.object.rotation.y = Math.atan2(f.tan.x, f.tan.z);
      d.object.rotation.z = Math.sin(elapsed * 0.9 + d.wobble) * 0.12;
      for (const r of d.rotors) r.rotation.y += dt * 55;
      d.strobe = (d.strobe + dt * 2.2) % 1;
      for (let i = 0; i < d.leds.length; i++) {
        const led = d.leds[i];
        const phase = (d.strobe + i * 0.5) % 1;
        led.mat.emissiveIntensity = phase < 0.5 ? 6 : 0.6;
      }
    }
  }

  function updateFountains(dt, ctx) {
    for (const f of animated.fountains) {
      for (const jet of f.jets) {
        jet.phase = (jet.phase + dt * 0.7) % 1;
        const s = 0.72 + Math.sin(jet.phase * Math.PI * 2) * 0.28;
        jet.mesh.scale.y = s;
        jet.mesh.position.y = jet.base;
      }
      f.waterMat.opacity = 0.66 + Math.sin(elapsed * 0.6) * 0.06;
    }
  }

  function updateDishes(dt, ctx) {
    for (const d of animated.dishes) {
      d.phase += dt * d.sweep;
      d.head.rotation.y = Math.sin(d.phase) * d.range;
      d.head.rotation.x = -0.25;
    }
  }

  function updateBeacons(dt, ctx) {
    const night = !!(ctx && ctx.isNight);
    for (const b of animated.beacons) {
      if (!night) {
        b.beam.visible = false;
        continue;
      }
      b.beam.visible = true;
      b.phase += dt * b.sweep;
      b.head.rotation.y = Math.sin(b.phase) * 1.5;
      b.head.rotation.x = -0.5 + Math.sin(b.phase * 0.7) * b.tilt;
      b.beam.material.opacity = 0.095;

      // The shaft pool lives for ~0.4s, so a persistent emitter re-injects its
      // shaft every frame — that is the intended usage.
      if (volumetrics && volumetrics.addLightShaft) {
        b.object.updateMatrixWorld();
        b.lens.getWorldPosition(b.worldPos);
        if (volumetrics.addLightShaft(b.worldPos, 0xfff0cc, 1.5, 13) >= 0) stats.shafts++;
      }
    }
  }

  function updateBirds(dt, ctx) {
    const flock = animated.birds;
    if (!flock) return;
    const { mesh, birds, dummy } = flock;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      b.t = ((b.t + b.speed * dt * 0.08) % 1 + 1) % 1;
      const f = frameAt(b.t);
      const swirl = b.swirl + elapsed * 0.2 + i * 0.35;
      const lat = b.lateral + Math.cos(swirl) * b.swirlR;
      const alt = b.altitude + Math.sin(swirl * 0.7) * b.swirlR * 0.5;

      _v1.copy(f.p).addScaledVector(f.right, lat);
      _v1.y = alt;
      dummy.position.copy(_v1);
      dummy.rotation.set(0, Math.atan2(f.tan.x, f.tan.z), 0);

      // flap: the wing tips sit at a fixed +y in the geometry, so scaling the
      // dummy's Y lifts and drops them together — one multiply, and at flock
      // distance it is indistinguishable from a skinned wing
      const flap = Math.sin(elapsed * b.flapRate + b.flap) * 0.9;
      dummy.scale.set(b.scale, b.scale * (1 + flap), b.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /* ============================================================== public API */

  function setWeather(weather) { /* reserved for future wind coupling */ void weather; }

  function setQuality(name) {
    // no structural change — the population was chosen at build time
    void name;
  }

  function setSize() { /* nothing screen-sized in here */ }

  function update(dt, ctx = {}) {
    elapsed += dt;
    if (animated.helicopters.length) updateHelicopters(dt, ctx);
    if (animated.blimps.length) updateBlimps(dt, ctx);
    if (animated.balloons.length) updateBalloons(dt, ctx);
    if (animated.turbines.length) updateTurbines(dt, ctx);
    if (animated.drones.length) updateDrones(dt, ctx);
    if (animated.fountains.length) updateFountains(dt, ctx);
    if (animated.dishes.length) updateDishes(dt, ctx);
    if (animated.beacons.length) updateBeacons(dt, ctx);
    if (animated.birds) updateBirds(dt, ctx);
  }

  function dispose() {
    group.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isSprite) {
        if (o.geometry) o.geometry.dispose();
      }
    });
    for (const m of disposables) { try { m.dispose(); } catch (e) { /* ignore */ } }
    disposables.clear();
    for (const key of Object.keys(animated)) {
      if (Array.isArray(animated[key])) animated[key].length = 0;
      else animated[key] = null;
    }
    if (group.parent) group.parent.remove(group);
    group.clear();
  }

  return {
    group,
    stats,
    animated,
    update,
    setWeather,
    setQuality,
    setSize,
    dispose,
  };
}

export default { createDynamicProps };
