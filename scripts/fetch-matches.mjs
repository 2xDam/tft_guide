#!/usr/bin/env node
// Ruft die letzten Spiele der in players.json eingetragenen Riot-IDs über die
// offizielle Riot-API ab und schreibt sie nach data/matches.json.
//
//   RIOT_API_KEY=… node scripts/fetch-matches.mjs
//
// Ohne Schlüssel oder ohne eingetragene Spieler passiert nichts (kein Fehler),
// damit die Seite auch ohne diese Funktion gebaut werden kann.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'matches.json');
const KEY = process.env.RIOT_API_KEY;
const REGIONS = new Set(['europe', 'americas', 'asia', 'sea']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function riot(region, path, tries = 5) {
  const url = `https://${region}.api.riotgames.com${path}`;
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: { 'X-Riot-Token': KEY } });
    if (res.ok) return res.json();
    if (res.status === 429 && i < tries) {
      // Rate-Limit: Riot nennt die Wartezeit in Sekunden
      await sleep((Number(res.headers.get('retry-after')) || 10) * 1000 + 500);
      continue;
    }
    if (res.status >= 500 && i < tries) {
      await sleep(2000 * i);
      continue;
    }
    const hint = res.status === 401 || res.status === 403 ? ' (Schlüssel ungültig oder abgelaufen)' : res.status === 404 ? ' (nicht gefunden)' : '';
    throw new Error(`HTTP ${res.status}${hint} für ${path.split('?')[0]}`);
  }
}

// Nur die eigenen Daten des Spielers übernehmen – keine Daten der Mitspieler.
function slim(match, puuid) {
  const info = match.info || {};
  const me = (info.participants || []).find((p) => p.puuid === puuid);
  if (!me) return null;
  return {
    id: match.metadata?.match_id,
    time: info.game_datetime,
    length: Math.round(info.game_length || 0),
    queue: info.queue_id ?? info.queueId ?? null,
    set: info.tft_set_core_name || (info.tft_set_number ? `TFTSet${info.tft_set_number}` : null),
    placement: me.placement,
    level: me.level,
    lastRound: me.last_round,
    goldLeft: me.gold_left,
    damage: me.total_damage_to_players,
    eliminated: me.players_eliminated,
    units: (me.units || []).map((u) => ({ id: u.character_id, tier: u.tier, items: u.itemNames || [] })),
    traits: (me.traits || [])
      .filter((t) => t.tier_current > 0)
      .map((t) => ({ id: t.name, tier: t.tier_current, units: t.num_units, style: t.style })),
  };
}

async function main() {
  let cfg;
  try {
    cfg = JSON.parse(await readFile(join(ROOT, 'players.json'), 'utf8'));
  } catch {
    cfg = { players: [] };
  }
  const players = (cfg.players || []).map((p) => String(p).trim()).filter((p) => p.includes('#'));
  const region = REGIONS.has(cfg.region) ? cfg.region : 'europe';
  const count = Math.min(50, Math.max(1, Number(cfg.count) || 20));

  if (!players.length) return console.log('Keine Riot-IDs in players.json – Spiele werden übersprungen.');
  if (!KEY) return console.log('RIOT_API_KEY fehlt – Spiele werden übersprungen.');

  const cache = new Map();
  const out = [];
  for (const riotId of players) {
    const cut = riotId.lastIndexOf('#');
    const name = riotId.slice(0, cut);
    const tag = riotId.slice(cut + 1);
    try {
      const acc = await riot(region, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
      const ids = await riot(region, `/tft/match/v1/matches/by-puuid/${acc.puuid}/ids?start=0&count=${count}`);
      const matches = [];
      for (const id of ids) {
        if (!cache.has(id)) cache.set(id, await riot(region, `/tft/match/v1/matches/${id}`));
        const m = slim(cache.get(id), acc.puuid);
        if (m) matches.push(m);
      }
      out.push({ riotId: `${acc.gameName || name}#${acc.tagLine || tag}`, matches });
      console.log(`${riotId}: ${matches.length} Spiele`);
    } catch (err) {
      console.warn(`${riotId}: ${err.message}`);
      out.push({ riotId, matches: [], error: err.message });
    }
  }

  if (!out.some((p) => p.matches.length)) {
    return console.warn('Keine Spiele abgerufen – vorhandene Daten bleiben erhalten.');
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), region, players: out }));
  console.log(`Fertig: ${cache.size} Spiele für ${out.length} Spieler.`);
}

main().catch((err) => {
  // Die Seite soll trotzdem gebaut werden – nur die Spiele fehlen dann.
  console.error(`Abruf der Spiele fehlgeschlagen: ${err.message}`);
});
