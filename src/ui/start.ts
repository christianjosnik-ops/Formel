import { MAP_LIST } from '../world/maps';
import { DRIVERS, teamOf } from '../race/field';
import { saveSettings, type Settings } from '../input/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Startbildschirm: Modus, Strecke, Fahrer, Rundenzahl, KI-Stärke, Startplatz, Steuerung. */
export function setupStart(settings: Settings, onGo: (mapChanged: boolean) => void): { show: () => void } {
  const el = $('start');
  const map = $<HTMLSelectElement>('stMap');
  for (const m of MAP_LIST) map.add(new Option(m.name, m.id));
  const drv = $<HTMLSelectElement>('stDriver');
  DRIVERS.forEach((d, i) => drv.add(new Option(`#${d.number} ${d.name} — ${teamOf(d).name}`, String(i))));

  const bind = (id: string, get: () => string, set: (v: string) => void) => {
    const s = $<HTMLSelectElement>(id);
    s.value = get();
    s.addEventListener('change', () => {
      set(s.value);
      sync();
    });
  };
  const sync = () => {
    const race = settings.mode === 'race';
    document.querySelectorAll('#start .rr').forEach((n) => n.classList.toggle('hide', !race));
    const solo = settings.aiLevel < 0;
    document.querySelectorAll('#start .ra').forEach((n) => n.classList.toggle('hide', !race || solo));
    $('stHint').textContent = settings.control === 'arrows' ? 'Rechts: ◀ ▶ lenken · Links: Bremse + Gas · Aero-Knopf rechts' : settings.control === 'tilt' ? 'Gerät wie ein Lenkrad neigen (Freigabe im Menü)' : 'Lenkband links/unten, Pedale rechts';
  };
  bind('stMode', () => settings.mode, (v) => (settings.mode = v as Settings['mode']));
  bind('stMap', () => settings.map, (v) => (settings.map = v as Settings['map']));
  bind('stDriver', () => String(settings.driver), (v) => (settings.driver = Number(v)));
  bind('stLaps', () => String(settings.laps), (v) => (settings.laps = Number(v)));
  bind('stAi', () => String(settings.aiLevel), (v) => (settings.aiLevel = Number(v)));
  bind('stField', () => String(settings.field), (v) => (settings.field = Number(v)));
  bind('stGrid', () => settings.grid, (v) => (settings.grid = v as Settings['grid']));
  bind('stControl', () => settings.control, (v) => (settings.control = v as Settings['control']));
  bind('stAssist', () => String(settings.steerAssist === 2 && settings.tc === 2 ? 2 : settings.tc), (v) => {
    const n = Number(v);
    settings.tc = n;
    settings.abs = n === 0 ? 0 : 1;
    settings.steerAssist = n === 2 ? 2 : n === 1 ? 1 : 0;
  });
  sync();
  const loadedMap = settings.map;
  $('stGo').addEventListener('click', () => {
    saveSettings(settings);
    el.classList.add('hidden');
    onGo(settings.map !== loadedMap);
  });
  return { show: () => el.classList.remove('hidden') };
}
