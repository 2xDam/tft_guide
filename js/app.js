import {
  ROUNDS, TYPE_LABEL, roundIndex, roundType, isAugmentRound, schedule, standardSchedule, targetLevel,
  rollLevel, isReroll, styleLabel, carries, threeStarTargets, componentPriority, emblemNeed,
  buildTips, upcoming, gamePlan,
} from './tips.js';
import { loadMatches, renderGames } from './games.js';
import { renderFreestyle, freestyleActive, freestyleRank, freestyleHandover, freestyleCount } from './freestyle.js';
import { addHistory } from './history.js';

const app = document.getElementById('app');
const STORE = 'tft-guide-state-v1';
let data = null; // { comps, set, updated }
let db = null; // statische Daten
let ui = { search: '', style: 'all', boardTab: 'now', variant: 0 };
let game = loadGame();
const MODE = 'tft-guide-mode';
let mode = 'track';
try {
  mode = localStorage.getItem(MODE) === 'overview' ? 'overview' : 'track';
} catch { /* privater Modus */ }
const overview = () => mode === 'overview';

// Favoriten pro Gerät. Schlüssel ist der Comp-Name (Synergie + Einheiten), weil sich die
// internen Nummern der Comps bei jedem Daten-Update ändern können.
const FAVS = 'tft-guide-favs-v1';
let favs = new Set();
try {
  favs = new Set(JSON.parse(localStorage.getItem(FAVS) || '[]'));
} catch { /* privater Modus */ }
const favKey = (c) => c.name.map((n) => n.id).join('+') || c.id;
const isFav = (c) => favs.has(favKey(c));
function toggleFav(c) {
  const k = favKey(c);
  favs.has(k) ? favs.delete(k) : favs.add(k);
  try {
    localStorage.setItem(FAVS, JSON.stringify([...favs]));
  } catch { /* privater Modus */ }
}
const favButton = (c) => `<button class="fav-btn${isFav(c) ? ' on' : ''}" data-fav="${c.id}" aria-pressed="${isFav(c)}" title="${isFav(c) ? 'Favorit entfernen' : 'Als Favorit merken'}">${isFav(c) ? '★' : '☆'}</button>`;

// ---------- Hilfen ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (n) => (n == null ? '–' : `${(n * 100).toFixed(1).replace('.', ',')} %`);
const num = (n, d = 2) => (n == null ? '–' : n.toFixed(d).replace('.', ','));
const img = (path, alt, cls = '') =>
  path ? `<img class="${cls}" src="${esc(db.iconBase + path)}" alt="${esc(alt)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="${cls} noimg"></span>`;
const unit = (id) => db.units[id] || { name: id, cost: 0, traits: [], icon: null };
const item = (id) => db.items[id] || { name: id, icon: null, recipe: [] };
const isReal = (id) => !unit(id).summon;

function defaultGame() {
  return { stage: 2, round: 1, level: 4, gold: 10, hp: 100, streak: 'none', owned: {}, items: {}, log: {} };
}
function loadGame() {
  try {
    return { ...defaultGame(), ...JSON.parse(localStorage.getItem(STORE) || '{}') };
  } catch {
    return defaultGame();
  }
}
function saveGame() {
  try {
    localStorage.setItem(STORE, JSON.stringify(game));
  } catch { /* privater Modus */ }
}

function compName(c) {
  const parts = c.name.map((n) => (n.type === 'trait' ? db.traits[n.id]?.name : unit(n.id).name)).filter(Boolean);
  return parts.length ? parts.join(' · ') : `Comp ${c.id}`;
}
function tier(c) {
  if (c.avg <= 4.3) return 'S';
  if (c.avg <= 4.5) return 'A';
  if (c.avg <= 4.75) return 'B';
  return 'C';
}
const byCost = (a, b) => unit(a).cost - unit(b).cost || unit(a).name.localeCompare(unit(b).name);

function unitChip(id, opts = {}) {
  const u = unit(id);
  const items = opts.items || [];
  return `<span class="unit cost-${u.cost}${opts.dim ? ' dim' : ''}" title="${esc(u.name)}">
    ${img(u.icon, u.name, 'unit-img')}
    ${opts.stars ? `<span class="stars">★★★</span>` : ''}
    ${items.length ? `<span class="unit-items">${items.map((i) => img(item(i).icon, item(i).name)).join('')}</span>` : ''}
  </span>`;
}

