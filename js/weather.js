import * as THREE from 'three';
import { lerp, clamp, createNoise2D, fbm, createRadialTexture } from './utils.js';
import { getBlossomSprite } from './materials.js';

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.currentWeather = 'clear';
    this.timeOfDay = 10;
    this.timeSpeed = 0.01;
    this.windSpeed = 0;
    this.windDirection = 0;
    this.temperature = 22;
    this.humidity = 0.5;
    this.precipitation = 0;
    this.fogDensity = 0.002;
    this.lightningTimer = 0;
    this.lightningActive = false;

    this.rainParticles = null;
    this.snowParticles = null;
    this.petalParticles = null;
    this.leafParticles = null;
    this.fog = new THREE.FogExp2(0x8899aa, 0.002);

    this.cloudMeshes = [];
    this.sunLight = null;
    this.ambientLight = null;
    this.hemisphereLight = null;

    this.noise = createNoise2D(123);
    this.transitionProgress = 0;
    this.targetWeather = 'clear';
    this.previousWeather = 'clear';

    this.seasons = ['winter', 'spring', 'summer', 'autumn'];
    this.seasonIndex = 0;
    this.seasonTimer = 0;
    this.seasonDuration = 30;
    this.seasonCycleActive = false;
  }

  setupLights() {
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
    this.sunLight.position.set(50, 100, 50);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 200;
    this.sunLight.shadow.camera.left = -100;
    this.sunLight.shadow.camera.right = 100;
    this.sunLight.shadow.camera.top = 100;
    this.sunLight.shadow.camera.bottom = -100;
    this.sunLight.shadow.bias = -0.001;
    this.scene.add(this.sunLight);

    this.ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x362312, 0.4);
    this.scene.add(this.hemisphereLight);

    this.moonLight = new THREE.DirectionalLight(0x6688cc, 0.2);
    this.moonLight.position.set(-30, 80, -30);
    this.scene.add(this.moonLight);
  }

  createSky() {
    const skyGeo = new THREE.SphereGeometry(400, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0077ff) },
        bottomColor: { value: new THREE.Color(0xffffff) },
        offset: { value: 20 },
        exponent: { value: 0.6 },
        sunPosition: { value: new THREE.Vector3(0, 100, 0) },
        sunColor: { value: new THREE.Color(0xffffee) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        uniform vec3 sunPosition;
        uniform vec3 sunColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          float t = max(pow(max(h, 0.0), exponent), 0.0);
          vec3 skyColor = mix(bottomColor, topColor, t);

          vec3 sunDir = normalize(sunPosition);
          vec3 viewDir = normalize(vWorldPosition);
          float sunDot = max(dot(sunDir, viewDir), 0.0);
          float sunGlow = pow(sunDot, 64.0);
          float sunHalo = pow(sunDot, 8.0);

          skyColor += sunColor * sunGlow * 1.5;
          skyColor += sunColor * sunHalo * 0.3;

          gl_FragColor = vec4(skyColor, 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);
  }

  createRain(count = 5000) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      velocities[i * 3] = (Math.random() - 0.5) * 2;
      velocities[i * 3 + 1] = -20 - Math.random() * 15;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xaaaacc,
      size: 0.1,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    this.rainParticles = new THREE.Points(geo, mat);
    this.rainParticles.visible = false;
    this.scene.add(this.rainParticles);
  }

  createSnow(count = 3000) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      velocities[i * 3] = (Math.random() - 0.5) * 3;
      velocities[i * 3 + 1] = -2 - Math.random() * 3;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.PointsMaterial({
      map: createRadialTexture(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
      color: 0xffffff,
      size: 0.45,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      alphaTest: 0.02,
    });

    this.snowParticles = new THREE.Points(geo, mat);
    this.snowParticles.visible = false;
    this.scene.add(this.snowParticles);
  }

  createPetalParticles(count = 2000) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const petalColors = [
      new THREE.Color(0xffb6c1),
      new THREE.Color(0xffc0cb),
      new THREE.Color(0xffd1dc),
      new THREE.Color(0xfff0f5),
      new THREE.Color(0xff69b4),
    ];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 400;
      positions[i * 3 + 1] = Math.random() * 120;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400;
      velocities[i * 3] = (Math.random() - 0.5) * 1;
      velocities[i * 3 + 1] = -1 - Math.random() * 2;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 1;

      const c = petalColors[Math.floor(Math.random() * petalColors.length)];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      map: getBlossomSprite(),
      size: 0.6,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      alphaTest: 0.05,
    });

    this.petalParticles = new THREE.Points(geo, mat);
    this.petalParticles.visible = false;
    this.scene.add(this.petalParticles);
  }

  createLeafParticles(count = 2000) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const leafColors = [
      new THREE.Color(0xffd700),
      new THREE.Color(0xff8c00),
      new THREE.Color(0xd2691e),
      new THREE.Color(0x8b4513),
      new THREE.Color(0xffa500),
      new THREE.Color(0xdaa520),
    ];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 400;
      positions[i * 3 + 1] = Math.random() * 120;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400;
      velocities[i * 3] = (Math.random() - 0.5) * 1.5;
      velocities[i * 3 + 1] = -1.5 - Math.random() * 2.5;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;

      const c = leafColors[Math.floor(Math.random() * leafColors.length)];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    this.leafParticles = new THREE.Points(geo, mat);
    this.leafParticles.visible = false;
    this.scene.add(this.leafParticles);
  }

  createCloudLayer() {
    const cloudGeo = new THREE.SphereGeometry(1, 8, 6);
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      roughness: 1,
    });

    for (let i = 0; i < 40; i++) {
      const cloud = new THREE.Group();
      const puffCount = 3 + Math.floor(Math.random() * 5);

      for (let j = 0; j < puffCount; j++) {
        const puff = new THREE.Mesh(cloudGeo, cloudMat.clone());
        puff.material.opacity = 0.4 + Math.random() * 0.3;
        puff.position.set(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 4,
          (Math.random() - 0.5) * 10
        );
        puff.scale.set(8 + Math.random() * 12, 3 + Math.random() * 4, 5 + Math.random() * 8);
        cloud.add(puff);
      }

      cloud.position.set(
        (Math.random() - 0.5) * 600,
        80 + Math.random() * 40,
        (Math.random() - 0.5) * 600
      );
      cloud.userData.speed = 0.3 + Math.random() * 0.8;
      cloud.userData.baseY = cloud.position.y;

      this.scene.add(cloud);
      this.cloudMeshes.push(cloud);
    }
  }

  update(dt, cameraPosition) {
    this.updateTimeOfDay(dt);
    this.updateSeasonCycle(dt);
    this.updateWeatherTransition(dt);
    this.updateSunPosition();
    this.updateFog();
    this.updateClouds(dt, cameraPosition);
    this.updateParticles(dt, cameraPosition);
    this.updateLighting();
    this.checkLightning(dt);
  }

  updateTimeOfDay(dt) {
    this.timeOfDay += this.timeSpeed * dt;
    if (this.timeOfDay >= 24) this.timeOfDay -= 24;
    if (this.timeOfDay < 0) this.timeOfDay += 24;
  }

  updateWeatherTransition(dt) {
    if (this.targetWeather !== this.currentWeather) {
      this.transitionProgress += dt * 0.5;
      if (this.transitionProgress >= 1) {
        this.currentWeather = this.targetWeather;
        this.transitionProgress = 0;
      }
    }
  }

  updateSeasonCycle(dt) {
    if (!this.seasonCycleActive) return;
    this.seasonTimer += dt;
    if (this.seasonTimer >= this.seasonDuration) {
      this.seasonTimer = 0;
      this.seasonIndex = (this.seasonIndex + 1) % this.seasons.length;
      const season = this.seasons[this.seasonIndex];
      this.setSeason(season);
    }
  }

  setSeasonCycle(enabled, startIndex = 0) {
    this.seasonCycleActive = !!enabled;
    this.seasonIndex = startIndex % this.seasons.length;
    this.seasonTimer = 0;
    if (this.seasonCycleActive) {
      this.setSeason(this.seasons[this.seasonIndex]);
    }
  }

  setSeason(season) {
    switch (season) {
      case 'winter': this.setWeather('snow'); break;
      case 'spring': this.setWeather('petals'); break;
      case 'summer': this.setWeather('clear'); break;
      case 'autumn': this.setWeather('leaves'); break;
    }
  }

  getSeason() { return this.seasons[this.seasonIndex]; }
  getSeasonProgress() { return this.seasonTimer / this.seasonDuration; }

  updateSunPosition() {
    const sunAngle = ((this.timeOfDay - 6) / 12) * Math.PI;
    const sunHeight = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle) * 100;
    const sunY = Math.max(sunHeight * 100, -20);

    this.sunLight.position.set(sunX, sunY, 30);

    if (this.sky) {
      this.sky.material.uniforms.sunPosition.value.copy(this.sunLight.position);
    }

    const dayIntensity = clamp(sunHeight * 2, 0.05, 1.0);
    const nightIntensity = clamp(-sunHeight * 0.5, 0, 1);

    this.sunLight.intensity = lerp(0, 2.5, dayIntensity);
    this.moonLight.intensity = lerp(0.2, 0, dayIntensity);

    if (this.sky) {
      const dayTop = new THREE.Color(0x0077ff);
      const dayBottom = new THREE.Color(0xffeedd);
      const nightTop = new THREE.Color(0x000022);
      const nightBottom = new THREE.Color(0x001133);
      const sunsetTop = new THREE.Color(0x334488);
      const sunsetBottom = new THREE.Color(0xff6633);

      let topColor, bottomColor;

      if (sunHeight > 0.3) {
        topColor = dayTop;
        bottomColor = dayBottom;
      } else if (sunHeight > 0) {
        const t = sunHeight / 0.3;
        topColor = new THREE.Color().lerpColors(sunsetTop, dayTop, t);
        bottomColor = new THREE.Color().lerpColors(sunsetBottom, dayBottom, t);
      } else {
        topColor = nightTop;
        bottomColor = nightBottom;
      }

      if (this.currentWeather === 'overcast' || this.currentWeather === 'rain' || this.currentWeather === 'storm') {
        topColor.lerp(new THREE.Color(0x555555), 0.5);
        bottomColor.lerp(new THREE.Color(0x777777), 0.5);
      } else       if (this.currentWeather === 'fog') {
        topColor.lerp(new THREE.Color(0x999999), 0.7);
        bottomColor.lerp(new THREE.Color(0xaaaaaa), 0.7);
      }

      const season = this.getSeason();
      if (this.seasonCycleActive && season === 'winter') {
        topColor.lerp(new THREE.Color(0x446688), 0.4);
        bottomColor.lerp(new THREE.Color(0xeeeeff), 0.3);
      } else if (this.seasonCycleActive && season === 'spring') {
        topColor.lerp(new THREE.Color(0x88ccff), 0.3);
        bottomColor.lerp(new THREE.Color(0xfff0f5), 0.3);
      } else if (this.seasonCycleActive && season === 'autumn') {
        topColor.lerp(new THREE.Color(0xff8844), 0.35);
        bottomColor.lerp(new THREE.Color(0xffddaa), 0.3);
      }

      this.sky.material.uniforms.topColor.value.copy(topColor);
      this.sky.material.uniforms.bottomColor.value.copy(bottomColor);
    }
  }

  updateFog() {
    let targetDensity = 0.002;
    let fogColor = new THREE.Color(0x8899aa);

    if (this.currentWeather === 'fog') {
      targetDensity = 0.02;
      fogColor = new THREE.Color(0xaaaaaa);
    } else if (this.currentWeather === 'rain') {
      targetDensity = 0.005;
      fogColor = new THREE.Color(0x667788);
    } else if (this.currentWeather === 'storm') {
      targetDensity = 0.008;
      fogColor = new THREE.Color(0x445566);
    } else if (this.currentWeather === 'overcast') {
      targetDensity = 0.003;
      fogColor = new THREE.Color(0x8899aa);
    } else if (this.currentWeather === 'petals') {
      targetDensity = 0.0025;
      fogColor = new THREE.Color(0xfff0f5);
    } else if (this.currentWeather === 'leaves') {
      targetDensity = 0.003;
      fogColor = new THREE.Color(0xffddaa);
    }

    if (this.timeOfDay < 6 || this.timeOfDay > 20) {
      targetDensity *= 2;
      fogColor.lerp(new THREE.Color(0x222244), 0.5);
    }

    this.fog.density = lerp(this.fog.density, targetDensity, 0.02);
    this.scene.fog = this.fog;
  }

  updateClouds(dt, cameraPosition) {
    for (const cloud of this.cloudMeshes) {
      cloud.position.x += cloud.userData.speed * dt * this.windSpeed;

      if (cloud.position.x > 300) cloud.position.x = -300;

      const weatherOpacity = this.currentWeather === 'overcast' || this.currentWeather === 'rain' ? 0.9 :
        this.currentWeather === 'clear' ? 0.5 : 0.7;

      cloud.children.forEach(puff => {
        puff.material.opacity = lerp(puff.material.opacity, weatherOpacity, dt);
      });

      const distToCam = cloud.position.distanceTo(cameraPosition);
      cloud.visible = distToCam < 500;
    }
  }

  updateParticles(dt, cameraPosition) {
    if (this.rainParticles) {
      this.rainParticles.visible = this.currentWeather === 'rain' || this.currentWeather === 'storm';
      if (this.rainParticles.visible) {
        const positions = this.rainParticles.geometry.attributes.position.array;
        const velocities = this.rainParticles.geometry.attributes.velocity.array;
        const count = positions.length / 3;

        for (let i = 0; i < count; i++) {
          positions[i * 3] += velocities[i * 3] * dt + this.windSpeed * dt * 2;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

          if (positions[i * 3 + 1] < 0) {
            positions[i * 3] = cameraPosition.x + (Math.random() - 0.5) * 200;
            positions[i * 3 + 1] = 60 + Math.random() * 30;
            positions[i * 3 + 2] = cameraPosition.z + (Math.random() - 0.5) * 200;
          }
        }
        this.rainParticles.geometry.attributes.position.needsUpdate = true;
        this.rainParticles.material.opacity = this.currentWeather === 'storm' ? 0.8 : 0.5;
      }
    }

    if (this.snowParticles) {
      this.snowParticles.visible = this.currentWeather === 'snow';
      if (this.snowParticles.visible) {
        const positions = this.snowParticles.geometry.attributes.position.array;
        const velocities = this.snowParticles.geometry.attributes.velocity.array;
        const count = positions.length / 3;

        for (let i = 0; i < count; i++) {
          positions[i * 3] += (velocities[i * 3] + Math.sin(Date.now() * 0.001 + i) * 0.5) * dt;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

          if (positions[i * 3 + 1] < 0) {
            positions[i * 3] = cameraPosition.x + (Math.random() - 0.5) * 200;
            positions[i * 3 + 1] = 60 + Math.random() * 30;
            positions[i * 3 + 2] = cameraPosition.z + (Math.random() - 0.5) * 200;
          }
        }
        this.snowParticles.geometry.attributes.position.needsUpdate = true;
      }
    }

    if (this.petalParticles) {
      this.petalParticles.visible = this.currentWeather === 'petals';
      if (this.petalParticles.visible) {
        const positions = this.petalParticles.geometry.attributes.position.array;
        const velocities = this.petalParticles.geometry.attributes.velocity.array;
        const count = positions.length / 3;

        for (let i = 0; i < count; i++) {
          const flutter = Math.sin(Date.now() * 0.002 + i) * 0.9;
          positions[i * 3] += (velocities[i * 3] + flutter + this.windSpeed * 1.4) * dt;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += (velocities[i * 3 + 2] + Math.cos(Date.now() * 0.002 + i) * 0.6) * dt;

          if (positions[i * 3 + 1] < 0) {
            positions[i * 3] = cameraPosition.x + (Math.random() - 0.5) * 400;
            positions[i * 3 + 1] = 70 + Math.random() * 50;
            positions[i * 3 + 2] = cameraPosition.z + (Math.random() - 0.5) * 400;
          }
        }
        this.petalParticles.geometry.attributes.position.needsUpdate = true;
      }
    }

    if (this.leafParticles) {
      this.leafParticles.visible = this.currentWeather === 'leaves';
      if (this.leafParticles.visible) {
        const positions = this.leafParticles.geometry.attributes.position.array;
        const velocities = this.leafParticles.geometry.attributes.velocity.array;
        const count = positions.length / 3;

        for (let i = 0; i < count; i++) {
          positions[i * 3] += (velocities[i * 3] + Math.sin(Date.now() * 0.0015 + i) * 1.2) * dt;
          positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += (velocities[i * 3 + 2] + Math.cos(Date.now() * 0.0015 + i) * 1.0) * dt;

          if (positions[i * 3 + 1] < 0) {
            positions[i * 3] = cameraPosition.x + (Math.random() - 0.5) * 400;
            positions[i * 3 + 1] = 70 + Math.random() * 50;
            positions[i * 3 + 2] = cameraPosition.z + (Math.random() - 0.5) * 400;
          }
        }
        this.leafParticles.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  updateLighting() {
    const weatherDim = this.currentWeather === 'overcast' || this.currentWeather === 'rain' ? 0.6 :
      this.currentWeather === 'storm' ? 0.4 :
      this.currentWeather === 'fog' ? 0.7 :
      this.currentWeather === 'petals' ? 0.95 :
      this.currentWeather === 'leaves' ? 0.9 : 1.0;

    this.ambientLight.intensity = 0.5 * weatherDim;
    this.hemisphereLight.intensity = 0.4 * weatherDim;

    if (this.hemisphereLight) {
      const skyColor = new THREE.Color(0x87ceeb);
      const groundColor = new THREE.Color(0x362312);

      if (this.currentWeather === 'overcast' || this.currentWeather === 'rain') {
        skyColor.lerp(new THREE.Color(0x666666), 0.5);
      }
      if (this.currentWeather === 'storm') {
        skyColor.lerp(new THREE.Color(0x334455), 0.7);
      }
      if (this.currentWeather === 'petals') {
        skyColor.lerp(new THREE.Color(0xffc0cb), 0.3);
        groundColor.lerp(new THREE.Color(0xfff0f5), 0.3);
      }
      if (this.currentWeather === 'leaves') {
        skyColor.lerp(new THREE.Color(0xffaa66), 0.3);
        groundColor.lerp(new THREE.Color(0x8b4513), 0.3);
      }

      this.hemisphereLight.color.copy(skyColor);
      this.hemisphereLight.groundColor.copy(groundColor);
    }
  }

  checkLightning(dt) {
    if (this.currentWeather === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningActive = true;
        setTimeout(() => { this.lightningActive = false; }, 100);
        this.lightningTimer = 3 + Math.random() * 10;
        this.sunLight.intensity = 5;
      }
    }
  }

  setWeather(weather) {
    this.previousWeather = this.currentWeather;
    this.targetWeather = weather;
    this.transitionProgress = 0;
  }

  setTimeOfDay(hours) {
    this.timeOfDay = hours % 24;
  }

  setTimeSpeed(speed) {
    this.timeSpeed = speed;
  }

  getWeatherName() { return this.currentWeather; }
  getTimeString() {
    const h = Math.floor(this.timeOfDay);
    const m = Math.floor((this.timeOfDay - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
