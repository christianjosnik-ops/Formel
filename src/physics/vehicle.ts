import type { CarConfig } from '../config/car';
import { PHYS } from '../config/physics';
import { AeroModel } from './aero';
import { Powertrain } from './powertrain';
import { S } from './layout';
import { TireModel } from './tire';

const RAD_TO_RPM = 60 / (2 * Math.PI);

export interface DriverInput {
  /** -1..1, positiv = links. */
  steer: number;
  throttle: number;
  brake: number;
  /** Aktive Aero: 1 = X-Modus (Gerade), 0 = Z-Modus (Kurve). */
  aeroX: number;
  /** Fahrhilfen 0 = aus, 1 = mittel, 2 = stark. */
  tc: number;
  abs: number;
  steerAssist: number;
}

export function newInput(): DriverInput {
  return { steer: 0, throttle: 0, brake: 0, aeroX: 0, tc: 1, abs: 1, steerAssist: 1 };
}

/**
 * Vier-Rad-Fahrzeugmodell mit 10 Freiheitsgraden:
 *  - Ebene Bewegung: x, y, Gieren (Längs-/Quergeschwindigkeit in Karosserieachsen)
 *  - Aufbau: Hub (heave), Wanken (roll), Nicken (pitch) über Feder/Dämpfer/Stabi je Rad
 *  - 4 Raddrehungen (implizit integriert wegen der Steifigkeit des Reifenschlupfs)
 *
 * Alle Zustände sind Zahlen bzw. vorallokierte Float64Arrays. Der Schritt allokiert nicht.
 * Koordinaten: x vorn, y links, Gieren positiv gegen den Uhrzeigersinn (Linkskurve).
 * Räder: 0 FL, 1 FR, 2 RL, 3 RR.
 */
export class Vehicle {
  readonly cfg: CarConfig;
  readonly input: DriverInput = newInput();

  // ---- Zustand ----
  time = 0;
  x = 0;
  y = 0;
  psi = 0;
  u = 0;
  v = 0;
  r = 0;
  z = 0;
  zd = 0;
  phi = 0;
  phid = 0;
  theta = 0;
  thetad = 0;
  steer = 0;
  aeroX = 0;
  fuel = 0;
  soc = 0;
  mass = 0;

  readonly omega = new Float64Array(4);
  readonly alphaLag = new Float64Array(4);
  readonly brakeTemp = new Float64Array(4);

  // ---- Ausgaben / Telemetrie ----
  readonly fz = new Float64Array(4);
  readonly fx = new Float64Array(4);
  readonly fy = new Float64Array(4);
  readonly kappa = new Float64Array(4);
  readonly alpha = new Float64Array(4);
  readonly susp = new Float64Array(4);
  readonly gripScale = new Float64Array([1, 1, 1, 1]);
  readonly steerWheel = new Float64Array(2);
  axG = 0;
  ayG = 0;
  absActive = 0;
  tcActive = 0;
  kPowerSigned = 0;
  throttleEff = 0;
  brakeEff = 0;
  /** Überschreibungen für Windschatten/Dirty Air (Phase 5). */
  aeroScaleFront = 1;
  aeroScaleRear = 1;
  dragScale = 1;
  /** -1 = MGU-K folgt dem Gaspedal, sonst 0..1. */
  kDeployOverride = -1;

  // ---- Crash, Schäden und Umwelt (werden vom World-Modul gesetzt) ----
  /** Äußere Kräfte/Momente in Karosserieachsen (Kontakte) [N, Nm]. */
  extFx = 0;
  extFy = 0;
  extMz = 0;
  /** Nickmoment (Nase tiefer +) und Wankmoment (rechts tiefer +) aus Kontakten [Nm]. */
  extMPitch = 0;
  extMRoll = 0;
  powerScale = 1;
  retired = 0;
  aeroDamageF = 1;
  aeroDamageR = 1;
  dragDamage = 1;
  readonly wheelOff = new Float64Array(4);
  readonly punct = new Float64Array(4);
  readonly toe = new Float64Array(4);
  readonly brakeScale = new Float64Array([1, 1, 1, 1]);
  readonly surfGrip = new Float64Array([1, 1, 1, 1]);
  readonly surfRoll = new Float64Array(4);
  /** Schleifintensität je Ecke 0..1 (Funken) und Arbeit [J] seit dem letzten Abholen. */
  readonly scrape = new Float64Array(4);
  scrapeWork = 0;