// ---------- Teamwahl ----------
function renderPicker() {
  const styles = [
    ['all', 'Alle'], ['fast', 'Fast 8 / 9'], ['reroll', 'Reroll'],
  ];
  const q = ui.search.trim().toLowerCase();
  const list = data.comps.filter((c) => {
    if (ui.style === 'fast' && isReroll(c)) return false;
    if (ui.style === 'reroll' && !isReroll(c)) return false;
    if (!q) return true;
    const hay = [compName(c), ...c.units.map((u) => unit(u).name), ...c.traits.map(([t]) => db.traits[t]?.name)].join(' ').toLowerCase();
    return hay.includes(q);
  });

  app.innerHTML = `
    <section class="picker-head">
      <h1>Welches Team spielst du?</h1>
      <p class="sub">${data.comps.length} Meta-Comps aus ${esc(data.setName || data.set)}, sortiert nach durchschnittlicher Platzierung. Mit dem Stern ☆ merkst du dir Favoriten.</p>
      <div class="filters">
        <input id="search" type="search" placeholder="Einheit oder Synergie suchen …" value="${esc(ui.search)}" autocomplete="off">
        <div class="seg" role="group" aria-label="Spielstil">
          ${styles.map(([k, l]) => `<button data-style="${k}" class="${ui.style === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </div>
    </section>
    ${list.some(isFav) ? `<h2 class="grid-title">★ Favoriten</h2>
    <section class="comp-grid">${list.filter(isFav).map(compCard).join('')}</section>
    <h2 class="grid-title">Alle Teams</h2>` : ''}
    <section class="comp-grid">
      ${list.filter((c) => !isFav(c)).map(compCard).join('') || (list.length ? '' : '<p class="empty">Keine Comp passt zur Suche.</p>')}
    </section>`;

  app.querySelectorAll('[data-fav]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = data.comps.find((x) => x.id === b.dataset.fav);
      if (!c) return;
      toggleFav(c);
      const y = window.scrollY;
      renderPicker();
      window.scrollTo(0, y);
    }));

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    ui.search = search.value;
    const pos = search.selectionStart;
    renderPicker();
    const s = document.getElementById('search');
    s.focus();
    s.setSelectionRange(pos, pos);
  });
  app.querySelectorAll('[data-style]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.style = b.dataset.style;
      renderPicker();
    }));
}

function compCard(c) {
  const t = tier(c);
  const main = new Set(carries(c).slice(0, 2));
  return `<div class="comp-wrap">${favButton(c)}<a class="comp-card" href="#/comp/${c.id}">
    <div class="comp-card-top">
      <span class="tier tier-${t}">${t}</span>
      <div class="comp-title">
        <strong>${esc(compName(c))}</strong>
        <span class="badge">${esc(styleLabel(c))}</span>
      </div>
    </div>
    <div class="unit-row">${[...c.units].sort(byCost).map((u) => unitChip(u, { items: main.has(u) ? c.builds[u][0].items : [] })).join('')}</div>
    <span class="card-stats">Ø <b>${num(c.avg)}</b> · Top 4 <b>${pct(c.top4)}</b> · Sieg <b>${pct(c.win)}</b></span>
  </a></div>`;
}

// ---------- Board ----------
// MetaTFT zählt Felder 1–28 von hinten rechts; Index 0 ist vorne links.
function layoutBoard(comp, units) {
  const cells = new Array(28).fill(null);
  const todo = [...new Set(units)].filter(isReal);
  const pairs = [];
  for (const u of todo) for (const [cell, count] of comp.positions[u] || comp.positions[unit(u).alias] || []) pairs.push([u, 28 - cell, count]);
  pairs.sort((a, b) => b[2] - a[2]);
  const placed = new Set();
  for (const [u, idx] of pairs) {
    if (placed.has(u) || idx < 0 || idx > 27 || cells[idx]) continue;
    cells[idx] = u;
    placed.add(u);
  }
  // Ohne Positionsdaten: Item-Träger nach hinten, Rest nach vorne
  for (const u of todo.filter((x) => !placed.has(x))) {
    const back = !!comp.builds[u] && unit(u).cost >= 4;
    const order = back ? [27, 21, 26, 22, 25, 23, 24] : [3, 2, 4, 1, 5, 0, 6, 10, 9, 11];
    const free = order.find((i) => !cells[i]) ?? cells.findIndex((x) => !x);
    if (free >= 0) cells[free] = u;
  }
  return cells;
}

function activeTraits(units, given) {
  if (given?.length) {
    return given
      .map(([id, tierIdx]) => {
        const t = db.traits[id];
        const step = t?.steps[tierIdx - 1];
        return t && step ? { id, name: t.name, icon: t.icon, count: step[0], style: step[1] } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.style - a.style || b.count - a.count);
  }
  const counts = {};
  for (const u of new Set(units)) for (const t of unit(u).traits) counts[t] = (counts[t] || 0) + 1;
  return Object.entries(counts)
    .map(([id, n]) => {
      const t = db.traits[id];
      const step = t?.steps.filter((s) => s[0] <= n).pop();
      return step ? { id, name: t.name, icon: t.icon, count: n, style: step[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.style - a.style || b.count - a.count);
}

function boardOptions(comp) {
  const tabs = [];
  if (overview()) {
    const levels = [...new Set([...Object.keys(comp.boards), ...Object.keys(comp.finals)].map(Number))].sort((a, b) => a - b);
    for (const l of levels) {
      const early = comp.boards[l] && (l <= 6 || !comp.finals[l]);
      tabs.push({ key: `f${l}`, label: `Lvl ${l}`, level: l, options: early ? comp.boards[l] : comp.finals[l], early });
    }
    if (!tabs.length) tabs.push({ key: 'base', label: 'Zielboard', level: comp.units.length, options: [{ units: comp.units, traits: comp.traits }] });
    return tabs;
  }
  const lvl = game.level;
  const early = comp.boards[lvl];
  const late = comp.finals[lvl];
  if (early && lvl <= 7) tabs.push({ key: 'now', label: `Jetzt · Lvl ${lvl}`, level: lvl, options: early, early: true });
  else if (late) tabs.push({ key: 'now', label: `Jetzt · Lvl ${lvl}`, level: lvl, options: late });
  for (const l of Object.keys(comp.finals).map(Number).sort((a, b) => a - b)) {
    if (l === lvl && !(early && lvl <= 7)) continue;
    tabs.push({ key: `f${l}`, label: `Lvl ${l}`, level: l, options: comp.finals[l] });
  }
  if (!tabs.length) tabs.push({ key: 'base', label: 'Zielboard', level: comp.units.length, options: [{ units: comp.units, traits: comp.traits }] });
  return tabs;
}

// Code für den Team-Planer im Spiel: "02" + je Einheit 3 Hex-Stellen (10 Plätze) + Set-Kennung
function teamCode(units) {
  const codes = [...new Set(units.map((u) => unit(u).code).filter(Boolean))];
  if (!codes.length) return null;
  const slots = codes.slice(0, 10).map((c) => c.toString(16).padStart(3, '0'));
  while (slots.length < 10) slots.push('000');
  return `02${slots.join('')}${data.set}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch { /* nicht unterstützt */ }
    ta.remove();
    return ok;
  }
}

