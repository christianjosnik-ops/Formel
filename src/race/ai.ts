import type { Vehicle } from '../physics/vehicle';
import { brakeLimit, type RacingLine } from './line';

export interface AIParams {
  /** Grundtempo als Faktor der Profilgeschwindigkeit (Fahrer-Pace, KI-Stärke). */
  pace: number;
  /** 0..1: hoch = kaum Fehler. */
  consistency: number;
  /** 0..1: Bereitschaft zum Überholen. */
  racecraft: number;
  seed: number;
}

/** Anderes Auto aus Sicht der KI. */
export interface Rival {
  /** Kennung (Fahrzeugindex). */
  id: number;
  /** Abstand entlang der Strecke [m], >0 = vor mir. */
  gap: number;
  /** Querposition zur Mittellinie (links +). */
  lat: number;
  speed: number;
  /** Liegengebliebenes/verunfalltes Auto (Hindernis). */
  wreck: boolean;
}

export type AIMode = 'hold' | 'race' | 'cooldown';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHEELBASE = 3.4;

/**
 * KI-Fahrer: fährt die Ideallinie (Pure Pursuit), regelt die Geschwindigkeit auf das Profil, folgt und überholt
 * andere Autos, macht je nach Konstanz kleine Fehler. Nutzt dieselbe Physik wie der Spieler; Eingaben gehen
 * ausschließlich über die Fahrzeug-Eingabe (Lenkung, Gas, Bremse, Aero).
 */
export class AIDriver {
  idx = 0;
  lat = 0; // aktueller Querversatz der Soll-Linie (relativ zur Ideallinie)
  private latTarget = 0;
  private side = 0; // laufendes Überholmanöver: -1 rechts, +1 links
  /** Aktives Manöver: Angriff (Überholen) oder Verteidigung der Innenlinie. */
  private man: 'none' | 'attack' | 'defend' = 'none';
  private manTimer = 0;
  private manTarget = -1; // Fahrzeug-ID des Angriffsziels
  private defendCool = 0;
  private attackCool = 0;
  /** Gerade laufende Ausweichbewegung (Hindernis/Unfall voraus). */
  evading = false;
  private attackBoost = 1;
  /** Beschreibung der aktuellen Situation für Debug/Tests. */
  situation = 'free';
  private err = 0;
  private mistake = 0;
  private stuck = 0;
  private readonly rnd: () => number;
  private readonly pt = { x: 0, y: 0 };
  /** Vom Regler berechnete Sollgeschwindigkeit (für Tests/Anzeige). */
  targetSpeed = 0;
  /** Zusätzlicher Querversatz (Startaufstellung: Spur halten, später auf 0 abbauen). */
  laneBias = 0;

  constructor(
    private readonly line: RacingLine,
    readonly params: AIParams,
  ) {
    this.rnd = rng(params.seed);
  }

