import * as THREE from 'three';
import { S } from '../physics/layout';
import { teamOf, DRIVERS } from '../race/field';
import { COMPOUND_ORDER } from '../config/tyres';
import { COMPOUND_COLOR, type CarModel } from './carModel';

/**
 * Boxenstopp-Animation: Eine zwölfköpfige Crew läuft aus der Garage zum Auto, Wagenheber heben es an, die Schrauber
 * lösen die Radmuttern, die Träger tauschen die Räder (alte Reifen weg, neue Mischung dran), das Auto wird abgelassen,
 * der Lollipop-Mann gibt das Auto frei. Alles wird aus dem Fortschritt p (0..1) der Standzeit berechnet.
 */

const sm = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const LF = 1.853; // Vorderachse vor Schwerpunkt
const LR = 1.547;
const HT = 0.74; // halbe Spur

interface Figure {
  root: THREE.Group;
  legs: THREE.Group[];
  arms: THREE.Group[];
  body: THREE.Group;
}

const geoLeg = new THREE.CylinderGeometry(0.085, 0.075, 0.86, 8).translate(0, -0.43, 0);
const geoTorso = new THREE.CylinderGeometry(0.19, 0.17, 0.62, 10).translate(0, 0.31, 0);
const geoArm = new THREE.CylinderGeometry(0.055, 0.05, 0.56, 6).translate(0, -0.28, 0);
const geoHead = new THREE.SphereGeometry(0.105, 10, 8);
const geoHelmet = new THREE.SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
const geoTyre = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14).rotateX(Math.PI / 2);
const geoRing = new THREE.CylinderGeometry(0.365, 0.365, 0.02, 14).rotateX(Math.PI / 2);
const matSkin = new THREE.MeshStandardMaterial({ color: 0xd2a284, roughness: 0.8 });
const matDark = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 });
const matGun = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.4, metalness: 0.6 });

function makeFigure(suit: THREE.Material, helmet: THREE.Material): Figure {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(geoTorso, suit);
  torso.position.y = 0.86;
  body.add(torso);
  const head = new THREE.Mesh(geoHead, matSkin);
  head.position.y = 1.58;
  body.add(head);
  const hm = new THREE.Mesh(geoHelmet, helmet);
  hm.position.y = 1.6;
  body.add(hm);
  const legs: THREE.Group[] = [];
  for (const z of [-0.1, 0.1]) {
    const g = new THREE.Group();
    g.position.set(0, 0.87, z);
    g.add(new THREE.Mesh(geoLeg, matDark));
    root.add(g);
    legs.push(g);
  }
  const arms: THREE.Group[] = [];
  for (const z of [-0.25, 0.25]) {
    const g = new THREE.Group();
    g.position.set(0, 1.42, z);
    g.add(new THREE.Mesh(geoArm, suit));
    body.add(g);
    arms.push(g);
  }
  root.traverse((o) => {
    o.castShadow = true;
  });
  return { root, legs, arms, body };
}

class Crew {
  readonly group = new THREE.Group();
  readonly fig: Figure[] = [];
  readonly newTyres: THREE.Group[] = [];
  readonly oldTyres: THREE.Group[] = [];
  readonly ringMat = new THREE.MeshStandardMaterial({ color: 0xffd12e, roughness: 0.6 });
  readonly gun: THREE.Mesh[] = [];
  readonly jacks: THREE.Mesh[] = [];
  readonly pole = new THREE.Group();
  readonly signMat = new THREE.MeshBasicMaterial({ color: 0xd8201a });
  readonly suit = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.7 });
  readonly helmetMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
  fade = 0;
  carIdx = -1;
  compoundSet = false;

  constructor() {
    for (let i = 0; i < 12; i++) {
      const f = makeFigure(this.suit, this.helmetMat);
      this.fig.push(f);
      this.group.add(f.root);
    }
    for (let i = 0; i < 4; i++) {
      const mk = (): THREE.Group => {
        const g = new THREE.Group();
        const t = new THREE.Mesh(geoTyre, matDark);
        const r = new THREE.Mesh(geoRing, this.ringMat);
        r.position.z = 0.152;
        g.add(t, r);
        g.traverse((o) => (o.castShadow = true));
        g.visible = false;
        return g;
      };
      const n = mk();
      const o = mk();
      this.newTyres.push(n);
      this.oldTyres.push(o);
      this.group.add(n, o);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.1), matGun);
      this.gun.push(gun);
      this.group.add(gun);
    }
    for (let i = 0; i < 2; i++) {
      const j = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.32), matGun);
      this.jacks.push(j);
      this.group.add(j);
    }
    // Lollipop: Stange mit Scheibe
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 6), matDark);
    stick.position.y = 0.85;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.27, 20), this.signMat);
    disc.position.set(0, 1.78, 0);
    const disc2 = disc.clone();
    disc2.rotation.y = Math.PI;
    this.pole.add(stick, disc, disc2);
    this.group.add(this.pole);
    this.group.visible = false;
  }
}

