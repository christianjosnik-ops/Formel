/**
 * Haptik: Vibration auf dem Handy (navigator.vibrate) und Rumble am Gamepad.
 * Kerbs: kurze Impulse im Rhythmus der Geschwindigkeit, blockierende/durchdrehende Räder: Dauerbrummen am Gamepad,
 * Schleifen des Unterbodens und Aufprall: kräftige Stöße.
 */
export class Haptics {
  enabled = true;
  private nextPulse = 0;
  private lastPad = 0;

  private pad(strong: number, weak: number, ms: number): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      const act = (p as unknown as { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } } | null)?.vibrationActuator;
      if (!p || !p.connected || !act?.playEffect) continue;
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => undefined);
    }
  }

  private buzz(pattern: number | number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* nicht unterstützt */
    }
  }

  /** Jeden Frame: kerb = Räder auf dem Kerb, slip = größter Schlupf (1 = Grenze), scrape = Schleifen 0..1, speed in km/h. */
  update(now: number, speedKmh: number, kerb: number, slip: number, scrape: number): void {
    if (!this.enabled || speedKmh < 12) return;
    if (kerb > 0 && now >= this.nextPulse) {
      this.nextPulse = now + Math.max(0.05, 0.16 - speedKmh / 3000);
      this.buzz(12 + kerb * 6);
      this.pad(0.15, 0.55, 70);
    }
    if (now - this.lastPad > 0.12) {
      if (slip > 1.15) {
        this.lastPad = now;
        this.pad(0.1, Math.min(0.7, (slip - 1) * 0.5), 130);
      } else if (scrape > 0.15) {
        this.lastPad = now;
        this.pad(0.5 * scrape, 0.2, 100);
        this.buzz(18);
      }
    }
  }

  /** Aufprall: level 1..4. */
  crash(level: number): void {
    if (!this.enabled) return;
    if (level >= 3) {
      this.buzz([60, 40, 120]);
      this.pad(1, 0.9, 350);
    } else {
      this.buzz(40);
      this.pad(0.6, 0.5, 160);
    }
  }
}
