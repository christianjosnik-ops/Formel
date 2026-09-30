import { S } from '../physics/layout';
import type { PhysicsClient } from '../physics/client';
import { DRIVERS, shortName, teamOf } from '../race/field';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function fmtGap(v: Float64Array): string {
  if (v[S.raceOut] > 0.5) return 'AUS';
  const pos = v[S.racePos];
  const g = v[S.raceGapLeader];
  if (pos === 1) return v[S.raceFinished] > 0.5 ? 'Sieger' : 'Führt';
  if (g < 0) return `+${-g} Rd`;
  if (g <= 0) return '—';
  return g < 100 ? `+${g.toFixed(g < 10 ? 3 : 2)}` : `+${Math.floor(g / 60)}:${(g % 60).toFixed(1).padStart(4, '0')}`;
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
}

/** Live-Rangliste, Rundenanzeige, Startampel und Ergebnis. */
export class RaceHud {
  private acc = 1;
  private bannerT = 0;
  private shown = false;
  private finishedShown = false;
  private prevState = -1;
  private lastLap = 0;
  onAgain: () => void = () => {};
  onMenu: () => void = () => {};

  constructor() {
    $('resAgain').addEventListener('click', () => this.onAgain());
    $('resMenu').addEventListener('click', () => this.onMenu());
  }

  setActive(on: boolean): void {
    $('race').classList.toggle('hidden', !on);
    if (!on) {
      $('results').classList.add('hidden');
      this.finishedShown = false;
    }
    this.shown = on;
    this.prevState = -1;
    this.lastLap = 0;
  }

  update(physics: PhysicsClient, dt: number): void {
    if (!this.shown) return;
    const n = physics.carCount;
    if (n === 0) return;
    const me = physics.out;
    const state = me[S.raceState];
    const lights = me[S.raceLights];
    const box = $('lights');
    box.classList.toggle('show', state === 0 || (state === 1 && me[S.raceTime] < 1.6));
    const lamps = box.children;
    for (let i = 0; i < 5; i++) lamps[i].classList.toggle('on', state === 0 && lights >= i + 1 && lights < 6);
    const banner = $('banner');
    if (state === 1 && this.prevState === 0) this.say('LOS!', 1.4);
    this.prevState = state;
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) banner.textContent = '';
    }
    const total = me[S.raceLaps];
    const lap = Math.min(total, Math.max(1, me[S.raceLap]));
    $('raceLap').textContent = `RUNDE ${lap}/${total}`;
    if (total > 1 && lap === total && this.lastLap < total && state === 1) this.say('LETZTE RUNDE', 1.8);
    this.lastLap = lap;
    $('racePos').textContent = `P${me[S.racePos]}/${n}`;
    if (me[S.raceFinished] > 0.5 && state === 1 && !this.finishedShown) {
      this.say(`ZIEL · P${me[S.racePos]}`, 99);
    }

    this.acc += dt;
    if (this.acc >= 0.2) {
      this.acc = 0;
      this.board(physics, n);
    }
    if (state === 2 && !this.finishedShown) {
      this.finishedShown = true;
      this.banner('');
      this.results(physics, n);
    }
  }

  private say(t: string, sec: number): void {
    $('banner').textContent = t;
    this.bannerT = sec;
  }
  private banner(t: string): void {
    $('banner').textContent = t;
    this.bannerT = 0;
  }

  private rows(physics: PhysicsClient, n: number): Float64Array[] {
    const list: Float64Array[] = [];
    for (let k = 0; k < n; k++) {
      const v = physics.carView(k);
      if (v) list.push(Float64Array.from(v.subarray(0, S.contacts)));
    }
    list.sort((a, b) => a[S.racePos] - b[S.racePos]);
    return list;
  }

  private board(physics: PhysicsClient, n: number): void {
    const rows = this.rows(physics, n);
    const maxRows = window.innerHeight < 560 ? 9 : 22;
    let idx = rows.map((_, i) => i);
    let myI = rows.findIndex((r) => r === rows.find((x) => x[S.raceDriver] === physics.out[S.raceDriver]));
    if (myI < 0) myI = 0;
    if (rows.length > maxRows) {
      const keep = new Set<number>([0, 1, 2]);
      const from = Math.max(3, Math.min(rows.length - (maxRows - 3), myI - Math.floor((maxRows - 3) / 2)));
      for (let i = from; i < from + (maxRows - 3); i++) keep.add(i);
      idx = [...keep].sort((a, b) => a - b);
    }
    let html = '';
    let prev = -1;
    for (const i of idx) {
      if (prev >= 0 && i > prev + 1) html += '<div class="sep">⋮</div>';
      prev = i;
      const r = rows[i];
      const d = DRIVERS[r[S.raceDriver] | 0];
      const t = teamOf(d);
      const me = i === myI;
      const ahead = r[S.racePos] > 1 && r[S.raceOut] < 0.5 && r[S.raceGapAhead] > 0 ? `+${r[S.raceGapAhead].toFixed(1)}` : '';
      html += `<div class="row${me ? ' me' : ''}${r[S.raceOut] > 0.5 ? ' out' : ''}"><span>${r[S.racePos]}</span><span class="bar" style="background:${t.colors.primary}"></span><span>${shortName(d)}</span><span class="gap">${fmtGap(r as Float64Array)}${me || !ahead ? '' : `<small>${ahead}</small>`}</span></div>`;
    }
    $('board').innerHTML = html;
  }

  private results(physics: PhysicsClient, n: number): void {
    const rows = this.rows(physics, n);
    const myDriver = physics.out[S.raceDriver];
    let html = '';
    for (const r of rows) {
      const d = DRIVERS[r[S.raceDriver] | 0];
      const t = teamOf(d);
      const me = r[S.raceDriver] === myDriver;
      const best = r[S.raceBest] > 0 ? fmtTime(r[S.raceBest]) : '';
      html += `<div class="rrow${me ? ' me' : ''}"><span>${r[S.racePos]}</span><span class="bar" style="background:${t.colors.primary}"></span><span>${d.name}</span><span>${fmtGap(r as Float64Array)}</span><span>${best}</span></div>`;
    }
    $('resList').innerHTML = `<div class="rrow"><span></span><span></span><span></span><span>Abstand</span><span>Beste</span></div>${html}`;
    $('results').classList.remove('hidden');
  }
}
