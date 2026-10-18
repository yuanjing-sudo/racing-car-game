import * as THREE from 'three';

/**
 * cinematic.js — the camera director.
 *
 * The game's `CameraController` is a *driver's* camera: chase, cockpit, hood,
 * bumper, with speed-linked FOV and a small shake. This module is the
 * *filmmaker*: it stages the shots you would cut to in a broadcast.
 *
 * Four things it owns:
 *
 *  1. **Directed shots.** A sequence of camera moves — orbit, chase, trackside
 *     pan, ground-level dolly, crane rise, wheel macro, flyby, top-down — with
 *     per-shot duration, easing, focal length and roll. Shots are picked with a
 *     seeded RNG and never repeat back-to-back, so a replay/attract loop keeps
 *     finding new angles. Each shot is a pure function of its progress `u`.
 *  2. **Auto-focus.** It writes a `focusDistance` for the depth-of-field pass by
 *     tracking the car with a damped follow plus a velocity feed-forward, so the
 *     hero stays sharp and the tarmac ahead falls off — the single cheapest
 *     thing that makes a racing frame look photographed rather than rendered.
 *  3. **Aspect + speed.** A fadeable 2.39:1 letterbox for replays and finish
 *     sequences, and a requested `timeScale` for slow motion. The host reads
 *     `timeScale` and multiplies its own step.
 *  4. **Trauma.** The classic trauma model — events *add* trauma, each frame it
 *     decays, and the shake amplitude is `trauma²`. Squaring is what makes a big
 *     hit feel violent and then settle, instead of jittering forever.
 *
 * Everything is allocation-free per frame: poses are written into scratch
 * vectors and the noise is a stateless sum of interpolated hashes.
 *
 * @param {{camera?:THREE.PerspectiveCamera, seed?:number,
 *          curve?:THREE.Curve, width?:number}} opts
 * @returns {{state:object, settings:object, setTrack:Function, setMode:Function,
 *            addTrauma:Function, impact:Function, punch:Function, slowMo:Function,
 *            playSequence:Function, stopSequence:Function, update:Function,
 *            applyToCamera:Function, dispose:Function, timeScale:number,
 *            letterbox:number, focusDistance:number, active:boolean}}
 */

/* ================================================================ easing ==== */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (t) => t * t * (3 - 2 * t);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeOutBack = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const EASINGS = { linear: (t) => t, easeIn, easeOut, easeInOut, easeOutCubic, easeInCubic, easeOutBack, easeInOutCubic };

/* ============================== cheap stateless noise ======================== */

