/**
 * Layout des Snapshot-Puffers (Float64Array), den der Physik-Worker an den Main-Thread liefert.
 * Reine Indexkonstanten, damit beide Seiten ohne Objektallokation kommunizieren.
 */
let next = 0;
const one = () => next++;
const four = () => {
  const i = next;
  next += 4;
  return i;
};

export const S = {
  time: one(),
  x: one(),
  y: one(),
  psi: one(),
  u: one(), // Längsgeschwindigkeit (Karosserie) [m/s]
  v: one(), // Quergeschwindigkeit [m/s]
  r: one(), // Gierrate [rad/s]
  heave: one(), // Einfederung Schwerpunkt [m] (>0 = tiefer)
  roll: one(), // [rad] >0 = rechts tiefer
  pitch: one(), // [rad] >0 = Nase tiefer
  speedKmh: one(),
  rpm: one(),
  gear: one(), // 1..8
  throttle: one(),
  brake: one(),
  steer: one(), // Lenkwinkel Fahrzeugmitte [rad]
  aeroX: one(),
  ax: one(), // Längsbeschleunigung [g]
  ay: one(), // Querbeschleunigung [g]
  soc: one(), // Batterie [J]
  fuel: one(), // [kg]
  mass: one(),
  rideFront: one(),
  rideRear: one(),
  downFront: one(),
  downRear: one(),
  drag: one(),
  icePower: one(),
  kPower: one(), // >0 Antrieb, <0 Rekuperation
  absActive: one(),
  tcActive: one(),
  stepMs: one(), // Rechenzeit je Physikschritt [ms] (gleitend)
  hz: one(),
  steerL: one(),
  steerR: one(),
  omega: four(),
  fz: four(),
  fx: four(),
  fy: four(),
  kappa: four(),
  alpha: four(),
  susp: four(), // Einfederung je Rad [m]
  brakeTemp: four(),
  size: 0,
};
S.size = next + 4;

export const SNAP_SIZE = S.size;
