import { S } from '../physics/layout';
import { TEST_CAR_2026 } from '../config/car';
import { HULL } from '../physics/crash/hull';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const TRACE_N = 600;

/** Anzeigeelemente: Cockpit-Daten, Schaltlichter, Telemetrie (Verlauf, g-Kreis, Reifen), Systemstatus. */
export class Hud {
  private readonly speedVal = $('speedVal');
  private readonly gear = $('gear');
  private readonly rpmVal = $('rpmVal');
  private readonly thrBar = $('thrBar');
  private readonly brkBar = $('brkBar');
  private readonly socBar = $('socBar');
  private readonly socVal = $('socVal');
  private readonly kVal = $('kVal');
  private readonly aeroChip = $('aeroChip');
  private readonly tcChip = $('tcChip');
  private readonly absChip = $('absChip');
  private readonly aeroBtn = $('aeroBtn');
  private readonly lights = $('shiftlights');
  private readonly ledEls: HTMLElement[] = [];
  private readonly telemetry = $('telemetry');
  private readonly trace = $('trace') as HTMLCanvasElement;
  private readonly gm = $('gmeter') as HTMLCanvasElement;
  private readonly tiresEl = $('tires');
  private readonly stats = $('stats');
  private readonly tireEls: { load: HTMLElement; txt: HTMLElement }[] = [];

  private readonly hSpeed = new Float32Array(TRACE_N);
  private readonly hThr = new Float32Array(TRACE_N);
  private readonly hBrk = new Float32Array(TRACE_N);
  private readonly hGear = new Float32Array(TRACE_N);
  private head = 0;
  private sampleAcc = 0;
  private textAcc = 0;
  private gTrail: Array<[number, number]> = [];
  private fps = 60;
  private flashT = 0;
  private readonly dmgPanel = $('damage');
  private readonly dmgCanvas = $('dmgCanvas') as HTMLCanvasElement;
  private readonly dmgText = $('dmgText');
  private readonly dmgTitle = $('dmgTitle');

