import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { S } from '../physics/layout';
import { teamOf, DRIVERS } from '../race/field';
import { COMPOUND_ORDER } from '../config/tyres';
import { COMPOUND_COLOR, type CarModel } from './carModel';

/**
 * Boxenstopp-Animation aus Blender (tools/make_pitcrew.py, public/models/pitcrew.glb): 18 gegliederte Mechaniker nach dem
 * Ablauf eines echten F1-Stopps – Anlauf, Wagenheber vorn/hinten, je Rad Schrauber / Rad ab / Rad an, Frontflügel-
 * Einsteller, Heck-Stabilisierer, Feuerlöscher, Freigabe, Rückzug. Der Clip ('pitstop', 5 s) wird nicht abgespielt, sondern
 * über Fortschritt gescrubbt: Anlauf nach Abstand zur Box, Service nach Standzeit, Rückzug nach Abstand hinter der Box.
 */

const T_PRE = 1.2;
const T_SERV = 2.6;
const T_POST = 1.2;
const PRE_DIST = 30; // ab so vielen Metern vor der Box rückt die Crew an
const POST_DIST = 24; // so viele Meter hinter der Box zieht sie sich zurück
const SWAP_AT = T_PRE + 1.1; // Zeitpunkt, an dem das neue Rad sichtbar am Auto sitzt

interface CarEntry {
  k: number;
  view: Float64Array;
  model: CarModel;
  ground: number;
}

class Crew {
  readonly group: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly action: THREE.AnimationAction;
  readonly suit: THREE.MeshStandardMaterial;
  readonly ringNew: THREE.MeshStandardMaterial;
  readonly ringOld: THREE.MeshStandardMaterial;
  readonly lift: THREE.Object3D;
  readonly wheelVis: THREE.Object3D;
  carIdx = -1;
  compoundSet = false;
  shadows = false;

  constructor(src: THREE.Group, clip: THREE.AnimationClip) {
    this.group = src.clone(true);
    this.suit = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.62, vertexColors: true });
    this.ringNew = new THREE.MeshStandardMaterial({ color: 0xffd12e, roughness: 0.5, vertexColors: false });
    this.ringOld = this.ringNew.clone();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      if (mat.name === 'Suit') m.material = this.suit;
      else if (mat.name === 'TyreRing') m.material = this.ringNew;
      else if (mat.name === 'TyreRingOld') m.material = this.ringOld;
      m.frustumCulled = false;
    });
    this.lift = this.group.getObjectByName('CarLift')!;
    this.wheelVis = this.group.getObjectByName('WheelVis_FL')!;
    this.mixer = new THREE.AnimationMixer(this.group);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
    this.group.visible = false;
  }

  setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.group.traverse((o) => {
      o.castShadow = on;
    });
  }
}

export class PitCrewRenderer {
  private readonly crews: Crew[] = [];
  private readonly active = new Map<number, Crew>();
  private ready = false;
  /** Vorführung (Debug): >= 0 erzwingt die Animation am Spielerauto bei diesem Fortschritt (0..1 des ganzen Clips). */
  demo = -1;

  constructor(scene: THREE.Scene) {
    const base = import.meta.env.BASE_URL;
    new GLTFLoader()
      .loadAsync(`${base}models/pitcrew.glb`)
      .then((gltf) => {
        const clip = gltf.animations[0];
        if (!clip) return;
        for (let i = 0; i < 2; i++) {
          const c = new Crew(gltf.scene, clip);
          this.crews.push(c);
          scene.add(c.group);
        }
        this.ready = true;
      })
      .catch(() => undefined);
  }

  /** Zeit im Clip für ein Auto, oder -1 wenn keine Crew gebraucht wird. */
  private clipTime(v: Float64Array, isDemo: number): number {
    if (isDemo >= 0) return Math.min(1, isDemo) * (T_PRE + T_SERV + T_POST);
    const st = v[S.pitState];
    const d = v[S.pitDBox];
    if (st === 3) {
      const svc = Math.max(0.5, v[S.pitSvc]);
      const p = 1 - Math.max(0, v[S.pitTimer]) / svc;
      return T_PRE + T_SERV * Math.min(1, p);
    }
    if (st === 0 && d > PRE_DIST) return -1;
    if (d >= 900) return -1;
    if (st === 4) return d < 0 && -d < POST_DIST ? T_PRE + T_SERV + T_POST * Math.min(1, -d / (POST_DIST * 0.8)) : -1;
    if ((st === 1 || st === 2 || st === 0) && d > 0 && d < PRE_DIST) return T_PRE * (1 - d / PRE_DIST);
    return -1;
  }

  update(cars: CarEntry[], camX: number, camZ: number): void {
    if (!this.ready) return;
    const seen = new Set<number>();
    for (const c of cars) {
      const t = this.clipTime(c.view, this.demo >= 0 && c.k === 0 ? this.demo : -1);
      const dx = c.view[S.x] - camX;
      const dz = -c.view[S.y] - camZ;
      if (t < 0 || dx * dx + dz * dz > 220 * 220) {
        c.model.serviceLift = 0;
        c.model.serviceHide.fill(false);
        continue;
      }
      let crew = this.active.get(c.k);
      if (!crew) {
        const used = new Set(this.active.values());
        crew = this.crews.find((x) => !used.has(x));
        if (!crew) continue;
        this.active.set(c.k, crew);
        crew.carIdx = c.k;
        crew.compoundSet = false;
        const team = teamOf(DRIVERS[Math.min(DRIVERS.length - 1, Math.max(0, c.view[S.raceDriver] | 0))]);
        crew.suit.color.set(team.colors.primary);
        if (crew.suit.color.r + crew.suit.color.g + crew.suit.color.b < 0.5) crew.suit.color.set(team.colors.accent || team.colors.secondary);
        crew.group.visible = true;
        crew.setShadows(c.k === 0);
      }
      seen.add(c.k);
      this.animate(crew, c, t);
    }
    for (const [k, crew] of this.active) {
      if (seen.has(k)) continue;
      crew.group.visible = false;
      this.active.delete(k);
    }
  }

  private animate(crew: Crew, c: CarEntry, t: number): void {
    const v = c.view;
    const next = COMPOUND_ORDER[v[S.pitNext] | 0] ?? 'medium';
    if (t < T_PRE + 0.05) {
      crew.compoundSet = false;
      crew.ringOld.color.copy(c.model.compoundColor);
      crew.ringNew.color.set(COMPOUND_COLOR[next] ?? '#ffd12e');
    }
    crew.group.position.set(v[S.x], c.ground, -v[S.y]);
    crew.group.rotation.y = v[S.psi];
    crew.mixer.setTime(Math.min(t, T_PRE + T_SERV + T_POST - 1e-3));
    crew.group.updateMatrixWorld(true);
    c.model.serviceLift = crew.lift.position.y;
    const off = crew.wheelVis.scale.x < 0.5;
    for (let i = 0; i < 4; i++) c.model.serviceHide[i] = off;
    if (t >= SWAP_AT && !crew.compoundSet) {
      crew.compoundSet = true;
      c.model.setCompound(next);
    }
  }
}
