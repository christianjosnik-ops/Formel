/// <reference lib="webworker" />
import { TEST_CAR_2026 } from '../config/car';
import { PHYS } from '../config/physics';
import type { FromWorker, ToWorker } from './messages';
import { SNAP_SIZE, S } from './layout';
import { Vehicle } from './vehicle';
import { World } from './world';
import { buildProvingGround } from '../world/provingGround';

/**
 * Physik-Worker: feste Schrittweite mit Zeitakkumulator, unabhängig von der Renderrate.
 * Snapshots gehen per transferierbarem Float64Array an den Main-Thread (Ping-Pong-Pool,
 * kein SharedArrayBuffer nötig, daher ohne COOP/COEP-Header auf GitHub Pages lauffähig).
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const car = new Vehicle(TEST_CAR_2026);
const world = new World(buildProvingGround(), [car]);
const pool: Float64Array[] = [];
let paused = false;
let acc = 0;
let last = performance.now();
let stepMsAvg = 0.05;
let hzAvg = PHYS.hz;
let lastPost = 0;

function post(): void {
  const buf = pool.pop() ?? new Float64Array(SNAP_SIZE);
  world.writeSnapshot(buf, 0);
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
  if (!paused) {
    acc += elapsed;
    const dt = PHYS.dt;
    let steps = 0;
    const t0 = performance.now();
    while (acc >= dt && steps < PHYS.maxCatchUpSteps) {
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
    case 'input':
      Object.assign(car.input, m.input);
      break;
    case 'reset':
      world.reset(0, m.x, m.y, m.psi, m.speed);
      break;
    case 'recycle':
      if (pool.length < 6) pool.push(m.buf);
      break;
    case 'pause':
      paused = m.paused;
      break;
    case 'repair':
      world.repair(0);
      break;
    case 'brakeBias':
      car.cfg.brakes.bias = m.bias;
      break;
  }
};

const ready: FromWorker = { type: 'ready', hz: PHYS.hz };
ctx.postMessage(ready);
tick();
