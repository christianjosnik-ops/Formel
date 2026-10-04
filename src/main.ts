import './style.css';
import * as THREE from 'three';
import { TEST_CAR_2026 } from './config/car';
import teams from './data/teams.json';
import { DRIVERS, teamOf } from './race/field';
import { AI_LEVELS, driverPace } from './race/field';
import { RacingLine } from './race/line';
import { RacingLineVis } from './render/racingLineVis';
import { RainFx } from './render/rain';
import { Haptics } from './input/haptics';
import { SafetyCarModel } from './render/safetyCarModel';
import { selectField, type RaceConfig } from './race/race';
import { fmtTime } from './ui/race';
import { COMPOUND_ORDER } from './config/tyres';
import { GameAudio } from './audio/audio';
import { loadCareer, prize, recordResult, saveCareer } from './career';
import { CALENDAR, loadSeason, recordRound, seasonDone } from './season';
import { Controls } from './input/controls';
import { loadSettings, saveSettings } from './input/settings';
import { setupTouchPads } from './input/touch';
import { PhysicsClient } from './physics/client';
import { CONTACT_STRIDE, MAX_CONTACTS, S } from './physics/layout';
import { newInput } from './physics/vehicle';
import { CarModel, type Livery } from './render/carModel';
import { loadCarAssets } from './render/carAssets';
import { CameraRig } from './render/cameraRig';
import { createScene } from './render/scene';
import { DebrisRenderer, Effects } from './render/effects';
import { buildWorldVisuals } from './render/worldVisuals';
import { buildTrackVisuals } from './render/trackVisuals';
import { PitCrewRenderer } from './render/pitCrew';
import { loadSceneryAssets } from './render/sceneryAssets';
import { createMap } from './world/maps';
import { LapTimer } from './ui/lap';
import { Hud } from './ui/hud';
import { setupMenu } from './ui/menu';
import { setupStart } from './ui/start';
import { RaceHud } from './ui/race';

