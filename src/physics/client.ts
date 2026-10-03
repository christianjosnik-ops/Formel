import type { FromWorker, ToWorker } from './messages';
import { BODY_STRIDE, CAR_BLOCK, CAR_BLOCK_DENTS, MAX_BODIES, SNAP_SIZE, S } from './layout';
import type { RaceConfig } from '../race/race';
import type { CompoundId } from '../config/tyres';
import type { Upgrades } from '../career';
import type { MapId } from '../world/maps';
import type { DriverInput } from './vehicle';

/**
 * Main-Thread-Seite der Physik: startet den Worker, hält einen kleinen Ring aus Snapshots und
 * interpoliert für das Rendering zwischen zwei Zeitpunkten (Render-Verzögerung ~1 Snapshot).
 */
export class PhysicsClient {
  private readonly worker: Worker;
  private readonly ring: Float64Array[] = [];
  private readonly ringRecv: number[] = [];
  private readonly maxRing = 8;
  readonly out = new Float64Array(SNAP_SIZE);
  ready = false;
  private offset = 0; // simTime - performance.now()/1000 (Schätzung, nimmt Minimum der Verzögerung)
  private haveOffset = false;
  private readonly delay = 0.022;
  private scale = 1;

  private readonly views: Float64Array[] = [];
  private sa: Float64Array | null = null;
  private sb: Float64Array | null = null;
  private st = 0;

