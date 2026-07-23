# Codex review request - Collection FAB/overflow pass + bulk edit (durable writes)

**Branch:** `collection-menu-consistency` (off `main`). **Range:** `git diff main..HEAD`.
Device: built + owner-exercised on a Pixel 9 Pro XL. **The highest-risk surface is the new
durable bulk-owned-SET command - please attack it first.**

## Corrective increment - all six findings addressed (please re-check)

Following the "Changes required" disposition (4 Majors + 2 Minors), this commit lands the fixes.
None changed the write contract; they hardened the planner, added an atomic list-create command, and
made the failure/toast/a11y surfaces honest.

- **Major 1 - indeterminate writes are no longer reported as definite.** New pure helper
  `src/store/bulkWriteOutcome.js` (`bulkWriteFailure`): a `BulkWriteError` with
  `writeState==='unknown'` (web tx applied THEN persistence rejected) yields `indeterminate:true`, a
  warn tone, "check the refreshed counts" copy, and `keepSelection:false` (an indeterminate write must
  not read as a retry invitation); any definite/non-bulk failure keeps the selection for a safe retry.
  Wired into both `bulkEditCopies` and `createListFromSelection` catch paths. Unit-tested incl. a
  property that ONLY `unknown` is ever indeterminate (`bulkWriteOutcome.test.mjs`).
- **Major 2 - list-from-selection is now one atomic write.** New factory command
  `createListWithEntries` (`ownedImportRepository.js`): list row + entries in a single `tx()` under
  the exclusive barrier, ONE broadcast, card-ids deduped, pid captured at the gesture, full
  write-outcome contract. Replaces the old `createList` + per-card `setListEntry` loop (N broadcasts,
  no atomicity). `ListNameSheet` now awaits submission and locks the button while busy, so a
  double-tap can't create two lists.
- **Major 3 - `planOwnedSetBatch` validates before it folds.** Two passes: pass 1 validates EVERY
  item (foil boolean, set string, qty bounds, positive-set catalog printing) and folds into a target
  map, throwing on a conflicting duplicate qty for one `(card,slug)` and coalescing identical ones;
  pass 2 emits statements and OMITS no-ops (reads `qty_owned`). Result carries
  `{set, removed, cleared, unchanged, cards}`.
- **Major 4 - selection a11y + touch targets.** `BinderTile` in select mode is a real
  `role="button"` with `aria-pressed`, a "Select/Deselect {name}" label, and Enter/Space keyboard
  toggle (QuickAdd stays un-nested, only rendered out of select mode). `SelectionBar` cancel is 44x44
  and both actions are `minHeight:44`.
- **Minor 1 - toasts read from the repository result**, not the selection count: "No change - N
  already at X" when nothing moved, real changed-count otherwise.
- **Minor 2 - docs reconciled.** `DESIGN_SYSTEM.md` §4 Header-overflow now states the
  manage-only-overflow / `+`-FAB-for-all-adding boundary and drops set-level Export Missing;
  `COMPENDIUM_FEATURE_MATRIX.md` gains a "Bulk selection (scoped)" row.

Gates after the corrective: `test:query` 735, `test:ui` 162, `test:app` 17, `test:codex` 10,
store suites 55 (`ownedImportRepository` + `bulkWriteOutcome`), `check:types`, `check:cycles` (134),
`check:source`, `check:docs`, `build` - all green. Device re-exercise + build/install pending owner.

## What's here, riskiest first

### 1. Durable: `setOwnedItemsBulk` + `planOwnedSetBatch` (`src/store/ownedImportRepository.js`)
A new **barrier-guarded** command that SETS `qty_owned` absolutely for a batch of collector items -
the engine behind bulk edit and bulk delete. Built to the branch's standing contracts, mirroring
`importCollectionResolved`:
- **One transaction, ONE broadcast.** `bump()` is synchronous per write (the file comment says the
  bulk command "fires exactly ONE broadcast rather than one per row"), so a per-row loop would fire
  ~100 grid refreshes. The command reads current rows + catalog, plans, runs a single `tx()`, and
  `notify()`s once.
