export interface Settings {
  control: 'touch' | 'tilt';
  tc: number;
  abs: number;
  steerAssist: number;
  team: string;
  compound: 'soft' | 'medium' | 'hard' | 'inter' | 'wet';
  camera: 'chase' | 'cockpit' | 'tv' | 'showroom';
  telemetry: boolean;
  brakeBias: number;
  /** Neigung: voller Lenkeinschlag bei diesem Winkel [Grad]. */
  tiltRange: number;
  tiltInvert: boolean;
  quality: 'auto' | 'high' | 'low';
}

const KEY = 'formel.settings.v1';

export const DEFAULTS: Settings = {
  control: 'touch',
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
