import * as THREE from 'three';
import { clamp, lerp, damp, randomRange, degToRad } from './utils.js';
import { createCarModel } from './car.js';
import { createDefaultPhysics } from './physics.js';

const AI_NAMES = [
  'Vettel', 'Hamilton', 'Verstappen', 'Leclerc', 'Norris', 'Sainz',
  'Perez', 'Russell', 'Alonso', 'Stroll', 'Gasly', 'Ocon',
  'Tsunoda', 'Bottas', 'Magnussen', 'Ricciardo', 'Hulkenberg', 'Albon',
  'Sargeant', 'Piastri', 'De Vries', 'Antonelli', 'Bearman', 'Lawson',
  'Kobayashi', 'Nakajima', 'Ito', 'Tanaka', 'Suzuki', 'Yamamoto',
  'Müller', 'Schmidt', 'Weber', 'Fischer', 'Becker', 'Hoffmann',
  'Kowalski', 'Nowak', 'Lewandowski', 'Zielinski', 'Wojcik', 'Kaminski',
  'Rossi', 'Ferrari', 'Bianchi', 'R Romano', 'Galli', 'Moretti',
  'Costa', 'Silva', 'Santos', 'Oliveira', 'Pereira', 'Carvalho',
  'Dubois', 'Laurent', 'Moreau', 'Simon', 'Michel', 'Garcia',
  'Martinez', 'Lopez', 'Hernandez', 'Diaz', 'Torres', 'Vargas',
];

const AI_TEAMS = [
  { name: 'Scuderia Veloce', color: 0xcc0000 },
  { name: 'Azure Racing', color: 0x0066cc },
  { name: 'Golden Motorsport', color: 0xffaa00 },
  { name: 'Shadow GP', color: 0x333333 },
  { name: 'Emerald Racing', color: 0x00aa44 },
  { name: 'Storm Chasers', color: 0x6600aa },
  { name: 'Crimson Speed', color: 0xff0044 },
  { name: 'Frost Racing', color: 0x00cccc },
  { name: 'Thunder Motorsport', color: 0xffcc00 },
  { name: 'Phantom GP', color: 0x888888 },
];

const AI_SKILL_LEVELS = [
  { name: 'Rookie', skill: 0.45, consistency: 0.6, aggression: 0.3, reactionTime: 0.4, brakingSkill: 0.5, corneringSkill: 0.45, overtakingSkill: 0.3, wetSkill: 0.4, tireMgmt: 0.5 },
  { name: 'Amateur', skill: 0.6, consistency: 0.7, aggression: 0.5, reactionTime: 0.3, brakingSkill: 0.65, corneringSkill: 0.6, overtakingSkill: 0.5, wetSkill: 0.55, tireMgmt: 0.6 },
  { name: 'Professional', skill: 0.75, consistency: 0.8, aggression: 0.65, reactionTime: 0.22, brakingSkill: 0.8, corneringSkill: 0.75, overtakingSkill: 0.7, wetSkill: 0.7, tireMgmt: 0.75 },
  { name: 'Veteran', skill: 0.85, consistency: 0.88, aggression: 0.75, reactionTime: 0.18, brakingSkill: 0.88, corneringSkill: 0.85, overtakingSkill: 0.8, wetSkill: 0.8, tireMgmt: 0.85 },
  { name: 'Elite', skill: 0.92, consistency: 0.93, aggression: 0.85, reactionTime: 0.14, brakingSkill: 0.93, corneringSkill: 0.92, overtakingSkill: 0.88, wetSkill: 0.88, tireMgmt: 0.9 },
  { name: 'Legend', skill: 0.97, consistency: 0.96, aggression: 0.9, reactionTime: 0.1, brakingSkill: 0.97, corneringSkill: 0.96, overtakingSkill: 0.94, wetSkill: 0.94, tireMgmt: 0.95 },
];

export class AIDirector {
  constructor(scene, trackData, difficulty = 2) {
    this.scene = scene;
    this.trackData = trackData;
    this.difficulty = difficulty;
    this.opponents = [];
    this.numOpponents = 8 + difficulty * 2;
    this.skillLevel = AI_SKILL_LEVELS[Math.min(difficulty, AI_SKILL_LEVELS.length - 1)];
    this.racePositions = [];
    this.overtakeCooldowns = new Map();

    this.initOpponents();
  }

