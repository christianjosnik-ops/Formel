/**
 * Reifenmodell 2026 (vereinfacht): je Rad Kerntemperatur und Verschleiß.
 * - Temperatur: Wärmeeintrag aus der Schlupfleistung, Kühlung durch Fahrtwind; Grip fällt abseits des Fensters ab.
 * - Verschleiß: wächst mit Schlupfenergie (Überhitzung verschleißt schneller); Grip sinkt linear, am Ende steil ("Cliff").
 */
export type CompoundId = 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
export const COMPOUND_ORDER: CompoundId[] = ['soft', 'medium', 'hard', 'inter', 'wet'];

export interface CompoundDef {
  /** Gripfaktor im Temperaturfenster (frisch). */
  grip: number;
  /** Optimale Temperatur [°C]. */
  topt: number;
  /** Relative Verschleißrate. */
  wear: number;
  name: string;
}

export const COMPOUNDS: Record<CompoundId, CompoundDef> = {
  soft: { grip: 1.05, topt: 108, wear: 1.9, name: 'Soft' },
  medium: { grip: 1.0, topt: 105, wear: 1.0, name: 'Medium' },
  hard: { grip: 0.955, topt: 100, wear: 0.55, name: 'Hard' },
  inter: { grip: 0.9, topt: 80, wear: 1.0, name: 'Intermediate' },
  wet: { grip: 0.85, topt: 70, wear: 0.8, name: 'Wet' },
};

export const TYRE = {
  ambient: 28,
  startTemp: 92,
  /** Wärmekapazität des Reifenkerns [J/K]. */
  heatCap: 3000,
  /** Anteil der Schlupfleistung, der den Reifen erwärmt. */
  heatK: 0.3,
  /** Kühlung [W/K] bei Stillstand und Zuwachs pro m/s. */
  coolK: 24,
  /** Walkwärme: Anteil von Radlast × Geschwindigkeit. */
  hysteresis: 0.02,
  coolSpeed: 0.03,
  /** Verschleiß pro Joule Schlupfenergie für Medium bei wearScale 1 (kalibriert: ca. 10 Runden Monza). */
  wearPerJoule: 6.0e-8,
};

export function gripFromTemp(t: number, topt: number): number {
  const d = (t - topt) / 30;
  return Math.max(0.82, 1 - 0.05 * d * d);
}

export function gripFromWear(w: number): number {
  const c = Math.max(0, w - 0.8);
  return Math.max(0.6, 1 - 0.1 * w - 3.75 * c * c);
}