// ---------------------------------------------------------------- Ladebildschirm mit Startampel
const ldFill = document.getElementById('ldFill')!;
const ldText = document.getElementById('ldText')!;
const ldLights = document.querySelector('.ldLights')!;
const LD_TIPS = [
  'Tipp: BOX (Taste P) meldet den Boxenstopp an – die Automatik fährt dich in die Box.',
  'Tipp: Bei Regen sind Intermediates (I) und Regenreifen (W) deutlich schneller als Slicks.',
  'Tipp: Die Ideallinie (Fahren → Fahrlinie) zeigt Bremspunkte: rot heißt bremsen.',
  'Tipp: Unter Safety Car ist das Tempo begrenzt – schließe auf und warte auf Grün.',
  'Tipp: Im Menü Karriere findest du Saison, Werkstatt und Upgrades für dein Auto.',
  'Tipp: Aero-Taste Z öffnet die Flügel für mehr Topspeed auf den Geraden.',
];
document.getElementById('ldTip')!.textContent = LD_TIPS[Math.floor(Math.random() * LD_TIPS.length)];
/** Fortschritt anzeigen (0..1) und dem Browser Zeit zum Zeichnen geben, bevor schwere Arbeit weiterläuft. */
async function loadStep(p: number, text: string): Promise<void> {
  ldFill.style.width = `${Math.round(p * 100)}%`;
  ldText.textContent = text;
  [...ldLights.children].forEach((l, i) => l.classList.toggle('on', p >= (i + 1) / 6));
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
await loadStep(0.05, 'Szene wird aufgebaut');
const settings = loadSettings();
const canvas = document.getElementById('view') as HTMLCanvasElement;
const bundle = createScene(canvas);
const { renderer, scene, camera } = bundle;

const gameMap = createMap(settings.map);
const worldMap = gameMap.world;
await loadStep(0.12, 'Strecke wird geladen');
const scenery = gameMap.track ? await loadSceneryAssets() : null;
await loadStep(0.3, 'Gelände, Bäume und Tribünen werden gebaut');
const visuals = gameMap.track ? buildTrackVisuals(scene, gameMap, scenery) : buildWorldVisuals(scene, worldMap, true);
if (gameMap.track) {
  // Strecke: Gelände ersetzt die mitlaufende Grasfläche; Dunst und große Sichtweite für Berge
  bundle.ground.visible = false;
  scene.fog = new THREE.Fog(gameMap.theme.fog, 650, 7200);
  camera.near = 0.3;
  camera.far = 9800;
  camera.updateProjectionMatrix();
}
await loadStep(0.55, 'Effekte und Boxencrew');
const effects = new Effects(scene, worldMap);
const pitCrew = new PitCrewRenderer(scene);
let debris: DebrisRenderer | null = null;
/** Wetter/Tageszeit nach Einstellung anwenden. */
let lookWeather: typeof settings.weather | null = null;
function applyWeather(override?: typeof settings.weather): void {
  const fogColor = gameMap.track ? new THREE.Color(gameMap.theme.fog).getHex() : 0xb9c4ca;
  lookWeather = override ?? settings.weather;
  bundle.setWeather(lookWeather, fogColor, gameMap.track ? 650 : 350, gameMap.track ? 7200 : 2000);
}
const rainFx = new RainFx(scene);
const haptics = new Haptics();
const scModel = new SafetyCarModel();
scene.add(scModel.root);
const windTmp = new THREE.Vector3();
let debugSc: { x: number; y: number; psi: number } | null = null;
applyWeather();
const lapTimer = new LapTimer(gameMap.track);
let lineVis: RacingLineVis | null = null;
/** Ideallinien-Band nach Einstellung ein-/ausblenden (wird erst beim ersten Einschalten berechnet). */
function syncRacingLine(): void {
  if (!gameMap.track) return;
  if (settings.racingLine && !lineVis) {
    lineCache ??= new RacingLine(gameMap.track);
    lineVis = new RacingLineVis(scene, gameMap.track, lineCache);
  }
  lineVis?.setVisible(settings.racingLine && settings.camera !== 'showroom');
}

const career = loadCareer();
const physics = new PhysicsClient(settings.map, undefined, career.up);
const controls = new Controls(settings);
setupTouchPads(controls);
const audio = new GameAudio();
const unlockAudio = () => audio.unlock();
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlockAudio, { passive: true });
audio.setVolume(settings.volume);
const hud = new Hud();
// Touch-Geräte: Telemetrie-Panel (zwei Canvas je Bild) einmalig ausschalten – spart viel Zeichenarbeit auf dem iPad
try {
  if (window.matchMedia?.('(pointer: coarse)').matches && !localStorage.getItem('formel.tel.v1')) {
    settings.telemetry = false;
    localStorage.setItem('formel.tel.v1', '1');
  }
} catch {
  /* Speicher nicht verfügbar */
}
hud.setTelemetryVisible(settings.telemetry);

// ---------------------------------------------------------------- Fahrzeug / Livree
await loadStep(0.65, 'Autos werden geladen');
const assets = await loadCarAssets();
let car!: CarModel;
function buildCar(): void {
  if (car) {
    scene.remove(car.root);
    car.dispose();
  }
  const team = teams.find((t) => t.id === settings.team) ?? teams[0];
  const driver = settings.mode === 'race' || settings.mode === 'season' ? DRIVERS[settings.driver] ?? DRIVERS[0] : DRIVERS.find((d) => d.team === team.id) ?? DRIVERS[0];
  const livery: Livery = {
    primary: team.colors.primary,
    secondary: team.colors.secondary,
    accent: team.colors.accent,
    number: driver.number,
    helmet: driver.helmet,
    teamName: team.name,
    engineName: team.engine,
    compound: settings.compound,
  };
  car = new CarModel(TEST_CAR_2026, livery, assets);
  scene.add(car.root);
  debris?.dispose();
  debris = new DebrisRenderer(scene, car.debrisTemplates);
  rig?.setMode(rig.mode, car);
}
const rig = new CameraRig(camera, canvas);
buildCar();
// Bis zum Start zeigt die Kamera das Auto im Showroom
rig.setMode('showroom', car);
document.body.classList.add('showroom');
const raceHud = new RaceHud();
raceHud.pitAuto = settings.pitAuto;

