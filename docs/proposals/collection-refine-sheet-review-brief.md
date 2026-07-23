# Codex review request - Collection-specific Refine sheet (Filters + Sort)

**Branch:** `collection-refine-sheet` (off `main`, and main has since been merged IN, so the review
range is clean). **Range:** `git diff main..HEAD` - this isolates ONLY the refine-sheet work
(~493+/181-, 15 files); the wishlist changes already on main are excluded. Device: built +
owner-exercised on a Pixel 9 Pro XL (build 179).

## Why this exists
Browsing a collection asks different questions than building a deck, so Collection gets its OWN
2-page Refine sheet instead of reusing the deckbuilder's. The deck sheet's threshold/mana/power
comparators are gone; the ownership-derived axes only a collection has are added, plus a Sort page.

## What's here, riskiest first

### 1. The pure ownership-derived filter/sort engine (`src/store/collectionFilter.js` + test)
The load-bearing new logic, kept pure and node-tested. `getPool` (the catalog query) CANNOT answer
these because they depend on what the profile owns, so they run in the collection layer.
- **`effOwned(row, finishes)`** - the single effective owned count under a FINISH scope. `finishes`
  is a subset of `['standard','foil']`; empty = both. Every ownership-derived axis evaluates this one
  number, so selecting Finish reframes Owned/Missing, Playset and the Owned-amount comparator at once.
- **`matchesPlayset(row, playset, finishes)`** - Completed (>=rarity limit, matching the collected
  seal), Missing copies (0<t<limit), More than a playset (>limit); uncapped cards (unlimited / no
  rarity) never match a playset filter.
- **`rowMatchesOwn(row, isWish, own)`** - the combined predicate. `own = {states, playset, qty,
  finishes}`. Any-of WITHIN a group (states, playset), AND ACROSS groups; qty is the `=/<=/>=`
  comparator on the effective count; wishlist is judged on the card.
- **`rowComparator(sortKey, cardOf)`** - within-group order: name asc/desc, Recently added (newest
  first, blanks last), Rarity (Ordinary->Unique, avatars last), each tie-broken by name. Default
  (name-asc) reproduces the historical A-Z, so an unset sort changes nothing.
- **`ownActive(own)`** gates whether the predicate is applied at all.

**Where to attack:** the finish-scope semantics (does Finish=Foil + Missing really mean "no foil
copy"?); the playset partition + the uncapped-card exclusion; the any-of-within / and-across
combination; the comparator's total order + the "blanks last" / "avatars last" tails; whether an
empty `own` ever hides a row.

### 2. `groupCollection` refactor + `ownedBySet` (`collectionGroups.js`, `ownedRepository.js`)
`groupCollection` now takes the `own` predicate object (was `ownScope`/`ownActive`) and applies
`rowMatchesOwn`; it carries `added` onto each row for the sort. The legacy `viewMode` lens is gone
(only tests used it). `ownedBySet` gained `added` = the EARLIEST `created_at` across a printing's
rows (a true first-added time, since created_at is set on insert and never moved by a quantity edit)
- an additive field, existing consumers read `.owned`/`.foil`. `groupCards` gained an optional
within-section comparator (defaults to name-A-Z).

**Where to attack:** the ownership semantics CHANGE - "Owned" now means own ANY copy (was non-foil
'regular'); a foil-only card is now Owned, and the old "Foil only" chip is gone (Finish replaces it).
Is the Uncategorised recovery still judged by the same predicate? Does the additive `added` break any
`ownedBySet` consumer (SetsHome, setCompletion)?

### 3. `playset.js` leaf + re-exports (`deckRepository.js`, `CollectionCardViews.jsx`)
Extracted ONE playset definition (`RARITY_LIMITS`, `isUnlimited`, `playsetOf`) to a leaf so the UI
and the pure filter share it without a cycle. `deckRepository` re-exports `RARITY_LIMITS`/`isUnlimited`
(unchanged public API); `CollectionCardViews`' local `playsetOf` is removed in favour of the import.

**Where to attack:** the re-export keeps every existing importer working; no cycle (`check:cycles`
137 modules).

### 4. UI: `CollectionRefineSheet.jsx` + wiring (`Collection.jsx`, `RefineSheet.jsx`)
A dedicated 2-page sheet (Filters | Sort) reusing the shared primitives - `CmpRow`, `SortRow`,
`PipChip`, `RARITY_DOT` are now exported from `RefineSheet.jsx` rather than duplicated. Collection's
Cards drill drops the deck comparators (thByEl/totalTh/costCmp/powerCmp) and the "Foil only" chip;
adds the ownership/finish/playset/qty state + the sort; passes `own` to `groupCollection` and the sort
comparator to `groupCards`. Type chips INCLUDE Avatars (the deck sheet omits them); `getPool` already
matches `c.type` exactly, so Avatar filtering works.

**BEHAVIOUR CHANGE flagged to owner (awaiting ruling):** the old "Group by element/rarity"
arrangement was DROPPED, replaced by the Sort page (Rarity sort covers ordering-by-rarity). Easy to
restore as a third arrangement if wanted.

## Invariants (constitution §3)
- **Catalog/profile boundary.** Catalog axes (element/type/rarity/artist/search) still run through
  `getPool`; the ownership-derived axes + sort run in the profile-owned collection layer. No catalog
  row acquires profile state; no ownership leaks into the catalog query.
- **Profile isolation.** `ownedBySet`/`wishlistCards` are `activeProfileId()`-scoped as before.
- **Forward-only schema.** NO schema change - `created_at` already existed; the sort reads it.
- **Graceful zero-image.** The sheet is chips/selects/comparators; no art dependency.

## Gates
`test:query` 772, `test:ui` 162, `test:app` 17, `test:codex` 10, `check:types`, `check:cycles` (137),
`check:source`, `check:docs`, `build` - all green. `check:smoke` remains the pre-merge device gate
(the Pixel auto-locks mid-run, so it has been owner-manually verified instead).

## Device (owner-exercised, Pixel 9 Pro XL, build 179)
Finish=Foil + Owned (foils owned); Playset=Missing copies; Owned Amount >=2; Type shows Avatars;
Sort -> Recently added raises the latest additions. Element/Rarity/Artist unchanged.
