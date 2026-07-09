// Card keyword linker - card `rulesText` references rule keywords in plain text
// (no [[..]] markup), which today render as dead words. We linkify them, but
// keyword linking is fundamentally a CURATION problem: the rule-title lexicon is
// full of common English words (Draw, Cost, Life, Fire, Attack, Hand...), so
// linking every occurrence would over-link catastrophically. Stage 0 is therefore
// deliberately CONSERVATIVE (under-link, never mis-link); the CMS/enrichment pass
// refines from here:
//   - multi-word titles: linked anywhere (a capitalised multi-word phrase matching
//     a rule title is unambiguous), case-sensitive, word-bounded.
//   - single-word titles: linked ONLY at a line start (where card abilities put
//     their keyword banner, e.g. "Airborne", "Genesis -> ...") and never if the
//     title is a common word on the stop-list.
// `name` on each span is the exact rule title, so the renderer resolves it the
// same way it resolves a [[Name]] link.

// Single-word titles that are also ordinary card-text words - never auto-linked.
const STOPLIST = new Set([
  'Ability', 'Adjacent', 'Air', 'Ally', 'Atlas', 'Atop', 'Attack', 'Aura', 'Below',
  'Body', 'Border', 'Bottom', 'Bruin', 'Card', 'Codex', 'Copy', 'Cost', 'Damage',
  'Die', 'Draw', 'Drop', 'Earth', 'Enemy', 'Enter', 'Evil', 'Fight', 'Fire', 'Fly',
  'Hand', 'Here', 'Kill', 'Lance', 'Level', 'Life', 'Lose', 'Magic', 'Mana', 'Move',
  'Nearby', 'Order', 'Play', 'Power', 'Range', 'Rest', 'Site', 'Spell', 'Strike',
  'Tap', 'Token', 'Turn', 'Unit', 'Void', 'Ward', 'Water',
]);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildLexicon(titles) {
  const single = new Set();
  const multi = [];
  for (const raw of titles) {
    const name = String(raw || '').trim();
    if (!name) continue;
    if (/\s/.test(name)) multi.push(name);
    else if (!STOPLIST.has(name)) single.add(name);
  }
  multi.sort((a, b) => b.length - a.length);              // most specific first
  return { single, multi };
}

/** Keyword link spans (offsets into canon), sorted, non-overlapping. */
export function linkifyKeywords(canon, lex) {
  const spans = [];
  const taken = (s, e) => spans.some((x) => s < x.end && e > x.start);

  for (const name of lex.multi) {
    const re = new RegExp('(^|[^A-Za-z0-9])(' + esc(name) + ')(?![A-Za-z0-9])', 'g');
    let m;
    while ((m = re.exec(canon))) {
      const s = m.index + m[1].length, e = s + name.length;
      if (!taken(s, e)) spans.push({ start: s, end: e, name, target: 'rule' });
      re.lastIndex = e;
    }
  }

  const lineStarts = [0];
  for (let i = 0; i < canon.length; i++) if (canon[i] === '\n') lineStarts.push(i + 1);
  for (const ls of lineStarts) {
    const m = /^([A-Za-z][A-Za-z'-]*)/.exec(canon.slice(ls));
    if (m && lex.single.has(m[1])) {
      const s = ls, e = ls + m[1].length;
      if (!taken(s, e)) spans.push({ start: s, end: e, name: m[1], target: 'rule' });
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}