// ---------------------------------------------------------------- KI-Autos
const aiModels: (CarModel | undefined)[] = [];
function clearAi(): void {
  for (const m of aiModels) {
    if (!m) continue;
    scene.remove(m.root);
    m.dispose();
  }
  aiModels.length = 0;
}
function makeAi(v: Float64Array): CarModel {
  const d = DRIVERS[v[S.raceDriver] | 0] ?? DRIVERS[0];
  const t = teamOf(d);
  const m = new CarModel(
    TEST_CAR_2026,
    { primary: t.colors.primary, secondary: t.colors.secondary, accent: t.colors.accent, number: d.number, helmet: d.helmet, teamName: t.name, engineName: t.engine, compound: 'medium' },
    assets,
  );
  m.root.traverse((o) => (o.castShadow = false));
  scene.add(m.root);
  return m;
}
function updateAi(dt: number, s: Float64Array): void {
  const n = physics.carCount;
  if (n <= 1) {
    if (aiModels.length) clearAi();
    return;
  }
  for (let k = 1; k < n; k++) {
    const v = physics.carView(k);
    if (!v) continue;
    const m = (aiModels[k] ??= makeAi(v));
    if (m.lastCompound !== (v[S.compound] | 0)) {
      m.lastCompound = v[S.compound] | 0;
      m.setCompound(COMPOUND_ORDER[m.lastCompound] ?? 'medium');
    }
    const dx = v[S.x] - s[S.x];
    const dy = v[S.y] - s[S.y];
    const near = dx * dx + dy * dy < 450 * 450;
    m.root.visible = near;
    if (near) {
      let g = 0;
      let tl = 0;
      if (gameMap.track) {
        g = gameMap.track.heightAt(v[S.x], v[S.y]);
        gameMap.track.slopeAt(v[S.x], v[S.y], slopeTmp);
        tl = Math.atan(slopeTmp[0] * Math.cos(v[S.psi]) + slopeTmp[1] * Math.sin(v[S.psi]));
      }
      m.update(v, dt, g, tl);
    }
  }
}


/** Boxenstopp-Animation: Crew, Wagenheber und Radwechsel für alle Autos in der Nähe. */
function updatePitCrew(s: Float64Array): void {
  const list: Array<{ k: number; view: Float64Array; model: CarModel; ground: number }> = [];
  const trk = gameMap.track;
  const gy = (x: number, y: number) => (trk ? trk.heightAt(x, y) : 0);
  list.push({ k: 0, view: s, model: car, ground: gy(s[S.x], s[S.y]) });
  const n = physics.carCount;
  for (let k = 1; k < n; k++) {
    const v = physics.carView(k);
    const m = aiModels[k];
    if (v && m && m.root.visible) list.push({ k, view: v, model: m, ground: gy(v[S.x], v[S.y]) });
  }
  pitCrew.update(list, camera.position.x, camera.position.z);
}

/** Boxenstopp-Kamera: sanft zu einer Nahansicht des Autos vor der Box überblenden, solange der Reifenwechsel läuft. */
let pitCamBlend = 0;
const pitCamQuat = new THREE.Quaternion();
const pitCamTmp = new THREE.Object3D();
function updatePitCam(s: Float64Array, dt: number): void {
  const active = (s[S.pitState] === 3 || pitCrew.demo >= 0) && rig.mode !== 'cockpit' && rig.mode !== 'showroom' && !debugCam;
  pitCamBlend += ((active ? 1 : 0) - pitCamBlend) * Math.min(1, dt * 3.5);
  if (pitCamBlend < 0.01) return;
  const psi = s[S.psi];
  const cx = s[S.x];
  const cy = s[S.y];
  const fx = Math.cos(psi);
  const fy = Math.sin(psi);
  const rx = Math.sin(psi);
  const ry = -Math.cos(psi);
  // vorn-rechts, tief, mit Blick auf die Radmitte
  const lx = 5.0;
  const lz = 3.4;
  const g = gameMap.track ? gameMap.track.heightAt(cx, cy) : 0;
  const target = new THREE.Vector3(cx + fx * lx + rx * lz, g + 1.25, -(cy + fy * lx + ry * lz));
  pitCamTmp.position.copy(target);
  pitCamTmp.lookAt(cx + fx * 0.2, g + 0.6, -cy - fy * 0.2);
  pitCamQuat.copy(pitCamTmp.quaternion);
  const k = pitCamBlend * pitCamBlend * (3 - 2 * pitCamBlend);
  camera.position.lerp(target, k);
  camera.quaternion.slerp(pitCamQuat, k);
}

