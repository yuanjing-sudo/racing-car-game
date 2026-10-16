import * as THREE from 'three';
import { clamp, lerp, damp } from './utils.js';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.modes = ['chase', 'cockpit', 'hood', 'bumper', 'cinematic', 'orbit', 'top'];
    this.smoothPosition = new THREE.Vector3();
    this.smoothLookAt = new THREE.Vector3();
    this.shakeIntensity = 0;
    this.shakeDecay = 5;
    this.fovBase = 55;
    this.fovSpeed = 75;
    this.currentFov = this.fovBase;
    this.cinematicTimer = 0;
    this.cinematicPath = [];
    this.orbitAngle = 0;
    this.freeLook = { x: 0, y: 0 };
  }

  cycle() {
    this.mode = (this.mode + 1) % this.modes.length;
    return this.modes[this.mode];
  }

  setMode(mode) {
    const idx = this.modes.indexOf(mode);
    if (idx !== -1) this.mode = idx;
  }

  getMode() { return this.modes[this.mode]; }

  update(dt, carData) {
    const { position, heading, speed, steering, isDrifting, velocity } = carData;
    const speedFactor = clamp(speed / 70, 0, 1);
    const targetFov = this.fovBase + speedFactor * (this.fovSpeed - this.fovBase);
    this.currentFov = damp(this.currentFov, targetFov, 5, dt);

    if (Math.abs(this.camera.fov - this.currentFov) > 0.1) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    switch (this.getMode()) {
      case 'chase': this.updateChase(dt, carData, speedFactor); break;
      case 'cockpit': this.updateCockpit(dt, carData); break;
      case 'hood': this.updateHood(dt, carData); break;
      case 'bumper': this.updateBumper(dt, carData); break;
      case 'cinematic': this.updateCinematic(dt, carData); break;
      case 'orbit': this.updateOrbit(dt, carData); break;
      case 'top': this.updateTop(dt, carData); break;
    }

    this.applyShake(dt);
  }

  updateChase(dt, carData, speedFactor) {
    const { position, heading, velocity } = carData;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    const dist = 6 + speedFactor * 3;
    const height = 2.5 + speedFactor * 1;

    const targetPos = new THREE.Vector3(
      position.x - sinH * dist,
      position.y + height,
      position.z - cosH * dist
    );

    const dampFactor = isDrifting => 3 + (isDrifting ? 2 : 0);
    this.smoothPosition.x = damp(this.smoothPosition.x, targetPos.x, dampFactor, dt);
    this.smoothPosition.y = damp(this.smoothPosition.y, targetPos.y, dampFactor, dt);
    this.smoothPosition.z = damp(this.smoothPosition.z, targetPos.z, dampFactor, dt);

    const lookTarget = new THREE.Vector3(
      position.x + sinH * 3,
      position.y + 0.8,
      position.z + cosH * 3
    );

    this.smoothLookAt.lerp(lookTarget, 1 - Math.exp(-6 * dt));

    this.camera.position.copy(this.smoothPosition);
    this.camera.lookAt(this.smoothLookAt);

    if (carData.isDrifting) {
      this.camera.rotation.z += Math.sin(Date.now() * 0.005) * 0.01;
    }
  }

  updateCockpit(dt, carData) {
    const { position, heading } = carData;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    this.camera.position.set(
      position.x + sinH * 0.3 + cosH * 0.2,
      position.y + 1.05,
      position.z + cosH * 0.3 - sinH * 0.2
    );

    const lookTarget = new THREE.Vector3(
      position.x + sinH * 20,
      position.y + 1.0,
      position.z + cosH * 20
    );
    this.camera.lookAt(lookTarget);
  }

  updateHood(dt, carData) {
    const { position, heading } = carData;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    this.camera.position.set(
      position.x + sinH * 0.5,
      position.y + 0.85,
      position.z + cosH * 0.5
    );

    const lookTarget = new THREE.Vector3(
      position.x + sinH * 30,
      position.y + 0.3,
      position.z + cosH * 30
    );
    this.camera.lookAt(lookTarget);
  }

  updateBumper(dt, carData) {
    const { position, heading } = carData;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);

    this.camera.position.set(
      position.x + sinH * 1.8,
      position.y + 0.6,
      position.z + cosH * 1.8
    );

    const lookTarget = new THREE.Vector3(
      position.x + sinH * 25,
      position.y + 0.5,
      position.z + cosH * 25
    );
    this.camera.lookAt(lookTarget);
  }

  updateCinematic(dt, carData) {
    this.cinematicTimer += dt;
    const { position, heading, speed } = carData;

    const angleOffset = Math.sin(this.cinematicTimer * 0.3) * Math.PI * 0.8 + Math.PI;
    const dist = 8 + Math.sin(this.cinematicTimer * 0.2) * 3;
    const height = 2 + Math.sin(this.cinematicTimer * 0.4) * 2;

    const cosA = Math.cos(heading + angleOffset);
    const sinA = Math.sin(heading + angleOffset);

    this.camera.position.set(
      position.x + sinA * dist,
      position.y + height,
      position.z + cosA * dist
    );

    this.camera.lookAt(position.x, position.y + 0.5, position.z);

    const dutchAngle = Math.sin(this.cinematicTimer * 0.15) * 0.1;
    this.camera.rotation.z += dutchAngle;
  }

  updateOrbit(dt, carData) {
    this.orbitAngle += dt * 0.5;
    const { position } = carData;

    this.camera.position.set(
      position.x + Math.sin(this.orbitAngle) * 8,
      position.y + 3,
      position.z + Math.cos(this.orbitAngle) * 8
    );
    this.camera.lookAt(position.x, position.y + 0.5, position.z);
  }

  updateTop(dt, carData) {
    const { position } = carData;
    this.camera.position.set(position.x, position.y + 30, position.z);
    this.camera.lookAt(position.x, position.y, position.z);
  }

  applyShake(dt) {
    if (this.shakeIntensity > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity * 0.5;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.exp(-this.shakeDecay * dt);
    }
  }

  addShake(intensity) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  reset(carPosition) {
    this.smoothPosition.copy(carPosition).add(new THREE.Vector3(-6, 3, -6));
    this.smoothLookAt.copy(carPosition);
    this.shakeIntensity = 0;
  }
}
