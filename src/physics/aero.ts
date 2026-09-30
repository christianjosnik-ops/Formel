import type { CarConfig } from '../config/car';
import { PHYS } from '../config/physics';

/**
 * Aerodynamik: Abtrieb/Luftwiderstand ~ v^2, Bodeneffekt über Bodenfreiheit je Achse
 * (Nickwinkel/Rake wirkt über unterschiedliche Vorder-/Hinterachshöhen), aktive Aero
 * (Z-Modus Kurve / X-Modus Gerade, stufenlos übergeblendet).
 * Windschatten und Dirty Air werden über die Skalierungsfaktoren eingespeist (Phase 5).
 */
export class AeroModel {
  private readonly a: CarConfig['aero'];
  /** Ergebnisse des letzten update(). */
  downFront = 0;
  downRear = 0;
  /** Widerstandskraft-Koeffizient: F_drag = dragK * v_air (Komponenten) mit dragK = 0.5 rho CdA V. */
  cdA = 0;
  dynamicPressure = 0;

  constructor(cfg: CarConfig) {
    this.a = cfg.aero;
  }

  /** Bodeneffekt-Faktor einer Achse in Abhängigkeit der Bodenfreiheit h [m]. */
  static groundFactor(h: number, ref: number, gain: number, stall: number): number {
    const raw = (hh: number) => {
      const f = 1 + (gain * (ref - hh)) / ref;
      return f < 0.55 ? 0.55 : f > 1.6 ? 1.6 : f;
    };
    if (h >= stall) return raw(h);
    const atStall = raw(stall);
    const f = atStall * (h > 0 ? h / stall : 0);
    return f < 0.3 ? 0.3 : f;
  }

  update(
    speed: number,
    hFront: number,
    hRear: number,
    aeroX: number,
    beta: number,
    scaleFront: number,
    scaleRear: number,
    dragScale: number,
  ): void {
    const a = this.a;
    const q = 0.5 * PHYS.rhoAir * speed * speed;
    this.dynamicPressure = q;
    const clA = a.zClA + (a.xClA - a.zClA) * aeroX;
    const bal = a.zBalance + (a.xBalance - a.zBalance) * aeroX;
    const gf = AeroModel.groundFactor(hFront, a.refHeightFront, a.groundGainFront, a.stallHeightFront);
    const gr = AeroModel.groundFactor(hRear, a.refHeightRear, a.groundGainRear, a.stallHeightRear);
    this.downFront = q * clA * bal * gf * scaleFront;
    this.downRear = q * clA * (1 - bal) * gr * scaleRear;
    const cd = a.zCdA + (a.xCdA - a.zCdA) * aeroX;
    this.cdA = cd * (1 + a.yawDrag * beta * beta) * dragScale;
  }
}
