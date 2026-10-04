import * as THREE from 'three';

/** Safety Car: einfaches Sportcoupé (britisch-grün, silberne Streifen) mit blinkendem Lichtbalken. */
export class SafetyCarModel {
  readonly root = new THREE.Group();
  private readonly bar: THREE.MeshStandardMaterial;

  constructor() {
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x0c5a3a, roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0f1113, roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.08, metalness: 0.6 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.3, metalness: 0.8 });
    this.bar = new THREE.MeshStandardMaterial({ color: 0x221400, emissive: 0xffa000, emissiveIntensity: 1, roughness: 0.4 });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, 0, rz);
      mesh.castShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    // Karosserie: Unterbau, Motorhaube (nach vorn abfallend), Kabine, Heck
    add(new THREE.BoxGeometry(4.5, 0.55, 1.95), paint, 0, 0.62, 0);
    add(new THREE.BoxGeometry(1.5, 0.22, 1.9), paint, 1.55, 0.95, 0, 0, -0.1);
    add(new THREE.BoxGeometry(1.8, 0.5, 1.7), glass, -0.2, 1.05, 0);
    add(new THREE.BoxGeometry(1.6, 0.06, 1.62), paint, -0.25, 1.33, 0);
    add(new THREE.BoxGeometry(0.9, 0.2, 1.85), paint, -1.95, 0.98, 0, 0, 0.1);
    add(new THREE.BoxGeometry(0.12, 0.05, 1.85), dark, -2.35, 1.1, 0);
    // Frontsplitter, Streifen, Lufteinlass
    add(new THREE.BoxGeometry(0.5, 0.06, 2.0), dark, 2.3, 0.37, 0);
    add(new THREE.BoxGeometry(4.3, 0.04, 0.12), silver, 0, 0.9, 0.5);
    add(new THREE.BoxGeometry(4.3, 0.04, 0.12), silver, 0, 0.9, -0.5);
    add(new THREE.BoxGeometry(0.12, 0.3, 1.2), dark, 2.26, 0.62, 0);
    // Räder
    for (const [x, z] of [[1.45, 0.88], [1.45, -0.88], [-1.4, 0.9], [-1.4, -0.9]] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 20), dark);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.36, z);
      w.castShadow = true;
      this.root.add(w);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 14), silver);
      c.rotation.x = Math.PI / 2;
      c.position.set(x, 0.36, z);
      this.root.add(c);
    }
    // Lichtbalken auf dem Dach
    add(new THREE.BoxGeometry(0.32, 0.1, 1.5), this.bar, -0.3, 1.43, 0);
    // Rücklichter
    const tail = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1010, emissiveIntensity: 1.4 });
    add(new THREE.BoxGeometry(0.06, 0.08, 0.6), tail, -2.32, 0.78, 0.6);
    add(new THREE.BoxGeometry(0.06, 0.08, 0.6), tail, -2.32, 0.78, -0.6);
    this.root.visible = false;
  }

  update(active: boolean, x: number, ground: number, z: number, psi: number, time: number): void {
    this.root.visible = active;
    if (!active) return;
    this.root.position.set(x, ground, z);
    this.root.rotation.y = psi;
    this.bar.emissiveIntensity = Math.sin(time * 14) > 0 ? 2.6 : 0.2;
  }
}
