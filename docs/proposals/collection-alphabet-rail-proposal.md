# Proposal - Collection Phase 2: the A-Z alphabet rail (rev 2)

**Branch:** `collection-all-and-alphabar` (continues from the approved Phase 1 ALL view)
**Class:** High-risk (new global pointer-capture gesture + an rAF scheduler + programmatic scroll
coupled to progressive render, on two surfaces, with a11y + reduced-motion fallbacks and a hard
"no leaks" bar).
**Author:** Claude (lead engineer). **Reviewer:** Codex (principal). This rev answers Codex's five
Majors + two Minors on rev 1. **No production code exists yet; none begins until this lands.**

## Problem / goal
ALL holds ~1,500 collector items. Even with the progressive prefix, reaching "W" by thumb is a long
scroll. The owner asked for a **Niagara-style vertical A-Z rail** on the right edge: drag or tap a letter
to jump; the rail bulges/waves around the touch point. It works on ALL **and** inside any set, ducks when
the order is not alphabetical, respects the existing chrome (sticky header, FABs, dock, safe areas), is
**side-agnostic** (built right for testing), and offers keyboard + reduced-motion fallbacks - **leaking
no rAF, observer, or listener.**

## Non-goals
- No change to the result engine, selection, or the Phase-1 progressive-render contract. The rail is a
  navigation overlay: it READS the canonical arranged order and CALLS the existing `ensureRendered`.
- No persistence, schema, or catalog touch.
- Not a general app-wide index yet - it ships for Collection; extraction follows a second caller.

## Assumptions & confidence
- **A1 (high):** the Phase-1 `arranged.flat` order is exactly what the grid renders (it already is on
  ALL). Phase 2 makes the set drill render from the same `arrangeSections` object so this holds on both.
- **A2 (medium):** locale name-sort and ASCII letter-bucketing usually agree, but **not always**
  (e.g. `Æther` collating between `Aardvark` and `Alpha`). We do NOT assume agreement - `railModel`
  proves bucket monotonicity per result and **fails closed (ducks)** when it can't. Confidence in the
  *mechanism* is high; confidence that the rail is *shown* on any given filter is deliberately conditional.
- **A3 (medium, device-gated):** WebView pointer-capture + rAF behave as on desktop. Stated as an
  uncertainty, not a claim - the pre-merge device pass is the proof (see Testing + Risks).
- **A4 (high):** geometry is derivable from measurable inputs (scrollport top, header height, dock/FAB
  stack height, safe-area, `--kb`, `--ui-scale`); constants may be tuned on device but the *contract* is
  fixed here, not invented on the Pixel.

## Where it sits (grounded in the real layout)
- **Scroll owner:** `.cx-scroll` (`App.jsx:489`; `S.body` = `overflowY:auto`, `paddingBottom` reserves
  ~154px for the dock). The rail resolves and scrolls THIS element via `resolveScrollRoot(railNode)` =
  `railNode.closest('.cx-scroll')` - never a global query (the first `.cx-scroll` is Collection's
  horizontal header scroller).
- **Sticky header:** Collection header `sticky; top:0; z-index:6`. Its height differs between ALL (no
  per-set header) and the set drill (set title band), and scales with `--ui-scale` - so it is passed to
  the rail explicitly, never assumed (see Geometry).
- **Bottom dock:** `.cx-dock` `fixed; z-index:50; bottom: max(62px+safe-area+16, kb...)`. That value
  locates the dock's BOTTOM edge; the ~52px controls and the absolutely-positioned stacked add-FAB
  extend UPWARD from there. The rail must clear the tallest reachable stack, not the dock offset.
- **Motion kill-switch:** `body.reduce-motion` (`appearance.js`, OS + in-app toggle).
- **Gesture precedent:** `CardArtViewer` does `setPointerCapture` + a rAF loop with strict
  release/cancel on up/cancel/unmount - Phase 2 reuses the shape but with an *event-driven* scheduler.

## Design

### D1. One canonical arranged result drives everything
Both surfaces build a single `arrangeSections(rows, groupBy, cardOf, comparator)` object (ALL already
does; the set drill is refactored from its inline `groupCards` to the same call). **That exact object**
feeds: (a) the grid sections rendered, (b) the `data-letter` anchors, (c) the rail model, (d) jump
indexes. There is no second ordering path, so rail indexes cannot diverge from DOM order.

