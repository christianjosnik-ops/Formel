/**
 * Fahrzeugparameter. Das Testauto entspricht dem Reglement 2026 (Radstand <= 3400 mm,
 * Breite <= 1900 mm, Mindestgewicht 768 kg inkl. Fahrer ohne Kraftstoff, Vorderachslast 45,5 %,
 * Reifen vorne 280 mm / hinten 375 mm, 18 Zoll). Teams überschreiben einzelne Werte (Phase 4).
 */
export interface TireParams {
  /** Nennlast [N]. */
  fz0: number;
  /** Reibwert längs/quer bei Nennlast. */
  mux: number;
  muy: number;
  /** Änderung des Reibwerts pro N Mehrlast (negativ = Lastempfindlichkeit). */
  dmuDFz: number;
  /** Längssteifigkeit Kx/Fz [1/Schlupf]. */
  kxStiff: number;
  /** Querkraft-Steifigkeit: Ky = pKy1 * Fz0 * sin(2 atan(Fz / (pKy2 Fz0))). */
  pKy1: number;
  pKy2: number;
  /** Magic-Formula-Formfaktoren. */
  Cx: number;
  Ex: number;
  Cy: number;
  Ey: number;
  /** Kombinierter Schlupf (MF 5.2 Gewichtungsfunktionen). */
  rBx1: number;
  rBx2: number;
  rCx1: number;
  rBy1: number;
  rBy2: number;
  rBy3: number;
  rCy1: number;
  /** Relaxationslänge Schräglaufwinkel [m]. */
  relaxLength: number;
  /** Freier Rollradius [m]. */
  radius: number;
  /** Reifenbreite [m] (nur Darstellung). */
  width: number;
  /** Trägheit Rad+Reifen+Bremsscheibe um die Drehachse [kg m^2]. */
  inertia: number;
}

export interface CarConfig {
  name: string;
  mass: {
    /** Mindestgewicht Auto + Fahrer ohne Kraftstoff [kg]. */
    dry: number;
    fuelStart: number;
    /** Ungefederte Masse je Rad vorne/hinten [kg]. */
    unsprungFront: number;
    unsprungRear: number;
  };
  geometry: {
    wheelbase: number;
    /** Anteil der statischen Last auf der Vorderachse. */
    frontWeight: number;
    trackFront: number;
    trackRear: number;
    cgHeight: number;
    /** Rollzentrumshöhe vorne/hinten [m]. */
    rollCenterFront: number;
    rollCenterRear: number;
    /** Nickzentrum (Anti-Dive/Anti-Squat) [m]. */
    pitchCenter: number;
    /** Trägheitsmomente [kg m^2]. */
    Iz: number;
    Ix: number;
    Iy: number;
    /** Ackermann-Anteil 0..1. */
    ackermann: number;
    maxSteer: number;
    /** Max. Lenkwinkelgeschwindigkeit am Rad [rad/s]. */
    steerRate: number;
    steerTau: number;
  };
  suspension: {
    /** Federrate am Rad [N/m]. */
    springFront: number;
    springRear: number;
    /** Stabilisator [N/m] Radäquivalent (Differenz links/rechts). */
    arbFront: number;
    arbRear: number;
    damperBump: number;
    damperRebound: number;
    /** Statische Bodenfreiheit an Vorder-/Hinterachse [m]. */
    rideHeightFront: number;
    rideHeightRear: number;
    /** Anschlagpuffer/Bodenplatte: Bodenfreiheit, unterhalb der Anschlag greift [m]. */
    bumpStopHeight: number;
    bumpStopRate: number;
  };
  aero: {
    /** Z-Modus (Kurve, hoher Abtrieb): CdA, ClA gesamt [m^2]. */
    zCdA: number;
    zClA: number;
    /** X-Modus (Gerade, niedriger Luftwiderstand). */
    xCdA: number;
    xClA: number;
    /** Abtriebsverteilung Front (0..1) im Z-/X-Modus. */
    zBalance: number;
    xBalance: number;
    /** Referenz-Bodenfreiheit für die Bodeneffekt-Kennlinie. */
    refHeightFront: number;
    refHeightRear: number;
    /** Zuwachs Abtrieb pro relativer Bodenfreiheitsabsenkung. */
    groundGainFront: number;
    groundGainRear: number;
    /** Strömungsabriss-Höhe (darunter Abtriebsverlust). */
    stallHeightFront: number;
    stallHeightRear: number;
    /** Dauer des Moduswechsels [s]. */
    modeTransition: number;
    /** Zusatzwiderstand durch Schiebewinkel (pro rad^2). */
    yawDrag: number;
  };
  engine: {
    /** Spitzenleistung Verbrenner [W]. */
    iceMaxPower: number;
    idleRpm: number;
    revLimit: number;
    launchRpm: number;
    /** Normierte Leistungskurve: [rpm, Anteil der Spitzenleistung]. */
    powerCurve: Array<[number, number]>;
    /** Schleppmoment: drag0 + drag1 * rpm [Nm]. */
    dragTorque0: number;
    dragTorque1: number;
    /** Trägheit Motor + MGU-K-Rotor [kg m^2]. */
    inertia: number;
    /** Fuel: Wirkungsgrad * Heizwert [J/kg]. */
    fuelEnergy: number;
  };
  ers: {
    /** MGU-K Spitzenleistung [W] (Antrieb und Rekuperation). */
    kMaxPower: number;
    /** Max. MGU-K Moment an den Hinterrädern (Summe) [Nm]. */
    kMaxWheelTorque: number;
    /** Geschwindigkeits-Abregelung des Antriebs [m/s]: volle Leistung bis vTaperStart, null bei vTaperEnd. */
    vTaperStart: number;
    vTaperEnd: number;
    efficiency: number;
    /** Nutzbare Batteriekapazität [J]. */
    batteryCapacity: number;
    batteryStart: number;
    /** Max. Rekuperationsleistung beim Bremsen [W]. */
    regenMaxPower: number;
    /** Rekuperationsleistung beim Ausrollen [W]. */
    coastRegenPower: number;
  };
  drivetrain: {
    /** Gesamtübersetzung (Motor -> Rad) je Gang. */
    ratios: number[];
    efficiency: number;
    upshiftRpm: number;
    downshiftRpm: number;
    shiftTime: number;
    /** Max. übertragbares Moment der schleifenden Kupplung (Start), bezogen auf die Hinterachse [Nm]. */
    clutchTorqueMax: number;
    /** Sperrdifferenzial. */
    diffPreload: number;
    diffPowerRamp: number;
    diffCoastRamp: number;
  };
  brakes: {
    /** Max. Bremsmoment je Rad vorne/hinten [Nm]. */
    maxTorqueFront: number;
    maxTorqueRear: number;
    /** Bremsbalance vorne 0..1. */
    bias: number;
    /** Thermische Masse Scheibe+Sattel [J/K]. */
    heatCapFront: number;
    heatCapRear: number;
    coolBase: number;
    coolSpeed: number;
  };
  tiresFront: TireParams;
  tiresRear: TireParams;
  /** Abmessungen für die Darstellung. */
  body: {
    length: number;
    width: number;
  };
}

