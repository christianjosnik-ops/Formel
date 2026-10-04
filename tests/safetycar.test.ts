import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { carConfigFor } from '../src/race/field';
import { RaceDirector, selectField } from '../src/race/race';
import { SC_SPEED } from '../src/race/safetycar';
import { createMap } from '../src/world/maps';

describe('Safety Car', () => {
  it('rückt nach einem Ausfall aus, Feld schließt auf und bleibt unter Tempolimit, danach Grün und alle kommen ins Ziel', () => {
    const map = createMap('monza');
    const cfg = { laps: 5, aiLevel: 1, playerDriver: 2, field: 6, grid: 'pole' as const, seed: 9, autopilot: true };
    const n = selectField(cfg).length;
    const vs = Array.from({ length: n }, () => new Vehicle(carConfigFor()));
    const world = new World(map.world, vs);
    const dir = new RaceDirector(world, map, cfg);
    let steps = 0;
    let maxSpeedUnderSc = 0;
    let sawSc = false;
    let sawGreen = false;
    let minGap = 1e9;
    let retired = false;
    while (dir.state !== 'finished' && steps < 500 * 900) {
      dir.update(0.002);
      world.step(0.002);
      steps++;
      if (!retired && dir.time > 45) {
        vs[3].retired = 1;
        retired = true;
      }
      if (dir.sc.active) sawSc = true;
      if (sawSc && !dir.sc.active && dir.sc.greenT > 0) sawGreen = true;
      if (dir.sc.state === 2 && dir.sc.t > 40 && steps % 100 === 0) {
        const act = dir.entrants.filter((e) => !e.out && e.pit === 0 && !e.finished);
        for (const e of act) {
          const v = vs[e.vi];
          maxSpeedUnderSc = Math.max(maxSpeedUnderSc, Math.hypot(v.u, v.v));
        }
        const sorted = [...act].sort((a, b) => b.dist - a.dist);
        for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i - 1].dist - sorted[i].dist);
      }
    }
    expect(sawSc).toBe(true);
    expect(sawGreen).toBe(true);
    expect(dir.sc.count).toBe(1);
    expect(maxSpeedUnderSc).toBeLessThan(SC_SPEED * 1.75);
    expect(maxSpeedUnderSc).toBeGreaterThan(15);
    expect(minGap).toBeGreaterThan(3); // kein Auffahren
    expect(dir.entrants.filter((e) => e.finished).length).toBeGreaterThanOrEqual(5);
  }, 300000);
});
