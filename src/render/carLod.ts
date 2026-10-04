import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Vereinfachtes Auto für größere Entfernung (~500 Dreiecke, ein Draw-Call statt ~30 und ~90 000 Dreiecke).
 * Eine gemeinsame Geometrie mit Vertexfarben (Weiß = Lackierung, wird per Materialfarbe zur Teamfarbe), Maße wie das Modell
 * (x vorn, y oben, z rechts, Ursprung im Schwerpunkt, Boden bei y = −cgHeight; hier in Bodenkoordinaten).
 */
let geo: THREE.BufferGeometry | null = null;
const mats = new Map<string, THREE.MeshStandardMaterial>();

function part(g: THREE.BufferGeometry, x: number, y: number, z: number, color: [number, number, number], sx = 1, sy = 1, sz = 1, rx = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));
  const out = g.clone().applyMatrix4(m).toNonIndexed();
  const n = out.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  out.deleteAttribute('uv');
  return out;
}

function build(): THREE.BufferGeometry {
  const W: [number, number, number] = [1, 1, 1];
  const K: [number, number, number] = [0.06, 0.06, 0.07];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
  const sph = new THREE.SphereGeometry(1, 8, 6);
  const parts = [
    // Monocoque und Nase
    part(box, 0.5, 0.36, 0, W, 3.6, 0.34, 0.62),
    part(box, 2.25, 0.27, 0, W, 1.6, 0.2, 0.28),
    // Motorabdeckung/Airbox
    part(box, -0.55, 0.68, 0, W, 1.6, 0.46, 0.4),
    part(box, -0.05, 0.9, 0, K, 0.4, 0.18, 0.3),
    // Seitenkästen
    part(box, 0.3, 0.33, 0.55, W, 1.6, 0.34, 0.42),
    part(box, 0.3, 0.33, -0.55, W, 1.6, 0.34, 0.42),
    // Boden
    part(box, 0.2, 0.1, 0, K, 3.8, 0.04, 1.3),
    // Frontflügel, Heckflügel
    part(box, 2.95, 0.1, 0, K, 0.4, 0.05, 1.75),
    part(box, -1.78, 0.88, 0, W, 0.3, 0.05, 1.0),
    part(box, -1.78, 0.62, 0, K, 0.32, 0.5, 0.05),
    part(box, -1.78, 0.62, 0.5, K, 0.36, 0.55, 0.04),
    part(box, -1.78, 0.62, -0.5, K, 0.36, 0.55, 0.04),
    // Helm
    part(sph, 0.3, 0.73, 0, [0.9, 0.9, 0.9], 0.12, 0.12, 0.11),
    // Räder (Reifen) mit Achse in z
    part(cyl, 1.853, 0.345, 0.76, K, 0.345, 0.375, 0.345, Math.PI / 2),
    part(cyl, 1.853, 0.345, -0.76, K, 0.345, 0.375, 0.345, Math.PI / 2),
    part(cyl, -1.547, 0.345, 0.78, K, 0.35, 0.5, 0.35, Math.PI / 2),
    part(cyl, -1.547, 0.345, -0.78, K, 0.35, 0.5, 0.35, Math.PI / 2),
  ];
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function carLodMesh(color: THREE.ColorRepresentation): THREE.Mesh {
  geo ??= build();
  const key = new THREE.Color(color).getHexString();
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.42, metalness: 0.15 });
    mats.set(key, m);
  }
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = true;
  return mesh;
}

/**
 * Statische Teile eines Knotens, die dasselbe Material nutzen, zu einem Mesh verschmelzen (ein Draw-Call statt vieler).
 * Nur für KI-Autos: dort sind Dellen/Einzelteil-Animationen unnötig.
 */
export function mergeByMaterial(root: THREE.Object3D): void {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m === root || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    (groups.get(m.material) ?? groups.set(m.material, []).get(m.material)!).push(m);
  });
  for (const [mat, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    for (const m of meshes) {
      const g = m.geometry.clone();
      g.applyMatrix4(inv.clone().multiply(m.matrixWorld));
      const ni = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(ni.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') ni.deleteAttribute(name);
      geos.push(ni);
    }
    const hasUv = geos.every((g) => !!g.getAttribute('uv'));
    if (!hasUv) for (const g of geos) g.deleteAttribute('uv');
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = meshes[0].castShadow;
    for (const m of meshes) m.parent?.remove(m);
    root.add(mesh);
  }
}
