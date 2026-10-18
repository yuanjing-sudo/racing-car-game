import * as THREE from 'three';
import { getAsphaltMaps } from './materials.js';

/* ==================================================================
 * environment.js
 * The "Lumen" stand-in: instead of relying on a neutral studio probe,
 * we bake a small procedural sky (gradient dome + ground bounce + a
 * hot sun disc) into a PMREM environment map. Every metal, glass and
 * wet-asphalt surface in the scene mirrors it, which is what sells
 * rain-slicked roads and glowing car paint.
 * ================================================================== */

function createSkyEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  const skyGeo = new THREE.SphereGeometry(60, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color(0x2f7bd4) },
      uHorizon: { value: new THREE.Color(0xdfeaf5) },
      uBottom: { value: new THREE.Color(0x1a1c20) },
      uSunDir: { value: new THREE.Vector3(0.45, 0.55, 0.7).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix( uHorizon, uTop, clamp( pow( max( h, 0.0 ), 0.55 ), 0.0, 1.0 ) );
        col = mix( uBottom, col, smoothstep( -0.22, 0.06, h ) );

        // bright sun disc + halo, drives the specular hot-spots
        float sd = max( dot( normalize( vDir ), normalize( uSunDir ) ), 0.0 );
        col += vec3( 1.0, 0.95, 0.86 ) * pow( sd, 220.0 ) * 9.0;
        col += vec3( 1.0, 0.92, 0.8 )  * pow( sd, 8.0 ) * 0.55;

        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));

  // ground bounce card so upward-facing metal picks up warm bounce
  const groundGeo = new THREE.CircleGeometry(60, 24);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshBasicMaterial({ color: 0x2a2b30 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -1.5;
  envScene.add(ground);

  const target = pmrem.fromScene(envScene, 0.02);
  const tex = target.texture;

  pmrem.dispose();
  skyGeo.dispose();
  groundGeo.dispose();
  skyMat.dispose();
  groundMat.dispose();

  return tex;
}

export function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);
  scene.fog = new THREE.FogExp2(0x0a0d14, 0.0035);

  // --- image based lighting -------------------------------------
  scene.environment = createSkyEnvironment(renderer);

  // --- garage / menu showroom floor -----------------------------
  const maps = getAsphaltMaps();
  const groundGeo = new THREE.CircleGeometry(30, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x191b20,
    map: maps.map,
    roughnessMap: maps.roughnessMap,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 1.0,
    metalness: 0.6,
    envMapIntensity: 1.9,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const gridHelper = new THREE.GridHelper(40, 40, 0x2a3a52, 0x14181f);
  gridHelper.position.y = 0.012;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.35;
  scene.add(gridHelper);

  // --- showroom key / fill / rim ---------------------------------
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(6, 12, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 40;
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -12;
  keyLight.shadow.bias = -0.0008;
  keyLight.shadow.radius = 3;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x5f8fff, 1.0);
  fillLight.position.set(-7, 5, -5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xff7a2a, 1.6);
  rimLight.position.set(-2, 3.5, -9);
  scene.add(rimLight);

  const ambientLight = new THREE.AmbientLight(0x3a4456, 0.55);
  scene.add(ambientLight);

  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.25, 2000);
  camera.position.set(6, 3, 8);
  camera.lookAt(0, 0.5, 0);
  return camera;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}
