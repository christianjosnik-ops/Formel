import { BODY_CONE, BODY_SHARD, BODY_STRIDE, BODY_WHEEL, BODY_WING_F, BODY_WING_R, MAX_BODIES } from '../layout';
import type { ConeDef, WallDef } from '../../world/provingGround';
import { WALLS } from '../../world/provingGround';

const G = 9.80665;

/**
 * Bewegliche Fremdkörper: Kegel, abgerissene Räder und Flügel, Karbon-Splitter. Kreisförmige
 * Kontaktgeometrie in der Ebene mit einfacher Hubbewegung (Wurf, Aufprall, Rollen).
 * Strukturen-of-Arrays, keine Allokationen im Schritt.
 */
export class BodyPool {
  readonly n = MAX_BODIES;
  readonly active = new Uint8Array(MAX_BODIES);
  readonly kind = new Uint8Array(MAX_BODIES);
  readonly id = new Float64Array(MAX_BODIES);
  readonly x = new Float64Array(MAX_BODIES);
  readonly y = new Float64Array(MAX_BODIES);
  readonly psi = new Float64Array(MAX_BODIES);
  readonly vx = new Float64Array(MAX_BODIES);
  readonly vy = new Float64Array(MAX_BODIES);
  readonly w = new Float64Array(MAX_BODIES);
  readonly z = new Float64Array(MAX_BODIES);
  readonly vz = new Float64Array(MAX_BODIES);
  /** Nick-/Kippwinkel (Kegel) bzw. Rollwinkel (Rad). */
  readonly tilt = new Float64Array(MAX_BODIES);
  /** Rotation um die eigene Achse (Raddrehung). */
  readonly spin = new Float64Array(MAX_BODIES);
  readonly spinRate = new Float64Array(MAX_BODIES);
  readonly mass = new Float64Array(MAX_BODIES);
  readonly radius = new Float64Array(MAX_BODIES);
  /** 1 = liegt in Ruhe (wird nicht simuliert). */
  readonly asleep = new Uint8Array(MAX_BODIES);
  /** 1 = vom Ursprungsort bewegt (muss im Snapshot stehen). */
  readonly displaced = new Uint8Array(MAX_BODIES);
  readonly restX = new Float64Array(MAX_BODIES);
  readonly restY = new Float64Array(MAX_BODIES);
  /** Anzahl der Kegel (Indizes 0..coneCount-1 sind Kegel mit fester Id). */
  coneCount = 0;
  private shardCursor = 0;
  private debrisStart = 0;

  initCones(cones: ConeDef[]): void {
    this.coneCount = cones.length;
    this.debrisStart = cones.length;
    for (let i = 0; i < cones.length; i++) {
      this.active[i] = 1;
      this.kind[i] = BODY_CONE;
      this.id[i] = i;
      this.restX[i] = this.x[i] = cones[i].x;
      this.restY[i] = this.y[i] = cones[i].y;
      this.psi[i] = 0;
      this.mass[i] = 1.8;
      this.radius[i] = 0.24;
      this.asleep[i] = 1;
      this.displaced[i] = 0;
    }
  }

  resetAll(): void {
    for (let i = 0; i < this.n; i++) {
      if (i < this.coneCount) {
        this.x[i] = this.restX[i];
        this.y[i] = this.restY[i];
        this.vx[i] = this.vy[i] = this.vz[i] = this.w[i] = this.z[i] = this.tilt[i] = this.spin[i] = this.psi[i] = 0;
        this.asleep[i] = 1;
        this.displaced[i] = 0;
      } else {
        this.active[i] = 0;
        this.displaced[i] = 0;
      }
    }
  }

  wake(i: number): void {
    this.asleep[i] = 0;
    this.displaced[i] = 1;
  }

  /** Trümmerteil erzeugen. Gibt den Index zurück oder -1. */
  spawn(kind: number, x: number, y: number, psi: number, vx: number, vy: number, w: number, z: number, vz: number, mass: number, radius: number, spinRate: number, id: number): number {
    let slot = -1;
    if (kind === BODY_SHARD) {
      // Splitter: Ringpuffer über die hintere Hälfte des Debris-Bereichs
      const span = Math.max(1, Math.floor((this.n - this.debrisStart) / 2));
      slot = this.n - 1 - (this.shardCursor++ % span);
    } else {
      for (let i = this.debrisStart; i < this.n; i++) {
        if (!this.active[i]) {
          slot = i;
          break;
        }
      }
    }
    if (slot < 0) return -1;
    this.active[slot] = 1;
    this.kind[slot] = kind;
    this.id[slot] = id;
    this.x[slot] = x;
    this.y[slot] = y;
    this.psi[slot] = psi;
    this.vx[slot] = vx;
    this.vy[slot] = vy;
    this.w[slot] = w;
    this.z[slot] = z;
    this.vz[slot] = vz;
    this.tilt[slot] = 0;
    this.spin[slot] = 0;
    this.spinRate[slot] = spinRate;
    this.mass[slot] = mass;
    this.radius[slot] = radius;
    this.asleep[slot] = 0;
    this.displaced[slot] = 1;
    return slot;
  }

