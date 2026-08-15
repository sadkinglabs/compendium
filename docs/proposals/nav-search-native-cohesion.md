# Nav + Search: Native-Feel Cohesion Plan

Status: APPROVED WITH CHANGES - Codex review 2026-08-15 (disposition: changes required) incorporated; owner approved implementation. Phases 0-3 authorized; Phases 4-6 gated on device measurement.
Method: four parallel read-only audits (nav behaviour, search behaviour, appearance vs DESIGN_SYSTEM.md, performance), synthesized here. Every claim below carries a file:line citation from the working tree at commit 3987976, and is tagged **[M]** measured-in-code, **[I]** inferred, or **[D]** needs on-device confirmation.

---

## 0. What is already correct (no work invented)

These surfaces passed the audit and are explicitly out of scope:

- **Hardware-back plumbing** - LIFO consumer stack + declared fallback order + double-back-to-exit, wired fresh every render (`src/back.js:18-23`, `src/navBack.js:16-57`, `src/App.jsx:110,385-393`), with tests (`src/navBack.test.mjs`, `src/back.test.mjs`). The strongest subsystem audited. [M]
- **Keyboard inset contract** (Phase 1 polish) - `--kb` from `visualViewport` (`src/appearance.js:15-25`), native resize disabled (`src/native.js:27-28`), dock consumes `max(navBase, --kb/--ui-scale)` (`src/theme/tokens.css:265`), sheets lift via `GothicSheet.jsx:47,51`. Correct and single-sourced. [M]
- **Edge-to-edge** - `viewport-fit=cover`, `env(safe-area-inset-*)` on shell, nav, and sheets; no edge-to-edge opt-out on targetSdk 36. [M]
- **Reduced motion** - global neutralisation + OS-level media query + documented exceptions (`tokens.css:185-203`, `appearance.js:33-35`). [M]
- **OverflowMenu** - 44px trigger, opacity+translate (no scale), full keyboard/focus model, measured WebView a11y justification (`OverflowMenu.jsx:13-18,104-182`). The model implementation. [M]
- **CollectionSubHeader** - tokenised, 48dp row, correct ruby accent as a dot not a wash, hand-rolled M3 scroll-under frost (`CollectionSubHeader.jsx:12-34`). [M]
- **BottomDock + .cx-nav accent policy** - zero inline style in the dock; nav is deliberately gold-only chrome per DESIGN_SYSTEM §2, icons all SVG, ≥44px targets, contrast 5.5:1 / 11.1:1. [M]
- **Pillar transition = cross-fade** - deliberate, documented sacrifice after the measured tile-seam bug (`tokens.css:363-371`); not a defect. Reopening it is explicitly NOT proposed.

---

## 1. Inventory

### 1.1 Navigation surfaces (31 found; full table in audit)

| Surface | file:line | Key defects |
|---|---|---|
| Bottom pillar nav | `src/App.jsx:556-566`, `tokens.css:236-240` | no ripple/:active, default tap-highlight NOT suppressed (only surface where it shows), no aria-label/tab semantics, raw literals for hair/edge values |
| Bottom dock | `src/components/BottomDock.jsx:11-18`, `tokens.css:265-268` | conforms; `bottom` (layout prop) transition on keyboard open [I] |
| Global FAB + menu | `src/components/Fab.jsx:73-130`, `decks.css:121-157` | menu `scale(.18)` morph violates DESIGN_SYSTEM §4 HARD RULE (`decks.css:150` vs `DESIGN_SYSTEM.md:118`); no keyboard/focus model; `var(--danger)` undefined token bug (`Fab.jsx:119`, token is `--destructive`); Unicode glyph fallback path (`Fab.jsx:122`, `DecksPager.jsx:154-155`) |
| Brand bar | `App.jsx:421-435` | wordmark ~20px tall, chip 28px - both under floor |
| Pillar context header | `App.jsx:466-468` | content scrolls under with no scrim/divider [I] |
| Detail header | `App.jsx:456-464,1641-1644` | back ~16-19px tall hit box; hardcoded `#e3c589`/`#efe7d8` where tokens exist |
| Add-cards header | `App.jsx:447-454` | "Done" ~16px tall; eyebrow uses content violet `#a08cc0` in a chrome surface - Decks two-tone violation (`App.jsx:451`) |
| Codex scope bar / all Chip rows | `App.jsx:812-833`, `ui.jsx:39-60` | ~29px tall; zero tokens in Chip |
| SegTabs (9 nav uses) | `ui.jsx:67-87` | ~31px tall; propagates to every consumer |
| Collection drill sticky header | `Collection.jsx:943-988` | good (44px back, ruby Ring) but hand-rolled duplicate of CollectionSubHeader; drill itself registers NO back consumer |
| Collection list-detail header | `Collection.jsx:2101-2133` | 38px back button, typed `‹` glyph, rose `224,169,177` (a third red, neither ruby token) on a nav control; not sticky; no back consumer |
| Play "All matches" back | `Play.jsx:127` | bare 12px text link, no padding |
| AvatarPicker chassis | `App.jsx:599-605`, `tokens.css:485`, `counter.css:686-693` | live transform+overflow-scroll trap (see §3.3) |
| LifeCounter modals | `counter.css:826-832` | WORST trap instance: scroller IS the transform target |
| Sheet/modal chassis | `GothicSheet.jsx`, `ui.jsx:230-262` | consolidated; `CenteredModal` close 30px; `.sheet-close` 30px (`decks.css:173`) |
| Swipe nav | `ui.jsx:169-190` | fine |
| Hardware back | `native.js:43-48` | no predictive back (see §5, decision D5) |

