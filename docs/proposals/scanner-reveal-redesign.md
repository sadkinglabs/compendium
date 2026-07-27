# Proposal: Card Scanner — recognition reveal redesign ("The Gilt Impression")

**Branch:** `scanner-reveal-redesign`
**Class:** Standard
**Author:** Claude Code (lead engineer) · concept by Fable 5
**Reviewer:** Codex (principal engineer / independent review)
**Status:** Rev 7 — implements Codex's "final experience" review: one shared presentation clock,
title *translation* (not scale), no frame scaling, a stronger/shorter bloom synced to the haptic,
frozen recognised identity, ownership removed from the ceremony, app fonts, rounded guides, 48dp
close. **MERGED** to `main` (bb7e391, build 206). Owner-accepted on device for the visual + haptic
experience; the a11y/reduced-motion/layout matrix was NOT formally run (see §6). (Rev 5 =
fonts/guides/divider; Rev 6 = violet frame + building haptic; both folded in.)

---

## 1. Problem / goal

Phase 1 of a larger scanner pass, scoped to the **recognition reveal + scanner screen** only
(matching/reliability come later). Two prior directions were rejected by the owner:

- **Rev 2 "Halo Reveal" — too busy:** a travelling outline + full-frame glow + expanding ripple +
  foil gleam over the card + multi-part haptic + overlapping text. "The frame celebrated itself
  instead of confirming the card."
- **Rev 3 "Archivist's Mark" — too austere:** four minimal corner brackets that nudged in and grew
  a tiny serif; one tick. "Underwhelming… not magical/gilded/expensive/luxe/arcane."

Rev 4 lands deliberately between them: **rewarding and luxe with ONE rich gesture**, not six.

Governing constraint (owner brief): the reveal must **never depend on the remote card image** — no
camera→render crossfade, no waiting on the CDN, works identically offline. The remote image, if it
ever loads, belongs in detail views, never in the success choreography.

## 2. Recommended concept (single, committed) — by Fable 5

**The Gilt Impression.** Recognition is one act: a gilded **double-rule manuscript frame with corner
bosses** is *stamped* around the live card in a single press, blooms softly as the gold leaf catches
light, then quiets to a still gilt page-rule. Luxe comes from **material depth**, not motion — four
layers of one silhouette: an **ink shadow** debossed under the gold (letterpress seating), the **gold
body** (thick outer rule + thin inner rule, a manuscript page edge), a wide low-alpha **halo** (the
leaf catching candlelight, done as a stroke — no blur), and a thin parchment **sheen** skimming the
top. Four gold **corner bosses** (bookbinding studs, each on an ink dot) pin it. One gesture, done
richly, held ~800ms, then still.

## 3. Proposed change

### 3.1 Overlay rewrite (`ui/CameraOverlay.kt`) — states + timeline

Signature `CameraOverlay(phase, lockEvent, rec: Recognition?, reduceMotion: Boolean, modifier)`,
driven by the existing `phase`/`lockEvent`/`sheet` flows (no pipeline change).

- **Ready** (`SEARCHING`, no result): four parchment `#EFE7D8` corner brackets (~45% alpha) over a
  lightly dimmed surround. "Point at a card". Still.
- **Recognising** (`DETECTING`, no result): brackets warm to the Decks-violet token; a faint full
  hairline breathes on the guide (≤18% alpha, ~1.1s sine). "Recognising…". `StabilityGate` requires
  a stable streak before a lock, so success never fires on fluctuating OCR candidates.
- **Recognised** (a new `lockEvent`, sticky result): the impression, off a 0→0.8s clock —

  | Window | Beat | Property / easing |
  |---|---|---|
  | 0–90ms | brackets fade; impression scale 1.015→1.0; rules+bosses 0→92% | `press` (.16,1,.30,1) |
  | ~90ms | **contact** — haptic click; core alpha 92→100% for 60ms then 92% | — |
  | 90–210ms | ink shadow seats (0→22%) — arrives *after* the gold | `settle` (.4,0,.2,1) |
  | 90–260ms | halo swells (3→8dp, 0→18%) | `settle` |
  | 120–300ms | sheen skims in (0→16%) | `settle` |
  | 90–260ms | "Recognising…" → card **name** (+ its gilt rule) | `settle`, text alpha |
  | 150–320ms | collection line follows | `settle`, text alpha |
  | 260–800ms | halo decays (8→4dp, 18→8%) to a quiet persistent gold | `decay` (.33,0,.67,1) |
  | by ~800ms | fully still | — |

  Success is coloured by the result's type accent token (gold card / violet deck / jade match). The
  whole impression presses via one `graphicsLayer`-equivalent Canvas `scale` about the guide centre.
  **Gilded depth = stacked opacity on one hue** (ink / body / halo / sheen); gradients along the
  stroke are deliberately forbidden (the "cheap foil" look).

