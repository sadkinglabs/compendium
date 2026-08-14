// Pure diff for Curiosa re-sync (docs/proposals/curiosa-resync.md): no DOM, no
// network, no db - unit-testable under node --test. Both sides aggregate by
// (zone, cardId) so duplicate rows on either side collapse before comparison.
// Local placeholder rows (card_id null) are excluded by the caller: they store
// no name, so no later sync can tell them apart, and touching them would
// duplicate them on every run.

const ZONE_ORDER = { spellbook: 0, atlas: 1, collection: 2 };
const key = (zone, cardId) => `${zone}|${cardId}`;
const byZoneThenName = (a, b) =>
  (ZONE_ORDER[a.zone] ?? 9) - (ZONE_ORDER[b.zone] ?? 9) || String(a.name || '').localeCompare(String(b.name || ''));

/** [{zone, cardId, qty, name}] -> Map<zone·cardId, {zone, cardId, name, qty}>, qty summed. */
export function aggregateByZoneCard(entries) {
  const map = new Map();
  for (const e of entries || []) {
    if (!e || !e.cardId || !e.zone) continue;
    const qty = Math.max(0, e.qty | 0);
    if (!qty) continue;
    const k = key(e.zone, e.cardId);
    const cur = map.get(k);
    if (cur) cur.qty += qty;
    else map.set(k, { zone: e.zone, cardId: e.cardId, name: e.name || null, qty });
  }
  return map;
}

/**
 * One-way diff: what must change locally so the deck matches the remote list.
 *   current       - local resolved entries [{zone, cardId, qty, name}]
 *   remoteEntries - remote resolved entries, same shape
 *   currentAvatarId / remoteAvatar ({cardId, name} | null) - avatar comparison;
 *   a null remoteAvatar (absent or unresolved upstream) never changes the local one.
 *   names ({fromName, toName} | null) - deck rename. toName is the EFFECTIVE new
 *   name (the caller resolves profile-unique dedup first, so a "(1)" suffix that
 *   lands back on the current name reads as no change, not a rename every sync);
 *   an empty/null toName never renames.
 * Returns { adds, removes, changes, avatar, name, unchangedCount, isEmpty } with
 * deterministic zone-then-name ordering for display.
 */
export function computeCuriosaDiff(current, remoteEntries, currentAvatarId = null, remoteAvatar = null, names = null) {
  const cur = aggregateByZoneCard(current);
  const rem = aggregateByZoneCard(remoteEntries);
  const adds = [], removes = [], changes = [];
  let unchangedCount = 0;
  for (const [k, r] of rem) {
    const c = cur.get(k);
    if (!c) adds.push({ zone: r.zone, cardId: r.cardId, name: r.name, qty: r.qty });
    else if (c.qty !== r.qty) changes.push({ zone: r.zone, cardId: r.cardId, name: r.name || c.name, from: c.qty, to: r.qty });
    else unchangedCount++;
  }
  for (const [k, c] of cur) {
    if (!rem.has(k)) removes.push({ zone: c.zone, cardId: c.cardId, name: c.name, qty: c.qty });
  }
  adds.sort(byZoneThenName); removes.sort(byZoneThenName); changes.sort(byZoneThenName);
  const avatar = remoteAvatar?.cardId && remoteAvatar.cardId !== (currentAvatarId || null)
    ? { fromId: currentAvatarId || null, toId: remoteAvatar.cardId, toName: remoteAvatar.name || null }
    : null;
  const fromName = String(names?.fromName || '').trim();
  const toName = String(names?.toName || '').trim();
  const name = toName && toName !== fromName ? { from: fromName || null, to: toName } : null;
  const isEmpty = !adds.length && !removes.length && !changes.length && !avatar && !name;
  return { adds, removes, changes, avatar, name, unchangedCount, isEmpty };
}

/**
 * Cards whose total requested copies (summed ACROSS zones, matching the
 * editor's rarity rule) exceed their legal limit. Curiosa permits this; the
 * sync writes it verbatim (owner decision 2026-08-14) - this exists so the
 * diff sheet can SAY so before the user confirms. limitFor(cardId) -> max
 * copies (copyLimit semantics: 99 = effectively uncapped).
 * Returns [{cardId, name, qty, limit}] sorted by name.
 */
export function overLimitEntries(entries, limitFor) {
  const totals = new Map();
  for (const e of entries || []) {
    if (!e || !e.cardId) continue;
    const qty = Math.max(0, e.qty | 0);
    if (!qty) continue;
    const cur = totals.get(e.cardId);
    if (cur) cur.qty += qty; else totals.set(e.cardId, { cardId: e.cardId, name: e.name || null, qty });
  }
  const out = [];
  for (const t of totals.values()) {
    const limit = limitFor(t.cardId);
    if (Number.isFinite(limit) && t.qty > limit) out.push({ ...t, limit });
  }
  return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}
