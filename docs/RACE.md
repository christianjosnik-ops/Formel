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
