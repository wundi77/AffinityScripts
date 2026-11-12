# AffinityScripts – Projektnotizen

Scripts für Affinity Studio (JavaScript-SDK), Repo: wundi77/AffinityScripts. Sprache der Oberfläche und Doku: Deutsch.

## Arbeitsweise

- Quelle der Wahrheit ist die Datei im Repo. Nach jeder Änderung die Version im Dateikopf (`version:`) erhöhen und dasselbe Script über `save_script_to_library` unter gleichem Titel in die Affinity-Skriptbibliothek schreiben (Titel: "Gestaltungsraster-Generator"). Bibliotheksversion und Datei müssen identisch sein.
- Vor dem ersten `execute_script` das SDK-Dokument `preamble` lesen (sonst Fehler).
- Der Affinity-Konnektor ist ein MCP-Server (`mcp__Affinity__*`); Affinity muss laufen.

## Testen ohne Benutzerinteraktion

- Testdokument: `Document.createFromOptions(opts)` mit `NewDocumentOptions.createDefault()` (units, width, height, dpi setzen). Es wird dabei zum aktuellen Dokument.
- `runModal()` blockiert bis zur Eingabe im Dialog, daher nicht in Tests aufrufen. Stattdessen Rastertypen über `TYPES[i].fields(frame)` (Standardwerte `def`) und `.build(werte, frame)` direkt ausführen und mit `addToDocument` anlegen.
- Sichtprüfung: `render_spread` braucht `document_session_uuid` und `spread_index`; `render_selection` braucht `document_session_uuid`. Einzelne Raster-Ebene vorher per `doc.selection = [container]` markieren.
- Das Dialog-Gerüst lässt sich ohne `runModal()` aufbauen und die Werte zurücklesen.

## SDK-Erkenntnisse

- Mehrere `addUnitValueEditor` in einer Dialoggruppe funktionieren. `addColourPicker` und `addTextBox` mit Startwert funktionieren.
- Bei `addUnitValueEditor` mit `max = null` setzt das SDK den Wert auf 0: nach dem Anlegen `.value = Startwert` erneut setzen (steht im Script).
- Neue Ebene: `ContainerNodeDefinition` per `AddChildNodesCommandBuilder` mit Ziel `spread`, danach den Container über `spread.children` und `userDescription` suchen und die Linienobjekte (`PolyCurveNodeDefinition`) mit Ziel Container einfügen.
- Objektrahmen: `node.getSpreadBaseBox(false)`. Artboard: `node.artboardInterface.isArtboardEnabled` und `.spreadBaseBox`.
- Dokument-Koordinaten sind Pixel im Spread-Koordinatensystem.

## Offene Punkte

- Artboard-Markierung, gedrehte Objekte und Doppelseiten sind nicht getestet.
- Kein Live-Vorschau im Dialog (nur Dialog, dann Erzeugen).
