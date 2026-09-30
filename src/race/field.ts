import { TEST_CAR_2026, type CarConfig } from '../config/car';
import driversData from '../data/drivers.json';
import teamsData from '../data/teams.json';

export interface TeamData {
  id: string;
  name: string;
  car: string;
  engine: string;
  overall: number;
  engineRating?: number;
  aero?: number;
  tyreCare?: number;
  gap: number;
  colors: { primary: string; secondary: string; accent: string };
}

export interface DriverData {
  name: string;
  number: number;
  team: string;
  pace: number;
  racecraft: number;
  tyres: number;
  wet: number;
  consistency: number;
  helmet: string;
  reserve?: boolean;
}

/** Fahrerfeld der Saison 2026 (ohne Reservefahrer). */
export const DRIVERS: DriverData[] = (driversData as DriverData[]).filter((d) => !d.reserve);
export const TEAMS: TeamData[] = teamsData as TeamData[];

export function teamOf(d: DriverData): TeamData {
  return TEAMS.find((t) => t.id === d.team) ?? TEAMS[0];
}

/** Kürzel für die Rangliste (erste drei Buchstaben des Nachnamens). */
export function shortName(d: DriverData): string {
  const parts = d.name.split(' ');
  const last = parts[parts.length - 1];
  return last.slice(0, 3).toUpperCase().replace('Ü', 'U').replace('É', 'E');
}

/**
 * Leistungsparameter eines Teams. Die Ratings wirken nur über physikalische Größen:
 * Motorleistung (Verbrenner + MGU-K) und Abtrieb. Der Rückstand pro Runde wird auf beide aufgeteilt;
 * ein schwächerer Motor überträgt mehr Rückstand auf die Leistung (Ferrari: schwach auf Geraden, stark in Kurven),
 * ein schwächeres Aero-Paket mehr auf den Abtrieb (Red Bull: stärkster Motor, schwächeres Aero).
 * Die Konstanten sind an Rundensimulationen auf Monza kalibriert (tests/race.test.ts).
 */
export const TEAM_K = { power: 0.0502, aero: 0.0584 };

export function teamPerformance(t: TeamData): { power: number; aero: number; powerShare: number } {
  const engine = t.engineRating ?? t.overall - 4;
  const aero = t.aero ?? t.overall - 2;
  const share = Math.min(0.8, Math.max(0.2, 0.5 + (100 - engine) * 0.02 - (100 - aero) * 0.02));
  return {
    power: 1 - TEAM_K.power * t.gap * share * 2,
    aero: 1 - TEAM_K.aero * t.gap * (1 - share) * 2,
    powerShare: share,
  };
}

export function carConfigFor(): CarConfig {
  return structuredClone(TEST_CAR_2026);
}

/** KI-Stärken: Faktor auf das Profiltempo. */
export const AI_LEVELS = [
  { id: 0, name: 'Anfänger', pace: 0.64, mistakes: 3.0 },
  { id: 1, name: 'Mittel', pace: 0.74, mistakes: 2.2 },
  { id: 2, name: 'Profi', pace: 0.84, mistakes: 1.4 },
  { id: 3, name: 'Legende', pace: 0.94, mistakes: 0.7 },
];

/** Grundtempo eines Fahrers relativ zum besten (Verstappen 98): ca. 1.5 % Spannweite. */
export function driverPace(d: DriverData): number {
  return 0.985 + 0.015 * Math.min(1, Math.max(0, (d.pace - 78) / 20));
}
