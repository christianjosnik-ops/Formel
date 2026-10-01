/**
 * Karriere: Preisgeld für Platzierungen, Werkstatt mit Teile-Upgrades (Stufen 0..5), gespeichert im Browser.
 * Upgrades wirken nur über physikalische Größen (Leistung, Abtrieb, Bremsmoment, Reifenverschleiß, Masse).
 */
export type UpgradeId = 'engine' | 'aero' | 'brakes' | 'tyres' | 'weight';
export interface Upgrades {
  engine: number;
  aero: number;
  brakes: number;
  tyres: number;
  weight: number;
}
export interface Career {
  money: number;
  up: Upgrades;
}

export const MAX_LEVEL = 5;

export const UPGRADE_INFO: Array<{ id: UpgradeId; name: string; ico: string; per: string }> = [
  { id: 'engine', name: 'Antrieb', ico: '⚙️', per: '+1,2 % Motorleistung je Stufe' },
  { id: 'aero', name: 'Aerodynamik', ico: '🌀', per: '+1,2 % Abtrieb je Stufe' },
  { id: 'brakes', name: 'Bremsen', ico: '🛑', per: '+3 % Bremsmoment je Stufe' },
  { id: 'tyres', name: 'Reifenpflege', ico: '🛞', per: '−9 % Verschleiß, +0,4 % Grip je Stufe' },
  { id: 'weight', name: 'Leichtbau', ico: '🪶', per: '−2,5 kg je Stufe' },
];

const KEY = 'formel.career.v1';

export function emptyUpgrades(): Upgrades {
  return { engine: 0, aero: 0, brakes: 0, tyres: 0, weight: 0 };
}

export function loadCareer(): Career {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Career;
      return { money: Math.max(0, Number(c.money) || 0), up: { ...emptyUpgrades(), ...c.up } };
    }
  } catch {
    /* Speicher nicht verfügbar */
  }
  return { money: 25000, up: emptyUpgrades() };
}

export function saveCareer(c: Career): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignorieren */
  }
}

export function upgradeCost(level: number): number {
  return Math.round((20000 * Math.pow(1.65, level)) / 1000) * 1000;
}

export function buy(c: Career, id: UpgradeId): boolean {
  const lvl = c.up[id];
  if (lvl >= MAX_LEVEL) return false;
  const cost = upgradeCost(lvl);
  if (c.money < cost) return false;
  c.money -= cost;
  c.up[id] = lvl + 1;
  saveCareer(c);
  return true;
}

/** Preisgeld: Platzierung, Rennlänge, Gegnerstärke. */
export function prize(pos: number, field: number, laps: number, aiLevel: number, dnf: boolean): number {
  if (dnf) return 1000;
  const factorAi = aiLevel < 0 ? 0.25 : [0.6, 0.85, 1.15, 1.5][Math.min(3, aiLevel)];
  const base = Math.max(1, field + 1 - pos) * (55000 / Math.max(field, 2));
  const f = Math.pow(Math.max(laps, 1) / 3, 0.6);
  return Math.round((base * f * factorAi) / 500) * 500;
}

export interface UpgradeEffects {
  power: number;
  aero: number;
  brakes: number;
  wear: number;
  tyreGrip: number;
  massDelta: number;
}

export function effects(u: Upgrades): UpgradeEffects {
  return {
    power: 1 + 0.012 * u.engine,
    aero: 1 + 0.012 * u.aero,
    brakes: 1 + 0.03 * u.brakes,
    wear: 1 - 0.09 * u.tyres,
    tyreGrip: 1 + 0.004 * u.tyres,
    massDelta: -2.5 * u.weight,
  };
}