function raceConfig(over: Partial<RaceConfig> = {}): RaceConfig {
  return {
    laps: settings.laps,
    aiLevel: Math.max(0, settings.aiLevel),
    playerDriver: settings.driver,
    field: settings.aiLevel < 0 ? 1 : settings.field,
    grid: settings.grid,
    seed: (Date.now() & 0xffff) + 1,
    wearScale: settings.wear,
    pitAssist: settings.pitAuto,
    safetyCar: settings.safetyCar,
    startCompound: (['soft', 'medium', 'hard', 'inter', 'wet'].includes(settings.compound) ? settings.compound : 'medium') as RaceConfig['startCompound'],
    ...over,
  };
}
function applyControlClass(): void {
  document.body.classList.toggle('arrows', settings.control === 'arrows');
  document.body.classList.toggle('tilt', settings.control === 'tilt');
}
let lineCache: RacingLine | null = null;
/** Qualifying-Zeiten der KI: Profilzeit der Ideallinie, reale Fahrzeit (Faktor), Team-/Fahrerabstand, Rauschen. */
function qualiGrid(cfg: RaceConfig, playerBest: number): { order: number[]; rows: Array<{ pos: number; name: string; color: string; time: string; gap: string; me: boolean }> } {
  lineCache ??= new RacingLine(gameMap.track!);
  const level = AI_LEVELS[Math.min(AI_LEVELS.length - 1, cfg.aiLevel)];
  const ids = selectField({ ...cfg, field: settings.aiLevel < 0 ? 1 : settings.field });
  let seed = cfg.seed;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const list = ids.map((id, k) => {
    const d = DRIVERS[id];
    const t = teamOf(d);
    const time = k === 0 ? (playerBest > 0 ? playerBest : 999) : (lineCache!.lapTime(1) * 1.165) / (level.pace * driverPace(d)) + t.gap * 0.9 + (98 - d.pace) * 0.04 + (rnd() - 0.5) * 0.5;
    return { id, d, t, time, me: k === 0 };
  });
  list.sort((a, b) => a.time - b.time);
  const pole = list[0].time;
  return {
    order: list.map((x) => x.id),
    rows: list.map((x, i) => ({ pos: i + 1, name: x.d.name, color: x.t.colors.primary, time: x.time >= 999 ? 'keine Zeit' : fmtTime(x.time), gap: i === 0 ? '' : `+${(x.time - pole).toFixed(3)}`, me: x.me })),
  };
}
function launch(kind: 'free' | 'race' | 'quali', over: Partial<RaceConfig> = {}): void {
  raceHud.againLabel = settings.mode === 'season' ? 'Weiter' : 'Neues Rennen';
  syncRacingLine();
  applyWeather();
  const race = kind !== 'free';
  if (race) settings.team = teamOf(DRIVERS[settings.driver] ?? DRIVERS[0]).id;
  applyControlClass();
  buildCar();
  clearAi();
  physics.restart(kind === 'quali' ? raceConfig({ laps: 4, field: 1, grid: 'pole', ...over }) : race ? raceConfig(over) : undefined, career.up, settings.rain);
  physics.setBrakeBias(settings.brakeBias);
  raceHud.pitAuto = settings.pitAuto;
  raceHud.setActive(race, kind === 'quali' ? 'quali' : 'race');
  document.body.classList.toggle('race', race);
  if (race) {
    settings.telemetry = false;
    hud.setTelemetryVisible(false);
    (document.getElementById('chkTelemetry') as HTMLInputElement).checked = false;
  }
  lapTimer.enforceLimits = settings.trackLimits;
  lapTimer.reset(0);
  slowT = 0;
  slowScale = 1;
  prevLevel = 0;
  lastScale = 1;
  physics.setTimeScale(1);
  document.body.classList.remove('slowmo');
  const cam = settings.camera === 'showroom' ? 'chase' : settings.camera;
  rig.setMode(cam, car);
  document.body.classList.remove('showroom');
  (document.getElementById('selTeam') as HTMLSelectElement).value = settings.team;
}
function startGame(): void {
  launch(settings.mode === 'weekend' || settings.mode === 'season' ? 'quali' : settings.mode === 'race' ? 'race' : 'free');
}
const season = loadSeason();
raceHud.onFinish = (pos, n, dnf, order) => {
  let extra = '';
  if (settings.mode === 'season' && !seasonDone(season)) {
    const done = season.round + 1;
    const pts = recordRound(season, order, settings.driver);
    extra = `\nSaison: +${pts} Punkte · Lauf ${done}/${CALENDAR.length}${seasonDone(season) ? ' – Saison beendet, Wertung im Reiter Karriere' : ''}`;
  }
  const win = prize(pos, n, settings.laps, settings.aiLevel, dnf);
  career.money += win;
  recordResult(career, pos, dnf, win);
  saveCareer(career);
  return `Preisgeld + ${win.toLocaleString('de-DE')} €  ·  Guthaben ${career.money.toLocaleString('de-DE')} €${extra}`;
};
raceHud.onQuali = (best) => {
  const cfg = raceConfig();
  const g = qualiGrid(cfg, best);
  const pos = g.rows.findIndex((r) => r.me) + 1;
  raceHud.showTable(`Qualifying – Startplatz ${pos}`, g.rows, 'Weiter zum Rennen', () => launch('race', { gridOrder: g.order }));
};
const start = setupStart(settings, career, season, (mapChanged) => {
  if (mapChanged) {
    try {
      sessionStorage.setItem('formel.autostart', '1');
    } catch {
      /* ignorieren */
    }
    location.reload();
  } else startGame();
});
raceHud.onAgain = () => (settings.mode === 'season' ? raceHud.onMenu() : startGame());
raceHud.onMenu = () => {
  raceHud.setActive(false);
  document.body.classList.remove('race');
  clearAi();
  physics.restart(undefined, career.up);
  rig.setMode('showroom', car);
  document.body.classList.add('showroom');
  start.show();
};
applyControlClass();
let autostart = false;
try {
  autostart = sessionStorage.getItem('formel.autostart') === '1';
  sessionStorage.removeItem('formel.autostart');
} catch {
  /* ignorieren */
}
if (autostart) document.getElementById('start')!.classList.add('hidden');
else start.show();

