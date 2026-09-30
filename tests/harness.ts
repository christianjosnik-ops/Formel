import { TEST_CAR_2026 } from '../src/config/car';
import { PHYS } from '../src/config/physics';
import { Vehicle } from '../src/physics/vehicle';

export function makeCar(): Vehicle {
  return new Vehicle(TEST_CAR_2026);
}

export function run(car: Vehicle, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds * PHYS.hz);
  for (let i = 0; i < n; i++) {
    car.step(PHYS.dt);
    if (each) each(car.time);
  }
}

export interface AccelResult {
  t100: number;
  t200: number;
  t300: number;
  vTop: number;
  dist: number;
}

/** Vollgas-Beschleunigung aus dem Stand (gerade). */
export function accelRun(aeroX = 0, seconds = 60): AccelResult {
  const car = makeCar();
  car.input.throttle = 1;
  car.input.aeroX = aeroX;
  car.input.tc = 1;
  const res: AccelResult = { t100: NaN, t200: NaN, t300: NaN, vTop: 0, dist: 0 };
  run(car, seconds, (t) => {
    const kmh = Math.hypot(car.u, car.v) * 3.6;
    if (Number.isNaN(res.t100) && kmh >= 100) res.t100 = t;
    if (Number.isNaN(res.t200) && kmh >= 200) res.t200 = t;
    if (Number.isNaN(res.t300) && kmh >= 300) res.t300 = t;
    if (kmh > res.vTop) res.vTop = kmh;
  });
  res.dist = car.x;
  return res;
}

/** Vollbremsung aus v0 [km/h]: Bremsweg und -zeit bis 0. */
export function brakeRun(v0: number, abs = 1): { dist: number; time: number; peakG: number } {
  const car = makeCar();
  car.reset(0, 0, 0, v0 / 3.6);
  car.input.abs = abs;
  car.input.brake = 1;
  let peak = 0;
  const x0 = car.x;
  const t0 = car.time;
  let stopT = NaN;
  run(car, 12, () => {
    peak = Math.max(peak, -car.axG);
    if (Number.isNaN(stopT) && car.u < 0.3) stopT = car.time;
  });
  return { dist: car.x - x0, time: (Number.isNaN(stopT) ? car.time : stopT) - t0, peakG: peak };
}

/**
 * Stationäre Kreisfahrt (Skidpad) bei Zielgeschwindigkeit: Der Fahrer hält die Geschwindigkeit per Gas,
 * und lenkt so, dass der Radius konstant bleibt (einfacher Regler). Ergibt max. Querbeschleunigung.
 */
export function steadyCorner(speedKmh: number, radius: number): { ayG: number; speed: number } {
  const car = makeCar();
  car.reset(0, 0, 0, speedKmh / 3.6);
  car.input.tc = 0;
  car.input.steerAssist = 0;
  // Regler: Gierrate = v / R
  run(car, 14, () => {
    const v = Math.hypot(car.u, car.v);
    const rTarget = v / radius;
    const err = rTarget - car.r;
    const target = car.cfg.geometry.wheelbase / radius;
    const maxS = car.maxSteerAt(v, 0);
    car.input.steer = Math.max(-1, Math.min(1, (target + err * 0.6) / maxS));
    car.input.throttle = Math.max(0, Math.min(1, 0.25 + (speedKmh / 3.6 - v) * 0.2));
    car.input.brake = v > speedKmh / 3.6 + 2 ? 0.1 : 0;
  });
  return { ayG: Math.abs(car.ayG), speed: Math.hypot(car.u, car.v) * 3.6 };
}
