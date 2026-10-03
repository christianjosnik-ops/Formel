import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { carConfigFor } from '../src/race/field';
import { AIDriver } from '../src/race/ai';
import { RaceDirector, selectField } from '../src/race/race';
import { createMap } from '../src/world/maps';
import { S } from '../src/physics/layout';

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

  it('Boxen-Automatik: ein Knopfdruck, Auto fährt selbst ein, hält in der Box, wechselt Reifen und fährt aus', () => {
    const map = createMap('monza');
    const cfg = { laps: 3, aiLevel: 1, playerDriver: 2, field: 2, grid: 'pole' as const, seed: 5, pitAssist: true };
    const n = selectField(cfg).length;
    const vs = Array.from({ length: n }, () => new Vehicle(carConfigFor()));
    const world = new World(map.world, vs);
    const dir = new RaceDirector(world, map, cfg);
    // Spielerauto wird hier von einer externen KI auf der Linie gefahren (steht für die Hände des Spielers)
    const driver = new AIDriver(dir.line, { pace: 0.9, consistency: 1, racecraft: 0, seed: 3 });
    const pl = dir.entrants[0];
    const car = vs[0];
    let sawService = false;
    let sawLane = false;
    let steps = 0;
    let requested = false;
    const snap = new Float64Array(2048);
    const approach: number[] = [];
    const leaving: number[] = [];
    while (steps < 500 * 400) {
      if (steps % 5 === 0 && dir.state !== 'grid' && pl.pit === 0 || pl.pit === 1) driver.update(0.01, car, 'race', [], 1);
      dir.update(0.002);
      world.step(0.002);
      steps++;
      if (!requested && dir.state === 'racing' && dir.time > 8) {
        dir.setPlayerPit(true, 'hard');
        requested = true;
      }
      if (pl.pit === 2) sawLane = true;
      if (pl.pit === 3) sawService = true;
      if (steps % 50 === 0 && (pl.pit >= 2 || sawService)) {
        dir.writeRace(snap, 0, 0);
        if (pl.pit === 2) approach.push(snap[S.pitDBox]);
        if (pl.pit === 3) expect(snap[S.pitDBox]).toBe(0);
        if (pl.pit === 4) leaving.push(snap[S.pitDBox]);
      }
      if (sawService && pl.pit === 0) break;
    }
    // Abstand zur Box: vor dem Halt positiv und fallend, nach der Abfahrt negativ und wachsend (Crew-Anlauf/-Rückzug)
    expect(approach.length).toBeGreaterThan(3);
    expect(Math.max(...approach)).toBeGreaterThan(30);
    expect(approach[approach.length - 1]).toBeLessThan(6);
    expect(approach[approach.length - 1]).toBeLessThan(approach[0]);
    expect(leaving.some((d) => d < -5)).toBe(true);
    dir.writeRace(snap, 0, 0);
    // wieder auf der Strecke: entweder außerhalb der Gasse (999) oder weit hinter der Box (Crew längst zurückgezogen)
    expect(snap[S.pitDBox] === 999 || snap[S.pitDBox] < -24).toBe(true);
    expect(sawLane).toBe(true);
    expect(sawService).toBe(true);
    expect(pl.pitStops).toBe(1);
    expect(car.compound).toBe('hard');
    expect(pl.pit).toBe(0);
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
