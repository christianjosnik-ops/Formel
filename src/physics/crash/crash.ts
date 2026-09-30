import { DENT_STRIDE, MAX_DENTS } from '../layout';
import { HULL, ZONE, ZONE_COUNT, ZONE_PARAMS } from './hull';

/** Maximale Steifigkeit je Kontaktpunkt (Stabilität des expliziten Integrators bei 500 Hz). */
const K_MAX = 3.0e7;
/** Linienlast der versagenden Struktur nach aufgebrauchtem Knautschweg [N/m]. */
const Q_HARD = 2.4e6;
/** Maximale Gesamtverformung eines Punktes [m]. */
const MAX_PLASTIC = 2.0;

/** Schadens-Schwellen [J] */
const E_WING_F_DETACH = 2400;
const E_WING_R_DETACH = 3000;
const E_WHEEL_TEAR = 24e3;
const E_WHEEL_BENT = 14e3;
const E_WHEEL_PUNCT0 = 3e3;
const E_WHEEL_PUNCT1 = 10e3;

/** Maximale plastische Verformung in einem Schritt: die tatsächliche Annäherung (mit kleiner Toleranz). */
export function plasticCap(vn: number, dt: number): number {
  return (vn > 0 ? vn * dt : 0) * 1.05 + 2e-5;
}

/** Obere Grenze der Kontaktkraft beim Schließen: Annäherung höchstens leicht umkehren (keine Energieeinspeisung). */
export function limitClosing(meff: number, vn: number, dt: number, keff: number, d: number): number {
  return (meff * vn * 1.3) / dt + keff * (d < 0.004 ? d : 0.004);
}

/** Obere Grenze beim Trennen: Rückprallgeschwindigkeit begrenzen (vsep = aktuelle Trenngeschwindigkeit). */
export function limitSeparating(meff: number, vsep: number, dt: number, vmax = 3.0): number {
  const room = vmax - vsep;
  return room > 0 ? (meff * room) / dt : 0;
}

export interface ContactEvent {
  x: number;
  y: number;
  nx: number;
  ny: number;
  force: number;
  kind: number;
}

/**
 * Crash-Zustand eines Autos: bleibende Verformung je Kontaktpunkt, aufgenommene Energie je Zone,
 * Bauteilschäden, Beschleunigungsspitzen und Dellen für die Darstellung.
 */
export class CrashState {
  /** Bleibende Einwärtsverschiebung je Punkt [m]. */
  readonly plastic = new Float64Array(HULL.n);
  /** Plastisch aufgenommene Arbeit je Zone [J]. */
  readonly energy = new Float64Array(ZONE_COUNT);
  readonly wheelOff = new Float64Array(4);
  readonly puncture = new Float64Array(4);
  readonly bent = new Float64Array(4); // Spurversatz [rad]
  readonly dents = new Float64Array(MAX_DENTS * DENT_STRIDE);

  wingFront = 0;
  wingRear = 0;
  nose = 0;
  floor = 0;
  sideL = 0;
  sideR = 0;
  rear = 0;
  engine = 0;
  retired = 0;
  crashLevel = 0;
  peakG = 0;
  /** Gefilterte momentane Beschleunigung durch Kontakte [g]. */
  gNow = 0;
  impactSpeed = 0;
  totalEnergy = 0;
  scrapeEnergy = 0;
  /** Ereignisse seit dem letzten Abholen (Flügel/Rad abgerissen), für die Trümmer-Erzeugung. */
  pendingWingFront = false;
  pendingWingRear = false;
  readonly pendingWheel = new Uint8Array(4);
  private wingFrontGone = false;
  private wingRearGone = false;

  reset(): void {
    this.plastic.fill(0);
    this.energy.fill(0);
    this.wheelOff.fill(0);
    this.puncture.fill(0);
    this.bent.fill(0);
    this.dents.fill(0);
    this.wingFront = this.wingRear = this.nose = this.floor = 0;
    this.sideL = this.sideR = this.rear = this.engine = 0;
    this.retired = 0;
    this.crashLevel = 0;
    this.peakG = 0;
    this.gNow = 0;
    this.impactSpeed = 0;
    this.totalEnergy = 0;
    this.scrapeEnergy = 0;
    this.pendingWingFront = this.pendingWingRear = false;
    this.pendingWheel.fill(0);
    this.wingFrontGone = this.wingRearGone = false;
  }

  /** Einwärts-versetzte aktuelle Position des Punktes (Karosserie). */
  pointX(i: number): number {
    return HULL.px[i] - HULL.nx[i] * this.plastic[i];
  }
  pointY(i: number): number {
    return HULL.py[i] - HULL.ny[i] * this.plastic[i];
  }

