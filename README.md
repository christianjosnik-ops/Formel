# Formel 2026

Hyperrealistische Formel-1-Simulation der Saison 2026 als Web-Game für iPad und iPhone (Safari, als PWA zum Homescreen hinzufügbar). Nur private Nutzung.

**Spielen:** https://christianjosnik-ops.github.io/Formel/ (wird bei jedem Push auf `main` per GitHub Actions neu gebaut)

## Stack

TypeScript, Vite, Three.js. Die Physik läuft als eigenes Modul in einem Web Worker mit fester Rate (500 Hz), unabhängig vom Rendering (60 FPS). Keine fertige Fahrzeugphysik-Library.

## Struktur

```
src/config/      zentrale Konstanten (physics.ts) und Fahrzeugdaten (car.ts)
src/physics/     reiner Simulationscode ohne DOM: Reifen, Aero, Antrieb, Fahrzeug, Worker
src/render/      Three.js: Szene, prozedurales F1-Modell, Kamera
src/input/       Touch, Neigung (iOS-Berechtigung), Gamepad, Tastatur, Einstellungen
src/ui/          HUD, Telemetrie, Menü
src/data/        teams.json, drivers.json (Ratings 2026)
tests/           Vitest: Physikformeln und Fahrmanöver
docs/            Referenz-Repos, Phasenplan
VALIDATION.md    Abgleich mit echter Telemetrie (ab Phase 3)
```

## Entwicklung

```
npm ci
npm run dev        # Vite Dev-Server
npm test           # Physik-Unit-Tests
npm run build
```

Alles ist auch ohne lokalen Rechner testbar: Die GitHub Action führt Typecheck, Tests und Build aus und veröffentlicht nur bei Erfolg.

## Steuerung

| Quelle | Belegung |
|---|---|
| Touch | Lenkband links, Bremse und Gas als analoge Flächen rechts (Fingerhöhe = Pedalstellung), AERO-Knopf |
| Neigung | Menü → Lenkung → Neigung, „Neigung aktivieren“ (iOS fragt nach Berechtigung), Gerät wie ein Lenkrad halten |
| Gamepad | Linker Stick lenkt, RT Gas, LT Bremse, A/X Aero, B Kamera, Y Reset, Start Menü |
| Tastatur | Pfeile/WASD, X Aero, R Reset, C Kamera, T Telemetrie, M Menü |

Fahrhilfen (Traktionskontrolle, ABS, Lenkhilfe) sind in drei Stufen einstellbar. Sie filtern nur die Eingaben, die Physik bleibt identisch.

## Lizenzen der Referenzen

Siehe `docs/REFERENCES.md`. Es wird kein Fremdcode kopiert, Streckendaten (LGPL-3, TUMFTM) kommen mit Lizenzhinweis in `data/` (ab Phase 3).
