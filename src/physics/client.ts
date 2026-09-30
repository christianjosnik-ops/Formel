import type { FromWorker, ToWorker } from './messages';
import { SNAP_SIZE, S } from './layout';
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

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
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
          this.offset += (off - this.offset) * 0.002;
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
      return true;
    }
    const tRender = performance.now() / 1000 + this.offset - this.delay;
    let i = n - 1;
    while (i > 0 && this.ring[i - 1][S.time] > tRender) i--;
    // tRender liegt zwischen ring[i-1] und ring[i]  (i >= 1) oder vor/nach dem Ring
    if (i === 0) {
      out.set(this.ring[0]);
      return true;
    }
    const a = this.ring[i - 1];
    const b = this.ring[i];
    const span = b[S.time] - a[S.time];
    let t = span > 1e-6 ? (tRender - a[S.time]) / span : 1;
    if (t > 1.5) t = 1.5;
    if (t < 0) t = 0;
    for (let k = 0; k < SNAP_SIZE; k++) out[k] = a[k] + (b[k] - a[k]) * t;
    // Gier periodisch interpolieren
    let dpsi = b[S.psi] - a[S.psi];
    dpsi -= Math.round(dpsi / (2 * Math.PI)) * 2 * Math.PI;
    out[S.psi] = a[S.psi] + dpsi * t;
    // Ganzzahl-/Zustandswerte vom neueren Snapshot
    out[S.gear] = b[S.gear];
    out[S.absActive] = b[S.absActive];
    out[S.tcActive] = b[S.tcActive];
    out[S.stepMs] = b[S.stepMs];
    out[S.hz] = b[S.hz];
    return true;
  }

  /** Letzter roher Snapshot (für Telemetrie ohne Interpolation). */
  latest(): Float64Array | null {
    return this.ring.length ? this.ring[this.ring.length - 1] : null;
  }
}
