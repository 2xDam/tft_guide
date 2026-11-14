// Seite „Meine Spiele“: letzte Partien aus data/matches.json, ausgewertet gegen die Meta-Daten.
// Grundlage ist nur der Endstand jeder Partie – Entscheidungen pro Runde liefert Riot nicht.

import { carries, rollLevel, isReroll, threeStarTargets, emblemNeed, styleLabel, ROUNDS } from './tips.js';
import { loadHistory, removeHistory, analyzeLog, chartSvg } from './history.js';

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

// Schwächen: Bezeichnung und was man dagegen tun kann
const WEAK = {
  level: ['Zu niedriges Level für die Comp', 'Gold bis zum Roll-Level zusammenhalten und erst dort rollen – nicht vorher verzetteln.'],
  'carry-missing': ['Haupt-Carry nicht gefunden', 'Fehlt der Carry nach dem Rolldown, früh auf eine ähnliche Comp mit denselben Items ausweichen.'],
  'carry-1star': ['Carry nur auf 1 Stern', 'Beim Rolldown zuerst die Carries auf 2 Sterne bringen, erst danach das Board abrunden.'],
  'items-few': ['Carry mit weniger als 3 Items', 'Komponenten früher zu fertigen Items bauen, auch wenn es nicht der perfekte Build ist.'],
  'items-off': ['Unpassende Items auf dem Carry', 'Vor dem Bauen die Item-Liste der Comp prüfen und im Karussell gezielt die fehlende Komponente nehmen.'],
  'reroll-none': ['Reroll ohne 3-Sterne-Einheit', 'Reroll-Comps nur spielen, wenn früh viele Kopien kommen – sonst auf eine Level-Comp wechseln.'],
  gold: ['Mit viel Gold ausgeschieden', 'Bei wenig Leben Gold ausgeben: rollen oder leveln statt Zinsen sammeln.'],
};
const STRONG = {
  'items-ok': 'Carry mit dem besten Build ausgestattet',
  'level-ok': 'Level-Ziel der Comp erreicht',
  'reroll-ok': '3-Sterne-Ziele getroffen',
};

const fmt = (n, d = 2) => n.toFixed(d).replace('.', ',');
const shortName = (riotId) => riotId.split('#')[0];

function evalPlayer(player, ctx, unitKey, itemKey) {
  const { data } = ctx;
  const games = player.matches.map((raw) => {
    const m = { ...raw, units: raw.units.map((u) => ({ ...u, id: unitKey(u.id), items: u.items.map(itemKey) })) };
    const current = !m.set || m.set === data.set;
    const found = current && ANALYZED.has(m.queue) ? findComp(m.units.map((u) => u.id), data.comps) : null;
    return { m, current, player: player.riotId, comp: found?.comp || null, findings: found ? analyze(m, found.comp, ctx) : [] };
  });
  const rated = games.filter((g) => ANALYZED.has(g.m.queue) && g.current);
  const n = rated.length;
  return {
    riotId: player.riotId,
    games,
    rated: n,
    analyzed: games.filter((g) => g.comp).length,
    avg: n ? rated.reduce((a, g) => a + g.m.placement, 0) / n : null,
    top4: n ? rated.filter((g) => g.m.placement <= 4).length / n : null,
    wins: rated.filter((g) => g.m.placement === 1).length,
  };
}