const menu = setupMenu(settings, controls, {
  onMainMenu: () => raceHud.onMenu?.(),
  onLineChanged: syncRacingLine,
  onWeatherChanged: () => applyWeather(),
  onTeamChanged: buildCar,
  onCameraChanged: () => {
    rig.setMode(settings.camera, car);
    document.body.classList.toggle('showroom', settings.camera === 'showroom');
    syncRacingLine();
  },
  onTelemetryChanged: () => hud.setTelemetryVisible(settings.telemetry),
  onBrakeBias: (b) => physics.setBrakeBias(b),
  onQualityChanged: () => {
    qualityLocked = settings.quality !== 'auto';
    applyQuality();
  },
});
const btnSound = document.getElementById('btnSound')!;
const syncSound = () => (btnSound.textContent = audio.isMuted || settings.volume === 0 ? '🔇' : '🔊');
btnSound.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.isMuted);
  syncSound();
});
const rngVol = document.getElementById('rngVol') as HTMLInputElement;
const valVol = document.getElementById('valVol')!;
rngVol.value = String(Math.round(settings.volume * 100));
valVol.textContent = `${rngVol.value} %`;
rngVol.addEventListener('input', () => {
  settings.volume = Number(rngVol.value) / 100;
  valVol.textContent = `${rngVol.value} %`;
  audio.unlock();
  audio.setVolume(settings.volume);
  saveSettings(settings);
  syncSound();
});
document.getElementById('buildInfo')!.textContent = `Build ${__BUILD__}`;

const resetCar = () => {
  if (physics.carCount > 0 && gameMap.track) {
    // Rennen: Streckenposten setzt das Auto an der aktuellen Stelle zurück auf die Strecke
    const t = gameMap.track;
    const i = t.nearest(physics.out[S.x], physics.out[S.y]);
    if (i >= 0) physics.reset(t.x[i], t.y[i], t.hdg[i], 0);
    return;
  }
  physics.reset(gameMap.start.x, gameMap.start.y, gameMap.start.psi, 0);
  lapTimer.reset(0);
};
const repairCar = () => physics.repair();
controls.onRepair = repairCar;
document.getElementById('btnRepair')!.addEventListener('click', repairCar);
controls.onReset = resetCar;
controls.onCamera = () => {
  settings.camera = rig.cycle(car);
  (document.getElementById('selCam') as HTMLSelectElement).value = settings.camera;
  document.body.classList.toggle('showroom', settings.camera === 'showroom');
  saveSettings(settings);
};
controls.onToggleMenu = menu.toggle;
controls.onToggleTelemetry = () => {
  settings.telemetry = !settings.telemetry;
  hud.setTelemetryVisible(settings.telemetry);
  (document.getElementById('chkTelemetry') as HTMLInputElement).checked = settings.telemetry;
  saveSettings(settings);
};
document.getElementById('btnReset')!.addEventListener('click', resetCar);
document.getElementById('btnCamera')!.addEventListener('click', controls.onCamera);
document.getElementById('btnTelemetry')!.addEventListener('click', controls.onToggleTelemetry);
const aeroBtn = document.getElementById('aeroBtn')!;
aeroBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  controls.toggleAero();
});

