import { S } from '../physics/layout';
import type { Vehicle } from '../physics/vehicle';
import type { World } from '../physics/world';
import type { GameMap } from '../world/maps';
import type { Track } from '../world/track';
import { AIDriver, type AIMode, type NearCar } from './ai';
import { AI_LEVELS, driverPace, DRIVERS, type DriverData, type TeamData, teamOf, teamPerformance } from './field';
import { RacingLine } from './line';

export type GridMode = 'pole' | 'mid' | 'last' | 'random';

export interface RaceConfig {
  laps: number;
  /** Index in AI_LEVELS. */
  aiLevel: number;
  /** Fahrer des Spielers (Index in DRIVERS). */
  playerDriver: number;
  /** Anzahl Autos im Feld (inkl. Spieler), 2..22. */
  field: number;
  grid: GridMode;
  seed: number;
  /** Spielerauto von der KI fahren lassen (Tests/Demo). */
  autopilot?: boolean;
}

export interface Entrant {
  vi: number;
  driver: number; // Index in DRIVERS
  data: DriverData;
  team: TeamData;
  isPlayer: boolean;
  ai: AIDriver | null;
  idx: number;
  lapsDone: number; // Zählt Linienüberfahrten (Start: -1 hinter der Linie)
  prevIdx: number;
  dist: number;
  finished: boolean;
  finishTime: number;
  finishLaps: number;
  out: boolean;
  lapStart: number;
  lapsSeen: number;
  gridLat: number;
  best: number;
  last: number;
  pos: number;
  gapLeader: number;
  gapAhead: number;
  gapBehind: number;
  stopped: number;
  cpTimes: Float64Array;
  cpNext: number;
}

export type RaceState = 'grid' | 'racing' | 'finished';

const CP_LEN = 50;
const PARK_X = -8000;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Erzeugt das Fahrerfeld: Spieler zuerst, dann die KI-Fahrer; Reihenfolge nach Teamstärke für Startaufstellung. */
export function selectField(cfg: RaceConfig): number[] {
  const all = DRIVERS.map((_, i) => i).filter((i) => i !== cfg.playerDriver);
  // die schnellsten Teams zuerst (Gap), bei gleichem Gap Fahrerpace
  all.sort((a, b) => {
    const ta = teamOf(DRIVERS[a]).gap;
    const tb = teamOf(DRIVERS[b]).gap;
    if (ta !== tb) return ta - tb;
    return DRIVERS[b].pace - DRIVERS[a].pace;
  });
  const n = Math.max(1, Math.min(DRIVERS.length, cfg.field)) - 1;
  // gleichmäßig aus dem Gesamtfeld wählen, damit auch kleine Felder gemischt sind
  const picked: number[] = [];
  for (let k = 0; k < n; k++) picked.push(all[Math.min(all.length - 1, Math.floor((k * all.length) / Math.max(n, 1)))]);
  return [cfg.playerDriver, ...picked];
}

export class RaceDirector {
  readonly entrants: Entrant[] = [];
  readonly track: Track;
  readonly line: RacingLine;
  state: RaceState = 'grid';
  time = 0; // seit Rennstart (Lichter aus), negativ davor
  lights = 0;
  private sim = 0;
  private goAt = 6;
  private readonly rnd: () => number;
  private step = 0;
  private winnerTime = -1;
  private readonly cpCount: number;
  readonly order: number[] = [];

