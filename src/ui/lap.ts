import { S } from '../physics/layout';
import type { Track } from '../world/track';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function fmt(t: number): string {
  if (!Number.isFinite(t)) return '–';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** Rundenzeiten, Streckenlimits und Minimap (nur auf Strecken mit Streckendaten). */
export class LapTimer {
  private readonly root = $('lap');
  private readonly lapNo = $('lapNo');
  private readonly lapTime = $('lapTime');
  private readonly last = $('lapLast');
  private readonly best = $('lapBest');
  private readonly warn = $('lapWarn');
  private readonly mini = $('minimap') as HTMLCanvasElement;
  private lap = 1;
  private lapStart = 0;
  private prevI = -1;
  private bestTime = Infinity;
  private lastTime = NaN;
  private invalid = false;
  private started = false;
  private off = 0;
  private miniBase: HTMLCanvasElement | null = null;
  private miniScale = 1;
  private miniX0 = 0;
  private miniY0 = 0;

  constructor(private readonly track: Track | null) {
    const show = !!track;
    this.root.style.display = show ? '' : 'none';
    this.mini.style.display = show ? '' : 'none';
    if (track) this.buildMini(track);
  }

  reset(simTime: number): void {
    this.lap = 1;
    this.lapStart = simTime;
    this.prevI = -1;
    this.invalid = false;
    this.started = false;
    this.root.classList.remove('invalid');
    this.warn.textContent = '';
  }

  private buildMini(t: Track): void {
    const W = this.mini.width;
    const H = this.mini.height;
    const pad = 10;
    const sx = (W - 2 * pad) / (t.maxX - t.minX);
    const sy = (H - 2 * pad) / (t.maxY - t.minY);
    this.miniScale = Math.min(sx, sy);
    this.miniX0 = (W - (t.maxX - t.minX) * this.miniScale) / 2 - t.minX * this.miniScale;
    this.miniY0 = (H - (t.maxY - t.minY) * this.miniScale) / 2 - t.minY * this.miniScale;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 6;
    g.beginPath();
    for (let i = 0; i <= t.n; i++) {
      const k = i % t.n;
      const x = this.miniX0 + t.x[k] * this.miniScale;
      const y = H - (this.miniY0 + t.y[k] * this.miniScale);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = '#dfe5ea';
    g.lineWidth = 3;
    g.stroke();
    // Start/Ziel
    const x0 = this.miniX0 + t.x[0] * this.miniScale;
    const y0 = H - (this.miniY0 + t.y[0] * this.miniScale);
    g.fillStyle = '#ff4a3d';
    g.beginPath();
    g.arc(x0, y0, 3.4, 0, Math.PI * 2);
    g.fill();
    this.miniBase = c;
  }

  update(s: Float64Array): void {
    const t = this.track;
    if (!t) return;
    const now = s[S.time];
    const p = t.progress(s[S.x], s[S.y]);
    if (p.i >= 0) {
      if (this.prevI >= 0) {
        // Zielüberfahrt: Index springt von hinten nach vorn
        if (this.prevI > t.n * 0.85 && p.i < t.n * 0.15) {
          if (this.started && !this.invalid) {
            const lt = now - this.lapStart;
            this.lastTime = lt;
            if (lt < this.bestTime) this.bestTime = lt;
          } else if (this.started) {
            this.lastTime = now - this.lapStart;
          }
          this.started = true;
          this.lap++;
          this.lapStart = now;
          this.invalid = false;
        } else if (this.prevI < t.n * 0.15 && p.i > t.n * 0.85) {
          // rückwärts über die Linie: Zeit verwerfen
          this.started = false;
          this.lapStart = now;
        }
      }
      this.prevI = p.i;
      // Streckenlimit: Fahrzeugmitte mehr als 0.9 m neben der weißen Linie (ca. alle Räder draußen)
      const w = p.lat >= 0 ? t.wl[p.i] : t.wr[p.i];
      const over = Math.abs(p.lat) - w;
      this.off = over;
      if (over > 1.1 && this.started) this.invalid = true;
    }
    this.lapNo.textContent = `RUNDE ${this.lap}${this.started ? '' : ' · OUT'}`;
    this.lapTime.textContent = fmt(this.started ? now - this.lapStart : 0);
    this.root.classList.toggle('invalid', this.invalid);
    this.last.textContent = `Letzte ${fmt(this.lastTime)}`;
    this.best.textContent = `Beste ${fmt(this.bestTime)}`;
    if (this.invalid) {
      this.warn.textContent = 'STRECKENLIMIT – RUNDE UNGÜLTIG';
      this.warn.className = 'bad';
    } else if (this.off > 0.2) {
      this.warn.textContent = 'STRECKENLIMIT';
      this.warn.className = '';
    } else this.warn.textContent = '';

    // Minimap
    if (this.miniBase) {
      const g = this.mini.getContext('2d')!;
      g.clearRect(0, 0, this.mini.width, this.mini.height);
      g.drawImage(this.miniBase, 0, 0);
      const x = this.miniX0 + s[S.x] * this.miniScale;
      const y = this.mini.height - (this.miniY0 + s[S.y] * this.miniScale);
      g.save();
      g.translate(x, y);
      g.rotate(-s[S.psi]);
      g.fillStyle = '#19d3a2';
      g.strokeStyle = '#04261d';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(6, 0);
      g.lineTo(-4, 4);
      g.lineTo(-4, -4);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }
}
