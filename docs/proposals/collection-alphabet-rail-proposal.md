# Proposal - Collection Phase 2: the A-Z alphabet rail

**Branch:** `collection-all-and-alphabar` (continues from the approved Phase 1 ALL view)
**Class:** High-risk (new global gesture surface + rAF animation loop + programmatic scroll coupled to
progressive render, across two surfaces, with accessibility fallbacks). Proposing before any production
edit, per the gate.
**Author:** Claude (lead engineer). For Codex adversarial review + owner ruling on the open questions.

## Problem / goal
ALL can hold ~1,500 collector items. Even with the progressive prefix, reaching "W" by thumb-scroll is
long. The owner asked for a **Niagara-style vertical A-Z rail** on the right edge: drag or tap a letter
to jump; the rail bulges/waves around the touch point. It must work on ALL **and** inside any set, duck
away when the order is not alphabetical, respect the existing chrome (sticky header, FABs, bottom dock,
safe areas), be **side-agnostic** (built right for testing, not hardcoded), and offer keyboard +
reduced-motion fallbacks - **without leaking a single rAF, observer, or listener.**

## Non-goals
- No change to the result engine, selection, or the Phase-1 progressive-render contract (the rail is a
  navigation overlay; it only *reads* the arranged order and *calls the existing* `ensureRendered`).
- No new persistence, no schema touch, no catalog touch.
- Not a general reusable app-wide index yet - it ships for Collection; extraction can follow if a second
  caller appears (same discipline as the Phase-1 helpers).

## Where it sits (grounded in the real layout)
- **Scroll owner:** `.cx-scroll` (`App.jsx:489`, `S.body` = `overflowY:auto`, `paddingBottom` reserves
  ~154px for the dock). The rail scrolls THIS element programmatically; it resolves it the same tested
  way the sentinel does - `resolveScrollRoot(node)` = `node.closest('.cx-scroll')`, never a global
  query (the first `.cx-scroll` match is Collection's horizontal header scroller).
- **Sticky header:** Collection header is `sticky; top:0; z-index:6`. The rail's top terminus clears it.
- **Bottom dock:** `.cx-dock` is `fixed; z-index:50; bottom: max(62px+safe-area+16, kb...)`. The rail's
  bottom terminus clears the dock/FAB and rises with the keyboard var the same way (`--kb`).
- **Motion kill-switch:** `body.reduce-motion` (set by `appearance.js` from the OS + the in-app toggle).
- **Gesture precedent:** `CardArtViewer` already does `setPointerCapture` + a single rAF spring loop
  with strict release/cancel on up/cancel/unmount - the rail follows that shape exactly.

## Design

### 1. A pure model module - `src/store/alphabetIndex.js` (DOM-free, unit-tested)
- `letterOf(name)` -> `'#'` or `'A'..'Z'`: trim, fold diacritics to base (NFD strip combining marks),
  uppercase the first character; a non-letter leading char (digit, quote, symbol) buckets to `'#'`.
- `railModel(flat, cardOf)` -> `{ order, present, firstIndex }` computed over the **flattened arranged
  order** Phase 1 already produces (`arranged.flat`):
  - `order`: the fixed rail sequence `['#','A',...,'Z']` (spatial constancy - the wave never reflows).
  - `present`: `Set` of letters that actually occur (absent letters render dim + non-interactive).
  - `firstIndex`: `Map(letter -> first flat index)`. Because the rail only shows when the order is
    globally alphabetical (see visibility rule), `firstIndex` is monotonic - a clean jump target.
- `bulge(distancePx, radiusPx, maxScale)` -> scale in `[1, maxScale]`: a pure falloff (cosine or
  smoothstep) of |distance| within `radius`, `1` beyond. This is the wave math; it is tested in
  isolation so the animation layer only feeds it a distance.

### 2. The component - `src/components/AlphabetRail.jsx`
`<AlphabetRail order present activeLetter side='right' onPick={(letter)=>...} />`
- **Layout:** a fixed-position column pinned to the logical inline edge. **Side-agnostic:** a single
  `side` prop drives ONE logical inset (`insetInlineEnd` for right / `insetInlineStart` for left) and
  the label/gradient anchor; no `left:`/`right:` literal is branched in JS. Vertical extent is
  `top: <below header>` to `bottom: <above dock>` using the same `--kb`/safe-area calc the dock uses, so
  it never collides with header, FAB, dock, or the home indicator.
- **Motion:** on `pointerdown` capture the pointer; a single rAF loop lerps each label's scale toward
  `bulge(distanceToPointer, radius, maxScale)` and updates the active letter. `pointerup`/`pointercancel`
  release capture, cancel the rAF, and settle. **Every path** (up, cancel, unmount) runs the same
  teardown; the rAF id and capture id are the only retained handles and both are cleared.
- **Tap vs drag:** a tap on a letter is a pointerdown+up in place - same `onPick`. Dragging sweeps
  `onPick` as the active letter changes (throttled to rAF, deduped so we don't re-jump to the same
  letter).
- **Reduced motion:** under `body.reduce-motion` the bulge is disabled (labels stay at scale 1); the
  rail is still fully operable by tap/drag - motion is decoration, never the mechanism.
- **Keyboard / a11y:** the rail is a `role="listbox"`-style control; letters are focusable, Up/Down move
  the active letter and Enter/Space jumps, Home/End go to `#`/`Z`. `aria-label` per letter; absent
  letters are `aria-disabled`. A visually-hidden live region announces the jumped-to letter.

### 3. Jump semantics (the load-bearing coupling with progressive render)
On pick of letter L:
1. `idx = firstIndex.get(L)` from the pure model (absent letter -> nearest present letter at/after L, or
   no-op).
2. `ensureRendered(idx + BUFFER)` - the Phase-1 hook grows the prefix so the target tile EXISTS before
   we scroll (in the set drill this is a no-op: the drill renders its rows in full).
3. After the paint that includes `idx` (a `useLayoutEffect` keyed on the render `count`, or a single
   rAF), scroll the target into the scroll root: locate the letter's first tile (a `data-letter` anchor)
   and set `scrollTop` so it sits just below the sticky header. No `scrollIntoView` fighting - we compute
   the offset against `.cx-scroll` directly.
This reuses `ensureRendered` exactly as Phase 1 designed it, and never bypasses the signature reset:
jumping does not change the signature, so no reset fires.

### 4. Visibility (the duck)
The rail is **navigation for an alphabetical list**. It shows only when the effective order is globally
A-Z by name: `sort === 'name-asc'` **and** `groupBy === 'none'`. Any other sort, or any grouping
(element/rarity sections break a single letter across sections), **ducks it out** with a short
translate+fade (neutralised under reduced motion). **Selection mode: the rail STAYS visible** (owner
ruling) - a jump during multi-select is allowed, and the union snapshot means jumping never disturbs the
selection. The rail's bottom terminus and the docked selection action bar share the same `--kb`/
safe-area calc, so they coexist without overlap.

### 5. Mounting
`AllCards` and the set-drill `Cards` each render `<AlphabetRail>` when visible, passing the pure model
built from their own `arranged.flat` (ALL) / `drillRows` arrangement (drill) and an
`onPick`/`ensureRendered` pair. No shared mutable state; the rail holds only its own gesture state.

## Invariants (constitution §3)
- **Catalog/profile boundary, profile isolation, forward-only schema, durable writes, transactional
  user-data:** untouched - the rail issues no writes and reads only already-derived rows.
- **Graceful zero-image:** the rail is text labels; it is unaffected by image state and needs no art.
- **Content-is-data / cross-runtime:** the rail is presentation only; letter bucketing is pure JS with
  no platform branch (works identically web + Android WebView).

## Risks / self-critique
- **rAF / capture / listener leaks** - the exact hazard the owner named. Mitigation: one rAF handle, one
  capture id, a single teardown run from up/cancel AND unmount; no `window`/`document` listeners (pointer
  capture routes all moves to the element). I will read the final effect cleanup line-by-line and state
  it explicitly for review.
- **Jump-before-render race** in ALL - if I scroll before `ensureRendered`'s growth paints, the target
  tile isn't there. Mitigation: scroll is gated on the post-growth paint (layout effect keyed on
  `count`), not fired synchronously on pick.
