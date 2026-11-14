// Regelwerk: leitet aus Comp-Daten und Spielstand die Tipps für die aktuelle Runde ab.

export const ROUNDS = (() => {
  const list = [];
  for (let n = 1; n <= 4; n++) list.push({ s: 1, n });
  for (let s = 2; s <= 7; s++) for (let n = 1; n <= 7; n++) list.push({ s, n });
  return list.map((r, i) => ({ ...r, i, key: `${r.s}-${r.n}` }));
})();

const AUGMENT_ROUNDS = new Set(['2-1', '3-2', '4-2']);
const STANDARD = { 4: '2-1', 5: '2-5', 6: '3-2', 7: '3-5', 8: '4-2', 9: '5-2', 10: '6-2' };

export const roundIndex = (s, n) => ROUNDS.findIndex((r) => r.s === s && r.n === n);
export const standardSchedule = () =>
  Object.entries(STANDARD).map(([level, key]) => {
    const [s, n] = key.split('-').map(Number);
    return { level: Number(level), s, n, i: roundIndex(s, n) };
  });

export function roundType(r) {
  if (r.s === 1) return r.n === 1 ? 'carousel' : 'pve';
  if (r.n === 4) return 'carousel';
  if (r.n === 7) return 'pve';
  return 'pvp';
}
export const isAugmentRound = (r) => AUGMENT_ROUNDS.has(r.key);
export const TYPE_LABEL = { carousel: 'Karussell', pve: 'PvE', pvp: 'Kampf' };

// Level-Zeitplan der Comp (aus den Spieldaten), streng aufsteigend und mit Level 4 als Start.
export function schedule(comp) {
  const out = [];
  let last = -1;
  // Level 4 kommt ohne XP-Kauf zu Beginn von Stage 2
  const src = [{ level: 4, stage: 2, round: 1 }, ...comp.levels.filter((l) => l.level > 4)];
  for (const l of src.sort((a, b) => a.level - b.level)) {
    const i = roundIndex(l.stage, l.round);
    if (i < 0 || l.level < 4) continue;
    const idx = Math.max(i, last);
    out.push({ level: l.level, s: ROUNDS[idx].s, n: ROUNDS[idx].n, i: idx });
    last = idx;
  }
  return out;
}

export function targetLevel(sched, ri) {
  let lvl = Math.min(3, Math.max(1, ri + 1));
  for (const e of sched) if (e.i <= ri) lvl = e.level;
  return lvl;
}

export function rollLevel(comp) {
  const m = comp.style.match(/(\d+)/);
  if (m) return Number(m[1]);
  const top = [...comp.rolls].sort((a, b) => b.pct - a.pct)[0];
  return top ? top.level : 8;
}
export const isReroll = (comp) => /^lvl/i.test(comp.style);

export function styleLabel(comp) {
  const lvl = rollLevel(comp);
  if (isReroll(comp)) return `Reroll auf Level ${lvl}`;
  if (/fast/i.test(comp.style)) return `Fast ${lvl}`;
  return 'Standard-Tempo';
}

export function carries(comp) {
  return Object.keys(comp.builds).filter((u) => comp.units.includes(u) || (comp.unitStats[u]?.play || 0) > 0.3);
}
export function threeStarTargets(comp) {
  return comp.units.filter((u) => (comp.unitStats[u]?.star3 || 0) >= 0.3);
}

// Wie oft jede Komponente für die Haupt-Builds gebraucht wird; Haupt-Carry zählt stärker.
export function componentPriority(comp, db) {
  const score = new Map();
  const need = new Map();
  carries(comp).forEach((unit, idx) => {
    const weight = idx === 0 ? 3 : idx === 1 ? 2 : 1;
    for (const item of comp.builds[unit][0].items) {
      for (const c of db.items[item]?.recipe || []) {
        score.set(c, (score.get(c) || 0) + weight);
        need.set(c, (need.get(c) || 0) + 1);
      }
    }
  });
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => ({ id, score: s, need: need.get(id) }));
}

export function emblemNeed(comp, db) {
  const main = carries(comp)[0];
  if (!main) return null;
  const item = comp.builds[main][0].items.find((i) => /emblem/i.test(i));
  if (!item) return null;
  const stat = comp.topItems.find((t) => t.item === item);
  if (stat && stat.pct < 0.4) return null;
  return { item, unit: main, recipe: db.items[item]?.recipe || [] };
}