export class PitCrewRenderer {
  private readonly crews: Crew[] = [];
  private readonly active = new Map<number, Crew>();
  /** Vorführung (Debug): >= 0 erzwingt die Animation am Spielerauto bei diesem Fortschritt. */
  demo = -1;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 3; i++) {
      const c = new Crew();
      this.crews.push(c);
      scene.add(c.group);
    }
  }

  /** cars: k = Index im Snapshot, view = interpolierter Autoblock, model = Darstellung, ground = Bodenhöhe. */
  update(cars: Array<{ k: number; view: Float64Array; model: CarModel; ground: number }>, camX: number, camZ: number): void {
    const seen = new Set<number>();
    for (const c of cars) {
      let p = -1;
      const st = c.view[S.pitState];
      if (this.demo >= 0 && c.k === 0) p = this.demo;
      else if (st === 3) {
        const svc = Math.max(0.5, c.view[S.pitSvc]);
        p = 1 - Math.max(0, c.view[S.pitTimer]) / svc;
      }
      const dx = c.view[S.x] - camX;
      const dz = -c.view[S.y] - camZ;
      if (p < 0 || dx * dx + dz * dz > 300 * 300) {
        c.model.serviceLift = 0;
        c.model.serviceHide.fill(false);
        continue;
      }
      let crew = this.active.get(c.k);
      if (!crew) {
        crew = this.crews.find((x) => !x.group.visible && !Array.from(this.active.values()).includes(x));
        if (!crew) continue;
        this.active.set(c.k, crew);
        crew.carIdx = c.k;
        crew.compoundSet = false;
        const team = teamOf(DRIVERS[Math.min(DRIVERS.length - 1, Math.max(0, c.view[S.raceDriver] | 0))]);
        crew.suit.color.set(team.colors.primary);
        if (crew.suit.color.r + crew.suit.color.g + crew.suit.color.b < 0.5) crew.suit.color.set(team.colors.accent || team.colors.secondary);
        crew.group.visible = true;
      }
      seen.add(c.k);
      this.animate(crew, c, Math.min(1, p));
    }
    for (const [k, crew] of this.active) {
      if (seen.has(k)) continue;
      crew.group.visible = false;
      this.active.delete(k);
    }
  }

  private animate(crew: Crew, c: { k: number; view: Float64Array; model: CarModel; ground: number }, p: number): void {
    const v = c.view;
    const psi = v[S.psi];
    const px = v[S.x];
    const py = v[S.y];
    const fx = Math.cos(psi);
    const fy = Math.sin(psi);
    const rx = Math.sin(psi);
    const ry = -Math.cos(psi);
    const g = c.ground;
    // Lage in Fahrzeugkoordinaten (lx vorwärts, lz rechts) -> Szene
    const put = (o: THREE.Object3D, lx: number, lz: number, ly = 0): void => {
      o.position.set(px + fx * lx + rx * lz, g + ly, -(py + fy * lx + ry * lz));
    };
    const lift = 0.14 * sm(0.14, 0.26, p) * (1 - sm(0.72, 0.84, p));
    c.model.serviceLift = lift;
    const next = COMPOUND_ORDER[v[S.pitNext] | 0] ?? 'medium';
    const wheelOff = p > 0.37 && p < 0.52;
    for (let i = 0; i < 4; i++) c.model.serviceHide[i] = wheelOff;
    if (p >= 0.52 && !crew.compoundSet) {
      crew.compoundSet = true;
      c.model.setCompound(next);
    }
    crew.ringMat.color.set(COMPOUND_COLOR[next] ?? '#ffd12e');
    const t = performance.now() / 1000;
    // Wunschpositionen der Radbesatzung
    const wheels: Array<[number, number]> = [
      [LF, -HT],
      [LF, HT],
      [-LR, -HT],
      [-LR, HT],
    ];
    const run = sm(0.0, 0.16, p) * (1 - sm(0.88, 1.0, p));
    const gunning = (p > 0.24 && p < 0.37) || (p > 0.52 && p < 0.66);
    for (let i = 0; i < 4; i++) {
      const [wx, wz] = wheels[i];
      const side = wz < 0 ? -1 : 1;
      // Start in der Garage (links, neben dem Auto), Rechte laufen vorn/hinten herum
      const sx = i < 2 ? 4.2 : -4.0;
      const gunPos: [number, number] = [wx, wz + side * 0.95];
      const carPos: [number, number] = [wx + (i < 2 ? 0.2 : -0.2), wz + side * 1.9];
      for (const role of [0, 1]) {
        const fig = crew.fig[i + role * 4];
        const tx = role === 0 ? gunPos[0] : carPos[0];
        const tz = role === 0 ? gunPos[1] : carPos[1];
        // Linke Seite: direkt aus der Garage; rechte Seite: über Front bzw. Heck herum
        const k1 = Math.min(1, run * 2);
        const k2 = Math.max(0, run * 2 - 1);
        let lx: number;
        let lz: number;
        if (side < 0) {
          lx = sx + (tx - sx) * run;
          lz = -6 + (tz + 6) * run;
        } else {
          lx = sx + (tx - sx) * k2;
          lz = -6 + 3 * k1 + (tz + 3) * k2;
        }
        const kneel = role === 0 && p > 0.18 && p < 0.84 ? 0.7 : 1;
        put(fig.root, lx, lz, 0);
        // Blickrichtung zum Auto
        fig.root.rotation.y = side < 0 ? psi - Math.PI / 2 : psi + Math.PI / 2;
        fig.body.position.y = kneel < 1 ? -0.38 : 0;
        const moving = run > 0.02 && run < 0.98;
        const sw = moving ? Math.sin(t * 14 + i + role) * 0.7 : 0;
        fig.legs[0].rotation.z = sw;
        fig.legs[1].rotation.z = -sw;
        if (kneel < 1) fig.legs.forEach((l) => (l.rotation.z = 1.3));
        const armUp = role === 0 ? (gunning ? -1.35 : -0.5) : -0.9;
        const vib = role === 0 && gunning ? Math.sin(t * 60 + i) * 0.08 : 0;
        fig.arms[0].rotation.z = armUp + vib;
        fig.arms[1].rotation.z = armUp - vib;
        fig.arms[0].rotation.x = fig.arms[1].rotation.x = 0;
      }
      // Schlagschrauber
      const gun = crew.gun[i];
      gun.visible = run > 0.05;
      put(gun, wx, wz + side * 0.62, 0.55 + lift);
      gun.rotation.y = psi + (side < 0 ? 0 : Math.PI);
      // Reifen: neuer wartet beim Träger und wird eingesetzt, alter wird weggetragen
      const nt = crew.newTyres[i];
      const ot = crew.oldTyres[i];
      const wheelH = 0.345 + lift;
      nt.visible = p > 0.1 && p < 0.52;
      if (nt.visible) {
        const k = sm(0.42, 0.52, p);
        const lx = carPos[0] + (wx - carPos[0]) * k;
        const lz = carPos[1] * (1 - k) + wz * k;
        put(nt, lx, lz, 0.9 * (1 - k) + wheelH * k);
        nt.rotation.y = psi;
      }
      ot.visible = p > 0.37 && p < 0.62;
      if (ot.visible) {
        const k = sm(0.37, 0.58, p);
        put(ot, wx - (i < 2 ? -0.4 : 0.4) * k, wz + side * (0.5 + 4.2 * k), wheelH * (1 - k) + 0.36 * k);
        ot.rotation.y = psi;
      }
    }
    // Wagenheber vorn und hinten
    for (let j = 0; j < 2; j++) {
      const lx = j === 0 ? 2.65 : -2.7;
      const fig = crew.fig[8 + j];
      const apply = sm(0.02, 0.14, p) * (1 - sm(0.88, 1.0, p));
      const sx = j === 0 ? 5.5 : -5.6;
      put(fig.root, sx + (lx + (j === 0 ? 0.9 : -0.9) - sx) * apply, -6 + 6 * apply, 0);
      fig.root.rotation.y = psi + (j === 0 ? Math.PI : 0);
      fig.body.position.y = 0;
      fig.legs.forEach((l) => (l.rotation.z = 0));
      const pump = sm(0.1, 0.26, p) * (1 - sm(0.7, 0.84, p));
      fig.arms[0].rotation.z = fig.arms[1].rotation.z = -1.0 - pump * 0.5;
      fig.arms[0].rotation.x = fig.arms[1].rotation.x = 0;
      const jack = crew.jacks[j];
      put(jack, lx, 0, 0.25 + lift * 0.9);
      jack.scale.y = 0.6 + lift * 3;
      jack.rotation.y = psi;
    }
    // Lollipop-Mann vor dem Auto
    {
      const fig = crew.fig[10];
      const apply = sm(0.0, 0.16, p) * (1 - sm(0.93, 1.0, p));
      put(fig.root, 6.0 + (4.4 - 6.0) * apply, -6 + 6.2 * apply, 0);
      fig.root.rotation.y = psi + Math.PI;
      fig.body.position.y = 0;
      fig.legs.forEach((l) => (l.rotation.z = 0));
      fig.arms[0].rotation.z = -2.6;
      fig.arms[1].rotation.z = -0.2;
      put(crew.pole, 6.0 + (4.4 - 6.0) * apply, -6 + 6.2 * apply + 0.4, 0);
      crew.pole.rotation.y = psi + Math.PI / 2;
      crew.signMat.color.set(p < 0.84 ? 0xd8201a : 0x18b83a);
      crew.pole.position.y = g + (p > 0.9 ? -0.95 * sm(0.9, 0.97, p) : 0);
    }
    // Sicherungsposten (Feuerlöscher) und Mitläufer
    {
      const fig = crew.fig[11];
      put(fig.root, -3.4, -2.8 * sm(0.0, 0.16, p) - 3.2 * (1 - sm(0.0, 0.16, p)), 0);
      fig.root.rotation.y = psi + Math.PI / 2;
      fig.body.position.y = 0;
      fig.arms[0].rotation.z = -1.1;
      fig.arms[1].rotation.z = -0.2;
      fig.arms[0].rotation.x = fig.arms[1].rotation.x = 0;
    }
  }
}
