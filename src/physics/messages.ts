import type { MapId } from '../world/maps';
import type { DriverInput } from './vehicle';
import type { RaceConfig } from '../race/race';
import type { CompoundId } from '../config/tyres';
import type { Upgrades } from '../career';

export type ToWorker =
  | { type: 'init'; map: MapId; race?: RaceConfig; upgrades?: Upgrades }
  | { type: 'restart'; race?: RaceConfig; upgrades?: Upgrades }
  | { type: 'input'; input: Partial<DriverInput> }
  | { type: 'reset'; x: number; y: number; psi: number; speed: number }
  | { type: 'recycle'; buf: Float64Array }
  | { type: 'pause'; paused: boolean }
  | { type: 'brakeBias'; bias: number }
  | { type: 'timescale'; scale: number }
  | { type: 'pit'; request: boolean; compound: CompoundId }
  | { type: 'repair' };

export type FromWorker =
  | { type: 'ready'; hz: number }
  | { type: 'snap'; buf: Float64Array };