  readonly powertrain: Powertrain;
  readonly aero: AeroModel;
  private readonly tireF: TireModel;
  private readonly tireR: TireModel;

  // ---- abgeleitete Konstanten ----
  readonly xw = new Float64Array(4);
  readonly yw = new Float64Array(4);
  private readonly sy = new Float64Array(4); // +1 rechts, -1 links
  private readonly track = new Float64Array(4);
  private readonly kSpring = new Float64Array(4);
  private readonly kArb = new Float64Array(4);
  private readonly rideStatic = new Float64Array(4);
  private readonly wheelR = new Float64Array(4);
  private readonly wheelI = new Float64Array(4);
  private readonly lf: number;
  private readonly lr: number;
  private readonly L: number;
  private readonly hRollAtCg: number;

  // ---- Arbeitsvariablen ----
  private axF = 0; // gefilterte Längsbeschleunigung [m/s^2]
  private ayF = 0;
  private tcFactor = 1;
  private thrFilt = 0;
  private absFront = 1;
  private absRear = 1;
  private readonly tireOut = new Float64Array(2);
  private readonly tireOut2 = new Float64Array(2);
  private readonly dS = new Float64Array(4);
  private readonly dSd = new Float64Array(4);
  private readonly dFs = new Float64Array(4); // dynamischer Federkraftanteil
  private readonly scrapeForce = new Float64Array(4);
  private readonly tqDrive = new Float64Array(4);
  private readonly tqBrake = new Float64Array(4);

  constructor(cfg: CarConfig) {
    this.cfg = cfg;
    const g = cfg.geometry;
    this.L = g.wheelbase;
    this.lr = g.frontWeight * g.wheelbase;
    this.lf = g.wheelbase - this.lr;
    this.xw.set([this.lf, this.lf, -this.lr, -this.lr]);
    this.yw.set([g.trackFront / 2, -g.trackFront / 2, g.trackRear / 2, -g.trackRear / 2]);
    this.sy.set([-1, 1, -1, 1]);
    this.track.set([g.trackFront, g.trackFront, g.trackRear, g.trackRear]);
    const s = cfg.suspension;
    this.kSpring.set([s.springFront, s.springFront, s.springRear, s.springRear]);
    this.kArb.set([s.arbFront, s.arbFront, s.arbRear, s.arbRear]);
    this.rideStatic.set([s.rideHeightFront, s.rideHeightFront, s.rideHeightRear, s.rideHeightRear]);
    this.wheelR.set([cfg.tiresFront.radius, cfg.tiresFront.radius, cfg.tiresRear.radius, cfg.tiresRear.radius]);
    this.wheelI.set([cfg.tiresFront.inertia, cfg.tiresFront.inertia, cfg.tiresRear.inertia, cfg.tiresRear.inertia]);
    this.hRollAtCg = g.frontWeight * g.rollCenterFront + (1 - g.frontWeight) * g.rollCenterRear;
    this.powertrain = new Powertrain(cfg);
    this.aero = new AeroModel(cfg);
    this.tireF = new TireModel(cfg.tiresFront);
    this.tireR = new TireModel(cfg.tiresRear);
    this.reset(0, 0, 0);
  }

