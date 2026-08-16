# Bottom Sheet Audit - Raw Findings

Investigation date: 2026-08-15. Read-only audit: seven parallel agents (inventory, implementation forensics, performance, gesture/platform, design, accessibility, external reference), followed by a refute-by-default verification pass in which six independent skeptics re-traced every significant claim. Only findings that survived verification are stated as fact; refuted or corrected parts are recorded inline. Companion document: `docs/bottom-sheet-spec.md` (the unified specification).

Verdict legend: **CONFIRMED** = skeptic independently re-traced the code path and the mechanism holds. **PARTIAL** = the core finding holds but a stated mechanism or magnitude was corrected. **INFERENCE** = plausible, not proven from source.

---

## 1. Inventory (verified count)

**11 distinct open/animate/dismiss mechanisms** exist in `src/`. CONFIRMED by independent re-count and a completeness sweep (position:fixed / createPortal / keyframes / z-index audit found no missed dismissible surface).

| # | Mechanism | Definition | Kind | Drag | Exit anim | z |
|---|---|---|---|---|---|---|
| 1 | **GothicSheet** (canonical chassis) | `src/components/GothicSheet.jsx:17-85` | bottom sheet, portal to `.cx-app` | yes (handle/header only) | none | 200 |
| 2 | CenteredModal | `src/components/ui.jsx:238-257` | centered modal, no portal | no | none | 700 |
| 3 | `.ob-overlay` wizard chassis | CSS `src/theme/decks.css:177-179`; JSX duplicated at `CreateDeckWizard.jsx:58` and `DeckDashboard.jsx:460` | bottom sheet look-alike | no (handle decorative) | none | 400 |
| 4 | `.cx-picker-modal` (pre-match avatar picker) | `App.jsx:608-616`, `tokens.css:499-505` | centered modal | no | none | 300 |
| 5 | CardArtViewer | `CardArtViewer.jsx:304-315` | full-screen stage, portal to body | tilt only | **yes** (180ms phased) | 900 |
| 6 | VModal `.vc-modal-overlay` | `LifeCounter.jsx:902-916`; hand-rolled bypass copies at `:1068` (EndModal) and `:1136` (ShareQRModal) | centered modal | no | none | 120-140 |
| 7 | `#counter-screen` takeover | `LifeCounter.jsx:728`, `counter.css:43` | full-screen takeover | no | none | 100 |
| 8 | Fab menu + `.fab-scrim` | `Fab.jsx:132-151`, `decks.css:151-160` | anchored menu + scrim; **stays mounted** | no | **yes** (reversed transition) | 110 |
| 9 | LifeCounter hand-rolled FAB menus | `LifeCounter.jsx:760-766, 822-837`, `counter.css:501-557` | anchored menus, scale morph, no scrim, no portal | no | none | under Play modals |
| 10 | OverflowMenu | `OverflowMenu.jsx:77-211` | anchored popover | no | none | 60 |
| 11 | ToastHost | `FeedbackHosts.jsx:12-48`, `tokens.css:419-425` | top-edge toast | no | **yes** (`cxToastOut`) | 700 |

Borderline fixed overlays that are not dismissible surfaces (correctly excluded): AlphabetRail scrub preview (`AlphabetRail.jsx:304-312`), `.roll-lock` tap catcher (`LifeCounter.jsx:846-849`, part of mechanism 7), persistent chrome (nav, dock, match clock, roll pill).

### GothicSheet call sites - exactly 37 (independently re-counted)

- **Direct (4):** `CardSheet.jsx:82`, `CollectionCardSheet.jsx:508`, `CollectionRefineSheet.jsx:56`, `RefineSheet.jsx:138`
- **Via `Sheet` adapter (`Sheet.jsx:13`) - 16:** `App.jsx:913` (Profile), `Codex.jsx:139` (Article Filters), `DeckDashboard.jsx:258` (Curiosa sync), `DecksPager.jsx:295` (Rename), `:359` (Add from text), `:440` (Export), `:519` (Deck Spread), `Decks.jsx:63` (Import Curiosa), `:136` (Import Text), `Play.jsx:337` (Edit match), `:511` (Add Record), `:616` (Import result), `Home.jsx:407` (Layouts), `:590` (Add Widget), `:641` (Configure widget), `FeedbackHosts.jsx:62` (app-wide Confirm)
- **Via `BottomSheet` adapter (`ui.jsx:225-232`) - 17:** `CollectionPicker.jsx:21`, `Collection.jsx:259, 387, 544, 819, 1268, 1392, 1457, 1527, 2276, 2291, 2301`, `CodexDetail.jsx:465, 551`, `MissingSheet.jsx:54`, `WantPrintingSheet.jsx:74`, `TriageSheet.jsx:102`

