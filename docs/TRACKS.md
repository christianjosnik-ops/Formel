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

## Optik nach Vorlage (Drift-Strecke)

Die Layouts bleiben Monza, Spa und Silverstone; Optik und Ausstattung orientieren sich an einer vom Nutzer gelieferten Drift-Strecke: schwarzer Drei-Holm-Zaun, orange-weiße Leitpfosten, hohe Werbefahnen und Tafeln (erfundene Marken), Chevron-Schilder, Erdstreifen zwischen Asphalt und Zaun, bläulich-graues Asphalt, Bäume aus Blattkarten mit prozeduraler Laubtextur (`trackVisuals.ts`, `trackProps.ts`, `worldVisuals.ts`).

## Landschaftsobjekte aus Blender

`tools/make_scenery.py` (Blender 5, headless: `blender -b -P tools/make_scenery.py -- public/models/scenery.glb` bzw. mit `bpy`-Modul) erzeugt Laub-/Nadelbäume mit echtem Stamm, Ästen und Blattkarten, Grasbüschel (grün und Stroh), Büsche und ein Tribünenmodul (Betonstufen, Sitzschalen, Publikum, Dach) als Draco-GLB. `src/render/sceneryAssets.ts` lädt die Datei; `trackVisuals.ts` instanziert die Objekte streckennah (Bäume bis ~95 m, Gras/Büsche in Chunks mit Frustum-Culling), weiter weg bleiben die günstigen Kartenbäume. Das Gelände hat zusätzlich sanfte Wellen sowie Stroh- und Erdflecken.

### Texturen, Relief, Tribünen (v2)

- `tools/make_textures.py` erzeugt kachelbare Boden-Texturen mit Normalmaps (`public/textures/`: Gras mit einzelnen Halmen, Kies, Asphalt mit Zuschlagkorn und Rissen, Erde). `surfaceTexture`/`surfaceNormal` in `worldVisuals.ts` laden sie.
- Das Gelände hat jetzt deutliches Relief (breite Hügelzüge, Rollen, unregelmäßige Erdwälle hinter den Auslaufzonen); Gitterweite 28 m.
- Bäume: voll detaillierte Blender-Bäume direkt an der Strecke (≤ 320 Stück), dahinter Blender-LOD-Bäume (~250 Flächen) in 450-m-Chunks mit Frustum-Culling; Dichte per `setDetail`.
- Tribünenmodul (12 m): zwei Ränge mit Einzelsitzen, Mittelgang mit Handläufen, Querweg, Werbebanden, Publikum (Textur mit Armen/Fahnen), Fachwerkdach, Rückwand mit Verkleidung und Stützen.

## Grafik-Update (Kino-Look)

- **Nachbearbeitung** (`src/render/scene.ts`, ein Shader-Pass nach Bloom): radiale Bewegungsunschärfe ab ~130 km/h, leichte chromatische Aberration, Filmkorn (in Schatten stärker), Sonnenglanz mit schwachem Objektiv-Geist, Farbgrading (Grün entsättigt Richtung Oliv, Schatten kühl, Lichter warm; je Wetter eigene Werte).
- **Bäume** (`tools/make_scenery.py`): Laubblatt-Cluster aus ~1900 echten Blättern (Mittelrippe, Seitenadern, gezähnter Rand, innen dunkel/außen hell, 1024²) und Nadelzweige mit Seitenzweigen, tausenden feinen Nadeln und deckender Unterlage (damit sie in Mipmaps nicht verschwinden). Weiche Kontaktschatten unter jedem Baum (`trackVisuals.ts`), da die Schattenkarte nur das Umfeld des Autos abdeckt.
- **Zuschauer**: Schattierung nach oben, Stoffkorn, dunkle Kontur je Figur. **Asphalt**: geringere Rauheit für Himmelsreflexe unter flachem Blick.

## Performance (iPad/Handy)

- **Touch-Pfad** (`(pointer: coarse)`): weniger Geometrie (110 statt 320 Detail-Bäume, 3200 statt 5600 LOD-Bäume, halbe Grasdichte und nur 24 m Streifen), keine Schattenwerfer außer Auto, Boxenanlage und Pitwall (Baumschatten ersetzen weiche Kontaktschatten), Schattenkarte 1536², Startauflösung 1,25× (adaptiv nach unten bis 0,85×, kein Hochskalieren mehr), HUD nur mit 30 Hz, Telemetrie-Panel einmalig aus.
- **Chunking** (`chunkLargeInstances`): große Instanzen-Meshes (Reifenstapel, Hecken, Pfosten …) werden in 220-m-Zellen geteilt, damit Frustum-Culling greift. Messung Monza (iPad-Emulation, 1180×820 @2×): 3,06 Mio. → 0,53 Mio. Dreiecke je Bild, 554 → 233 Draw-Calls.
- **Ladebildschirm** mit Startampel (fünf Lichter = Fortschritt, Tipps): danach wird einmal die gesamte Szene ohne Culling gezeichnet (Shader kompilieren, Geometrien/Texturen hochladen, auch Boxencrew, Regen, Safety Car, Ideallinie), damit es im Spiel keine Ruckler beim ersten Sichtbarwerden gibt.

### Performance, Runde 2 (Rennen mit vielen Autos)

- **KI-Autos in drei Stufen**: nah (<16 m auf Touch, <40 m sonst; in der Box immer) das vereinfachte Modell `f1car_lod.glb` (`tools/make_car_lod.py`: ~14 000 statt ~80 000 Polygone, Teile gleichen Materials zu einem Mesh verschmolzen), weiter weg ein ~500-Dreiecke-Proxy (`render/carLod.ts`, ein Draw-Call). Nur das Auto des Spielers nutzt das volle Modell.
- **Sichtweiten je Chunk** (`TrackVisuals.updateVisibility`): Gras/Büsche nur bis ~240 m (Touch) bzw. 420 m, Detail-Bäume bis 450/800 m, LOD-Bäume bis 2400/4500 m, Hecken/Gehöfte bis 1000/1800 m – im flachen Monza zeichnete der Frustum-Test sonst Hunderte weit entfernter Chunks.
- **Touch**: keine Ausbesserungs-/Marbles-Schichten (vollflächige durchscheinende PBR-Layer) und kein geharkter Kies; Startauflösung 1,1×, bei Bedarf stufenweise Auflösung → Schatten aus → weniger Details.
- **Qualifying**: Aufwärmrunde + eine schnelle Runde.
