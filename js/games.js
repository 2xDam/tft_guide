// Seite „Meine Spiele“: letzte Partien aus data/matches.json, ausgewertet gegen die Meta-Daten.
// Grundlage ist nur der Endstand jeder Partie – Entscheidungen pro Runde liefert Riot nicht.

import { carries, rollLevel, isReroll, threeStarTargets, emblemNeed, styleLabel } from './tips.js';

const QUEUES = { 1100: 'Ranked', 1090: 'Normal', 1130: 'Hyper Roll', 1160: 'Double Up', 1150: 'Double Up' };
const ANALYZED = new Set([1090, 1100]);

let cache = null;
export async function loadMatches() {
  if (cache) return cache;
  try {
    const res = await fetch('data/matches.json', { cache: 'no-cache' });
    cache = res.ok ? await res.json() : { players: [] };
  } catch {
    cache = { players: [] };
  }
  return cache;
}

function lookup(keys) {
  const map = new Map(keys.map((k) => [k.toLowerCase(), k]));
  return (id) => map.get(String(id).toLowerCase()) || id;
}

// Passende Meta-Comp: größte Überschneidung mit dem gespielten Board
function findComp(units, comps) {
  const mine = new Set(units);
  let best = null;
  for (const c of comps) {
    const boards = [c.units, ...Object.values(c.finals).flat().map((f) => f.units)];
    for (const b of boards) {
      const set = new Set(b);
      let hit = 0;
      for (const u of set) if (mine.has(u)) hit++;
      const score = hit / Math.max(set.size, mine.size || 1);
      if (!best || score > best.score) best = { comp: c, score, hit };
    }
  }
  return best && best.score >= 0.55 ? best : null;
}

function analyze(m, comp, ctx) {
  const { db } = ctx;
  const out = [];
  const add = (kind, key, text) => out.push({ kind, key, text });
  const name = (u) => db.units[u]?.name || u;
  const byId = new Map(m.units.map((u) => [u.id, u]));
  const top4 = m.placement <= 4;

  add(top4 ? 'good' : 'bad', top4 ? 'top4' : 'bot4',
    `Platz ${m.placement} – die Comp landet im Schnitt auf ${comp.avg.toFixed(2).replace('.', ',')}.`);

  // Level
  const roll = rollLevel(comp);
  const best = [...comp.finalLevels].filter((f) => f.pct >= 0.08).sort((a, b) => a.avg - b.avg)[0];
  if (!isReroll(comp) && m.level < roll) {
    add('bad', 'level', `Auf Level ${m.level} geblieben – die Comp braucht Level ${roll} (${styleLabel(comp)}).`);
  } else if (best && m.level < best.level && !top4) {
    add('info', 'level-late', `Endlevel ${m.level}. Am besten schneidet die Comp auf Level ${best.level} ab (Ø Platz ${best.avg.toFixed(1).replace('.', ',')}).`);
  } else if (best && m.level >= best.level) {
    add('good', 'level-ok', `Level ${m.level} erreicht – passt zum Plan der Comp.`);
  }

  // Carries: vorhanden, Sterne, Items
  const cs = carries(comp).filter((u) => comp.units.includes(u)).slice(0, 3);
  cs.forEach((u, idx) => {
    const mine = byId.get(u);
    if (!mine) {
      if (idx === 0) add('bad', 'carry-missing', `Haupt-Carry ${name(u)} stand am Ende nicht auf dem Board.`);
      return;
    }
    if (mine.tier <= 1 && (db.units[u]?.cost || 0) <= 4) add('bad', 'carry-1star', `${name(u)} hatte nur 1 Stern.`);
    const main = comp.builds[u][0].items;
    const known = new Set(comp.builds[u].flatMap((b) => b.items));
    comp.topItems.filter((t) => t.unit === u).forEach((t) => known.add(t.item));
    const have = mine.items;
    const hitMain = have.filter((i) => main.includes(i)).length;
    const hitKnown = have.filter((i) => known.has(i)).length;
    if (have.length < 3) {
      add(idx === 0 ? 'bad' : 'info', 'items-few', `${name(u)} hatte nur ${have.length} von 3 Items.`);
    } else if (hitMain >= 2) {
      add('good', 'items-ok', `${name(u)}: ${hitMain} von 3 Items aus dem besten Build.`);
    } else if (hitKnown >= 2) {
      add('info', 'items-alt', `${name(u)}: brauchbarer Alternativ-Build, aber nicht der stärkste.`);
    } else {
      add('bad', 'items-off', `${name(u)}: Items weichen deutlich von den erfolgreichen Builds ab.`);
    }
  });

  // Reroll-Ziele
  if (isReroll(comp)) {
    const targets = threeStarTargets(comp).filter((u) => byId.has(u));
    const done = targets.filter((u) => byId.get(u).tier >= 3);
    if (targets.length && !done.length) add('bad', 'reroll-none', `Kein 3-Sterne-Ziel getroffen (${targets.slice(0, 3).map(name).join(', ')}).`);
    else if (done.length) add('good', 'reroll-ok', `3 Sterne auf ${done.map(name).join(', ')}.`);
  }

  // Emblem
  const emblem = emblemNeed(comp, db);
  if (emblem && byId.has(emblem.unit) && !byId.get(emblem.unit).items.includes(emblem.item)) {
    add('info', 'emblem', `Ohne ${db.items[emblem.item]?.name || 'Emblem'} gespielt – damit ist die Comp deutlich stärker.`);
  }

  // Gold
  if (!top4 && m.goldLeft >= 30) add('bad', 'gold', `Mit ${m.goldLeft} Gold ausgeschieden – das hätte ins Board gehört.`);
  else if (m.placement === 1 && m.goldLeft >= 50) add('info', 'gold-win', `Sieg mit ${m.goldLeft} Gold auf der Bank.`);

  return out;
}

