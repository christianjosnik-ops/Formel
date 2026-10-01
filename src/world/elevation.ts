/**
 * Höhenprofile der Strecken (Näherung nach bekannten Höhenunterschieden), periodisch über die Runde.
 * Stützpunkte: [Kilometer ab Startlinie, Höhe in m]. Zwischen den Punkten wird kubisch interpoliert.
 * Die Physik bekommt daraus die Hangabtriebskraft, die Darstellung die Geländehöhe unter der Strecke.
 */
const PROFILES: Record<string, Array<[number, number]>> = {
  // Monza: fast eben, leichte Wellen (Lesmo, Ascari), Gesamthub ca. 8 m
  monza: [[0, 0], [0.5, 0.8], [1.1, 0], [1.6, 1.5], [2.3, 3.6], [2.9, 4.4], [3.4, 2.4], [4.0, 0.8], [4.6, 2.6], [5.2, 1.2], [5.79, 0]],
  // Spa: La Source bergab, Eau Rouge/Raidillon steil bergauf, Kemmel-Gerade, Les Combes, Pouhon-Senke; ca. 90 m Hub
  spa: [[0, 0], [0.25, -5], [0.55, -16], [0.78, -24], [0.95, -14], [1.15, 4], [1.6, 13], [2.2, 24], [2.75, 30], [3.15, 16], [3.7, 2], [4.3, -10], [4.75, -6], [5.25, 4], [5.75, -2], [6.2, -14], [6.6, -8], [7.0, 0]],
  // Silverstone: flaches Land, sanfte Wellen (Maggotts/Becketts), Gesamthub ca. 7 m
  silverstone: [[0, 0], [0.6, 0.6], [1.3, -0.8], [2.0, 0.4], [2.7, 2.2], [3.3, 3.0], [3.9, 1.2], [4.6, 2.0], [5.3, 0.8], [5.89, 0]],
};

/** Höhe je Stützstelle (n Werte über die Länge `length`), periodisch geglättet. */
export function buildElevation(id: string, n: number, length: number): Float64Array {
  const pts = PROFILES[id];
  const out = new Float64Array(n);
  if (!pts || pts.length < 3) return out;
  const m = pts.length - 1; // letzter Punkt = erster (periodisch)
  const at = (k: number) => pts[((k % m) + m) % m];
  for (let i = 0; i < n; i++) {
    const km = ((i / n) * length) / 1000;
    const scale = pts[m][0];
    const x = (km / (length / 1000)) * scale;
    let k = 0;
    while (k < m - 1 && pts[k + 1][0] <= x) k++;
    const p0 = at(k - 1);
    const p1 = at(k);
    const p2 = at(k + 1);
    const p3 = at(k + 2);
    const span = Math.max(1e-6, p2[0] - p1[0]);
    const t = Math.min(1, Math.max(0, (x - p1[0]) / span));
    // Catmull-Rom auf den Höhen (nicht-äquidistant, Tangenten aus Nachbarn)
    const t2 = t * t;
    const t3 = t2 * t;
    const m1 = 0.5 * (p2[1] - p0[1]);
    const m2 = 0.5 * (p3[1] - p1[1]);
    out[i] = (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  }
  // zusätzlich glätten, damit die Steigung stetig bleibt
  const half = Math.max(2, Math.round(40 / (length / n)));
  const tmp = new Float64Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -half; k <= half; k++) s += out[(i + k + n * 2) % n];
      tmp[i] = s / (2 * half + 1);
    }
    out.set(tmp);
  }
  return out;
}