  constructor(
    private readonly world: World,
    map: GameMap,
    readonly cfg: RaceConfig,
    lineCache?: RacingLine,
  ) {
    this.track = map.track!;
    this.line = lineCache ?? new RacingLine(this.track);
    this.rnd = lcg(cfg.seed);
    this.cpCount = Math.ceil(this.track.length / CP_LEN) + 2;
    const ids = selectField(cfg);
    const level = AI_LEVELS[Math.min(AI_LEVELS.length - 1, Math.max(0, cfg.aiLevel))];
    for (let k = 0; k < ids.length; k++) {
      const data = DRIVERS[ids[k]];
      const team = teamOf(data);
      const isPlayer = k === 0;
      const perf = teamPerformance(team);
      const v = world.vehicles[k];
      v.teamPower = perf.power;
      v.teamAero = perf.aero;
      const ai =
        isPlayer && !cfg.autopilot
          ? null
          : new AIDriver(this.line, {
              pace: driverPace(data) * level.pace,
              consistency: Math.max(0.2, 1 - (1 - data.consistency / 100) * 5 * level.mistakes * 0.5),
              racecraft: data.racecraft / 100,
              seed: cfg.seed * 131 + k * 17 + 5,
            });
      this.entrants.push({
        vi: k,
        driver: ids[k],
        data,
        team,
        isPlayer,
        ai,
        idx: 0,
        lapsDone: -1,
        prevIdx: 0,
        dist: 0,
        finished: false,
        finishTime: 0,
        finishLaps: 0,
        out: false,
        lapStart: 0,
        lapsSeen: -1,
        gridLat: 0,
        best: 0,
        last: 0,
        pos: k + 1,
        gapLeader: 0,
        gapAhead: 0,
        gapBehind: 0,
        stopped: 0,
        cpTimes: new Float64Array((cfg.laps + 3) * this.cpCount).fill(-1),
        cpNext: 0,
      });
    }
    this.placeOnGrid();
  }

  /** Qualifying-Ergebnis (erwartete Rundenzeit mit Rauschen) und Aufstellung. */
  private placeOnGrid(): void {
    const t = this.track;
    const n = this.entrants.length;
    const score = this.entrants.map((e) => {
      const base = e.team.gap + (98 - e.data.pace) * 0.04 + (this.rnd() - 0.5) * 0.45;
      return { e, base };
    });
    const ai = score.filter((s) => !s.e.isPlayer).sort((a, b) => a.base - b.base);
    const player = this.entrants.find((e) => e.isPlayer)!;
    let slot = 0;
    switch (this.cfg.grid) {
      case 'pole':
        slot = 0;
        break;
      case 'mid':
        slot = Math.floor(n / 2);
        break;
      case 'last':
        slot = n - 1;
        break;
      case 'random':
        slot = Math.floor(this.rnd() * n);
        break;
    }
    const grid: Entrant[] = ai.map((s) => s.e);
    grid.splice(Math.min(slot, grid.length), 0, player);
    this.order.length = 0;
    for (let g = 0; g < grid.length; g++) {
      const e = grid[g];
      this.order.push(e.vi);
      const row = Math.floor(g / 2);
      const left = g % 2 === 0;
      // 8 m Reihenabstand, die rechte Spalte 4 m weiter hinten, Pole 10 m hinter der Linie
      const back = 10 + row * 8 + (left ? 0 : 4);
      const i = Math.round(back / t.ds);
      const idx = (t.n - i + t.n * 8) % t.n;
      const lat = (left ? 1 : -1) * 2.6;
      const x = t.x[idx] + t.nx(idx) * lat;
      const y = t.y[idx] + t.ny(idx) * lat;
      this.world.reset(e.vi, x, y, t.hdg[idx], 0);
      e.idx = idx;
      e.prevIdx = idx;
      e.lapsDone = -1;
      e.dist = -back;
      e.ai?.reset(idx);
      if (e.ai) {
        e.gridLat = lat;
        e.ai.lat = lat - this.line.offset[idx];
        e.ai.laneBias = e.ai.lat;
      }
      e.pos = g + 1;
    }
    this.state = 'grid';
    this.sim = 0;
    this.lights = 0;
    this.goAt = 5.2 + this.rnd() * 1.6;
    this.time = -this.goAt;
  }

