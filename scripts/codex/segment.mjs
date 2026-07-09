// Segmenter - turns a canon string into typed blocks whose `span` is a [start,end)
// character range INTO canon. Deterministic and CONSERVATIVE: it keeps prose as
// paragraphs unless there is an explicit, unambiguous signal. Real readable
// structure that the source doesn't signal (unmarked enumerations, in-article
// headings, most callouts) is authored later by the reviewed enrichment overlay -
// NOT invented here. Bumping PARSER_VERSION only churns block ids (render handles),
// never annotation anchors (those live in canon offsets).

export const PARSER_VERSION = 1;

const DOT = String.fromCharCode(0xE000);                 // sentinel for a guarded abbreviation period
const ABBR = /\b(e\.g|i\.e|etc|vs|Mr|Dr|No)\./g;
const SENT_SPLIT = /(?<=[.!?])\s+(?=[“"'\[(A-Z0-9])/;    // '(' added: split before a parenthetical sentence

// Explicit "Word:" callout prefixes only. NOT "For example" - too common; that
// stays a paragraph-break discourse marker so we don't spam callouts.
const CALLOUTS = [
  { re: /^Note:/i, type: 'note', label: 'Note' },
  { re: /^Reminder:/i, type: 'note', label: 'Reminder' },
  { re: /^Example:/i, type: 'example', label: 'Example' },
  { re: /^Exception:/i, type: 'warning', label: 'Exception' },
  { re: /^Warning:/i, type: 'warning', label: 'Warning' },
  { re: /^Important:/i, type: 'warning', label: 'Important' },
];
const BREAKERS = /^(For example|For instance|However|Note that|Additionally|In addition|Furthermore|Moreover|That said|In effect|Importantly|Remember|Finally|Similarly|Otherwise|Therefore|Thus)\b/i;

function sentencesOf(text) {
  const g = text.replace(ABBR, (m) => m.slice(0, -1) + DOT);
  return g.split(SENT_SPLIT).map((s) => s.split(DOT).join('.').trim()).filter(Boolean);
}
function calloutFor(text) { return CALLOUTS.find((c) => c.re.test(text)) || null; }
function trimRange(canon, s, e) { while (e > s && /\s/.test(canon[e - 1])) e--; while (s < e && /\s/.test(canon[s])) s++; return [s, e]; }

// Strict numbered list: markers N. / N) at a whitespace boundary, not part of a
// "(N)" parenthetical, forming a SEQUENTIAL run 1,2,3,... with >=2 items. The old
// detector fired on any prose number ("power of 3. When...") and deleted the digit.
function detectNumbered(unit) {
  const re = /(^|\s)(\d+)[.)](?=\s)/g;
  const marks = [];
  let m;
  while ((m = re.exec(unit))) {
    const markAt = m.index + m[1].length;
    if (unit[markAt - 1] === '(') continue;              // reject "(2)"
    marks.push({ num: +m[2], markAt, contentAt: re.lastIndex });
  }
  if (marks.length < 2 || !marks.every((x, i) => x.num === i + 1)) return null;
  return {
    type: 'ol',
    firstMarkerAt: marks[0].markAt,
    items: marks.map((mk, i) => ({ s: mk.contentAt, e: i + 1 < marks.length ? marks[i + 1].markAt : unit.length })),
  };
}

// Strict bullet list: real bullet glyphs only (corpus has none; a lone spaced
// hyphen is NEVER a bullet - that was the false-positive that shredded prose).
function detectBulleted(unit) {
  const re = /(^|\s)[•●▪‣◦]\s+/g;
  const marks = [];
  let m;
  while ((m = re.exec(unit))) marks.push({ markAt: m.index + m[1].length, contentAt: re.lastIndex });
  if (marks.length < 2) return null;
  return {
    type: 'ul',
    firstMarkerAt: marks[0].markAt,
    items: marks.map((mk, i) => ({ s: mk.contentAt, e: i + 1 < marks.length ? marks[i + 1].markAt : unit.length })),
  };
}

// One canon unit (base..base+text.length) -> blocks appended to `out`.
function segmentUnit(canon, base, text, out) {
  const list = detectNumbered(text) || detectBulleted(text);
  if (list) {
    if (list.firstMarkerAt > 0) {
      const [is, ie] = trimRange(canon, base, base + list.firstMarkerAt);
      if (ie > is) out.push({ type: 'p', span: [is, ie] });   // intro clause before the list
    }
    const items = list.items
      .map((it) => trimRange(canon, base + it.s, base + it.e))
      .filter(([s, e]) => e > s)
      .map(([s, e]) => ({ span: [s, e] }));
    if (items.length >= 2) {
      out.push({ type: list.type, span: [items[0].span[0], items[items.length - 1].span[1]], items });
      return;
    }
  }

  // Prose: group sentences into paragraphs; explicit "Word:" sentences become
  // single-sentence callouts; discourse markers / a 3-sentence cap end a group.
  const sents = sentencesOf(text);
  let cursor = base;
  let group = [];
  const locate = (sent) => { const i = canon.indexOf(sent, cursor); cursor = i + sent.length; return [i, cursor]; };
  const flush = () => {
    if (!group.length) return;
    const span = [group[0][0], group[group.length - 1][1]];
    const co = calloutFor(canon.slice(span[0], span[1]));
    out.push(co ? { type: co.type, label: co.label, span } : { type: 'p', span });
    group = [];
  };
  for (const sent of sents) {
    const span = locate(sent);
    const co = calloutFor(sent);
    if (co) { flush(); out.push({ type: co.type, label: co.label, span }); continue; }
    if (group.length && (BREAKERS.test(sent) || group.length >= 3)) flush();
    group.push(span);
  }
  flush();
}

/** canon -> ordered blocks with canon-offset spans. Units are the \n-separated
 *  pieces (article paragraph breaks / card lines); each is segmented in place. */
export function segment(canon) {
  const out = [];
  let base = 0;
  for (const piece of canon.split('\n')) {
    if (piece.trim()) segmentUnit(canon, base, piece, out);
    base += piece.length + 1;                              // +1 for the consumed \n
  }
  return out;
}
