# Strecken

Strecken entstehen zur Laufzeit aus den Mittellinien und Breiten der TUM-Streckendatenbank (`src/data/tracks/*.csv`, LGPL-3.0, Lizenztext im selben Ordner). Verfügbar: **Monza**, **Spa-Francorchamps**, **Silverstone** und das Crash-Testgelände. Suzuka fehlt bewusst, weil sich die Strecke an der Brücke selbst kreuzt und ohne Höhenprofil ebenerdig wäre.

## Erzeugung (`src/world/track.ts`)

1. Mittellinie als periodischer Catmull-Rom-Spline, nach Bogenlänge gleichmäßig neu abgetastet (alle ~4 m), leicht geglättet
2. Richtung, Krümmung und **Kurvenschwere** (0 bis 1) je Stützstelle
3. Aus der Kurvenschwere folgen an jeder Stelle:
   - **Kies** an der Kurvenaußenseite (5 bis 21 m breit), **Kerbs** innen und am Kurvenausgang
   - **Barrieren**: Reifenwand hinter Kiesbetten, Leitplanke an Geraden, Beton im Bereich Start/Ziel; Abstand vom Kurvenradius begrenzt
   - **Untergrundkarte** (2-m-Raster: Asphalt, Kerb, Kies, Gras) für die Physik (Grip, Rollwiderstand je Rad)
4. Wände liegen nie im Asphalt eines anderen Streckenabschnitts (Test)
5. Fortschritt entlang der Strecke für Rundenzeiten und Streckenlimits

Der Generator ist deterministisch; Physik-Worker und Darstellung bauen unabhängig voneinander identische Daten.

## Darstellung (`src/render/trackVisuals.ts`)

- Asphalt mit Randlinien, Gummispur zur Kurveninnenseite, Start/Ziel-Linie
- Kerbs (rot/weiß), Kiesbetten, gepflegter Rasen mit Mähstreifen bis zur Barriere
- Werbebanden an den Geraden, Reifenwände, Leitplanken, Betonmauern
- Startportal mit Ampeln, Tribünen mit Dach und Stützen, Boxengebäude mit Garagentoren
- **Natur:** Gelände mit Hügeln (nur abseits der Strecke, damit die Fahrbahn eben bleibt), Laub- und Nadelwälder in Flecken mit Lichtungen, ferne Waldschicht bis 1,1 km, Berge am Horizont mit Dunst (Alpen bei Monza, Ardennen bei Spa)
- Umgebung je Strecke über ein Thema (`src/world/maps.ts`): Baumdichte, Nadel-/Laubanteil, Hügel- und Berghöhe, Farben, Dunst
- Minimap und Rundenzeit im HUD, Streckenlimit: Runde ungültig, wenn die Fahrzeugmitte mehr als 1,1 m neben der Linie liegt
- Kamera „Hubschrauber“ für Überblick

## Leistung

Bäume sind Instanzen (ca. 6 500 nah + 3 800 fern). Bei „Niedrig“ bzw. wenn die FPS unter 50 fallen, sinkt die Baumdichte automatisch (Regler `setDetail`).

## Grenzen

- **Keine Höhen:** Die Physik und Fahrbahn sind eben. Eau Rouge, Raidillon oder Blanchimont verlieren ihre Steigung (racetrack-database enthält keine Höhendaten). Hügel gibt es nur in der Umgebung.
- Keine Boxengasse (Phase 5), keine Brücken
- Die Bebauung ist generisch (Tribünen, Boxen), keine Nachbildung einzelner Gebäude

## Höhenprofil, Boxengasse, Ausstattung

- `src/world/elevation.ts`: Höhenprofile (Näherung) für Monza, Spa und Silverstone. `Track.elev`/`grade`/`heightAt()`/`slopeAt()`. Die Physik erhält daraus die Hangabtriebskraft, die Darstellung hebt Strecke, Kerbs, Wände, Tribünen und Gelände entsprechend an; Autos und Kamera folgen der Höhe und neigen sich mit der Steigung.
- Boxengasse links der Start/Ziel-Geraden (`PIT` in `track.ts`): zusätzliche Breite mit weichen Ein- und Ausfahrten, dünne Boxenmauer (`pitwall`), 22 Boxen, Garagenreihe mit Toren in Teamfarben, Tempo-80-Schilder.
- `src/render/trackProps.ts`: Bremstafeln (300/200/100 m), Kurvennummern, Fangzäune an schnellen Kurven, Überführungen mit Bannern, Flutlichtmasten.
