/**
 * Zentrale Physikkonstanten. Alles, was die Simulation beeinflusst und nicht
 * fahrzeugspezifisch ist, steht hier. Fahrzeugdaten: siehe car.ts.
 */
export const PHYS = {
  /** Feste Physikrate im Worker [Hz]. */
  hz: 500,
  get dt(): number {
    return 1 / this.hz;
  },
  /** Max. Physikschritte pro Worker-Tick (Schutz gegen Spiral of Death). */
  maxCatchUpSteps: 40,

  gravity: 9.80665,
  /** Luftdichte [kg/m^3] (ca. 25 °C, Meereshöhe). */
  rhoAir: 1.2,
  ambientTemp: 25,

  /** Untergrenze der Bezugsgeschwindigkeit im Schlupf [m/s] (Niedriggeschwindigkeits-Regularisierung). */
  vMinSlip: 3.0,
  /** Untergrenze der Geschwindigkeit für die Schräglauf-Relaxation [m/s]. */
  vMinRelax: 3.0,

  /** Mindestradlast [N], verhindert Division durch null. */
  minWheelLoad: 30,
  /** Rollwiderstandsbeiwert (Slick, hoher Druck). */
  rollingResistance: 0.011,
  rollingResistanceSpeed: 1.5e-5,

  /** Anzahl Räder: 0 FL, 1 FR, 2 RL, 3 RR. */
  wheels: 4,
} as const;

export const WHEEL = { FL: 0, FR: 1, RL: 2, RR: 3 } as const;
