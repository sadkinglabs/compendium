// Pure helpers for the Collection grid surfaces (set drill + ALL), so the load-bearing decisions -
// scope->pool args, groups->rows, the render signature, the progressive ARRANGEMENT, and the scroll
// root - are unit-tested rather than buried in a hook. DOM-free (resolveScrollRoot only calls a
// passed node's `.closest`).
import { groupCards } from './collectionGrouping.js';

/** getPool arguments for a scope. Set scope pins to the printed set NAME; ALL passes no set filter. */
export function poolArgs(scope, { q, els, types, rarities, multi, artist }) {
  return { q, els, types, rarities, sets: scope.kind === 'set' ? [scope.name] : undefined, multi, artist };
}

/** Rows for a scope from the grouped result: a set drill renders its one set's group; ALL flattens
 *  every set's group (including the recovered Uncategorised pile) into one list. */
export function rowsForScope(groups, scope) {
  if (scope.kind === 'set') return groups.find((g) => g.code === scope.code)?.rows || [];
  return groups.flatMap((g) => g.rows);
}

/**
 * The tiles that should wear the filed mark, as a Set of "cardId|set" keys, from `filedBySet`'s map.
 *
 * BOTH finishes count and the amount does not: the mark says "some of these are in a place", so a
 * card with one foil in a binder is filed exactly as much as one with four standards in a box. An
 * entry that sums to zero is NOT filed - `filedBySet` groups over allocations, and an allocation can
 * legitimately sit at zero after its copies move out.
 */
export function filedKeysOf(filed) {
  const keys = new Set();
  for (const [key, v] of (filed || new Map())) {
    if (((v?.owned || 0) + (v?.foil || 0)) > 0) keys.add(key);
  }
  return keys;
}

/**
 * Stamp `filed` onto the rows the key set names, so a tile re-renders on the ownership broadcast
 * rather than reading a ref nothing subscribes to.
 *
 * Rows are COPIED rather than mutated because they are memoised derived objects shared with the
 * arrangement and the A-Z rail; mutating one in place would change a value those have already read.
 * An unfiled row is returned UNCHANGED (same reference) so the common case costs no allocation and
 * BinderTile's memo compare still short-circuits on it.
 */
export function withFiled(rows, filedKeys) {
  if (!filedKeys || filedKeys.size === 0) return rows;
  return rows.map((r) => (filedKeys.has(`${r.card?.card_id}|${r.set}`) ? { ...r, filed: true } : r));
}

/** A STRUCTURED render signature (JSON, so field order/escaping can't collide). It captures ONLY the
 *  things that reshape the result - scope + filters + sort + group - never the derived row objects,
 *  so a quick-add / ledger broadcast (fresh rows, same signature) must not reset progressive render. */
export function renderSignature(scope, { q, states, finishes, playset, ownedCmp, types, rarities, els, multi, artist, sort, groupBy }) {
  const kind = typeof scope === 'string' ? scope : scope.kind;
  const code = typeof scope === 'string' ? null : (scope.code ?? null);
  return JSON.stringify({
    scope: kind, set: code, q: q || '',
    states, finishes, playset, qty: [ownedCmp?.op ?? '>=', ownedCmp?.val ?? null],
    types, rarities, els, multi: !!multi, artist: artist || '', sort, groupBy: groupBy || 'none',
  });
}

/**
 * Arrange the COMPLETE result into final sections FIRST, then flatten to a single stable order. The
 * progressive prefix is applied to this flattened order (see visibleSections) - so growing the count
 * only ever APPENDS: a later batch's Air row can never be inserted into an earlier Air section above
 * already-rendered content. Returns { sections, flat } where flat is [{ row, si }].
 */
export function arrangeSections(rows, groupBy, cardOf, comparator) {
  const sections = groupCards(rows, groupBy, cardOf, comparator);
  const flat = [];
  for (let si = 0; si < sections.length; si += 1) for (const row of sections[si].cards) flat.push({ row, si });
  return { sections, flat };
}

/**
 * The first `count` items of the flattened arranged order, reconstructed into visible sections in
 * order. Each visible section reports its FULL count (from the complete arrangement), not the count
 * currently shown, so a header never changes as more loads. The rendered key sequence for a larger
 * count is always an exact prefix of the smaller one (the progressive invariant Phase 2 relies on).
 */
export function visibleSections(arranged, count) {
  const { sections, flat } = arranged;
  const n = Math.max(0, Math.min(count, flat.length));
  const out = [];
  let cur = null;
  for (let i = 0; i < n; i += 1) {
    const { row, si } = flat[i];
    if (!cur || cur.si !== si) { cur = { si, key: sections[si].key, label: sections[si].label, fullCount: sections[si].cards.length, cards: [] }; out.push(cur); }
    cur.cards.push(row);
  }
  return out;
}

/**
 * The rendered prefix length, derived SYNCHRONOUSLY from committed progress `{ signature, count }`.
 * When the signature has moved (sort/filter/group changed), the FIRST render already yields `initial`
 * - React never reconciles the stale large prefix on the way down to the reset. Only when the stored
 * signature still matches do we honour the grown count. Always clamped to [0, total].
 */
export function effectiveCount(progress, signature, initial, total) {
  const raw = progress.signature === signature ? progress.count : initial;
  return Math.max(0, Math.min(raw, total));
}

/** The vertical scroll ancestor for a node. MUST be resolved from the node (closest), never a global
 *  document.querySelector - the first `.cx-scroll` in the document is Collection's HORIZONTAL header
 *  scroller, which is not an ancestor of the grid, so an IntersectionObserver rooted there never fires. */
export function resolveScrollRoot(node) {
  return node && typeof node.closest === 'function' ? node.closest('.cx-scroll') : null;
}
