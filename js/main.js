import * as THREE from 'three';
import { createCarModel, CAR_PAINT_COLORS } from './car.js';
import { createDefaultPhysics } from './physics.js';
import { createTrack, TRACK_THEMES } from './track.js';
import { createScenery } from './scenery.js';
import { createScene, createCamera, createRenderer } from './environment.js';
import { createPostFX, updatePostFXSize, setBloomIntensity } from './postfx.js';
import { InputManager } from './controls.js';
import { HUD } from './hud.js';
import { AudioManager } from './audio.js';
import { WeatherSystem } from './weather.js';
import { ParticleSystem } from './particles.js';
import { CarConfigurator } from './configurator.js';
import { CameraController } from './camera.js';
import { GameMenu } from './menu.js';
import { RaceManager } from './race.js';
import { AIDirector } from './ai.js';
import { clamp, damp, formatTime, lerp } from './utils.js';

class Game {
  constructor() {
    this.state = 'loading';
    this.canvas = document.getElementById('webgl');
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.postFX = null;
    this.playerCar = null;
    this.playerPhysics = null;
    this.trackData = null;
    this.scenery = null;
    this.input = new InputManager();
    this.hud = new HUD();
    this.audio = new AudioManager();
    this.weather = null;
    this.particles = null;
    this.configurator = null;
    this.cameraController = null;
    this.menu = null;
    this.race = new RaceManager();
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

    this.updateLoader(10, 'Creating scene...');
    this.scene = createScene(this.renderer);
    this.camera = createCamera();

    this.updateLoader(15, 'Setting up post-processing...');
    this.postFX = createPostFX(this.renderer, this.scene, this.camera);

    this.updateLoader(20, 'Creating weather system...');
    this.weather = new WeatherSystem(this.scene);
    this.weather.setupLights();
    this.weather.createSky();
    this.weather.createRain();
    this.weather.createSnow();
    this.weather.createCloudLayer();

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
    this.postFX.composer.setSize(w, h);
    updatePostFXSize(this.postFX, w, h, this.renderer.getPixelRatio());
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
    this.aiDirector = new AIDirector(this.scene, this.trackData, settings.difficulty);
    this.aiDirector.numOpponents = settings.opponents || 10;

    this.updateLoader(75, 'Configuring weather...');
    if (settings.weather) this.weather.setWeather(settings.weather);
    if (settings.timeOfDay) this.weather.setTimeOfDay(settings.timeOfDay);

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
    this.scenery = createScenery(settings.track || 'countryside', seed, this.trackData.curve);
    this.scene.add(this.scenery);

    this.playerCar.visible = true;
    const startPos = this.trackData.curve.getPointAt(0);
    const startTan = this.trackData.curve.getTangentAt(0);
    this.playerPhysics.reset(startPos, Math.atan2(startTan.x, startTan.z));
    this.playerCar.position.copy(startPos);
    this.cameraController.reset(startPos);

    this.weather.setWeather('clear');
    this.weather.setTimeOfDay(14);

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

  startRenderLoop() {
    const loop = () => {
      this.animFrameId = requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  render() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsedTime += dt;
    this.updateFPS(dt);

    switch (this.state) {
      case 'menu': this.updateMenu(dt); break;
      case 'configurator': this.updateConfigurator(dt); break;
      case 'racing': this.updateRacing(dt); break;
      case 'freeroam': this.updateFreeRoam(dt); break;
      case 'paused': break;
    }

    this.weather.update(dt, this.camera.position);
    this.particles.update(dt);
    this.postFX.composer.render();
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
    const carData = {
      position: this.playerPhysics.position,
      heading: this.playerPhysics.heading,
      speed: this.playerPhysics.speed,
      steering: this.playerPhysics.steerAngle,
      isDrifting: this.playerPhysics.isDrifting,
      velocity: this.playerPhysics.velocity,
    };
    this.cameraController.update(dt, carData);
  }

  updateRaceLogic(dt, physData) {
    this.race.update(dt, {
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
    }

    const event = this.race.update(dt, {
      position: this.playerPhysics.position,
      speed: this.playerPhysics.speed,
      gForceLat: physData.gForceLat,
      gForceLon: physData.gForceLon,
      driftAngle: this.playerPhysics.driftAngle,
      throttle: this.playerPhysics.throttle,
      brake: this.playerPhysics.brake,
    }, this.trackData, this.aiDirector);

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
