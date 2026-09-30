import { describe, expect, it } from 'vitest';
import { PHYS } from '../src/config/physics';
import { HULL } from '../src/physics/crash/hull';
import { BODY_WHEEL, BODY_WING_F, MAX_BODIES, S, SNAP_SIZE } from '../src/physics/layout';
import { wallChain } from '../src/world/provingGround';
import { makeMap, makeWorld, runWorld, wallImpact } from './crashHarness';

const kineticEnergy = (w: ReturnType<typeof makeWorld>, i = 0) => {
  const v = w.vehicles[i];
  return 0.5 * v.mass * (v.u * v.u + v.v * v.v);
};

describe('Hülle', () => {
  it('hat Kontaktpunkte in allen Zonen und ein geschlossenes Polygon', () => {
    expect(HULL.n).toBeGreaterThan(60);
    const zones = new Set(Array.from(HULL.zone));
    expect(zones.size).toBe(11);
    // Länge und Breite entsprechen dem Modell (ca. 5.05 m x 1.9 m)
    let minX = 1e9;
    let maxX = -1e9;
    let maxY = 0;
    for (let i = 0; i < HULL.polyN; i++) {
      minX = Math.min(minX, HULL.polyX[i]);
      maxX = Math.max(maxX, HULL.polyX[i]);
      maxY = Math.max(maxY, Math.abs(HULL.polyY[i]));
    }
    expect(maxX - minX).toBeGreaterThan(4.9);
    expect(maxX - minX).toBeLessThan(5.3);
    expect(maxY * 2).toBeGreaterThan(1.8);
    expect(maxY * 2).toBeLessThan(2.0);
    expect(HULL.contains(0, 0)).toBe(true);
    expect(HULL.contains(0, 1.5)).toBe(false);
    expect(HULL.contains(4, 0)).toBe(false);
    // Normalen zeigen nach außen
    for (let i = 0; i < HULL.n; i++) expect(Math.hypot(HULL.nx[i], HULL.ny[i])).toBeCloseTo(1, 6);
  });
});

describe('Frontaler Aufprall', () => {
  it('15 m/s gegen Beton: hohe aber überlebbare Verzögerung, Nase knautscht, Flügel ab', () => {
    const r = wallImpact(15);
    expect(r.peakG).toBeGreaterThan(15);
    expect(r.peakG).toBeLessThan(65);
    expect(r.stopDist).toBeGreaterThan(0.2);
    expect(r.stopDist).toBeLessThan(0.7);
    expect(r.nose).toBeGreaterThan(0.25);
    expect(r.wingF).toBe(1);
    expect(r.retired).toBe(0);
    expect(r.reboundSpeed).toBeLessThan(4);
    // der größte Teil der Bewegungsenergie wird plastisch aufgenommen
    expect(r.energyKJ / r.ke0KJ).toBeGreaterThan(0.5);
    expect(r.energyKJ).toBeLessThanOrEqual(r.ke0KJ);
  });

  it('Schwere steigt mit der Geschwindigkeit, extreme Einschläge führen zum Ausfall', () => {
    const a = wallImpact(10);
    const b = wallImpact(25);
    const c = wallImpact(45);
    expect(b.peakG).toBeGreaterThan(a.peakG);
    expect(c.peakG).toBeGreaterThan(b.peakG);
    expect(b.energyKJ).toBeGreaterThan(a.energyKJ * 3);
    expect(a.retired).toBe(0);
    expect(c.retired).toBe(1);
    expect(c.engine).toBeGreaterThan(0.6);
    expect(b.stopDist).toBeGreaterThan(a.stopDist);
  });

  it('Reifenbarriere nimmt Energie auf: weniger Verzögerung und kaum Schaden am Auto', () => {
    const concrete = wallImpact(25);
    const tire = wallImpact(25, { kind: 'tire' });
    expect(tire.peakG).toBeLessThan(concrete.peakG * 0.95);
    expect(tire.nose).toBeLessThan(concrete.nose * 0.4);
    expect(tire.engine).toBeLessThan(concrete.engine * 0.5);
    expect(tire.stopDist).toBeGreaterThan(concrete.stopDist);
    expect(tire.stopDist).toBeLessThan(3);
    expect(tire.retired).toBe(0);
    // Bei hoher Geschwindigkeit fängt die Barriere immer noch mehr ab als Beton
    expect(wallImpact(40, { kind: 'tire' }).peakG).toBeLessThan(wallImpact(40).peakG * 0.5);
  });

  it('Energiebilanz: plastische Arbeit übersteigt nie die Bewegungsenergie (Beton und Reifenbarriere)', () => {
    for (const kind of ['concrete', 'tire'] as const) {
      for (const v of [10, 25, 40, 60, 80]) {
        const r = wallImpact(v, { kind });
        expect(r.energyKJ).toBeLessThanOrEqual(r.ke0KJ * 1.05);
      }
    }
  });

  it('erzeugt niemals Energie: nach dem Aufprall nie mehr kinetische Energie als vorher', () => {
    for (const v of [8, 15, 30, 50, 70]) {
      for (const heading of [0, 0.4, 0.9]) {
        const walls = wallChain(100, -60, 100, 60, -1, 0, 'concrete');
        const w = makeWorld(makeMap(walls));
        w.reset(0, 100 - 3.9 * Math.cos(heading) - 0.4, -3.9 * Math.sin(heading), heading, v);
        const e0 = kineticEnergy(w) + 0.5 * w.vehicles[0].cfg.geometry.Iz * 0;
        runWorld(w, 1.5);
        expect(kineticEnergy(w)).toBeLessThan(e0 * 1.02);
      }
    }
  });
});

