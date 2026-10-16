import * as THREE from 'three';
import { clamp, lerp, damp } from './utils.js';

export class VehiclePhysics {
  constructor(config = {}) {
    this.mass = config.mass || 1400;
    this.wheelBase = config.wheelBase || 2.7;
    this.trackWidth = config.trackWidth || 1.6;
    this.cgHeight = config.cgHeight || 0.45;
    this.maxEngineForce = config.maxEngineForce || 8000;
    this.maxBrakeForce = config.maxBrakeForce || 12000;
    this.maxSteerAngle = config.maxSteerAngle || 0.6;
    this.dragCoefficient = config.dragCoefficient || 0.3;
    this.rollingResistance = config.rollingResistance || 0.015;
    this.downforceCoeff = config.downforceCoeff || 0.5;
    this.cornerStiffnessF = config.cornerStiffnessF || 8.0;
    this.cornerStiffnessR = config.cornerStiffnessR || 8.5;
    this.wheelRadius = config.wheelRadius || 0.33;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.angularVelocity = 0;
    this.heading = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.engineRPM = 800;
    this.gear = 0;
    this.wheelRotations = [0, 0, 0, 0];
    this.slipAngles = [0, 0, 0, 0];
    this.wheelLoads = [0, 0, 0, 0];
    this.isDrifting = false;
    this.driftAngle = 0;
    this.gForceLat = 0;
    this.gForceLon = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.slipRatio = 0;
    this.isOnGround = true;
    this.suspensionTravel = [0, 0, 0, 0];
    this.suspensionVelocities = [0, 0, 0, 0];

    this.groundHeightGetter = null;
    this.isOnGround = true;
    this.fallen = false;

    this.gearRatios = [3.8, 2.2, 1.5, 1.1, 0.85, 0.7];
    this.finalDrive = 3.5;
    this.idleRPM = 800;
    this.redlineRPM = 7500;
    this.shiftTime = 0.08;
    this.isShifting = false;
    this.shiftTimer = 0;

    this.aeroMultiplier = 1.0;
    this.gripMultiplier = 1.0;
    this.damageAmount = 0.0;
  }

  setGroundHeightGetter(fn) {
    this.groundHeightGetter = fn;
  }

  reset(pos, heading = 0) {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.angularVelocity = 0;
    this.heading = heading;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.engineRPM = this.idleRPM;
    this.gear = 0;
    this.isDrifting = false;
    this.driftAngle = 0;
    this.gForceLat = 0;
    this.gForceLon = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
  }

