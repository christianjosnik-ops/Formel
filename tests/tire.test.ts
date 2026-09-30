import { describe, expect, it } from 'vitest';
import { TEST_CAR_2026 } from '../src/config/car';
import { TireModel } from '../src/physics/tire';

const out = new Float64Array(2);
const front = new TireModel(TEST_CAR_2026.tiresFront);
const rear = new TireModel(TEST_CAR_2026.tiresRear);

function peakOf(fn: (x: number) => number, from: number, to: number, steps = 4000): { x: number; v: number } {
  let best = { x: 0, v: -Infinity };
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    const v = fn(x);
    if (v > best.v) best = { x, v };
  }
  return best;
}

describe('Reifen (Magic Formula)', () => {
  it('ist ungerade in Schlupf und Schräglauf', () => {
    for (const a of [0.02, 0.06, 0.15]) {
      front.compute(3000, 0, a, 1, out);
      const fy = out[1];
      front.compute(3000, 0, -a, 1, out);
      expect(out[1]).toBeCloseTo(-fy, 6);
    }
    for (const k of [0.02, 0.08, 0.3]) {
      front.compute(3000, k, 0, 1, out);
      const fx = out[0];
      front.compute(3000, -k, 0, 1, out);
      expect(out[0]).toBeCloseTo(-fx, 6);
    }
  });

  it('liefert bei Nullschlupf keine Kräfte', () => {
    front.compute(4000, 0, 0, 1, out);
    expect(Math.abs(out[0])).toBeLessThan(1e-6);
    expect(Math.abs(out[1])).toBeLessThan(1e-6);
  });

  it('erreicht die Haftgrenze mu*Fz und fällt danach leicht ab', () => {
    const fz = 3000;
    const pk = peakOf((a) => front.pureFy(fz, a, 1), 0, 0.6);
    const mu = front.muY(fz);
    expect(pk.v / fz).toBeGreaterThan(mu * 0.97);
    expect(pk.v / fz).toBeLessThan(mu * 1.03);
    expect(front.pureFy(fz, 0.6, 1)).toBeLessThan(pk.v);
    // Peak bei realistischem Schräglaufwinkel (F1 Slick: ca. 4 bis 9 Grad)
    const deg = (pk.x * 180) / Math.PI;
    expect(deg).toBeGreaterThan(3.5);
    expect(deg).toBeLessThan(10);
  });

  it('hat den Längskraft-Peak bei ca. 6 bis 15 % Schlupf', () => {
    const pk = peakOf((k) => front.pureFx(3000, k, 1), 0, 0.6);
    expect(pk.x).toBeGreaterThan(0.06);
    expect(pk.x).toBeLessThan(0.15);
  });

  it('zeigt Lastempfindlichkeit: Reibwert sinkt, Kraft steigt degressiv', () => {
    expect(front.muY(6000)).toBeLessThan(front.muY(2000));
    const f2 = peakOf((a) => front.pureFy(2000, a, 1), 0, 0.5).v;
    const f6 = peakOf((a) => front.pureFy(6000, a, 1), 0, 0.5).v;
    expect(f6).toBeGreaterThan(f2);
    expect(f6 / f2).toBeLessThan(3);
  });

  it('skaliert linear mit dem Gripfaktor (Temperatur/Verschleiß/Nässe)', () => {
    const a = peakOf((x) => front.pureFy(3000, x, 1), 0, 0.5).v;
    const b = peakOf((x) => front.pureFy(3000, x, 0.8), 0, 0.5).v;
    expect(b / a).toBeCloseTo(0.8, 2);
  });

  it('kombinierter Schlupf: Längskraft reduziert Querkraft und umgekehrt', () => {
    const fz = 3500;
    front.compute(fz, 0, 0.1, 1, out);
    const fyPure = out[1];
    front.compute(fz, 0.1, 0.1, 1, out);
    expect(out[1]).toBeLessThan(fyPure * 0.95);
    front.compute(fz, 0.1, 0, 1, out);
    const fxPure = out[0];
    front.compute(fz, 0.1, 0.1, 1, out);
    expect(out[0]).toBeLessThan(fxPure * 0.95);
  });

  it('bleibt nahe an der Reibellipse', () => {
    const fz = 3500;
    const fx0 = peakOf((k) => front.pureFx(fz, k, 1), 0, 0.5).v;
    const fy0 = peakOf((a) => front.pureFy(fz, a, 1), 0, 0.5).v;
    for (let i = 0; i <= 12; i++) {
      const th = (i / 12) * (Math.PI / 2);
      let best = 0;
      for (let k = 0.02; k < 0.4; k += 0.01) {
        for (let a = 0.02; a < 0.4; a += 0.01) {
          front.compute(fz, k * Math.cos(th) * 1.0, a * Math.sin(th), 1, out);
          best = Math.max(best, Math.hypot(out[0] / fx0, out[1] / fy0));
        }
      }
      expect(best).toBeGreaterThan(0.85);
      expect(best).toBeLessThan(1.25);
    }
  });

  it('Hinterreifen haben höheren Grip als Vorderreifen (breiter)', () => {
    expect(rear.muY(3000)).toBeGreaterThan(front.muY(3000));
  });

  it('liefert bei Radlast null keine Kraft', () => {
    front.compute(0, 0.1, 0.1, 1, out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });
});
