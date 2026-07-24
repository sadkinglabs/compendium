# Codex review brief - Collection ALL view + alphabet rail + Add-to-list

**Branch:** `collection-all-and-alphabar` (off `main`)
**Diff:** `docs/proposals/collection-phase2-codex-review.diff` (`git diff main...HEAD`, 30 files, +2543/-439)
**Build on device:** 195 (owner device-iterated 186→195 on a Pixel; a second device is testing the art CDN)
**Purpose:** pre-alpha review. This is the increment we want to ship to alpha testers this week.

## Gate status (repo, all green)
`test:query` 820 · `test:ui` 173 · `test:app` 17 · `check:types` · `check:cycles` (147 modules, no cycles) ·
`check:source` · `check:docs` · `build`. **`check:smoke` is pending a connected device** (will run before merge).

## What is ALREADY approved (context, light-touch)
- **Phase 1 - the ALL view** (`collection-all-view-proposal.md`): you approved it + two corrective rounds
  (identity selection, synchronous prefix reset, set-drill hidden disclosure, tested pure helpers). Commits
  `98d57f1`, `efbd5bf`, `4fabc44`. Re-review only if the later work disturbed it.
- **The rail PROPOSAL** (`collection-alphabet-rail-proposal.md` rev 3): you approved the contract. **But the
  implementation then PIVOTED** on owner device feedback - see below.

## What NEEDS review (new since your last pass)

### 1. NEW WRITE PATH - `addEntriesToList` (the priority) - `src/store/ownedImportRepository.js`
"Add to list" adds a bulk selection to an EXISTING list. Invariant §3.5 (transactional user-data). It mirrors
the approved `createListWithEntries`: strict input validation + the `MAX_BATCH_ITEMS` (2000) ceiling on the RAW
array, an authoritative catalog-membership check AND a profile-ownership check INSIDE the barrier (foreign/stale
list rejected, nothing written), existing entries skipped so no duplicate row (idempotent), and the same
`prewrite/none` vs `transaction/unknown` write-outcome contract. Returns `{ added, skipped }`.
- Tests: `ownedImportRepository.test.mjs` (+8) - dedup-existing, foreign-profile reject, unknown-id reject, raw
  ceiling, all-present no-op, malformed input, apply-then-reject (indeterminate), production barrier blocking.
- Consumed by `useCollectionBulkActions.addToListFromSelection` (card-grain dedup + 2000 guard + honest copy)
  and the `AddToListSheet` picker in `Collection.jsx`.
- **Please attack:** the profile-scope check, the dedup-vs-existing read, the raw-vs-deduped ceiling ordering,
  and the notify()/write-state classification on the apply-then-reject path.

### 2. The alphabet rail - IMPLEMENTATION PIVOT from the reviewed proposal
The proposal described a Niagara bulge/wave with live jump-on-crossing. On device that was janky (overlap +
render contention) and the active letter sat under the thumb. **Owner-directed pivot to: latch + floating pill.**
- **Latch:** during a drag we do ZERO grid work (no jump/scroll/re-render); only a floating letter pill moves.
  The single grow+scroll fires once on RELEASE. `pointercancel` aborts with no jump.
- Pure, tested: `alphabetIndex.js` (`letterOf`/`railModel` with `indexable` fail-closed + deterministic
  `modelKey`/`activeLetterFor`), `railGeometry.js` (`railBounds`/`railTopOffset`/`effectiveZoom`/`indexAtY`),
  `alphabetRailState.js` (the jump-coordinator reducer). ~40 unit tests.
- `AlphabetRail.jsx` is the DOM shell (device-gated, not unit-tested). **Please attack the teardown/leak
  surface:** window-level pointer listeners keyed to pointerId, one `teardownRef`, dispose on unmount, two
  rAF-throttled scroll listeners (active-letter + bounds re-measure) - confirm nothing leaks across
  mount/unmount/root-change, and that the four rev-3 contracts still hold in code (deterministic `modelKey`
  cancellation, last-anchor active letter, tap exactly-once, single-boundary geometry with no safe-area
  double-count). The `bulge` helper was removed (dead after the pivot).
- **Zoom caveat worth a look:** the rail lives inside `.cx-app { zoom: var(--ui-scale) }`; every measured inset
  and `scrollTop` delta is divided once by a measured `effectiveZoom`. Verify that's correct and complete.

### 3. Shared sticky sub-header - `src/components/CollectionSubHeader.jsx`
One component now renders BOTH My-Collection headers (Sets landing + ALL grid) so they're identical in size and
colour (pixel-diff drift + a warm band clashing with the fixed `#000`+ruby wash drove this). Neutral frosted
band; single-line (nowrap) so a wider pill / long count can't reflow it; `data-rail-sticky` is the rail's top
floor. Set-drill header switched to the same band value. Low risk; flag any a11y/contrast concern.

### 4. Consolidations (should be behaviour-preserving)
- `bulkSelection.js` deleted → folded into `collectionSelection.js` (`selectionSummary` unifies count/allSelected/
  hidden across both surfaces).
- Set drill refactored onto the shared `arrangeSections` (one canonical arranged object drives grid + rail
  anchors + indexes) and the shared refine/selection/bulk hooks.

## Docs updated
FEATURE_MATRIX (Sets|All row, bulk-selection row incl. Add-to-list + `addEntriesToList`), ARCHITECTURE §7.4,
DESIGN_SYSTEM (rail primitive + header). Both proposals carry their full approval records + the rail's
device-pivot note.

## Disposition asked
Go / changes-required for an alpha release from `main`. The write path (§1) is the one I'd most want a second
set of eyes on before it touches testers' data; the rail (§2) is device-verified but its shell is not unit-tested.
