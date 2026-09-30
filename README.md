# Formel 2026

Hyperrealistische Formel-1-Simulation der Saison 2026 als Web-Game für iPad und iPhone (Safari, als PWA zum Homescreen hinzufügbar). Nur private Nutzung.

**Spielen:** https://christianjosnik-ops.github.io/Formel/ (wird bei jedem Push auf `main` per GitHub Actions neu gebaut)

## Stack

TypeScript, Vite, Three.js. Das Auto ist ein 3D-Modell (Blender, `docs/MODEL.md`) mit Team-Lackdesign im Shader. Die Physik läuft als eigenes Modul in einem Web Worker mit fester Rate (500 Hz), unabhängig vom Rendering (60 FPS). Keine fertige Fahrzeugphysik-Library.

## Struktur

```
src/config/      zentrale Konstanten (physics.ts) und Fahrzeugdaten (car.ts)
src/physics/     reiner Simulationscode ohne DOM: Reifen, Aero, Antrieb, Fahrzeug, Worker
src/render/      Three.js: Szene, F1-Modell (GLB), Gelände, Trümmer, Partikel, Kamera
src/world/       Strecken (aus Streckendaten) und Testgelände, gemeinsam für Physik und Darstellung
tools/           Modellkonvertierung (Blender nach GLB)
src/input/       Touch, Neigung (iOS-Berechtigung), Gamepad, Tastatur, Einstellungen
src/ui/          HUD, Telemetrie, Menü
src/data/        teams.json, drivers.json (Ratings 2026)
tests/           Vitest: Physikformeln und Fahrmanöver
docs/            Referenz-Repos, Phasenplan, Modell, Crash-Physik
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
| Tastatur | Pfeile/WASD, X Aero, R Reset, B Reparatur, C Kamera, T Telemetrie, M Menü |

Fahrhilfen (Traktionskontrolle, ABS, Lenkhilfe) sind in drei Stufen einstellbar. Sie filtern nur die Eingaben, die Physik bleibt identisch.

## Strecken

Monza, Spa-Francorchamps und Silverstone aus den TUM-Streckendaten (LGPL-3.0), dazu das Crash-Testgelände. Kerbs, Kiesbetten, Barrieren, Tribünen, Startportal, Wälder, Hügel und Berge im Hintergrund, Rundenzeiten mit Streckenlimit und Minimap. Auswahl im Menü (Strecke). Details: `docs/TRACKS.md`.

## Crash-Physik

Elasto-plastisches Kontaktmodell mit Knautschzonen, bleibender Verformung, Reibung, Reifenbarrieren, Kegeln, abreißenden Flügeln und Rädern, Platten, verbogenen Querlenkern, Antriebs- und Bodenschäden, Kies/Gras/Sand und Auto-gegen-Auto-Kollision. Details und Kalibrierung: `docs/CRASH.md`. Das Testgelände hat Wände, Barrieren und Kegel; Reparatur mit B oder dem Knopf im Schadenspanel.

## Lizenzen der Referenzen

Siehe `docs/REFERENCES.md`. Es wird kein Fremdcode kopiert, Streckendaten (LGPL-3, TUMFTM) kommen mit Lizenzhinweis in `data/` (ab Phase 3).
