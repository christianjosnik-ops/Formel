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
  inter: { grip: 1.0, topt: 80, wear: 1.0, name: 'Intermediate' },
  wet: { grip: 1.0, topt: 70, wear: 0.8, name: 'Wet' },
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

/** Gripfaktor je Mischung und Streckennässe (Stützstellen bei 0, 0,25, 0,5, 0,75, 1). Slicks brechen im Nassen ein, Intermediates liegen im Mittelfeld, Regenreifen im Starkregen. */
const WET_TABLE: Record<CompoundId, number[]> = {
  soft: [1, 0.86, 0.66, 0.5, 0.38],
  medium: [1, 0.86, 0.68, 0.52, 0.4],
  hard: [1, 0.87, 0.7, 0.54, 0.42],
  inter: [0.88, 0.86, 0.8, 0.7, 0.6],
  wet: [0.8, 0.79, 0.76, 0.74, 0.72],
};

export function wetGrip(c: CompoundId, wet: number): number {
  const t = WET_TABLE[c];
  const x = Math.max(0, Math.min(1, wet)) * 4;
  const i = Math.min(3, Math.floor(x));
  return t[i] + (t[i + 1] - t[i]) * (x - i);
}

/** Verschleißfaktor durch Nässe: Intermediates/Regenreifen auf trockener Strecke überhitzen und verschleißen schnell. */
export function wetWear(c: CompoundId, wet: number): number {
  if (c === 'inter') return 1 + 3.5 * Math.max(0, 0.45 - wet) ** 1.2 * 3;
  if (c === 'wet') return 1 + 5 * Math.max(0, 0.7 - wet) ** 1.2 * 2;
  return 1;
}

/** Empfohlene Mischung für eine Streckennässe. */
export function wetCompound(wet: number): 'inter' | 'wet' | null {
  if (wet > 0.62) return 'wet';
  if (wet > 0.22) return 'inter';
  return null;
}
