import teams from '../data/teams.json';
import { MAP_LIST } from '../world/maps';
import type { Controls } from '../input/controls';
import { saveSettings, type Settings } from '../input/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuHooks {
  onTeamChanged: () => void;
  onCameraChanged: () => void;
  onTelemetryChanged: () => void;
  onBrakeBias: (bias: number) => void;
  onQualityChanged: () => void;
  onMainMenu?: () => void;
  onLineChanged?: () => void;
  onWeatherChanged?: () => void;
}

export function setupMenu(settings: Settings, controls: Controls, hooks: MenuHooks): { toggle: () => void } {
  const menu = $('menu');
  const toggle = () => menu.classList.toggle('hidden');
  $('btnMenu').addEventListener('click', toggle);
  $('menuClose').addEventListener('click', toggle);
  const mtabs = menu.querySelectorAll<HTMLButtonElement>('#menuTabs button');
  const mpanels = menu.querySelectorAll<HTMLElement>('.scroll section');
  mtabs.forEach((b) =>
    b.addEventListener('click', () => {
      mtabs.forEach((x) => x.classList.toggle('on', x === b));
      mpanels.forEach((p) => p.classList.toggle('mp-on', p.dataset.mp === b.dataset.mt));
      menu.querySelector<HTMLElement>('.scroll')!.scrollTop = 0;
    }),
  );
  $('btnMainMenu').addEventListener('click', () => {
    menu.classList.add('hidden');
    hooks.onMainMenu?.();
  });

  const persist = () => saveSettings(settings);
  const bindSelect = (id: string, get: () => string, set: (v: string) => void) => {
    const el = $<HTMLSelectElement>(id);
    el.value = get();
    el.addEventListener('change', () => {
      set(el.value);
      persist();
    });
    return el;
  };

  const applyBody = () => {
    document.body.classList.toggle('tilt', settings.control === 'tilt');
    document.body.classList.toggle('arrows', settings.control === 'arrows');
    $('rowTilt').style.display = settings.control === 'tilt' ? '' : 'none';
  };

  bindSelect('selControl', () => settings.control, (v) => {
    settings.control = v as Settings['control'];
    applyBody();
  });
  bindSelect('selTc', () => String(settings.tc), (v) => (settings.tc = Number(v)));
  bindSelect('selAbs', () => String(settings.abs), (v) => (settings.abs = Number(v)));
  bindSelect('selPit', () => (settings.pitAuto ? '1' : '0'), (v) => (settings.pitAuto = v === '1'));
  bindSelect('selLine', () => (settings.racingLine ? '1' : '0'), (v) => {
    settings.racingLine = v === '1';
    hooks.onLineChanged?.();
  });
  bindSelect('selWeather', () => settings.weather, (v) => {
    settings.weather = v as Settings['weather'];
    hooks.onWeatherChanged?.();
  });
  bindSelect('selSteer', () => String(settings.steerAssist), (v) => (settings.steerAssist = Number(v)));
  bindSelect('selCompound', () => settings.compound, (v) => {
    settings.compound = v as Settings['compound'];
    hooks.onTeamChanged();
  });
  bindSelect('selCam', () => settings.camera, (v) => {
    settings.camera = v as Settings['camera'];
    hooks.onCameraChanged();
  });
  bindSelect('selQuality', () => settings.quality, (v) => {
    settings.quality = v as Settings['quality'];
    hooks.onQualityChanged();
  });

  const mapSel = $<HTMLSelectElement>('selMap');
  for (const m of MAP_LIST) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name;
    mapSel.appendChild(o);
  }
  mapSel.value = settings.map;
  mapSel.addEventListener('change', () => {
    settings.map = mapSel.value as Settings['map'];
    persist();
    location.reload();
  });

  const teamSel = $<HTMLSelectElement>('selTeam');
  for (const t of teams) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.name} ${t.car}`;
    teamSel.appendChild(o);
  }
  teamSel.value = settings.team;
  teamSel.addEventListener('change', () => {
    settings.team = teamSel.value;
    persist();
    hooks.onTeamChanged();
  });

  const tel = $<HTMLInputElement>('chkTelemetry');
  tel.checked = settings.telemetry;
  tel.addEventListener('change', () => {
    settings.telemetry = tel.checked;
    persist();
    hooks.onTelemetryChanged();
  });

  const bias = $<HTMLInputElement>('rngBias');
  const biasVal = $('valBias');
  bias.value = String(settings.brakeBias * 100);
  biasVal.textContent = `${(settings.brakeBias * 100).toFixed(1)} %`;
  bias.addEventListener('input', () => {
    settings.brakeBias = Number(bias.value) / 100;
    biasVal.textContent = `${bias.value} %`;
    hooks.onBrakeBias(settings.brakeBias);
    persist();
  });

  const tilt = $<HTMLInputElement>('rngTilt');
  const tiltVal = $('valTilt');
  tilt.value = String(settings.tiltRange);
  tiltVal.textContent = `${settings.tiltRange}°`;
  tilt.addEventListener('input', () => {
    settings.tiltRange = Number(tilt.value);
    tiltVal.textContent = `${tilt.value}°`;
    persist();
  });

  const inv = $<HTMLInputElement>('chkTiltInv');
  inv.checked = settings.tiltInvert;
  inv.addEventListener('change', () => {
    settings.tiltInvert = inv.checked;
    persist();
  });

  const tiltState = $('tiltState');
  const enableTilt = async () => {
    const ok = await controls.tilt.enable();
    tiltState.textContent = ok ? 'aktiv – Gerät wie ein Lenkrad halten' : controls.tilt.supported ? 'Berechtigung verweigert' : 'nicht unterstützt';
    if (ok) controls.tilt.calibrate();
  };
  $('btnTilt').addEventListener('click', enableTilt);
  $('tiltCal').addEventListener('click', async () => {
    if (!controls.tilt.enabled) await enableTilt();
    else controls.tilt.calibrate();
  });

  applyBody();
  return { toggle };
}