- **Positive set validates the printing** against the catalog (`setCodesOf` + `printingFinishes`,
  strict) - a foil on a standard-only set is rejected. **Zero is exempt**, exactly as the want
  writers treat zero: a historical or malformed row must always be clearable.
- **Set-to-0 preserves a want.** An owned-only row is DELETEd; a row that also carries `qty_wanted>0`
  is UPDATEd to `qty_owned=0` so a bulk owned cleanup never wipes a wishlist goal (owner ruling).
- `planOwnedSetBatch` is a PURE planner (statements + summary), separately tested.
- **11 new tests** (`ownedImportRepository.test.mjs`): set/insert, delete-vs-keep-want, zero no-op,
  positive-set catalog validation + zero exemption, boolean/qty bounds, and an end-to-end proving the
  single broadcast + want preservation against the real sql.js DB.

**Where to attack:** the barrier (does it fail closed if in-flight writes don't drain? it reuses
`withExclusiveCollectionWrites` via the same factory as the audited add command); the pid capture
(the caller passes none → `activeProfileId()` at the gesture - can a mid-flight profile switch
misroute?); the delete-vs-keep-want branch (a row with a want AND owned set to 0); dedup of a
repeated `(card_id, slug)`; the `noop` path and the `ranTransaction` classification on a failed tx;
whether a positive set can ever create a phantom owned row the catalog can't describe.

### 2. UI bulk-select flow (`src/pillars/Collection.jsx`, `CollectionCardViews.jsx`)
Selection mode on the set grid: overflow "Select all" over the *scoped* grid, tap-to-toggle tiles
(`BinderTile` gains `selectMode/checked/onToggle`, defaults off), the docked search bar becomes a
selection action bar (portals to the same `#cx-dock-search` slot), and two actions - **Edit copies**
(the modal: Add/Set × Standard/Foil × stepper) and **New list** (name + Wanted/Card type,
pre-loaded). Selection captures `{card,set}` at selection time, so the actions don't depend on the
live filter. Cards lacking the chosen finish are skipped + reported (the finish is per printing -
`defaultFinish`/`printingFinishes` - which is what a flat `foil:false` got wrong for foil-only
Winter River, the bug that surfaced this).

**Where to attack:** the finish-eligibility filter (is any impossible pair ever sent to the writer?);
`createListFromSelection` dedups to card-grain (`setListEntry` per distinct card) - correct? hardware
Back exits selection before the drill; the action bar swapping in/out of the dock slot cleanly.

### 3. FAB / overflow reorganisation (UI-only)
`OverflowMenu` restyled to the FAB-menu chassis + a shared `MenuGlyph` set (fixes ad-hoc glyph
sizing). Every ADD/import moved onto a single `+` FAB menu per surface; the overflow is manage-only
(edit/delete). Set-level "Export missing" dropped - export lives on Lists (the bulk flow replaces the
buy-list path: scope Missing → Select all → New list → export the list).

## Invariants (constitution §3)
- **Transactional user-data operations / durable offline-first writes.** `setOwnedItemsBulk` is one
  `tx()` under the exclusive barrier with a single post-commit broadcast; it never claims
  nothing-written and never auto-retries (the bulk-write-outcome contract).
- **Profile isolation.** `pid` captured at the gesture and passed into the write, not re-read.
- **Forward-only schema.** No schema/table/column change - absolute set is different string *values*
  in existing columns.
- **Content-is-data / no phantom items.** A positive set validates the printing; owned may be
  uncategorised (a want may not) - unchanged.
- **Catalog/profile boundary, zero-image, cross-runtime:** untouched (UI + profile-owned writes).

## Gates
`test:query` 720, `test:ui` 162, `test:app` 17, `test:codex` 10, `check:types`, `check:cycles` (133),
`check:source`, `check:docs`, `build` - all green. `check:smoke` remains the pre-merge device gate.

## Device (owner-exercised, Pixel 9 Pro XL, build 169)
Scope a set → Select all → Add copies (Standard + Foil, foil-only cards skipped + reported); Set →
exact count; Set → 0 removes, and a wishlisted card keeps its want; New list from selection then
export from Lists. The foil-only batch (Winter River in Alpha) that first failed a flat non-foil add
now validates.
