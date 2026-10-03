import { CONTACT_STRIDE, MAX_CONTACTS, S } from '../physics/layout';
import type { PhysicsClient } from '../physics/client';

/**
 * Prozedurale Klangwelt (Web Audio, keine Dateien): V6-Turbo-Hybrid mit Drehzahl, Last und Hybrid-Heulen,
 * Reifenquietschen, Fahrtwind, Aufprall- und Schleifgeräusche, Gegner-Motoren mit Doppler und Stereo,
 * Startampel-Pieptöne. Der Kontext wird erst nach einer Nutzergeste gestartet (iOS).
 */

interface EngineVoice {
  osc: OscillatorNode;
  sub: OscillatorNode;
  whine: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  whineGain: GainNode;
  pan: StereoPannerNode | null;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    last = last * 0.15 + w * 0.85;
    d[i] = last;
  }
  return buf;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private wave!: PeriodicWave;
  private player: EngineVoice | null = null;
  private rivals: EngineVoice[] = [];
  private squeal!: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
  private wind!: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
  private scrape!: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
  private rumble!: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode };
  private volume = 0.8;
  private muted = false;
  private lastGear = 1;
  private duck = 0;
  private lastLights = 0;
  private lastState = -1;
  private lastForce = 0;
  private lastCrashT = -10;
  private lastPit = 0;
  private lastStops = 0;
  private lastWheelOff = 0;
  private lastLap = 0;
  enabled = true;

  /** Muss in einer Nutzergeste (Klick/Tipp) aufgerufen werden. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 5;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    this.noise = noiseBuffer(ctx, 3);
    // Klangfarbe des Motors: Obertöne mit Betonung der Zündordnung (3., 6., 9. Ordnung)
    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let h = 1; h < n; h++) imag[h] = (1 / Math.pow(h, 1.05)) * (h % 3 === 0 ? 1.7 : 1) * (h > 14 ? 0.5 : 1);
    this.wave = ctx.createPeriodicWave(real, imag);
    this.player = this.makeVoice(false);
    this.squeal = this.makeNoise(1400, 3.5, 'bandpass');
    this.wind = this.makeNoise(500, 0.6, 'lowpass');
    this.scrape = this.makeNoise(2600, 1.8, 'bandpass');
    this.rumble = this.makeNoise(140, 0.9, 'lowpass');
    void ctx.resume();
  }

  private makeVoice(spatial: boolean): EngineVoice {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.22;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    osc.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(gain);
    whine.connect(whineGain);
    whineGain.connect(gain);
    let pan: StereoPannerNode | null = null;
    if (spatial && ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(this.master);
    } else gain.connect(this.master);
    osc.start();
    sub.start();
    whine.start();
    return { osc, sub, whine, filter, gain, whineGain, pan };
  }

  private makeNoise(freq: number, q: number, type: BiquadFilterType): { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    return { src, gain, filter };
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }
  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }
  get isMuted(): boolean {
    return this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass', when = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loopStart = Math.random() * 2;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.4), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
  }

  /** Aufprall: tiefer Schlag + Knirschen, Stärke 0..1 (nach Kraft). */
  private impact(k: number): void {
    const vol = 0.25 + 0.75 * k;
    this.tone(120 - 40 * k, 0.5, 'sine', 0.9 * vol, 0, 34);
    this.tone(70, 0.35, 'triangle', 0.6 * vol, 0, 28);
    this.burst(900 + 600 * (1 - k), 0.7, 0.35 + 0.5 * k, 0.9 * vol);
    this.burst(3200, 1.2, 0.18, 0.4 * vol, 'bandpass', 0.01);
    if (k > 0.5) {
      // Karbon-Splitter und Metall
      for (let i = 0; i < 4; i++) this.tone(900 + Math.random() * 1800, 0.12 + Math.random() * 0.2, 'square', 0.12, 0.03 + i * 0.05, 300);
    }
  }

  /** Muss jeden Frame laufen. s = interpolierter Spieler-Snapshot. */
  update(s: Float64Array, dt: number, physics: PhysicsClient): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.player) return;
    const t = ctx.currentTime;
    const rpm = s[S.rpm];
    const thr = s[S.throttle];
    const speed = s[S.speedKmh] / 3.6;
    const retired = s[S.retired] > 0.5;
    const rps = rpm / 60;
    const f0 = Math.max(18, rps * 3);

    // --- Gangwechsel: kurzer Zugkraftabriss und Knall ---
    const gear = s[S.gear];
    if (gear !== this.lastGear) {
      if (gear > this.lastGear) {
        this.duck = 1;
        this.burst(500, 1, 0.08, 0.12, 'lowpass');
      } else this.burst(700, 1.5, 0.12, 0.1, 'bandpass');
      this.lastGear = gear;
    }
    this.duck = Math.max(0, this.duck - dt * 9);

    // --- Spielermotor ---
    const v = this.player;
    const load = 0.35 + 0.65 * thr;
    const dead = retired ? 0.0 : 1;
    v.osc.frequency.setTargetAtTime(f0, t, 0.025);
    v.sub.frequency.setTargetAtTime(f0 * 0.5, t, 0.025);
    v.filter.frequency.setTargetAtTime(500 + rpm * 0.22 + thr * 2600, t, 0.04);
    v.gain.gain.setTargetAtTime((0.1 + 0.2 * load) * (1 - 0.7 * this.duck) * dead, t, 0.03);
    // Hybrid-Heulen (MGU-K): abhängig von Rekuperation/Antrieb und Drehzahl
    const kp = Math.abs(s[S.kPower]) / 350e3;
    v.whine.frequency.setTargetAtTime(2400 + rpm * 0.42, t, 0.05);
    v.whineGain.gain.setTargetAtTime(Math.min(0.06, 0.01 + kp * 0.05) * dead, t, 0.06);

    // --- Reifen: Quietschen bei Schlupf ---
    let slip = 0;
    for (let i = 0; i < 4; i++) {
      const a = Math.abs(s[S.alpha + i]);
      const k = Math.abs(s[S.kappa + i]);
      const fz = s[S.fz + i];
      if (fz > 300) slip = Math.max(slip, Math.max(0, a - 0.075) * 9, Math.max(0, k - 0.14) * 5);
    }
    const sq = speed > 6 ? Math.min(1, slip) : 0;
    this.squeal.gain.gain.setTargetAtTime(sq * 0.22, t, 0.04);
    this.squeal.filter.frequency.setTargetAtTime(1100 + sq * 1300 + speed * 6, t, 0.06);

    // --- Wind und Rollgeräusch ---
    this.wind.gain.gain.setTargetAtTime(Math.min(0.2, (speed / 90) ** 2 * 0.2), t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(300 + speed * 7, t, 0.1);
    // Schlaggeräusch über die Federwege (Kerbs, Unebenheiten): hochfrequenter Anteil der Einfederung
    let bump = 0;
    for (let i = 0; i < 4; i++) bump += Math.abs(s[S.susp + i] - 0.5 * (s[S.susp] + s[S.susp + 1]));
    this.rumble.gain.gain.setTargetAtTime(Math.min(0.12, bump * 2.2) * (speed > 4 ? 1 : 0), t, 0.05);

    // --- Aufprall und Schleifen ---
    let force = 0;
    for (let k = 0; k < MAX_CONTACTS; k++) force += s[S.contacts + k * CONTACT_STRIDE + 4];
    const peak = Math.min(1, force / 260e3);
    if (force > 25e3 && force > this.lastForce * 1.8 && t - this.lastCrashT > 0.12) {
      this.impact(Math.min(1, force / 200e3));
      this.lastCrashT = t;
    }
    this.lastForce = force * 0.5 + this.lastForce * 0.5;
    const scr = Math.max(s[S.scrape], s[S.scrape + 1], s[S.scrape + 2], s[S.scrape + 3]);
    const wall = force > 3e3 ? Math.min(1, speed / 40) * Math.min(1, force / 60e3 + 0.25) : 0;
    this.scrape.gain.gain.setTargetAtTime(Math.min(0.28, scr * 0.22 + wall * 0.22), t, 0.04);
    this.scrape.filter.frequency.setTargetAtTime(1800 + speed * 22 + peak * 800, t, 0.05);
    const off = s[S.wheelOff] + s[S.wheelOff + 1] + s[S.wheelOff + 2] + s[S.wheelOff + 3];
    if (off > this.lastWheelOff) {
      this.burst(2400, 0.9, 0.3, 0.5);
      this.tone(210, 0.25, 'sawtooth', 0.25, 0, 70);
    }
    this.lastWheelOff = off;

    // --- Rennen: Ampel, Boxenarbeit, Rundenglocke ---
    const state = s[S.raceState];
    const lights = s[S.raceLights];
    if (physics.carCount > 0) {
      if (state === 0 && lights !== this.lastLights && lights >= 1 && lights <= 5) this.tone(880, 0.22, 'sine', 0.22);
      if (state === 1 && this.lastState === 0) this.tone(1320, 0.5, 'sine', 0.3);
      const stops = s[S.pitStops];
      const pit = s[S.pitState];
      if (pit === 3 && this.lastPit !== 3) for (let i = 0; i < 5; i++) this.burst(2600, 2, 0.05, 0.25, 'bandpass', i * 0.11);
      if (pit !== 3 && this.lastPit === 3 && stops > this.lastStops) this.tone(660, 0.18, 'sine', 0.2);
      this.lastPit = pit;
      this.lastStops = stops;
      const lap = s[S.raceLap];
      if (state === 1 && lap > this.lastLap && this.lastLap > 0) this.tone(1000, 0.12, 'sine', 0.12);
      this.lastLap = lap;
      this.lastLights = lights;
      this.lastState = state;
    }

    // --- Gegner: die drei nächsten Motoren mit Abstand, Stereoposition und Doppler ---
    const n = physics.carCount;
    if (n > 1) {
      while (this.rivals.length < 3) this.rivals.push(this.makeVoice(true));
      const px = s[S.x];
      const py = s[S.y];
      const psi = s[S.psi];
      const cx = Math.cos(psi);
      const sx = Math.sin(psi);
      let best: Array<{ d: number; k: number; lat: number; vr: number }> = [];
      for (let k = 1; k < n; k++) {
        const c = physics.carView(k);
        if (!c) continue;
        const dx = c[S.x] - px;
        const dy = c[S.y] - py;
        const d = Math.hypot(dx, dy);
        if (d > 260 || c[S.raceOut] > 0.5) continue;
        const lat = (-dx * sx + dy * cx) / Math.max(d, 1);
        const vr = ((c[S.u] * Math.cos(c[S.psi]) - speed * cx) * dx + (c[S.u] * Math.sin(c[S.psi]) - speed * sx) * dy) / Math.max(d, 1);
        best.push({ d, k, lat, vr });
      }
      best.sort((a, b) => a.d - b.d);
      best = best.slice(0, 3);
      for (let i = 0; i < 3; i++) {
        const rv = this.rivals[i];
        const b = best[i];
        if (!b) {
          rv.gain.gain.setTargetAtTime(0, t, 0.1);
          continue;
        }
        const c = physics.carView(b.k)!;
        const f = Math.max(18, (c[S.rpm] / 60) * 3) * (1 - Math.max(-60, Math.min(60, b.vr)) / 343);
        rv.osc.frequency.setTargetAtTime(f, t, 0.05);
        rv.sub.frequency.setTargetAtTime(f * 0.5, t, 0.05);
        rv.filter.frequency.setTargetAtTime(380 + c[S.rpm] * 0.1 + c[S.throttle] * 900, t, 0.06);
        const att = 1 / (1 + b.d / 22);
        rv.gain.gain.setTargetAtTime(0.16 * att * (c[S.retired] > 0.5 ? 0 : 0.5 + 0.5 * c[S.throttle]), t, 0.06);
        rv.whineGain.gain.setTargetAtTime(0, t, 0.1);
        if (rv.pan) rv.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, b.lat * 1.4)), t, 0.05);
      }
    } else {
      for (const rv of this.rivals) rv.gain.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  /** Alle Dauertöne stumm (Menü, Pause). */
  silence(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.player?.gain.gain.setTargetAtTime(0, t, 0.05);
    for (const rv of this.rivals) rv.gain.gain.setTargetAtTime(0, t, 0.05);
    for (const n of [this.squeal, this.wind, this.scrape, this.rumble]) n?.gain.gain.setTargetAtTime(0, t, 0.05);
  }
}
