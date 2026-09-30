import { DRIVERS, TEAMS, teamOf, teamPerformance } from '../race/field';
import { saveSettings, type Settings } from '../input/settings';
import { createMap, MAP_LIST, type MapId } from '../world/maps';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const MODES: Array<{ id: Settings['mode']; name: string; ico: string; text: string }> = [
  { id: 'race', name: 'Rennen', ico: '🏁', text: 'Startaufstellung, Ampelstart und Rennen gegen das Feld. Live-Rangliste mit Zeitabständen.' },
  { id: 'weekend', name: 'Rennwochenende', ico: '🏆', text: 'Qualifying mit Zeitenjagd, danach das Rennen – dein Startplatz hängt von deiner schnellsten Runde ab.' },
  { id: 'free', name: 'Freies Fahren', ico: '⏱', text: 'Allein auf der Strecke: Rundenzeiten jagen, Fahrwerk und Crash-Verhalten testen.' },
];

const MAP_TEXT: Record<string, string> = {
  monza: 'Der Tempel der Geschwindigkeit: lange Geraden, harte Bremszonen, Schikanen.',
  spa: 'Ardennen-Klassiker mit Eau Rouge, Wald und extrem schnellen Passagen.',
  silverstone: 'Schnelle Kurvenkombinationen wie Maggotts–Becketts und Copse.',
  proving: 'Testgelände mit Barrieren und Hütchen für Crash-Versuche.',
};

const SELECTS: Array<{ id: string; label: string; opts: Array<[string, string]>; get: (s: Settings) => string; set: (s: Settings, v: string) => void; only?: Array<Settings['mode']> }> = [
  { id: 'laps', label: 'Renndistanz', opts: [['1', '1 Runde'], ['2', '2 Runden'], ['3', '3 Runden'], ['5', '5 Runden'], ['10', '10 Runden'], ['20', '20 Runden']], get: (s) => String(s.laps), set: (s, v) => (s.laps = Number(v)), only: ['race', 'weekend'] },
  { id: 'ai', label: 'Gegner (KI)', opts: [['-1', 'Aus – allein fahren'], ['0', 'Anfänger'], ['1', 'Mittel'], ['2', 'Profi'], ['3', 'Legende']], get: (s) => String(s.aiLevel), set: (s, v) => (s.aiLevel = Number(v)), only: ['race', 'weekend'] },
  { id: 'field', label: 'Starterfeld', opts: [['22', '22 Autos'], ['12', '12 Autos'], ['6', '6 Autos']], get: (s) => String(s.field), set: (s, v) => (s.field = Number(v)), only: ['race', 'weekend'] },
  { id: 'grid', label: 'Startplatz', opts: [['pole', 'Pole Position'], ['mid', 'Mittelfeld'], ['last', 'Letzter Platz'], ['random', 'Zufällig']], get: (s) => s.grid, set: (s, v) => (s.grid = v as Settings['grid']), only: ['race'] },
  { id: 'assist', label: 'Fahrhilfen', opts: [['2', 'Stark (Einsteiger)'], ['1', 'Mittel'], ['0', 'Aus (Profi)']], get: (s) => String(s.tc), set: (s, v) => { const n = Number(v); s.tc = n; s.abs = n === 0 ? 0 : 1; s.steerAssist = n; } },
  { id: 'control', label: 'Steuerung', opts: [['arrows', 'Pfeile rechts · Pedale links'], ['touch', 'Lenkband + Pedale'], ['tilt', 'Neigung']], get: (s) => s.control, set: (s, v) => (s.control = v as Settings['control']) },
  { id: 'limits', label: 'Streckenlimits', opts: [['0', 'Aus'], ['1', 'Ein (ungültige Runden)']], get: (s) => (s.trackLimits ? '1' : '0'), set: (s, v) => (s.trackLimits = v === '1') },
  { id: 'quality', label: 'Grafik', opts: [['auto', 'Automatisch (60 FPS)'], ['high', 'Hoch'], ['low', 'Niedrig']], get: (s) => s.quality, set: (s, v) => (s.quality = v as Settings['quality']) },
];

