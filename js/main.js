import * as THREE from 'three';
import { createCarModel, CAR_PAINT_COLORS } from './car.js';
import { createDefaultPhysics } from './physics.js';
import { createTrack, TRACK_THEMES, getTerrainHeight } from './track.js';
import { createScenery } from './scenery.js';
import { createScene, createCamera, createRenderer } from './environment.js';
import { createGraphicsEngine } from './gfx/index.js';
import { InputManager } from './controls.js';
import { HUD } from './hud.js';
import { AudioManager } from './audio.js';
import { WeatherSystem } from './weather.js';
import { ParticleSystem } from './gfx/particles.js';
import { CarConfigurator } from './configurator.js';
import { CameraController } from './camera.js';
import { GameMenu } from './menu.js';
import { RaceManager } from './race.js';
import { AIDirector } from './ai.js';
import { clamp, damp, formatTime, lerp } from './utils.js';
import { updateWindTime } from './materials.js';

class Game {
  constructor() {
    this.state = 'loading';
    this.canvas = document.getElementById('webgl');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.postFX = null;
    this.gfx = null;
    this.gfxOwnsLighting = false;
    this.envLights = [];
    this.speed01 = 0;
    this.playerCar = null;
    this.playerPhysics = null;
    this.trackData = null;
    this.scenery = null;
    this.input = null;
    this.hud = null;
    this.audio = null;
    this.weather = null;
    this.particles = null;
    this.configurator = null;
    this.cameraController = null;
    this.menu = null;
    this.race = null;
    this.aiDirector = null;
    this.clock = new THREE.Clock();
    this.animFrameId = null;
    this.lastTime = 0;
    this.elapsedTime = 0;
    this.frameCount = 0;
    this.fps = 60;
    this.fpsHistory = [];
    this.isPaused = false;
    this.gameMode = 'menu';
    this.carConfig = {
      paintColor: 0xcc0000,
      wheelStyle: 0,
      spoilerType: 3,
      rimColor: 0xcccccc,
      windowTint: 0.3,
    };
    this.nitro = { active: false, timer: 0, cooldown: 0 };
    this.lapData = { checkpoints: [], bestLap: null, lastLap: null };
    this.collisionCooldown = 0;
    this.offTrackTimer = 0;
    this.messageTimer = 0;

    this.init();
  }