  /** Streckenindex des Fahrzeugs bestimmen (mit Suchfenster um den letzten Index). */
  locate(x: number, y: number): number {
    const t = this.line.track;
    const n = t.n;
    let best = this.idx;
    let bd = (x - t.x[best]) ** 2 + (y - t.y[best]) ** 2;
    if (bd > 30 * 30) {
      const j = t.nearest(x, y);
      if (j >= 0) {
        best = j;
        bd = (x - t.x[j]) ** 2 + (y - t.y[j]) ** 2;
      }
    }
    for (let k = -4; k <= 14; k++) {
      const j = (this.idx + k + n) % n;
      const d = (x - t.x[j]) ** 2 + (y - t.y[j]) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    this.idx = best;
    return best;
  }

  reset(idx: number): void {
    this.idx = idx;
    this.lat = 0;
    this.latTarget = 0;
    this.side = 0;
    this.mistake = 0;
    this.err = 0;
    this.stuck = 0;
    this.laneBias = 0;
    this.man = 'none';
    this.manTimer = 0;
    this.defendCool = 0;
    this.evading = false;
  }

  update(dt: number, v: Vehicle, mode: AIMode, rivals: Rival[], level = 1): void {
    const line = this.line;
    const t = line.track;
    const n = line.n;
    const inp = v.input;
    inp.tc = 1;
    inp.abs = 1;
    inp.steerAssist = 0;

    if (mode === 'hold') {
      inp.throttle = 0;
      inp.brake = 1;
      inp.steer = 0;
      inp.aeroX = 0;
      return;
    }
    const speed = Math.hypot(v.u, v.v);
    const idx = this.locate(v.x, v.y);
    // Reifengrip (Temperatur, Verschleiß) bestimmt das fahrbare Tempo: schlechtere Reifen, vorsichtigere Fahrweise
    const gAvg = 0.25 * (v.tyreGrip[0] + v.tyreGrip[1] + v.tyreGrip[2] + v.tyreGrip[3]);
    level *= Math.pow(Math.min(1.03, gAvg / 0.985), 0.75);

    // ---- Fehler-Modell: langsames Rauschen des Tempos, seltene Fehlversuche ----
    const sigma = (1 - this.params.consistency) * 0.03;
    this.err += (-this.err / 4 + sigma * 3 * (this.rnd() - 0.5)) * dt * 2;
    if (this.mistake > 0) this.mistake -= dt;
    else if (this.rnd() < (1 - this.params.consistency) * 0.004 * dt * 60 * 0.12 && speed > 25) this.mistake = 1.4;

    // ---- Rennsituation: Hindernisse, Angriff, Verteidigung, Nebeneinander ----
    const myLat = t.lateral(idx, v.x, v.y);
    const pathLat = Math.min(Math.max(line.offset[idx] + this.lat, line.lo[idx]), line.hi[idx]);
    const edgeL = t.wl[idx] - 1.3;
    const edgeR = -(t.wr[idx] - 1.3);
    const clampEdge = (x: number) => Math.min(Math.max(x, edgeR), edgeL);
    const prof = line.speed[(idx + Math.round((speed * 0.3) / t.ds)) % n] * this.params.pace * level;
    let vCap = 1e9;
    let tgt = line.offset[idx] + this.laneBias; // gewünschte absolute Querposition (Mittellinien-Koordinate), Standard: Ideallinie (+ Startspur)
    const gridPhase = Math.abs(this.laneBias) > 0.8;
    this.situation = 'free';
    this.evading = false;
    if (this.defendCool > 0) this.defendCool -= dt;
    if (this.attackCool > 0) this.attackCool -= dt;

    // nächste Kurve voraus: Abstand zum Bremspunkt und Innenseite
    let cornerDist = 1e9;
    let insideSign = 0;
    {
      const lim = Math.min(n - 1, Math.round(320 / t.ds));
      const vNow = Math.max(speed, 30);
      for (let k = 6; k < lim; k++) {
        const j = (idx + k) % n;
        if (line.speed[j] < vNow * 0.82 && Math.abs(line.curv[j]) > 0.004) {
          cornerDist = k * t.ds;
          insideSign = Math.sign(line.curv[j]);
          break;
        }
      }
    }

    // Kurvenfahrt: dort keine seitlichen Manöver (nur auf Geraden und in der Bremszone)
    let inCorner = false;
    {
      const k1 = Math.max(2, Math.round(30 / t.ds));
      for (let k = 0; k <= k1; k += 3) if (Math.abs(line.curv[(idx + k) % n]) > 0.0045) inCorner = true;
    }

    // Rivalen sortieren in Gruppen
    let front: Rival | null = null; // nächstes lebendes Auto vor mir im Fahrstreifen
    let rear: Rival | null = null; // nächstes Auto hinter mir im Fahrstreifen
    let wreck: Rival | null = null; // nächstes Hindernis voraus
    const alongside: Rival[] = [];
    for (const r of rivals) {
      const dLat = Math.min(Math.abs(r.lat - pathLat), Math.abs(r.lat - myLat));
      if (r.wreck) {
        if (r.gap > -8 && r.gap < 170 && dLat < 3.4 && (!wreck || r.gap < wreck.gap)) wreck = r;
        continue;
      }
      if (Math.abs(r.gap) < 7.5 && Math.abs(r.lat - myLat) < 4.2) alongside.push(r);
      if (r.gap > 0 && r.gap < 110 && dLat < 3.0 && (!front || r.gap < front.gap)) front = r;
      if (r.gap < -2 && r.gap > -60 && dLat < 3.2 && (!rear || r.gap > rear.gap)) rear = r;
    }

    // 1) Unfall/Hindernis voraus: früh bremsen und die freie Seite wählen
    if (wreck) {
      const roomL = edgeL - wreck.lat;
      const roomR = wreck.lat - edgeR;
      const sd = Math.abs(wreck.lat - pathLat) < 0.3 ? (roomL >= roomR ? 1 : -1) : Math.sign(pathLat - wreck.lat);
      if (Math.max(roomL, roomR) > 2.6) tgt = clampEdge(wreck.lat + sd * 3.1);
      else vCap = Math.min(vCap, 6);
      const room = Math.max(0, wreck.gap - 16);
      let vw = Math.sqrt(2 * 0.42 * brakeLimit(speed) * room + 36);
      // seitlich schon vorbei: mit Schrittgeschwindigkeit weiterfahren statt anzuhalten
      if (Math.abs(myLat - wreck.lat) > 2.6 && Math.sign(myLat - wreck.lat) === Math.sign(tgt - wreck.lat)) vw = Math.max(vw, 18);
      vCap = Math.min(vCap, vw);
      this.evading = true;
      this.situation = 'evade';
      this.man = 'none';
    }

    // 2) Angriff: Auto vor mir im Fahrstreifen, schneller oder im Windschatten
    if (!this.evading && !gridPhase) {
      if (this.man === 'attack') {
        this.manTimer += dt;
        const tr = rivals.find((r) => r.id === this.manTarget && !r.wreck);
        if (!tr || tr.gap < -9 || tr.gap > 85 || this.manTimer > 7) {
          this.man = 'none';
          this.attackCool = 5;
          this.defendCool = Math.max(this.defendCool, 2);
        } else {
          // Seite und Querabstand zum Ziel halten; vor der Kurve Innenseite bevorzugen
          const want = clampEdge(tr.lat + this.side * 2.9);
          // Innenseite verloren (Kante erreicht): Manöver abbrechen
          if (Math.abs(want - (tr.lat + this.side * 2.9)) > 1.4 && tr.gap > 6) {
            this.man = 'none';
          } else {
            // in der Kurve den Querversatz nur halten, wenn schon nebeneinander (sonst würde die Ideallinie ins Nachbarauto führen)
            if (!inCorner || Math.abs(tr.gap) < 16) tgt = want;
            this.situation = 'attack';
            // spät bremsen, wenn ich schon überlappe und innen liege
            if (Math.abs(tr.gap) < 8 && this.side * insideSign > 0) this.attackBoost = 1.015;
          }
        }
      } else if (front && level > 0.9 && this.attackCool <= 0 && this.params.racecraft > 0.15 && front.gap < 30 && (cornerDist > 60 || Math.abs(myLat - front.lat) > 2.4)) {
        const slip = front.gap < 24 && front.speed > 40 && cornerDist > 90 && cornerDist < 330;
        const faster = (prof > front.speed + 1.2 || front.speed < 14) && speed - front.speed < 9;
        if ((faster || slip) && this.rnd() < dt * (0.7 + 4 * this.params.racecraft)) {
          const mid = 0.5 * (edgeL + edgeR);
          let sd = cornerDist < 300 && insideSign !== 0 ? insideSign : front.lat < mid ? 1 : -1;
          const fits = (x: number) => Math.abs(clampEdge(front!.lat + x * 2.9) - (front!.lat + x * 2.9)) < 1.0;
          if (!fits(sd)) sd = -sd;
          if (fits(sd)) {
            this.side = sd;
            this.man = 'attack';
            this.manTimer = 0;
            this.manTarget = front.id;
          }
        }
      }
    }
    if (this.man !== 'attack') this.attackBoost = 1;

    // 3) Verteidigung: Verfolger dicht hinter mir, vor der nächsten Bremszone die Innenlinie decken (nur ein Schwenk)
    if (!this.evading && !gridPhase && this.man !== 'attack') {
      if (this.man === 'defend') {
        this.manTimer += dt;
        if (!rear || cornerDist < 35 || speed < 30 || this.manTimer > 6) {
          this.man = 'none';
          this.defendCool = 9;
        } else {
          const inEdge = insideSign * (insideSign > 0 ? edgeL : -edgeR) * 0.92;
          if (!inCorner) tgt = clampEdge(insideSign * Math.abs(inEdge));
          this.situation = 'defend';
        }
      } else if (rear && this.defendCool <= 0 && this.params.racecraft > 0.25 && speed > 45 && cornerDist > 70 && cornerDist < 320 && rear.gap > -30 && rear.speed > speed - 2 && this.rnd() < dt * (0.4 + 2.5 * this.params.racecraft)) {
        // Verfolger auf der Innenseite oder auf der Linie: Innenseite zumachen
        this.man = 'defend';
        this.manTimer = 0;
      }
    }

    // 4) Nebeneinander: Platz lassen, Außenmann gibt in der Kurve nach
    for (const r of alongside) {
      const d = r.lat - tgt;
      if (Math.abs(d) < 2.7) {
        const away = r.lat - Math.sign(d || (r.lat >= myLat ? 1 : -1)) * 2.7;
        tgt = clampEdge(away);
        if (clampEdge(away) !== away) {
          // kein Platz: der Hintere nimmt Tempo zurück
          if (r.gap > 0) vCap = Math.min(vCap, Math.max(10, r.speed * 0.97));
        }
      }
      // Überlappung in der Kurve: liegt der Rivale innen und ist mit der Nase vorn, gebe ich nach
      if (insideSign !== 0 && cornerDist < 160 && r.gap > 0.5 && (r.lat - myLat) * insideSign > 0.8) {
        vCap = Math.min(vCap, Math.max(12, r.speed * 0.98));
        this.situation = 'yield';
      }
    }

    // 5) Abstandsregelung zum Vordermann (kein Auffahren, außer ich überhole seitlich versetzt)
    if (front && !this.evading) {
      // Abstand halten, solange ich tatsächlich hinter ihm im Streifen bin (auch wenn ich schon ausscheren will)
      const latOff = Math.min(Math.abs(myLat - front.lat), this.man === 'attack' ? 99 : Math.abs(tgt - front.lat));
      if (latOff < 2.4) {
        const attacking = this.man === 'attack';
        const room = Math.max(0, front.gap - (attacking ? 6.2 : 9.5) - (attacking ? 0.05 : 0.1) * speed);
        const aF = 0.5 * brakeLimit(speed);
        const aL = 0.8 * brakeLimit(front.speed);
        vCap = Math.min(vCap, Math.sqrt(2 * aF * room + (aF / aL) * front.speed * front.speed));
        if (room < 3) vCap = Math.min(vCap, front.speed * 0.92);
        if (this.situation === 'free') this.situation = 'follow';
      }
    }

    // 6) Kollisionsvermeidung unabhängig von der Absicht: kein Auto in meiner Fahrspur darf in unter ~1,2 s erreicht werden
    for (const r of rivals) {
      if (r.wreck || r.gap <= 0 || r.gap > 60) continue;
      if (Math.min(Math.abs(myLat - r.lat), Math.abs(tgt - r.lat)) < 2.3 && speed > r.speed + 1) {
        vCap = Math.min(vCap, r.speed + Math.max(0, r.gap - 5.5) / 1.2);
      }
    }

    if (this.man === 'none' && !this.evading) this.side = 0;
    const evadeRate = this.evading ? 3.4 : this.man !== 'none' ? 2.2 : 1.7;
    const goalAbs = tgt;
    this.latTarget = clampEdge(goalAbs) - line.offset[idx] - this.laneBias;
    const rate = evadeRate * dt;
    const goal = this.latTarget + this.laneBias;
    this.lat += Math.min(rate, Math.max(-rate, goal - this.lat));

    // ---- Lenkung: Pure Pursuit ----
    const Ld = Math.max(7, 4.5 + 0.3 * speed);
    const steps = Math.max(1, Math.round(Ld / t.ds));
    line.pointAt(idx + steps, this.lat, this.pt);
    const dx = this.pt.x - v.x;
    const dy = this.pt.y - v.y;
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const bx = c * dx + s * dy;
    const by = -s * dx + c * dy;
    const alpha = Math.atan2(by, Math.max(bx, 0.5));
    let delta = Math.atan2(2 * WHEELBASE * Math.sin(alpha), Ld);
    // Dämpfung: Gierrate gegenüber der vom Soll-Radius geforderten begrenzen
    const yawDes = (speed * Math.sin(alpha) * 2) / Ld;
    delta += 0.18 * (yawDes - v.r) * (WHEELBASE / Math.max(speed, 6));
    const maxS = v.maxSteerAt(speed, 0);
    inp.steer = Math.max(-1, Math.min(1, delta / maxS));

    // ---- Geschwindigkeit ----
    const look = Math.max(1, Math.round((speed * 0.2) / t.ds));
    let vt = line.speed[(idx + look) % n] * this.params.pace * level * (1 + this.err) * this.attackBoost;
    if (this.mistake > 0) vt *= 1.07;
    // Bahnfehler: bei großer Abweichung zurücknehmen
    const latErr = Math.abs(by);
    vt *= 1 - Math.min(0.5, Math.max(0, latErr - 1.6) * 0.09);
    if (Math.abs(alpha) > 0.7) vt = Math.min(vt, 18);
    if (mode === 'cooldown') vt = Math.min(vt * 0.55, 42);
    vt = Math.min(vt, vCap);
    this.targetSpeed = vt;
    const e = vt - speed;
    // Bremsvorausschau: benötigte Verzögerung bis zum nächsten langsameren Profilpunkt
    let aReq = 0;
    {
      let dist = 0;
      const scale = this.params.pace * level * (1 + this.err) * (this.mistake > 0 ? 1.07 : 1) * this.attackBoost;
      const horizon = Math.min(80, Math.ceil((speed * speed) / (2 * 25) / t.ds) + 12);
      for (let k = 0; k < horizon; k++) {
        const j = (idx + k) % n;
        dist += line.seg[j];
        const vp = line.speed[(j + 1) % n] * scale;
        if (speed > vp) {
          const a = (speed * speed - vp * vp) / (2 * Math.max(dist - 5, 2));
          if (a > aReq) aReq = a;
        }
      }
    }
    const avail = (brakeLimit(speed) / 0.92) * 0.96;
    const ff = aReq / avail;
    let brake = 0;
    // erst am Bremspunkt des Profils voll bremsen (spät und hart), nicht früh und sanft
    if (ff > 0.86) brake = Math.min(1, ff * 1.04);
    if (e < -1.2) brake = Math.max(brake, Math.min(1, 0.06 + -e * 0.055));
    if (brake > 0) {
      inp.throttle = 0;
      inp.brake = brake;
    } else if (e >= 0) {
      inp.throttle = Math.min(1, 0.3 + e * 0.35);
      inp.brake = 0;
    } else {
      inp.throttle = 0;
      inp.brake = 0;
    }
    // Aktive Aero: X-Modus, wenn auf den nächsten 250 m nichts Enges kommt
    let straight = speed > 40;
    for (let k = 1; k <= 45 && straight; k += 5) if (line.speed[(idx + k) % n] < 66) straight = false;
    inp.aeroX = straight && inp.brake === 0 ? 1 : 0;

    // ---- Steckenbleiben erkennen ----
    if (speed < 1.5 && mode === 'race') this.stuck += dt;
    else this.stuck = 0;
  }

  /**
   * Fahren nach festem Querversatz und Zieltempo (Boxengasse). lat = Querabstand zur Mittellinie (links +).
   * Die Steuerung ist dieselbe Pure-Pursuit-Regelung wie auf der Rennlinie.
   */
  driveTo(dt: number, v: Vehicle, tgtLat: number, tgtSpeed: number): void {
    const t = this.line.track;
    const n = t.n;
    const inp = v.input;
    inp.tc = 1;
    inp.abs = 1;
    inp.steerAssist = 0;
    inp.aeroX = 0;
    const speed = Math.hypot(v.u, v.v);
    const idx = this.locate(v.x, v.y);
    const Ld = Math.max(5, 3 + 0.3 * speed);
    const j = (idx + Math.max(1, Math.round(Ld / t.ds))) % n;
    const px = t.x[j] + t.nx(j) * tgtLat;
    const py = t.y[j] + t.ny(j) * tgtLat;
    const dx = px - v.x;
    const dy = py - v.y;
    const c = Math.cos(v.psi);
    const s = Math.sin(v.psi);
    const bx = c * dx + s * dy;
    const by = -s * dx + c * dy;
    const alpha = Math.atan2(by, Math.max(bx, 0.5));
    let delta = Math.atan2(2 * WHEELBASE * Math.sin(alpha), Ld);
    const yawDes = (speed * Math.sin(alpha) * 2) / Ld;
    delta += 0.18 * (yawDes - v.r) * (WHEELBASE / Math.max(speed, 6));
    inp.steer = Math.max(-1, Math.min(1, delta / v.maxSteerAt(speed, 0)));
    const e = tgtSpeed - speed;
    if (tgtSpeed < 0.25 && speed < 1.2) {
      inp.throttle = 0;
      inp.brake = 1;
    } else if (e < -0.6) {
      inp.throttle = 0;
      inp.brake = Math.min(1, 0.08 + -e * 0.14);
    } else {
      inp.throttle = Math.max(0, Math.min(1, 0.12 + e * 0.35));
      inp.brake = 0;
    }
    this.stuck = 0;
  }

  /** Sekunden, die das Auto im Rennen stillsteht (für Bergung/Zurücksetzen). */
  get stuckTime(): number {
    return this.stuck;
  }
}
