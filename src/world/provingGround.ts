/**
 * Testgelände mit Untergründen, Wänden und Kegeln. Die Daten werden von Physik (Worker) und
 * Darstellung gemeinsam genutzt. Koordinaten: x nach vorn (Start bei 0), y nach links, Meter.
 * Streckenbasierte Welten (Phase 3) liefern dieselben Strukturen aus den Streckendaten.
 */

export type SurfaceKind = 'asphalt' | 'gravel' | 'grass' | 'sand' | 'kerb';

export interface SurfaceParams {
  /** Gripfaktor der Reifen. */
  grip: number;
  /** Zusätzlicher Rollwiderstandsbeiwert (Kies/Gras bremsen stark). */
  roll: number;
  /** Staubentwicklung 0..1 (nur Darstellung). */
  dust: number;
}

export const SURFACES: Record<SurfaceKind, SurfaceParams> = {
  asphalt: { grip: 1, roll: 0, dust: 0 },
  gravel: { grip: 0.52, roll: 0.2, dust: 0.9 },
  grass: { grip: 0.42, roll: 0.055, dust: 0.25 },
  sand: { grip: 0.48, roll: 0.3, dust: 1 },
  kerb: { grip: 0.94, roll: 0.012, dust: 0 },
};

export interface SurfaceRect {
  kind: SurfaceKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type WallKind = 'concrete' | 'tire' | 'armco';

export interface WallParams {
  /** Steifigkeit je Meter Wandlänge [N/m pro m]. */
  stiffness: number;
  /** Fließkraft je Meter Wandlänge [N/m] (Plateau, danach Nachgeben). Infinity = starr. */
  yieldPerM: number;
  /** Weg, bis die Wand aufgebraucht ist und hart wird [m]. */
  stroke: number;
  /** Anteil der Fließkraft bei Eindringtiefe null (steigt linear bis zum Wegende auf 1). */
  softStart: number;
  /** Dämpfungsgrad beim Eindringen. */
  zeta: number;
  /** Anteil der Kraft beim Zurückfedern (0 = plastisch, 1 = elastisch). */
  unload: number;
  /** Reibwert Karosserie/Wand. */
  mu: number;
  /** Tiefe des Wandkörpers hinter der Fläche [m]. */
  depth: number;
}

export const WALLS: Record<WallKind, WallParams> = {
  concrete: { stiffness: 1e10, yieldPerM: Infinity, stroke: 0, softStart: 1, zeta: 0.5, unload: 0.4, mu: 0.32, depth: 3 },
  // Reifenbarriere: progressiv (anfangs 30 % der Fließkraft, am Wegende 100 %), danach hart
  tire: { stiffness: 1.0e6, yieldPerM: 520e3, stroke: 2.6, softStart: 0.3, zeta: 0.85, unload: 0.12, mu: 0.75, depth: 4 },
  armco: { stiffness: 2.2e6, yieldPerM: 230e3, stroke: 0.45, softStart: 0.6, zeta: 0.6, unload: 0.2, mu: 0.4, depth: 2 },
};

export interface WallDef {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Normale zur freien (befahrbaren) Seite, normiert. */
  nx: number;
  ny: number;
  kind: WallKind;
}

export interface ConeDef {
  x: number;
  y: number;
  color: 'orange' | 'white' | 'yellow';
}

export interface World2D {
  surfaces: SurfaceRect[];
  /** Optional: berechnete Untergrundkarte (Strecken). Hat Vorrang vor `surfaces`. */
  surfaceFn?: (x: number, y: number) => SurfaceKind;
  walls: WallDef[];
  cones: ConeDef[];
}

function wall(ax: number, ay: number, bx: number, by: number, nx: number, ny: number, kind: WallKind): WallDef {
  const l = Math.hypot(nx, ny);
  return { ax, ay, bx, by, nx: nx / l, ny: ny / l, kind };
}

/** Wand als Kette aus Segmenten (Länge ≤ seg), damit Kontakte lokal bleiben. */
export function wallChain(ax: number, ay: number, bx: number, by: number, nx: number, ny: number, kind: WallKind, seg = 6): WallDef[] {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(len / seg));
  const out: WallDef[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    out.push(wall(ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, nx, ny, kind));
  }
  return out;
}

export function buildProvingGround(): World2D {
  const surfaces: SurfaceRect[] = [
    // Hauptgerade inkl. Slalomstrecke nach hinten
    { kind: 'asphalt', x0: -520, y0: -9, x1: 1400, y1: 9 },
    // Skidpad und Zufahrt
    { kind: 'asphalt', x0: -30, y0: 9, x1: 50, y1: 34 },
    { kind: 'asphalt', x0: -30, y0: 30, x1: 150, y1: 160 },
    // Kiesbetten neben der Strecke
    { kind: 'gravel', x0: 300, y0: -42, x1: 430, y1: -9 },
    { kind: 'gravel', x0: 300, y0: 9, x1: 430, y1: 42 },
    // Auslaufzone am Streckenende: Kies, dann Reifenstapel und Betonwand
    { kind: 'gravel', x0: 1240, y0: -40, x1: 1336, y1: 40 },
    { kind: 'sand', x0: 1400, y0: -40, x1: 1500, y1: 40 },
  ];
  const walls: WallDef[] = [];
  // Reifenbarriere am Streckenende (x = 1340) und Betonwand dahinter (x = 1352)
  walls.push(...wallChain(1340, -40, 1340, 40, -1, 0, 'tire'));
  walls.push(...wallChain(1352, -40, 1352, 40, -1, 0, 'concrete'));
  // Seitenwände: links Beton (y = +48), rechts Reifen (y = -48), jeweils 500..900
  walls.push(...wallChain(500, 48, 900, 48, 0, -1, 'concrete'));
  walls.push(...wallChain(500, -48, 900, -48, 0, 1, 'tire'));
  // Schräge Betonwand (Streifschuss-Test): von (900,48) nach (990,22)
  {
    const dx = 990 - 900;
    const dy = 22 - 48;
    const l = Math.hypot(dx, dy);
    walls.push(...wallChain(900, 48, 990, 22, dy / l, -dx / l, 'concrete'));
  }
  // Leitplanke entlang der Kiesbetten, rechte Seite
  walls.push(...wallChain(300, -44, 430, -44, 0, 1, 'armco'));
  walls.push(...wallChain(300, 44, 430, 44, 0, -1, 'armco'));

  const cones: ConeDef[] = [];
  // Skidpad: Außenring R = 50 m um (60, 90), Innenring R = 42 m
  const cx = 60;
  const cy = 90;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    cones.push({ x: cx + Math.cos(a) * 50, y: cy + Math.sin(a) * 50, color: 'orange' });
  }
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    cones.push({ x: cx + Math.cos(a) * 42, y: cy + Math.sin(a) * 42, color: 'white' });
  }
  // Slalom rückwärts der Startlinie
  for (let i = 0; i < 20; i++) cones.push({ x: -150 - i * 18, y: (i % 2 ? 1 : -1) * 4, color: 'yellow' });
  return { surfaces, walls, cones };
}

/** Untergrund an einer Position (letzter passender Eintrag gewinnt, Standard: Gras). */
export function surfaceAt(world: World2D, x: number, y: number): SurfaceKind {
  if (world.surfaceFn) return world.surfaceFn(x, y);
  const s = world.surfaces;
  for (let i = s.length - 1; i >= 0; i--) {
    const r = s[i];
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.kind;
  }
  return 'grass';
}
