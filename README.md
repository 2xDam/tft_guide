# TFT Guide

Web-App mit Rundentipps für Teamfight Tactics: Meta-Comp auswählen, Runde und Spielstand
(Level, Gold, Leben, Serie) einstellen und sehen, was jetzt zu tun ist – inklusive
Zielaufstellung, Item-Builds mit Rezepten, Komponenten-Priorität und Level-Zeitplan.

## Daten

`npm run fetch` importiert die aktuellen Comps von [MetaTFT](https://www.metatft.com/comps)
(inoffizielle Schnittstelle, kann sich ändern) sowie Namen, Icons und Item-Rezepte von
[CommunityDragon](https://www.communitydragon.org) und schreibt sie nach `data/`.
Sprache der Spieldaten: `TFT_LOCALE=en_us npm run fetch` (Standard `de_de`).

## Lokal starten

```bash
npm start
```

Danach http://localhost:4173 öffnen. Es gibt keinen Build-Schritt und keine Abhängigkeiten.

## Auf GitHub hosten

1. Repository auf GitHub anlegen und diesen Ordner auf den Branch `main` pushen.
2. Im Repository unter **Settings → Pages → Source** „GitHub Actions“ wählen.

Der Workflow `.github/workflows/deploy.yml` importiert bei jedem Push und alle sechs Stunden
frische Daten und veröffentlicht die Seite auf GitHub Pages.

## Meine Spiele (optional)

Die Seite „Meine Spiele“ zeigt die letzten Partien der eingetragenen Riot-IDs und wertet den
Endstand gegen die Meta-Daten aus (Platzierung, Level, Items und Sterne der Carries, Restgold).
Entscheidungen pro Runde liefert die Riot-API nicht.

1. Auf https://developer.riotgames.com einen persönlichen API-Schlüssel beantragen.
2. Im Repository unter **Settings → Secrets and variables → Actions** das Secret
   `RIOT_API_KEY` anlegen. Den Schlüssel niemals in eine Datei im Repository schreiben.
3. In `players.json` die Riot-IDs (`Name#TAG`), die Region (`europe`, `americas`, `asia`, `sea`)
   und die Anzahl der Spiele eintragen.

Der Workflow ruft die Spiele bei jedem Lauf ab. Die Daten in `data/matches.json` sind über die
veröffentlichte Seite öffentlich einsehbar. Lokal: `RIOT_API_KEY=… npm run matches`.

## Als App und Mitschriften

- Die Seite lässt sich auf dem Handy zum Startbildschirm hinzufügen (Android: Browsermenü →
  „App installieren“, iPhone: Teilen → „Zum Home-Bildschirm“). Ein Service Worker lädt eigene
  Dateien bei jedem Start frisch und zeigt ohne Netz den zuletzt geladenen Stand.
- Im Modus „Runde für Runde“ wird jede Runde mitgeschrieben und der Verlauf automatisch auf dem
  Gerät gespeichert. In Kampfrunden schließt „Sieg“ oder „Verl.“ die Runde ab und schreibt Gold
  (Einkommen), Leben (geschätzter Schaden) und Serie fort; geschätzte Werte sind mit ≈ markiert,
  bis man sie korrigiert. „Spiel beenden“ ergänzt die Platzierung; die Auswertung steht unter
  Spiele & Analyse → Mitschriften.
- Favoriten (je Spieler), Freestyle-Auswahl und Mitschriften liegen nur im Browser des jeweiligen Geräts.

## Hinweise

Die Tipps kombinieren Statistiken der gewählten Comp (Level-Timings, Roll-Level, Builds,
Positionierung) mit allgemeinen Regeln zu Zinsen, Serien und Leben. Die Rundenstruktur
(Karussell in x-4, PvE in x-7, Augments in 2-1/3-2/4-2) steht in `js/tips.js`.

Nicht von Riot Games unterstützt oder mit Riot Games verbunden.
