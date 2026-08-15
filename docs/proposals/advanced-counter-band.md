# Advanced Counter Band - "Cartouche"

Status: PROPOSAL - awaiting owner approval (and the prototype file: the claude.ai design share link is auth-walled to my fetcher; drop `Counter Band v3.dc.html` anywhere in the repo and I will cross-check the graphics against it). Classification: **High-risk** - the live match screen, a persisted-contract change, and an always-on gesture surface.

Spec source: the owner's written prompt (2026-08-15). The visual language, ceremony beats/timings, and interaction mechanics are APPROVED as specified and are not re-litigated here. The controls presentation is explicitly open ("needs work") - §4 is my design answer for sign-off.

## 1. Architecture

**1a. Pure state module** - `src/pillars/bandState.js`, per the approved UI-state extraction pattern (matchLife.js is the template). One reducer owns the ten figures (2 players x [mana, air, earth, fire, water]) and the gesture lifecycle: `press -> ghost -> (cross trigger | cancel) -> commit`, hold-repeat ticks, hard floor 0, no cap, opponent direction mirroring as a pure input (`mirrored: true`), one-step-per-gesture regardless of distance. DOM-free, unit-tested (`test:ui`): floor behaviour, cancel-on-recross, mirror inversion, repeat cadence (380ms then 130ms), simultaneous independent gestures keyed by pointerId.

**1b. Snapshot contract** - `matchSnapshot.js` gains optional fields with defaults: `pMana, eMana, pThr: {air,earth,fire,water}, eThr: {...}` (all default 0). Built and read in the one build/read pair; `isValidMatchSnapshot` unchanged; **no version bump** - an old snapshot resumes with zeros, a new snapshot read by an old build ignores the fields. Forward-only evolution invariant named and held. Persistence rides LifeCounter's existing durable persist points (visibilitychange/pagehide + save cadence) - the durable-offline-writes invariant is inherited, not re-implemented. localStorage only; no SQL, no cross-runtime surface.

**1c. The toggle** - `advanced_band` in profile settings via the EXISTING Tweaks pattern (`LifeCounter.jsx:116,292`: persists to settings AND applies immediately). Default OFF (basic view). Flipping mid-match shows/hides the band; band values are retained while hidden. Life numerals must not move or resize between modes - guaranteed structurally: the band is an OVERLAY positioned off the divider, not a flex sibling of the numerals (verified by screenshot diff of the numeral region across the toggle).

**1d. Rendering** - `CounterBand` inside the counter scope: two strips absolutely positioned 6px off the 2px divider (player below, opponent above), 10% side insets, 38px tall, the two-layer clip-path cartouche exactly as specified (outer gilt keyline layer + inset dark fill), grid `56px repeat(4, 1fr)`, mana pill + four threshold figures, opponent FIGURES individually rotated 180 (the strip itself is not rotated - and nothing in the band scrolls, so no rotated-scroller paint-trap shape exists). No backdrop-filter, no shadows, hairlines only (the §6 paint rules and the anti-patterns list agree). All animation is transform/opacity - compositor-safe under the counter's always-animating pulses.

**1e. Ceremony** - triggered on roll RESOLVE (the `matchRoll` phase machine already exposes it): divider flash 520ms -> strip unroll scaleX 0->1.02->1 620ms (player 0ms, opponent +80ms) -> ten figures stamp 1.6->1 340ms, 60ms stagger, opponent row +80ms - timings verbatim from the spec. Resumed matches (which skip the roll) mount the band instantly with no ceremony. Reduced motion: unroll/stamp/pulse/trail all collapse to their end states via the global neutralizer - the band must be fully legible with zero animation, which the keyframes guarantee by ending at identity.

## 2. Element pips (RESOLVED - owner correction + rulings 2026-08-15)

The band uses the app's EXISTING shared `ElementPip` (`ui.jsx:210`) - the same primitive the deck builder, Codex articles, and sheets already use. It already implements the spec's exact contract: the real element icon from `public/icons` when imagery is enabled, the coloured ▲ glyph fallback when the asset is missing or images are suppressed. Nothing new to build or bundle; the zero-image invariant is inherited. (My original draft claimed no element assets existed - wrong, corrected by the owner.)

**OWNER RULING: the band uses the app-wide `--el-*` element tokens** (`--el-air #67b6c4, --el-earth #b35c33, --el-fire #d2645a, --el-water #5b87d6`), NOT the prototype's band-specific palette - every pillar shows identical element hues. Legibility on the dark strip is checked in the device pass; if a hue genuinely fails contrast there, that comes back as a finding, not a silent re-tint.

## 3. Fixed interactions (implementing as specified)

