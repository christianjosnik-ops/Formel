/**
 * Neigungssteuerung über DeviceOrientation. Das Gerät wird wie ein Lenkrad gehalten
 * (Bildschirm zum Fahrer). Aus den Eulerwinkeln wird der Schwerkraftvektor im
 * Gerätekoordinatensystem abgeleitet und in Bildschirmkoordinaten gedreht; der Lenkwinkel
 * ist die Drehung des Geräts in der Bildschirmebene. Funktioniert dadurch in allen
 * vier Bildschirmorientierungen.
 */
export class TiltSteering {
  enabled = false;
  supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  /** Gefilterter Lenkwinkel in Grad (positiv = links). */
  angle = 0;
  offset = 0;
  private raw = 0;
  private valid = false;
  private listening = false;

  private screenAngle(): number {
    const so = (screen as Screen & { orientation?: { angle: number } }).orientation;
    if (so && typeof so.angle === 'number') return so.angle;
    const wo = (window as unknown as { orientation?: number }).orientation;
    return typeof wo === 'number' ? wo : 0;
  }

  private onOrient = (e: DeviceOrientationEvent): void => {
    if (e.beta == null || e.gamma == null) return;
    const b = (e.beta * Math.PI) / 180;
    const g = (e.gamma * Math.PI) / 180;
    // "Oben"-Vektor in Gerätekoordinaten (x rechts, y oben im Hochformat, z aus dem Bildschirm)
    const ux = -Math.cos(b) * Math.sin(g);
    const uy = Math.sin(b);
    // In Bildschirmkoordinaten drehen
    let sx: number;
    let sy: number;
    switch (((this.screenAngle() % 360) + 360) % 360) {
      case 90:
        sx = -uy;
        sy = ux;
        break;
      case 180:
        sx = -ux;
        sy = -uy;
        break;
      case 270:
        sx = uy;
        sy = -ux;
        break;
      default:
        sx = ux;
        sy = uy;
    }
    // Gerät aufrecht gehalten? Sonst letzten Wert halten
    if (Math.hypot(sx, sy) < 0.35) {
      this.valid = false;
      return;
    }
    this.valid = true;
    this.raw = (Math.atan2(sx, sy) * 180) / Math.PI;
  };

  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try {
      if (typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      }
    } catch {
      return false;
    }
    if (!this.listening) {
      window.addEventListener('deviceorientation', this.onOrient);
      this.listening = true;
    }
    this.enabled = true;
    return true;
  }

  disable(): void {
    this.enabled = false;
  }

  calibrate(): void {
    this.offset = this.raw;
  }

  /** Normierter Lenkwert -1..1 (positiv = links). */
  value(range: number, dt: number): number {
    if (!this.enabled) return 0;
    const target = this.valid ? this.raw - this.offset : 0;
    let d = target - this.angle;
    d -= Math.round(d / 360) * 360;
    this.angle += d * Math.min(1, dt * 18);
    const dead = 1.5;
    const a = Math.abs(this.angle);
    if (a < dead) return 0;
    const n = Math.min(1, (a - dead) / (range - dead));
    return Math.sign(this.angle) * n;
  }
}
