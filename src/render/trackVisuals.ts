import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameMap } from '../world/maps';
import type { Track } from '../world/track';
import { buildWalls, surfaceTexture } from './worldVisuals';

// ---------------------------------------------------------------------------------------------
// Hilfen: Zufall, Rauschen
// ---------------------------------------------------------------------------------------------

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, oct = 4): number {
  let f = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < oct; i++) {
    f += amp * vnoise(x * freq, y * freq, seed + i * 17);
    amp *= 0.5;
    freq *= 2.03;
  }
  return f;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Streifen entlang der Strecke (Asphalt, Kerbs, Kies, Rasen, Linien)
// ---------------------------------------------------------------------------------------------

type LatFn = (i: number) => number;
type UvFn = (i: number, lat: number, edge: 0 | 1) => [number, number];

function ribbon(t: Track, y: number, lat0: LatFn, lat1: LatFn, cond: (i: number) => boolean, uv: UvFn): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const n = t.n;
  let prev = -1;
  let count = 0;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (!cond(k)) {
      prev = -1;
      continue;
    }
    const a = lat0(k);
    const b = lat1(k);
    const nx = t.nx(k);
    const ny = t.ny(k);
    const base = count * 2;
    // physikalisch (x, y) -> Three (x, h, -y)
    pos.push(t.x[k] + nx * a, y, -(t.y[k] + ny * a), t.x[k] + nx * b, y, -(t.y[k] + ny * b));
    const u0 = uv(i, a, 0);
    const u1 = uv(i, b, 1);
    uvs.push(u0[0], u0[1], u1[0], u1[1]);
    if (prev >= 0) idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
    prev = base;
    count++;
  }
  if (count < 2) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Normale nach oben erzwingen
  const nr = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
  return g;
}

function layerMat(map: THREE.Texture | null, layer: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.92,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -layer,
    polygonOffsetUnits: -layer * 2,
    ...extra,
  });
}

// ---------------------------------------------------------------------------------------------
// Texturen
// ---------------------------------------------------------------------------------------------

function kerbTexture(): THREE.CanvasTexture {
  return canvasTex(64, 128, (g) => {
    g.fillStyle = '#c4202a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 64, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, 4, 128);
    g.fillRect(60, 0, 4, 128);
  });
}

function rubberTexture(): THREE.CanvasTexture {
  const t = canvasTex(128, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(10,10,12,0)');
    grad.addColorStop(0.3, 'rgba(10,10,12,0.5)');
    grad.addColorStop(0.7, 'rgba(10,10,12,0.5)');
    grad.addColorStop(1, 'rgba(10,10,12,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    // gröbere Gummikörnung
    for (let i = 0; i < 700; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  });
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

function adTexture(): THREE.CanvasTexture {
  const names = ['APEX', 'VELOCE', 'NOVA', 'TERRA', 'AQUILA', 'STRATOS', 'ORBIT', 'KINETIC'];
  const cols = ['#d9262d', '#1a4fb5', '#f2b600', '#0e8f5a', '#1d1d20', '#ff6a13', '#0a84c6', '#7a2f8f'];
  return canvasTex(1536, 128, (g) => {
    for (let i = 0; i < names.length; i++) {
      g.fillStyle = cols[i];
      g.fillRect(i * 192, 0, 192, 128);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(i * 192, 0, 192, 10);
      g.fillStyle = cols[i] === '#f2b600' ? '#111' : '#fff';
      g.font = '800 54px "Helvetica Neue", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(names[i], i * 192 + 96, 68);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(i * 192 + 6, 112, 180, 3);
    }
  });
}

function seatTexture(): THREE.CanvasTexture {
  return canvasTex(256, 128, (g) => {
    g.fillStyle = '#2a2d33';
    g.fillRect(0, 0, 256, 128);
    const rnd = mulberry(99);
    const cols = ['#d9262d', '#f2f2f2', '#1a4fb5', '#f2b600', '#22a15c', '#ff6a13'];
    for (let y = 0; y < 128; y += 6) {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(0, y + 4, 256, 2);
      for (let x = 0; x < 256; x += 4) {
        if (rnd() < 0.78) {
          g.fillStyle = cols[Math.floor(rnd() * cols.length)];
          g.globalAlpha = 0.85;
          g.fillRect(x, y, 3, 4);
        }
      }
    }
    g.globalAlpha = 1;
  });
}

function facadeTexture(): THREE.CanvasTexture {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = '#d6d9dd';
    g.fillRect(0, 0, 512, 128);
    // Fensterband
    g.fillStyle = '#1b2a38';
    g.fillRect(0, 18, 512, 40);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 0; x < 512; x += 64) g.fillRect(x + 4, 22, 26, 32);
    // Garagentore
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#2d3138' : '#3a3f48';
      g.fillRect(i * 64 + 6, 70, 52, 54);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let y = 74; y < 122; y += 6) g.fillRect(i * 64 + 8, y, 48, 1);
    }
    g.fillStyle = '#c4202a';
    g.fillRect(0, 0, 512, 6);
  });
}