  initOpponents() {
    const usedNames = new Set();

    for (let i = 0; i < this.numOpponents; i++) {
      let name;
      do {
        name = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
      } while (usedNames.has(name));
      usedNames.add(name);

      const skillVariation = randomRange(-0.08, 0.08);
      const teamInfo = AI_TEAMS[i % AI_TEAMS.length];
      const carConfig = {
        paintColor: teamInfo.color,
        wheelStyle: Math.floor(Math.random() * 5),
        spoilerType: Math.floor(Math.random() * 5),
        rimColor: [0xcccccc, 0x333333, 0xffcc00, 0xcc0000][Math.floor(Math.random() * 4)],
      };

      const carModel = createCarModel(carConfig);
      this.scene.add(carModel);

      const physics = createDefaultPhysics();
      physics.maxEngineForce *= (0.85 + this.skillLevel.skill * 0.15);
      physics.gripMultiplier = 0.9 + this.skillLevel.corneringSkill * 0.15;

      const gridPos = this.getGridPosition(i + 1);
      physics.reset(gridPos.position, gridPos.angle);

      const opponent = {
        id: i,
        name,
        team: teamInfo.name,
        car: carModel,
        physics,
        skill: { ...this.skillLevel, skill: clamp(this.skillLevel.skill + skillVariation, 0.3, 0.99) },
        currentLap: 0,
        lapTimes: [],
        bestLapTime: null,
        lastCheckpoint: 0,
        checkpointTimer: 0,
        racePosition: i + 1,
        isFinished: false,
        finishTime: null,
        driftScore: 0,
        topSpeed: 0,
        distanceDriven: 0,
        mistakesCount: 0,
        overtakesAttempted: 0,
        overtakesSuccessful: 0,
        currentSpeed: 0,
        targetSpeed: 0,
        idealLine: [],
        avoidanceVector: new THREE.Vector3(),
        rubberBanding: 1.0,
        aiState: 'racing',
        lastOvertakeTime: 0,
        stuckTimer: 0,
        recoveryMode: false,
      };

      this.generateIdealLine(opponent);
      this.opponents.push(opponent);
      this.racePositions.push(opponent);
    }

    this.updateRacePositions();
  }

  getGridPosition(index) {
    const t = 0.99 - (index * 0.003);
    const pt = this.trackData.curve.getPointAt(Math.max(0, t));
    const tangent = this.trackData.curve.getTangentAt(Math.max(0, t));
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const row = Math.floor((index - 1) / 2);
    const side = index % 2 === 0 ? 1 : -1;
    const offset = 3 * side;
    const backOffset = row * 5;

    const pos = pt.clone().add(normal.clone().multiplyScalar(offset));
    pos.add(tangent.clone().multiplyScalar(-backOffset));
    const angle = Math.atan2(tangent.x, tangent.z);

    return { position: pos, angle };
  }

  generateIdealLine(opponent) {
    const points = this.trackData.trackPoints;
    const idealPoints = [];

    for (let i = 0; i < points.length; i += 3) {
      const idx = i % points.length;
      const pt = points[idx];
      const nextPt = points[(idx + 1) % points.length];
      const tangent = nextPt.clone().sub(pt).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      const offsetAmount = Math.sin(idx * 0.1) * 2 * opponent.skill.corneringSkill;
      const idealPt = pt.clone().add(normal.multiplyScalar(offsetAmount));
      idealPoints.push(idealPt);
    }

    opponent.idealLine = idealPoints;
  }

  update(dt, playerPosition, playerSpeed) {
    const allRacers = [...this.opponents];

    for (const opponent of this.opponents) {
      if (opponent.isFinished) continue;

      this.updateAIInput(opponent, dt, playerPosition, playerSpeed);
      const result = opponent.physics.update(dt, opponent.aiInput, 1.0);

      this.updateOpponentVisuals(opponent, dt);
      this.updateOpponentRaceData(opponent, dt);

      opponent.currentSpeed = result.speed * 3.6;
      opponent.topSpeed = Math.max(opponent.topSpeed, opponent.currentSpeed);

      if (result.isDrifting) {
        opponent.driftScore += Math.abs(result.driftAngle) * dt * 10;
      }

      this.applyRubberBanding(opponent, playerPosition, playerSpeed);
    }

    this.updateRacePositions();
    this.detectCollisions();
    this.updateOvertakeDetection(dt);
  }

