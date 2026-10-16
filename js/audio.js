import { clamp, lerp } from './utils.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.tireNoise = null;
    this.tireGain = null;
    this.windNoise = null;
    this.windGain = null;
    this.skidding = false;
    this.initialized = false;
    this.muted = false;
    this.volume = 0.7;

    this.engineBaseFreq = 80;
    this.engineRPM = 800;
    this.targetEngineRPM = 800;
  }

  async init() {
    if (this.initialized) return;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);

      this.setupEngine();
      this.setupTireNoise();
      this.setupWindNoise();
      this.setupEffects();

      this.initialized = true;
    } catch (e) {
      console.warn('Audio initialization failed:', e);
    }
  }

  setupEngine() {
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 800;
    this.engineFilter.Q.value = 2;

    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = this.engineBaseFreq;
    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc1.start();

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = this.engineBaseFreq * 1.5;
    const osc2Gain = this.ctx.createGain();
    osc2Gain.gain.value = 0.3;
    this.engineOsc2.connect(osc2Gain);
    osc2Gain.connect(this.engineFilter);
    this.engineOsc2.start();

    const subOsc = this.ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = this.engineBaseFreq * 0.5;
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.5;
    subOsc.connect(subGain);
    subGain.connect(this.engineGain);
    subOsc.start();
    this.engineSubOsc = subOsc;
  }

  setupTireNoise() {
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.tireNoise = this.ctx.createBufferSource();
    this.tireNoise.buffer = buffer;
    this.tireNoise.loop = true;

    const tireFilter = this.ctx.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 800;
    tireFilter.Q.value = 1.5;

    this.tireGain = this.ctx.createGain();
    this.tireGain.gain.value = 0;

    this.tireNoise.connect(tireFilter);
    tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.masterGain);
    this.tireNoise.start();
  }

  setupWindNoise() {
    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.windNoise = this.ctx.createBufferSource();
    this.windNoise.buffer = buffer;
    this.windNoise.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'highpass';
    windFilter.frequency.value = 2000;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;

    this.windNoise.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    this.windNoise.start();
  }

  setupEffects() {
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;
    this.compressor.connect(this.masterGain);

    this.reverb = this.ctx.createConvolver();
    const reverbBuffer = this.createReverbImpulse(2, 2, false);
    this.reverb.buffer = reverbBuffer;

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.15;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);
  }

  createReverbImpulse(duration, decay, reverse) {
    const rate = this.ctx.sampleRate;
    const length = rate * duration;
    const impulse = this.ctx.createBuffer(2, length, rate);
    const impulseL = impulse.getChannelData(0);
    const impulseR = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = reverse ? length - i : i;
      impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
      impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }

    return impulse;
  }

  update(dt, vehicleData) {
    if (!this.initialized || this.muted) return;

    this.targetEngineRPM = vehicleData.rpm;
    this.engineRPM = lerp(this.engineRPM, this.targetEngineRPM, dt * 8);

    const freq = this.engineBaseFreq * (this.engineRPM / 800);
    this.engineOsc1.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.01);
    this.engineOsc2.frequency.setTargetAtTime(freq * 1.5, this.ctx.currentTime, 0.01);
    this.engineSubOsc.frequency.setTargetAtTime(freq * 0.5, this.ctx.currentTime, 0.01);

    const load = vehicleData.throttle;
    const volume = 0.08 + load * 0.12;
    this.engineGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);

    const filterFreq = 400 + this.engineRPM * 0.5 + load * 600;
    this.engineFilter.frequency.setTargetAtTime(filterFreq, this.ctx.currentTime, 0.05);

    this.updateTireSound(vehicleData);
    this.updateWindSound(vehicleData);
  }

  updateTireSound(vehicleData) {
    const isSkidding = vehicleData.isDrifting || vehicleData.wheelSlip > 0.3;
    const slipAmount = Math.abs(vehicleData.driftAngle || 0) + vehicleData.wheelSlip;

    if (isSkidding && vehicleData.speed > 3) {
      const targetGain = clamp(slipAmount * 0.15, 0, 0.12);
      this.tireGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);

      const freq = 600 + slipAmount * 400;
      this.tireNoise.playbackRate.setTargetAtTime(freq / 800, this.ctx.currentTime, 0.05);
    } else {
      this.tireGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
  }

  updateWindSound(vehicleData) {
    const speed = vehicleData.speed;
    const windVolume = clamp(speed / 80, 0, 1) * 0.06;
    this.windGain.gain.setTargetAtTime(windVolume, this.ctx.currentTime, 0.1);
  }

  playEffect(type, volume = 1.0) {
    if (!this.initialized || this.muted) return;

    switch (type) {
      case 'countdown_beep':
        this.playTone(440, 0.15, 'sine', 0.3 * volume);
        break;
      case 'go_beep':
        this.playTone(880, 0.3, 'sine', 0.4 * volume);
        break;
      case 'lap_complete':
        this.playTone(660, 0.1, 'sine', 0.3 * volume);
        setTimeout(() => this.playTone(880, 0.15, 'sine', 0.3 * volume), 100);
        break;
      case 'overtake':
        this.playTone(520, 0.08, 'triangle', 0.2 * volume);
        setTimeout(() => this.playTone(780, 0.12, 'triangle', 0.2 * volume), 80);
        break;
      case 'collision':
        this.playNoiseBurst(0.2, 2000, 0.5 * volume);
        break;
      case 'boost':
        this.playTone(700, 0.12, 'square', 0.35 * volume);
        setTimeout(() => this.playTone(1050, 0.12, 'square', 0.35 * volume), 60);
        break;
      case 'menu_select':
        this.playTone(1200, 0.05, 'sine', 0.15 * volume);
        break;
      case 'menu_hover':
        this.playTone(800, 0.03, 'sine', 0.08 * volume);
        break;
      case 'gear_shift':
        this.playTone(200, 0.05, 'square', 0.2 * volume);
        this.playNoiseBurst(0.05, 4000, 0.1 * volume);
        break;
      case 'checkpoint':
        this.playTone(990, 0.1, 'sine', 0.2 * volume);
        break;
    }
  }

  playTone(freq, duration, type = 'sine', volume = 0.3) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playNoiseBurst(duration, frequency, volume) {
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
    return this.muted;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.masterGain && !this.muted) {
      this.masterGain.gain.value = this.volume;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
}
