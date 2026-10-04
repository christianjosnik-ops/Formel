# Rennmodus

- **Startbildschirm**: Modus (Rennen / Freies Fahren), Strecke, Fahrer/Team (22 Fahrer 2026), Runden (1–20), KI-Stärke (Aus, Anfänger, Mittel, Profi, Legende), Feldgröße, Startplatz (Pole/Mittelfeld/Letzter/Zufall), Steuerung, Fahrhilfen.
- **Steuerung „Pfeiltasten“**: rechts ◀ ▶ (digitale Lenkung mit Rampe), links Bremse + Gas, Aero-Knopf rechts.
- **KI** (`src/race/`): Ideallinie + Geschwindigkeitsprofil (`line.ts`), Pure-Pursuit-Fahrer mit Folgen/Überholen/Fehlern (`ai.ts`), Teamleistung nur über Motorleistung/Abtrieb (`field.ts`, kalibriert: Rückstände aus `teams.json` ±0.35 s), Rennleitung (`race.ts`: Aufstellung, Startampel, Runden, Zielüberfahrt, Ausfälle/Streckenposten, Windschatten und verwirbelte Luft).
- **Zeitabstände**: Jedes Auto speichert alle 50 m die Zeit; der Abstand zu einem Auto ist die Zeit, die seit dessen Durchfahrt derselben Stelle vergangen ist (wie in der echten Zeitnahme). Überrundete: „+N Rd“.
- Alle Autos laufen in derselben Physik (Worker, 500 Hz); Snapshot enthält je Auto einen Block (`layout.ts`, `CAR_BLOCK`).
- Tests: `tests/race.test.ts` (Feld, Teamabstände, Startaufstellung/Ampel, 22-Auto-Runde).

## Reifen, Boxenstopps, Werkstatt

- **Reifenmodell** (`src/config/tyres.ts`, `vehicle.ts`): je Rad Kerntemperatur und Verschleiß. Wärme aus Schlupfleistung und Walkarbeit, Kühlung durch Fahrtwind. Gripfaktor = Mischung × Temperaturfenster × Verschleiß (linear, am Ende steiler Abfall). Mischungen Soft/Medium/Hard (Grip und Verschleißrate unterschiedlich), Einstellung „Reifenverschleiß“ aus/normal/hoch.
- **Boxengasse** (`src/world/track.ts`, `PIT`): links der Start/Ziel-Geraden, 15 m breit, mit Boxenmauer, 22 Boxen in Teamfarben, Begrenzer 80 km/h, Einfahrt 430 m vor der Linie.
- **KI-Stopps** (`src/race/race.ts`): Stopp bei hohem Verschleiß (nicht in den letzten 1,4 Runden), Mischung nach Restdistanz, Anfahrt mit Tempolimit, Reifenwechsel 2,4–3,4 s.
- **Spieler**: Knopf „BOX“ (Taste P) fordert den Stopp an, Mischung wählbar; in der Boxengasse begrenzt das Auto selbst auf 80 km/h, an der eigenen Box anhalten → Reifenwechsel.
- **Werkstatt** (`src/career.ts`): Preisgeld nach Platzierung, Upgrades (Antrieb, Aerodynamik, Bremsen, Reifenpflege, Leichtbau; je 5 Stufen) wirken nur über physikalische Größen. Stand im Browser gespeichert.
- **Höhenprofile** (`src/world/elevation.ts`): Näherungen für Monza, Spa und Silverstone; Hangabtriebskraft in der Physik, Gelände/Strecke/Bauwerke folgen der Höhe.

## Klang und Crash-Wirkung

- `src/audio/audio.ts`: prozeduraler Ton (Web Audio): V6-Turbo-Hybrid mit Drehzahl/Last/Hybrid-Heulen, Reifenquietschen, Wind, Aufprall- und Schleifgeräusche, Gegner-Motoren mit Abstand, Stereo und Doppler, Startampel-Pieptöne, Boxen-Schlagschrauber. Lautstärke im Menü, Stumm-Knopf oben.
- Schwere Crashs (Stufe ≥ 3): Zeitlupe (Worker-Zeitskala), roter Blitz, Vibration, Rauch aus dem Heck bei Motorschaden.
- Wrack-Verhalten: schleifender Unterboden, fehlende Räder und platte Reifen bremsen stark (`wreckDrag`), das Auto „driftet“ nicht mehr einfach davon.
- Reifenbarrieren: Reifen werden bei Aufprall herausgeschleudert (`BODY_TYRE`), Strecken-Barrieren zeigen gestapelte Reifen.

## KI-Rennintelligenz (v2)

