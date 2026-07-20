// The Collection card grouping - pure over its inputs so it is node-testable. (A
// pure test would have caught the "Unspecified" filter bug where the pseudo-set
// reached the catalog pool query and emptied it.)
//
// It groups the pool's printings by set, applies the ownership lens/chips, and
// recovers the set-less '' owned rows into an "Unspecified" group.
//
// CALLER CONTRACT for the "Unspecified" set filter:
//   - `sets` may include the pseudo-value 'Unspecified'. No printed set is ever named
//     that, so here it ONLY gates the '' recovery.
//   - The caller must NOT pass 'Unspecified' to the catalog pool query (getPool filters
//     by printed set name, so it would return an empty pool).
//   - Whenever 'Unspecified' is selected, the caller must provide a pool that is NOT
//     narrowed by set (other filters are fine), so the set-less owned cards - which can
//     belong to any printed set - are present in the pool to be recovered here.
export function groupCollection({
  pool, owBySet, wishSet, sets = [], viewMode = 'owned',
  ownScope = [], ownActive = false, setLabel = {}, setRank = () => 0,
}) {
  const g = new Map();   // code -> { code, name, rows:[{card,set,owned,foil}] }
  const push = (code, name, row) => {
    let x = g.get(code);
    if (!x) { x = { code, name: name || setLabel[code] || code, rows: [] }; g.set(code, x); }
    x.rows.push(row);
  };
  const chip = (isOwned, isWish) => (ownScope.includes('owned') && isOwned)
    || (ownScope.includes('unowned') && !isOwned)
    || (ownScope.includes('wishlist') && isWish);
  const matches = (isOwned, isWish) => {
    if (viewMode === 'owned') return isOwned;
    if (viewMode === 'unowned') return !isOwned;
    return ownActive ? chip(isOwned, isWish) : true;                 // read 'all'
  };
  for (const c of (pool || [])) {
    const isWish = wishSet.has(c.card_id);
    for (const s of (c._sets || [])) {
      if (!s.code) continue;
      // Per-printing set filter (a real set name; 'Unspecified' never matches a printing).
      if (sets.length && !sets.includes(s.name)) continue;
      const oc = owBySet.get(c.card_id + '|' + s.code);
      const owned = oc?.owned || 0, foil = oc?.foil || 0;
      if (!matches(owned + foil > 0, isWish)) continue;
      push(s.code, s.name, { card: c, set: s.code, owned, foil });
    }
  }
  // Set-less ('' / 'foil') owned rows: always owned, so they show wherever owned cards
  // do - under no set filter, OR under the explicit "Unspecified" chip - never under a
  // real-set-only narrowing, and never under the "Not owned" lens.
  const wantLegacy = (sets.length === 0 || sets.includes('Unspecified')) && (
    viewMode === 'unowned' ? false
      : viewMode === 'owned' ? true
        : (ownActive ? (ownScope.includes('owned') || ownScope.includes('wishlist')) : true));   // 'all'
  if (wantLegacy) {
    const byId = new Map((pool || []).map((c) => [c.card_id, c]));
    for (const [k, v] of owBySet) {
      const i = k.lastIndexOf('|');
      if (k.slice(i + 1) !== '') continue;                          // only the '' bucket
      if ((v.owned || 0) + (v.foil || 0) === 0) continue;
      const card = byId.get(k.slice(0, i));
      if (!card) continue;
      if (viewMode === 'all' && ownActive && !(ownScope.includes('owned') || (ownScope.includes('wishlist') && wishSet.has(card.card_id)))) continue;
      push('', 'Unspecified', { card, set: '', owned: v.owned || 0, foil: v.foil || 0 });
    }
  }
  return [...g.values()].sort((a, b) => setRank(a.code) - setRank(b.code));
}

// The set list to pass to the catalog pool query: strip the 'Unspecified' pseudo-set,
// and when it is selected drop set narrowing entirely (other filters still apply) so the
// set-less owned cards are present in the pool for groupCollection to recover.
export function poolSetFilter(sets = []) {
  return sets.includes('Unspecified') ? [] : sets;
}