  reset(x: number, y: number, psi: number, speed = 0): void {
    this.time = 0;
    this.x = x;
    this.y = y;
    this.psi = psi;
    this.u = speed;
    this.v = 0;
    this.r = 0;
    this.z = 0;
    this.zd = 0;
    this.phi = 0;
    this.phid = 0;
    this.theta = 0;
    this.thetad = 0;
    this.steer = 0;
    this.aeroX = 0;
    this.fuel = this.cfg.mass.fuelStart;
    this.soc = this.cfg.ers.batteryStart;
    this.mass = this.cfg.mass.dry + this.fuel;
    this.axF = 0;
    this.ayF = 0;
    this.tcFactor = 1;
    this.thrFilt = 0;
    this.absFront = 1;
    this.absRear = 1;
    for (let i = 0; i < 4; i++) {
      this.omega[i] = speed / this.wheelR[i];
      this.alphaLag[i] = 0;
      this.brakeTemp[i] = 250;
      this.fz[i] = 0;
      this.fx[i] = 0;
      this.fy[i] = 0;
      this.kappa[i] = 0;
      this.alpha[i] = 0;
      this.susp[i] = 0;
    }
    this.extFx = this.extFy = this.extMz = this.extMPitch = this.extMRoll = 0;
    this.powerScale = 1;
    this.retired = 0;
    this.aeroDamageF = this.aeroDamageR = this.dragDamage = 1;
    this.wheelOff.fill(0);
    this.punct.fill(0);
    this.toe.fill(0);
    this.brakeScale.fill(1);
    this.scrape.fill(0);
    this.scrapeWork = 0;
    this.powertrain.reset();
    if (speed > 0) {
      // Gang passend zur Geschwindigkeit wählen
      const rat = this.cfg.drivetrain.ratios;
      for (let gi = rat.length - 1; gi >= 0; gi--) {
        if ((speed / this.wheelR[2]) * rat[gi] * RAD_TO_RPM < this.cfg.drivetrain.upshiftRpm) {
          this.powertrain.gear = gi;
        } else break;
      }
    }
  }

  private brakeEfficiency(temp: number): number {
    if (temp < 150) return 0.72;
    if (temp < 400) return 0.72 + 0.28 * ((temp - 150) / 250);
    if (temp < 850) return 1;
    if (temp < 1100) return 1 - 0.3 * ((temp - 850) / 250);
    return 0.7;
  }

  /** Geschwindigkeitsabhängiger maximaler Radlenkwinkel [rad] (Eingabe-Skalierung). */
  maxSteerAt(speed: number, level: number): number {
    const v0 = level === 0 ? 46 : level === 1 ? 32 : 24;
    return this.cfg.geometry.maxSteer / (1 + (speed * speed) / (v0 * v0));
  }

