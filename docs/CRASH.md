# Crash-Physik

Alles läuft im Physik-Worker (`src/physics/world.ts`, `src/physics/crash/*`), deterministisch, ohne Zufall in der Berechnung und ohne Allokationen im Schritt.

## Modell

- **Kollisionshülle:** ca. 100 Kontaktpunkte entlang des Umrisses (Nase, Frontflügel, vier Räder, Seitenkästen, Heck, Heckflügel) plus innere Strukturpunkte (Nasenbox, Überlebenszelle, Heck-Crashstruktur). Maße entsprechen dem Modell (5,05 m x 1,9 m).
- **Kontaktgesetz je Punkt (elasto-plastisch):** Feder bis zur Fließgrenze, danach bleibende Verformung bei konstanter Knautschkraft (Linienlast je Zone, z. B. Nase 330 kN/m, Seitenkasten 95 kN/m, Flügel 26 kN/m). Der Punkt wandert dauerhaft nach innen, das Auto wird kürzer.
- **Knautschweg:** je Punkt der Abstand bis zur Überlebenszelle. Danach versagt die Struktur bei sehr hoher Last weiter (kein starres Anschlagen, keine Energieeinspeisung).
- **Dämpfung und Restitution:** viskose Dämpfung nur beim Eindringen, begrenzte Kraft beim Zurückfedern, Kraftstoßbegrenzung gegen Energiegewinn. Nach jedem Aufprall ist die kinetische Energie nie größer als vorher (Test).
- **Reibung:** Coulomb, regularisiert, je Zone (Karbon an Beton 0,32, Reifengummi an der Wand 0,75).
- **Kontakt in drei Höhen:** Kontakte erzeugen Nick- und Wankmomente (Kontakthöhe je Zone), dadurch taucht die Nase bei Frontalaufprall und das Auto rollt bei Seitenkontakt.
- **Drei Kontaktarten:** gegen Wände (Beton, Reifenstapel, Leitplanke), gegen bewegliche Körper (Kegel, Trümmer), Auto gegen Auto (Punkte gegen Polygon, Kraft und Gegenkraft, gemeinsame plastische Verformung).
- **Barrieren:** Beton starr, Reifenbarriere weich mit großem Weg und starker Dämpfung (Abschattung: nur die vordersten Punkte verdrängen Material), Leitplanke dazwischen.
- **Untergründe:** Asphalt, Kies, Gras, Sand ändern Grip und Rollwiderstand je Rad.

## Schäden und ihre Wirkung

| Schaden | Ursache | Wirkung |
|---|---|---|
| Frontflügel | Energie > 2,4 kJ in der Zone | Abtrieb vorn sinkt bis -75 %, Flügel reißt ab und wird zum eigenen Körper |
| Heckflügel | Energie > 3,0 kJ | Abtrieb hinten sinkt bis -70 %, Flügel reißt ab |
| Rad | Energie > 24 kJ in der Radzone | Rad reißt ab und rollt davon, Radträger schleift (Funken), Auto zieht zur Seite |
| Querlenker | Energie > 14 kJ | Spurversatz bis 4,3°, Bremswirkung sinkt |
| Reifen | Energie > 3 bis 10 kJ | Luftverlust: weniger Grip, höherer Rollwiderstand, Ecke sinkt ab |
| Seitenkasten, Heck, Nase | plastische Arbeit | Antriebsleistung sinkt stufenlos bis auf 12 % |
| Unterboden | Schleifen, Seitenschläge | Abtrieb sinkt bis -40 % |
| Überlebenszelle | hohe Last in der Zelle | Ausfall (Retire) |

Ausfall: Motor zerstört, zwei Räder abgerissen, Zelle überlastet oder Spitzenverzögerung > 110 g. Crash-Stufe nach Spitzenverzögerung (3-ms-Filter): < 6 g keine, bis 15 g leicht, 40 g mittel, 80 g schwer, darüber extrem.

## Darstellung

- Dellen direkt auf der Karosserie (Vertex-Shader, bis zu 8 Dellen, Tiefe = bleibende Verformung)
- Flügel hängen und verdrehen sich bei Schaden, abgerissene Teile und Räder fliegen als echte Körper mit Hüpfen und Rollen weiter
- Funken (Unterboden, Aufprall), Staub auf Kies/Gras/Sand, Reifenqualm bei Blockieren und Platten, Karbon-Splitter, Kamera-Schütteln
- Schadensanzeige mit Draufsicht, Crash-Stufe, Spitzen-g, Aufprallgeschwindigkeit, Energie und Reparatur-Taste (B)

## Testgelände (Phase 1)

Hauptgerade mit Entfernungstafeln, Kiesbetten, Reifenbarriere und Betonwand am Ende (x = 1340 m), Seitenwände (Beton links, Reifen rechts, 500 bis 900 m), schräge Betonwand für Streifschüsse, Leitplanken an den Kiesbetten, Kegelring und Slalom. Streckenwelten ab Phase 3 liefern dieselben Datenstrukturen.

## Grenzen

Ebener Untergrund, keine echte 3D-Überschlagsdynamik (Wanken auf ±17° begrenzt), kein Verhaken von Rad an Rad mit Abheben, keine Fahrerverletzung über g-Anzeige hinaus.
