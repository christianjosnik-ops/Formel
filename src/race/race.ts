import { S } from '../physics/layout';
import type { Vehicle } from '../physics/vehicle';
import type { World } from '../physics/world';
import type { GameMap } from '../world/maps';
import type { Track } from '../world/track';
import { AIDriver, type AIMode, type Rival } from './ai';
import { AI_LEVELS, driverPace, DRIVERS, type DriverData, type TeamData, teamOf, teamPerformance } from './field';
import { RacingLine } from './line';
import { PIT } from '../world/track';
import { SafetyCarSim } from './safetycar';
import { COMPOUND_ORDER, wetCompound, wetGrip, type CompoundId } from '../config/tyres';

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
  /** Startaufstellung als Fahrer-Indizes (Pole zuerst), z. B. aus dem Qualifying. */
  gridOrder?: number[];
  /** Spielerauto von der KI fahren lassen (Tests/Demo). */
  autopilot?: boolean;
  /** Verschleißfaktor (0 = aus, 1 = normal, 2 = hoch). */
  wearScale?: number;
  /** Boxen-Automatik für den Spieler (Einfahrt, Halt, Ausfahrt per KI-Steuerung). */
  pitAssist?: boolean;
  /** Safety Car bei Unfällen (Standard an). */
  safetyCar?: boolean;
  /** Startreifen des Spielers. */
  startCompound?: CompoundId;
  /** Upgrades des Spielers (Stufen 0..5). */
  upgrades?: { engine: number; aero: number; brakes: number; tyres: number; weight: number };
}

export interface Entrant {
  /** Höchstgeschwindigkeit unter Safety Car [m/s] (Infinity = frei). */
  scCap: number;
  /** Unfall dieses Autos ist schon gemeldet. */
  incidentSeen: boolean;
  /** Sekunden, seit die Mischung nicht mehr zur Streckennässe passt (KI wechselt nach Verzögerung). */
  wrongT: number;
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
  /** Sekunden mit nahezu Stillstand im Rennen (Hindernis-Erkennung für die KI). */
  slowT: number;
  cpTimes: Float64Array;
  cpNext: number;
  /** Boxenstopp: 0 keiner, 1 angefordert, 2 Boxengasse, 3 Reifenwechsel, 4 Ausfahrt. */
  pit: number;
  pitStops: number;
  pitTimer: number;
  pitSvc: number;
  pitEntryLat: number;
  pitThr: number;
  pitReq: boolean;
  nextCompound: CompoundId;
  limiter: boolean;
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
  /** Steuerung des Spielerautos in der Boxengasse (Boxen-Automatik). */
  private readonly pitDriver: AIDriver;
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
  readonly sc: SafetyCarSim;

