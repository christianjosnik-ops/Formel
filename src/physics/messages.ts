import type { DriverInput } from './vehicle';

export type ToWorker =
  | { type: 'input'; input: Partial<DriverInput> }
  | { type: 'reset'; x: number; y: number; psi: number; speed: number }
  | { type: 'recycle'; buf: Float64Array }
  | { type: 'pause'; paused: boolean }
  | { type: 'brakeBias'; bias: number }
  | { type: 'repair' };

export type FromWorker =
  | { type: 'ready'; hz: number }
  | { type: 'snap'; buf: Float64Array };
