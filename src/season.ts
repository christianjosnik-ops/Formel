import { DRIVERS, teamOf } from './race/field';

/**
 * Saison: drei Rennwochenenden (Qualifying + Rennen) mit Meisterschaftspunkten für alle Fahrer, im Browser gespeichert.
 * Die Strecke ist je Lauf festgelegt; nach dem dritten Lauf steht der Weltmeister fest.
 */
export const CALENDAR: Array<'monza' | 'spa' | 'silverstone'> = ['monza', 'spa', 'silverstone'];
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export interface Season {
  /** Nächster Lauf (0..CALENDAR.length; gleich Länge = Saison beendet). */
  round: number;
  /** Punkte je Fahrer (Index in DRIVERS). */
  pts: Record<string, number>;
  /** Siege je Fahrer. */
  wins: Record<string, number>;
  /** Punkte des Spielers je gefahrenem Lauf (für die Anzeige). */
  log: Array<{ map: string; pos: number; pts: number; dnf: boolean }>;
}

const KEY = 'formel.season.v1';

export const newSeason = (): Season => ({ round: 0, pts: {}, wins: {}, log: [] });

export function loadSeason(): Season {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Season;
      return { round: Math.max(0, Math.min(CALENDAR.length, Number(s.round) || 0)), pts: s.pts ?? {}, wins: s.wins ?? {}, log: s.log ?? [] };
    }
  } catch {
    /* Speicher nicht verfügbar */
  }
  return newSeason();
}

export function saveSeason(s: Season): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignorieren */
  }
}

export const seasonDone = (s: Season): boolean => s.round >= CALENDAR.length;

/** Trägt ein Rennergebnis ein. order: Fahrer in Zielreihenfolge; out = ausgefallen (keine Punkte). Gibt die Punkte des Spielers zurück. */
export function recordRound(s: Season, order: Array<{ driver: number; out: boolean }>, player: number): number {
  let mine = 0;
  let myPos = 0;
  let myOut = false;
  order.forEach((r, i) => {
    const p = r.out ? 0 : (POINTS[i] ?? 0);
    const k = String(r.driver);
    s.pts[k] = (s.pts[k] ?? 0) + p;
    if (i === 0 && !r.out) s.wins[k] = (s.wins[k] ?? 0) + 1;
    if (r.driver === player) {
      mine = p;
      myPos = i + 1;
      myOut = r.out;
    }
  });
  s.log.push({ map: CALENDAR[s.round] ?? '', pos: myPos, pts: mine, dnf: myOut });
  s.round = Math.min(CALENDAR.length, s.round + 1);
  saveSeason(s);
  return mine;
}

export interface DriverRow {
  driver: number;
  name: string;
  team: string;
  color: string;
  pts: number;
  wins: number;
}

/** Fahrerwertung, nach Punkten (dann Siegen) absteigend. */
export function driverTable(s: Season): DriverRow[] {
  return DRIVERS.map((d, i) => {
    const t = teamOf(d);
    return { driver: i, name: d.name, team: t.name, color: t.colors.primary, pts: s.pts[String(i)] ?? 0, wins: s.wins[String(i)] ?? 0 };
  }).sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.driver - b.driver);
}

/** Konstrukteurswertung. */
export function teamTable(s: Season): Array<{ team: string; color: string; pts: number }> {
  const m = new Map<string, { team: string; color: string; pts: number }>();
  for (const r of driverTable(s)) {
    const e = m.get(r.team) ?? { team: r.team, color: r.color, pts: 0 };
    e.pts += r.pts;
    m.set(r.team, e);
  }
  return [...m.values()].sort((a, b) => b.pts - a.pts);
}