  /** Ein Physikschritt der Länge dt. Allokationsfrei. */
  step(dt: number): void {
    const cfg = this.cfg;
    const inp = this.input;
    const g = PHYS.gravity;
    const geo = cfg.geometry;
    const susC = cfg.suspension;
    const br = cfg.brakes;
    const ers = cfg.ers;

    const speed = Math.sqrt(this.u * this.u + this.v * this.v);
    this.mass = cfg.mass.dry + this.fuel;
    const m = this.mass;
    const mUnsF = cfg.mass.unsprungFront;
    const mUnsR = cfg.mass.unsprungRear;
    const mSprung = m - 2 * (mUnsF + mUnsR);

    // ---------------- Fahrerassistenz (Physik bleibt identisch, nur Eingaben werden gefiltert) ----------------
    let thr = inp.throttle < 0 ? 0 : inp.throttle > 1 ? 1 : inp.throttle;
    let brk = inp.brake < 0 ? 0 : inp.brake > 1 ? 1 : inp.brake;
    if (this.retired) thr = 0;

    // Gasannahme: Anstieg begrenzt (Drive-by-Wire/Kupplung), Zurücknehmen sofort
    {
      const up = thr - this.thrFilt;
      const maxUp = 7 * dt;
      this.thrFilt = up > maxUp ? this.thrFilt + maxUp : thr;
      thr = this.thrFilt;
    }

    // Traktionskontrolle auf Basis des Antriebsschlupfs der Hinterräder
    {
      const thrK = inp.tc === 1 ? 0.17 : 0.11;
      const slip = Math.max(this.kappa[2], this.kappa[3]);
      let target = 1;
      if (inp.tc > 0 && slip > thrK && speed > 2) {
        target = 1 - (slip - thrK) * 9;
        if (target < 0.05) target = 0.05;
      }
      const k = target < this.tcFactor ? 60 : 12;
      this.tcFactor += (target - this.tcFactor) * Math.min(1, dt * k);
      this.tcActive = this.tcFactor < 0.97 ? 1 : 0;
      thr *= this.tcFactor;
    }
    // ABS je Achse
    {
      const lock = inp.abs === 1 ? 0.22 : 0.14;
      const slipF = -Math.min(this.kappa[0], this.kappa[1]);
      const slipR = -Math.min(this.kappa[2], this.kappa[3]);
      let tF = 1;
      let tR = 1;
      if (inp.abs > 0 && speed > 4 && brk > 0.05) {
        if (slipF > lock) tF = Math.max(0.15, 1 - (slipF - lock) * 7);
        if (slipR > lock) tR = Math.max(0.15, 1 - (slipR - lock) * 7);
      }
      this.absFront += (tF - this.absFront) * Math.min(1, dt * (tF < this.absFront ? 80 : 14));
      this.absRear += (tR - this.absRear) * Math.min(1, dt * (tR < this.absRear ? 80 : 14));
      this.absActive = this.absFront < 0.97 || this.absRear < 0.97 ? 1 : 0;
    }
    this.throttleEff = thr;
    this.brakeEff = brk;

    // Lenkung: Zielwinkel, optional Gierstabilisierung, Stellgeschwindigkeit
    {
      let cmd = inp.steer < -1 ? -1 : inp.steer > 1 ? 1 : inp.steer;
      if (inp.steerAssist > 0) cmd = Math.sign(cmd) * Math.pow(Math.abs(cmd), 1.35);
      let target = cmd * this.maxSteerAt(speed, inp.steerAssist);
      if (inp.steerAssist > 0 && speed > 8) {
        const rDes = (speed * Math.tan(target)) / this.L;
        const gain = inp.steerAssist === 1 ? 0.35 : 0.8;
        let corr = gain * (rDes - this.r) * (this.L / speed);
        if (corr > 0.06) corr = 0.06;
        else if (corr < -0.06) corr = -0.06;
        target += corr;
      }
      const max = geo.maxSteer;
      if (target > max) target = max;
      else if (target < -max) target = -max;
      let rate = (target - this.steer) / geo.steerTau;
      if (rate > geo.steerRate) rate = geo.steerRate;
      else if (rate < -geo.steerRate) rate = -geo.steerRate;
      this.steer += rate * dt;
    }
    // Ackermann
    {
      const d = this.steer;
      const td = Math.tan(d);
      const dl = Math.atan((this.L * td) / (this.L - (geo.trackFront / 2) * td));
      const dr = Math.atan((this.L * td) / (this.L + (geo.trackFront / 2) * td));
      this.steerWheel[0] = d + geo.ackermann * (dl - d);
      this.steerWheel[1] = d + geo.ackermann * (dr - d);
    }

    // Aktive Aero: Modus-Übergang; Bremsen schaltet sofort zurück in den Z-Modus
    {
      const want = brk > 0.1 ? 0 : inp.aeroX;
      const rate = 1 / cfg.aero.modeTransition;
      if (want > this.aeroX) this.aeroX = Math.min(want, this.aeroX + rate * dt);
      else this.aeroX = Math.max(want, this.aeroX - rate * dt * 2);
    }

    // ---------------- Antrieb ----------------
    const wRear = 0.5 * (this.omega[2] + this.omega[3]);
    const kDeploy = this.kDeployOverride >= 0 ? this.kDeployOverride : thr;
    this.powertrain.powerScale = this.powerScale;
    this.powertrain.step(dt, wRear, thr, speed, this.soc, kDeploy);
    const pt = this.powertrain;

    // Differenzial (Lamellen-Sperre, glatt)
    const tIn = pt.iceWheelTorque + pt.kWheelTorque;
    {
      const dtc = cfg.drivetrain;
      const lockTq = dtc.diffPreload + (tIn > 0 ? dtc.diffPowerRamp : dtc.diffCoastRamp) * Math.abs(tIn);
      const dw = this.omega[2] - this.omega[3];
      const transfer = lockTq * Math.tanh(dw / 2.5);
      this.tqDrive[0] = 0;
      this.tqDrive[1] = 0;
      this.tqDrive[2] = 0.5 * tIn - transfer;
      this.tqDrive[3] = 0.5 * tIn + transfer;
    }

    // ---------------- Bremsen + Rekuperation ----------------
    {
      const tf = Math.min(brk * this.absFront * br.bias * (br.maxTorqueFront + br.maxTorqueRear), br.maxTorqueFront * 1.15);
      const tr = Math.min(brk * this.absRear * (1 - br.bias) * (br.maxTorqueFront + br.maxTorqueRear), br.maxTorqueRear * 1.15);
      // Rekuperation an der Hinterachse: zuerst Bremsanforderung, sonst Ausrollen
      let regen = 0; // Summe Hinterachse [Nm]
      const wk = Math.max(wRear, 8);
      const socRoom = ers.batteryCapacity - this.soc;
      if (socRoom > 0) {
        const speedFade = Math.min(1, speed / 10);
        if (brk > 0.02) {
          const cap = Math.min((ers.regenMaxPower * ers.efficiency) / wk, ers.kMaxWheelTorque) * speedFade;
          regen = Math.min(2 * tr, cap);
        } else if (thr < 0.03) {
          regen = Math.min((ers.coastRegenPower * ers.efficiency) / wk, ers.kMaxWheelTorque * 0.3) * speedFade;
        }
      }
      const effF0 = this.brakeEfficiency(this.brakeTemp[0]);
      const effF1 = this.brakeEfficiency(this.brakeTemp[1]);
      const fricR = Math.max(0, 2 * tr - regen);
      this.tqBrake[0] = tf * effF0;
      this.tqBrake[1] = tf * effF1;
      this.tqBrake[2] = 0.5 * fricR * this.brakeEfficiency(this.brakeTemp[2]) + 0.5 * regen;
      this.tqBrake[3] = 0.5 * fricR * this.brakeEfficiency(this.brakeTemp[3]) + 0.5 * regen;
      for (let i = 0; i < 4; i++) {
        if (this.wheelOff[i] > 0.5) this.tqBrake[i] = 0;
        else this.tqBrake[i] *= this.brakeScale[i];
      }
      const regenPower = regen * wk;
      this.kPowerSigned = pt.kPower - regenPower;
      // Batterie
      this.soc -= (pt.batteryPower - regenPower * ers.efficiency) * dt;
      if (this.soc < 0) this.soc = 0;
      else if (this.soc > ers.batteryCapacity) this.soc = ers.batteryCapacity;
      // Scheibentemperaturen (nur Reibbremsen heizen)
      for (let i = 0; i < 4; i++) {
        const fricTq = i < 2 ? this.tqBrake[i] : this.tqBrake[i] - 0.5 * regen;
        const cap = i < 2 ? br.heatCapFront : br.heatCapRear;
        const heat = Math.max(0, fricTq) * Math.abs(this.omega[i]);
        const cool = (br.coolBase + br.coolSpeed * speed) * (this.brakeTemp[i] - PHYS.ambientTemp);
        this.brakeTemp[i] += ((heat - cool) * dt) / cap;
      }
    }

    // ---------------- Aerodynamik ----------------
    const hF = this.rideStatic[0] - 0.5 * (this.susp[0] + this.susp[1]);
    const hR = this.rideStatic[2] - 0.5 * (this.susp[2] + this.susp[3]);
    const beta = speed > 5 ? Math.atan2(this.v, Math.abs(this.u)) : 0;
    this.aero.update(speed, hF, hR, this.aeroX, beta, this.aeroScaleFront * this.aeroDamageF, this.aeroScaleRear * this.aeroDamageR, this.dragScale * this.dragDamage);
    const dragK = 0.5 * PHYS.rhoAir * this.aero.cdA * speed;
    const fxAero = -dragK * this.u;
    const fyAero = -dragK * this.v;
    const downF = this.aero.downFront;
    const downR = this.aero.downRear;

    // ---------------- Federung: Einfederung, Kräfte, Radlasten ----------------
    const phi = this.phi;
    const th = this.theta;
    const z = this.z;
    const axF = this.axF;
    const ayF = this.ayF;

    const rwF = cfg.tiresFront.radius;
    const rwR = cfg.tiresRear.radius;
    // geometrische Lastverlagerung
    const tgF = (mSprung * geo.frontWeight * ayF * geo.rollCenterFront + 2 * mUnsF * ayF * rwF) / geo.trackFront;
    const tgR = (mSprung * (1 - geo.frontWeight) * ayF * geo.rollCenterRear + 2 * mUnsR * ayF * rwR) / geo.trackRear;
    const tgLong = (mSprung * axF * geo.pitchCenter) / this.L / 2;

    let sumDFs = 0;
    let momPitch = downF * this.lf - downR * this.lr;
    let momRoll = 0;
    for (let i = 0; i < 4; i++) {
      const half = this.track[i] * 0.5;
      const sgn = this.sy[i];
      const d = z + sgn * half * phi + this.xw[i] * th;
      const dd = this.zd + sgn * half * this.phid + this.xw[i] * this.thetad;
      this.dS[i] = d;
      this.dSd[i] = dd;
      this.susp[i] = d;
    }
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const other = i ^ 1;
      const d = this.dS[i];
      const dd = this.dSd[i];
      let f = this.kSpring[i] * d + (dd > 0 ? susC.damperBump : susC.damperRebound) * dd;
      // Stabilisator: Kraft proportional zur Einfederungsdifferenz rechts - links
      f += 0.5 * this.kArb[i] * (d - this.dS[other]);
      // Anschlagpuffer / Bodenplatte (platter Reifen senkt die Ecke ab)
      const h = this.rideStatic[i] - 0.045 * this.punct[i] - d;
      let scrapeF = 0;
      if (h < susC.bumpStopHeight) scrapeF = susC.bumpStopRate * (susC.bumpStopHeight - h);
      // Rad abgerissen: Radträger/Querlenker stützen die Ecke auf dem Boden ab
      if (this.wheelOff[i] > 0.5) {
        const strutH = 0.13;
        if (h < strutH) scrapeF += 6.0e5 * (strutH - h) + (dd > 0 ? 9000 * dd : 0);
      }
      f += scrapeF;
      this.scrapeForce[i] = scrapeF;
      this.dFs[i] = f;
      sumDFs += f;
      momPitch -= f * this.xw[i];
      momRoll -= f * this.sy[i] * this.track[i] * 0.5;

      const share = front ? geo.frontWeight : 1 - geo.frontWeight;
      const f0 = 0.5 * mSprung * g * share;
      const unsprung = (front ? mUnsF : mUnsR) * g;
      const tg = front ? tgF : tgR;
      let load = f0 + f + unsprung + this.sy[i] * tg + (front ? -tgLong : tgLong);
      if (load < PHYS.minWheelLoad) load = PHYS.minWheelLoad;
      this.fz[i] = this.wheelOff[i] > 0.5 ? 0 : load;
    }
    momPitch -= mSprung * axF * (geo.cgHeight - geo.pitchCenter);
    momRoll += mSprung * ayF * (geo.cgHeight - this.hRollAtCg);

