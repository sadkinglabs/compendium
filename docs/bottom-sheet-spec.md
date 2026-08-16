# Bottom Sheet Specification - the unified primitive

Status: APPROVED AND IMPLEMENTED (2026-08-15). The owner approved the spec and resolved all seven open questions (recorded in section 7); implementation landed the same day: `sheetMotion.js` (spring + gesture engine), `overlayStack.js` (stacking + inert), the rebuilt `GothicSheet.jsx`, the `Sheet`/`BottomSheet` adapter merge, the wizard-chassis migration, the Phase 0 grid-memoization prerequisites, and the global Escape route. Companion evidence document: `docs/bottom-sheet-audit.md`.

---

## 1. Current state summary

**11 distinct open/animate/dismiss mechanisms** exist (audit §1). One canonical chassis (`GothicSheet`) serves all 37 true bottom-sheet call sites through three entry points; the other 10 mechanisms are one-offs (wizard chassis x2 duplicated JSX, centered modal, avatar picker, Play modal family with two hand-rolled bypasses, counter takeover, two separate FAB menu implementations, overflow popover, toasts).

Confirmed root causes of the performance problem, ranked by impact (all survived a refute-by-default verification pass; full mechanics in audit §3):

1. **Open/close state lives at grid roots and tile memoization is defeated.** Opening or closing a sheet re-renders the entire grid behind it in the same commit that starts (or should end) the animation: up to 447 tiles in a Collection set drill (memo defeated by a single unstable `onToggle` closure), 1,109 tiles in the Codex grid (no memo at all, no content-visibility). This also fires on every filter chip tap inside an open Refine sheet. This is the dominant cause of both the heavy open and the close hitch.
2. **Everything mounts in the opening commit, and async content lands mid-slide.** The chassis mounts full content at open; the panel is content-sized, so each Loading-to-content swap re-layouts the animating panel and changes the slide distance itself. AddCardsSheet demonstrably swaps ~130ms into the 280ms window.
3. **No exit animation exists.** Close is an instant unmount that shares its frame with cause 1's re-render. Sheets cannot feel native while close is a teleport plus a jank spike.
4. **Drag position goes through React.** One scheduler pass + render + commit per pointermove frame; the compositor never owns the motion.
5. **Secondary compositor costs**: backdrop-filter stepper buttons (2-14) riding the moving panel force per-frame GPU backdrop re-evaluation; paint-phase shimmer placeholders (~8-12 visible on cold cache) repaint continuously during entrances.

Fidelity against the seven criteria today: GothicSheet fails interruptibility, velocity awareness, rubber banding, and scroll-to-drag handoff outright; passes compositor-only on properties; fails the frame budget in practice (audit §8).

---

## 2. Unified behaviour spec

One motion engine drives everything: a rAF spring loop that writes `transform: translate3d(0, y, 0)` on the panel and a derived opacity on the scrim, and nothing else. All programmatic motion (open, close, snap-back) runs through the same spring so any motion can be grabbed mid-flight with velocity carried. CSS transitions/keyframes are not used for sheet position in the new primitive.