// ---------------------------------------------------------------- Adaptive Auflösung
const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
// Handys starten konservativ (1,5x) und steigern sich, wenn die Bildrate stabil ist
let pixelRatio = coarse ? Math.min(maxPixelRatio, 1.25) : maxPixelRatio;
let qualityLocked = settings.quality !== 'auto';
function applyQuality(): void {
  visuals.setDetail?.(settings.quality === 'low' ? 0.4 : coarse && settings.quality !== 'high' ? 0.65 : 1);
  if (settings.quality === 'high') pixelRatio = maxPixelRatio;
  else if (settings.quality === 'low') pixelRatio = 1;
  bundle.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = settings.quality !== 'low';
  bundle.sun.castShadow = settings.quality !== 'low';
  bundle.setPost(settings.quality === 'high' || (settings.quality === 'auto' && !coarse));
  if (settings.quality === 'low') bundle.setShadow(1024, 20);
  else if (coarse) bundle.setShadow(1536, 26);
  else bundle.setShadow(3072, 34);
}
applyQuality();

// ---------------------------------------------------------------- Aufwärmen
let warming = false;
let hudAcc = 0;
/**
 * Vor dem Start einmal alles zeichnen: Shader kompilieren und alle Geometrien/Texturen auf die GPU laden (auch die außerhalb des
 * Bildes und die nur gelegentlich sichtbaren: Boxencrew, Regen, Safety Car, Ideallinie), damit es später keine Ruckler gibt.
 */
async function warmUp(): Promise<void> {
  await loadStep(0.8, 'Boxencrew und Effekte werden vorbereitet');
  await pitCrew.loaded;
  await loadStep(0.88, 'Shader werden kompiliert');
  const culled = new Map<THREE.Object3D, boolean>();
  scene.traverse((o) => {
    culled.set(o, o.frustumCulled);
    o.frustumCulled = false;
  });
  const rainWas = rainFx.lines.visible;
  const scWas = scModel.root.visible;
  const lineWas = lineVis?.mesh.visible ?? false;
  try {
    rainFx.lines.visible = true;
    scModel.root.visible = true;
    if (lineVis) lineVis.mesh.visible = true;
    pitCrew.warm(true);
    renderer.compile(scene, camera);
    bundle.render();
  } catch {
    /* Aufwärmen ist nur eine Optimierung */
  }
  await loadStep(0.96, 'Grafik wird geladen');
  try {
    bundle.render();
  } catch {
    /* ignorieren */
  }
  pitCrew.warm(false);
  rainFx.lines.visible = rainWas;
  scModel.root.visible = scWas;
  if (lineVis) lineVis.mesh.visible = lineWas;
  for (const [o, c] of culled) o.frustumCulled = c;
  await loadStep(1, 'Bereit');
  ldLights.classList.add('go');
  await new Promise<void>((r) => setTimeout(r, 450));
}