function drawTrack(canvas: HTMLCanvasElement, id: MapId): number {
  const m = createMap(id);
  const t = m.track;
  const g = canvas.getContext('2d')!;
  const w = (canvas.width = 360);
  const h = (canvas.height = 160);
  g.clearRect(0, 0, w, h);
  if (!t) {
    g.strokeStyle = 'rgba(255,255,255,.5)';
    g.strokeRect(40, 30, w - 80, h - 60);
    return 0;
  }
  const sx = (w - 30) / (t.maxX - t.minX);
  const sy = (h - 24) / (t.maxY - t.minY);
  const k = Math.min(sx, sy);
  const ox = (w - (t.maxX - t.minX) * k) / 2;
  const oy = (h - (t.maxY - t.minY) * k) / 2;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    for (let i = 0; i <= t.n; i += 3) {
      const j = i % t.n;
      const x = ox + (t.x[j] - t.minX) * k;
      const y = h - (oy + (t.y[j] - t.minY) * k);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.lineWidth = 9;
  path();
  g.stroke();
  g.strokeStyle = '#e8edf5';
  g.lineWidth = 4.5;
  path();
  g.stroke();
  // Start/Ziel
  g.fillStyle = '#e10600';
  g.beginPath();
  g.arc(ox + (t.x[0] - t.minX) * k, h - (oy + (t.y[0] - t.minY) * k), 5.5, 0, Math.PI * 2);
  g.fill();
  return t.length;
}

/** Hauptmenü: Modus, Strecke, Team/Fahrer, Einstellungen. */
export function setupStart(settings: Settings, onGo: (mapChanged: boolean) => void): { show: () => void } {
  const el = $('start');
  const loadedMap = settings.map;
  const tabs = document.querySelectorAll<HTMLButtonElement>('#mmTabs button');
  const panels = document.querySelectorAll<HTMLElement>('#mmBody section');
  const showTab = (name: string) => {
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    panels.forEach((p) => p.classList.toggle('panel-on', p.dataset.panel === name));
    if (name === 'track') buildTracks();
    $('mmBody').scrollTop = 0;
  };
  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab!)));

  const summary = () => {
    const mode = MODES.find((m) => m.id === settings.mode)!;
    const d = DRIVERS[settings.driver] ?? DRIVERS[0];
    const map = MAP_LIST.find((m) => m.id === settings.map)!;
    const ai = ['Anfänger', 'Mittel', 'Profi', 'Legende'][settings.aiLevel] ?? 'keine KI';
    const race = settings.mode !== 'free';
    $('mmSummary').innerHTML = `<b>${mode.name}</b> · ${map.name} · <b>#${d.number} ${d.name}</b> (${teamOf(d).name})${race ? ` · ${settings.laps} Runden · KI: ${settings.aiLevel < 0 ? 'aus' : ai}` : ''}`;
  };

  // ---- Modus ----
  const modeBox = $('modeCards');
  const buildModes = () => {
    modeBox.innerHTML = '';
    for (const m of MODES) {
      const c = document.createElement('div');
      c.className = `card${settings.mode === m.id ? ' on' : ''}`;
      c.innerHTML = `<span class="ico">${m.ico}</span><h3>${m.name}</h3><p>${m.text}</p>`;
      c.addEventListener('click', () => {
        settings.mode = m.id;
        buildModes();
        buildOpts();
        summary();
      });
      modeBox.appendChild(c);
    }
  };

  // ---- Strecke ----
  const trackBox = $('trackCards');
  const buildTracks = () => {
    trackBox.innerHTML = '';
    for (const m of MAP_LIST) {
      const c = document.createElement('div');
      c.className = `card${settings.map === m.id ? ' on' : ''}`;
      const cv = document.createElement('canvas');
      c.appendChild(cv);
      const h = document.createElement('h3');
      h.textContent = m.name;
      const p = document.createElement('p');
      p.textContent = MAP_TEXT[m.id] ?? '';
      const meta = document.createElement('div');
      meta.className = 'meta';
      c.append(h, p, meta);
      c.addEventListener('click', () => {
        settings.map = m.id;
        trackBox.querySelectorAll('.card').forEach((x) => x.classList.remove('on'));
        c.classList.add('on');
        summary();
      });
      trackBox.appendChild(c);
      setTimeout(() => {
        const len = drawTrack(cv, m.id);
        meta.textContent = len ? `${(len / 1000).toFixed(2)} km` : 'Testgelände';
      }, 0);
    }
  };

  // ---- Team / Fahrer ----
  const teamBox = $('teamGrid');
  const info = $('driverInfo');
  const bar = (label: string, v: number) => `<div class="rbar"><span>${label}</span><i style="--v:${Math.max(0, Math.min(100, v))}%"></i><b>${Math.round(v)}</b></div>`;
  const buildInfo = () => {
    const d = DRIVERS[settings.driver] ?? DRIVERS[0];
    const t = teamOf(d);
    const perf = teamPerformance(t);
    info.innerHTML = `<h4>#${d.number} ${d.name} · ${t.name} ${t.car}</h4>${bar('Tempo', d.pace)}${bar('Zweikampf', d.racecraft)}${bar('Reifenpflege', d.tyres)}${bar('Nässe', d.wet)}${bar('Konstanz', d.consistency)}${bar('Motor', t.engineRating ?? t.overall - 4)}${bar('Aerodynamik', t.aero ?? t.overall - 2)}${bar('Teamstärke', t.overall)}<span class="muted" style="grid-column:1/-1">Motor: ${t.engine} · Leistung ${(perf.power * 100).toFixed(1)} % · Abtrieb ${(perf.aero * 100).toFixed(1)} %</span>`;
  };
  const buildTeams = () => {
    teamBox.innerHTML = '';
    for (const t of TEAMS) {
      const drivers = DRIVERS.map((d, i) => ({ d, i })).filter((x) => x.d.team === t.id);
      if (!drivers.length) continue;
      const box = document.createElement('div');
      const onTeam = drivers.some((x) => x.i === settings.driver);
      box.className = `team${onTeam ? ' on' : ''}`;
      const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5, 7), 16) * 0.11;
      const head = document.createElement('div');
      head.className = 'th';
      head.style.background = `linear-gradient(100deg, ${t.colors.primary} 0%, ${t.colors.primary} 55%, ${t.colors.secondary} 100%)`;
      head.style.color = lum(t.colors.primary) > 150 ? '#0b0f14' : '#fff';
      head.style.textShadow = lum(t.colors.primary) > 150 ? 'none' : '';
      head.innerHTML = `${t.name}<small>${t.car}</small>`;
      box.appendChild(head);
      for (const { d, i } of drivers) {
        const b = document.createElement('button');
        b.className = `drv${i === settings.driver ? ' on' : ''}`;
        b.innerHTML = `<b>${d.number}</b>${d.name}`;
        b.addEventListener('click', () => {
          settings.driver = i;
          buildTeams();
          buildInfo();
          summary();
        });
        box.appendChild(b);
      }
      teamBox.appendChild(box);
    }
  };

  // ---- Einstellungen ----
  const optBox = $('optGrid');
  const buildOpts = () => {
    optBox.innerHTML = '';
    for (const o of SELECTS) {
      if (o.only && !o.only.includes(settings.mode)) continue;
      if (o.id === 'field' && settings.aiLevel < 0 && settings.mode !== 'free') continue;
      const row = document.createElement('div');
      row.className = 'opt';
      const l = document.createElement('label');
      l.textContent = o.label;
      const s = document.createElement('select');
      for (const [v, n] of o.opts) s.add(new Option(n, v));
      s.value = o.get(settings);
      s.addEventListener('change', () => {
        o.set(settings, s.value);
        if (o.id === 'ai') buildOpts();
        summary();
      });
      row.append(l, s);
      optBox.appendChild(row);
    }
  };

  buildModes();
  buildTeams();
  buildInfo();
  buildOpts();
  summary();
  $('stGo').addEventListener('click', () => {
    saveSettings(settings);
    el.classList.add('hidden');
    document.body.classList.remove('inmenu');
    onGo(settings.map !== loadedMap);
  });
  return {
    show: () => {
      showTab('mode');
      buildModes();
      buildTeams();
      buildInfo();
      buildOpts();
      summary();
      el.classList.remove('hidden');
      document.body.classList.add('inmenu');
    },
  };
}
