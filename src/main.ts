import './style.css';
import * as THREE from 'three';
import { TEST_CAR_2026 } from './config/car';
import teams from './data/teams.json';
import drivers from './data/drivers.json';
import { Controls } from './input/controls';
import { loadSettings, saveSettings } from './input/settings';
import { setupTouchPads } from './input/touch';
import { PhysicsClient } from './physics/client';
import { S } from './physics/layout';
import { newInput } from './physics/vehicle';
import { CarModel, type Livery } from './render/carModel';
import { CameraRig } from './render/cameraRig';
import { createScene } from './render/scene';
import { Hud } from './ui/hud';
import { setupMenu } from './ui/menu';

const settings = loadSettings();
const canvas = document.getElementById('view') as HTMLCanvasElement;
const bundle = createScene(canvas);
const { renderer, scene, camera } = bundle;

const physics = new PhysicsClient();
const controls = new Controls(settings);
setupTouchPads(controls);
const hud = new Hud();
hud.setTelemetryVisible(settings.telemetry);

// ---------------------------------------------------------------- Fahrzeug / Livree
let car!: CarModel;
function buildCar(): void {
  if (car) {
    scene.remove(car.root);
    car.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }
  const team = teams.find((t) => t.id === settings.team) ?? teams[0];
  const driver = drivers.find((d) => d.team === team.id) ?? drivers[0];
  const livery: Livery = {
    primary: team.colors.primary,
    secondary: team.colors.secondary,
    accent: team.colors.accent,
    number: driver.number,
    helmet: driver.helmet,
    compound: settings.compound,
  };
  car = new CarModel(TEST_CAR_2026, livery);
  scene.add(car.root);
  rig?.setMode(rig.mode, car);
}
const rig = new CameraRig(camera, canvas);
buildCar();
rig.setMode(settings.camera, car);
document.body.classList.toggle('showroom', settings.camera === 'showroom');

const menu = setupMenu(settings, controls, {
  onTeamChanged: buildCar,
  onCameraChanged: () => {
    rig.setMode(settings.camera, car);
    document.body.classList.toggle('showroom', settings.camera === 'showroom');
  },
  onTelemetryChanged: () => hud.setTelemetryVisible(settings.telemetry),
  onBrakeBias: (b) => physics.setBrakeBias(b),
  onQualityChanged: () => {
    qualityLocked = settings.quality !== 'auto';
    applyQuality();
  },
});
document.getElementById('buildInfo')!.textContent = `Build ${__BUILD__}`;

const resetCar = () => physics.reset(0, 0, 0, 0);
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
let pixelRatio = maxPixelRatio;
let qualityLocked = settings.quality !== 'auto';
function applyQuality(): void {
  if (settings.quality === 'high') pixelRatio = maxPixelRatio;
  else if (settings.quality === 'low') pixelRatio = 1;
  bundle.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = settings.quality !== 'low';
  bundle.sun.castShadow = settings.quality !== 'low';
}
applyQuality();

// ---------------------------------------------------------------- Hauptschleife
const input = newInput();
let last = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let fps = 60;
let loaded = false;
let lowCount = 0;
let highCount = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  controls.update(dt);
  controls.fill(input);
  physics.setInput(input);

  if (physics.sample()) {
    const s = physics.out;
    car.update(s, dt);
    rig.update(s, dt, car);
    bundle.updateEnvironment(s[S.x], -s[S.y]);
    hud.update(s, dt, settings.tc, settings.abs);
    if (!loaded) {
      loaded = true;
      document.getElementById('loading')!.classList.add('gone');
    }
  }
  renderer.render(scene, camera);

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
      if (lowCount >= 2 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        bundle.setPixelRatio(pixelRatio);
        lowCount = 0;
      } else if (lowCount >= 4 && renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = false;
        bundle.sun.castShadow = false;
        lowCount = 0;
      } else if (highCount >= 8 && pixelRatio < maxPixelRatio) {
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
(window as unknown as Record<string, unknown>).__formel = { physics, controls, settings, rig, get car() { return car; } };

// PWA: Service Worker (Netzwerk zuerst, Cache als Offline-Rückfall)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.hostname.match(/^(localhost|127\.)/)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
