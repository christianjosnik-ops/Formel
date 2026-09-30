import type { DriverInput } from '../physics/vehicle';
import type { Settings } from './settings';
import { TiltSteering } from './tilt';

/**
 * Führt alle Eingabequellen zusammen: Touch-Flächen, Neigung, Gamepad, Tastatur.
 * Die Quellen liefern normierte Werte; Fahrhilfen wirken später in der Physik-Eingabe.
 */
export class Controls {
  readonly tilt = new TiltSteering();
  // Touch (von touch.ts gesetzt)
  touchSteer = 0;
  touchThrottle = 0;
  touchBrake = 0;
  // Tastatur
  private readonly keys = new Set<string>();
  private keySteer = 0;
  private aeroX = 0;
  // Ergebnis
  steer = 0;
  throttle = 0;
  brake = 0;
  gamepadName = '';

  onReset: () => void = () => {};
  onRepair: () => void = () => {};
  onCamera: () => void = () => {};
  onToggleMenu: () => void = () => {};
  onToggleTelemetry: () => void = () => {};

  private prevButtons: boolean[] = [];

  constructor(private readonly settings: Settings) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'KeyX':
        case 'KeyE':
          this.toggleAero();
          break;
        case 'KeyR':
          this.onReset();
          break;
        case 'KeyC':
          this.onCamera();
          break;
        case 'KeyB':
          this.onRepair();
          break;
        case 'KeyT':
          this.onToggleTelemetry();
          break;
        case 'Escape':
        case 'KeyM':
          this.onToggleMenu();
          break;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  toggleAero(): void {
    this.aeroX = this.aeroX ? 0 : 1;
  }
  get aeroMode(): number {
    return this.aeroX;
  }

  private pollGamepad(): { steer: number; thr: number; brk: number; active: boolean } {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.gamepadName = p.id;
      let sx = p.axes[0] ?? 0;
      const dz = 0.07;
      sx = Math.abs(sx) < dz ? 0 : Math.sign(sx) * ((Math.abs(sx) - dz) / (1 - dz));
      // Triggern: Standard-Mapping (RT = 7, LT = 6); Fallback auf Achsen/Buttons
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      const btn = p.buttons.map((b) => b.pressed);
      // Flanken: A/X = Aero, Y = Reset, B = Kamera, Start = Menü
      const edge = (i: number) => btn[i] && !this.prevButtons[i];
      if (edge(2) || edge(0)) this.toggleAero();
      if (edge(3)) this.onReset();
      if (edge(1)) this.onCamera();
      if (edge(9)) this.onToggleMenu();
      this.prevButtons = btn;
      const active = Math.abs(sx) > 0.02 || rt > 0.02 || lt > 0.02;
      return { steer: -sx, thr: rt, brk: lt, active };
    }
    this.gamepadName = '';
    return { steer: 0, thr: 0, brk: 0, active: false };
  }

  /** Muss jeden Frame aufgerufen werden. */
  update(dt: number): void {
    const k = this.keys;
    // Tastatur
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    const dir = (left ? 1 : 0) - (right ? 1 : 0);
    if (dir !== 0) this.keySteer += Math.sign(dir - this.keySteer) * Math.min(Math.abs(dir - this.keySteer), dt * 3.2);
    else this.keySteer -= Math.sign(this.keySteer) * Math.min(Math.abs(this.keySteer), dt * 6);
    const keyThr = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0;
    const keyBrk = k.has('ArrowDown') || k.has('KeyS') || k.has('Space') ? 1 : 0;

    const gp = this.pollGamepad();

    let steer = 0;
    if (gp.active && Math.abs(gp.steer) > 0.02) steer = gp.steer;
    else if (Math.abs(this.keySteer) > 0.001) steer = this.keySteer;
    else if (this.settings.control === 'tilt') steer = this.tilt.value(this.settings.tiltRange, dt) * (this.settings.tiltInvert ? -1 : 1);
    else steer = this.touchSteer;

    this.steer = steer;
    this.throttle = Math.max(keyThr, gp.thr, this.touchThrottle);
    this.brake = Math.max(keyBrk, gp.brk, this.touchBrake);
  }

  fill(input: DriverInput): void {
    input.steer = this.steer;
    input.throttle = this.throttle;
    input.brake = this.brake;
    input.aeroX = this.aeroX;
    input.tc = this.settings.tc;
    input.abs = this.settings.abs;
    input.steerAssist = this.settings.steerAssist;
  }
}
