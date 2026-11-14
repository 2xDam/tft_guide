// Seite „Freestyle“: aus den eigenen Einheiten und Items die am besten passenden Meta-Comps berechnen.
// Reine Übereinstimmungs-Rangliste – keine Simulation, keine Shop-Wahrscheinlichkeiten.

import { carries, threeStarTargets, isReroll, styleLabel, emblemNeed } from './tips.js';

const STORE = 'tft-guide-freestyle-v1';
let st = { units: [], items: {} };
try {
  st = { units: [], items: {}, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
} catch { /* privater Modus */ }
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(st));
  } catch { /* privater Modus */ }
};

function scoreComp(comp, db, mine, pool) {
  const norm = (id) => db.units[id]?.alias || id;
  const core = new Set(comp.units.map(norm));
  const early = new Set();
  for (const [lvl, opts] of Object.entries(comp.boards)) if (Number(lvl) <= 6) for (const o of opts) o.units.forEach((u) => early.add(norm(u)));
  const cs = carries(comp).map(norm);
  const stars = new Set(isReroll(comp) ? threeStarTargets(comp).map(norm) : []);
  const traitSet = new Set(comp.traits.map(([t]) => t));

  // Einheiten
  const hits = [];
  let unitPts = 0;
  for (const u of mine) {
    let p = 0;
    if (core.has(u)) p = 1 + (cs.includes(u) ? 0.4 : 0) + (stars.has(u) ? 0.3 : 0);
    else if (early.has(u)) p = 0.5;
    else if ((db.units[u]?.traits || []).some((t) => traitSet.has(t))) p = 0.15;
    if (p >= 0.5) hits.push({ id: u, core: core.has(u) });
    unitPts += Math.min(p, 1.4);
  }
  const unitFit = mine.length ? Math.min(1, unitPts / (mine.length * 1.1)) : 0;

  // Items: erst fertige Items, dann komplette Rezepte, dann einzelne Komponenten
  const have = { ...pool };
  const take = (id) => {
    if (!have[id]) return false;
    have[id]--;
    return true;
  };
  const wanted = [];
  cs.slice(0, 3).forEach((u) => {
    const key = Object.keys(comp.builds).find((k) => norm(k) === u);
    comp.builds[key]?.[0].items.forEach((i, n) => wanted.push({ unit: u, item: i, key, n }));
  });
  const built = [];
  const partial = [];
  let itemPts = 0;
  const open = [];
  for (const w of wanted) {
    if (take(w.item)) {
      built.push({ ...w, done: true });
      itemPts += 1;
    } else open.push(w);
  }
  const open2 = [];
  for (const w of open) {
    const [a, b] = db.items[w.item]?.recipe || [];
    if (!a || !b) continue;
    const ok = a === b ? (have[a] || 0) >= 2 : (have[a] || 0) >= 1 && (have[b] || 0) >= 1;
    if (ok) {
      take(a);
      take(b);
      built.push(w);
      itemPts += 1;
    } else open2.push(w);
  }
  for (const w of open2) {
    const c = (db.items[w.item]?.recipe || []).find((x) => have[x]);
    if (c && take(c)) {
      partial.push({ ...w, comp: c });
      itemPts += 0.4;
    }
  }
  let given = 0;
  for (const [id, n] of Object.entries(pool)) given += (db.items[id]?.recipe?.length ? 1 : 0.5) * n;
  const itemFit = given ? Math.min(1, itemPts / given) : 0;

  const strength = Math.max(0, Math.min(1, (5 - comp.avg) / 0.9));
  const wU = mine.length ? 0.55 : 0;
  const wI = given ? 0.3 : 0;
  const wS = 0.15;
  const total = (wU * unitFit + wI * itemFit + wS * strength) / (wU + wI + wS);

  const missing = [...new Set([...cs, ...comp.units.map(norm)])].filter((u) => !mine.includes(u) && !db.units[u]?.summon).slice(0, 5);
  return { comp, total, unitFit, itemFit, hits, built, partial, missing, givenItems: given };
}

const poolOf = () => Object.fromEntries(Object.entries(st.items).filter(([, n]) => n > 0));
export const freestyleActive = () => st.units.length > 0 || Object.keys(poolOf()).length > 0;
export const freestyleCount = () => st.units.length;