- **Grouped/other-sort ambiguity** - a letter is not a single anchor when the list is sectioned or
  non-alphabetical; rather than guess, the rail ducks. Surfaced as an open question in case the owner
  wants first-occurrence mapping instead of ducking.
- **Right-edge collision with the FAB/dock** - the rail's vertical band stops above the dock and shares
  its `--kb`/safe-area calc; I will verify on device that no letter sits under the FAB or the home
  indicator. **Device-gated**, not claimed here.
- **Touch-target vs density** - 27 labels (#+A-Z) on a short screen can fall below the 44px floor per
  label. The bulge enlarges the *touched* label, but the *hit* target must stay reachable. Mitigation:
  the rail's hit area is a continuous strip mapped by position (Niagara-style), not 27 tiny buttons -
  the label under the finger is derived from pointer Y, so precision doesn't depend on per-label size.
- **Two surfaces drifting** - same lesson as Phase 1's `selectionSummary`: both surfaces build the rail
  from ONE model helper and render ONE component, so behaviour can't fork.

## Testing plan
- **Pure (unit):** `letterOf` (accents fold, digits/symbols/quotes -> `#`, empty/whitespace, case);
  `railModel` (present set, monotonic `firstIndex`, `#` bucket ordering, empty result); `bulge`
  (monotone falloff, clamped to `[1,maxScale]`, `1` beyond radius, symmetric). Nearest-present-letter
  resolution for an absent target.
- **Reuse:** the Phase-1 `ensureRendered` / `effectiveCount` suites already lock the growth contract the
  jump depends on.
- **Gates:** full battery (`test:query/ui/app`, `check:types/cycles/source/docs`, `build`).
- **Device (pre-merge gate, not claimed):** drag/tap jump on ALL (incl. jump past the prefix -> grow ->
  land), tap jump in a set, duck on sort/group change, keyboard operation, reduced-motion (no wave, still
  jumps), no-collision with FAB/dock/safe-area, and a leak check (mount/unmount + rapid drag, observe no
  runaway rAF). `check:smoke` still certifies the drill route.

## Resolved (owner rulings)
1. **Non-alphabetical / grouped order -> DUCK the rail.** If `sort !== 'name-asc'` OR `groupBy !== 'none'`
   the rail ducks out. No first-occurrence mapping - a letter is only ever a single clean anchor.
2. **Absent letters stay in the rail, dimmed + non-interactive.** The full `#`+A-Z is always present, so
   the wave has constant length and never reflows as filters change.
3. **Selection mode KEEPS the rail** (see §4) - jump-while-selecting is supported; the snapshot is
   undisturbed by scrolling.
4. **Set drill just scrolls** - same component, `ensureRendered` passed as a no-op (the drill renders its
   rows in full, so the target tile always exists).
5. **Build right this phase**, `side` prop wired and ready; no left-side work now.

## Phase 2 is self-contained
No virtualisation, no engine change, no schema change. If approved, I implement the pure module + tests
first (reviewable in isolation), then the component + wiring, then run the full gate battery. Build stays
at the current number until the owner's coordinated device pass; I will not install to the Pixel on my
own.