  isActive(i: number): boolean {
    const z = HULL.zone[i];
    switch (z) {
      case ZONE.WING_F:
        return !this.wingFrontGone;
      case ZONE.WING_R:
        return !this.wingRearGone;
      case ZONE.WHEEL_FL:
        return this.wheelOff[0] < 0.5;
      case ZONE.WHEEL_FR:
        return this.wheelOff[1] < 0.5;
      case ZONE.WHEEL_RL:
        return this.wheelOff[2] < 0.5;
      case ZONE.WHEEL_RR:
        return this.wheelOff[3] < 0.5;
      default:
        return true;
    }
  }

  /** Elastische Steifigkeit des Punktes (Kontaktpunkt-Feder) [N/m]. */
  stiffness(i: number): number {
    const zp = ZONE_PARAMS[HULL.zone[i]];
    const k = (zp.q * HULL.ds[i]) / zp.yieldDefl;
    return k > K_MAX ? K_MAX : k;
  }

  /** Fließkraft des Punktes [N] (Infinity, wenn der Knautschweg aufgebraucht ist = starr). */
  yieldForce(i: number): number {
    const zp = ZONE_PARAMS[HULL.zone[i]];
    // Aufgebrauchter Knautschweg: Struktur versagt bei sehr hoher Last weiter (kein starres Anschlagen)
    if (this.plastic[i] >= HULL.crush[i]) return Q_HARD * HULL.ds[i];
    return zp.q * HULL.ds[i];
  }

  /**
   * Kontaktgesetz eines Kontaktpunktes (elasto-plastisch). Gibt die Normalkraft [N] zurück und
   * aktualisiert Verformung und Energie.
   * @param d Eindringtiefe [m] (>0)
   * @param vn Annäherungsgeschwindigkeit entlang der Normalen [m/s] (>0 = schließt)
   * @param kw Steifigkeit des Gegenübers je Punkt [N/m]
   * @param yieldW Fließkraft des Gegenübers je Punkt [N] (Infinity = starr/elastisch)
   * @param zeta Dämpfungsgrad beim Eindringen
   * @param unload Kraftanteil beim Zurückfedern
   * @param meff effektive Masse am Kontaktpunkt [kg]
   */
  contact(i: number, d: number, vn: number, kw: number, yieldW: number, zeta: number, unload: number, meff: number, dt: number): number {
    const kc = this.stiffness(i);
    const keff = (kc * kw) / (kc + kw);
    const fc = this.yieldForce(i);
    if (this.plastic[i] >= HULL.crush[i]) unload *= 0.25;
    const fTrial = keff * d;
    const fy = fc < yieldW ? fc : yieldW;
    let f: number;
    if (vn > 0) {
      const elastic = fTrial < fy ? fTrial : fy;
      const c = 2 * zeta * Math.sqrt(keff * meff);
      let fd = c * vn;
      // Dämpfung darf das Plateau nur begrenzt überschreiten, außer im elastischen Bereich
      const cap = fy === Infinity ? Infinity : fy * 0.35;
      if (fd > cap) fd = cap;
      f = elastic + fd;
      // Kraftstoß begrenzen: die Annäherung wird höchstens (mit kleiner Restitution) umgekehrt
      const fmax = limitClosing(meff, vn, dt, keff, d);
      if (f > fmax) f = fmax;
      // Plastische Verformung, wenn der Punkt fließt
      if (fTrial > fc && fc < yieldW) {
        // Verformung höchstens um die tatsächliche Annäherung in diesem Schritt (Arbeit = Kraft * Weg)
        const dp = Math.min((fTrial - fc) / kc, plasticCap(vn, dt));
        this.addPlastic(i, dp, fc);
      }
    } else {
      const elastic = fTrial < fy ? fTrial : fy;
      f = elastic * unload;
      const fsep = limitSeparating(meff, -vn, dt);
      if (f > fsep) f = fsep;
    }
    return f;
  }

  /** Plastische Verformung von außen (Auto-Auto-Kontakt). */
  addPlasticExternal(i: number, dp: number, fc: number): void {
    this.addPlastic(i, dp, fc);
  }

  private addPlastic(i: number, dp: number, fc: number): void {
    const z = HULL.zone[i];
    const room = MAX_PLASTIC - this.plastic[i];
    const step = dp < room ? dp : room;
    if (step <= 0) return;
    this.plastic[i] += step;
    const e = fc * step;
    this.energy[z] += e;
    this.totalEnergy += e;
  }

  /** Beschleunigung durch Kontakte filtern (3 ms Zeitkonstante, FIA-ähnlich). */
  updateG(forceMagnitude: number, mass: number, dt: number): void {
    const g = forceMagnitude / (mass * 9.80665);
    this.gNow += (g - this.gNow) * Math.min(1, dt / 0.003);
    if (this.gNow > this.peakG) this.peakG = this.gNow;
  }

