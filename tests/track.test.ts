import { describe, expect, it } from 'vitest';
import { createMap, MAP_LIST, type MapId } from '../src/world/maps';

describe('Strecken aus Streckendaten', () => {
  for (const { id } of MAP_LIST.filter((m) => m.id !== 'proving')) {
    it(`${id}: Länge, Schleife, Breiten, Startposition`, () => {
      const m = createMap(id as MapId);
      const t = m.track!;
      expect(t.length).toBeGreaterThan(4500);
      expect(t.length).toBeLessThan(7600);
      // geschlossene Schleife: Abstand letzter zu erster Punkt ~ds
      const gap = Math.hypot(t.x[0] - t.x[t.n - 1], t.y[0] - t.y[t.n - 1]);
      expect(gap).toBeLessThan(t.ds * 1.6);
      for (let i = 0; i < t.n; i++) {
        expect(t.wl[i] + t.wr[i]).toBeGreaterThan(6);
        expect(t.wl[i] + t.wr[i]).toBeLessThan(21);
      }
      // gleichmäßige Abtastung
      for (let i = 1; i < t.n; i++) {
        const d = Math.hypot(t.x[i] - t.x[i - 1], t.y[i] - t.y[i - 1]);
        expect(d).toBeGreaterThan(t.ds * 0.6);
        expect(d).toBeLessThan(t.ds * 1.4);
      }
      // Start liegt auf Asphalt, in Fahrtrichtung
      expect(t.surfaceAt(m.start.x, m.start.y)).toBe('asphalt');
      const p = t.progress(m.start.x, m.start.y);
      expect(p.onTrack).toBe(true);
      expect(Math.abs(p.lat)).toBeLessThan(0.5);
    });

    it(`${id}: Untergrundkarte passt zu Breiten, Kerbs, Kies und Wänden`, () => {
      const t = createMap(id as MapId).track!;
      let gravel = 0;
      let kerb = 0;
      for (let i = 0; i < t.n; i += 4) {
        const nx = t.nx(i);
        const ny = t.ny(i);
        // Mittellinie und Innenbereich sind Asphalt
        expect(t.surfaceAt(t.x[i], t.y[i])).toBe('asphalt');
        expect(t.surfaceAt(t.x[i] + nx * (t.wl[i] - 1.5), t.y[i] + ny * (t.wl[i] - 1.5))).toBe('asphalt');
        const out = t.surfaceAt(t.x[i] + nx * (t.wl[i] + t.kerbL[i] + 2), t.y[i] + ny * (t.wl[i] + t.kerbL[i] + 2));
        if (out === 'gravel') gravel++;
        if (t.kerbL[i] > 0.6 && t.surfaceAt(t.x[i] + nx * (t.wl[i] + 0.4), t.y[i] + ny * (t.wl[i] + 0.4)) === 'kerb') kerb++;
      }
      expect(gravel).toBeGreaterThan(10);
      expect(kerb).toBeGreaterThan(10);
      // Wände: liegen außerhalb der Strecke, Normalen zeigen zur Strecke
      expect(t.walls.length).toBeGreaterThan(300);
      for (const w of t.walls) {
        const mx = (w.ax + w.bx) / 2;
        const my = (w.ay + w.by) / 2;
        const i = t.nearest(mx, my);
        expect(i).toBeGreaterThanOrEqual(0);
        const lat = t.lateral(i, mx, my);
        const edge = lat >= 0 ? t.wl[i] : t.wr[i];
        expect(Math.abs(lat)).toBeGreaterThan(edge + 2.5);
        if (t.sev[i] < 0.4) {
          const toTrack = -Math.sign(lat);
          expect((w.nx * t.nx(i) + w.ny * t.ny(i)) * toTrack).toBeGreaterThan(0.3);
        }
      }
    });
  }

  it('Wände liegen nirgends im Asphalt eines anderen Streckenabschnitts', () => {
    for (const id of ['monza', 'spa', 'silverstone'] as const) {
      const t = createMap(id).track!;
      for (const w of t.walls) {
        for (const f of [0, 0.5, 1]) {
          const px = w.ax + (w.bx - w.ax) * f;
          const py = w.ay + (w.by - w.ay) * f;
          const i = t.nearest(px, py);
          const lat = t.lateral(i, px, py);
          expect(Math.abs(lat)).toBeGreaterThan((lat >= 0 ? t.wl[i] : t.wr[i]) + 1);
        }
      }
    }
  });

  it('Monza hat die bekannte Charakteristik: lange Geraden, enge Schikanen', () => {
    const t = createMap('monza').track!;
    // längster Abschnitt mit kleiner Krümmung (Start/Ziel-Gerade und Parabolica-Ausgang) > 900 m
    let run = 0;
    let best = 0;
    for (let k = 0; k < t.n * 2; k++) {
      const i = k % t.n;
      if (Math.abs(t.curv[i]) < 0.002) {
        run += t.ds;
        best = Math.max(best, run);
      } else run = 0;
    }
    expect(best).toBeGreaterThan(700);
    let maxCurv = 0;
    for (let i = 0; i < t.n; i++) maxCurv = Math.max(maxCurv, Math.abs(t.curv[i]));
    expect(1 / maxCurv).toBeLessThan(45); // engster Radius: Schikane/Lesmo
  });
});