Horizontal drag = one step (trigger ~20px, haptic AT the crossing, ghost until release, recross cancels, mirrored for the opponent's seat); tap <=10px opens inline steppers with hold-to-repeat; floor 0 with feedback (see §4.5); no upper cap. Multi-touch: gesture state is per-pointerId in the reducer, so both players can operate simultaneously - listed in the device test plan because WebView multi-touch is only provable on glass.

## 4. Controls presentation - my design (the "needs work" items)

**4.1 Placement: the steppers dock OUTSIDE the strip, not beside the figure.** The strip is 38px tall and its columns are ~60px wide - there is no honest room to flank a figure horizontally inside it without crowding neighbours or breaching the cartouche points (the prototype's miss). Design: on tap, the - / + pair appears in the clear band BETWEEN the strip and that player's life numeral (above the strip for the player, below for the rotated opponent - i.e. always on the tapped player's own side), horizontally centred on the pressed figure's measured bounds, edge-clamped to the strip's span. They never collide with neighbouring figures, never overhang the cartouche ends, and have room for full 44px targets. The pressed figure gets a 1px gilt underline marking the association. This reads as the figure "opening toward its owner", consistent with the delta trail rising away from the divider. Fallback if you prefer in-strip: flanking with measured-bounds anchoring and neighbour-suppression - buildable but I recommend against it.

**4.2 Drag affordance:** on press, a 1px gilt rail (`rgba(220,184,111,.35)`) draws under the pressed figure, extending +-22px with a tick dot at each trigger distance; minimal - / + marks sit at the rail's ends at 40% gilt. The ghost value rides the drag; the figure itself never moves. The rail is the affordance AND the ruler - it shows where the step commits.

**4.3 Choreography:** steppers stamp in (scale 1.3->1 + fade, 200ms, the approved stamp cubic) and dismiss with the reverse at 160ms; pressed state is a gilt fill `rgba(220,184,111,.16)` + scale .94; each hold-repeat tick pulses the button's hairline ring in sync with its haptic. Dismiss on tap elsewhere, on drag-start of any figure, and on mode toggle.

**4.4 Hit targets:** figure press areas span the full column width and extend 14px above/below the 38px strip (>=44px effective, invisible); steppers are 30px visual with expanded 44px hit boxes.

**4.5 Edge cases in the device plan:** opponent-row mirror correctness, 0-floor feedback (a short 90ms shake of the figure + the warm-red ghost refusing below 0 - no step, no haptic), rapid alternating gestures, simultaneous both-player touches, 3-digit mana pill stretch without threshold movement, mode toggle with steppers open.

## 5. Decisions - ALL RULED by the owner, 2026-08-15

- **D-b1 RESOLVED:** the existing shared `ElementPip` is the badge system; ▲ fallback inherited (owner correction - see §2).
- **D-b2 RULED: app `--el-*` tokens** - element hues identical across every pillar.
- **D-b3 RULED: steppers outside the strip** (§4.1 design as written).
- **D-b4 RULED: table state only** - no match-log entries, no history writes.
- **D-b5 RULED: Tweaks sheet, default OFF.**

## 6. Invariants and docs touched

Durable offline-first writes (snapshot fields ride the existing persist), forward-only schema evolution (optional fields, no bump, old snapshots valid), graceful zero-image (pips are the base rendering), cross-runtime integrity untouched (localStorage only). WebView §6 paint rules: no blur, hairlines only, compositor-only animation, no scroll surfaces in the band. Docs: DESIGN_SYSTEM gains the cartouche + band vocabulary under the counter scope exception; COMPENDIUM_FEATURE_MATRIX gains the Advanced view capability row; matchSnapshot contract doc-comment updated.

## 7. Verification

`bandState` unit suite (floor/mirror/gesture/repeat/multi-pointer); gates; device (agent-run): ceremony capture at spec timings, numeral-region pixel diff across the toggle (must be zero), 3-digit mana reflow check, mirrored drag from the opponent seat, simultaneous touches, 0-floor feedback, resume round-trip with band values, reduced-motion still-state, zero-image (pips) - plus your hands on the glass for feel, which no capture replaces.

## 8. Self-critique

The §4.1 outside-the-strip placement is the strongest opinion here and deviates from the prototype's sketch - if your fiddling landed somewhere specific that I am overriding, the prototype file will show me and I will fold. Multi-touch simultaneity in the WebView is asserted from pointer-event semantics but only device-provable. And the ceremony's interaction with a mid-ceremony mode toggle (advanced switched off during the unroll) needs one explicit rule: the band completes its ceremony and then hides - simpler than cancelling mid-flight.