  /** Leitet aus Energien und Verformungen Bauteilschäden ab. Einmal pro Schritt aufrufen. */
  evaluate(): void {
    const E = this.energy;
    const prevWF = this.wingFront;
    void prevWF;
    this.wingFront = Math.min(1, E[ZONE.WING_F] / E_WING_F_DETACH);
    this.wingRear = Math.min(1, E[ZONE.WING_R] / E_WING_R_DETACH);
    if (this.wingFront >= 1 && !this.wingFrontGone) {
      this.wingFrontGone = true;
      this.pendingWingFront = true;
    }
    if (this.wingRear >= 1 && !this.wingRearGone) {
      this.wingRearGone = true;
      this.pendingWingRear = true;
    }
    this.nose = this.crushRatio(ZONE.NOSE);
    this.sideL = this.crushRatio(ZONE.SIDE_L);
    this.sideR = this.crushRatio(ZONE.SIDE_R);
    this.rear = this.crushRatio(ZONE.REAR);

    const wheelZones = [ZONE.WHEEL_FL, ZONE.WHEEL_FR, ZONE.WHEEL_RL, ZONE.WHEEL_RR];
    let off = 0;
    for (let w = 0; w < 4; w++) {
      const e = E[wheelZones[w]];
      const sign = w % 2 === 0 ? 1 : -1;
      this.bent[w] = sign * 0.075 * Math.min(1, e / E_WHEEL_BENT);
      this.puncture[w] = Math.max(this.puncture[w], Math.min(1, Math.max(0, (e - E_WHEEL_PUNCT0) / (E_WHEEL_PUNCT1 - E_WHEEL_PUNCT0))));
      if (e > E_WHEEL_TEAR && this.wheelOff[w] < 0.5) {
        this.wheelOff[w] = 1;
        this.pendingWheel[w] = 1;
      }
      if (this.wheelOff[w] > 0.5) off++;
    }

    // Antrieb: Seitenkasten (Kühler), Heck (Getriebe), Nase (Monocoque-Überlast)
    const engine = (0.9 * (E[ZONE.SIDE_L] + E[ZONE.SIDE_R])) / 70e3 + (1.0 * E[ZONE.REAR]) / 90e3 + (0.5 * E[ZONE.NOSE]) / 240e3 + (0.8 * E[ZONE.CELL]) / 20e3;
    this.engine = Math.min(1, engine);
    // Unterboden: Schleifen + Seitenschläge
    this.floor = Math.min(1, (0.35 * (E[ZONE.SIDE_L] + E[ZONE.SIDE_R])) / 40e3 + this.scrapeEnergy / 70e3 + (0.2 * E[ZONE.NOSE]) / 100e3);

    // Aufgabe: Motor zerstört, zwei Räder weg, Überlebenszelle überlastet oder extreme Verzögerung
    if (this.engine >= 0.98 || off >= 2 || E[ZONE.CELL] > 14e3 || this.peakG > 110) this.retired = 1;
    this.crashLevel = this.peakG < 6 ? 0 : this.peakG < 15 ? 1 : this.peakG < 40 ? 2 : this.peakG < 80 ? 3 : 4;
    if (this.retired && this.crashLevel < 2) this.crashLevel = 2;
  }

  private crushRatio(zone: number): number {
    let m = 0;
    for (let i = 0; i < HULL.n; i++) {
      if (HULL.zone[i] !== zone) continue;
      const r = this.plastic[i] / HULL.crush[i];
      if (r > m) m = r;
    }
    return Math.min(1, m);
  }

  /**
   * Delle auf der Karosserie vormerken. Position/Richtung in GLB-Karosseriekoordinaten
   * (x vorn, y oben, z rechts).
   */
  addDent(bx: number, by: number, nxOut: number, nyOut: number, height: number, depth: number): void {
    const px = bx;
    const py = height;
    const pz = -by;
    const dx = -nxOut;
    const dz = nyOut; // nach innen, z = -y
    let slot = -1;
    let weakest = 0;
    let weakDepth = Infinity;
    for (let k = 0; k < MAX_DENTS; k++) {
      const o = k * DENT_STRIDE;
      const dpth = this.dents[o + 6];
      if (dpth > 0) {
        const dist = Math.hypot(this.dents[o] - px, this.dents[o + 2] - pz);
        if (dist < 0.3) {
          slot = k;
          break;
        }
      } else if (slot < 0) slot = k;
      if (dpth < weakDepth) {
        weakDepth = dpth;
        weakest = k;
      }
    }
    if (slot < 0) slot = weakest;
    const o = slot * DENT_STRIDE;
    if (this.dents[o + 6] <= 0) {
      this.dents[o] = px;
      this.dents[o + 1] = py;
      this.dents[o + 2] = pz;
      this.dents[o + 3] = dx;
      this.dents[o + 4] = 0;
      this.dents[o + 5] = dz;
      this.dents[o + 7] = 0.3;
    }
    if (depth > this.dents[o + 6]) this.dents[o + 6] = Math.min(0.42, depth);
    this.dents[o + 7] = Math.min(0.7, 0.3 + depth * 0.6);
  }
}
