import { describe, expect, it } from 'vitest';
import { Vehicle } from '../src/physics/vehicle';
import { World } from '../src/physics/world';
import { AIDriver, type Rival } from '../src/race/ai';
import { carConfigFor } from '../src/race/field';
import { RacingLine } from '../src/race/line';
import { createMap } from '../src/world/maps';

/** Zwei bis drei KI-Autos auf Monza mit selbst berechneter Rivalenliste (wie RaceDirector.neighbours). */
function setup(paces: number[], gaps: number[], opts: { wreckAt?: number } = {}) {
  const map = createMap('monza');
  const t = map.track!;
  const line = new RacingLine(t);
  const n = paces.length;
  const vs = Array.from({ length: n }, () => new Vehicle(carConfigFor()));
  const world = new World(map.world, vs);
  const ais: AIDriver[] = [];
  const start = Math.round(2000 / t.ds);
  for (let i = 0; i < n; i++) {
    const idx = (start - Math.round(gaps[i] / t.ds) + t.n) % t.n;
    world.reset(i, line.x[idx], line.y[idx], t.hdg[idx], 55);
    const ai = new AIDriver(line, { pace: paces[i], consistency: 1, racecraft: 1, seed: i + 1 });
    ai.reset(idx);
    ais.push(ai);
  }
  let wreck: { x: number; y: number; idx: number } | null = null;
  if (opts.wreckAt !== undefined) {
    const idx = Math.round(opts.wreckAt / t.ds) % t.n;
    wreck = { x: line.x[idx], y: line.y[idx], idx };
  }
  const L = t.length;
  const dist = (i: number): number => {
    const v = world.vehicles[i];
    const j = t.nearest(v.x, v.y);
    return j * t.ds;
  };
  const rivalsFor = (i: number): Rival[] => {
    const me = world.vehicles[i];
    const out: Rival[] = [];
    const di = dist(i);
    const myIdx = t.nearest(me.x, me.y);
    void myIdx;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const o = world.vehicles[k];
      let d = dist(k) - di;
      d = ((((d + L / 2) % L) + L) % L) - L / 2;
      out.push({ id: k, gap: d, lat: t.lateral(t.nearest(o.x, o.y), o.x, o.y), speed: Math.hypot(o.u, o.v), wreck: false });
    }
    if (wreck) {
      let d = wreck.idx * t.ds - di;
      d = ((((d + L / 2) % L) + L) % L) - L / 2;
      out.push({ id: 99, gap: d, lat: t.lateral(wreck.idx, wreck.x, wreck.y), speed: 0, wreck: true });
    }
    return out;
  };
  return { world, t, ais, rivalsFor, wreck, n };
}

describe('Rennintelligenz der KI', () => {
  it('weicht einem liegengebliebenen Auto auf der Ideallinie aus', () => {
    const s = setup([1], [0], { wreckAt: 2000 + 330 });
    // Hindernis als stehendes Auto in die Welt stellen
    let minSep = 1e9;
    let evaded = false;
    const t = s.t;
    for (let k = 0; k < 500 * 14; k++) {
      if (k % 5 === 0) {
        s.ais[0].update(0.01, s.world.vehicles[0], 'race', s.rivalsFor(0), 1);
        if (s.ais[0].evading) evaded = true;
      }
      s.world.step(0.002);
      const v = s.world.vehicles[0];
      const w = s.wreck!;
      const di = Math.hypot(v.x - w.x, v.y - w.y);
      if (Math.abs(t.nearest(v.x, v.y) * t.ds - w.idx * t.ds) < 25) minSep = Math.min(minSep, di);
    }
    expect(evaded).toBe(true);
    // Am Hindernis vorbei mit mindestens 2 m Seitenabstand (Fahrzeugbreite 1,9 m)
    expect(minSep).toBeGreaterThan(2.4);
    expect(s.world.vehicles[0].retired).toBe(0);
  }, 60000);

  it('schnelleres Auto im Windschatten setzt zum Überholen an, ohne Kontakt', () => {
    const s = setup([0.94, 1.0], [0, 22]);
    let attacked = false;
    let minSep = 1e9;
    for (let k = 0; k < 500 * 50; k++) {
      if (k % 5 === 0) {
        for (let i = 0; i < s.n; i++) {
          s.ais[i].update(0.01, s.world.vehicles[i], 'race', s.rivalsFor(i), 1);
          if (s.ais[i].situation === 'attack') attacked = true;
        }
      }
      s.world.step(0.002);
      if (k % 25 === 0) {
        const a = s.world.vehicles[0];
        const b = s.world.vehicles[1];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        minSep = Math.min(minSep, d);
      }
    }
    expect(attacked).toBe(true);
    expect(minSep).toBeGreaterThan(1.9);
    expect(s.world.vehicles[0].retired + s.world.vehicles[1].retired).toBe(0);
  }, 90000);
});
