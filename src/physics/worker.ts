/// <reference lib="webworker" />
import { TEST_CAR_2026 } from '../config/car';
import { carConfigFor } from '../race/field';
import { RaceDirector, selectField, type RaceConfig } from '../race/race';
import type { GameMap } from '../world/maps';
import { PHYS } from '../config/physics';
import type { FromWorker, ToWorker } from './messages';
import { CAR_BLOCK, SNAP_SIZE, S } from './layout';
import { Vehicle } from './vehicle';
import { World } from './world';
import { createMap } from '../world/maps';

/**
 * Physik-Worker: feste Schrittweite mit Zeitakkumulator, unabhängig von der Renderrate.
 * Snapshots gehen per transferierbarem Float64Array an den Main-Thread (Ping-Pong-Pool,
 * kein SharedArrayBuffer nötig, daher ohne COOP/COEP-Header auf GitHub Pages lauffähig).
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let car = new Vehicle(structuredClone(TEST_CAR_2026));
let world: World | null = null;
let director: RaceDirector | null = null;
let curMap: GameMap | null = null;
let playerInput = { ...car.input };
const pool: Float64Array[] = [];
let paused = false;
let acc = 0;
let last = performance.now();
let stepMsAvg = 0.05;
let hzAvg = PHYS.hz;
let lastPost = 0;

function build(race?: RaceConfig): void {
  const map = curMap!;
  const n = race ? selectField(race).length : 1;
  const vs: Vehicle[] = [];
  for (let k = 0; k < n; k++) vs.push(new Vehicle(k === 0 ? structuredClone(TEST_CAR_2026) : carConfigFor()));
  car = vs[0];
  Object.assign(car.input, playerInput);
  world = new World(map.world, vs);
  if (race) director = new RaceDirector(world, map, race);
  else {
    director = null;
    world.reset(0, map.start.x, map.start.y, map.start.psi, 0);
  }
  acc = 0;
}

function post(): void {
  const buf = pool.pop() ?? new Float64Array(SNAP_SIZE);
  world!.writeSnapshot(buf, 0);
  if (director) {
    director.writeRace(buf, 0, 0);
    const n = director.entrants.length;
    buf[S.nCars] = n;
    for (let k = 0; k < n; k++) world!.writeCarBlock(buf, S.cars + k * CAR_BLOCK, k, (t) => director!.writeRace(t, 0, k));
  } else buf[S.nCars] = 0;
  buf[S.stepMs] = stepMsAvg;
  buf[S.hz] = hzAvg;
  const msg: FromWorker = { type: 'snap', buf };
  ctx.postMessage(msg, [buf.buffer]);
}

function tick(): void {
  const now = performance.now();
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25;
  if (!world) {
    acc = 0;
  } else if (!paused) {
    acc += elapsed;
    const dt = PHYS.dt;
    let steps = 0;
    const t0 = performance.now();
    while (acc >= dt && steps < PHYS.maxCatchUpSteps) {
      director?.update(dt);
      world.step(dt);
      acc -= dt;
      steps++;
    }
    if (steps === PHYS.maxCatchUpSteps) acc = 0;
    if (steps > 0) {
      const ms = (performance.now() - t0) / steps;
      stepMsAvg += (ms - stepMsAvg) * 0.05;
      hzAvg += (steps / Math.max(elapsed, 1e-4) - hzAvg) * 0.05;
    }
    // Snapshot-Rate ~ 120 Hz reicht für Interpolation bei 60 FPS
    if (steps > 0 && now - lastPost >= 7) {
      lastPost = now;
      post();
    }
  } else {
    acc = 0;
  }
  setTimeout(tick, 2);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      curMap = createMap(m.map);
      build(m.race);
      const ready: FromWorker = { type: 'ready', hz: PHYS.hz };
      ctx.postMessage(ready);
      break;
    }
    case 'restart':
      build(m.race);
      break;
    case 'input':
      Object.assign(playerInput, m.input);
      Object.assign(car.input, director && director.state === 'grid' ? { ...m.input, throttle: 0, brake: 1 } : m.input);
      break;
    case 'reset':
      world?.reset(0, m.x, m.y, m.psi, m.speed);
      break;
    case 'recycle':
      if (pool.length < 6) pool.push(m.buf);
      break;
    case 'pause':
      paused = m.paused;
      break;
    case 'repair':
      world?.repair(0);
      break;
    case 'brakeBias':
      car.cfg.brakes.bias = m.bias;
      break;
  }
};

tick();
