import type { CarConfig } from '../config/car';

const RAD_TO_RPM = 60 / (2 * Math.PI);
const RPM_TO_RAD = (2 * Math.PI) / 60;

/**
 * Antrieb 2026: 1.6 l V6 Turbo (~400 kW) plus MGU-K (350 kW) an der Hinterachse,
 * kein MGU-H. 8 Gänge, automatisches Schalten mit Zugkraftunterbrechung,
 * Schleppmoment, Drehzahlbegrenzer, Kupplungsschlupf beim Start.
 */
export class Powertrain {
  private readonly c: CarConfig;
  private readonly curveRpm: Float64Array;
  private readonly curveFrac: Float64Array;

  gear = 0; // Index 0..7
  shiftTimer = 0;
  rpm = 0;
  clutchSlipping = true;
  /** Leistungsfaktor durch Schäden (1 = voll). */
  powerScale = 1;

  /** Ergebnisse des letzten step(). */
  iceWheelTorque = 0;
  kWheelTorque = 0;
  /** Auf die Hinterräder reflektierte Trägheit (Summe beider Räder) [kg m^2]. */
  reflectedInertia = 0;
  fuelRate = 0; // kg/s
  batteryPower = 0; // W, >0 entlädt
  icePowerMech = 0;
  kPower = 0;

  constructor(cfg: CarConfig) {
    this.c = cfg;
    const n = cfg.engine.powerCurve.length;
    this.curveRpm = new Float64Array(n);
    this.curveFrac = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.curveRpm[i] = cfg.engine.powerCurve[i][0];
      this.curveFrac[i] = cfg.engine.powerCurve[i][1];
    }
    this.rpm = cfg.engine.idleRpm;
  }

  reset(): void {
    this.gear = 0;
    this.shiftTimer = 0;
    this.rpm = this.c.engine.idleRpm;
    this.clutchSlipping = true;
  }

  get ratio(): number {
    return this.c.drivetrain.ratios[this.gear];
  }

  /** Normierte Leistung bei Drehzahl (lineare Interpolation). */
  powerFraction(rpm: number): number {
    const r = this.curveRpm;
    const f = this.curveFrac;
    const n = r.length;
    if (rpm <= r[0]) return f[0] * Math.max(0, rpm / r[0]);
    if (rpm >= r[n - 1]) return f[n - 1];
    let i = 1;
    while (i < n - 1 && rpm > r[i]) i++;
    const t = (rpm - r[i - 1]) / (r[i] - r[i - 1]);
    return f[i - 1] + (f[i] - f[i - 1]) * t;
  }

  /** Motormoment bei Volllast [Nm]. */
  iceTorque(rpm: number): number {
    const w = Math.max(rpm, 1000) * RPM_TO_RAD;
    return (this.c.engine.iceMaxPower * this.powerScale * this.powerFraction(rpm)) / w;
  }

  dragTorque(rpm: number): number {
    return this.c.engine.dragTorque0 + this.c.engine.dragTorque1 * rpm;
  }

  /** MGU-K Abregelfaktor über der Geschwindigkeit (Reglement 2026: Leistung fällt ab ~290 km/h). */
  kTaper(speed: number): number {
    const e = this.c.ers;
    if (speed <= e.vTaperStart) return 1;
    if (speed >= e.vTaperEnd) return 0;
    return 1 - (speed - e.vTaperStart) / (e.vTaperEnd - e.vTaperStart);
  }

  /**
   * @param wRear mittlere Drehzahl der Hinterräder [rad/s]
   * @param throttle Gaspedal 0..1
   * @param speed Fahrzeuggeschwindigkeit [m/s]
   * @param soc Batterieladung [J]
   * @param kDeploy MGU-K Einsatz 0..1 (Energiemanagement, Standard = Gaspedal)
   */
  step(dt: number, wRear: number, throttle: number, speed: number, soc: number, kDeploy: number): void {
    const c = this.c;
    const dtc = c.drivetrain;
    const eng = c.engine;
    const w = wRear > 0 ? wRear : 0;

    // Schaltlogik
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer < 0) this.shiftTimer = 0;
    } else {
      const rpmWheel = w * this.ratio * RAD_TO_RPM;
      if (this.gear < dtc.ratios.length - 1 && rpmWheel > dtc.upshiftRpm) {
        this.gear++;
        this.shiftTimer = dtc.shiftTime;
      } else if (this.gear > 0 && rpmWheel < dtc.downshiftRpm) {
        this.gear--;
        this.shiftTimer = dtc.shiftTime;
      }
    }

    const ratio = this.ratio;
    const rpmWheel = w * ratio * RAD_TO_RPM;
    const shifting = this.shiftTimer > 0;

    // Kupplungsschlupf: Start / niedrige Drehzahl
    let rpmEng: number;
    if (rpmWheel < eng.launchRpm && this.gear === 0) {
      this.clutchSlipping = true;
      const launch = Math.min(1, throttle * 2.5);
      rpmEng = Math.max(rpmWheel, eng.idleRpm + (eng.launchRpm - eng.idleRpm) * launch);
    } else {
      this.clutchSlipping = false;
      rpmEng = Math.max(rpmWheel, eng.idleRpm);
    }
    this.rpm = rpmEng;

    // Trägheit: nur bei geschlossener Kupplung
    this.reflectedInertia = this.clutchSlipping || shifting ? 0 : eng.inertia * ratio * ratio;

    let te = 0;
    if (!shifting) {
      const limiter = Math.min(1, Math.max(0, (eng.revLimit - rpmEng) / 250));
      const full = this.iceTorque(rpmEng) * limiter;
      te = full * throttle;
      if (!this.clutchSlipping) te -= this.dragTorque(rpmEng) * (1 - throttle);
    }
    this.icePowerMech = Math.max(0, te) * rpmEng * RPM_TO_RAD;
    this.iceWheelTorque = te * ratio * (te > 0 ? dtc.efficiency : 1 / dtc.efficiency);
    if (this.clutchSlipping && this.iceWheelTorque > dtc.clutchTorqueMax) this.iceWheelTorque = dtc.clutchTorqueMax;
    this.fuelRate = this.icePowerMech / eng.fuelEnergy + 0.0004;

    // MGU-K Antrieb
    const e = c.ers;
    let pk = 0;
    if (soc > 0 && kDeploy > 0) {
      pk = e.kMaxPower * this.powerScale * this.kTaper(speed) * kDeploy;
    }
    const wk = Math.max(w, 8);
    let tk = (pk * e.efficiency) / wk;
    if (tk > e.kMaxWheelTorque) tk = e.kMaxWheelTorque;
    this.kWheelTorque = tk;
    this.kPower = tk * wk;
    this.batteryPower = this.kPower / e.efficiency;
  }
}
