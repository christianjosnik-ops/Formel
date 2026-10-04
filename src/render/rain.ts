import * as THREE from 'three';

/**
 * Regen: Streifen in einem Würfel um die Kamera, die im Vertex-Shader fallen und umbrechen (keine CPU-Arbeit je Tropfen).
 * Die Strichrichtung folgt Fallgeschwindigkeit und Fahrtwind (schräg bei hohem Tempo), die Stärke steuert die Sichtbarkeit.
 */
const BOX = 44;
const HEIGHT = 26;

export class RainFx {
  readonly lines: THREE.LineSegments;
  private readonly mat: THREE.ShaderMaterial;
  private readonly rainCam = new THREE.Vector3();

  constructor(scene: THREE.Scene, n = 4200) {
    const pos = new Float32Array(n * 2 * 3);
    const end = new Float32Array(n * 2);
    const seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * BOX;
      const y = Math.random() * HEIGHT;
      const z = Math.random() * BOX;
      const sd = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
        seed[i * 2 + k] = sd;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: this.rainCam }, uWind: { value: new THREE.Vector3() }, uRain: { value: 0 } },
      vertexShader: `attribute float aEnd; attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform vec3 uWind; uniform float uRain; varying float vA;
void main(){
  float speed = 14.0 + aSeed * 6.0;
  vec3 p = position;
  p.y = mod(p.y - uTime * speed, ${HEIGHT.toFixed(1)});
  p.xz = mod(p.xz - uCam.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCam.xz;
  p.y += uCam.y - ${(HEIGHT * 0.35).toFixed(1)};
  vec3 vel = vec3(0.0, -speed, 0.0) - uWind;
  p += aEnd * normalize(vel) * (1.1 + aSeed * 0.9) * (0.6 + length(vel) * 0.035);
  float keep = step(aSeed, uRain);
  vA = (0.14 + 0.2 * aSeed) * keep * (1.0 - aEnd * 0.8);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.78, 0.84, 0.92, vA); }`,
    });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 8;
    scene.add(this.lines);
  }

  /** rain: Intensität 0..1; wind: relativer Fahrtwind in Szenenkoordinaten [m/s]. */
  update(time: number, cam: THREE.Vector3, rain: number, wind: THREE.Vector3): void {
    this.lines.visible = rain > 0.03;
    if (!this.lines.visible) return;
    this.mat.uniforms.uTime.value = time % 1000;
    this.rainCam.copy(cam);
    this.mat.uniforms.uWind.value.copy(wind).multiplyScalar(0.8);
    this.mat.uniforms.uRain.value = Math.min(1, rain);
  }
}
