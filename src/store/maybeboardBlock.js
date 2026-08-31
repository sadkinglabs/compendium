// Managed Maybeboard block inside a deck's notes: no DOM, no network, no db -
// unit-testable under node --test. SorceryTCG decks carry a Maybeboard that our
// schema has no zone for, so it lives in the free-text notes instead. That makes
// the notes field shared territory, and this module protects the one invariant
// that keeps sharing safe: re-sync owns the delimited block and NOTHING else.
// Text before and after the block is copied through byte-for-byte, so a user's
// own notes can never be reworded, reordered, or lost by a sync.
//
// Two supporting properties fall out of that promise:
//   - Deterministic render (aggregate by exact name, sort by localeCompare) so
//     an unchanged remote Maybeboard produces an unchanged block, and re-sync
//     reports "already in sync" instead of a phantom notes change.
//   - Idempotence: apply(apply(n, e), e) === apply(n, e), for every corpus,
//     including the removal path. Sync runs repeatedly; drift is not an option.
//
// Names are written verbatim from the API - no catalog resolution here, because
// a Maybeboard card may not exist in our catalog at all.

/** First line of the managed block. Recognised by TRIMMED equality, so a stray indent still matches. */
export const MAYBEBOARD_BEGIN = '--- Maybeboard (synced from SorceryTCG) ---';
/** Last line of the managed block. */
export const MAYBEBOARD_END = '--- end Maybeboard ---';

/**
 * @typedef {Object} MaybeboardEntry
 * @property {string} name Card name exactly as the remote sent it.
 * @property {number} qty  Copies; summed across duplicate rows with the same name.
 */

/**
 * Render the managed block body for `entries`, or null when there is nothing to
 * show (nullish/empty list, or every row unusable). Callers treat null as
 * "remove the block", which is why aggregation and rendering share one function:
 * whatever render calls empty is exactly what apply removes.
 * @param {MaybeboardEntry[]|null|undefined} entries
 * @returns {string|null} BEGIN + `${qty}x ${name}` lines + END, '\n'-joined, no trailing newline.
 */
export function renderMaybeboardBlock(entries) {
  const totals = new Map();
  for (const e of entries || []) {
    if (!e) continue;
    const name = typeof e.name === 'string' ? e.name : '';
    if (!name) continue;
    const qty = Math.max(0, e.qty | 0);
    if (!qty) continue;
    totals.set(name, (totals.get(name) || 0) + qty);   // exact-name grain: no trimming, no casefolding
  }
  if (!totals.size) return null;
  const names = [...totals.keys()].sort((a, b) => a.localeCompare(b));
  return [MAYBEBOARD_BEGIN, ...names.map((n) => `${totals.get(n)}x ${n}`), MAYBEBOARD_END].join('\n');
}

/**
 * Locate the managed block in `lines`.
 * A BEGIN with no matching END means a previous write was truncated or a user
 * deleted the closing line: the block is taken to run to the end of the text so
 * the next sync heals it rather than appending a second block forever.
 * @param {string[]} lines
 * @returns {{begin: number, end: number}|null} inclusive line indices
 */
function findBlock(lines) {
  const begin = lines.findIndex((l) => l.trim() === MAYBEBOARD_BEGIN);
  if (begin < 0) return null;
  for (let i = begin + 1; i < lines.length; i++) {
    if (lines[i].trim() === MAYBEBOARD_END) return { begin, end: i };
  }
  return { begin, end: lines.length - 1 };
}

/**
 * Write `entries` into `notes` as the managed block and return the new notes.
 *
 *   - Non-empty entries, block present: the block's line range is replaced in
 *     place; every byte before and after it survives untouched.
 *   - Non-empty entries, no block: appended at the very end, separated from
 *     existing notes by exactly one blank line.
 *   - Empty entries, block present: the block and its delimiters are removed and
 *     the seam is collapsed (a 3+ newline gap becomes one blank line); a result
 *     that is nothing but whitespace becomes ''.
 *   - Empty entries, no block: `notes` is returned byte-identical.
 *
 * @param {string|null|undefined} notes
 * @param {MaybeboardEntry[]|null|undefined} entries
 * @returns {string}
 */
export function applyMaybeboardBlock(notes, entries) {
  const text = String(notes || '');
  const block = renderMaybeboardBlock(entries);
  const lines = text.split('\n');
  const found = findBlock(lines);

  if (block) {
    if (found) return [...lines.slice(0, found.begin), ...block.split('\n'), ...lines.slice(found.end + 1)].join('\n');
    const head = text.replace(/\s+$/, '');
    return head ? `${head}\n\n${block}` : block;
  }

  if (!found) return text;                     // nothing to remove: byte-identical, so re-sync sees no change
  const before = lines.slice(0, found.begin).join('\n');
  const after = lines.slice(found.end + 1).join('\n');
  const beforeCore = before.replace(/\n+$/, '');
  const afterCore = after.replace(/^\n+/, '');
  // Newlines swallowed by the removal: those trailing `before`, the one that
  // ended the BEGIN line, and those leading `after`. Three or more meant a blank
  // line on both sides of the block, which would read as a gap where it stood.
  const seam = (before.length - beforeCore.length) + 1 + (after.length - afterCore.length);
  const gap = beforeCore && afterCore ? '\n'.repeat(Math.min(seam, 2)) : '';
  const out = `${beforeCore}${gap}${afterCore}`.replace(/\s+$/, '');
  return out.trim() ? out : '';
}
