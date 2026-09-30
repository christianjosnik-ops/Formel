import * as THREE from 'three';
import { DENT_STRIDE, MAX_DENTS, S } from '../physics/layout';
import type { CarConfig } from '../config/car';
import type { CarAssets } from './carAssets';

export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
  number: number;
  helmet: string;
  teamName: string;
  engineName: string;
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
// Dekor-Texturen (Teamname, Emblem, Startnummer) – eigene Schriftzüge, keine Originallogos
// ---------------------------------------------------------------------------------------------

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function sideDecal(l: Livery): THREE.CanvasTexture {
  return canvasTex(1536, 320, (g) => {
    g.clearRect(0, 0, 1536, 320);
    const onLight = luminance(l.primary) > 0.45;
    const ink = onLight ? l.accent : '#ffffff';
    // Emblem: zwei schräge Balken im Teamfarbschema
    g.save();
    g.translate(60, 50);
    g.fillStyle = l.secondary;
    g.beginPath();
    g.moveTo(0, 220);
    g.lineTo(70, 0);
    g.lineTo(140, 0);
    g.lineTo(70, 220);
    g.closePath();
    g.fill();
    g.fillStyle = ink;
    g.beginPath();
    g.moveTo(110, 220);
    g.lineTo(180, 0);
    g.lineTo(250, 0);
    g.lineTo(180, 220);
    g.closePath();
    g.fill();
    g.restore();
    // Teamname
    g.fillStyle = ink;
    g.font = '800 130px "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText(l.teamName.toUpperCase(), 350, 175);
    g.font = '600 52px "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = l.secondary;
    g.fillText(`${l.engineName.toUpperCase()}  ·  2026`, 354, 250);
    // Startnummer rechts
    g.font = '900 250px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'right';
    g.fillStyle = ink;
    g.fillText(String(l.number), 1480, 240);
  });
}

const SPONSORS = ['APEX', 'VELOCE', 'NOVA', 'TERRA', 'AQUILA', 'STRATOS', 'ORBIT', 'KINETIC'];