  constructor(
    private readonly world: World,
    map: GameMap,
    readonly cfg: RaceConfig,
    lineCache?: RacingLine,
  ) {
    this.track = map.track!;
    this.line = lineCache ?? new RacingLine(this.track);
    this.sc = new SafetyCarSim(this.track, this.line);
    this.pitDriver = new AIDriver(this.line, { pace: 1, consistency: 1, racecraft: 0, seed: 99 });
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
        scCap: Infinity,
        incidentSeen: false,
        wrongT: 0,
        slowT: 0,
        cpTimes: new Float64Array((cfg.laps + 3) * this.cpCount).fill(-1),
        cpNext: 0,
        pit: 0,
        pitStops: 0,
        pitTimer: 0,
        pitSvc: 2.4 + this.rnd() * 1.0,
        pitEntryLat: 0,
        pitThr: 0.6 + this.rnd() * 0.16,
        pitReq: false,
        nextCompound: 'medium',
        limiter: false,
      });
      v.wearScale = cfg.wearScale ?? 1;
      const r0 = this.rnd();
      const wc = wetCompound(v.wetness);
      const dry = r0 < 0.3 ? 'soft' : r0 < 0.8 ? 'medium' : 'hard';
      // Start auf nasser Strecke: KI wählt passende Regenreifen (an der Grenze zwischen Inter und Regen mit etwas Streuung)
      const wetPick: CompoundId | null = wc === 'wet' ? (v.wetness < 0.7 && r0 < 0.4 ? 'inter' : 'wet') : wc === 'inter' ? (v.wetness > 0.5 && r0 > 0.8 ? 'wet' : 'inter') : null;
      v.fitTyres(isPlayer ? cfg.startCompound ?? (wetPick ?? 'medium') : (wetPick ?? dry));
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
    let grid: Entrant[] = ai.map((s) => s.e);
    grid.splice(Math.min(slot, grid.length), 0, player);
    if (this.cfg.gridOrder) {
      const byDriver = new Map(this.entrants.map((e) => [e.driver, e]));
      const ordered = this.cfg.gridOrder.map((d) => byDriver.get(d)).filter((e): e is Entrant => !!e);
      for (const e of grid) if (!ordered.includes(e)) ordered.push(e);
      grid = ordered;
    }
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
        if (e.ai) e.ai.update(dt, v, 'hold', []);
      }
      if (elapsed >= this.goAt) {
        this.state = 'racing';
        this.time = 0;
        for (const e of this.entrants) e.lapStart = 0;
      }
      return;
    }
    this.time += dt;
    this.applyPlayerOverrides();
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
      // Stillstand auf der Strecke (Dreher, Unfall ohne Ausfall): andere weichen aus
      if (sp < 1.5 && this.state === 'racing' && now > 10 && e.pit === 0 && Math.abs(this.track.lateral(e.idx, v.x, v.y)) < this.track.wl[e.idx]) e.slowT += dt;
      else e.slowT = Math.max(0, e.slowT - 2 * dt);
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

    this.updateSafety(dt, ranked);

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

    const pl = ents[0];
    if (pl.isPlayer && !pl.ai && !pl.out) this.pitPlayer(pl, this.world.vehicles[pl.vi], dt);

    // KI-Steuerung: in der Startphase vorsichtiger (Pulk, enge erste Kurve)
    const player = ents.find((x) => x.isPlayer && !cfgAuto);
    const startEase = Math.min(1, 0.72 + 0.28 * (now / 75));
    for (const e of ents) {
      if (e.out || !e.ai) continue;
      const v = this.world.vehicles[e.vi];
      if (v.retired) {
        v.input.throttle = 0;
        v.input.brake = 0.3;
        continue;
      }
      // Startspur halten, bis die erste Kurve nahe ist
      e.ai.laneBias = e.gridLat * Math.max(0, 1 - Math.max(0, e.dist - 150) / 800) - this.line.offset[e.idx] * Math.max(0, 1 - Math.max(0, e.dist - 150) / 800);
      if (this.pitAI(e, v, dt)) continue;
      const rivals = this.neighbours(e, ents);
      const mode: AIMode = e.finished ? 'cooldown' : 'race';
      // Gummiband: Feld bleibt beim Spieler (enges Rad-an-Rad-Rennen); zu weit Zurückliegende holen etwas auf,
      // zu weit Enteilte drosseln. Nur wenige Prozent Tempo, die Physik bleibt unverändert.
      let rubber = 1;
      if (!e.isPlayer && player && !player.out && !this.sc.active) {
        const L2 = t.length;
        let d = e.dist - player.dist;
        d = ((((d + L2 / 2) % L2) + L2) % L2) - L2 / 2;
        if (d < -40) rubber = 1 + Math.min(0.08, ((-d - 40) / 400) * 0.08);
        else if (d > 60) rubber = 1 - Math.min(0.1, ((d - 60) / 400) * 0.1);
      }
      e.ai.setGrip(wetGrip(v.compound, v.wetness));
      e.ai.update(dt, v, mode, rivals, startEase * rubber);
      if (e.scCap < Infinity && e.pit === 0) this.limitSpeed(v, e.scCap);
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

  /** Bremst/nimmt Gas weg, wenn das Auto schneller als cap [m/s] fährt. */
  private limitSpeed(v: Vehicle, cap: number): void {
    const speed = Math.hypot(v.u, v.v);
    const over = speed - cap;
    if (over > 0) {
      v.input.throttle = 0;
      v.input.brake = Math.max(v.input.brake, Math.min(0.75, 0.1 + over * 0.09));
    } else if (over > -2.5) v.input.throttle *= Math.max(0, -over / 2.5);
  }

  /** Unfälle, gelbe Flaggen, Safety Car und Tempobegrenzungen. */
  private updateSafety(dt: number, ranked: Entrant[]): void {
    const sc = this.sc;
    const t = this.track;
    const wet = this.world.vehicles[0]?.wetness ?? 0;
    if (this.cfg.safetyCar !== false && this.state === 'racing') {
      const remaining = this.cfg.laps - (ranked.find((r) => !r.out)?.dist ?? 0) / t.length;
      for (const e of this.entrants) {
        if (e.out) continue;
        const v = this.world.vehicles[e.vi];
        const sp = Math.hypot(v.u, v.v);
        const hit = e.pit === 0 && this.time > 12 && ((v.retired && sp < 6) || e.slowT > 2.5);
        if (hit) {
          sc.incident(t.s[e.idx], !!v.retired || e.slowT > 4);
          if (!e.incidentSeen) {
            e.incidentSeen = true;
            if (remaining > 1.8 && this.rnd() < 0.8) {
              const lead = ranked.find((r) => !r.out && !r.finished);
              if (lead) sc.deploy(lead.dist, wet);
            }
          }
        } else if (!v.retired && e.slowT < 0.5) e.incidentSeen = false;
      }
    }
    sc.update(dt, wet);
    // Tempobegrenzung: jedes Auto hinter SC bzw. Vordermann
    let ref = -1;
    for (const e of ranked) {
      e.scCap = Infinity;
      if (!sc.active || e.out || e.finished || e.pit >= 2) continue;
      let refDist: number;
      let refSpeed: number;
      if (ref < 0) {
        refDist = sc.dist;
        refSpeed = sc.speed;
      } else {
        const r = this.entrants[ref];
        refDist = r.dist;
        const rv = this.world.vehicles[r.vi];
        refSpeed = Math.hypot(rv.u, rv.v);
      }
      // auf Runde Zurückliegende zählen den Abstand zum nächsten Auto davor in der gleichen Runde
      let gap = refDist - e.dist - 5;
      if (gap > t.length * 0.5) gap -= Math.floor(gap / t.length) * t.length;
      e.scCap = sc.cap(refSpeed, gap, wet);
      ref = this.entrants.indexOf(e);
    }
  }

  private rel(idx: number): number {
    const t = this.track;
    return t.s[idx] > t.length / 2 ? t.s[idx] - t.length : t.s[idx];
  }

  /** Wahl der nächsten Mischung anhand der Restdistanz. */
  private pickCompound(e: Entrant): CompoundId {
    const wc = wetCompound(this.world.vehicles[e.vi].wetness);
    if (wc) return wc;
    const rem = this.cfg.laps - e.dist / this.track.length;
    return rem <= 6 ? 'soft' : rem <= 11 ? 'medium' : 'hard';
  }

  private smooth(a: number, b: number, x: number): number {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  }

  /** Setzt die Boxenanforderung des Spielers (HUD-Knopf). */
  setPlayerPit(request: boolean, compound: CompoundId): void {
    const e = this.entrants.find((x) => x.isPlayer);
    if (!e || e.out) return;
    e.nextCompound = compound;
    if (request && e.pit === 0) {
      e.pitReq = true;
      e.pit = 1;
    } else if (!request && e.pit === 1) {
      e.pitReq = false;
      e.pit = 0;
    }
  }

  /** Boxengasse für KI: Einfahrt, Anfahrt zur Box, Reifenwechsel, Ausfahrt. true = Auto wird hier gesteuert. */
  private pitAI(e: Entrant, v: Vehicle, dt: number): boolean {
    const t = this.track;
    const ai = e.ai ?? this.pitDriver;
    const rel = this.rel(e.idx);
    const speed = Math.hypot(v.u, v.v);
    const box = t.pit.boxes[e.driver % t.pit.boxes.length];
    const wl = t.wl[e.idx];
    if (e.pit === 0) {
      let wmax = 0;
      for (let i = 0; i < 4; i++) wmax = Math.max(wmax, v.tyreWear[i]);
      const remaining = this.cfg.laps - e.dist / t.length;
      const w = v.wetness;
      // Wetterwechsel: Mischung passt nicht mehr zur Streckennässe -> nach kurzer, je Fahrer verschiedener Verzögerung an die Box
      const wrong = (v.compound === 'inter' ? w > 0.8 || w < 0.1 : v.compound === 'wet' ? w < 0.35 : w > 0.3);
      e.wrongT = wrong ? e.wrongT + dt : 0;
      const wrongDelay = 4 + (e.pitThr - 0.6) * 50;
      if (!e.isPlayer && this.cfg.laps >= 2 && e.pitStops < 4 && remaining > 0.7 && !e.finished && !v.retired && e.wrongT > wrongDelay) {
        e.pit = 1;
        e.nextCompound = this.pickCompound(e);
        e.wrongT = 0;
      } else if (!e.isPlayer && this.cfg.laps >= 2 && e.pitStops < 3 && wmax > e.pitThr && remaining > 1.4 && !e.finished && !v.retired) {
        e.pit = 1;
        e.nextCompound = this.pickCompound(e);
      }
    }
    const pz = t.pitZone;
    if (e.pit === 1 && rel > pz.entry0 - 25 && rel < pz.full0 - 40) {
      e.pit = 2;
      e.pitEntryLat = t.lateral(e.idx, v.x, v.y);
    }
    if (e.pit === 0 || e.pit === 1) return false;
    const limit = PIT.limit;
    if (e.pit === 2) {
      const dBox = box.s - rel;
      const k = this.smooth(pz.entry0 - 10, pz.full0 + 5, rel);
      let lat = e.pitEntryLat + (wl + PIT.fastLane - e.pitEntryLat) * k;
      lat += (PIT.workLane - PIT.fastLane) * this.smooth(45, 8, dBox);
      let vT: number;
      if (rel < pz.full0) vT = Math.sqrt(limit * limit + 2 * 6 * Math.max(0, pz.full0 - rel));
      else vT = limit;
      vT = Math.min(vT, Math.sqrt(2 * 3 * Math.max(0, dBox - 1.4)) + 0.2);
      if (dBox < -6) {
        // Box verpasst: weiter durch die Gasse und ausfahren
        e.pit = 4;
        return true;
      }
      ai.driveTo(dt, v, lat, Math.min(vT, 90));
      if (speed < 0.6 && Math.abs(dBox) < 4.5) {
        e.pit = 3;
        e.pitTimer = e.pitSvc;
      }
      return true;
    }
    if (e.pit === 3) {
      v.input.throttle = 0;
      v.input.brake = 1;
      v.input.steer = 0;
      e.pitTimer -= dt;
      if (e.pitTimer <= 0) {
        v.fitTyres(e.nextCompound);
        e.pitStops++;
        e.pitReq = false;
        e.pit = 4;
      }
      return true;
    }
    // Ausfahrt
    const dOut = rel - box.s;
    const lat = wl + PIT.fastLane + (PIT.workLane - PIT.fastLane) * (1 - this.smooth(0, 25, dOut));
    const vT = rel < pz.full1 - 8 ? limit : limit + (rel - (pz.full1 - 8)) * 0.6;
    ai.driveTo(dt, v, lat, vT);
    if (rel > pz.full1 + 5 || rel < pz.entry0 - 60) {
      e.pit = 0;
      ai.lat = Math.max(-6, Math.min(8, t.lateral(e.idx, v.x, v.y) - this.line.offset[e.idx]));
      ai.laneBias = 0;
    }
    return true;
  }

  /** Boxengasse für den Spieler: Begrenzer, Reifenwechsel an der eigenen Box. */
  private pitPlayer(e: Entrant, v: Vehicle, dt: number): void {
    if (this.cfg.pitAssist !== false) {
      // Automatik: Einfahrt, Halt in der eigenen Box, Reifenwechsel und Ausfahrt übernimmt die Boxen-KI
      e.limiter = false;
      this.pitAI(e, v, dt);
      return;
    }
    const t = this.track;
    const rel = this.rel(e.idx);
    const lat = t.lateral(e.idx, v.x, v.y);
    const wl = t.wl[e.idx];
    const speed = Math.hypot(v.u, v.v);
    const box = t.pit.boxes[e.driver % t.pit.boxes.length];
    const pzp = t.pitZone;
    const inLane = lat > wl + 0.9 && rel > pzp.full0 - 10 && rel < pzp.full1 + 10;
    e.limiter = inLane;
    if (e.pit === 3) {
      e.pitTimer -= dt;
      if (e.pitTimer <= 0) {
        v.fitTyres(e.nextCompound);
        e.pitStops++;
        e.pitReq = false;
        e.pit = 4;
      }
      return;
    }
    if (e.pit === 4) {
      if (!inLane) e.pit = 0;
      return;
    }
    if (e.pitReq && inLane && speed < 0.8 && Math.abs(rel - box.s) < 4 && lat > wl + 7.6 && lat < wl + 13.6) {
      e.pit = 3;
      e.pitTimer = e.pitSvc;
    }
  }

  /** Pro Physikschritt: Bremse halten beim Reifenwechsel, Begrenzer in der Boxengasse (Spieler). */
  private applyPlayerOverrides(): void {
    const e = this.entrants[0];
    if (!e || !e.isPlayer || e.ai) return;
    const v = this.world.vehicles[e.vi];
    if (e.pit === 3) {
      v.input.throttle = 0;
      v.input.brake = 1;
    } else if (e.scCap < Infinity && e.pit === 0) {
      this.limitSpeed(v, e.scCap * 1.03);
    } else if (e.limiter) {
      const speed = Math.hypot(v.u, v.v);
      const over = speed - PIT.limit;
      if (over > 0) {
        v.input.throttle = 0;
        v.input.brake = Math.max(v.input.brake, Math.min(0.7, 0.15 + over * 0.12));
      } else if (over > -2.5) v.input.throttle *= Math.max(0, -over / 2.5);
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

  /** Alle relevanten Autos in der Nähe (-60 m .. +170 m entlang der Strecke) aus Sicht von e. */
  private neighbours(e: Entrant, ents: Entrant[]): Rival[] {
    const t = this.track;
    const L = t.length;
    const out: Rival[] = [];
    for (const o of ents) {
      if (o === e || o.out) continue;
      let d = o.dist - e.dist;
      d = ((((d + L / 2) % L) + L) % L) - L / 2;
      if (d < -60 || d > 170) continue;
      const vo = this.world.vehicles[o.vi];
      const sp = Math.hypot(vo.u, vo.v);
      const lat = t.lateral(o.idx, vo.x, vo.y);
      // in der Boxengasse (weit außerhalb der Fahrbahn) kein Hindernis
      if (o.pit >= 2 && Math.abs(lat) > t.wl[o.idx] + 1) continue;
      const wreck = vo.retired > 0 || (o.slowT > 3.5 && !o.ai?.evading) || (sp > 3 && sp < 40 && Math.abs(vo.v) > 0.55 * Math.abs(vo.u) + 3);
      out.push({ id: o.vi, gap: d, lat, speed: sp, wreck });
    }
    return out;
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
    out[base + S.pitState] = e.pit;
    out[base + S.pitTimer] = e.pit === 3 ? Math.max(0, e.pitTimer) : 0;
    out[base + S.pitStops] = e.pitStops;
    out[base + S.pitBoxS] = this.track.pit.boxes[e.driver % this.track.pit.boxes.length].s;
    out[base + S.pitLimiter] = e.limiter ? 1 : 0;
    out[base + S.pitNext] = COMPOUND_ORDER.indexOf(e.nextCompound);
    out[base + S.pitSvc] = e.pitSvc;
    // Abstand zur Box für die Crew-Animation: nur innerhalb der Boxengasse gültig
    const box = this.track.pit.boxes[e.driver % this.track.pit.boxes.length];
    const rel = this.rel(e.idx);
    const pz = this.track.pitZone;
    const veh = this.world.vehicles[e.vi];
    const inLane = veh && this.track.lateral(e.idx, veh.x, veh.y) > this.track.wl[e.idx] + 0.9 && rel > pz.full0 - 10 && rel < pz.full1 + 10;
    const sc = this.sc;
    out[base + S.scState] = sc.state;
    out[base + S.scX] = sc.x;
    out[base + S.scY] = sc.y;
    out[base + S.scPsi] = sc.psi;
    out[base + S.scTime] = sc.state ? sc.t : 0;
    out[base + S.flag] = sc.flagAt(this.track.s[e.idx]);
    out[base + S.pitDBox] = e.pit === 3 ? 0 : e.pit >= 2 || inLane ? box.s - rel : 999;
  }
}
