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

Der Workflow `.github/workflows/deploy.yml` importiert bei jedem Push und einmal täglich
frische Daten und veröffentlicht die Seite auf GitHub Pages.

## Hinweise

Die Tipps kombinieren Statistiken der gewählten Comp (Level-Timings, Roll-Level, Builds,
Positionierung) mit allgemeinen Regeln zu Zinsen, Serien und Leben. Die Rundenstruktur
(Karussell in x-4, PvE in x-7, Augments in 2-1/3-2/4-2) steht in `js/tips.js`.

Nicht von Riot Games unterstützt oder mit Riot Games verbunden.