  private groundDecel(kind: number): number {
    switch (kind) {
      case BODY_CONE:
        return 0.55 * G;
      case BODY_WHEEL:
        return 0.045 * G;
      case BODY_WING_F:
      case BODY_WING_R:
        return 0.5 * G;
      default:
        return 0.75 * G;
    }
  }

  step(dt: number, walls: WallDef[]): void {
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i] || this.asleep[i]) continue;
      const kind = this.kind[i];
      // Hub: freier Flug und Aufprall
      if (this.z[i] > 0 || this.vz[i] > 0) {
        this.vz[i] -= G * dt;
        this.z[i] += this.vz[i] * dt;
        if (this.z[i] <= 0) {
          this.z[i] = 0;
          if (this.vz[i] < -1.5) {
            this.vz[i] = -this.vz[i] * 0.32;
            this.vx[i] *= 0.85;
            this.vy[i] *= 0.85;
            this.w[i] *= 0.8;
          } else this.vz[i] = 0;
        }
      }
      const onGround = this.z[i] <= 0;
      const sp = Math.hypot(this.vx[i], this.vy[i]);
      if (onGround && sp > 0) {
        const dec = this.groundDecel(kind) * dt;
        const k = sp > dec ? 1 - dec / sp : 0;
        this.vx[i] *= k;
        this.vy[i] *= k;
        this.w[i] *= 1 - Math.min(1, dt * (kind === BODY_WHEEL ? 0.2 : 1.6));
      }
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.psi[i] += this.w[i] * dt;
      const spNow = Math.hypot(this.vx[i], this.vy[i]);
      if (kind === BODY_WHEEL) {
        // rollt: Drehung folgt der Bahngeschwindigkeit
        this.spin[i] += (spNow / Math.max(0.1, this.radius[i])) * dt;
        if (spNow > 0.3) this.psi[i] = Math.atan2(this.vy[i], this.vx[i]);
        // langsam werdend kippt das Rad um
        if (spNow < 4 && this.z[i] <= 0) this.tilt[i] = Math.min(Math.PI / 2, this.tilt[i] + dt * (4 - spNow) * 0.6);
      } else if (kind === BODY_CONE) {
        // kippt beim Rutschen/Fliegen und bleibt liegend
        this.tilt[i] += (spNow * 1.6 + Math.abs(this.w[i])) * dt;
        if (this.tilt[i] > Math.PI / 2 && spNow < 6) this.tilt[i] = Math.PI / 2;
      } else {
        this.spin[i] += this.spinRate[i] * dt;
      }
      if (kind === BODY_CONE && spNow > 0.05 && this.z[i] <= 0) this.psi[i] = Math.atan2(this.vy[i], this.vx[i]);

      // Wände
      const r = this.radius[i];
      const px = this.x[i];
      const py = this.y[i];
      for (let s = 0; s < walls.length; s++) {
        const wl = walls[s];
        const minx = Math.min(wl.ax, wl.bx) - r;
        const maxx = Math.max(wl.ax, wl.bx) + r;
        if (px < minx || px > maxx) continue;
        const miny = Math.min(wl.ay, wl.by) - r;
        const maxy = Math.max(wl.ay, wl.by) + r;
        if (py < miny || py > maxy) continue;
        const dx = wl.bx - wl.ax;
        const dy = wl.by - wl.ay;
        const len = Math.hypot(dx, dy);
        const tx = dx / len;
        const ty = dy / len;
        const rx = px - wl.ax;
        const ry = py - wl.ay;
        const t = rx * tx + ry * ty;
        if (t < 0 || t > len) continue;
        const dist = rx * wl.nx + ry * wl.ny;
        const depth = WALLS[wl.kind].depth;
        if (dist < r && dist > -depth) {
          this.x[i] += wl.nx * (r - dist);
          this.y[i] += wl.ny * (r - dist);
          const vn = this.vx[i] * wl.nx + this.vy[i] * wl.ny;
          if (vn < 0) {
            const e = wl.kind === 'tire' ? 0.15 : 0.38;
            this.vx[i] -= (1 + e) * vn * wl.nx;
            this.vy[i] -= (1 + e) * vn * wl.ny;
          }
        }
      }
      // Ruhe
      if (onGround && spNow < 0.06 && Math.abs(this.w[i]) < 0.1) {
        this.vx[i] = this.vy[i] = 0;
        this.w[i] = 0;
        if (kind === BODY_CONE || kind === BODY_WHEEL) this.tilt[i] = Math.PI / 2;
        this.asleep[i] = 1;
      }
    }
  }

  /** Stoß auf einen Körper (Ns). */
  impulse(i: number, jx: number, jy: number): void {
    this.vx[i] += jx / this.mass[i];
    this.vy[i] += jy / this.mass[i];
    if (this.asleep[i]) this.wake(i);
  }

  write(buf: Float64Array, offset: number): number {
    let count = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.active[i] || (!this.displaced[i] && i < this.coneCount)) continue;
      const o = offset + count * BODY_STRIDE;
      buf[o] = this.kind[i];
      buf[o + 1] = this.x[i];
      buf[o + 2] = this.y[i];
      buf[o + 3] = this.psi[i];
      buf[o + 4] = this.z[i];
      buf[o + 5] = this.tilt[i];
      buf[o + 6] = this.spin[i];
      buf[o + 7] = this.id[i];
      count++;
      if (count >= MAX_BODIES) break;
    }
    return count;
  }
}
