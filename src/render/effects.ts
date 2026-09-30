import * as THREE from 'three';
import { TEST_CAR_2026 } from '../config/car';
import { BODY_SHARD, BODY_STRIDE, BODY_WHEEL, BODY_WING_F, BODY_WING_R, CONTACT_STRIDE, MAX_BODIES, MAX_CONTACTS, S } from '../physics/layout';
import { surfaceAt, SURFACES, type World2D } from '../world/provingGround';
import type { CarModel } from './carModel';

// ---------------------------------------------------------------------------------------------
// Trümmerteile: abgerissene Räder und Flügel, Karbon-Splitter
// ---------------------------------------------------------------------------------------------

export class DebrisRenderer {
  groundY = 0;
  private readonly wheels: THREE.Group[] = [];
  private readonly wheelTilt: THREE.Group[] = [];
  private readonly wheelSpin: THREE.Group[] = [];
  private readonly wingF: THREE.Group;
  private readonly wingR: THREE.Group;
  private readonly shards: THREE.InstancedMesh;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly eul = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(
    private readonly scene: THREE.Scene,
    templates: CarModel['debrisTemplates'],
  ) {
    for (let i = 0; i < 4; i++) {
      const outer = new THREE.Group();
      const tilt = new THREE.Group();
      const spin = new THREE.Group();
      spin.add(templates.wheel.clone(true));
      tilt.add(spin);
      outer.add(tilt);
      outer.visible = false;
      scene.add(outer);
      this.wheels.push(outer);
      this.wheelTilt.push(tilt);
      this.wheelSpin.push(spin);
    }
    this.wingF = new THREE.Group();
    this.wingF.add(templates.wingFront.clone(true));
    this.wingR = new THREE.Group();
    this.wingR.add(templates.wingRear.clone(true));
    this.wingF.visible = this.wingR.visible = false;
    scene.add(this.wingF, this.wingR);
    this.shards = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.22, 0.025, 0.11),
      new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.4 }),
      96,
    );
    this.shards.castShadow = true;
    this.shards.frustumCulled = false;
    this.shards.count = 0;
    scene.add(this.shards);
  }

  update(snap: Float64Array): void {
    let shardN = 0;
    let wheelSeen = 0;
    let wf = false;
    let wr = false;
    const nb = Math.min(MAX_BODIES, snap[S.nBodies] | 0);
    for (let i = 0; i < nb; i++) {
      const o = S.bodies + i * BODY_STRIDE;
      const kind = snap[o];
      const x = snap[o + 1];
      const y = snap[o + 2];
      const psi = snap[o + 3];
      const hop = snap[o + 4];
      const tilt = snap[o + 5];
      const spin = snap[o + 6];
      const id = snap[o + 7] | 0;
      if (kind === BODY_WHEEL) {
        const w = this.wheels[id & 3];
        w.visible = true;
        wheelSeen |= 1 << (id & 3);
        const cr = Math.cos(tilt);
        w.position.set(x, this.groundY + hop + 0.345 * cr + 0.13 * Math.sin(tilt), -y);
        w.rotation.set(0, psi, 0);
        this.wheelTilt[id & 3].rotation.set(tilt, 0, 0);
        this.wheelSpin[id & 3].rotation.set(0, 0, -spin);
      } else if (kind === BODY_WING_F) {
        wf = true;
        this.wingF.position.set(x, this.groundY + hop + 0.06, -y);
        this.wingF.rotation.set(0, psi, 0);
      } else if (kind === BODY_WING_R) {
        wr = true;
        this.wingR.position.set(x, this.groundY + hop + 0.06, -y);
        this.wingR.rotation.set(0, psi, 0);
      } else if (kind === BODY_SHARD && shardN < 96) {
        this.eul.set(spin * 0.7, psi, spin);
        this.q.setFromEuler(this.eul);
        this.pos.set(x, this.groundY + hop + 0.02, -y);
        this.m4.compose(this.pos, this.q, this.one);
        this.shards.setMatrixAt(shardN++, this.m4);
      }
    }
    for (let i = 0; i < 4; i++) if (!(wheelSeen & (1 << i))) this.wheels[i].visible = false;
    this.wingF.visible = wf;
    this.wingR.visible = wr;
    this.shards.count = shardN;
    if (shardN > 0) this.shards.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const w of this.wheels) this.scene.remove(w);
    this.scene.remove(this.wingF, this.wingR, this.shards);
  }
}