Excluded deliberately: DockLeft (`DockLeft.jsx:8-13`) is a portal helper, not a tablet rail - there is no tablet navigation at all (zero width media queries in `src/theme/*.css`) [M]; that is decision D6, not a defect row.

### 1.2 Search surfaces (10 mount sites, 6 implementations)

| # | Surface | file:line | Impl | Debounce | Query path | Clear | IME hint |
|---|---|---|---|---|---|---|---|
| 1 | Codex universal (+ add-cards slot) | `App.jsx:537-539` | SearchPill | 130ms / 120ms | `searchAll` fan-out incl. SQL LIKE scans | yes | yes |
| 2-3 | Collection drill + All | `Collection.jsx:1041,1198` | SearchPill | 130ms | in-memory pool | yes | yes |
| 4 | Decks library | `DecksPager.jsx:215` | SearchPill | none | in-memory filter | yes | yes |
| 5 | Collection add-cards sheet | `Collection.jsx:1533` | bespoke bare input | 130ms | in-memory pool, UNCAPPED render | no | no |
| 6 | Marginalia link picker | `CodexDetail.jsx:489` | bespoke bare input | 150ms | `searchCodex` (incl. SQL) | no | no |
| 7 | Avatar picker | `AvatarPicker.jsx:147` | bespoke `.picker-search` | none | in-memory | yes (44px expander - the only conforming clear) | yes |
| 8-9 | Deck wizard + change-avatar | `CreateDeckWizard.jsx:82`, `DeckDashboard.jsx:465` | bespoke `.ob-search-pill` | 250ms (0 on clear) | SQL SELECT per tick (`deckRepository.js:33-38`, bypasses catalogCache) | yes (26px) | no |
| 10 | Play deck picker | `Play.jsx:435` | bespoke inline row | none | in-memory, cap 14 | no (the visible "Clear" clears the deck selection, not the text - affordance collision `Play.jsx:430`) | no |

Excluded (name/URL/number fields, not search): full list in audit; notably all Refine/Triage/Missing/Card sheets have no text input at all [M].

**Cohesion counts [M]:** 6 search implementations for one job; 3 visual search-bar families (52px neutral-frost / 50px gold-hairline / 48px warm, three grounds, three blurs, two input font families); 8 screen-header treatments with 8 distinct Cinzel title recipes sharing no scale step; 6 back affordances + 4 back-chevron glyphs (one a Unicode `‹`); 5 debounce values (0/120/130/150/250ms); 4 copies of the dock-slot retry idiom; 4 copies of the nav-height literal (`tokens.css:236,265`, `deckpager.css:8`, `App.jsx:1649`); 5 verbatim copies of the gilt-pill recipe (`Collection.jsx:755,952,1144,1187,1527`).

---

## 2. "Native" defined concretely

Judged against these specific Android platform behaviours, not a vibe:

