#!/usr/bin/env node
// Importiert die aktuellen Meta-Comps von MetaTFT und die statischen Spieldaten
// (Namen, Icons, Item-Rezepte) von CommunityDragon und schreibt sie kompakt nach data/.
//
//   node scripts/fetch-data.mjs
//
// Schlägt der Import fehl und es existieren bereits Daten, bleiben diese erhalten.

import { writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');
const META = 'https://api-hc.metatft.com/tft-comps-api';
const CDRAGON = 'https://raw.communitydragon.org/latest';
const LOCALE = process.env.TFT_LOCALE || 'de_de';
const MIN_GAMES = 2000; // Comps mit weniger Spielen sind statistisch zu dünn
const UA = 'tft-guide-importer';

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i], i);
      }
    }),
  );
  return out;
}

const icon = (path) =>
  path ? path.toLowerCase().replace(/\.(tex|dds)$/, '.png') : null;
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const splitList = (s, sep) => (s ? s.split(sep).map((x) => x.trim()).filter(Boolean) : []);

function parseTraits(list) {
  return list
    .map((t) => {
      const m = t.match(/^(.*)_(\d+)$/);
      return m ? [m[1], Number(m[2])] : null;
    })
    .filter(Boolean);
}

// Bestes Board aus einer Options-Liste: Score gewichtet Häufigkeit und Platzierung.
function bestOptions(list, n) {
  return [...(list || [])]
    .filter((o) => o.count >= 50)
    .sort((a, b) => (b.score ?? b.count) - (a.score ?? a.count))
    .slice(0, n);
}

function buildComp(base, details, placeStats) {
  const units = splitList(base.units_string, ',');
  const total = placeStats?.count || base.overall?.count || 0;
  const places = placeStats?.places?.slice(0, 8) || [];
  const top4 = total ? places.slice(0, 4).reduce((a, b) => a + b, 0) / total : null;
  const win = total ? (places[0] || 0) / total : null;

  // Level-Zeitplan: in welcher Runde wurde welches Level typischerweise erreicht
  const levels = (details.levels || [])
    .filter((l) => l.stage && l.round)
    .map((l) => ({ level: l.level, stage: Number(l.stage), round: Number(l.round) }))
    .sort((a, b) => a.level - b.level);

  const finalTotal = (details.final_levels || []).reduce((a, l) => a + l.count, 0);
  const finalLevels = (details.final_levels || [])
    .map((l) => ({ level: Number(l.level), pct: round4(l.count / finalTotal), avg: l.avg }))
    .sort((a, b) => a.level - b.level);

  // Auf welchem Level wird gerollt
  const rr = Object.entries(details.rerolls || {})
    .map(([lvl, v]) => ({ level: Number(lvl), rerolls: Math.max(0, v.rerolls) }))
    .filter((r) => r.level >= 4);
  const rrTotal = rr.reduce((a, r) => a + r.rerolls, 0) || 1;
  const rolls = rr
    .map((r) => ({ level: r.level, pct: round4(r.rerolls / rrTotal) }))
    .filter((r) => r.pct >= 0.05)
    .sort((a, b) => a.level - b.level);

  // Einheiten-Statistik: Spielrate, 3-Sterne-Quote, Item-Träger
  const unitStats = {};
  for (const u of details.unit_stats || []) {
    if (u.pcnt < 0.08) continue;
    const t3 = u.tiers?.find((t) => t.tier === 3)?.pcnt || 0;
    const full = u.num_items?.find((n) => n.num_items === 3)?.pcnt || 0;
    unitStats[u.unit] = { play: round4(u.pcnt), star3: round4(t3), items3: round4(full) };
  }

  // Builds je Einheit: Haupt-Build aus der Comp-Übersicht, Alternativen aus den Details
  const builds = {};
  for (const b of base.builds || []) {
    builds[b.unit] = [{ items: b.buildName, avg: b.avg, count: b.count, main: true }];
  }
  const alt = {};
  for (const b of details.builds || []) {
    if (b.num_items !== 3 || b.count < 100) continue;
    (alt[b.unit] ||= []).push(b);
  }
  for (const [unit, list] of Object.entries(alt)) {
    const st = unitStats[unit];
    if (!st || (st.items3 < 0.3 && !builds[unit])) continue;
    list.sort((a, b) => (b.adjusted_score ?? b.score) - (a.adjusted_score ?? a.score));
    const have = (builds[unit] ||= []);
    for (const b of list) {
      if (have.length >= 3) break;
      const key = [...b.buildName].sort().join('|');
      if (have.some((h) => [...h.items].sort().join('|') === key)) continue;
      have.push({ items: b.buildName, avg: b.avg, count: b.count });
    }
  }

  // Beliebteste Einzel-Items mit ihrem häufigsten Träger
  const topItems = (details.itemNames || [])
    .filter((i) => i.pcnt >= 0.12)
    .slice(0, 14)
    .map((i) => ({ item: i.itemNames, pct: round4(i.pcnt), avg: i.avg, unit: i.units?.[0]?.units || null }));

  // Positionierung: häufigste Felder je Einheit
  const positions = {};
  for (const [unit, p] of Object.entries(details.positioning?.units || {})) {
    positions[unit] = (p.positions || [])
      .slice(0, 6)
      .map((c) => [Number(String(c.cell).replace('cell_', '')), c.count]);
  }

  const boards = {};
  for (const [lvl, list] of Object.entries(details.early_options || {})) {
    const top = [...list].sort((a, b) => b.count - a.count).slice(0, 2);
    if (top.length)
      boards[lvl] = top.map((o) => ({ units: splitList(o.unit_list, '&'), avg: o.avg, count: o.count, win: o.win }));
  }
  const finals = {};
  for (const [lvl, list] of Object.entries(details.options || {})) {
    const top = bestOptions(list, 3);
    if (top.length)
      finals[lvl] = top.map((o) => ({
        units: splitList(o.units_list, '&'),
        traits: parseTraits(splitList(o.traits_list, '&')),
        avg: o.avg,
        count: o.count,
      }));
  }

  return {
    id: String(base.Cluster),
    name: (base.name || []).map((n) => ({ id: n.name, type: n.type })),
    units,
    traits: parseTraits(splitList(base.traits_string, ',')),
    style: base.levelling || 'Standard',
    avg: base.overall?.avg ?? null,
    count: total,
    top4: top4 && round4(top4),
    win: win && round4(win),
    difficulty: base.difficulty ?? null,
    levels,
    finalLevels,
    rolls,
    unitStats,
    builds,
    topItems,
    positions,
    boards,
    finals,
  };
}

