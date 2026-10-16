import * as THREE from 'three';
import { lerp, clamp, createGradientTexture } from './utils.js';

export const CAR_PAINT_COLORS = [
  { name: 'Rosso Corsa', color: 0xcc0000 },
  { name: 'Midnight Blue', color: 0x003366 },
  { name: 'Pearl White', color: 0xf5f5f5 },
  { name: 'Stealth Black', color: 0x111111 },
  { name: 'Racing Green', color: 0x004422 },
  { name: 'Sunset Orange', color: 0xff6600 },
  { name: 'Electric Yellow', color: 0xffcc00 },
  { name: 'Gunmetal Grey', color: 0x444444 },
  { name: 'Royal Purple', color: 0x6600cc },
  { name: 'Silver Arrow', color: 0xc0c0c0 },
];

export const WHEEL_STYLES = [
  { name: 'Sport 5-Spoke', spokes: 5 },
  { name: 'Racing Mesh', spokes: 10 },
  { name: 'Turbine', spokes: 7 },
  { name: 'Classic Split', spokes: 6 },
  { name: 'GT Blade', spokes: 3 },
];

export const SPOILER_TYPES = [
  { name: 'None', height: 0 },
  { name: 'Lip', height: 0.05 },
  { name: 'Ducktail', height: 0.12 },
  { name: 'GT Wing', height: 0.25 },
  { name: 'Time Attack', height: 0.35 },
];

