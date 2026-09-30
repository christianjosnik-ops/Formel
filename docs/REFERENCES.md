# Referenz-Repos

Gelesen und zusammengefasst. Nur Referenz, keine Abhängigkeit. Lizenzen beachtet: Es wird kein Code kopiert, nur Daten und Konzepte verwendet.

| Repo | Lizenz | Übernahme |
|---|---|---|
| TUMFTM/racetrack-database | LGPL-3.0 | CSV-Format `x_m,y_m,w_tr_right_m,w_tr_left_m` (Monza 1160 Punkte, Spa 1402). Grundlage für Strecken-Mesh, Randsteine, Auslaufzonen (Phase 3). Höhenprofil fehlt, kommt aus anderen Quellen. Datenlizenz: Hinweis in `data/` |
| TUMFTM/laptime-simulation | LGPL-3.0 | Parameterstruktur (`lf/lr`, `h_cog`, `c_w_a`, `c_z_a_f/r`, `drs_factor`, Reifen mit `mu(Fz)`), Lastverteilung (statisch, Längs, Quer, Aero), Hybrid-Antrieb (`car_hybrid.py`). Werte aus `F1_Shanghai.ini` dienten als Startwerte der Reifen (mu ~1,85..2,15 bei Fz0 = 3000 N, Lastempfindlichkeit -5e-5/N). Modell dort quasi-stationär, unseres dynamisch |
| TUMFTM/global_racetrajectory_optimization | LGPL-3.0 | Mincurvature-/Mintime-Ideallinie. Wird offline in Python gerechnet und als JSON abgelegt, im Spiel läuft nur das Linienfolgen (Phase 3 bis 5) |
| theOehrly/Fast-F1 | MIT | Telemetrie (Speed, Gang, Gas, Bremse), Rundenzeiten, Stints für VALIDATION.md. Version 3.8.3 installierbar |
| bacinger/f1-circuits | MIT | GeoJSON-Layouts zum Abgleich der Strecken |
| f1db/f1db | CC-BY-4.0 | Stammdaten Fahrer, Teams, Kalender (Namensnennung erforderlich) |
| jolpica/jolpica-f1 | Apache-2.0 | Nur die API-Endpunkte für Ergebnisse und Wertungen 2026, kein Code |

## Netzwerk-Hinweis

Die Cloud-Umgebung blockiert `livetiming.formula1.com` (FastF1) und `api.jolpi.ca`. Für Phase 3 muss die Netzwerkrichtlinie diese Hosts freigeben, sonst läuft die Validierung nur gegen laptime-simulation und bekannte Bestzeiten.
