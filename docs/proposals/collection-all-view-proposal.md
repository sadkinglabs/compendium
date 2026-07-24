# Proposal (design review) - Collection "ALL cards" view + progressive rendering

**Branch:** `collection-all-and-alphabar` (off `main`). **Class:** Standard-to-High-risk (new browse
surface + bulk selection reusing the audited atomic write commands; no schema change). **Reviewer:**
Codex. This is **Phase 1 of 2** - the ALL view lands first; the A-Z rail (Phase 2) is outlined at the
end. **Status: Codex disposition "Changes required - narrow revision" now folded in** (rulings below).

## Codex rulings folded into this revision
- Shared refine machinery: **yes**. Prefix rendering in Phase 1: **yes** (no full virtualisation without
  device evidence the bounded prefix fails). Bulk selection deferred: **no** - selection is in Phase 1.
- **Correction A:** progressive rendering resets from a stable **scope/filter/sort/group signature**, NOT
  when refreshed row objects change - so a quick-add or ledger broadcast near the bottom can't snap the
  user back to the first 100.
- **Correction B:** selection is its **own** shared controller/reducer, separate from the refine hook.
  Refine *derives* rows; selection *snapshots* rows. Two narrow controllers, not one oversized hook.

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

### Architecture decision - two shared controllers, not a fork
The stateful wiring the set drill and ALL share is **extracted once** and consumed by both, split into
TWO narrow controllers (Correction B) so neither surface forks and no single hook becomes oversized:

- **`useCollectionRefine({ scope })`** - owns the filter/sort/group state, the derived `own`, and the
  debounced pool loader parameterised by `scope` (`{kind:'set', set}` vs `{kind:'all'}`). It DERIVES the
  ordered rows. Pure-ish state container, unit-testable.
- **`useCollectionSelection()`** - owns selection ONLY: a snapshot `Map` keyed `card_id|set` -> the
  captured `{card, set, owned, foil}`, plus `selectMode`, `toggle`, `selectAll(rows)`, `deselectAll`,
  `clear`. It never reads filter state; the parent hands it the current derived rows for a Select-all.
  Its reducer is pure and unit-testable (the selection contract below is its spec).
- A shared `<CollectionGrid rows renderCount onNearEnd selection ...>` presentational piece (the 2-up
  `content-visibility` grid + section headers + per-tile checked state), used by both surfaces.
- The set drill keeps its **set-specific chrome** (completion ring header, "back to sets", roster/
  `ownedPerSet`) as its own wrapper; ALL gets a lighter header ("All cards" + count) and the SETS/ALL
  toggle. Both wrappers drive the SAME selection controller + action bar.

**Alternative considered & rejected (owner ruling):** a standalone `AllCards` sibling duplicating the
filter/selection wiring - lower regression risk but two copies that drift. Mitigation for touching the
just-merged drill: keep its chrome/behaviour byte-identical where possible, re-run its full gate battery
+ `check:smoke`, and lean on its existing tests.

## Progressive rendering (the "first ~100" ask)
ALL can be ~1000-1500 tiles; the grid is not virtualised. Grouping/sorting the rows is cheap JS; the cost
is **DOM tile nodes**. So ALL renders a **growing prefix**, not the whole list:

- `renderCount` (ref-backed state), initial **100**. Render `rows.slice(0, renderCount)`, then section it
  with `groupCards` and lay out tiles.
- A bottom **sentinel** watched by one `IntersectionObserver` on the `.cx-scroll` root; when it nears the
  viewport, `renderCount += 100` via `requestAnimationFrame` (no per-scroll React churn).
- **`renderCount` resets to 100 only when a stable SIGNATURE changes** (Correction A) - a string of
  `scope + q + filters + sort + groupBy`, NOT the identity of the derived row objects. A quick-add or a
  `subscribeCollection` broadcast re-derives fresh row objects with the same signature, so it must NOT
  snap the user back to the first 100. Only a real query/filter/sort/group change resets the prefix.
- `content-visibility` still applies to the rendered tiles, so even the prefix is cheap to paint.

This keeps first paint bounded and interaction smooth regardless of catalogue size. It is scoped to ALL;
the single-set drill keeps rendering its (smaller) set in full to avoid touching approved behaviour.

## Selection contract (ALL) - the `useCollectionSelection` spec
Bulk selection is a first-class ALL capability (owner ruling), identical in spirit to the set drill:
**Select · per-tile toggle · Select all · Deselect all · Edit copies · New list.**