### 3.15 Codex "final experience" changes (Rev 7)

Implementing the Codex review in full where practical:
- **One shared presentation clock.** `ScannerScreen` owns a single `reveal` Animatable (0→1 / 800ms,
  keyed on `lockEvent`) passed to BOTH `CameraOverlay` and `RecognitionCard`. The overlay reveal and
  the tray entrance are now one timeline; the tray's own 240ms animator was removed. The tray
  **arrives late** (reveal 0.52→0.875) so it doesn't overpower the frame/name beats.
- **Title translates, not scales.** The name now animates `translationY 14dp→0` + alpha over reveal
  0.22→0.52 (≈180–420ms) — real vertical movement (Codex: "use no title scaling"). Two-line max.
- **No frame scaling.** The 1.06 press/rebound is removed; impact is expressed by **brightness**
  (core alpha peaks at contact) + **stroke weight** (rules heavier at contact) + haptic sync.
- **Stronger, shorter bloom synced to the haptic.** Halo peaks ~50% alpha at reveal≈0.29 then
  settles by ≈0.60; `culminate()` retuned so its firm finish lands ~150–230ms (the bloom peak).
- **Frozen recognised identity.** `ScannerViewModel.onResult`/`onLink` ignore all further matches
  while `locked != null`; the shown card cannot change under a user reaching for an action. Resumes
  only on "Scan another" / a completed action.
- **Copy:** "Position a card within the frame." → "Hold steady" → name. **Close:** 48dp target.
- **TalkBack:** the overlay recognised block is `clearAndSetSemantics {}` (decorative); the result
  tray is the single announcer, so name is not read twice.

### 3.2 Confirmation info — name only; ownership DEFERRED (Codex)

Status sits above the frame (never over the card). On a lock it shows the **card name** only (the
payoff). The **ownership line was removed** and deferred to Phase 2 on Codex's recommendation: the
Rev 6 optimistic native increment could display a count before JS acknowledged the write, so a
decorative line could momentarily misrepresent collection data. The full solution (per-write
request-ID + committed-count acknowledgement from JS) belongs with the Phase-2 write path; until
then the ceremony makes no ownership claim. Deck/match results show a kind label ("Shared deck" /
"Shared match"). The entire ownership handoff (JS `owned`/`ownedKnown`, the plugin/channel fields,
`Recognition.ownedCount`, the native increment) is reverted; the `reduceMotion` handoff stays.

### 3.3 Haptics (`ScannerHaptics`) — build → climax (Rev 6, owner direction)

The owner asked for the 1.0.2 "felt like an achievement" escalation back (Fable's single crisp tick
read as anticlimactic). Two events: a light `tick()` (14ms) when a candidate is being read
(`DETECTING`, debounced 800ms) — the *build* — then `culminate()` on the lock: a `createWaveform`
whose amplitude **ramps soft→strong and lands on a firm 200ms finish** — the *climax*. `culminate` is
keyed on `lockEvent`, so a stationary card never re-fires and a newer lock restarts it. This
deliberately reverses the Rev 2→5 "one flat tick" (owner direction prevails); it pairs with the
brighter gold halo flare so the visual and haptic climax together.

### 3.35 Type + chrome consistency (Rev 5 — owner consistency pass)

The reveal was on-concept but off-brand in three ways; all now aligned to existing tokens:

- **Fonts.** The scanner rendered in system Roboto. The app's three shipping families
  (`--f-display` Cinzel / `--f-read` EB Garamond / `--f-ui` Hanken Grotesk, `src/theme/fonts`) are
  web-only woff2, which Compose can't load, so their 400 masters were converted to TTF (fontTools)
  and bundled in `android/app/src/main/res/font/`. `ScannerTheme` now defines the three
  `FontFamily`s, sets a `Typography` + `LocalTextStyle` default of **Hanken** (so buttons and every
  plain `Text` inherit it, not Roboto), and **Cinzel** is applied to the card name + the sheet
  eyebrow/title, **EB Garamond** to reading copy. Compose synthesises heavier weights, mirroring the
  app's faux-bold (OD-19). No new font weights invented.
- **Corner guides rounded.** The ready/recognising corner guides were square Ls; they now trace the
  card's own corner radius (a 90° arc of radius `r` + short edge arms), so they sit on the corners
  the user aligns to.
- **Name divider.** The solid gold underline became the app's **centre-weighted fade gilt hairline**
  (transparent→gilt→transparent), the manuscript divider idiom used elsewhere.
- **Feedback loop preserved + clarified.** The idle → recognising → recognised guidance (which the
  owner flagged as load-bearing) is intact: parchment "Point at a card" → violet corners + a
  breathing guide hairline "Recognising…" → the gilt impression + name. The recognising cue was
  given slightly more presence. The pipeline (when `DETECTING` fires) is unchanged — matching work
  is the later phase.

### 3.4 Result panel (`ui/RecognitionSheet.kt`)

The action panel stays (it carries Search Codex / Collection / Wishlist / qty), but its entrance is
de-bounced: a quiet ease-out slide + fade (`tween(240, (0,0,.2,1))`), **no spring/scale
overshoot**. `SparkleBurst` (and its `Spark`/`sparkle` helpers) are **deleted** — no particles.

### 3.5 Reduced motion

The resolved preference (`body.reduce-motion`, folded from the user setting OR OS
`prefers-reduced-motion` by `appearance.js`) is passed at `scan()` → channel → activity → Compose.
When on: no breath, no settle, no glow, no loop are constructed at all; corners change straight
from the recognising to the success style, the serif is present at once, text crossfades quickly,
the panel is at rest, one optional tick. Recognition stays clear via colour + geometry + text.

### 3.6 Files touched

```
 src/cardScanner.js                                 (reduceMotion + hardened owned/ownedKnown handoff)
 .../scanner/CardScannerPlugin.kt                   (parse reduceMotion + owned/ownedKnown)
 .../scanner/ScannerChannel.kt                      (reduceMotion, ownedCounts, ownedKnown + reset)
 .../scanner/model/ScanModels.kt                    (Recognition.ownedCount, -1 = suppress)
 .../scanner/ScannerViewModel.kt                    (set ownedCount, honouring ownedKnown)
 .../scanner/ScannerActivity.kt                     (snapshot reduceMotion; single confirm tick; session-increment owned)
 .../scanner/ScannerHaptics.kt                      (single confirm tick; drop waveform + detect tick)
 .../scanner/ui/CameraOverlay.kt                    (full rewrite: Archivist's Mark)
 .../scanner/ui/ScannerScreen.kt                    (pass rec + reduceMotion; drop SparkleBurst)
 .../scanner/ui/RecognitionSheet.kt                 (de-spring reveal; delete SparkleBurst)
 DESIGN_SYSTEM.md                                   (rewrite the scanner-reveal §6 entry)
```

## 4. Decisions (owner) & scope

- **No card render / no art in the success moment** — owner brief + a hard technical constraint
  (CDN-only art). The reveal is Canvas-vector only and never touches art.
- **Collection line re-added, hardened** — owner reversed Rev 2's deferral; §3.2 removes the
  false-claim and staleness defects Codex flagged. (This re-opens the ownership path for review.)
- **Palette: shipping tokens** — unchanged owner ruling from Rev 2.
- **Concept: The Gilt Impression** (Fable 5), a single committed gesture — the middle path between
  the rejected busy (Rev 2) and austere (Rev 3) extremes.

## 5. Invariants (ENGINEERING_CONSTITUTION §3)

- **Graceful zero-image degradation** — HOLDS, and is now *central*: the design forbids any art in
  the reveal by construction. The confirmation is name + local count only.
- **Offline-first** — HOLDS. No network in the scan/reveal path; recognition never awaits the CDN.
  `owned`/`reduceMotion` are local reads. No writes added (JS still owns the ledger).