  update(dt, input, surfaceGrip = 1.0) {
    if (this.isShifting) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) {
        this.isShifting = false;
      }
      return {
        forwardSpeed: this.forwardSpeed,
        speed: this.speed,
        latForce: 0,
        longForce: 0,
        gForceLat: this.gForceLat,
        gForceLon: this.gForceLon,
        isDrifting: this.isDrifting,
        driftAngle: this.driftAngle,
      };
    }

    const cosH = Math.cos(this.heading);
    const sinH = Math.sin(this.heading);
    const forwardDir = new THREE.Vector3(sinH, 0, cosH);
    const rightDir = new THREE.Vector3(cosH, 0, -sinH);

    this.forwardSpeed = this.velocity.dot(forwardDir);
    this.speed = this.velocity.length();

    const targetSteer = input.steering * this.maxSteerAngle;
    const steerSpeed = 5.0;
    this.steerAngle = damp(this.steerAngle, targetSteer, steerSpeed, dt);

    this.throttle = damp(this.throttle, input.throttle, 8.0, dt);
    this.brake = damp(this.brake, input.brake, 10.0, dt);

    const wheelCircumference = 2 * Math.PI * this.wheelRadius;
    const gearRatio = this.gearRatios[this.gear] * this.finalDrive;
    this.engineRPM = clamp(
      Math.abs(this.forwardSpeed) / wheelCircumference * gearRatio * 60,
      this.idleRPM,
      this.redlineRPM
    );

    if (this.engineRPM > this.redlineRPM * 0.95 && this.gear < this.gearRatios.length - 1) {
      this.shiftUp();
    }
    if (this.engineRPM < this.idleRPM * 1.5 && this.gear > 0 && this.forwardSpeed < 1) {
      this.shiftDown();
    }

    const engineForce = this.throttle * this.maxEngineForce *
      this.getEngineTorqueCurve(this.engineRPM) *
      (1 - this.damageAmount * 0.3);

    const brakeForce = this.brake * this.maxBrakeForce;
    const rollingResist = this.rollingResistance * this.mass * 9.81 * Math.sign(this.forwardSpeed);
    const dragForce = 0.5 * 1.225 * this.dragCoefficient * 2.2 * this.speed * this.speed *
      Math.sign(this.forwardSpeed) * this.aeroMultiplier;

    const totalLongForce = engineForce - brakeForce - rollingResist - dragForce;

    const totalGrip = surfaceGrip * this.gripMultiplier * (1 - this.damageAmount * 0.4);
    const maxLatForce = totalGrip * this.mass * 9.81;

    const cornerStiffness = this.forwardSpeed > 0 ?
      this.cornerStiffnessF : this.cornerStiffnessR;

    const slipAngleF = Math.abs(this.steerAngle) > 0.01 ?
      Math.atan2(
        this.velocity.dot(rightDir) + this.angularVelocity * this.wheelBase * 0.5,
        Math.abs(this.forwardSpeed)
      ) - this.steerAngle : 0;

    const slipAngleR = Math.abs(this.forwardSpeed) > 0.5 ?
      Math.atan2(
        this.velocity.dot(rightDir) - this.angularVelocity * this.wheelBase * 0.5,
        Math.abs(this.forwardSpeed)
      ) : 0;

    this.slipAngles[0] = slipAngleF;
    this.slipAngles[1] = slipAngleF;
    this.slipAngles[2] = slipAngleR;
    this.slipAngles[3] = slipAngleR;

    const tireGripF = cornerStiffness * totalGrip;
    const tireGripR = cornerStiffness * totalGrip;

    const latForceF = clamp(-slipAngleF * tireGripF, -maxLatForce * 0.6, maxLatForce * 0.6);
    const latForceR = clamp(-slipAngleR * tireGripR, -maxLatForce * 0.6, maxLatForce * 0.6);

    this.isDrifting = Math.abs(slipAngleR) > 0.15 && this.speed > 5;
    this.driftAngle = this.isDrifting ? slipAngleR : 0;

    const downforce = 0.5 * 1.225 * this.downforceCoeff * 2.5 * this.speed * this.speed;
    const effectiveWeight = this.mass * 9.81 + downforce;

    this.wheelLoads = [
      effectiveWeight * 0.25 * (1 - totalLongForce / effectiveWeight * 0.5),
      effectiveWeight * 0.25 * (1 - totalLongForce / effectiveWeight * 0.5),
      effectiveWeight * 0.25 * (1 + totalLongForce / effectiveWeight * 0.5),
      effectiveWeight * 0.25 * (1 + totalLongForce / effectiveWeight * 0.5),
    ];

    const latForceTotal = latForceF * Math.cos(this.steerAngle) + latForceR;
    const yawMoment = latForceF * Math.cos(this.steerAngle) * this.wheelBase * 0.5 -
      latForceR * this.wheelBase * 0.5;

    const angularDamping = this.isDrifting ? 1.5 : 3.0;
    const targetAngularVel = this.speed > 0.1 ?
      (this.forwardSpeed * Math.tan(this.steerAngle)) / this.wheelBase : 0;
    this.angularVelocity = damp(this.angularVelocity, targetAngularVel + yawMoment / (this.mass * 10), angularDamping, dt);

    this.heading += this.angularVelocity * dt;

    const newCosH = Math.cos(this.heading);
    const newSinH = Math.sin(this.heading);
    const newForwardDir = new THREE.Vector3(newSinH, 0, newCosH);
    const newRightDir = new THREE.Vector3(newCosH, 0, -newSinH);

    const accelLon = totalLongForce / this.mass;
    const accelLat = latForceTotal / this.mass;

    this.velocity.add(newForwardDir.multiplyScalar(accelLon * dt));
    this.velocity.add(newRightDir.multiplyScalar(accelLat * dt));

    const velDamp = this.isDrifting ? 0.98 : 0.995;
    this.velocity.multiplyScalar(Math.pow(velDamp, dt * 60));

    if (this.handbrake) {
      const hbForce = this.maxBrakeForce * 0.8;
      const hbDir = this.velocity.clone().normalize().multiplyScalar(-1);
      this.velocity.add(hbDir.multiplyScalar(hbForce / this.mass * dt));
      this.velocity.multiplyScalar(0.97);
    }

    this.position.add(this.velocity.clone().multiplyScalar(dt));

    const groundY = this.groundHeightGetter ? this.groundHeightGetter(this.position.x, this.position.z) : 0;
    if (this.position.y <= groundY + 0.35) {
      this.position.y = groundY + 0.35;
      this.velocity.y = 0;
      this.isOnGround = true;
      this.fallen = false;
    } else {
      this.velocity.y -= 9.81 * dt;
      this.isOnGround = false;
      if (this.position.y < -120) this.fallen = true;
    }

    this.gForceLon = accelLon / 9.81;
    this.gForceLat = accelLat / 9.81;

    const wheelCircum = 2 * Math.PI * this.wheelRadius;
    for (let i = 0; i < 4; i++) {
      this.wheelRotations[i] += (this.forwardSpeed / wheelCircum) * dt * Math.PI * 2;
    }

    this.suspensionTravel[0] = Math.sin(Date.now() * 0.01) * 0.01 * this.speed * 0.1;
    this.suspensionTravel[1] = Math.sin(Date.now() * 0.01 + 1) * 0.01 * this.speed * 0.1;
    this.suspensionTravel[2] = Math.sin(Date.now() * 0.01 + 2) * 0.01 * this.speed * 0.1;
    this.suspensionTravel[3] = Math.sin(Date.now() * 0.01 + 3) * 0.01 * this.speed * 0.1;

    return {
      forwardSpeed: this.forwardSpeed,
      speed: this.speed,
      latForce: latForceTotal,
      longForce: totalLongForce,
      gForceLat: this.gForceLat,
      gForceLon: this.gForceLon,
      isDrifting: this.isDrifting,
      driftAngle: this.driftAngle,
    };
  }

  getEngineTorqueCurve(rpm) {
    const idleR = this.idleRPM;
    const redR = this.redlineRPM;
    const normalized = (rpm - idleR) / (redR - idleR);

    if (normalized < 0.15) return lerp(0.6, 0.85, normalized / 0.15);
    if (normalized < 0.4) return lerp(0.85, 1.0, (normalized - 0.15) / 0.25);
    if (normalized < 0.75) return lerp(1.0, 0.92, (normalized - 0.4) / 0.35);
    return lerp(0.92, 0.5, (normalized - 0.75) / 0.25);
  }

  shiftUp() {
    if (this.gear < this.gearRatios.length - 1 && !this.isShifting) {
      this.gear++;
      this.isShifting = true;
      this.shiftTimer = this.shiftTime;
    }
  }

  shiftDown() {
    if (this.gear > 0 && !this.isShifting) {
      this.gear--;
      this.isShifting = true;
      this.shiftTimer = this.shiftTime;
    }
  }

  applyDamage(amount) {
    this.damageAmount = clamp(this.damageAmount + amount, 0, 1.0);
  }

  getSpeedKmh() { return this.speed * 3.6; }
  getSpeedMph() { return this.speed * 2.237; }

  getTelemetry() {
    return {
      speed: this.speed,
      speedKmh: this.getSpeedKmh(),
      rpm: this.engineRPM,
      gear: this.gear + 1,
      gForceLat: this.gForceLat,
      gForceLon: this.gForceLon,
      isDrifting: this.isDrifting,
      driftAngle: this.driftAngle,
      throttle: this.throttle,
      brake: this.brake,
      steerAngle: this.steerAngle,
      slipAngles: [...this.slipAngles],
      wheelLoads: [...this.wheelLoads],
      damage: this.damageAmount,
    };
  }
}

export function createDefaultPhysics() {
  return new VehiclePhysics({
    mass: 1450,
    wheelBase: 2.75,
    trackWidth: 1.65,
    cgHeight: 0.42,
    maxEngineForce: 9000,
    maxBrakeForce: 14000,
    maxSteerAngle: 0.55,
    dragCoefficient: 0.28,
    rollingResistance: 0.012,
    downforceCoeff: 0.6,
    cornerStiffnessF: 8.5,
    cornerStiffnessR: 9.0,
  });
}