// ---------------------------------------------------------------------------------------------
// Bauwerke entlang der Strecke
// ---------------------------------------------------------------------------------------------

interface Seg {
  /** Querversatz vom Streckenrand und Höhe der Profilpunkte. */
  a: [number, number];
  b: [number, number];
  mat: number;
  /** UV-Skalierung: Meter pro Texturwiederholung (entlang, quer/hoch). */
  uvAlong: number;
  uvAcross: number;
}

/** Extrudiert ein Profil entlang der Strecke (Tribünen, Gebäude). side +1 = links, -1 = rechts. */
function extrudeAlong(t: Track, s0: number, s1: number, side: 1 | -1, startOff: (i: number) => number, segs: Seg[], mats: THREE.Material[]): THREE.Mesh {
  const i0 = Math.round(((s0 + t.length) % t.length) / t.ds);
  const count = Math.round((s1 - s0) / t.ds);
  const geos: THREE.BufferGeometry[] = [];
  for (let m = 0; m < segs.length; m++) {
    const sg = segs[m];
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k <= count; k++) {
      const i = (i0 + k) % t.n;
      const edge = side === 1 ? t.wl[i] : t.wr[i];
      const base = edge + startOff(i);
      const nx = t.nx(i) * side;
      const ny = t.ny(i) * side;
      const s = k * t.ds;
      for (const [o, h] of [sg.a, sg.b]) {
        pos.push(t.x[i] + nx * (base + o), h, -(t.y[i] + ny * (base + o)));
      }
      uv.push(s / sg.uvAlong, sg.a[1] / sg.uvAcross + sg.a[0] / sg.uvAcross, s / sg.uvAlong, sg.b[1] / sg.uvAcross + sg.b[0] / sg.uvAcross);
      if (k > 0) {
        const p = (k - 1) * 2;
        const c = k * 2;
        idx.push(p, p + 1, c, p + 1, c + 1, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.clearGroups();
    g.addGroup(0, idx.length, sg.mat);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, true)!;
  const mesh = new THREE.Mesh(merged, mats);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function addGrandstand(scene: THREE.Scene, t: Track, s0: number, s1: number, side: 1 | -1): void {
  const seats = seatTexture();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide });
  const seatMat = new THREE.MeshStandardMaterial({ map: seats, roughness: 0.85, side: THREE.DoubleSide });
  const conc = new THREE.MeshStandardMaterial({ color: 0xb4b7ba, roughness: 0.95, side: THREE.DoubleSide });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe4e6e8, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  const off = (i: number) => (side === 1 ? t.barrierL[i] : t.barrierR[i]) + 10;
  const stairs: Seg[] = [];
  // Tribünenstufen: 9 Stufen bis 15 m Höhe über 27 m Tiefe
  const steps = 9;
  for (let k = 0; k < steps; k++) {
    const o0 = k * 3;
    const h0 = 1 + k * 1.55;
    stairs.push({ a: [o0, h0], b: [o0 + 3, h0], mat: 0, uvAlong: 6, uvAcross: 6 }); // Sitzfläche
    stairs.push({ a: [o0 + 3, h0], b: [o0 + 3, h0 + 1.55], mat: 1, uvAlong: 6, uvAcross: 6 }); // Stufe
  }
  stairs.push({ a: [0, 0], b: [0, 1], mat: 1, uvAlong: 6, uvAcross: 6 }); // Front
  const mesh = extrudeAlong(t, s0, s1, side, off, stairs, [seatMat, conc]);
  scene.add(mesh);
  // Dach
  const roof = extrudeAlong(t, s0, s1, side, off, [{ a: [2, 17.5], b: [30, 15.5], mat: 0, uvAlong: 10, uvAcross: 10 }, { a: [2, 17.2], b: [30, 15.2], mat: 0, uvAlong: 10, uvAcross: 10 }], [roofMat]);
  scene.add(roof);
  // Stützen
  const count = Math.floor((s1 - s0) / 14);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 16, 6), steel, count * 2);
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const i = (Math.round(s0 / t.ds) + Math.round((k * 14) / t.ds) + t.n) % t.n;
    const edge = side === 1 ? t.wl[i] : t.wr[i];
    const base = edge + off(i);
    for (let r = 0; r < 2; r++) {
      const o = base + (r === 0 ? 3 : 27);
      m4.makeTranslation(t.x[i] + t.nx(i) * side * o, r === 0 ? 8.5 : 7.6, -(t.y[i] + t.ny(i) * side * o));
      posts.setMatrixAt(k * 2 + r, m4);
    }
  }
  scene.add(posts);
}