// Item mit Rezept als kompakte Kachel: großes Icon, daneben die beiden Komponenten
function recipeChip(id, key) {
  const it = item(id);
  const have = !!game.items[key];
  const parts = it.recipe.length
    ? it.recipe.map((c) => img(item(c).icon, item(c).name)).join('')
    : '<em>–</em>';
  return `<button class="rc${have ? ' have' : ''}" data-item="${esc(id)}" data-key="${esc(key)}" aria-pressed="${have}" title="${esc(it.name)}${have ? ' – habe ich' : ''}">
    ${img(it.icon, it.name, 'rc-item')}<span class="rc-parts">${parts}</span></button>`;
}

function renderBuilds(comp) {
  const cs = carries(comp);
  const prio = componentPriority(comp, db);
  const emblem = emblemNeed(comp, db);
  const rows = cs.map((u, idx) => {
    const un = unit(u);
    return `<div class="build">
      ${unitChip(u)}
      <span class="build-name"><b>${esc(un.name)}</b><small>${idx === 0 ? 'Haupt-Carry' : comp.unitStats[u]?.items3 > 0.5 ? 'Item-Träger' : 'Zweite Wahl'}</small></span>
      <span class="build-items">${comp.builds[u][0].items.map((i, n) => recipeChip(i, `${u}:${n}`)).join('')}</span>
    </div>`;
  }).join('');
  const alts = cs.filter((u) => comp.builds[u].length > 1).map((u) => `<div class="alt">
      ${unitChip(u)}${comp.builds[u].slice(1).map((b) => `<span class="alt-build">${b.items.map((i) => img(item(i).icon, item(i).name)).join('')}<small>Ø ${num(b.avg)}</small></span>`).join('')}
    </div>`).join('');
  const info = ui.itemInfo && item(ui.itemInfo);

  // Was noch fehlt: Komponenten aller nicht abgehakten Items
  const need = new Map();
  let total = 0;
  let open = 0;
  for (const u of cs) {
    comp.builds[u][0].items.forEach((id, n) => {
      total++;
      if (game.items[`${u}:${n}`]) return;
      open++;
      const parts = item(id).recipe.length ? item(id).recipe : [id];
      for (const c of parts) need.set(c, (need.get(c) || 0) + 1);
    });
  }
  const rank = new Map(prio.map((p, i) => [p.id, i]));
  const missing = [...need.entries()].sort((a, b) => b[1] - a[1] || (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99));

  return `<div class="builds-head"><h3>Items <small>antippen = habe ich</small></h3><span class="badge">${total - open} / ${total} fertig</span></div>
    <div class="missing"><span class="lbl">Fehlt noch</span>${missing.length
      ? missing.map(([id, n], i) => `<span class="cp${i < 3 ? ' top' : ''}" title="${esc(item(id).name)}">${img(item(id).icon, item(id).name)}<b>${n}×</b></span>`).join('')
      : '<span class="all-done">Alle Items gebaut ✓</span>'}</div>
    ${emblem ? `<p class="callout">Braucht <b>${esc(item(emblem.item).name)}</b> auf ${esc(unit(emblem.unit).name)}${emblem.recipe.length ? '' : ' – nur über Augments oder Beute'}.</p>` : ''}
    <div class="builds">${rows || '<p class="empty">Keine Build-Daten.</p>'}</div>
    ${info ? `<p class="item-info"><b>${esc(info.name)}</b>${info.recipe.length ? ` = ${info.recipe.map((c) => esc(item(c).name)).join(' + ')}` : ' – nicht baubar'}</p>` : ''}
    ${alts ? `<details class="alts"><summary>Alternative Builds</summary>${alts}</details>` : ''}`;
}

