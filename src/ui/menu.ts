import teams from '../data/teams.json';
import type { Controls } from '../input/controls';
import { saveSettings, type Settings } from '../input/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuHooks {
  onTeamChanged: () => void;
  onCameraChanged: () => void;
  onTelemetryChanged: () => void;
  onBrakeBias: (bias: number) => void;
  onQualityChanged: () => void;
}

export function setupMenu(settings: Settings, controls: Controls, hooks: MenuHooks): { toggle: () => void } {
  const menu = $('menu');
  const toggle = () => menu.classList.toggle('hidden');
  $('btnMenu').addEventListener('click', toggle);
  $('menuClose').addEventListener('click', toggle);

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
    $('rowTilt').style.display = settings.control === 'tilt' ? '' : 'none';
  };

  bindSelect('selControl', () => settings.control, (v) => {
    settings.control = v as Settings['control'];
    applyBody();
  });
  bindSelect('selTc', () => String(settings.tc), (v) => (settings.tc = Number(v)));
  bindSelect('selAbs', () => String(settings.abs), (v) => (settings.abs = Number(v)));
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