function addMarshalPosts(scene: THREE.Scene, t: Track): void {
  const spacing = 210;
  const n = Math.floor(t.length / spacing);
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), new THREE.MeshStandardMaterial({ color: 0xd9d9dc, roughness: 0.6 }), n);
  const box = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.3, 1.1), new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.6 }), n);
  const light = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a }), n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3(1, 1, 1);
  for (let k = 0; k < n; k++) {
    const i = Math.round((k * spacing) / t.ds) % t.n;
    const side = k % 2 === 0 ? 1 : -1;
    const o = (side === 1 ? t.wl[i] + t.barrierL[i] : t.wr[i] + t.barrierR[i]) + 2.6;
    const x = t.x[i] + t.nx(i) * side * o;
    const y = t.y[i] + t.ny(i) * side * o;
    e.set(0, t.hdg[i], 0);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, 1.3, -y), q, sc);
    post.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(x, 1.0, -y), q, sc);
    box.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(x, 2.85, -y), q, sc);
    light.setMatrixAt(k, m4);
  }
  scene.add(post, box, light);
}

function addPitBuilding(scene: THREE.Scene, t: Track, s0: number, s1: number, side: 1 | -1): void {
  const facade = facadeTexture();
  const fm = new THREE.MeshStandardMaterial({ map: facade, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  const roof = new THREE.MeshStandardMaterial({ color: 0x9da2a8, roughness: 0.7, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8, side: THREE.DoubleSide });
  const off = (i: number) => (side === 1 ? t.barrierL[i] : t.barrierR[i]) + 20;
  const segs: Seg[] = [
    { a: [0, 0], b: [0, 7], mat: 0, uvAlong: 64, uvAcross: 14 },
    { a: [0, 7], b: [14, 7.6], mat: 1, uvAlong: 20, uvAcross: 20 },
    { a: [14, 7.6], b: [14, 0], mat: 2, uvAlong: 20, uvAcross: 20 },
    // Boxenmauer davor
    { a: [-7, 0], b: [-7, 1.1], mat: 2, uvAlong: 20, uvAcross: 20 },
    { a: [-7, 1.1], b: [-6.4, 1.1], mat: 2, uvAlong: 20, uvAcross: 20 },
  ];
  scene.add(extrudeAlong(t, s0, s1, side, off, segs, [fm, roof, dark]));
  // Kommandostand (höherer Aufbau)
  const tower = extrudeAlong(t, s0 + 70, s0 + 120, side, (i) => off(i) - 2, [{ a: [0, 7], b: [0, 12], mat: 0, uvAlong: 40, uvAcross: 14 }, { a: [0, 12], b: [10, 12], mat: 1, uvAlong: 10, uvAcross: 10 }], [fm, roof]);
  scene.add(tower);
}

function addGantry(scene: THREE.Scene, t: Track): void {
  const i = 0;
  const hw = Math.max(t.wl[i], t.wr[i]) + 1.8;
  const grp = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x5c6167, roughness: 0.5, metalness: 0.6 });
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.5, 0.7), steel);
    pillar.position.set(0, 4.25, side * hw);
    grp.add(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.8, hw * 2 + 0.7), steel);
  beam.position.set(0, 8.4, 0);
  grp.add(beam);
  // Startampeln
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 1.3 });
  for (let k = 0; k < 5; k++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12).rotateZ(Math.PI / 2), lightMat);
    l.position.set(1.22, 8.4, -hw * 0.5 + k * hw * 0.25);
    grp.add(l);
  }
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 1.4, 1.2),
    new THREE.MeshBasicMaterial({
      map: canvasTex(1024, 96, (g) => {
        g.fillStyle = '#0d0f13';
        g.fillRect(0, 0, 1024, 96);
        g.fillStyle = '#ffffff';
        g.font = '800 64px "Helvetica Neue", Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('FORMEL 2026', 512, 52);
      }, false),
    }),
  );
  board.position.set(-1.25, 8.4, 0);
  board.rotation.y = -Math.PI / 2;
  grp.add(board);
  // Physik (x, y) -> Three (x, h, -y); Ausrichtung entlang der Fahrtrichtung
  grp.position.set(t.x[i], 0, -t.y[i]);
  grp.rotation.y = t.hdg[i];
  scene.add(grp);
}