  /** Pro Physikschritt aufrufen (vor world.step). */
  update(dt: number): void {
    this.sim += dt;
    this.step++;
    // Startsequenz: Lichter im Sekundentakt, nach goAt aus
    if (this.state === 'grid') {
      const elapsed = this.sim;
      this.time = elapsed - this.goAt;
      this.lights = elapsed >= this.goAt ? 6 : Math.min(5, Math.max(0, Math.floor(elapsed - 0.2)));
      for (const e of this.entrants) {
        const v = this.world.vehicles[e.vi];
        v.input.throttle = 0;
        v.input.brake = 1;
        if (e.ai) e.ai.update(dt, v, 'hold', null, null);
      }
      if (elapsed >= this.goAt) {
        this.state = 'racing';
        this.time = 0;
        for (const e of this.entrants) e.lapStart = 0;
      }
      return;
    }
    this.time += dt;
    // KI, Fortschritt, Rangfolge: alle 10 ms
    if (this.step % 5 === 0) this.tick(dt * 5);
  }

  private locate(e: Entrant, v: Vehicle): void {
    const t = this.track;
    const n = t.n;
    let best = e.idx;
    let bd = (v.x - t.x[best]) ** 2 + (v.y - t.y[best]) ** 2;
    if (bd > 35 * 35) {
      const j = t.nearest(v.x, v.y);
      if (j >= 0) {
        best = j;
        bd = (v.x - t.x[j]) ** 2 + (v.y - t.y[j]) ** 2;
      }
    }
    for (let k = -4; k <= 14; k++) {
      const j = (e.idx + k + n) % n;
      const d = (v.x - t.x[j]) ** 2 + (v.y - t.y[j]) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    e.prevIdx = e.idx;
    e.idx = best;
    // Runden: Sprung über die Startlinie
    if (e.prevIdx > n * 0.75 && best < n * 0.25) e.lapsDone++;
    else if (e.prevIdx < n * 0.25 && best > n * 0.75) e.lapsDone--;
    if (e.lapsDone < 0) e.dist = -(t.length - t.s[best]);
    else e.dist = e.lapsDone * t.length + t.s[best];
  }

  private tick(dt: number): void {
    const t = this.track;
    const ents = this.entrants;
    const L = t.length;
    const now = this.time;
    const cfgAuto = !!this.cfg.autopilot;

    for (const e of ents) {
      const v = this.world.vehicles[e.vi];
      if (e.out) continue;
      this.locate(e, v);
      // Zwischenzeiten alle 50 m
      const cp = Math.floor(Math.max(0, e.dist) / CP_LEN);
      while (e.cpNext <= cp && e.cpNext < e.cpTimes.length) e.cpTimes[e.cpNext++] = now;
      // Runden- und Bestzeit
      if (e.lapsDone > e.lapsSeen) {
        if (e.lapsDone >= 1) {
          e.last = now - e.lapStart;
          if (e.best === 0 || e.last < e.best) e.best = e.last;
        }
        e.lapStart = now;
      }
      e.lapsSeen = e.lapsDone;
      // Ausfall: stillstehendes, defektes Auto wird nach kurzer Zeit geborgen
      const sp = Math.hypot(v.u, v.v);
      if (v.retired && sp < 2.5) e.stopped += dt;
      else if (!v.retired) e.stopped = Math.max(0, e.stopped - dt);
      if (v.retired && e.stopped > 4 && !e.isPlayer) this.park(e);
    }

    // Rangfolge
    const active = ents.filter((e) => !e.out);
    active.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      return b.dist - a.dist;
    });
    const outs = ents.filter((e) => e.out).sort((a, b) => b.dist - a.dist);
    const ranked = [...active, ...outs];
    ranked.forEach((e, i) => (e.pos = i + 1));
    this.order.length = 0;
    for (const e of ranked) this.order.push(e.vi);

    // Zielüberfahrt
    const finishDist = this.cfg.laps * L;
    for (const e of active) {
      if (!e.finished && e.dist >= finishDist) {
        e.finished = true;
        e.finishTime = now;
        e.finishLaps = this.cfg.laps;
        if (this.winnerTime < 0) {
          this.winnerTime = now;
          // alle anderen beenden ihre aktuelle Runde
          for (const o of ents) if (!o.finished && !o.out) o.finishLaps = Math.min(this.cfg.laps, Math.max(0, o.lapsDone) + 1);
        }
      } else if (!e.finished && this.winnerTime >= 0 && e.dist >= e.finishLaps * L && e.finishLaps > 0) {
        e.finished = true;
        e.finishTime = now;
      }
    }

