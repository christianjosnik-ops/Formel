import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { AIDriver } from '../src/race/ai';
import { carConfigFor, teamPerformance, type TeamData } from '../src/race/field';
import { RacingLine } from '../src/race/line';
import { createMap, type MapId } from '../src/world/maps';

const lineCache = new Map<string, RacingLine>();

/** Zweite gezeitete Runde einer einzelnen KI (fliegende Runde) für ein Team. Gibt Rundenzeit [s] zurück. */
export function aiLapTime(mapId: MapId, team: TeamData | null, pace = 1.0): number {
  const map = createMap(mapId);
  const t = map.track!;
  let line = lineCache.get(mapId);
  if (!line) lineCache.set(mapId, (line = new RacingLine(t)));
  const v = new Vehicle(carConfigFor());
  if (team) {
    const p = teamPerformance(team);
    v.teamPower = p.power;
    v.teamAero = p.aero;
  }
  const w = new World(map.world, [v]);
  w.reset(0, map.start.x, map.start.y, map.start.psi, 0);
  const ai = new AIDriver(line, { pace, consistency: 1, racecraft: 0.5, seed: 1 });
  ai.reset(t.n - 2);
  let time = 0;
  let prev = t.n - 2;
  let crossings = 0;
  let lapStart = 0;
  for (let k = 0; k < 500 * 260; k++) {
    if (k % 5 === 0) ai.update(0.01, v, time < 0.5 ? 'hold' : 'race', null, null);
    w.step(0.002);
    time += 0.002;
    const i = t.nearest(v.x, v.y);
    if (prev > t.n * 0.85 && i >= 0 && i < t.n * 0.15) {
      crossings++;
      if (crossings === 2) return time - lapStart;
      lapStart = time;
    }
    if (i >= 0) prev = i;
  }
  return NaN;
}
