// Article formatter - the reference text arrives as one unformatted blob with
// hard line-wraps mid-sentence and no paragraph/list structure. We reflow it and
// re-segment it semantically into blocks the reader can scan: paragraphs, ordered
// and unordered lists, and colon-introduced lists. [[Card Name]] markup is left
// intact for the renderer to linkify. Conservative by design - when in doubt we
// keep prose as a paragraph rather than risk mangling it.

// Discourse markers that almost always begin a new thought → a new paragraph.
const BREAKERS = /^(For example|For instance|However|Note that|Note:|Additionally|In addition|Furthermore|Moreover|That said|In effect|Importantly|Remember|Finally|Similarly|Otherwise|Therefore|Thus|Exception:|Example:)\b/i;

// A sentinel that stands in for an abbreviation's period while we sentence-split,
// then gets restored. Uses a Private Use Area codepoint that can't occur in text.
const DOT = String.fromCharCode(0xE000);

function toSentences(text) {
  const guarded = text.replace(/\b(e\.g|i\.e|etc|vs|Mr|Dr|No)\./g, (m) => m.slice(0, -1) + DOT);
  const out = guarded.split(/(?<=[.!?])\s+(?=[“"'\[A-Z0-9])/);
  return out.map((s) => s.split(DOT).join('.').trim()).filter(Boolean);
}

// A colon-introduced enumeration, or a run of numbered / bulleted items. These
// only fire when explicit list markers are present, so ordinary prose that
// happens to contain a colon or a hyphen is never mis-split.
function splitNumbered(body) {
  const parts = body.split(/\s+(?=\d+[.)]\s)/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.slice(1).every((p) => /^\d+[.)]/.test(p))) {
    return parts.map((p) => p.replace(/^\d+[.)]\s*/, '')).filter(Boolean);
  }
  return null;
}
function splitBulleted(body) {
  if (!/(?:^|\s)[•●\-–\*]\s+\S/.test(body)) return null;
  const parts = body.split(/\s*(?:^|\s)[•●\-–\*]\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

// A single reflowed block → one or more structured blocks.
function segment(block) {
  const out = [];
  const numbered = splitNumbered(block);
  if (numbered) { out.push({ type: 'ol', items: numbered }); return out; }
  const bulleted = splitBulleted(block);
  if (bulleted) { out.push({ type: 'ul', items: bulleted }); return out; }

  // colon-introduced list: an intro clause, then 2+ marker-led items
  const colon = block.match(/^(.{4,}?:)\s+(.+)$/s);
  if (colon) {
    const tail = colon[2];
    const asNum = splitNumbered(tail);
    const asBul = asNum ? null : splitBulleted(tail);
    if (asNum || asBul) {
      out.push({ type: 'p', text: colon[1] });
      out.push({ type: asNum ? 'ol' : 'ul', items: asNum || asBul });
      return out;
    }
  }

  // prose → group sentences into paragraphs, breaking on discourse markers or length
  const sentences = toSentences(block);
  let cur = [];
  const flush = () => { if (cur.length) { out.push({ type: 'p', text: cur.join(' ') }); cur = []; } };
  for (const s of sentences) {
    if (cur.length && (BREAKERS.test(s) || cur.length >= 3)) flush();
    cur.push(s);
  }
  flush();
  return out.length ? out : [{ type: 'p', text: block }];
}

/** Format a raw article/sub-entry string into an array of blocks:
    { type: 'p', text } | { type: 'ul'|'ol', items: string[] }. */
export function formatArticle(text) {
  const raw = String(text || '').replace(/\r/g, '');
  if (!raw.trim()) return [];
  // Paragraph units: explicit blank lines if present, else the whole blob.
  const units = /\n[ \t]*\n/.test(raw) ? raw.split(/\n[ \t]*\n/) : [raw];
  const blocks = [];
  for (const u of units) {
    // reflow soft wraps, and normalise any em dashes in the source text to spaced
    // hyphens so no em dash ever reaches the reader (em-dash bullets survive as
    // hyphen bullets, still detected below).
    const reflowed = u.replace(/\s*\n\s*/g, ' ').replace(/\s*—\s*/g, ' - ').replace(/[ \t]{2,}/g, ' ').trim();
    if (reflowed) blocks.push(...segment(reflowed));
  }
  return blocks;
}
