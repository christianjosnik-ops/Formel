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
  // ---- Schäden (0 = heil, 1 = zerstört) ----
  dmgNose: one(),
  dmgWingF: one(),
  dmgWingR: one(),
  dmgFloor: one(),
  dmgSideL: one(),
  dmgSideR: one(),
  dmgRear: one(),
  dmgEngine: one(),
  wheelOff: four(), // 1 = Rad abgerissen
  puncture: four(), // 0..1 Luftverlust
  bent: four(), // Spurversatz durch verbogene Querlenker [rad]
  retired: one(),
  crashLevel: one(), // 0 keiner, 1 leicht, 2 mittel, 3 schwer, 4 extrem
  peakG: one(),
  impactSpeed: one(), // [km/h]
  impactEnergy: one(), // [kJ] aufgenommene Crash-Energie
  scrape: four(), // Schleifintensität je Ecke 0..1 (Funken)
  wallContact: one(), // Anzahl Kontaktpunkte mit Wand/Fremdkörpern
  contacts: 0, // Anfang des Kontaktfeldes (MAX_CONTACTS * CONTACT_STRIDE)
  dents: 0, // Anfang des Dellenfeldes (MAX_DENTS * DENT_STRIDE)
  nBodies: 0,
  bodies: 0, // Anfang des Körperfeldes (MAX_BODIES * BODY_STRIDE)
  size: 0,
};
export const MAX_CONTACTS = 6;
export const CONTACT_STRIDE = 6; // x, y, nx, ny, Intensität, Art
export const MAX_DENTS = 8;
export const DENT_STRIDE = 8; // px py pz (GLB-Karosseriekoordinaten), dx dy dz, Tiefe, Radius
export const MAX_BODIES = 200;
export const BODY_STRIDE = 8; // Typ, x, y, psi, Hub, Nick/Rollwinkel, Drehwinkel, Id
export const BODY_CONE = 1;
export const BODY_WHEEL = 2;
export const BODY_WING_F = 3;
export const BODY_WING_R = 4;
export const BODY_SHARD = 5;
S.nBodies = next++;
S.contacts = next;
next += MAX_CONTACTS * CONTACT_STRIDE;
S.dents = next;
next += MAX_DENTS * DENT_STRIDE;
S.bodies = next;
next += MAX_BODIES * BODY_STRIDE;
S.size = next + 4;


export const SNAP_SIZE = S.size;
