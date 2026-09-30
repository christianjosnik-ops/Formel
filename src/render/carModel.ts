import * as THREE from 'three';
import { S } from '../physics/layout';
import type { CarConfig } from '../config/car';

export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
  number: number;
  helmet: string;
  /** Reifenmischung für die Flankenmarkierung. */
  compound?: 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
}

export const COMPOUND_COLOR: Record<string, string> = {
  soft: '#e8192c',
  medium: '#ffd51f',
  hard: '#f2f2f2',
  inter: '#2ecc40',
  wet: '#1f77ff',
};

// ---------------------------------------------------------------------------------------------
// Hilfsfunktionen für Geometrie
// ---------------------------------------------------------------------------------------------

interface Section {
  x: number;
  /** Halbbreite. */
  w: number;
  yb: number;
  yt: number;
  n?: number;
  /** Seitlicher Versatz des Querschnittsmittelpunkts. */
  cz?: number;
}

const RING = 28;

function spow(v: number, e: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), e);
}

/** Erzeugt einen Rumpf durch Verbinden von Superellipsen-Querschnitten (Nase -> Heck). */
function loft(secs: Section[]): THREE.BufferGeometry {
  const ns = secs.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < ns; i++) {
    const s = secs[i];
    const n = s.n ?? 2.5;
    const e = 2 / n;
    for (let j = 0; j <= RING; j++) {
      const a = (j / RING) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      pos.push(s.x, (s.yb + s.yt) / 2 + ((s.yt - s.yb) / 2) * spow(sn, e), (s.cz ?? 0) + s.w * spow(c, e));
      uv.push(i / (ns - 1), j / RING);
    }
  }
  const stride = RING + 1;
  for (let i = 0; i < ns - 1; i++) {
    for (let j = 0; j < RING; j++) {
      const a = i * stride + j;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Endkappen
  for (const end of [0, ns - 1]) {
    const s = secs[end];
    const center = pos.length / 3;
    pos.push(s.x, (s.yb + s.yt) / 2, s.cz ?? 0);
    uv.push(end === 0 ? 0 : 1, 0.25);
    const base = end * stride;
    for (let j = 0; j < RING; j++) {
      if (end === 0) idx.push(center, base + j + 1, base + j);
      else idx.push(center, base + j, base + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Naht glätten
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < ns; i++) {
    const a = i * stride;
    const b = a + RING;
    const nx = nrm.getX(a) + nrm.getX(b);
    const ny = nrm.getY(a) + nrm.getY(b);
    const nz = nrm.getZ(a) + nrm.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / l, ny / l, nz / l);
    nrm.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

/** Flügelprofil (Sehne entlang x, Dicke entlang y), extrudiert entlang z, zentriert. */
function airfoil(chord: number, thickness: number, camber: number, span: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 14;
  const yt = (t: number) =>
    5 * thickness * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1015 * t ** 4);
  const yc = (t: number) => camber * (2 * t - t * t);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector2(t * chord, (yc(t) + yt(t)) * chord));
  }
  for (let i = N - 1; i >= 1; i--) {
    const t = i / N;
    pts.push(new THREE.Vector2(t * chord, (yc(t) - yt(t)) * chord));
  }
  const shape = new THREE.Shape(pts);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -span / 2);
  g.computeVertexNormals();
  return g;
}

/** Plattenförmiger Körper aus einem Polygon in der x-y-Ebene (Seitenansicht), Dicke entlang z. */
function sidePlate(points: Array<[number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  return g;
}

/** Flache Platte aus einem Polygon in der x-z-Ebene (Draufsicht), Dicke entlang y. */
function topPlate(points: Array<[number, number]>, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

function tube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, radius, 8, false);
}