| # | Platform behaviour | Current state |
|---|---|---|
| N1 | System back always goes UP one level, matching the on-screen back | FAILS on ≥4 screens (§3.1) |
| N2 | Predictive back (targetSdk 36 default-on) | Absent; JS listener only (`native.js:43-48`) [M], runtime effect [D] |
| N3 | Keyboard insets: content lifts, never obscured; IME action key correct | Dock/sheets correct; 2 shells missing `--kb`; IME hint on 2 of 6 impls |
| N4 | Edge-to-edge with safe-area insets | PASSES [M] |
| N5 | 48dp touch targets (M3 floor; DESIGN_SYSTEM §6 target) | ~12 nav/search controls below 44px, more below 48 (§3.2) |
| N6 | Press feedback on every interactive surface (ripple or equivalent) | Absent on bottom nav and all header controls; nav shows the DEFAULT grey tap highlight [M/I] |
| N7 | M3 top app bar: pinned + scroll-under tint/elevation | Hand-rolled correctly twice in Collection only |
| N8 | M3 search: clear keeps focus; scroll dismisses keyboard | Clear orphans caret [I]; no blur-on-scroll anywhere [M] |
| N9 | Scroll position survives back/tab-return | Codex detail stack only; pillar switch discards scroll (keyed remount `App.jsx:488`) - owner call, D4 |
| N10 | TalkBack: nav semantics, headings, focus follows navigation | No tab roles/aria-current on nav, no h1/landmarks, no focus movement on navigate [M] |
| N11 | Sub-16ms input-to-paint on keystroke | Unmeasured [D]; code-level hazards found (§3.4) |

The pillar cross-fade (vs M3 shared-axis) and the absence of ripple-the-actual-Android-ripple are accepted deviations of the Manuscript language; press feedback is still required (N6) but its form is decision D1.

---

## 3. Gap list, classified per ENGINEERING_CONSTITUTION

Classes: T=Trivial, S=Standard, H=High-risk. Effort: S/M/L. Impact = user-visible.

### 3.1 Back-stack parity (the biggest behavioural gap)

| ID | Gap | Evidence | Class | Effort | Impact |
|---|---|---|---|---|---|
| G1 | Hardware back does not close **hierarchical** layers that have an on-screen back: Collection set drill and Collection list detail fall through to `tabHome`. (Codex correction applied: Codex List/Grid, Collection view pills, and Decks List/Stats are **presentation-only** states with no on-screen back - they must NOT become back entries; inventing history for them would silently change a display preference on back-press. Decks detail layers already have rows: `navBack.js:30-31`.) Fix via `registerBackConsumer` in the owning component - not by adding rows to `APP_BACK_ORDER` for child-local state | `navBack.js:16-33`, `Collection.jsx:922,1128` (pattern exists for select-mode), `Codex.jsx:51` (List/Grid is a preference) [M] | **S** | M | High - back button feels broken on core screens |
| G2 | Codex-detail scroll restore queries `.cx-scroll` globally; 4+ elements can match | `App.jsx:297,307-314` vs `App.jsx:1031`, `GothicSheet.jsx:61` [M] hazard, [D] symptom | **S** | S | Medium |

### 3.2 Touch floor + feedback + a11y semantics

| ID | Gap | Evidence | Class | Effort | Impact |
|---|---|---|---|---|---|
| G3 | Sub-floor targets: detail back ~16px, bmToggle, add-cards Done, list-detail back 38px, sheet-close 30px, modal-close 30px, SearchPill help 24px, cx-search-clear 40px wide, ob clear 26px, brand chip 28px, Play back link, Chip ~29px, SegTabs ~31px. The 44px `::after` expander exists (`tokens.css:349-352`) and is applied to none of them | full table in audit; `App.jsx:1642,1644,449`, `Collection.jsx:2106`, `decks.css:173,218`, `ui.jsx:254,44,76`, `SearchPill.jsx:28` [M] | **S** | M | High - mis-taps on the most-used controls |
| G4 | No press feedback on bottom nav or any header control; nav is the one surface not suppressing the default tap highlight | `tokens.css:237` [M], visual outcome [I] | **S** | S | Medium - reads as web, not app |
| G5 | `.cx-nav` has no aria-label/tab semantics/aria-current; no headings or landmarks; no focus move on navigation; FAB menu lacks OverflowMenu's keyboard model | `App.jsx:556-566,467`, `Fab.jsx:112-128` [M] | **S** | M | High for TalkBack users, invisible otherwise |