### D2. Pure model - `src/store/alphabetIndex.js` (DOM-free, unit-tested)
- `letterOf(name)` -> `'#'` or `'A'..'Z'`: trim; NFD-fold diacritics to base; uppercase the first
  scalar; a leading non-A-Z char (digit, quote, symbol, empty) -> `'#'`.
- `bulge(distancePx, radiusPx, maxScale)` -> scale in `[1, maxScale]`: smoothstep falloff of `|distance|`
  within `radius`, `1` beyond. Pure; the animation layer only feeds it a distance.
- `railModel(flat, cardOf)` -> `{ order, present, firstIndex, indexable }`:
  - `order`: the fixed sequence `['#','A',...,'Z']` (constant length; the wave never reflows).
  - `present`: `Set` of letters that occur.
  - `firstIndex`: `Map(letter -> first flat index)` walking `flat` in render order.
  - `indexable`: **false** if the per-row bucket RANK (position in `order`) is ever non-monotonic across
    `flat` - i.e. the locale sort and ASCII buckets disagree (the `Aardvark, Æther, Alpha` ->
    `A, #, A` case). When false, the rail ducks. This is the fail-closed guarantee: we never scroll to a
    false index; we hide instead.

### D3. Geometry - pure `railBounds(...)` + one shared CSS base var
- Extract the dock's base offset into a shared CSS custom property (e.g. `--cx-dock-base`) consumed by
  BOTH `.cx-dock` and the rail, so they can never drift.
- `railBounds({ scrollportTop, headerHeight, dockStackHeight, safeAreaBottom, kb, uiScale, selecting })`
  -> `{ top, bottom }` (logical insets): `top = scrollportTop + headerHeight`;
  `bottom = max(dock-base + dockStackHeight, kb/uiScale + gap) + safeAreaBottom`. `dockStackHeight`
  accounts for the tallest reachable dock/FAB (and the selection action bar when `selecting`). Pure and
  tested across normal / selection / keyboard-open / UI-scale / safe-area cases. The set drill passes its
  sticky-header height; ALL passes the scrollport top with a zero per-set header. Device may tune the
  stack constant; it does not invent the formula.

### D4. Component - `src/components/AlphabetRail.jsx`
`<AlphabetRail model activeLetter side='right' bounds onPick scheduler capture tracker />`
- **Semantics (Minor 1):** a `<nav aria-label="Alphabetical index">` of letter `<button>`s. **Present**
  letters are real buttons (`aria-current` on the active one, roving `tabindex`); **absent** letters are
  `disabled`, `aria-hidden`, non-focusable visual slots - never navigable, never a jump. Not a listbox.
- **Hit model:** a single flat continuous capture strip with `touch-action:none`; the letter under the
  finger is derived from pointer Y mapped over `order`, so precision does not depend on per-label size
  (solves the 27-labels-below-44px density problem). **A Y that maps to an absent slot is a no-op**
  (Major 1) - no nearest-letter resolution anywhere.
- **Side-agnostic:** one `side` prop drives ONE logical inset (`insetInlineEnd`/`insetInlineStart`) and
  the label/gradient anchor; no `left:`/`right:` literal branched in JS. Built right; left is prop-ready.
- **Injectable seams (Major 4):** `scheduler` (rAF), `capture` (pointer-capture adapter), and `tracker`
  (scroll listener) are injected so tests exercise the real orchestration, not just `bulge()`. Defaults
  are the production implementations.

### D5. Gesture + active-letter lifecycle (Major 4)
- **Admission:** accept only the **primary** pointer and, for mouse, the **left button**; ignore others.
- **Event-driven rAF (not a continuous loop):** `pointermove` stores the latest Y; at most one rAF is
  scheduled; that frame computes the wave (<=27 scale writes) and the deduped active letter, and emits a
  pick only when the letter changes. No idle frames.
- **One teardown - `endGesture()`** runs from **up, cancel, `lostpointercapture`, a replacing pointer,
  and unmount**: releases capture, cancels the pending rAF, removes transforms; a short **CSS** settle
  (not the JS lerp) returns labels to rest, so "cancel rAF" and "settle" don't contradict.
- **Ordinary-scroll tracking:** `activeLetter` during normal scrolling comes from ONE **passive**
  listener on the resolved scroll root, rAF-throttled, testing at most 27 `data-letter` anchors to find
  the first below the header. That exact listener + its rAF are removed on every teardown.