// ---------------------------------------------------------------------------------------------
// Texturen
// ---------------------------------------------------------------------------------------------

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function liveryTexture(l: Livery, kind: 'body' | 'pod'): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  return canvasTex(W, H, (g) => {
    g.fillStyle = l.primary;
    g.fillRect(0, 0, W, H);
    if (kind === 'body') {
      // u: Nase (0) -> Heck (1); v: 0 rechts, .25 oben, .5 links, .75 unten
      g.fillStyle = l.secondary;
      // Mittelstreifen auf der Oberseite
      g.fillRect(0, H * 0.25 - 26, W * 0.42, 52);
      g.fillRect(W * 0.55, H * 0.25 - 26, W * 0.45, 52);
      // Seitenstreifen
      for (const vy of [0, 0.5, 1]) {
        g.fillStyle = l.accent;
        g.fillRect(W * 0.12, H * vy - 7, W * 0.55, 14);
      }
      // Unterseite dunkel
      g.fillStyle = '#16181b';
      g.fillRect(0, H * 0.62, W, H * 0.26);
      // Startnummer: Nase oben und Motorhaube
      g.save();
      g.fillStyle = l.accent;
      g.font = 'bold 120px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.translate(W * 0.13, H * 0.25);
      g.rotate(Math.PI / 2);
      g.scale(1, -1);
      g.fillText(String(l.number), 0, 0);
      g.restore();
      g.save();
      g.fillStyle = l.secondary;
      g.font = 'bold 110px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // rechts (v=0): u läuft Nase->Heck, von außen gesehen also gespiegelt; links (v=0.5): auf dem Kopf
      g.save();
      g.translate(W * 0.73, H * 0.04);
      g.scale(-1, 1);
      g.fillText(String(l.number), 0, 0);
      g.restore();
      g.save();
      g.translate(W * 0.73, H * 0.5);
      g.scale(1, -1);
      g.fillText(String(l.number), 0, 0);
      g.restore();
      g.restore();
    } else {
      g.fillStyle = l.secondary;
      g.fillRect(0, H * 0.46, W, 26);
      g.fillStyle = '#16181b';
      g.fillRect(0, H * 0.64, W, H * 0.3);
      g.fillStyle = l.accent;
      g.font = 'bold 150px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.save();
      g.translate(W * 0.42, H * 0.03);
      g.scale(-1, 1);
      g.fillText(String(l.number), 0, 0);
      g.restore();
      g.save();
      g.translate(W * 0.42, H * 0.5);
      g.scale(1, -1);
      g.fillText(String(l.number), 0, 0);
      g.restore();
    }
  });
}

