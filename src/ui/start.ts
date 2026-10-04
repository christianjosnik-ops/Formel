import { DRIVERS, TEAMS, teamOf, teamPerformance } from '../race/field';
import { saveSettings, type Settings } from '../input/settings';
import { createMap, MAP_LIST, type MapId } from '../world/maps';
import { buy, MAX_LEVEL, UPGRADE_INFO, upgradeCost, type Career } from '../career';

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

interface Choice {
  id: string;
  label: string;
  hint?: string;
  opts: Array<[string, string, string?]>;
  get: (s: Settings) => string;
  set: (s: Settings, v: string) => void;
  only?: Array<Settings['mode']>;
  show?: (s: Settings) => boolean;
}
interface Group {
  title: string;
  ico: string;
  items: Choice[];
  only?: Array<Settings['mode']>;
}

const COMPOUND_DOT: Record<string, string> = { soft: '#ff3b30', medium: '#ffd12e', hard: '#f2f2f2' };

const LAPS: Choice = { id: 'laps', label: 'Renndistanz', opts: [['1', '1'], ['3', '3'], ['5', '5'], ['10', '10'], ['20', '20']], hint: 'Runden', get: (s) => String(s.laps), set: (s, v) => (s.laps = Number(v)) };
const AI: Choice = { id: 'ai', label: 'Gegner (KI)', opts: [['-1', 'Aus'], ['0', 'Anfänger'], ['1', 'Mittel'], ['2', 'Profi'], ['3', 'Legende']], get: (s) => String(s.aiLevel), set: (s, v) => (s.aiLevel = Number(v)) };
const FIELD: Choice = { id: 'field', label: 'Starterfeld', opts: [['6', '6'], ['12', '12'], ['22', '22']], hint: 'Autos', get: (s) => String(s.field), set: (s, v) => (s.field = Number(v)), show: (s) => s.aiLevel >= 0 };
const GRID: Choice = { id: 'grid', label: 'Startplatz', opts: [['pole', 'Pole'], ['mid', 'Mitte'], ['last', 'Letzter'], ['random', 'Zufall']], get: (s) => s.grid, set: (s, v) => (s.grid = v as Settings['grid']), only: ['race'] };
const PIT: Choice = { id: 'pitauto', label: 'Boxenstopp', opts: [['1', 'Automatik', 'BOX-Knopf genügt'], ['0', 'Manuell', 'selbst einfahren & halten']], get: (s) => (s.pitAuto ? '1' : '0'), set: (s, v) => (s.pitAuto = v === '1') };
const COMPOUND: Choice = { id: 'compound', label: 'Startreifen', opts: [['soft', 'Soft', 'schnell, verschleißt'], ['medium', 'Medium', 'Allrounder'], ['hard', 'Hard', 'hält lange']], get: (s) => (['soft', 'medium', 'hard'].includes(s.compound) ? s.compound : 'medium'), set: (s, v) => (s.compound = v as Settings['compound']) };
const WEAR: Choice = { id: 'wear', label: 'Reifenverschleiß', opts: [['0', 'Aus'], ['1', 'Normal'], ['2', 'Hoch', 'Boxenstopps nötig']], get: (s) => String(s.wear), set: (s, v) => (s.wear = Number(v)) };
const LIMITS: Choice = { id: 'limits', label: 'Streckenlimits', opts: [['0', 'Aus'], ['1', 'Ein', 'ungültige Runden']], get: (s) => (s.trackLimits ? '1' : '0'), set: (s, v) => (s.trackLimits = v === '1') };

const SETUP: Group[] = [
  { title: 'Rennen', ico: '🏁', only: ['race', 'weekend'], items: [LAPS, AI, FIELD, GRID] },
  { title: 'Boxenstopp & Reifen', ico: '🛞', items: [PIT, COMPOUND, WEAR] },
  { title: 'Regeln', ico: '⚖️', items: [LIMITS] },
];