### Stacking (CONFIRMED)

Two GothicSheets can be open simultaneously at the same z-index 200: WantPrintingSheet over CollectionCardSheet (`CollectionCardSheet.jsx:491`), and ConfirmHost (`FeedbackHosts.jsx:62`, mounted app-wide `App.jsx:675`) over any of the 37 sheets. Paint order falls to DOM order in the `.cx-app` portal target - the later-opened sheet's node is appended later. This works today by accident, not by contract. Back order is correct via the LIFO consumer stack (`back.js:18-23`). Cross-mechanism stacks that are deliberate: Settings (CenteredModal z-700) over ProfileSheet (z-200) at `App.jsx:624-627`; ShareQR (z-140) over End screen (z-120).

---

## 2. Implementation forensics

**No libraries.** `package.json` has no sheet, animation, gesture, or headless-UI dependency of any kind. Everything is hand-rolled with inline styles + CSS keyframes.

### GothicSheet chassis

- **Two-element split** (comment `GothicSheet.jsx:30-37`): outer fixed scrim animates opacity only (`cxfade .2s ease`, `tokens.css:526`); inner panel carries transform (`cxsheet .28s cubic-bezier(.2,.9,.3,1)`, translateY(100%) to 0, `tokens.css:542`). The split is the documented workaround for the Android WebView deferred-paint bug (nested scroller stays blank until scroll).
- Panel is bottom-anchored via `marginTop:'auto'`, content-sized under `maxHeight: min(88dvh, calc(100dvh - safe-top - 12px - var(--kb)/var(--ui-scale)))` (`GothicSheet.jsx:47,51`). Keyboard lift via `marginBottom: calc(var(--kb)/var(--ui-scale))`.
- **Mount/unmount on toggle**: `if (!open) return null` (`GothicSheet.jsx:25`). Entrance keyframes play on mount; **there is no exit animation** - close is an instant unmount. CONFIRMED: the only overlays in the app with a real exit are the FAB menu (reversed transition), toasts (`cxToastOut`), and CardArtViewer (180ms phased exit).
- Portal to `.cx-app` (`GothicSheet.jsx:29,85`) to escape the pillar slide-pane's transform. `.cx-app` is the root stacking context (`tokens.css:224`).
- **Compositor hints are permanent, not transient**: `willChange:'transform'` on the panel (`:52`) and `translateZ(0)` + `WebkitOverflowScrolling:'touch'` on the scroll body (`:73`) are on for the sheet's whole lifetime. The opaque self-compositing scroller is the fix for the panel background failing to paint under a nested scroller (comment `:55-60`). No `contain` anywhere on sheets.
- **Drag-to-dismiss exists** (`useSheetDrag.js`): pointer events on the grab zone (handle/header only, never the body); move/up on `window`; deliberately no `setPointerCapture` (a capture dangling after unmount swallowed the next tap, `:19-21`); downward only; **per-move `setDy` drives a React re-render** that writes `transform: translateY(dy)` inline (`:51`); release past a fixed **92px threshold** closes, otherwise spring-back via CSS transition `.26s cubic-bezier(.34,1.2,.64,1)` (`:52-53`); a one-shot capture-phase click swallower eats the post-drag synthetic click (`:6-12`). No velocity measurement anywhere.
- Adapters: `Sheet` (`Sheet.jsx:13-29`, pinned header + footer) and `BottomSheet` (`ui.jsx:225-232`, title scrolls with body). Both are pure pass-throughs; correctly counted as call sites, not mechanisms.

### Divergent chassis facts worth carrying forward

