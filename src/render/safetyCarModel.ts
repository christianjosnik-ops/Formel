import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Safety Car: Blender-Modell (tools/make_safetycar.py, public/models/safetycar.glb) mit blinkendem Dachlichtbalken,
 * drehenden Rädern und Lichtern. Bis das Modell geladen ist (oder falls es fehlt), erscheint nichts.
 */
export class SafetyCarModel {
  readonly root = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private amber: THREE.MeshStandardMaterial[] = [];
  private green: THREE.MeshStandardMaterial[] = [];
  private tail: THREE.MeshStandardMaterial[] = [];
  private head: THREE.MeshStandardMaterial[] = [];
  private spin = 0;
  private lastT = 0;
  /** Modell geladen. */
  readonly loaded: Promise<void>;
  ready = false;

  constructor() {
    this.root.visible = false;
    this.loaded = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}models/safetycar.glb`)
      .then((gltf) => {
        const m = gltf.scene;
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (/^Wheel(FL|FR|RL|RR)$/.test(o.name)) this.wheels.push(o);
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = false;
          mesh.frustumCulled = true;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mt of mats) {
            const sm = mt as THREE.MeshStandardMaterial;
            if (sm.name === 'SCAmber' && !this.amber.includes(sm)) this.amber.push(sm);
            else if (sm.name === 'SCGreen' && !this.green.includes(sm)) this.green.push(sm);
            else if (sm.name === 'SCTail' && !this.tail.includes(sm)) this.tail.push(sm);
            else if (sm.name === 'SCHead' && !this.head.includes(sm)) this.head.push(sm);
            if (sm.name === 'SCGlass') {
              sm.roughness = 0.05;
              sm.metalness = 0.6;
              sm.envMapIntensity = 1.6;
            }
          }
        });
        this.root.add(m);
        this.ready = true;
      })
      .catch(() => undefined);
  }

  /** x, z in Szenenkoordinaten, psi = Kursrichtung (wie das Auto), speed in m/s für die Raddrehung. */
  update(active: boolean, x: number, ground: number, z: number, psi: number, time: number, speed = 0): void {
    this.root.visible = active && this.ready;
    if (!this.root.visible) return;
    this.root.position.set(x, ground, z);
    this.root.rotation.y = psi;
    const dt = Math.min(0.1, Math.max(0, time - this.lastT));
    this.lastT = time;
    this.spin -= (speed / 0.36) * dt;
    for (const w of this.wheels) w.rotation.z = this.spin;
    // Lichtbalken: Bernstein im Wechsel mit kurzer Pause, Grün aus
    const on = Math.sin(time * 13) > -0.2;
    for (const m of this.amber) m.emissiveIntensity = on ? 3.2 : 0.05;
    for (const m of this.green) m.emissiveIntensity = 0;
    for (const m of this.tail) m.emissiveIntensity = 1.4;
    for (const m of this.head) m.emissiveIntensity = 1.6;
  }
}