describe('Seitenaufprall und Streifschuss', () => {
  it('seitlicher Aufprall mit 15 m/s beschädigt Seitenkasten und Räder, nicht die Nase', () => {
    const walls = wallChain(-60, 8, 60, 8, 0, -1, 'concrete');
    const w = makeWorld(makeMap(walls));
    w.reset(0, 0, 8 - 0.95 - 0.5, 0, 0);
    const car = w.vehicles[0];
    car.u = 0;
    car.v = 15; // nach links zur Wand
    runWorld(w, 1.5);
    const cs = w.crash[0];
    expect(cs.peakG).toBeGreaterThan(8);
    expect(cs.sideL + cs.energy[2] + cs.energy[6]).toBeGreaterThan(0);
    expect(cs.nose).toBeLessThan(0.05);
    expect(Math.abs(car.v)).toBeLessThan(3);
  });

  it('flacher Einschlag (ca. 5°) bei 40 m/s: Auto schabt an der Wand entlang und behält Tempo', () => {
    const walls = wallChain(100, -200, 100, 200, -1, 0, 'concrete');
    const w = makeWorld(makeMap(walls));
    w.reset(0, 99 - 1.2, -60, Math.PI / 2, 0);
    const car = w.vehicles[0];
    car.u = 39.8;
    car.v = -3.5; // leicht zur Wand (rechts)
    car.input.throttle = 0;
    runWorld(w, 1.2);
    const cs = w.crash[0];
    expect(cs.peakG).toBeLessThan(60);
    expect(Math.hypot(car.u, car.v)).toBeGreaterThan(18);
  });
});