- **Reduced motion:** `body.reduce-motion` disables the wave (labels stay scale 1); tap/drag still jump.
- **Live region (Major 4):** announce only the **committed** destination letter, never each intermediate
  drag crossing - no live-region spam.

### D6. Jump coordinator (Major 3) - one explicit, cancellable sequence
```
PICK(letter):                       // present letters only
  idx = firstIndex.get(letter)
  set pendingJump = { requestId, signature, modelId, letter, idx }   // newer supersedes older
  ensureRendered(min(total, idx + 1 + LOOKAHEAD))                     // idx+1 guarantees the 0-based row

layoutEffect [pendingJump, count, signature, model]:                 // useLayoutEffect
  if !pendingJump: return
  if pendingJump.signature !== signature || pendingJump.modelId !== model.id:
      clear pendingJump; return                                       // filter/sort/group/duck/unmount cancels
  if count <= pendingJump.idx: return                                 // wait for the growth paint (re-fires on count change)
  anchor = scrollRoot.querySelector(`[data-letter="${pendingJump.letter}"]`)  // within the root, never global
  if !anchor: clear pendingJump; return                              // fail closed, no throw
  scrollRoot.scrollTop += anchor.offsetTop-relative delta so it sits just below the header
  clear pendingJump                                                   // exactly-once commit
```
- **Last-pick-wins:** a newer pick overwrites `pendingJump`; the stale requestId never commits.
- **Already-rendered & set-drill jumps** still execute: changing `pendingJump` re-runs the effect even
  when `count` is unchanged (set drill renders in full, so `count > idx` immediately).
- **Only each letter's first row carries `data-letter`** (from `firstIndex`), queried inside the root.
- Jumping never changes the signature, so no progressive reset fires.

### D7. Visibility (the duck)
Rail is shown iff **`sort === 'name-asc'` AND `groupBy === 'none'` AND `model.indexable` AND
`present.size > 0`**. Otherwise it ducks (translate+fade, neutralised under reduced motion). **Empty
results: duck entirely** (chosen over a fully-dimmed inert rail - a control with nothing to navigate is
noise). **Selection mode keeps the rail** (owner ruling); its bottom bound accounts for the docked action
bar via `railBounds({selecting:true})`.

### D8. Mounting
`AllCards` and the set-drill `Cards` each render `<AlphabetRail>` when visible, from their own canonical
`arranged.flat`, passing `onPick`/`ensureRendered` (a no-op grow in the drill) and their measured
`bounds`. No shared mutable state; the rail holds only its own gesture state.

## Performance budget
- Per animation frame: **<= 27 scale writes + 1 active-letter computation**; no layout thrash (reads
  batched before writes). At most one rAF in flight for the wave, one for scroll-tracking.
- Jump: one `ensureRendered` growth + one `scrollTop` write; no per-tile work.
- Idle (no gesture, no scroll): zero scheduled frames.

## Invariants (constitution §3)
Catalog/profile boundary, profile isolation, forward-only schema, durable/transactional writes: untouched
- the rail issues no writes and reads only derived rows. Graceful zero-image: the rail is text; no art.
Content-is-data / cross-runtime: pure JS bucketing, no platform branch (identical logic web + WebView;
runtime *behavior* is device-gated per A3).

## Alternatives considered
- **Static index (no wave), letters as a plain sticky list:** simplest, no rAF, no capture strip. Rejected
  because the owner explicitly asked for the Niagara wave, and the flat capture strip is what makes small
  targets reachable; a static list reintroduces the 27-tiny-buttons density problem. The no-wave path is
  still the reduced-motion fallback, so the simpler design ships *inside* this one.
- **Section-anchored letters via `scrollIntoView`:** rejected - `scrollIntoView` fights the sticky header
  and gives no control over the growth-then-scroll ordering; explicit `scrollTop` against the resolved
  root is deterministic and testable.
- **First-occurrence letter mapping under grouping:** rejected by owner ruling (duck instead); also a
  letter would stop being a single clean anchor.

## Migration / compatibility
No data or schema change; nothing to migrate. The only structural change to existing code is the set
drill rendering from `arrangeSections` instead of inline `groupCards` (behaviour-identical sections,
verified by the existing drill tests + `check:smoke`). Backwards compatible; no persisted state added.

## Rollback / recovery
The rail is a presentation-only overlay. Rollback = remove `<AlphabetRail>` mounts + the pure module +
the CSS var; the grids render exactly as Phase 1. No data written, so nothing to reconcile or recover.
Can be gated behind a simple render condition if a device issue appears late.