function renderBoard(comp) {
  const tabs = boardOptions(comp);
  let tab = tabs.find((t) => t.key === ui.boardTab);
  if (!tab) {
    // Standard: aktuelles Board solange es früh ist, sonst das häufigste Endboard
    tab = (!overview() && tabs.find((t) => t.key === 'now' && game.level < rollLevel(comp))) || tabs.find((t) => t.key === `f${rollLevel(comp)}`) ||
      (game.level >= rollLevel(comp) && tabs.find((t) => t.key === 'now')) || tabs[tabs.length - 1];
  }
  const opt = tab.options[Math.min(ui.variant, tab.options.length - 1)] || tab.options[0];
  const cells = layoutBoard(comp, opt.units);
  const stars = new Set(threeStarTargets(comp));
  const traits = activeTraits(opt.units.filter(isReal), opt.traits);
  const code = teamCode([...opt.units].filter(isReal).sort(byCost));

  const rows = [0, 1, 2, 3].map((row) => `<div class="hex-row${row % 2 ? ' offset' : ''}">${
    cells.slice(row * 7, row * 7 + 7).map((u) => {
      if (!u) return '<div class="hex empty"></div>';
      const un = unit(u);
      const items = comp.builds[u]?.[0].items || [];
      return `<button class="hex-wrap${game.owned[u] ? ' own' : ''}" data-own="${esc(u)}" title="${esc(un.name)}">
        <span class="hex cost-${un.cost}">${img(un.icon, un.name)}</span>
        ${stars.has(u) ? '<span class="stars">★★★</span>' : ''}
        ${items.length ? `<span class="hex-items">${items.map((i) => img(item(i).icon, item(i).name)).join('')}</span>` : ''}
        <span class="hex-name">${esc(un.name)}</span>
      </button>`;
    }).join('')}</div>`).join('');

  return `<section class="card board-card">
    <div class="card-head">
      <h2>Aufstellung</h2>
      <div class="seg scroll">${tabs.map((t) => `<button data-tab="${t.key}" class="${t === tab ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</div>
    </div>
    <div class="board">${rows}</div>
    <div class="board-foot">
      <span class="hint">${tab.early ? 'Frühes Board' : 'Zielboard'} · antippen = habe ich</span>
      <span class="foot-actions">
      ${tab.options.length > 1 ? `<span class="variants">${tab.options.map((o, i) =>
        `<button data-variant="${i}" class="${o === opt ? 'on' : ''}" title="Ø Platz ${num(o.avg)}">V${i + 1}</button>`).join('')}</span>` : ''}
      ${code ? `<button class="copy-code" data-code="${esc(code)}" title="Im Spiel: Team-Planer öffnen und Code einfügen">Teamcode kopieren</button>` : ''}
      </span>
    </div>
    <div class="traits">${traits.map((t) => `<span class="trait style-${t.style}" title="${esc(t.name)}">${img(t.icon, t.name)}<b>${t.count}</b> ${esc(t.name)}</span>`).join('')}</div>
    ${renderBuilds(comp)}
  </section>`;
}

// ---------- Level-Zeitplan ----------
function renderLevels(comp) {
  const sched = schedule(comp);
  const std = standardSchedule();
  const ov = overview();
  const ri = ov ? -1 : roundIndex(game.stage, game.round);
  const lastIdx = Math.max(roundIndex(6, 7), ...sched.map((e) => e.i));
  const lastStage = ROUNDS[lastIdx].s;
  const rollLvl = rollLevel(comp);

  const stages = [];
  for (let s = 2; s <= lastStage; s++) {
    stages.push(`<div class="tl-stage"><span class="tl-label">Stage ${s}</span><div class="tl-cells">${
      ROUNDS.filter((r) => r.s === s).map((r) => {
        const e = sched.find((x) => x.i === r.i);
        const sd = std.find((x) => x.i === r.i);
        const type = roundType(r);
        return `<button class="tl-cell ${type}${r.i === ri ? ' now' : ''}${r.i < ri ? ' past' : ''}" data-goto="${r.i}" title="${r.key} · ${TYPE_LABEL[type]}">
          ${e ? `<b class="lvl${e.level === rollLvl ? ' roll' : ''}">${e.level}</b>` : '<b class="lvl none"></b>'}
          <span class="rk">${r.n}</span>
          ${sd ? `<i class="std">${sd.level}</i>` : '<i class="std none"></i>'}
        </button>`;
      }).join('')}</div></div>`);
  }

  const chips = sched.map((e) => {
    const done = !ov && game.level >= e.level;
    const late = !ov && !done && e.i <= ri;
    return `<li class="${done ? 'done' : late ? 'late' : ''}" title="${done ? 'erreicht' : late ? 'überfällig' : `bis ${e.s}-${e.n}`}">
      <b>Lvl ${e.level}</b> ${e.s}-${e.n}${done ? ' ✓' : late ? ' !' : ''}</li>`;
  }).join('');

  const fin = comp.finalLevels.filter((f) => f.pct >= 0.05);
  return `<section class="card levels">
    <div class="card-head"><h2>Level-Zeitplan</h2><span class="badge">${esc(styleLabel(comp))}</span></div>
    <ul class="lvl-list">${chips}</ul>
    <div class="timeline">${stages.join('')}</div>
    <p class="legend"><span><b class="lvl">7</b> Level-Up</span><span><b class="lvl roll">8</b> Roll-Level</span><span><i class="std">7</i> Standard-Tempo</span></p>
    ${fin.length ? `<p class="hint">Endlevel: ${fin.map((f) => `Lvl ${f.level} ${Math.round(f.pct * 100)} % (Ø ${num(f.avg, 1)})`).join(' · ')}</p>` : ''}
  </section>`;
}

// ---------- Rundensteuerung + Tipps ----------
function stepper(key, label, min, max, step) {
  return `<div class="stepper">
    <button data-step="${key}" data-d="${-step}" aria-label="${label} verringern">−</button>
    <label><small>${label}</small>
    <input data-field="${key}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${game[key]}"></label>
    <button data-step="${key}" data-d="${step}" aria-label="${label} erhöhen">+</button>
  </div>`;
}

const STREAKS = { none: 'Keine', win: 'Siege', loss: 'Niederl.' };

function renderControl(comp) {
  const ri = roundIndex(game.stage, game.round);
  const r = ROUNDS[ri];
  const type = roundType(r);
  const target = targetLevel(schedule(comp), ri);
  const diff = game.level - target;
  const state = diff < 0 ? 'behind' : diff > 0 ? 'ahead' : 'ok';
  const stateText = diff < 0 ? `${-diff} Level zurück` : diff > 0 ? `${diff} Level voraus` : 'im Plan';
  return `<section class="card control">
    <div class="round-nav">
      <button data-round="-1" ${ri <= 0 ? 'disabled' : ''} aria-label="Vorherige Runde">‹</button>
      <div class="round-now">
        <span class="round-key">${r.key}</span>
        <span class="round-type ${type}">${TYPE_LABEL[type]}${isAugmentRound(r) ? ' · Augment' : ''}</span>
      </div>
      <button class="soll ${state}" data-setlevel="${target}" title="Level auf ${target} setzen"><small>Soll Lvl ${target}</small><b>${stateText}</b></button>
      <button class="next" data-round="1" ${ri >= ROUNDS.length - 1 ? 'disabled' : ''}>Weiter ›</button>
    </div>
    <div class="inputs">
      ${stepper('level', 'Level', 1, 10, 1)}
      ${stepper('gold', 'Gold', 0, 999, 10)}
      ${stepper('hp', 'Leben', 1, 100, 10)}
      <button class="streak ${game.streak}" data-streak title="Serie umschalten"><small>Serie</small><b>${STREAKS[game.streak]}</b></button>
    </div>
    <div class="endgame">${ui.ending
      ? `<span>Platzierung</span>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button data-place="${n}">${n}</button>`).join('')}<button class="ghost" data-end="0">Abbrechen</button>`
      : `<span class="hint">${ui.flash ? esc(ui.flash) : `${Object.keys(game.log || {}).length} Runden mitgeschrieben`}</span>
         ${ui.flash ? '<a href="#/spiele/log">Mitschriften ansehen</a>' : '<button class="ghost" data-end="1">Spiel beenden &amp; speichern</button>'}`}
    </div>
  </section>`;
}

