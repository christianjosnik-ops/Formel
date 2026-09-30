# Validierung

Pflicht ab Phase 3: Vergleich der simulierten KI-Runde mit echter Telemetrie (FastF1, Saison 2026) bei jeder Physikänderung.

## Stand Phase 1 (keine Telemetrie-Validierung)

Es liegt noch keine Strecke und keine echte Telemetrie vor. Die Plausibilitätswerte des Testautos (Unit-Tests in `tests/vehicle.test.ts`) dienen als Vorab-Check gegen bekannte Größenordnungen der Formel 1.

| Kenngröße | Simulation | Referenzbereich F1 |
|---|---|---|
| 0 bis 100 km/h | 2,15 s | 2,4 bis 2,8 s |
| 0 bis 200 km/h | 4,4 s | 4,6 bis 5,6 s |
| Topspeed Z-Modus / X-Modus | 316 / 349 km/h | 315 bis 350 km/h |
| Bremsweg 300 auf 0 km/h | 98 m, 2,9 s | ca. 100 bis 130 m |
| Querbeschleunigung 80 / 160 / 250 km/h | 2,4 / 3,1 / 3,7 g | 2,5 / 3,5 / 4,5 g |

Die Beschleunigung ist etwas zu schnell, die Hochgeschwindigkeits-Querbeschleunigung etwas zu niedrig. Das wird in Phase 2 durch Reifen- und Aero-Kalibrierung und in Phase 3 gegen echte Telemetrie korrigiert.

## Netzwerk

Die Cloud-Umgebung blockiert derzeit `livetiming.formula1.com`. Ohne Freigabe kann `tools/validate.py` keine Telemetrie laden.
