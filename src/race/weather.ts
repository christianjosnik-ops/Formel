/**
 * Wettersimulation: Regenintensität und Streckennässe (0 trocken … 1 nass mit Pfützen).
 * Läuft im Physik-Worker; die Nässe wirkt über den Reifengrip (config/tyres.ts, wetGrip) auf alle Autos.
 * - light: konstanter Nieselregen, Strecke bleibt feucht (~0,45)
 * - heavy: Starkregen, Strecke steht unter Wasser (→ 1)
 * - changing: trocken, nach 1–2 min zieht ein Schauer auf, danach trocknet es wieder ab
 * - drying: Start auf nasser Strecke, die langsam abtrocknet
 */
export type RainMode = 'off' | 'light' | 'heavy' | 'changing' | 'drying';

export const RAIN_MODES: RainMode[] = ['off', 'light', 'heavy', 'changing', 'drying'];

export class WeatherSim {
  /** Regenintensität 0..1. */
  rain = 0;
  /** Streckennässe 0..1. */
  wet = 0;
  private t = 0;
  private readonly start: number;
  private readonly len: number;

  constructor(
    readonly mode: RainMode,
    seed = 1,
  ) {
    const r = ((Math.imul(seed | 0, 2654435761) >>> 8) & 0xffff) / 0xffff;
    this.start = 50 + r * 70; // Beginn des Schauers [s]
    this.len = 120 + r * 90; // Dauer des Schauers [s]
    if (mode === 'drying') this.wet = 0.85;
    if (mode === 'light') this.wet = 0.35;
    if (mode === 'heavy') this.wet = 0.7;
  }

  /** Ziel-Regenintensität zur Zeit t. */
  private target(): number {
    switch (this.mode) {
      case 'light':
        return 0.32;
      case 'heavy':
        return 0.95;
      case 'changing': {
        const u = (this.t - this.start) / this.len;
        if (u < 0 || u > 1.25) return 0;
        // schnell anschwellen, dann abklingen
        return u < 0.25 ? 0.85 * (u / 0.25) : 0.85 * Math.max(0, 1 - (u - 0.25) / 1.0);
      }
      default:
        return 0;
    }
  }

  update(dt: number): void {
    if (this.mode === 'off') return;
    this.t += dt;
    const target = this.target();
    this.rain += (target - this.rain) * Math.min(1, dt * 0.35);
    // Nässe: Regen füllt auf (Pfützen), sonst trocknet die Strecke langsam ab (schneller auf der Ideallinie, hier vereinfacht)
    const fill = this.rain * 0.016 * (1.08 - this.wet);
    const dry = 0.0032 * (1 - Math.min(1, this.rain * 2.2)) * (0.35 + this.wet);
    this.wet = Math.max(0, Math.min(1, this.wet + (fill - dry) * dt));
  }
}
