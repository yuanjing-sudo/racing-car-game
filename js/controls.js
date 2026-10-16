import { clamp, damp } from './utils.js';

export class InputManager {
  constructor() {
    this.keys = {};
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0 };
    this.gamepad = null;
    this.touch = { steering: 0, throttle: 0, brake: 0, active: false };
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.lookBack = false;
    this.cameraToggle = false;
    this.pauseToggle = false;
    this.rToggle = false;
    this.gearUp = false;
    this.gearDown = false;

    this.steerSensitivity = 1.0;
    this.throttleSensitivity = 1.0;
    this.deadZone = 0.05;
    this.smoothing = 0.15;

    this._prevSteering = 0;
    this._prevThrottle = 0;
    this._prevBrake = 0;

    this.setupKeyboard();
    this.setupMouse();
    this.setupTouch();
    this.setupGamepad();
  }

  setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyC') this.cameraToggle = true;
      if (e.code === 'Escape') this.pauseToggle = true;
      if (e.code === 'KeyR') this.rToggle = true;
      if (e.code === 'KeyE') this.gearUp = true;
      if (e.code === 'KeyQ') this.gearDown = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    window.addEventListener('blur', () => {
      this.keys = {};
    });
  }

  setupMouse() {
    window.addEventListener('mousemove', (e) => {
      this.mouse.dx = e.movementX || 0;
      this.mouse.dy = e.movementY || 0;
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.touch.active = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.touch.active = false;
    });
  }

  setupTouch() {
    const touchSteer = document.getElementById('touch-steer');
    const touchThrottle = document.getElementById('touch-throttle');
    const touchBrake = document.getElementById('touch-brake');
    const touchHandbrake = document.getElementById('touch-handbrake');

    if (touchSteer) {
      let startX = 0;
      touchSteer.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startX = e.touches[0].clientX;
        this.touch.active = true;
      }, { passive: false });

      touchSteer.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const dx = e.touches[0].clientX - startX;
        this.touch.steering = clamp(dx / 80, -1, 1);
      }, { passive: false });

      touchSteer.addEventListener('touchend', () => {
        this.touch.steering = 0;
        this.touch.active = false;
      });
    }

    if (touchThrottle) {
      touchThrottle.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.touch.throttle = 1;
      }, { passive: false });
      touchThrottle.addEventListener('touchend', () => {
        this.touch.throttle = 0;
      });
    }

    if (touchBrake) {
      touchBrake.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.touch.brake = 1;
      }, { passive: false });
      touchBrake.addEventListener('touchend', () => {
        this.touch.brake = 0;
      });
    }

    if (touchHandbrake) {
      touchHandbrake.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.touch.handbrake = true;
      }, { passive: false });
      touchHandbrake.addEventListener('touchend', () => {
        this.touch.handbrake = false;
      });
    }
  }

  setupGamepad() {
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepad = e.gamepad;
    });

    window.addEventListener('gamepaddisconnected', () => {
      this.gamepad = null;
    });
  }

  update(dt) {
    let targetSteering = 0;
    let targetThrottle = 0;
    let targetBrake = 0;
    let targetHandbrake = false;

    if (this.keys['ArrowLeft'] || this.keys['KeyA']) targetSteering = -1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) targetSteering = 1;
    if (this.keys['ArrowUp'] || this.keys['KeyW']) targetThrottle = 1;
    if (this.keys['ArrowDown'] || this.keys['KeyS']) targetBrake = 1;
    if (this.keys['Space']) targetHandbrake = true;
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) targetThrottle = 1;

    if (this.gamepad) {
      const gp = navigator.getGamepads()[this.gamepad.index];
      if (gp) {
        const rawSteer = gp.axes[0] || 0;
        if (Math.abs(rawSteer) > this.deadZone) {
          targetSteering = rawSteer;
        }

        const rawThrottle = gp.buttons[7] ? gp.buttons[7].value : 0;
        const rawBrake = gp.buttons[6] ? gp.buttons[6].value : 0;
        if (rawThrottle > 0.1) targetThrottle = rawThrottle;
        if (rawBrake > 0.1) targetBrake = rawBrake;

        if (gp.buttons[0] && gp.buttons[0].pressed) targetHandbrake = true;
      }
    }

    if (this.touch.active) {
      if (Math.abs(this.touch.steering) > 0.01) targetSteering = this.touch.steering;
      if (this.touch.throttle > 0) targetThrottle = this.touch.throttle;
      if (this.touch.brake > 0) targetBrake = this.touch.brake;
      if (this.touch.handbrake) targetHandbrake = true;
    }

    this.steering = damp(this.steering, targetSteering, 1 / this.smoothing, dt);
    this.throttle = damp(this.throttle, targetThrottle, 1 / this.smoothing, dt);
    this.brake = damp(this.brake, targetBrake, 1 / this.smoothing, dt);

    if (Math.abs(this.steering) < 0.01 && targetSteering === 0) this.steering = 0;
    if (Math.abs(this.throttle) < 0.01 && targetThrottle === 0) this.throttle = 0;
    if (Math.abs(this.brake) < 0.01 && targetBrake === 0) this.brake = 0;

    this.handbrake = targetHandbrake;

    this.lookBack = !!(this.keys['KeyB']);
    this.cameraToggle = this.cameraToggle && false;
    this.pauseToggle = this.pauseToggle && false;
    this.rToggle = this.rToggle && false;
    this.gearUp = this.gearUp && false;
    this.gearDown = this.gearDown && false;
  }

  consumeCameraToggle() {
    const val = this.cameraToggle;
    this.cameraToggle = false;
    return val;
  }

  consumePauseToggle() {
    const val = this.pauseToggle;
    this.pauseToggle = false;
    return val;
  }

  consumeRToggle() {
    const val = this.rToggle;
    this.rToggle = false;
    return val;
  }

  consumeGearUp() {
    const val = this.gearUp;
    this.gearUp = false;
    return val;
  }

  consumeGearDown() {
    const val = this.gearDown;
    this.gearDown = false;
    return val;
  }

  getInput() {
    return {
      steering: this.steering * this.steerSensitivity,
      throttle: this.throttle * this.throttleSensitivity,
      brake: this.brake,
      handbrake: this.handbrake,
    };
  }

  reset() {
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.keys = {};
  }
}
