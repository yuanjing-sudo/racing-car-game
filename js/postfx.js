import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
  ssaoPass.kernelRadius = 0.5;
  ssaoPass.minDistance = 0.001;
  ssaoPass.maxDistance = 0.15;
  composer.addPass(ssaoPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.4,
    0.5,
    0.85
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return { composer, bloomPass, ssaoPass };
}
