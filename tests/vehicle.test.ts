import { describe, expect, it } from 'vitest';
import { PHYS } from '../src/config/physics';
import { TEST_CAR_2026 } from '../src/config/car';
import { Vehicle } from '../src/physics/vehicle';
import { S, SNAP_SIZE } from '../src/physics/layout';
import { accelRun, brakeRun, makeCar, run, steadyCorner } from './harness';

describe('Fahrzeug im Stand', () => {
  it('Summe der Radlasten = Gewichtskraft, Achsverteilung 45,5 % vorn', () => {
    const car = makeCar();
    run(car, 2);
    const sum = car.fz[0] + car.fz[1] + car.fz[2] + car.fz[3];
    expect(sum).toBeCloseTo(car.mass * PHYS.gravity, -1);
    const front = (car.fz[0] + car.fz[1]) / sum;
    expect(front).toBeGreaterThan(0.45);
    expect(front).toBeLessThan(0.465);
    // links/rechts symmetrisch
    expect(car.fz[0]).toBeCloseTo(car.fz[1], 1);
    expect(car.fz[2]).toBeCloseTo(car.fz[3], 1);
  });

  it('bleibt ruhig stehen', () => {
    const car = makeCar();
    run(car, 3);
    expect(Math.hypot(car.u, car.v)).toBeLessThan(0.01);
    expect(Math.abs(car.z)).toBeLessThan(1e-4);
  });

  it('Mindestgewicht 2026: 768 kg plus Kraftstoff', () => {
    expect(TEST_CAR_2026.mass.dry).toBe(768);
    const car = makeCar();
    expect(car.mass).toBe(768 + TEST_CAR_2026.mass.fuelStart);
  });
});

describe('Längsdynamik', () => {
  it('Beschleunigung aus dem Stand im realistischen Bereich', () => {
    const r = accelRun(0, 45);
    expect(r.t100).toBeGreaterThan(2.0);
    expect(r.t100).toBeLessThan(3.2);
    expect(r.t200).toBeGreaterThan(4.0);
    expect(r.t200).toBeLessThan(6.5);
    expect(r.vTop).toBeGreaterThan(300);
    expect(r.vTop).toBeLessThan(335);
  });

  it('X-Modus: höhere Endgeschwindigkeit', () => {
    const z = accelRun(0, 45);
    const x = accelRun(1, 45);
    expect(x.vTop).toBeGreaterThan(z.vTop + 15);
    expect(x.vTop).toBeGreaterThan(335);
    expect(x.vTop).toBeLessThan(365);
  });

  it('Vollbremsung 300 -> 0 km/h: Bremsweg und -zeit im F1-Bereich', () => {
    const b = brakeRun(300);
    expect(b.dist).toBeGreaterThan(85);
    expect(b.dist).toBeLessThan(140);
    expect(b.time).toBeGreaterThan(2.5);
    expect(b.time).toBeLessThan(4.5);
    expect(b.peakG).toBeGreaterThan(4);
    expect(b.peakG).toBeLessThan(7);
  });

  it('Bremsverzögerung steigt mit der Geschwindigkeit (Abtrieb)', () => {
    const slow = brakeRun(100).peakG;
    const fast = brakeRun(250).peakG;
    expect(fast).toBeGreaterThan(slow * 1.5);
  });

  it('Rekuperation lädt die Batterie beim Bremsen', () => {
    const car = makeCar();
    car.reset(0, 0, 0, 250 / 3.6);
    car.soc = 1e6;
    car.input.brake = 1;
    run(car, 2.5);
    expect(car.soc).toBeGreaterThan(1.28e6);
  });

  it('Vollgas entlädt die Batterie (Deployment), Kraftstoff sinkt', () => {
    const car = makeCar();
    car.input.throttle = 1;
    const soc0 = car.soc;
    const fuel0 = car.fuel;
    run(car, 6);
    expect(car.soc).toBeLessThan(soc0 - 0.9e6);
    expect(car.fuel).toBeLessThan(fuel0);
    expect(fuel0 - car.fuel).toBeLessThan(1);
  });

  it('Traktionskontrolle: starke Stufe hält den Schlupf unter dem Grundschutz', () => {
    const launch = (tc: number) => {
      const car = makeCar();
      car.input.tc = tc;
      car.input.throttle = 1;
      let kSum = 0;
      let n = 0;
      run(car, 3.5, () => {
        kSum += Math.max(car.kappa[2], car.kappa[3]);
        n++;
      });
      return { v: car.u, meanK: kSum / n };
    };
    const off = launch(0);
    const strong = launch(2);
    // Stufe 0 hat nur noch groben Grundschutz: Stufe 2 greift früher ein (weniger Schlupf), ohne langsamer zu sein
    expect(strong.v).toBeGreaterThan(off.v * 0.97);
    expect(strong.meanK).toBeLessThan(off.meanK);
  });

  it('ABS verhindert Blockieren', () => {
    const minKappa = (abs: number) => {
      const car = makeCar();
      car.reset(0, 0, 0, 150 / 3.6);
      car.input.abs = abs;
      car.input.brake = 1;
      let k = 0;
      run(car, 2, () => {
        if (car.u > 10) k = Math.min(k, car.kappa[0], car.kappa[1], car.kappa[2], car.kappa[3]);
      });
      return k;
    };
    expect(minKappa(2)).toBeGreaterThan(minKappa(0) - 1e-9);
  });

  it('Geradeauslauf: keine seitliche Drift ohne Lenkung', () => {
    const car = makeCar();
    car.input.throttle = 1;
    run(car, 8);
    expect(Math.abs(car.y)).toBeLessThan(0.3);
    expect(Math.abs(car.psi)).toBeLessThan(0.01);
  });
});