describe('Bauteilschäden und Trümmer', () => {
  it('Frontflügel reißt ab und wird zum eigenen Körper', () => {
    const walls = wallChain(100, -60, 100, 60, -1, 0, 'concrete');
    const w = makeWorld(makeMap(walls));
    w.reset(0, 100 - 3.6, 0, 0, 12);
    runWorld(w, 1.2);
    expect(w.crash[0].wingFront).toBe(1);
    const kinds: number[] = [];
    for (let i = 0; i < w.bodies.n; i++) if (w.bodies.active[i] && i >= w.bodies.coneCount) kinds.push(w.bodies.kind[i]);
    expect(kinds).toContain(BODY_WING_F);
  });

  it('Frontflügelverlust reduziert den Abtrieb an der Vorderachse', () => {
    const w = makeWorld(makeMap());
    w.reset(0, 0, 0, 0, 70);
    runWorld(w, 0.5);
    const full = w.vehicles[0].aero.downFront;
    w.crash[0].energy[0] = 1e5;
    w.crash[0].evaluate();
    // Wirkung auf das Fahrzeug
    w.step(PHYS.dt);
    runWorld(w, 0.3);
    expect(w.vehicles[0].aero.downFront).toBeLessThan(full * 0.5);
  });

  it('Rad reißt bei hoher seitlicher Last ab, Auto schleift auf drei Rädern und bleibt stabil', () => {
    const walls = wallChain(-80, 10, 80, 10, 0, -1, 'concrete');
    const w = makeWorld(makeMap(walls));
    w.reset(0, 0, 10 - 0.95 - 0.3, 0, 30);
    const car = w.vehicles[0];
    car.v = 13;
    car.input.throttle = 0.3;
    runWorld(w, 3);
    const cs = w.crash[0];
    const off = Array.from(cs.wheelOff).reduce((a, b) => a + b, 0);
    expect(off).toBeGreaterThanOrEqual(1);
    for (const x of [car.x, car.y, car.psi, car.u, car.v, car.r, car.z, car.phi, car.theta]) expect(Number.isFinite(x)).toBe(true);
    const wheelBodies = [];
    for (let i = w.bodies.coneCount; i < w.bodies.n; i++) if (w.bodies.active[i] && w.bodies.kind[i] === BODY_WHEEL) wheelBodies.push(i);
    expect(wheelBodies.length).toBeGreaterThanOrEqual(1);
  });

  it('Fahrzeug ohne Rad schleift: Funken, Bodenschaden, deutlich mehr Verzögerung', () => {
    const run = (off: boolean) => {
      const w = makeWorld(makeMap());
      w.reset(0, 0, 0, 0, 60);
      const c = w.crash[0];
      if (off) {
        c.wheelOff[1] = 1;
        w.vehicles[0].wheelOff[1] = 1;
      }
      let maxScrape = 0;
      runWorld(w, 3, () => {
        maxScrape = Math.max(maxScrape, w.vehicles[0].scrape[1]);
      });
      return { speed: w.vehicles[0].u, scrape: maxScrape, floor: w.crash[0].floor, yaw: Math.abs(w.vehicles[0].psi) };
    };
    const intact = run(false);
    const damaged = run(true);
    expect(damaged.scrape).toBeGreaterThan(0.2);
    expect(intact.scrape).toBeLessThan(0.05);
    expect(damaged.speed).toBeLessThan(intact.speed - 3);
    expect(damaged.floor).toBeGreaterThan(0);
  });

  it('Kegel werden weggeschleudert, das Auto bleibt heil', () => {
    const cones = Array.from({ length: 10 }, (_, i) => ({ x: 60 + i * 10, y: (i % 2) * 0.6 - 0.3 }));
    const w = makeWorld(makeMap([], cones));
    w.reset(0, 0, 0, 0, 70);
    runWorld(w, 3);
    let displaced = 0;
    for (let i = 0; i < 10; i++) displaced += w.bodies.displaced[i];
    expect(displaced).toBeGreaterThanOrEqual(8);
    expect(w.crash[0].wingFront).toBeLessThan(0.01);
    expect(w.crash[0].peakG).toBeLessThan(6);
    expect(w.vehicles[0].u).toBeGreaterThan(40);
  });

  it('Kies bremst stark, Gras ebenfalls, Asphalt am wenigsten', () => {
    const speedAfter = (kind: 'gravel' | 'grass' | 'asphalt') => {
      const map = makeMap();
      map.surfaces = [{ kind, x0: -500, y0: -500, x1: 3000, y1: 500 }];
      const w = makeWorld(map);
      w.reset(0, 0, 0, 0, 50);
      runWorld(w, 4);
      return w.vehicles[0].u;
    };
    const a = speedAfter('asphalt');
    const g = speedAfter('gravel');
    const gr = speedAfter('grass');
    expect(g).toBeLessThan(a - 5);
    expect(gr).toBeLessThan(a);
    expect(g).toBeLessThan(gr);
  });
});

