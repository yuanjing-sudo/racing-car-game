import { formatTime, formatSpeed, clamp, lerp } from './utils.js';

// Full-scale speedometer reading. The dial is calibrated to this so the
// needle keeps meaningful resolution at the game's ~360 km/h top speed.
const MAX_SPEED_KMH = 380;

export class HUD {
  constructor() {
    this.container = document.getElementById('hud');
    this.elements = {};
    this.visible = true;
    this.fadingElements = new Map();

    this.createHUD();
  }

  createHUD() {
    this.container.innerHTML = `
      <div class="hud-top-left">
        <div class="hud-lap-counter">
          <span class="hud-label">LAP</span>
          <span class="hud-value" id="hud-lap">1/3</span>
        </div>
        <div class="hud-position">
          <span class="hud-label">POS</span>
          <span class="hud-value" id="hud-pos">1st</span>
        </div>
        <div class="hud-time">
          <span class="hud-label">TIME</span>
          <span class="hud-value" id="hud-time">0:00.000</span>
        </div>
        <div class="hud-best-lap">
          <span class="hud-label">BEST</span>
          <span class="hud-value" id="hud-best">--:--.---</span>
        </div>
        <div class="hud-last-lap">
          <span class="hud-label">LAST</span>
          <span class="hud-value" id="hud-last">--:--.---</span>
        </div>
      </div>

      <div class="hud-top-right">
        <div class="hud-standings" id="hud-standings"></div>
      </div>

      <div class="hud-bottom-left">
        <div class="hud-damage">
          <span class="hud-label">DAMAGE</span>
          <div class="hud-bar"><div class="hud-bar-fill" id="hud-damage-bar" style="width:0%"></div></div>
        </div>
        <div class="hud-tire-wear">
          <span class="hud-label">TIRES</span>
          <div class="hud-tire-container">
            <div class="hud-tire" id="tire-fl"><span>FL</span><div class="hud-tire-bar"><div class="hud-tire-fill"></div></div></div>
            <div class="hud-tire" id="tire-fr"><span>FR</span><div class="hud-tire-bar"><div class="hud-tire-fill"></div></div></div>
            <div class="hud-tire" id="tire-rl"><span>RL</span><div class="hud-tire-bar"><div class="hud-tire-fill"></div></div></div>
            <div class="hud-tire" id="tire-rr"><span>RR</span><div class="hud-tire-bar"><div class="hud-tire-fill"></div></div></div>
          </div>
        </div>
      </div>

      <div class="hud-bottom-right">
        <div class="hud-speedometer">
          <svg viewBox="0 0 200 120" class="hud-speed-svg">
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#333" stroke-width="2"/>
            <path id="speed-arc" d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#ff6600" stroke-width="4" stroke-dasharray="0 251"/>
            <g id="speed-ticks"></g>
            <text id="speed-value" x="100" y="80" text-anchor="middle" class="hud-speed-text">0</text>
            <text x="100" y="95" text-anchor="middle" class="hud-speed-unit">km/h</text>
          </svg>
        </div>
        <div class="hud-rpm-bar">
          <div class="hud-rpm-fill" id="hud-rpm-fill"></div>
          <div class="hud-rpm-redline" id="hud-rpm-redline"></div>
        </div>
        <div class="hud-gear">
          <span class="hud-label">GEAR</span>
          <span class="hud-value" id="hud-gear">N</span>
        </div>
      </div>

      <div class="hud-bottom-center">
        <div class="hud-minimap">
          <canvas id="minimap-canvas" width="200" height="200"></canvas>
        </div>
        <div class="hud-delta">
          <span class="hud-label">DELTA</span>
          <span class="hud-value" id="hud-delta">+0.000</span>
        </div>
      </div>

      <div class="hud-center-top">
        <div class="hud-message" id="hud-message"></div>
      </div>

      <div class="hud-pedals">
        <div class="hud-pedal" id="pedal-throttle"><div class="hud-pedal-fill"></div></div>
        <div class="hud-pedal" id="pedal-brake"><div class="hud-pedal-fill"></div></div>
        <div class="hud-pedal" id="pedal-clutch"><div class="hud-pedal-fill"></div></div>
      </div>

      <div class="hud-gforce">
        <div class="hud-gforce-container">
          <div class="hud-gforce-dot" id="gforce-dot"></div>
          <span class="hud-gforce-label-lat">LAT</span>
          <span class="hud-gforce-label-lon">LON</span>
        </div>
      </div>

      <div class="hud-drift-indicator" id="hud-drift">
        <span>DRIFT!</span>
      </div>

      <div class="hud-countdown" id="hud-countdown"></div>

      <div class="hud-notification" id="hud-notification"></div>
    `;

    this.elements = {
      lap: document.getElementById('hud-lap'),
      position: document.getElementById('hud-pos'),
      time: document.getElementById('hud-time'),
      best: document.getElementById('hud-best'),
      last: document.getElementById('hud-last'),
      standings: document.getElementById('hud-standings'),
      damageBar: document.getElementById('hud-damage-bar'),
      speedValue: document.getElementById('speed-value'),
      speedArc: document.getElementById('speed-arc'),
      speedTicks: document.getElementById('speed-ticks'),
      rpmFill: document.getElementById('hud-rpm-fill'),
      gear: document.getElementById('hud-gear'),
      delta: document.getElementById('hud-delta'),
      minimap: document.getElementById('minimap-canvas'),
      message: document.getElementById('hud-message'),
      pedalThrottle: document.querySelector('#pedal-throttle .hud-pedal-fill'),
      pedalBrake: document.querySelector('#pedal-brake .hud-pedal-fill'),
      gforceDot: document.getElementById('gforce-dot'),
      drift: document.getElementById('hud-drift'),
      countdown: document.getElementById('hud-countdown'),
      notification: document.getElementById('hud-notification'),
    };

    this.createSpeedTicks();
    this.minimapCtx = this.elements.minimap.getContext('2d');
  }

