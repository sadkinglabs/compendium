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

---

## Corrective applied (post-review) - for the narrow confirmation pass
Codex round-1 returned **Changes required (4 Majors + 3 Minors)**. All addressed in commit `652dd69`
(diff refreshed in `collection-phase2-codex-review.diff`). Repo gates re-verified: `test:query` 821,
`test:ui` 181, `test:app` 17, types, cycles (147), source, docs, build.

- **M1 (fast tap no-jump):** release letter now resolved SYNCHRONOUSLY from `pointerup.clientY`. The latch
  sequence is extracted into a pure `makeRailGesture` controller (`alphabetRailState.js`) with 8 sequence
  tests (tap-before-frame → one pick; moves→release wins once; cancel/absent → zero; wrong-id/second-down
  ignored; abort; changed-flag).
- **M2 (keyboard):** Enter/Space handled ONLY by the focused button's native `onClick`; the nav handler is
  Arrow/Home/End, moves `focus()` to the destination before jumping, derives from the focused letter (not
  `active`); added a `:focus-visible` ring (`.cx-rail-letter`).
- **M3 (duck/teardown):** `visible = indexable && present.size>0`; scroll root resolved via a callback-ref
  into state (rebind/teardown on duck AND root replacement); tracking effects keyed on `rootEl`+`visible`;
  on invisibility we abort the gesture, dispatch `CANCEL`, clear bounds; unmount dispose aborts.
- **M4 (Add-to-list concurrency):** ref-backed single-flight guard + busy state; awaits `onPick`; disables
  all rows + sheet dismissal (`aria-busy`) while pending; "Adding…" on the chosen row; clears in `finally`.
- **m1:** `addEntriesToList` notifies only when `ranTransaction` (all-present add → zero broadcasts, tested).
- **m2:** added the profile A→B capture regression (park before tx, switch active, release, assert A only).
- **m3:** FEATURE_MATRIX rail row rewritten to the shipped latch+pill; proposal carries a SUPERSEDED banner
  over the pre-pivot bulge/injected-seams/parent-announcement sections.

Still device-gated before merge (Codex flagged): manual keyboard-focus verification, rapid-tap-two-rows on
Add-to-list, and **`check:smoke`** (held until a device is free - the owner is CDN-testing on the second
device and the Pixel is currently off adb).