## Documentation impact
- **`COMPENDIUM_FEATURE_MATRIX.md`** - **will update:** the My Collection row gains the A-Z rail
  (jump-to-letter on ALL + set drill, ducks off-alphabetical).
- **`COMPENDIUM_ARCHITECTURE.md`** - **will update:** §7.4 notes the rail as a Collection navigation
  overlay reading the canonical arranged order.
- **`DESIGN_SYSTEM.md`** - **will update:** document the rail primitive (nav semantics, the shared
  `--cx-dock-base` bound var, reduced-motion behaviour, side-agnostic inset).
- **`COMPENDIUM_DATA_MODEL.md`** - **reviewed, no change** (no table/column/repository/schema touch).
- **`BUILD.md`** - **reviewed, no change** (no new command/dependency/env; same gate battery +
  `check:smoke`).

## Risks / self-critique
- **rAF / capture / listener leaks** (owner's named hazard): one wave-rAF handle, one scroll-track rAF
  handle, one capture id, one passive listener - all released by a single `endGesture()`/cleanup run from
  up/cancel/lostcapture/replacement/unmount. I will read the final cleanup line-by-line for review and
  the injectable seams let a test assert teardown ran.
- **Model/DOM order divergence:** eliminated by the single canonical arranged object + `indexable`
  fail-closed check; adversarial non-ASCII/punctuation tests + a real-catalog corpus contract guard it.
- **Jump-before-render race:** the coordinator waits on `count > idx` in a layout effect; it cannot
  scroll before the target commits, and a superseding pick/duck cancels cleanly.
- **Geometry collision with FAB/dock/safe-area:** `railBounds` clears the tallest reachable stack, shares
  the dock base var, and is tested across states - but final constants are **device-gated**, not claimed.
- **WebView gesture/scroll fidelity (A3):** explicitly uncertain until the device pass; no identical-
  runtime claim is made.

## Testing plan
- **Pure:** `letterOf` (accents fold, digits/symbols/quotes/empty -> `#`, case); `bulge` (monotone,
  clamped `[1,maxScale]`, `1` beyond radius, symmetric); `railModel` (present set, `firstIndex` in render
  order, `#` bucketing, `indexable` true on clean A-Z, **false** on the `A,#,A` interleave and other
  non-monotonic corpora, empty result); a **real-catalog corpus contract** asserting `indexable` holds
  for the shipped catalogue under name-asc.
- **Coordinator (with injected seams):** insufficient-count wait, already-rendered immediate commit,
  last-pick-wins supersession, signature/model cancellation, missing-anchor no-op, exactly-once commit.
- **Rail control:** pointer-Y -> letter mapping (incl. absent-slot no-op), keyboard arrow skipping of
  absent letters, Home/End -> first/last **present** letter, empty-result duck.
- **Geometry:** `railBounds` normal / selection / keyboard-open / UI-scale / safe-area.
- **Gates:** full battery (`test:query/ui/app`, `check:types/cycles/source/docs`, `build`).
- **Device (pre-merge gate, not claimed):** drag/tap jump on ALL (incl. jump past the prefix -> grow ->
  land), tap jump in a set, duck on sort/group/non-indexable, keyboard operation, reduced-motion, no
  collision with FAB/dock/safe-area/home-indicator, jump-while-selecting, and a leak check (mount/unmount
  + rapid drag -> no runaway rAF/listener). `check:smoke` still certifies the drill route.

## Resolved (owner rulings)
1. **Non-alphabetical / grouped order -> DUCK** (`sort !== 'name-asc'` OR `groupBy !== 'none'`); also
   ducks when `!indexable` or empty. No first-occurrence mapping.
2. **Full `#`+A-Z always**, absent letters dimmed + **inert** (no-op, non-focusable) - constant wave.
3. **Selection mode KEEPS the rail** (bounds account for the action bar).
4. **Set drill just scrolls** - same component, `ensureRendered` a no-op.
5. **Build right**, `side` prop ready; no left-side work this phase.

## Approval record
- Rev 1 - owner rulings on 5 product questions (folded above).
- Rev 1 review - Codex: Changes required (5 Majors + 2 Minors on the implementation contract).
- Rev 2 (this) - answers all seven; **awaiting Codex disposition. No implementation until approved.**
