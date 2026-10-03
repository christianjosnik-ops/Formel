import { describe, expect, it } from 'vitest';
import { TEST_CAR_2026 } from '../src/config/car';
import { PHYS } from '../src/config/physics';
import { AeroModel } from '../src/physics/aero';
import { Powertrain } from '../src/physics/powertrain';

describe('Aerodynamik', () => {
  const aero = new AeroModel(TEST_CAR_2026);
  const a = TEST_CAR_2026.aero;

  it('Abtrieb und Luftwiderstand wachsen mit v^2', () => {
    aero.update(40, a.refHeightFront, a.refHeightRear, 0, 0, 1, 1, 1);
    const d40 = aero.downFront + aero.downRear;
    const c40 = aero.cdA;
    aero.update(80, a.refHeightFront, a.refHeightRear, 0, 0, 1, 1, 1);
    expect((aero.downFront + aero.downRear) / d40).toBeCloseTo(4, 6);
    expect(aero.cdA).toBeCloseTo(c40, 9);
  });

  it('entspricht bei Referenzhöhe ClA und Balance aus der Config', () => {
    const v = 50;
    aero.update(v, a.refHeightFront, a.refHeightRear, 0, 0, 1, 1, 1);
    const q = 0.5 * PHYS.rhoAir * v * v;
    expect(aero.downFront + aero.downRear).toBeCloseTo(q * a.zClA, 4);
    expect(aero.downFront / (aero.downFront + aero.downRear)).toBeCloseTo(a.zBalance, 6);
  });

  it('X-Modus reduziert Widerstand und Abtrieb deutlich', () => {
    aero.update(80, 0.03, 0.07, 0, 0, 1, 1, 1);
    const zDown = aero.downFront + aero.downRear;
    const zDrag = aero.cdA;
    aero.update(80, 0.03, 0.07, 1, 0, 1, 1, 1);
    expect(aero.cdA).toBeLessThan(zDrag * 0.65);
    expect(aero.downFront + aero.downRear).toBeLessThan(zDown * 0.6);
  });

  it('Bodeneffekt: tiefer = mehr Abtrieb, unterhalb der Abrisshöhe Einbruch', () => {
    const f = (h: number) => AeroModel.groundFactor(h, a.refHeightFront, a.groundGainFront, a.stallHeightFront);
    expect(f(0.02)).toBeGreaterThan(f(0.03));
    expect(f(0.03)).toBeGreaterThan(f(0.05));
    expect(f(0.004)).toBeLessThan(f(a.stallHeightFront));
    // stetig am Übergang
    expect(Math.abs(f(a.stallHeightFront + 1e-6) - f(a.stallHeightFront - 1e-6))).toBeLessThan(1e-3);
  });

  it('Dirty-Air-Skalierung wirkt linear', () => {
    aero.update(70, 0.03, 0.07, 0, 0, 1, 1, 1);
    const f1 = aero.downFront;
    aero.update(70, 0.03, 0.07, 0, 0, 0.7, 1, 1);
    expect(aero.downFront / f1).toBeCloseTo(0.7, 6);
  });
});

describe('Antrieb 2026', () => {
  const pt = new Powertrain(TEST_CAR_2026);

  it('Verbrenner liefert Spitzenleistung von 385 kW (Spielabstimmung) bei 11 500 rpm', () => {
    const p = (pt.iceTorque(11500) * 11500 * 2 * Math.PI) / 60;
    expect(p).toBeCloseTo(385e3, -2);
    const p8 = (pt.iceTorque(8000) * 8000 * 2 * Math.PI) / 60;
    expect(p8).toBeLessThan(385e3);
  });

  it('MGU-K regelt zwischen 280 und 345 km/h linear auf null', () => {
    expect(pt.kTaper(250 / 3.6)).toBe(1);
    expect(pt.kTaper(345 / 3.6)).toBe(0);
    expect(pt.kTaper(312.5 / 3.6)).toBeCloseTo(0.5, 2);
  });

  it('MGU-K liefert ca. 350 kW elektrisch (ca. 330 kW am Rad) bei vollem Gas im Kurvenbereich', () => {
    const v = 200 / 3.6;
    pt.reset();
    pt.step(0.002, v / 0.335, 1, v, 4e6, 1);
    expect(pt.batteryPower).toBeGreaterThan(300e3);
    expect(pt.batteryPower).toBeLessThan(355e3);
    expect(pt.kPower).toBeGreaterThan(280e3);
  });

  it('MGU-K arbeitet nicht bei leerer Batterie', () => {
    pt.reset();
    pt.step(0.002, 50, 1, 50, 0, 1);
    expect(pt.kWheelTorque).toBe(0);
  });

  it('schaltet hoch bei Drehzahl und runter beim Verzögern', () => {
    pt.reset();
    const r = TEST_CAR_2026.drivetrain.ratios;
    // Raddrehzahl für 13 700 rpm im 1. Gang
    let w = (13700 * 2 * Math.PI) / 60 / r[0];
    pt.step(0.002, w, 1, 30, 1e6, 1);
    expect(pt.gear).toBe(1);
    expect(pt.shiftTimer).toBeGreaterThan(0);
    w = (6500 * 2 * Math.PI) / 60 / r[1];
    for (let i = 0; i < 40; i++) pt.step(0.002, w, 0, 30, 1e6, 0);
    expect(pt.gear).toBe(0);
  });

  it('unterbricht den Antrieb während des Schaltvorgangs', () => {
    pt.reset();
    const r = TEST_CAR_2026.drivetrain.ratios;
    const w = (13700 * 2 * Math.PI) / 60 / r[0];
    pt.step(0.002, w, 1, 30, 0, 0);
    expect(pt.iceWheelTorque).toBe(0);
  });

  it('begrenzt die Drehzahl', () => {
    pt.reset();
    pt.gear = 7;
    const w = (15500 * 2 * Math.PI) / 60 / TEST_CAR_2026.drivetrain.ratios[7];
    pt.step(0.002, w, 1, 90, 0, 0);
    expect(pt.iceWheelTorque).toBeLessThanOrEqual(0);
  });

  it('Leistungskurve ist stetig', () => {
    let prev = pt.powerFraction(3000);
    for (let rpm = 3050; rpm < 15500; rpm += 50) {
      const p = pt.powerFraction(rpm);
      expect(Math.abs(p - prev)).toBeLessThan(0.06);
      prev = p;
    }
  });
});