export function freestyleRank(data, db, n = 5) {
  if (!freestyleActive()) return [];
  const pool = poolOf();
  return data.comps.map((c) => scoreComp(c, db, st.units, pool)).sort((a, b) => b.total - a.total).slice(0, n);
}

// Auswahl in den Guide übernehmen: vorhandene Einheiten und baubare Items abhaken
export function freestyleHandover(comp, db) {
  const r = scoreComp(comp, db, st.units, poolOf());
  const owned = {};
  for (const [id, u] of Object.entries(db.units)) if (st.units.includes(u.alias || id)) owned[id] = true;
  const items = {};
  for (const b of r.built) items[`${b.key}:${b.n}`] = true;
  return { owned, items, score: r.total };
}

export function renderFreestyle(app, ctx) {
  const { data, db, esc, img, compName, tier } = ctx;
  const playable = Object.entries(db.units)
    .filter(([, u]) => u.code && !u.alias && !u.summon && u.cost >= 1 && u.cost <= 5 && !u.name.includes('('))
    .sort((a, b) => a[1].cost - b[1].cost || a[1].name.localeCompare(b[1].name));
  const valid = new Set(playable.map(([id]) => id));
  st.units = st.units.filter((u) => valid.has(u));
  const craftable = Object.entries(db.items)
    .filter(([id, i]) => i.recipe.length === 2 && !db.components.includes(id))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  const draw = () => {
    const mine = st.units;
    const pool = Object.fromEntries(Object.entries(st.items).filter(([, n]) => n > 0));
    const any = mine.length || Object.keys(pool).length;
    const ranked = any
      ? data.comps.map((c) => scoreComp(c, db, mine, pool)).sort((a, b) => b.total - a.total).slice(0, 5)
      : [];
    const itemChip = (id, cls = '') => {
      const n = st.items[id] || 0;
      const it = db.items[id];
      return `<span class="fs-item${n ? ' on' : ''} ${cls}">
        <button data-add="${esc(id)}" title="${esc(it.name)} hinzufügen">${img(it.icon, it.name)}${n ? `<b>${n}</b>` : ''}</button>
        ${n ? `<button class="minus" data-sub="${esc(id)}" aria-label="${esc(it.name)} entfernen">−</button>` : ''}</span>`;
    };
    const finished = craftable.filter(([id]) => st.items[id]);

    app.innerHTML = `
      <section class="picker-head">
        <h1>Freestyle</h1>
        <p class="sub">Tippe an, was du gerade hast – die App zeigt, welche Meta-Comps am besten dazu passen.</p>
      </section>
      <div class="guide-grid fs">
        <div class="col">
          <section class="card">
            <div class="card-head"><h2>Deine Einheiten <small>${mine.length || ''}</small></h2>
              <button class="ghost" data-clear ${any ? '' : 'disabled'}>Zurücksetzen</button></div>
            ${[1, 2, 3, 4, 5].map((cost) => `<div class="fs-row"><span class="fs-cost cost-${cost}">${cost}</span><div class="fs-units">${
              playable.filter(([, u]) => u.cost === cost).map(([id, u]) =>
                `<button class="fs-unit cost-${u.cost}${mine.includes(id) ? ' on' : ''}" data-unit="${esc(id)}" title="${esc(u.name)}" aria-pressed="${mine.includes(id)}">${img(u.icon, u.name)}<span>${esc(u.name)}</span></button>`).join('')}</div></div>`).join('')}
          </section>
          <section class="card">
            <div class="card-head"><h2>Deine Items</h2><span class="hint">antippen = +1</span></div>
            <div class="fs-items">${db.components.filter((id) => db.items[id]).map((id) => itemChip(id)).join('')}</div>
            <details class="alts"${finished.length ? ' open' : ''}><summary>Fertige Items${finished.length ? ` (${finished.reduce((a, [id]) => a + st.items[id], 0)})` : ''}</summary>
              <div class="fs-items small">${craftable.map(([id]) => itemChip(id)).join('')}</div></details>
          </section>
        </div>
        <div class="col">
          <section class="card" id="fs-results">
            <div class="card-head"><h2>Passende Comps</h2></div>
            ${ranked.length ? `<ol class="fs-results">${ranked.map((r, i) => resultHtml(r, i, mine)).join('')}</ol>
              <p class="hint">Rangliste nach Übereinstimmung mit Boards und Builds der Comps – ohne Shop-Chancen, Gegner und Augments.</p>`
              : '<p class="empty">Wähle links Einheiten oder Items aus.</p>'}
          </section>
        </div>
      </div>
      ${ranked.length ? `<button class="fs-jump" data-jump><span>Beste Wahl</span><b>${esc(compName(ranked[0].comp))}</b><em>${Math.round(ranked[0].total * 100)} % ↓</em></button>` : ''}`;
  };

  const unitIcon = (id, dim) => {
    const u = db.units[id] || { name: id, cost: 0 };
    return `<span class="unit cost-${u.cost}${dim ? ' dim' : ''}" title="${esc(u.name)}">${img(u.icon, u.name, 'unit-img')}</span>`;
  };
  const itemIcon = (id) => img(db.items[id]?.icon, db.items[id]?.name || id);

  function resultHtml(r, i, mine) {
    const c = r.comp;
    const t = tier(c);
    const emblem = emblemNeed(c, db);
    const items = [
      ...r.built.map((b) => `<span class="fs-build" title="${esc(db.items[b.item]?.name)} für ${esc(db.units[b.unit]?.name)}">${itemIcon(b.item)}<small>${esc(db.units[b.unit]?.name || '')}</small></span>`),
      ...r.partial.map((b) => `<span class="fs-build part" title="${esc(db.items[b.comp]?.name)} → ${esc(db.items[b.item]?.name)} für ${esc(db.units[b.unit]?.name)}">${itemIcon(b.comp)}<i>→</i>${itemIcon(b.item)}</span>`),
    ];
    return `<li class="fs-res${i === 0 ? ' best' : ''}">
      <header>
        <span class="tier tier-${t}">${t}</span>
        <a href="#/comp/${c.id}?fs">${esc(compName(c))}</a>
        <span class="fs-score">${Math.round(r.total * 100)} %</span>
      </header>
      <p class="fs-meta">${esc(styleLabel(c))} · Ø Platz ${c.avg.toFixed(2).replace('.', ',')}</p>
      ${mine.length ? `<div class="fs-line"><span class="lbl">Passt</span>${r.hits.length ? r.hits.map((h) => unitIcon(h.id)).join('') : '<em>keine deiner Einheiten</em>'}
        <b>${r.hits.length} von ${mine.length}</b></div>` : ''}
      ${r.givenItems ? `<div class="fs-line"><span class="lbl">Items</span>${items.length ? items.join('') : '<em>nichts davon passt in die Builds</em>'}</div>` : ''}
      <div class="fs-line"><span class="lbl">Fehlt</span>${r.missing.map((u) => unitIcon(u, true)).join('') || '<em>nichts Wichtiges</em>'}</div>
      ${emblem ? `<p class="hint">Braucht ${esc(db.items[emblem.item]?.name || 'ein Emblem')}.</p>` : ''}
      <a class="fs-open" href="#/comp/${c.id}?fs">Guide öffnen – Einheiten und Items werden übernommen ›</a>
    </li>`;
  }

  app.onchange = null;
  app.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b || !app.contains(b)) return;
    const d = b.dataset;
    if ('jump' in d) {
      app.querySelector('#fs-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (d.unit) st.units = st.units.includes(d.unit) ? st.units.filter((u) => u !== d.unit) : [...st.units, d.unit];
    else if (d.add) st.items[d.add] = Math.min(9, (st.items[d.add] || 0) + 1);
    else if (d.sub) {
      st.items[d.sub] = (st.items[d.sub] || 0) - 1;
      if (st.items[d.sub] <= 0) delete st.items[d.sub];
    } else if ('clear' in d) st = { units: [], items: {} };
    else return;
    save();
    const open = app.querySelector('details.alts')?.open;
    const y = window.scrollY;
    draw();
    if (open) app.querySelector('details.alts').open = true;
    window.scrollTo(0, y);
  };
  draw();
}