function addAdBoards(scene: THREE.Scene, t: Track): void {
  const tex = adTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let vc = 0;
  for (const side of [1, -1] as const) {
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      const straight = t.sev[i] < 0.16 && t.sev[j] < 0.16;
      if (!straight) continue;
      // Segmente abwechselnd, damit Lücken bleiben
      if (Math.floor(i / 12) % 3 === 2) continue;
      const off = (k: number) => (side === 1 ? t.wl[k] + t.barrierL[k] : t.wr[k] + t.barrierR[k]) - 0.25;
      const a = off(i);
      const b = off(j);
      for (const [k, o] of [[i, a], [j, b]] as const) {
        const nx = t.nx(k) * side;
        const ny = t.ny(k) * side;
        const px = t.x[k] + nx * o;
        const py = t.y[k] + ny * o;
        pos.push(px, 0.3, -py, px, 1.3, -py);
        const u0 = (t.s[k] + (k < i ? t.length : 0)) / 48;
        const u = side === 1 ? u0 : -u0;
        uv.push(u, 0, u, 1);
      }
      idx.push(vc, vc + 1, vc + 2, vc + 1, vc + 3, vc + 2);
      vc += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, mat));
}

// ---------------------------------------------------------------------------------------------
// Natur: Terrain, Wald, Berge
// ---------------------------------------------------------------------------------------------

function buildDistanceGrid(t: Track, x0: number, y0: number, nx: number, ny: number, cell: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(nx * ny).fill(INF);
  for (let i = 0; i < t.n; i++) {
    const cx = Math.floor((t.x[i] - x0) / cell);
    const cy = Math.floor((t.y[i] - y0) / cell);
    if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) d[cy * nx + cx] = 0;
  }
  const dg = cell * 1.4142;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let v = d[y * nx + x];
      if (x > 0) v = Math.min(v, d[y * nx + x - 1] + cell);
      if (y > 0) v = Math.min(v, d[(y - 1) * nx + x] + cell);
      if (x > 0 && y > 0) v = Math.min(v, d[(y - 1) * nx + x - 1] + dg);
      if (x < nx - 1 && y > 0) v = Math.min(v, d[(y - 1) * nx + x + 1] + dg);
      d[y * nx + x] = v;
    }
  }
  for (let y = ny - 1; y >= 0; y--) {
    for (let x = nx - 1; x >= 0; x--) {
      let v = d[y * nx + x];
      if (x < nx - 1) v = Math.min(v, d[y * nx + x + 1] + cell);
      if (y < ny - 1) v = Math.min(v, d[(y + 1) * nx + x] + cell);
      if (x < nx - 1 && y < ny - 1) v = Math.min(v, d[(y + 1) * nx + x + 1] + dg);
      if (x > 0 && y < ny - 1) v = Math.min(v, d[(y + 1) * nx + x - 1] + dg);
      d[y * nx + x] = v;
    }
  }
  return d;
}

export interface TrackVisuals {
  /** Gelände- und Baumhöhe an (x, y) in Physikkoordinaten. */
  heightAt: (x: number, y: number) => number;
  /** Kegel-Aktualisierung (Strecken haben keine). */
  updateCones: (snap: Float64Array) => void;
  center: THREE.Vector3;
  /** Baumdichte 0..1 (für schwächere Geräte). */
  setDetail: (f: number) => void;
}