// Stärken und Schwächen über alle ausgewerteten Spiele eines Spielers
function analysisHtml(p, ctx) {
  const { esc, compName } = ctx;
  if (!p.analyzed) return '<p class="hint">Noch keine Partie mit passender Meta-Comp – keine Analyse möglich.</p>';
  const count = (kind, table) => {
    const map = new Map();
    for (const g of p.games) {
      const seen = new Set();
      for (const f of g.findings) if (f.kind === kind && table[f.key] && !seen.has(f.key)) {
        seen.add(f.key);
        map.set(f.key, (map.get(f.key) || 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  const weak = count('bad', WEAK).slice(0, 4);
  const strong = count('good', STRONG).slice(0, 3);

  const byComp = new Map();
  for (const g of p.games) if (g.comp) {
    const e = byComp.get(g.comp.id) || { comp: g.comp, n: 0, sum: 0 };
    e.n++;
    e.sum += g.m.placement;
    byComp.set(g.comp.id, e);
  }
  const comps = [...byComp.values()].sort((a, b) => b.n - a.n).slice(0, 4);

  return `<div class="ana-grid">
    <div class="ana weak"><h3>Das kostet Plätze</h3>
      ${weak.length ? `<ul>${weak.map(([k, n]) => `<li><b>${n} von ${p.analyzed} Spielen:</b> ${esc(WEAK[k][0])}<p>${esc(WEAK[k][1])}</p></li>`).join('')}</ul>` : '<p class="hint">Keine wiederkehrenden Fehler gefunden.</p>'}
    </div>
    <div class="ana strong"><h3>Das läuft gut</h3>
      ${strong.length ? `<ul>${strong.map(([k, n]) => `<li><b>${n} von ${p.analyzed} Spielen:</b> ${esc(STRONG[k])}</li>`).join('')}</ul>` : '<p class="hint">Noch nichts Auffälliges.</p>'}
      ${comps.length ? `<h3>Gespielte Comps</h3><ul class="fav">${comps.map((f) => {
        const diff = f.sum / f.n - f.comp.avg;
        return `<li><a href="#/comp/${f.comp.id}">${esc(compName(f.comp))}</a><span class="${diff <= 0 ? 'up' : 'down'}">${f.n}× · Ø ${fmt(f.sum / f.n, 1)} (Meta ${fmt(f.comp.avg, 1)})</span></li>`;
      }).join('')}</ul>` : ''}
    </div>
  </div>`;
}

export function renderGames(app, ctx, sel) {
  const { db, esc } = ctx;
  const all = ctx.matches;
  const raw = (all.players || []).filter((p) => p.matches?.length);
  const logs = loadHistory();
  app.onclick = null;
  if (sel === 'log' || !raw.length) {
    renderLogs(app, ctx, raw, logs);
    return;
  }
  const unitKey = lookup(Object.keys(db.units));
  const itemKey = lookup(Object.keys(db.items));
  const players = raw.map((p) => evalPlayer(p, ctx, unitKey, itemKey));
  const idx = sel == null || sel === 'alle' || players.length === 1 && sel == null ? (players.length === 1 ? 0 : -1) : Math.min(players.length - 1, Math.max(0, Number(sel) || 0));
  const one = idx >= 0 ? players[idx] : null;
  const date = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

  const filter = tabsHtml(players.map((p) => p.riotId), idx, logs.length, esc);

  let body;
  if (one) {
    body = `<section class="card games-sum">
        <div class="card-head"><h2>Analyse · ${esc(one.riotId)}</h2><span class="badge">${one.analyzed} von ${one.games.length} Spielen ausgewertet</span></div>
        <dl class="plan-sum">
          <div><dt>Spiele</dt><dd>${one.rated}</dd></div>
          <div><dt>Ø Platz</dt><dd>${one.avg == null ? '–' : fmt(one.avg)}</dd></div>
          <div><dt>Top 4</dt><dd>${one.top4 == null ? '–' : `${Math.round(one.top4 * 100)} %`}</dd></div>
          <div><dt>Siege</dt><dd>${one.wins}</dd></div>
        </dl>
        ${analysisHtml(one, ctx)}
      </section>
      <section class="games">${one.games.map((g) => gameCard(g, ctx, date, false)).join('')}</section>`;
  } else {
    const games = players.flatMap((p) => p.games).sort((a, b) => b.m.time - a.m.time).slice(0, 60);
    body = `<section class="card games-sum">
        <div class="card-head"><h2>Vergleich</h2></div>
        <table class="cmp"><thead><tr><th>Spieler</th><th>Spiele</th><th>Ø Platz</th><th>Top 4</th><th>Siege</th></tr></thead>
        <tbody>${[...players].sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9)).map((p) => `<tr>
          <td><a href="#/spiele/${players.indexOf(p)}">${esc(shortName(p.riotId))}</a></td><td>${p.rated}</td>
          <td>${p.avg == null ? '–' : fmt(p.avg)}</td><td>${p.top4 == null ? '–' : `${Math.round(p.top4 * 100)} %`}</td><td>${p.wins}</td></tr>`).join('')}</tbody></table>
        <p class="hint">Spieler antippen für die persönliche Analyse.</p>
      </section>
      <section class="games">${games.map((g) => gameCard(g, ctx, date, true)).join('')}</section>`;
  }

  const failed = (all.players || []).filter((p) => p.error);
  app.innerHTML = `
    <section class="picker-head">
      <h1>Spiele &amp; Analyse</h1>
      <p class="sub">Auswertung des Endstands jeder Partie gegen die Meta-Daten · Stand ${esc(new Date(all.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))}</p>
      ${filter}
      ${failed.length ? `<p class="callout">Nicht abrufbar: ${failed.map((p) => `${esc(p.riotId)} (${esc(p.error)})`).join(', ')}</p>` : ''}
    </section>
    ${body}`;
}

// Reiter: Alle | Spieler … | Mitschriften
function tabsHtml(riotIds, idx, nLogs, esc) {
  return `<div class="filters"><div class="seg scroll">
      ${riotIds.length > 1 ? `<a class="segl${idx === -1 ? ' on' : ''}" href="#/spiele/alle">Alle</a>` : ''}
      ${riotIds.map((id, i) => `<a class="segl${i === idx ? ' on' : ''}" href="#/spiele/${i}">${esc(shortName(id))}</a>`).join('')}
      <a class="segl${idx === 'log' ? ' on' : ''}" href="#/spiele/log">Mitschriften${nLogs ? ` (${nLogs})` : ''}</a>
    </div></div>`;
}

const LOG_WEAK = {
  'level-late': 'Level-Ups zu spät',
  'level-never': 'geplantes Level nicht erreicht',
  'econ-low': 'kaum Gold aufgebaut',
  'gold-hp': 'bei wenig Leben auf Gold gesessen',
  hp: 'früh viel Leben verloren',
};

// Eigene Mitschriften aus dem Modus „Runde für Runde“
let logWho = null; // gewählter Spieler-Filter, null = aktueller Spieler
function renderLogs(app, ctx, riotPlayers, allLogs) {
  const { esc } = ctx;
  const all = ctx.matches;
  const whoOf = (e) => e.player || 'Ohne Namen';
  const names = [...new Set(allLogs.map(whoOf))];
  let who = logWho ?? ctx.player;
  if (who !== '*' && !names.includes(who)) who = names.length > 1 ? '*' : names[0] || '*';
  const logs = who === '*' ? allLogs : allLogs.filter((e) => whoOf(e) === who);
  const rows = logs.map((e) => ({ e, findings: analyzeLog(e) }));
  const placed = logs.filter((e) => e.placement);
  const avg = placed.length ? placed.reduce((a, e) => a + e.placement, 0) / placed.length : null;
  const issues = new Map();
  for (const r of rows) {
    const seen = new Set();
    for (const f of r.findings) if (f.kind === 'bad' && LOG_WEAK[f.key] && !seen.has(f.key)) {
      seen.add(f.key);
      issues.set(f.key, (issues.get(f.key) || 0) + 1);
    }
  }
  const top = [...issues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const icon = { good: '✓', bad: '✗', info: 'i' };
  const date = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  app.innerHTML = `
    <section class="picker-head">
      <h1>Spiele &amp; Analyse</h1>
      <p class="sub">Mitschriften: deine im Modus „Runde für Runde“ gespeicherten Spiele – nur auf diesem Gerät.</p>
      ${tabsHtml(riotPlayers.map((p) => p.riotId), 'log', allLogs.length, esc)}
      ${names.length > 1 ? `<div class="filters"><div class="seg scroll">
        <button data-logwho="*" class="${who === '*' ? 'on' : ''}">Alle Spieler</button>
        ${names.map((n) => `<button data-logwho="${esc(n)}" class="${n === who ? 'on' : ''}">${esc(shortName(n))}</button>`).join('')}
      </div></div>` : names.length ? `<p class="sub">Spieler: ${esc(shortName(names[0]))}</p>` : ''}
    </section>
    ${logs.length ? `<section class="card games-sum">
        <dl class="plan-sum">
          <div><dt>Spiele</dt><dd>${logs.length}</dd></div>
          <div><dt>Ø Platz</dt><dd>${avg == null ? '–' : fmt(avg)}</dd></div>
          <div><dt>Top 4</dt><dd>${placed.length ? `${Math.round((placed.filter((e) => e.placement <= 4).length / placed.length) * 100)} %` : '–'}</dd></div>
          <div><dt>Siege</dt><dd>${placed.filter((e) => e.placement === 1).length}</dd></div>
        </dl>
        ${top.length ? `<h3>Wiederkehrende Muster</h3><ul class="issues">${top.map(([k, n]) => `<li><b>${n}×</b> ${esc(LOG_WEAK[k])}</li>`).join('')}</ul>` : ''}
      </section>
      <section class="games">${rows.map(({ e, findings }) => {
        const place = !e.placement ? '' : e.placement <= 4 ? (e.placement === 1 ? 'p1' : 'ptop') : 'pbot';
        const last = e.log[e.log.length - 1];
        return `<article class="card game">
          <header>
            <span class="place ${place}">${e.placement || '–'}</span>
            <div class="game-title"><b>${esc(e.compName)}</b>
              <small><em>${esc(shortName(whoOf(e)))}</em> · ${date(e.time)} · ${esc(e.style || '')} · ${e.log.length} Runden bis ${esc(ROUNDS[last?.i]?.key || '?')} · Items ${e.itemsDone}/${e.itemsTotal}</small></div>
            <button class="ghost del" data-del="${e.id}" title="Mitschrift löschen">Löschen</button>
          </header>
          ${chartSvg(e)}
          <p class="legend"><span><i class="dot hp"></i>Leben</span><span><i class="dot gold"></i>Gold</span><span><b class="lvl">7</b> Level-Up</span></p>
          <ul class="findings">${findings.map((f) => `<li class="${f.kind}"><i>${icon[f.kind]}</i>${esc(f.text)}</li>`).join('')}</ul>
        </article>`;
      }).join('')}</section>`
    : `<section class="card setup"><p>Noch keine Mitschrift. So entsteht eine:</p><ol>
        <li>Team wählen und oben auf <b>Runde für Runde</b> stellen.</li>
        <li>Während des Spiels Level, Gold und Leben aktuell halten und mit <b>Weiter</b> zur nächsten Runde gehen.</li>
        <li>Am Ende <b>Spiel beenden &amp; speichern</b> antippen und die Platzierung wählen.</li>
      </ol></section>`}
    ${riotPlayers.length ? '' : `<details class="alts"><summary>Riot-Spiele automatisch abrufen (optional)</summary>${setupHtml(all, esc)}</details>`}`;

  app.onclick = (ev) => {
    const f = ev.target.closest('button[data-logwho]');
    if (f) {
      logWho = f.dataset.logwho;
      renderLogs(app, ctx, riotPlayers, allLogs);
      return;
    }
    const b = ev.target.closest('button[data-del]');
    if (!b || !window.confirm('Diese Mitschrift löschen?')) return;
    removeHistory(b.dataset.del);
    renderLogs(app, ctx, riotPlayers, loadHistory());
  };
}

function gameCard(g, ctx, date, showPlayer) {
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
        <small>${showPlayer ? `<em>${esc(shortName(g.player))}</em> · ` : ''}${date(m.time)} · ${esc(QUEUES[m.queue] || 'Sondermodus')} · Level ${m.level} · ${m.goldLeft} Gold übrig</small>
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
  return `<section class="card setup"><p>So richtest du den Abruf deiner Riot-Spiele ein:</p><ol>
      <li>Auf <a href="https://developer.riotgames.com" target="_blank" rel="noopener">developer.riotgames.com</a> anmelden und einen persönlichen API-Schlüssel beantragen („Register Product → Personal API Key“).</li>
      <li>Im GitHub-Repository unter <b>Settings → Secrets and variables → Actions</b> ein Secret namens <code>RIOT_API_KEY</code> mit dem Schlüssel anlegen.</li>
      <li>In <code>players.json</code> die Riot-IDs eintragen, z. B. <code>"players": ["Name#EUW"]</code>, und pushen.</li>
      <li>Der Workflow ruft die Spiele bei jedem Push und einmal täglich ab.</li>
    </ol>
    ${errs.length ? `<p class="callout">Letzter Abruf: ${errs.map((p) => `${esc(p.riotId)} – ${esc(p.error)}`).join('; ')}</p>` : ''}
    </section>`;
}
