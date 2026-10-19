import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { getDarkMetalMaterial, getMetalMaterial, getPlasticMaterial } from './materials.js';

/**
 * screens.js — trackside media.
 *
 * Real circuits are covered in light: LED walls, ribbon boards, timing towers,
 * sponsor plinths. This module builds that layer and, crucially, keeps it
 * *alive* — every screen is a canvas-backed emissive surface showing one of
 * several generated programmes:
 *
 *   live      an abstract broadcast feed: moving colour fields, a sweeping
 *             highlight, a REC dot and a running timecode, plus a lower third
 *   standings a four-row classification with the player's row highlighted
 *   sponsor   a full-bleed sponsor loop with a light sweep
 *   lap       a giant LAP n/N slate with the current position
 *   arrows    scrolling chevrons for the ribbon boards
 *
 * The panels are drawn at a deliberately low resolution (their canvases are
 * small) and then overlaid with an LED grid and scanlines, so they read as
 * emissive diode arrays rather than as posters. Repaints are budgeted and
 * round-robined — a handful of canvases per second, never the whole board every
 * frame — and each screen's brightness is driven by the time of day so they
 * scorch through the bloom pass at night and sit quietly in daylight.
 *
 * @param {{theme?:string, seed?:number, curve:THREE.Curve, width?:number,
 *          gapZones?:Array, quality?:string, density?:number,
 *          lighting?:object, scene?:THREE.Scene}} opts
 * @returns {{group:THREE.Group, update:Function, setRaceInfo:Function,
 *            setQuality:Function, setTheme:Function, dispose:Function,
 *            stats:object, screens:Array}}
 */

/* ================================================================ helpers ==== */

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

const hex = (n) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
const rgba = (n, a) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;

const SPONSORS = [
  ['VELOCE', 0x28c8ff],
  ['APEX', 0xffd400],
  ['NEXUS', 0x00e08a],
  ['KATANA', 0xff2e88],
  ['VOLT', 0x9dff3a],
  ['TITAN', 0xff6a00],
  ['HALO', 0xb45cff],
  ['DRIFT', 0xffffff],
];

const DRIVERS = [
  'VET', 'HAM', 'VER', 'LEC', 'NOR', 'SAI', 'PER', 'RUS',
  'ALO', 'STR', 'GAS', 'OCO', 'TSU', 'BOT', 'MAG', 'RIC',
];

/* ================================================================= surface === */

/**
 * A canvas-backed LED panel. Owns its canvas, texture and material, and knows
 * how to paint the handful of programmes listed above.
 */
