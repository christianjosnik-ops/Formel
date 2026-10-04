import type { Track } from '../world/track';
import type { RacingLine } from './line';

/**
 * Safety Car und gelbe Flaggen (reine Logik, läuft im Physik-Worker im RaceDirector).
 * - Ein Unfall oder liegengebliebenes Auto setzt eine gelbe Flagge im Sektor (doppelt gelb, wenn es auf der Strecke steht).
 * - Bei einem Unfall kann das Safety Car ausrücken: es fährt auf der Ideallinie vor dem Führenden, das Feld schließt auf
 *   (kein Überholen, Tempobegrenzung), nach etwa 70 s und freier Strecke kommt es an der Boxeneinfahrt herein, danach Grün.
 */
export const SC_SPEED = 38; // m/s (~137 km/h), bei Nässe langsamer

export class SafetyCarSim {
  /** 0 aus, 1 ausgerückt (Feld sammelt sich), 2 Feld geschlossen, 3 kommt in die Box. */
  state: 0 | 1 | 2 | 3 = 0;
  /** Zurückgelegte Distanz (gleiche Zählung wie Entrant.dist). */
  dist = 0;
  speed = 0;
  x = 0;
  y = 0;
  psi = 0;
  /** Sekunden seit dem Ausrücken. */
  t = 0;
  /** Restdauer der Grünphase nach dem Restart [s]. */
  greenT = 0;
  count = 0;
  private cool = 0;
  readonly yellows: Array<{ s: number; t: number; dbl: boolean }> = [];

  constructor(
    private readonly track: Track,
    private readonly line: RacingLine,
  ) {}

  get active(): boolean {
    return this.state !== 0;
  }

  /** Signed Abstand a − b entlang der Strecke (−L/2 … L/2]. */
  delta(a: number, b: number): number {
    const L = this.track.length;
    return ((((a - b + L / 2) % L) + L) % L) - L / 2;
  }

  /** Meldet ein Hindernis an Streckenposition s [m]. */
  incident(s: number, dbl: boolean): void {
    const y = this.yellows.find((z) => Math.abs(this.delta(z.s, s)) < 90);
    if (y) {
      y.t = 25;
      y.dbl = y.dbl || dbl;
    } else this.yellows.push({ s, t: 25, dbl });
  }

  /** Safety Car ausrücken lassen (false, wenn schon draußen oder noch gesperrt). */
  deploy(leaderDist: number, wet: number): boolean {
    if (this.state !== 0 || this.cool > 0) return false;
    this.state = 1;
    this.dist = leaderDist + 70;
    this.speed = 30;
    this.t = 0;
    this.count++;
    this.place();
    void wet;
    return true;
  }

  targetSpeed(wet: number): number {
    return SC_SPEED * (1 - 0.22 * wet);
  }

  private place(): void {
    const t = this.track;
    const L = t.length;
    const s = ((this.dist % L) + L) % L;
    const f = s / t.ds;
    const i = Math.floor(f) % t.n;
    const j = (i + 1) % t.n;
    const k = f - Math.floor(f);
    this.x = this.line.x[i] + (this.line.x[j] - this.line.x[i]) * k;
    this.y = this.line.y[i] + (this.line.y[j] - this.line.y[i]) * k;
    this.psi = Math.atan2(this.line.y[j] - this.line.y[i], this.line.x[j] - this.line.x[i]);
  }

  update(dt: number, wet: number): void {
    this.cool -= dt;
    this.greenT -= dt;
    for (let k = this.yellows.length - 1; k >= 0; k--) {
      this.yellows[k].t -= dt;
      if (this.yellows[k].t <= 0) this.yellows.splice(k, 1);
    }
    if (this.state === 0) return;
    this.t += dt;
    const target = this.targetSpeed(wet) * (this.state === 1 ? 0.92 : 1);
    this.speed += Math.max(-6 * dt, Math.min(4 * dt, target - this.speed));
    this.dist += this.speed * dt;
    this.place();
    if (this.state === 1 && this.t > 22) this.state = 2;
    if (this.state === 2 && this.t > 70 && this.yellows.length === 0) this.state = 3;
    if (this.state === 3) {
      const t = this.track;
      const s = ((this.dist % t.length) + t.length) % t.length;
      const rel = s > t.length / 2 ? s - t.length : s;
      const e0 = t.pitZone.entry0;
      if (rel >= e0 && rel < e0 + 90) {
        this.state = 0;
        this.greenT = 7;
        this.cool = 140;
      }
    }
  }

  /** Höchstgeschwindigkeit für ein Auto hinter `ref` (SC oder Vordermann) bei Abstand gap [m]; Infinity ohne Safety Car. */
  cap(refSpeed: number, gap: number, wet: number): number {
    if (this.state === 0) return Infinity;
    const base = this.targetSpeed(wet);
    let cap = refSpeed + (gap - 14) * 0.55;
    cap = Math.max(base * 0.5, Math.min(cap, base * 1.55));
    if (gap < 7) cap = Math.min(cap, refSpeed * 0.85);
    return cap;
  }

  /** Flagge für einen Fahrer an Streckenposition s: 0 keine, 1 gelb, 2 doppelt gelb, 3 Safety Car, 4 Grün (nach Restart). */
  flagAt(s: number): number {
    if (this.state !== 0) return 3;
    if (this.greenT > 0) return 4;
    let f = 0;
    for (const z of this.yellows) {
      const d = this.delta(z.s, s);
      if (d > -30 && d < 250) f = Math.max(f, z.dbl ? 2 : 1);
    }
    return f;
  }
}