- The `.ob-overlay` wizard chassis uses a **different** entrance (`.32s cubic-bezier(.34,1.2,.64,1)` vs GothicSheet's `.28s (.2,.9,.3,1)`), has a decorative handle with no pointer handlers, no portal, no focus trap, no back consumer.
- CenteredModal's box has **no entrance animation at all** - only the scrim fades. Its scrim is the only one with backdrop-filter blur (6px).
- The counter deliberately bans scrim blur (comment `counter.css:921-924`): blur over the counter's infinite pulse animations would force full-screen re-rasterisation per frame.
- CardArtViewer is the only overlay with a genuine phase machine (`preparing/entering/open/exiting`), choreographed FLIP exit, and full a11y (see §6).
- App-wide z ladder: nav 40 < FAB dock 50 < OverflowMenu 60 < counter 100-140 < FAB scrim 110 < GothicSheet 200 < avatar picker 300 < wizard 400 < CenteredModal/toasts 700 < CardArtViewer 900.

---

## 3. Performance - verified root causes, ranked by impact

Every cause below survived an adversarial refutation pass. Corrections from that pass are stated inline. The animated properties themselves are compositor-safe (verified negative: opacity scrim / transform panel, size-reserved images, passive listeners where relevant, no body-scroll-lock hacks). The jank comes from what shares the frame with the animation.

### P1. Sheet open/close state lives at grid roots and tile memoization is defeated - the full grid re-renders in the same commit that starts the sheet animation. PARTIAL (cascade CONFIRMED, one mechanism corrected)

- `sheetCard` lives at the Collection root (`Collection.jsx:102`, sheet at `:184`). `Cards` and `AllCards` are not memoized, so `setSheetCard` re-renders the whole active surface in the commit that mounts the sheet (React 19.2.8, no compiler, no bail-out - verified against `vite.config.js`).
- The set drill renders **every card of a set uncapped** (`Collection.jsx:995-1021`); real set sizes from `public/catalog/cards.json`: Gothic 447, Alpha 413, Beta 411. `AllCards` renders a progressive prefix (100/batch, `useProgressiveRender.js:22`) of 1,584 printing rows.
- `BinderTile` **is** `React.memo` (`CollectionCardViews.jsx:229`) but the memo is defeated by exactly one prop: `onToggle={toggleSel}`, a plain arrow re-created every render (`Collection.jsx:919` passed at `:1017`; `AllCards` `:1120` at `:1165`). Every other prop was verified identity-stable. So every rendered tile body re-executes on every sheet open AND close.
- **Refuted mechanism:** the original claim of per-tile `JSON.parse(card.variants)` is wrong. `artForSet` (`CollectionCardViews.jsx:33-41`) takes the `_variants` fast path because the catalog cache pre-parses once per session (`catalogCache.js:59`) and all row paths share those frozen rows. The repeated per-tile cost is variants filter/find, a regex test, object spread, `playsetOf`, and vdom reconcile - real but far lighter than parse-per-tile.
- Tiles have `contentVisibility:'auto'` (`:245`), which skips off-screen layout/paint but not the JS render pass.
- The in-repo counter-example proving this is a local defect, not a framework tax: `DeckAddCards.jsx:98-117` keeps callbacks referentially stable precisely so memo skips all rows.

### P2. Codex card grid: 1,109 unmemoized tiles reconcile on every sheet toggle and every chip tap. CONFIRMED

- `filterSheet` lives at Codex root (`Codex.jsx:57`). In grid view the browse list maps **all** entries inline with no memo, no cap, no virtualization (`Codex.jsx:169-179`); unfiltered pool is exactly 1,109 cards (`getCodexCards`, `codexRepository.js:123-135`).
- `.cx-card-tile` has **no** `content-visibility` (`tokens.css:395-397`; the only grid-adjacent rule is scoped to the A-Z list, `:524`), so this is a full 1,109-component render + reconcile per state change at the root - twice per sheet open/close cycle, and again on **every** filter chip tap inside the open sheet (`setCEls`/`setCur` at `:129, :133-137`).
- Correction from verification: effects and reducers do NOT re-fire in `CardArt`/`useArtSource` (deps unchanged); the cost is the render/reconcile pass itself, synchronous in one commit, coinciding with the sheet's entrance.
- The list view is protected (rows built in `useMemo` keyed `[entries, onOpen]`, `Codex.jsx:410-452`, plus `content-visibility` `tokens.css:524`); the grid genuinely has neither protection.

### P3. Refine sheet state lives inside the grid's data hook. PARTIAL (cascade CONFIRMED, debounce coupling corrected)

- `filterOpen` sits inside `useCollectionRefine` (`useCollectionRefine.js:47`), consumed by `Cards` (`Collection.jsx:879`) and `AllCards` (`:1080`), so opening the Refine sheet re-renders the whole grid (through the P1 memo defeat). Every chip tap inside the open sheet calls setters from the same hook instance (`:1063-1070`, `:1212-1219`), re-rendering grid + tiles per tap. Ownership-axis changes additionally recompute `groupCollection` synchronously (`useCollectionRefine.js:125-127`); in the set drill that is ≤447 rows, in ALL scope ~1,584 printings.
- **Refuted detail:** ownership axes do NOT trigger the 130ms debounced pool reload - `loadPool`'s deps (`:66`) are the catalog axes (q/element/type/rarity/multi/artist) only. The debounced `getPool` + second groups recompute belongs to catalog-axis chips.

### P4. Mount-everything-at-open chassis + content-sized panel = mid-animation reflow storms. CONFIRMED (mechanism); mid-window timing is code-proven only for AddCardsSheet

- Chassis fact: all content mounts in the opening commit (`GothicSheet.jsx:25`); the panel is content-sized and bottom-anchored (`:47,51`), and `cxsheet`'s translateY(100%) resolves against panel height, so any content-height change mid-animation both re-layouts the panel and changes the slide's remaining travel.
- **AddCardsSheet** (`Collection.jsx:1488-1498`): fetches the entire catalog on open (empty query passes every `getPool` filter, `deckRepository.js:380-393`; served from the in-memory cache so the fetch itself is cheap), renders up to 80 rows (`ADD_SHEET_RENDER_CAP`, `:1481, :1551`) each mounting a `CardArt` img. The explicit `setTimeout(..., 130)` (`:1491`) floor-bounds the Loading-to-80-rows swap at ~130ms after open - inside the 280ms slide (final step inference, floor is code). Mitigations verified: rows carry `contentVisibility:'auto'` (`:1557`) so only ~8-12 visible rows paint; `loading="lazy"`; warm art cache resolves synchronously.
- **CollectionCardSheet**: one true subtree replacement (Loading stub to full CardBody when `getCard` lands, `:503-513`), which substantially resizes the animating panel; then `ownedSetsForCard` + `wantedItemsForCard` + two store subscriptions (`:266-272, :336-342`) land sequentially after the swap - ordinary re-renders, though the default-set dispatch (`:302-309`) can swap the displayed printing/art. Correction: "4 content-replacing re-renders" overstated three of the four. `CardSheet.jsx:46-60` is the same shape with three chained fetches.
- **DeckSpreadSheet** (`DecksPager.jsx:476-507`): `getDeckCards` on open then one img per distinct card. Correction: the 60-90 per-copy figure only exists after the user taps Shuffle - post-animation, cannot land mid-slide.
- Whether SQLite-backed promises resolve inside 280ms is INFERENCE everywhere except the AddCardsSheet floor.

### P5. Drag tracks through React, not the compositor. CONFIRMED

- `useSheetDrag.js:29-32,44`: `setDy` per pointermove; each move is its own task (React 19 batching does not merge across tasks), Chromium aligns pointermove to display refresh, so it is one scheduler pass + one GothicSheet render + commit per frame at up to 120Hz. Children genuinely bail (identical element references); what runs per frame is the chassis body, inline style diffing, and the commit that writes `transform`. There is no compositor-driven motion during active drag; position originates on the JS main thread every frame. Bounded to the gesture (handle/header only).

### P6. backdrop-filter elements ride inside the transform-animating panel. PARTIAL (mechanism CONFIRMED, count and cost corrected)

- `StepBtn` sets `backdropFilter: blur(10px)` (`CollectionCardSheet.jsx:76`) and sits inside the animating/dragging GothicSheet panel. Verified counts: CardSheet 4 (spell path; 2 avatar path), CollectionCardSheet 2, RefineSheet 14 (7 CmpRows x 2, below-fold ones `content-visibility`-skipped at open, `RefineSheet.jsx:195,204`), CollectionRefineSheet 2.
- Mechanism verified as real Chromium behavior: a backdrop-filter element forces its own render surface, and its invalidation is positional - when the element moves relative to its backdrop root every frame (which `will-change: transform` on the panel does not create), the readback + blur re-runs per frame per element.
- Corrections: the gold `Frost` variant (`CollectionCardViews.jsx:116-117`) lives in the pillar list, NOT in any sheet - in-sheet Frosts are the blur-free rose variant. And the cost is compositor/GPU-side, competing with the animation on the GPU rather than with React on the main thread; for 2-14 elements of ~32px it is real but modest. The repo's own rule acknowledges the hazard class (`Ring.jsx:4-6`).

### P7. Paint-phase shimmer animations run during entrances. PARTIAL (mechanism CONFIRMED, magnitude corrected ~10x down)

- `.cx-art-shimmer` animates `background-position` 1.4s infinite (`tokens.css:552-558`) - not compositor-animatable, so main-thread style + paint per frame per visible shimmer. Shown on cold-cache remote loads only (`CardArt.jsx:34`, `artSource.js:117-125`; on-device-cached art never shimmers).
- Correction: `content-visibility` on AddCardsSheet rows and binder tiles means only viewport elements raster - roughly 8-12, not 80, and 6-12 behind the scrim, not dozens. Those on-screen ones do keep repainting behind the translucent scrim during the entrance. (Comment in tokens.css records this was a deliberate trade against the worse transform-in-overflow WebView bug.)

### P8. FitText forced synchronous layout inside the animating panel. CONFIRMED (small)

- `CardSheet.jsx:29-37`: `useLayoutEffect` writes fontSize, reads `scrollWidth` (forced layout flush), then setState (second render). Two instances; because `text` includes the separately-fetched deck name, each can run the cycle **twice** per open. Mid-slide timing is INFERENCE; magnitude small (the dirty region is the just-mounted sheet).

### The close hitch specifically

Close = instant unmount (no exit animation) + the same full-grid re-render as open (P1-P3). The perceived "heavy close" is pure re-render cost in the frame the scrim vanishes.

---

## 4. Gesture and platform behaviour

### Dismissal matrix (all CONFIRMED)

| Surface | Scrim tap | Close button | Hardware back | Drag | Escape |
|---|---|---|---|---|---|
| GothicSheet (all 37 sites) | yes (`GothicSheet.jsx:40`) | **no** (removed by design, `Sheet.jsx:4-5`) | yes (`:24`) | yes, handle/header only | **no** |
| CenteredModal | yes | yes (default) | yes | no | **no** (despite `App.jsx:341-342` claiming it - the comment is false; repo-wide, Escape handlers exist only in CardArtViewer, Fab, OverflowMenu) |
| TelemetryDisclosure | no | no | consumed no-op (locked) | no | no |
| CreateDeckWizard | **no** (no scrim onClick) | yes | yes via App fallback `deckWizard` | no | no |
| ChangeAvatarSheet | yes | yes | **NO - hole, see below** | no | no |
| Pre-match avatar picker | yes | Cancel | yes via fallback `preMatch` | no | no |
| VModal family | yes | yes | yes via `match` fallback + closeTopmost | no | no |
| End screen | no (deliberate) | yes + actions | yes | no | no |
| Fab menu / OverflowMenu | yes / outside-tap | toggle | yes | no | yes |
| CardArtViewer | no (stage is the tilt surface) | yes (44px) | yes | tilt only | yes |

### Back button architecture (CONFIRMED, three tiers)

`App.addListener('backButton')` (`native.js:43-48`) → LIFO `runBackConsumers()` (`back.js:18-23`; every GothicSheet/CenteredModal/Fab/OverflowMenu/CardArtViewer/ShareQR self-registers while open) → tested App fallback table (`navBack.js:16-43`, actions `App.jsx:371-388`) → Home back, then double-back-within-2s exits (`App.jsx:393-396`). A non-dismissible sheet still consumes back so the app cannot navigate underneath (`GothicSheet.jsx:13-16,24`). Native side is stock `BridgeActivity`, no `enableOnBackInvokedCallback`.

**The ChangeAvatarSheet hole (CONFIRMED, all three paths):** it registers no back consumer and has no fallback row; the previously-open CardSheet closes before it opens (`DeckDashboard.jsx:647`, `CardSheet.jsx:178`), so nothing catches back. Pressing back with it open fires the row beneath: `deckOpen` unmounts the entire deck view (overlay goes with it, as its child); in edit mode `deckEdit` silently toggles edit off beneath the overlay; from DeckAddCards, `exitAdd` exits the whole add flow.

**Horizontal swipe leak (CONFIRMED at trace level):** `useSwipe`'s exclusion list (`ui.jsx:175`) checks `e.target.closest(...)` and includes `.vc-modal-overlay`/`.cx-picker-modal`/`.fab-menu`/`.ds-grid`/inputs but no GothicSheet class. GothicSheet portals into `.cx-app` so DOM `closest()` never matches, React portal events bubble through the React tree, GothicSheet stops propagation only on click, and sheet call sites in DecksPager (`:210`, wrapping Export/TextAdd/Spread/Rename) and Home (`:65`) are inside the `{...swipe}` container. A decisive horizontal touch on those open sheets pages the pillar beneath. Carve-outs: swipes starting on inputs/textareas/`.ds-grid` are excluded. Not device-reproduced.

### Platform details (verified)

- **touch-action**: only on drag surfaces, correctly (`useSheetDrag.js:49`, CardArtViewer, AlphabetRail). Sheet scroll bodies have no `touch-action` and **no `overscroll-behavior`** (`GothicSheet.jsx:73`), unlike the page scroller (`App.jsx:1656` sets `overscrollBehaviorY:'contain'`).
- **Pointer capture**: deliberately avoided in useSheetDrag (dangling-capture bug); used correctly where elements survive (CounterBand, CardArtViewer, Home widgets, AlphabetRail).
- **Body scroll lock**: none exists and none is needed - the shell is `overflow:hidden` with inner scrollers (`App.jsx:1645,1656`), so there is no scroll-position-jump class of bug at all, and no double-lock hazard when sheets stack.
- **Safe areas**: sheets pad the gesture bar inside the scroll body (`calc(26px + env(safe-area-inset-bottom))`, `GothicSheet.jsx:73`) and respect the notch via maxHeight (`:51`). `SystemBars.insetsHandling:"disable"` (`capacitor.config.json:9-11`).
- **Keyboard/IME**: resize mode none at all three layers (`native.js:24-28`, `capacitor.config.json:12-15`, `AndroidManifest.xml:81` adjustNothing). Keyboard inset measured via `visualViewport` into `--kb` px + `body.kb-open` at >60px (`appearance.js:15-31`); sheets ride it through CSS margin/maxHeight. `--kb` divided by `--ui-scale` because it is measured in real px but consumed in the scaled container.

---

## 5. Design and visual comparison

The app is **dark-only** (no `prefers-color-scheme` anywhere in src; single `:root` palette, `--bg:#000`, `tokens.css:7`).

### Bottom sheets

| Property | GothicSheet | Wizard `.ob-inner` |
|---|---|---|
| Top radius | 30px hardcoded (`GothicSheet.jsx:48`) | 26px hardcoded (`decks.css:178`) |
| Scrim | `var(--scrim)` = rgba(8,5,3,.6) - the only token-driven scrim (`tokens.css:22`) | rgba(5,4,3,.7) hardcoded |
| Panel ground | `#100c08` flat, hardcoded, bypasses `--surface-sheet` | gradient literal duplicating `--surface-sheet` byte-for-byte (`decks.css:178` vs `tokens.css:20`) |
| Top hairline | rgba(203,167,95,.35) - gilt gold family | rgba(220,184,111,.16) - the other gold family |
| Shadow | `0 -20px 50px -10px rgba(0,0,0,.5)` | same recipe, alpha .6 |
| Handle | 46x5px functional drag (grab zone ~19px tall without header) | 36x4px decorative |
| Header | `Sheet`: pinned Cinzel 13px; `BottomSheet`: same type but **scrolls with body** (`ui.jsx:228` vs `Sheet.jsx:22-23`) | left h2 24px + 30px X (44px hit) |
| Max height | min(88dvh, ...) | min(92dvh, ...) |
| Entrance | scrim .2s ease; panel .28s cubic-bezier(.2,.9,.3,1) | scrim .2s; panel .32s cubic-bezier(.34,1.2,.64,1) |
| Exit | none | none |

### Cross-overlay inconsistencies (from the full matrix)

Six scrim values for one concept, five of them hardcoded (`rgba(5,4,3,.7)`, `rgba(4,3,2,.72)`, `rgba(4,3,2,.86)`, `rgba(6,4,12,.66)`, `rgba(6,4,3,.94)`, plus FAB `rgba(6,5,4,.5)`); five corner radii (30/26/22/20/14); four shadow recipes; three distinct entrance curves for the same slide-up motion; `--surface-sheet` has **zero consumers**; no radius, shadow, or motion tokens exist (`--dur`/`--ease` are `[Target]` only, `DESIGN_SYSTEM.md:126`). Of ~40 sheet-chrome values inventoried, about 7 are token-driven. `DESIGN_SYSTEM.md:108` sanctions "radius/ground per chassis", so some divergence is documented intent, but the dead token and the two gold families on hairlines are doc-vs-code drift.

---

## 6. Accessibility

- **GothicSheet**: focus trap + restore via `useFocusTrap` (`useFocusTrap.js:19-35`), `role="dialog" aria-modal aria-label aria-busy` (`GothicSheet.jsx:44`). But: default labels `'Dialog'`/`'Sheet'`; direct consumers label generically ("Card", "Refine"); **no background `inert`/`aria-hidden`** (the repo's own measurement shows this WebView mishandles aria-modal, `OverflowMenu.jsx:171-177`); scrim is an unlabeled clickable div; **no Escape**; **no close button**; drag grab zone ~19px tall without a header (vs 48dp minimum); no accessibility action exposed for dismissal.
- **CardSheet/CollectionCardSheet have no in-content close control at all** - scrim/drag/back are the only exits.
- **`.ob-overlay` pair**: `role="dialog" aria-modal` but no label; CreateDeckWizard has focus-in but no trap and no restore; ChangeAvatarSheet has none of it; avatar grid cells are clickable divs with no role/tabindex (`CreateDeckWizard.jsx:99`, `DeckDashboard.jsx:483`).
- **LifeCounter VModal family**: no dialog role, no aria-modal, no label, no focus management; 30px close buttons with **no hit extension** (`counter.css:942`).
- **CardArtViewer is the internal gold standard**: saves activeElement, focuses close, sets `aria-hidden` + `inert` on sibling body children, restores both (`CardArtViewer.jsx:80-90`); document-level Tab containment; Escape + back; 44px close; reduced-motion honored in all its JS motion (`:157, :286-292, :360`).
- **Reduced motion is handled well codebase-wide**: OS setting OR in-app toggle folds into `body.reduce-motion` (`appearance.js:40-41`); universal `!important` neutralizer (`tokens.css:190-198`) overrides even the inline sheet animations; one documented deliberate exception (art reveal fade, `:199-208`); JS-driven motion separately gated.
- **If dismissal became drag-only**: keyboard and switch-access users stranded entirely (no X, no Escape, scrim unfocusable); TalkBack users lose scrim-tap too and cannot drag without an exposed accessibility action - hardware back would be the single remaining exit.

---

## 7. External reference numbers (sourced)

Normative platform values, fetched 2026-08-15:

| Property | Value | Source |
|---|---|---|
| M3 drag handle | 32 x 4dp, `onSurfaceVariant` at 0.4 opacity, 22dp vertical padding | androidx SheetBottomTokens.kt / SheetDefaults.kt |
| M3 sheet shape | 28dp top corners (CornerExtraLargeTop) | androidx ShapeTokens.kt |
| M3 scrim | scrim color at **0.32** opacity | androidx ScrimTokens.kt (`ContainerOpacity = 0.32f`) |
| M3 elevation | Level1 = 1dp | androidx SheetBottomTokens.kt + ElevationTokens.kt |
| M3 easing | emphasized-decelerate (0.05, 0.7, 0.1, 1); emphasized-accelerate (0.3, 0, 0.8, 0.15); standard (0.2, 0, 0, 1) | androidx MotionTokens.kt |
| What Compose actually ships for sheets | tween 300ms, FastOutSlowIn (0.4, 0, 0.2, 1) | androidx SheetDefaults.kt |
| Android View dismissal | `HIDE_THRESHOLD 0.5`, `HIDE_FRICTION 0.1` (projected top = top + v x 0.1), significant velocity **500 px/s**; half-expanded 0.5 | material-components-android BottomSheetBehavior.java |
| Compose dismissal | positional threshold 56dp, velocity threshold 125dp/s | androidx SheetDefaults.kt |
| iOS rubber band | `b = (1 - 1/(x*c/d + 1)) * d`, **c = 0.55**, d = viewport dimension | Grant Paul's UIScrollView analysis (gist.github.com/originell/6961057) |
| iOS sheet detents | .medium / .large / .custom (iOS 16+); dimming via largestUndimmedDetentIdentifier; scale-back of presenter unpublished - Ionic's iOS replica uses **0.915** | Apple docs (secondary refs) + ionic-framework swipe-to-close.ts |
| vaul | velocity threshold **0.4 px/ms**, distance threshold **0.25** of visible height, transition 0.5s cubic-bezier(0.32, 0.72, 0, 1), scroll-lock timeout 100ms, drag = direct transform writes with transition:none, refuses drag if any scrollable ancestor has scrollTop != 0 | emilkowalski/vaul constants.ts, helpers.ts, index.tsx |
| react-modal-sheet | velocity 1200 px/s, close threshold 0.6, min drag distance 20px, tween easeOut 0.2s (no spring in current main) | Temzasse/react-modal-sheet constants.ts |
| Ionic sheet | enter 500ms cubic-bezier(0.32, 0.72, 0, 1); card dismiss when `(deltaY + velocityY x 1000)/height >= 0.5`; gesture activation threshold 10px; presenting-view scale 0.915 | ionic-framework modal sources |
| Spring conventions | react-spring default {tension 170, friction 26, mass 1}, stiff {210, 20}; framer-motion physical defaults {stiffness 100, damping 10, mass 1} | pmndrs/react-spring constants.ts, framer-motion type defs |
| Compositor rule | only transform and opacity animate without layout/paint; promote only the animating element | web.dev "Stick to compositor-only properties" |

Key convergence: Android View, Compose, and Ionic all use a **velocity-projected position** test (position + v x k against a threshold), not two independent tests. The de-facto web "iOS sheet feel" constant is cubic-bezier(0.32, 0.72, 0, 1) at 500ms (vaul and Ionic identically). Nobody dampens inside bounds; rubber-band/log dampening applies only past limits.

---

## 8. Fidelity scorecard - GothicSheet vs the seven criteria

| # | Criterion | Verdict |
|---|---|---|
| 1 | 1:1 finger tracking | PARTIAL - tracks during drag but through per-frame React renders, handle/header only, downward only |
| 2 | Interruptibility | **FAIL** - entrance is a fixed CSS keyframe that cannot be grabbed; there is no exit motion at all to interrupt |
| 3 | Velocity-aware dismissal | **FAIL** - fixed 92px displacement threshold, velocity never measured |
| 4 | Rubber banding | **FAIL** - upward drag is clamped dead at 0 |
| 5 | Scroll-to-drag handoff | **FAIL (by omission)** - body drag does not exist, so no handoff logic; nothing steals mid-scroll gestures, but the primary affordance is missing |
| 6 | Compositor-only animation | PASS on properties (transform/opacity only) with the caveat that drag position originates on the main thread each frame, and backdrop-filter children ride the moving layer |
| 7 | Frame budget | FAIL in practice - P1-P4 put multi-hundred-component reconciles and content reflows inside the 280ms entrance window |

The 10 non-GothicSheet mechanisms fail 1-5 outright (no drag at all) and several also fail 6 (LifeCounter menus scale-morph; CenteredModal blur scrim).

---

## 9. Findings outside the asked scope (materially notable)

Reported separately per the audit rules; no fixes proposed here.

1. **Codex grid re-renders 1,109 tiles on every root state change** - not just sheet toggles: search input, scope changes, every chip tap. This is the single largest render hotspot found and it degrades interactions that have nothing to do with sheets.
2. **ChangeAvatarSheet hardware-back hole** (§4) can silently unmount the deck screen under the user - behaviourally the worst gesture bug found, worse than anything cosmetic about the sheets.
3. **Horizontal swipe leak through open sheets** in Home/DecksPager (§4).
4. **Doc/code discrepancies** (reported per the constitution's rule): `App.jsx:341-342` claims CenteredModal owns Escape - false; `WantPrintingSheet.jsx:1-5` says "DORMANT. Nothing renders this yet" while two live call sites render it; `DESIGN_SYSTEM.md:108` "one chassis" does not cover the five other modal chassis in code; `--surface-sheet` is documented as the shared sheet ground but has zero consumers.
5. **LifeCounter modal family a11y** - no dialog semantics at all, sub-minimum close targets (§6).
6. **Two independent FAB-menu implementations** - `Fab.jsx` (correct contract) vs LifeCounter's hand-rolled copies using the scale morph that `OverflowMenu.jsx:13-18` documents as breaking the WebView a11y tree.