const baseTire: TireParams = {
  fz0: 3000,
  mux: 1.75,
  muy: 1.9,
  dmuDFz: -5e-5,
  kxStiff: 34,
  pKy1: 44,
  pKy2: 2.2,
  Cx: 1.65,
  Ex: 0.2,
  Cy: 1.55,
  Ey: -0.4,
  rBx1: 13,
  rBx2: 9.9,
  rCx1: 1.05,
  rBy1: 10.5,
  rBy2: 7.8,
  rBy3: 0.0,
  rCy1: 1.05,
  relaxLength: 0.35,
  radius: 0.345,
  width: 0.28,
  inertia: 1.3,
};

export const TEST_CAR_2026: CarConfig = {
  name: 'Testauto 2026',
  mass: { dry: 768, fuelStart: 100, unsprungFront: 22, unsprungRear: 26 },
  geometry: {
    wheelbase: 3.4,
    frontWeight: 0.455,
    trackFront: 1.473,
    trackRear: 1.479,
    cgHeight: 0.275,
    rollCenterFront: 0.035,
    rollCenterRear: 0.085,
    pitchCenter: 0.09,
    Iz: 800,
    Ix: 180,
    Iy: 950,
    ackermann: 0.6,
    maxSteer: 0.33,
    steerRate: 2.4,
    steerTau: 0.035,
  },
  suspension: {
    springFront: 240e3,
    springRear: 210e3,
    arbFront: 90e3,
    arbRear: 70e3,
    damperBump: 6500,
    damperRebound: 9500,
    rideHeightFront: 0.04,
    rideHeightRear: 0.085,
    bumpStopHeight: 0.008,
    bumpStopRate: 4.0e6,
  },
  aero: {
    zCdA: 1.18,
    zClA: 3.85,
    xCdA: 0.66,
    xClA: 1.95,
    zBalance: 0.42,
    xBalance: 0.4,
    refHeightFront: 0.03,
    refHeightRear: 0.07,
    groundGainFront: 0.45,
    groundGainRear: 0.3,
    stallHeightFront: 0.012,
    stallHeightRear: 0.03,
    modeTransition: 0.35,
    yawDrag: 2.0,
  },
  engine: {
    iceMaxPower: 400e3,
    idleRpm: 4500,
    revLimit: 15000,
    launchRpm: 8500,
    powerCurve: [
      [4000, 0.3],
      [6000, 0.55],
      [8000, 0.76],
      [10000, 0.93],
      [11500, 1.0],
      [13000, 0.97],
      [15000, 0.8],
    ],
    dragTorque0: 35,
    dragTorque1: 0.009,
    inertia: 0.15,
    fuelEnergy: 17.6e6,
  },
  ers: {
    kMaxPower: 350e3,
    kMaxWheelTorque: 2300,
    vTaperStart: 290 / 3.6,
    vTaperEnd: 355 / 3.6,
    efficiency: 0.95,
    batteryCapacity: 8.0e6,
    batteryStart: 7.2e6,
    regenMaxPower: 350e3,
    coastRegenPower: 150e3,
  },
  drivetrain: {
    ratios: [14.0, 11.3, 9.35, 7.9, 6.8, 5.95, 5.3, 4.8],
    efficiency: 0.95,
    upshiftRpm: 13400,
    downshiftRpm: 7600,
    shiftTime: 0.028,
    clutchTorqueMax: 3600,
    diffPreload: 60,
    diffPowerRamp: 0.3,
    diffCoastRamp: 0.15,
  },
  brakes: {
    maxTorqueFront: 4300,
    maxTorqueRear: 3300,
    bias: 0.58,
    heatCapFront: 1900,
    heatCapRear: 1700,
    coolBase: 30,
    coolSpeed: 1.9,
  },
  tiresFront: { ...baseTire, mux: 2.0, muy: 2.3, width: 0.28 },
  tiresRear: { ...baseTire, mux: 2.3, muy: 2.6, width: 0.375, pKy1: 47, inertia: 1.5 },
  body: { length: 5.4, width: 1.9 },
};