### 3.3 WebView paint traps (documented hazard, live violations)

| ID | Gap | Evidence | Class | Effort | Impact |
|---|---|---|---|---|---|
| G6 | LifeCounter `.modal-box`: the scroller itself is transform-animated (`vc-modal-in`), plus a persistent `rotate(180deg)` on a scroller | `counter.css:826-832` [M], symptom [D] | **H** | M | Blank-until-scroll risk on dice/max-life/end-screen modals |
| G7 | AvatarPicker `.cx-picker-box`: `overflow:hidden` + `cxsheet` transform over an unmitigated nested scroller (`.avatar-grid`) - the exact shape GothicSheet was refactored to avoid | `tokens.css:485,523`, `counter.css:686-693` [M], [D] | **H** | M | Same risk on the pre-match picker |
| G8 | CreateDeckWizard `.ob-inner`: same family (transform anim + nested `overflow-y:auto` lists) | `decks.css:169,179,195` [M], [D] | **H** | S | Same risk in deck creation |
| G9 | FAB menu `scale(.18)` morph - violates the DESIGN_SYSTEM §4 HARD RULE written about this exact element; WebView a11y tree reports pre-transition geometry | `decks.css:150` vs `DESIGN_SYSTEM.md:118`, `OverflowMenu.jsx:13-18` [M] | **S** | S | A11y geometry on the app's primary action menu |

### 3.4 Search behaviour + performance

| ID | Gap | Evidence | Class | Effort | Impact |
|---|---|---|---|---|---|
| G10 | Global `query` lives at App root: every keystroke re-renders the entire shell (nav, dock, pillar); first/last character unmounts/remounts the whole Codex pillar (lazy chunk) | `App.jsx:77,240,415,488` [M], felt latency [D] | **S** | M | High - the app's primary input path |
| G11 | `searchAll` re-runs 2 SQL `LIKE '%…%'` full scans + full `listDecks()` (4 queries incl. JOIN) + `listMatches(50)` every 130ms tick | `codexRepository.js:192-199`, `searchRepository.js:16-21`, `deckRepository.js:56-58` [M] | **S** | M | Medium-high on device [D] |
| G12 | Collection add-cards sheet renders the ENTIRE uncapped catalog as rows, each mounting CardArt | `Collection.jsx:1496-1499,1555,1562` [M] | **S** | S | High - heaviest single search surface |
| G13 | BinderTile memo defeated by inline `toggleSel`/`onPeek` closures; every mounted tile re-renders per keystroke; `drillOrdered`/`ordered` unmemoized so railModel rebuilds per stroke | `Collection.jsx:902,1125,910-916,1107-1119`, `CollectionCardViews.jsx:229` [M] | **S** | S | Medium |
| G14 | Wizard/change-avatar search runs a real SQL SELECT per debounce tick, bypassing catalogCache | `deckRepository.js:33-38` [M] | **S** | S | Low-medium |
| G15 | Missing `--kb` keyboard inset: `.picker-footer` (AvatarPicker search) and `.ob-*` shells (wizard/change-avatar search) | `counter.css:784`, `decks.css:212-218` [I], confirm [D] | **S** | S | Keyboard likely occludes 3 search fields |
| G16 | IME/clear/debounce inconsistency: enterKeyHint on 2 of 6 impls; clear missing on 3; five debounce values; Play "Clear" affordance collision | §1.2 table [M] | **S** | M | Medium |
| G17 | Search-state retention inconsistent: Collection persists q across unmount, Decks loses it, Codex clears on tab switch but restores on back | `useCollectionRefine.js:30,35`, `DecksPager.jsx:65`, `App.jsx:253,299,306` [M] | **S** | S | Low - but sets the contract |
| G18 | SearchPill/Fab portal effect runs every render (no dep array); slot-retry idiom copy-pasted 4x | `SearchPill.jsx:12-14`, `Fab.jsx:92-93`, `DockLeft.jsx:9`, `Collection.jsx:750` [M] | **T** | S | None visible; hygiene |

### 3.5 Appearance + cohesion