    // Abstände (Zeit)
    const leader = ranked[0];
    for (let i = 0; i < ranked.length; i++) {
      const e = ranked[i];
      if (e.out) {
        e.gapLeader = e.gapAhead = e.gapBehind = 0;
        continue;
      }
      if (i === 0) {
        e.gapLeader = 0;
        e.gapAhead = 0;
      } else {
        e.gapLeader = this.timeGap(e, leader, now);
        e.gapAhead = this.timeGap(e, ranked[i - 1], now);
      }
      const next = ranked[i + 1];
      if (next && !next.out) {
        const vb = this.world.vehicles[next.vi];
        const sp = Math.max(25, Math.hypot(vb.u, vb.v));
        e.gapBehind = Math.max(0, (e.dist - next.dist) / sp);
      } else e.gapBehind = 0;
    }

    // Windschatten und verwirbelte Luft
    this.slipstream(ranked);

    // KI-Steuerung: in der Startphase vorsichtiger (Pulk, enge erste Kurve)
    const player = ents.find((x) => x.isPlayer && !cfgAuto);
    const startEase = Math.min(1, 0.84 + 0.16 * (now / 45));
    for (const e of ents) {
      if (e.out || !e.ai) continue;
      const v = this.world.vehicles[e.vi];
      if (v.retired) {
        v.input.throttle = 0;
        v.input.brake = 0.3;
        continue;
      }
      // Startspur halten, bis die erste Kurve nahe ist
      e.ai.laneBias = e.gridLat * Math.max(0, 1 - Math.max(0, e.dist) / 550) - this.line.offset[e.idx] * Math.max(0, 1 - Math.max(0, e.dist) / 550);
      const { ahead, beside } = this.neighbours(e, ents);
      const mode: AIMode = e.finished ? 'cooldown' : 'race';
      // Gummiband: Feld bleibt beim Spieler (enges Rad-an-Rad-Rennen); zu weit Zurückliegende holen etwas auf,
      // zu weit Enteilte drosseln. Nur wenige Prozent Tempo, die Physik bleibt unverändert.
      let rubber = 1;
      if (!e.isPlayer && player && !player.out) {
        const L2 = t.length;
        let d = e.dist - player.dist;
        d = ((((d + L2 / 2) % L2) + L2) % L2) - L2 / 2;
        if (d < -40) rubber = 1 + Math.min(0.07, ((-d - 40) / 500) * 0.07);
        else if (d > 60) rubber = 1 - Math.min(0.1, ((d - 60) / 400) * 0.1);
      }
      e.ai.update(dt, v, mode, ahead, beside, startEase * rubber);
      // Streckenposten: festgefahrene KI zurück auf die Linie
      if (e.ai.stuckTime > 7 && !v.retired) {
        const i = (e.idx + 6) % t.n;
        this.world.teleport(e.vi, this.line.x[i], this.line.y[i], t.hdg[i]);
        e.ai.reset(i);
        e.idx = i;
      }
    }

