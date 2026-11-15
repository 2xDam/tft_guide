// Mitschriften: im Modus „Runde für Runde“ gespeicherte Spielverläufe (nur auf diesem Gerät)
// und ihre Auswertung gegen den Level-Zeitplan der gespielten Comp.

import { ROUNDS, roundIndex } from './tips.js';

const STORE = 'tft-guide-history-v1';
const MAX = 50;

export function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function store(list) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, MAX)));
  } catch { /* privater Modus */ }
}
export function addHistory(entry) {
  store([entry, ...loadHistory()]);
}
// Legt die Mitschrift an oder ersetzt die mit derselben Nummer (laufendes Spiel).
export function putHistory(entry) {
  const list = loadHistory();
  const at = list.findIndex((e) => String(e.id) === String(entry.id));
  // Eine nachgetragene Platzierung bleibt, wenn das laufende Spiel weiter mitschreibt.
  if (at >= 0) list[at] = { ...entry, placement: entry.placement ?? list[at].placement ?? null };
  else list.unshift(entry);
  store(list);
}
export function removeHistory(id) {
  store(loadHistory().filter((e) => String(e.id) !== String(id)));
}

const key = (i) => ROUNDS[i]?.key || '?';

export function analyzeLog(e) {
  const out = [];
  const add = (kind, k, text) => out.push({ kind, key: k, text });
  const log = [...e.log].sort((a, b) => a.i - b.i);
  if (!log.length) return out;
  const last = log[log.length - 1].i;

  if (e.placement) add(e.placement <= 4 ? 'good' : 'bad', 'place', `Platz ${e.placement}${e.avg ? ` – die Comp landet im Schnitt auf ${e.avg.toFixed(2).replace('.', ',')}` : ''}.`);

  // Level-Zeitplan: wann wurde jedes Level tatsächlich erreicht?
  let late = 0;
  let checked = 0;
  for (const s of e.sched || []) {
    if (s.level <= 4 || s.i > last) continue;
    checked++;
    const hit = log.find((r) => r.l >= s.level);
    if (!hit) {
      late++;
      add('bad', 'level-never', `Level ${s.level} nicht erreicht – geplant war ${key(s.i)}.`);
    } else if (hit.i - s.i >= 2) {
      late++;
      add('bad', 'level-late', `Level ${s.level} erst in ${key(hit.i)} – ${hit.i - s.i} Runden nach Plan (${key(s.i)}).`);
    } else if (s.i - hit.i >= 3) {
      add('info', 'level-early', `Level ${s.level} schon in ${key(hit.i)} – ${s.i - hit.i} Runden vor Plan (${key(s.i)}).`);
    }
  }
  if (checked >= 2 && !late) add('good', 'level-ok', 'Level-Zeitplan der Comp eingehalten.');

  // Gold
  const rollEntry = (e.sched || []).find((s) => s.level === e.rollLvl);
  const before = log.filter((r) => r.i >= roundIndex(2, 1) && (!rollEntry || r.i < rollEntry.i));
  const first50 = log.find((r) => r.g >= 50);
  if (before.length >= 4) {
    const max = Math.max(...before.map((r) => r.g));
    if (first50 && first50.i <= roundIndex(3, 5)) add('good', 'econ-ok', `50 Gold schon in ${key(first50.i)} erreicht.`);
    else if (max < 30) add('bad', 'econ-low', `Vor dem Rolldown nie über ${max} Gold – viele Zinsen verschenkt.`);
    else if (max < 50) add('info', 'econ-mid', `Vor dem Rolldown höchstens ${max} Gold – 50 bringen die vollen Zinsen.`);
  }
  const rich = log.filter((r) => r.h <= 40 && r.g >= 50);
  if (rich.length >= 2) add('bad', 'gold-hp', `${rich.length} Runden mit über 50 Gold bei höchstens 40 Leben (ab ${key(rich[0].i)}) – früher ausgeben.`);

  // Leben: größte Verluste je Stage
  const byStage = new Map();
  for (const r of log) {
    const s = ROUNDS[r.i]?.s;
    if (!byStage.has(s)) byStage.set(s, { first: r.h, last: r.h });
    byStage.get(s).last = r.h;
  }
  let prev = null;
  let worst = null;
  for (const [s, v] of byStage) {
    const loss = (prev ?? v.first) - v.last;
    if (!worst || loss > worst.loss) worst = { s, loss };
    prev = v.last;
  }
  if (worst && worst.loss >= 30) add(worst.s <= 3 ? 'bad' : 'info', 'hp', `In Stage ${worst.s} ${worst.loss} Leben verloren${worst.s <= 3 ? ' – das Board war früh zu schwach' : ''}.`);

  if (log.length < 5) add('info', 'short', 'Nur wenige Runden mitgeschrieben – die Auswertung ist entsprechend dünn.');
  return out;
}

// Kleiner Verlauf: Leben und Gold über die Runden, Level-Ups als Marken
export function chartSvg(e) {
  const log = [...e.log].sort((a, b) => a.i - b.i);
  if (log.length < 2) return '';
  const W = 300;
  const H = 70;
  const x0 = log[0].i;
  const span = Math.max(1, log[log.length - 1].i - x0);
  const x = (i) => 4 + ((i - x0) / span) * (W - 8);
  const y = (v, max) => H - 14 - (Math.min(v, max) / max) * (H - 22);
  const line = (f, max) => log.map((r) => `${x(r.i).toFixed(1)},${y(f(r), max).toFixed(1)}`).join(' ');
  const ups = log.filter((r, n) => n > 0 && r.l > log[n - 1].l);
  const stages = [...new Set(log.map((r) => ROUNDS[r.i]?.s))].map((s) => ({ s, i: Math.max(x0, roundIndex(s, 1)) }));
  return `<svg class="log-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf von Leben und Gold">
    ${stages.map((s) => `<line x1="${x(s.i)}" x2="${x(s.i)}" y1="4" y2="${H - 14}" class="grid"/><text x="${x(s.i) + 2}" y="${H - 3}" class="ax">Stage ${s.s}</text>`).join('')}
    <polyline points="${line((r) => r.g, 100)}" class="gold"/>
    <polyline points="${line((r) => r.h, 100)}" class="hp"/>
    ${ups.map((r) => `<g><circle cx="${x(r.i)}" cy="8" r="6" class="up"/><text x="${x(r.i)}" y="11" class="upt">${r.l}</text></g>`).join('')}
  </svg>`;
}
