# Bottom Sheet Engine - Device Pass 1 Review (for Codex)

Status: REVIEWED (Codex: "Approved for one corrective implementation pass"; build 254 remains Changes required) - CORRECTIVE PASS IMPLEMENTED in build 255, awaiting the owner's re-test.
Author: Claude (lead engineer). Reviewer: Codex.
Date: 2026-08-15, against build 254 installed on the owner's Pixel (working tree, NOT committed).

## Codex disposition and what was implemented (build 255)

| # | Codex disposition | Implemented as |
|---|---|---|
| 1 | Gesture-history reset CONFIRMED. Record origin + first sample at pointerdown, keep sampling through tracking, retain both at handoff, apply the handoff event immediately, judge `MIN_FLICK_DISTANCE` on `releaseY - originY`, keep the projected test on the panel's actual position, same model for chrome drags (immediate ownership). `v = 0` during drag is correct. Seed a REJECTED dismissal with `min(0, releaseVelocity)`; accepted keeps full velocity. | `sheetMotion.js`: one `gesture` record `{originY, originX, originP, h, mode, scrollTop, moved}` created at pointerdown and never rebased; `takeOwnership()` calls `dragTo(e)` immediately; `release()` uses origin displacement for the flick floor and `Math.max(0,p)*h` for projection; snap-back seeds `Math.min(0, vpx)/h`. Covered by 3 dedicated tests. |
| 2 | Option C + A with refinement: position-linked while opening/dragging/snap-back; on accepted dismissal FREEZE at the current opacity, slide fully off-screen with no scrim change, then fade 100ms and unmount; reduced motion completes within one frame. | `freezeScrim()` captures the current value at acceptance; `apply()` skips the scrim while frozen; a `fading` phase runs the 100ms fade before `onClosed`. Two tests (pure-slide close, frozen-at-drag-value). |
| 3 | Scrim-level grab ONLY. Keep deferred children; no height caching. Do not double-process the panel pointerdown when it bubbles; a moved scrim gesture must suppress the click-dismiss; a stationary tap keeps normal dismissal. Caller close stays final. `initialHeight` has no callers - correct the documentation, do not invent a cache. | Engine accepts a `'scrim'` zone only while `opening`/`settling`/gesture-`closing`; `GothicSheet` skips scrim pointerdowns originating inside the panel, and `onScrimClick` checks `wasDragged()` (which now survives gesture teardown via `lastMoved`). `swallowNextClick()` fires on ANY moved release. `initialHeight` prop REMOVED; spec section corrected. Three tests. |
| 4 | Restore permanent panel promotion: keep `will-change: transform` for the mounted lifetime, write `translate3d(0, y, 0)`, settle at a written zero transform, leave the scroller's `translateZ(0)`, do NOT promote the scrim. Record the revision to spec constraint 7 and in DESIGN_SYSTEM.md. | `GothicSheet` sets `willChange: 'transform'` permanently and the initial inline transform is `translate3d(0, 100%, 0)`; `apply()` is the single transform writer and settles at `translate3d(0, 0%, 0)` (the redundant literal write was removed). Spec constraint 7 rewritten with the device evidence + bounded cost; DESIGN_SYSTEM sheets pattern updated. One test. |
| 5 | Do NOT modify overlayStack speculatively. Instrument to split React/art lifecycle from compositor/raster. Never ship without background inertness. | `ArtImg` gained opt-in tracing (`window.__artTrace = true` logs mount/unmount/load with the warm flag); inert behaviour untouched. If the flash persists in 255, the trace tells us which class it is. |
| 6 | Add deterministic engine tests for the nine listed behaviours, run all seven gates, re-test on-device including first-open and repeat-open grabs. | `src/sheetMotion.test.mjs` - 16 tests against a fake DOM + manual clock, covering all nine (handoff origin/velocity, flick, sub-threshold snap-back, chrome, scrim catch vs tap, frozen scrim + delayed unmount, interrupted close, caller-close finality, locked sheet, reduced motion, listener/frame cleanup, layer promotion, scroll cooldown). All green. |

## Device pass 2 (build 255) - one finding, fixed in build 256

Owner: "all is fixed, but now I observe that when a sheet dismisses, the main screen takes a bit too long to come back from being in its secondary/background dimmed state."

