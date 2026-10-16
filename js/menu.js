import { TRACK_THEMES } from './track.js';
import { clamp } from './utils.js';

export class GameMenu {
  constructor() {
    this.container = document.getElementById('game-menu');
    this.overlay = document.getElementById('menu-overlay');
    this.isOpen = false;
    this.currentTab = 'main';
    this.selectedTrack = 0;
    this.selectedDifficulty = 2;
    this.selectedLaps = 3;
    this.raceSettings = {
      track: 'alpine',
      laps: 3,
      difficulty: 2,
      opponents: 10,
      weather: 'clear',
      timeOfDay: 10,
      assists: {
        abs: true,
        tcs: true,
        stability: false,
        autoBrakes: false,
        racingLine: true,
      },
      damage: true,
      tireWear: true,
      fuelConsumption: false,
    };
    this.animals = [];
    this.callbacks = {};
  }

  init(callbacks) {
    this.callbacks = callbacks;
    this.setupEventListeners();
    this.populateTrackList();
    this.updateUI();
  }

  setupEventListeners() {
    const tabs = document.querySelectorAll('.menu-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.currentTab = tab.dataset.tab;
        this.updateTabVisibility();
      });
    });

    const startBtn = document.getElementById('btn-start-race');
    if (startBtn) startBtn.addEventListener('click', () => this.startRace());

    const configBtn = document.getElementById('btn-configurator');
    if (configBtn) configBtn.addEventListener('click', () => this.openConfigurator());

    const freeRoamBtn = document.getElementById('btn-free-roam');
    if (freeRoamBtn) freeRoamBtn.addEventListener('click', () => this.startFreeRoam());

    const trackItems = document.querySelectorAll('.track-item');
    trackItems.forEach((item, idx) => {
      item.addEventListener('click', () => {
        this.selectedTrack = idx;
        this.raceSettings.track = TRACK_THEMES[idx].id;
        this.updateTrackSelection();
      });
    });

    const difficultySelect = document.getElementById('difficulty-select');
    if (difficultySelect) {
      difficultySelect.addEventListener('change', (e) => {
        this.selectedDifficulty = parseInt(e.target.value);
        this.raceSettings.difficulty = this.selectedDifficulty;
      });
    }

    const lapsInput = document.getElementById('laps-input');
    if (lapsInput) {
      lapsInput.addEventListener('change', (e) => {
        this.selectedLaps = clamp(parseInt(e.target.value) || 3, 1, 20);
        this.raceSettings.laps = this.selectedLaps;
      });
    }

    const opponentsInput = document.getElementById('opponents-input');
    if (opponentsInput) {
      opponentsInput.addEventListener('change', (e) => {
        this.raceSettings.opponents = clamp(parseInt(e.target.value) || 10, 1, 20);
      });
    }

    const weatherSelect = document.getElementById('weather-select');
    if (weatherSelect) {
      weatherSelect.addEventListener('change', (e) => {
        this.raceSettings.weather = e.target.value;
      });
    }

    const timeSlider = document.getElementById('time-slider');
    if (timeSlider) {
      timeSlider.addEventListener('input', (e) => {
        this.raceSettings.timeOfDay = parseFloat(e.target.value);
        document.getElementById('time-display').textContent = this.formatTime(this.raceSettings.timeOfDay);
      });
    }

    const assistToggles = document.querySelectorAll('.assist-toggle');
    assistToggles.forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const assist = e.target.dataset.assist;
        this.raceSettings.assists[assist] = e.target.checked;
      });
    });

    const damageToggle = document.getElementById('damage-toggle');
    if (damageToggle) {
      damageToggle.addEventListener('change', (e) => {
        this.raceSettings.damage = e.target.checked;
      });
    }

    const tireWearToggle = document.getElementById('tirewear-toggle');
    if (tireWearToggle) {
      tireWearToggle.addEventListener('change', (e) => {
        this.raceSettings.tireWear = e.target.checked;
      });
    }
  }

  populateTrackList() {
    const container = document.getElementById('track-list');
    if (!container) return;

    container.innerHTML = TRACK_THEMES.map((track, idx) => `
      <div class="track-item ${idx === this.selectedTrack ? 'selected' : ''}" data-idx="${idx}">
        <div class="track-preview track-${track.id}"></div>
        <div class="track-info">
          <span class="track-name">${track.name}</span>
          <span class="track-desc">${track.desc}</span>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.track-item').forEach((item, idx) => {
      item.addEventListener('click', () => {
        this.selectedTrack = idx;
        this.raceSettings.track = TRACK_THEMES[idx].id;
        this.updateTrackSelection();
      });
    });
  }

  updateTrackSelection() {
    document.querySelectorAll('.track-item').forEach((item, idx) => {
      item.classList.toggle('selected', idx === this.selectedTrack);
    });
  }

  updateTabVisibility() {
    document.querySelectorAll('.menu-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === this.currentTab);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `tab-${this.currentTab}`);
    });
  }

  updateUI() {
    const timeEl = document.getElementById('time-display');
    if (timeEl) timeEl.textContent = this.formatTime(this.raceSettings.timeOfDay);
  }

  formatTime(hours) {
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  show() {
    this.isOpen = true;
    this.container?.classList.add('active');
    this.overlay?.classList.add('active');
    document.body.classList.add('menu-open');
  }

  hide() {
    this.isOpen = false;
    this.container?.classList.remove('active');
    this.overlay?.classList.remove('active');
    document.body.classList.remove('menu-open');
  }

  startRace() {
    this.hide();
    this.callbacks.onStartRace?.(this.raceSettings);
  }

  openConfigurator() {
    this.hide();
    this.callbacks.onOpenConfigurator?.();
  }

  startFreeRoam() {
    this.hide();
    this.callbacks.onStartFreeRoam?.(this.raceSettings);
  }

  on(event, callback) {
    this.callbacks[event] = callback;
  }

  getSettings() { return { ...this.raceSettings }; }
}
