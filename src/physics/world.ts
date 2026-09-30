import { surfaceAt, SURFACES, WALLS, type World2D } from '../world/provingGround';
import { BodyPool } from './crash/bodies';
import { CrashState, limitClosing, limitSeparating, plasticCap } from './crash/crash';
import { HULL, ZONE_PARAMS } from './crash/hull';
import {
  BODY_CONE,
  BODY_SHARD,
  BODY_WHEEL,
  BODY_WING_F,
  BODY_WING_R,
  CONTACT_STRIDE,
  DENT_STRIDE,
  MAX_CONTACTS,
  MAX_DENTS,
  S,
} from './layout';
import type { Vehicle } from './vehicle';

const VS = 0.35; // Regularisierung der Coulomb-Reibung [m/s]
const CONE_K = 1.4e5;
const CONE_CAP = 2800;
const DEBRIS_PARAMS: Record<number, { k: number; cap: number }> = {
  [BODY_CONE]: { k: CONE_K, cap: CONE_CAP },
  [BODY_WHEEL]: { k: 9e5, cap: 70e3 },
  [BODY_WING_F]: { k: 2.5e5, cap: 9e3 },
  [BODY_WING_R]: { k: 2.5e5, cap: 9e3 },
  [BODY_SHARD]: { k: 6e4, cap: 1200 },
};

/**
 * Physik-Welt: Fahrzeuge, statische Wände und Untergründe, bewegliche Körper. Erkennt Kontakte
 * (Wand, Fremdkörper, Auto gegen Auto), wendet das elasto-plastische Crash-Modell an und überträgt
 * die Schadenswirkungen auf die Fahrzeuge.
 */
export class World {
  readonly vehicles: Vehicle[];
  readonly crash: CrashState[];
  readonly bodies = new BodyPool();
  readonly map: World2D;
  private seed = 12345;

  // Wand-Vorberechnung
  private readonly wTx: Float64Array;
  private readonly wTy: Float64Array;
  private readonly wLen: Float64Array;
  private readonly wMinX: Float64Array;
  private readonly wMaxX: Float64Array;
  private readonly wMinY: Float64Array;
  private readonly wMaxY: Float64Array;

  // Arbeitsfelder je Schritt (für das gerade bearbeitete Fahrzeug)
  private readonly bestD = new Float64Array(HULL.n);
  private readonly bestW = new Int32Array(HULL.n);
  private readonly wallMaxD: Float64Array;
  private fwX = 0;
  private fwY = 0;
  private tz = 0;
  private fbx = 0;
  private fby = 0;
  private mPitch = 0;
  private mRoll = 0;
  private peakContactForce = 0;
  private energyBefore = 0;
  private readonly inContact: boolean[];

  /** Stärkste Kontakte des letzten Schritts (mit kurzem Nachleuchten) für die Darstellung. */
  readonly contacts = new Float64Array(MAX_CONTACTS * CONTACT_STRIDE);
  private contactCount = 0;
  private readonly tmpContacts = new Float64Array(MAX_CONTACTS * CONTACT_STRIDE);
  private tmpCount = 0;

