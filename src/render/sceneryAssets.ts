import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Teil eines Blender-Objekts (eine Geometrie mit genau einem Material). */
export interface SceneryPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
}

export interface SceneryAssets {
  parts: (name: string) => SceneryPart[];
  /** Höhe des Objekts (Meter, Blender-Maßstab). */
  height: (name: string) => number;
}

let cached: Promise<SceneryAssets | null> | null = null;

/**
 * Lädt die in Blender erzeugten Landschaftsobjekte (Bäume, Gras, Büsche, Tribünenmodul; tools/make_scenery.py).
 * Blattkarten, Gras und Publikum werden unbeleuchtet mit eingebackener Schattierung dargestellt – das vermeidet
 * die harten Hell/Dunkel-Kanten zweiseitiger Karten und kostet auf Handys weniger.
 */
export function loadSceneryAssets(): Promise<SceneryAssets | null> {
  if (cached) return cached;
  const base = import.meta.env.BASE_URL;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}draco/`);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  cached = loader
    .loadAsync(`${base}models/scenery.glb`)
    .then((gltf) => {
      draco.dispose();
      const swap = new Map<THREE.Material, THREE.Material>();
      const convert = (m: THREE.MeshStandardMaterial): THREE.Material => {
        let r = swap.get(m);
        if (r) return r;
        if (/Leaf|Needle|Crowd|Grass|Bush/i.test(m.name)) {
          r = new THREE.MeshBasicMaterial({
            map: m.map,
            vertexColors: true,
            alphaTest: m.map ? 0.5 : 0,
            side: THREE.DoubleSide,
            name: m.name,
          });
        } else {
          m.side = THREE.DoubleSide;
          m.roughness = Math.max(m.roughness, 0.7);
          m.metalness = Math.min(m.metalness, 0.3);
          r = m;
        }
        swap.set(m, r);
        return r;
      };
      const bank = new Map<string, SceneryPart[]>();
      const heights = new Map<string, number>();
      for (const child of gltf.scene.children) {
        const parts: SceneryPart[] = [];
        child.updateWorldMatrix(true, true);
        const box = new THREE.Box3();
        child.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const geo = mesh.geometry.clone();
          geo.applyMatrix4(mesh.matrixWorld);
          geo.computeBoundingBox();
          box.union(geo.boundingBox!);
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          parts.push({ geo, mat: convert(mat as THREE.MeshStandardMaterial) });
        });
        bank.set(child.name, parts);
        heights.set(child.name, Math.max(0.01, box.max.y - Math.min(0, box.min.y)));
      }
      return {
        parts: (n) => bank.get(n) ?? [],
        height: (n) => heights.get(n) ?? 1,
      } as SceneryAssets;
    })
    .catch(() => null);
  return cached;
}