    // ---------------- Reifenkräfte ----------------
    let fxBody = fxAero + this.extFx;
    let fyBody = fyAero + this.extFy;
    let mz = this.extMz;
    momPitch += this.extMPitch;
    momRoll += this.extMRoll;
    const u = this.u;
    const v = this.v;
    const r = this.r;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const delta = (front ? this.steerWheel[i] : 0) + this.toe[i];
      const c = Math.cos(delta);
      const s = Math.sin(delta);
      const vxb = u - r * this.yw[i];
      const vyb = v + r * this.xw[i];
      // Bodenkontakt von Unterboden/Radträger: Reibung bremst und erzeugt Funken
      {
        const sf = this.scrapeForce[i];
        const sp = Math.hypot(vxb, vyb);
        if (sf > 0 && sp > 0.05) {
          const mu = this.wheelOff[i] > 0.5 ? 0.6 : 0.42;
          const k = (-mu * sf) / Math.sqrt(sp * sp + 0.04);
          const ffx = k * vxb;
          const ffy = k * vyb;
          fxBody += ffx;
          fyBody += ffy;
          mz += this.xw[i] * ffy - this.yw[i] * ffx;
          this.scrapeWork += mu * sf * sp * dt;
          const inten = Math.min(1, (sf / 12000) * Math.min(1, sp / 18));
          this.scrape[i] += (inten - this.scrape[i]) * 0.3;
        } else {
          this.scrape[i] *= 0.9;
        }
      }
      if (this.wheelOff[i] > 0.5) {
        this.fx[i] = this.fy[i] = this.kappa[i] = this.alpha[i] = 0;
        this.omega[i] = 0;
        continue;
      }
      const vxw = vxb * c + vyb * s;
      const vyw = -vxb * s + vyb * c;
      const vden = Math.max(Math.abs(vxw), PHYS.vMinSlip);
      let kap = (this.omega[i] * this.wheelR[i] - vxw) / vden;
      if (kap > 1.5) kap = 1.5;
      else if (kap < -1.5) kap = -1.5;
      const aSlide = Math.atan(vyw / vden);
      const relax = Math.max(Math.abs(vxw), PHYS.vMinRelax) / (front ? cfg.tiresFront.relaxLength : cfg.tiresRear.relaxLength);
      this.alphaLag[i] += (aSlide - this.alphaLag[i]) * (1 - Math.exp(-relax * dt));
      const al = this.alphaLag[i];
      this.kappa[i] = kap;
      this.alpha[i] = al;

