import type { MapId } from '../world/maps';
import type { DriverInput } from './vehicle';
import type { RaceConfig } from '../race/race';

export type ToWorker =
  | { type: 'init'; map: MapId; race?: RaceConfig }
  | { type: 'restart'; race?: RaceConfig }
  | { type: 'input'; input: Partial<DriverInput> }
  | { type: 'reset'; x: number; y: number; psi: number; speed: number }
  | { type: 'recycle'; buf: Float64Array }
  | { type: 'pause'; paused: boolean }
  | { type: 'brakeBias'; bias: number }
  | { type: 'repair' };

export type FromWorker =
  | { type: 'ready'; hz: number }
  | { type: 'snap'; buf: Float64Array };