  constructor(map: World2D, vehicles: Vehicle[]) {
    this.map = map;
    this.vehicles = vehicles;
    this.crash = vehicles.map(() => new CrashState());
    this.inContact = vehicles.map(() => false);
    const n = map.walls.length;
    this.wTx = new Float64Array(n);
    this.wTy = new Float64Array(n);
    this.wLen = new Float64Array(n);
    this.wMinX = new Float64Array(n);
    this.wMaxX = new Float64Array(n);
    this.wMinY = new Float64Array(n);
    this.wMaxY = new Float64Array(n);
    this.wallMaxD = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = map.walls[i];
      const dx = w.bx - w.ax;
      const dy = w.by - w.ay;
      const l = Math.hypot(dx, dy);
      this.wLen[i] = l;
      this.wTx[i] = dx / l;
      this.wTy[i] = dy / l;
      const d = WALLS[w.kind].depth;
      this.wMinX[i] = Math.min(w.ax, w.bx) - d;
      this.wMaxX[i] = Math.max(w.ax, w.bx) + d;
      this.wMinY[i] = Math.min(w.ay, w.by) - d;
      this.wMaxY[i] = Math.max(w.ay, w.by) + d;
    }
    this.bodies.initCones(map.cones);
  }

  reset(index: number, x: number, y: number, psi: number, speed = 0): void {
    this.vehicles[index].reset(x, y, psi, speed);
    this.crash[index].reset();
    this.inContact[index] = false;
    this.bodies.resetAll();
    this.contactCount = 0;
    this.contacts.fill(0);
    this.applyEffects(index);
  }

  /** Repariert das Fahrzeug an Ort und Stelle (Boxenreparatur). */
  repair(index: number): void {
    this.crash[index].reset();
    this.applyEffects(index);
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  // ---------------------------------------------------------------------------------------------
  step(dt: number): void {
    const vs = this.vehicles;
    for (let vi = 0; vi < vs.length; vi++) this.sampleSurfaces(vs[vi]);
    this.tmpCount = 0;
    for (let vi = 0; vi < vs.length; vi++) {
      this.beginAccumulate();
      const cs = this.crash[vi];
      this.energyBefore = cs.totalEnergy;
      this.collideStatic(vi, dt);
      this.collideBodies(vi, dt);
      for (let vj = vi + 1; vj < vs.length; vj++) this.collideCars(vi, vj, dt);
      this.finishAccumulate(vi, dt);
    }
    // Kontakte der anderen Fahrzeuge (vj > vi) haben in collideCars beide Seiten gefüttert
    for (let vi = 0; vi < vs.length; vi++) {
      vs[vi].step(dt);
    }
    this.bodies.step(dt, this.map.walls);
    this.decayContacts();
  }

  private beginAccumulate(): void {
    this.fwX = this.fwY = this.tz = 0;
    this.fbx = this.fby = 0;
    this.mPitch = this.mRoll = 0;
    this.peakContactForce = 0;
  }

  private sampleSurfaces(v: Vehicle): void {
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    for (let i = 0; i < 4; i++) {
      const wx = v.x + c * v.xw[i] - s * v.yw[i];
      const wy = v.y + s * v.xw[i] + c * v.yw[i];
      const p = SURFACES[surfaceAt(this.map, wx, wy)];
      v.surfGrip[i] = p.grip;
      v.surfRoll[i] = p.roll;
    }
  }

  // ---------------------------------------------------------------------------------------------
  /** Kraft [world] an Kontaktpunkt anwenden, der um (rx, ry) vom Schwerpunkt entfernt liegt. */
  private addForce(vi: number, fx: number, fy: number, rx: number, ry: number, height: number): void {
    const v = this.vehicles[vi];
    this.fwX += fx;
    this.fwY += fy;
    this.tz += rx * fy - ry * fx;
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const fxb = fx * c + fy * s;
    const fyb = -fx * s + fy * c;
    this.fbx += fxb;
    this.fby += fyb;
    const arm = height - v.cfg.geometry.cgHeight;
    this.mPitch += fxb * arm;
    this.mRoll += -fyb * arm;
  }

  private recordContact(x: number, y: number, nx: number, ny: number, force: number, kind: number): void {
    const t = this.tmpContacts;
    const n = this.tmpCount;
    let slot = -1;
    if (n < MAX_CONTACTS) slot = n;
    else {
      let weak = Infinity;
      for (let k = 0; k < MAX_CONTACTS; k++) {
        if (t[k * CONTACT_STRIDE + 4] < weak) {
          weak = t[k * CONTACT_STRIDE + 4];
          slot = k;
        }
      }
      if (force <= weak) return;
    }
    const o = slot * CONTACT_STRIDE;
    t[o] = x;
    t[o + 1] = y;
    t[o + 2] = nx;
    t[o + 3] = ny;
    t[o + 4] = force;
    t[o + 5] = kind;
    if (slot === n) this.tmpCount++;
  }

  private decayContacts(): void {
    if (this.tmpCount > 0) {
      this.contacts.set(this.tmpContacts);
      this.contactCount = this.tmpCount;
    } else if (this.contactCount > 0) {
      let any = 0;
      for (let k = 0; k < this.contactCount; k++) {
        const o = k * CONTACT_STRIDE + 4;
        this.contacts[o] *= 0.92;
        if (this.contacts[o] > 200) any = k + 1;
      }
      this.contactCount = any;
    }
  }

  // ---------------------------------------------------------------------------------------------
  private collideStatic(vi: number, dt: number): void {
    const v = this.vehicles[vi];
    const cs = this.crash[vi];
    const walls = this.map.walls;
    const nW = walls.length;
    if (nW === 0) return;
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const R = HULL.radius + 0.3;
    const minx = v.x - R;
    const maxx = v.x + R;
    const miny = v.y - R;
    const maxy = v.y + R;
    const n = HULL.n;
    let any = false;
    this.bestW.fill(-1);
    this.bestD.fill(0);
    for (let w = 0; w < nW; w++) {
      if (maxx < this.wMinX[w] || minx > this.wMaxX[w] || maxy < this.wMinY[w] || miny > this.wMaxY[w]) continue;
      const wl = walls[w];
      const depth = WALLS[wl.kind].depth;
      const tx = this.wTx[w];
      const ty = this.wTy[w];
      const len = this.wLen[w];
      for (let i = 0; i < n; i++) {
        if (!cs.isActive(i)) continue;
        const bx = cs.pointX(i);
        const by = cs.pointY(i);
        const px = v.x + c * bx - s * by;
        const py = v.y + s * bx + c * by;
        const rx = px - wl.ax;
        const ry = py - wl.ay;
        const t = rx * tx + ry * ty;
        if (t < -0.05 || t > len + 0.05) continue;
        const dist = rx * wl.nx + ry * wl.ny;
        if (dist >= 0 || dist < -depth) continue;
        const d = -dist;
        if (d > this.bestD[i]) {
          this.bestD[i] = d;
          this.bestW[i] = w;
          any = true;
        }
      }
    }
    if (!any) return;
    const m = v.mass;
    const iz = v.cfg.geometry.Iz;
    const cu = v.u * c - v.v * s;
    const cvw = v.u * s + v.v * c;
    // Tiefste Eindringung je Wand: weichere Barrieren werden nur von den vordersten Punkten verdrängt,
    // Punkte weiter hinten im entstandenen Hohlraum berühren das Material nicht mehr.
    this.wallMaxD.fill(0);
    for (let i = 0; i < n; i++) {
      const wi = this.bestW[i];
      if (wi >= 0 && this.bestD[i] > this.wallMaxD[wi]) this.wallMaxD[wi] = this.bestD[i];
    }
    for (let i = 0; i < n; i++) {
      const wi = this.bestW[i];
      if (wi < 0) continue;
      const wl = walls[wi];
      const wp = WALLS[wl.kind];
      const d = this.bestD[i];
      if (wp.yieldPerM !== Infinity && d < this.wallMaxD[wi] - 0.3) continue;
      const bx = cs.pointX(i);
      const by = cs.pointY(i);
      const rx = c * bx - s * by;
      const ry = s * bx + c * by;
      // Punktgeschwindigkeit (Welt)
      const vpx = cu - v.r * ry;
      const vpy = cvw + v.r * rx;
      const vnClosing = -(vpx * wl.nx + vpy * wl.ny);
      const tx = -wl.ny;
      const ty = wl.nx;
      const vt = vpx * tx + vpy * ty;
      const rn = rx * wl.ny - ry * wl.nx;
      const meff = 1 / (1 / m + (rn * rn) / iz);
      const ds = HULL.ds[i];
      let kw = wp.stiffness * ds;
      let yieldW = wp.yieldPerM * ds;
      if (wp.stroke > 0) {
        if (d > wp.stroke) {
          kw = 3e7;
          yieldW = Infinity;
        } else {
          yieldW *= wp.softStart + (1 - wp.softStart) * (d / wp.stroke);
        }
      }
      const before = cs.plastic[i];
      const f = cs.contact(i, d, vnClosing, kw, yieldW, wp.zeta, wp.unload, meff, dt);
      if (f <= 0) continue;
      const zp = ZONE_PARAMS[HULL.zone[i]];
      const mu = Math.sqrt(zp.mu * wp.mu);
      const ft = (-mu * f * vt) / Math.sqrt(vt * vt + VS * VS);
      const fx = f * wl.nx + ft * tx;
      const fy = f * wl.ny + ft * ty;
      this.addForce(vi, fx, fy, rx, ry, zp.height);
      this.peakContactForce += f;
      this.recordContact(v.x + rx, v.y + ry, wl.nx, wl.ny, f, 0);
      const dp = cs.plastic[i] - before;
      if (dp > 0) this.registerDeformation(vi, i, rx, ry, wl.nx, wl.ny);
    }
  }

  /** Delle und Splitter bei bleibender Verformung. */
  private registerDeformation(vi: number, i: number, rx: number, ry: number, nx: number, ny: number): void {
    const cs = this.crash[vi];
    const zp = ZONE_PARAMS[HULL.zone[i]];
    cs.addDent(HULL.px[i], HULL.py[i], HULL.nx[i], HULL.ny[i], zp.height, cs.plastic[i] * 0.9);
    // Karbon-Splitter: alle ~1.5 kJ plastischer Arbeit ein Stück
    const e = cs.totalEnergy;
    const prev = this.energyBefore;
    if (Math.floor(e / 1500) > Math.floor(prev / 1500)) {
      const v = this.vehicles[vi];
      const count = 1 + Math.floor(this.rand() * 2);
      for (let k = 0; k < count; k++) {
        const ang = Math.atan2(ny, nx) + (this.rand() - 0.5) * 1.6;
        const sp = 2 + this.rand() * 8;
        const cu = v.u * Math.cos(v.psi) - v.v * Math.sin(v.psi);
        const cw = v.u * Math.sin(v.psi) + v.v * Math.cos(v.psi);
        this.bodies.spawn(BODY_SHARD, v.x + rx, v.y + ry, this.rand() * 6.28, cu * 0.6 + Math.cos(ang) * sp, cw * 0.6 + Math.sin(ang) * sp, (this.rand() - 0.5) * 20, 0.25, 1.5 + this.rand() * 3, 0.4, 0.08, (this.rand() - 0.5) * 30, 0);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  private collideBodies(vi: number, dt: number): void {
    const v = this.vehicles[vi];
    const cs = this.crash[vi];
    const B = this.bodies;
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const m = v.mass;
    const iz = v.cfg.geometry.Iz;
    const cu = v.u * c - v.v * s;
    const cvw = v.u * s + v.v * c;
    const reach = HULL.radius + 0.4;
    const n = HULL.n;
    for (let b = 0; b < B.n; b++) {
      if (!B.active[b]) continue;
      const rad = B.radius[b];
      const dxb = B.x[b] - v.x;
      const dyb = B.y[b] - v.y;
      if (dxb > reach + rad || dxb < -reach - rad || dyb > reach + rad || dyb < -reach - rad) continue;
      if (B.z[b] > 0.6) continue;
      const params = DEBRIS_PARAMS[B.kind[b]];
      const mb = B.mass[b];
      for (let i = 0; i < n; i++) {
        if (!cs.isActive(i)) continue;
        const bx = cs.pointX(i);
        const by = cs.pointY(i);
        const rx = c * bx - s * by;
        const ry = s * bx + c * by;
        const ddx = v.x + rx - B.x[b];
        const ddy = v.y + ry - B.y[b];
        const dist = Math.hypot(ddx, ddy);
        if (dist >= rad) continue;
        let nx: number;
        let ny: number;
        if (dist > 1e-4) {
          nx = ddx / dist;
          ny = ddy / dist;
        } else {
          const l = Math.hypot(dxb, dyb) || 1;
          nx = -dxb / l;
          ny = -dyb / l;
        }
        const d = rad - dist;
        const vpx = cu - v.r * ry;
        const vpy = cvw + v.r * rx;
        const vrx = vpx - B.vx[b];
        const vry = vpy - B.vy[b];
        const vnClosing = -(vrx * nx + vry * ny);
        const tx = -ny;
        const ty = nx;
        const vt = vrx * tx + vry * ty;
        const rn = rx * ny - ry * nx;
        const meffCar = 1 / (1 / m + (rn * rn) / iz);
        const meff = 1 / (1 / meffCar + 1 / mb);
        const f = cs.contact(i, d, vnClosing, params.k, params.cap, 0.25, 0.3, meff, dt);
        if (f <= 0) continue;
        const zp = ZONE_PARAMS[HULL.zone[i]];
        const mu = 0.45;
        const ft = (-mu * f * vt) / Math.sqrt(vt * vt + VS * VS);
        const fx = f * nx + ft * tx;
        const fy = f * ny + ft * ty;
        this.addForce(vi, fx, fy, rx, ry, zp.height);
        this.peakContactForce += f;
        B.impulse(b, -fx * dt, -fy * dt);
        if (B.kind[b] !== BODY_CONE || f > 600) this.recordContact(v.x + rx, v.y + ry, nx, ny, f, B.kind[b] === BODY_CONE ? 1 : 2);
        // Kegel steigen auf
        if (B.kind[b] === BODY_CONE && B.z[b] <= 0 && f > 300) B.vz[b] = Math.max(B.vz[b], 1.5 + Math.min(4, f / 2000));
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  /** Auto gegen Auto: Punkte von A im Polygon von B und umgekehrt. */
  private collideCars(ia: number, ib: number, dt: number): void {
    const A = this.vehicles[ia];
    const Bv = this.vehicles[ib];
    const reach = 2 * HULL.radius + 0.2;
    if (Math.abs(A.x - Bv.x) > reach || Math.abs(A.y - Bv.y) > reach) return;
    if (Math.hypot(A.x - Bv.x, A.y - Bv.y) > reach) return;
    this.carPair(ia, ib, dt);
    this.carPair(ib, ia, dt);
  }

  /** Punkte des Fahrzeugs a dringen in die Hülle von Fahrzeug b ein; Kräfte wirken auf beide. */
  private carPair(ia: number, ib: number, dt: number): void {
    const A = this.vehicles[ia];
    const Bv = this.vehicles[ib];
    const csA = this.crash[ia];
    const csB = this.crash[ib];
    const cA = Math.cos(A.psi);
    const sA = Math.sin(A.psi);
    const cB = Math.cos(Bv.psi);
    const sB = Math.sin(Bv.psi);
    const nA = HULL.n;
    const polyN = HULL.polyN;
    const auW = A.u * cA - A.v * sA;
    const avW = A.u * sA + A.v * cA;
    const buW = Bv.u * cB - Bv.v * sB;
    const bvW = Bv.u * sB + Bv.v * cB;
    for (let i = 0; i < nA; i++) {
      if (!csA.isActive(i)) continue;
      const ax = csA.pointX(i);
      const ay = csA.pointY(i);
      const rax = cA * ax - sA * ay;
      const ray = sA * ax + cA * ay;
      const wx = A.x + rax;
      const wy = A.y + ray;
      // in den Rahmen von B
      const dx = wx - Bv.x;
      const dy = wy - Bv.y;
      const lx = cB * dx + sB * dy;
      const ly = -sB * dx + cB * dy;
      if (!HULL.contains(lx, ly)) continue;
      // nächste Kante von B
      let best = Infinity;
      let enx = 0;
      let eny = 0;
      for (let k = 0; k < polyN; k++) {
        const k2 = (k + 1) % polyN;
        const x1 = HULL.polyX[k];
        const y1 = HULL.polyY[k];
        const ex = HULL.polyX[k2] - x1;
        const ey = HULL.polyY[k2] - y1;
        const len2 = ex * ex + ey * ey;
        let t = ((lx - x1) * ex + (ly - y1) * ey) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x1 + ex * t - lx;
        const qy = y1 + ey * t - ly;
        const dd = qx * qx + qy * qy;
        if (dd < best) {
          best = dd;
          const l = Math.sqrt(len2);
          enx = ey / l;
          eny = -ex / l;
        }
      }
      const d = Math.sqrt(best);
      if (d < 1e-5) continue;
      // Normale (Welt): aus B heraus
      const nx = cB * enx - sB * eny;
      const ny = sB * enx + cB * eny;
      // nächster Strukturpunkt von B zum Kontakt (für Steifigkeit/Verformung)
      let jBest = -1;
      let jd = Infinity;
      for (let j = 0; j < HULL.n; j++) {
        if (!csB.isActive(j)) continue;
        const ddx = csB.pointX(j) - lx;
        const ddy = csB.pointY(j) - ly;
        const q = ddx * ddx + ddy * ddy;
        if (q < jd) {
          jd = q;
          jBest = j;
        }
      }
      if (jBest < 0) continue;
      const rbx = wx - Bv.x;
      const rby = wy - Bv.y;
      const vaX = auW - A.r * ray;
      const vaY = avW + A.r * rax;
      const vbX = buW - Bv.r * rby;
      const vbY = bvW + Bv.r * rbx;
      const vrx = vaX - vbX;
      const vry = vaY - vbY;
      const vnClosing = -(vrx * nx + vry * ny);
      const tx = -ny;
      const ty = nx;
      const vt = vrx * tx + vry * ty;
      const rnA = rax * ny - ray * nx;
      const rnB = rbx * ny - rby * nx;
      const mA = 1 / (1 / A.mass + (rnA * rnA) / A.cfg.geometry.Iz);
      const mB = 1 / (1 / Bv.mass + (rnB * rnB) / Bv.cfg.geometry.Iz);
      const meff = 1 / (1 / mA + 1 / mB);
      const kcA = csA.stiffness(i);
      const kcB = csB.stiffness(jBest);
      const keff = (kcA * kcB) / (kcA + kcB);
      const fcA = csA.yieldForce(i);
      const fcB = csB.yieldForce(jBest);
      const fTrial = keff * d;
      const fy = fcA < fcB ? fcA : fcB;
      let f: number;
      if (vnClosing > 0) {
        const elastic = fTrial < fy ? fTrial : fy;
        let fd = 2 * 0.25 * Math.sqrt(keff * meff) * vnClosing;
        const cap = fy === Infinity ? Infinity : fy * 0.35;
        if (fd > cap) fd = cap;
        f = elastic + fd;
        const fmax = limitClosing(meff, vnClosing, dt, keff, d);
        if (f > fmax) f = fmax;
        const pcap = plasticCap(vnClosing, dt);
        if (fTrial > fcA) csA.addPlasticExternal(i, Math.min((fTrial - fcA) / kcA, pcap), fcA);
        if (fTrial > fcB) csB.addPlasticExternal(jBest, Math.min((fTrial - fcB) / kcB, pcap), fcB);
      } else {
        f = (fTrial < fy ? fTrial : fy) * 0.3;
        const fsep = limitSeparating(meff, -vnClosing, dt);
        if (f > fsep) f = fsep;
      }
      if (f <= 0) continue;
      const zA = ZONE_PARAMS[HULL.zone[i]];
      const zB = ZONE_PARAMS[HULL.zone[jBest]];
      const mu = Math.sqrt(zA.mu * zB.mu);
      const ft = (-mu * f * vt) / Math.sqrt(vt * vt + VS * VS);
      const fx = f * nx + ft * tx;
      const fyy = f * ny + ft * ty;
      // Kraft wirkt auf A in +(fx, fyy), auf B entgegengesetzt
      this.addForceTo(ia, fx, fyy, rax, ray, zA.height);
      this.addForceTo(ib, -fx, -fyy, rbx, rby, zB.height);
      this.recordContact(wx, wy, nx, ny, f, 3);
      this.registerDeformationPair(ia, i, ib, jBest, rbx, rby, nx, ny);
    }
  }

  /** Wie addForce, aber für ein beliebiges Fahrzeug (Akkumulatoren werden in pending gehalten). */
  private pendingForce: Array<{ fwx: number; fwy: number; tz: number; fbx: number; fby: number; mp: number; mr: number; peak: number }> | null = null;

  private addForceTo(vi: number, fx: number, fy: number, rx: number, ry: number, height: number): void {
    if (!this.pendingForce) {
      this.pendingForce = this.vehicles.map(() => ({ fwx: 0, fwy: 0, tz: 0, fbx: 0, fby: 0, mp: 0, mr: 0, peak: 0 }));
    }
    const v = this.vehicles[vi];
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const pf = this.pendingForce[vi];
    const fxb = fx * c + fy * s;
    const fyb = -fx * s + fy * c;
    pf.fwx += fx;
    pf.fwy += fy;
    pf.tz += rx * fy - ry * fx;
    pf.fbx += fxb;
    pf.fby += fyb;
    const arm = height - v.cfg.geometry.cgHeight;
    pf.mp += fxb * arm;
    pf.mr += -fyb * arm;
    pf.peak += Math.hypot(fx, fy);
  }

  private registerDeformationPair(ia: number, i: number, ib: number, j: number, rbx: number, rby: number, nx: number, ny: number): void {
    const csA = this.crash[ia];
    const csB = this.crash[ib];
    const zA = ZONE_PARAMS[HULL.zone[i]];
    const zB = ZONE_PARAMS[HULL.zone[j]];
    if (csA.plastic[i] > 0.002) csA.addDent(HULL.px[i], HULL.py[i], HULL.nx[i], HULL.ny[i], zA.height, csA.plastic[i] * 0.9);
    if (csB.plastic[j] > 0.002) csB.addDent(HULL.px[j], HULL.py[j], HULL.nx[j], HULL.ny[j], zB.height, csB.plastic[j] * 0.9);
    void rbx;
    void rby;
    void nx;
    void ny;
  }

  // ---------------------------------------------------------------------------------------------
  private finishAccumulate(vi: number, dt: number): void {
    const v = this.vehicles[vi];
    const cs = this.crash[vi];
    let fbx = this.fbx;
    let fby = this.fby;
    let tz = this.tz;
    let mp = this.mPitch;
    let mr = this.mRoll;
    let peak = this.peakContactForce;
    // Beiträge aus Fahrzeug-Fahrzeug-Kontakten (von anderen Schleifendurchläufen gesammelt)
    if (this.pendingForce) {
      const pf = this.pendingForce[vi];
      fbx += pf.fbx;
      fby += pf.fby;
      tz += pf.tz;
      mp += pf.mp;
      mr += pf.mr;
      peak += pf.peak;
      pf.fwx = pf.fwy = pf.tz = pf.fbx = pf.fby = pf.mp = pf.mr = pf.peak = 0;
    }
    v.extFx = fbx;
    v.extFy = fby;
    v.extMz = tz;
    v.extMPitch = mp;
    v.extMRoll = mr;
    const inContact = peak > 50;
    if (inContact && !this.inContact[vi]) cs.impactSpeed = Math.hypot(v.u, v.v) * 3.6;
    this.inContact[vi] = inContact;
    cs.updateG(Math.hypot(fbx, fby), v.mass, dt);
    // Schleifarbeit (Funken) in die Bodenschäden einrechnen
    if (v.scrapeWork > 0) {
      cs.scrapeEnergy += v.scrapeWork;
      v.scrapeWork = 0;
    }
    cs.evaluate();
    this.applyEffects(vi);
    this.spawnDebris(vi);
  }

  /** Überträgt Schadenszustand auf die Fahrzeugphysik. */
  private applyEffects(vi: number): void {
    const v = this.vehicles[vi];
    const cs = this.crash[vi];
    v.powerScale = cs.retired ? 0 : Math.max(0.12, 1 - 1.3 * Math.max(0, cs.engine - 0.05));
    v.aeroDamageF = (1 - 0.75 * cs.wingFront) * (1 - 0.4 * cs.floor);
    v.aeroDamageR = (1 - 0.7 * cs.wingRear) * (1 - 0.4 * cs.floor);
    v.dragDamage = 1 - 0.06 * cs.wingFront - 0.1 * cs.wingRear + 0.05 * cs.nose;
    v.retired = cs.retired;
    for (let i = 0; i < 4; i++) {
      v.wheelOff[i] = cs.wheelOff[i];
      v.punct[i] = cs.puncture[i];
      v.toe[i] = cs.bent[i];
      v.brakeScale[i] = 1 - 0.55 * Math.min(1, Math.abs(cs.bent[i]) / 0.075);
    }
  }

  private spawnDebris(vi: number): void {
    const v = this.vehicles[vi];
    const cs = this.crash[vi];
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const cu = v.u * c - v.v * s;
    const cw = v.u * s + v.v * c;
    if (cs.pendingWingFront) {
      cs.pendingWingFront = false;
      this.bodies.spawn(BODY_WING_F, v.x + c * 2.8, v.y + s * 2.8, v.psi, cu * 0.75, cw * 0.75, (this.rand() - 0.5) * 6, 0.12, 1.0, 14, 0.55, 0, 0);
    }
    if (cs.pendingWingRear) {
      cs.pendingWingRear = false;
      this.bodies.spawn(BODY_WING_R, v.x - c * 1.9, v.y - s * 1.9, v.psi, cu * 0.8, cw * 0.8, (this.rand() - 0.5) * 8, 0.7, 2.2, 10, 0.45, 0, 0);
    }
    for (let w = 0; w < 4; w++) {
      if (!cs.pendingWheel[w]) continue;
      cs.pendingWheel[w] = 0;
      const wx = v.x + c * v.xw[w] - s * v.yw[w];
      const wy = v.y + s * v.xw[w] + c * v.yw[w];
      const side = v.yw[w] > 0 ? 1 : -1;
      const kick = 3 + this.rand() * 4;
      // Rad rollt nach vorn/außen davon
      const vx = cu * 0.9 + (-s * side) * kick;
      const vy = cw * 0.9 + (c * side) * kick;
      this.bodies.spawn(BODY_WHEEL, wx, wy, v.psi, vx, vy, 0, 0.35, 1.8 + this.rand() * 2, 24, 0.345, v.omega[w], w);
    }
  }

  // ---------------------------------------------------------------------------------------------
  /** Schreibt Zustand inkl. Schäden, Kontakten, Dellen und Körpern in den Snapshot. */
  writeSnapshot(out: Float64Array, index = 0): void {
    const v = this.vehicles[index];
    const cs = this.crash[index];
    v.writeSnapshot(out);
    out[S.dmgNose] = cs.nose;
    out[S.dmgWingF] = cs.wingFront;
    out[S.dmgWingR] = cs.wingRear;
    out[S.dmgFloor] = cs.floor;
    out[S.dmgSideL] = cs.sideL;
    out[S.dmgSideR] = cs.sideR;
    out[S.dmgRear] = cs.rear;
    out[S.dmgEngine] = cs.engine;
    out[S.retired] = cs.retired;
    out[S.crashLevel] = cs.crashLevel;
    out[S.peakG] = cs.peakG;
    out[S.impactSpeed] = cs.impactSpeed;
    out[S.impactEnergy] = cs.totalEnergy / 1000;
    out[S.wallContact] = this.contactCount;
    for (let i = 0; i < 4; i++) {
      out[S.wheelOff + i] = cs.wheelOff[i];
      out[S.puncture + i] = cs.puncture[i];
      out[S.bent + i] = cs.bent[i];
    }
    out.fill(0, S.contacts, S.contacts + MAX_CONTACTS * CONTACT_STRIDE);
    for (let k = 0; k < this.contactCount * CONTACT_STRIDE; k++) out[S.contacts + k] = this.contacts[k];
    for (let k = 0; k < MAX_DENTS * DENT_STRIDE; k++) out[S.dents + k] = cs.dents[k];
    out[S.nBodies] = this.bodies.write(out, S.bodies);
  }
}
