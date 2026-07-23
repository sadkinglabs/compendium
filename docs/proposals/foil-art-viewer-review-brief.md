# Codex review request - holographic foil + finger-tracked full-art view

## Corrective (build 163) - read first

The "Changes required" disposition is addressed in commit `1b753fd` (`git diff 67dc00c..HEAD`):
- **Major (decode gate):** effects now gate on the DECODED candidate identity `{src, gen}`, not URL
  availability - `<img> onLoad` sets `decoded`, `onError` resets it, `showFx = !!src && decoded.src===src
  && decoded.gen===gen`. Foil/glare can no longer ignite over the fallback during slow/failed delivery,
  and a same-URI/new-gen quarantine re-resolve returns to fallback-only until the replacement decodes.
- **Minor (capture release):** `requestClose` routes through one `stopDrag()` that also
  `releasePointerCapture` on the root (Back/Escape mid-drag no longer leaves the pointer held); a
  `closeRequested` ref prevents a reduced-motion double `onClose`.
- **Minor (X pointer identity):** the close button only closes on the pointer that began on it
  (`closePointerId`).
- **Minor (FLIP exactness):** origin scale measured from the untransformed `offsetWidth`, not the
  `scale(.94)` `getBoundingClientRect().width`.
- **Docs:** feature matrix + DESIGN_SYSTEM (mix-blend-mode now two, device-verified; Foil recorded as
  shipping in the viewer only, not a universal primitive). Architecture / Data Model / BUILD: reviewed,
  no change (pure view; foil is validated boolean UI state; no command/env change).

Gates after corrective: test:ui 162, check:types, check:cycles (133), check:source, check:docs, build.

---

**Branch:** `foil-art-viewer` (off `main`, tip = latest). **Range:** `git diff main..foil-art-viewer`.
**Primary file:** `src/components/CardArtViewer.jsx` (+ `src/components/cardArtViewerPhase.js` and its test).
Device: **build 162 on a Pixel 9 Pro XL**, owner-validated across the acceptance checklist below.

## What this is

The full-screen card art view - reached by tapping the art in a card sheet - is rebuilt to a Fable
spec: a finger-tracked 3D tilt with a holographic foil sheen for foil printings. Much of the *input
and lifecycle* architecture here is **Codex's own prescription from two prior review rounds**,
implemented to spec with tests; this pass confirms the implementation plus the new feature layer.

Three things landed, in order:

1. **The foil + motion feature (Fable spec).** A single `requestAnimationFrame` spring loop lerps six
   values (`rx/ry/mx/my/o/hyp`) toward pointer targets (k=0.3 tracking) and, on release, eases
   (k=0.14) into a slow lissajous idle drift; values are refs, never state, so it never re-renders.
   Layer 1 is a color-dodge rainbow sheet (foil printings only) that ignites on the artwork's
   highlights and slides opposite the pointer; Layer 2 is an overlay glare hotspot (both finishes).
   The old **gyroscope parallax was removed** (janky). `isolation: isolate` keeps the blend modes off
   the page.
2. **Drag input on the untransformed root (Codex's round-1 fix).** Hit-testing against the tilt
   element - whose own `rotateX/rotateY` changes every frame inside `perspective` + `preserve-3d` -
   dropped ~4 of 5 drags on Android WebView. Capture now lives on the fixed full-screen root; the flat
   `cardRef` rectangle is only a geometric admission boundary; the entire 3D subtree is
   `pointerEvents: none`. Owner-confirmed reliable.
3. **Explicit phase state machine (Codex's round-2 fix).** The old `open/armed/flipT` booleans let the
   entry effect read "open===false with a valid flipT" as "start entering", so closing rescheduled an
   ENTER next frame - reopening the viewer mid-exit. Replaced by one monotonic phase
   (`preparing → entering → open → exiting → closed`) in a **pure reducer** (`cardArtViewerPhase.js`,
   **11 tests**). Enter/exit is derived from `phase` in one render (no stagger); FLIP continuity when an
   origin exists, else a centred `.94 → 1`. The close button captures its own pointer, stops
   propagation (immune to the drag logic + the root also bails when the target is within it), gives an
   immediate `scale(.88)` down-state, and terminates any in-flight drag.

## Foil-flag plumbing (the only change outside CardArtViewer)

`CollectionCardSheet` passes its active Standard/Foil finish → `SheetArt` (new `foil` prop, default
false) → `CardArtViewer`. The deckbuilder `CardSheet` passes nothing → non-foil (tilt + glare, no
rainbow). No data, schema, or repository change; the finish is already-validated boolean UI state.

## Invariants (constitution §3) and how they hold

- **Graceful zero-image degradation.** With art suppressed there is no `<img>` (`showFx = !!src`), so
  neither foil nor glare renders - they never ignite over the deterministic gradient fallback, which
  fills the stage as before.
- **Reduced motion.** No rAF loop, no tilt, no drift, no glare; the viewer opens and closes
  immediately (phase inits to `open`, `requestClose` calls `onClose` directly); a foil card shows a
  single static low-key sheen so it still reads as special.
- **WebView transform+scroll paint gotcha.** Not in play - neither the card nor the root scrolls; the
  animation is transform/opacity on non-scrolling elements.
- **Profile/catalog boundary, durable writes, schema:** untouched - this is a pure view.

## Where to attack

- **Phase reducer fidelity:** any event that could reopen an exiting viewer, or an EXITED/ENTERED
  accepted off its phase. (Covered by `cardArtViewerPhase.test.mjs`, but the *wiring* - transitionend
  filtered to the card transform + the fallback timers, cleaned on unmount - is where a real leak would
  hide.)
- **Close reliability:** the X capturing its own pointer + `stopPropagation` + the root's
  `contains(e.target)` bail - can a tap on the X ever start a card drag, or a drag ever swallow the X?
- **Drag/close interaction:** `requestClose` nulls `dragId`/`active`; confirm a close mid-drag can't
  leave a captured pointer or a stuck `active` flag.
- **Enter/exit correctness:** origin vs no-origin both animate; closing mid-entrance reverses from the
  current computed transform; no instant-unmount path remains.
- **Loop hygiene:** idle drift only at `phase === 'open'`, held neutral otherwise; the loop writes CSS
  vars to a pointer-inert element and cancels on unmount.

## Device acceptance (owner-validated on the Pixel 9 Pro XL, build 162)

Drags register reliably (the 4/5-miss defect is gone); the X closes immediately with visible
down-state, during and after the entrance, including where it overlaps the card rectangle; enter/exit
both animate (~300 ms in / ~180 ms out); the foil rides to rich-but-not-burnt at full tilt
(`TILT = 12.4°`, `HYP_MAX = 0.75`); idle drift, snap-back, and 0.6 foil intensity are the owner-tuned
values. `check:smoke` (device route render) remains the pre-merge gate.

## Gates

`test:ui` 162, `test:query` 714, `check:types`, `check:cycles` (133 modules), `check:source`,
`check:docs`, `build` - all green.

## Tuning knobs (owner-settled, listed for context)

`ENTER_MS`/`EXIT_MS` (300/180), `ENTER_EASE`/`EXIT_EASE`, `TILT` (12.4), `HYP_MAX` (0.75), the `0.6`
foil-intensity multiplier, the idle-drift amplitudes, and the spring `k` (0.3 / 0.14).
