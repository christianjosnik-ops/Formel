import type { Vehicle } from '../physics/vehicle';
import { brakeLimit, type RacingLine } from './line';

export interface AIParams {
  /** Grundtempo als Faktor der Profilgeschwindigkeit (Fahrer-Pace, KI-Stärke). */
  pace: number;
  /** 0..1: hoch = kaum Fehler. */
  consistency: number;
  /** 0..1: Bereitschaft zum Überholen. */
  racecraft: number;
  seed: number;
}

export interface NearCar {
  /** Abstand entlang der Strecke [m], >0 = vor mir. */
  gap: number;
  /** Querposition zur Mittellinie (links +). */
  lat: number;
  speed: number;
}

export type AIMode = 'hold' | 'race' | 'cooldown';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHEELBASE = 3.4;

/**
 * KI-Fahrer: fährt die Ideallinie (Pure Pursuit), regelt die Geschwindigkeit auf das Profil, folgt und überholt
 * andere Autos, macht je nach Konstanz kleine Fehler. Nutzt dieselbe Physik wie der Spieler; Eingaben gehen
 * ausschließlich über die Fahrzeug-Eingabe (Lenkung, Gas, Bremse, Aero).
 */
export class AIDriver {
  idx = 0;
  lat = 0; // aktueller Querversatz der Soll-Linie (relativ zur Ideallinie)
  private latTarget = 0;
  private side = 0; // laufendes Überholmanöver: -1 rechts, +1 links
  private err = 0;
  private mistake = 0;
  private stuck = 0;
  private readonly rnd: () => number;
  private readonly pt = { x: 0, y: 0 };
  /** Vom Regler berechnete Sollgeschwindigkeit (für Tests/Anzeige). */
  targetSpeed = 0;
  /** Zusätzlicher Querversatz (Startaufstellung: Spur halten, später auf 0 abbauen). */
  laneBias = 0;

  constructor(
    private readonly line: RacingLine,
    readonly params: AIParams,
  ) {
    this.rnd = rng(params.seed);
  }

