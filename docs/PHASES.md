# Phasenplan

1. **Physikkern** ✅ Vier-Rad-Modell (10 Freiheitsgrade), Testauto 2026, Telemetrie, Touch-/Neigungs-/Gamepad-Steuerung, PWA, CI/CD
2. Reifen und Aero kalibrieren (Temperatur, Verschleiß, Druck, Mischungen C1..C5/Inter/Wet)
3. Erste echte Strecke (Monza, Spa) plus FastF1-Validierung
4. Energiemanagement 2026, aktive Aero, Teamunterschiede (teams.json wirkt nur über Physikparameter)
5. KI-Gegner, Rennmodus, Boxenstopps, Schäden, Wetter

## Phase 1: Modellannahmen

- Körper: x, y, Gieren (Karosserieachsen) plus Hub, Wanken, Nicken über Feder/Dämpfer/Stabi je Rad, vier Raddrehungen (implizit integriert)
- Reifen: Magic Formula (MF 5.2 Struktur), kombinierter Schlupf über Gewichtungsfunktionen, Lastempfindlichkeit, Relaxationslänge, Gripfaktor als Haken für Temperatur, Verschleiß, Nässe
- Aero: CdA/ClA je Modus (Z Kurve, X Gerade), Bodeneffekt je Achse über Bodenfreiheit, Strömungsabriss, Skalierungshaken für Windschatten und Dirty Air
- Antrieb: Verbrenner 400 kW + MGU-K 350 kW (Abregelung ab 290 km/h bis 355 km/h), 8 Gänge, automatische Schaltung, Kupplungsschlupf beim Start, Schleppmoment, Sperrdifferenzial
- Bremsen: Scheibentemperatur mit Fade, Balance, Blockieren, Rekuperation an der Hinterachse
- Fahrwerksgeometrie: Rollzentren, Nickzentrum, geometrische Lastverlagerung
- Bekannte Vereinfachung: Ebener Untergrund, ungefederte Masse quasi-statisch, Aero ohne Giermoment, Hubkraft proportional zur Masse (keine Vorspannungsänderung durch Kraftstoff)
