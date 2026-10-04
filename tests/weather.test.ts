import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { carConfigFor } from '../src/race/field';
import { RaceDirector, selectField } from '../src/race/race';
import { WeatherSim } from '../src/race/weather';
import { wetGrip } from '../src/config/tyres';
import { createMap } from '../src/world/maps';

describe('Regen', () => {
  it('Wettersimulation: Starkregen macht nass, Schauer kommt und geht, trocken bleibt trocken', () => {
    const dry = new WeatherSim('off');
    const heavy = new WeatherSim('heavy', 3);
    const shower = new WeatherSim('changing', 3);
    let peak = 0;
    let wetAfterShower = 0;
    for (let t = 0; t < 900; t += 0.1) {
      dry.update(0.1);
      heavy.update(0.1);
      shower.update(0.1);
      peak = Math.max(peak, shower.wet);
      wetAfterShower = shower.wet;
    }
    expect(dry.wet).toBe(0);
    expect(heavy.wet).toBeGreaterThan(0.85);
    expect(peak).toBeGreaterThan(0.3);
    expect(wetAfterShower).toBeLessThan(peak);
  });

  it('Reifengrip: Slicks brechen im Nassen ein, Regenreifen gewinnen im Starkregen, Inter dazwischen', () => {
    expect(wetGrip('medium', 0)).toBe(1);
    expect(wetGrip('medium', 1)).toBeLessThan(0.5);
    expect(wetGrip('wet', 1)).toBeGreaterThan(wetGrip('inter', 1));
    expect(wetGrip('inter', 1)).toBeGreaterThan(wetGrip('medium', 1));
    expect(wetGrip('inter', 0.5)).toBeGreaterThan(wetGrip('wet', 0.5) - 0.05);
    expect(wetGrip('medium', 0.1)).toBeGreaterThan(wetGrip('inter', 0.1));
  });

  function lapTime(wet: number): { best: number; finished: number; compounds: string[] } {
    const map = createMap('monza');
    const cfg = { laps: 2, aiLevel: 1, playerDriver: 2, field: 3, grid: 'pole' as const, seed: 5, autopilot: true };
    const n = selectField(cfg).length;
    const vs = Array.from({ length: n }, () => new Vehicle(carConfigFor()));
    for (const v of vs) v.wetness = wet;
    const world = new World(map.world, vs);
    const dir = new RaceDirector(world, map, cfg);
    let steps = 0;
    while (dir.state !== 'finished' && steps < 500 * 400) {
      for (const v of vs) v.wetness = wet;
      dir.update(0.002);
      world.step(0.002);
      steps++;
    }
    const bests = dir.entrants.filter((e) => e.best > 0).map((e) => e.best);
    return { best: Math.min(...bests), finished: dir.entrants.filter((e) => e.finished).length, compounds: dir.entrants.map((e) => vs[e.vi].compound) };
  }

  it('KI fährt im Regen mit Regenreifen deutlich langsamer, aber sauber ins Ziel', () => {
    const dry = lapTime(0);
    const wet = lapTime(1);
    expect(wet.compounds.every((c) => c === 'wet' || c === 'inter')).toBe(true);
    expect(dry.finished).toBe(3);
    expect(wet.finished).toBe(3);
    expect(wet.best).toBeGreaterThan(dry.best * 1.1);
    expect(wet.best).toBeLessThan(dry.best * 1.7);
  }, 300000);
});