function renderTips(comp) {
  const tips = buildTips(comp, db, game);
  return `<section class="card tips">
    <div class="card-head"><h2>Jetzt tun</h2></div>
    <ol>${tips.map((t) => `<li class="tip ${t.prio}"><details${t.prio === 'high' ? ' open' : ''}>
      <summary><span class="tag">${esc(t.tag)}</span><strong>${esc(t.title)}</strong></summary>
      <p>${esc(t.text)}</p></details></li>`).join('') || '<li class="empty">Keine besonderen Hinweise – stärkstes Board spielen.</li>'}</ol>
  </section>`;
}

function renderUpcoming(comp) {
  const next = upcoming(comp, db, game);
  return `<section class="card upcoming">
    <div class="card-head"><h2>Nächste Runden</h2></div>
    <ul>${next.map((r) => `<li class="${r.type}">
      <b>${r.key}</b><span class="round-type ${r.type}">${TYPE_LABEL[r.type]}</span>
      <span class="notes">${r.notes.map(esc).join(' · ')}</span></li>`).join('')}</ul>
  </section>`;
}

function renderPlan(comp) {
  const plan = gamePlan(comp, db);
  return `<section class="card plan">
    <div class="card-head"><h2>Spielplan</h2></div>
    <dl class="plan-sum">${plan.summary.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="plan-stages">${plan.stages.map((st) => `<div class="plan-stage"><h3>${esc(st.title)}</h3>
      <ul>${st.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`).join('')}</div>
  </section>`;
}

// Comps mit vielen gemeinsamen Einheiten und Items – zum Wechseln, wenn es nicht läuft
function similarComps(comp) {
  const norm = (id) => unit(id).alias || id;
  const mine = new Set(comp.units.map(norm));
  const itemsOf = (c) => carries(c).slice(0, 3).flatMap((u) => c.builds[u][0].items);
  const myItems = itemsOf(comp);
  return data.comps
    .filter((c) => c.id !== comp.id)
    .map((c) => {
      const shared = [...new Set(c.units.map(norm))].filter((u) => mine.has(u));
      const pool = [...myItems];
      let items = 0;
      for (const i of itemsOf(c)) {
        const at = pool.indexOf(i);
        if (at >= 0) {
          pool.splice(at, 1);
          items++;
        }
      }
      return { comp: c, shared, items, score: shared.length + items * 0.5 - Math.max(0, c.avg - 4.3) };
    })
    .filter((r) => r.shared.length >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function renderAlternatives(comp) {
  const sim = similarComps(comp);
  const fs = game.fromFs && freestyleActive() ? freestyleRank(data, db, 6) : [];
  const own = fs.find((r) => r.comp.id === comp.id);
  const others = fs.filter((r) => r.comp.id !== comp.id).slice(0, 4);
  if (!sim.length && !others.length) return '';
  const row = (c, info, pctText, flag, icons) => `<li>
      <a href="#/comp/${c.id}?${flag}"><span class="tier tier-${tier(c)}">${tier(c)}</span><b>${esc(compName(c))}</b>${pctText ? `<em>${pctText}</em>` : ''}</a>
      <div class="alt-info"><span class="alt-units">${icons.slice(0, 7).map((u) => unitChip(u)).join('')}</span><small>${info}</small></div>
    </li>`;
  return `<section class="card alts-card">
    ${others.length ? `<div class="card-head"><h2>Passt zu deiner Freestyle-Auswahl</h2><a class="hint" href="#/freestyle">Auswahl ändern</a></div>
      ${own ? `<p class="hint">Diese Comp: ${Math.round(own.total * 100)} % Übereinstimmung.</p>` : ''}
      <ul class="alt-list">${others.map((r) => row(r.comp,
        `${r.hits.length} von ${freestyleCount()} Einheiten · ${r.built.length} Items baubar · ${esc(styleLabel(r.comp))} · Ø ${num(r.comp.avg)}`,
        `${Math.round(r.total * 100)} %`, 'fs', r.hits.map((h) => h.id))).join('')}</ul>` : ''}
    ${sim.length ? `<div class="card-head"><h2>Ausweich-Comps</h2><span class="hint">Spielstand bleibt erhalten</span></div>
      <ul class="alt-list">${sim.map((r) => row(r.comp,
        `${r.shared.length} gemeinsame Einheiten · ${r.items} gleiche Items · ${esc(styleLabel(r.comp))} · Ø ${num(r.comp.avg)}`,
        '', 'sw', r.shared)).join('')}</ul>` : ''}
  </section>`;
}

function renderGuide(comp) {
  const t = tier(comp);
  const ov = overview();
  app.innerHTML = `
    <section class="guide-head">
      <a class="back" href="#/" aria-label="Zur Teamwahl">‹ Teams</a>
      <span class="tier tier-${t}">${t}</span>
      <h1>${esc(compName(comp))}</h1>
      ${favButton(comp)}
      <span class="head-stats">Ø ${num(comp.avg)} · Top 4 ${pct(comp.top4)} · Sieg ${pct(comp.win)}</span>
      <div class="seg mode" role="group" aria-label="Ansicht">
        <button data-mode="overview" class="${ov ? 'on' : ''}">Übersicht</button>
        <button data-mode="track" class="${ov ? '' : 'on'}">Runde für Runde</button>
      </div>
      <button class="ghost" data-reset>${ov ? 'Zurücksetzen' : 'Neues Spiel'}</button>
    </section>
    <div class="guide-grid${ov ? ' overview' : ''}">
      <div class="col">${ov ? renderPlan(comp) : renderControl(comp) + renderTips(comp) + renderUpcoming(comp)}${renderLevels(comp)}${renderAlternatives(comp)}</div>
      <div class="col">${renderBoard(comp)}</div>
    </div>`;
  const tl = app.querySelector('.timeline');
  const now = tl?.querySelector('.tl-cell.now');
  if (now) tl.scrollLeft = now.offsetLeft - tl.offsetLeft - tl.clientWidth / 2 + now.offsetWidth / 2;
}

function bindGuide(comp) {
  app.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b || !app.contains(b)) return;
    const d = b.dataset;
    if (d.code) {
      copyText(d.code).then((ok) => {
        b.textContent = ok ? 'Kopiert ✓' : d.code;
        b.classList.toggle('done', ok);
        setTimeout(() => {
          if (!b.isConnected) return;
          b.textContent = 'Teamcode kopieren';
          b.classList.remove('done');
        }, ok ? 1800 : 8000);
      });
      return;
    }
    if (d.fav) toggleFav(comp);
    else if (d.end) {
      ui.ending = d.end === '1';
      ui.flash = '';
    } else if (d.place) {
      saveMatchLog(comp, Number(d.place));
      game = { ...defaultGame(), compId: comp.id };
      ui.ending = false;
      ui.flash = `Spiel gespeichert (Platz ${d.place}).`;
      ui.boardTab = '';
      saveGame();
      renderGuide(comp);
      return;
    } else if (d.round) {
      ui.flash = '';
      const i = Math.min(ROUNDS.length - 1, Math.max(0, roundIndex(game.stage, game.round) + Number(d.round)));
      game.stage = ROUNDS[i].s;
      game.round = ROUNDS[i].n;
      ui.boardTab = '';
    } else if (d.mode) {
      mode = d.mode;
      ui.boardTab = '';
      ui.variant = 0;
      try {
        localStorage.setItem(MODE, mode);
      } catch { /* privater Modus */ }
    } else if (d.goto) {
      if (overview()) return;
      const r = ROUNDS[Number(d.goto)];
      game.stage = r.s;
      game.round = r.n;
    } else if (d.step) {
      const input = app.querySelector(`[data-field="${d.step}"]`);
      setField(d.step, Number(game[d.step]) + Number(d.d), input);
    } else if ('streak' in d) game.streak = { none: 'win', win: 'loss', loss: 'none' }[game.streak] || 'none';
    else if (d.setlevel) {
      game.level = Number(d.setlevel);
      ui.boardTab = '';
    } else if (d.tab) {
      ui.boardTab = d.tab;
      ui.variant = 0;
    } else if (d.variant) ui.variant = Number(d.variant);
    else if (d.item) {
      game.items[d.key] ? delete game.items[d.key] : (game.items[d.key] = true);
      ui.itemInfo = d.item;
    }
    else if (d.own) game.owned[d.own] ? delete game.owned[d.own] : (game.owned[d.own] = true);
    else if ('reset' in d) {
      game = { ...defaultGame(), compId: comp.id };
      ui.boardTab = '';
      ui.variant = 0;
    } else return;
    update(comp);
  };
  app.onchange = (ev) => {
    const f = ev.target.dataset?.field;
    if (!f) return;
    setField(f, Number(ev.target.value), ev.target);
    update(comp);
  };
}

function setField(key, value, input) {
  const min = Number(input?.min ?? 0);
  const max = Number(input?.max ?? 999);
  if (!Number.isFinite(value)) value = game[key];
  const before = game[key];
  game[key] = Math.min(max, Math.max(min, Math.round(value)));
  if (key === 'level' && before !== game[key]) ui.boardTab = '';
}

// Stand der aktuellen Runde festhalten (wird überschrieben, bis man weiterklickt)
function logRound() {
  if (overview()) return;
  const i = roundIndex(game.stage, game.round);
  game.log ||= {};
  game.log[i] = { l: game.level, g: game.gold, h: game.hp, s: game.streak };
}

function saveMatchLog(comp, placement) {
  logRound();
  const done = Object.keys(game.items || {}).length;
  addHistory({
    id: Date.now(),
    time: Date.now(),
    compId: comp.id,
    compName: compName(comp),
    style: styleLabel(comp),
    rollLvl: rollLevel(comp),
    avg: comp.avg,
    sched: schedule(comp).map((e) => ({ level: e.level, i: e.i })),
    placement,
    itemsDone: done,
    itemsTotal: carries(comp).reduce((a, u) => a + comp.builds[u][0].items.length, 0),
    log: Object.entries(game.log || {}).map(([i, r]) => ({ i: Number(i), ...r })).sort((a, b) => a.i - b.i),
  });
}

// Beim Wechsel der Comp mitten im Spiel: Runde, Level, Gold, Leben und Einheiten behalten,
// abgehakte Items anhand des Item-Namens auf die neue Comp übertragen.
function switchComp(comp, useFreestyle) {
  const old = data.comps.find((c) => c.id === game.compId);
  const keep = old ? game : defaultGame();
  const have = [];
  if (old) for (const k of Object.keys(game.items || {})) {
    const cut = k.lastIndexOf(':');
    const id = old.builds[k.slice(0, cut)]?.[0].items[Number(k.slice(cut + 1))];
    if (id) have.push(id);
  }
  const items = {};
  for (const u of carries(comp)) comp.builds[u][0].items.forEach((id, n) => {
    const at = have.indexOf(id);
    if (at >= 0) {
      have.splice(at, 1);
      items[`${u}:${n}`] = true;
    }
  });
  game = { ...defaultGame(), ...keep, compId: comp.id, items, owned: { ...(keep.owned || {}) } };
  if (useFreestyle && freestyleActive()) {
    const h = freestyleHandover(comp, db);
    game.owned = { ...game.owned, ...h.owned };
    game.items = { ...game.items, ...h.items };
    game.fromFs = true;
  }
}

function update(comp) {
  logRound();
  saveGame();
  const y = window.scrollY;
  renderGuide(comp);
  window.scrollTo(0, y);
}

// ---------- Routing ----------
function route() {
  if (location.hash.startsWith('#/freestyle')) {
    renderFreestyle(app, { data, db, esc, img, compName, tier });
    window.scrollTo(0, 0);
    return;
  }
  const g = location.hash.match(/^#\/spiele(?:\/(\d+|alle|log))?/);
  if (g) {
    app.onclick = null;
    app.onchange = null;
    loadMatches().then((matches) => {
      if (!location.hash.startsWith('#/spiele')) return;
      renderGames(app, { data, db, esc, img, compName, matches }, g[1]);
      window.scrollTo(0, 0);
    });
    return;
  }
  const m = location.hash.match(/^#\/comp\/(\w+)(?:\?(fs|sw))?/);
  const comp = m && data.comps.find((c) => c.id === m[1]);
  app.onclick = null;
  app.onchange = null;
  if (comp) {
    if (m[2] === 'sw' || (m[2] === 'fs' && game.fromFs)) {
      // Wechsel aus dem Guide heraus: Spielstand behalten
      switchComp(comp, m[2] === 'fs');
      saveGame();
    } else if (m[2] === 'fs') {
      // Einstieg aus Freestyle: neues Spiel mit übernommener Auswahl
      game = { ...defaultGame(), compId: comp.id, fromFs: true, ...(() => {
        const h = freestyleHandover(comp, db);
        return { owned: h.owned, items: h.items };
      })() };
      saveGame();
    } else if (game.compId !== comp.id) {
      game = { ...defaultGame(), compId: comp.id };
      saveGame();
    }
    // Kennzeichen aus der Adresse nehmen, damit ein Neuladen nichts erneut überschreibt
    if (m[2]) history.replaceState(null, '', `#/comp/${comp.id}`);
    ui.ending = false;
    ui.flash = '';
    ui.boardTab = '';
    ui.variant = 0;
    ui.itemInfo = null;
    renderGuide(comp);
    bindGuide(comp);
    window.scrollTo(0, 0);
  } else {
    renderPicker();
  }
}

async function init() {
  try {
    const [c, s] = await Promise.all([
      fetch('data/comps.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
      fetch('data/static.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
    ]);
    data = c;
    db = s;
    const date = new Date(c.updated).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    document.getElementById('meta').textContent = `${c.setName || c.set} · Daten vom ${date}`;
    window.addEventListener('hashchange', route);
    route();
  } catch (err) {
    app.innerHTML = `<p class="loading">Die Daten konnten nicht geladen werden (${esc(err.message)}). Führe <code>npm run fetch</code> aus und starte die Seite über einen lokalen Server.</p>`;
  }
}

init();

// Handy-App: frische Dateien bei jedem Start, zuletzt geladener Stand ohne Netz
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