  updateAIInput(opponent, dt, playerPosition, playerSpeed) {
    const phys = opponent.physics;
    const pos = phys.position;
    const heading = phys.heading;

    const targetSpeed = this.getTargetSpeed(opponent);
    const speedFactor = clamp(targetSpeed / 50, 0.1, 1.0);

    const lookAheadDist = 8 + phys.speed * 0.5;
    const lookAheadT = this.getClosestT(pos) + lookAheadDist / this.trackData.length;
    const targetPt = this.getIdealPoint(opponent, lookAheadT % 1.0);

    const toTarget = targetPt.clone().sub(pos);
    const targetAngle = Math.atan2(toTarget.x, toTarget.z);
    let angleDiff = targetAngle - heading;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const steerInput = clamp(angleDiff * 2.5, -1, 1) * speedFactor;

    const nearestOpp = this.findNearestOpponent(opponent);
    let avoidanceSteer = 0;
    if (nearestOpp && nearestOpp.distance < 4) {
      const avoidDir = opponent.position.clone().sub(nearestOpp.opponent.position).normalize();
      avoidanceSteer = Math.atan2(avoidDir.x, avoidDir.z) - heading;
      avoidanceSteer = clamp(avoidanceSteer * 3, -0.5, 0.5);
    }

    const combinedSteer = clamp(steerInput + avoidanceSteer * (1 - opponent.skill.aggression), -1, 1);

    const speedDiff = targetSpeed / 3.6 - phys.forwardSpeed;
    let throttleInput = 0;
    let brakeInput = 0;

    if (speedDiff > 0.5) {
      throttleInput = clamp(speedDiff * 0.5, 0, 1) * opponent.skill.consistency;
    } else if (speedDiff < -1) {
      brakeInput = clamp(-speedDiff * 0.3, 0, 1) * opponent.skill.brakingSkill;
    } else {
      throttleInput = 0.2;
    }

    if (Math.abs(angleDiff) > 0.8 && phys.speed > 10) {
      brakeInput = Math.max(brakeInput, 0.4);
      throttleInput = 0;
    }

    opponent.aiInput = {
      steering: combinedSteer + (Math.random() - 0.5) * (1 - opponent.skill.consistency) * 0.1,
      throttle: throttleInput,
      brake: brakeInput,
      handbrake: false,
    };
  }

  getTargetSpeed(opponent) {
    const t = this.getClosestT(opponent.physics.position);
    const curve = this.trackData.curve;

    const lookAheadPts = 5;
    let maxCurvature = 0;
    for (let i = 0; i < lookAheadPts; i++) {
      const tCheck = (t + i * 0.005) % 1.0;
      const tan = curve.getTangentAt(tCheck);
      const nextTan = curve.getTangentAt((tCheck + 0.003) % 1.0);
      const curvature = tan.angleTo(nextTan);
      maxCurvature = Math.max(maxCurvature, curvature);
    }

    const cornerSpeed = 60 * (1 - maxCurvature * 3) * opponent.skill.corneringSkill;
    const baseSpeed = 55 + opponent.skill.skill * 30;

    return clamp(Math.min(baseSpeed, cornerSpeed), 15, 80);
  }

  getClosestT(position) {
    const pts = this.trackData.trackPoints;
    let minDist = Infinity;
    let closestT = 0;

    for (let i = 0; i < pts.length; i += 5) {
      const dist = position.distanceTo(pts[i]);
      if (dist < minDist) {
        minDist = dist;
        closestT = i / pts.length;
      }
    }

    return closestT;
  }

  getIdealPoint(opponent, t) {
    const idx = Math.floor(t * opponent.idealLine.length) % opponent.idealLine.length;
    return opponent.idealLine[idx];
  }

  findNearestOpponent(self) {
    let nearest = null;
    let minDist = Infinity;

    for (const other of this.opponents) {
      if (other === self) continue;
      const dist = self.physics.position.distanceTo(other.physics.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = { opponent: other, distance: dist };
      }
    }

    return nearest;
  }

  applyRubberBanding(opponent, playerPosition, playerSpeed) {
    const dist = opponent.physics.position.distanceTo(playerPosition);
    const playerT = this.getClosestT(playerPosition);
    const aiT = this.getClosestT(opponent.physics.position);

    let gap = (aiT - playerT) * this.trackData.length;
    if (gap < -this.trackData.length / 2) gap += this.trackData.length;
    if (gap > this.trackData.length / 2) gap -= this.trackData.length;

    if (gap < -50) {
      opponent.rubberBanding = clamp(1.0 + Math.abs(gap) / 200, 1.0, 1.15);
    } else if (gap > 50) {
      opponent.rubberBanding = clamp(1.0 - gap / 300, 0.85, 1.0);
    } else {
      opponent.rubberBanding = 1.0;
    }

    opponent.physics.maxEngineForce = 8000 * (0.85 + opponent.skill.skill * 0.15) * opponent.rubberBanding;
  }

