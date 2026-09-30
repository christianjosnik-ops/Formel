import type { TireParams } from '../config/car';

/**
 * Pacejka Magic Formula (MF 5.2 Struktur) mit kombiniertem Längs-/Querschlupf.
 *
 * Konventionen (Reifenkoordinaten): Fx > 0 treibt nach vorn, kappa > 0 = Antriebsschlupf.
 * alpha = atan(vy / |vx|): Gleitwinkel des Reifens. Fy wird hier positiv zum Gleitwinkel geliefert;
 * der Aufrufer dreht das Vorzeichen (Reibkraft wirkt der Gleitbewegung entgegen).
 *
 * Keine Allokationen: Ergebnis in `out` (Float64Array[2]: Fx, Fy).
 */
export class TireModel {
  readonly p: TireParams;
  constructor(p: TireParams) {
    this.p = p;
  }

  /** Reibwert längs bei Radlast fz (mit Lastempfindlichkeit), ohne Gripfaktor. */
  muX(fz: number): number {
    const p = this.p;
    return Math.max(0.4, p.mux + p.dmuDFz * (fz - p.fz0));
  }
  muY(fz: number): number {
    const p = this.p;
    return Math.max(0.4, p.muy + p.dmuDFz * (fz - p.fz0));
  }

  /** Querkraftsteifigkeit Ky [N/rad]. */
  cornerStiffness(fz: number): number {
    const p = this.p;
    return p.pKy1 * p.fz0 * Math.sin(2 * Math.atan(fz / (p.pKy2 * p.fz0)));
  }

  /** Reine Längskraft Fx0(kappa). */
  pureFx(fz: number, kappa: number, grip: number): number {
    const p = this.p;
    const D = this.muX(fz) * grip * fz;
    const B = (p.kxStiff * fz) / (p.Cx * D);
    const bk = B * kappa;
    return D * Math.sin(p.Cx * Math.atan(bk - p.Ex * (bk - Math.atan(bk))));
  }

  /** Reine Querkraft Fy0(alpha). */
  pureFy(fz: number, alpha: number, grip: number): number {
    const p = this.p;
    const D = this.muY(fz) * grip * fz;
    const B = this.cornerStiffness(fz) / (p.Cy * D);
    const ba = B * alpha;
    return D * Math.sin(p.Cy * Math.atan(ba - p.Ey * (ba - Math.atan(ba))));
  }

  /**
   * Kombinierte Kräfte. out[0] = Fx, out[1] = Fy (beide im Reifenkoordinatensystem,
   * Fy mit dem Vorzeichen von alpha).
   */
  compute(fz: number, kappa: number, alpha: number, grip: number, out: Float64Array): void {
    const p = this.p;
    if (fz <= 0) {
      out[0] = 0;
      out[1] = 0;
      return;
    }
    const fx0 = this.pureFx(fz, kappa, grip);
    const fy0 = this.pureFy(fz, alpha, grip);

    const bxa = p.rBx1 * Math.cos(Math.atan(p.rBx2 * kappa));
    let gxa = Math.cos(p.rCx1 * Math.atan(bxa * alpha));
    if (gxa < 0) gxa = 0;

    const byk = p.rBy1 * Math.cos(Math.atan(p.rBy2 * (alpha - p.rBy3)));
    let gyk = Math.cos(p.rCy1 * Math.atan(byk * kappa));
    if (gyk < 0) gyk = 0;

    out[0] = gxa * fx0;
    out[1] = gyk * fy0;
  }
}
