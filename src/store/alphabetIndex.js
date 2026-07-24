// Pure model for the Collection A-Z alphabet rail (Phase 2). DOM-free so the load-bearing decisions -
// which letter a name buckets to, whether the rendered order is safely indexable, where each letter
// first appears, and a stable key for jump cancellation - are unit tests, not device round-trips.
//
// The rail is navigation for an ALPHABETICAL list. It only shows when the grid's order is globally A-Z
// by name AND the ASCII letter buckets agree with that order (see `indexable`); otherwise the caller
// ducks it. We never scroll to a guessed index - we hide instead.

/** The fixed rail sequence. Constant length so the wave never reflows as filters change. */
export const RAIL_ORDER = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const RANK = new Map(RAIL_ORDER.map((l, i) => [l, i]));

/**
 * The rail bucket for a card name: '#' or 'A'..'Z'. Trim, NFD-fold diacritics to their base letter
 * (so 'Älvalinne' -> 'A'), uppercase the first scalar; a leading non-A-Z character (digit, quote,
 * symbol, ligature that doesn't decompose, empty) buckets to '#'. '#' is rank 0 - digit/symbol-leading
 * names sort before the letters under the grid's locale collation, so this keeps buckets monotonic.
 */
export function letterOf(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return '#';
  const first = s.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0);
  const u = first.toUpperCase();
  return u >= 'A' && u <= 'Z' ? u : '#';
}

/**
 * Build the rail model from the rows in EXACT render order (the caller's canonical arranged.flat).
 *   - `present`: the letters that actually occur.
 *   - `firstIndex`: letter -> first flat index (its jump target; used only when indexable).
 *   - `indexable`: false the moment the per-row bucket RANK goes backwards, i.e. the locale name-sort
 *     and the ASCII buckets disagree (e.g. a ligature collating among 'A' but bucketing to '#').
 *     Fail-closed: when false the caller ducks rather than jumping to a false index.
 *   - `modelKey`: a DETERMINISTIC key over the ordered stable ids (`card_id|set`), NOT object identity.
 *     An equivalent re-allocation yields the same key (so it won't cancel a live jump); any membership
 *     or order change yields a different key (so it will). FNV-1a rolling hash + length.
 */
export function railModel(rows, cardOf = (r) => r.card, keyOf = (r) => `${cardOf(r)?.card_id}|${r?.set}`) {
  const present = new Set();
  const firstIndex = new Map();
  let prevRank = -1;
  let indexable = true;
  let hash = 0x811c9dc5;                    // FNV-1a 32-bit offset basis
  const mix = (code) => { hash ^= code; hash = Math.imul(hash, 0x01000193); };
  for (let i = 0; i < rows.length; i += 1) {
    const letter = letterOf(cardOf(rows[i])?.name);
    const rank = RANK.get(letter);
    if (rank < prevRank) indexable = false;   // order vs bucket disagreement -> not safe to index
    if (rank > prevRank) prevRank = rank;
    if (!present.has(letter)) { present.add(letter); firstIndex.set(letter, i); }
    const key = keyOf(rows[i]) || '';
    for (let k = 0; k < key.length; k += 1) mix(key.charCodeAt(k));
    mix(0x7c);                                // '|' record separator: [ab,c] must not equal [a,bc]
  }
  const modelKey = `${(hash >>> 0).toString(36)}:${rows.length}`;
  return { order: RAIL_ORDER, present, firstIndex, indexable, modelKey };
}

/** The first present letter in rail order (Home target / top-of-list active fallback), or null. */
export function firstPresent(present) {
  for (const l of RAIL_ORDER) if (present.has(l)) return l;
  return null;
}

/** The last present letter in rail order (End target), or null. */
export function lastPresent(present) {
  for (let i = RAIL_ORDER.length - 1; i >= 0; i -= 1) if (present.has(RAIL_ORDER[i])) return RAIL_ORDER[i];
  return null;
}

/**
 * Keyboard neighbour: the next PRESENT letter after `letter` in `dir` (+1 / -1), skipping absent
 * (inert) slots. Returns `letter` itself if there is no present letter that way (edge). Absent letters
 * are never navigable and never a jump - this only ever lands on present ones.
 */
export function stepLetter(present, letter, dir) {
  let i = RANK.get(letter);
  if (i == null) return firstPresent(present);
  for (i += dir; i >= 0 && i < RAIL_ORDER.length; i += dir) {
    if (present.has(RAIL_ORDER[i])) return RAIL_ORDER[i];
  }
  return letter;                              // already at the present edge
}

/**
 * Active letter for a scroll position: the LAST anchor to have crossed the header boundary - the
 * greatest anchor whose top <= threshold - with the first present letter as the top-of-list fallback
 * (before any anchor has crossed). Never "the first below the header" (that highlights B mid-A).
 * `anchors` is [{ letter, top }] in rail order; `top` is relative to the same origin as `threshold`.
 */
export function activeLetterFor(anchors, threshold, present) {
  let active = null;
  for (const a of anchors) {
    if (a.top <= threshold) active = a.letter;   // crossed; keep the LAST such
    else break;                                   // anchors are ordered, so the rest are below
  }
  return active || firstPresent(present);
}