  constructor() {
    for (let i = 0; i < 15; i++) {
      const el = document.createElement('i');
      el.className = i < 5 ? 'g' : i < 10 ? 'r' : 'b';
      this.lights.appendChild(el);
      this.ledEls.push(el);
    }
    const names = ['VL', 'VR', 'HL', 'HR'];
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'tire';
      d.innerHTML = `<b>${names[i]}</b><div class="load"><i></i></div><span></span>`;
      this.tiresEl.appendChild(d);
      this.tireEls.push({ load: d.querySelector('.load i') as HTMLElement, txt: d.querySelector('span') as HTMLElement });
    }
  }

  setTelemetryVisible(v: boolean): void {
    this.telemetry.classList.toggle('hidden', !v);
  }

  setFps(fps: number): void {
    this.fps = fps;
  }

  update(s: Float64Array, dt: number, tcLevel: number, absLevel: number): void {
    const cfg = TEST_CAR_2026;
    const kmh = s[S.speedKmh];
    this.speedVal.textContent = String(Math.round(kmh));
    const gear = s[S.gear];
    this.gear.textContent = kmh < 2 && s[S.throttle] < 0.05 ? 'N' : String(Math.round(gear));
    const rpm = s[S.rpm];
    this.rpmVal.textContent = String(Math.round(rpm / 10) * 10);
    this.thrBar.style.height = `${s[S.throttle] * 100}%`;
    this.brkBar.style.height = `${s[S.brake] * 100}%`;

    // Schaltlichter 9000 .. 13400 rpm
    const lo = 9000;
    const hi = cfg.drivetrain.upshiftRpm;
    const n = Math.max(0, Math.min(15, Math.round(((rpm - lo) / (hi - lo)) * 15)));
    const flash = rpm > hi - 150;
    this.flashT += dt;
    const flashOn = flash && Math.floor(this.flashT * 12) % 2 === 0;
    this.lights.classList.toggle('flash', flashOn);
    for (let i = 0; i < 15; i++) this.ledEls[i].classList.toggle('on', i < n);

    const soc = s[S.soc] / cfg.ers.batteryCapacity;
    this.socBar.style.width = `${soc * 100}%`;
    this.socVal.textContent = `${Math.round(soc * 100)}%`;
    const kp = s[S.kPower] / 1000;
    this.kVal.textContent = `${kp >= 0 ? '+' : ''}${Math.round(kp)} kW`;
    this.kVal.style.color = kp < -5 ? '#4da3ff' : kp > 5 ? '#19d3a2' : '';

    const ax = s[S.aeroX] > 0.5;
    this.aeroChip.textContent = ax ? 'X' : 'Z';
    this.aeroChip.className = `chip ${ax ? 'x' : 'z'}`;
    this.aeroBtn.classList.toggle('x', ax);
    (this.aeroBtn.querySelector('b') as HTMLElement).textContent = ax ? 'X' : 'Z';
    this.tcChip.className = `chip ${tcLevel === 0 ? 'off' : s[S.tcActive] ? 'on' : ''}`;
    this.absChip.className = `chip ${absLevel === 0 ? 'off' : s[S.absActive] ? 'on' : ''}`;
    this.tcChip.style.opacity = tcLevel === 0 ? '0.4' : '1';
    this.absChip.style.opacity = absLevel === 0 ? '0.4' : '1';

    this.updateDamage(s);

    if (this.telemetry.classList.contains('hidden')) return;

    // Verlauf mit 60 Hz
    this.sampleAcc += dt;
    while (this.sampleAcc >= 1 / 60) {
      this.sampleAcc -= 1 / 60;
      this.hSpeed[this.head] = kmh;
      this.hThr[this.head] = s[S.throttle];
      this.hBrk[this.head] = s[S.brake];
      this.hGear[this.head] = gear;
      this.head = (this.head + 1) % TRACE_N;
    }
    this.drawTrace();
    this.drawG(s[S.ax], s[S.ay]);

    this.textAcc += dt;
    if (this.textAcc > 0.1) {
      this.textAcc = 0;
      for (let i = 0; i < 4; i++) {
        const fz = s[S.fz + i];
        const e = this.tireEls[i];
        e.load.style.width = `${Math.min(100, (fz / 12000) * 100)}%`;
        const kap = s[S.kappa + i];
        const al = (s[S.alpha + i] * 180) / Math.PI;
        const slipMag = Math.min(1, Math.hypot(kap / 0.12, al / 7));
        e.load.style.background = slipMag > 1.0 ? '#ff4a3d' : slipMag > 0.75 ? '#ffc233' : '#19d3a2';
        e.txt.textContent = `${(fz / 1000).toFixed(1)}kN κ${kap.toFixed(2)} α${al.toFixed(1)}° ${Math.round(s[S.brakeTemp + i])}°C`;
      }
      const vmax = s[S.mass];
      this.stats.textContent =
        `FPS ${this.fps.toFixed(0)}  Physik ${s[S.hz].toFixed(0)} Hz  ${(s[S.stepMs] * 1000).toFixed(0)} µs/Schritt\n` +
        `Masse ${vmax.toFixed(0)} kg  Sprit ${s[S.fuel].toFixed(1)} kg\n` +
        `Bodenfreiheit V/H ${(s[S.rideFront] * 1000).toFixed(0)}/${(s[S.rideRear] * 1000).toFixed(0)} mm\n` +
        `Abtrieb V/H ${(s[S.downFront] / 1000).toFixed(1)}/${(s[S.downRear] / 1000).toFixed(1)} kN  Luftw. ${(s[S.drag] / 1000).toFixed(1)} kN\n` +
        `ICE ${(s[S.icePower] / 1000).toFixed(0)} kW  Lenkung ${((s[S.steer] * 180) / Math.PI).toFixed(1)}°  Gier ${s[S.r].toFixed(2)} rad/s`;
    }
  }

  private drawTrace(): void {
    const c = this.trace;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(0, (H * i) / 4);
      g.lineTo(W, (H * i) / 4);
      g.stroke();
    }
    const line = (arr: Float32Array, scale: number, color: string, lw = 1.6) => {
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.beginPath();
      for (let i = 0; i < TRACE_N; i++) {
        const v = arr[(this.head + i) % TRACE_N];
        const x = (i / (TRACE_N - 1)) * W;
        const y = H - 4 - (v / scale) * (H - 8);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    line(this.hGear, 8, 'rgba(255,255,255,.35)', 1);
    line(this.hSpeed, 360, '#4da3ff');
    line(this.hThr, 1, '#22e07a');
    line(this.hBrk, 1, '#ff4a3d');
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.font = '10px system-ui';
    g.fillText('Speed · Gas · Bremse · Gang (10 s)', 6, 12);
  }

  private drawG(ax: number, ay: number): void {
    const c = this.gm;
    const g = c.getContext('2d')!;
    const W = c.width;
    const cx = W / 2;
    const R = W / 2 - 6;
    g.clearRect(0, 0, W, W);
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 1;
    for (let i = 1; i <= 5; i += 1) {
      g.beginPath();
      g.arc(cx, cx, (R * i) / 5, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(cx - R, cx);
    g.lineTo(cx + R, cx);
    g.moveTo(cx, cx - R);
    g.lineTo(cx, cx + R);
    g.stroke();
    // gefühlte Kraft: Kurve links -> Punkt rechts, Bremsen -> Punkt oben
    const px = cx - (ay / 5) * R;
    const py = cx + (ax / 5) * R;
    this.gTrail.push([px, py]);
    if (this.gTrail.length > 40) this.gTrail.shift();
    for (let i = 0; i < this.gTrail.length; i++) {
      g.fillStyle = `rgba(255,194,51,${(i / this.gTrail.length) * 0.5})`;
      g.beginPath();
      g.arc(this.gTrail[i][0], this.gTrail[i][1], 3, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffc233';
    g.beginPath();
    g.arc(px, py, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.font = '10px system-ui';
    g.fillText(`${Math.hypot(ax, ay).toFixed(1)} g`, 6, 12);
  }

  // ------------------------------------------------------------------------------------------
  private static dmgColor(d: number): string {
    const t = Math.max(0, Math.min(1, d));
    const r = t < 0.5 ? 43 + (255 - 43) * (t / 0.5) : 255;
    const g = t < 0.5 ? 209 + (194 - 209) * (t / 0.5) : 194 - 194 * ((t - 0.5) / 0.5) + 59 * ((t - 0.5) / 0.5);
    const b = t < 0.5 ? 126 + (51 - 126) * (t / 0.5) : 51 + (48 - 51) * ((t - 0.5) / 0.5);
    return `rgb(${r | 0},${Math.max(0, g) | 0},${b | 0})`;
  }

  /** Schadenspanel: Draufsicht mit Zonenfarben, Crash-Stufe, Spitzen-g, Einschlaggeschwindigkeit. */
  private updateDamage(s: Float64Array): void {
    const any =
      s[S.crashLevel] > 0 ||
      s[S.dmgWingF] > 0.02 ||
      s[S.dmgWingR] > 0.02 ||
      s[S.dmgNose] > 0.02 ||
      s[S.dmgSideL] > 0.02 ||
      s[S.dmgSideR] > 0.02 ||
      s[S.dmgFloor] > 0.05 ||
      s[S.retired] > 0 ||
      s[S.wheelOff] + s[S.wheelOff + 1] + s[S.wheelOff + 2] + s[S.wheelOff + 3] > 0;
    this.dmgPanel.classList.toggle('hidden', !any);
    if (!any) return;
    const level = Math.round(s[S.crashLevel]);
    const names = ['Kleiner Schaden', 'Leichter Crash', 'Mittlerer Crash', 'Schwerer Crash', 'Extremer Crash'];
    this.dmgTitle.textContent = s[S.retired] > 0 ? 'AUSGEFALLEN' : names[level];
    this.dmgTitle.className = `l${s[S.retired] > 0 ? 4 : level}`;
    const engine = Math.round((1 - s[S.dmgEngine]) * 100);
    const floor = Math.round((1 - s[S.dmgFloor]) * 100);
    this.dmgText.innerHTML =
      `${s[S.peakG].toFixed(0)} g · ${s[S.impactSpeed].toFixed(0)} km/h · ${s[S.impactEnergy].toFixed(0)} kJ<br>` + `Antrieb ${engine} % · Boden ${floor} %`;

    const c = this.dmgCanvas;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const k = 40; // px pro Meter
    const cx = c.width / 2;
    const ox = 0.55; // x-Mitte des Fahrzeugs
    const X = (y: number) => cx - y * k;
    const Y = (x: number) => 118 - (x - ox) * k;
    const rect = (x0: number, x1: number, y0: number, y1: number, fill: string, dashed = false) => {
      g.beginPath();
      g.rect(X(y1), Y(x1), (y1 - y0) * k, (x1 - x0) * k);
      if (dashed) {
        g.setLineDash([3, 3]);
        g.strokeStyle = 'rgba(255,255,255,.55)';
        g.lineWidth = 1.3;
        g.stroke();
        g.setLineDash([]);
      } else {
        g.fillStyle = fill;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,.45)';
        g.lineWidth = 1;
        g.stroke();
      }
    };
    // Rumpf
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.beginPath();
    for (let i = 0; i < HULL.polyN; i++) {
      const x = X(HULL.polyY[i]);
      const y = Y(HULL.polyX[i]);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    const wf = s[S.dmgWingF];
    const wr = s[S.dmgWingR];
    rect(2.45, 3.11, -0.86, 0.86, Hud.dmgColor(wf), wf >= 1);
    rect(-1.94, -1.6, -0.5, 0.5, Hud.dmgColor(wr), wr >= 1);
    rect(2.0, 3.0, -0.16, 0.16, Hud.dmgColor(s[S.dmgNose]));
    rect(-1.0, 2.0, -0.3, 0.3, Hud.dmgColor(s[S.dmgEngine] * 0.8));
    rect(-1.0, 1.15, 0.3, 0.53, Hud.dmgColor(s[S.dmgSideL]));
    rect(-1.0, 1.15, -0.53, -0.3, Hud.dmgColor(s[S.dmgSideR]));
    rect(-1.72, -1.0, -0.25, 0.25, Hud.dmgColor(s[S.dmgRear]));
    const gf = TEST_CAR_2026.geometry;
    const lr = gf.frontWeight * gf.wheelbase;
    const lf = gf.wheelbase - lr;
    const wheelX = [lf, lf, -lr, -lr];
    const wheelY = [gf.trackFront / 2, -gf.trackFront / 2, gf.trackRear / 2, -gf.trackRear / 2];
    for (let i = 0; i < 4; i++) {
      const off = s[S.wheelOff + i] > 0.5;
      const dmg = Math.max(Math.abs(s[S.bent + i]) / 0.075, s[S.puncture + i]);
      const w = i < 2 ? 0.19 : 0.23;
      rect(wheelX[i] - 0.36, wheelX[i] + 0.36, wheelY[i] - w, wheelY[i] + w, Hud.dmgColor(dmg * 0.9), off);
    }
  }
}