- **Catalog / profile boundary** — the ownership snapshot is read-only display data scoped to the
  active profile; native never writes it. The session-increment is an in-memory display bump on the
  native side mirroring an add JS has been told to persist — it does not write the DB.
- **Content-is-data / cross-runtime integrity** — unaffected (no schema/serialization change).

**Accessibility (DESIGN_SYSTEM §5/§6):** reduced-motion still-fallback implemented; single
`clearAndSetSemantics` status announces exactly the destination text.

## 6. Verification

- `npm run check:types` — PASS. `npm run build` — PASS. `npm run check:cycles` — PASS.
- `:app:compileDebugKotlin` — **BUILD SUCCESSFUL**. `npm run check:docs` — expected PASS.
- **Device (recorded):** owner installed builds 202→206 on **Pixel 9 Pro XL · Android 17 (SDK 37) ·
  System WebView 150.0.7871.124**, signed **release** APK, and iterated the reveal to acceptance
  ("Phase 1 is good to go") — so the **normal-motion reveal, frame pacing, and the building/
  culminating haptic are owner-accepted on that device**. Codex re-review waived by the owner.
- **Device checklist run (2026-07-27, Pixel 9 Pro XL / Android 17 / WebView 150 / release 206):**
  | # | Case | Result |
  |---|---|---|
  | 1 | App reduce-motion still state (haptics preserved) | **PASS** |
  | 2 | OS reduce-motion still state | **PASS** |
  | 3 | TalkBack (once, no stale, traversal/labels) | **NOT CHECKED** (owner deferred) |
  | 4 | Android Back dismisses result before exit | **FAIL → fixed build 207** (`BackHandler`; needs re-verify) |
  | 5 | Font/display scaling affects scanner text | **FAIL → deferred to Phase 2a** (native honours neither OS font nor the app `--ui-scale`; needs a font-scale handoff, done with the sheet rebuild) |
  | 6 | Short/notched portrait layout | **PASS** |
  | 7 | Touch targets ≥48dp | **PASS** |
- **Follow-ups:** #4 fixed in build 207 (re-verify pending); #3 TalkBack + #5 font-scale carried into
  the Phase-2a verification matrix. "Merged" is not a substitute for those.

## 7. Self-critique / risks for the reviewer

1. **Untestable surface.** The payoff is motion CI cannot see; the double-rule outset/radii, boss
   placement on the corner diagonal, and the 0.8s beat timings are the likeliest to need on-device
   tuning. Whether the layered-opacity gold reads "expensive" on a real panel is the core unknown.
2. **Codex items only partially addressed (deferred, not silently dropped).** From Codex's final
   list I implemented the choreography, unified clock, freeze, ownership removal, copy, 48dp, and
   the TalkBack de-duplication. Still OPEN and not in this rev: explicit **focus move** to the tray
   heading after the single announcement; a visible **"Not this card / Scan again"** recovery action
   (today's "Scan another" is the only recovery); **save-failure inline retry** (a failed add still
   surfaces only as a closing toast); **long-name reserved height** and **short-screen independent
   tray scroll**; and the **result-tray hierarchy restructure** (mode-specific primary/secondary
   ordering). These are a follow pass; the reviewer should weigh whether any are merge-blocking.
3. **No true "failed recognition" state.** The brief describes a "Couldn't identify card" state, but
   distinguishing *a card is present but unmatched* from *an empty frame* needs presence/confidence
   signals the current pipeline lacks. Deferred to the functionality phase (which adds those
   signals); the scanner simply stays in ready/recognising meanwhile. Called out so it is not
   mistaken for an omission.
4. **Per-frame draw during the ~800ms reveal** is ~16 cheap draws (strokes, 8 circle fills) inside
   one Canvas `scale`; geometry is computed per-Canvas-pass, not precomputed across frames (Fable's
   brief suggested precomputing paths at layout — a viable optimisation if profiling shows cost).
   Steady states run zero animation. Not profiled on a low-end device.