const KEY_LABEL = {
  level: 'zu niedriges Level für die Comp',
  'carry-missing': 'Haupt-Carry nicht gefunden',
  'carry-1star': 'Carry nur auf 1 Stern',
  'items-few': 'Carry mit weniger als 3 Items',
  'items-off': 'unpassende Items auf dem Carry',
  'reroll-none': 'Reroll ohne 3-Sterne-Einheit',
  gold: 'mit viel Gold ausgeschieden',
};

export function renderGames(app, ctx, sel) {
  const { data, db, esc, img, compName } = ctx;
  const all = ctx.matches;
  const players = (all.players || []).filter((p) => p.matches?.length);
  if (!players.length) {
    app.innerHTML = setupHtml(all, esc);
    return;
  }
  const idx = Math.min(players.length - 1, Math.max(0, Number(sel) || 0));
  const player = players[idx];
  const unitKey = lookup(Object.keys(db.units));
  const itemKey = lookup(Object.keys(db.items));

  const games = player.matches.map((raw) => {
    const m = {
      ...raw,
      units: raw.units.map((u) => ({ ...u, id: unitKey(u.id), items: u.items.map(itemKey) })),
    };
    const current = !m.set || m.set === data.set;
    const found = current && ANALYZED.has(m.queue) ? findComp(m.units.map((u) => u.id), data.comps) : null;
    return { m, current, comp: found?.comp || null, findings: found ? analyze(m, found.comp, ctx) : [] };
  });

  const rated = games.filter((g) => ANALYZED.has(g.m.queue) && g.current);
  const avg = rated.length ? rated.reduce((a, g) => a + g.m.placement, 0) / rated.length : null;
  const top4 = rated.length ? rated.filter((g) => g.m.placement <= 4).length / rated.length : null;
  const wins = rated.filter((g) => g.m.placement === 1).length;

  const issues = new Map();
  for (const g of games) for (const f of g.findings) if (f.kind === 'bad' && KEY_LABEL[f.key]) issues.set(f.key, (issues.get(f.key) || 0) + 1);
  const analyzed = games.filter((g) => g.comp).length;
  const topIssues = [...issues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const compCount = new Map();
  for (const g of games) if (g.comp) {
    const e = compCount.get(g.comp.id) || { comp: g.comp, n: 0, sum: 0 };
    e.n++;
    e.sum += g.m.placement;
    compCount.set(g.comp.id, e);
  }
  const favs = [...compCount.values()].sort((a, b) => b.n - a.n).slice(0, 3);

  const fmt = (n, d = 2) => n.toFixed(d).replace('.', ',');
  const date = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

  app.innerHTML = `
    <section class="picker-head">
      <h1>Meine Spiele</h1>
      <p class="sub">Auswertung des Endstands jeder Partie gegen die Meta-Daten. Stand: ${esc(new Date(all.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</p>
      ${players.length > 1 ? `<div class="filters"><div class="seg scroll">${players.map((p, i) =>
        `<a class="segl${i === idx ? ' on' : ''}" href="#/spiele/${i}">${esc(p.riotId.split('#')[0])}</a>`).join('')}</div></div>` : `<p class="sub">${esc(player.riotId)}</p>`}
    </section>
    <section class="card games-sum">
      <dl class="plan-sum">
        <div><dt>Spiele</dt><dd>${rated.length}</dd></div>
        <div><dt>Ø Platz</dt><dd>${avg == null ? '–' : fmt(avg)}</dd></div>
        <div><dt>Top 4</dt><dd>${top4 == null ? '–' : `${Math.round(top4 * 100)} %`}</dd></div>
        <div><dt>Siege</dt><dd>${wins}</dd></div>
      </dl>
      ${favs.length ? `<h3>Meistgespielt</h3><ul class="fav">${favs.map((f) =>
        `<li><a href="#/comp/${f.comp.id}">${esc(compName(f.comp))}</a><span>${f.n}× · Ø ${fmt(f.sum / f.n, 1)}</span></li>`).join('')}</ul>` : ''}
      ${topIssues.length ? `<h3>Wiederkehrende Muster <small>in ${analyzed} ausgewerteten Spielen</small></h3>
        <ul class="issues">${topIssues.map(([k, n]) => `<li><b>${n}×</b> ${esc(KEY_LABEL[k])}</li>`).join('')}</ul>` : ''}
    </section>
    <section class="games">${games.map((g) => gameCard(g, ctx, date)).join('')}</section>`;
}

function gameCard(g, ctx, date) {
  const { db, esc, img, compName } = ctx;
  const { m, comp, findings } = g;
  const units = [...m.units].sort((a, b) => (db.units[a.id]?.cost || 0) - (db.units[b.id]?.cost || 0));
  const place = m.placement <= 4 ? (m.placement === 1 ? 'p1' : 'ptop') : 'pbot';
  const icon = { good: '✓', bad: '✗', info: 'i' };
  return `<article class="card game">
    <header>
      <span class="place ${place}">${m.placement}</span>
      <div class="game-title">
        ${comp ? `<a href="#/comp/${comp.id}">${esc(compName(comp))}</a>` : `<b>${g.current ? 'Eigene Comp' : 'Älteres Set'}</b>`}
        <small>${date(m.time)} · ${esc(QUEUES[m.queue] || 'Sondermodus')} · Level ${m.level} · ${m.goldLeft} Gold übrig</small>
      </div>
    </header>
    <div class="unit-row">${units.map((u) => {
      const un = db.units[u.id] || { name: u.id, cost: 0, icon: null };
      return `<span class="unit cost-${un.cost}" title="${esc(un.name)}">${img(un.icon, un.name, 'unit-img')}
        <span class="stars">${'★'.repeat(Math.min(3, u.tier || 1))}</span>
        ${u.items.length ? `<span class="unit-items">${u.items.slice(0, 3).map((i) => img(db.items[i]?.icon, db.items[i]?.name || i)).join('')}</span>` : ''}</span>`;
    }).join('')}</div>
    ${findings.length ? `<ul class="findings">${findings.map((f) =>
      `<li class="${f.kind}"><i>${icon[f.kind]}</i>${esc(f.text)}</li>`).join('')}</ul>`
      : `<p class="hint">${!g.current ? 'Aus einem anderen Set – keine Auswertung.' : ANALYZED.has(m.queue) ? 'Keine passende Meta-Comp gefunden – keine Auswertung.' : 'Sondermodus – keine Auswertung.'}</p>`}
  </article>`;
}

function setupHtml(all, esc) {
  const errs = (all.players || []).filter((p) => p.error);
  return `<section class="picker-head"><h1>Meine Spiele</h1>
    <p class="sub">Noch keine Spiele vorhanden. So richtest du den Abruf ein:</p></section>
    <section class="card setup"><ol>
      <li>Auf <a href="https://developer.riotgames.com" target="_blank" rel="noopener">developer.riotgames.com</a> anmelden und einen persönlichen API-Schlüssel beantragen („Register Product → Personal API Key“).</li>
      <li>Im GitHub-Repository unter <b>Settings → Secrets and variables → Actions</b> ein Secret namens <code>RIOT_API_KEY</code> mit dem Schlüssel anlegen.</li>
      <li>In <code>players.json</code> die Riot-IDs eintragen, z. B. <code>"players": ["Name#EUW"]</code>, und pushen.</li>
      <li>Der Workflow ruft die Spiele bei jedem Push und einmal täglich ab.</li>
    </ol>
    ${errs.length ? `<p class="callout">Letzter Abruf: ${errs.map((p) => `${esc(p.riotId)} – ${esc(p.error)}`).join('; ')}</p>` : ''}
    </section>`;
}
