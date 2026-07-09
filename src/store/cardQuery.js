// The card-query grammar - the ONE search language shared by the deckbuilder and
// the Codex. Pure and DB-free (no ./db import), so it unit-tests under
// `node --test` and can be imported by any layer without a database.
//
//   parseQuery(raw) -> { name, clauses, scopes }
//     name    - the free-text needle (bare words + "quoted phrases")
//     clauses - array of (card)=>bool predicates from card-attribute tokens
//     scopes  - { has:[], is:[] } Codex personal-layer/scope tokens (has:faq,
//               is:saved, is:article, ...). Consumed by searchCodex; INERT in the
//               deckbuilder (a deck pool has no personal layer), where they are
//               swallowed so they never poison the name needle.
//   cardMatchesQuery(row, parsed) - tests a card row against parsed.clauses.
//
// Card-attribute tokens (key OP value; OP in : = > < >= <=, ':' == '='):
//   name:sir · type:mortal (t:) · rules:draw (r:) · life:20 · attack>2 ·
//   defense>2 · element:fire / el:ae / e:air (letters=OR) · threshold:3 (th:) ·
//   at>1 / et: / ft: / wt: · cost:2 (c:, c=2) · keyword:charge (kw:) ·
//   set:art (s:, codes alp/bet/art/got/dra/pro, names work too) ·
//   artist:"Ed Beard" · rarity:unique
// <text> values may be "quoted" or /regex/; a comma inside a text value ANDs the
// terms (r:"airborne, genesis" needs both). Numeric keys self-guard: a
// non-numeric value yields no clause and falls through to the free-text needle.
// flavor: is reference syntax but the catalogue carries no flavor text, so it is
// unsupported. artist: is wired but the catalogue ships no variant data yet.

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

const CQ_EL_LETTER = { a: 'air', e: 'earth', f: 'fire', w: 'water' };
const CQ_ELS = ['air', 'earth', 'fire', 'water'];

// <text|regex> matcher: /.../ -> RegExp (case-insensitive). Otherwise CI
// substring, where commas separate REQUIRED terms (AND) - r:"airborne, genesis"
// matches only cards whose rules carry both.
const cqTerms = (val) => val.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
function cqText(val) {
  const m = /^\/(.+)\/$/.exec(val);
  if (m) { try { const re = new RegExp(m[1], 'i'); return (s) => re.test(s || ''); } catch { /* bad regex -> substring */ } }
  const needles = cqTerms(val);
  return (s) => { const hay = (s || '').toLowerCase(); return needles.every((n) => hay.includes(n)); };
}
const cqCmp = (a, op, b) => op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : a === b;

function cqClause(key, op, val) {
  const num = Number(val);
  const nOp = (op === ':' || op === '=') ? '=' : op;
  const numeric = (get) => Number.isFinite(num) ? ((c) => get(c) != null && cqCmp(get(c), nOp, num)) : null;
  switch (key) {
    case 'name': { const m = cqText(val); return (c) => m(c.name); }
    // Collection fields flatten to one haystack so comma-AND spans the whole
    // type line - t:mortal,knight needs both, wherever each lives.
    case 'type': case 't': { const m = cqText(val); return (c) => m([c.type, ...jp(c.sub_types, [])].join(' ')); }
    case 'rules': case 'r': { const m = cqText(val); return (c) => m(c.rules_text); }
    case 'life': return numeric((c) => c.life);
    case 'attack': return numeric((c) => c.attack);
    case 'defense': case 'defence': return numeric((c) => c.defence);
    case 'element': case 'el': case 'e': {
      // element:fire (full name) or el:ae / e:af (letters, OR across elements).
      // Guard: treat the value as an element-letter set ONLY when EVERY char is
      // an element letter (a/e/f/w), else it is not an element filter and falls
      // through to the free-text needle - so e:dragon is a name search, never a
      // silent filter-to-Air (the old [...val].filter(Boolean) footgun).
      const v = val.toLowerCase();
      const els = CQ_ELS.includes(v) ? [v]
        : /^[aefw]+$/.test(v) ? [...v].map((ch) => CQ_EL_LETTER[ch]) : [];
      if (!els.length) return null;
      return (c) => {
        const have = jp(c.elements, []).map((e) => String(e).toLowerCase());
        const th = jp(c.thresholds, {});
        return els.some((el) => have.includes(el) || (th[el] || 0) > 0);
      };
    }
    case 'threshold': case 'th':
      return Number.isFinite(num) ? (c) => { const th = jp(c.thresholds, {}); return CQ_ELS.some((el) => cqCmp(th[el] || 0, nOp, num)); } : null;
    case 'at': case 'et': case 'ft': case 'wt': {
      const el = { at: 'air', et: 'earth', ft: 'fire', wt: 'water' }[key];
      return Number.isFinite(num) ? (c) => cqCmp(jp(c.thresholds, {})[el] || 0, nOp, num) : null;
    }
    case 'cost': case 'c': return numeric((c) => c.cost);
    case 'keyword': case 'kw': {
      // keywords live in rules text - whole-word match so kw:charge doesn't hit
      // "discharge"; comma-separated keywords are ALL required (AND)
      try {
        const res = cqTerms(val).map((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
        return res.length ? (c) => res.every((re) => re.test(c.rules_text || '')) : null;
      } catch { return null; }
    }
    case 'set': case 's': { const m = cqText(val); return (c) => m(jp(c.sets, []).map((s) => `${s.code} ${s.name}`).join(' ')); }
    case 'artist': { const m = cqText(val); return (c) => m(jp(c.variants, []).map((v) => v?.artist || '').join(' ')); }
    case 'rarity': { const m = cqText(val); return (c) => m(c.rarity); }
    default: return null;
  }
}

const SCOPE_KEYS = new Set(['has', 'is']);

export function parseQuery(raw) {
  const clauses = [];
  const words = [];
  const scopes = { has: [], is: [] };
  const tokens = (raw || '').match(/[a-z]+(?:>=|<=|[:=><])"[^"]*"|[a-z]+(?:>=|<=|[:=><])\S+|"[^"]*"|\S+/gi) || [];
  for (const t of tokens) {
    const m = /^([a-z]+)(>=|<=|[:=><])(.+)$/i.exec(t);
    if (m) {
      const key = m[1].toLowerCase();
      const op = m[2];
      const val = m[3].replace(/^"|"$/g, '');
      // Codex scope channel: has:/is: (colon only) are carried on the parse, never
      // become clauses, and never leak into the needle. Inert in the deckbuilder.
      if (SCOPE_KEYS.has(key) && op === ':') { scopes[key].push(val.toLowerCase()); continue; }
      const clause = cqClause(key, op, val);
      if (clause) { clauses.push(clause); continue; }
    }
    words.push(t.replace(/^"|"$/g, ''));
  }
  return { name: words.join(' ').trim(), clauses, scopes };
}

// Back-compat alias - parseCardQuery IS parseQuery. Deckbuilder callers read
// only { name, clauses } and simply ignore the (inert) scopes channel.
export const parseCardQuery = parseQuery;

export function cardMatchesQuery(c, parsed) {
  return parsed.clauses.every((test) => test(c));
}
