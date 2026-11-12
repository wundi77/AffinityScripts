# AffinityScripts

Eigene Scripts für Affinity Studio (JavaScript-SDK).

## Gestaltungsraster-Generator

`Gestaltungsraster.js` legt 14 gängige Gestaltungsraster als Linienobjekte auf einer **neuen Ebene** an.

**Ablauf:** zweistufiger Dialog. Schritt 1 wählt den Rastertyp, Schritt 2 zeigt nur die dazu passenden Einstellungen (Ränder, Spaltenzahl, Abstände, Linienfarbe, Linienstärke, Ebenenname).

**Bezugsfläche**

| Auswahl | Bezug |
|---|---|
| nichts markiert | aktuelle Seite |
| ein Objekt markiert | dessen Rahmen |
| mehrere Objekte markiert | ihr gemeinsamer Gesamtrahmen |
| nur das Artboard markiert | das Artboard |

Bei mehreren Artboards und ohne Auswahl erscheint ein Hinweis.

**Rastertypen**

| Gruppe | Raster |
|---|---|
| Spalten und Module | Spaltenraster, Modulraster, Manuskriptraster, Hierarchisches Raster |
| Typografie | Grundlinienraster, Satzspiegel (Van de Graaf / Tschichold) |
| Proportionen | Goldener Schnitt, Drittelregel / Teilungsraster, Fibonacci / Goldene Spirale, Diagonalen / Dynamische Symmetrie |
| Sonderraster | Quadrat- / Punktraster, Isometrisch / Dreiecksraster, Hexagonalraster, Polar- / Radialraster |

**Installation:** Den Inhalt von `Gestaltungsraster.js` in Affinity als Script einfügen bzw. über den Claude-Konnektor in die Skriptbibliothek speichern (Titel: "Gestaltungsraster-Generator").

## Stand

- Version 1.1.0
- Getestet: alle 14 Typen mit Standardwerten in einem neuen A4-Dokument, Auswahl-Logik mit Rechtecken.
- Nicht getestet: markiertes Artboard, gedrehte Objekte, Doppelseiten (dort gilt die ganze Doppelseite als Bezugsfläche).
