import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { carConfigFor, DRIVERS } from '../src/race/field';
import { RaceDirector, selectField, type RaceConfig } from '../src/race/race';
import { createMap } from '../src/world/maps';
import { aiLapTime } from './raceHarness';
import { TEAMS } from '../src/race/field';

function makeRace(over: Partial<RaceConfig> = {}) {
  const map = createMap('monza');
  const cfg: RaceConfig = { laps: 1, aiLevel: 3, playerDriver: 2, field: 22, grid: 'mid', seed: 7, autopilot: true, ...over };
  const n = selectField(cfg).length;
  const vs = Array.from({ length: n }, () => new Vehicle(carConfigFor()));
  const world = new World(map.world, vs);
  const dir = new RaceDirector(world, map, cfg);
  return { world, dir, map };
}

describe('Rennmodus', () => {
  it('Feld: Spieler zuerst, keine Doppelten', () => {
    const f = selectField({ laps: 1, aiLevel: 1, playerDriver: 5, field: 22, grid: 'pole', seed: 1 });
    expect(f.length).toBe(DRIVERS.length);
    expect(f[0]).toBe(5);
    expect(new Set(f).size).toBe(f.length);
    const small = selectField({ laps: 1, aiLevel: 1, playerDriver: 5, field: 8, grid: 'pole', seed: 1 });
    expect(small.length).toBe(8);
    expect(new Set(small).size).toBe(8);
  });

  it('Teamrückstand entspricht den vorgegebenen Abständen (Monza, ±0.35 s)', () => {
    const ref = aiLapTime('monza', TEAMS.find((t) => t.id === 'mercedes')!);
    for (const id of ['ferrari', 'cadillac']) {
      const t = TEAMS.find((x) => x.id === id)!;
      const d = aiLapTime('monza', t) - ref;
      expect(Math.abs(d - t.gap)).toBeLessThan(0.35);
    }
  }, 120000);

  it('Startaufstellung und Lichterfolge', () => {
    const { world, dir } = makeRace({ grid: 'last' });
    expect(dir.entrants[0].pos).toBe(22);
    const pl = dir.entrants[0];
    // Reihen sind hinter der Linie, niemand überlappt
    for (let i = 0; i < 22; i++)
      for (let j = i + 1; j < 22; j++) {
        const a = world.vehicles[i];
        const b = world.vehicles[j];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(3.5);
      }
    let sawFive = false;
    for (let k = 0; k < 500 * 8 && dir.state === 'grid'; k++) {
      dir.update(0.002);
      world.step(0.002);
      if (dir.lights === 5) sawFive = true;
    }
    expect(sawFive).toBe(true);
    expect(dir.state).toBe('racing');
    expect(pl.dist).toBeLessThan(0);
  }, 60000);

  it('22 KI-Autos fahren eine Runde: sinnvolle Reihenfolge, Zeitabstände, kaum Ausfälle', () => {
    const { world, dir } = makeRace();
    let steps = 0;
    const t0 = performance.now();
    while (dir.state !== 'finished' && steps < 500 * 210) {
      dir.update(0.002);
      world.step(0.002);
      steps++;
    }
    const ms = performance.now() - t0;
    expect(dir.state).toBe('finished');
    const fin = dir.entrants.filter((e) => e.finished);
    expect(fin.length).toBeGreaterThanOrEqual(15);
    const order = [...dir.entrants].sort((a, b) => a.pos - b.pos);
    // Ergebnis: Zielzeiten nicht fallend
    for (let i = 1; i < fin.length; i++) {
      const a = order[i - 1];
      const b = order[i];
      if (a.finished && b.finished) expect(b.finishTime).toBeGreaterThanOrEqual(a.finishTime - 1e-6);
    }
    // Rundenzeit in plausiblem Bereich, Gesamtfeld innerhalb weniger Sekunden
    const winner = order[0];
    expect(winner.finishTime).toBeGreaterThan(90);
    expect(winner.finishTime).toBeLessThan(140);
    expect(order[Math.min(14, fin.length - 1)].finishTime - winner.finishTime).toBeLessThan(55);
    console.log('winner', winner.data.name, winner.finishTime.toFixed(1), 'finished', fin.length, 'sim ms/s', (ms / (steps * 0.002)).toFixed(0));
  }, 600000);
});