| ID | Gap | Evidence | Class | Effort | Impact |
|---|---|---|---|---|---|
| G19 | `var(--danger)` does not exist (token is `--destructive`): FAB danger items render in body ink | `Fab.jsx:119` vs `tokens.css:68` [M] | **T** | S | Real bug, one line |
| G20 | Glyph stragglers vs the no-Unicode rule: `?` (SearchPill help), `‹` (list-detail back), `‹ Back` x2, `›` x4, `✦` x2, `★☆✓✕` via FAB fallback, default `'+'` prop | audit table [M] | **T** | S | Low each; violates own rule |
| G21 | Accent violations: add-cards eyebrow uses content violet `#a08cc0` in chrome (two-tone rule); list-detail back uses rose `224,169,177` (third red) on a nav control; `160,140,192` is a fourth violet in BlankState/CodexDetail | `App.jsx:451`, `Collection.jsx:2109`, `DecksPager.jsx:211,237`, `CodexDetail.jsx:288` [M] | **T** | S | Low each; brand integrity |
| G22 | Near-miss tokens written raw: `--hair-glass`, `--r-pill`, `--blur-pill` exist and are unused by the very surfaces they describe; detail-header hexes; SegTabs `#4a3c22` = `--edge-brown`; nav-height literal x4; gilt-pill recipe x5 | `tokens.css:271,45,127,147`, `App.jsx:1642-1643`, `ui.jsx:69` [M] | **T** | M | None visible; blocks future retune |
| G23 | 3 search-bar visual families, 8 header families, 8 title recipes, 6 back affordances, 2 menu a11y contracts, contrast failure in ob placeholder (~3.2:1) | §1 counts, `decks.css:214,216` [M/I] | **S** | L | The cohesion ask itself |
| G24 | Home error copy promises pull-to-refresh; none exists | `Home.jsx:100` [M] | **T** | S | Trivial dishonesty |
| G25 | Sticky blurred headers over scrolling grids re-sample backdrop per scroll frame; 19 backdrop-filter sites inventoried; `.cx-app::before` full-screen 550ms gradient repaint per pillar swap; `.fab-menu` animates border-radius (paint prop) | `CollectionSubHeader.jsx:14`, `Collection.jsx:948`, `tokens.css:227-231`, `decks.css:150` [M], cost [I/D] | **S** | S-M | Unknown until measured - Phase 6 gate |

---

## 4. Target contracts

### 4.1 The nav contract (one pattern)

1. **One `AppBar` primitive** replacing the 8 header families, with three variants: `root` (pillar title), `sub` (back + title + trailing slot), `mode` (editing banner). Frost treatment (Codex correction applied): the CollectionSubHeader recipe is a **permanent** frost + divider (`CollectionSubHeader.jsx:12` has no scroll-state detection) - the contract must pick ONE of (a) static frost as shipped today, or (b) genuine scroll-under state detection, and specify it before rollout. **The chosen AppBar must be measured on the target WebView before app-wide adoption** (D7 moved ahead of Phase 5), with an opaque non-blur fallback (`rgba(0,0,0,.92)` flat) specified if it misses frame budget. Title from a 3-step Cinzel scale (27 root / 22 sub / 14 mode eyebrow) replacing the current 8; heading rendered as `<h1>`; eyebrow may carry the pillar accent token as a dot, never a wash; Decks chrome uses `--accent-violet #c79ad0` only.
2. **One back affordance**: the 44px circle + shared SVG chevron from `Collection.jsx:952-957`, promoted to a `BackButton` component, 48dp effective target via the existing `::after` expander. Every screen that shows it ALSO registers a back consumer (or navBack row) so hardware back and on-screen back are the same operation, tested in `navBack.test.mjs`.
3. **Bottom nav**: keep exactly as designed visually; add `aria-label`, `aria-current="page"`, suppress default tap highlight, add a Manuscript press state (see D1). 62px height becomes a single `--nav-h` token consumed by all four current copies.
4. **Menus**: one contract - opacity + ≤8px translate entrance (never scale, never border-radius animation), OverflowMenu's keyboard/focus model, shared between OverflowMenu and Fab menu.
5. **Focus**: after push/back/tab change, move focus to the new `<h1>` (screen-reader only outline).
6. **Sheets**: GothicSheet stays canonical; `CenteredModal` close and `.sheet-close` grow to 44px effective; the two bespoke overlays (`.cx-picker-modal`, `.ob-overlay`) migrate onto GothicSheet (this also retires their paint-trap shells, G7/G8).

