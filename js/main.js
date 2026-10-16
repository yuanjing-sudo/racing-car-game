import * as THREE from 'three';
import { createCar } from './car.js';
import { createScene, createCamera, createRenderer } from './environment.js';
import { createPostFX } from './postfx.js';
import { createAnimations } from './animation.js';

const canvas = document.getElementById('webgl');
const loaderFill = document.getElementById('loaderFill');
const loaderStatus = document.getElementById('loaderStatus');
const preloader = document.getElementById('preloader');

function updateLoader(progress, status) {
  loaderFill.style.width = `${progress}%`;
  if (status) loaderStatus.textContent = status;
}

async function init() {
  updateLoader(10, 'Creating renderer...');
  const renderer = createRenderer(canvas);

  updateLoader(25, 'Setting up environment...');
  const scene = createScene();

  updateLoader(40, 'Building car model...');
  const { car, wheels } = createCar();
  scene.add(car);

  updateLoader(55, 'Configuring camera...');
  const camera = createCamera();

  updateLoader(70, 'Loading post-processing...');
  const { composer } = createPostFX(renderer, scene, camera);

  updateLoader(85, 'Preparing animations...');
  const { camState, wheelSpeed } = createAnimations(camera, wheels, car);

  updateLoader(95, 'Starting render loop...');

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();

    camera.position.x += (camState.x - camera.position.x) * 0.05;
    camera.position.y += (camState.y - camera.position.y) * 0.05;
    camera.position.z += (camState.z - camera.position.z) * 0.05;
    camera.lookAt(0, camState.lookY, 0);

    wheels.forEach((wheel) => {
      wheel.rotation.x += wheelSpeed.value * delta;
    });

    car.position.y = Math.sin(clock.elapsedTime * 0.5) * 0.01;

    composer.render();
  }

  animate();

  updateLoader(100, 'Ready!');
  setTimeout(() => {
    preloader.classList.add('hidden');
  }, 500);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });
}

init();
