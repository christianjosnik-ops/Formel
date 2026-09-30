import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface CarModelInfo {
  wheelbase: number;
  tireRadius: number;
  trackFront: number;
  trackRear: number;
  tireWidthFront: number;
  tireWidthRear: number;
  lf: number;
  lr: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

export interface CarAssets {
  scene: THREE.Group;
  info: CarModelInfo;
}

let cached: Promise<CarAssets> | null = null;

/** Lädt das F1-Modell (Draco-komprimiertes GLB) einmalig. */
export function loadCarAssets(): Promise<CarAssets> {
  if (cached) return cached;
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}draco/`);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  cached = Promise.all([
    loader.loadAsync(`${base}models/f1car.glb`),
    fetch(`${base}models/f1car.json`).then((r) => r.json() as Promise<CarModelInfo>),
  ]).then(([gltf, info]) => {
    draco.dispose();
    return { scene: gltf.scene, info };
  });
  return cached;
}