// ---------------------------------------------------------------- Hauptschleife
// ---------------------------------------------------------------- Crash-Wirkung: Zeitlupe, Blitz, Vibration
let slowT = 0;
let prevLevel = 0;
let slowScale = 1;
const flashEl = document.getElementById('flash')!;
let flash = 0;
function crashFx(s: Float64Array, dt: number): void {
  const lvl = s[S.crashLevel];
  const speedKmh = s[S.speedKmh];
  if (lvl >= 3 && prevLevel < 3 && !document.body.classList.contains('showroom')) {
    slowT = 1.5;
    flash = 1;
    haptics.crash(lvl);
  } else if (lvl >= 2 && prevLevel < 2) {
    flash = Math.max(flash, 0.45);
    haptics.crash(lvl);
  }
  prevLevel = lvl;
  void speedKmh;
  // Zeitlupe: schnell hinein, weich wieder heraus
  let target = 1;
  if (slowT > 0) {
    slowT -= dt;
    const k = Math.max(0, slowT) / 1.5;
    target = k > 0.35 ? 0.22 : 0.22 + (0.35 - k) / 0.35 * 0.78;
  }
  slowScale += (target - slowScale) * Math.min(1, dt * 10);
  const sc = slowScale > 0.97 ? 1 : slowScale;
  if (Math.abs(sc - lastScale) > 0.02) {
    lastScale = sc;
    physics.setTimeScale(sc);
    document.body.classList.toggle('slowmo', sc < 0.6);
  }
  flash = Math.max(0, flash - dt * 1.6);
  flashEl.style.opacity = String(flash);
}
let lastScale = 1;

const input = newInput();
const slopeTmp = new Float64Array(2);
const speedFx = document.getElementById('speedfx')!;
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let fps = 60;
let loaded = false;
let shake = 0;
let lowCount = 0;
let highCount = 0;