function wheelCoverTexture(): THREE.CanvasTexture {
  const N = 512;
  const t = canvasTex(N, N, (g) => {
    g.clearRect(0, 0, N, N);
    g.fillStyle = '#23262b';
    g.beginPath();
    g.arc(N / 2, N / 2, N / 2 - 2, 0, Math.PI * 2);
    g.fill();
    // Schlitze (transparent) zwischen den Speichen
    g.globalCompositeOperation = 'destination-out';
    const slots = 10;
    for (let i = 0; i < slots; i++) {
      const a0 = (i / slots) * Math.PI * 2 + 0.08;
      const a1 = ((i + 1) / slots) * Math.PI * 2 - 0.08;
      g.beginPath();
      g.arc(N / 2, N / 2, N * 0.44, a0, a1);
      g.arc(N / 2, N / 2, N * 0.22, a1, a0, true);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#9aa0a8';
    g.beginPath();
    g.arc(N / 2, N / 2, N * 0.07, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#545961';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(N / 2, N / 2, N * 0.455, 0, Math.PI * 2);
    g.stroke();
  });
  return t;
}

// ---------------------------------------------------------------------------------------------
// Fahrzeug
// ---------------------------------------------------------------------------------------------

interface Arm {
  mesh: THREE.Mesh;
  /** Punkt am Chassis (Karosseriekoordinaten). */
  body: THREE.Vector3;
  /** Punkt am Radträger (Wurzelkoordinaten, relativ zum Rad, wird mit Radposition addiert). */
  hub: THREE.Vector3;
  wheel: number;
}

export class CarModel {
  readonly root = new THREE.Group();
  /** Drehpunkt auf Schwerpunkthöhe: Hub/Wanken/Nicken. */
  private readonly pivot = new THREE.Group();
  private readonly shell = new THREE.Group();
  private readonly wheelGroups: THREE.Group[] = [];
  private readonly wheelSpin: THREE.Group[] = [];
  private readonly wheelSteer: THREE.Group[] = [];
  private readonly discMats: THREE.MeshStandardMaterial[] = [];
  private readonly rearFlap = new THREE.Group();
  private readonly frontFlaps: THREE.Group[] = [];
  private readonly helmet = new THREE.Group();
  private readonly arms: Arm[] = [];
  private readonly spinAngle = new Float64Array(4);
  private readonly cfg: CarConfig;
  private readonly tmp = new THREE.Vector3();
  private readonly mat = new THREE.Matrix4();
  private readonly brakeLight: THREE.MeshBasicMaterial;
  private readonly wheelPos: THREE.Vector3[] = [];
  readonly livery: Livery;

  constructor(cfg: CarConfig, livery: Livery) {
    this.cfg = cfg;
    this.livery = livery;
    this.root.add(this.pivot);
    this.pivot.position.y = cfg.geometry.cgHeight;
    this.pivot.add(this.shell);
    this.shell.position.y = -cfg.geometry.cgHeight;

    const carbon = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.42, metalness: 0.35 });
    const carbonMatte = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.7, metalness: 0.2 });
    const paint = new THREE.MeshPhysicalMaterial({
      map: liveryTexture(livery, 'body'),
      roughness: 0.32,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    });
    const paintPod = new THREE.MeshPhysicalMaterial({
      map: liveryTexture(livery, 'pod'),
      roughness: 0.32,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
    });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.38, metalness: 0.4 });
    const accentMat = new THREE.MeshStandardMaterial({ color: livery.secondary, roughness: 0.35, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0 });

    this.brakeLight = new THREE.MeshBasicMaterial({ color: 0x550000 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.shell) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = false;
      parent.add(m);
      return m;
    };

    // ---- Monocoque / Nase / Motorhaube ----
    add(
      loft([
        { x: 2.8, w: 0.012, yb: 0.215, yt: 0.245, n: 2.2 },
        { x: 2.65, w: 0.055, yb: 0.19, yt: 0.262, n: 2.3 },
        { x: 2.4, w: 0.09, yb: 0.16, yt: 0.285, n: 2.4 },
        { x: 2.1, w: 0.12, yb: 0.135, yt: 0.315, n: 2.5 },
        { x: 1.85, w: 0.15, yb: 0.115, yt: 0.345, n: 2.6 },
        { x: 1.5, w: 0.19, yb: 0.1, yt: 0.41, n: 2.8 },
        { x: 1.1, w: 0.225, yb: 0.09, yt: 0.47, n: 3.0 },
        { x: 0.7, w: 0.24, yb: 0.085, yt: 0.54, n: 3.2 },
        { x: 0.3, w: 0.245, yb: 0.085, yt: 0.56, n: 3.2 },
        { x: -0.1, w: 0.24, yb: 0.085, yt: 0.6, n: 3.0 },
        { x: -0.5, w: 0.21, yb: 0.09, yt: 0.68, n: 2.7 },
        { x: -0.9, w: 0.17, yb: 0.095, yt: 0.62, n: 2.5 },
        { x: -1.4, w: 0.125, yb: 0.1, yt: 0.52, n: 2.4 },
        { x: -1.9, w: 0.085, yb: 0.105, yt: 0.42, n: 2.3 },
        { x: -2.25, w: 0.055, yb: 0.115, yt: 0.345, n: 2.2 },
        { x: -2.38, w: 0.035, yb: 0.13, yt: 0.31, n: 2.2 },
      ]),
      paint,
    );

    // ---- Lufteinlass ----
    add(
      loft([
        { x: -0.02, w: 0.05, yb: 0.6, yt: 0.84, n: 2.4 },
        { x: -0.3, w: 0.078, yb: 0.6, yt: 0.92, n: 2.4 },
        { x: -0.6, w: 0.068, yb: 0.6, yt: 0.84, n: 2.4 },
        { x: -1.0, w: 0.035, yb: 0.56, yt: 0.66, n: 2.2 },
      ]),
      paint,
    );
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), dark);
    intake.rotation.y = Math.PI / 2;
    intake.position.set(-0.012, 0.75, 0);
    this.shell.add(intake);

    // ---- Cockpit-Öffnung + Sitzfläche ----
    const cockpit = new THREE.Mesh(
      topPlate(
        [
          [0.62, 0.0],
          [0.55, 0.14],
          [0.3, 0.19],
          [0.0, 0.2],
          [-0.12, 0.12],
          [-0.12, -0.12],
          [0.0, -0.2],
          [0.3, -0.19],
          [0.55, -0.14],
        ],
        0.004,
      ),
      dark,
    );
    cockpit.position.y = 0.572;
    this.shell.add(cockpit);
    // Cockpit-Rand
    const rim = tube(
      [
        new THREE.Vector3(0.64, 0.56, 0),
        new THREE.Vector3(0.55, 0.575, 0.145),
        new THREE.Vector3(0.3, 0.585, 0.205),
        new THREE.Vector3(0.0, 0.62, 0.21),
        new THREE.Vector3(-0.14, 0.64, 0.12),
        new THREE.Vector3(-0.14, 0.64, -0.12),
        new THREE.Vector3(0.0, 0.62, -0.21),
        new THREE.Vector3(0.3, 0.585, -0.205),
        new THREE.Vector3(0.55, 0.575, -0.145),
        new THREE.Vector3(0.64, 0.56, 0),
      ],
      0.012,
    );
    add(rim, carbonMatte);

    // ---- Fahrer / Helm ----
    {
      const helmetMat = new THREE.MeshPhysicalMaterial({
        color: livery.helmet,
        roughness: 0.25,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
      });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 14), helmetMat);
      head.scale.set(1.12, 1.04, 0.93);
      head.castShadow = true;
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 16, 10, -0.75, 1.5, 1.15, 0.65),
        new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, roughness: 0.05, metalness: 0.6, clearcoat: 1 }),
      );
      visor.rotation.y = -Math.PI / 2;
      visor.scale.set(1.14, 1.06, 0.95);
      this.helmet.add(head, visor);
      this.helmet.position.set(0.18, 0.66, 0);
      this.shell.add(this.helmet);
      const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.34), carbonMatte);
      shoulders.position.set(-0.02, 0.6, 0);
      this.shell.add(shoulders);
    }

    // ---- Halo ----
    {
      const left = tube(
        [
          new THREE.Vector3(-0.1, 0.61, -0.225),
          new THREE.Vector3(0.14, 0.74, -0.235),
          new THREE.Vector3(0.44, 0.745, -0.17),
          new THREE.Vector3(0.66, 0.68, -0.05),
          new THREE.Vector3(0.72, 0.64, 0),
        ],
        0.019,
      );
      const right = tube(
        [
          new THREE.Vector3(-0.1, 0.61, 0.225),
          new THREE.Vector3(0.14, 0.74, 0.235),
          new THREE.Vector3(0.44, 0.745, 0.17),
          new THREE.Vector3(0.66, 0.68, 0.05),
          new THREE.Vector3(0.72, 0.64, 0),
        ],
        0.019,
      );
      add(left, carbon);
      add(right, carbon);
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.11, 10), carbon);
      pylon.position.set(0.72, 0.6, 0);
      pylon.castShadow = true;
      this.shell.add(pylon);
    }

    // ---- Seitenkästen ----
    for (const side of [-1, 1]) {
      const pod = loft([
        { x: 1.05, w: 0.12, yb: 0.1, yt: 0.44, n: 2.6, cz: 0.35 * side },
        { x: 0.7, w: 0.16, yb: 0.085, yt: 0.5, n: 2.6, cz: 0.36 * side },
        { x: 0.2, w: 0.185, yb: 0.075, yt: 0.535, n: 2.6, cz: 0.36 * side },
        { x: -0.3, w: 0.18, yb: 0.07, yt: 0.5, n: 2.6, cz: 0.34 * side },
        { x: -0.8, w: 0.15, yb: 0.07, yt: 0.42, n: 2.5, cz: 0.29 * side },
        { x: -1.3, w: 0.105, yb: 0.075, yt: 0.32, n: 2.4, cz: 0.23 * side },
        { x: -1.75, w: 0.06, yb: 0.085, yt: 0.22, n: 2.3, cz: 0.16 * side },
      ]);
      add(pod, paintPod);
      const inlet = new THREE.Mesh(new THREE.CircleGeometry(1, 24), dark);
      inlet.scale.set(0.15, 0.105, 1);
      inlet.rotation.y = Math.PI / 2;
      inlet.position.set(1.045, 0.27, 0.35 * side);
      this.shell.add(inlet);
      // Kühl-Lamellen am Heck der Seitenkästen
      const louver = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.006, 0.09), carbon);
      louver.position.set(-0.95, 0.43, 0.27 * side);
      louver.rotation.z = 0.15;
      this.shell.add(louver);
      // Rückspiegel
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), carbon);
      stalk.position.set(0.78, 0.535, 0.29 * side);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.14), carbon);
      mirror.position.set(0.78, 0.585, 0.375 * side);
      this.shell.add(stalk, mirror);
      // Bargeboard / Luftleitelemente
      const vane = new THREE.Mesh(sidePlate([[0, 0], [0.5, 0], [0.45, 0.22], [0.05, 0.18]], 0.008), carbon);
      vane.position.set(1.35, 0.1, 0.46 * side);
      this.shell.add(vane);
    }

    // ---- Haifischflosse ----
    {
      const fin = new THREE.Mesh(
        sidePlate(
          [
            [-0.9, 0.6],
            [-1.3, 0.56],
            [-2.0, 0.46],
            [-2.3, 0.38],
            [-2.3, 0.33],
            [-1.4, 0.45],
            [-0.9, 0.58],
          ],
          0.012,
        ),
        paint,
      );
      fin.castShadow = true;
      this.shell.add(fin);
    }

    // ---- Unterboden / Diffusor ----
    {
      const floor = new THREE.Mesh(
        topPlate(
          [
            [2.05, 0.12],
            [1.65, 0.42],
            [0.9, 0.6],
            [0.0, 0.64],
            [-1.0, 0.58],
            [-1.8, 0.46],
            [-2.15, 0.32],
            [-2.2, 0.0],
            [-2.15, -0.32],
            [-1.8, -0.46],
            [-1.0, -0.58],
            [0.0, -0.64],
            [0.9, -0.6],
            [1.65, -0.42],
            [2.05, -0.12],
          ],
          0.014,
        ),
        carbon,
      );
      floor.position.y = 0.04;
      floor.castShadow = true;
      this.shell.add(floor);
      const diff = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.76), carbon);
      diff.position.set(-2.12, 0.085, 0);
      diff.rotation.z = -0.3;
      diff.castShadow = true;
      this.shell.add(diff);
      for (const z of [-0.22, -0.11, 0, 0.11, 0.22]) {
        const strake = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.006), carbonMatte);
        strake.position.set(-2.1, 0.095, z);
        this.shell.add(strake);
      }
      // Bodenkante (Splitter)
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.006, 0.02), accentMat);
      edge.position.set(-0.35, 0.052, 0.63);
      const edge2 = edge.clone();
      edge2.position.z = -0.63;
      this.shell.add(edge, edge2);
    }

    // ---- Frontflügel ----
    {
      const fw = new THREE.Group();
      const span = 1.76;
      const main = new THREE.Mesh(airfoil(0.32, 0.055, 0.03, span), wingMat);
      main.position.set(2.72, 0.085, 0);
      main.rotation.z = 0.03;
      main.castShadow = true;
      fw.add(main);
      // zwei Klappen mit Pivot an der Vorderkante
      const flapSpecs = [
        { x: 2.6, y: 0.135, chord: 0.24, rot: 0.2 },
        { x: 2.49, y: 0.19, chord: 0.2, rot: 0.3 },
      ];
      for (const f of flapSpecs) {
        const grp = new THREE.Group();
        grp.position.set(f.x, f.y, 0);
        grp.rotation.z = f.rot;
        const el = new THREE.Mesh(airfoil(f.chord, 0.05, 0.05, span - 0.06), wingMat);
        el.castShadow = true;
        grp.add(el);
        (grp as any).baseRot = f.rot;
        this.frontFlaps.push(grp);
        fw.add(grp);
      }
      for (const side of [-1, 1]) {
        const ep = new THREE.Mesh(
          sidePlate(
            [
              [2.45, 0.02],
              [3.04, 0.02],
              [3.06, 0.05],
              [2.98, 0.2],
              [2.55, 0.23],
              [2.45, 0.16],
            ],
            0.012,
          ),
          carbon,
        );
        ep.position.z = (span / 2) * side;
        ep.castShadow = true;
        fw.add(ep);
        const eff = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.008, 0.07), accentMat);
        eff.position.set(2.75, 0.305 - 0.25, (span / 2 - 0.04) * side);
        fw.add(eff);
      }
      const pylon = new THREE.Mesh(sidePlate([[0, 0], [0.4, 0], [0.4, 0.06], [0.15, 0.09], [0, 0.08]], 0.03), carbon);
      pylon.position.set(2.38, 0.12, 0);
      fw.add(pylon);
      this.shell.add(fw);
    }

    // ---- Heckflügel ----
    {
      const rw = new THREE.Group();
      const span = 0.96;
      const main = new THREE.Mesh(airfoil(0.3, 0.05, 0.06, span), wingMat);
      main.position.set(-2.4, 0.83, 0);
      main.rotation.z = 0.12;
      main.castShadow = true;
      rw.add(main);
      this.rearFlap.position.set(-2.38, 0.93, 0);
      this.rearFlap.rotation.z = 0.35;
      (this.rearFlap as any).baseRot = 0.35;
      const flapEl = new THREE.Mesh(airfoil(0.22, 0.04, 0.07, span), wingMat);
      flapEl.position.set(-0.0, 0.0, 0);
      flapEl.castShadow = true;
      this.rearFlap.add(flapEl);
      rw.add(this.rearFlap);
      for (const side of [-1, 1]) {
        const ep = new THREE.Mesh(
          sidePlate(
            [
              [-2.45, 0.55],
              [-2.0, 0.6],
              [-2.0, 0.75],
              [-2.12, 1.03],
              [-2.5, 1.06],
              [-2.52, 0.8],
            ],
            0.012,
          ),
          carbon,
        );
        ep.position.z = (span / 2) * side;
        ep.castShadow = true;
        rw.add(ep);
      }
      const beam = new THREE.Mesh(airfoil(0.16, 0.05, 0.05, span - 0.1), wingMat);
      beam.position.set(-2.4, 0.46, 0);
      rw.add(beam);
      const pyl = new THREE.Mesh(sidePlate([[-2.3, 0.32], [-2.12, 0.32], [-2.15, 0.85], [-2.33, 0.85]], 0.03), carbon);
      rw.add(pyl);
      // Bremslicht / Regenlicht
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.12), this.brakeLight);
      light.position.set(-2.4, 0.4, 0);
      rw.add(light);
      const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.16, 14), new THREE.MeshStandardMaterial({ color: 0x6a645c, roughness: 0.4, metalness: 0.9 }));
      exh.rotation.z = Math.PI / 2;
      exh.position.set(-2.33, 0.3, 0);
      rw.add(exh);
      this.shell.add(rw);
    }

    // ---- Räder + Aufhängung ----
    const g = cfg.geometry;
    const lr = g.frontWeight * g.wheelbase;
    const lf = g.wheelbase - lr;
    const xw = [lf, lf, -lr, -lr];
    const zw = [-g.trackFront / 2, g.trackFront / 2, -g.trackRear / 2, g.trackRear / 2]; // Three: links = -z
    const tires = [cfg.tiresFront, cfg.tiresFront, cfg.tiresRear, cfg.tiresRear];
    const cover = wheelCoverTexture();
    const sidewallColor = COMPOUND_COLOR[livery.compound ?? 'medium'];
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.92, metalness: 0 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.35, metalness: 0.85 });
    const coverMat = new THREE.MeshStandardMaterial({
      map: cover,
      alphaTest: 0.5,
      roughness: 0.4,
      metalness: 0.7,
      side: THREE.DoubleSide,
      transparent: false,
    });
    const stripeMat = new THREE.MeshBasicMaterial({ color: sidewallColor, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const t = tires[i];
      const R = t.radius;
      const h = t.width / 2;
      const sgn = zw[i] < 0 ? -1 : 1; // Außenseite
      const wg = new THREE.Group();
      wg.position.set(xw[i], R, zw[i]);
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      wg.add(steer);
      steer.add(spin);
      // Reifenprofil (Lathe um y, dann Achse auf z legen)
      const prof: THREE.Vector2[] = [
        new THREE.Vector2(0.236, -h + 0.004),
        new THREE.Vector2(0.255, -h),
        new THREE.Vector2(R - 0.06, -h * 0.99),
        new THREE.Vector2(R - 0.028, -h * 0.94),
        new THREE.Vector2(R - 0.008, -h * 0.8),
        new THREE.Vector2(R, -h * 0.5),
        new THREE.Vector2(R, 0),
        new THREE.Vector2(R, h * 0.5),
        new THREE.Vector2(R - 0.008, h * 0.8),
        new THREE.Vector2(R - 0.028, h * 0.94),
        new THREE.Vector2(R - 0.06, h * 0.99),
        new THREE.Vector2(0.255, h),
        new THREE.Vector2(0.236, h - 0.004),
      ];
      const tg = new THREE.LatheGeometry(prof, 40);
      tg.rotateX(Math.PI / 2);
      const tire = new THREE.Mesh(tg, tireMat);
      tire.castShadow = true;
      spin.add(tire);
      // Felge (Zylinder) + Abdeckung außen
      const rimG = new THREE.CylinderGeometry(0.238, 0.238, t.width * 0.94, 28, 1, true);
      rimG.rotateX(Math.PI / 2);
      const rim = new THREE.Mesh(rimG, rimMat);
      spin.add(rim);
      const coverG = new THREE.CircleGeometry(0.242, 40);
      const cvr = new THREE.Mesh(coverG, coverMat);
      cvr.position.z = sgn * (h - 0.012);
      if (sgn < 0) cvr.rotation.y = Math.PI;
      spin.add(cvr);
      // farbiger Streifen auf der Reifenflanke (außen)
      const stripe = new THREE.Mesh(new THREE.RingGeometry(0.29, 0.305, 48), stripeMat);
      stripe.position.z = sgn * (h * 0.985);
      if (sgn < 0) stripe.rotation.y = Math.PI;
      spin.add(stripe);
      // Bremsscheibe (glüht) sichtbar durch die Schlitze
      const discMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.8, emissive: 0x000000 });
      this.discMats.push(discMat);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 28).rotateX(Math.PI / 2), discMat);
      disc.position.z = sgn * (h - 0.06);
      spin.add(disc);
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.05), accentMat);
      caliper.position.set(0, 0.11, sgn * (h - 0.1));
      steer.add(caliper);
      this.root.add(wg);
      this.wheelGroups.push(wg);
      this.wheelSpin.push(spin);
      this.wheelSteer.push(steer);
      this.wheelPos.push(wg.position);

      // Lenker (Wishbones + Zugstrebe) als Zylinder zwischen Chassis und Radträger
      const s = zw[i] < 0 ? -1 : 1;
      const isFront = i < 2;
      const inner = s * (Math.abs(zw[i]) - h - 0.03);
      const fore = isFront ? 0.3 : 0.26;
      const aft = isFront ? 0.25 : 0.22;
      const cz = isFront ? 0.13 : 0.13;
      const upY = isFront ? 0.33 : 0.36;
      const loY = 0.11;
      const defs: Array<[THREE.Vector3, THREE.Vector3, number]> = [
        [new THREE.Vector3(xw[i] + fore, upY, s * cz), new THREE.Vector3(0, 0.11, inner - zw[i]), 0.009],
        [new THREE.Vector3(xw[i] - aft, upY - 0.01, s * cz), new THREE.Vector3(0, 0.11, inner - zw[i]), 0.009],
        [new THREE.Vector3(xw[i] + fore, loY, s * (cz + 0.02)), new THREE.Vector3(0, -0.14, inner - zw[i]), 0.011],
        [new THREE.Vector3(xw[i] - aft, loY, s * (cz + 0.02)), new THREE.Vector3(0, -0.14, inner - zw[i]), 0.011],
        [new THREE.Vector3(xw[i] + 0.04, isFront ? 0.36 : 0.44, s * 0.1), new THREE.Vector3(0, 0.12, inner - zw[i]), 0.008],
      ];
      for (const [b, hubOff, rad] of defs) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 1, 6), carbon);
        m.castShadow = true;
        this.root.add(m);
        this.arms.push({ mesh: m, body: b, hub: hubOff, wheel: i });
      }
    }
  }

  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly pa = new THREE.Vector3();
  private readonly pb = new THREE.Vector3();

  /** Aktualisiert Transformationen aus einem (interpolierten) Snapshot. dt = Renderzeit seit letztem Aufruf. */
  update(snap: Float64Array, dt: number): void {
    const cfg = this.cfg;
    // Physik: x,y (Ebene) -> Three (x, 0, -y). Gieren um y.
    this.root.position.set(snap[S.x], 0, -snap[S.y]);
    this.root.rotation.set(0, snap[S.psi], 0);
    this.pivot.position.y = cfg.geometry.cgHeight - snap[S.heave];
    // Nick: positiv = Nase tiefer -> Rotation um z negativ; Wanken positiv = rechts tiefer -> Rotation um x positiv.
    this.pivot.rotation.set(snap[S.roll], 0, -snap[S.pitch], 'YZX');

    // Räder
    for (let i = 0; i < 4; i++) {
      this.spinAngle[i] -= snap[S.omega + i] * dt;
      this.wheelSpin[i].rotation.z = this.spinAngle[i];
      if (i < 2) this.wheelSteer[i].rotation.y = snap[i === 0 ? S.steerL : S.steerR];
      // Bremsscheiben glühen: 400 C beginnt, 1000 C hellorange
      const t = snap[S.brakeTemp + i];
      const k = Math.min(1, Math.max(0, (t - 450) / 650));
      this.discMats[i].emissive.setRGB(k * 1.6, k * k * 0.55, k * k * k * 0.12);
    }

    // Aktive Aero: Klappen öffnen im X-Modus
    const ax = snap[S.aeroX];
    const rb = (this.rearFlap as any).baseRot as number;
    this.rearFlap.rotation.z = rb - ax * 0.55;
    for (const f of this.frontFlaps) f.rotation.z = (f as any).baseRot - ax * 0.12;

    // Bremslicht
    this.brakeLight.color.setRGB(0.25 + snap[S.brake] * 3, 0.02, 0.02);

    // Lenker aktualisieren
    this.root.updateMatrixWorld(true);
    // Transformation Karosserie -> Wurzel: pivot * shell
    this.mat.copy(this.pivot.matrix).multiply(this.shell.matrix);
    for (const a of this.arms) {
      this.pa.copy(a.body).applyMatrix4(this.mat);
      const wp = this.wheelPos[a.wheel];
      this.pb.copy(a.hub).add(wp);
      this.dir.subVectors(this.pb, this.pa);
      const len = this.dir.length();
      a.mesh.position.copy(this.pa).addScaledVector(this.dir, 0.5);
      a.mesh.scale.set(1, len, 1);
      this.quat.setFromUnitVectors(this.up, this.dir.multiplyScalar(1 / (len || 1)));
      a.mesh.quaternion.copy(this.quat);
    }
  }

  /** Helm im Cockpit-View ausblenden. */
  setFirstPerson(on: boolean): void {
    this.helmet.visible = !on;
  }

  /** Weltposition des Fahrerauges (für Cockpitkamera), benötigt vorheriges update(). */
  eyeWorld(target: THREE.Vector3): THREE.Vector3 {
    this.tmp.set(0.2, 0.7, 0);
    this.shell.localToWorld(target.copy(this.tmp));
    return target;
  }
}