      const tire = front ? this.tireF : this.tireR;
      const fz = this.fz[i];
      const grip = this.gripScale[i] * this.surfGrip[i] * (1 - 0.55 * this.punct[i]);
      tire.compute(fz, kap, al, grip, this.tireOut);
      const fxT = this.tireOut[0];
      const fyT = -this.tireOut[1];
      this.fx[i] = fxT;
      this.fy[i] = fyT;
      // Rollwiderstand wirkt nur auf den Aufbau
      const rr = (PHYS.rollingResistance + PHYS.rollingResistanceSpeed * Math.abs(vxw) + this.surfRoll[i] + 0.04 * this.punct[i]) * fz * Math.tanh(vxw / 0.6);
      const fxTot = fxT - rr;
      const fxb = fxTot * c - fyT * s;
      const fyb = fxTot * s + fyT * c;
      fxBody += fxb;
      fyBody += fyb;
      mz += this.xw[i] * fyb - this.yw[i] * fxb;

      // Ableitung dFx/dkappa für die implizite Raddrehzahl-Integration
      tire.compute(fz, kap + 0.01, al, grip, this.tireOut2);
      const dFxdK = Math.max(0, (this.tireOut2[0] - fxT) / 0.01);
      this.kappa[i] = kap;
      // Raddrehung (implizit): I dw/dt = Td - R Fx
      let inertia = this.wheelI[i];
      if (i >= 2) inertia += 0.5 * pt.reflectedInertia;
      const rad = this.wheelR[i];
      const f = this.tqDrive[i] - rad * fxT;
      const kw = (dFxdK * rad) / vden; // dFx/domega
      let w1 = this.omega[i] + ((dt * f) / inertia) / (1 + (dt * rad * kw) / inertia);
      // Bremse als Impuls, hält das Rad bei null an
      const dw = (dt * this.tqBrake[i]) / inertia;
      if (w1 > 0) w1 = w1 > dw ? w1 - dw : 0;
      else if (w1 < 0) w1 = w1 < -dw ? w1 + dw : 0;
      this.omega[i] = w1;
    }

    // ---------------- Aufbau integrieren ----------------
    const axB = fxBody / m;
    const ayB = fyBody / m;
    // gefilterte Beschleunigungen für die Lastverlagerung (Schleife Kraft -> Last -> Kraft glätten)
    const fa = 0.45;
    this.axF += (axB - this.axF) * fa;
    this.ayF += (ayB - this.ayF) * fa;
    this.axG = axB / g;
    this.ayG = ayB / g;

    this.u += (axB + v * r) * dt;
    this.v += (ayB - this.u * r) * dt;
    this.r += (mz / geo.Iz) * dt;
    // Niedriggeschwindigkeits-Dämpfung gegen Schlupf-Zittern im Stand
    if (speed < 0.6 && thr < 0.01) {
      const k = 1 - Math.min(1, dt * 6);
      this.u *= k;
      this.v *= k;
      this.r *= k;
    }
    const cp = Math.cos(this.psi);
    const sp = Math.sin(this.psi);
    this.x += (this.u * cp - this.v * sp) * dt;
    this.y += (this.u * sp + this.v * cp) * dt;
    this.psi += this.r * dt;

    // Hub, Wank, Nick (semi-implizites Euler)
    const zdd = (downF + downR - sumDFs) / mSprung;
    this.zd += zdd * dt;
    this.z += this.zd * dt;
    this.phid += (momRoll / geo.Ix) * dt;
    this.phi += this.phid * dt;
    this.thetad += (momPitch / geo.Iy) * dt;
    this.theta += this.thetad * dt;
    if (this.phi > 0.3 || this.phi < -0.3) {
      this.phi = this.phi > 0 ? 0.3 : -0.3;
      this.phid = 0;
    }
    if (this.theta > 0.22 || this.theta < -0.22) {
      this.theta = this.theta > 0 ? 0.22 : -0.22;
      this.thetad = 0;
    }
    if (this.z > 0.09) {
      this.z = 0.09;
      if (this.zd > 0) this.zd = 0;
    } else if (this.z < -0.04) {
      this.z = -0.04;
      if (this.zd < 0) this.zd = 0;
    }

    // Kraftstoff
    this.fuel -= pt.fuelRate * dt;
    if (this.fuel < 0) this.fuel = 0;

    this.time += dt;
  }

  /** Schreibt den Zustand in einen Snapshot-Puffer (siehe layout.ts). */
  writeSnapshot(out: Float64Array): void {
    out[S.time] = this.time;
    out[S.x] = this.x;
    out[S.y] = this.y;
    out[S.psi] = this.psi;
    out[S.u] = this.u;
    out[S.v] = this.v;
    out[S.r] = this.r;
    out[S.heave] = this.z;
    out[S.roll] = this.phi;
    out[S.pitch] = this.theta;
    out[S.speedKmh] = Math.hypot(this.u, this.v) * 3.6;
    out[S.rpm] = this.powertrain.rpm;
    out[S.gear] = this.powertrain.gear + 1;
    out[S.throttle] = this.throttleEff;
    out[S.brake] = this.brakeEff;
    out[S.steer] = this.steer;
    out[S.aeroX] = this.aeroX;
    out[S.ax] = this.axG;
    out[S.ay] = this.ayG;
    out[S.soc] = this.soc;
    out[S.fuel] = this.fuel;
    out[S.mass] = this.mass;
    out[S.rideFront] = this.rideStatic[0] - 0.5 * (this.susp[0] + this.susp[1]);
    out[S.rideRear] = this.rideStatic[2] - 0.5 * (this.susp[2] + this.susp[3]);
    out[S.downFront] = this.aero.downFront;
    out[S.downRear] = this.aero.downRear;
    out[S.drag] = 0.5 * PHYS.rhoAir * this.aero.cdA * (this.u * this.u + this.v * this.v);
    out[S.icePower] = this.powertrain.icePowerMech;
    out[S.kPower] = this.kPowerSigned;
    out[S.absActive] = this.absActive;
    for (let i = 0; i < 4; i++) out[S.scrape + i] = this.scrape[i];
    out[S.tcActive] = this.tcActive;
    out[S.steerL] = this.steerWheel[0];
    out[S.steerR] = this.steerWheel[1];
    for (let i = 0; i < 4; i++) {
      out[S.omega + i] = this.omega[i];
      out[S.fz + i] = this.fz[i];
      out[S.fx + i] = this.fx[i];
      out[S.fy + i] = this.fy[i];
      out[S.kappa + i] = this.kappa[i];
      out[S.alpha + i] = this.alpha[i];
      out[S.susp + i] = this.susp[i];
      out[S.brakeTemp + i] = this.brakeTemp[i];
    }
  }
}