// ---------------------------------------------------------------------------------------------
// Partikel: Funken, Staub, Reifenqualm
// ---------------------------------------------------------------------------------------------

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  float a = smoothstep(1.0, 0.0, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class ParticleSystem {
  yOffset = 0;
  readonly points: THREE.Points;
  private readonly n: number;
  private readonly px: Float32Array;
  private readonly aSize: Float32Array;
  private readonly aAlpha: Float32Array;
  private readonly aColor: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;

  constructor(n: number, additive: boolean, scale: number) {
    this.n = n;
    this.px = new Float32Array(n * 3);
    this.aSize = new Float32Array(n);
    this.aAlpha = new Float32Array(n);
    this.aColor = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.px, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: scale } },
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }

  setScale(s: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = s;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, r: number, g: number, b: number, alpha: number, gravity: number, drag: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.px[i * 3] = x;
    this.px[i * 3 + 1] = y + this.yOffset;
    this.px[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.aColor[i * 3] = r;
    this.aColor[i * 3 + 1] = g;
    this.aColor[i * 3 + 2] = b;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.aAlpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const k = 1 - Math.min(1, this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * 9.81 * dt;
      this.vel[i3 + 2] *= k;
      this.px[i3] += this.vel[i3] * dt;
      this.px[i3 + 1] += this.vel[i3 + 1] * dt;
      this.px[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.px[i3 + 1] < 0.02 && this.grav[i] > 0) {
        this.px[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.35;
        this.vel[i3] *= 0.7;
        this.vel[i3 + 2] *= 0.7;
      }
      this.aSize[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.aAlpha[i] = this.alpha0[i] * (1 - t) * (1 - t * 0.3);
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Deterministisch genug für Effekte, aber ohne Einfluss auf die Physik. */
const rnd = (): number => Math.random();

export class Effects {
  set groundY(h: number) {
    this.sparks.yOffset = h;
    this.smoke.yOffset = h;
  }
  private readonly sparks = new ParticleSystem(700, true, 900);
  private readonly smoke = new ParticleSystem(900, false, 900);
  private readonly car = TEST_CAR_2026;
  private readonly lf: number;
  private readonly lr: number;

  constructor(
    scene: THREE.Scene,
    private readonly map: World2D,
  ) {
    scene.add(this.smoke.points, this.sparks.points);
    this.lr = this.car.geometry.frontWeight * this.car.geometry.wheelbase;
    this.lf = this.car.geometry.wheelbase - this.lr;
  }

  setQuality(low: boolean): void {
    this.sparks.points.visible = true;
    this.smoke.points.visible = !low;
  }

  update(snap: Float64Array, dt: number): void {
    const x = snap[S.x];
    const y = snap[S.y];
    const psi = snap[S.psi];
    const c = Math.cos(psi);
    const s = Math.sin(psi);
    const u = snap[S.u];
    const v = snap[S.v];
    const vwx = u * c - v * s;
    const vwy = u * s + v * c;
    const speed = Math.hypot(vwx, vwy);
    const g = this.car.geometry;
    const xw = [this.lf, this.lf, -this.lr, -this.lr];
    const yw = [g.trackFront / 2, -g.trackFront / 2, g.trackRear / 2, -g.trackRear / 2];

    for (let i = 0; i < 4; i++) {
      const wx = x + c * xw[i] - s * yw[i];
      const wy = y + s * xw[i] + c * yw[i];
      const off = snap[S.wheelOff + i] > 0.5;
      // Funken beim Schleifen des Unterbodens / Radträgers
      const sc = snap[S.scrape + i];
      if (sc > 0.04 && speed > 3) {
        const n = sc * dt * 420 * Math.min(1, speed / 25);
        let k = Math.floor(n) + (rnd() < n - Math.floor(n) ? 1 : 0);
        while (k-- > 0) {
          const back = 3 + rnd() * 10;
          const hot = rnd();
          this.sparks.emit(
            wx + (rnd() - 0.5) * 0.3,
            0.04,
            -wy + (rnd() - 0.5) * 0.3,
            (-vwx / Math.max(speed, 1)) * back + (rnd() - 0.5) * 4,
            1 + rnd() * 4,
            (vwy / Math.max(speed, 1)) * back + (rnd() - 0.5) * 4,
            0.3 + rnd() * 0.5,
            0.11,
            0.03,
            1,
            0.55 + hot * 0.4,
            0.15 + hot * 0.4,
            1,
            1,
            0.6,
          );
        }
      }
      if (off) continue;
      // Staub auf Kies/Gras/Sand
      const kind = surfaceAt(this.map, wx, wy);
      const sp = SURFACES[kind];
      if (sp.dust > 0 && speed > 5) {
        const n = sp.dust * dt * speed * 1.4;
        let k = Math.floor(n) + (rnd() < n - Math.floor(n) ? 1 : 0);
        const tint = kind === 'gravel' ? [0.62, 0.57, 0.48] : kind === 'sand' ? [0.78, 0.68, 0.5] : [0.36, 0.45, 0.25];
        while (k-- > 0) {
          this.smoke.emit(
            wx + (rnd() - 0.5) * 0.4,
            0.08,
            -wy + (rnd() - 0.5) * 0.4,
            -vwx * 0.15 + (rnd() - 0.5) * 2,
            0.6 + rnd() * 1.6,
            vwy * 0.15 + (rnd() - 0.5) * 2,
            1.1 + rnd() * 0.9,
            0.5,
            2.2 + rnd(),
            tint[0],
            tint[1],
            tint[2],
            0.32,
            -0.05,
            1.4,
          );
        }
      }
      // Reifenqualm bei Blockieren/Durchdrehen/Querrutschen auf Asphalt
      const slip = Math.max(Math.abs(snap[S.kappa + i]) / 0.3, Math.abs(snap[S.alpha + i]) / 0.2);
      const pun = snap[S.puncture + i];
      if (kind === 'asphalt' && speed > 6 && (slip > 1 || pun > 0.5)) {
        const n = Math.min(3, slip - 0.5 + pun) * dt * 38;
        let k = Math.floor(n) + (rnd() < n - Math.floor(n) ? 1 : 0);
        while (k-- > 0) {
          this.smoke.emit(wx, 0.1, -wy, -vwx * 0.05 + (rnd() - 0.5), 0.5 + rnd(), vwy * 0.05 + (rnd() - 0.5), 1 + rnd() * 0.8, 0.45, 1.9, 0.9, 0.9, 0.92, 0.26, -0.03, 1.1);
        }
      }
    }

    // Kontakte: Funkenregen und Staub an den Aufprallstellen
    for (let k = 0; k < MAX_CONTACTS; k++) {
      const o = S.contacts + k * CONTACT_STRIDE;
      const f = snap[o + 4];
      if (f < 1500) continue;
      const kind = snap[o + 5];
      const cx = snap[o];
      const cy = snap[o + 1];
      const nx = snap[o + 2];
      const ny = snap[o + 3];
      const n = Math.min(60, (f / 4000) * dt * 60);
      let m = Math.floor(n) + (rnd() < n - Math.floor(n) ? 1 : 0);
      while (m-- > 0) {
        const sp2 = 3 + rnd() * 12;
        this.sparks.emit(
          cx,
          0.12 + rnd() * 0.35,
          -cy,
          nx * sp2 + vwx * 0.4 + (rnd() - 0.5) * 6,
          rnd() * 5,
          -(ny * sp2 + vwy * 0.4) + (rnd() - 0.5) * 6,
          0.25 + rnd() * 0.5,
          0.1,
          0.03,
          1,
          0.6 + rnd() * 0.35,
          0.2 + rnd() * 0.3,
          1,
          1,
          0.4,
        );
      }
      if (kind === 0 || kind === 3) {
        const d = Math.min(6, (f / 20000) * dt * 40);
        let m2 = Math.floor(d) + (rnd() < d - Math.floor(d) ? 1 : 0);
        while (m2-- > 0) {
          this.smoke.emit(cx, 0.2, -cy, nx * 2 + (rnd() - 0.5) * 3, 0.5 + rnd() * 1.5, -ny * 2 + (rnd() - 0.5) * 3, 1.0 + rnd(), 0.6, 2.8, 0.62, 0.6, 0.58, 0.3, -0.02, 1.0);
        }
      }
    }

    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  setPixelScale(viewHeight: number, fov: number): void {
    const scale = viewHeight / (2 * Math.tan((fov * Math.PI) / 360));
    this.sparks.setScale(scale);
    this.smoke.setScale(scale);
  }
}