Confirmed as a defect in the close leg, not a taste question. The close spring aimed at exactly `1.0`, and a critically damped spring approaches its target asymptotically: the panel was visually off-screen at ~200ms, but the settle test (`abs(p - target) < 0.001` AND `abs(v) < 0.01`) only passed near ~430ms, and the 100ms scrim fade started only after that. The screen therefore stayed dimmed for roughly 530ms, with nothing moving for the last ~250ms of it - exactly what the owner described.

Fix: the close leg now aims **past** the exit (target 1.25) so the visible travel sits on the fast early part of the curve and `p >= 1` arrives in finite time; the close completes the moment the panel reaches 1.0; and the scrim fade (now 90ms) begins once the panel passes 90% of travel, so the dim lifts as the sheet clears rather than after it. The owner ruling still holds - the dim is untouched for the entire visible slide, so close reads as the sheet coming down.

Measured: sheet off-screen **192ms**, dim starts lifting **176ms**, screen fully back **256ms** (was ~530ms). M3 puts a sheet exit at 200ms (short-4, emphasized-accelerate), so the new timing lands on the platform spec.

Two new regression tests pin it: a dismissal must clear the dim within 320ms, and a flicked dismissal must never be slower than a programmatic one. Engine suite is now 18 tests.

## Pre-release gate sweep (build 256) - one unrelated gate defect found and fixed

`check:smoke` was run on-device for the first time in this effort and failed with `Play: missing "quick match"`. Investigated before touching anything; it is **not** a regression from the sheet work and **not** an app defect:

- `Fab.jsx`, `Play.jsx` and `check-smoke.mjs` are untouched by this branch (verified against `git status`).
- On-device probe of the Play route with the FAB closed: **`recent` present** (so Play renders correctly), `quick match` absent, and the FAB trigger's own `Match menu` label also absent.
- Mechanism: "Quick Match" is a FAB MENU ITEM, and the menu renders `aria-hidden={!open}` (`Fab.jsx:136`), so its subtree is excluded from the accessibility tree while closed; the trigger's `aria-label` does not reach this WebView's tree either - the same measured defect `OverflowMenu.jsx:171-181` already documents and works around. The marker became unreachable when the FAB gained its a11y morph (commit 69c7ee2), and the gate simply had not been run on a device since.

