export interface Settings {
  map: 'proving' | 'monza' | 'spa' | 'silverstone';
  control: 'arrows' | 'touch' | 'tilt';
  tc: number;
  abs: number;
  steerAssist: number;
  team: string;
  compound: 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
  camera: 'chase' | 'tcam' | 'cockpit' | 'nose' | 'tv' | 'side' | 'heli' | 'showroom';
  telemetry: boolean;
  brakeBias: number;
  /** Neigung: voller Lenkeinschlag bei diesem Winkel [Grad]. */
  tiltRange: number;
  tiltInvert: boolean;
  quality: 'auto' | 'high' | 'low';
  mode: 'race' | 'weekend' | 'free';
  laps: number;
  /** -1 = keine KI, sonst Index in AI_LEVELS. */
  aiLevel: number;
  grid: 'pole' | 'mid' | 'last' | 'random';
  /** Index in der Fahrerliste (race/field DRIVERS). */
  driver: number;
  field: number;
  autoAero: boolean;
  trackLimits: boolean;
  /** Reifenverschleiß: 0 aus, 1 normal, 2 hoch. */
  wear: number;
  volume: number;
}

const KEY = 'formel.settings.v2';

export const DEFAULTS: Settings = {
  map: 'monza',
  control: 'arrows',
  tc: 1,
  abs: 1,
  steerAssist: 1,
  team: 'mercedes',
  compound: 'medium',
  camera: 'chase',
  telemetry: true,
  brakeBias: 0.58,
  tiltRange: 38,
  tiltInvert: false,
  quality: 'auto',
  mode: 'race',
  laps: 3,
  aiLevel: 1,
  grid: 'mid',
  driver: 0,
  field: 22,
  autoAero: true,
  trackLimits: false,
  wear: 1,
  volume: 0.8,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* Speicher nicht verfügbar (privater Modus) */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignorieren */
  }
}
