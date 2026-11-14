import {
  ROUNDS, TYPE_LABEL, roundIndex, roundType, isAugmentRound, schedule, standardSchedule, targetLevel,
  rollLevel, isReroll, styleLabel, carries, threeStarTargets, componentPriority, emblemNeed,
  buildTips, upcoming,
} from './tips.js';

const app = document.getElementById('app');
const STORE = 'tft-guide-state-v1';
let data = null; // { comps, set, updated }
let db = null; // statische Daten
let ui = { search: '', style: 'all', boardTab: 'now', variant: 0 };
let game = loadGame();

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
  return { stage: 2, round: 1, level: 4, gold: 10, hp: 100, streak: 'none', owned: {} };
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
      <p class="sub">${data.comps.length} Meta-Comps aus ${esc(data.setName || data.set)}, sortiert nach durchschnittlicher Platzierung.</p>
      <div class="filters">
        <input id="search" type="search" placeholder="Einheit oder Synergie suchen …" value="${esc(ui.search)}" autocomplete="off">
        <div class="seg" role="group" aria-label="Spielstil">
          ${styles.map(([k, l]) => `<button data-style="${k}" class="${ui.style === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </div>
    </section>
    <section class="comp-grid">
      ${list.map(compCard).join('') || '<p class="empty">Keine Comp passt zur Suche.</p>'}
    </section>`;

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
  return `<a class="comp-card" href="#/comp/${c.id}">
    <div class="comp-card-top">
      <span class="tier tier-${t}">${t}</span>
      <div class="comp-title">
        <strong>${esc(compName(c))}</strong>
        <span class="badge">${esc(styleLabel(c))}</span>
      </div>
    </div>
    <div class="unit-row">${[...c.units].sort(byCost).map((u) => unitChip(u, { items: main.has(u) ? c.builds[u][0].items : [] })).join('')}</div>
    <dl class="stats">
      <div><dt>Ø Platz</dt><dd>${num(c.avg)}</dd></div>
      <div><dt>Top 4</dt><dd>${pct(c.top4)}</dd></div>
      <div><dt>Sieg</dt><dd>${pct(c.win)}</dd></div>
    </dl>
  </a>`;
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
  const lvl = game.level;
  const early = comp.boards[lvl];
  const late = comp.finals[lvl];
  if (early && lvl <= 7) tabs.push({ key: 'now', label: `Jetzt · Level ${lvl}`, level: lvl, options: early, early: true });
  else if (late) tabs.push({ key: 'now', label: `Jetzt · Level ${lvl}`, level: lvl, options: late });
  for (const l of Object.keys(comp.finals).map(Number).sort()) {
    if (l === lvl && !(early && lvl <= 7)) continue;
    tabs.push({ key: `f${l}`, label: `Ziel · Level ${l}`, level: l, options: comp.finals[l] });
  }
  if (!tabs.length) tabs.push({ key: 'base', label: 'Zielboard', level: comp.units.length, options: [{ units: comp.units, traits: comp.traits }] });
  return tabs;
}

function renderBoard(comp) {
  const tabs = boardOptions(comp);
  let tab = tabs.find((t) => t.key === ui.boardTab);
  if (!tab) {
    // Standard: aktuelles Board solange es früh ist, sonst das häufigste Endboard
    tab = tabs.find((t) => t.key === 'now' && game.level < rollLevel(comp)) || tabs.find((t) => t.key === `f${rollLevel(comp)}`) ||
      (game.level >= rollLevel(comp) && tabs.find((t) => t.key === 'now')) || tabs[tabs.length - 1];
  }
  const opt = tab.options[Math.min(ui.variant, tab.options.length - 1)] || tab.options[0];
  const cells = layoutBoard(comp, opt.units);
  const stars = new Set(threeStarTargets(comp));
  const traits = activeTraits(opt.units.filter(isReal), opt.traits);
  const realUnits = [...new Set(opt.units)].filter(isReal).sort(byCost);

  const rows = [0, 1, 2, 3].map((row) => `<div class="hex-row${row % 2 ? ' offset' : ''}">${
    cells.slice(row * 7, row * 7 + 7).map((u) => {
      if (!u) return '<div class="hex empty"></div>';
      const un = unit(u);
      const items = comp.builds[u]?.[0].items || [];
      return `<div class="hex-wrap">
        <div class="hex cost-${un.cost}" title="${esc(un.name)}">${img(un.icon, un.name)}</div>
        ${stars.has(u) ? '<span class="stars">★★★</span>' : ''}
        ${items.length ? `<span class="hex-items">${items.map((i) => img(item(i).icon, item(i).name)).join('')}</span>` : ''}
        <span class="hex-name">${esc(un.name)}</span>
      </div>`;
    }).join('')}</div>`).join('');

  return `<section class="card board-card">
    <div class="card-head">
      <h2>Aufstellung</h2>
      <div class="seg scroll">${tabs.map((t) => `<button data-tab="${t.key}" class="${t === tab ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</div>
    </div>
    ${tab.options.length > 1 ? `<div class="variants">${tab.options.map((o, i) =>
      `<button data-variant="${i}" class="${o === opt ? 'on' : ''}">Variante ${i + 1}<small>Ø ${num(o.avg)}</small></button>`).join('')}</div>` : ''}
    <div class="board-side">Gegner</div>
    <div class="board">${rows}</div>
    <div class="board-side">Deine Seite</div>
    <div class="traits">${traits.map((t) => `<span class="trait style-${t.style}" title="${esc(t.name)}">${img(t.icon, t.name)}<b>${t.count}</b> ${esc(t.name)}</span>`).join('')}</div>
    <h3>Einheiten <small>antippen = habe ich</small></h3>
    <div class="own-list">${realUnits.map((u) => {
      const un = unit(u);
      return `<button class="own cost-${un.cost}${game.owned[u] ? ' on' : ''}" data-own="${esc(u)}">
        ${img(un.icon, un.name)}<span>${esc(un.name)}</span><em>${un.cost}</em></button>`;
    }).join('')}</div>
    ${tab.early ? '<p class="hint">Häufigstes frühes Board erfolgreicher Spieler dieser Comp – spiele ähnlich starke Einheiten, wenn du diese nicht findest.</p>' : ''}
  </section>`;
}

// ---------- Items ----------
function recipeHtml(id) {
  const it = item(id);
  const parts = it.recipe.length
    ? it.recipe.map((c) => `<span class="comp-ic" title="${esc(item(c).name)}">${img(item(c).icon, item(c).name)}</span>`).join('<i>+</i>')
    : '<span class="no-recipe">nicht baubar</span>';
  return `<div class="recipe">
    <span class="item-ic">${img(it.icon, it.name)}</span>
    <span class="item-name">${esc(it.name)}</span>
    <span class="parts">${parts}</span>
  </div>`;
}

function renderItems(comp) {
  const cs = carries(comp);
  const prio = componentPriority(comp, db);
  const emblem = emblemNeed(comp, db);
  const builds = cs.map((u, idx) => {
    const un = unit(u);
    const [main, ...alts] = comp.builds[u];
    return `<article class="build">
      <header>
        ${unitChip(u)}
        <div><strong>${esc(un.name)}</strong><span>${idx === 0 ? 'Haupt-Carry' : comp.unitStats[u]?.items3 > 0.5 ? 'Item-Träger' : 'Zweite Wahl'}</span></div>
      </header>
      <div class="recipes">${main.items.map(recipeHtml).join('')}</div>
      ${alts.length ? `<details><summary>Alternativen</summary>${alts.map((b) =>
        `<div class="alt">${b.items.map((i) => `<span title="${esc(item(i).name)}">${img(item(i).icon, item(i).name)}</span>`).join('')}<small>Ø ${num(b.avg)}</small></div>`).join('')}</details>` : ''}
    </article>`;
  }).join('');

  return `<section class="card">
    <div class="card-head"><h2>Items</h2></div>
    ${emblem ? `<p class="callout">Diese Comp lebt vom <b>${esc(item(emblem.item).name)}</b> auf ${esc(unit(emblem.unit).name)}${emblem.recipe.length ? ` (${emblem.recipe.map((c) => esc(item(c).name)).join(' + ')})` : ' – nur über Augments oder Beute'}.</p>` : ''}
    <div class="builds">${builds || '<p class="empty">Keine Build-Daten.</p>'}</div>
    <h3>Komponenten-Priorität <small>für die Haupt-Builds</small></h3>
    <div class="comp-prio">${prio.map((p, i) => `<span class="${i < 3 ? 'top' : ''}">${img(item(p.id).icon, item(p.id).name)}<b>${p.need}×</b> ${esc(item(p.id).name)}</span>`).join('')}</div>
    <h3>Beliebteste Items <small>Anteil der Spiele</small></h3>
    <div class="top-items">${comp.topItems.slice(0, 10).map((t) => `<span title="${esc(item(t.item).name)}${t.unit ? ` · meist auf ${esc(unit(t.unit).name)}` : ''}">
      ${img(item(t.item).icon, item(t.item).name)}<small>${Math.round(t.pct * 100)} %</small></span>`).join('')}</div>
  </section>`;
}

// ---------- Level-Zeitplan ----------
function renderLevels(comp) {
  const sched = schedule(comp);
  const std = standardSchedule();
  const ri = roundIndex(game.stage, game.round);
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

  const rows = sched.map((e) => {
    const done = game.level >= e.level;
    const late = !done && e.i <= ri;
    return `<li class="${done ? 'done' : late ? 'late' : ''}">
      <b>Level ${e.level}</b><span>bis ${e.s}-${e.n}</span>
      <em>${done ? 'erreicht' : late ? 'überfällig' : `in ${e.i - ri} Runde${e.i - ri === 1 ? '' : 'n'}`}</em>
    </li>`;
  }).join('');

  const fin = comp.finalLevels.filter((f) => f.pct >= 0.05);
  return `<section class="card">
    <div class="card-head"><h2>Level-Zeitplan</h2><span class="badge">${esc(styleLabel(comp))}</span></div>
    <div class="timeline">${stages.join('')}</div>
    <p class="legend"><span><b class="lvl">7</b> Level-Up dieser Comp</span><span><b class="lvl roll">8</b> Roll-Level</span><span><i class="std">7</i> Standard-Tempo</span></p>
    <ul class="lvl-list">${rows}</ul>
    ${fin.length ? `<p class="hint">Endlevel in gespielten Partien: ${fin.map((f) => `Level ${f.level} ${Math.round(f.pct * 100)} % (Ø Platz ${num(f.avg, 1)})`).join(' · ')}</p>` : ''}
  </section>`;
}

// ---------- Rundensteuerung + Tipps ----------
function stepper(key, label, min, max, step) {
  return `<div class="stepper">
    <label for="in-${key}">${label}</label>
    <div><button data-step="${key}" data-d="${-step}" aria-label="${label} verringern">−</button>
    <input id="in-${key}" data-field="${key}" type="number" inputmode="numeric" min="${min}" max="${max}" value="${game[key]}">
    <button data-step="${key}" data-d="${step}" aria-label="${label} erhöhen">+</button></div>
  </div>`;
}

function renderControl(comp) {
  const ri = roundIndex(game.stage, game.round);
  const r = ROUNDS[ri];
  const type = roundType(r);
  const target = targetLevel(schedule(comp), ri);
  const diff = game.level - target;
  return `<section class="card control">
    <div class="round-nav">
      <button data-round="-1" ${ri <= 0 ? 'disabled' : ''} aria-label="Vorherige Runde">‹</button>
      <div class="round-now">
        <span class="round-key">${r.key}</span>
        <span class="round-type ${type}">${TYPE_LABEL[type]}${isAugmentRound(r) ? ' · Augment' : ''}</span>
      </div>
      <button class="next" data-round="1" ${ri >= ROUNDS.length - 1 ? 'disabled' : ''}>Nächste Runde ›</button>
    </div>
    <div class="inputs">
      ${stepper('level', 'Level', 1, 10, 1)}
      ${stepper('gold', 'Gold', 0, 999, 10)}
      ${stepper('hp', 'Leben', 1, 100, 10)}
      <div class="stepper streak">
        <label>Serie</label>
        <div class="seg">${[['win', 'Siege'], ['none', 'Keine'], ['loss', 'Niederl.']].map(([k, l]) =>
          `<button data-streak="${k}" class="${game.streak === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
    </div>
    <div class="status ${diff < 0 ? 'behind' : diff > 0 ? 'ahead' : 'ok'}">
      Soll-Level in ${r.key}: <b>${target}</b> ·
      ${diff < 0 ? `du liegst ${-diff} Level zurück` : diff > 0 ? `du bist ${diff} Level voraus` : 'du bist im Plan'}
      ${diff !== 0 ? `<button data-setlevel="${target}">auf ${target} setzen</button>` : ''}
    </div>
  </section>`;
}

function renderTips(comp) {
  const tips = buildTips(comp, db, game);
  const next = upcoming(comp, db, game);
  return `<section class="card tips">
    <div class="card-head"><h2>Jetzt tun</h2></div>
    <ol>${tips.map((t) => `<li class="tip ${t.prio}">
      <span class="tag">${esc(t.tag)}</span>
      <div><strong>${esc(t.title)}</strong><p>${esc(t.text)}</p></div></li>`).join('') || '<li class="empty">Keine besonderen Hinweise – stärkstes Board spielen.</li>'}</ol>
  </section>
  <section class="card upcoming">
    <div class="card-head"><h2>Nächste Runden</h2></div>
    <ul>${next.map((r) => `<li class="${r.type}">
      <b>${r.key}</b><span class="round-type ${r.type}">${TYPE_LABEL[r.type]}</span>
      <span class="notes">${r.notes.map(esc).join(' · ')}</span></li>`).join('')}</ul>
  </section>`;
}

function renderGuide(comp) {
  const t = tier(comp);
  app.innerHTML = `
    <section class="guide-head">
      <a class="back" href="#/">‹ Teams</a>
      <div class="guide-title">
        <span class="tier tier-${t}">${t}</span>
        <h1>${esc(compName(comp))}</h1>
      </div>
      <dl class="stats inline">
        <div><dt>Ø Platz</dt><dd>${num(comp.avg)}</dd></div>
        <div><dt>Top 4</dt><dd>${pct(comp.top4)}</dd></div>
        <div><dt>Sieg</dt><dd>${pct(comp.win)}</dd></div>
        <div><dt>Spiele</dt><dd>${comp.count.toLocaleString('de-DE')}</dd></div>
      </dl>
      <button class="ghost" data-reset>Neues Spiel</button>
    </section>
    <div class="guide-grid">
      <div class="col">${renderControl(comp)}${renderTips(comp)}${renderLevels(comp)}</div>
      <div class="col">${renderBoard(comp)}${renderItems(comp)}</div>
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
    if (d.round) {
      const i = Math.min(ROUNDS.length - 1, Math.max(0, roundIndex(game.stage, game.round) + Number(d.round)));
      game.stage = ROUNDS[i].s;
      game.round = ROUNDS[i].n;
      ui.boardTab = '';
    } else if (d.goto) {
      const r = ROUNDS[Number(d.goto)];
      game.stage = r.s;
      game.round = r.n;
    } else if (d.step) {
      const input = app.querySelector(`[data-field="${d.step}"]`);
      setField(d.step, Number(game[d.step]) + Number(d.d), input);
    } else if (d.streak) game.streak = d.streak;
    else if (d.setlevel) {
      game.level = Number(d.setlevel);
      ui.boardTab = '';
    } else if (d.tab) {
      ui.boardTab = d.tab;
      ui.variant = 0;
    } else if (d.variant) ui.variant = Number(d.variant);
    else if (d.own) game.owned[d.own] ? delete game.owned[d.own] : (game.owned[d.own] = true);
    else if ('reset' in d) {
      game = defaultGame();
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

function update(comp) {
  saveGame();
  const y = window.scrollY;
  renderGuide(comp);
  window.scrollTo(0, y);
}

// ---------- Routing ----------
function route() {
  const m = location.hash.match(/^#\/comp\/(\w+)/);
  const comp = m && data.comps.find((c) => c.id === m[1]);
  app.onclick = null;
  app.onchange = null;
  if (comp) {
    if (game.compId !== comp.id) {
      game = { ...defaultGame(), compId: comp.id };
      saveGame();
    }
    ui.boardTab = '';
    ui.variant = 0;
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
      fetch('data/comps.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
      fetch('data/static.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))),
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