/** Sponsorstreifen (erfundene Marken) für Motorabdeckung und Flügelendplatten. */
function sponsorDecal(l: Livery): THREE.CanvasTexture {
  return canvasTex(1024, 128, (g) => {
    g.clearRect(0, 0, 1024, 128);
    const onLight = luminance(l.primary) > 0.45;
    let h = 0;
    for (const ch of l.teamName) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      const name = SPONSORS[(h + i * 3) % SPONSORS.length];
      g.fillStyle = i % 2 ? (onLight ? l.accent : '#ffffff') : l.secondary;
      g.font = `${i % 2 ? 800 : 600} ${i % 2 ? 76 : 64}px "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'left';
      g.fillText(name, 20 + i * 256, 66);
    }
  });
}

function patternOf(l: Livery): number {
  let h = 7;
  for (const ch of l.teamName) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return h % 5;
}

function topDecal(l: Livery): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    g.clearRect(0, 0, 512, 512);
    g.fillStyle = luminance(l.primary) > 0.45 ? l.accent : '#ffffff';
    g.font = '900 360px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(l.number), 256, 270);
  });
}

// ---------------------------------------------------------------------------------------------
// Material-Patches: Schadensdellen (Vertex) + Lackdesign (Fragment)
// ---------------------------------------------------------------------------------------------

interface DentUniforms {
  a: { value: THREE.Vector4[] }; // xyz Position, w Radius
  b: { value: THREE.Vector4[] }; // xyz Richtung, w Tiefe
}

function patchMaterial(mat: THREE.Material, key: string, dent: DentUniforms, fragment?: { decl: string; body: string; uniforms: Record<string, { value: unknown }> }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDentA = dent.a;
    shader.uniforms.uDentB = dent.b;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uDentA[${MAX_DENTS}];
uniform vec4 uDentB[${MAX_DENTS}];
varying vec3 vOP;
varying vec3 vON;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vOP = position;
vON = normal;
for (int i = 0; i < ${MAX_DENTS}; i++) {
  vec4 da = uDentA[i];
  vec4 db = uDentB[i];
  if (db.w > 0.0005) {
    float d = distance(position, da.xyz);
    float f = smoothstep(da.w, 0.0, d);
    float n = 0.82 + 0.18 * sin(position.x * 23.0 + position.z * 19.0 + position.y * 17.0);
    transformed += db.xyz * (db.w * f * n);
  }
}`,
      );
    if (fragment) {
      Object.assign(shader.uniforms, fragment.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;\n${fragment.decl}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${fragment.body}`);
    } else {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;');
    }
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}

const LIVERY_DECL = `
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform sampler2D uDecalSide;
uniform sampler2D uDecalTop;
uniform sampler2D uSponsor;
uniform float uPattern;
`;

// Koordinaten: Objektraum der Karosserie (x vorn, y oben, z rechts), Meter.
const LIVERY_BODY = `
{
  vec3 P = vOP;
  vec3 N = normalize(vON);
  vec3 carbon = vec3(0.022, 0.024, 0.028);
  vec3 col = uPrimary;
  float az = abs(P.z);
  // Frontflügel: Endplatten in Zweitfarbe, Elemente in Grundfarbe
  if (P.x > 2.4) {
    col = az > 0.74 ? uSecondary : uPrimary;
    if (N.y < -0.4) col = carbon;
  }
  // Heckflügel
  if (P.x < -1.5 && P.y > 0.45) {
    col = az > 0.40 ? uSecondary : uPrimary;
    if (N.y < -0.5) col = mix(col, carbon, 0.6);
  }
  // Mittelstreifen über Nase und Motorabdeckung
  if (az < 0.05 && N.y > 0.35 && P.y > 0.3 && P.x > -1.75 && P.x < 2.38 && !(P.x > -0.12 && P.x < 0.9 && P.y > 0.72)) col = uSecondary;
  // Schweller / Unterkante abgesetzt
  if (P.y < 0.19 && P.x > -1.6 && P.x < 2.4) col = mix(uAccent, carbon, 0.5);
  if (P.y >= 0.19 && P.y < 0.205 && P.x > -1.3 && P.x < 1.5) col = uSecondary;
  // Teamspezifische Lackierung (Muster 0..4)
  if (P.x > -1.45 && P.x < 2.3 && P.y > 0.2 && N.y > -0.2) {
    if (uPattern < 0.5) {
      // Diagonale Schwungstreifen über Seitenkasten und Motorabdeckung
      float d = P.x * 0.62 + az * 1.15 - P.y * 0.35;
      if (fract(d * 1.6) < 0.16 && P.x < 1.6) col = uSecondary;
    } else if (uPattern < 1.5) {
      // zweifarbig: Nase und Front in Zweitfarbe, Kante abgesetzt
      if (P.x > 1.25 + 0.5 * az) col = uSecondary;
      if (abs(P.x - (1.25 + 0.5 * az)) < 0.025) col = uAccent;
    } else if (uPattern < 2.5) {
      // Pfeilspitze (Chevron) auf der Nase
      if (P.x > 1.1 && P.x < 2.3 && abs(fract((P.x - az * 1.3) * 2.2) - 0.5) < 0.13) col = uSecondary;
    } else if (uPattern < 3.5) {
      // Seitenkasten-Klinge: unterer Bereich in Zweitfarbe
      if (P.y < 0.42 - 0.2 * max(0.0, P.x) * 0.2 && P.x > -1.0 && P.x < 1.4 && az > 0.25) col = uSecondary;
    } else {
      // Motorabdeckung zweifarbig, Hecksektion dunkel
      if (P.x < -0.6 && N.y > 0.3) col = mix(col, uSecondary, 0.85);
      if (P.x < -1.2) col = mix(col, uAccent, 0.5);
    }
  }
  // Sponsorstreifen: Seite der Motorabdeckung und Flügelendplatten
  if (abs(N.z) > 0.55) {
    if (az > 0.08 && az < 0.5 && P.x > -1.45 && P.x < -0.35 && P.y > 0.5 && P.y < 0.72) {
      float u = (P.x + 1.45) / 1.1;
      if (P.z < 0.0) u = 1.0 - u;
      vec4 d = texture2D(uSponsor, vec2(u, (P.y - 0.5) / 0.22));
      col = mix(col, d.rgb, d.a);
    }
    if (P.x < -1.5 && P.y > 0.5 && az > 0.38) {
      float u = (P.x + 1.95) / 0.55;
      if (P.z < 0.0) u = 1.0 - u;
      vec4 d = texture2D(uSponsor, vec2(u * 0.5, 0.5 + (P.y - 0.55) * 1.5));
      col = mix(col, d.rgb, d.a * 0.9);
    }
  }
  // Halo + Spiegel in Karbon
  if (P.x > -0.06 && P.x < 0.95 && P.y > 0.74 && az < 0.34) col = carbon;
  // Seitenkasten-Dekor
  if (az > 0.27 && abs(N.z) > 0.5 && P.x > -0.95 && P.x < 0.65 && P.y > 0.2 && P.y < 0.51) {
    float u = (P.x + 0.95) / 1.6;
    if (P.z < 0.0) u = 1.0 - u;
    vec4 d = texture2D(uDecalSide, vec2(u, (P.y - 0.2) / 0.31));
    col = mix(col, d.rgb, d.a);
  }
  // Startnummer oben auf Nase und Motorabdeckung
  if (N.y > 0.6) {
    if (az < 0.13 && P.x > 1.45 && P.x < 2.15) {
      vec4 d = texture2D(uDecalTop, vec2((P.z + 0.13) / 0.26, (P.x - 1.45) / 0.7));
      col = mix(col, d.rgb, d.a);
    }
    if (az < 0.11 && P.x > -1.55 && P.x < -0.85) {
      vec4 d = texture2D(uDecalTop, vec2((P.z + 0.11) / 0.22, (P.x + 1.55) / 0.7));
      col = mix(col, d.rgb, d.a);
    }
  }
  diffuseColor.rgb = col;
}
`;

const SIDEWALL_DECL = `uniform vec3 uCompound;`;
const SIDEWALL_BODY = `
{
  float r = length(vOP.xy);
  float band = smoothstep(0.252, 0.256, r) * (1.0 - smoothstep(0.278, 0.282, r));
  diffuseColor.rgb = mix(vec3(0.018), uCompound, band);
}
`;

// ---------------------------------------------------------------------------------------------
// Fahrzeug
// ---------------------------------------------------------------------------------------------

const WHEEL_KEYS = ['FL', 'FR', 'RL', 'RR'] as const;

export class CarModel {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly shell = new THREE.Group();
  private readonly wheelRoots: THREE.Group[] = [];
  private readonly wheelSteer: THREE.Group[] = [];
  private readonly wheelSpin: THREE.Group[] = [];
  private readonly wheelStatic: THREE.Group[] = [];
  private readonly discMats: THREE.MeshStandardMaterial[] = [];
  private readonly wingFront = new THREE.Group();
  private readonly wingRear = new THREE.Group();
  private readonly helmet = new THREE.Group();
  private readonly brakeLightMats: THREE.MeshStandardMaterial[] = [];
  private readonly dent: DentUniforms;
  private readonly compoundU = { value: new THREE.Color() };
  lastCompound = -1;
  private readonly spinAngle = new Float64Array(4);
  private readonly tmp = new THREE.Vector3();
  readonly livery: Livery;
  readonly wheelPos: THREE.Vector3[] = [];
  /** Geometrie-Vorlagen für Trümmerteile (aus demselben Modell). */
  readonly debrisTemplates: { wheel: THREE.Group; wingFront: THREE.Object3D; wingRear: THREE.Object3D };

  constructor(
    private readonly cfg: CarConfig,
    livery: Livery,
    assets: CarAssets,
  ) {
    this.livery = livery;
    this.root.add(this.pivot);
    this.pivot.position.y = cfg.geometry.cgHeight;
    this.pivot.add(this.shell);
    this.shell.position.y = -cfg.geometry.cgHeight;

    this.dent = {
      a: { value: Array.from({ length: MAX_DENTS }, () => new THREE.Vector4(0, 0, 0, 0.3)) },
      b: { value: Array.from({ length: MAX_DENTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    };

    const src = assets.scene.clone(true);
    const nodes: Record<string, THREE.Object3D> = {};
    src.traverse((o) => {
      if (o.name) nodes[o.name] = o;
    });

    // ---- Materialien ----
    this.compoundU.value.set(COMPOUND_COLOR[livery.compound ?? 'medium']);
    const primary = new THREE.Color(livery.primary);
    const secondary = new THREE.Color(livery.secondary);
    const accent = new THREE.Color(livery.accent);
    const liveryUniforms = {
      uPrimary: { value: primary },
      uSecondary: { value: secondary },
      uAccent: { value: accent },
      uDecalSide: { value: sideDecal(livery) },
      uDecalTop: { value: topDecal(livery) },
      uSponsor: { value: sponsorDecal(livery) },
      uPattern: { value: patternOf(livery) },
    };
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 });
    patchMaterial(paint, 'f1-livery', this.dent, { decl: LIVERY_DECL, body: LIVERY_BODY, uniforms: liveryUniforms });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.42, metalness: 0.4 });
    patchMaterial(carbon, 'f1-carbon', this.dent, {
      decl: '',
      body: `{
  vec2 w = vec2(vOP.x + vOP.z * 0.5, vOP.y + vOP.z * 0.5) * 140.0;
  float ck = step(0.5, fract(w.x)) == step(0.5, fract(w.y)) ? 1.0 : 0.0;
  float tw = 0.78 + 0.34 * ck * (0.6 + 0.4 * sin(w.x * 6.2831));
  diffuseColor.rgb *= tw;
}`,
      uniforms: {},
    });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1014, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.93, metalness: 0 });
    const sidewall = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    patchMaterial(sidewall, 'f1-sidewall', this.dent, {
      decl: SIDEWALL_DECL,
      body: SIDEWALL_BODY,
      uniforms: { uCompound: this.compoundU },
    });
    const cover = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.3, metalness: 0.85 });
    const led = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x39c6ff, emissiveIntensity: 1.6 });
    const steering = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.5 });
    const suit = new THREE.MeshStandardMaterial({ color: secondary.clone().multiplyScalar(0.8), roughness: 0.8 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.7 });
    const tailLight = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0.6 });
    this.brakeLightMats.push(tailLight);

    const pickMaterial = (name: string): THREE.Material => {
      const n = name.replace(/\.\d+$/, '');
      switch (n) {
        case 'Livery1Mtl':
          return paint;
        case 'Aero1Mtl':
          return glass;
        case 'Wheeldecal1Mtl':
          return rubber;
        case 'Wheeldecal2Mtl':
          return sidewall;
        case 'Cover1Mtl':
          return cover;
        case 'Led1Mtl':
          return led;
        case 'Meshpart1Mtl':
          return steering;
        case 'Rightupperarm1Mtl':
          return suit;
        case 'Righthand1Mtl':
          return glove;
        case 'Part1Mtl':
        case 'Meshesmcledgears0011Mtl':
          return tailLight;
        default:
          return carbon; // Aero2, Meshesmesh101, ...
      }
    };
    const applyMaterials = (root: THREE.Object3D) => {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        m.material = (mats.length === 1 ? pickMaterial(mats[0].name) : mats.map((x) => pickMaterial(x.name))) as THREE.Material;
        m.castShadow = true;
        m.receiveShadow = false;
      });
    };

    // ---- Karosserie ----
    const body = nodes['body'];
    applyMaterials(body);
    this.shell.add(body);
    // Flügel: Drehpunkte für Verformung
    const wf = nodes['wing_front'];
    applyMaterials(wf);
    this.wingFront.position.set(2.4, 0.22, 0);
    wf.position.set(-2.4, -0.22, 0);
    this.wingFront.add(wf);
    this.shell.add(this.wingFront);
    const wr = nodes['wing_rear'];
    applyMaterials(wr);
    this.wingRear.position.set(-1.75, 0.6, 0);
    wr.position.set(1.75, -0.6, 0);
    this.wingRear.add(wr);
    this.shell.add(this.wingRear);

    // ---- Fahrer: Helm ----
    {
      const helmetMat = new THREE.MeshPhysicalMaterial({ color: livery.helmet, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.112, 22, 16), helmetMat);
      head.scale.set(1.12, 1.04, 0.94);
      head.castShadow = true;
      const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.114, 18, 10, -0.8, 1.6, 1.1, 0.7),
        new THREE.MeshPhysicalMaterial({ color: 0x08090b, roughness: 0.04, metalness: 0.7, clearcoat: 1 }),
      );
      visor.rotation.y = -Math.PI / 2;
      visor.scale.set(1.14, 1.06, 0.96);
      this.helmet.add(head, visor);
      this.helmet.position.set(0.28, 0.66, 0);
      this.shell.add(this.helmet);
    }

    // ---- Räder ----
    const R = cfg.tiresFront.radius;
    const scaleR = 1; // Modell ist bereits auf den Sollradius skaliert
    for (let i = 0; i < 4; i++) {
      const src = nodes['wheel_' + WHEEL_KEYS[i]];
      const wroot = new THREE.Group();
      wroot.position.copy(src.position);
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      const still = new THREE.Group();
      wroot.add(steer);
      steer.add(spin);
      steer.add(still);
      // Kinder nach Material sortieren: Bremsbelüftung (Meshesmesh101) dreht nicht mit
      const kids = [...src.children];
      for (const k of kids) {
        const m = k as THREE.Mesh;
        if (!m.isMesh) continue;
        const matName = (Array.isArray(m.material) ? m.material[0] : m.material).name.replace(/\.\d+$/, '');
        applyMaterials(m);
        (matName === 'Meshesmesh101Mtl' ? still : spin).add(m);
      }
      // Bremsscheibe: glühende Scheibe hinter der Abdeckung
      const dmat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.5, metalness: 0.8, emissive: 0x000000 });
      this.discMats.push(dmat);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 28).rotateX(Math.PI / 2), dmat);
      disc.position.z = Math.sign(src.position.z) * -0.06;
      spin.add(disc);
      wroot.scale.setScalar(scaleR);
      this.root.add(wroot);
      this.wheelRoots.push(wroot);
      this.wheelSteer.push(steer);
      this.wheelSpin.push(spin);
      this.wheelStatic.push(still);
      this.wheelPos.push(wroot.position);
    }
    void R;

    // Vorlagen für Trümmerteile (eigene Materialien, gleiche Geometrie)
    const tplWheel = new THREE.Group();
    {
      const m0 = this.wheelSpin[0];
      for (const k of m0.children) tplWheel.add((k as THREE.Mesh).clone());
    }
    // Trümmer-Flügel: frische Kopien, um ihren eigenen Schwerpunkt zentriert
    const fresh = assets.scene.clone(true);
    const center = (name: string, cx: number, cy: number): THREE.Group => {
      const node = fresh.getObjectByName(name)!;
      applyMaterials(node);
      node.position.set(-cx, -cy, 0);
      const g = new THREE.Group();
      g.add(node);
      return g;
    };
    const tplWF = center('wing_front', 2.75, 0.2);
    const tplWR = center('wing_rear', -1.75, 0.65);
    this.debrisTemplates = { wheel: tplWheel, wingFront: tplWF, wingRear: tplWR };
  }

  /** Aktualisiert Transformationen und Schadensdarstellung aus einem (interpolierten) Snapshot. */
  update(snap: Float64Array, dt: number, ground = 0, tilt = 0): void {
    const cfg = this.cfg;
    this.root.position.set(snap[S.x], ground, -snap[S.y]);
    this.root.rotation.set(0, snap[S.psi], tilt);
    this.pivot.position.y = cfg.geometry.cgHeight - snap[S.heave];
    // Nick: positiv = Nase tiefer -> Rotation um z negativ; Wanken: positiv = rechts tiefer -> Rotation um x positiv.
    this.pivot.rotation.set(snap[S.roll], 0, -snap[S.pitch], 'YZX');

    for (let i = 0; i < 4; i++) {
      const off = snap[S.wheelOff + i] > 0.5;
      this.wheelRoots[i].visible = !off;
      if (off) continue;
      this.spinAngle[i] -= snap[S.omega + i] * dt;
      this.wheelSpin[i].rotation.z = this.spinAngle[i];
      const toe = snap[S.bent + i];
      if (i < 2) this.wheelSteer[i].rotation.y = snap[i === 0 ? S.steerL : S.steerR] + toe;
      else this.wheelSteer[i].rotation.y = toe;
      // Verbogene Querlenker zeigen sich zusätzlich als Sturz
      this.wheelSteer[i].rotation.x = toe * 2.2 * (i % 2 === 0 ? -1 : 1);
      // Platter Reifen: sichtbar niedriger
      const p = snap[S.puncture + i];
      this.wheelRoots[i].scale.set(1, 1 - 0.13 * p, 1);
      this.wheelRoots[i].position.y = this.wheelPos[i].y * (1 - 0.13 * p); // Reifen bleibt am Boden
      // Bremsscheiben glühen: ab 450 C sichtbar, bis 1100 C hellorange
      const t = snap[S.brakeTemp + i];
      const k = Math.min(1, Math.max(0, (t - 450) / 650));
      this.discMats[i].emissive.setRGB(k * 1.6, k * k * 0.55, k * k * k * 0.12);
    }

    // Flügel: Verformung durch Schaden (hängt nach unten, verdreht), abgerissen = unsichtbar
    const dF = snap[S.dmgWingF];
    const dR = snap[S.dmgWingR];
    this.wingFront.visible = dF < 0.999;
    this.wingFront.rotation.set(0, dF * 0.18 * Math.sign(Math.sin(dF * 37)), -dF * 0.32);
    this.wingRear.visible = dR < 0.999;
    this.wingRear.rotation.set(dR * 0.2, dR * 0.12, -dR * 0.12);

    // Heckleuchte: Bremslicht
    const tl = this.brakeLightMats[0];
    tl.emissiveIntensity = 0.5 + snap[S.brake] * 5;

    // Dellen
    const a = this.dent.a.value;
    const b = this.dent.b.value;
    for (let i = 0; i < MAX_DENTS; i++) {
      const o = S.dents + i * DENT_STRIDE;
      a[i].set(snap[o], snap[o + 1], snap[o + 2], Math.max(snap[o + 7], 0.05));
      b[i].set(snap[o + 3], snap[o + 4], snap[o + 5], snap[o + 6]);
    }
  }

  /** Punkt in Karosseriekoordinaten (x vorn, y oben, z rechts) in Weltkoordinaten. */
  attach(x: number, y: number, z: number, target: THREE.Vector3): THREE.Vector3 {
    this.tmp.set(x, y, z);
    this.shell.updateWorldMatrix(true, false);
    return this.shell.localToWorld(target.copy(this.tmp));
  }

  /** Reifenmischung (Farbring der Flanke). */
  setCompound(id: string): void {
    this.compoundU.value.set(COMPOUND_COLOR[id as keyof typeof COMPOUND_COLOR] ?? '#ffd12e');
  }

  setFirstPerson(on: boolean): void {
    this.helmet.visible = !on;
  }

  eyeWorld(target: THREE.Vector3): THREE.Vector3 {
    this.tmp.set(0.32, 0.72, 0);
    this.shell.localToWorld(target.copy(this.tmp));
    return target;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mt of mats) mt.dispose();
      }
    });
  }
}