  createSpeedTicks() {
    const ticksGroup = this.elements.speedTicks;
    const cx = 100, cy = 100, r = 75;
    for (let i = 0; i <= 12; i++) {
      const angle = Math.PI + (i / 12) * Math.PI;
      const x1 = cx + Math.cos(angle) * (r - 5);
      const y1 = cy + Math.sin(angle) * (r - 5);
      const x2 = cx + Math.cos(angle) * r;
      const y2 = cy + Math.sin(angle) * r;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', '#666');
      line.setAttribute('stroke-width', i % 3 === 0 ? '2' : '1');
      ticksGroup.appendChild(line);

      if (i % 2 === 0) {
        const tx = cx + Math.cos(angle) * (r - 18);
        const ty = cy + Math.sin(angle) * (r - 12);
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', tx);
        text.setAttribute('y', ty);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#888');
        text.setAttribute('font-size', '10');
        text.textContent = Math.round((i / 12) * MAX_SPEED_KMH);
        ticksGroup.appendChild(text);
      }
    }
  }

  update(data) {
    if (!this.visible) return;

    this.updateSpeedometer(data.speedKmh, data.rpm, data.redlineRPM);
    this.updateGearIndicator(data.gear);
    this.updatePedals(data.throttle, data.brake);
    this.updateGForce(data.gForceLat, data.gForceLon);
    this.updateDriftIndicator(data.isDrifting, data.driftAngle);
    this.updateLapInfo(data.lap, data.totalLaps, data.position, data.totalRacers);
    this.updateTiming(data.raceTime, data.bestLapTime, data.lastLapTime, data.delta);
    this.updateDamage(data.damage);
    this.updateStandings(data.standings);
    this.updateMinimap(data.minimapData);
  }

  updateSpeedometer(speedKmh, rpm, redlineRPM) {
    this.elements.speedValue.textContent = Math.round(speedKmh);
    const maxSpeed = MAX_SPEED_KMH;
    const speedFraction = clamp(speedKmh / maxSpeed, 0, 1);
    const arcLength = speedFraction * 251;
    this.elements.speedArc.setAttribute('stroke-dasharray', `${arcLength} 251`);

    const rpmFraction = clamp(rpm / redlineRPM, 0, 1);
    this.elements.rpmFill.style.width = `${rpmFraction * 100}%`;

    if (rpmFraction > 0.9) {
      this.elements.rpmFill.classList.add('rpm-warning');
    } else {
      this.elements.rpmFill.classList.remove('rpm-warning');
    }
  }

  updateGearIndicator(gear) {
    this.elements.gear.textContent = gear === 0 ? 'N' : gear.toString();
  }

  updatePedals(throttle, brake) {
    this.elements.pedalThrottle.style.height = `${throttle * 100}%`;
    this.elements.pedalBrake.style.height = `${brake * 100}%`;
  }

  updateGForce(lat, lon) {
    const x = clamp(lat / 2, -1, 1) * 40;
    const y = clamp(-lon / 2, -1, 1) * 40;
    this.elements.gforceDot.style.transform = `translate(${x}px, ${y}px)`;
  }