/** Smooth 1-D value noise in roughly −1..1. Stateless: same input, same output. */
function vnoise(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const h = (n) => {
    const s = Math.sin((n + seed * 57.31) * 12.9898) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  return h(i) * (1 - u) + h(i + 1) * u;
}

/** Two octaves — enough to read as turbulence rather than a wobble. */
function fbm(x, seed = 0) {
  return vnoise(x, seed) * 0.66 + vnoise(x * 2.17, seed + 11) * 0.34;
}

/* ================================================================== shots ==== */

/** Shot kinds the director can cut to. `weight` biases the seeded picker. */
const SHOT_KINDS = [
  { kind: 'orbit', weight: 3, minDur: 5.5, maxDur: 11, fov: 34 },
  { kind: 'chase', weight: 3, minDur: 4.0, maxDur: 7.5, fov: 46 },
  { kind: 'trackside', weight: 3, minDur: 3.2, maxDur: 5.5, fov: 40 },
  { kind: 'low', weight: 2, minDur: 2.6, maxDur: 4.2, fov: 52 },
  { kind: 'crane', weight: 2, minDur: 5.0, maxDur: 8.5, fov: 38 },
  { kind: 'macro', weight: 1, minDur: 2.4, maxDur: 3.8, fov: 30 },
  { kind: 'flyby', weight: 2, minDur: 2.4, maxDur: 4.0, fov: 44 },
  { kind: 'top', weight: 1, minDur: 3.5, maxDur: 6.0, fov: 42 },
];

const TOTAL_WEIGHT = SHOT_KINDS.reduce((a, s) => a + s.weight, 0);

/* ============================================================== sequences ==== */

/**
 * Named sequences. `attract` cycles forever; the others are one-shots that
 * return the camera to the host when they finish.
 */
const SEQUENCES = {
  attract: {
    loop: true, letterbox: 0.55, shots: ['orbit', 'chase', 'trackside', 'crane', 'low', 'flyby', 'orbit', 'macro', 'top'],
  },
  finish: {
    loop: false, letterbox: 1.0, letterboxIn: 0.7, letterboxOut: 1.6,
    slowMo: 0.34, slowMoTime: 2.6, hold: 2.2, shotScale: 0.42,
    shots: ['crane', 'orbit', 'macro', 'orbit', 'flyby'],
  },
  overtake: {
    loop: false, letterbox: 0.0, hold: 0.0, shotScale: 0.5,
    shots: ['low', 'trackside'],
  },
  intro: {
    loop: false, letterbox: 1.0, letterboxIn: 1.0, letterboxOut: 1.2, hold: 1.0, shotScale: 0.6,
    shots: ['top', 'crane', 'trackside', 'orbit', 'chase'],
  },
};

/* ================================================================ factory ==== */

export function createCinematic(opts = {}) {
  const camera = opts.camera || null;
  const seed = opts.seed != null ? opts.seed : 7;

  let curve = opts.curve || null;
  let trackWidth = opts.width || 12;

  /* -------------------------------------------------------------- tunables -- */

  const settings = {
    // shake
    traumaDecay: 1.35,
    shakePosition: 0.55,   // metres at trauma = 1
    shakeRotation: 0.055,  // radians at trauma = 1
    shakeFrequency: 21,
    // lens
    baseFov: 42,
    punchFov: 6.5,
    punchDecay: 3.2,
    // focus
    autoFocus: true,
    focusBias: 1.0,        // focus a touch beyond the car
    minFocus: 0.4,
    // impact
    impactTrauma: 0.0016,  // trauma per m/s of speed lost
    impactFov: 0.22,
  };

  const state = {
    mode: 'off',            // 'off' | 'shake' | 'director'
    sequence: null,
    sequenceTime: 0,
    shot: null,
    shotTime: 0,
    shotIndex: 0,
    holdTimer: 0,
    trauma: 0,
    punch: 0,
    letterbox: 0,
    letterboxTarget: 0,
    letterboxRate: 1.4,
    timeScale: 1,
    timeScaleTarget: 1,
    slowTimer: 0,
    focusDistance: 14,
    focusVelocity: 0,
    fovOffset: 0,
    roll: 0,
    cutFlash: 0,
    shotsPlayed: [],
    lastKind: null,
  };

  let rngState = (seed >>> 0) || 1;
  function rnd() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }
  const rr = (a, b) => a + rnd() * (b - a);

  /* ----------------------------------------------------------- scratch ---- */

  const _pos = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _tmp = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _target = new THREE.Vector3();
  const _prevTarget = new THREE.Vector3();
  const _targetVelocity = new THREE.Vector3();
  const _cp = new THREE.Vector3();
  const _ct = new THREE.Vector3();
  const _camToTarget = new THREE.Vector3();
  let haveTarget = false;

  /* ============================================================ track math == */

  /** Place a world point relative to the circuit at `t`. Allocation-free. */
  function trackPoint(out, t, lateral, height) {
    if (!curve) {
      out.set(0, height, 0);
      return out;
    }
    const tt = ((t % 1) + 1) % 1;
    curve.getPointAt(tt, _cp);
    curve.getTangentAt(tt, _ct).normalize();
    _right.crossVectors(_ct, _up).normalize();
    out.copy(_cp).addScaledVector(_right, lateral).addScaledVector(_up, height);
    return out;
  }

  /** The circuit parameter nearest a world position (coarse, then refine). */
  function nearestT(position) {
    if (!curve) return 0;
    let best = 0;
    let bestD = Infinity;
    const STEPS = 40;
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      curve.getPointAt(t, _cp);
      const d = _cp.distanceToSquared(position);
      if (d < bestD) { bestD = d; best = t; }
    }
    // refine within the winning bracket
    const span = 1 / STEPS;
    for (let i = -4; i <= 4; i++) {
      const t = ((best + (i / 4) * span) % 1 + 1) % 1;
      curve.getPointAt(t, _cp);
      const d = _cp.distanceToSquared(position);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  /* ================================================================ shots == */

  /** Choose the next shot descriptor, avoiding an immediate repeat. */
  function nextShot(forceKind) {
    let def = null;
    if (forceKind) {
      def = SHOT_KINDS.find((s) => s.kind === forceKind) || null;
    }
    if (!def) {
      for (let attempt = 0; attempt < 8 && !def; attempt++) {
        let r = rnd() * TOTAL_WEIGHT;
        for (const s of SHOT_KINDS) {
          r -= s.weight;
          if (r <= 0) { def = s; break; }
        }
        if (def && def.kind === state.lastKind) def = null;
      }
      if (!def) def = SHOT_KINDS[0];
    }

    const dur = rr(def.minDur, def.maxDur)
      * (state.sequence && state.sequence.shotScale ? state.sequence.shotScale : 1);
    const shot = {
      kind: def.kind,
      duration: dur,
      easing: ['easeInOut', 'easeOutCubic', 'linear', 'easeInOutCubic'][Math.floor(rnd() * 4)],
      fov: def.fov + rr(-4, 4),
      roll: rr(-0.035, 0.035),
      // geometry
      radius: rr(7, 26),
      height: rr(1.2, 12),
      turns: rnd() < 0.35 ? 0.5 : 1,
      dir: rnd() < 0.5 ? 1 : -1,
      phase: rnd(),
      lateral: (rnd() < 0.5 ? -1 : 1) * rr(trackWidth * 0.5 + 4, trackWidth * 0.5 + 22),
      tOffset: rr(0.004, 0.02),
      lead: rr(3, 16),
      lookHeight: rr(0.4, 1.4),
      macroSide: rnd() < 0.5 ? -1 : 1,
    };
    state.lastKind = def.kind;
    state.shotsPlayed.push(def.kind);
    if (state.shotsPlayed.length > 24) state.shotsPlayed.shift();
    return shot;
  }

  /**
   * Evaluate a shot at progress `u` (0..1) and write the pose into the
   * module-scope scratch vectors. Returns the pose through `pose`.
   */
  const pose = {
    position: new THREE.Vector3(),
    look: new THREE.Vector3(),
    fov: 40,
    roll: 0,
  };

  function evaluateShot(shot, u, ctx) {
    const e = (EASINGS[shot.easing] || easeInOut)(clamp01(u));
    const heading = ctx && typeof ctx.heading === 'number' ? ctx.heading : 0;
    _fwd.set(Math.sin(heading), 0, Math.cos(heading));
    if (!_fwd.lengthSq()) _fwd.set(0, 0, 1);
    _fwd.normalize();
    _right.crossVectors(_fwd, _up).normalize();

    // Trackside shots need the circuit; without one they degrade to an orbit.
    let kind = shot.kind;
    if (!curve && (kind === 'trackside' || kind === 'flyby')) kind = 'orbit';
    const carT = (kind === 'trackside' || kind === 'flyby') ? nearestT(_target) : 0;

    pose.look.copy(_target);
    pose.look.y += shot.lookHeight;
    pose.fov = shot.fov;
    pose.roll = shot.roll * (e - 0.5) * 2;

    switch (kind) {
      case 'orbit': {
        const a = (shot.phase + e * shot.turns * shot.dir) * Math.PI * 2;
        const r = shot.radius * (0.85 + 0.3 * Math.sin(e * Math.PI));
        pose.position.set(
          _target.x + Math.sin(a) * r,
          _target.y + shot.height * (0.6 + 0.8 * Math.sin(e * Math.PI)),
          _target.z + Math.cos(a) * r
        );
        pose.fov = shot.fov - 4 * Math.sin(e * Math.PI);
        break;
      }
      case 'chase': {
        const back = shot.radius * 0.55 + 5;
        pose.position.copy(_target)
          .addScaledVector(_fwd, -back)
          .addScaledVector(_right, Math.sin(e * Math.PI) * 3);
        pose.position.y = _target.y + shot.height * 0.55 + 1.3;
        // look past the car down the road
        pose.look.copy(_target).addScaledVector(_fwd, shot.lead).setY(_target.y + 0.9);
        pose.fov = shot.fov + 4 * e;
        break;
      }
      case 'trackside': {
        // stand beside the circuit and let the car come to us
        const tt = carT - shot.tOffset * (0.5 - e) * shot.dir;
        trackPoint(pose.position, tt, shot.lateral, shot.height);
        pose.look.copy(_target).setY(_target.y + 0.75);
        pose.fov = shot.fov * (1.0 + 0.35 * e);
        break;
      }
      case 'low': {
        // ground-level: the car sweeps past overhead
        pose.position.copy(_target)
          .addScaledVector(_fwd, shot.lead * (0.5 + e))
          .addScaledVector(_right, shot.lateral * 0.12);
        pose.position.y = _target.y + 0.32;
        pose.look.copy(_target).setY(_target.y + 0.6);
        break;
      }
      case 'crane': {
        pose.position.copy(_target)
          .addScaledVector(_right, shot.radius * 0.7)
          .addScaledVector(_fwd, -shot.radius * 0.4 * (1 - e));
        pose.position.y = _target.y + 0.8 + easeOutCubic(e) * (shot.height * 1.6 + 6);
        pose.look.copy(_target).setY(_target.y + 0.7 * (1 - e));
        pose.fov = shot.fov + 6 * (1 - e);
        break;
      }
      case 'macro': {
        pose.position.copy(_target)
          .addScaledVector(_right, shot.macroSide * (0.95 + e * 0.5))
          .addScaledVector(_fwd, 1.15 - e * 1.6);
        pose.position.y = _target.y + 0.34;
        pose.look.copy(_target)
          .addScaledVector(_right, shot.macroSide * 0.5)
          .addScaledVector(_fwd, 1.1).setY(_target.y + 0.4);
        pose.fov = shot.fov;
        break;
      }
      case 'flyby': {
        const tt = carT + shot.tOffset * shot.dir;
        trackPoint(pose.position, tt, shot.lateral, shot.height);
        pose.look.copy(_target).setY(_target.y + 0.85);
        pose.fov = shot.fov * (1 + 0.5 * Math.abs(e - 0.5));
        break;
      }
      case 'top':
      default: {
        pose.position.copy(_target).addScaledVector(_fwd, -shot.radius * 0.3);
        pose.position.y = _target.y + shot.height + 14;
        pose.look.copy(_target).setY(_target.y + 0.5);
        pose.fov = shot.fov - 6 * Math.sin(e * Math.PI);
        break;
      }
    }
    return pose;
  }

  /* ============================================================= sequences == */

  function setMode(mode) {
    if (mode !== 'off' && mode !== 'shake' && mode !== 'director') return;
    if (state.mode === 'director' && mode !== 'director') {
      // leaving the director: restore the aspect
      state.letterboxTarget = 0;
    }
    state.mode = mode;
  }

  function playSequence(name) {
    const seq = SEQUENCES[name];
    if (!seq) return false;
    state.sequence = { ...seq, name };
    state.sequenceTime = 0;
    state.shotIndex = 0;
    state.holdTimer = 0;
    state.lastKind = null;
    state.mode = 'director';
    state.shot = nextShot(seq.shots[0]);
    state.shotTime = 0;
    state.letterboxTarget = seq.letterbox != null ? seq.letterbox : 0;
    state.letterboxRate = 1 / Math.max(0.15, seq.letterboxIn || 0.6);
    if (seq.slowMo) slowMo(seq.slowMo, seq.slowMoTime || 2.5);
    return true;
  }

  function stopSequence() {
    state.sequence = null;
    state.shot = null;
    state.holdTimer = 0;
    setMode('off');
    state.letterboxTarget = 0;
  }

  function addTrauma(amount) {
    const a = Number.isFinite(amount) ? amount : 0;
    state.trauma = clamp01(state.trauma + a);
  }

  /** Convert a speed loss (m/s) into trauma and a lens punch. */
  function impact(speedDelta) {
    const d = Math.abs(Number.isFinite(speedDelta) ? speedDelta : 0);
    if (d < 6) return;
    addTrauma(Math.min(0.85, d * settings.impactTrauma));
    state.punch = Math.min(1.4, state.punch + d * settings.impactFov * 0.012);
  }

  /** Nitro / kerb / gearshift kick: a short lens flare of enthusiasm. */
  function punch(amount = 0.4) {
    state.punch = Math.min(1.6, state.punch + amount);
  }

  function slowMo(scale, seconds) {
    state.timeScaleTarget = Math.max(0.2, Math.min(1, scale));
    state.slowTimer = Math.max(0.1, seconds || 2);
  }

  /* ================================================================ update == */

  function updateFocus(dt, ctx) {
    // damped follow, compensated for its own lag: a first-order filter follows
    // a constant-velocity target about `v / rate` behind it, so we bias the
    // target by exactly that much along the line of sight. The result locks
    // onto the car even when it is closing at 90 m/s.
    if (!haveTarget) {
      _prevTarget.copy(_target);
      haveTarget = true;
    }
    _targetVelocity.subVectors(_target, _prevTarget).divideScalar(Math.max(dt, 1e-4));
    _prevTarget.copy(_target);

    const cam = (ctx && ctx.camera) || camera;
    if (!cam) return;

    const rate = 9;
    _tmp.copy(_target);
    _tmp.y += 0.6;
    const dist = cam.position.distanceTo(_tmp);
    if (dist > 1e-4) {
      _camToTarget.subVectors(_tmp, cam.position).divideScalar(dist);
      const closing = _targetVelocity.dot(_camToTarget);   // + = pulling away
      _tmp.addScaledVector(_camToTarget, closing / rate);
    }
    const raw = Math.max(settings.minFocus, dist * settings.focusBias);
    // a fast focus pull is cinematic, but snapping is not: damp it
    const k = 1 - Math.exp(-rate * dt);
    state.focusDistance += (raw - state.focusDistance) * k;
  }

  function update(dt, ctx = {}) {
    const step = Math.min(Math.max(dt || 0, 0), 0.25);

    // --- target -------------------------------------------------------------
    if (ctx.focus && ctx.focus.isVector3) _target.copy(ctx.focus);
    if (ctx.focus && Array.isArray(ctx.focus)) _target.fromArray(ctx.focus);

    // --- trauma decay -------------------------------------------------------
    state.trauma = Math.max(0, state.trauma - settings.traumaDecay * step);

    // --- lens punch ---------------------------------------------------------
    state.punch = Math.max(0, state.punch - settings.punchDecay * step);

    // --- slow motion --------------------------------------------------------
    if (state.slowTimer > 0) {
      state.slowTimer -= step;
      if (state.slowTimer <= 0) state.timeScaleTarget = 1;
    }
    state.timeScale += (state.timeScaleTarget - state.timeScale) * (1 - Math.exp(-6 * step));

    // --- letterbox ----------------------------------------------------------
    const lbRate = state.letterboxTarget > state.letterbox ? state.letterboxRate : state.letterboxRate * 0.7;
    state.letterbox += (state.letterboxTarget - state.letterbox) * Math.min(1, lbRate * step * 2.2);
    if (Math.abs(state.letterbox - state.letterboxTarget) < 0.002) state.letterbox = state.letterboxTarget;

    // --- shots --------------------------------------------------------------
    if (state.mode === 'director' && state.sequence) {
      state.shotTime += step;
      state.sequenceTime += step;

      const list = state.sequence.shots;
      const running = state.shotIndex < list.length || state.sequence.loop;

      if (running) {
        if (state.shot && state.shotTime >= state.shot.duration) {
          state.shotIndex++;
          state.shotTime = 0;
          state.cutFlash = 1;
          state.shot = nextShot(list[state.shotIndex % list.length]);
        }
      } else {
        // the shot list is exhausted: hold, drop the bars, then release the camera
        state.holdTimer = (state.holdTimer || 0) + step;
        state.letterboxTarget = 0;
        if (state.holdTimer >= (state.sequence.hold || 0) + (state.sequence.letterboxOut || 1)) {
          stopSequence();
        }
      }

      // a light-speed flash on the cut
      state.cutFlash = Math.max(0, state.cutFlash - step * 9);
    } else if (state.mode === 'off') {
      state.shot = null;
    }

    // --- roll (lateral G), used only in director mode ------------------------
    if (state.mode === 'director') {
      const lat = ctx.gForceLat != null ? ctx.gForceLat : 0;
      const targetRoll = THREE.MathUtils.clamp(-lat * 0.012, -0.06, 0.06);
      state.roll += (targetRoll - state.roll) * Math.min(1, step * 4);
    } else {
      state.roll *= Math.max(0, 1 - step * 4);
    }

    updateFocus(step, ctx);
  }

  /* ======================================================== camera writing == */

  /** Add the trauma shake in the camera's own axes. */
  function applyShake(dt, amount) {
    if (!camera || amount <= 0.0001) return;
    const s = amount * amount;               // trauma²
    const t = (state.elapsed || 0) * settings.shakeFrequency;
    const ampP = settings.shakePosition * s;
    const ampR = settings.shakeRotation * s;

    camera.translateX(fbm(t + 0.0, 3) * ampP);
    camera.translateY(fbm(t + 19.7, 7) * ampP * 0.8);
    camera.translateZ(fbm(t + 41.3, 13) * ampP * 0.4);
    camera.rotateX(fbm(t + 7.1, 5) * ampR);
    camera.rotateY(fbm(t + 33.9, 9) * ampR);
    camera.rotateZ(fbm(t + 61.7, 15) * ampR * 1.6);
  }

  /**
   * Write the cinematic camera for this frame.
   * @returns {boolean} true when the director drove the camera (host should not).
   */
  function applyToCamera(dt, ctx = {}) {
    const cam = (ctx && ctx.camera) || camera;
    if (!cam) return false;
    state.elapsed = (state.elapsed || 0) + (dt || 0);

    if (state.mode === 'director' && state.shot) {
      const u = state.shot.duration > 0 ? state.shotTime / state.shot.duration : 0;
      evaluateShot(state.shot, u, ctx);

      // a cut is a cut: snap to the new pose, otherwise follow the path exactly
      cam.position.copy(pose.position);
      cam.up.set(0, 1, 0);
      cam.lookAt(pose.look);
      cam.rotateZ(pose.roll + state.roll + state.cutFlash * 0.05 * Math.sign(vnoise(state.shotIndex * 3.7, 21) || 1));

      const fov = pose.fov + state.punch * settings.punchFov * 0.4;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      state.appliedPunch = 0;

      applyShake(dt, state.trauma);
      return true;
    }

    // Not directing: only a lens kick plus any trauma the host pushed in. The
    // gameplay FOV belongs to CameraController, so we apply our punch as a
    // *delta* on whatever it wrote — otherwise the offset would compound.
    const base = cam.fov - (state.appliedPunch || 0);
    const punchFov = state.punch * settings.punchFov * 0.4;
    const target = base + punchFov;
    state.appliedPunch = punchFov;
    if (Math.abs(cam.fov - target) > 0.01) {
      cam.fov = target;
      cam.updateProjectionMatrix();
    }
    if (state.trauma > 0.0001) applyShake(dt, state.trauma * 0.4);
    return false;
  }

  /* ================================================================ public == */

  function setTrack(track = {}) {
    if (track.curve !== undefined) curve = track.curve || null;
    if (track.width != null) trackWidth = track.width;
    state.lastT = null;
  }

  function dispose() {
    stopSequence();
    state.trauma = 0;
    state.punch = 0;
    state.letterbox = 0;
    state.timeScale = 1;
  }

  return {
    state,
    settings,
    sequenceNames: Object.keys(SEQUENCES),
    shotKinds: SHOT_KINDS.map((s) => s.kind),
    setTrack,
    setMode,
    addTrauma,
    impact,
    punch,
    slowMo,
    playSequence,
    stopSequence,
    evaluateShot,
    update,
    applyToCamera,
    dispose,
    get active() { return state.mode === 'director' && !!state.shot; },
    get directing() { return state.mode === 'director'; },
    get timeScale() { return state.timeScale; },
    get letterbox() { return state.letterbox; },
    get focusDistance() { return state.focusDistance; },
    get fovOffset() { return state.punch * settings.punchFov; },
    get trauma() { return state.trauma; },
  };
}

export default { createCinematic, SEQUENCES, SHOT_KINDS };
