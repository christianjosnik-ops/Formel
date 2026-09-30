import { TEST_CAR_2026 } from '../src/config/car';
import { PHYS } from '../src/config/physics';
import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { wallChain, type WallDef, type World2D } from '../src/world/provingGround';

export function makeMap(walls: WallDef[] = [], cones: Array<{ x: number; y: number }> = [], gravel = false): World2D {
  return {
    surfaces: [
      { kind: 'asphalt', x0: -2000, y0: -2000, x1: 2000, y1: 2000 },
      ...(gravel ? [{ kind: 'gravel' as const, x0: 100, y0: -100, x1: 400, y1: 100 }] : []),
    ],
    walls,
    cones: cones.map((c) => ({ ...c, color: 'orange' as const })),
  };
}

export function makeWorld(map: World2D, n = 1): World {
  const vs: Vehicle[] = [];
  for (let i = 0; i < n; i++) vs.push(new Vehicle(TEST_CAR_2026));
  return new World(map, vs);
}

export function runWorld(w: World, seconds: number, each?: () => void): void {
  const n = Math.round(seconds * PHYS.hz);
  for (let i = 0; i < n; i++) {
    w.step(PHYS.dt);
    if (each) each();
  }
}

export interface CrashResult {
  peakG: number;
  stopDist: number;
  finalSpeed: number;
  reboundSpeed: number;
  nose: number;
  wingF: number;
  engine: number;
  retired: number;
  energyKJ: number;
  ke0KJ: number;
  wheelsOff: number;
  sideL: number;
  sideR: number;
  rear: number;
}

/** Fahrzeug mit Geschwindigkeit v0 [m/s] unter Winkel angle [rad] gegen eine Wand bei x = wallX. */
export function wallImpact(v0: number, opts: { kind?: 'concrete' | 'tire' | 'armco'; heading?: number; yOffset?: number; seconds?: number; wallX?: number } = {}): CrashResult {
  const wallX = opts.wallX ?? 100;
  const kind = opts.kind ?? 'concrete';
  const heading = opts.heading ?? 0;
  const walls = wallChain(wallX, -60, wallX, 60, -1, 0, kind);
  const w = makeWorld(makeMap(walls));
  // Rückwärts-Entfernung so wählen, dass die Vorderkante ca. 0.4 m vor der Wand beginnt
  const back = 3.5;
  const x0 = wallX - back * Math.cos(heading) - 0.4;
  const y0 = (opts.yOffset ?? 0) - back * Math.sin(heading);
  w.reset(0, x0, y0, heading, v0);
  const car = w.vehicles[0];
  car.input.throttle = 0;
  car.input.brake = 0;
  car.input.tc = 0;
  car.input.abs = 0;
  const ke0 = 0.5 * car.mass * v0 * v0;
  let maxX = -1e9;
  let x1st = NaN;
  let rebound = 0;
  runWorld(w, opts.seconds ?? 3, () => {
    if (Number.isNaN(x1st) && w.crash[0].peakG > 0.5) x1st = car.x;
    maxX = Math.max(maxX, car.x);
    if (!Number.isNaN(x1st)) rebound = Math.min(rebound, car.u * Math.cos(car.psi));
  });
  const cs = w.crash[0];
  return {
    peakG: cs.peakG,
    stopDist: maxX - (Number.isNaN(x1st) ? maxX : x1st),
    finalSpeed: Math.hypot(car.u, car.v),
    reboundSpeed: -rebound,
    nose: cs.nose,
    wingF: cs.wingFront,
    engine: cs.engine,
    retired: cs.retired,
    energyKJ: cs.totalEnergy / 1000,
    ke0KJ: ke0 / 1000,
    wheelsOff: cs.wheelOff.reduce((a, b) => a + b, 0),
    sideL: cs.sideL,
    sideR: cs.sideR,
    rear: cs.rear,
  };
}