  updateDriftIndicator(isDrifting, angle) {
    if (isDrifting) {
      this.elements.drift.classList.add('active');
      this.elements.drift.querySelector('span').textContent = `DRIFT! ${Math.abs(angle * 57.3).toFixed(0)}°`;
    } else {
      this.elements.drift.classList.remove('active');
    }
  }

  updateLapInfo(lap, totalLaps, position, totalRacers) {
    this.elements.lap.textContent = `${Math.min(lap, totalLaps)}/${totalLaps}`;
    this.elements.position.textContent = this.ordinal(position);
  }

  updateTiming(raceTime, bestLap, lastLap, delta) {
    this.elements.time.textContent = formatTime(raceTime);
    this.elements.best.textContent = bestLap ? formatTime(bestLap) : '--:--.---';
    this.elements.last.textContent = lastLap ? formatTime(lastLap) : '--:--.---';

    if (delta !== null && delta !== undefined) {
      const sign = delta >= 0 ? '+' : '-';
      this.elements.delta.textContent = `${sign}${Math.abs(delta).toFixed(3)}`;
      this.elements.delta.style.color = delta >= 0 ? '#00ff88' : '#ff4444';
    } else {
      this.elements.delta.textContent = '--:--.---';
      this.elements.delta.style.color = '#888';
    }
  }

  updateDamage(damage) {
    this.elements.damageBar.style.width = `${damage * 100}%`;
    if (damage > 0.7) {
      this.elements.damageBar.style.background = '#ff0000';
    } else if (damage > 0.4) {
      this.elements.damageBar.style.background = '#ff8800';
    } else {
      this.elements.damageBar.style.background = '#00cc44';
    }
  }

  updateStandings(standings) {
    if (!standings || standings.length === 0) {
      this.elements.standings.innerHTML = '';
      return;
    }

    let html = '<div class="standings-header">STANDINGS</div>';
    standings.slice(0, 5).forEach((s, i) => {
      html += `<div class="standings-row ${s.isPlayer ? 'player-row' : ''}">
        <span class="standings-pos">${this.ordinal(i + 1)}</span>
        <span class="standings-name">${s.name}</span>
        <span class="standings-gap">${s.gap ? `+${s.gap.toFixed(1)}s` : '---'}</span>
      </div>`;
    });

    this.elements.standings.innerHTML = html;
  }

  updateMinimap(data) {
    if (!data || !this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const w = 200, h = 200;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 95, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 95, 0, Math.PI * 2);
    ctx.clip();

    if (data.trackPoints) {
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 4;
      ctx.beginPath();
      data.trackPoints.forEach((pt, i) => {
        const x = w / 2 + pt.x * data.scale;
        const y = h / 2 + pt.z * data.scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    if (data.cars) {
      data.cars.forEach(car => {
        const x = w / 2 + car.x * data.scale;
        const y = h / 2 + car.z * data.scale;
        ctx.fillStyle = car.isPlayer ? '#ff6600' : '#0088ff';
        ctx.beginPath();
        ctx.arc(x, y, car.isPlayer ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();

        if (car.isPlayer) {
          ctx.strokeStyle = '#ff6600';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    }

    ctx.restore();
  }

  showMessage(text, duration = 2000) {
    this.elements.message.textContent = text;
    this.elements.message.classList.add('active');

    setTimeout(() => {
      this.elements.message.classList.remove('active');
    }, duration);
  }

  showNotification(text, type = 'info', duration = 3000) {
    this.elements.notification.textContent = text;
    this.elements.notification.className = `hud-notification active ${type}`;

    setTimeout(() => {
      this.elements.notification.classList.remove('active');
    }, duration);
  }

  showCountdown(value) {
    if (value > 0) {
      this.elements.countdown.textContent = value.toString();
      this.elements.countdown.className = 'hud-countdown active';
    } else if (value === 0) {
      this.elements.countdown.textContent = 'GO!';
      this.elements.countdown.className = 'hud-countdown active go';
      setTimeout(() => {
        this.elements.countdown.classList.remove('active');
      }, 800);
    }
  }

  ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  toggle() {
    this.visible = !this.visible;
    this.container.classList.toggle('hidden', !this.visible);
  }

  show() {
    this.visible = true;
    this.container.classList.remove('hidden');
  }

  hide() {
    this.visible = false;
    this.container.classList.add('hidden');
  }
}