Jede KI bekommt von `RaceDirector.neighbours` eine Liste aller Autos im Bereich -60 m .. +170 m (Abstand, Querposition, Tempo, `wreck` = ausgefallen, seit >3,5 s stehend oder quer schleudernd). `AIDriver.update` entscheidet daraus:

- **Ausweichen**: Hindernisse voraus (Unfall, Dreher) → früh bremsen, freie Seite wählen (`evade`), seitlich vorbei mit Schrittgeschwindigkeit.
- **Angreifen**: schnelleres Auto im Windschatten setzt auf der Geraden/Bremszone zum Überholen an, bevorzugt die Innenseite der nächsten Kurve, hält den Querabstand zum Ziel und bremst bei Überlappung innen etwas später. Maximal 7 s pro Versuch, danach Pause.
- **Verteidigen**: Verfolger dicht dahinter → einmal vor der Bremszone die Innenlinie zumachen (kein Zickzack).
- **Nebeneinander**: Querabstand ≥ 2,7 m, in der Kurve gibt der Außenmann nach (`yield`).
- **Kollisionsvermeidung** unabhängig von der Absicht: kein Auto in der eigenen Spur wird in unter ~1,2 s erreicht.

## Fahrgefühl (v2)

Mit Fahrhilfe (Stufe 1/2) entspricht voller Lenkeinschlag der Grip-Grenze des Autos (`Vehicle.maxSteerAt`/`gripLimit`), die Assist-Gierrate wird auf den Grip begrenzt. Beschleunigung: 0–100 km/h ≈ 2,4 s, 0–200 ≈ 5,3 s, 0–300 ≈ 11 s (Start-Kennfeld begrenzt das Moment bei niedrigem Tempo, MGU-K-Abregelung ab 280 km/h).

## Boxenstopp (Automatik und Animation)

- **Boxen-Automatik** (Einstellung "Boxenstopp", Standard an): Ein Druck auf BOX (Taste P) genügt. Hinter der Boxeneinfahrt übernimmt die Boxen-KI (`RaceDirector.pitAI` mit `pitDriver`) das Auto: Einfahrt mit 80 km/h, Halt in der eigenen Box, Reifenwechsel, Ausfahrt. Danach hat der Spieler wieder die Kontrolle. "Manuell" fährt wie bisher selbst. Bei verschlissenen Reifen (>72 %) blinkt ein Hinweis.
- **Animation** (`src/render/pitCrew.ts`, Modell `public/models/pitcrew.glb` aus `tools/make_pitcrew.py`): 18 gegliederte Mechaniker (Overall in Teamfarbe, Helm mit Visier, Handschuhe, Stiefel) folgen dem Ablauf eines echten F1-Stopps – Anlauf aus der Garage (rechte Seite um Nase bzw. Heck herum), Wagenheber vorn/hinten, je Rad Schrauber / Rad ab / Rad an, zwei Frontflügel-Einsteller, Heck-Stabilisierer, Feuerlöscher, Handzeichen, Freigabe und Rückzug. Die Posen entstehen in Blender per Zwei-Gelenk-IK (Hände greifen Radmutter, Reifen, Wagenheber-Griff, Flügel), die Animation ist ein 5-s-Clip, der im Spiel nicht abgespielt, sondern gescrubbt wird: Anlauf nach Abstand zur Box (`S.pitDBox`, 30 m), Service nach Standzeit (`pitTimer/pitSvc`, 2,6 s Nennablauf), Rückzug nach Abstand hinter der Box (24 m). Die Leerobjekte `CarLift` und `WheelVis_*` im Clip steuern `CarModel.serviceLift/serviceHide`; die neue Mischung (Farbring) erscheint beim Aufsetzen des Rades. Beim Spieler blendet eine Boxen-Kamera zur Nahansicht über. Neu erzeugen: `python tools/make_pitcrew.py public/models/pitcrew.glb` (Blender-`bpy`).

## Menüs

- **Hauptmenü** (`src/ui/start.ts`, Reiter Spiel · Strecke · Team · Karriere · Fahren): Im Reiter *Spiel* wählt man oben den Modus (Rennen / Rennwochenende / Freies Fahren) und darunter in Gruppen per Auswahlfeldern *Rennen* (Distanz, Gegner, Starterfeld, Startplatz), *Boxenstopp & Reifen* (Automatik/Manuell, Startreifen, Verschleiß) und *Regeln* (Streckenlimits). Rechts zeigt die Übersichtskarte Strecke mit Streckenverlauf, Renndistanz in km, Gegner, Start, Boxenstopp und einen Strategie-Hinweis. *Karriere* zeigt Guthaben, Statistik (Rennen, Siege, Podien, Bestplatz, Ausbau) und die Werkstatt-Upgrades. *Fahren* enthält Fahrhilfen, Steuerung und Grafik.
- **Menü im Spiel** (`#menu`, `src/ui/menu.ts`): Reiter Fahren (Steuerung, Fahrhilfen, Boxenstopp) · Auto (Team, Reifen, Bremsbalance) · Anzeige (Kamera, Grafik, Ton, Telemetrie) · Rennen (Strecke, Zurück zum Hauptmenü).

