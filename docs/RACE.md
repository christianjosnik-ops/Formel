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
- **Animation** (`src/render/pitCrew.ts`): Zwölf Crewmitglieder laufen aus der Garage, Wagenheber heben das Auto an (`CarModel.serviceLift`), die Räder werden ausgebaut (`serviceHide`), neue Reifen mit der gewählten Mischung eingesetzt, das Auto abgelassen und per Lollipop (rot → grün) freigegeben. Der Fortschritt kommt aus `pitTimer/pitSvc` im Snapshot. Beim Spieler blendet eine Boxen-Kamera zur Nahansicht über.