| Parameter | Android (shipping default) | iOS (specified, not yet implemented) | Rationale |
|---|---|---|---|
| Open motion | Spring from y = H (H = panel height), v = 0: mass 1, stiffness 235, damping 31 (critically damped) | Same engine; tune to match cubic-bezier(0.32, 0.72, 0, 1) over 500ms feel (Ionic/vaul's shared iOS constant) | Stiffness/damping derived, not invented: critically damped settle time ~= 4.6/sqrt(k/m) = 300ms, matching what Compose actually ships for sheets (tween 300ms, SheetDefaults.kt). Spring rather than tween because interruptibility requires it (criterion 2) |
| Close motion | Same spring toward y = H, seeded with current velocity (from drag release or interruption) | Same | Velocity carry across interruption is the point of the shared engine |
| Snap-back (failed dismiss) | Same spring toward y = 0, seeded with release velocity | Same | One spring everywhere; no separate curve to drift |
| Reduced motion | Position jumps, scrim fades <= 1 frame | Same | Matches existing `body.reduce-motion` contract (tokens.css:190-198), which already neutralizes sheet motion today |
| Live drag | 1:1, zero easing: y = clamp of finger delta, written via rAF directly to style, never through React state | Same | Criterion 1; vaul and react-modal-sheet both write transforms directly during drag. Fixes confirmed cause 4 |
| Gesture origin (added after device review) | The ORIGINAL pointerdown owns the gesture: `{originY, originP, height}` + the first velocity sample are recorded there, samples accumulate through the tracking phase, and a scroll-handoff takeover RETAINS that history and applies the takeover event immediately so the sheet catches up to the finger | Same | Rebasing at takeover discarded the pre-handoff travel and peak velocity, so mid-sheet flicks failed both dismissal tests and snapped back - the "bounce up" defect (finding 1b) |
| Flick distance basis | Pointer displacement `releaseY - originY`, NOT post-takeover panel movement | Same | Same finding; the projected-position test still uses the panel's ACTUAL current position |
| Rejected-dismissal snap-back | Seed the spring with `min(0, releaseVelocity)` - never carry downward velocity into a snap-back | Same | Carrying positive velocity produced the visible dip-then-rebound (finding 1b). Accepted dismissals still carry full release velocity |
| Dismissal rule | Velocity-projected position: dismiss iff `(y + v x 0.1s) > 0.25 x H`, where v is the release velocity (px/s, positive down) | Same numbers until iOS tuning says otherwise | The projected-position form is what Android View (`top + v x HIDE_FRICTION(0.1)`) and Ionic (`deltaY + v x 1000ms` vs 0.5H) actually use - one test, not two. Projection constant 0.1s is Android's HIDE_FRICTION. Distance fraction 0.25 is vaul's CLOSE_THRESHOLD, chosen over Android's 0.5-of-peek because these sheets are single-detent and mostly short; 0.25 x H keeps slow-drag dismissal reachable on tall sheets |
| Fast-flick override | Dismiss regardless of position when v >= 500 px/s downward and total displacement >= 20px | Same | 500 px/s is Android's DEFAULT_SIGNIFICANT_VEL_THRESHOLD (= vaul's 0.4 px/ms within rounding); the 20px displacement floor is react-modal-sheet's minDragDistance, rejecting twitch taps |
| Velocity measurement | Weighted average of the last ~100ms of pointer samples at release | Same | Matches the projection window; single-sample velocity is noise |
| Rubber band (upward past detent) | `y' = -(1 - 1/(x x 0.55 / H + 1)) x H` for upward overdrag x | Same, c = 0.55 | The canonical iOS coefficient (sourced); replaces today's hard clamp at 0 |
| Scrim opacity (open / drag / snap-back) | `targetOpacity x (1 - y/H)`, linked to position, never to time | Same | Keeps scrim honest during drag, interruption, and settle; a time-based fade desynchronizes the moment a drag begins |
| Scrim opacity (accepted dismissal) | FREEZE at its current value the moment the dismissal is accepted (full for programmatic closes, the current drag value for gesture closes); hold it untouched through the visible travel; begin a **90ms** fade once the panel passes **90%** of its travel; unmount when both finish | Same | Owner ruling + Codex refinement (finding 1a): "close is the sheet coming down", not a fade. Freezing the CURRENT value avoids re-darkening a partially-dragged sheet on release. The 90%-tail fade start comes from device pass 2 (below): holding the dim until the panel had *fully* settled left the screen dimmed after the sheet was already gone |
| Close leg target | Spring aims at **1.25**, and the close completes the moment the panel reaches 1.0 | Same | Device pass 2 fix. A critically damped spring approaches its target asymptotically: aiming at exactly 1.0 put the panel visually off-screen at ~200ms but only satisfied the settle test (`abs(p-1) < 0.001` AND `abs(v) < 0.01`) at ~430ms - a quarter-second of dead time with nothing moving and the screen still dimmed. Aiming past the exit puts the visible travel on the fast early part of the curve and makes `p >= 1` arrive in finite time. Nothing is visible past 1.0; the extra 25% only shapes the curve. Measured: off-screen 192ms, dim lifting from 176ms, screen fully back at **256ms** (was ~530ms) - and M3 puts a sheet exit at 200ms (short-4, emphasized-accelerate) |
| Scrim value | `var(--scrim)` (today rgba(8,5,3,.6)); every sheet uses the token | iOS same token | One of six scrim literals already is this token; the other five collapse into it (audit §5). M3's 0.32 is noted in Open Question 1 - the Manuscript scrim is deliberately darker and that is an owner call |
| Scrim blur | None on sheets, ever | None | The counter already bans it for per-frame re-rasterisation cost (counter.css:921-924); a blur scrim under a moving panel is the same hazard |
| Detents | Single detent: content-sized, capped `min(88dvh, 100dvh - safe-top - 12px - kb)` | iOS column reserved for medium/large if ever wanted; not specified now | All 37 call sites are content-sized modal sheets; inventing detents nobody uses adds gesture states for nothing |
| Drag surface | Entire sheet (handle, header, and body via the handoff state machine in §3) | Same | Handle-only drag with a ~19px grab zone is the current failure; body drag is what makes dismissal discoverable |
| Handle | 32 x 4px bar, `--gold-handle` token (minted from today's #5a4a28), centered, within a >= 48px-tall touch region | Same geometry | 32x4 is the M3 handle spec; 48px region is the M3/48dp minimum the current 19px zone violates. Always rendered on dismissible sheets - it is the affordance signal |
| Corner radius | 30px top, minted as `--radius-sheet` | Same token, iOS may retune | Keeps the established Manuscript value (M3 says 28; the 2px delta is not worth a visual change across 37 sheets - Open Question 1 if the owner prefers spec purity) |
| Elevation | Single minted shadow token `--shadow-sheet: 0 -20px 50px -10px rgba(0,0,0,.5)` | Same | Today's GothicSheet value, promoted to a token; the wizard's .6-alpha variant collapses into it |
| Panel ground | `var(--surface-sheet)` - the existing token finally gets its consumers | Same | The token exists with zero consumers today; GothicSheet's flat #100c08 and the wizard's duplicate gradient both migrate to it (owner may pick which value the token holds - Open Question 1) |
| Hairline | One gold family, tokenized | Same | Two gold families are in use on sheet hairlines today (audit §5); pick one (Open Question 1) |
| z-index | Sheets 200; stacked sheets get explicit +1 per stack level from the sheet host | Same | Replaces the DOM-order accident (audit §1) with a contract |
| Android back | Dismiss request routed through the existing LIFO back-consumer stack; plays the close motion | n/a (iOS has no back button; edge-swipe not specified) | The three-tier back architecture is sound (audit §4); the primitive keeps registering exactly as GothicSheet does today |
| Escape key | Closes the top dismissible sheet | Same | Fixes a confirmed accessibility gap; costs one keydown listener |
| Keyboard/IME | `marginBottom: calc(var(--kb)/var(--ui-scale))` + kb-aware maxHeight, unchanged | iOS: same vars once the keyboard plumbing exists there | The existing `--kb`/`body.kb-open` mechanism is correct and device-proven; do not touch it |
| Safe areas | Bottom inset padded inside the scroll body; top inset respected in maxHeight, unchanged | Same | Current behaviour is correct |

### Hard implementation constraints (carried over from device-proven WebView lessons; violating any of these is disqualifying)

1. **Two-element split stays**: scrim element animates opacity only; panel element carries the transform (GothicSheet.jsx:30-37 documents the deferred-paint bug the split works around).
2. **The scroll body stays an opaque, self-compositing scroller** (`translateZ(0)` + opaque background), or the panel blanks under a nested scroller on Android WebView (GothicSheet.jsx:55-60).
3. **Transform and opacity only**, on those two elements only, every frame of open/drag/close. No height, top, margin, or layout property is ever animated.
4. **Never a transform animation and overflow scroll on the same element** (webview-sheet-paint gotcha; the split above also enforces this).
5. **Never hand-write the -webkit-backdrop-filter pair in CSS files** (minifier gotcha); irrelevant to sheets once rule 6 applies, but recorded.
6. **No backdrop-filter anywhere inside the panel or on the scrim** (confirmed per-frame GPU cost while the panel moves; the stepper buttons must lose their blur or get an opaque ground before/while migrating).
7. **REVISED 2026-08-15 after device evidence (review finding 3): the panel's layer stays promoted for its entire mounted life.** `will-change: transform` is set on mount and never removed, the engine writes `translate3d(0, y, 0)` during motion, and the panel settles at a written zero transform rather than a cleared one. The original rule (transient hints, per web.dev's layer-count guidance) demoted the layer at the exact frame the sheet reached the top, and the Android WebView showed a partial raster - the owner reproduced it on the Refine sheet at full height. The previously device-proven chassis promoted permanently too; this is that lesson re-learned. Bounded cost: sheets are few (at most two stacked) and short-lived, so the layer count stays trivial. The scroller keeps its own permanent `translateZ(0)`; the scrim is NOT promoted (it only needs its opacity lifecycle).
8. **Exit animation is mandatory**: the primitive stays mounted through the close motion (phase machine like CardArtViewer's) and unmounts only after settle. The unmount commit must not share a frame with the close motion's start.

### Deferred content mount (fixes cause 2 at the chassis level)

The primitive mounts its shell (scrim, panel, handle, pinned header) in the opening commit but renders `children` only after the first animation frame has been scheduled (one rAF tick), and exposes `onSettled` so heavy consumers can defer data-triggered swaps until the motion is done. Consumers keep their Loading states.

**Correction (2026-08-15, Codex review):** an earlier draft of this section claimed the panel "opens at a stable initial height (last-known or min-height)". That is NOT implemented and no height cache exists - the `initialHeight` prop shipped with zero callers and has been removed. The panel is content-sized throughout, and because the engine animates a PERCENTAGE translate, a mid-slide height change stays bottom-anchored and coherent rather than jumping. A height cache will only be introduced if device evidence shows height-changing motion is actually visible.

Note honestly: the biggest confirmed cost (cause 1) is not fixable inside the primitive - it requires stabilizing the grid callbacks (`useCallback` on `toggleSel` in Collection, memoizing the Codex grid rows) and is listed as migration phase 0 because no sheet will meet the frame budget while a 447-tile reconcile shares its commit.

---

## 3. The gesture state machine

States: `CLOSED`, `OPENING`, `OPEN`, `TRACKING_SCROLL`, `DRAGGING`, `SETTLING_OPEN`, `CLOSING`, `FADING`.

All motion states (`OPENING`, `SETTLING_OPEN`, `CLOSING`) are the same spring loop with different targets; they differ only in what happens on completion and how new pointers are treated.

| From | Event | Guard | To | Effect |
|---|---|---|---|---|
| CLOSED | `open=true` | - | OPENING | Mount shell; spring toward y=0 from y=H; scrim tracks y; children mount next rAF tick |
| OPENING | spring settles | - | OPEN | `onSettled`; drop will-change on next idle |
| OPENING | pointerdown on panel | - | DRAGGING | **Interruption**: read current y from the spring (not the DOM), kill the spring, carry its velocity into the drag |
| OPEN | pointerdown on handle/header | - | DRAGGING | Begin drag at y=0 |
| OPEN | pointerdown on scroll body | - | TRACKING_SCROLL | Record the gesture ORIGIN (position, panel height, first velocity sample), `scrollTop` at down, and the last-scroll timestamp; keep sampling while tracking |
| OPENING / SETTLING_OPEN / CLOSING (gesture) | pointerdown on the SCRIM | dismissible | DRAGGING | Catch a moving sheet from the scrim, so an entrance is grabbable before the panel is tall enough to land a finger on. Refused once OPEN - the scrim is then tap-to-dismiss only, never an air-drag surface (finding 2) |
| TRACKING_SCROLL | pointermove | `scrollTop at down == 0` AND first accumulated move is downward AND displacement >= 10px (activation slop, Ionic) AND no scroll event within the last 100ms (vaul's scroll-lock cooldown) | DRAGGING | Take the gesture WITHOUT resetting its origin or samples, and apply the takeover event immediately so the sheet catches up to the finger |
| TRACKING_SCROLL | pointermove | any guard fails | (stay) | Native scroll proceeds untouched; the state machine never re-enters DRAGGING for this pointer - mid-scroll drags must not steal |
| TRACKING_SCROLL | pointerup | - | OPEN | Nothing happened |
| DRAGGING | pointermove | y >= 0 | (stay) | `y = downY + delta`, written via rAF, 1:1, no easing |
| DRAGGING | pointermove | delta would take y < 0 | (stay) | Rubber band: `y = -(1 - 1/(x x 0.55/H + 1)) x H` for overdrag x |
| DRAGGING | pointerup / pointercancel | `(y + v x 0.1) > 0.25H` OR (`v >= 500 px/s` AND displacement >= 20px) | CLOSING | Spring toward y=H seeded with v; swallow the next synthetic click (existing one-shot swallower behaviour) |
| DRAGGING | pointerup / pointercancel | otherwise | SETTLING_OPEN | Spring toward y=0 seeded with v |
| SETTLING_OPEN | pointerdown on panel | - | DRAGGING | Interruption, velocity carried |
| SETTLING_OPEN | spring settles | - | OPEN | - |
| CLOSING | pointerdown on panel | sheet still dismissible | DRAGGING | Interruption: a closing sheet can be caught and redirected |
| CLOSING | panel passes 90% of travel | - | FADING | Scrim begins a 90ms fade from its frozen value while the panel finishes clearing |
| FADING | panel reaches 100% AND the fade completes | - | CLOSED | `onClose` commit: unmount, restore focus, unregister back consumer |
| CLOSING / FADING | pointerdown (gesture close only) | dismissible, fade not yet begun | DRAGGING | Catching a closing sheet cancels the pending fade and makes it live again |
| any open state | scrim tap | dismissible | CLOSING | - |
| any open state | hardware back (LIFO consumer fires) | dismissible | CLOSING | Consumer returns true either way; a non-dismissible sheet consumes and no-ops (today's contract) |
| any open state | Escape keydown | dismissible, sheet is topmost | CLOSING | - |
| any open state | `open=false` from caller | - | CLOSING | Programmatic close plays the same motion |
| any state | `prefers-reduced-motion` / `body.reduce-motion` | - | - | Springs resolve in <= 1 frame; drag still tracks 1:1 (direct manipulation is exempt, matching current convention) |

Pointer bookkeeping: primary pointer only; multi-touch ignores secondary pointers. Given the documented dangling-capture bug (useSheetDrag.js:19-21), the implementation uses window-level move/up listeners rather than `setPointerCapture` unless the panel provably outlives the gesture in the new mounted-through-close lifecycle (it does - the phase machine keeps the element alive - so capture MAY be revisited, but the window-listener approach is the proven default). `touch-action: none` on handle/header; the scroll body keeps native `touch-action` plus `overscroll-behavior: contain` (currently missing, audit §4).

Every dismissal path converges on `CLOSING`; there is exactly one way a sheet leaves the screen.

---

## 4. Platform-adaptive strategy

One primitive, one values table (§2) with an Android column that ships and an iOS column specified now so the port is a values change. Platform is resolved once (Capacitor `getPlatform()`) into a frozen values object; nothing branches at render time.

Behaviour that genuinely cannot be shared (documented platform branches, not values):

1. **Hardware back / predictive back** exists only on Android; the back-consumer registration is a platform branch already isolated in `native.js` today. iOS gets nothing (its dismiss affordances are drag, scrim, Escape-equivalent none).
2. **Presenting-view scale-back** (iOS sheets recede the underlying view; Ionic uses scale 0.915): this animates the app root behind the sheet, which on Android WebView means transforming the pillar container that GothicSheet deliberately portals out of. Specified as iOS-only and OFF by default (Open Question 6); if adopted it must be transform-only on the `.cx-app` layer.
3. **Keyboard plumbing**: the `--kb` visualViewport mechanism is Android-tuned (adjustNothing). iOS keyboard behaviour must be re-verified on device when the port happens; the CSS contract (margin + maxHeight vars) is shared.
4. **Status/system bars**: SystemBars insets handling is Android config; the safe-area env() usage is shared.

Everything else - state machine, springs, thresholds, rubber band, scrim link, a11y contract - is shared code with per-platform constants.

---

## 5. API design for the shared primitive

Working name `SheetV2` during migration; it replaces GothicSheet and both adapters, ending at one exported component plus one host.

```jsx
<SheetHost/>                    // mounted once in App inside .cx-app; owns portal target,
                                // stack order (z = 200 + index), scrim dedup for stacks,
                                // and the Escape listener for the topmost sheet

<Sheet
  open={bool}                   // controlled, as today
  onClose={fn}                  // request-close; fires when CLOSING commits
  label="Add to Wishlist"       // REQUIRED aria-label (no more 'Dialog'/'Sheet'/'Card' defaults)
  title={node?}                 // pinned header title (Manuscript Cinzel treatment built in)
  header={node?}                // custom pinned header region (replaces title row when given)
  footer={node?}                // pinned footer row (Sheet adapter parity)
  dismissible={bool=true}       // false: no scrim/drag/back/Escape close, back still consumed,
                                // handle hidden (today's in-flight-write contract)
  busy={bool?}                  // aria-busy passthrough (today's prop)
  onSettled={fn?}               // open motion finished; heavy consumers defer data swaps to here
  initialHeight={px?}           // optional stable opening height to prevent mid-slide re-layout
                                // (defaults to content-sized, capped as today)
  bodyClass={string?}           // BottomSheet adapter parity (Collection uses it)
  bodyStyle={object?}           // escape hatch used by current direct consumers
>
  {children}                    // rendered into the managed scroll body (the primitive owns
                                // the scroller: opaque, translateZ(0), overscroll-contain,
                                // safe-area padding, scrollTop readable for the handoff)
</Sheet>
```

Internally owned, not props: portal target, z-index, scrim (token), handle, drag, springs, focus trap + restore, background `inert` (CardArtViewer's proven pattern, applied to sibling subtrees of the host), back-consumer registration, Escape, keyboard margin, reduced motion, the post-drag click swallower.

### Coverage check against all 37 call sites + adjacent chassis (from the audit inventory)

| Call-site class | Count | Covered by | Notes |
|---|---|---|---|
| `Sheet` adapter sites (title + optional footer, pinned header) | 16 | `title` + `footer` | Direct mapping; ConfirmHost included |
| `BottomSheet` adapter sites (title scrolls with body today) | 17 | `title` | Deliberate behaviour change: titles become pinned. DESIGN_SYSTEM.md:91 already flags this merge as pending; visual QA per sheet needed |
| CardSheet / CollectionCardSheet (custom art header, no title, stacking, busy) | 2 | `header`/bare children + `busy` + host stacking | Heaviest content; also need `onSettled` for their data swaps. WantPrintingSheet stacks above via the host |
| RefineSheet / CollectionRefineSheet (2-page bodies, steppers) | 2 | bare children + `bodyStyle` | Steppers must lose backdrop-filter (constraint 6) |
| `dismissible={false}` users (in-flight writes: Collection.jsx:544, 1457; App restore) | - | `dismissible` | Contract preserved exactly, including back consumption |
| `.ob-overlay` wizard chassis (CreateDeckWizard, ChangeAvatarSheet) | 2 | `title`/`header` + `footer` | Migrating them onto the primitive gives them the focus trap, back consumer (closing the confirmed back hole), real drag, and exit animation they lack. The wizard's multi-step body is plain children |
| Not covered, by design | - | - | CenteredModal (centered geometry, different concept), the Play VModal family incl. the 180-degree rotated opponent variant (`vc-modal-in-rot`), `#counter-screen`, FAB menus, OverflowMenu, toasts, CardArtViewer. None are bottom sheets. Flagged so nobody bends the primitive into a modal system |

No call site was found that the API cannot express; the two behaviour changes (pinned titles on the 17 BottomSheet sites, exit animation everywhere) are intentional and listed for owner sign-off.

---

## 6. Migration plan (ordered by risk)

**Phase 0 - prerequisites, no primitive yet (the perf floor).** Stabilize `toggleSel` with `useCallback` in Collection (`Collection.jsx:919, 1120`) and memoize the Codex grid rows (mirror the AzList pattern, `Codex.jsx:410-452`). Without this, no sheet meets the frame budget regardless of motion engine, because the open/close commit carries a 447-1,109-component reconcile. Independently verifiable with React profiler counts. (Moving `filterOpen` out of `useCollectionRefine` is a larger refactor; the callback fix alone breaks the tile cascade and is the low-risk cut.)

**Phase 1 - build `SheetV2` + `SheetHost` behind a flag.** Prove it on the two lowest-risk, self-contained sheets: Rename Deck (`DecksPager.jsx:295`) and Export Deck (`:440`). Device-verify the seven fidelity criteria, the WebView paint constraints (frame-forensic recording loop, agent-run per the device-test convention), zero-image mode, and TalkBack exit paths.

**Phase 2 - the 16 `Sheet` adapter sites.** Mechanical prop mapping; ConfirmHost last in this phase (it stacks over anything, so it exercises the host's stack contract).

**Phase 3 - the 17 `BottomSheet` sites.** Same mapping plus the pinned-title visual change; per-sheet screenshot pass. Collection's `dismissible:false` writers get explicit regression attention.

**Phase 4 - the 4 direct consumers (hardest).**
- `RefineSheet`/`CollectionRefineSheet`: stepper backdrop-filter removal (visual sign-off needed).
- `CollectionCardSheet`: hardest overall - stacking (WantPrintingSheet), four async arrivals to re-time onto `onSettled`, the busy contract, and its art header. Do it with `initialHeight` + deferred swaps.
- `CardSheet`: same shape, plus FitText's double layout cycle should be re-keyed off `onSettled`.

**Phase 5 - the `.ob-overlay` chassis.** CreateDeckWizard and ChangeAvatarSheet onto the primitive; deletes the duplicated JSX and closes the ChangeAvatarSheet back hole. Risk is the wizard's mandatory-2-step flow interacting with `dismissible` semantics (wizard is currently non-scrim-dismissible by omission - decide deliberately, Open Question 5).

**Phase 6 - cleanup.** Delete GothicSheet, `Sheet`, `BottomSheet`, `useSheetDrag`, the wizard chassis CSS; mint the tokens (`--radius-sheet`, `--shadow-sheet`, motion constants) in tokens.css; update DESIGN_SYSTEM.md (chassis section), FEATURE_MATRIX rows, and fix the two false comments (`App.jsx:341-342` Escape claim, `WantPrintingSheet.jsx:1-5` DORMANT claim).

Explicitly out of scope for the primitive (tracked separately): the horizontal-swipe leak fix (add the sheet class to `useSwipe`'s exclusion list or gate on an open-sheet signal - one-line class of fix, but it is app code outside the primitive), the LifeCounter modal family's a11y, and the Codex-grid hotspot beyond the phase 0 memoization.

Flagged call sites the primitive cannot express: none found (the not-covered rows in §5 are non-sheets by design).

---

## 7. Open questions - RESOLVED (owner decisions, 2026-08-15)

Decisions as given: (1) Manuscript wins - 30px radius, `--scrim` as-is, gold handle; chrome standardizes on the GothicSheet look (gilt hairline + flat #100c08, promoted into `--surface-sheet`). (2) Accessible handle - the drag handle is a screen-reader "Close" button, Escape added; no visible X. (3) No body-drag opt-out prop. (4) Deferred content mount is ON by default. (5) Wizard is locked - dismissible=false, X only, back consumed. (6) iOS presenting-view recede: decide at port time. (7) Exit motion animates everywhere, no exceptions.

The original questions follow for the record.

1. **Manuscript vs Material values.** The spec keeps the app's identity where it conflicts with M3: 30px radius (M3: 28), scrim rgba(8,5,3,.6) (M3: black at 0.32), gold handle (M3: onSurfaceVariant at 0.4). Confirm identity wins, or pick M3 purity per value. Also: which gold family for the hairline, and which value `--surface-sheet` should hold (flat #100c08 vs the documented gradient).
2. **Close affordance posture.** Chassis currently has no close button by deliberate decision (Sheet.jsx:4-5). The spec adds Escape and background inert, and dismissal stays scrim/drag/back. TalkBack users still have no in-sheet exit on CardSheet/CollectionCardSheet unless we either (a) expose the handle as an accessible "Close" button (screen-reader-only semantics, no visual change) or (b) restore a visible X. The audit recommends (a) as the minimum; your call between (a) and (b).
3. **Body-drag scope.** The spec makes the whole sheet draggable via the handoff machine. If any specific sheet's content conflicts (e.g. future horizontal gestures inside a sheet), it needs a per-sheet opt-out prop - none identified today; confirm none is wanted.
4. **Deferred content mount default.** Shell-first mounting (children one rAF later) changes when consumer effects fire by one frame. Default ON for all migrated sheets, or opt-in per sheet during migration?
5. **Wizard dismissibility.** CreateDeckWizard currently cannot be scrim-dismissed (omission, not documented intent). On the new primitive: dismissible with confirm, or `dismissible={false}` semantics? (Avatar wizard is a mandatory 2-step flow per the Decks spine design.)
6. **iOS scale-back.** When the iOS port happens, should the presenting view recede (Ionic's 0.915) - a genuine platform branch touching the app root - or is a plain sheet enough? Decision can wait, but the spec reserves it.
7. **Exit-motion exceptions.** Every sheet gains a ~200-300ms close animation. Any sheet where instant close is actually wanted (e.g. ConfirmHost after a destructive confirm, where the user expects the action's result immediately)?