function buildStatic(cd, setKey, comps) {
  const setNum = setKey.replace(/\D/g, '');
  const set = cd.sets[setNum];
  if (!set) throw new Error(`Set ${setNum} fehlt in den CommunityDragon-Daten`);

  const usedUnits = new Set();
  const usedItems = new Set();
  for (const c of comps) {
    c.units.forEach((u) => usedUnits.add(u));
    Object.keys(c.unitStats).forEach((u) => usedUnits.add(u));
    Object.keys(c.positions).forEach((u) => usedUnits.add(u));
    Object.values(c.boards).flat().forEach((b) => b.units.forEach((u) => usedUnits.add(u)));
    Object.values(c.finals).flat().forEach((b) => b.units.forEach((u) => usedUnits.add(u)));
    Object.values(c.builds).flat().forEach((b) => b.items.forEach((i) => usedItems.add(i)));
    c.topItems.forEach((i) => usedItems.add(i.item));
  }

  const traitByName = new Map(set.traits.map((t) => [t.name, t.apiName]));
  const units = {};
  for (const ch of set.champions) {
    if (!usedUnits.has(ch.apiName) && !(ch.traits?.length && ch.cost <= 5)) continue;
    units[ch.apiName] = {
      name: ch.name,
      cost: ch.cost,
      traits: (ch.traits || []).map((t) => traitByName.get(t) || t),
      icon: icon(ch.tileIcon || ch.squareIcon || ch.icon),
    };
  }
  // Beschworene Einheiten o. Ä., die nur in anderen Listen stehen
  const allChamps = new Map(Object.values(cd.sets).flatMap((s) => s.champions).map((c) => [c.apiName, c]));
  for (const id of usedUnits) {
    if (units[id]) continue;
    // Varianten wie "…_AP"/"…_AD" auf die Basis-Einheit des Sets abbilden
    const stem = id.replace(/_(AP|AD)$/, '');
    const variant = set.champions.find(
      (c) => c.traits?.length && (c.apiName === stem || c.apiName.startsWith(`${stem}_`)),
    );
    if (variant && units[variant.apiName]) {
      units[id] = { ...units[variant.apiName], alias: variant.apiName };
      continue;
    }
    const ch = allChamps.get(id);
    units[id] = ch
      ? { name: ch.name, cost: ch.cost || 0, traits: [], icon: icon(ch.tileIcon || ch.squareIcon || ch.icon), summon: true }
      : { name: id.replace(/^DA_|^TFT\d*_|18/g, '').replace(/_/g, ' '), cost: 0, traits: [], icon: null, summon: true };
  }

  const traits = {};
  for (const t of set.traits) {
    traits[t.apiName] = {
      name: t.name,
      icon: icon(t.icon),
      steps: (t.effects || []).map((e) => [e.minUnits, e.style]),
    };
  }

  const itemMap = new Map(cd.items.map((i) => [i.apiName, i]));
  const items = {};
  const addItem = (id) => {
    if (items[id]) return;
    const it = itemMap.get(id);
    if (!it) {
      items[id] = { name: id, icon: null, recipe: [] };
      return;
    }
    items[id] = { name: it.name, icon: icon(it.icon), recipe: it.composition || [] };
    (it.composition || []).forEach(addItem);
  };
  usedItems.forEach(addItem);
  cd.items.filter((i) => /_Component_/.test(i.apiName) && /^DA_|^TFT_Item_/.test(i.apiName)).forEach((i) => addItem(i.apiName));
  const components = Object.keys(items).filter((id) => /_Component_|^TFT_Item_(BFSword|RecurveBow|NeedlesslyLargeRod|TearOfTheGoddess|ChainVest|NegatronCloak|GiantsBelt|SparringGloves|Spatula|FryingPan)$/.test(id));

  return { setName: `Set ${setNum}`, units, traits, items, components, iconBase: `${CDRAGON}/game/` };
}