  async init() {
    try {
    this.updateLoader(5, 'Initializing renderer...');
    this.renderer = createRenderer(this.canvas);
    this.input = new InputManager();
    this.hud = new HUD();
    this.audio = new AudioManager();
    this.race = new RaceManager();

    this.updateLoader(10, 'Creating scene...');
    this.scene = createScene(this.renderer);
    this.camera = createCamera();
    // Snapshot the legacy global light rig so the graphics engine can mute it
    // if it takes over lighting.
    this.envLights = this.scene.children.filter((o) => o.isLight);

    this.updateLoader(20, 'Creating weather system...');
    this.weather = new WeatherSystem(this.scene);
    this.weather.setupLights();
    this.weather.createSky();
    this.weather.createRain();
    this.weather.createSnow();
    this.weather.createPetalParticles();
    this.weather.createLeafParticles();
    this.weather.createCloudLayer();

    this.updateLoader(23, 'Setting up post-processing...');
    this.setupGraphics();

    this.updateLoader(25, 'Creating particle system...');
    this.particles = new ParticleSystem(this.scene);

    this.updateLoader(30, 'Building player car...');
    this.playerCar = createCarModel(this.carConfig);
    this.playerCar.position.set(0, 0, 0);
    this.playerCar.visible = false;
    this.scene.add(this.playerCar);

    this.updateLoader(35, 'Initializing physics...');
    this.playerPhysics = createDefaultPhysics();

    this.updateLoader(40, 'Setting up camera...');
    this.cameraController = new CameraController(this.camera);

    this.updateLoader(45, 'Creating configurator...');
    this.configurator = new CarConfigurator(this.scene, this.camera, this.renderer);

    this.updateLoader(50, 'Building menu system...');
    this.menu = new GameMenu();
    this.menu.init({
      onStartRace: (settings) => this.startRace(settings),
      onOpenConfigurator: () => this.openConfigurator(),
      onStartFreeRoam: (settings) => this.startFreeRoam(settings),
    });

    this.updateLoader(55, 'Loading audio...');
    this.setupAudio();

    this.updateLoader(60, 'Preparing tracks...');
    this.preloadTrackData();

    this.updateLoader(70, 'Setting up event listeners...');
    this.setupEventListeners();

    this.updateLoader(80, 'Final setup...');
    this.setupResize();

    this.updateLoader(90, 'Almost ready...');
    this.state = 'menu';

    this.updateLoader(100, 'Ready!');
    setTimeout(() => {
      document.getElementById('preloader').classList.add('hidden');
      this.menu.show();
      this.startRenderLoop();
    }, 500);
    } catch (err) {
      console.error('Init error:', err);
      const statusEl = document.getElementById('loaderStatus');
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
  }

  updateLoader(progress, status) {
    const fill = document.getElementById('loaderFill');
    const statusEl = document.getElementById('loaderStatus');
    if (fill) fill.style.width = `${progress}%`;
    if (statusEl && status) statusEl.textContent = status;
  }

  /**
   * Build the advanced graphics engine (atmosphere, lighting, cascaded shadows,
   * volumetrics and the full HDR post chain). Every step is guarded so a failure
   * in any one subsystem degrades gracefully instead of breaking the game.
   */
  setupGraphics() {
    const quality = this.detectQuality();
    try {
      this.gfx = createGraphicsEngine({
        renderer: this.renderer,
        scene: this.scene,
        camera: this.camera,
        settings: { quality },
      });

      // Our raymarched atmosphere replaces the legacy sky dome…
      this.gfx.attachLegacy({ sky: this.weather ? this.weather.sky : null });

      // …and the cascaded shadow manager takes over the sun. If the lighting rig
      // came up we let it drive the global rig and mute the legacy lights so the
      // scene is not lit twice.
      if (this.gfx.lighting && this.gfx.lighting.sun) {
        if (this.gfx.shadows) this.gfx.shadows.register(this.gfx.lighting.sun);
        this.gfxOwnsLighting = true;
        for (const l of this.envLights) l.visible = false;
      }

      const size = this.renderer.getSize(new THREE.Vector2());
      this.gfx.setSize(size.x, size.y);
      this.gfx.setQuality(quality);
    } catch (err) {
      console.warn('[gfx] engine unavailable, using the legacy renderer:', err);
      this.gfx = null;
      this.gfxOwnsLighting = false;
    }
  }

  /** Pick a starting quality tier from the device's resolution and memory. */
  detectQuality() {
    const pr = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1;
    const px = window.innerWidth * window.innerHeight * pr * pr;
    const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
    if (px > 4.2e6 && mem >= 8) return 'ultra';
    if (px > 2.0e6) return 'high';
    if (px > 9.0e5) return 'medium';
    return 'low';
  }

  /** The per-frame context every graphics sub-system reads from. */
  graphicsContext() {
    const phys = this.playerPhysics;
    const speed01 = phys ? clamp(phys.speed / 95, 0, 1) : 0;
    const hour = this.weather ? this.weather.timeOfDay : 12;
    const w = this.weather ? this.weather.currentWeather : 'clear';
    return {
      camera: this.camera,
      timeOfDay: hour,
      weather: w,
      isNight: hour < 6.4 || hour > 18.6,
      wetness: (w === 'rain' || w === 'storm') ? 1 : 0,
      fogScale: this.weather ? this.weather.fogScale : 1,
      speed01: this.speed01 != null ? this.speed01 : (phys ? clamp(phys.speed / 95, 0, 1) : 0),
      damage01: this.damage01 || 0,
      focus: this.playerCar && this.playerCar.visible ? this.playerCar.position : undefined,
      groundY: 0,
      racePhase: this.race && this.state === 'racing' ? this.race.state : undefined,
    };
  }


  setupAudio() {
    const initAudio = () => {
      this.audio.init();
      document.removeEventListener('click', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
    document.addEventListener('click', initAudio);
    document.addEventListener('keydown', initAudio);
  }

  preloadTrackData() {
    this.trackCache = {};
  }

  setupEventListeners() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('resize', () => this.onResize());
  }

  setupResize() {
    this.onResize();
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.gfx) this.gfx.setSize(w, h);
  }

  onKeyDown(e) {
    if (e.code === 'Escape') {
      if (this.gameMode === 'racing' || this.gameMode === 'freeroam') {
        this.pauseGame();
      } else if (this.isPaused) {
        this.resumeGame();
      }
    }
    if (e.code === 'KeyC' && this.gameMode !== 'menu') {
      const mode = this.cameraController.cycle();
      this.hud.showMessage(`Camera: ${mode.toUpperCase()}`);
    }
    if (e.code === 'KeyM') {
      const muted = this.audio.toggleMute();
      this.hud.showMessage(muted ? 'Audio Muted' : 'Audio On');
    }
    if (e.code === 'KeyH') {
      this.hud.toggle();
    }
    if (e.code === 'KeyN' && (this.gameMode === 'racing' || this.gameMode === 'freeroam') && !this.isPaused) {
      this.activateNitro();
    }
  }

  onKeyUp(e) {}

  startRace(settings) {
    this.gameMode = 'racing';
    this.raceSettings = settings;
    this.hud.show();
    this.hud.showMessage('Get Ready...', 2000);

    this.clearWorld();

    this.updateLoader(10, 'Generating track...');
    const seed = Math.floor(Math.random() * 10000);
    this.trackData = createTrack(settings.track, seed);
    this.playerPhysics.setGroundHeightGetter((x, z) => this.getGroundHeight(x, z));

    this.updateLoader(30, 'Creating scenery...');
    this.scenery = createScenery(settings.track, seed, this.trackData.curve);
    this.scene.add(this.scenery);

    this.updateLoader(50, 'Placing car on grid...');
    this.playerCar.visible = true;
    const gridPos = this.getGridPosition(0);
    this.playerPhysics.reset(gridPos.position, gridPos.angle);
    this.playerCar.position.copy(gridPos.position);
    this.playerCar.rotation.y = gridPos.angle;
    this.cameraController.reset(gridPos.position);

    this.updateLoader(60, 'Spawning AI opponents...');
    this.aiDirector = new AIDirector(this.scene, this.trackData, settings.difficulty, settings.opponents);

    this.updateLoader(75, 'Configuring weather...');
    const isTokyoTrack = settings.track === 'tokyo';
    const isCityTrack = settings.track === 'city';
    if (isTokyoTrack) {
      // Tokyo Dream Circuit is authored as a cinematic wet neon night:
      // rain-slicked tarmac mirroring the signage, headlights on, haze
      // thinned just enough that the skyline reads.
      this.weather.setSeasonCycle(false, 0);
      this.weather.fogScale = 0.35;
      this.weather.setTimeOfDay(19.6);
      this.weather.setWeather('rain');
    } else {
      this.weather.fogScale = 1;
      this.weather.setSeasonCycle(isCityTrack, 0);
      if (!isCityTrack && settings.weather) this.weather.setWeather(settings.weather);
      if (settings.timeOfDay != null) {
        this.weather.setTimeOfDay(settings.timeOfDay);
      } else if (isCityTrack) {
        // downtown defaults to a neon-lit night so the emissive windows,
        // wet asphalt and headlights all do their thing
        this.weather.setTimeOfDay(21);
      }
    }

    // Tell the graphics engine how this track should look.
    if (this.gfx) {
      this.gfx.setTheme({
        theme: settings.track,
        timeOfDay: this.weather.timeOfDay,
        weather: this.weather.currentWeather,
        fogScale: this.weather.fogScale,
        curve: this.trackData.curve,
        width: this.trackData.width,
        gapZones: this.trackData.gapZones,
        seed,
      });
    }

    this.updateLoader(85, 'Starting race...');
    this.race.start(settings);
    this.state = 'racing';

    this.updateLoader(100, 'GO!');
    this.audio.playEffect('countdown_beep');
  }

  startFreeRoam(settings) {
    this.gameMode = 'freeroam';
    this.hud.show();

    this.clearWorld();

    const seed = Math.floor(Math.random() * 10000);
    this.trackData = createTrack(settings.track || 'countryside', seed);
    this.playerPhysics.setGroundHeightGetter((x, z) => this.getGroundHeight(x, z));
    this.scenery = createScenery(settings.track || 'countryside', seed, this.trackData.curve);
    this.scene.add(this.scenery);

    this.playerCar.visible = true;
    const startPos = this.trackData.curve.getPointAt(0);
    const startTan = this.trackData.curve.getTangentAt(0);
    this.playerPhysics.reset(startPos, Math.atan2(startTan.x, startTan.z));
    this.playerCar.position.copy(startPos);
    this.cameraController.reset(startPos);

    if (settings.track === 'tokyo') {
      this.weather.setSeasonCycle(false, 0);
      this.weather.fogScale = 0.35;
      this.weather.setWeather('rain');
      this.weather.setTimeOfDay(19.6);
    } else {
      this.weather.fogScale = 1;
      this.weather.setWeather('clear');
      this.weather.setTimeOfDay(14);
    }

    if (this.gfx) {
      this.gfx.setTheme({
        theme: settings.track || 'countryside',
        timeOfDay: this.weather.timeOfDay,
        weather: this.weather.currentWeather,
        fogScale: this.weather.fogScale,
        curve: this.trackData.curve,
        width: this.trackData.width,
        gapZones: this.trackData.gapZones,
        seed,
      });
    }

    this.race.reset();
    this.race.totalLaps = 999;
    this.state = 'freeroam';
    this.hud.showMessage('Free Roam - Explore the track!', 3000);
  }

  openConfigurator() {
    this.gameMode = 'configurator';
    this.hud.hide();
    this.clearWorld();
    this.configurator.enter();
    this.state = 'configurator';
  }

  clearWorld() {
    if (this.scenery) {
      this.scene.remove(this.scenery);
      this.scenery = null;
    }
    if (this.trackData && this.trackData.group) {
      this.scene.remove(this.trackData.group);
    }
    if (this.aiDirector) {
      this.aiDirector.dispose();
      this.aiDirector = null;
    }
    this.trackData = null;
    this.particles.emitters = [];
    if (this.gfx && this.gfx.decals) {
      this.gfx.decals.clearSkid();
      this.gfx.decals.clearDecals();
    }
  }

  getGridPosition(index) {
    if (!this.trackData) return { position: new THREE.Vector3(), angle: 0 };
    const t = 0.99 - (index * 0.003);
    const pt = this.trackData.curve.getPointAt(Math.max(0, t));
    const tangent = this.trackData.curve.getTangentAt(Math.max(0, t));
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? 1 : -1;
    const pos = pt.clone().add(normal.clone().multiplyScalar(3 * side));
    pos.add(tangent.clone().multiplyScalar(-row * 5));
    return { position: pos, angle: Math.atan2(tangent.x, tangent.z) };
  }

  getGroundHeight(x, z) {
    if (!this.trackData) return 0;
    const pts = this.trackData.trackPoints;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(x - pts[i].x, z - pts[i].z);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    const t = nearestIdx / Math.max(1, pts.length - 1);
    for (const gz of this.trackData.gapZones) {
      if (t >= gz.tStart && t <= gz.tEnd) return NaN;
    }
    const onRoad = nearestDist < (this.trackData.width / 2 + 4);
    if (onRoad) return pts[nearestIdx].y;
    return getTerrainHeight(x, z, this.trackData.theme, this.trackData.noise);
  }

  startRenderLoop() {
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  render() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.rawDt = Math.min(rawDt, 0.25);
    this.elapsedTime += dt;
    this.updateFPS(dt);
    updateWindTime(dt);

    switch (this.state) {
      case 'menu': this.updateMenu(dt); break;
      case 'configurator': this.updateConfigurator(dt); break;
      case 'racing': this.updateRacing(dt); break;
      case 'freeroam': this.updateFreeRoam(dt); break;
      case 'paused': break;
    }

    this.weather.update(dt, this.camera.position);

    // When the graphics engine owns lighting, mute the legacy weather lights so
    // the scene is not lit twice.
    if (this.gfxOwnsLighting && this.weather) {
      if (this.weather.sunLight) { this.weather.sunLight.intensity = 0; this.weather.sunLight.castShadow = false; }
      if (this.weather.ambientLight) this.weather.ambientLight.intensity = 0;
      if (this.weather.hemisphereLight) this.weather.hemisphereLight.intensity = 0;
    }

    this.particles.update(dt, {
      groundY: this.playerPhysics ? this.playerPhysics.position.y : 0,
      wetness: this.weather ? ((this.weather.currentWeather === 'rain' || this.weather.currentWeather === 'storm') ? 1 : 0) : 0,
      turbulence: 0.3,
    });
    this.updateCinematic(dt, rawDt);

    const ctx = this.graphicsContext();
    if (this.gfx) {
      this.gfx.update(dt, ctx);
      this.gfx.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Drive the speed-reactive grade, brake lights and headlights.
   * Top speed in this build is ~95 m/s (342 km/h), which maps to 1.0.
   */
  updateCinematic(dt, rawDt) {
    const phys = this.playerPhysics;
    const speed01 = clamp(phys.speed / 95, 0, 1);
    const driving = this.state === 'racing' || this.state === 'freeroam';
    const extra = driving && this.nitro.active ? 0.35 : 0;

    this.speed01 = driving ? Math.min(speed01 + extra, 1.6) : 0;

    if (this.gfx) {
      // Hand the speed-driven grade + bloom the current intensity.
      if (this.gfx.post) {
        this.gfx.post.setSetting('bloomStrength', 0.72 + this.speed01 * 0.55);
      }
      this.gfx.settings.speed01 = this.speed01;
    }

    const rolling = driving ? clamp(phys.speed / 4, 0, 1) : 0;
    this.updateCarLights(dt, phys.brake * rolling, speed01);
  }

  updateCarLights(dt, brakeAmount, speed01) {
    const mats = this.playerCar.userData.mats;
    if (!mats) return;

    // taillights flare under braking and shimmer at speed (kept hot
    // so the bloom pass smears them across the wet tarmac)
    if (mats.taillightMat) {
      const target = 2.2 + brakeAmount * 9.0 + speed01 * 0.8;
      mats.taillightMat.emissiveIntensity = damp(mats.taillightMat.emissiveIntensity, target, 12, dt);
    }

    // headlights come on after dark
    const hour = this.weather.timeOfDay;
    const night = hour < 6.6 || hour > 18.4;
    const beams = this.playerCar.userData.parts.headlightBeams;
    if (beams) {
      const target = night && this.playerCar.visible ? 6.5 : 0;
      beams.forEach((b) => { b.intensity = damp(b.intensity, target, 4, dt); });
    }
    if (mats.headlightMat) {
      const target = night ? 6.0 : 3.2;
      mats.headlightMat.emissiveIntensity = damp(mats.headlightMat.emissiveIntensity, target, 4, dt);
    }
  }

  updateMenu(dt) {
    const time = this.elapsedTime * 0.2;
    const radius = 15;
    this.camera.position.set(
      Math.sin(time) * radius,
      5 + Math.sin(time * 0.5) * 2,
      Math.cos(time) * radius
    );
    this.camera.lookAt(0, 1, 0);
  }

  updateConfigurator(dt) {
    this.configurator.update(dt);
  }

  updateRacing(dt) {
    if (this.isPaused) return;

    this.input.update(dt);

    if (this.input.consumePauseToggle()) {
      this.pauseGame();
      return;
    }

    const input = this.input.getInput();
    const prevSpeed = this.playerPhysics.speed;
    const result = this.playerPhysics.update(dt, input, 1.0);

    if (this.nitro.active) {
      this.nitro.timer -= dt;
      if (this.nitro.timer <= 0) { this.nitro.active = false; this.nitro.timer = 0; }
      else {
        const forwardDir = new THREE.Vector3(Math.sin(this.playerPhysics.heading), 0, Math.cos(this.playerPhysics.heading));
        this.playerPhysics.velocity.add(forwardDir.multiplyScalar(140 * dt));
      }
    }
    if (this.nitro.cooldown > 0) this.nitro.cooldown = Math.max(0, this.nitro.cooldown - dt);

    if (this.playerPhysics.fallen) {
      this.respawnCar();
      return;
    }

    const speedDiff = Math.abs(result.speed - prevSpeed);
    if (speedDiff > 20) {
      this.cameraController.addShake(0.3);
      this.audio.playEffect('collision', 0.5);
    }

    this.updatePlayerVisuals(dt, result);
    this.updateCamera(dt, result);
    this.updateRaceLogic(dt, result);
    this.updateEffects(dt, result);
    this.updateAI(dt);
    this.updateHUD(result);
    this.checkTrackLimits(result);
  }

  updateFreeRoam(dt) {
    this.input.update(dt);
    if (this.input.consumePauseToggle()) {
      this.pauseGame();
      return;
    }

    const input = this.input.getInput();
    const result = this.playerPhysics.update(dt, input, 1.0);

    if (this.nitro.active) {
      this.nitro.timer -= dt;
      if (this.nitro.timer <= 0) { this.nitro.active = false; this.nitro.timer = 0; }
      else {
        const forwardDir = new THREE.Vector3(Math.sin(this.playerPhysics.heading), 0, Math.cos(this.playerPhysics.heading));
        this.playerPhysics.velocity.add(forwardDir.multiplyScalar(140 * dt));
      }
    }
    if (this.nitro.cooldown > 0) this.nitro.cooldown = Math.max(0, this.nitro.cooldown - dt);

    if (this.playerPhysics.fallen) {
      this.respawnCar();
      return;
    }

    this.updatePlayerVisuals(dt, result);
    this.updateCamera(dt, result);
    this.updateEffects(dt, result);
    this.updateHUD(result);
  }

  updatePlayerVisuals(dt, physData) {
    const phys = this.playerPhysics;
    this.playerCar.position.copy(phys.position);
    this.playerCar.rotation.y = phys.heading;

    const bodyRoll = clamp(phys.gForceLat * 0.025, -0.06, 0.06);
    const bodyPitch = clamp(-phys.gForceLon * 0.02, -0.04, 0.04);
    this.playerCar.rotation.z = damp(this.playerCar.rotation.z, bodyRoll, 8, dt);
    this.playerCar.rotation.x = damp(this.playerCar.rotation.x, bodyPitch, 8, dt);

    for (let i = 0; i < 4; i++) {
      const wheel = this.playerCar.userData.wheels[i];
      if (!wheel) continue;
      if (wheel.userData.steering) {
        wheel.rotation.y = phys.steerAngle * 0.85;
      }
      wheel.children.forEach(child => {
        child.rotation.x = phys.wheelRotations[i];
      });
    }
  }

  updateCamera(dt, physData) {
    const look = this.input.getLook();
    const carData = {
      position: this.playerPhysics.position,
      heading: this.playerPhysics.heading,
      speed: this.playerPhysics.speed,
      steering: this.playerPhysics.steerAngle,
      isDrifting: this.playerPhysics.isDrifting,
      velocity: this.playerPhysics.velocity,
      freeLook: this.input.isFreeLook(),
      lookX: look.x,
      lookY: look.y,
    };
    this.cameraController.setLook(look.x, look.y);
    this.cameraController.update(dt, carData);
  }

  updateRaceLogic(dt, physData) {
    const raceDt = this.rawDt !== undefined ? this.rawDt : dt;
    const event = this.race.update(raceDt, {
      position: this.playerPhysics.position,
      speed: this.playerPhysics.speed,
      gForceLat: this.playerPhysics.gForceLat,
      gForceLon: this.playerPhysics.gForceLon,
      driftAngle: this.playerPhysics.driftAngle,
      throttle: this.playerPhysics.throttle,
      brake: this.playerPhysics.brake,
    }, this.trackData, this.aiDirector);

    if (this.race.state === 'countdown') {
      this.hud.showCountdown(this.race.countdownValue);
    } else if (event === 'go') {
      this.hud.showCountdown(0);
    }

    if (event === 'lap') {
      this.hud.showMessage(`Lap ${this.race.currentLap}/${this.race.totalLaps}`, 2000);
      this.audio.playEffect('lap_complete');
    } else if (event === 'finish') {
      this.hud.showMessage(`Finished! Position: ${this.race.racePosition}${this.ordinal(this.race.racePosition)}`, 5000);
      this.audio.playEffect('lap_complete');
    }
  }

  updateEffects(dt, physData) {
    const isDrifting = this.playerPhysics.isDrifting;
    const speed = this.playerPhysics.speed;
    const wheels = this.playerCar.userData.wheels;
    const underglow = this.playerCar.userData.parts.underglow;

    // Lay rubber on the tarmac whenever the tyres are slipping.
    this.updateSkidMarks(isDrifting, speed, wheels);

    // Wet-weather rooster tails: spray off all four wheels at speed.
    const wet = this.weather && (this.weather.currentWeather === 'rain' || this.weather.currentWeather === 'storm');
    if (wet && speed > 12) {
      for (let i = 0; i < 4; i++) {
        const w = wheels[i];
        if (!w) continue;
        const wheelPos = new THREE.Vector3();
        w.getWorldPosition(wheelPos);
        this.particles.emitSpray(wheelPos, this.playerPhysics.velocity, Math.min(1, speed / 60));
      }
    }

    if (this.nitro.active) {
      const pulse = 1 + Math.sin(this.elapsedTime * 20) * 0.4;
      if (underglow) {
        underglow.intensity = 2.5 * pulse;
        underglow.distance = 6;
      }
      this.particles.emitExhaust(
        new THREE.Vector3(
          this.playerPhysics.position.x - Math.sin(this.playerPhysics.heading) * 2.3,
          this.playerPhysics.position.y + 0.3,
          this.playerPhysics.position.z - Math.cos(this.playerPhysics.heading) * 2.3
        ),
        new THREE.Vector3(-Math.sin(this.playerPhysics.heading), 0.15, -Math.cos(this.playerPhysics.heading)),
        1.0
      );
    } else if (underglow) {
      underglow.intensity = 0.5;
      underglow.distance = 3;
    }

    if (isDrifting && speed > 5) {
      for (let i = 2; i < 4; i++) {
        if (wheels[i]) {
          const wheelPos = new THREE.Vector3();
          wheels[i].getWorldPosition(wheelPos);
          this.particles.emitTireSmoke(wheelPos, this.playerPhysics.velocity, 1.0);
        }
      }
    }

    const exhaustPos = new THREE.Vector3(
      this.playerPhysics.position.x - Math.sin(this.playerPhysics.heading) * 2.3,
      this.playerPhysics.position.y + 0.3,
      this.playerPhysics.position.z - Math.cos(this.playerPhysics.heading) * 2.3
    );
    const exhaustDir = new THREE.Vector3(
      -Math.sin(this.playerPhysics.heading),
      0.1,
      -Math.cos(this.playerPhysics.heading)
    );
    this.particles.emitExhaust(exhaustPos, exhaustDir, this.playerPhysics.throttle);

    if (this.playerPhysics.throttle > 0.5 && speed > 10) {
      for (let i = 2; i < 4; i++) {
        if (wheels[i] && Math.random() < 0.3) {
          const wheelPos = new THREE.Vector3();
          wheels[i].getWorldPosition(wheelPos);
          this.particles.emitTireSmoke(wheelPos, this.playerPhysics.velocity, 0.5);
        }
      }
    }
  }

  /**
   * Lay rubber on the tarmac whenever the tyres are slipping: drifting lays the
   * darkest marks, locked brakes a little lighter, wheelspin on launch lighter
   * still. Skid lanes are keyed per wheel so a slide paints four continuous
   * ribbons rather than a scatter of dashes.
   */
  updateSkidMarks(isDrifting, speed, wheels) {
    const decals = this.gfx && this.gfx.decals;
    if (!decals || !wheels) return;
    const keys = ['fl', 'fr', 'rl', 'rr'];
    const braking = this.playerPhysics.brake > 0.7 && speed > 8;
    const spinning = this.playerPhysics.throttle > 0.85 && speed < 16;
    const sliding = isDrifting && speed > 4;

    if (!sliding && !braking && !spinning) {
      for (const k of keys) decals.breakSkid(k);
      return;
    }

    const baseY = this.playerPhysics.position.y + 0.02;
    const strength = sliding ? 1.0 : braking ? 0.85 : 0.62;
    const wheelPos = new THREE.Vector3();
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (!w) continue;
      w.getWorldPosition(wheelPos);
      wheelPos.y = baseY;
      decals.emitSkid(keys[i], wheelPos, 0.17, strength);
    }
  }

  updateAI(dt) {
    if (this.aiDirector) {
      this.aiDirector.update(dt, this.playerPhysics.position, this.playerPhysics.speed);
    }
  }

  updateHUD(physData) {
    const raceData = this.race.getData();
    const telemetry = this.playerPhysics.getTelemetry();
    const standings = this.aiDirector ? this.aiDirector.getStandings().slice(0, 5) : [];
    standings.unshift({
      name: 'YOU',
      isPlayer: true,
      gap: 0,
    });

    const minimapData = this.getMinimapData();

    this.hud.update({
      speedKmh: telemetry.speedKmh,
      rpm: telemetry.rpm,
      redlineRPM: this.playerPhysics.redlineRPM,
      gear: telemetry.gear,
      gForceLat: telemetry.gForceLat,
      gForceLon: telemetry.gForceLon,
      isDrifting: telemetry.isDrifting,
      driftAngle: telemetry.driftAngle,
      throttle: telemetry.throttle,
      brake: telemetry.brake,
      lap: raceData.currentLap,
      totalLaps: raceData.totalLaps,
      position: raceData.racePosition,
      totalRacers: raceData.totalRacers,
      raceTime: raceData.raceTime,
      bestLapTime: raceData.bestLapTime,
      lastLapTime: raceData.lastLapTime,
      delta: raceData.lastDelta,
      damage: this.playerPhysics.damageAmount,
      standings,
      minimapData,
    });
  }

  getMinimapData() {
    if (!this.trackData) return null;
    const pts = this.trackData.trackPoints;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    pts.forEach(p => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    });
    const scale = 180 / Math.max(maxX - minX, maxZ - minZ);

    const cars = [{
      x: this.playerPhysics.position.x,
      z: this.playerPhysics.position.z,
      isPlayer: true,
    }];

    if (this.aiDirector) {
      this.aiDirector.opponents.forEach(opp => {
        cars.push({ x: opp.physics.position.x, z: opp.physics.position.z, isPlayer: false });
      });
    }

    return { trackPoints: pts, scale, cars };
  }

  checkTrackLimits(physData) {
    if (!this.trackData) return;
    const pos = this.playerPhysics.position;
    const trackWidth = this.trackData.width / 2 + 2;
    let onTrack = false;

    for (let i = 0; i < this.trackData.trackPoints.length; i += 5) {
      const dist = pos.distanceTo(this.trackData.trackPoints[i]);
      if (dist < trackWidth) { onTrack = true; break; }
    }

    if (!onTrack) {
      this.offTrackTimer += 0.016;
      if (this.offTrackTimer > 2) {
        this.hud.showNotification('OFF TRACK!', 'warning', 1000);
        this.playerPhysics.velocity.multiplyScalar(0.95);
      }
    } else {
      this.offTrackTimer = 0;
    }
  }

  activateNitro() {
    const n = this.nitro;
    if (n.active || n.cooldown > 0) return;
    n.active = true;
    n.timer = 3.5;
    n.cooldown = 8;
    this.hud.showMessage('NITRO BOOST', 1200);
    this.cameraController.addShake(0.5);
    this.audio.playEffect('boost');
  }

  respawnCar() {
    if (!this.trackData) return;
    const grid = this.getGridPosition(0);
    this.playerPhysics.fallen = false;
    this.playerPhysics.reset(grid.position, grid.angle);
    this.playerCar.position.copy(grid.position);
    this.playerCar.rotation.y = grid.angle;
    this.playerPhysics.velocity.set(0, 0, 0);
    this.cameraController.reset(grid.position);
    this.hud.showMessage('Respawned', 1200);
  }

  pauseGame() {
    this.isPaused = true;
    this.state = 'paused';
    this.menu.show();
    this.hud.showMessage('PAUSED', 999999);
  }

  resumeGame() {
    this.isPaused = false;
    this.state = this.gameMode === 'racing' ? 'racing' : 'freeroam';
    this.menu.hide();
    this.hud.showMessage('RESUMED', 1000);
  }

  updateFPS(dt) {
    const currentFPS = 1 / dt;
    this.fpsHistory.push(currentFPS);
    if (this.fpsHistory.length > 60) this.fpsHistory.shift();
    this.fps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
  }

  ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }
}

const game = new Game();
window.game = game;