  updateOpponentVisuals(opponent, dt) {
    const phys = opponent.physics;
    const car = opponent.car;

    car.position.copy(phys.position);
    car.rotation.y = phys.heading;

    const bodyRoll = clamp(phys.gForceLat * 0.02, -0.05, 0.05);
    const bodyPitch = clamp(-phys.gForceLon * 0.015, -0.03, 0.03);
    car.rotation.z = bodyRoll;
    car.rotation.x = bodyPitch;

    for (let i = 0; i < 4; i++) {
      const wheel = car.userData.wheels[i];
      if (wheel.userData.steering) {
        wheel.rotation.y = phys.steerAngle * 0.8;
      }
      wheel.children.forEach(child => {
        if (child !== wheel) {
          child.rotation.x = phys.wheelRotations[i];
        }
      });
    }
  }

  updateOpponentRaceData(opponent, dt) {
    const currentT = this.getClosestT(opponent.physics.position);
    const checkpointIdx = Math.floor(currentT * this.trackData.checkpoints.length);

    if (checkpointIdx < opponent.lastCheckpoint || (opponent.lastCheckpoint > 15 && checkpointIdx < 5)) {
      opponent.currentLap++;
      const lapTime = opponent.checkpointTimer;
      opponent.lapTimes.push(lapTime);
      if (!opponent.bestLapTime || lapTime < opponent.bestLapTime) {
        opponent.bestLapTime = lapTime;
      }
      opponent.checkpointTimer = 0;
    }

    opponent.lastCheckpoint = checkpointIdx;
    opponent.checkpointTimer += dt;
    opponent.distanceDriven += opponent.physics.speed * dt;
  }

  updateRacePositions() {
    const sorted = [...this.opponents].sort((a, b) => {
      if (a.isFinished && b.isFinished) return (a.finishTime || 0) - (b.finishTime || 0);
      if (a.isFinished) return -1;
      if (b.isFinished) return 1;

      const lapDiff = b.currentLap - a.currentLap;
      if (lapDiff !== 0) return lapDiff;

      const tA = this.getClosestT(a.physics.position);
      const tB = this.getClosestT(b.physics.position);
      return tB - tA;
    });

    sorted.forEach((opp, idx) => {
      opp.racePosition = idx + 1;
    });

    this.racePositions = sorted;
  }

  detectCollisions() {
    for (let i = 0; i < this.opponents.length; i++) {
      for (let j = i + 1; j < this.opponents.length; j++) {
        const a = this.opponents[i];
        const b = this.opponents[j];
        const dist = a.physics.position.distanceTo(b.physics.position);

        if (dist < 2.5) {
          const pushDir = a.physics.position.clone().sub(b.physics.position).normalize();
          const pushForce = (2.5 - dist) * 5;

          a.physics.position.add(pushDir.clone().multiplyScalar(pushForce * 0.5));
          b.physics.position.add(pushDir.clone().multiplyScalar(-pushForce * 0.5));

          const relVel = a.physics.velocity.clone().sub(b.physics.velocity);
          const impulse = relVel.dot(pushDir) * 0.5;
          a.physics.velocity.add(pushDir.clone().multiplyScalar(-impulse));
          b.physics.velocity.add(pushDir.clone().multiplyScalar(impulse));

          a.physics.applyDamage(0.01);
          b.physics.applyDamage(0.01);
          a.mistakesCount++;
          b.mistakesCount++;
        }
      }
    }
  }

  updateOvertakeDetection(dt) {
    const now = performance.now() / 1000;
    for (const opp of this.opponents) {
      if (now - opp.lastOvertakeTime > 5) {
        const ahead = this.racePositions[opp.racePosition - 2];
        if (ahead && ahead !== opp) {
          const dist = opp.physics.position.distanceTo(ahead.physics.position);
          if (dist < 8) {
            opp.overtakesAttempted++;
          }
        }
      }
    }
  }

  getOpponentAhead(position, currentPos) {
    const idx = this.racePositions.findIndex(o => o.racePosition === currentPos);
    if (idx > 0) return this.racePositions[idx - 1];
    return null;
  }

  getStandings() {
    return this.racePositions.map((opp, idx) => ({
      position: idx + 1,
      name: opp.name,
      team: opp.team,
      lap: opp.currentLap,
      bestLap: opp.bestLapTime,
      topSpeed: opp.topSpeed,
      gap: this.calculateGap(opp),
    }));
  }

  calculateGap(opponent) {
    if (opponent.racePosition === 1) return 0;
    const leader = this.racePositions[0];
    const leaderT = this.getClosestT(leader.physics.position);
    const oppT = this.getClosestT(opponent.physics.position);
    let gapMeters = (leaderT - oppT) * this.trackData.length;
    if (gapMeters < 0) gapMeters += this.trackData.length;
    return gapMeters;
  }

  dispose() {
    for (const opp of this.opponents) {
      this.scene.remove(opp.car);
    }
    this.opponents = [];
  }
}
