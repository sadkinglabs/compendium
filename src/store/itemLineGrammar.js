// The collector-item text line grammar - BOTH directions (format + parse) in one module so an
// export and its re-import cannot drift.
//
//   line       := qty SP name (SP annotation)*
//   annotation := '[' token ']'
//
//   3 Albespine Pikemen [Beta]          non-foil, set Beta
//   2 Albespine Pikemen [Beta] [Foil]   foil, set Beta
//   4 Wild Boars                        bare - no printing claim (Curiosa-compatible)
//
// This module is PURE and catalog-free: it peels the bracket tokens off a line and reports what
// it found (a set token string, a foil flag, and any grammar problems). Matching a set token to a
// real catalog set, and checking a finish exists for that printing, happens one layer up where
// the card is known - the grammar never guesses at the catalog.
//
// MALFORMED INPUT IS DEFINED, NOT ACCIDENTAL. Duplicate [Foil], two set annotations, and an
// over-long token are FLAGGED (surfaced in review), never silently dropped or clamped. Empty
// brackets [] and an unmatched [ are left as part of the free-text name, which then resolves or
// reports as unknown - never a crash. Unknown future annotations are by construction set tokens
// that match no set, so they surface in review too (forward compatibility, brief §7.3).

/** The finish annotation, case-insensitive on parse, canonical case on format. */
export const FOIL_TOKEN = 'Foil';
/** An annotation token longer than this is flagged rather than treated as a real set name. */
export const MAX_ANNOTATION_LEN = 64;

// A single well-formed, NON-EMPTY bracket token at the very end of the string. An empty `[]` and
// an unmatched `[` do not match, so they stay in the name by construction.
const TRAILING_ANNOTATION = /\s*\[([^[\]]*)\]\s*$/;
// A list bullet is a `-`/`*` FOLLOWED BY WHITESPACE, so `-1` reads as a signed quantity, not a
// bullet plus 1. A bare `-` bullet is stripped before the quantity is read.
const BULLET = /^[-*]\s+(.*)$/;
// A numeric-looking quantity prefix: an optional sign, digits, an optional decimal, an optional
// x/× multiplier, then the name. The sign/decimal are captured so a NEGATIVE, SIGNED, or
// FRACTIONAL quantity is detected and flagged rather than swallowed into the card name.
const QTY_PREFIX = /^([+\-]?\d+(?:\.\d+)?)(?:\s*[x×])?\s+(.+)$/i;
// Header / zone lines the owned import skips, mirroring parseDeckText so deck exports stay
// importable: a `#`/`//` line, or a bare zone word.
const ZONE_WORD = /^(avatar|spellbook|atlas|sideboard|collection)$/i;

/**
 * Peel trailing `[...]` annotations off a NAME string.
 *
 * Returns `{ name, setToken, foil, problems }`:
 *   - name     the name with annotations stripped, trimmed.
 *   - setToken the raw (unmatched) set annotation, or null. At most one; a second is a problem.
 *   - foil     true when a `[Foil]` annotation is present (case-insensitive); a second is a problem.
 *   - problems reason strings: 'duplicate finish', 'two sets named', 'annotation too long'.
 *
 * Annotations may appear in either order; peeling from the end handles both. An empty `[]` or an
 * unmatched `[` stops the peel and is left in the name.
 */
export function parseAnnotations(rawName) {
  let rest = String(rawName == null ? '' : rawName);
  let setToken = null;
  let foil = false;
  const problems = [];

  // Peel from the END so `[Beta] [Foil]` and `[Foil] [Beta]` both resolve identically.
  for (;;) {
    const m = rest.match(TRAILING_ANNOTATION);
    if (!m) break;
    const token = m[1].trim();
    if (!token) break;   // empty brackets are part of the name, not an annotation
    rest = rest.slice(0, m.index);
    if (/^foil$/i.test(token)) {
      if (foil) problems.push('duplicate finish');
      foil = true;
    } else if (token.length > MAX_ANNOTATION_LEN) {
      problems.push('annotation too long');   // cannot be a real set name; flagged, not matched
    } else if (setToken !== null) {
      problems.push('two sets named');
    } else {
      setToken = token;
    }
  }

  return { name: rest.trim(), setToken, foil, problems };
}

/**
 * Parse a full grammar line: `qty name [annotation]*`.
 *
 * A missing leading quantity defaults to 1 (a bare name line). A numeric-looking prefix that is
 * NOT a clean positive integer 1..999 - negative, signed, fractional, zero, or over 999 - is
 * FLAGGED ('quantity out of range') and returned as parsed, never silently clamped and never
 * swallowed into the card name, so the resolver shows the user exactly what they typed.
 *
 * @returns { qty, name, setToken, foil, problems }
 */
export function parseItemLine(rawLine) {
  const line = String(rawLine == null ? '' : rawLine).trim();
  const problems = [];
  let qty = 1;
  let body = line;

  const bullet = line.match(BULLET);
  const afterBullet = bullet ? bullet[1] : line;
  const m = afterBullet.match(QTY_PREFIX);
  if (m) {
    const numStr = m[1];
    body = m[2];
    if (/^\d+$/.test(numStr)) {
      qty = parseInt(numStr, 10);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 999) problems.push('quantity out of range');
    } else {
      // A signed or fractional prefix (-1, +2, 1.5): a quantity the user clearly intended, but not
      // a valid one. Flag it; do not treat the whole line as a bare card name.
      qty = Number(numStr);
      problems.push('quantity out of range');
    }
  } else {
    body = afterBullet;   // no numeric prefix at all: a bare name line, quantity 1
  }

  const ann = parseAnnotations(body);
  return { qty, name: ann.name, setToken: ann.setToken, foil: ann.foil, problems: [...problems, ...ann.problems] };
}

/** True for a header / zone line the owned import skips (mirrors parseDeckText's own rules). */
export function isKnownHeader(rawLine) {
  const line = String(rawLine == null ? '' : rawLine).trim();
  if (!line) return false;
  if (/^(#|\/\/)/.test(line)) return true;                     // markdown / comment header
  const hdr = line.replace(/^#+\s*/, '').replace(/^\/\/\s*/, '');
  return ZONE_WORD.test(hdr);                                   // a bare zone word
}

/**
 * The PRODUCTION entry point: parse pasted text into per-line grammar results.
 *
 * Every card line runs through `parseItemLine` (not parseDeckText), so the grammar's flags reach
 * the caller instead of being discarded. Blank lines and headers are skipped; deck exports stay
 * importable because the same headers parseDeckText knew are skipped here. Each returned line
 * carries its `lineNumber`, `raw` text, and `problems`.
 *
 * @returns Array<{ lineNumber, raw, qty, name, setToken, foil, problems }>
 */
export function parseItemText(text) {
  const out = [];
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || isKnownHeader(trimmed)) continue;
    out.push({ lineNumber: i + 1, raw, ...parseItemLine(raw) });
  }
  return out;
}

/**
 * Format one collector item as a grammar line. `set` is the DISPLAY set label ('Beta'), or falsy
 * for a bare line (an uncategorised want, which claims no printing). Export always emits set
 * first, then finish, so a re-import parses back to the same `(name, set, foil, qty)`.
 */
export function formatItemLine({ qty, name, set, foil }) {
  let out = `${qty} ${name}`;
  if (set) out += ` [${set}]`;
  if (foil) out += ` [${FOIL_TOKEN}]`;
  return out;
}