  constructor(mapId: MapId, race?: RaceConfig, upgrades?: Upgrades) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.send({ type: 'init', map: mapId, race, upgrades });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'ready') {
        this.ready = true;
      } else if (m.type === 'snap') {
        const now = performance.now() / 1000;
        const off = m.buf[S.time] - now;
        if (!this.haveOffset || off > this.offset) {
          // Größerer Offset = geringere Transportverzögerung; langsam nachführen
          this.offset = this.haveOffset ? this.offset + (off - this.offset) * 0.1 : off;
          this.haveOffset = true;
        } else {
          this.offset += (off - this.offset) * (this.scale < 1 ? 0.3 : 0.002);
        }
        this.ring.push(m.buf);
        this.ringRecv.push(now);
        while (this.ring.length > this.maxRing) {
          const old = this.ring.shift()!;
          this.ringRecv.shift();
          this.send({ type: 'recycle', buf: old });
        }
      }
    };
  }

  private send(m: ToWorker): void {
    const transfer = m.type === 'recycle' ? [m.buf.buffer] : [];
    this.worker.postMessage(m, transfer);
  }

  setInput(input: Partial<DriverInput>): void {
    this.send({ type: 'input', input });
  }
  reset(x = 0, y = 0, psi = 0, speed = 0): void {
    this.send({ type: 'reset', x, y, psi, speed });
  }
  restart(race?: RaceConfig, upgrades?: Upgrades): void {
    this.send({ type: 'restart', race, upgrades });
  }
  setTimeScale(scale: number): void {
    this.scale = scale;
    this.send({ type: 'timescale', scale });
  }
  pit(request: boolean, compound: CompoundId): void {
    this.send({ type: 'pit', request, compound });
  }
  repair(): void {
    this.send({ type: 'repair' });
  }
  pause(paused: boolean): void {
    this.send({ type: 'pause', paused });
  }
  setBrakeBias(bias: number): void {
    this.send({ type: 'brakeBias', bias });
  }

  /** Interpolierter Zustand zur aktuellen Renderzeit. Gibt false zurück, solange keine Daten vorliegen. */
  sample(): boolean {
    const n = this.ring.length;
    if (n === 0) return false;
    const out = this.out;
    if (n === 1) {
      out.set(this.ring[0]);
      this.sa = this.sb = this.ring[0];
      this.st = 1;
      return true;
    }
    const tRender = performance.now() / 1000 + this.offset - this.delay;
    let i = n - 1;
    while (i > 0 && this.ring[i - 1][S.time] > tRender) i--;
    // tRender liegt zwischen ring[i-1] und ring[i]  (i >= 1) oder vor/nach dem Ring
    if (i === 0) {
      out.set(this.ring[0]);
      this.sa = this.sb = this.ring[0];
      this.st = 1;
      return true;
    }
    const a = this.ring[i - 1];
    const b = this.ring[i];
    const span = b[S.time] - a[S.time];
    let t = span > 1e-6 ? (tRender - a[S.time]) / span : 1;
    if (t > 1.5) t = 1.5;
    if (t < 0) t = 0;
    this.sa = a;
    this.sb = b;
    this.st = t;
    // Skalare Felder (bis zu den Kontakten) interpolieren; Kontakte, Dellen, Körper vom neueren Snapshot
    const nScalar = S.contacts;
    for (let k = 0; k < nScalar; k++) out[k] = a[k] + (b[k] - a[k]) * t;
    for (let k = nScalar; k < SNAP_SIZE; k++) out[k] = b[k];
    // Körper (Kegel, Trümmer): Position nur zwischen gleichen Einträgen mischen
    const nb = Math.min(MAX_BODIES, b[S.nBodies] | 0);
    const na = Math.min(MAX_BODIES, a[S.nBodies] | 0);
    for (let i = 0; i < nb && i < na; i++) {
      const ob = S.bodies + i * BODY_STRIDE;
      if (a[ob] === b[ob] && a[ob + 7] === b[ob + 7]) {
        out[ob + 1] = a[ob + 1] + (b[ob + 1] - a[ob + 1]) * t;
        out[ob + 2] = a[ob + 2] + (b[ob + 2] - a[ob + 2]) * t;
        out[ob + 4] = a[ob + 4] + (b[ob + 4] - a[ob + 4]) * t;
        out[ob + 6] = a[ob + 6] + (b[ob + 6] - a[ob + 6]) * t;
        let dp = b[ob + 3] - a[ob + 3];
        dp -= Math.round(dp / (2 * Math.PI)) * 2 * Math.PI;
        out[ob + 3] = a[ob + 3] + dp * t;
      }
    }
    // Gier periodisch interpolieren
    let dpsi = b[S.psi] - a[S.psi];
    dpsi -= Math.round(dpsi / (2 * Math.PI)) * 2 * Math.PI;
    out[S.psi] = a[S.psi] + dpsi * t;
    // Zustandswerte vom neueren Snapshot
    out[S.gear] = b[S.gear];
    out[S.absActive] = b[S.absActive];
    out[S.tcActive] = b[S.tcActive];
    out[S.stepMs] = b[S.stepMs];
    out[S.hz] = b[S.hz];
    out[S.retired] = b[S.retired];
    out[S.crashLevel] = b[S.crashLevel];
    out[S.nBodies] = b[S.nBodies];
    return true;
  }

  /** Anzahl Autos im Rennen (0 = Freies Fahren). */
  get carCount(): number {
    return this.sb ? this.sb[S.nCars] | 0 : 0;
  }

  /** Interpolierter Zustand des k-ten Autos in der Indexierung des Snapshots (für CarModel/Anzeige). */
  carView(k: number): Float64Array | null {
    const a = this.sa;
    const b = this.sb;
    if (!a || !b || k >= (b[S.nCars] | 0)) return null;
    let v = this.views[k];
    if (!v) v = this.views[k] = new Float64Array(SNAP_SIZE);
    const base = S.cars + k * CAR_BLOCK;
    const t = this.st;
    for (let q = 0; q < S.contacts; q++) v[q] = a[base + q] + (b[base + q] - a[base + q]) * t;
    for (let q = 0; q < CAR_BLOCK_DENTS; q++) v[S.dents + q] = b[base + S.contacts + q];
    let dpsi = b[base + S.psi] - a[base + S.psi];
    dpsi -= Math.round(dpsi / (2 * Math.PI)) * 2 * Math.PI;
    v[S.psi] = a[base + S.psi] + dpsi * t;
    for (const f of [S.gear, S.absActive, S.tcActive, S.retired, S.crashLevel, S.raceLap, S.racePos, S.raceFinished, S.raceOut, S.raceDriver, S.raceBest, S.raceLast, S.raceState, S.raceLights, S.raceLaps, S.raceFinishTime, S.raceGapLeader, S.raceGapAhead, S.raceGapBehind, S.pitState, S.pitTimer, S.pitSvc, S.pitNext, S.pitStops])
      v[f] = b[base + f];
    return v;
  }

  /** Letzter roher Snapshot (für Telemetrie ohne Interpolation). */
  latest(): Float64Array | null {
    return this.ring.length ? this.ring[this.ring.length - 1] : null;
  }
}
