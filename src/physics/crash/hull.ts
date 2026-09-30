/**
 * Kollisionshülle des Autos: Kontaktpunkte entlang des Umrisses (Nase, Flügel, Räder, Seitenkästen,
 * Heck) plus innere Strukturpunkte (Nasenbox, Überlebenszelle, Heck-Crashstruktur). Jeder Punkt gehört
 * zu einer Zone mit eigener Knautschfestigkeit. Koordinaten: Karosserieachsen (x vorn, y links).
 */
export const ZONE = {
  WING_F: 0,
  NOSE: 1,
  WHEEL_FL: 2,
  WHEEL_FR: 3,
  SIDE_L: 4,
  SIDE_R: 5,
  WHEEL_RL: 6,
  WHEEL_RR: 7,
  REAR: 8,
  WING_R: 9,
  CELL: 10,
} as const;
export const ZONE_COUNT = 11;

export interface ZoneParams {
  /** Knautschfestigkeit als Linienlast [N/m] (Fließgrenze). */
  q: number;
  /** Maximaler Knautschweg [m]; danach starr. */
  crush: number;
  /** Reibwert gegen Wand/Fremdkörper. */
  mu: number;
  /** Kontakthöhe über dem Boden [m] (Nick-/Wankmoment). */
  height: number;
  /** Elastischer Weg bis zur Fließgrenze [m]. */
  yieldDefl: number;
}

export const ZONE_PARAMS: ZoneParams[] = [
  /* WING_F   */ { q: 26e3, crush: 0.5, mu: 0.3, height: 0.12, yieldDefl: 0.01 },
  /* NOSE     */ { q: 330e3, crush: 0.62, mu: 0.3, height: 0.22, yieldDefl: 0.012 },
  /* WHEEL_FL */ { q: 170e3, crush: 0.26, mu: 0.9, height: 0.32, yieldDefl: 0.012 },
  /* WHEEL_FR */ { q: 170e3, crush: 0.26, mu: 0.9, height: 0.32, yieldDefl: 0.012 },
  /* SIDE_L   */ { q: 95e3, crush: 0.3, mu: 0.3, height: 0.3, yieldDefl: 0.012 },
  /* SIDE_R   */ { q: 95e3, crush: 0.3, mu: 0.3, height: 0.3, yieldDefl: 0.012 },
  /* WHEEL_RL */ { q: 170e3, crush: 0.26, mu: 0.9, height: 0.32, yieldDefl: 0.012 },
  /* WHEEL_RR */ { q: 170e3, crush: 0.26, mu: 0.9, height: 0.32, yieldDefl: 0.012 },
  /* REAR     */ { q: 290e3, crush: 0.5, mu: 0.3, height: 0.3, yieldDefl: 0.012 },
  /* WING_R   */ { q: 28e3, crush: 0.4, mu: 0.3, height: 0.75, yieldDefl: 0.01 },
  /* CELL     */ { q: 6.5e5, crush: 0.5, mu: 0.3, height: 0.42, yieldDefl: 0.006 },
];

const MIRROR = [
  ZONE.WING_F,
  ZONE.NOSE,
  ZONE.WHEEL_FR,
  ZONE.WHEEL_FL,
  ZONE.SIDE_R,
  ZONE.SIDE_L,
  ZONE.WHEEL_RR,
  ZONE.WHEEL_RL,
  ZONE.REAR,
  ZONE.WING_R,
  ZONE.CELL,
];

/** Umrisspunkte der linken Hälfte (Nase -> Heck) mit der Zone der Kante zum nächsten Punkt. */
const LEFT: Array<[number, number, number]> = [
  [3.0, 0.0, ZONE.NOSE],
  [3.04, 0.16, ZONE.NOSE],
  [3.11, 0.24, ZONE.WING_F],
  [3.11, 0.86, ZONE.WING_F],
  [2.5, 0.88, ZONE.WING_F],
  [2.21, 0.926, ZONE.WHEEL_FL],
  [1.49, 0.926, ZONE.WHEEL_FL],
  [1.49, 0.55, ZONE.WHEEL_FL],
  [1.15, 0.5, ZONE.SIDE_L],
  [0.6, 0.53, ZONE.SIDE_L],
  [-0.6, 0.5, ZONE.SIDE_L],
  [-1.0, 0.42, ZONE.SIDE_L],
  [-1.19, 0.52, ZONE.WHEEL_RL],
  [-1.19, 0.96, ZONE.WHEEL_RL],
  [-1.91, 0.96, ZONE.WHEEL_RL],
  [-1.91, 0.52, ZONE.WHEEL_RL],
  [-1.94, 0.5, ZONE.WING_R],
  [-1.94, 0.0, ZONE.WING_R],
];

/** Innere Strukturpunkte [x, y, Zone, nx, ny] (nx,ny = nach außen weisende Normale). */
const INTERIOR: Array<[number, number, number, number, number]> = [
  [2.62, 0.0, ZONE.NOSE, 1, 0],
  [2.45, 0.1, ZONE.NOSE, 1, 0],
  [2.45, -0.1, ZONE.NOSE, 1, 0],
  [2.25, 0.0, ZONE.NOSE, 1, 0],
  [1.95, 0.0, ZONE.CELL, 1, 0],
  [1.9, 0.18, ZONE.CELL, 1, 0],
  [1.9, -0.18, ZONE.CELL, 1, 0],
  [0.9, 0.3, ZONE.CELL, 0, 1],
  [0.3, 0.3, ZONE.CELL, 0, 1],
  [-0.3, 0.3, ZONE.CELL, 0, 1],
  [0.9, -0.3, ZONE.CELL, 0, -1],
  [0.3, -0.3, ZONE.CELL, 0, -1],
  [-0.3, -0.3, ZONE.CELL, 0, -1],
  [-1.72, 0.0, ZONE.REAR, -1, 0],
  [-1.72, 0.22, ZONE.REAR, -1, 0],
  [-1.72, -0.22, ZONE.REAR, -1, 0],
  [-1.5, 0.0, ZONE.REAR, -1, 0],
];

