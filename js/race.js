import * as THREE from 'three';
import { clamp, lerp, damp, formatTime, formatSpeed } from './utils.js';

export class RaceManager {
  constructor() {
    this.state = 'idle';
    this.countdownValue = 3;
    this.countdownTimer = 0;
    this.raceTime = 0;
    this.currentLap = 1;
    this.totalLaps = 3;
    this.bestLapTime = null;
    this.lastLapTime = null;
    this.lapStartTime = 0;
    this.lapTimes = [];
    this.sectorTimes = [[], [], []];
    this.currentSector = 0;
    this.lastCheckpointIdx = 0;
    this.racePosition = 1;
    this.totalRacers = 1;
    this.isFinished = false;
    this.finishTime = null;
    this.penalties = [];
    this.offTrackTime = 0;
    this.wrongWay = false;
    this.wrongWayTimer = 0;
    this.drsAvailable = false;
    this.drsActive = false;
    this.ersCharge = 0;
    this.ersActive = false;
    this.ersMode = 0;
    this.fuelLevel = 100;
    this.tireWear = [0, 0, 0, 0];
    this.tireTemp = [80, 80, 80, 80];
    this.brakeTemp = [300, 300, 300, 300];
    this.gForceHistory = [];
    this.speedTrap = [];
    this.topSpeed = 0;
    this.currentSpeed = 0;
    this.lastDelta = null;
    this.bestDelta = null;
    this.personalBest = null;
  }

  start(settings) {
    this.state = 'countdown';
    this.countdownValue = 3;
    this.countdownTimer = 3.0;
    this.countdownEndTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 3000;
    this.raceTime = 0;
    this.currentLap = 1;
    this.totalLaps = settings.laps || 3;
    this.bestLapTime = null;
    this.lastLapTime = null;
    this.lapStartTime = 0;
    this.lapTimes = [];
    this.sectorTimes = [[], [], []];
    this.currentSector = 0;
    this.lastCheckpointIdx = 0;
    this.racePosition = 1;
    this.totalRacers = settings.opponents || 10;
    this.isFinished = false;
    this.finishTime = null;
    this.penalties = [];
    this.offTrackTime = 0;
    this.wrongWay = false;
    this.wrongWayTimer = 0;
    this.drsAvailable = false;
    this.drsActive = false;
    this.ersCharge = 100;
    this.ersActive = false;
    this.ersMode = 0;
    this.fuelLevel = 100;
    this.tireWear = [0, 0, 0, 0];
    this.tireTemp = [80, 80, 80, 80];
    this.brakeTemp = [300, 300, 300, 300];
    this.gForceHistory = [];
    this.speedTrap = [];
    this.topSpeed = 0;
    this.currentSpeed = 0;
    this.lastDelta = null;
    this.bestDelta = null;
  }

  update(dt, carData, trackData, aiData) {
    switch (this.state) {
      case 'countdown': return this.updateCountdown(dt);
      case 'racing': return this.updateRacing(dt, carData, trackData, aiData);
      case 'finished': this.updateFinished(dt); return null;
      case 'paused': return null;
    }
    return null;
  }

  updateCountdown(dt) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const remaining = (this.countdownEndTime - now) / 1000;
    this.countdownTimer = remaining;
    this.countdownValue = Math.max(1, Math.ceil(remaining));