5. **Rapid-scan abbreviated form not implemented.** Fable specified a shorter (~300ms) impression for
   a *different* card recognised while one is still settled (fast binder-flipping). Current code
   replays the full 0.8s timeline on each new lock (the sticky-sheet model has no leave-frame
   release, by earlier design). Full-each-time is correct and brisk enough; the abbreviated form is
   a deferred polish, noted not silently skipped.
6. **Status placement.** Name + collection line sit in the top status area, not tucked immediately
   above the guide; on a very short screen the gap to the frame is larger than ideal. Device-gated.

## 8. Rollback

Single branch, not committed. Revert = discard the branch. No migration/schema/persisted state.

## 9. Documentation impact

| Document | Assessment | Action |
|---|---|---|
| `DESIGN_SYSTEM.md` | The reveal changed substantially + gained an explicit type/divider/feedback-loop contract and a "deliberately excluded" list. | **Edited** — rewrote the §6 scanner-reveal entry (Gilt Impression + fonts + rounded guides + divider + feedback loop). |
| `android/app/src/main/res/font/*.ttf` | Bundled the app's three type families (Cinzel/EB Garamond/Hanken) as TTFs so the native scanner matches app typography. Converted from the existing bundled woff2 (fontTools); no new fonts sourced. | **Added** (3 files, ~0.4MB). |
| `COMPENDIUM_FEATURE_MATRIX.md` | "Camera-assisted entry" already **Implemented**; still a visual refinement. | **No change.** |
| `COMPENDIUM_ARCHITECTURE.md` / `COMPENDIUM_DATA_MODEL.md` | No pillar/boundary/table change; ownership snapshot is read-only, native writes nothing. | **No change.** |
| `BUILD.md` | Existing zero-image + `check:smoke` device-gate language covers "native behaviour is device-verified"; a scanner-specific motion check can be added once verified on the APK. | **No change now.** |
| `AGENTS.md` / `ENGINEERING_CONSTITUTION.md` | No process change. | **No change.** |

## Appendix — round history

- **Rev 1 → Rev 2:** Codex round-1 (reduced-motion, ownership trust, docs/palette, shared-code copy)
  all resolved; ownership deferred, palette → tokens.
- **Rev 2 → Rev 3:** owner rejected the Halo Reveal as too busy; re-choreographed to the austere
  Archivist's Mark. Ownership **re-added hardened** (sentinel + session-increment) per the owner's
  new brief. Reduced-motion, single haptic, no-sparkle, no-spring, no-art carried/strengthened.
- **Rev 3 → Rev 4:** owner found the Archivist's Mark too austere ("not magical/gilded/luxe"); asked
  Fable 5 to design a middle path. Result = **The Gilt Impression** (this rev). Features unchanged
  (hardened ownership, reduced-motion, offline, single haptic — now retimed to the contact frame and
  using the system click). The reveal chrome gained material depth (ink/body/halo/sheen + bosses)
  while staying one gesture. Codex's Rev-2 Minor (no animation machinery constructed under reduced
  motion) is preserved.
- **Rev 4 → Rev 5:** owner consistency pass — the scanner now uses the app's shipping type families
  (Cinzel/EB Garamond/Hanken, converted woff2→TTF and bundled), the ready/recognising corner guides
  are rounded to the card's radius, the name divider became the manuscript fade-hairline, and the
  three-state feedback loop was explicitly preserved and documented as load-bearing.
- **Rev 5 → Rev 6:** owner wanted a stronger climax. Recognising now shows a **full breathing violet
  frame** (clear "engaged"); haptics went **build→climax** (light engaged tick + a growing
  culminating pulse, restoring the 1.0.2 feel — reverses the single-tick); the gold halo flare is
  brighter/faster and the press more decisive; and the close control became a **gold-X round button
  top-right** (app language) with the reveal text offset clear of it.
- **Rev 6 → Rev 7:** Codex "final experience" review (owner: "we trust codex"). The title now
  *translates* rather than scales (the "snap" it identified); frame scaling removed (impact via
  brightness + stroke weight + haptic sync); bloom stronger/shorter and haptic-peak-aligned;
  overlay + tray unified on one `ScannerScreen` clock (tray arrives late); recognised identity
  frozen; ownership removed from the ceremony (deferred to Phase 2 with a committed-write ack);
  tray heading made compact; copy updated; close 48dp; TalkBack de-duplicated.