async function main() {
  console.log('Lade Comps von MetaTFT …');
  const [compsData, compsStats] = await Promise.all([
    getJson(`${META}/comps_data`),
    getJson(`${META}/comps_stats`),
  ]);
  const setKey = compsData.tft_set || compsData.results?.data?.tft_set;
  const clusterId = compsData.cluster_id;
  const details = compsData.results?.data?.cluster_details || {};
  const stats = new Map((compsStats.results || []).map((s) => [String(s.cluster), s]));

  const candidates = Object.values(details).filter(
    (c) => c.units_string && c.overall && (stats.get(String(c.Cluster))?.count || c.overall.count) >= MIN_GAMES,
  );
  console.log(`${candidates.length} Comps (${setKey}), lade Details …`);

  const comps = (
    await mapLimit(candidates, 4, async (c) => {
      try {
        const d = await getJson(`${META}/comp_details?comp=${c.Cluster}&cluster_id=${clusterId}`);
        return buildComp(c, d.results || {}, stats.get(String(c.Cluster)));
      } catch (err) {
        console.warn(`  übersprungen ${c.Cluster}: ${err.message}`);
        return null;
      }
    })
  ).filter(Boolean);
  if (comps.length < 5) throw new Error('Zu wenige Comps importiert');
  comps.sort((a, b) => a.avg - b.avg);

  console.log(`Lade Spieldaten (${LOCALE}) von CommunityDragon …`);
  const cd = await getJson(`${CDRAGON}/cdragon/tft/${LOCALE}.json`);
  const staticData = buildStatic(cd, setKey, comps);

  await mkdir(OUT, { recursive: true });
  const meta = { set: setKey, setName: staticData.setName, updated: new Date().toISOString(), source: 'MetaTFT', comps };
  await writeFile(join(OUT, 'comps.json'), JSON.stringify(meta));
  await writeFile(join(OUT, 'static.json'), JSON.stringify(staticData));
  console.log(`Fertig: ${comps.length} Comps, ${Object.keys(staticData.units).length} Einheiten, ${Object.keys(staticData.items).length} Items.`);
}

main().catch(async (err) => {
  console.error(`Import fehlgeschlagen: ${err.message}`);
  try {
    await access(join(OUT, 'comps.json'));
    console.error('Vorhandene Daten bleiben erhalten.');
  } catch {
    process.exitCode = 1;
  }
});
