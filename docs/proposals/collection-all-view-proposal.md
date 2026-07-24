# Proposal (design review) - Collection "ALL cards" view + progressive rendering

**Branch:** `collection-all-and-alphabar` (off `main`). **Class:** Standard (new read/browse surface;
reuses the merged refine engine; no schema change; no new durable writes). **Reviewer:** Codex, before
implementation. This is **Phase 1 of 2** - the ALL view lands first; the Niagara-style A-Z rail
(Phase 2) is outlined at the end but proposed separately once this is approved and built.

## Problem / goal
Users want to see and search the **whole** catalogue at once, not one set at a time, to use the full
refine engine for granularity. Today "My Collection" only lists sets; a card grid exists solely inside
a single-set drill (`Cards` in `Collection.jsx`), pinned to `setDrill`.

## Scope - Phase 1
A **`SETS | ALL` toggle** at the My Collection level (the `view==='cards' && setDrill==null` branch that
renders `SetsHome`).
- **SETS** - unchanged: `SetsHome` (a tile per set).
- **ALL** - one grid of **every collector item across every set** (per-printing grain, owner-decided),
  driven by the same `CollectionRefineSheet` (Ownership · Finish · Playset · Element · Type · Rarity ·
  Owned-amount · Artist), the same Sort/Group (Arrange) page, and the same docked search bar. Tap →
  card sheet; the inline tile stepper adds copies exactly as in a set drill. **All ownership states are
  exact** because ALL reuses the per-printing engine (below).

### Why the engine is reused verbatim
`ownedBySet()` and `wishlistCards()` already return the **whole** collection (not set-scoped), so no new
ownership plumbing is needed. ALL is:

```
pool = getPool({ q, els, types, rarities, multi, artist })      // NO `sets` filter -> all cards
       .filter(c => !isTokenCard(c))
groups = groupCollection({ pool, owBySet, wishSet, sets: [], own })   // per-printing rows, every set
rows   = groups.flatMap(g => g.rows)                            // flatten to one list
render = groupCards(rows, groupBy, r => r.card, rowComparator(sort, r => r.card))
```

This is exactly the set-drill pipeline with `sets:[]` instead of `sets:[drillName]` and a flatten. Every
axis (Finish availability, playset, wishlist-per-item, "Recently updated", avatars-last) behaves
identically because it is the same pure code (`collectionFilter.js` / `collectionGroups.js` /
`collectionGrouping.js`), already Codex-approved.

### Architecture decision - shared machinery, not a fork
The stateful wiring the set drill and ALL share (filter state, `own` memo, pool loader, owBySet/wishSet
refresh, the grid render + `BinderTile`) will be **extracted once** and consumed by both, rather than
duplicated. Proposed shape:

- `useCollectionRefine({ scope })` - a hook owning the filter/sort/group state, the derived `own`, and
  the debounced pool loader parameterised by `scope` (`{kind:'set', set}` vs `{kind:'all'}`). Pure state
  container, unit-testable.
- A shared `<CollectionGrid rows renderCount onNearEnd ...>` presentational piece (the 2-up
  `content-visibility` grid + section headers), used by both surfaces.
- The set drill keeps its **set-specific chrome** (completion ring header, "back to sets", roster/
  `ownedPerSet`, Select pill) as its own wrapper; ALL gets a lighter header ("All cards" + count) and the
  toggle. Selection/bulk stays a set-drill wrapper concern (see Deferred).

**Alternative considered:** a standalone `AllCards` sibling that duplicates the filter-state boilerplate
(leaves the drill untouched, lower regression risk, but two copies of the filter model that will drift).
Recommendation: the shared hook - drift across two collection surfaces is a real correctness hazard, and
the risky *pure* logic is already shared. Mitigation for touching the just-merged drill: re-run its full
gate battery + `check:smoke`, and a diff that preserves the drill's chrome verbatim.

## Progressive rendering (the "first ~100" ask)
ALL can be ~1000-1500 tiles; the grid is not virtualised. Grouping/sorting the rows is cheap JS; the cost
is **DOM tile nodes**. So ALL renders a **growing prefix**, not the whole list:

- `renderCount` (ref-backed state), initial **100**. Render `rows.slice(0, renderCount)`, then section it
  with `groupCards` and lay out tiles.
- A bottom **sentinel** watched by one `IntersectionObserver` on the `.cx-scroll` root; when it nears the
  viewport, `renderCount += 100` via `requestAnimationFrame` (no per-scroll React churn).
- `renderCount` resets to 100 whenever the filtered/sorted result set changes (new query/filter/sort).
- `content-visibility` still applies to the rendered tiles, so even the prefix is cheap to paint.

This keeps first paint bounded and interaction smooth regardless of catalogue size. It is scoped to ALL;
the single-set drill keeps rendering its (smaller) set in full to avoid touching approved behaviour.

### Interaction with Phase 2 (flagged now, handled then)
A prefix-render list means the A-Z rail jumping to "Z" must first ensure Z's section exists in the DOM.
Phase 2 will, on a rail selection past the rendered window, **raise `renderCount` to cover the target
letter's last row, then scroll** (all synchronous, pre-scroll). Because the rail navigates by letter and
the rows are globally name-sorted, the target index is a cheap lookup into the section map. This is why
the rail is Phase 2: it depends on this render model. (Noted so the Phase-1 API - exposing "ensure row N
rendered" - is designed in now, not bolted on.)

## Invariants (constitution §3)
- **Catalog/profile boundary.** Catalog axes run through `getPool`; ownership-derived axes + sort run in
  the pure collection layer. No catalog row gains profile state; no ownership leaks into the pool query.
- **Profile isolation.** `ownedBySet`/`wishlistCards` stay `activeProfileId()`-scoped.
- **Forward-only schema / durable writes.** No schema change; no new write path (ownership edits use the
  existing, tested tile stepper + barrier-guarded writes).
- **Graceful zero-image.** ALL is the same `BinderTile` (deterministic art fallback) - unaffected.

## Risks / self-critique
- **Perf on device** - I will measure ALL first paint + scroll on the Pixel with the full catalogue; if
  the prefix model still janks I will say so, not ship it. The rail (Phase 2) is the real navigation
  answer for a list this long.
- **Touching the merged set drill** - the extraction is the main regression surface. Mitigation: keep the
  drill's chrome/behaviour byte-identical where possible, full gates + `check:smoke`, and lean on the
  drill's existing tests.
- **Progressive render vs "active letter during scroll"** (Phase 2) - the highlighted rail letter must
  track the first visible section without a feedback loop; designed via `IntersectionObserver`, not
  scroll scanning.
- **Deferred (Phase 1):** bulk multi-select *in ALL* - "Select all" over ~1500 items needs its own
  thought; selection stays a per-set action for now. Flag if it should be in ALL.

## Testing plan (Phase 1)
- Pure: `useCollectionRefine` scope→pool-args mapping; the ALL flatten (groups→rows) preserves per-item
  state; `renderCount` slice + reset-on-filter-change logic (extract the reducer as pure).
- Reuse the existing `collectionFilter`/`collectionGroups` suites unchanged (engine unchanged).
- Gates: full battery + `check:smoke` (the drill must still certify); device pass on ALL (search, each
  refine axis, sort/group, progressive scroll, tap→sheet, inline add).

## Phase 2 outline (separate increment, not this review)
A reusable `<AlphabetIndex letters activeLetter onSelectLetter />` on the right edge: pointer-capture +
rAF wave (CardArtViewer pattern), letters from the current result set (`#` + A-Z, accented folded to
base), scroll `.cx-scroll` offsetting the sticky header, duck out when sort ≠ name-asc, keyboard +
reduced-motion fallbacks, side-agnostic (right for now), clearing the bottom-right FAB/dock column. Full
spec already provided by the owner.

## Open questions for the reviewer
1. Shared `useCollectionRefine` hook (recommended) vs standalone `AllCards` sibling - acceptable to touch
   the just-merged set drill for the extraction, with gates + smoke as the safety net?
2. Progressive prefix (100 + grow) vs committing to real virtualisation now - is prefix-render acceptable
   for Phase 1 given the rail arrives in Phase 2?
3. Confirm bulk multi-select in ALL is out of Phase 1 scope.