export function buildTrackVisuals(scene: THREE.Scene, map: GameMap): TrackVisuals {
  const t = map.track!;
  const th = map.theme;
  const seed = th.seed;
  const margin = 1800;
  const cell = 40;
  const x0 = t.minX - margin;
  const y0 = t.minY - margin;
  const W = t.maxX - t.minX + 2 * margin;
  const H = t.maxY - t.minY + 2 * margin;
  const nx = Math.ceil(W / cell) + 1;
  const ny = Math.ceil(H / cell) + 1;
  const dist = buildDistanceGrid(t, x0, y0, nx, ny, cell);
  const distAt = (x: number, y: number): number => {
    const fx = (x - x0) / cell;
    const fy = (y - y0) / cell;
    const ix = Math.min(nx - 2, Math.max(0, Math.floor(fx)));
    const iy = Math.min(ny - 2, Math.max(0, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - ix));
    const ty = Math.min(1, Math.max(0, fy - iy));
    const a = dist[iy * nx + ix];
    const b = dist[iy * nx + ix + 1];
    const c = dist[(iy + 1) * nx + ix];
    const d = dist[(iy + 1) * nx + ix + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const edgeFade = (x: number, y: number): number => {
    const e = Math.min(x - x0, x0 + W - x, y - y0, y0 + H - y);
    return smooth(0, 500, e);
  };
  const heightAt = (x: number, y: number): number => {
    const d = distAt(x, y);
    if (d < 70) return 0;
    const big = fbm(x / 700, y / 700, seed) * 2 - 0.5; // -0.5 .. 1.5
    const rolling = (fbm(x / 160, y / 160, seed + 9) - 0.5) * 2.4;
    const hills = th.hills * Math.max(0, big) * smooth(140, 620, d);
    return (hills + rolling * smooth(70, 220, d)) * edgeFade(x, y);
  };

  // ---- Terrain ----
  {
    const pos = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    const uv = new Float32Array(nx * ny * 2);
    const c = new THREE.Color();
    const base = new THREE.Color(th.grass[0], th.grass[1], th.grass[2]);
    const dark = new THREE.Color(th.foliage[0] * 0.8, th.foliage[1] * 0.8, th.foliage[2] * 0.8);
    const rock = new THREE.Color(0.42, 0.4, 0.36);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = x0 + ix * cell;
        const y = y0 + iy * cell;
        const h = heightAt(x, y);
        const k = iy * nx + ix;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h - 0.02;
        pos[k * 3 + 2] = -y;
        uv[k * 2] = x / 18;
        uv[k * 2 + 1] = y / 18;
        const d = distAt(x, y);
        const forestMask = smooth(0.35, 0.6, fbm(x / 420, y / 420, seed + 3)) * th.forest;
        c.copy(base).lerp(dark, Math.min(1, forestMask * smooth(60, 240, d) * 0.9));
        c.lerp(rock, Math.min(0.5, (h / Math.max(th.hills, 1)) * 0.25 * smooth(0.6, 1, fbm(x / 300, y / 300, seed + 5))));
        const v = 0.85 + 0.3 * fbm(x / 60, y / 60, seed + 7);
        col[k * 3] = c.r * v;
        col[k * 3 + 1] = c.g * v;
        col[k * 3 + 2] = c.b * v;
      }
    }
    const index: number[] = [];
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iy * nx + ix;
        index.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    const tex = surfaceTexture('grass');
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 1, metalness: 0 }));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- Streifen entlang der Strecke ----
  const asphalt = surfaceTexture('asphalt');
  const gravelTex = surfaceTexture('gravel');
  const lawnTex = (() => {
    const base = surfaceTexture('grass');
    const img = base.image as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 512, 512);
    // Mähstreifen quer zur Strecke (Wiederholung entlang v)
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(0,30,0,0.12)';
    g.fillRect(0, 256, 512, 256);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadow = true) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = shadow;
    scene.add(m);
    return m;
  };
  // gepflegter Rasen bis zur Barriere
  const lawnMat = layerMat(lawnTex, 1, { color: 0xb6d19a, roughness: 1 });
  add(ribbon(t, 0.004, (i) => t.wl[i] + t.kerbL[i], (i) => t.wl[i] + t.barrierL[i], () => true, (i, lat) => [lat / 24, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 24]), lawnMat);
  add(ribbon(t, 0.004, (i) => -(t.wr[i] + t.barrierR[i]), (i) => -(t.wr[i] + t.kerbR[i]), () => true, (i, lat) => [lat / 24, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 24]), lawnMat);
  // Kies
  const gravelMat = layerMat(gravelTex, 2, { roughness: 1 });
  add(ribbon(t, 0.008, (i) => t.wl[i] + t.kerbL[i], (i) => t.wl[i] + t.kerbL[i] + t.gravelL[i], (i) => t.gravelL[i] > 1.5, (i, lat) => [lat / 6, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 6]), gravelMat);
  add(ribbon(t, 0.008, (i) => -(t.wr[i] + t.kerbR[i] + t.gravelR[i]), (i) => -(t.wr[i] + t.kerbR[i]), (i) => t.gravelR[i] > 1.5, (i, lat) => [lat / 6, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 6]), gravelMat);
  // Asphalt
  const asphaltMat = layerMat(asphalt, 3, { roughness: 0.88, color: 0xb9b9bd });
  add(ribbon(t, 0.012, (i) => -t.wr[i], (i) => t.wl[i], () => true, (i, lat) => [lat / 8, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 8]), asphaltMat);
  // Reifenspur (Ideallinie: zur Kurveninnenseite verschoben)
  {
    const lineOff = new Float64Array(t.n);
    for (let i = 0; i < t.n; i++) lineOff[i] = Math.sign(t.curv[i]) * t.sev[i] * 0.42 * (t.curv[i] > 0 ? t.wl[i] : t.wr[i]);
    const smoothed = new Float64Array(t.n);
    for (let i = 0; i < t.n; i++) {
      let s = 0;
      for (let k = -6; k <= 6; k++) s += lineOff[(i + k + t.n * 2) % t.n];
      smoothed[i] = s / 13;
    }
    const rub = layerMat(rubberTexture(), 4, { transparent: true, depthWrite: false, roughness: 0.75 });
    add(ribbon(t, 0.014, (i) => smoothed[i % t.n] - 1.9, (i) => smoothed[i % t.n] + 1.9, () => true, (i, _lat, e) => [e, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 6]), rub);
  }
  // Kerbs
  const kerbMat = layerMat(kerbTexture(), 6, { roughness: 0.7 });
  add(ribbon(t, 0.02, (i) => t.wl[i], (i) => t.wl[i] + t.kerbL[i], (i) => t.kerbL[i] > 0.5, (i, _lat, e) => [e, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 1.6]), kerbMat);
  add(ribbon(t, 0.02, (i) => -(t.wr[i] + t.kerbR[i]), (i) => -t.wr[i], (i) => t.kerbR[i] > 0.5, (i, _lat, e) => [1 - e, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 1.6]), kerbMat);
  // Randlinien
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf1f1ee, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 });
  add(ribbon(t, 0.016, (i) => t.wl[i] - 0.45, (i) => t.wl[i] - 0.25, (i) => t.kerbL[i] < 0.5, () => [0, 0]), lineMat, false);
  add(ribbon(t, 0.016, (i) => -t.wr[i] + 0.25, (i) => -t.wr[i] + 0.45, (i) => t.kerbR[i] < 0.5, () => [0, 0]), lineMat, false);
  // Start/Ziel-Linie (Schachbrett) und Aufstellfelder
  {
    const chk = canvasTex(256, 32, (g) => {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }, false);
    const w = t.wl[0] + t.wr[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.2, w), new THREE.MeshBasicMaterial({ map: chk, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -14 }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = t.hdg[0];
    const cx = t.x[0] + t.nx(0) * (t.wl[0] - t.wr[0]) * 0.5;
    const cy = t.y[0] + t.ny(0) * (t.wl[0] - t.wr[0]) * 0.5;
    line.position.set(cx, 0.022, -cy);
    scene.add(line);
  }

  // ---- Wände (Beton, Leitplanken, Reifenwände) ----
  buildWalls(scene, map.world.walls, true);
  addAdBoards(scene, t);

  // ---- Bauwerke an der Start/Ziel-Geraden ----
  addGantry(scene, t);
  addGrandstand(scene, t, -330, -60, -1);
  addGrandstand(scene, t, 40, 260, -1);
  addGrandstand(scene, t, 20, 200, 1);
  addPitBuilding(scene, t, -300, -40, 1);
  // Kurventribünen außen an den engsten Kurven, Streckenposten und Flutlichtmasten
  const stands: Array<{ s0: number; s1: number; side: 1 | -1 }> = [
    { s0: -330, s1: -60, side: -1 },
    { s0: 40, s1: 260, side: -1 },
    { s0: 20, s1: 200, side: 1 },
    { s0: -300, s1: -40, side: 1 },
  ];
  {
    const cand: Array<{ i: number; sev: number }> = [];
    for (let i = 0; i < t.n; i++) if (t.sev[i] > 0.45 && Math.abs(t.curv[i]) > 0.004) cand.push({ i, sev: t.sev[i] });
    cand.sort((a, b) => b.sev - a.sev);
    const used: number[] = [];
    for (const c of cand) {
      const sc = t.s[c.i];
      if (sc < 420 || sc > t.length - 420) continue;
      if (used.some((u) => Math.min(Math.abs(u - sc), t.length - Math.abs(u - sc)) < 550)) continue;
      used.push(sc);
      const side: 1 | -1 = t.curv[c.i] > 0 ? -1 : 1;
      addGrandstand(scene, t, sc - 70, sc + 70, side);
      stands.push({ s0: sc - 70, s1: sc + 70, side });
      if (used.length >= 5) break;
    }
    addMarshalPosts(scene, t);
  }

  // ---- Wald ----
  const treeMeshes: Array<{ im: THREE.InstancedMesh; total: number }> = [];
  {
    const rnd = mulberry(seed * 7919);
    const conBuild = (): THREE.BufferGeometry => {
      const parts: THREE.BufferGeometry[] = [];
      const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.3, 6).translate(0, 0.15, 0);
      const c1 = new THREE.ConeGeometry(0.3, 0.6, 7).translate(0, 0.52, 0);
      const c2 = new THREE.ConeGeometry(0.22, 0.52, 7).translate(0, 0.86, 0);
      const c3 = new THREE.ConeGeometry(0.14, 0.4, 7).translate(0, 1.12, 0);
      const colorize = (g: THREE.BufferGeometry, r: number, gr: number, b: number) => {
        const n = g.getAttribute('position').count;
        const a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) a.set([r, gr, b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        return g;
      };
      parts.push(colorize(trunk, 0.3, 0.2, 0.12), colorize(c1, 0.75, 0.9, 0.75), colorize(c2, 0.85, 1, 0.85), colorize(c3, 0.95, 1, 0.95));
      return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
    };
    const leafBuild = (): THREE.BufferGeometry => {
      const trunk = new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6).translate(0, 0.25, 0);
      const soft = (g: THREE.BufferGeometry, cx: number, cy: number, cz: number) => {
        // kugelförmige Normalen für weiche Beleuchtung der Krone
        const p = g.getAttribute('position');
        const n = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i) - cx;
          const y = p.getY(i) - cy;
          const z = p.getZ(i) - cz;
          const l = Math.hypot(x, y, z) || 1;
          n.set([x / l, y / l, z / l], i * 3);
        }
        g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
        return g;
      };
      const crown = soft(new THREE.IcosahedronGeometry(0.42, 1).scale(1, 0.85, 1).translate(0, 0.78, 0), 0, 0.78, 0);
      const crown2 = soft(new THREE.IcosahedronGeometry(0.3, 0).translate(0.22, 0.6, 0.1), 0.22, 0.6, 0.1);
      const colorize = (g: THREE.BufferGeometry, r: number, gr: number, b: number) => {
        const n = g.getAttribute('position').count;
        const a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) a.set([r, gr, b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
        return g;
      };
      return mergeGeometries([colorize(trunk, 0.32, 0.22, 0.14).toNonIndexed(), colorize(crown, 1, 1, 1).toNonIndexed(), colorize(crown2, 0.9, 1, 0.85).toNonIndexed()])!;
    };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    type Tree = { x: number; y: number; h: number; tint: number; con: boolean };
    const trees: Tree[] = [];
    const gs = 13;
    const maxTrees = 6500;
    const reach = 360;
    const gx0 = Math.floor((t.minX - reach) / gs);
    const gx1 = Math.ceil((t.maxX + reach) / gs);
    const gy0 = Math.floor((t.minY - reach) / gs);
    const gy1 = Math.ceil((t.maxY + reach) / gs);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = (gx + 0.15 + rnd() * 0.7) * gs;
        const y = (gy + 0.15 + rnd() * 0.7) * gs;
        const d = distAt(x, y);
        if (d > reach || d < 10) continue;
        const i = t.nearest(x, y);
        if (i >= 0) {
          const lat = t.lateral(i, x, y);
          const edge = lat >= 0 ? t.wl[i] + t.barrierL[i] : t.wr[i] + t.barrierR[i];
          if (Math.abs(lat) < edge + 4.5) continue;
          const sd = lat >= 0 ? 1 : -1;
          const sv = t.s[i];
          if (Math.abs(lat) < edge + 48 && stands.some((z) => z.side === sd && sv > z.s0 - 12 && sv < z.s1 + 12)) continue;
        } else if (d < 40) continue;
        // Wald in Flecken, Lichtungen, nach außen lichter
        const patch = smooth(0.3, 0.55, fbm(x / 240, y / 240, seed + 1));
        const p = th.forest * (0.15 + 0.85 * patch) * (0.3 + 0.7 * (1 - d / reach));
        if (rnd() > p) continue;
        const con = fbm(x / 500, y / 500, seed + 4) * 1.25 + (rnd() - 0.5) * 0.3 < th.conifer;
        trees.push({ x, y, h: con ? 9 + rnd() * 9 : 7 + rnd() * 7, tint: 0.75 + rnd() * 0.5, con });
      }
    }
    // Ferne Waldschicht: größere, gröbere Bäume bis ~1.1 km für Tiefe im Hintergrund
    const fgs = 34;
    const freach = 1150;
    const fx0 = Math.floor((t.minX - freach) / fgs);
    const fx1 = Math.ceil((t.maxX + freach) / fgs);
    const fy0 = Math.floor((t.minY - freach) / fgs);
    const fy1 = Math.ceil((t.maxY + freach) / fgs);
    const far: Tree[] = [];
    for (let gy = fy0; gy <= fy1; gy++) {
      for (let gx = fx0; gx <= fx1; gx++) {
        const x = (gx + 0.1 + rnd() * 0.8) * fgs;
        const y = (gy + 0.1 + rnd() * 0.8) * fgs;
        const d = distAt(x, y);
        if (d < reach * 0.8 || d > freach) continue;
        const patch = smooth(0.32, 0.55, fbm(x / 300, y / 300, seed + 1));
        if (rnd() > th.forest * (0.2 + 0.8 * patch) * 0.8) continue;
        const con = fbm(x / 500, y / 500, seed + 4) * 1.25 + (rnd() - 0.5) * 0.3 < th.conifer;
        far.push({ x, y, h: (con ? 14 + rnd() * 10 : 11 + rnd() * 9) * 1.15, tint: 0.7 + rnd() * 0.45, con });
      }
    }
    const shuffle = <T,>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    // nah: gleichmäßig ausdünnen, falls zu viele; Reihenfolge mischen, damit sich die Dichte später gleichmäßig reduzieren lässt
    let list = trees;
    if (list.length > maxTrees) {
      const step = list.length / maxTrees;
      list = Array.from({ length: maxTrees }, (_, k) => trees[Math.floor(k * step)]);
    }
    list = shuffle([...list, ...far.slice(0, 3800)]);
    const cons = list.filter((tr) => tr.con);
    const leaf = list.filter((tr) => !tr.con);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();
    const mk = (geo: THREE.BufferGeometry, arr: Tree[], wide: number) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach((tr, k) => {
        e.set(0, rnd() * 6.283, 0);
        q.setFromEuler(e);
        const hgt = heightAt(tr.x, tr.y);
        pos.set(tr.x, hgt - 0.15, -tr.y);
        scl.set(tr.h * wide, tr.h, tr.h * wide);
        m4.compose(pos, q, scl);
        im.setMatrixAt(k, m4);
        col.setRGB(th.foliage[0] * tr.tint * 1.5, th.foliage[1] * tr.tint * 1.5, th.foliage[2] * tr.tint * 1.5);
        im.setColorAt(k, col);
      });
      im.frustumCulled = false;
      scene.add(im);
      treeMeshes.push({ im, total: arr.length });
    };
    mk(conBuild(), cons, 0.55);
    mk(leafBuild(), leaf, 0.75);
  }

  // ---- ferne Berge ----
  const cx = (t.minX + t.maxX) / 2;
  const cy = (t.minY + t.maxY) / 2;
  if (th.mountains > 0) {
    const seg = 220;
    const rings = 7;
    const r0 = Math.hypot(W, H) * 0.5 + 350;
    const r1 = r0 + 3600;
    const pos = new Float32Array((seg + 1) * (rings + 1) * 3);
    const col = new Float32Array((seg + 1) * (rings + 1) * 3);
    const c = new THREE.Color();
    for (let r = 0; r <= rings; r++) {
      const fr = r / rings;
      const rad = r0 + (r1 - r0) * fr;
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const nxp = Math.cos(a);
        const nyp = Math.sin(a);
        // periodisches Rauschen über den Winkel
        const ridge = fbm(nxp * 2.6 + 10, nyp * 2.6 + 10, seed + 21, 5);
        const peaks = Math.pow(Math.max(0, ridge - 0.28) / 0.72, 1.35);
        const h = th.mountains * peaks * smooth(0.0, 0.85, fr) * (0.85 + 0.3 * fbm(nxp * 9, nyp * 9 + fr * 4, seed + 33));
        const k = r * (seg + 1) + s;
        pos[k * 3] = cx + nxp * rad;
        pos[k * 3 + 1] = Math.max(h, 0) + (fr < 0.05 ? -0.5 : 0);
        pos[k * 3 + 2] = -(cy + nyp * rad);
        const hn = th.mountains > 0 ? h / th.mountains : 0;
        c.setRGB(th.foliage[0] * 0.75, th.foliage[1] * 0.85, th.foliage[2] * 0.85);
        c.lerp(new THREE.Color(0.42, 0.45, 0.5), smooth(0.25, 0.6, hn));
        if (th.mountains > 500) c.lerp(new THREE.Color(0.95, 0.96, 0.98), smooth(0.62, 0.8, hn));
        col[k * 3] = c.r;
        col[k * 3 + 1] = c.g;
        col[k * 3 + 2] = c.b;
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < seg; s++) {
        const a = r * (seg + 1) + s;
        index.push(a, a + 1, a + seg + 1, a + 1, a + seg + 2, a + seg + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.frustumCulled = false;
    scene.add(m);
  }

  return {
    heightAt,
    updateCones: () => {},
    center: new THREE.Vector3(cx, 0, -cy),
    setDetail: (f: number) => {
      for (const m of treeMeshes) m.im.count = Math.max(1, Math.ceil(m.total * f));
    },
  };
}