Fix: the Play marker is now `win rate` (the hero donut's label). Verified on-device against the gate's own doctrine - present on Play, **absent from Home**, so a tap that silently does nothing still fails. `recent matches` was rejected precisely because the probe found it on BOTH screens (Home carries a Recent Matches widget). Recorded caveat: it marks the populated hub; a profile with no matches shows "No Matches Yet" instead.

Result: **8/8 routes green, build 256 certified on device** (release artifact, not debuggable).

Two harness bugs surfaced while writing the tests and were fixed in the tests, not the engine: the fake scroll element lacked `scrollTop` (so the `scrollTop === 0` handoff guard read `undefined`), and the engine had been writing a second, differently-formatted transform at settle - now `apply()` is the single writer.

## What you are reviewing

The unified sheet primitive implemented from `docs/bottom-sheet-spec.md` (approved same day; owner decisions recorded in its section 7). New/changed code under review:

- `src/components/sheetMotion.js` - NEW. One rAF spring (stiffness 235 / damping 31, critically damped) + the gesture state machine (tracking / dragging / settling / closing), velocity-projected dismissal, rubber band, scroll handoff.
- `src/components/overlayStack.js` - NEW. Explicit z-order + background inert/aria-hidden management.
- `src/components/GothicSheet.jsx` - REWRITTEN. Mounted-through-close phase handling, deferred children (one rAF), percentage-based translate, handle-as-close-button, engine wiring.
- `src/components/Sheet.jsx` / `ui.jsx` (`BottomSheet` alias, `CenteredModal` overlay registration, `useSwipe` exclusion), `CreateDeckWizard.jsx` + `DeckDashboard.jsx` `ChangeAvatarSheet` (migrated onto the chassis), `Collection.jsx` / `Codex.jsx` (P1/P2 memoization), `App.jsx` (global Escape), `tokens.css` (sheet tokens + `.cx-card-tile` content-visibility), `decks.css` (dead chassis CSS removed).

All seven quality gates were green at install. The five findings below are from the owner's first device pass. Please review each finding's diagnosis candidates adversarially, confirm or replace the mechanism, and prescribe the fix set so this is ONE corrective pass. Where my candidate conflicts with your reading of the code, your reading wins - say so explicitly.

---

## Finding 1a - OWNER DIRECTION: no opacity animation on close

> "I don't want opacity down on sheet close, sheet close animation is the sheet just coming down."

Current behavior: `sheetMotion.js` `apply()` links scrim opacity to position every frame (`opacity = 1 - visual`), so during the close motion the scrim fades in lockstep with the slide and the whole dismissal reads as a fade-out.

This is a ruling, not a bug: close must read as a pure downward slide. Design question for you: what should the scrim do on close - (a) hold fully dark until the panel is off-screen, then a fast (~100ms) fade; (b) a short fade only in the final fraction of travel; or (c) keep position-linked opacity ONLY while the finger is down (drag) and switch to (a)/(b) for released/programmatic closes? My candidate is (c)+(a): position-linked while dragging (the finger explains the fade), hold-then-quick-fade once the close motion owns the sheet. Open motion keeps the current position-linked fade unless you disagree.

## Finding 1b + 5a - THE BIG ONE: a downward swipe from the middle of the sheet bounces the sheet up instead of dismissing

> "Swipe downwards from the middle of the sheet makes the sheet bounce up instead. Swipe down slow works fine sometimes but not ideal." (Reproduced on the card sheet and the Home profile sheet.)

My diagnosis - the scroll-handoff takeover throws away the gesture's history, so a flick almost never passes the dismissal test:

1. A mid-sheet touch enters `tracking` (`pointerDown`, zone 'body'). The finger travels >= `ACTIVATION_SLOP` (10px) before `move()` decides the takeover.
2. `beginDrag(e.clientY)` then does `samples.length = 0` and sets `grab = { y: clientY, p, startP: p }` at the CURRENT pointer position - so both the displacement baseline and the velocity window restart at the takeover point. Everything the finger did before the takeover is discarded.
3. On a fast flick, most of the travel and all of the peak velocity happened BEFORE takeover; release arrives a few ms later with 1-2 samples, tiny `movedPx` (< `MIN_FLICK_DISTANCE` 20px), tiny `yPx`, and a noisy/near-zero `sampleVelocity()`. The dismissal test (`projected > 0.25H` OR `v >= 500 px/s && moved >= 20px`) fails.
4. `release()` then springs to 0 seeded with whatever downward velocity it did measure - the sheet visibly dips further, then returns up. That is exactly "bounce up instead".

Slow drags survive because post-takeover displacement accumulates past 25% - matching "slow works fine sometimes".

Fix candidates for your disposition:
- Measure displacement AND the velocity sample window from the ORIGINAL `pointerdown` (`track.x/y`, plus keep pushing samples during `tracking`), not from the takeover point. The takeover only decides WHO owns the gesture, never resets its history. (vaul equivalent: drag distance is computed from the gesture origin.)
- Drop or shrink the takeover jump: `grab.y` at takeover with history preserved means `movedPx` computes from `track.y`.
- Consider whether `MIN_FLICK_DISTANCE` should apply to gesture-origin displacement (it then almost always passes for a real flick).
- Verify the same reset bug does not also degrade chrome-zone (handle/header) flicks - `beginDrag` resets samples there too, but chrome drags have no tracking phase so the loss is only the one event; likely fine, please confirm.

## Finding 2 - sheet is not grabbable mid-open

> "Sheet is not grabbable mid open."

Candidates, most-likely first:

- **The first-frames panel is tiny.** Children are deferred one rAF (`contentReady`), so at open start the panel is shell-height (handle + header only, ~40-90px). `translateY(100%)` of a short panel means the visible rising surface during the catchable window is small, and the finger lands on the SCRIM (which has no pointerdown handler; its click closes). By the time the panel is tall, the 300ms spring is nearly settled. So mid-open grabs mostly miss the panel entirely.
- **Hit-testing vs transform**: pointer hit-testing follows the transformed box, so touches above the risen portion hit scrim. Combined with the above, the catchable area is thin.
- Also check: `pointerDown`'s `if (pointerId != null) return` guard and whether a scrim-tap-then-drag sequence eats the attempt.

Fix candidates: (a) put the mid-open catch on the SCRIM too - during `opening`/`settling`/`closing`, a pointerdown anywhere in the sheet layer (scrim included) begins the grab (and suppresses the scrim's click-dismiss for that gesture); (b) reconsider the shell-first mount interaction with catchability - e.g. mount children in the same commit but keep `initialHeight`/min-height so the panel is full-size from frame one when a last-known height exists. (b) trades away part of the deferred-mount win, so prescribe deliberately.

## Finding 3 - RefineSheet: at full height, a paint glitch shows "the right vertical half of the right side"

> "My Deck > Edit > add cards refine sheet, once the sheet reaches the top, it glitches showing the right vertical half of the right side."

This smells like the §6 WebView paint family, and I think I caused it by being "correct": at open-settle, `finishSettle()` clears `panel.style.transform = ''` AND `setMoving(false)` removes `will-change: transform`. Both together demote the panel's compositor layer at the exact moment the sheet reaches the top; the WebView re-rasters and shows a partial raster (the historical "Refine sheet symptom" the old chassis comment warned about - GothicSheet's OLD code kept `willChange: 'transform'` permanently for the sheet's whole life, and its keyframe left no lingering transform issues because the layer promotion stayed).

Fix candidates: keep the panel promoted for the sheet's entire mounted life (restore permanent `will-change: transform`, and/or settle to `translateY(0%)` instead of clearing) - i.e. revert my "transient hints" purity for this panel, matching the audit's observation that the permanent hints were a deliberate device-proven choice. The spec's layer-count concern is satisfied by sheets being few and short-lived. Please confirm the mechanism (I did not reproduce on-device myself) and whether the scroller's `translateZ(0)` contract needs the same treatment anywhere else in the new code.

## Finding 5b - after the profile sheet dismisses, Home's YOUR DECKS avatar heroes flash as if refetched

> "Once the sheet dismisses, the avatar hero images in the YOUR DECKS section of home flash as if they were refetched."

Candidates - I could not pin one mechanism from source; please arbitrate:

- **overlayStack inert churn**: `recompute()` toggles `inert` + `aria-hidden` on every `.cx-app` child on each push/release. If any of those attribute writes lands on the subtree containing the deck carousel, and anything in the art pipeline (artReveal contract, `content-visibility`, or a CSS selector keyed off attributes) reacts, the reveal fade could re-run. Note `art-first-paint` history: the reveal animation is load-bearing and re-triggering it looks exactly like "refetched".
- **Extra commits from the new close lifecycle**: the chassis now produces additional renders around close (`contentReady` reset, `setMounted(false)` after settle). If Home hero `ArtImg`s remount or their keys change across those commits, the paint-once (`artCache.hasPainted`) path should suppress the fade - check whether these heroes go through a path that bypasses the paint-once session set.
- **Compositor re-raster** when the scrim layer (now a longer-lived, engine-driven layer) is destroyed at unmount - a raster flash rather than a React-level refetch. If so, the finding 3 fix (stable layer policy) may interact.

Diagnostic suggestion for the fix pass: temporarily disable overlayStack's inert application and re-test - it cleanly splits candidate 1 from the rest. `scripts/diag/seam.mjs` exists for frame-forensics if needed.

## Confirmed working (owner)

- Finding 4 path: handle tap closes the sheet (accessible-handle contract) - "Yes, works."
- General direction endorsed: "Nice good looking... we are on the right track."

## Constraints on the fix pass

- Owner decisions in `docs/bottom-sheet-spec.md` section 7 stand (Manuscript values, accessible handle, locked wizard, animate-everywhere, deferred mount ON - though finding 2(b) may qualify HOW deferred mount is implemented; flag if you want to renegotiate it with the owner).
- The §6 WebView paint rules and the two-element scrim/panel split are inviolable.
- All seven gates must stay green; the fix pass ends with a fresh install (build bump) and a repeat of the owner's 6-step device script from the implementation handoff, plus explicit re-checks of: mid-sheet fast flick dismisses; mid-open grab; RefineSheet at full height; profile-sheet close with YOUR DECKS on screen.

## Questions for Codex

1. Do you confirm the finding 1b mechanism (gesture-history reset at takeover)? If yes, prescribe the exact measurement contract: displacement baseline, velocity window, and where `MIN_FLICK_DISTANCE` applies.
2. Scrim-on-close: pick (a)/(b)/(c) from finding 1a, with the value (duration/fraction).
3. Mid-open catch: scrim-level grab (2a), earlier full-height mount (2b), or both?
4. Do you confirm layer demotion as finding 3's mechanism, and should the permanent-promotion policy apply to the panel only or also to the scrim?
5. Any verdict on 5b's mechanism, and whether overlayStack's per-change full recompute needs a quieter design (e.g. only touch elements whose state actually changes - it already diffs via the `saved` map, but attribute writes still occur on transitions).
6. Anything else in `sheetMotion.js` / `GothicSheet.jsx` you would fix while we are in there - especially the release-velocity seeding of the snap-back spring (it contributes to the perceived bounce) and the `v = 0` write during drag.
