# MixTape

Einfacher Mehrspur-Editor für Mixtapes – Musik, Sprachaufnahmen, YouTube-Songs und Notizen zusammenstellen, ohne die Komplexität einer vollwertigen DAW.

**Stack:** Electron · React · Tailwind CSS · lucide-react · Web Audio API · lamejs (MP3) · yt-dlp (YouTube)

## Starten

```bash
npm install
npm run dev      # Entwicklungsmodus mit Hot-Reload
npm start        # Produktions-Build lokal starten
npm run dist     # Windows-Installer bauen (Ordner release/)
```

## Funktionen

| Bereich | Was geht |
|---|---|
| **Timeline** | Mehrere Spuren, horizontal scrollbar, Zoom (Strg+Mausrad, +/−), Wellenformen, Lücken-Anzeige zwischen Clips |
| **Import** | Drag & Drop von MP3/WAV/M4A/OGG/FLAC/… direkt in eine Spur (an der Drop-Position) oder unten für eine neue Spur; Datei-Dialog hängt ans Spurende an |
| **YouTube** | Link einfügen → Audio wird per yt-dlp geladen und eingefügt (yt-dlp wird beim ersten Mal automatisch heruntergeladen und wöchentlich aktualisiert) |
| **Aufnahme** | Mikrofon-Aufnahme an der Abspielposition, Musik läuft mit (optional leiser, Pegel einstellbar), Stille am Anfang/Ende wird automatisch entfernt, Pegelanzeige |
| **Bearbeiten** | Verschieben (auch zwischen Spuren), Ränder trimmen, Fade-In/-Out per Griff oder Regler, Clip-Lautstärke, Teilen (S), Duplizieren (Strg+D), Löschen (Entf), Crossfade mit Vorgänger, „Stille entfernen“, Undo/Redo |
| **Magnet-Modus** | Clips rasten an Clip-Kanten, Markern und Abspielposition ein; „Lücken schließen“ pro Spur |
| **Ducking** | Spuren mit „Sprache“ senken alle anderen Spuren automatisch ab (Stärke im Projekt-Panel) |
| **Notizen & Kapitel** | Doppelklick in die Marker-Leiste oder „M“: Notiz mit Text, Regieanweisung und Farbe; optional als Kapitelmarke |
| **Export** | MP3 (128–320 kbit/s) oder WAV, Auspegeln auf −1 dB, Kapitel als ID3-Kapitel im MP3 + CUE-Sheet + Kapitelliste (.txt) |
| **Sound-Liste** | Panel unten rechts: Sounds/Snippets sammeln (Dateien hineinziehen, „+“, oder Clip per „In Sound-Liste“ inkl. Zuschnitt), vorhören, per Drag in jede Spur ziehen; projektübergreifend gespeichert |
| **Projekte** | Speichern/Öffnen als `.mixtape` (JSON mit absoluten + relativen Pfaden zu den Audiodateien) |
| **J-Card** | Druckbarer Kassetten-Einleger mit Titel, Widmung, Farbschema und Tracklist (Seite A/B) – drucken oder als PDF speichern |

## Ablage

Aufnahmen, YouTube-Downloads, Projekte und Exporte landen unter `Musik\MixTape\` (`Aufnahmen`, `YouTube`, `Projekte`, `Export`).

## Tastenkürzel

| Taste | Aktion |
|---|---|
| Leertaste | Abspielen / Pause |
| R | Aufnahme starten / stoppen |
| S | Clip an Abspielposition teilen |
| M | Notiz / Marker setzen |
| Entf | Auswahl löschen |
| Strg+D | Clip duplizieren |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen |
| Strg+S / Strg+Umschalt+S / Strg+O | Speichern / Speichern unter / Öffnen |
| Pos1 / Ende | Zum Anfang / Ende |

## Projektstruktur

```
electron/main.cjs      Hauptprozess: Dateien, Projekte, Export-Streams, yt-dlp, PDF
electron/preload.cjs   sichere IPC-Brücke (window.api)
scripts/electron.cjs   Starter (entfernt ELECTRON_RUN_AS_NODE, z. B. aus VS Code-Terminals)
src/App.jsx            Zustand, Wiedergabe, Aufnahme, Import, Projekte, Tastatur
src/components/        Toolbar, Timeline, Clip, Waveform, TrackHeader, Inspector, Dialoge
src/lib/engine.js      Audio-Graph (Fades, Ducking) für Wiedergabe und Export
src/lib/exporter.js    Offline-Rendering in Abschnitten, MP3/WAV-Streaming
src/lib/id3.js         ID3v2.3 inkl. Kapitel (CHAP/CTOC)
src/lib/jcard.js       J-Card-Layout
```