    if (remaining <= 0) {
      this.state = 'racing';
      this.raceTime = 0;
      this.lapStartTime = 0;
      return 'go';
    }
    return null;
  }

  updateRacing(dt, carData, trackData, aiData) {
    this.raceTime += dt;
    this.lapStartTime += dt;
    this.currentSpeed = carData.speed * 3.6;
    this.topSpeed = Math.max(this.topSpeed, this.currentSpeed);

    this.updateTireWear(dt, carData);
    this.updateTireTemp(dt, carData);
    this.updateBrakeTemp(dt, carData);
    this.updateFuel(dt, carData);
    this.updateERS(dt, carData);
    this.updateDRS(trackData, carData);
    this.updateTrackPosition(trackData, carData);
    this.updateSectorTiming(trackData, carData);
    this.updateRacePosition(aiData);
    this.updateSpeedTrap(carData);

    this.gForceHistory.push({ lat: carData.gForceLat, lon: carData.gForceLon, time: this.raceTime });
    if (this.gForceHistory.length > 600) this.gForceHistory.shift();

    const event = this.pendingEvent || null;
    this.pendingEvent = null;
    return event;
  }

  updateTireWear(dt, carData) {
    const wearRate = 0.0001;
    const slipWear = Math.abs(carData.driftAngle || 0) * 0.001;
    const brakingWear = carData.brake * 0.0005;
    const corneringWear = Math.abs(carData.gForceLat) * 0.0003;

    for (let i = 0; i < 4; i++) {
      const frontBias = i < 2 ? 1.3 : 0.7;
      this.tireWear[i] = clamp(this.tireWear[i] + (wearRate + slipWear + brakingWear + corneringWear) * frontBias * dt, 0, 1);
    }
  }

  updateTireTemp(dt, carData) {
    const targetTemps = [85, 85, 85, 85];
    for (let i = 0; i < 4; i++) {
      const slipHeat = Math.abs(carData.driftAngle || 0) * 20;
      const brakingHeat = carData.brake * 30;
      targetTemps[i] += slipHeat + brakingHeat;
      this.tireTemp[i] = damp(this.tireTemp[i], targetTemps[i], 0.5, dt);
    }
  }

  updateBrakeTemp(dt, carData) {
    for (let i = 0; i < 4; i++) {
      const cooling = 50 * dt;
      const heating = carData.brake * 200 * dt;
      this.brakeTemp[i] = clamp(this.brakeTemp[i] + heating - cooling, 20, 800);
    }
  }

  updateFuel(dt, carData) {
    const consumption = (carData.throttle * 0.02 + 0.005) * dt;
    this.fuelLevel = clamp(this.fuelLevel - consumption, 0, 100);
  }

  updateERS(dt, carData) {
    if (carData.brake > 0.5) {
      this.ersCharge = clamp(this.ersCharge + carData.brake * 20 * dt, 0, 100);
    }
    if (this.ersActive) {
      this.ersCharge = clamp(this.ersCharge - 30 * dt, 0, 100);
      if (this.ersCharge <= 0) this.ersActive = false;
    }
  }

  updateDRS(trackData, carData) {
    this.drsAvailable = false;
    this.drsActive = false;
  }

  updateTrackPosition(trackData, carData) {
    const pos = carData.position;
    const pts = trackData.trackPoints;
    let minDist = Infinity;
    let closestIdx = 0;

    for (let i = 0; i < pts.length; i += 3) {
      const dist = pos.distanceTo(pts[i]);
      if (dist < minDist) { minDist = dist; closestIdx = i; }
    }

    const checkpointIdx = Math.floor((closestIdx / pts.length) * trackData.checkpoints.length);

    if (this.lastCheckpointIdx > trackData.checkpoints.length * 0.8 && checkpointIdx < trackData.checkpoints.length * 0.2) {
      this.pendingEvent = this.completeLap();
    }

    this.lastCheckpointIdx = checkpointIdx;
  }

  updateSectorTiming(trackData, carData) {
    const sectorLength = trackData.checkpoints.length / 4;
    const currentSector = Math.floor(this.lastCheckpointIdx / sectorLength);

    if (currentSector !== this.currentSector) {
      this.currentSector = currentSector;
    }
  }

  updateRacePosition(aiData) {
    if (!aiData || !aiData.opponents) return;
    let position = 1;
    const playerProgress = this.getProgress();

    for (const opp of aiData.opponents) {
      if (opp.racePosition < position) continue;
      const oppProgress = opp.currentLap + this.getClosestT(opp.physics.position, aiData.trackData);
      if (oppProgress > playerProgress) position++;
    }

    this.racePosition = position;
  }

  updateSpeedTrap(carData) {
    if (carData.speed * 3.6 > 200) {
      this.speedTrap.push({ speed: carData.speed * 3.6, time: this.raceTime });
      if (this.speedTrap.length > 50) this.speedTrap.shift();
    }
  }

  getProgress() {
    return (this.currentLap - 1) + (this.lastCheckpointIdx / 20);
  }

  getClosestT(position, trackData) {
    const pts = trackData.trackPoints;
    let minDist = Infinity;
    let closestT = 0;
    for (let i = 0; i < pts.length; i += 5) {
      const dist = position.distanceTo(pts[i]);
      if (dist < minDist) { minDist = dist; closestT = i / pts.length; }
    }
    return closestT;
  }

  completeLap() {
    const lapTime = this.lapStartTime;
    this.lapTimes.push(lapTime);

    if (!this.bestLapTime || lapTime < this.bestLapTime) {
      this.bestLapTime = lapTime;
    }
    this.lastLapTime = lapTime;
    this.lapStartTime = 0;
    this.currentLap++;

    if (this.currentLap > this.totalLaps) {
      this.finishRace();
      return 'finish';
    }
    return 'lap';
  }

  finishRace() {
    this.state = 'finished';
    this.isFinished = true;
    this.finishTime = this.raceTime;
  }

  updateFinished(dt) {}

  pause() { if (this.state === 'racing') this.state = 'paused'; }
  resume() { if (this.state === 'paused') this.state = 'racing'; }

  reset() {
    this.state = 'idle';
    this.raceTime = 0;
    this.currentLap = 1;
    this.bestLapTime = null;
    this.lastLapTime = null;
    this.isFinished = false;
    this.topSpeed = 0;
  }

  getData() {
    return {
      state: this.state,
      countdown: this.countdownValue,
      raceTime: this.raceTime,
      currentLap: this.currentLap,
      totalLaps: this.totalLaps,
      bestLapTime: this.bestLapTime,
      lastLapTime: this.lastLapTime,
      racePosition: this.racePosition,
      totalRacers: this.totalRacers,
      isFinished: this.isFinished,
      finishTime: this.finishTime,
      fuelLevel: this.fuelLevel,
      tireWear: [...this.tireWear],
      tireTemp: [...this.tireTemp],
      brakeTemp: [...this.brakeTemp],
      topSpeed: this.topSpeed,
      currentSpeed: this.currentSpeed,
      ersCharge: this.ersCharge,
      ersActive: this.ersActive,
      drsAvailable: this.drsAvailable,
      wrongWay: this.wrongWay,
      offTrackTime: this.offTrackTime,
    };
  }
}
