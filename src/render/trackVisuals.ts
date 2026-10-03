import type { SceneryAssets } from './sceneryAssets';
import * as THREE from 'three';
import { DRIVERS, teamOf } from '../race/field';
import { addTrackProps } from './trackProps';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameMap } from '../world/maps';
import type { Track } from '../world/track';
import { buildWalls, surfaceNormal, surfaceTexture } from './worldVisuals';

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
    pos.push(t.x[k] + nx * a, y + t.elev[k], -(t.y[k] + ny * a), t.x[k] + nx * b, y + t.elev[k], -(t.y[k] + ny * b));
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

/** Gras/Gelände: weltfeste Farbvariation (große Flecken, mittlere Büschel, feines Korn) gegen den Kachel-Look. */
function grassPatch(mat: THREE.MeshStandardMaterial, key: string, strength = 1): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassStr = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPosG;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPosG = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPosG;
uniform float uGrassStr;
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), f.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 q = vWPosG.xz;
  float n1 = gn(q * 0.028);
  float n2 = gn(q * 0.19 + 7.0);
  float n3 = gn(q * 1.9 + 3.0);
  float v = 0.80 + 0.26 * n1 + 0.16 * n2 + 0.10 * n3;
  vec3 tint = mix(vec3(0.96, 1.02, 0.82), vec3(0.74, 0.90, 0.58), n1);
  diffuseColor.rgb *= mix(vec3(1.0), v * tint, uGrassStr);
}`,
      );
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
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
        pos.push(t.x[i] + nx * (base + o), h + t.elev[i], -(t.y[i] + ny * (base + o)));
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

/** Tribüne aus dem Blender-Modul (Stufen, Sitzschalen, Publikum, Dach), entlang der Strecke gereiht. */
function addGrandstandModules(scene: THREE.Scene, t: Track, s0: number, s1: number, side: 1 | -1, sc: SceneryAssets): void {
  const parts = sc.parts('grandstand_module');
  if (!parts.length) return;
  const scale = 1;
  const len = 12;
  const count = Math.max(1, Math.floor((s1 - s0) / len));
  const mats: THREE.Matrix4[] = [];
  const basis = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const sca = new THREE.Vector3(scale, scale, scale);
  const quat = new THREE.Quaternion();
  for (let k = 0; k < count; k++) {
    const sPos = s0 + k * len;
    const i = (Math.round(sPos / t.ds) + t.n) % t.n;
    const j = (Math.round((sPos + len) / t.ds) + t.n) % t.n;
    const off = (side === 1 ? t.barrierL[i] : t.barrierR[i]) + 9;
    const edge = side === 1 ? t.wl[i] : t.wr[i];
    const o = edge + off;
    const ax = t.x[i] + t.nx(i) * side * o;
    const ay = t.y[i] + t.ny(i) * side * o;
    const o2 = (side === 1 ? t.wl[j] + t.barrierL[j] : t.wr[j] + t.barrierR[j]) + 9;
    const bx = t.x[j] + t.nx(j) * side * o2;
    const by = t.y[j] + t.ny(j) * side * o2;
    // lokale x-Achse entlang der Strecke, lokale +z-Achse zur Strecke hin (Blick der Zuschauer)
    const tx = bx - ax;
    const tz = -(by - ay);
    const l = Math.hypot(tx, tz) || 1;
    let xv = new THREE.Vector3(tx / l, 0, tz / l);
    const toTrack = new THREE.Vector3(-side * t.nx(i), 0, side * t.ny(i));
    let zv = new THREE.Vector3(-xv.z, 0, xv.x);
    if (zv.dot(toTrack) < 0) {
      xv = xv.negate();
      zv = new THREE.Vector3(-xv.z, 0, xv.x);
    }
    basis.makeBasis(xv, new THREE.Vector3(0, 1, 0), zv);
    quat.setFromRotationMatrix(basis);
    // Modul-Ursprung ist die vordere linke Ecke: bei umgedrehter x-Achse beginnt es am Segmentende
    const flipped = tx * xv.x + tz * xv.z < 0;
    pos.set(flipped ? bx : ax, t.elev[i] - 0.1, -(flipped ? by : ay));
    mats.push(new THREE.Matrix4().compose(pos, quat, sca));
  }
  for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geo, part.mat, mats.length);
    mats.forEach((m, k) => im.setMatrixAt(k, m));
    im.computeBoundingSphere();
    scene.add(im);
  }
}

function addGrandstand(scene: THREE.Scene, t: Track, s0: number, s1: number, side: 1 | -1, sc: SceneryAssets | null = null): void {
  if (sc && sc.parts('grandstand_module').length) {
    addGrandstandModules(scene, t, s0, s1, side, sc);
    return;
  }
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
      m4.makeTranslation(t.x[i] + t.nx(i) * side * o, (r === 0 ? 8.5 : 7.6) + t.elev[i], -(t.y[i] + t.ny(i) * side * o));
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
    const eh = t.elev[i];
    m4.compose(new THREE.Vector3(x, 1.3 + eh, -y), q, sc);
    post.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(x, 1.0 + eh, -y), q, sc);
    box.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(x, 2.85 + eh, -y), q, sc);
    light.setMatrixAt(k, m4);
  }
  scene.add(post, box, light);
}

function addPitMarkings(scene: THREE.Scene, t: Track): void {
  // Boxenmarkierungen (Felder, Teamfarben), Geschwindigkeitsschild und Fahrspurlinien
  const slot = canvasTex(256, 96, (g) => {
    g.clearRect(0, 0, 256, 96);
    g.strokeStyle = '#f2f2f2';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 244, 84);
  }, false);
  const planeGeo = new THREE.PlaneGeometry(10.2, 3.4);
  const boxes = t.pit.boxes;
  const order = DRIVERS.map((d) => teamOf(d));
  const colors = new THREE.InstancedMesh(new THREE.PlaneGeometry(9.4, 2.7), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }), boxes.length);
  const lines = new THREE.InstancedMesh(planeGeo, new THREE.MeshBasicMaterial({ map: slot, transparent: true, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }), boxes.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  boxes.forEach((b, k) => {
    e.set(-Math.PI / 2, 0, b.psi, 'YXZ');
    q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.psi);
    q.premultiply(qy);
    m4.compose(new THREE.Vector3(b.x, 0.03 + t.elev[b.idx], -b.y), q, new THREE.Vector3(1, 1, 1));
    lines.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(b.x, 0.028 + t.elev[b.idx], -b.y), q, new THREE.Vector3(1, 1, 1));
    colors.setMatrixAt(k, m4);
    const tm = order[Math.min(k, order.length - 1)];
    colors.setColorAt(k, c.set(tm.colors.primary));
  });
  scene.add(colors, lines);
  // durchgezogene Linien der schnellen Spur
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf1f1ee, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 });
  const inZone = (i: number) => {
    const r = t.s[i % t.n] > t.length / 2 ? t.s[i % t.n] - t.length : t.s[i % t.n];
    return r > t.pitZone.full0 && r < t.pitZone.full1;
  };
  const geo = ribbon(t, 0.018, (i) => t.wl[i] + 8.1, (i) => t.wl[i] + 8.3, (i) => inZone(i), () => [0, 0]);
  if (geo) scene.add(new THREE.Mesh(geo, lineMat));
  const geo2 = ribbon(t, 0.018, (i) => t.wl[i] + 1.9, (i) => t.wl[i] + 2.1, (i) => inZone(i), () => [0, 0]);
  if (geo2) scene.add(new THREE.Mesh(geo2, lineMat));
  // Schild "80" am Beginn der Boxengasse
  const sign = canvasTex(128, 128, (g) => {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d10000';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(64, 64, 54, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#111';
    g.font = '800 58px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('80', 64, 68);
  }, false);
  for (const rs of [t.pitZone.full0 - 5, t.pitZone.full1 - 10]) {
    const i = (Math.round(((rs + t.length) % t.length) / t.ds) + t.n) % t.n;
    const lat = t.wl[i] + 2.6;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x888c92 }));
    post.position.set(t.x[i] + t.nx(i) * lat, 1.3 + t.elev[i], -(t.y[i] + t.ny(i) * lat));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshBasicMaterial({ map: sign, side: THREE.DoubleSide }));
    face.position.set(post.position.x, 2.7 + t.elev[i], post.position.z);
    face.rotation.y = t.hdg[i] - Math.PI / 2 + (rs > 0 ? Math.PI : 0) + Math.PI;
    scene.add(post, face);
  }
}

function addPitBuilding(scene: THREE.Scene, t: Track, s0: number, s1: number, side: 1 | -1): void {
  const facade = facadeTexture();
  const fm = new THREE.MeshStandardMaterial({ map: facade, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  const roof = new THREE.MeshStandardMaterial({ color: 0x9da2a8, roughness: 0.7, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8, side: THREE.DoubleSide });
  // Garagenreihe direkt hinter der Boxengasse (Mauer bei barrierL)
  const off = (i: number) => (side === 1 ? t.barrierL[i] : t.barrierR[i]) + 0.4;
  const segs: Seg[] = [
    { a: [0, 0], b: [0, 6.5], mat: 0, uvAlong: 64, uvAcross: 14 },
    { a: [0, 6.5], b: [15, 7.2], mat: 1, uvAlong: 20, uvAcross: 20 },
    { a: [15, 7.2], b: [15, 0], mat: 2, uvAlong: 20, uvAcross: 20 },
  ];
  scene.add(extrudeAlong(t, s0, s1, side, off, segs, [fm, roof, dark]));
  // Kommandostand (höherer Aufbau) und Überbau über der Boxenmauer
  const tower = extrudeAlong(t, s0 + 130, s0 + 185, side, (i) => off(i) - 1, [{ a: [0, 6.5], b: [0, 12.5], mat: 0, uvAlong: 40, uvAcross: 14 }, { a: [0, 12.5], b: [11, 12.5], mat: 1, uvAlong: 10, uvAcross: 10 }], [fm, roof]);
  scene.add(tower);
  // Garagentore und Team-Schilder: je Box ein dunkles Tor mit farbigem Band
  const n = t.pit.boxes.length;
  const doors = new THREE.InstancedMesh(new THREE.PlaneGeometry(8.6, 4.2), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.9 }), n);
  const bands = new THREE.InstancedMesh(new THREE.PlaneGeometry(8.6, 1.1), new THREE.MeshBasicMaterial({}), n);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const q = new THREE.Quaternion();
  t.pit.boxes.forEach((b, k) => {
    const i = b.idx;
    const o = off(i) - 0.05;
    const x = t.x[i] + t.nx(i) * side * o;
    const y = t.y[i] + t.ny(i) * side * o;
    // Fläche zeigt zur Strecke (Normale −Querrichtung)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.hdg[i] + (side === 1 ? Math.PI / 2 : -Math.PI / 2));
    m4.compose(new THREE.Vector3(x, 2.2 + t.elev[i], -y), q, new THREE.Vector3(1, 1, 1));
    doors.setMatrixAt(k, m4);
    m4.compose(new THREE.Vector3(x, 4.8 + t.elev[i], -y), q, new THREE.Vector3(1, 1, 1));
    bands.setMatrixAt(k, m4);
    bands.setColorAt(k, col.set(teamOf(DRIVERS[Math.min(k, DRIVERS.length - 1)]).colors.primary));
  });
  scene.add(doors, bands);
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
  grp.position.set(t.x[i], t.elev[i], -t.y[i]);
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
        pos.push(px, 0.3 + t.elev[k], -py, px, 1.3 + t.elev[k], -py);
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

function buildDistanceGrid(t: Track, x0: number, y0: number, nx: number, ny: number, cell: number): { d: Float32Array; h: Float32Array } {
  const INF = 1e9;
  const d = new Float32Array(nx * ny).fill(INF);
  const h = new Float32Array(nx * ny);
  for (let i = 0; i < t.n; i++) {
    const cx = Math.floor((t.x[i] - x0) / cell);
    const cy = Math.floor((t.y[i] - y0) / cell);
    if (cx >= 0 && cy >= 0 && cx < nx && cy < ny) {
      d[cy * nx + cx] = 0;
      h[cy * nx + cx] = t.elev[i];
    }
  }
  const dg = cell * 1.4142;
  const relax = (k: number, from: number, add: number) => {
    const v = d[from] + add;
    if (v < d[k]) {
      d[k] = v;
      h[k] = h[from];
    }
  };
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const k = y * nx + x;
      if (x > 0) relax(k, k - 1, cell);
      if (y > 0) relax(k, k - nx, cell);
      if (x > 0 && y > 0) relax(k, k - nx - 1, dg);
      if (x < nx - 1 && y > 0) relax(k, k - nx + 1, dg);
    }
  }
  for (let y = ny - 1; y >= 0; y--) {
    for (let x = nx - 1; x >= 0; x--) {
      const k = y * nx + x;
      if (x < nx - 1) relax(k, k + 1, cell);
      if (y < ny - 1) relax(k, k + nx, cell);
      if (x < nx - 1 && y < ny - 1) relax(k, k + nx + 1, dg);
      if (x > 0 && y < ny - 1) relax(k, k + nx - 1, dg);
    }
  }
  return { d, h };
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

export function buildTrackVisuals(scene: THREE.Scene, map: GameMap, scenery: SceneryAssets | null = null): TrackVisuals {
  const t = map.track!;
  const th = map.theme;
  const seed = th.seed;
  const margin = 1800;
  const cell = 28;
  const x0 = t.minX - margin;
  const y0 = t.minY - margin;
  const W = t.maxX - t.minX + 2 * margin;
  const H = t.maxY - t.minY + 2 * margin;
  const nx = Math.ceil(W / cell) + 1;
  const ny = Math.ceil(H / cell) + 1;
  const grids = buildDistanceGrid(t, x0, y0, nx, ny, cell);
  const dist = grids.d;
  const trackH = grids.h;
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
  const trackHAt = (x: number, y: number): number => {
    const fx = (x - x0) / cell;
    const fy = (y - y0) / cell;
    const ix = Math.min(nx - 2, Math.max(0, Math.floor(fx)));
    const iy = Math.min(ny - 2, Math.max(0, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - ix));
    const ty = Math.min(1, Math.max(0, fy - iy));
    const a = trackH[iy * nx + ix];
    const b = trackH[iy * nx + ix + 1];
    const c = trackH[(iy + 1) * nx + ix];
    const d = trackH[(iy + 1) * nx + ix + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  // Relief: Amplitude je nach Streckenthema (Spa hügelig, Silverstone/Monza flacher, aber nie ein Brett)
  const amp = Math.max(14, th.hills * 0.5);
  const heightAt = (x: number, y: number): number => {
    const d = distAt(x, y);
    const big = fbm(x / 700, y / 700, seed) * 2 - 0.5; // -0.5 .. 1.5
    const rolling =
      (fbm(x / 240, y / 240, seed + 9) - 0.5) * 2 * amp * 0.55 +
      (fbm(x / 110, y / 110, seed + 15) - 0.5) * 2 * amp * 0.2;
    const hills = Math.max(th.hills, 34) * Math.max(0, big) * smooth(140, 620, d);
    const swell = Math.max(th.hills, 34) * 0.5 * smooth(90, 420, d) * (0.15 + 0.85 * fbm(x / 420, y / 420, seed + 23));
    let natural = (hills + swell + rolling * smooth(28, 140, d)) * edgeFade(x, y);
    // Erdwälle hinter den Auslaufzonen (unregelmäßig), danach leichter Graben
    const berm = (0.5 + 0.9 * fbm(x / 75, y / 75, seed + 19)) * 1.7;
    natural += berm * smooth(14, 26, d) * (1 - smooth(34, 70, d)) * edgeFade(x, y);
    // nahe der Strecke folgt das Gelände der Streckenhöhe, weiter weg geht es in die natürlichen Hügel über
    const w = 1 - smooth(25, 170, d);
    const th0 = d < 90 ? t.heightAt(x, y) : trackHAt(x, y);
    return natural + (th0 - natural) * w - 0.3 * (1 - smooth(8, 40, d));
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
    const straw = new THREE.Color(0.58, 0.52, 0.28);
    const soil = new THREE.Color(0.4, 0.31, 0.2);
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
        // Flecken aus getrocknetem Gras (Stroh) und blanker Erde
        const strawM = smooth(0.52, 0.68, fbm(x / 170, y / 170, seed + 11)) * smooth(30, 90, d);
        c.lerp(straw, Math.min(0.55, strawM * 0.6));
        c.lerp(soil, smooth(0.62, 0.74, fbm(x / 90, y / 90, seed + 13)) * 0.4 * smooth(25, 80, d));
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
    const mesh = new THREE.Mesh(g, grassPatch(new THREE.MeshStandardMaterial({ map: tex, normalMap: surfaceNormal('grass'), normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true, roughness: 1, metalness: 0 }), 'grass-terrain-n', 0.9));
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---- Streifen entlang der Strecke ----
  const asphalt = surfaceTexture('asphalt');
  const gravelTex = surfaceTexture('gravel');
  const lawnTex = surfaceTexture('grass');
  const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, shadow = true) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = shadow;
    scene.add(m);
    return m;
  };
  // gepflegter Rasen bis zur Barriere
  const lawnMat = grassPatch(layerMat(lawnTex, 1, { color: 0xc4dba6, roughness: 1, normalMap: surfaceNormal('grass') }), 'grass-lawn-n', 0.6);
  add(ribbon(t, 0.004, (i) => t.wl[i] + t.pitW[i] + t.kerbL[i], (i) => t.wl[i] + t.barrierL[i], () => true, (i, lat) => [lat / 24, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 24]), lawnMat);
  add(ribbon(t, 0.004, (i) => -(t.wr[i] + t.barrierR[i]), (i) => -(t.wr[i] + t.kerbR[i]), () => true, (i, lat) => [lat / 24, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 24]), lawnMat);
  // Erdstreifen zwischen Asphalt/Kerb und Zaun (wie in der Vorlage): wechselnde Breite, weiche Ränder
  {
    const dtex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#85673f';
      g.fillRect(0, 0, 256, 256);
      const rr = mulberry(55);
      for (let k = 0; k < 2600; k++) {
        const v = 80 + rr() * 80;
        g.fillStyle = `rgba(${v + 36},${v},${v - 34},${0.2 + rr() * 0.3})`;
        g.fillRect(rr() * 256, rr() * 256, 2 + rr() * 5, 2 + rr() * 3);
      }
      const grad = g.createLinearGradient(0, 0, 256, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.18, 'rgba(0,0,0,1)');
      grad.addColorStop(0.7, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    });
    dtex.wrapS = THREE.ClampToEdgeWrapping;
    const dirtMat = layerMat(dtex, 2, { transparent: true, depthWrite: false, roughness: 1 });
    const wide = (i: number, k: number) => 1.6 + 2.6 * (0.5 + 0.5 * Math.sin(t.s[i % t.n] / (23 + k * 9) + k)) + 1.2 * (0.5 + 0.5 * Math.sin(t.s[i % t.n] / 7.3 + k * 2));
    add(ribbon(t, 0.006, (i) => t.wl[i] + t.pitW[i] + t.kerbL[i] - 0.2, (i) => t.wl[i] + t.pitW[i] + t.kerbL[i] + wide(i, 1), (i) => t.gravelL[i] < 1.5, (i, _lat, e) => [e, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 9]), dirtMat);
    add(ribbon(t, 0.006, (i) => -(t.wr[i] + t.kerbR[i] + wide(i, 2)), (i) => -(t.wr[i] + t.kerbR[i]) + 0.2, (i) => t.gravelR[i] < 1.5, (i, _lat, e) => [1 - e, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 9]), dirtMat);
  }
  // Kies
  const gravelMat = layerMat(gravelTex, 2, { roughness: 1, normalMap: surfaceNormal('gravel'), normalScale: new THREE.Vector2(1.2, 1.2) });
  add(ribbon(t, 0.008, (i) => t.wl[i] + t.kerbL[i], (i) => t.wl[i] + t.kerbL[i] + t.gravelL[i], (i) => t.gravelL[i] > 1.5, (i, lat) => [lat / 6, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 6]), gravelMat);
  add(ribbon(t, 0.008, (i) => -(t.wr[i] + t.kerbR[i] + t.gravelR[i]), (i) => -(t.wr[i] + t.kerbR[i]), (i) => t.gravelR[i] > 1.5, (i, lat) => [lat / 6, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 6]), gravelMat);
  // Asphalt
  const asphaltMat = layerMat(asphalt, 3, { roughness: 0.88, color: 0xe4e6ee, normalMap: surfaceNormal('asphalt'), normalScale: new THREE.Vector2(0.7, 0.7) });
  add(ribbon(t, 0.012, (i) => -t.wr[i], (i) => t.wl[i] + t.pitW[i], () => true, (i, lat) => [lat / 8, (t.s[i % t.n] + (i >= t.n ? t.length : 0)) / 8]), asphaltMat);
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
    line.position.set(cx, 0.022 + t.elev[0], -cy);
    scene.add(line);
  }

  addPitMarkings(scene, t);
  addTrackProps(scene, t);

  // ---- Wände (Beton, Leitplanken, Reifenwände) ----
  buildWalls(scene, map.world.walls, true, (x, y) => t.heightAt(x, y));
  addAdBoards(scene, t);

  // ---- Bauwerke an der Start/Ziel-Geraden ----
  addGantry(scene, t);
  addGrandstand(scene, t, -330, -60, -1, scenery);
  addGrandstand(scene, t, 40, 260, -1, scenery);
  const pitS0 = t.pitZone.box0 - 12;
  const pitS1 = t.pitZone.box0 + 22 * 11 + 4;
  const leftS0 = Math.max(20, pitS1 + 25);
  addGrandstand(scene, t, leftS0, leftS0 + 180, 1, scenery);
  addPitBuilding(scene, t, pitS0, pitS1, 1);
  // Kurventribünen außen an den engsten Kurven, Streckenposten und Flutlichtmasten
  const stands: Array<{ s0: number; s1: number; side: 1 | -1 }> = [
    { s0: -330, s1: -60, side: -1 },
    { s0: 40, s1: 260, side: -1 },
    { s0: leftS0, s1: leftS0 + 180, side: 1 },
    { s0: pitS0, s1: pitS1, side: 1 },
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
      addGrandstand(scene, t, sc - 70, sc + 70, side, scenery);
      stands.push({ s0: sc - 70, s1: sc + 70, side });
      if (used.length >= 5) break;
    }
    addMarshalPosts(scene, t);
  }

  // ---- Wald ----
  const treeMeshes: Array<{ im: THREE.InstancedMesh; total: number }> = [];
  {
    const rnd = mulberry(seed * 7919);
    // Bäume aus Blattkarten (Alpha-Test) mit prozeduraler Laub-/Nadeltextur: dichte, detaillierte Kronen bei wenig Dreiecken
    const leafTex = (needle: boolean): THREE.CanvasTexture => {
      const r2 = mulberry(needle ? 71 : 37);
      const c = canvasTex(256, 256, (g) => {
        g.clearRect(0, 0, 256, 256);
        const cols = needle ? ['#2f6a40', '#3a7d4b', '#285a37', '#4a8c58', '#336f43'] : ['#46803a', '#559a45', '#3d7133', '#6aa854', '#2f5f2a', '#4c8b3d'];
        const lobes = Array.from({ length: 7 }, () => 0.62 + r2() * 0.45);
        for (let k = 0; k < (needle ? 1100 : 900); k++) {
          // Blattpositionen in einer unregelmäßigen Blob-Silhouette (Lappen), nach außen dünner
          const ang = r2() * 6.283;
          const lobe = lobes[Math.floor((ang / 6.283) * lobes.length) % lobes.length];
          const rad = Math.sqrt(r2()) * 118 * lobe;
          const x = 128 + Math.cos(ang) * rad;
          const y = 128 + Math.sin(ang) * rad * (needle ? 1.0 : 0.9);
          g.save();
          g.translate(x, y);
          g.rotate(needle ? (r2() - 0.5) * 1.6 - Math.PI / 2 + (x < 128 ? 0.5 : -0.5) : r2() * 6.283);
          g.fillStyle = cols[Math.floor(r2() * cols.length)];
          g.beginPath();
          if (needle) g.ellipse(0, 0, 12 + r2() * 11, 2.2 + r2() * 1.8, 0, 0, 6.283);
          else g.ellipse(0, 0, 8 + r2() * 10, 4.5 + r2() * 4.5, 0, 0, 6.283);
          g.fill();
          g.restore();
        }
      });
      c.wrapS = c.wrapT = THREE.ClampToEdgeWrapping;
      return c;
    };
    const quad = (w: number, h: number, cx: number, cy: number, cz: number, rotY: number, tiltX: number, shadeLo: number, shadeHi: number, centerN: [number, number, number] | null): THREE.BufferGeometry => {
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateX(tiltX);
      g.rotateY(rotY);
      g.translate(cx, cy, cz);
      const pp = g.getAttribute('position');
      const n = pp.count;
      const cl = new Float32Array(n * 3);
      const nn = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const k = shadeLo + (shadeHi - shadeLo) * Math.min(1, Math.max(0, (pp.getY(i) - (cy - h / 2)) / h));
        cl.set([k, k, k], i * 3);
        if (centerN) {
          const dx = pp.getX(i) - centerN[0];
          const dy = pp.getY(i) - centerN[1];
          const dz = pp.getZ(i) - centerN[2];
          const l = Math.hypot(dx, dy, dz) || 1;
          nn.set([dx / l, dy / l, dz / l], i * 3);
        } else nn.set([0, 1, 0], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
      return g;
    };
    const trunkGeo = (h: number, r0: number, r1: number): THREE.BufferGeometry => {
      const g = new THREE.CylinderGeometry(r1, r0, h, 6).translate(0, h / 2, 0).toNonIndexed();
      const n = g.getAttribute('position').count;
      const cl = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) cl.set([0.3, 0.2, 0.12], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const withUv = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      return g;
    };
    const leafBuild = (): THREE.BufferGeometry => {
      const parts: THREE.BufferGeometry[] = [withUv(trunkGeo(0.78, 0.075, 0.04))];
      const cn: [number, number, number] = [0, 0.98, 0];
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + (k % 2) * 0.3;
        parts.push(quad(0.95, 0.85, Math.cos(a) * 0.1, 1.0, Math.sin(a) * 0.1, a, -0.28, 0.8, 1.25, cn).toNonIndexed());
      }
      for (let k = 0; k < 3; k++) parts.push(quad(0.85, 0.85, 0, 0.78 + k * 0.2, 0, k * 1.1, -Math.PI / 2 + 0.05, 0.9, 1.25, cn).toNonIndexed());
      return mergeGeometries(parts.map((g) => withUv(g)))!;
    };
    const conBuild = (): THREE.BufferGeometry => {
      const parts: THREE.BufferGeometry[] = [withUv(trunkGeo(0.4, 0.05, 0.035))];
      const tiers: Array<[number, number, number]> = [
        [0.3, 0.4, 0.36],
        [0.5, 0.33, 0.3],
        [0.72, 0.26, 0.24],
        [0.94, 0.18, 0.2],
        [1.12, 0.1, 0.14],
      ];
      for (const [y, r, h] of tiers) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + y;
          parts.push(quad(r * 1.35, h * 1.7, Math.cos(a) * r * 0.45, y + h * 0.3, Math.sin(a) * r * 0.45, -a + Math.PI / 2, -0.55, 0.78, 1.25, null).toNonIndexed());
        }
      }
      return mergeGeometries(parts.map((g) => withUv(g)))!;
    };
    const lt = leafTex(false);
    const nt = leafTex(true);
    // Eigenleuchten (Emission aus der Textur) hellt die Eigenverschattung der Kugelnormalen auf
    const leafMat = new THREE.MeshLambertMaterial({ map: lt, emissiveMap: lt, emissive: 0xffffff, emissiveIntensity: 0.38, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    const needleMat = new THREE.MeshLambertMaterial({ map: nt, emissiveMap: nt, emissive: 0xffffff, emissiveIntensity: 0.38, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    type Tree = { x: number; y: number; h: number; tint: number; con: boolean; d?: number };
    const trees: Tree[] = [];
    const hi: Tree[] = [];
    const gs = 13;
    const maxTrees = scenery ? 3600 : 6500;
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
        const tr: Tree = { x, y, h: con ? 9 + rnd() * 9 : 7 + rnd() * 7, tint: 0.75 + rnd() * 0.5, con, d };
        if (scenery && d < 110) hi.push(tr);
        else trees.push(tr);
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
        far.push({ x, y, h: (con ? 14 + rnd() * 10 : 11 + rnd() * 9) * 1.15, tint: 0.7 + rnd() * 0.45, con, d });
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
      // die streckennächsten behalten (dichter Wald am Rand), Ferne übernimmt die grobe Schicht
      list = [...trees].sort((a, b) => (a.d ?? 0) - (b.d ?? 0)).slice(0, maxTrees);
    }
    list = shuffle([...list, ...far.slice(0, scenery ? 1900 : 3800)]);
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
      const im = new THREE.InstancedMesh(geo, geo === coneGeo ? needleMat : leafMat, arr.length);
      arr.forEach((tr, k) => {
        e.set(0, rnd() * 6.283, 0);
        q.setFromEuler(e);
        const hgt = heightAt(tr.x, tr.y);
        pos.set(tr.x, hgt - 0.15, -tr.y);
        scl.set(tr.h * wide, tr.h, tr.h * wide);
        m4.compose(pos, q, scl);
        im.setMatrixAt(k, m4);
        {
          const fm = Math.max(th.foliage[0], th.foliage[1], th.foliage[2]);
          col.setRGB((0.55 + 0.45 * (th.foliage[0] / fm)) * tr.tint * 1.12, (0.55 + 0.45 * (th.foliage[1] / fm)) * tr.tint * 1.12, (0.55 + 0.45 * (th.foliage[2] / fm)) * tr.tint * 1.12);
        }
        im.setColorAt(k, col);
      });
      im.frustumCulled = false;
      scene.add(im);
      treeMeshes.push({ im, total: arr.length });
    };
    const coneGeo = conBuild();
    if (!scenery) {
      mk(coneGeo, cons, 0.55);
      mk(leafBuild(), leaf, 0.75);
    }

    // ---- Blender-Objekte nahe der Strecke: detaillierte Bäume, Büsche, Grasbüschel (Stroh und Grün gemischt) ----
    if (scenery) {
      const fm = Math.max(th.foliage[0], th.foliage[1], th.foliage[2]);
      const tintCol = (k: number, boost: number) =>
        col.setRGB((0.6 + 0.4 * (th.foliage[0] / fm)) * k * boost, (0.6 + 0.4 * (th.foliage[1] / fm)) * k * boost, (0.6 + 0.4 * (th.foliage[2] / fm)) * k * boost);
      const isFoliage = (m: THREE.Material) => /Leaf|Needle|Bush/i.test(m.name);
      const place = (name: string, items: Array<{ x: number; y: number; h: number; tint: number }>, boost: number, add: (im: THREE.InstancedMesh, n: number) => void) => {
        if (!items.length) return;
        const hh = scenery.height(name);
        for (const part of scenery.parts(name)) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, items.length);
          const leafy = isFoliage(part.mat);
          items.forEach((it, k) => {
            e.set(0, rnd() * 6.283, 0);
            q.setFromEuler(e);
            const sc1 = it.h / hh;
            pos.set(it.x, heightAt(it.x, it.y) - 0.1, -it.y);
            scl.set(sc1, sc1, sc1);
            m4.compose(pos, q, scl);
            im.setMatrixAt(k, m4);
            if (leafy) im.setColorAt(k, tintCol(it.tint, boost));
          });
          add(im, items.length);
        }
      };
      // Bäume
      const maxHi = 320;
      let hl = hi;
      let overflow: Tree[] = [];
      if (hl.length > maxHi) {
        // die streckennächsten Bäume voll detailliert, der Rest als LOD-Baum
        const sorted = [...hi].sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
        hl = sorted.slice(0, maxHi);
        overflow = sorted.slice(maxHi);
      }
      const buckets = new Map<string, Tree[]>();
      const bn = ['tree_broad_1', 'tree_broad_2', 'tree_broad_3'];
      const cn = ['tree_conifer_1', 'tree_conifer_2'];
      for (const tr of hl) {
        const pool = tr.con ? cn : bn;
        const nm = pool[Math.floor(rnd() * pool.length)];
        (buckets.get(nm) ?? buckets.set(nm, []).get(nm)!).push(tr);
      }
      for (const [nm, arr] of buckets) {
        place(nm, arr, nm.includes('conifer') ? 1.7 : 1.15, (im, n) => {
          im.frustumCulled = false;
          scene.add(im);
          treeMeshes.push({ im, total: n });
        });
      }
      // Mittel- und Ferndistanz: Blender-LOD-Bäume (je ~250 Flächen), in Chunks für Frustum-Culling
      {
        const chunkMap = new Map<string, Map<string, Tree[]>>();
        const lodB = ['tree_broad_1_lod', 'tree_broad_2_lod', 'tree_broad_3_lod'];
        const lodC = ['tree_conifer_1_lod', 'tree_conifer_2_lod'];
        const lodItems = [...list, ...overflow].sort((a, b) => (a.d ?? 0) - (b.d ?? 0)).slice(0, 5600);
        for (const tr of lodItems) {
          const pool = tr.con ? lodC : lodB;
          const nm = pool[Math.floor(rnd() * pool.length)];
          const key = `${Math.floor(tr.x / 450)}:${Math.floor(tr.y / 450)}`;
          const cm = chunkMap.get(key) ?? chunkMap.set(key, new Map()).get(key)!;
          (cm.get(nm) ?? cm.set(nm, []).get(nm)!).push(tr);
        }
        for (const cm of chunkMap.values()) {
          for (const [nm, arr] of cm) {
            place(nm, arr, nm.includes('conifer') ? 1.7 : 1.15, (im, n) => {
              im.computeBoundingSphere();
              scene.add(im);
              treeMeshes.push({ im, total: n });
            });
          }
        }
      }
      // Büsche und Grasbüschel in Chunks (Frustum-Culling), am Streckenrand
      type Tuft = { x: number; y: number; h: number; tint: number };
      const chunks = new Map<string, Map<string, Tuft[]>>();
      const put = (name: string, tf: Tuft) => {
        const key = `${Math.floor(tf.x / 140)}:${Math.floor(tf.y / 140)}`;
        const m = chunks.get(key) ?? chunks.set(key, new Map()).get(key)!;
        (m.get(name) ?? m.set(name, []).get(name)!).push(tf);
      };
      const step = Math.max(1, Math.round(3.5 / t.ds));
      for (let i = 0; i < t.n; i += step) {
        for (const sd of [1, -1] as const) {
          const edge = sd === 1 ? t.wl[i] + t.barrierL[i] : t.wr[i] + t.barrierR[i];
          const sv = t.s[i];
          const inStand = stands.some((z) => z.side === sd && sv > z.s0 - 6 && sv < z.s1 + 6);
          const nTuft = 5 + (rnd() < 0.5 ? 1 : 0);
          for (let k = 0; k < nTuft; k++) {
            const lat = edge + 1.2 + Math.pow(rnd(), 1.6) * 38;
            if (inStand && lat < edge + 42) continue;
            const x = t.x[i] + t.nx(i) * sd * lat + (rnd() - 0.5) * 3;
            const y = t.y[i] + t.ny(i) * sd * lat + (rnd() - 0.5) * 3;
            const dry = fbm(x / 120, y / 120, seed + 12) + (rnd() - 0.5) * 0.25 > 0.58;
            const nm = dry ? (rnd() < 0.5 ? 'grass_dry_1' : 'grass_dry_2') : rnd() < 0.5 ? 'grass_green_1' : 'grass_green_2';
            put(nm, { x, y, h: 0.45 + rnd() * 0.75, tint: 0.8 + rnd() * 0.4 });
          }
          // vereinzelt Büsche weiter draußen
          if (rnd() < 0.05) {
            const lat = edge + 8 + rnd() * 40;
            const x = t.x[i] + t.nx(i) * sd * lat;
            const y = t.y[i] + t.ny(i) * sd * lat;
            if (!(inStand && lat < edge + 42)) put(rnd() < 0.5 ? 'bush_1' : 'bush_2', { x, y, h: 1.6 + rnd() * 1.6, tint: 0.8 + rnd() * 0.4 });
          }
        }
      }
      // Wiese: lockere Büschel im Gelände bis ~150 m Abstand (Stroh/Grün nach großflächigen Flecken)
      {
        const mg = 9;
        const mx0 = Math.floor((t.minX - 150) / mg);
        const mx1 = Math.ceil((t.maxX + 150) / mg);
        const my0 = Math.floor((t.minY - 150) / mg);
        const my1 = Math.ceil((t.maxY + 150) / mg);
        for (let gy = my0; gy <= my1; gy++) {
          for (let gx = mx0; gx <= mx1; gx++) {
            const x = (gx + rnd()) * mg;
            const y = (gy + rnd()) * mg;
            const d = distAt(x, y);
            if (d < 26 || d > 150) continue;
            if (rnd() > 0.42 * (1 - smooth(60, 150, d) * 0.7)) continue;
            const dry = fbm(x / 120, y / 120, seed + 12) + (rnd() - 0.5) * 0.3 > 0.55;
            const nm = dry ? (rnd() < 0.5 ? 'grass_dry_1' : 'grass_dry_2') : rnd() < 0.5 ? 'grass_green_1' : 'grass_green_2';
            put(nm, { x, y, h: 0.5 + rnd() * 0.9, tint: 0.75 + rnd() * 0.45 });
          }
        }
      }
      for (const m of chunks.values()) {
        for (const [nm, arr] of m) {
          place(nm, arr, 1.0, (im) => {
            im.computeBoundingSphere();
            scene.add(im);
          });
        }
      }
    }
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