describe('Querdynamik', () => {
  it('hält 3 g bei 200 km/h auf dem Kreis', () => {
    const R = (200 / 3.6) ** 2 / (3 * PHYS.gravity);
    const c = steadyCorner(200, R);
    expect(c.speed).toBeGreaterThan(185);
    expect(c.ayG).toBeGreaterThan(2.6);
    expect(c.ayG).toBeLessThan(3.6);
  });

  it('Querbeschleunigung am Limit steigt mit der Geschwindigkeit (Abtrieb)', () => {
    const lim = (v: number) => {
      let best = 0;
      for (const a of [2.0, 2.5, 3.0, 3.5, 4.0]) {
        const R = (v / 3.6) ** 2 / (a * PHYS.gravity);
        const c = steadyCorner(v, R);
        if (c.speed > v * 0.93) best = Math.max(best, c.ayG);
      }
      return best;
    };
    expect(lim(250)).toBeGreaterThan(lim(100) + 0.5);
  });

  it('Wankwinkel und Lastverlagerung bei Kurvenfahrt', () => {
    const car = makeCar();
    car.reset(0, 0, 0, 150 / 3.6);
    car.input.tc = 0;
    car.input.steerAssist = 0;
    car.input.steer = 0.6;
    car.input.throttle = 0.3;
    run(car, 3);
    // Linkskurve: rechte Räder höher belastet, Aufbau rollt nach rechts
    expect(car.ayG).toBeGreaterThan(1);
    expect(car.fz[1]).toBeGreaterThan(car.fz[0] * 1.5);
    expect(car.phi).toBeGreaterThan(0);
    expect(car.phi).toBeLessThan(0.05);
  });

  it('Nicken beim Bremsen: Nase taucht, Vorderachse wird höher belastet', () => {
    const car = makeCar();
    car.reset(0, 0, 0, 200 / 3.6);
    car.input.brake = 1;
    run(car, 0.8);
    expect(car.theta).toBeGreaterThan(0);
    expect(car.fz[0] + car.fz[1]).toBeGreaterThan(car.fz[2] + car.fz[3]);
  });

  it('Lenkhilfe begrenzt den Einschlag bei hoher Geschwindigkeit', () => {
    const car = makeCar();
    expect(car.maxSteerAt(90, 1)).toBeLessThan(car.maxSteerAt(20, 1) * 0.3);
    expect(car.maxSteerAt(0, 1)).toBeCloseTo(TEST_CAR_2026.geometry.maxSteer, 6);
  });
});

describe('Numerik', () => {
  it('ist deterministisch', () => {
    const a = makeCar();
    const b = makeCar();
    for (const car of [a, b]) {
      car.input.throttle = 1;
      car.input.steer = 0.2;
      run(car, 3);
    }
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.psi).toBe(b.psi);
  });

  it('bleibt bei extremen Eingaben endlich (Fuzz)', () => {
    const car = makeCar();
    let seed = 42;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    car.reset(0, 0, 0, 60);
    for (let i = 0; i < 20000; i++) {
      if (i % 50 === 0) {
        car.input.steer = rnd() * 2 - 1;
        car.input.throttle = rnd() > 0.5 ? 1 : 0;
        car.input.brake = rnd() > 0.7 ? 1 : 0;
        car.input.tc = Math.floor(rnd() * 3);
        car.input.abs = Math.floor(rnd() * 3);
        car.input.steerAssist = Math.floor(rnd() * 3);
      }
      car.step(PHYS.dt);
    }
    for (const v of [car.x, car.y, car.psi, car.u, car.v, car.r, car.z, car.phi, car.theta, ...car.omega, ...car.fz]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(Math.hypot(car.u, car.v)).toBeLessThan(150);
  });

  it('Physikschritt ist schnell genug (500 Hz mit großem Spielraum)', () => {
    const car = makeCar();
    car.input.throttle = 1;
    const t0 = performance.now();
    run(car, 10);
    const perStep = (performance.now() - t0) / 5000;
    expect(perStep).toBeLessThan(0.1); // ms pro Schritt
  });

  it('Snapshot enthält alle Felder und passt in den Puffer', () => {
    const car = makeCar();
    run(car, 1);
    const buf = new Float64Array(SNAP_SIZE);
    car.writeSnapshot(buf);
    expect(buf[S.time]).toBeCloseTo(1, 2);
    expect(buf[S.mass]).toBeCloseTo(car.mass, 6);
    for (const v of buf) expect(Number.isFinite(v)).toBe(true);
  });

  it('Bremsscheiben erhitzen sich und kühlen im Fahrtwind ab', () => {
    const car = makeCar();
    car.reset(0, 0, 0, 300 / 3.6);
    car.input.brake = 1;
    run(car, 2.5);
    const hot = car.brakeTemp[0];
    expect(hot).toBeGreaterThan(450);
    car.input.brake = 0;
    car.input.throttle = 0.7;
    run(car, 10);
    expect(car.brakeTemp[0]).toBeLessThan(hot);
  });
});

describe('Vehicle Konstruktion', () => {
  it('kann mehrfach zurückgesetzt werden', () => {
    const car = new Vehicle(TEST_CAR_2026);
    car.input.throttle = 1;
    run(car, 2);
    car.reset(10, 5, 1, 0);
    expect(car.x).toBe(10);
    expect(car.u).toBe(0);
    expect(car.time).toBe(0);
  });
});