- **Selection is over the COMPLETE derived rows, not the rendered prefix.** "Select all" selects every
  collector item in the current *filtered* result (all ~N rows), never just the 100 on screen. Progressive
  rendering is DOM presentation only; the selection controller is handed the full `rows` array.
- **Snapshot semantics, keyed `card_id|set`.** Each entry captures `{card, set, owned, foil}` at pick
  time. Changing filters or growing `renderCount` must **not silently add or remove** selected items -
  the snapshot only changes on an explicit user toggle / Select-all / Deselect-all / clear.
- **Counts.** Show the **total selected** count. When filters conceal part of the selection, also show a
  **hidden-selected** count (selected keys not present in the current derived rows), so the user knows an
  action will still touch items they can't currently see.
- **Lifecycle / clearing.** Hardware **Back** exits selection before leaving ALL. Switching **SETS/ALL**,
  **leaving Collection**, or **switching profiles** clears the selection.
- **Writes.** Edit copies / New list use the **existing atomic repository commands** (`adjust/
  setOwnedItemsBulk`, `createListWithEntries`) with the honest write-outcome contract (unknown-write ->
  "couldn't confirm", never a blind retry). **New list continues deduplicating** selected printings to
  card grain (multiple printings of one card -> one entry).
- **The `MAX_BATCH_ITEMS = 2000` payload guard (never a silent cap or split).** Selection itself is
  uncapped. Before an action, compute the ACTUAL payload:
  - *Edit copies:* after finish-eligibility filtering (a printing lacking the chosen finish is dropped).
  - *New list:* after card-grain deduplication (printings collapse to card entries) - checked on the
    deduped count, since several printings become one entry.
  If the payload exceeds 2000, do **not** partially execute or split behind the user's back: keep the
  selection and say e.g. "**2,143 items selected. Refine to 2,000 or fewer to edit copies.**" (Today's
  catalogue is ~1,566 printed collector-item rows, so an ordinary unfiltered ALL fits; uncategorised rows
  can theoretically push the derived result past 2000, which is exactly why the guard is payload-computed,
  not assumed.)

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

## Documentation Impact
- **`COMPENDIUM_FEATURE_MATRIX.md`** - **updated.** My Collection row now names the **Sets | All** toggle,
  the item-grain flat grid, the shared refine engine, and the progressive prefix; the Bulk-selection row
  now states it applies on either surface and spells out full-result Select-all, snapshot semantics, the
  hidden-selected count, Sets/All-switch clearing, and the 2,000 boundary. The per-collector-item
  granularity note (§ below the table) already covers ALL unchanged.
- **`COMPENDIUM_ARCHITECTURE.md`** - **updated.** §7.4 Collection now describes the Sets/All toggle, the
  two shared controllers, and that the progressive prefix is presentation-only (never the selection
  scope). Corrected a stale "gyro parallax" phrase to the shipped finger-tracked tilt.
- **`COMPENDIUM_DATA_MODEL.md`** - **reviewed, no change.** ALL introduces no table, column, repository,
  or schema-version change; it reads the existing `owned_cards` collector-item grain through the same
  `getPool`/`groupCollection` path the set drill uses. Bulk actions reuse the already-documented
  `adjustOwnedItemsBulk`/`setOwnedItemsBulk`/`createListWithEntries` commands.
- **`BUILD.md`** - **reviewed, no change.** No new command, dependency, env var, or build/deploy step; the
  same gate battery + `check:smoke` covers it. Zero-image mode is exercised by the unchanged `BinderTile`.
- **`DESIGN_SYSTEM.md`** - **reviewed, no change.** ALL reuses existing primitives (BinderTile, SegTabs,
  the refine sheet, FAB/dock, SearchPill) and tokens; the Select controls meet the documented ≥44px touch
  floor. No new token, primitive, or platform-render rule is introduced.

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
- **Selection vs progressive render** - the load-bearing hazard, addressed by the contract above:
  selection is over the full derived rows (not the prefix), a stable snapshot, and payload-guarded.

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

## Resolved (Codex/owner rulings)
1. Shared machinery - **yes** (two controllers: `useCollectionRefine` + `useCollectionSelection`);
   touching the merged drill is accepted with gates + `check:smoke` as the net.
2. Progressive prefix (100 + grow) - **yes**; full virtualisation only if device evidence shows the
   bounded prefix fails.
3. Bulk selection in ALL - **in scope**, per the selection contract above (Select/toggle/Select-all/
   Deselect-all/Edit copies/New list; snapshot over full derived rows; payload-guarded at 2000).
