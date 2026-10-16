import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const size = renderer.getSize(new THREE.Vector2());

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const ssaoPass = new SSAOPass(scene, camera, size.x, size.y);
  ssaoPass.kernelRadius = 0.4;
  ssaoPass.minDistance = 0.0008;
  ssaoPass.maxDistance = 0.12;
  ssaoPass.output = SSAOPass.OUTPUT.Default;
  composer.addPass(ssaoPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.35,
    0.6,
    0.88
  );
  bloomPass.enabled = true;
  composer.addPass(bloomPass);

  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms.offset.value = 0.95;
  vignettePass.uniforms.darkness.value = 1.1;
  composer.addPass(vignettePass);

  const fxaaPass = new ShaderPass(FXAAShader);
  const pixelRatio = renderer.getPixelRatio();
  fxaaPass.material.uniforms.resolution.value.set(1 / (size.x * pixelRatio), 1 / (size.y * pixelRatio));
  composer.addPass(fxaaPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return {
    composer,
    bloomPass,
    ssaoPass,
    vignettePass,
    fxaaPass,
    renderPass,
    outputPass,
  };
}

export function updatePostFXSize(postFX, width, height, pixelRatio) {
  postFX.fxaaPass.material.uniforms.resolution.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
  postFX.ssaoPass.setSize(width, height);
}

export function setBloomIntensity(postFX, intensity) {
  postFX.bloomPass.strength = intensity;
}

export function setSSAOEnabled(postFX, enabled) {
  postFX.ssaoPass.enabled = enabled;
}