function createScreenSurface(width, height, opts = {}) {
  const canvas = makeCanvas(width, height);
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 2;
  }

  const material = new THREE.MeshStandardMaterial({
    color: 0x0a0c10,
    map: texture || null,
    emissive: 0xffffff,
    emissiveMap: texture || null,
    emissiveIntensity: 0.9,
    roughness: 0.42,
    metalness: 0.15,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  return {
    canvas,
    texture,
    material,
    width,
    height,
    dirty: true,
    lastPaint: -1,
    get ctx() { return canvas ? canvas.getContext('2d') : null; },
  };
}

/** Overlay the diode grid + scanlines that sell the LED look. */
function ledOverlay(ctx, w, h, cell) {
  if (!ctx) return;
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  for (let x = 0; x < w; x += cell) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += cell) ctx.fillRect(0, y, w, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}

/** A text run with a soft glow, sized to fit by approximate character width. */
function glowText(ctx, text, x, y, px, color, align = 'center', weight = 'bold') {
  if (!ctx) return;
  ctx.font = `${weight} ${px}px monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = px * 0.5;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);   // second pass deepens the glow
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/** Filled bar with a gradient sheen — used for lower thirds and highlight rows. */
function sheenBar(ctx, x, y, w, h, color, alpha = 0.9) {
  if (!ctx) return;
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.55, rgba(color, alpha * 0.72));
  g.addColorStop(1, rgba(color, alpha * 0.18));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x, y, w, 1);
}

/* ============================================================ programmes ==== */

/**
 * Paint one programme onto a surface. `t` is seconds, `info` is the live race
 * state, `rnd` a seeded generator for stable-per-screen variation.
 */
function paintScreen(surface, programme, t, info, rnd, palette) {
  const ctx = surface.ctx;
  if (!ctx) return;
  const w = surface.width;
  const h = surface.height;
  const cell = Math.max(2, Math.round(w / 160));

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, w, h);

  switch (programme) {
    /* ---------------------------------------------------------- live feed -- */
    case 'live': {
      // moving colour fields stand in for a picture: three drifting blobs
      for (let i = 0; i < 3; i++) {
        const px = w * (0.25 + 0.5 * Math.sin(t * (0.21 + i * 0.07) + i * 2.1));
        const py = h * (0.5 + 0.32 * Math.cos(t * (0.17 + i * 0.05) + i * 1.3));
        const rad = w * (0.18 + 0.1 * Math.sin(t * 0.3 + i));
        const g = ctx.createRadialGradient(px, py, 1, px, py, rad);
        g.addColorStop(0, rgba(palette[i % palette.length], 0.75));
        g.addColorStop(1, rgba(palette[i % palette.length], 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      // sweeping highlight band
      const sweep = ((t * 0.35) % 1.4) - 0.2;
      const sg = ctx.createLinearGradient(sweep * w, 0, (sweep + 0.3) * w, h);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, w, h);

      // lower third
      sheenBar(ctx, 0, h * 0.68, w * 0.62, h * 0.22, 0x0b1220, 0.86);
      glowText(ctx, info && info.position ? `P${info.position}` : 'LIVE', w * 0.06, h * 0.79, h * 0.17, '#ffffff', 'left');
      glowText(ctx, SPONSORS[Math.floor(t / 3) % SPONSORS.length][0], w * 0.3, h * 0.79, h * 0.15, hex(palette[0]), 'left');

      // REC dot + timecode
      if (Math.floor(t * 2) % 2 === 0) {
        ctx.fillStyle = '#ff2b2b';
        ctx.beginPath();
        ctx.arc(w * 0.93, h * 0.12, h * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
      const tc = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      glowText(ctx, tc, w * 0.97, h * 0.12, h * 0.08, '#ff5a5a', 'right');
      break;
    }

    /* ---------------------------------------------------------- standings -- */
    case 'standings': {
      const rows = 4;
      for (let i = 0; i < rows; i++) {
        const y = h * (0.06 + i * 0.23);
        const isPlayer = info && info.position && i === Math.min(rows - 1, info.position - 1);
        if (isPlayer) sheenBar(ctx, 0, y - h * 0.02, w, h * 0.2, palette[0], 0.55);
        const name = DRIVERS[(Math.floor(t / 8) + i * 3) % DRIVERS.length];
        const gap = (i === 0 ? 'LEADER' : `+${(i * 1.37 + Math.sin(t * 0.2 + i) * 0.2).toFixed(1)}`);
        glowText(ctx, `P${i + 1}`, w * 0.05, y + h * 0.075, h * 0.13, '#ffffff', 'left');
        glowText(ctx, name, w * 0.22, y + h * 0.075, h * 0.13, isPlayer ? hex(palette[0]) : '#d8e2f0', 'left');
        glowText(ctx, gap, w * 0.95, y + h * 0.075, h * 0.11, '#9fb3cc', 'right');
      }
      break;
    }

    /* ------------------------------------------------------------ sponsor -- */
    case 'sponsor': {
      const idx = Math.floor(t / 4) % SPONSORS.length;
      const [word, colour] = SPONSORS[idx];
      ctx.fillStyle = rgba(colour, 0.10);
      ctx.fillRect(0, 0, w, h);
      // diagonal stripes
      ctx.fillStyle = rgba(colour, 0.16);
      for (let x = -h; x < w; x += h * 0.7) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + h * 0.28, h);
        ctx.lineTo(x + h * 0.28 + h * 0.5, 0);
        ctx.lineTo(x + h * 0.5, 0);
        ctx.closePath();
        ctx.fill();
      }
      glowText(ctx, word, w * 0.5, h * 0.48, h * 0.42, hex(colour));
      glowText(ctx, 'OFFICIAL PARTNER', w * 0.5, h * 0.82, h * 0.09, 'rgba(255,255,255,0.72)');
      // light sweep
      const sx = ((t * 0.5) % 1.6) - 0.3;
      const g = ctx.createLinearGradient(sx * w, 0, (sx + 0.22) * w, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    /* ---------------------------------------------------------------- lap -- */
    case 'lap': {
      const lap = info && info.lap ? info.lap : 1;
      const total = info && info.total ? info.total : 5;
      glowText(ctx, 'LAP', w * 0.5, h * 0.2, h * 0.16, '#9fb3cc');
      glowText(ctx, `${lap}/${total}`, w * 0.5, h * 0.46, h * 0.4, '#ffffff');
      sheenBar(ctx, w * 0.12, h * 0.7, w * 0.76, h * 0.04, palette[0], 0.8);
      glowText(ctx, info && info.position ? `POSITION ${info.position}` : 'RACING', w * 0.5, h * 0.84, h * 0.11, hex(palette[1] || palette[0]));
      break;
    }

    /* ------------------------------------------------------------- arrows -- */
    case 'arrows': {
      const offset = (t * 0.28) % 1;
      ctx.fillStyle = rgba(palette[0], 0.12);
      ctx.fillRect(0, 0, w, h);
      for (let i = -1; i < 5; i++) {
        const x = (i + offset) * (w / 4);
        ctx.fillStyle = rgba(palette[0], 0.85);
        ctx.beginPath();
        ctx.moveTo(x, h * 0.2);
        ctx.lineTo(x + w * 0.06, h * 0.5);
        ctx.lineTo(x, h * 0.8);
        ctx.lineTo(x + w * 0.035, h * 0.8);
        ctx.lineTo(x + w * 0.095, h * 0.5);
        ctx.lineTo(x + w * 0.035, h * 0.2);
        ctx.closePath();
        ctx.fill();
      }
      const idx = Math.floor(t / 5) % SPONSORS.length;
      glowText(ctx, SPONSORS[idx][0], w * 0.5, h * 0.5, h * 0.42, hex(SPONSORS[idx][1]));
      break;
    }

    /* ------------------------------------------------------------ default -- */
    default: {
      glowText(ctx, 'VELOCE', w * 0.5, h * 0.5, h * 0.34, hex(palette[0]));
      break;
    }
  }

  ledOverlay(ctx, w, h, cell);
  if (surface.texture) surface.texture.needsUpdate = true;
  surface.lastPaint = t;
}

/* =============================================================== geometry === */

/** Merge a list of transformed geometries, tolerating attribute mismatches. */
function merge(list) {
  const parts = list.filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  try {
    return mergeGeometries(parts, false);
  } catch (e) {
    return parts[0];
  }
}

function boxG(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** A four-post lattice tower with X bracing, merged into one geometry. */
function trussGeometry(height, spread = 0.55, bay = 1.6) {
  const parts = [];
  const post = 0.11;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(boxG(post, height, post, sx * spread * 0.5, height * 0.5, sz * spread * 0.5));
    }
  }
  const bays = Math.max(2, Math.round(height / bay));
  for (let i = 0; i < bays; i++) {
    const y = (i + 0.5) * (height / bays);
    const len = Math.sqrt(Math.pow(height / bays, 2) + Math.pow(spread, 2));
    const ang = Math.atan2(height / bays, spread);
    for (const [ax, az] of [[-1, 0], [1, 0]]) {
      const g = new THREE.BoxGeometry(0.06, len, 0.06);
      g.rotateZ(ax * ang * (i % 2 === 0 ? 1 : -1));
      g.translate(ax * spread * 0.5, y, az * spread * 0.5);
      parts.push(g);
    }
    for (const [ax, az] of [[0, -1], [0, 1]]) {
      const g = new THREE.BoxGeometry(0.06, len, 0.06);
      g.rotateX(az * ang * (i % 2 === 0 ? 1 : -1));
      g.translate(ax * spread * 0.5, y, az * spread * 0.5);
      parts.push(g);
    }
  }
  return merge(parts);
}

/** A rectangular bezel around a `w × h` panel. */
function bezelGeometry(w, h, depth = 0.22, thickness = 0.14) {
  return merge([
    boxG(w + thickness * 2, thickness, depth, 0, h * 0.5 + thickness * 0.5, 0),
    boxG(w + thickness * 2, thickness, depth, 0, -h * 0.5 - thickness * 0.5, 0),
    boxG(thickness, h, depth, -w * 0.5 - thickness * 0.5, 0, 0),
    boxG(thickness, h, depth, w * 0.5 + thickness * 0.5, 0, 0),
  ]);
}

/* ================================================================ factory ==== */

export function createScreens(opts = {}) {
  const theme = opts.theme || 'countryside';
  const seed = opts.seed != null ? opts.seed : 42;
  const curve = opts.curve || null;
  const width = opts.width || 12;
  const gapZones = opts.gapZones || [];
  const quality = opts.quality || 'high';
  const density = opts.density != null ? opts.density : 1;
  const lighting = opts.lighting || null;

  const random = mulberry32((seed >>> 0) ^ 0x51ce5);
  const range = (a, b) => a + random() * (b - a);
  const inGap = (t) => gapZones.some((g) => t >= g.tStart && t <= g.tEnd);

  const group = new THREE.Group();
  group.name = `Screens:${theme}`;
  const disposables = new Set();
  const stats = { screens: 0, jumbotrons: 0, ribbons: 0, towers: 0, meshes: 0, tris: 0, glows: 0 };
  const screens = [];
  const info = { lap: 1, total: 5, position: 1 };

  /* ------------------------------------------------------------ materials -- */

  const steel = getMetalMaterial(0x9aa1ab, 0.4);
  const dark = getDarkMetalMaterial();
  const plastic = getPlasticMaterial(0x14161b, 0.7);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1b1f26, roughness: 0.5, metalness: 0.55, envMapIntensity: 1.2,
  });
  disposables.add(frameMat);

  /** Per-theme palette for the generated content. */
  const PALETTES = {
    alpine: [0xff3b3b, 0xffffff, 0x2aa9ff],
    coastal: [0xffa62b, 0x3fd0ff, 0xffffff],
    desert: [0xffd24a, 0xff7a1a, 0xffffff],
    forest: [0x63e06a, 0xffffff, 0xd8ff6a],
    city: [0xff2e88, 0x28c8ff, 0xffd400],
    tokyo: [0xff2bd0, 0x21e6ff, 0xfff35a],
    countryside: [0x2aa9ff, 0xffd400, 0xffffff],
  };
  const palette = PALETTES[theme] || PALETTES.countryside;

  /* ------------------------------------------------------------ placement -- */

  const _p = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _r = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  function frameAt(t) {
    const tt = ((t % 1) + 1) % 1;
    const p = curve ? curve.getPointAt(tt, _p) : _p.set(0, 0, 0);
    const tan = curve ? curve.getTangentAt(tt, _t).normalize() : _t.set(0, 0, 1);
    const right = _r.crossVectors(tan, _up).normalize();
    return { p, tan, right };
  }

  /**
   * Place `object` beside the circuit at `t` and turn it to face the racing
   * line. A plane's normal is +Z locally, so we aim +Z at −sign·right.
   */
  function place(object, t, lateral, height, name) {
    const f = frameAt(t);
    const sign = Math.sign(lateral) || 1;
    object.position.copy(f.p).addScaledVector(f.right, lateral);
    object.position.y += height;
    const nx = -sign * f.right.x;
    const nz = -sign * f.right.z;
    object.rotation.y = Math.atan2(nx, nz);
    object.name = name;
    group.add(object);
    return object;
  }

  /** Free index of the circuit for a piece of trackside furniture. */
  function freeT(lo, hi) {
    for (let i = 0; i < 30; i++) {
      const t = range(lo, hi);
      let ok = true;
      for (let k = 0; k < 20; k++) {
        if (inGap(((t + k / 20) % 1))) { ok = false; break; }
      }
      if (ok) return t;
    }
    return range(lo, hi);
  }

  function countTris(root) {
    root.traverse((o) => {
      if (o.isMesh) {
        stats.meshes++;
        const g = o.geometry;
        if (g && g.attributes && g.attributes.position) {
          const n = g.index ? g.index.count : g.attributes.position.count;
          stats.tris += Math.round(n / 3);
        }
      }
    });
  }

  function register(surface, mesh, programme) {
    const rec = {
      surface,
      mesh,
      programme,
      nextPaint: 0,
      repaintRate: programme === 'arrows' ? 14 : programme === 'live' ? 12 : 5,
      rnd: random,
    };
    screens.push(rec);
    stats.screens++;
    // each screen owns its own texture/material, so they must be freed by us
    disposables.add(surface.material);
    if (surface.texture) disposables.add(surface.texture);
    // paint once immediately: a board must never be blank on its first frame
    paintScreen(surface, programme, 0, info, random, palette);
    return rec;
  }

  /* ============================================================= builders === */

  /** A big 16:9 LED wall on two truss legs. */
  function buildJumbotron(t, lateral) {
    const root = new THREE.Group();
    const W = 11.2;
    const H = 6.3;
    const legH = 4.4;

    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(trussGeometry(legH + H * 0.5, 0.7), steel);
      leg.position.set(sx * W * 0.32, (legH + H * 0.5) * 0.5, -0.3);
      leg.castShadow = true;
      root.add(leg);
    }

    // panel
    const surface = createScreenSurface(512, 288);
    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), surface.material);
    screenMesh.position.set(0, legH + H * 0.5, 0.14);
    root.add(screenMesh);

    // bezel + backing
    const bezel = new THREE.Mesh(bezelGeometry(W, H, 0.3, 0.16), frameMat);
    bezel.position.set(0, legH + H * 0.5, 0.06);
    bezel.castShadow = true;
    root.add(bezel);

    const back = new THREE.Mesh(boxG(W * 0.96, H * 0.96, 0.12, 0, legH + H * 0.5, -0.06), dark);
    root.add(back);

    // catwalk + lamps under the board
    const catwalk = new THREE.Mesh(boxG(W + 0.8, 0.1, 0.9, 0, legH - 0.25, 0.3), plastic);
    root.add(catwalk);
    for (let i = -2; i <= 2; i++) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xfff3d0, emissiveIntensity: 3.2, toneMapped: false })
      );
      lamp.position.set(i * 2.2, legH - 0.05, 0.55);
      root.add(lamp);
    }

    place(root, t, lateral, 0, 'Jumbotron');
    countTris(root);
    register(surface, screenMesh, 'live');
    stats.jumbotrons++;

    if (lighting && lighting.addNeonGlow) {
      const world = new THREE.Vector3();
      root.updateMatrixWorld(true);
      screenMesh.getWorldPosition(world);
      const glow = lighting.addNeonGlow(world, palette[0], 16, {});
      if (glow) stats.glows++;
    }
    return root;
  }

  /** A long thin ribbon board for the barriers. */
  function buildRibbon(t, lateral) {
    const root = new THREE.Group();
    const W = 14;
    const H = 1.5;
    const surface = createScreenSurface(512, 56);

    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), surface.material);
    panel.position.set(0, 1.25, 0.1);
    root.add(panel);

    const backing = new THREE.Mesh(boxG(W + 0.2, H + 0.2, 0.14, 0, 1.25, 0.0), dark);
    root.add(backing);

    // legs into the verge
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.3, 6), steel);
      leg.position.set(sx * W * 0.35, 0.62, 0);
      root.add(leg);
    }

    place(root, t, lateral, 0, 'RibbonBoard');
    countTris(root);
    register(surface, panel, 'arrows');
    stats.ribbons++;
    return root;
  }

  /** A timing tower: a column of stacked LED rows. */
  function buildTimingTower(t, lateral) {
    const root = new THREE.Group();
    const colH = 13;
    const W = 3.4;
    const H = 4.6;

    const column = new THREE.Mesh(boxG(1.5, colH, 1.5, 0, colH * 0.5, 0), frameMat);
    column.castShadow = true;
    root.add(column);

    const cap = new THREE.Mesh(boxG(2.0, 0.3, 2.0, 0, colH + 0.15, 0), steel);
    root.add(cap);

    const surfaces = [];
    const panels = [];
    for (let i = 0; i < 3; i++) {
      const s = createScreenSurface(256, 96);
      const y = colH * 0.5 + 2.4 - i * (H * 0.33);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.3), s.material);
      panel.position.set(0, y, 0.78);
      root.add(panel);
      const bezel = new THREE.Mesh(bezelGeometry(W, H * 0.3, 0.18, 0.08), dark);
      bezel.position.set(0, y, 0.7);
      root.add(bezel);
      surfaces.push(s);
      panels.push(panel);
    }

    place(root, t, lateral, 0, 'TimingTower');
    countTris(root);
    register(surfaces[0], panels[0], 'lap');
    register(surfaces[1], panels[1], 'standings');
    register(surfaces[2], panels[2], 'sponsor');
    stats.towers++;
    return root;
  }

  /* =========================================================== population == */

  const big = quality === 'ultra' ? 1.5 : quality === 'high' ? 1 : quality === 'medium' ? 0.6 : 0.3;

  if (curve) {
    const jumboCount = Math.max(1, Math.round(2 * big * density));
    for (let i = 0; i < jumboCount; i++) {
      const t = freeT(0.05 + i * 0.4, 0.35 + i * 0.4);
      const lat = (i % 2 === 0 ? -1 : 1) * range(width * 0.5 + 9, width * 0.5 + 17);
      buildJumbotron(t, lat);
    }

    const ribbonCount = Math.max(2, Math.round(6 * big * density));
    for (let i = 0; i < ribbonCount; i++) {
      const t = (i / ribbonCount + range(-0.03, 0.03) + 0.02) % 1;
      const lat = (i % 2 === 0 ? 1 : -1) * (width * 0.5 + 2.2);
      buildRibbon(t, lat);
    }

    const towerCount = big >= 1 ? 1 : 0;
    for (let i = 0; i < towerCount; i++) {
      buildTimingTower(freeT(0.4, 0.62), (i % 2 === 0 ? -1 : 1) * range(width * 0.5 + 12, width * 0.5 + 18));
    }
  }

  /* ============================================================ animation == */

  let elapsed = 0;
  let cursor = 0;

  /** Switch a jumbotron between programmes so the wall never freezes. */
  function programmeFor(rec, t) {
    if (rec.programme === 'live') {
      const cycle = ['live', 'live', 'standings', 'sponsor', 'lap'];
      return cycle[Math.floor(t / 7) % cycle.length];
    }
    return rec.programme;
  }

  function update(dt, ctx = {}) {
    const step = Math.min(Math.max(dt || 0, 0), 0.25);
    elapsed += step;

    // Night makes the diodes dominate; day washes them out.
    const night = !!(ctx && ctx.isNight);
    const gain = night ? 1.55 : 0.55;

    // Budget: at most two repaints per frame, round-robin across the screens.
    let budget = 2;
    const n = screens.length;
    for (let i = 0; i < n && budget > 0; i++) {
      const rec = screens[(cursor + i) % n];
      const interval = 1 / Math.max(1, rec.repaintRate);
      if (elapsed - rec.lastPaint < interval) continue;
      const prog = programmeFor(rec, elapsed);
      paintScreen(rec.surface, prog, elapsed, info, rec.rnd, palette);
      budget--;
      rec.programme = prog;
    }
    if (n > 0) cursor = (cursor + 1) % n;

    // Emissive intensity eases towards the time-of-day target.
    const target = gain;
    for (const rec of screens) {
      const m = rec.surface.material;
      m.emissiveIntensity += (target - m.emissiveIntensity) * Math.min(1, step * 2.2);
    }
  }

  /** Feed the live race state in. Primitives only — no per-frame allocation. */
  function setRaceInfo(lap, total, position) {
    if (lap != null && lap !== info.lap) info.lap = lap;
    if (total != null && total !== info.total) info.total = total;
    if (position != null && position !== info.position) info.position = position;
  }

  function setQuality(name) { void name; }
  function setTheme(name) { void name; }

  function dispose() {
    for (const rec of screens) {
      if (rec.surface && rec.surface.texture) rec.surface.texture.dispose();
    }
    screens.length = 0;
    group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } }
    disposables.clear();
    if (group.parent) group.parent.remove(group);
    group.clear();
  }

  return {
    group,
    screens,
    stats,
    update,
    setRaceInfo,
    setQuality,
    setTheme,
    dispose,
  };
}

export default { createScreens };