describe('Auto gegen Auto', () => {
  it('Impulserhaltung beim Heckaufprall (gemessen am Kontaktende) und Schäden an beiden Autos', () => {
    const w = makeWorld(makeMap(), 2);
    w.reset(0, 0, 0, 0, 30);
    w.reset(1, 9, 0, 0, 0);
    for (const v of w.vehicles) v.gripScale.fill(0);
    const A = w.vehicles[0];
    const B = w.vehicles[1];
    const p0 = A.mass * 30;
    let contacted = false;
    let pEnd = NaN;
    let eEnd = NaN;
    for (let i = 0; i < 600 && Number.isNaN(pEnd); i++) {
      w.step(PHYS.dt);
      const f = Math.abs(A.extFx) + Math.abs(B.extFx);
      if (f > 5000) contacted = true;
      if (contacted && f < 1000) {
        pEnd = A.mass * A.u + B.mass * B.u;
        eEnd = kineticEnergy(w, 0) + kineticEnergy(w, 1);
      }
    }
    expect(contacted).toBe(true);
    // Rest-Abweichung durch Luftwiderstand und Unterbodenreibung während der wenigen Millisekunden
    expect(pEnd / p0).toBeGreaterThan(0.93);
    expect(pEnd / p0).toBeLessThan(1.02);
    expect(eEnd).toBeLessThan(0.5 * A.mass * 900);
    runWorld(w, 0.3);
    expect(B.u).toBeGreaterThan(5);
    // nach dem (weitgehend plastischen) Stoß bewegen sich beide mit ähnlichem Tempo weiter
    expect(Math.abs(A.u - B.u)).toBeLessThan(4);
    // Schäden: Nase/Flügel von A, Heckflügel von B
    expect(w.crash[0].wingFront).toBeGreaterThan(0.5);
    expect(w.crash[1].wingRear).toBeGreaterThan(0.5);
    expect(w.crash[0].peakG).toBeGreaterThan(8);
    expect(w.crash[1].peakG).toBeGreaterThan(8);
  });

  it('Kraft und Gegenkraft sind symmetrisch: gleiche Spitzenverzögerung bei gleichen Massen', () => {
    const w = makeWorld(makeMap(), 2);
    w.reset(0, 0, 0, 0, 20);
    w.reset(1, 8.5, 0, 0, 0);
    for (const v of w.vehicles) v.gripScale.fill(0);
    runWorld(w, 0.5);
    const a = w.crash[0].peakG;
    const b = w.crash[1].peakG;
    expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.25);
  });

  it('Autos ohne Berührung beeinflussen sich nicht', () => {
    const w = makeWorld(makeMap(), 2);
    w.reset(0, 0, 0, 0, 30);
    w.reset(1, 0, 6, 0, 30);
    runWorld(w, 1);
    expect(w.crash[0].peakG).toBe(0);
    expect(w.crash[1].peakG).toBe(0);
  });
});

describe('Schadensfolgen und Reparatur', () => {
  it('ausgefallenes Auto hat keinen Antrieb; Reparatur stellt alles wieder her', () => {
    const w = makeWorld(makeMap(wallChain(100, -60, 100, 60, -1, 0, 'concrete')));
    w.reset(0, 100 - 3.6, 0, 0, 50);
    runWorld(w, 1.5);
    expect(w.crash[0].retired).toBe(1);
    const car = w.vehicles[0];
    expect(car.powerScale).toBe(0);
    w.repair(0);
    expect(w.crash[0].retired).toBe(0);
    expect(w.crash[0].totalEnergy).toBe(0);
    expect(car.powerScale).toBe(1);
    expect(car.aeroDamageF).toBe(1);
  });

  it('Motorschaden reduziert die Leistung stufenlos', () => {
    const w = makeWorld(makeMap());
    w.reset(0, 0, 0, 0, 0);
    w.crash[0].energy[4] = 20e3; // Seitenkasten/Kühler
    w.crash[0].evaluate();
    w.step(PHYS.dt);
    expect(w.vehicles[0].powerScale).toBeLessThan(0.95);
    expect(w.vehicles[0].powerScale).toBeGreaterThan(0.3);
  });
});

