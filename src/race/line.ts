import type { Track } from '../world/track';

/**
 * Ideallinie und Geschwindigkeitsprofil einer Strecke für die KI.
 * - Querversatz je Stützstelle durch iteratives Begradigen (Kurven schneiden, Scheitelpunkte treffen)
 *   innerhalb der Streckenbreite
 * - maximale Kurvengeschwindigkeit aus der Kurvenkrümmung und der vom Abtrieb abhängigen Querbeschleunigung
 * - Vorwärts-/Rückwärtsdurchlauf für Beschleunigungs- und Bremsgrenzen
 * Die Grenzen des Fahrzeugs stammen aus der Kalibrierung der Physik (tests/vehicle.test.ts), mit Sicherheitsabschlag.
 */

const G = 9.80665;

/** Maximale Querbeschleunigung [m/s^2] in Abhängigkeit der Geschwindigkeit (Abtrieb). */
export function lateralLimit(v: number): number {
  const a = 1.85 + 2.0 * (1 - Math.exp(-((v / 48) ** 2)));
  return a * G * 0.96;
}

/** Maximale Bremsverzögerung [m/s^2]. */
export function brakeLimit(v: number): number {
  return (23 + 0.0042 * v * v) * 0.92;
}

/** Maximale Beschleunigung [m/s^2] (Traktion/Leistung/Luftwiderstand). */
export function accelLimit(v: number): number {
  const power = 430e3 / (868 * Math.max(v, 4));
  const traction = 13.5;
  return Math.min(traction, power) - 0.00066 * v * v;
}

export class RacingLine {
  readonly n: number;
  /** Querversatz der Ideallinie zur Mittellinie (links +). */
  readonly offset: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly curv: Float64Array;
  /** Zulässige Querversätze (mit Sicherheitsabstand). */
  readonly lo: Float64Array;
  readonly hi: Float64Array;
  /** Geschwindigkeitsprofil der Ideallinie [m/s]. */
  readonly speed: Float64Array;
  /** Bogenlänge entlang der Linie zwischen i und i+1. */
  readonly seg: Float64Array;

  constructor(
    readonly track: Track,
    margin = 0.95,
  ) {
    const n = track.n;
    this.n = n;
    const lo = new Float64Array(n);
    const hi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Reifenaußenkante bis an die Linie, Kerbs dürfen teilweise mitgenommen werden
      lo[i] = -(track.wr[i] - margin + 0.6 * track.kerbR[i]);
      hi[i] = track.wl[i] - margin + 0.6 * track.kerbL[i];
    }
    this.lo = lo;
    this.hi = hi;
    // --- Querversatz: Relaxation Richtung Mittelwert der Nachbarn (kürzester Weg) ---
    let a = new Float64Array(n);
    for (let iter = 0; iter < 500; iter++) {
      for (let i = 0; i < n; i++) {
        const t = 0.5 * (a[(i + n - 1) % n] + a[(i + 1) % n]);
        let v = a[i] + 1.6 * (t - a[i]);
        if (v < lo[i]) v = lo[i];
        else if (v > hi[i]) v = hi[i];
        a[i] = v;
      }
    }
    // zusätzliche Glättung gegen Knicke
    for (let pass = 0; pass < 25; pass++) {
      const b = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let v = 0.25 * a[(i + n - 1) % n] + 0.5 * a[i] + 0.25 * a[(i + 1) % n];
        if (v < lo[i]) v = lo[i];
        else if (v > hi[i]) v = hi[i];
        b[i] = v;
      }
      a = b;
    }
    this.offset = a;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = track.x[i] + track.nx(i) * a[i];
      this.y[i] = track.y[i] + track.ny(i) * a[i];
    }
    // --- Krümmung der Linie (Menger, geglättet) ---
    this.seg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.seg[i] = Math.hypot(this.x[j] - this.x[i], this.y[j] - this.y[i]);
    }
    const k = new Float64Array(n);
    const W = 2;
    for (let i = 0; i < n; i++) {
      const i0 = (i - W + n) % n;
      const i1 = (i + W) % n;
      const ax = this.x[i] - this.x[i0];
      const ay = this.y[i] - this.y[i0];
      const bx = this.x[i1] - this.x[i];
      const by = this.y[i1] - this.y[i];
      const cx = this.x[i1] - this.x[i0];
      const cy = this.y[i1] - this.y[i0];
      const cross = ax * by - ay * bx;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      const lc = Math.hypot(cx, cy);
      k[i] = (2 * cross) / (la * lb * lc + 1e-9);
    }
    const ks = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let q = -2; q <= 2; q++) s += k[(i + q + n) % n];
      ks[i] = s / 5;
    }
    this.curv = ks;
    this.speed = new Float64Array(n);
    this.buildSpeed();
  }

  private buildSpeed(): void {
    const n = this.n;
    const v = this.speed;
    const VMAX = 97;
    for (let i = 0; i < n; i++) {
      const kk = Math.abs(this.curv[i]);
      if (kk < 1e-5) {
        v[i] = VMAX;
        continue;
      }
      let vv = 60;
      for (let it = 0; it < 6; it++) vv = Math.min(VMAX, Math.sqrt(lateralLimit(vv) / kk));
      v[i] = vv;
    }
    // Rückwärtsdurchlauf: Bremsen vor den Kurven (zwei Runden wegen der geschlossenen Schleife)
    for (let pass = 0; pass < 3; pass++) {
      for (let q = n * 2 - 1; q >= 0; q--) {
        const i = q % n;
        const j = (i + 1) % n;
        const ds = this.seg[i];
        const vb = Math.sqrt(v[j] * v[j] + 2 * brakeLimit(v[j]) * ds);
        if (vb < v[i]) v[i] = vb;
      }
      // Vorwärtsdurchlauf: Beschleunigungsgrenzen
      for (let q = 0; q < n * 2; q++) {
        const i = q % n;
        const j = (i + 1) % n;
        const ds = this.seg[i];
        const va = Math.sqrt(v[i] * v[i] + 2 * Math.max(accelLimit(v[i]), 0.3) * ds);
        if (va < v[j]) v[j] = va;
      }
    }
  }

  /** Lenkwinkel-Vorsteuerung und Sollpunkt: Punkt der Ideallinie mit Versatz `lat` bei Index i. */
  pointAt(i: number, lat: number, out: { x: number; y: number }): void {
    const t = this.track;
    const idx = ((i % this.n) + this.n) % this.n;
    const off = Math.min(Math.max(this.offset[idx] + lat, this.lo[idx]), this.hi[idx]);
    out.x = t.x[idx] + t.nx(idx) * off;
    out.y = t.y[idx] + t.ny(idx) * off;
  }
}
