// Canonicalizer - the coordinate system for the whole document render pipeline.
// Inline links and block spans are recorded as character offsets INTO `canon`, so
// this function's output must stay internally consistent for a given (raw,
// CANON_VERSION). (Offset-anchored highlights, the original durable consumer of
// these offsets, were removed in schema v10; link and block spans are recomputed
// each build, so an offset is no longer persisted across builds.)
//
// Two modes, because the two source shapes differ:
//   - articles: `content` is a reflowed prose blob with ~100-col HARD-WRAP noise
//     (single \n mid-sentence) and NO blank lines. We reflow wraps to spaces and
//     keep a real paragraph break (blank line) as a single \n, should the source
//     ever gain them.
//   - cards: `rulesText` uses SEMANTIC newlines (one line per ability/keyword,
//     blank line between a keyword banner and its text). We preserve line breaks.
//
// Inline [[Name]] wiki-links are stripped to their display text in canon, with
// their spans recorded as offsets INTO canon (brackets excluded) - so the renderer
// works in the exact coordinate space the reader sees.

export const CANON_VERSION = 1;

const EMDASH = /\s*—\s*/g;   // em dash -> spaced hyphen (app law: never render an em dash)

// Pull inline reference markup out of `text`; return the stripped display string +
// TYPED link spans. The source uses two intentional link syntaxes, distinguished
// by bracket family:
//   [[Name]]  -> a CARD reference   (target: 'card')
//   ((Name))  -> a RULE reference   (target: 'rule')
// A third form, reversed parens ))Name((, is a data-entry MISTAKE (24 occurrences).
// It is paren-family, so we recover it as a RULE link and flag it (`mistake: true`)
// for later source cleanup, rather than dropping the reference or silently hiding
// the error. `name` slices exactly out of canon so the link span and the renderer
// share the coordinate space.
function extractLinks(text) {
  let canon = '';
  const links = [];
  const re = /\[\[([^\]]+)\]\]|\(\(([^()]+)\)\)|\)\)([^()]+)\(\(/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    canon += text.slice(last, m.index);
    const name = m[1] ?? m[2] ?? m[3];
    const start = canon.length;
    canon += name;
    const link = { start, end: canon.length, name, target: m[1] != null ? 'card' : 'rule' };
    if (m[3] != null) link.mistake = true;                // reversed-paren source typo, recovered
    links.push(link);
    last = m.index + m[0].length;
  }
  canon += text.slice(last);
  return { canon, links };
}

/** Article content -> { canon, links }. Hard wraps collapse to spaces; genuine
 *  blank-line paragraph breaks (none today) survive as a single \n. */
export function canonicalizeArticle(raw) {
  const t = String(raw || '').replace(/\r/g, '').replace(EMDASH, ' - ');
  const paras = t
    .split(/\n[ \t]*\n+/)                       // blank lines = paragraph units
    .map((p) => p.replace(/\s*\n\s*/g, ' ')     // reflow the hard-wrap noise
                 .replace(/[ \t]{2,}/g, ' ')
                 .trim())
    .filter(Boolean);
  return extractLinks(paras.join('\n'));
}

/** Card rulesText -> { canon, links }. Newlines are semantic line breaks and are
 *  preserved (blank runs collapsed to a single break); intra-line runs of spaces
 *  collapse. Keyword links are added later by the keyword pass, not here. */
export function canonicalizeCard(raw) {
  const t = String(raw || '').replace(/\r/g, '').replace(EMDASH, ' - ');
  const lines = t
    .split(/\n+/)
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .filter(Boolean);
  return extractLinks(lines.join('\n'));
}