    // Rennende: alle im Ziel oder Zeitlimit
    if (this.state === 'racing') {
      const everyoneDone = ents.every((e) => e.finished || e.out);
      if (this.winnerTime >= 0 && (everyoneDone || now - this.winnerTime > 40)) this.state = 'finished';
    }
  }

  private park(e: Entrant): void {
    e.out = true;
    this.world.teleport(e.vi, PARK_X, -e.vi * 8, 0);
    const v = this.world.vehicles[e.vi];
    v.input.throttle = 0;
    v.input.brake = 1;
  }

  /** Zeitabstand von `e` zu `ref`: Wie lange her ist es, dass `ref` an der aktuellen Position von `e` war. */
  private timeGap(e: Entrant, ref: Entrant, now: number): number {
    const L = this.track.length;
    const lapGap = ref.dist - e.dist;
    if (lapGap > L * 0.98 && !(e.finished && ref.finished)) return -Math.floor(lapGap / L + 0.02);
    const x = Math.max(0, e.dist) / CP_LEN;
    const c = Math.floor(x);
    if (c >= ref.cpTimes.length - 1) return Math.max(0, e.finishTime - ref.finishTime);
    const t0 = ref.cpTimes[c];
    if (t0 < 0) return 0;
    const t1 = ref.cpTimes[c + 1];
    const frac = x - c;
    const tRef = t1 >= 0 ? t0 + (t1 - t0) * frac : t0;
    const ref0 = e.finished ? e.finishTime : now;
    return Math.max(0, ref0 - tRef);
  }

  private neighbours(e: Entrant, ents: Entrant[]): { ahead: NearCar | null; beside: NearCar | null } {
    const t = this.track;
    const L = t.length;
    let ahead: NearCar | null = null;
    let beside: NearCar | null = null;
    for (const o of ents) {
      if (o === e || o.out) continue;
      let d = o.dist - e.dist;
      d = ((((d + L / 2) % L) + L) % L) - L / 2;
      const vo = this.world.vehicles[o.vi];
      const lat = t.lateral(o.idx, vo.x, vo.y);
      const sp = Math.hypot(vo.u, vo.v);
      if (d > -6 && d < 6) {
        if (!beside || Math.abs(d) < Math.abs(beside.gap)) beside = { gap: d, lat, speed: sp };
      }
      if (d > 0 && d < 75) {
        if (!ahead || d < ahead.gap) ahead = { gap: d, lat, speed: sp };
      }
    }
    return { ahead, beside };
  }

  private slipstream(ranked: Entrant[]): void {
    const t = this.track;
    const L = t.length;
    for (const e of ranked) {
      const v = this.world.vehicles[e.vi];
      let drag = 1;
      let front = 1;
      let rear = 1;
      if (!e.out) {
        for (const o of ranked) {
          if (o === e || o.out) continue;
          let d = o.dist - e.dist;
          d = ((((d + L / 2) % L) + L) % L) - L / 2;
          if (d <= 4 || d > 34) continue;
          const vo = this.world.vehicles[o.vi];
          const lat = Math.abs(t.lateral(o.idx, vo.x, vo.y) - t.lateral(e.idx, v.x, v.y));
          if (lat > 2.0) continue;
          const f = (1 - (d - 4) / 30) * (1 - lat / 2.0);
          drag = Math.min(drag, 1 - 0.3 * f);
          front = Math.min(front, 1 - 0.3 * f * (d < 20 ? 1 : 0.4));
          rear = Math.min(rear, 1 - 0.14 * f);
        }
      }
      v.dragScale = drag;
      v.aeroScaleFront = front;
      v.aeroScaleRear = rear;
    }
  }

  /** Schreibt die Rennfelder eines Autos in einen Fahrzeugblock. */
  writeRace(out: Float64Array, base: number, vi: number): void {
    const e = this.entrants[vi];
    if (!e) return;
    out[base + S.raceLap] = Math.min(this.cfg.laps, Math.max(0, e.lapsDone) + 1);
    out[base + S.racePos] = e.pos;
    out[base + S.raceDist] = e.dist;
    out[base + S.raceGapLeader] = e.gapLeader;
    out[base + S.raceGapAhead] = e.gapAhead;
    out[base + S.raceGapBehind] = e.gapBehind;
    out[base + S.raceFinished] = e.finished ? 1 : 0;
    out[base + S.raceOut] = e.out ? 1 : 0;
    out[base + S.raceDriver] = e.driver;
    out[base + S.raceBest] = e.best;
    out[base + S.raceLast] = e.last;
    out[base + S.raceState] = this.state === 'grid' ? 0 : this.state === 'racing' ? 1 : 2;
    out[base + S.raceLights] = this.lights;
    out[base + S.raceTime] = this.time;
    out[base + S.raceLaps] = this.cfg.laps;
    out[base + S.raceFinishTime] = e.finished ? e.finishTime : 0;
  }
}
