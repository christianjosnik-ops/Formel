import { S } from '../physics/layout';
import type { PhysicsClient } from '../physics/client';
import { DRIVERS, shortName, teamOf } from '../race/field';
import { COMPOUND_ORDER, type CompoundId } from '../config/tyres';

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
  kind: 'race' | 'quali' = 'race';
  onQuali: (best: number) => void = () => {};
  onFinish: (pos: number, n: number, dnf: boolean) => string = () => '';
  private physics: PhysicsClient | null = null;
  prizeText = '';
  /** Boxen-Automatik aktiv (aus den Einstellungen). */
  pitAuto = true;
  private want = false;
  private wantAt = 0;
  private cmp: CompoundId = 'medium';
  onAgain: () => void = () => {};
  onMenu: () => void = () => {};

  private sendPit(): void {
    this.physics?.pit(this.want, this.cmp);
  }

  constructor() {
    $('btnBox').addEventListener('click', () => {
      this.want = !this.want;
      this.wantAt = performance.now();
      this.sendPit();
    });
    document.querySelectorAll<HTMLButtonElement>('#cmpSel button').forEach((b) =>
      b.addEventListener('click', () => {
        this.cmp = b.dataset.c as CompoundId;
        this.sendPit();
      }),
    );
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && this.shown) $('btnBox').click();
    });
    $('resAgain').addEventListener('click', () => {
      $('results').classList.add('hidden');
      const a = this.tableAction;
      this.tableAction = null;
      $('resTitle').textContent = 'Ergebnis';
      if (a) a();
      else this.onAgain();
    });
    $('resMenu').addEventListener('click', () => this.onMenu());
  }

  setActive(on: boolean, kind: 'race' | 'quali' = 'race'): void {
    this.kind = kind;
    $('race').classList.toggle('hidden', !on);
    if (!on) {
      $('results').classList.add('hidden');
      this.finishedShown = false;
    }
    this.shown = on;
    this.prevState = -1;
    this.lastLap = 0;
    this.want = false;
    this.stopsSeen = 0;
  }

  update(physics: PhysicsClient, dt: number): void {
    if (!this.shown) return;
    this.physics = physics;
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
    const q = this.kind === 'quali';
    $('raceLap').textContent = q ? `QUALIFYING · RUNDE ${lap}/${total}` : `RUNDE ${lap}/${total}`;
    if (!q && total > 1 && lap === total && this.lastLap < total && state === 1) this.say('LETZTE RUNDE', 1.8);
    this.lastLap = lap;
    $('racePos').textContent = q ? (me[S.raceBest] > 0 ? `Beste ${fmtTime(me[S.raceBest])}` : 'Beste –') : `P${me[S.racePos]}/${n}`;
    if (me[S.raceFinished] > 0.5 && state === 1 && !this.finishedShown) {
      this.say(q ? 'QUALIFYING BEENDET' : `ZIEL · P${me[S.racePos]}`, 99);
    }

    this.tyres(me);
    this.acc += dt;
    if (this.acc >= 0.2) {
      this.acc = 0;
      this.board(physics, n);
    }
    if (state === 2 && !this.finishedShown) {
      this.finishedShown = true;
      this.banner('');
      if (q) this.onQuali(me[S.raceBest]);
      else {
        this.prizeText = this.onFinish(me[S.racePos] | 0, n, me[S.raceOut] > 0.5 || (me[S.raceFinished] < 0.5 && me[S.retired] > 0.5));
        this.results(physics, n);
      }
    }
  }

  /** Ergebnistafel (z. B. Qualifying) mit Weiter-Knopf. */
  showTable(title: string, rows: Array<{ pos: number; name: string; color: string; time: string; gap: string; me: boolean }>, button: string, action: () => void): void {
    $('resTitle').textContent = title;
    let html = `<div class="rrow"><span></span><span></span><span></span><span>Zeit</span><span>Abstand</span></div>`;
    for (const r of rows) html += `<div class="rrow${r.me ? ' me' : ''}"><span>${r.pos}</span><span class="bar" style="background:${r.color}"></span><span>${r.name}</span><span>${r.time}</span><span>${r.gap}</span></div>`;
    $('resList').innerHTML = html;
    $('resAgain').textContent = button;
    $('resPrize').textContent = '';
    this.tableAction = action;
    $('results').classList.remove('hidden');
  }
  tableAction: (() => void) | null = null;

  private tyres(me: Float64Array): void {
    const ci = me[S.compound] | 0;
    const c = COMPOUND_ORDER[ci] ?? 'medium';
    const badge = $('tyreBadge');
    badge.textContent = c === 'soft' ? 'S' : c === 'medium' ? 'M' : c === 'hard' ? 'H' : c === 'inter' ? 'I' : 'W';
    badge.style.borderColor = c === 'soft' ? '#ff3b30' : c === 'medium' ? '#ffd12e' : c === 'hard' ? '#f2f2f2' : c === 'inter' ? '#2ecc40' : '#1f77ff';
    const bars = $('tyreBars').children;
    for (let i = 0; i < 4; i++) {
      const w = me[S.tyreWear + i];
      const t = me[S.tyreTemp + i];
      const el = bars[i] as HTMLElement;
      const fill = el.firstElementChild as HTMLElement;
      fill.style.height = `${Math.max(3, (1 - w) * 100)}%`;
      fill.style.background = `hsl(${Math.max(0, 125 * (1 - w * w * 1.1))} 70% 48%)`;
      el.classList.toggle('cold', t < 75);
      el.classList.toggle('hot', t > 128);
    }
    const st = me[S.pitState];
    const btn = $('btnBox');
    btn.classList.toggle('req', st === 1);
    btn.textContent = st === 1 ? 'BOX ✕' : 'BOX';
    const next = COMPOUND_ORDER[me[S.pitNext] | 0] ?? this.cmp;
    document.querySelectorAll<HTMLButtonElement>('#cmpSel button').forEach((b) => b.classList.toggle('on', b.dataset.c === (this.want ? this.cmp : next)));
    const msg = $('pitMsg');
    let wmax = 0;
    for (let i = 0; i < 4; i++) wmax = Math.max(wmax, me[S.tyreWear + i]);
    const nextName = (COMPOUND_ORDER[me[S.pitNext] | 0] ?? this.cmp).toUpperCase();
    if (st === 1) msg.textContent = this.pitAuto ? 'BOX BOX – die Automatik übernimmt an der Boxeneinfahrt' : 'BOX BOX – Einfahrt links vor der Start/Ziel-Geraden';
    else if (st === 2) msg.textContent = 'BOXENEINFAHRT – Automatik fährt in deine Box';
    else if (st === 3) msg.textContent = `REIFENWECHSEL ${me[S.pitTimer].toFixed(1)} s · ${nextName}`;
    else if (st === 4 && this.pitAuto) {
      if (this.stopsSeen !== me[S.pitStops]) {
        this.stopsSeen = me[S.pitStops];
        this.say('LOS!', 1.5);
      }
      msg.textContent = 'BOXENAUSFAHRT – Automatik';
    } else if (st === 4 && this.stopsSeen !== me[S.pitStops]) {
      this.stopsSeen = me[S.pitStops];
      this.say('LOS!', 1.5);
      msg.textContent = '';
    } else if (me[S.pitLimiter] > 0.5) msg.textContent = 'BOXENGASSE 80 km/h – halte in deiner Box';
    else if (st === 0 && wmax > 0.72 && Math.floor(performance.now() / 600) % 2 === 0) msg.textContent = 'REIFEN ABGENUTZT – BOX drücken (Taste P)';
    else msg.textContent = '';
    if (st === 1) this.want = true;
    else if (this.want && performance.now() - this.wantAt > 600) this.want = false;
  }
  private stopsSeen = 0;

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
    const maxRows = window.innerHeight < 520 ? 7 : window.innerHeight < 700 ? 12 : 22;
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
    $('resTitle').textContent = 'Ergebnis';
    $('resPrize').textContent = this.prizeText;
    $('resAgain').textContent = 'Neues Rennen';
    $('resList').innerHTML = `<div class="rrow"><span></span><span></span><span></span><span>Abstand</span><span>Beste</span></div>${html}`;
    $('results').classList.remove('hidden');
  }
}