let debugCam: { x: number; y: number; z: number; lx: number; ly: number; lz: number } | null = null;
const prof = { jsMs: 0, renderMs: 0, frames: 0, maxDt: 0 };
function frame(now: number): void {
  requestAnimationFrame(frame);
  const tFrame = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  controls.update(dt);
  controls.fill(input);
  {
    // Aero-Automatik (wie die KI): X-Modus auf der Geraden, Z in Kurven und beim Bremsen; Knopf erzwingt X
    const sn = physics.out;
    const straight = input.throttle > 0.9 && input.brake < 0.05 && Math.abs(input.steer) < 0.12 && sn[S.speedKmh] > 180;
    if (!controls.aeroMode && settings.autoAero && straight) input.aeroX = 1;
  }
  physics.setInput(input);

  if (physics.sample()) {
    const s = physics.out;
    if (car.lastCompound !== (s[S.compound] | 0)) {
      car.lastCompound = s[S.compound] | 0;
      car.setCompound(COMPOUND_ORDER[car.lastCompound] ?? 'medium');
    }
    const trk = gameMap.track;
    let ground = 0;
    let tilt = 0;
    if (trk) {
      ground = trk.heightAt(s[S.x], s[S.y]);
      trk.slopeAt(s[S.x], s[S.y], slopeTmp);
      tilt = Math.atan(slopeTmp[0] * Math.cos(s[S.psi]) + slopeTmp[1] * Math.sin(s[S.psi]));
    }
    rig.groundY = ground;
    effects.groundY = ground;
    if (debris) debris.groundY = ground;
    car.update(s, dt, ground, tilt);
    updateAi(dt, s);
    updatePitCrew(s);
    raceHud.update(physics, dt);
    rig.update(s, dt, car);
    updatePitCam(s, dt);
    if (debugCam) {
      camera.position.set(debugCam.x, debugCam.y, debugCam.z);
      camera.lookAt(debugCam.lx, debugCam.ly, debugCam.lz);
    }
    visuals.updateCones(s);
    debris?.update(s);
    effects.setPixelScale(renderer.domElement.height, camera.fov);
    effects.update(s, dt);
    haptics.enabled = settings.haptics && !document.body.classList.contains('inmenu') && rig.mode !== 'showroom';
    haptics.update(performance.now() * 0.001, s[S.speedKmh], effects.kerbWheels, effects.slipMax, Math.max(s[S.scrape], s[S.scrape + 1], s[S.scrape + 2], s[S.scrape + 3]));
    // Kamera-Schütteln bei Einschlägen
    {
      let f = 0;
      for (let k = 0; k < MAX_CONTACTS; k++) f += s[S.contacts + k * CONTACT_STRIDE + 4];
      const target = Math.min(1, f / 220e3);
      shake = Math.max(target, shake * Math.exp(-dt * 5));
      if (shake > 0.01 && rig.mode !== 'showroom') {
        const a = shake * (rig.mode === 'cockpit' ? 0.09 : 0.3);
        camera.position.x += (Math.random() - 0.5) * a;
        camera.position.y += (Math.random() - 0.5) * a;
        camera.position.z += (Math.random() - 0.5) * a;
        camera.rotation.z += (Math.random() - 0.5) * 0.05 * shake;
      }
    }
    bundle.updateEnvironment(s[S.x], -s[S.y]);
    {
      // Regen: Nässe auf Strecke/Boden, Regenstreifen, trübes Licht; Safety Car
      const wet = s[S.wet];
      const rain = s[S.rain];
      visuals.setWet?.(wet);
      const rainy = lookWeather === 'overcast' && settings.weather !== 'overcast';
      if (rain > 0.22 && !rainy) applyWeather('overcast');
      else if (rain < 0.08 && wet < 0.3 && lookWeather !== settings.weather) applyWeather();
      const sp = s[S.speedKmh] / 3.6;
      windTmp.set(Math.cos(s[S.psi]) * sp, 0, -Math.sin(s[S.psi]) * sp);
      rainFx.update(performance.now() * 0.001, camera.position, rig.mode === 'showroom' ? 0 : rain, windTmp);
      const fs = debugSc;
      const sc = (s[S.scState] > 0 || !!fs) && rig.mode !== 'showroom';
      const scx = fs ? fs.x : s[S.scX];
      const scy = fs ? fs.y : s[S.scY];
      scModel.update(sc, scx, sc && gameMap.track ? gameMap.track.heightAt(scx, scy) : 0, -scy, fs ? fs.psi : s[S.scPsi], performance.now() * 0.001);
    }
    bundle.setCinema(rig.mode === 'showroom' ? 0 : s[S.speedKmh] / 3.6, performance.now() * 0.001);
    // HUD (viele DOM-Schreibzugriffe) nur mit 30 Hz aktualisieren
    hudAcc += dt;
    if (hudAcc >= 1 / 30) {
      hud.update(s, hudAcc, settings.tc, settings.abs);
      hudAcc = 0;
    }
    if (document.body.classList.contains('inmenu')) audio.silence();
    else audio.update(s, dt, physics);
    crashFx(s, dt);
    speedFx.style.opacity = String(Math.min(0.85, Math.max(0, (s[S.speedKmh] - 120) / 260)));
    lapTimer.update(s);
    if (!loaded && !warming) {
      warming = true;
      void warmUp().then(() => {
        loaded = true;
        document.getElementById('loading')!.classList.add('gone');
        if (autostart) startGame();
      });
    }
  }
  const tR = performance.now();
  bundle.render();
  prof.jsMs += tR - tFrame;
  prof.renderMs += performance.now() - tR;
  prof.frames++;
  prof.maxDt = Math.max(prof.maxDt, dt);

  // FPS + adaptive Auflösung
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc >= 1) {
    fps = fpsFrames / fpsAcc;
    hud.setFps(fps);
    fpsAcc = 0;
    fpsFrames = 0;
    if (!qualityLocked && loaded) {
      if (fps < 50) {
        lowCount++;
        highCount = 0;
      } else if (fps > 58) {
        highCount++;
        lowCount = 0;
      } else {
        lowCount = 0;
        highCount = 0;
      }
      if (lowCount >= 2 && bundle.postOn()) {
        bundle.setPost(false);
        lowCount = 0;
      } else if (lowCount >= 2 && pixelRatio > (coarse ? 0.85 : 1)) {
        pixelRatio = Math.max(coarse ? 0.85 : 1, pixelRatio - 0.2);
        bundle.setPixelRatio(pixelRatio);
        lowCount = 0;
      } else if (lowCount >= 4 && renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = false;
        bundle.sun.castShadow = false;
        visuals.setDetail?.(0.55);
        lowCount = 0;
      } else if (!coarse && highCount >= 8 && pixelRatio < maxPixelRatio) {
        pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.25);
        bundle.setPixelRatio(pixelRatio);
        highCount = 0;
      }
    }
  }
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  physics.pause(document.hidden);
  last = performance.now();
});

// Debug-/Testzugriff
(window as unknown as Record<string, unknown>).__formel = { renderer, scene, setDebugSc: (v: { x: number; y: number; psi: number } | null) => { debugSc = v; }, pitCrew, setDebugCam: (c: typeof debugCam) => { debugCam = c; }, prof, physics, controls, settings, rig, map: gameMap, get car() { return car; }, raceHud, launch };

// PWA: Service Worker (Netzwerk zuerst, Cache als Offline-Rückfall)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.hostname.match(/^(localhost|127\.)/)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
