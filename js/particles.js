import * as THREE from 'three';
import { randomRange, clamp } from './utils.js';
import { ObjectPool } from './utils.js';

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.systems = {};
    this.emitters = [];

    this.createTireSmokePool();
    this.createDustPool();
    this.createSparksPool();
    this.createExhaustPool();
    this.createDebrisPool();
  }

  createTireSmokePool() {
    const maxParticles = 500;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const lifetimes = new Float32Array(maxParticles);
    const sizes = new Float32Array(maxParticles);
    const opacities = new Float32Array(maxParticles);
    const velocities = new Float32Array(maxParticles * 3);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: this.createSmokeTexture() },
      },
      vertexShader: `
        attribute float size;
        attribute float opacity;
        varying float vOpacity;
        void main() {
          vOpacity = opacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying float vOpacity;
        void main() {
          vec4 texColor = texture2D(uTexture, gl_PointCoord);
          gl_FragColor = vec4(texColor.rgb, texColor.a * vOpacity);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    this.systems.tireSmoke = {
      points,
      maxParticles,
      activeCount: 0,
      positions,
      lifetimes,
      sizes,
      opacities,
      velocities,
      initialLifetimes: new Float32Array(maxParticles),
      initialSizes: new Float32Array(maxParticles),
    };
  }

  createSmokeTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  createDustPool() {
    const maxParticles = 300;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const lifetimes = new Float32Array(maxParticles);
    const sizes = new Float32Array(maxParticles);
    const opacities = new Float32Array(maxParticles);
    const velocities = new Float32Array(maxParticles * 3);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: this.createSmokeTexture() } },
      vertexShader: `
        attribute float size;
        attribute float opacity;
        varying float vOpacity;
        void main() {
          vOpacity = opacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying float vOpacity;
        void main() {
          vec4 texColor = texture2D(uTexture, gl_PointCoord);
          vec3 dustColor = vec3(0.7, 0.6, 0.4);
          gl_FragColor = vec4(dustColor, texColor.a * vOpacity);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    this.systems.dust = { points, maxParticles, activeCount: 0, positions, lifetimes, sizes, opacities, velocities, initialLifetimes: new Float32Array(maxParticles), initialSizes: new Float32Array(maxParticles) };
  }

  createSparksPool() {
    const maxParticles = 200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const lifetimes = new Float32Array(maxParticles);
    const sizes = new Float32Array(maxParticles);
    const opacities = new Float32Array(maxParticles);
    const velocities = new Float32Array(maxParticles * 3);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: this.createSparkTexture() } },
      vertexShader: `
        attribute float size;
        attribute float opacity;
        varying float vOpacity;
        void main() {
          vOpacity = opacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying float vOpacity;
        void main() {
          vec4 texColor = texture2D(uTexture, gl_PointCoord);
          gl_FragColor = vec4(1.0, 0.8, 0.2, texColor.a * vOpacity);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    this.systems.sparks = { points, maxParticles, activeCount: 0, positions, lifetimes, sizes, opacities, velocities, initialLifetimes: new Float32Array(maxParticles), initialSizes: new Float32Array(maxParticles) };
  }

  createSparkTexture() {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, 'rgba(255,255,200,1)');
    gradient.addColorStop(0.3, 'rgba(255,200,50,0.8)');
    gradient.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  createExhaustPool() {
    const maxParticles = 200;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const lifetimes = new Float32Array(maxParticles);
    const sizes = new Float32Array(maxParticles);
    const opacities = new Float32Array(maxParticles);
    const velocities = new Float32Array(maxParticles * 3);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: this.createSmokeTexture() } },
      vertexShader: `
        attribute float size;
        attribute float opacity;
        varying float vOpacity;
        void main() {
          vOpacity = opacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying float vOpacity;
        void main() {
          vec4 texColor = texture2D(uTexture, gl_PointCoord);
          vec3 exhaustColor = vec3(0.3, 0.3, 0.3);
          gl_FragColor = vec4(exhaustColor, texColor.a * vOpacity);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    this.systems.exhaust = { points, maxParticles, activeCount: 0, positions, lifetimes, sizes, opacities, velocities, initialLifetimes: new Float32Array(maxParticles), initialSizes: new Float32Array(maxParticles) };
  }

  createDebrisPool() {
    const maxParticles = 100;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(maxParticles * 3);
    const lifetimes = new Float32Array(maxParticles);
    const sizes = new Float32Array(maxParticles);
    const opacities = new Float32Array(maxParticles);
    const velocities = new Float32Array(maxParticles * 3);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x444444,
      size: 0.05,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    this.systems.debris = { points, maxParticles, activeCount: 0, positions, lifetimes, sizes, opacities, velocities, initialLifetimes: new Float32Array(maxParticles), initialSizes: new Float32Array(maxParticles) };
  }

  emitTireSmoke(position, velocity, intensity = 1.0) {
    const sys = this.systems.tireSmoke;
    const count = Math.floor(2 * intensity);

    for (let i = 0; i < count; i++) {
      if (sys.activeCount >= sys.maxParticles) break;
      const idx = sys.activeCount;

      sys.positions[idx * 3] = position.x + randomRange(-0.2, 0.2);
      sys.positions[idx * 3 + 1] = position.y + randomRange(0, 0.1);
      sys.positions[idx * 3 + 2] = position.z + randomRange(-0.2, 0.2);

      sys.velocities[idx * 3] = velocity.x * 0.3 + randomRange(-0.5, 0.5);
      sys.velocities[idx * 3 + 1] = randomRange(0.5, 1.5);
      sys.velocities[idx * 3 + 2] = velocity.z * 0.3 + randomRange(-0.5, 0.5);

      sys.initialLifetimes[idx] = randomRange(0.5, 1.5);
      sys.lifetimes[idx] = sys.initialLifetimes[idx];
      sys.initialSizes[idx] = randomRange(1.0, 2.5);
      sys.sizes[idx] = sys.initialSizes[idx];
      sys.opacities[idx] = 0.6 * intensity;

      sys.activeCount++;
    }
  }

  emitDust(position, velocity, count = 3) {
    const sys = this.systems.dust;
    for (let i = 0; i < count; i++) {
      if (sys.activeCount >= sys.maxParticles) break;
      const idx = sys.activeCount;

      sys.positions[idx * 3] = position.x + randomRange(-0.5, 0.5);
      sys.positions[idx * 3 + 1] = position.y + randomRange(0, 0.3);
      sys.positions[idx * 3 + 2] = position.z + randomRange(-0.5, 0.5);

      sys.velocities[idx * 3] = velocity.x * 0.2 + randomRange(-1, 1);
      sys.velocities[idx * 3 + 1] = randomRange(1, 3);
      sys.velocities[idx * 3 + 2] = velocity.z * 0.2 + randomRange(-1, 1);

      sys.initialLifetimes[idx] = randomRange(0.8, 2.0);
      sys.lifetimes[idx] = sys.initialLifetimes[idx];
      sys.initialSizes[idx] = randomRange(1.5, 3.0);
      sys.sizes[idx] = sys.initialSizes[idx];
      sys.opacities[idx] = 0.4;

      sys.activeCount++;
    }
  }

  emitSparks(position, normal, count = 10) {
    const sys = this.systems.sparks;
    for (let i = 0; i < count; i++) {
      if (sys.activeCount >= sys.maxParticles) break;
      const idx = sys.activeCount;

      sys.positions[idx * 3] = position.x;
      sys.positions[idx * 3 + 1] = position.y;
      sys.positions[idx * 3 + 2] = position.z;

      const spread = 5;
      sys.velocities[idx * 3] = normal.x * 3 + randomRange(-spread, spread);
      sys.velocities[idx * 3 + 1] = normal.y * 3 + randomRange(0, spread);
      sys.velocities[idx * 3 + 2] = normal.z * 3 + randomRange(-spread, spread);

      sys.initialLifetimes[idx] = randomRange(0.2, 0.6);
      sys.lifetimes[idx] = sys.initialLifetimes[idx];
      sys.initialSizes[idx] = randomRange(0.3, 0.8);
      sys.sizes[idx] = sys.initialSizes[idx];
      sys.opacities[idx] = 1.0;

      sys.activeCount++;
    }
  }

  emitExhaust(position, direction, throttle) {
    const sys = this.systems.exhaust;
    const count = Math.ceil(throttle * 3);

    for (let i = 0; i < count; i++) {
      if (sys.activeCount >= sys.maxParticles) break;
      const idx = sys.activeCount;

      sys.positions[idx * 3] = position.x + randomRange(-0.05, 0.05);
      sys.positions[idx * 3 + 1] = position.y + randomRange(-0.02, 0.02);
      sys.positions[idx * 3 + 2] = position.z + randomRange(-0.05, 0.05);

      sys.velocities[idx * 3] = direction.x * 5 + randomRange(-0.5, 0.5);
      sys.velocities[idx * 3 + 1] = direction.y * 5 + randomRange(-0.2, 0.2);
      sys.velocities[idx * 3 + 2] = direction.z * 5 + randomRange(-0.5, 0.5);

      sys.initialLifetimes[idx] = randomRange(0.3, 0.8);
      sys.lifetimes[idx] = sys.initialLifetimes[idx];
      sys.initialSizes[idx] = randomRange(0.3, 0.8);
      sys.sizes[idx] = sys.initialSizes[idx];
      sys.opacities[idx] = 0.3 * throttle;

      sys.activeCount++;
    }
  }

  update(dt) {
    this.updateSystem(this.systems.tireSmoke, dt, (p, v, l, initL, initS, i) => {
      const lifeRatio = l / initL;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      v[i * 3 + 1] *= 0.98;
      return initS * (1 + (1 - lifeRatio) * 3);
    });

    this.updateSystem(this.systems.dust, dt, (p, v, l, initL, initS, i) => {
      const lifeRatio = l / initL;
      v[i * 3] *= 0.95;
      v[i * 3 + 1] *= 0.97;
      v[i * 3 + 2] *= 0.95;
      return initS * (1 + (1 - lifeRatio) * 2);
    });

    this.updateSystem(this.systems.sparks, dt, (p, v, l, initL, initS, i) => {
      v[i * 3 + 1] -= 15 * dt;
      return initS;
    });

    this.updateSystem(this.systems.exhaust, dt, (p, v, l, initL, initS, i) => {
      const lifeRatio = l / initL;
      v[i * 3] *= 0.95;
      v[i * 3 + 1] *= 0.95;
      v[i * 3 + 2] *= 0.95;
      return initS * (1 + (1 - lifeRatio) * 2);
    });

    this.updateSystem(this.systems.debris, dt, (p, v, l, initL, initS, i) => {
      v[i * 3 + 1] -= 20 * dt;
      if (p[i * 3 + 1] < 0) {
        p[i * 3 + 1] = 0;
        v[i * 3 + 1] *= -0.3;
        v[i * 3] *= 0.7;
        v[i * 3 + 2] *= 0.7;
      }
      return initS;
    });
  }

  updateSystem(sys, dt, updateFn) {
    let writeIdx = 0;

    for (let readIdx = 0; readIdx < sys.activeCount; readIdx++) {
      sys.lifetimes[readIdx] -= dt;

      if (sys.lifetimes[readIdx] <= 0) continue;

      if (writeIdx !== readIdx) {
        sys.positions[writeIdx * 3] = sys.positions[readIdx * 3];
        sys.positions[writeIdx * 3 + 1] = sys.positions[readIdx * 3 + 1];
        sys.positions[writeIdx * 3 + 2] = sys.positions[readIdx * 3 + 2];

        sys.velocities[writeIdx * 3] = sys.velocities[readIdx * 3];
        sys.velocities[writeIdx * 3 + 1] = sys.velocities[readIdx * 3 + 1];
        sys.velocities[writeIdx * 3 + 2] = sys.velocities[readIdx * 3 + 2];

        sys.initialLifetimes[writeIdx] = sys.initialLifetimes[readIdx];
        sys.initialSizes[writeIdx] = sys.initialSizes[readIdx];
      }

      sys.positions[writeIdx * 3] += sys.velocities[writeIdx * 3] * dt;
      sys.positions[writeIdx * 3 + 1] += sys.velocities[writeIdx * 3 + 1] * dt;
      sys.positions[writeIdx * 3 + 2] += sys.velocities[writeIdx * 3 + 2] * dt;

      sys.sizes[writeIdx] = updateFn(
        sys.positions, sys.velocities,
        sys.lifetimes[writeIdx], sys.initialLifetimes[writeIdx],
        sys.initialSizes[writeIdx], writeIdx
      );

      const lifeRatio = sys.lifetimes[writeIdx] / sys.initialLifetimes[writeIdx];
      sys.opacities[writeIdx] = lifeRatio * 0.7;

      writeIdx++;
    }

    sys.activeCount = writeIdx;

    sys.points.geometry.attributes.position.needsUpdate = true;
    sys.points.geometry.attributes.lifetime.needsUpdate = true;
    sys.points.geometry.attributes.size.needsUpdate = true;
    sys.points.geometry.attributes.opacity.needsUpdate = true;
    sys.points.geometry.attributes.velocity.needsUpdate = true;
  }

  dispose() {
    for (const key in this.systems) {
      const sys = this.systems[key];
      this.scene.remove(sys.points);
      sys.points.geometry.dispose();
      sys.points.material.dispose();
    }
    this.systems = {};
  }
}
