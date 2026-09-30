# Rennmodus

- **Startbildschirm**: Modus (Rennen / Freies Fahren), Strecke, Fahrer/Team (22 Fahrer 2026), Runden (1–20), KI-Stärke (Aus, Anfänger, Mittel, Profi, Legende), Feldgröße, Startplatz (Pole/Mittelfeld/Letzter/Zufall), Steuerung, Fahrhilfen.
- **Steuerung „Pfeiltasten“**: rechts ◀ ▶ (digitale Lenkung mit Rampe), links Bremse + Gas, Aero-Knopf rechts.
- **KI** (`src/race/`): Ideallinie + Geschwindigkeitsprofil (`line.ts`), Pure-Pursuit-Fahrer mit Folgen/Überholen/Fehlern (`ai.ts`), Teamleistung nur über Motorleistung/Abtrieb (`field.ts`, kalibriert: Rückstände aus `teams.json` ±0.35 s), Rennleitung (`race.ts`: Aufstellung, Startampel, Runden, Zielüberfahrt, Ausfälle/Streckenposten, Windschatten und verwirbelte Luft).
- **Zeitabstände**: Jedes Auto speichert alle 50 m die Zeit; der Abstand zu einem Auto ist die Zeit, die seit dessen Durchfahrt derselben Stelle vergangen ist (wie in der echten Zeitnahme). Überrundete: „+N Rd“.
- Alle Autos laufen in derselben Physik (Worker, 500 Hz); Snapshot enthält je Auto einen Block (`layout.ts`, `CAR_BLOCK`).
- Tests: `tests/race.test.ts` (Feld, Teamabstände, Startaufstellung/Ampel, 22-Auto-Runde).