export function createCarModel(config = {}) {
  const {
    paintColor = 0xcc0000,
    wheelStyle = 0,
    spoilerType = 0,
    rimColor = 0xcccccc,
    windowTint = 0.3,
  } = config;

  const car = new THREE.Group();
  car.userData.wheels = [];
  car.userData.parts = {};

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.85,
    roughness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    reflectivity: 1.0,
    envMapIntensity: 1.5,
  });

  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1.0,
    roughness: 0.0,
    envMapIntensity: 2.0,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x111122,
    metalness: 0.1,
    roughness: 0.0,
    transmission: 0.85,
    thickness: 0.3,
    transparent: true,
    opacity: windowTint + 0.2,
    ior: 1.5,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.92,
    metalness: 0.0,
  });

  const rimMat = new THREE.MeshPhysicalMaterial({
    color: rimColor,
    metalness: 1.0,
    roughness: 0.15,
    envMapIntensity: 1.8,
  });

  const carbonMat = new THREE.MeshPhysicalMaterial({
    color: 0x222222,
    metalness: 0.3,
    roughness: 0.4,
    clearcoat: 0.5,
  });

  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-1.0, 0);
  bodyShape.lineTo(-1.05, 0.2);
  bodyShape.quadraticCurveTo(-1.1, 0.4, -0.95, 0.5);
  bodyShape.lineTo(-0.9, 0.65);
  bodyShape.quadraticCurveTo(-0.7, 0.8, 0, 0.85);
  bodyShape.quadraticCurveTo(0.7, 0.8, 0.9, 0.65);
  bodyShape.lineTo(0.95, 0.5);
  bodyShape.quadraticCurveTo(1.1, 0.4, 1.05, 0.2);
  bodyShape.lineTo(1.0, 0);
  bodyShape.lineTo(-1.0, 0);

  const bodyExtrudeSettings = { depth: 4.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 };
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, bodyExtrudeSettings);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.translate(0, 0.35, -2.1);
  const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  car.add(bodyMesh);
  car.userData.parts.body = bodyMesh;

  const hoodGeo = new THREE.PlaneGeometry(1.8, 1.5, 8, 4);
  const hoodPos = hoodGeo.attributes.position;
  for (let i = 0; i < hoodPos.count; i++) {
    const x = hoodPos.getX(i);
    const y = hoodPos.getY(i);
    hoodPos.setZ(i, Math.sin(x * 2) * 0.03 + Math.cos(y * 3) * 0.02);
  }
  hoodGeo.computeVertexNormals();
  const hoodMesh = new THREE.Mesh(hoodGeo, paintMat);
  hoodMesh.rotation.x = -Math.PI / 2 + 0.05;
  hoodMesh.position.set(0, 0.88, 1.2);
  hoodMesh.castShadow = true;
  car.add(hoodMesh);

  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(-0.75, 0);
  cabinShape.lineTo(-0.8, 0.15);
  cabinShape.quadraticCurveTo(-0.7, 0.45, -0.5, 0.55);
  cabinShape.lineTo(0.5, 0.55);
  cabinShape.quadraticCurveTo(0.7, 0.45, 0.8, 0.15);
  cabinShape.lineTo(0.75, 0);
  cabinShape.lineTo(-0.75, 0);

  const cabinExtrudeSettings = { depth: 1.8, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 };
  const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, cabinExtrudeSettings);
  cabinGeo.rotateX(Math.PI / 2);
  cabinGeo.translate(0, 0.55, -1.3);
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.castShadow = true;
  car.add(cabinMesh);
  car.userData.parts.cabin = cabinMesh;

  const roofGeo = new THREE.BoxGeometry(1.4, 0.08, 1.2);
  const roofMesh = new THREE.Mesh(roofGeo, paintMat);
  roofMesh.position.set(0, 1.12, -0.5);
  roofMesh.castShadow = true;
  car.add(roofMesh);

  const windowGeo = new THREE.PlaneGeometry(1.3, 0.45);
  const windowMat = glassMat.clone();
  const windowL = new THREE.Mesh(windowGeo, windowMat);
  windowL.position.set(-0.76, 0.85, -0.5);
  windowL.rotation.y = Math.PI / 2;
  const windowR = new THREE.Mesh(windowGeo, windowMat);
  windowR.position.set(0.76, 0.85, -0.5);
  windowR.rotation.y = -Math.PI / 2;
  car.add(windowL, windowR);

  const windshieldGeo = new THREE.PlaneGeometry(1.3, 0.5);
  const windshield = new THREE.Mesh(windshieldGeo, windowMat);
  windshield.position.set(0, 0.9, 0.35);
  windshield.rotation.x = -0.4;
  car.add(windshield);

  const rearWindowGeo = new THREE.PlaneGeometry(1.3, 0.45);
  const rearWindow = new THREE.Mesh(rearWindowGeo, windowMat);
  rearWindow.position.set(0, 0.9, -1.45);
  rearWindow.rotation.x = 0.35;
  car.add(rearWindow);

  const splitterGeo = new THREE.BoxGeometry(2.2, 0.06, 0.6);
  const splitterMesh = new THREE.Mesh(splitterGeo, carbonMat);
  splitterMesh.position.set(0, 0.12, 2.25);
  splitterMesh.castShadow = true;
  car.add(splitterMesh);

  const diffuserGeo = new THREE.BoxGeometry(2.0, 0.15, 0.5);
  const diffuserMesh = new THREE.Mesh(diffuserGeo, carbonMat);
  diffuserMesh.position.set(0, 0.12, -2.2);
  car.add(diffuserMesh);

  const sideSkirtGeo = new THREE.BoxGeometry(0.08, 0.1, 2.5);
  const sideSkirtL = new THREE.Mesh(sideSkirtGeo, carbonMat);
  sideSkirtL.position.set(-1.05, 0.15, 0);
  const sideSkirtR = new THREE.Mesh(sideSkirtGeo, carbonMat);
  sideSkirtR.position.set(1.05, 0.15, 0);
  car.add(sideSkirtL, sideSkirtR);

  const spoilerInfo = SPOILER_TYPES[spoilerType] || SPOILER_TYPES[0];
  if (spoilerInfo.height > 0) {
    const wingGroup = new THREE.Group();
    const wingBladeGeo = new THREE.BoxGeometry(2.0, 0.05, 0.7);
    const wingBlade = new THREE.Mesh(wingBladeGeo, carbonMat);
    wingBlade.castShadow = true;
    wingGroup.add(wingBlade);

    const wingEndGeo = new THREE.BoxGeometry(0.05, 0.25, 0.6);
    const wingEndL = new THREE.Mesh(wingEndGeo, paintMat);
    wingEndL.position.set(-1.0, 0.1, 0);
    const wingEndR = new THREE.Mesh(wingEndGeo, paintMat);
    wingEndR.position.set(1.0, 0.1, 0);
    wingGroup.add(wingEndL, wingEndR);

    const wingLegGeo = new THREE.BoxGeometry(0.06, spoilerInfo.height + 0.15, 0.2);
    const wingLegL = new THREE.Mesh(wingLegGeo, chromeMat);
    wingLegL.position.set(-0.7, -(spoilerInfo.height + 0.15) / 2, 0);
    const wingLegR = new THREE.Mesh(wingLegGeo, chromeMat);
    wingLegR.position.set(0.7, -(spoilerInfo.height + 0.15) / 2, 0);
    wingGroup.add(wingLegL, wingLegR);

    wingGroup.position.set(0, 1.15 + spoilerInfo.height / 2, -2.1);
    car.add(wingGroup);
    car.userData.parts.spoiler = wingGroup;
  }

  const exhaustPositions = [
    { x: -0.55, y: 0.28, z: -2.3 },
    { x: -0.35, y: 0.28, z: -2.3 },
    { x: 0.35, y: 0.28, z: -2.3 },
    { x: 0.55, y: 0.28, z: -2.3 },
  ];
  const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.075, 0.35, 16);
  const exhaustInnerGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.36, 16);
  exhaustPositions.forEach(pos => {
    const exhaust = new THREE.Mesh(exhaustGeo, chromeMat);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(pos.x, pos.y, pos.z);
    car.add(exhaust);

    const inner = new THREE.Mesh(exhaustInnerGeo, new THREE.MeshStandardMaterial({ color: 0x000000 }));
    inner.rotation.x = Math.PI / 2;
    inner.position.set(pos.x, pos.y, pos.z + 0.01);
    car.add(inner);
  });

  const headlightGeo = new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI);
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffee,
    emissive: 0xffffcc,
    emissiveIntensity: 3.0,
    transparent: true,
    opacity: 0.9,
  });
  const headlightL = new THREE.Mesh(headlightGeo, headlightMat);
  headlightL.position.set(-0.65, 0.68, 2.15);
  headlightL.rotation.y = 0.2;
  const headlightR = new THREE.Mesh(headlightGeo, headlightMat);
  headlightR.position.set(0.65, 0.68, 2.15);
  headlightR.rotation.y = -0.2;
  car.add(headlightL, headlightR);
  car.userData.parts.headlights = [headlightL, headlightR];

  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.85,
  });
  const taillightGeo = new THREE.BoxGeometry(0.35, 0.1, 0.04);
  const taillightL = new THREE.Mesh(taillightGeo, taillightMat);
  taillightL.position.set(-0.65, 0.72, -2.15);
  const taillightR = new THREE.Mesh(taillightGeo, taillightMat);
  taillightR.position.set(0.65, 0.72, -2.15);
  car.add(taillightL, taillightR);
  car.userData.parts.taillights = [taillightL, taillightR];

  const mirrorGeo = new THREE.BoxGeometry(0.12, 0.06, 0.08);
  const mirrorStemGeo = new THREE.BoxGeometry(0.03, 0.02, 0.15);
  const mirrorL = new THREE.Mesh(mirrorGeo, paintMat);
  mirrorL.position.set(-0.85, 0.92, 0.3);
  const mirrorR = new THREE.Mesh(mirrorGeo, paintMat);
  mirrorR.position.set(0.85, 0.92, 0.3);
  const stemL = new THREE.Mesh(mirrorStemGeo, chromeMat);
  stemL.position.set(-0.78, 0.92, 0.35);
  const stemR = new THREE.Mesh(mirrorStemGeo, chromeMat);
  stemR.position.set(0.78, 0.92, 0.35);
  car.add(mirrorL, mirrorR, stemL, stemR);

  const grilleGeo = new THREE.BoxGeometry(1.4, 0.2, 0.04);
  const grilleMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.3 });
  const grille = new THREE.Mesh(grilleGeo, grilleMat);
  grille.position.set(0, 0.42, 2.18);
  car.add(grille);

  const badgeGeo = new THREE.CircleGeometry(0.06, 16);
  const badge = new THREE.Mesh(badgeGeo, chromeMat);
  badge.position.set(0, 0.55, 2.19);
  car.add(badge);

  const wheelStyleInfo = WHEEL_STYLES[wheelStyle] || WHEEL_STYLES[0];
  const wheelPositions = [
    { x: -0.95, y: 0.35, z: 1.35, steering: true },
    { x: 0.95, y: 0.35, z: 1.35, steering: true },
    { x: -0.95, y: 0.35, z: -1.35, steering: false },
    { x: 0.95, y: 0.35, z: -1.35, steering: false },
  ];

  wheelPositions.forEach((wPos, idx) => {
    const wheelGroup = new THREE.Group();

    const tireGeo = new THREE.TorusGeometry(0.3, 0.12, 12, 24);
    const tireMesh = new THREE.Mesh(tireGeo, tireMat);
    tireMesh.rotation.y = Math.PI / 2;
    tireMesh.castShadow = true;
    wheelGroup.add(tireMesh);

    const sidewallGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 24);
    const sidewallL = new THREE.Mesh(sidewallGeo, tireMat);
    sidewallL.rotation.z = Math.PI / 2;
    sidewallL.position.x = -0.09;
    sidewallL.scale.set(1, 1, 0.9);
    const sidewallR = new THREE.Mesh(sidewallGeo, tireMat);
    sidewallR.rotation.z = Math.PI / 2;
    sidewallR.position.x = 0.09;
    sidewallR.scale.set(1, 1, 0.9);
    wheelGroup.add(sidewallL, sidewallR);

    const rimGroup = new THREE.Group();
    const rimCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 8), rimMat);
    rimCenter.rotation.z = Math.PI / 2;
    rimGroup.add(rimCenter);

    for (let i = 0; i < wheelStyleInfo.spokes; i++) {
      const angle = (i / wheelStyleInfo.spokes) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.06), rimMat);
      spoke.position.set(0, Math.sin(angle) * 0.14, Math.cos(angle) * 0.14);
      spoke.rotation.x = angle;
      rimGroup.add(spoke);
    }

    const brakeDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.03, 24),
      new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.3 })
    );
    brakeDisc.rotation.z = Math.PI / 2;
    brakeDisc.position.x = -0.06;
    wheelGroup.add(brakeDisc);

    const caliper = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xcc0000, metalness: 0.5, roughness: 0.4 })
    );
    caliper.position.set(-0.06, 0.14, 0);
    wheelGroup.add(caliper);

    wheelGroup.add(rimGroup);
    wheelGroup.position.set(wPos.x, wPos.y, wPos.z);
    wheelGroup.userData.steering = wPos.steering;
    wheelGroup.userData.brakeDisc = brakeDisc;
    wheelGroup.userData.caliper = caliper;
    car.add(wheelGroup);
    car.userData.wheels.push(wheelGroup);
  });

  const underglow = new THREE.PointLight(paintColor, 0.5, 3);
  underglow.position.set(0, 0.05, 0);
  car.add(underglow);
  car.userData.parts.underglow = underglow;

  car.userData.config = { paintColor, wheelStyle, spoilerType, rimColor, windowTint };
  car.userData.materials = { paintMat, chromeMat, glassMat, tireMat, rimMat, carbonMat };
  car.userData.nitro = { active: false, timer: 0, cooldown: 0 };

  return car;
}

export function updateCarConfig(car, newConfig) {
  const { paintColor, wheelStyle, spoilerType, rimColor, windowTint } = newConfig;
  const mats = car.userData.materials;
  const parts = car.userData.parts;

  if (paintColor !== undefined) {
    mats.paintMat.color.setHex(paintColor);
    if (parts.underglow) parts.underglow.color.setHex(paintColor);
  }

  if (rimColor !== undefined) {
    mats.rimMat.color.setHex(rimColor);
  }

  if (windowTint !== undefined) {
    mats.glassMat.opacity = windowTint + 0.2;
  }

  car.userData.config = { ...car.userData.config, ...newConfig };
}

export function createConfiguratorCar() {
  const car = createCarModel({
    paintColor: 0xcc0000,
    wheelStyle: 0,
    spoilerType: 3,
    rimColor: 0xcccccc,
    windowTint: 0.3,
  });
  car.position.y = 0;
  return car;
}
