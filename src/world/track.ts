import type { SurfaceKind, WallDef, WallKind, World2D } from './provingGround';

/**
 * Strecke aus Mittellinie und Breiten (TUMFTM/racetrack-database, LGPL-3.0, Format x_m,y_m,w_tr_right_m,w_tr_left_m).
 * Erzeugt eine gleichmäßig abgetastete Mittellinie (alle ~4 m) mit Richtung, Krümmung und Kurvenschwere,
 * daraus Kerbs, Kiesbetten an den Kurvenaußenseiten, Grasauslauf, Barrieren (Wände für die Physik),
 * eine Untergrundkarte und eine Fortschrittsberechnung (Runden, Streckenlimits).
 * Der Generator ist deterministisch, damit Physik-Worker und Darstellung identische Daten erhalten.
 */

export type KindCode = 0 | 1 | 2 | 3;
const KIND_NAMES: SurfaceKind[] = ['grass', 'asphalt', 'kerb', 'gravel'];

export interface TrackStart {
  x: number;
  y: number;
  psi: number;
}

function parseCsv(csv: string): number[][] {
  const pts: number[][] = [];
  for (const line of csv.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const v = t.split(',').map(Number);
    if (v.length >= 4 && v.every((x) => Number.isFinite(x))) pts.push(v);
  }
  return pts;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Gleitender Mittelwert auf einer geschlossenen Reihe. */
function smoothClosed(a: Float64Array, half: number, passes = 1): Float64Array {
  const n = a.length;
  let src = a;
  for (let p = 0; p < passes; p++) {
    const dst = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -half; k <= half; k++) s += src[(i + k + n * 4) % n];
      dst[i] = s / (2 * half + 1);
    }
    src = dst;
  }
  return src;
}

export class Track {
  readonly id: string;
  readonly n: number;
  readonly ds: number;
  readonly length: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly hdg: Float64Array;
  readonly curv: Float64Array;
  readonly sev: Float64Array;
  readonly s: Float64Array;
  /** Halbbreiten links/rechts [m]. */
  readonly wl: Float64Array;
  readonly wr: Float64Array;
  /** Kiesbreite links/rechts (0 = keins) [m]. */
  readonly gravelL: Float64Array;
  readonly gravelR: Float64Array;
  /** Kerbbreite links/rechts [m]. */
  readonly kerbL: Float64Array;
  readonly kerbR: Float64Array;
  /** Abstand der Barriere (Wandfläche) vom Streckenrand links/rechts [m]. */
  readonly barrierL: Float64Array;
  readonly barrierR: Float64Array;
  readonly walls: WallDef[] = [];
  readonly start: TrackStart;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;

  // Untergrundkarte
  private readonly cell = 2;
  private readonly rx0: number;
  private readonly ry0: number;
  private readonly rw: number;
  private readonly rh: number;
  private readonly raster: Uint8Array;
  // räumlicher Index
  private readonly hashCell = 40;
  private readonly hash = new Map<number, number[]>();