### 4.2 The search contract (one pattern)

1. **One `SearchPill` component, two mounts**: `docked` (portals into the dock, exactly as today) and `inline` (in-sheet/in-panel, same chassis at 48px). The `.ob-search-pill` and `.picker-search` families retire onto `inline`; bare inputs (add-cards sheet, marginalia, Play picker) adopt it.
2. **Uniform input chassis, owner-controlled scheduling** (Codex correction applied): the component owns presentation and input behaviour only - controlled value, `enterKeyHint="search"`, `autoComplete/autoCapitalize/spellCheck` off, Enter blurs, clear button 44px effective that keeps focus after clearing (N8) and is visible-on-text only. **Query scheduling stays with the search owner**: surfaces filtering bounded in-memory collections (Decks library, AvatarPicker, Play picker) keep immediate filtering; surfaces with measured-expensive work keep their debounce (130ms standard, 0ms on clear-to-empty). The chassis never adds latency for consistency's sake.
3. **Keyboard**: every mount either sits in the dock (already `--kb`-aware) or in a shell that consumes `--kb` (fixes G15). No autoFocus except in-sheet pickers where the sheet's only job is the search (current add-cards/marginalia behaviour, kept).
4. **Query path**: no SQL on the keystroke path - all card-shaped search goes through the in-memory catalog (`getPool`/`catalogCache`); `listAvatarCards` gains a cached path; `searchAll`'s deck/match/article legs run against cached snapshots refreshed on mutation, not per tick.
5. **Rendering**: every result list either caps or uses `useProgressiveRender` (the Collection-ALL pattern, promoted).
6. **State retention**: pillar-level search persists across unmount (Collection's session pattern, promoted to Decks); sheet-level search resets on open. Codex's back-restore behaviour kept.
7. **Style**: the canonical 52px frost, with the three near-miss tokens (`--hair-glass`, `--r-pill`, `--blur-pill`) actually consumed; placeholder contrast ≥4.5:1 (fixes the ob 3.2:1 failure).

---

## 5. Decisions for the owner (tradeoffs, not walls)

RESOLVED 2026-08-15 per Codex recommendation + owner approval: D1 Manuscript `:active` press state, no JS ripple. D2 fold the gold-hairline field into the canonical inline SearchPill. D3 retain and document the AvatarPicker green identity. D4 defer pillar scroll retention (separate navigation-state work). D5 defer predictive back pending installed-app evidence. D6 tablet rail out of scope. D7 measure blur BEFORE Phase 5's frost rollout. Original option text kept below for the record.

- **D1 - Press feedback form.** True M3 ripple in a WebView means a JS ripple implementation (cost, risk) or CSS approximation. Recommendation: no ripple; a Manuscript press state instead (fast `:active` gold-tint + scale-none background shift, ~80ms), applied uniformly to nav buttons, chips, back buttons. Cheaper, on-brand, still satisfies N6. Your call: ripple fidelity vs Manuscript restraint.
- **D2 - The Decks gold-hairline search bar.** Folding `.ob-search-pill` into the canonical pill loses its gold border + warmer ground in the deck wizard. Recommendation: fold it (chrome is black+gold app-wide; the gold hairline was never a sanctioned variant). Alternative: keep as a blessed `inline` skin.
- **D3 - AvatarPicker green vocabulary.** The picker's warm-green ground is inside the sanctioned `.cx-life-tracker` exception but the ground colour itself is undocumented within it. Migrating the picker onto GothicSheet (G7 fix) forces the question. Recommendation: keep the green identity, document it in DESIGN_SYSTEM §2, restyle only the chassis/search internals to contract.
- **D4 - Pillar scroll retention.** Fixing N9 means un-keying the pillar remount or adding a scroll memo, and interacts with the pillar fade (the art-seam saga's slide-restore remainder is already flagged as your call). Recommendation: per-pillar scrollTop memo restored after fade-in, keyed remount kept. Can be dropped from scope with no effect on other phases.
- **D5 - Predictive back.** Real native work (OnBackInvokedCallback bridging, per-layer back preview), risky under Capacitor, and the system default on targetSdk 36 may already animate app-exit acceptably. Recommendation: defer; verify on-device what targetSdk 36 gives us for free, and only revisit if the exit animation actually fights double-back-to-exit [D].
- **D6 - Tablet rail.** No landscape/tablet nav exists by design (manifest note). Building an M3 rail is a redesign with its own proposal. Recommendation: out of scope here; log it.
- **D7 - Blur budget.** If Phase 6 device profiling shows the frosted language is costing frames on scroll (two sticky blurred headers, 19 blur sites), the fix trades visual identity for smoothness (e.g. pre-composited dark fills at 0.92 alpha, dropping blur on scroll-under headers only). That is a taste call you make with measurements in hand, not now.

---

## 6. Phased plan

Each phase is independently shippable, verifiable, and does not depend on later phases. Quality gates per CLAUDE.md run on every phase (`test:app`, `test:query` where store files move, `check:types`, `check:cycles`, `build`, `check:docs`); device evidence noted per phase. Owner runs device steps (standing rule).

**Phase 0 - Correctness batch. Class: STANDARD** (Codex correction: G19-G21 intentionally alter visible colour/iconography; G18 changes effect lifecycle - not Trivial). Split: **0a mechanical** (G22 token substitutions with zero visual delta, G24 copy fix) and **0b visual/behavioural** (G19 danger token - FAB danger items become visibly red; G20 glyphs to SVG; G21 accent corrections; G18 effect deps). Type: fix. Proves: gates green + before/after screenshot spot-check of FAB menu danger item and list-detail header.

**Phase 1 - Back parity, hierarchical layers only.** Type: fix. G1: `registerBackConsumer` in Collection set drill and Collection list detail (the `Collection.jsx:922` pattern - child-local consumers, NOT new `APP_BACK_ORDER` rows). Presentation-only states (Codex List/Grid, Collection view pills, Decks List/Stats) are explicitly excluded; back must never silently change a display preference. G2 (scope the scroll-restore query). Proves: unit tests for the consumer logic; owner device script: hardware-back from drill lands on Sets, from list detail lands on Lists; hardware-back with Grid view active leaves Codex without changing the view.

**Phase 2 - Touch floor, press feedback, semantics.** Type: fix. **Acceptance criterion: 44px effective on every control** (the shipping DESIGN_SYSTEM floor); 48dp is recorded per-control where layout already allows it, and the doc's §6 target line is updated honestly - Phase 2 does not claim 48dp app-wide (Codex correction). G3 (apply the existing expander + explicit min-heights; Chip/SegTabs gain padding - small visual change), G4 (D1: Manuscript `:active` press state, no JS ripple), G5 (nav semantics; focus contract is **route-aware**: forward navigation announces the new screen, back restores the initiating control when it still exists, modals keep the existing trap; TalkBack accessibility focus verified on the installed WebView [D], DOM focus alone is not proof), G9 (FAB menu to opacity+translate + adopt OverflowMenu focus model - closes the DESIGN_SYSTEM hard-rule violation). Proves: DevTools tap-target overlay audit; TalkBack pass on nav + both menus (owner device script); reduced-motion re-check.

**Phase 3 - Search chassis adoption.** Type: reimplementation (of the bespoke fields onto one chassis). Chassis, IME, clear, focus, keyboard accommodation, and a11y unify; **query scheduling is untouched per surface** (4.2.2 as corrected). G12 cap/progressive render, G15, G16 (chassis aspects), G17; D2 (fold gold-hairline), D3 (keep green identity, restyle internals only). Proves: per-surface checklist (IME action key visible, clear works and keeps focus, keyboard never occludes the field - owner device script per surface); gates green.

**Phase 4 - Search performance. Class: HIGH-RISK if caching proceeds** (Codex correction: deck/match records are profile-scoped via `activeProfileId()` - `deckRepository.js:47`, `playRepository.js:114` - so cross-pillar cached snapshots ARE a profile-boundary design, contradicting the earlier "no boundary touched" claim, now retracted). Type: measure, then possibly fix. **Opens with on-device measurement and may close with no change.** If caching is justified: key by profile, define boot/switch/restore/mutation invalidation, prevent stale async completion after a profile switch, and test all of those paths. The shell-design checkpoint (move `query` state out of App root vs keep Codex mounted under results - two materially different designs) is resolved and approved as its own mini-proposal BEFORE Phase 4 code, not in-phase. G10, G11, G13, G14 all sit behind the measurement gate. Proves: before/after keystroke trace on device (owner records, I analyse - the frame-forensics loop exception applies); profile-switch invalidation tests; no functional change in `test:query`/`test:codex`.

**Phase 5 - Header consolidation.** Type: redesign (largest visual change). **Gated on the AppBar measurement from 4.1.1** (D7: measure blur cost BEFORE broad frost rollout - Codex correction; the opaque fallback ships instead if blur misses budget). G23: build `AppBar` + `BackButton`, migrate the 8 families, 3-step title scale, h1 + route-aware focus (G5 remainder). Proves: measured AppBar scroll trace on device first; per-screen screenshot diff against current (owner approves visuals); `check:smoke` before merge.

**Phase 6 - WebView paint traps.** Type: fix (high-risk, device-gated). G6 (split scrim/panel/scroller in the life-counter modals per the GothicSheet recipe; the persistent `rotate(180deg)` needs its own design since the trap forbids transform-on-scroller), G7/G8 (retire bespoke shells onto GothicSheet, per 4.1.6), G25 remainder. **Precondition (Codex): the frame-forensics scripts import undeclared `pngjs` and fail with ERR_MODULE_NOT_FOUND - convert them to the existing `sharp` dependency before they become a verification gate.** Proves: frame forensics on each fixed surface; owner device pass on dice-roll modal, rotated modal, avatar picker, deck wizard.

Ordering rationale: 0-2 are pure wins with no visual redesign; 3-4 fix the daily-feel of search before the visual consolidation repaints headers; 6 is last because it is the riskiest and its blur decision needs measurements the earlier phases don't disturb.

---

## 7. Invariants + source-of-truth docs touched

- **Invariants (ENGINEERING_CONSTITUTION §3):** graceful zero-image degradation - search result rows and add-sheet rows mount `CardArt`; Phases 3-4 must re-verify zero-image mode (BUILD.md procedure). **Catalog/profile boundary and profile isolation: TOUCHED by Phase 4 if caching proceeds** (deck/match snapshots are profile-scoped; see Phase 4's design requirements - the original "no boundary touched" claim was wrong and is retracted per Codex review). No schema, transactional, or import/export surface is touched; cross-runtime integrity unaffected (JS repositories only, no SQL migration).
- **DESIGN_SYSTEM.md:** Phases 2, 3, 5 change primitives (`AppBar`, `BackButton`, SearchPill variants, press-state, menu contract) - doc updates are a completion gate per phase, including recording D2/D3 outcomes and promoting the scroll-under recipe from "hand-rolled twice" to a named pattern.
- **COMPENDIUM_FEATURE_MATRIX.md:** no capability changes; no update expected (flag if Phase 5 renames any user-visible affordance).
- **BUILD.md:** unchanged unless Phase 6 adds a frame-forensics runbook entry.
- **AGENTS.md / constitution:** governs process only; High-risk items (G6-G8, Phase 6) get their own in-phase mini-proposal before code, per the gate.

---

## 8. Self-critique (constitution §8)

**Weakest part:** the performance phase is ordered and scoped on code-reading alone. Every G10-G14 hazard is real in the source, but no keystroke latency, frame time, or blur cost has been measured on the Pixel. If device profiling shows typing in Codex already paints in budget, Phase 4 shrinks to hygiene and its position in the order was wasted priority - the honest fix is that Phase 4 opens with the measurement and is allowed to conclude "fast enough, close the phase."

**What would falsify the plan:**
- Device tracing showing keystroke latency is dominated by something not in the gap list (e.g. WebView IPC or the art cache), invalidating the G10/G11 emphasis.
- The predictive-back system behaviour on targetSdk 36 turning out to already conflict with double-back-to-exit in practice, which would promote D5 from "defer" to a blocking fix.
- Phase 5's single AppBar proving unable to express a legitimately divergent header (LifeCounter's immersive chrome is already excluded; if a second exception appears, the "one pattern" claim weakens and the contract needs a variant, not a fork).
- The [I]-tagged keyboard-occlusion claims (G15) failing to reproduce on device - in which case that work item is deleted, not reshaped.

**Known blind spots:** no screenshot-diff harness exists, so Phase 5's visual verification is owner-eyeball; the audit did not measure TalkBack behaviour, only the ARIA surface; tablet behaviour was scoped out by D6 rather than audited.
