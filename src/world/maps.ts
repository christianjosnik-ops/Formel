import monzaCsv from '../data/tracks/Monza.csv?raw';
import spaCsv from '../data/tracks/Spa.csv?raw';
import silverstoneCsv from '../data/tracks/Silverstone.csv?raw';
import { buildProvingGround, type World2D } from './provingGround';
import { Track } from './track';

export type MapId = 'proving' | 'monza' | 'spa' | 'silverstone';

/** Umgebungsthema: steuert Bewuchs, Hügel, Berge und Stimmung. */
export interface Theme {
  /** Baumdichte 0..1. */
  forest: number;
  /** Anteil Nadelbäume 0..1. */
  conifer: number;
  /** Hügelhöhe in der Ferne [m]. */
  hills: number;
  /** Höhe der fernen Berge [m] (0 = keine). */
  mountains: number;
  /** Gras-Grundton (RGB 0..1) und Laubfarben. */
  grass: [number, number, number];
  foliage: [number, number, number];
  fog: number;
  fogDensity: number;
  seed: number;
}

export interface GameMap {
  id: MapId;
  name: string;
  country: string;
  world: World2D;
  track: Track | null;
  start: { x: number; y: number; psi: number };
  theme: Theme;
}

export const MAP_LIST: Array<{ id: MapId; name: string }> = [
  { id: 'monza', name: 'Monza – Autodromo Nazionale' },
  { id: 'spa', name: 'Spa-Francorchamps' },
  { id: 'silverstone', name: 'Silverstone' },
  { id: 'proving', name: 'Crash-Testgelände' },
];

const THEMES: Record<string, Theme> = {
  // Königlicher Park von Monza: dichter Laub-/Mischwald, flaches Land, Alpen im Norden
  monza: { forest: 0.95, conifer: 0.25, hills: 18, mountains: 900, grass: [0.30, 0.45, 0.2], foliage: [0.2, 0.36, 0.14], fog: 0xb9c7d4, fogDensity: 1, seed: 11 },
  // Ardennen: Nadelwald, bewaldete Hügel
  spa: { forest: 1, conifer: 0.75, hills: 70, mountains: 260, grass: [0.26, 0.42, 0.18], foliage: [0.13, 0.27, 0.12], fog: 0xaebdc4, fogDensity: 1.1, seed: 23 },
  // Englisches Flachland: Felder, Baumgruppen, kaum Hügel
  silverstone: { forest: 0.35, conifer: 0.1, hills: 10, mountains: 0, grass: [0.36, 0.5, 0.22], foliage: [0.22, 0.4, 0.15], fog: 0xc3cdd6, fogDensity: 0.9, seed: 37 },
};

const CSV: Record<string, { csv: string; name: string; country: string }> = {
  monza: { csv: monzaCsv, name: 'Autodromo Nazionale Monza', country: 'Italien' },
  spa: { csv: spaCsv, name: 'Circuit de Spa-Francorchamps', country: 'Belgien' },
  silverstone: { csv: silverstoneCsv, name: 'Silverstone Circuit', country: 'Großbritannien' },
};

const cache = new Map<MapId, GameMap>();

export function createMap(id: MapId): GameMap {
  const hit = cache.get(id);
  if (hit) return hit;
  let map: GameMap;
  if (id === 'proving' || !CSV[id]) {
    map = {
      id: 'proving',
      name: 'Crash-Testgelände',
      country: '',
      world: buildProvingGround(),
      track: null,
      start: { x: 0, y: 0, psi: 0 },
      theme: { forest: 0, conifer: 0, hills: 0, mountains: 0, grass: [0.28, 0.41, 0.2], foliage: [0.2, 0.36, 0.14], fog: 0xb9c4ca, fogDensity: 1, seed: 1 },
    };
  } else {
    const c = CSV[id];
    const track = new Track(id, c.csv);
    map = { id, name: c.name, country: c.country, world: track.toWorld2D(), track, start: track.start, theme: THEMES[id] };
  }
  cache.set(id, map);
  return map;
}