  constructor(id: string, csv: string) {
    this.id = id;
    const raw = parseCsv(csv);
    const n0 = raw.length;
    // --- periodischer Catmull-Rom-Spline, dicht abgetastet, dann nach Bogenlänge neu verteilt ---
    const SUB = 8;
    const dx: number[] = [];
    const dy: number[] = [];
    const dwr: number[] = [];
    const dwl: number[] = [];
    const at = (k: number) => raw[((k % n0) + n0) % n0];
    for (let i = 0; i < n0; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      for (let j = 0; j < SUB; j++) {
        const t = j / SUB;
        const t2 = t * t;
        const t3 = t2 * t;
        const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dx.push(cr(p0[0], p1[0], p2[0], p3[0]));
        dy.push(cr(p0[1], p1[1], p2[1], p3[1]));
        dwr.push(p1[2] + (p2[2] - p1[2]) * t);
        dwl.push(p1[3] + (p2[3] - p1[3]) * t);
      }
    }
    const nd = dx.length;
    const cum = new Float64Array(nd + 1);
    for (let i = 0; i < nd; i++) cum[i + 1] = cum[i] + Math.hypot(dx[(i + 1) % nd] - dx[i], dy[(i + 1) % nd] - dy[i]);
    const total = cum[nd];
    const n = Math.max(64, Math.round(total / 4));
    this.n = n;
    this.length = total;
    this.ds = total / n;
    let x: Float64Array = new Float64Array(n);
    let y: Float64Array = new Float64Array(n);
    const wl = new Float64Array(n);
    const wr = new Float64Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const target = (i / n) * total;
      while (k < nd - 1 && cum[k + 1] < target) k++;
      const seg = cum[k + 1] - cum[k] || 1;
      const t = (target - cum[k]) / seg;
      const k2 = (k + 1) % nd;
      x[i] = dx[k] + (dx[k2] - dx[k]) * t;
      y[i] = dy[k] + (dy[k2] - dy[k]) * t;
      wl[i] = dwl[k] + (dwl[k2] - dwl[k]) * t;
      wr[i] = dwr[k] + (dwr[k2] - dwr[k]) * t;
    }
    x = smoothClosed(x, 2, 2);
    y = smoothClosed(y, 2, 2);
    this.x = x;
    this.y = y;
    this.wl = smoothClosed(wl, 2, 1);
    this.wr = smoothClosed(wr, 2, 1);
    const ds = this.ds;
    // Bogenlänge, Richtung, Krümmung
    this.s = new Float64Array(n);
    for (let i = 1; i < n; i++) this.s[i] = this.s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    const hdg = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i + 1) % n;
      const b = (i - 1 + n) % n;
      hdg[i] = Math.atan2(y[a] - y[b], x[a] - x[b]);
    }
    this.hdg = hdg;
    const curvRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) curvRaw[i] = wrapAngle(hdg[(i + 1) % n] - hdg[(i - 1 + n) % n]) / (2 * ds);
    this.curv = smoothClosed(curvRaw, 3, 2);
    // Kurvenschwere 0..1
    const sevRaw = new Float64Array(n);
    for (let i = 0; i < n; i++) sevRaw[i] = Math.min(1, Math.max(0, (Math.abs(this.curv[i]) - 0.004) / 0.012));
    this.sev = smoothClosed(sevRaw, 5, 2);

    // --- Kiesbetten (Kurvenaußenseite), Kerbs, Barrierenabstände ---
    const gL = new Float64Array(n);
    const gR = new Float64Array(n);
    const kL = new Float64Array(n);
    const kR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const sv = this.sev[i];
      const leftTurn = this.curv[i] > 0;
      // Außenseite: bei Linkskurve rechts
      if (sv > 0.22) {
        const w = 5 + 16 * sv;
        if (leftTurn) gR[i] = w;
        else gL[i] = w;
      }
      if (sv > 0.3) {
        // Innenkerb in Kurven, Außenkerb am Ausgang (nur bei engen Kurven)
        if (leftTurn) kL[i] = 1.4;
        else kR[i] = 1.4;
        if (sv > 0.5) {
          if (leftTurn) kR[i] = 1.0;
          else kL[i] = 1.0;
        }
      }
    }
    this.gravelL = smoothClosed(gL, 5, 2);
    this.gravelR = smoothClosed(gR, 5, 2);
    this.kerbL = smoothClosed(kL, 2, 1);
    this.kerbR = smoothClosed(kR, 2, 1);
    const bL = new Float64Array(n);
    const bR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const sv = this.sev[i];
      const grass = 9 + 7 * (1 - sv);
      bL[i] = this.gravelL[i] > 2 ? this.kerbL[i] + this.gravelL[i] + 4 : this.kerbL[i] + grass;
      bR[i] = this.gravelR[i] > 2 ? this.kerbR[i] + this.gravelR[i] + 4 : this.kerbR[i] + grass;
      // Innenseite enger Kurven: Versatz nicht größer als der halbe Kurvenradius (keine Schleifen)
      const radius = 1 / Math.max(Math.abs(this.curv[i]), 1e-4);
      if (this.curv[i] > 0) bL[i] = Math.min(bL[i], Math.max(4, (radius - this.wl[i]) * 0.6));
      else bR[i] = Math.min(bR[i], Math.max(4, (radius - this.wr[i]) * 0.6));
    }
    this.barrierL = smoothClosed(bL, 6, 2);
    this.barrierR = smoothClosed(bR, 6, 2);

    // --- Bounding-Box und räumlicher Index ---
    let mnx = 1e9;
    let mxx = -1e9;
    let mny = 1e9;
    let mxy = -1e9;
    for (let i = 0; i < n; i++) {
      mnx = Math.min(mnx, x[i]);
      mxx = Math.max(mxx, x[i]);
      mny = Math.min(mny, y[i]);
      mxy = Math.max(mxy, y[i]);
      const key = this.hashKey(x[i], y[i]);
      let arr = this.hash.get(key);
      if (!arr) this.hash.set(key, (arr = []));
      arr.push(i);
    }
    this.minX = mnx;
    this.maxX = mxx;
    this.minY = mny;
    this.maxY = mxy;

    // --- Wände ---
    this.buildWalls();

    // --- Untergrundkarte ---
    const pad = 60;
    this.rx0 = mnx - pad;
    this.ry0 = mny - pad;
    this.rw = Math.ceil((mxx - mnx + 2 * pad) / this.cell);
    this.rh = Math.ceil((mxy - mny + 2 * pad) / this.cell);
    this.raster = new Uint8Array(this.rw * this.rh);
    this.buildRaster();

    // --- Startaufstellung: 8 m hinter der Linie ---
    const si = n - 2;
    this.start = { x: x[si], y: y[si], psi: hdg[si] };
  }

  private hashKey(x: number, y: number): number {
    const cx = Math.floor(x / this.hashCell) + 512;
    const cy = Math.floor(y / this.hashCell) + 512;
    return cx * 1024 + cy;
  }

  /** Normalenvektor (nach links) an Stützstelle i. */
  nx(i: number): number {
    return -Math.sin(this.hdg[i]);
  }
  ny(i: number): number {
    return Math.cos(this.hdg[i]);
  }

  /** Nächste Stützstelle zu (px, py) im Umkreis, sonst -1. Optional mit Hinweisindex für Stetigkeit. */
  nearest(px: number, py: number): number {
    const cx = Math.floor(px / this.hashCell);
    const cy = Math.floor(py / this.hashCell);
    let best = -1;
    let bd = 1e18;
    for (let ring = 1; ring <= 2 && best < 0; ring++) {
      for (let ax = -ring; ax <= ring; ax++) {
        for (let ay = -ring; ay <= ring; ay++) {
          const arr = this.hash.get((cx + ax + 512) * 1024 + (cy + ay + 512));
          if (!arr) continue;
          for (let q = 0; q < arr.length; q++) {
            const i = arr[q];
            const ddx = px - this.x[i];
            const ddy = py - this.y[i];
            const d = ddx * ddx + ddy * ddy;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
      }
    }
    return best;
  }

  /** Querabstand zur Mittellinie (links positiv) an Stützstelle i. */
  lateral(i: number, px: number, py: number): number {
    return (px - this.x[i]) * this.nx(i) + (py - this.y[i]) * this.ny(i);
  }

  private buildWalls(): void {
    const n = this.n;
    const step = 3;
    const startZone = (i: number) => this.s[i] < 380 || this.s[i] > this.length - 380;
    for (const side of [1, -1] as const) {
      for (let i = 0; i < n; i += step) {
        const j = (i + step) % n;
        const off = (idx: number) => (side === 1 ? this.wl[idx] + this.barrierL[idx] : this.wr[idx] + this.barrierR[idx]);
        const ax = this.x[i] + this.nx(i) * side * off(i);
        const ay = this.y[i] + this.ny(i) * side * off(i);
        const bx = this.x[j] + this.nx(j) * side * off(j);
        const by = this.y[j] + this.ny(j) * side * off(j);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.5) continue;
        // Normale zur Strecke hin
        let wnx = -(by - ay) / len;
        let wny = (bx - ax) / len;
        const mi = (i + 1) % n;
        const tx = -this.nx(mi) * side;
        const ty = -this.ny(mi) * side;
        if (wnx * tx + wny * ty < 0) {
          wnx = -wnx;
          wny = -wny;
        }
        const gravel = side === 1 ? this.gravelL[mi] : this.gravelR[mi];
        const kind: WallKind = startZone(mi) ? 'concrete' : gravel > 2 ? 'tire' : 'armco';
        this.walls.push({ ax, ay, bx, by, nx: wnx, ny: wny, kind });
      }
    }
  }

  private buildRaster(): void {
    const { rw, rh, cell } = this;
    const out = this.raster;
    for (let cy = 0; cy < rh; cy++) {
      const py = this.ry0 + (cy + 0.5) * cell;
      for (let cx = 0; cx < rw; cx++) {
        const px = this.rx0 + (cx + 0.5) * cell;
        out[cy * rw + cx] = this.classify(px, py);
      }
    }
  }

  private classify(px: number, py: number): KindCode {
    const i = this.nearest(px, py);
    if (i < 0) return 0;
    // Zwischen den Stützstellen den besten Nachbarn prüfen (Segmentnähe)
    const n = this.n;
    let bi = i;
    let bd = 1e18;
    for (let k = -1; k <= 1; k++) {
      const j = (i + k + n) % n;
      const ddx = px - this.x[j];
      const ddy = py - this.y[j];
      const d = ddx * ddx + ddy * ddy;
      if (d < bd) {
        bd = d;
        bi = j;
      }
    }
    const lat = this.lateral(bi, px, py);
    const side = lat >= 0 ? 1 : -1;
    const al = Math.abs(lat);
    const w = side === 1 ? this.wl[bi] : this.wr[bi];
    if (al <= w) return 1;
    const kerb = side === 1 ? this.kerbL[bi] : this.kerbR[bi];
    const off = al - w;
    if (off <= kerb) return 2;
    const gravel = side === 1 ? this.gravelL[bi] : this.gravelR[bi];
    if (gravel > 2 && off <= kerb + gravel) return 3;
    return 0;
  }

  surfaceAt(px: number, py: number): SurfaceKind {
    const cx = Math.floor((px - this.rx0) / this.cell);
    const cy = Math.floor((py - this.ry0) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.rw || cy >= this.rh) return 'grass';
    return KIND_NAMES[this.raster[cy * this.rw + cx]];
  }

  /** Fortschritt entlang der Strecke: Stützstelle, Bogenlänge, Querabstand, auf der Strecke? */
  progress(px: number, py: number): { i: number; s: number; lat: number; onTrack: boolean } {
    const i = this.nearest(px, py);
    if (i < 0) return { i: -1, s: 0, lat: 1e9, onTrack: false };
    const lat = this.lateral(i, px, py);
    const w = lat >= 0 ? this.wl[i] : this.wr[i];
    return { i, s: this.s[i], lat, onTrack: Math.abs(lat) <= w + 0.3 };
  }

  toWorld2D(): World2D {
    return { surfaces: [], surfaceFn: (x, y) => this.surfaceAt(x, y), walls: this.walls, cones: [] };
  }
}
