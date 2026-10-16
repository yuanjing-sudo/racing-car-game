import * as THREE from 'three';
import { createCarModel, CAR_PAINT_COLORS, WHEEL_STYLES, SPOILER_TYPES, updateCarConfig } from './car.js';
import { clamp, damp } from './utils.js';

export class CarConfigurator {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.isActive = false;
    this.car = null;
    this.rotationAngle = 0;
    this.targetRotation = 0;
    this.cameraDistance = 6;
    this.targetCameraDist = 6;
    this.cameraHeight = 2;
    this.autoRotateSpeed = 0.3;
    this.selectedColor = 0;
    this.selectedWheel = 0;
    this.selectedSpoiler = 3;
    this.selectedRim = 0;
    this.windowTint = 0.3;
    this.paintFinish = 'gloss';
    this.environmentIntensity = 1.0;
    this.showroomFloor = null;
    this.spotLights = [];
    this.originalScene = null;
    this.showroomEnv = null;
  }

  enter() {
    this.isActive = true;
    this.createShowroomEnvironment();
    this.car = createCarModel({
      paintColor: CAR_PAINT_COLORS[this.selectedColor].color,
      wheelStyle: this.selectedWheel,
      spoilerType: this.selectedSpoiler,
      rimColor: [0xcccccc, 0x333333, 0xffcc00, 0xcc0000][this.selectedRim],
      windowTint: this.windowTint,
    });
    this.car.position.set(0, 0, 0);
    this.scene.add(this.car);
    this.targetRotation = 0;
    this.rotationAngle = 0;
  }

  exit() {
    this.isActive = false;
    if (this.car) {
      this.scene.remove(this.car);
      this.car = null;
    }
    this.removeShowroomEnvironment();
  }

  createShowroomEnvironment() {
    this.showroomEnv = new THREE.Group();

    const floorGeo = new THREE.CircleGeometry(8, 64);
    const floorMat = new THREE.MeshPhysicalMaterial({
      color: 0x111111,
      metalness: 0.9,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      reflectivity: 1.0,
    });
    this.showroomFloor = new THREE.Mesh(floorGeo, floorMat);
    this.showroomFloor.rotation.x = -Math.PI / 2;
    this.showroomFloor.receiveShadow = true;
    this.showroomEnv.add(this.showroomFloor);

    const ringGeo = new THREE.TorusGeometry(4, 0.05, 8, 64);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      emissive: 0xff6600,
      emissiveIntensity: 2.0,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.showroomEnv.add(ring);

    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(4.5, 0.03, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xff6600, emissiveIntensity: 0.5 })
    );
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.01;
    this.showroomEnv.add(ring2);

    const spotPositions = [
      { x: 0, y: 8, z: 0, intensity: 50, color: 0xffffff },
      { x: -5, y: 6, z: -3, intensity: 30, color: 0xffeedd },
      { x: 5, y: 6, z: -3, intensity: 30, color: 0xddeeff },
      { x: 0, y: 4, z: 5, intensity: 20, color: 0xffffff },
      { x: -4, y: 3, z: 4, intensity: 15, color: 0xff6600 },
      { x: 4, y: 3, z: 4, intensity: 15, color: 0x0066ff },
    ];

    spotPositions.forEach(s => {
      const spot = new THREE.SpotLight(s.color, s.intensity, 20, Math.PI / 4, 0.5);
      spot.position.set(s.x, s.y, s.z);
      spot.target.position.set(0, 0, 0);
      this.showroomEnv.add(spot);
      this.showroomEnv.add(spot.target);
      this.spotLights.push(spot);
    });

    const ambient = new THREE.AmbientLight(0x222222, 0.5);
    this.showroomEnv.add(ambient);

    const bgGeo = new THREE.SphereGeometry(50, 32, 16);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide });
    const bgSphere = new THREE.Mesh(bgGeo, bgMat);
    this.showroomEnv.add(bgSphere);

    this.scene.add(this.showroomEnv);
  }

  removeShowroomEnvironment() {
    if (this.showroomEnv) {
      this.scene.remove(this.showroomEnv);
      this.spotLights = [];
      this.showroomEnv = null;
      this.showroomFloor = null;
    }
  }

  update(dt) {
    if (!this.isActive || !this.car) return;

    this.rotationAngle = damp(this.rotationAngle, this.targetRotation, 5, dt);
    this.car.rotation.y = this.rotationAngle;

    this.cameraDistance = damp(this.cameraDistance, this.targetCameraDist, 3, dt);

    const camAngle = this.rotationAngle + Math.PI * 0.75;
    const targetCamPos = new THREE.Vector3(
      Math.sin(camAngle) * this.cameraDistance,
      this.cameraHeight,
      Math.cos(camAngle) * this.cameraDistance
    );
    this.camera.position.lerp(targetCamPos, 1 - Math.exp(-5 * dt));
    this.camera.lookAt(0, 0.5, 0);

    if (this.showroomFloor) {
      this.showroomFloor.material.envMapIntensity = this.environmentIntensity;
    }
  }

  rotateLeft() { this.targetRotation += Math.PI / 6; }
  rotateRight() { this.targetRotation -= Math.PI / 6; }
  zoomIn() { this.targetCameraDist = clamp(this.targetCameraDist - 1, 3, 10); }
  zoomOut() { this.targetCameraDist = clamp(this.targetCameraDist + 1, 3, 10); }

  setColor(index) {
    this.selectedColor = index;
    if (this.car) updateCarConfig(this.car, { paintColor: CAR_PAINT_COLORS[index].color });
  }

  setWheelStyle(index) {
    this.selectedWheel = index;
    if (this.car) {
      this.scene.remove(this.car);
      this.car = createCarModel({
        paintColor: CAR_PAINT_COLORS[this.selectedColor].color,
        wheelStyle: this.selectedWheel,
        spoilerType: this.selectedSpoiler,
        rimColor: [0xcccccc, 0x333333, 0xffcc00, 0xcc0000][this.selectedRim],
        windowTint: this.windowTint,
      });
      this.scene.add(this.car);
    }
  }

  setSpoiler(index) {
    this.selectedSpoiler = index;
    if (this.car) {
      this.scene.remove(this.car);
      this.car = createCarModel({
        paintColor: CAR_PAINT_COLORS[this.selectedColor].color,
        wheelStyle: this.selectedWheel,
        spoilerType: this.selectedSpoiler,
        rimColor: [0xcccccc, 0x333333, 0xffcc00, 0xcc0000][this.selectedRim],
        windowTint: this.windowTint,
      });
      this.scene.add(this.car);
    }
  }

  setRimColor(index) {
    this.selectedRim = index;
    if (this.car) {
      updateCarConfig(this.car, { rimColor: [0xcccccc, 0x333333, 0xffcc00, 0xcc0000][index] });
    }
  }

  setWindowTint(value) {
    this.windowTint = value;
    if (this.car) updateCarConfig(this.car, { windowTint: value });
  }

  setPaintFinish(finish) {
    this.paintFinish = finish;
    if (this.car) {
      const mat = this.car.userData.materials.paintMat;
      switch (finish) {
        case 'gloss':
          mat.roughness = 0.08; mat.clearcoat = 1.0; mat.metalness = 0.85; break;
        case 'matte':
          mat.roughness = 0.7; mat.clearcoat = 0.0; mat.metalness = 0.3; break;
        case 'metallic':
          mat.roughness = 0.15; mat.clearcoat = 0.5; mat.metalness = 1.0; break;
        case 'satin':
          mat.roughness = 0.3; mat.clearcoat = 0.3; mat.metalness = 0.6; break;
      }
    }
  }

  getConfig() {
    return {
      paintColor: CAR_PAINT_COLORS[this.selectedColor].color,
      paintColorName: CAR_PAINT_COLORS[this.selectedColor].name,
      wheelStyle: this.selectedWheel,
      wheelStyleName: WHEEL_STYLES[this.selectedWheel].name,
      spoilerType: this.selectedSpoiler,
      spoilerName: SPOILER_TYPES[this.selectedSpoiler].name,
      rimColor: this.selectedRim,
      windowTint: this.windowTint,
      paintFinish: this.paintFinish,
    };
  }
}