const DRIVE: Group[] = [
  { title: 'Fahrhilfen', ico: '🛟', items: [{ id: 'assist', label: 'Stabilität', opts: [['2', 'Stark', 'Einsteiger'], ['1', 'Mittel'], ['0', 'Aus', 'Profi']], get: (s) => String(s.tc), set: (s, v) => { const n = Number(v); s.tc = n; s.abs = n === 0 ? 0 : 1; s.steerAssist = n; } }] },
  { title: 'Steuerung', ico: '🎮', items: [{ id: 'control', label: 'Eingabe', opts: [['arrows', 'Pfeile', 'rechts lenken · links Pedale'], ['touch', 'Lenkband', 'mit Pedalen'], ['tilt', 'Neigung']], get: (s) => s.control, set: (s, v) => (s.control = v as Settings['control']) }] },
  { title: 'Ideallinie', ico: '🧭', items: [{ id: 'line', label: 'Fahrlinie', hint: 'Bremspunkte anzeigen', opts: [['0', 'Aus'], ['1', 'Ein', 'grün Gas · rot Bremsen']], get: (s) => (s.racingLine ? '1' : '0'), set: (s, v) => (s.racingLine = v === '1') }] },
  { title: 'Wetter & Licht', ico: '⛅', items: [{ id: 'weather', label: 'Stimmung', opts: [['sunny', 'Sonnig', 'klarer Himmel'], ['overcast', 'Bewölkt', 'weiches Licht'], ['evening', 'Abendlicht', 'tiefe Sonne']], get: (s) => s.weather, set: (s, v) => (s.weather = v as Settings['weather']) }] },
  { title: 'Grafik', ico: '🖥', items: [{ id: 'quality', label: 'Qualität', opts: [['auto', 'Auto', '60 FPS halten'], ['high', 'Hoch'], ['low', 'Niedrig']], get: (s) => s.quality, set: (s, v) => (s.quality = v as Settings['quality']) }] },
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

/** Geschätzte Boxenstrategie aus Renndistanz und Verschleiß. */
function strategyHint(s: Settings): string {
  if (s.mode === 'free') return 'Freies Fahren: keine Boxenpflicht, Reifen und Auto nach Belieben testen.';
  if (s.wear === 0) return 'Reifen verschleißen nicht – ein Boxenstopp ist nicht nötig.';
  if (s.laps < 3) return 'Kurzes Rennen: ein Boxenstopp lohnt sich kaum.';
  const stints = s.wear === 2 ? (s.laps >= 10 ? 2 : s.laps >= 5 ? 1 : 0) : s.laps >= 20 ? 2 : s.laps >= 10 ? 1 : 0;
  if (stints === 0) return 'Mit einem Satz Reifen machbar – ein Stopp ist optional.';
  const seq = stints === 1 ? 'Medium → Hard' : 'Soft → Medium → Hard';
  return `Empfohlen: ${stints} Boxenstopp${stints > 1 ? 's' : ''} (${seq}). ${s.pitAuto ? 'Mit der Automatik genügt der BOX-Knopf.' : 'Manuell: in die Gasse links fahren und in der Box halten.'}`;
}

/** Hauptmenü: Spiel (Modus + Rennaufbau), Strecke, Team/Fahrer, Karriere, Fahren. */
export function setupStart(settings: Settings, career: Career, onGo: (mapChanged: boolean) => void): { show: () => void } {
  const el = $('start');
  const loadedMap = settings.map;
  const tabs = document.querySelectorAll<HTMLButtonElement>('#mmTabs button');
  const panels = document.querySelectorAll<HTMLElement>('#mmBody section');
  const showTab = (name: string) => {
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    panels.forEach((p) => p.classList.toggle('panel-on', p.dataset.panel === name));
    if (name === 'track') buildTracks();
    if (name === 'garage') buildGarage();
    $('mmBody').scrollTop = 0;
  };
  tabs.forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab!)));

  const aiName = () => ['Anfänger', 'Mittel', 'Profi', 'Legende'][settings.aiLevel] ?? 'aus';
  const summary = () => {
    const mode = MODES.find((m) => m.id === settings.mode)!;
    const d = DRIVERS[settings.driver] ?? DRIVERS[0];
    const map = MAP_LIST.find((m) => m.id === settings.map)!;
    const race = settings.mode !== 'free';
    $('mmSummary').innerHTML = `<b>${mode.name}</b> · ${map.name} · <b>#${d.number} ${d.name}</b> <span>${teamOf(d).name}</span>${race ? ` · ${settings.laps} Runden · KI ${aiName()}` : ''}`;
  };

  // ---- Spiel: Modus-Umschalter, Aufbau in Gruppen, Übersichtskarte ----
  const modeSeg = $('modeSeg');
  const modeText = $('modeText');
  const groupBox = $('setupGroups');
  const sideBox = $('sideCard');
  const sideCv = document.createElement('canvas');
  let sideMap = '';
  let sideLen = 0;

  const chipGroup = (c: Choice, onChange: () => void): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'choice';
    const l = document.createElement('div');
    l.className = 'clabel';
    l.innerHTML = c.hint ? `${c.label}<small>${c.hint}</small>` : c.label;
    const seg = document.createElement('div');
    seg.className = 'seg';
    const cur = c.get(settings);
    for (const [v, n, h] of c.opts) {
      const b = document.createElement('button');
      b.className = `chip2${v === cur ? ' on' : ''}`;
      const dot = c.id === 'compound' ? `<i class="dot" style="background:${COMPOUND_DOT[v] ?? '#fff'}"></i>` : '';
      b.innerHTML = `${dot}<span>${n}</span>${h ? `<small>${h}</small>` : ''}`;
      b.addEventListener('click', () => {
        c.set(settings, v);
        onChange();
      });
      seg.appendChild(b);
    }
    row.append(l, seg);
    return row;
  };

  const buildGroups = (box: HTMLElement, groups: Group[]) => {
    box.innerHTML = '';
    for (const g of groups) {
      if (g.only && !g.only.includes(settings.mode)) continue;
      const items = g.items.filter((c) => (!c.only || c.only.includes(settings.mode)) && (!c.show || c.show(settings)));
      // Im freien Fahren zählen Pit-Optionen nicht
      const list = settings.mode === 'free' ? items.filter((c) => c.id !== 'pitauto') : items;
      if (!list.length) continue;
      const sec = document.createElement('div');
      sec.className = 'group';
      const h = document.createElement('h4');
      h.innerHTML = `<i>${g.ico}</i>${g.title}`;
      sec.appendChild(h);
      for (const c of list) sec.appendChild(chipGroup(c, refresh));
      box.appendChild(sec);
    }
  };

  const buildSide = () => {
    const mode = MODES.find((m) => m.id === settings.mode)!;
    const map = MAP_LIST.find((m) => m.id === settings.map)!;
    const d = DRIVERS[settings.driver] ?? DRIVERS[0];
    const team = teamOf(d);
    if (sideMap !== settings.map) {
      sideMap = settings.map;
      sideLen = drawTrack(sideCv, settings.map);
    }
    const race = settings.mode !== 'free';
    const km = sideLen / 1000;
    const rows: Array<[string, string]> = [['Modus', mode.name], ['Strecke', `${map.name}${sideLen ? ` · ${km.toFixed(2)} km` : ''}`], ['Fahrer', `#${d.number} ${d.name}`]];
    if (race) {
      rows.push(['Distanz', `${settings.laps} Runden${sideLen ? ` · ${(km * settings.laps).toFixed(1)} km` : ''}`]);
      rows.push(['Gegner', settings.aiLevel < 0 ? 'keine' : `${aiName()} · ${settings.field} Autos`]);
      if (settings.mode === 'race') rows.push(['Start', { pole: 'Pole Position', mid: 'Mittelfeld', last: 'Letzter Platz', random: 'Zufällig' }[settings.grid]]);
      else rows.push(['Start', 'nach Qualifying']);
      rows.push(['Boxenstopp', settings.pitAuto ? 'Automatik' : 'Manuell']);
    }
    rows.push(['Reifen', `${['Soft', 'Medium', 'Hard'][['soft', 'medium', 'hard'].indexOf(settings.compound)] ?? 'Medium'} · Verschleiß ${['aus', 'normal', 'hoch'][settings.wear] ?? 'normal'}`]);
    sideBox.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'sideHead';
    head.style.setProperty('--team', team.colors.primary);
    head.innerHTML = `<span>${map.name}</span><small>${team.name} ${team.car}</small>`;
    sideBox.append(head, sideCv);
    const dl = document.createElement('dl');
    dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = strategyHint(settings);
    const go = document.createElement('button');
    go.className = 'sideGo';
    go.textContent = settings.mode === 'free' ? 'Freies Fahren starten' : settings.mode === 'weekend' ? 'Qualifying starten' : 'Rennen starten';
    go.addEventListener('click', () => $('stGo').click());
    sideBox.append(dl, hint, go);
  };

  const buildModes = () => {
    modeSeg.innerHTML = '';
    for (const m of MODES) {
      const b = document.createElement('button');
      b.className = `modeBtn${settings.mode === m.id ? ' on' : ''}`;
      b.innerHTML = `<i>${m.ico}</i><span>${m.name}</span>`;
      b.addEventListener('click', () => {
        settings.mode = m.id;
        refresh();
      });
      modeSeg.appendChild(b);
    }
    modeText.textContent = MODES.find((m) => m.id === settings.mode)!.text;
  };

  const optBox = $('optGroups');
  function refresh(): void {
    buildModes();
    buildGroups(groupBox, SETUP);
    buildGroups(optBox, DRIVE);
    buildSide();
    summary();
  }

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
        buildSide();
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
          buildSide();
          summary();
        });
        box.appendChild(b);
      }
      teamBox.appendChild(box);
    }
  };

  // ---- Karriere: Guthaben, Statistik, Werkstatt ----
  const garageBox = $('garageCards');
  const garageHead = $('garageHead');
  const buildGarage = () => {
    const st = career.stats;
    const total = UPGRADE_INFO.reduce((a, u) => a + career.up[u.id], 0);
    garageHead.innerHTML = `
      <div class="money"><span>Guthaben</span><b>${career.money.toLocaleString('de-DE')} €</b><small>Preisgeld gibt es für Platzierungen. Upgrades gelten für dein Auto.</small></div>
      <div class="stats">
        <div><b>${st.races}</b><span>Rennen</span></div>
        <div><b>${st.wins}</b><span>Siege</span></div>
        <div><b>${st.podiums}</b><span>Podien</span></div>
        <div><b>${st.best ? `P${st.best}` : '–'}</b><span>Bestplatz</span></div>
        <div><b>${total}/${UPGRADE_INFO.length * MAX_LEVEL}</b><span>Ausbau</span></div>
      </div>`;
    garageBox.innerHTML = '';
    for (const u of UPGRADE_INFO) {
      const lvl = career.up[u.id];
      const c = document.createElement('div');
      c.className = 'card up';
      const cost = upgradeCost(lvl);
      const pips = Array.from({ length: MAX_LEVEL }, (_, k) => `<i class="${k < lvl ? 'on' : ''}"></i>`).join('');
      c.innerHTML = `<span class="ico">${u.ico}</span><h3>${u.name}</h3><p>${u.per}</p><div class="pips">${pips}</div><div class="lvl">Stufe ${lvl} / ${MAX_LEVEL}</div>`;
      const b = document.createElement('button');
      b.className = 'buy';
      if (lvl >= MAX_LEVEL) {
        b.textContent = 'MAX';
        b.disabled = true;
      } else {
        b.textContent = `Stufe ${lvl + 1} · ${cost.toLocaleString('de-DE')} €`;
        b.disabled = career.money < cost;
      }
      b.addEventListener('click', () => {
        if (buy(career, u.id)) buildGarage();
      });
      c.appendChild(b);
      garageBox.appendChild(c);
    }
  };

  buildTeams();
  buildInfo();
  refresh();
  $('stGo').addEventListener('click', () => {
    saveSettings(settings);
    el.classList.add('hidden');
    document.body.classList.remove('inmenu');
    onGo(settings.map !== loadedMap);
  });
  return {
    show: () => {
      showTab('mode');
      buildTeams();
      buildInfo();
      refresh();
      el.classList.remove('hidden');
      document.body.classList.add('inmenu');
    },
  };
}
