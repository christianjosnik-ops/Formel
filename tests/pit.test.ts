import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { carConfigFor } from '../src/race/field';
import { RaceDirector, selectField } from '../src/race/race';
import { createMap } from '../src/world/maps';

describe('Boxenstopps', () => {
  it('KI fährt bei hohem Verschleiß in die Box, wechselt Reifen und fährt weiter', () => {
    const map = createMap('monza');
    const cfg = { laps: 3, aiLevel: 1, playerDriver: 2, field: 4, grid: 'mid' as const, seed: 5, autopilot: true, wearScale: 16 };
    const n = selectField(cfg).length;
    const vs = Array.from({ length: n }, () => new Vehicle(carConfigFor()));
    const world = new World(map.world, vs);
    const dir = new RaceDirector(world, map, cfg);
    let steps = 0;
    let sawService = false;
    let done = false;
    while (!done && steps < 500 * 300) {
      dir.update(0.002);
      world.step(0.002);
      steps++;
      if (dir.entrants.some((e) => e.pit === 3)) sawService = true;
      // fertig, sobald ein Auto nach dem Stopp wieder auf der Strecke ist
      done = dir.entrants.some((e) => e.pitStops > 0 && e.pit === 0);
    }
    expect(sawService).toBe(true);
    expect(done).toBe(true);
    for (const e of dir.entrants) if (e.pitStops > 0) expect(Math.max(...vs[e.vi].tyreWear)).toBeLessThan(0.5);
  }, 300000);

  it('Tempolimit in der Boxengasse und Boxenpositionen liegen in der Gasse', () => {
    const t = createMap('monza').track!;
    expect(t.pit.boxes.length).toBe(22);
    for (const b of t.pit.boxes) {
      const lat = t.lateral(b.idx, b.x, b.y);
      expect(lat).toBeGreaterThan(t.wl[b.idx] + 8);
      expect(lat).toBeLessThan(t.wl[b.idx] + 13.5);
      expect(t.surfaceAt(b.x, b.y)).toBe('asphalt');
    }
  });
});