## Saison, Ideallinie, Wetter

- **Saison** (`src/season.ts`, Modus „Saison“): Drei Läufe (Monza, Spa, Silverstone), jeweils Qualifying + Rennen. Punkte 25-18-15-12-10-8-6-4-2-1, Ausfälle punktlos; Fahrer- und Teamwertung, Siege und Verlauf des Spielers werden im Browser gespeichert und im Reiter *Karriere* angezeigt (Neue Saison jederzeit möglich). Die Strecke ist durch den Kalender vorgegeben; nach dem Rennen führt „Weiter“ ins Hauptmenü zum nächsten Lauf.
- **Ideallinie** (`src/render/racingLineVis.ts`, Einstellung „Fahrlinie“): Band entlang der KI-Ideallinie, nach dem Geschwindigkeitsprofil eingefärbt (grün Gas, gelb lupfen, orange/rot bremsen, 70 m Vorschau).
- **Wetter/Licht** (`createScene().setWeather`, Himmel aus `tools/make_sky.py … sunny|overcast|evening`): Sonnig, Bewölkt (weiches Licht, nahe Dunstgrenze), Abendlicht (tiefe warme Sonne, lange Schatten). Die Physik bleibt unverändert (kein Regen).

## Regen, Safety Car, Haptik

- **Regen** (`src/race/weather.ts`, Einstellung „Regen“: Aus / Leicht / Stark / Wechselhaft / Abtrocknend): Die Wettersimulation im Physik-Worker liefert Regenintensität und Streckennässe (0..1). Die Nässe wirkt über `wetGrip(Mischung, Nässe)` (`config/tyres.ts`) auf den Reifengrip aller Autos: Slicks brechen im Nassen ein (Starkregen ≈ 0,4), Intermediates liegen im Mittelfeld, Regenreifen gewinnen im Starkregen; Intermediates/Regenreifen verschleißen auf trockener Strecke schnell, Regen kühlt die Reifen. Die Fahrhilfen (`gripLimit`) rechnen mit der Nässe. Die KI fährt Kurven und Bremsen mit `sqrt(Grip)`-Skalierung, wählt beim Start passende Reifen und geht bei Wetterwechsel (Mischung passt nicht mehr) nach kurzer, je Fahrer verschiedener Verzögerung an die Box. Starkregen kostet ca. 20 % Rundenzeit (Test in `tests/weather.test.ts`).
- **Darstellung**: Regenstreifen um die Kamera (`render/rain.ts`, Vertex-Shader), Asphalt/Boden werden dunkler und spiegelnder (`TrackVisuals.setWet`), Himmel wechselt bei Regen auf „Bewölkt“, Gischt hinter den Rädern auf nasser Strecke. HUD: Streckennässe, Reifenknöpfe S/M/H/I/W und Hinweis, wenn die Mischung nicht zum Wetter passt.
- **Safety Car und Flaggen** (`src/race/safetycar.ts`, im `RaceDirector`): Ein liegengebliebenes/ausgefallenes Auto setzt eine gelbe Flagge (doppelt gelb auf der Strecke) im Sektor; bei einem Unfall rückt mit 80 % Wahrscheinlichkeit das Safety Car aus (nicht in den letzten ~1,8 Runden). Es fährt auf der Ideallinie vor dem Führenden (~137 km/h, bei Nässe langsamer), das Feld schließt auf (Tempobegrenzung je Auto nach Vordermann/SC, der Spieler wird ebenfalls begrenzt), nach ~70 s und freier Strecke kommt es an der Boxeneinfahrt herein, danach Grün. Einstellung „Safety Car“ (Standard an). Modell: `render/safetyCarModel.ts`; Test: `tests/safetycar.test.ts`.
- **Haptik** (`src/input/haptics.ts`): Vibration auf dem Handy und Gamepad-Rumble bei Kerbs (im Takt der Geschwindigkeit), blockierenden/durchdrehenden Rädern, Schleifen und Aufprall; abschaltbar im Menü (Fahren → Vibration).