describe('Robustheit', () => {
  it('ist deterministisch', () => {
    const a = wallImpact(33, { heading: 0.3 });
    const b = wallImpact(33, { heading: 0.3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('bleibt bei zufälligen Crashs endlich und stabil (Fuzz)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 14; k++) {
      const walls = [...wallChain(60, -80, 60, 80, -1, 0, rnd() > 0.5 ? 'concrete' : 'tire'), ...wallChain(-40, 12, 120, 12, 0, -1, 'armco')];
      const w = makeWorld(makeMap(walls, [{ x: 30, y: 0 }, { x: 35, y: 1 }]), 2);
      w.reset(0, 20 * rnd(), (rnd() - 0.5) * 8, (rnd() - 0.5) * 1.4, 10 + rnd() * 70);
      w.reset(1, 20 + 20 * rnd(), (rnd() - 0.5) * 4, (rnd() - 0.5) * 3, rnd() * 40);
      for (const v of w.vehicles) {
        v.input.throttle = rnd();
        v.input.steer = rnd() * 2 - 1;
      }
      runWorld(w, 3);
      for (const v of w.vehicles) {
        for (const x of [v.x, v.y, v.psi, v.u, v.v, v.r, v.z, v.phi, v.theta, ...v.omega, ...v.fz]) expect(Number.isFinite(x)).toBe(true);
        expect(Math.hypot(v.u, v.v)).toBeLessThan(150);
      }
      const buf = new Float64Array(SNAP_SIZE);
      w.writeSnapshot(buf, 0);
      for (const x of buf) expect(Number.isFinite(x)).toBe(true);
    }
  });

  it('Snapshot enthält Schäden, Dellen und Körper', () => {
    const cones = [{ x: 20, y: 0 }];
    const walls = wallChain(100, -60, 100, 60, -1, 0, 'concrete');
    const w = makeWorld(makeMap(walls, cones));
    w.reset(0, 100 - 3.6, 0, 0, 20);
    runWorld(w, 1);
    const buf = new Float64Array(SNAP_SIZE);
    w.writeSnapshot(buf);
    expect(buf[S.dmgWingF]).toBe(1);
    expect(buf[S.peakG]).toBeGreaterThan(10);
    expect(buf[S.impactSpeed]).toBeGreaterThan(50);
    expect(buf[S.nBodies]).toBeGreaterThan(0);
    expect(buf[S.nBodies]).toBeLessThanOrEqual(MAX_BODIES);
    // mindestens eine Delle mit Tiefe
    let deepest = 0;
    for (let i = 0; i < 8; i++) deepest = Math.max(deepest, buf[S.dents + i * 8 + 6]);
    expect(deepest).toBeGreaterThan(0.05);
  });

  it('Physikschritt mit Welt bleibt schnell (auch im Crash)', () => {
    const walls = wallChain(100, -60, 100, 60, -1, 0, 'concrete');
    const w = makeWorld(makeMap(walls, Array.from({ length: 140 }, (_, i) => ({ x: 20 + (i % 10) * 3, y: Math.floor(i / 10) * 3 - 20 }))));
    w.reset(0, 100 - 3.6, 0, 0, 30);
    const t0 = performance.now();
    runWorld(w, 4);
    const per = (performance.now() - t0) / (4 * PHYS.hz);
    expect(per).toBeLessThan(0.6); // ms pro Schritt (Budget bei 500 Hz: 2 ms)
  });
});