  /** Streckenindex des Fahrzeugs bestimmen (mit Suchfenster um den letzten Index). */
  locate(x: number, y: number): number {
    const t = this.line.track;
    const n = t.n;
    let best = this.idx;
    let bd = (x - t.x[best]) ** 2 + (y - t.y[best]) ** 2;
    if (bd > 30 * 30) {
      const j = t.nearest(x, y);
      if (j >= 0) {
        best = j;
        bd = (x - t.x[j]) ** 2 + (y - t.y[j]) ** 2;
      }
    }
    for (let k = -4; k <= 14; k++) {
      const j = (this.idx + k + n) % n;
      const d = (x - t.x[j]) ** 2 + (y - t.y[j]) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    this.idx = best;
    return best;
  }

  reset(idx: number): void {
    this.idx = idx;
    this.lat = 0;
    this.latTarget = 0;
    this.side = 0;
    this.mistake = 0;
    this.err = 0;
    this.stuck = 0;
    this.laneBias = 0;
  }

  update(dt: number, v: Vehicle, mode: AIMode, ahead: NearCar | null, beside: NearCar | null, level = 1): void {
    const line = this.line;
    const t = line.track;
    const n = line.n;
    const inp = v.input;
    inp.tc = 2;
    inp.abs = 1;
    inp.steerAssist = 0;

    if (mode === 'hold') {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = 0;
      inp.aeroX = 0;
      return;
    }
    const speed = Math.hypot(v.u, v.v);
    const idx = this.locate(v.x, v.y);
    // Reifengrip (Temperatur, Verschleiß) bestimmt das fahrbare Tempo: schlechtere Reifen, vorsichtigere Fahrweise
    const gAvg = 0.25 * (v.tyreGrip[0] + v.tyreGrip[1] + v.tyreGrip[2] + v.tyreGrip[3]);
    level *= Math.pow(Math.min(1.03, gAvg / 0.985), 0.75);

    // ---- Fehler-Modell: langsames Rauschen des Tempos, seltene Fehlversuche ----
    const sigma = (1 - this.params.consistency) * 0.03;
    this.err += (-this.err / 4 + sigma * 3 * (this.rnd() - 0.5)) * dt * 2;
    if (this.mistake > 0) this.mistake -= dt;
    else if (this.rnd() < (1 - this.params.consistency) * 0.004 * dt * 60 * 0.12 && speed > 25) this.mistake = 1.4;

    // ---- Überholen / Folgen ----
    const myLat = t.lateral(idx, v.x, v.y);
    let vCap = 1e9;
    if (ahead && ahead.gap < 55 + speed * 1.6) {
      const sameLane = Math.abs(ahead.lat - myLat) < 3.3;
      const prof = line.speed[(idx + Math.round(speed * 0.3 / t.ds)) % n] * this.params.pace * level;
      if (this.side === 0 && ahead.gap < 26 && sameLane && (prof > ahead.speed + 0.3 || ahead.speed < 12) && this.rnd() < 0.05 + 0.6 * this.params.racecraft) {
        const mid = 0.5 * (line.lo[idx] + line.hi[idx]);
        this.side = ahead.lat < mid ? 1 : -1;
      }
      if (this.side !== 0) {
        if (ahead.gap < -9 || ahead.gap > 70) this.side = 0;
        else {
          const target = ahead.lat + this.side * 3.1;
          const off = line.offset[idx];
          this.latTarget = Math.min(Math.max(target, line.lo[idx] - 0.3), line.hi[idx] + 0.3) - off;
        }
      }
      if (this.side === 0) this.latTarget = 0;
      // Abstandsregelung: im gleichen Streifen nicht auffahren
      if (sameLane || Math.abs(this.latTarget + line.offset[idx] - ahead.lat) < 2.4) {
        // sicherer Abstand: aus dem Tempo des Vordermanns mit moderater Verzögerung noch anhaltbar
        const room = Math.max(0, ahead.gap - 9.5);
        const a = 0.42 * brakeLimit(speed);
        vCap = Math.sqrt(ahead.speed * ahead.speed + 2 * a * room);
        if (room < 3) vCap = Math.min(vCap, ahead.speed * 0.92);
      }
    } else {
      this.side = 0;
      this.latTarget = 0;
    }
    if (beside) {
      // nebeneinander: Platz lassen
      const d = beside.lat - myLat;
      if (Math.abs(d) < 3.2) this.latTarget = Math.min(Math.max(this.latTarget - Math.sign(d || 1) * 1.1, -4), 4);
    }
    const rate = 1.7 * dt;
    const goal = this.latTarget + this.laneBias;
    this.lat += Math.min(rate, Math.max(-rate, goal - this.lat));

    // ---- Lenkung: Pure Pursuit ----
    const Ld = Math.max(7, 4.5 + 0.3 * speed);
    const steps = Math.max(1, Math.round(Ld / t.ds));
    line.pointAt(idx + steps, this.lat, this.pt);
    const dx = this.pt.x - v.x;
    const dy = this.pt.y - v.y;
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const bx = c * dx + s * dy;
    const by = -s * dx + c * dy;
    const alpha = Math.atan2(by, Math.max(bx, 0.5));
    let delta = Math.atan2(2 * WHEELBASE * Math.sin(alpha), Ld);
    // Dämpfung: Gierrate gegenüber der vom Soll-Radius geforderten begrenzen
    const yawDes = (speed * Math.sin(alpha) * 2) / Ld;
    delta += 0.18 * (yawDes - v.r) * (WHEELBASE / Math.max(speed, 6));
    const maxS = v.maxSteerAt(speed, 0);
    inp.steer = Math.max(-1, Math.min(1, delta / maxS));

    // ---- Geschwindigkeit ----
    const look = Math.max(1, Math.round((speed * 0.2) / t.ds));
    let vt = line.speed[(idx + look) % n] * this.params.pace * level * (1 + this.err);
    if (this.mistake > 0) vt *= 1.07;
    // Bahnfehler: bei großer Abweichung zurücknehmen
    const latErr = Math.abs(by);
    vt *= 1 - Math.min(0.5, Math.max(0, latErr - 1.6) * 0.09);
    if (Math.abs(alpha) > 0.7) vt = Math.min(vt, 18);
    if (mode === 'cooldown') vt = Math.min(vt * 0.55, 42);
    vt = Math.min(vt, vCap);
    this.targetSpeed = vt;
    const e = vt - speed;
    // Bremsvorausschau: benötigte Verzögerung bis zum nächsten langsameren Profilpunkt
    let aReq = 0;
    {
      let dist = 0;
      const scale = this.params.pace * level * (1 + this.err) * (this.mistake > 0 ? 1.07 : 1);
      const horizon = Math.min(80, Math.ceil((speed * speed) / (2 * 25) / t.ds) + 12);
      for (let k = 0; k < horizon; k++) {
        const j = (idx + k) % n;
        dist += line.seg[j];
        const vp = line.speed[(j + 1) % n] * scale;
        if (speed > vp) {
          const a = (speed * speed - vp * vp) / (2 * Math.max(dist - 5, 2));
          if (a > aReq) aReq = a;
        }
      }
    }
    const avail = (brakeLimit(speed) / 0.92) * 0.96;
    const ff = aReq / avail;
    let brake = 0;
    // erst am Bremspunkt des Profils voll bremsen (spät und hart), nicht früh und sanft
    if (ff > 0.86) brake = Math.min(1, ff * 1.04);
    if (e < -1.2) brake = Math.max(brake, Math.min(1, 0.06 + -e * 0.055));
    if (brake > 0) {
      inp.throttle = 0;
      inp.brake = brake;
    } else if (e >= 0) {
      inp.throttle = Math.min(1, 0.3 + e * 0.35);
      inp.brake = 0;
    } else {
      inp.throttle = 0;
      inp.brake = 0;
    }
    // Aktive Aero: X-Modus, wenn auf den nächsten 250 m nichts Enges kommt
    let straight = speed > 40;
    for (let k = 1; k <= 45 && straight; k += 5) if (line.speed[(idx + k) % n] < 66) straight = false;
    inp.aeroX = straight && inp.brake === 0 ? 1 : 0;

    // ---- Steckenbleiben erkennen ----
    if (speed < 1.5 && mode === 'race') this.stuck += dt;
    else this.stuck = 0;
  }

  /** Sekunden, die das Auto im Rennen stillsteht (für Bergung/Zurücksetzen). */
  get stuckTime(): number {
    return this.stuck;
  }
}