export class Hull {
  readonly n: number;
  /** Ruhelage der Kontaktpunkte (Karosserie). */
  readonly px: Float64Array;
  readonly py: Float64Array;
  /** Nach außen weisende Normale. */
  readonly nx: Float64Array;
  readonly ny: Float64Array;
  /** Punktabstand (Länge, die der Punkt repräsentiert) [m]. */
  readonly ds: Float64Array;
  readonly zone: Uint8Array;
  /** Knautschweg je Punkt [m]: Abstand bis zur Überlebenszelle (Rad/Zelle: Zonenwert). */
  readonly crush: Float64Array;
  /** Umrisspolygon (geschlossen, gegen den Uhrzeigersinn) für Innen-/Außen-Tests. */
  readonly polyX: Float64Array;
  readonly polyY: Float64Array;
  readonly polyZone: Uint8Array;
  readonly polyN: number;
  /** Bounding-Radius um den Schwerpunkt. */
  readonly radius: number;

  constructor() {
    // Polygon: linke Hälfte, dann gespiegelte rechte Hälfte in umgekehrter Reihenfolge
    const vx: number[] = [];
    const vy: number[] = [];
    const vz: number[] = []; // Zone der Kante, die an diesem Punkt beginnt
    for (let i = 0; i < LEFT.length; i++) {
      vx.push(LEFT[i][0]);
      vy.push(LEFT[i][1]);
      vz.push(LEFT[i][2]);
    }
    // rechte Hälfte: von letztem inneren Punkt zurück zur Nase (ohne Mittelpunkte doppelt)
    for (let i = LEFT.length - 2; i >= 1; i--) {
      vx.push(LEFT[i][0]);
      vy.push(-LEFT[i][1]);
      // Kante von gespiegeltem Punkt i zu gespiegeltem Punkt i-1 entspricht der linken Kante (i-1 -> i)
      vz.push(MIRROR[LEFT[i - 1][2]]);
    }
    // Kante von gespiegeltem Punkt 1 zurück zum Nasenpunkt (Mitte): Zone der linken Kante 0 -> 1
    // (vz des letzten Polygonpunkts ist bereits MIRROR[LEFT[0][2]] durch die Schleife bei i = 1)
    const pn = vx.length;
    this.polyN = pn;
    this.polyX = Float64Array.from(vx);
    this.polyY = Float64Array.from(vy);
    this.polyZone = Uint8Array.from(vz);

    const px: number[] = [];
    const py: number[] = [];
    const nxs: number[] = [];
    const nys: number[] = [];
    const dss: number[] = [];
    const zs: number[] = [];
    const maxSpacing = 0.2;
    for (let i = 0; i < pn; i++) {
      const j = (i + 1) % pn;
      const dx = vx[j] - vx[i];
      const dy = vy[j] - vy[i];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const k = Math.max(1, Math.ceil(len / maxSpacing));
      const ds = len / k;
      // Außennormale einer gegen den Uhrzeigersinn umlaufenen Kante: (dy, -dx)
      const enx = dy / len;
      const eny = -dx / len;
      for (let s = 0; s < k; s++) {
        const t = s / k;
        px.push(vx[i] + dx * t);
        py.push(vy[i] + dy * t);
        nxs.push(enx);
        nys.push(eny);
        dss.push(ds);
        zs.push(vz[i]);
      }
    }
    for (const [x, y, z, nx, ny] of INTERIOR) {
      px.push(x);
      py.push(y);
      nxs.push(nx);
      nys.push(ny);
      dss.push(0.25);
      zs.push(z);
    }
    this.n = px.length;
    this.px = Float64Array.from(px);
    this.py = Float64Array.from(py);
    this.nx = Float64Array.from(nxs);
    this.ny = Float64Array.from(nys);
    this.ds = Float64Array.from(dss);
    this.zone = Uint8Array.from(zs);
    // Knautschweg: Abstand bis zur Überlebenszelle (Nase/Flügel bis x = 2.0, Heck bis x = -1.45,
    // Seitenkästen bis |y| = 0.3). Räder und Zelle verwenden den Zonenwert.
    this.crush = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const z = zs[i];
      let c: number;
      switch (z) {
        case ZONE.WING_F:
        case ZONE.NOSE:
          c = px[i] - 2.0;
          break;
        case ZONE.REAR:
        case ZONE.WING_R:
          c = -1.45 - px[i];
          c = c < 0 ? -c : c;
          break;
        case ZONE.SIDE_L:
        case ZONE.SIDE_R:
          c = Math.abs(py[i]) - 0.3;
          break;
        default:
          c = ZONE_PARAMS[z].crush;
      }
      this.crush[i] = Math.max(0.04, c - 0.03);
    }
    let r = 0;
    for (let i = 0; i < pn; i++) r = Math.max(r, Math.hypot(vx[i], vy[i]));
    this.radius = r;
  }

  /** Punkt-in-Polygon (Strahlverfahren) in Karosseriekoordinaten. */
  contains(x: number, y: number): boolean {
    let inside = false;
    const n = this.polyN;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = this.polyY[i];
      const yj = this.polyY[j];
      if (yi > y !== yj > y) {
        const xi = this.polyX[i];
        const xj = this.polyX[j];
        if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }
}

export const HULL = new Hull();
