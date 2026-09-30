# Fahrzeugmodell

Das Auto ist das vom Nutzer gelieferte 3D-Modell (Blender-Datei `Ferrari Mission Winnow.blend`, Blender 2.83, ein einziges Mesh mit 80 000 Flächen und 28 Materialien). Es wird nur privat genutzt. Die Originaltexturen (Livree, Sponsoren) lagen der Datei nicht bei. Geometrie und Materialzuordnung bleiben, Farben, Logos, Dekor und Startnummer erzeugt das Spiel selbst.

## Konvertierung

`tools/convert_model.py` (Blender als Python-Modul, `pip install bpy`):

```
python tools/convert_model.py "Ferrari Mission Winnow.blend" public/models/f1car.glb
```

- zerlegt das Mesh in `body`, `wing_front` (inkl. Nasenspitze), `wing_rear` und vier Radobjekte (Ursprung = Radmitte, Achse Z), damit sich Räder drehen und lenken lassen und Flügel abreißen können
- bestimmt die Radmitten aus den Reifenflächen und skaliert das Modell auf den Radstand 2026 (3,4 m), die Breite auf 1,9 m, den Rollradius auf 0,345 m
- schreibt die gemessenen Maße nach `public/models/f1car.json` (Spurweite vorn 1,473 m, hinten 1,479 m, Länge 5,06 m)
- entfernt die fehlenden Texturen, exportiert als Draco-komprimiertes GLB (ca. 3 MB)

Die `.blend`-Datei liegt nicht im Repo. Nur die konvertierte `f1car.glb` wird ausgeliefert.

## Materialien im Spiel (`src/render/carModel.ts`)

| Modellmaterial | Bauteil | Darstellung |
|---|---|---|
| Livery1 | Lack, Flügel, Halo, Motorabdeckung | Team-Lackshader (Grundfarbe, Mittelstreifen, Schweller, Endplatten, Halo in Karbon, Seitenkasten-Dekor mit Teamname, Emblem, Motor und Startnummer) |
| Aero2, Meshesmesh101 | Unterboden, Bargeboards, Querlenker, Bremsbelüftung | Karbon |
| Wheeldecal1 | Reifenlauffläche | Gummi |
| Wheeldecal2 | Reifenflanke | Gummi mit farbigem Mischungsring (Soft rot, Medium gelb, Hard weiß, Inter grün, Wet blau) |
| Cover1 | Radabdeckung | Metall |
| Aero1 | Windschutz | getönte Scheibe |
| Part1, LED-Gears | Rück-/Regenlicht | leuchtet stärker beim Bremsen |
| Rightupperarm, Righthand, Meshpart1 | Fahrer, Lenkrad | Rennanzug in Teamfarbe, Handschuhe, Lenkrad |

Logos und Schriftzüge sind eigene Wortmarken aus Teamname und einem neutralen Emblem, keine Originalgrafiken.

## Dynamik am Modell

Hub, Nicken und Wanken des Aufbaus, Lenkung und Raddrehung, Bremsscheibenglühen, Bremslicht, Flügelverformung und abgerissene Teile, Dellen (Vertex-Shader), plattgefahrene Reifen, verbogene Querlenker (Spur/Sturz).
