import * as THREE from 'three';

export function createCar() {
  const car = new THREE.Group();

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: 0xcc0000,
    metalness: 0.9,
    roughness: 0.15,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    reflectivity: 1.0,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x111111,
    metalness: 0.0,
    roughness: 0.0,
    transmission: 0.9,
    thickness: 0.5,
    transparent: true,
    opacity: 0.3,
  });

  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1.0,
    roughness: 0.0,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.9,
    metalness: 0.0,
  });

  const rimMat = new THREE.MeshPhysicalMaterial({
    color: 0xcccccc,
    metalness: 1.0,
    roughness: 0.2,
  });

  const bodyGeo = new THREE.BoxGeometry(2, 0.6, 4.5, 4, 2, 8);
  const posAttr = bodyGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    if (y > 0) {
      posAttr.setY(i, y * (1 - Math.abs(z) * 0.08));
    }
    if (z > 1.5) {
      posAttr.setY(i, y * 0.7);
      posAttr.setZ(i, z - (z - 1.5) * 0.15);
    }
    if (z < -1.5) {
      posAttr.setY(i, y * 0.8);
    }
  }
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.position.y = 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
  car.add(body);

  const cabinGeo = new THREE.BoxGeometry(1.6, 0.5, 2.0, 4, 2, 4);
  const cabinPos = cabinGeo.attributes.position;
  for (let i = 0; i < cabinPos.count; i++) {
    const z = cabinPos.getZ(i);
    const y = cabinPos.getY(i);
    if (y > 0) {
      cabinPos.setY(i, y * (1 - Math.abs(z) * 0.2));
    }
  }
  cabinGeo.computeVertexNormals();
  const cabin = new THREE.Mesh(cabinGeo, glassMat);
  cabin.position.set(0, 0.95, -0.3);
  cabin.castShadow = true;
  car.add(cabin);

  const splitterGeo = new THREE.BoxGeometry(2.1, 0.08, 0.5);
  const splitter = new THREE.Mesh(splitterGeo, chromeMat);
  splitter.position.set(0, 0.15, 2.4);
  car.add(splitter);

  const wingGeo = new THREE.BoxGeometry(2.0, 0.06, 0.6);
  const wing = new THREE.Mesh(wingGeo, paintMat);
  wing.position.set(0, 1.1, -2.2);
  car.add(wing);

  const wingLegGeo = new THREE.BoxGeometry(0.08, 0.35, 0.15);
  const wingLegL = new THREE.Mesh(wingLegGeo, chromeMat);
  wingLegL.position.set(-0.7, 0.9, -2.2);
  const wingLegR = new THREE.Mesh(wingLegGeo, chromeMat);
  wingLegR.position.set(0.7, 0.9, -2.2);
  car.add(wingLegL, wingLegR);

  const exhaustGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.4, 16);
  const exhaustL = new THREE.Mesh(exhaustGeo, chromeMat);
  exhaustL.rotation.x = Math.PI / 2;
  exhaustL.position.set(-0.5, 0.3, -2.3);
  const exhaustR = new THREE.Mesh(exhaustGeo, chromeMat);
  exhaustR.rotation.x = Math.PI / 2;
  exhaustR.position.set(0.5, 0.3, -2.3);
  car.add(exhaustL, exhaustR);

  const lightGeo = new THREE.BoxGeometry(0.4, 0.12, 0.05);
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffee,
    emissive: 0xffffcc,
    emissiveIntensity: 2.0,
  });
  const headlightL = new THREE.Mesh(lightGeo, headlightMat);
  headlightL.position.set(-0.6, 0.65, 2.26);
  const headlightR = new THREE.Mesh(lightGeo, headlightMat);
  headlightR.position.set(0.6, 0.65, 2.26);
  car.add(headlightL, headlightR);

  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    emissive: 0xff0000,
    emissiveIntensity: 1.5,
  });
  const taillightL = new THREE.Mesh(lightGeo, taillightMat);
  taillightL.position.set(-0.6, 0.7, -2.26);
  const taillightR = new THREE.Mesh(lightGeo, taillightMat);
  taillightR.position.set(0.6, 0.7, -2.26);
  car.add(taillightL, taillightR);

  const wheels = [];
  const wheelPositions = [
    { x: -1.0, z: 1.4 },
    { x: 1.0, z: 1.4 },
    { x: -1.0, z: -1.4 },
    { x: 1.0, z: -1.4 },
  ];

  wheelPositions.forEach((pos) => {
    const wheelGroup = new THREE.Group();

    const tireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 32);
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    wheelGroup.add(tire);

    const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.26, 8);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    wheelGroup.add(rim);

    const spokeGeo = new THREE.BoxGeometry(0.28, 0.04, 0.04);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (i / 5) * Math.PI * 2;
      wheelGroup.add(spoke);
    }

    wheelGroup.position.set(pos.x, 0.35, pos.z);
    car.add(wheelGroup);
    wheels.push(wheelGroup);
  });

  return { car, wheels };
}