const names = (ids, db) => ids.map((u) => db.units[u]?.name || u);
const listDe = (arr) =>
  arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} und ${arr[arr.length - 1]}`;

export function buildTips(comp, db, st) {
  const tips = [];
  const add = (prio, tag, title, text) => tips.push({ prio, tag, title, text });
  const ri = roundIndex(st.stage, st.round);
  const r = ROUNDS[ri];
  const sched = schedule(comp);
  const target = targetLevel(sched, ri);
  const rollLvl = rollLevel(comp);
  const reroll = isReroll(comp);
  const cs = carries(comp);
  const carryNames = names(cs.slice(0, 2), db);
  const stars = threeStarTargets(comp);
  const comps = componentPriority(comp, db);
  const compName = (c) => db.items[c.id]?.name || c.id;
  const emblem = emblemNeed(comp, db);
  const type = roundType(r);
  const next = sched.find((e) => e.level > st.level);
  const rollEntry = sched.find((e) => e.level === rollLvl);

  // --- Ereignis dieser Runde ---
  if (type === 'carousel' && comps.length) {
    const alt = comps[1] ? ` Alternativ: ${compName(comps[1])}${comps[2] ? ` oder ${compName(comps[2])}` : ''}.` : '';
    add('high', 'Karussell', `Nimm ${compName(comps[0])}`,
      `Die Komponente steckt in den meisten Items deiner Carries.${alt}` +
      (emblem && emblem.recipe.some((c) => /Spatula|FryingPan/.test(c))
        ? ` Liegt ein ${listDe(emblem.recipe.filter((c) => /Spatula|FryingPan/.test(c)).map((c) => db.items[c]?.name))} aus, hat er Vorrang – du brauchst das ${db.items[emblem.item]?.name}.`
        : ''));
  }
  if (isAugmentRound(r)) {
    let text;
    if (st.hp < 45) text = 'Dein Leben ist niedrig: wähle ein Kampf-Augment, das dein Board sofort stärker macht.';
    else if (r.s === 2) text = 'Früh lohnen sich Wirtschafts- und Item-Augments am meisten – sie zahlen sich über das ganze Spiel aus.';
    else text = 'Wähle, was deine Carries direkt verstärkt (Items, Kampfwerte) oder zur Haupt-Synergie passt.';
    if (emblem) text += ` Emblem-Augments sind hier besonders wertvoll: ${db.units[emblem.unit]?.name} spielt das ${db.items[emblem.item]?.name}.`;
    add('high', 'Augment', 'Augment-Wahl in dieser Runde', text);
  }
  if (type === 'pve' && r.s >= 2) {
    add('mid', 'PvE', 'Beute einsammeln und Items bauen',
      'Nach der Runde neue Komponenten sofort mit der Item-Liste abgleichen. Fertige Items der Prioritätsliste direkt bauen statt Komponenten zu horten.');
  }

  // --- Level ---
  if (r.s === 1) {
    add('mid', 'Start', 'Paare kaufen, nichts verrollen',
      `Kaufe Einheiten, die zur Comp passen oder Paare bilden. Kein Gold für XP oder Rerolls ausgeben.`);
  } else if (next && next.i <= ri) {
    const keep = reroll && st.level === rollLvl;
    if (!keep) {
      add('high', 'Level', `Jetzt auf Level ${next.level} gehen`,
        `Laut Zeitplan dieser Comp ist Level ${next.level} seit ${next.s}-${next.n} fällig, du bist auf Level ${st.level}.` +
        (st.gold < 20 ? ' Mit so wenig Gold erst nächste Runde leveln, falls du diese sicher gewinnst.' : ''));
    }
  } else if (next) {
    const dist = next.i - ri;
    add('low', 'Level', `Nächstes Level-Up: Level ${next.level} in ${next.s}-${next.n}`,
      `Noch ${dist} Runde${dist === 1 ? '' : 'n'}. ${st.level > target ? 'Du bist dem Zeitplan voraus – das lohnt sich nur, wenn du damit Kämpfe gewinnst.' : 'Bis dahin Gold für Zinsen zusammenhalten.'}`);
  }

  // --- Rollen ---
  if (r.s >= 2) {
    if (reroll) {
      const who = stars.length ? listDe(names(stars.slice(0, 4), db)) : listDe(carryNames);
      if (st.level < rollLvl) {
        add('mid', 'Rollen', `Noch nicht rollen – erst Level ${rollLvl}`,
          `Diese Comp rollt auf Level ${rollLvl}${rollEntry ? ` (geplant ab ${rollEntry.s}-${rollEntry.n})` : ''}. Bis dahin nur Paare aus dem normalen Shop mitnehmen.`);
      } else if (st.level === rollLvl) {
        if (st.gold > 50 || st.hp < 40)
          add('high', 'Rollen', st.hp < 40 ? 'Rollen, bis das Board stabil ist' : `Gold über 50 verrollen (${st.gold - 50} Gold)`,
            `Bleib auf Level ${rollLvl} und rolle für 3 Sterne auf ${who}.` + (st.hp < 40 ? ' Bei wenig Leben darfst du unter 50 Gold gehen.' : ' Nicht unter 50 fallen, damit die Zinsen weiterlaufen.'));
        else
          add('mid', 'Rollen', 'Erst auf 50 Gold sparen',
            `Dann jede Runde nur den Überschuss verrollen (Slow-Roll) für 3 Sterne auf ${who}.`);
      } else {
        add('low', 'Rollen', '3-Sterne fertig? Dann weiter leveln',
          `Du bist über dem Roll-Level ${rollLvl}. Fehlen noch Kopien von ${who}, wird es hier deutlich schwerer, sie zu treffen.`);
      }
    } else if (st.level < rollLvl) {
      if (st.hp < 35 && st.level >= 6)
        add('high', 'Rollen', 'Notfall: jetzt stabilisieren',
          `Mit ${st.hp} Leben erreichst du Level ${rollLvl} sonst nicht mehr. Rolle auf dem aktuellen Level, bis das Board Kämpfe gewinnt.`);
      else
        add('mid', 'Rollen', `Nicht rollen – Ziel ist Level ${rollLvl}`,
          `Gold sparen und ${rollEntry ? `in ${rollEntry.s}-${rollEntry.n} ` : ''}auf Level ${rollLvl} gehen. Erst dort nach ${listDe(carryNames)} rollen.`);
    } else if (st.level === rollLvl) {
      add('high', 'Rollen', `Rolldown auf Level ${rollLvl}`,
        `Rolle, bis ${listDe(carryNames)} 2 Sterne haben und das Zielboard steht.` +
        (st.gold >= 30 ? ' Danach aufhören und wieder Richtung 50 Gold sparen.' : ' Du hast wenig Gold – nur rollen, wenn du Paare vervollständigen kannst.'));
    } else {
      add('low', 'Rollen', 'Board vervollständigen',
        `Über Level ${rollLvl}: Überschuss nutzen, um teure Einheiten aufzuwerten oder das nächste Level zu erreichen.`);
    }
  }

  // --- Gold ---
  if (r.s >= 2 && st.gold < 50) {
    const nextTier = Math.floor(st.gold / 10) * 10 + 10;
    const d = nextTier - st.gold;
    const rolling = tips.some((t) => t.tag === 'Rollen' && t.prio === 'high');
    if (!rolling)
      add(d <= 3 ? 'mid' : 'low', 'Gold', `Noch ${d} Gold bis ${nextTier}`,
        `Ab ${nextTier} Gold bekommst du ${nextTier / 10} Zinsen pro Runde. ${d <= 3 ? 'Verkaufe notfalls eine Bank-Einheit, um die Schwelle zu erreichen.' : 'Ziel sind 50 Gold für die vollen 5 Zinsen.'}`);
  } else if (r.s >= 2 && st.gold >= 60 && !(reroll && st.level === rollLvl)) {
    add('mid', 'Gold', 'Gold über 50 bringt nichts',
      `Mehr als 5 Zinsen gibt es nicht. Stecke den Überschuss in XP${next ? ` für Level ${next.level}` : ''}.`);
  }

  // --- Leben und Serie ---
  if (st.hp <= 25)
    add('high', 'Leben', 'Kritisch: alles ins Board',
      'Zinsen sind jetzt egal. Rolle und baue alle Items, auch nicht perfekte – jede gewonnene Runde zählt für die Platzierung.');
  else if (st.hp <= 45 && r.s >= 3)
    add('mid', 'Leben', 'Leben wird knapp',
      'Keine Runden mehr verschenken: Komponenten zu brauchbaren Items bauen und das stärkste Board spielen, nicht das zukünftige.');
  else if (st.hp >= 80 && r.s >= 3 && r.s <= 4)
    add('low', 'Leben', 'Viel Leben – nutze es',
      'Du kannst dir ein, zwei schwächere Runden leisten, um Gold aufzubauen und früher zu leveln.');

  if (st.streak === 'win' && r.s >= 2)
    add('low', 'Serie', 'Siegesserie halten',
      'Spiele das stärkste Board und baue Items früh. Ein früheres Level-Up lohnt sich, wenn es die Serie rettet.');
  if (st.streak === 'loss' && r.s === 2)
    add('low', 'Serie', 'Niederlagenserie durchziehen',
      'In Stage 2 kostet Verlieren wenig Leben: Serie bis zum Ende der Stage halten, Gold sparen und im Karussell zuerst wählen.');
  if (st.streak === 'loss' && r.s >= 3 && st.hp < 60)
    add('mid', 'Serie', 'Niederlagenserie jetzt brechen',
      'Ab Stage 3 wird der Schaden zu hoch. Items bauen und das Board verstärken.');

  // --- Fehlende Carries ---
  if (r.s >= 3 && st.owned) {
    const missing = cs.filter((u) => comp.units.includes(u) && !st.owned[u] && (db.units[u]?.cost || 0) <= Math.max(3, st.level - 3));
    if (missing.length && Object.keys(st.owned).length)
      add('low', 'Einheiten', `Noch nicht gefunden: ${listDe(names(missing, db))}`,
        'Gib ihre Items vorerst einem Platzhalter mit ähnlicher Rolle und tausche später.');
  }

  const order = { high: 0, mid: 1, low: 2 };
  return tips.sort((a, b) => order[a.prio] - order[b.prio]);
}

export function upcoming(comp, db, st, count = 5) {
  const ri = roundIndex(st.stage, st.round);
  const sched = schedule(comp);
  const comps = componentPriority(comp, db);
  const rollLvl = rollLevel(comp);
  const out = [];
  for (let i = ri + 1; i < ROUNDS.length && out.length < count; i++) {
    const r = ROUNDS[i];
    const type = roundType(r);
    const notes = [];
    const lvl = sched.find((e) => e.i === i);
    if (lvl && lvl.level > st.level) notes.push(lvl.level === rollLvl && !isReroll(comp) ? `Level ${lvl.level} + Rolldown` : `Level ${lvl.level}`);
    if (isAugmentRound(r)) notes.push('Augment wählen');
    if (type === 'carousel' && comps[0]) notes.push(`${db.items[comps[0].id]?.name || 'Komponente'} nehmen`);
    if (type === 'pve' && r.s >= 2) notes.push('Beute, Items bauen');
    if (!notes.length) notes.push(st.gold < 50 ? 'Sparen' : 'Stärkstes Board spielen');
    out.push({ ...r, type, notes });
  }
  return out;
}

// Allgemeiner Spielplan je Stage – unabhängig vom aktuellen Spielstand.
export function gamePlan(comp, db) {
  const sched = schedule(comp);
  const rollLvl = rollLevel(comp);
  const reroll = isReroll(comp);
  const cs = carries(comp);
  const carryNames = listDe(names(cs.slice(0, 2), db));
  const stars = threeStarTargets(comp);
  const starNames = listDe(names(stars.slice(0, 4), db));
  const comps = componentPriority(comp, db).slice(0, 3).map((c) => db.items[c.id]?.name).filter(Boolean);
  const emblem = emblemNeed(comp, db);
  const rollEntry = sched.find((e) => e.level === rollLvl);
  const rollStage = rollEntry ? Math.min(5, rollEntry.s) : null;
  const bucket = (s) => Math.min(5, s);
  const fixed = {
    2: ['Paare und passende Einheiten kaufen, sonst Gold sparen (Ziel: 50).', comps.length ? `Im Karussell: ${comps.join(', ')}.` : null],
    3: ['Fertige Items bauen statt Komponenten zu horten.', 'Über 50 Gold nur für geplante Level-Ups ausgeben.'],
    4: [`Items auf ${carryNames || 'die Carries'} legen, Platzhalter ersetzen.`],
    5: ['Überschüssiges Gold in Level und teure Einheiten stecken.', 'Aufstellung an die stärksten Gegner anpassen.'],
  };
  const out = [];
  for (let s = 2; s <= 5; s++) {
    const points = [];
    const ups = sched.filter((e) => e.level > 4 && bucket(e.s) === s);
    if (ups.length) points.push(ups.map((e) => `Level ${e.level} in ${e.s}-${e.n}`).join(', ') + '.');
    if (rollStage === s) {
      points.push(reroll
        ? `Ab ${rollEntry.s}-${rollEntry.n} auf Level ${rollLvl} bleiben und alles über 50 Gold verrollen${starNames ? ` – Ziel: 3 Sterne auf ${starNames}` : ''}.`
        : `In ${rollEntry.s}-${rollEntry.n} auf Level ${rollLvl} runterrollen, bis ${carryNames || 'die Carries'} 2 Sterne haben.`);
    } else if (rollStage && s < rollStage && s >= 3) {
      points.push(`Nicht rollen – erst auf Level ${rollLvl}.`);
    } else if (rollStage && s === rollStage + 1 && reroll) {
      points.push('Sind die 3-Sterne fertig, weiter leveln und das Board abrunden.');
    }
    if (s === 2 && emblem) points.push(`Auf ${db.items[emblem.item]?.name} achten (Augments, Pfannenwender) – für ${db.units[emblem.unit]?.name}.`);
    points.push(...fixed[s].filter(Boolean));
    out.push({ title: s === 5 ? 'Stage 5+' : `Stage ${s}`, points });
  }
  return {
    stages: out,
    summary: [
      ['Spielstil', styleLabel(comp)],
      ['Carries', listDe(names(cs.slice(0, 3), db)) || '–'],
      stars.length ? ['3 Sterne', starNames] : null,
      comps.length ? ['Komponenten', comps.join(', ')] : null,
    ].filter(Boolean),
  };
}
