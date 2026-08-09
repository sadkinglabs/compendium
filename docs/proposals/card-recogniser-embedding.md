# Proposal: Embedding-based card recogniser alongside the OCR scanner

## Status and classification

**Rev 4 - APPROVED by Codex on 2026-08-03 with non-blocking follow-ups (folded in below);
proposal-review gate cleared, pending owner approval of the architecture + authorisation of
Gate 0.** **Risk: High** (new native inference dependency, new build/training toolchain, new
bundled artifacts, recognition-correctness surface, APK size). Author: Claude Code (lead).
Reviewer: Codex. Approver: owner.

**Codex non-blocking follow-ups (folded into Rev 4, no Rev 5 required):** (1) the false-lock
interval method is frozen before corpus sizing/sealing - one-sided Wilson upper bound, recorded
in `RunSpec` provenance (§5.4.5); (2) `catalogGenerationHash` is a required typed `scan()` input
at Gate 2, missing/mismatched disables embeddings for the session (§8 Gate 2); (3) the remaining
owner decisions carry an explicit timing schedule (§13). Codex accepts the legal entry as the
owner's recorded risk decision, not a legal opinion.

**Rev 2 (summary):** owner-confirmed reframe - the problem is **recall, not precision** (OCR is
~100% right when it locks; it silently fails to lock, sites first) and the encoder's mandate is
to recover that recall while preserving ~100% precision; single-card reliability is the primary
intent and board scan a read-only snapshot bonus; Gate 0 is bar-setting with an honest off-ramp;
foils may lag initially; iOS portability relaxed (Android-now); the runtime stack was posed as
open question OQ-1.

**Rev 3 (summary):** resolved Codex's proposal findings - governed three-way data splits with a
sealed test set and an unseen-card identity holdout; hard-negative/OOD coverage; CIs on every
headline metric; conditional fail-closed "no retraining" claim; multi-prototype index
(per-scan prototypes, best-score card aggregation, distinct-card top-5); reproducible artifacts
promoted under the existing journal; image-corpus governance (private store, consent, EXIF,
manifest) + per-instance board annotations; sustained-search recovery UX; the MIT-claim
correction; LiteRT + MobileNetV4-Conv-S PTQ-int8 recorded as the primary measured stack; gates
restructured with a runtime/export spike (Spike R).

**Rev 4 - Codex "Changes required" dispositions + two owner additions:**
- **Major 1 (digest self-reference):** the recognition digest no longer hashes a set the index
  declares about itself. The index is bound to an **independently authoritative recognition-
  input projection**: the existing catalog-generation hash (`scripts/catalog/generation.mjs:87`,
  which already folds catalog content + content-addressed art keys) plus a deterministic
  **prototype manifest** (source keys/hashes, card ids, inclusion/exclusion decisions,
  encoderVersion). The build gate independently DERIVES the expected prototype set from those
  inputs and compares; an omitted prototype or a stale index now fails closed to OCR (§5.1).
- **Major 2 (Gate 3 proof):** the primary recall bar is now a **PAIRED ON-vs-OFF comparison on
  the same sealed cases and slices** (visual-first must beat OCR-only on the sealed set itself,
  per slice), not a comparison against the separate calibration baseline; the false-lock
  shipping threshold is an **owner-accepted upper confidence bound** with the independent
  negative corpus **sized to demonstrate it** (zero-observed is necessary, not sufficient); the
  statistical unit is the **capture session/scene**, not correlated frames (§5.4.5, §8 Gate 3).
- **Major 3 (legal self-authorization):** the Rev-3 "unresolved but locally permitted"
  contradiction is removed - replaced by the **owner's recorded determination (2026-08-03)**
  covering training, checkpoint retention, repository storage, and APK distribution of weights
  derived from the card art, with a licences/attribution surface in Settings as a scope
  deliverable (§1.1, §16, owner addition B).
- **Owner addition A (DROP-pipeline artifact generation):** a catalog DROP that adds cards MUST
  generate their content-addressed image keys AND prototypes, recorded in the prototype
  manifest and promoted atomically with the catalog in the same journalled transaction - the
  index never lags the catalog (§5.6, §2 goals).
- **Owner addition B (legal determination recorded):** see Major 3; remaining-owner-decision #1
  is resolved and removed (§13, §16).
- **Minors:** index size consistently ~1.6MB (§5.7 corrected); **Spike R freezes the
  owner-approved cold-init and memory ceilings before Gate 2 begins** (§5.7, §8); invariant 7's
  wording aligned to the conditional §5.6 contract (§7).

**Settled owner decisions (recorded as fixed - not reopened here):** future recogniser platform
baseline is **minSdk 29 / Android 10**, release ABI **arm64-v8a only**, debug retains
**x86_64**, effective at recogniser Gate 2 unless separately approved earlier;
compileSdk/targetSdk 36 is a **separate increment due August 31, 2026**; preferred inference
hypothesis **LiteRT + MobileNetV4-Conv-S int8**, subject to the measured gates. The Android
platform architecture-record increment is Codex-APPROVED separately.

This document does four things: (1) an adversarial verdict on the design brief, grounded in the
actual repository; (2) an analysis of the real current implementation; (3) the recommended design
and a gated plan whose first gate establishes governed data and the recall baseline that sets the
bars the encoder must clear; (4) the owner's confirmed bonus capability - **multi-card board
scan** - designed in as the general case of the same pipeline rather than a future rework.

---

## 1. Verdict on the brief

The brief's core instinct is right: **encode a card crop, nearest-neighbour against precomputed
per-card embeddings, let OCR close only the last inch, measure before building.** Several of its
specific claims about *this repository* are wrong, and two of its architectural placements would
actively damage the measurement architecture the scanner just acquired in Phase 2a. Item by item:

### 1.1 Sound - keep

- **Additive, feature-flagged, OCR retained.** Correct posture. The scanner already has the pattern:
  tunables live in `ScanConfig` (`android/.../scanner/session/ScanSession.kt:46`) and
  `GuideGeometry` (`android/.../scanner/model/ScanModels.kt:48`), and the plugin accepts options at
  `scan()` (`android/.../scanner/CardScannerPlugin.kt:53`).
- **No vector DB.** Correct, and even more so at the real scale (Section 2.4): ~1,109 classes.
  Brute-force cosine over a packed `FloatArray` is tens of microseconds. FAISS/ANN would be
  indefensible complexity here (Constitution §4.2).
- **Model licensing - directionally right, but the brief's premise about the app is wrong, and
  it conflates two different questions (Rev 3, Codex #6).** The app is **not** MIT: the README
  states plainly that "Application source code is not licensed for redistribution" and that the
  bundled card data, rules text, and card art are the property of their respective owners
  (`README.md:76`). Two separate legal questions must not be blurred:
  (i) **runtime/backbone licence compatibility** - correct as the brief says: MobileCLIP/
  MobileCLIP2 weights are under Apple's research licence (apple-amlr) and MUST NOT ship; an
  Apache-2.0 backbone (MobileNetV4-Conv-S or EfficientNet-Lite, e.g. via timm) is compatible
  and, fine-tuned on the closed catalog, will beat generic CLIP anyway;
  (ii) **the right to train on and distribute weights derived from the card art** - the art
  belongs to its owners and the model weights are arguably a derived work. This is not an
  engineering call, and Rev 4 no longer makes one: it is settled by the **owner's recorded
  determination (2026-08-03, §16)**, which covers training, checkpoint retention, repository
  storage, and APK distribution of the derived weights for this non-commercial application.
  Gate-1 training is permitted BECAUSE that determination is recorded - not by engineering
  self-authorization. A companion scope deliverable: a **licences/attribution surface in
  Settings** covering all bundled ML technology whose licence requires notice (e.g. the
  Apache-2.0 backbone NOTICE), landing with the model (Gate 2 dark, user-visible by Gate 4).
- **Synthetic capture simulation is the real work.** Agreed. Glare (plain and rainbow-banded for
  foils) and sleeve simulation are the highest-value hand-written augmentations because glare is
  precisely where OCR dies. And the input is in hand from day one: the owner has confirmed, and
  the assets prove (Section 4(a)), that the repo's masters are **full-card renders** at 744x1039
  or 380x531 - both ample for a 224-256px encoder input. No external image sourcing is needed;
  no art-only contingency exists.
- **ArcFace head, discard head, prototypes, L2-normalised.** Standard and right - with two
  Rev-3 corrections. First, the *averaged*-prototype detail is replaced by the measured default
  of one prototype per distinct source scan with best-score aggregation (§5.3, Codex #2).
  Second, the implied "adding a set never requires retraining" is now **conditional, proven, and
  fail-closed** (Codex #1): the encoder is intended as a generic "Sorcery card embedder" whose
  new cards enter by embedding masters into new prototypes (content-is-data, invariant 7), and
  Gate 1 *tests* that with a stratified unseen-card holdout - but a new card that fails the
  unseen-class or collision gates at index build **stays OCR-only** (or triggers a retraining
  decision); it is NEVER forced into the visual index (§5.4, §5.6). Retraining remains an
  exceptional, evidence-driven event, not a catalog-update step - as long as the gates keep
  passing.
- **The embedding approach also unlocks a bonus OCR never can: board scan.** The owner's primary
  intent is single-card reliability, and the encoder is justified on that alone (the recall
  mandate, Section 2) - but quad detection + per-quad embedding additionally enables **board
  scan**: photograph a mid-match board and get the visible cards recognised at once, each row
  reusing the existing Codex card detail (FAQs, rulings, related articles - Section 3.5). With
  embeddings that is K independent rectified crops through the *same* encoder + cosine search.
  With OCR it is close to impossible: at board distance a name strip is a few pixels tall, far
  below ML Kit's character floor the current extractor already has to upscale for at point-blank
  range (`StripExtractor.kt:68-76`). The brief undersold this as a stray eval-category mention;
  this design keeps it where it belongs - a phased bonus (Phase B), never the justification.
- **Version coupling is a real failure mode** (silently-confident wrong matches from a stale
  index) - but the repo's reality softens it and the brief's remedy breaks an invariant
  (Sections 1.2.6 and 5.1).
- **BUILD FIRST: an eval number before a model.** Right, with one Rev-2 reframe: the owner has
  effectively decided single-card reliability must be fixed, and the recall problem is real by
  both owner experience and corpus evidence (Section 3.2). So Gate 0 is not a coin-flip "should
  we build" - it is **bar-setting**: measure OCR's recall on the hard slices (sites, foils,
  angles, dim - the existing corpora contain zero such cases, Section 3.3), size the win, set the
  encoder's recall bar, and fix the precision floor it must hold. An honest off-ramp remains if
  the number surprises (Section 8, Gate 0).
- **The "Do NOT" list.** All correct and all already true or preserved: no pixels across the
  bridge, no per-frame SQLite, full-screen native Activity (already the architecture -
  `ScannerActivity` covers the WebView), no ONNX-Web/WASM primary.

### 1.2 Wrong or resting on false premises about this codebase

1. **"Fork after existing quad detection + perspective warp" - that infrastructure does not
   exist.** The pipeline is: CameraX frame -> `FrameConverter.toUpright()` which does **rotation
   only** (`android/.../scanner/ocr/FrameConverter.kt:14-22`) -> `StripExtractor`, whose own
   contract is *"Crops ONLY the name strips - never the whole card"*
   (`android/.../scanner/ocr/StripExtractor.kt:21-24`), cropping **fixed fractional rectangles**
   from `GuideGeometry` (`ScanModels.kt:60-64`). There is no quad detection, no homography, no
   rectified card crop anywhere in the scanner. "Additive, not a rewrite" is therefore wrong as
   framed: **rectification is net-new work.** The owner has since confirmed quad detection + warp
   *is* wanted - as the enabler of board scan - so the error is not wanting it, it is claiming it
   exists. This design scopes it honestly: the single-card MVP ships **without** it (guide-crop,
   Section 5.3), and quad detection enters as a first-class, separately gated increment where it
   earns its cost - board scan (Section 5.9).
2. **"Decision logic in TypeScript; native returns top-5 to TS at 4Hz" - wrong for this repo, and
   harmful.** The decision layer here is a **pure Kotlin reducer** (`ScanSession.kt:97` -
   confirmation = time + observation count + dropout tolerance) plus a shared pure selector
   (`FrameSelector.kt:34-50`), both deliberately shared with the JVM `ReplayHarness`
   (`android/.../scanner/reliability/ReplayHarness.kt:89-109`) so that a policy measured off-device
   is *provably* the policy that runs on-device. That is the centrepiece of the approved Phase 2a
   proposal (`docs/proposals/scanner-phase2.md` §8: "A single pure FrameSelector ... is used by
   BOTH ScannerViewModel and the harness, so the two can't diverge"). Moving thresholds, temporal
   voting, and collision gating to TS would (a) fork the decision path away from the replay
   harness, destroying measurability, (b) push per-frame traffic through a WebView that sits
   *behind* the full-screen Activity and is subject to background throttling, and (c) contradict
   the approved Phase 2 bridge, which is request/respond for reads/writes, not a frame stream.
   **All per-frame recognition decisions stay in pure Kotlin next to the reducer.** JS's role
   grows only where it should: rendering the board-scan *result list* and resolving each row's
   Codex content (FAQs/rulings/related articles) - session-level results across the bridge, never
   frame-level evidence (Section 5.8). JS otherwise keeps exactly its current role: catalog
   supply, writes, navigation (`src/cardScanner.js:26-37`, `CardScannerPlugin.kt:21` - "JS owns
   all DB writes - this plugin never touches the app database").
3. **"Embeddings as BLOB column on variants" - there is no variants table.** `variants` is a JSON
   TEXT column on `cards` (`src/store/schema.js:28`), and the catalog is seeded *from JS* out of
   bundled `public/catalog/cards.json` via parameterized statements (`src/store/catalog.js:56-80`).
   Putting embeddings in SQLite would require a schema v12 migration (forward-only, both runtimes -
   invariant 4 and the native-vs-web DDL constraints), megabytes of base64 through the Capacitor
   bridge on every re-seed, and either a second native connection into the JS-owned DB or a
   violation of the stated native/JS boundary. All of that buys nothing: the catalog ships
   **inside the APK** and changes only at app releases, so the natural home for embeddings is a
   **versioned binary asset in the APK**, mmapped/loaded natively - which is what the brief itself
   falls back to in its open question (b). The fallback is the correct primary. SQLite stays
   storage for *user* data; it is neither storage nor search path for this feature.
4. **The scale is wrong: "~1,400 catalog variants."** Measured from `public/catalog/cards.json`
   and `art-manifest.json`: **1,109 cards, 3,088 printing/finish variants, 3,086 distinct source
   scans**. More importantly the brief indexes at the wrong grain. The scanner's lock contract is
   **card-grain**: `Recognition` carries `cardId` + the set list, and the printing/finish is
   chosen by the user in the set picker after the lock (`ScanModels.kt:16-25`,
   `cardScanner.js:59-68`). So the recogniser's classes are the ~1,109 `card_id`s, with each
   card's prototype averaged over its variants' scans. That **dissolves most of the
   collision-group machinery**: art-identical printings (Alpha/Beta, standard/foil) are the *same
   class* by construction. Derived collision groups remain as a cheap build-time safety net for
   genuinely confusable *distinct* cards, but they are expected to be nearly empty. (Rev 3,
   Codex #2: identity stays card-grain, but the *prototype* grain is per distinct source scan -
   ~3,087 vectors, ~1.6MB at 256-d fp16 before metadata - because averaging visually distinct
   printings/foils of one card into a single centroid can smear the very clusters that make it
   recognisable; §5.3.) **The brief's companion premise - "OCR closes the last inch on
   a 2-3 candidate collision list" - is also dead at printing grain:** the owner confirms the set
   symbol is too small and ill-defined for OCR to ever read reliably, so no amount of OCR can
   tell art-identical printings apart. It never needed to: the native result sheet already
   resolves printings **by user tap** - the "WHICH PRINTING?" chip picker gates the add action
   for multi-set cards (`android/.../scanner/ui/RecognitionSheet.kt:173-185`). Embeddings narrow
   to the card; the printing is and remains a human choice. OCR's only surviving refinement role
   is name-level arbitration between *distinct* cards (names are large and readable at guide
   distance; set symbols are not) - Section 5.5.
5. **"ONNX Runtime not LiteRT (iOS coming)" - speculative premise, and now an explicitly relaxed
   one.** There is no `ios/` directory in this repository; iOS is not in flight, and the owner
   has since **relaxed the portability constraint**: optimise Android now, port later, and do not
   pay a meaningful Android reliability/size tax purely for iOS portability. The brief presented
   a speculative constraint as settled. There *is* a repo-specific argument for ONNX Runtime the
   brief missed - the reliability method here is **JVM replay**, and ONNX Runtime's Java package
   runs the identical .onnx in desktop JVM unit tests (LiteRT's desktop JVM story is much
   weaker) - but per the owner, the whole runtime/model stack is a **named open question for
   Codex** (OQ-1, Section 5.7): candidates, trade-offs, and a reasoned lean are laid out there;
   the final choice is Codex's recommendation + owner sign-off, not a premise of this proposal.
6. **"On version mismatch refuse to scan + re-sync" - violates invariant 6 and assumes a sync path
   that doesn't exist.** Catalog and artifacts ship in the same APK; there is nothing to re-sync
   against (art is the only CDN surface, and it is a degradable asset). The correct fail mode on a
   model/index/catalog digest mismatch is **disable the encoder and continue OCR-only** - the
   scanner must never refuse to scan because an enhancement is unhealthy (graceful asset
   degradation, Constitution §3.6). Mismatch is primarily prevented at **build time** by a
   promote-gate-style check (the repo already has this pattern: `scripts/catalog/promoteGate.mjs`),
   with the runtime check as a fail-closed backstop for the encoder only.
7. **"Build an eval harness of 50-100 real labelled photos; run existing OCR against it" - half
   exists, and the missing half is pixels.** The repo already has frozen, versioned device-capture
   corpora + a fail-closed replay harness with measured baselines: v1 13/15, v2 12/13, precision
   1.00, floors asserted in CI (`FullCatalogBaselineTest.kt:29-33`,
   `docs/proposals/scanner-dropout-tolerant-confirm.md` §2). But the corpus format is
   **text-level** (post-OCR observations; the grammar in `CorpusIO.kt:13-18` has no image field),
   and coverage is sites-heavy with **zero** `SLEEVE_FOIL_GLARE`, dim, off-axis, negative, or
   multi-card cases (v1: 8 site + 7 spell; v2: 12 site + 1 spell/1 similar-name; the `Category`
   enum in `Corpus.kt:20-22` already reserves stress categories, unfilled). So: do not build a new
   harness - **extend the existing corpus with per-frame images and shoot the stress categories**,
   with board shots elevated to a first-class category (Section 5.4). The text-only corpus can
   measure OCR's decision layer; only an image corpus can measure OCR's front end under glare
   *and* later evaluate the encoder - and the quad detector - on identical frozen inputs.
8. **"Bridge = 5 small objects at 4Hz"** - nothing should cross the bridge per frame at all (see
   point 2). The bridge cost of this feature is session-level results only.

### 1.3 Net

Keep: additive + flag, brute-force cosine, Apache-2.0 backbone + ArcFace, synthetic capture
simulation, derived collisions (demoted to safety net), version-coupling awareness, eval-first.
Replace: the fork point (no warp exists - guide crop first, quad detection as the board-scan
enabler), the decision-layer placement (Kotlin, not TS), the storage (APK asset, not SQLite BLOB),
the class grain (card, not variant), the collision closer (user's printing picker, not OCR - the
set symbol is unreadable), the failure mode (degrade to OCR, never refuse to scan), and the
harness plan (extend the existing corpus with images, don't parallel-build).

---

## 2. Problem, goals, non-goals, acceptance

**Problem - a recall problem, not a precision problem.** When the OCR scanner locks, it is
right: measured precision 1.00, zero false locks across both frozen corpora, matching the owner's
experience that OCR was "~100% correct when it locked". The failure mode is that it **silently
fails to lock**: sites above all (the whole Phase-2a corpus history is sites fighting to
confirm), and - anticipated but unmeasured - foils, off-axis angles, and dim light. The two known
corpus misses "never get enough reads at all - a framing/OCR issue, not confirmation"
(`scanner-dropout-tolerant-confirm.md` §2). **The encoder's mandate is therefore precise:
recover the recall OCR drops WITHOUT ever introducing a confident-wrong match - the ~100%
precision is preserved, not traded.** Every gate bar in this proposal is shaped by that
asymmetry: recall is the prize, precision is the constraint.

**Goals.**
- **G1.** A measured, frozen, image-level baseline of the current OCR path's **recall on the
  hard slices** (sites / foils / angles / dim) - the instrument that sizes the win and sets the
  bars (Gate 0).
- **G2 (primary intent).** Single-card reliability: an on-device embedding encoder + prototype
  index as a new evidence source inside the existing selector/reducer, feature-flagged, OCR
  retained as fallback and name-level arbiter (its printing-refinement role does not exist -
  Section 5.5). Success = the recall OCR drops comes back, at unchanged precision.
- **G3.** One pipeline for K cards: the recogniser consumes rectified quads where K=1 (guide
  crop) is merely the common case, so the Phase-B bonus is a quad-provider and UX change, not a
  recogniser rework.
- **G4 (bonus, follow-on phase).** Board scan - the capability quad detection unlocks, not the
  justification for the build: a **read-only snapshot** of a mid-match board, photographed at a
  slight user angle, producing a result **list** where each recognised card opens the existing
  Codex card detail (FAQs/rulings/related - Section 3.5). Occluded or unconfident cards are
  simply skipped - "it picks what it picks", honestly.
- **G5.** Failure is honest in both modes: below the confidence bar the scanner says it couldn't
  identify (single-card: no lock, exactly as today; board: the card is absent from the list or
  marked unidentified) - **never a guess**.
- **G6 (scope, owner addition A - Rev 4).** DROP-pipeline artifact generation: a catalog DROP
  that adds cards MUST generate their recogniser inputs - the content-addressed image key(s)
  AND the corresponding prototype(s) - recorded in the prototype manifest and promoted
  atomically with the catalog in the same journalled transaction (§5.1, §5.6). The index never
  lags the catalog; a card that fails the new-card gate is recorded excluded (OCR-only), never
  silently missing.
- **G7 (scope, owner addition B - Rev 4).** A **licences/attribution surface in Settings**
  covering all bundled ML technology whose licence requires notice (e.g. the Apache-2.0
  backbone NOTICE), landing with the model (built at Gate 2, user-visible by Gate 4).

**Non-goals.** Printing/finish identification from pixels (impossible for art-identical printings
and the set symbol is not OCR-readable per the owner; the post-lock "WHICH PRINTING?" picker
stays the resolution mechanism); scanning on web (the scanner remains native-only); market data;
removing or bypassing OCR/QR; board-state *semantics* (positions, zones, whose card - board scan
lists cards, it does not referee); board-mode **writes** of any kind (read-only by definition);
the future board overlays (binder pricing, own/missing vs `owned_cards`) - out of scope, but the
per-quad contract is designed so they stay reachable (Section 5.8); the board-scan UI's visual
design (its own proposal when Phase B starts); foil recall as a v1 bar (owner-accepted initial
degradation - foil results are reported and tracked, not gating).

**Acceptance (headline; per-gate bars in Section 8).** Gate-0 hard-slice recall baseline
recorded under the data governance (train / calibration / SEALED splits, §5.4), bars set from
it, and the precision constraint stated honestly with CIs (§5.4.5 - zero observed false locks
is an upper bound, never "100% field precision"). Then: encoder top-1 >= 95% / top-5 >= 99%
(distinct-card top-5, §5.3) on the **calibration** non-foil stress slices AND the **unseen-card
identity holdout** within stated CIs (foil slices reported, not gating v1); the fused policy
evaluated **exactly once against the sealed test set at Gate 3**, with two Rev-4 corrections
(Codex Major 2): the primary recall bar is a **PAIRED ON-vs-OFF improvement on the same sealed
cases and slices** - visual-first must beat OCR-only *as measured on the sealed set itself*,
per hard slice, not merely beat the separate calibration-baseline number - and the false-lock
shipping threshold is the **owner-accepted upper confidence bound** demonstrated on an
independent negative corpus **sized for that bound** (zero-observed is necessary, not
sufficient; sessions, not correlated frames, are the statistical unit - §5.4.5). No
per-category recall regression anywhere; added APK <= budget; added per-frame latency <= 30ms
p95 single-card; the Phase-A **sustained-search recovery state** ships with the flag (honest
"still looking" guidance + recovery actions, §5.5) and passes its a11y checks; the G7 licences
surface present by Gate 4; board scan (Phase B) recognises >= 90% of visible unoccluded
ground-truth instances on the frozen board corpus with **zero confident-wrong rows**
(unconfident quads are skipped or shown unidentified, never guessed).

---

## 3. Evidence and current architecture

### 3.1 The real pipeline (what the fork point actually looks like)

```
CameraX ImageAnalysis (STRATEGY_KEEP_ONLY_LATEST)
  -> TitleStripAnalyzer.analyze()            one frame per >=350ms, single-in-flight
       (camera/TitleStripAnalyzer.kt:34-46)
  -> FrameConverter.toUpright()              rotation ONLY, full upright RGBA bitmap
       (ocr/FrameConverter.kt:14-22)
  -> BarcodeReader (QR wins)  else  StripExtractor.extract(upright)
  -> fixed fractional strip crops            topStrip / rightStrip / leftStrip
       (ocr/StripExtractor.kt:33-46, model/ScanModels.kt:60-64)
  -> ML Kit text -> TextParser -> OcrCandidate(text, Source)
  -> FrameSelector.selectCard(strips, Matcher)          pure, shared with harness
       (FrameSelector.kt:39-49)
  -> Matcher: normalize -> Levenshtein, threshold 0.80, margin 0.05
       (match/MatchEngine.kt:112-170)
  -> live path: StabilityGate(minStreak)      (ScannerViewModel.kt:50, 92)
     harness path: pure reducer               (session/ScanSession.kt:97-171)
```

Two facts matter for this design:

- **The upright full frame exists at exactly one point** (`TitleStripAnalyzer.kt:41-46`), before
  strip cropping. That is the true fork point: the recogniser taps the same upright bitmap and
  crops `GuideGeometry.guide` (a true 0.716 card rectangle the user is already trained to fill -
  the overlay and the OCR crops share that one coordinate space by design, `ScanModels.kt:35-47`).
- **The live scanner still confirms via `StabilityGate`; the Phase 2a reducer is harness-only**
  today. The reducer->ViewModel integration (with its mandatory lifecycle-reset acceptance
  condition, `scanner-dropout-tolerant-confirm.md` §7) is in flight on this branch. This proposal
  slots the encoder in as a **new evidence source feeding the same selector/reducer**, and must
  land after that integration, not astride it (Section 8).

### 3.2 The matcher and its measured weaknesses

`Matcher` accepts only a clear winner (>=0.80 and >=0.05 ahead) over normalized names; pip
stripping fixed short names (`MatchEngine.kt:26-45`). Measured on real device captures it is
precise (1.00, zero false locks in both corpora) but recall-limited by the OCR front end: v1's two
remaining misses "never get enough reads at all - a framing/OCR issue, not confirmation". The
failure budget is upstream of matching - exactly where an appearance-based signal helps.

### 3.3 The reliability harness is the seed of the brief's eval harness

`Corpus`/`CorpusIO`/`CorpusRecorder`/`CorpusValidator`/`ReplayHarness` already provide: frozen
versioned cases with categories and expected identities, execution-bound provenance (`RunSpec`
constructs the matcher it reports on), fail-closed validation, per-class precision/recall +
false-lock rate + latency percentiles, and CI floors (`FullCatalogBaselineTest`). What is missing
for this feature: **pixels** (the F-line grammar carries text only), **stress coverage** (no
foil/glare/sleeve/dim/negative cases despite reserved categories), and **multi-card cases**
(no category exists at all). Gate 0 fills all three by extending the format, not by building a
second harness.

### 3.4 Catalog, DB, art (the ground truth for the brief's open questions)

- Catalog: `public/catalog/cards.json` (1,109 cards, 3,088 variants), seeded into the SQLite
  `cards` table at boot when `catalogVersion.json` bumps (`src/store/catalog.js:56-80`). The
  native scanner receives id+name+isSite+sets+limit as a JS array per `scan()` call
  (`cardScanner.js:26-37` -> `Catalog.parse`, `CardScannerPlugin.kt:47`).
- DB: `@capacitor-community/sqlite`, database name `compendium`, explicitly `'no-encryption'`
  (`src/store/db.js:191-194`), `androidIsEncryption: false` (`capacitor.config.json`). On-disk at
  the plugin's default Android location (`/data/data/com.sadkinglabs.compendium/databases/
  compendiumSQLite.db`). The web dev runtime is sql.js + IndexedDB, but the scanner does not exist
  on web (`cardScanner.js:14-21` stub), so the web path is irrelevant to this feature.
- Art: Cloudflare R2 + on-device cache; **full-card renders**, one per printing+finish variant,
  745px-wide webp (`public/catalog/art-manifest.json` tier `webp:w745:q80:v1`; 3,086 unique
  source scans). Full-resolution originals live in the gitignored `CATALOG_DROP` staging
  (`scripts/update-catalog.mjs:34-41`). The app renders them at full-card aspect (5/7 portrait,
  531/380 site - `src/components/CardArtViewer.jsx:321`), and `GuideGeometry`'s 0.716 guide was
  measured from these images (`ScanModels.kt:43-47`).

### 3.5 The Codex content layer board scan links into (confirmed present, no hedging)

Everything a board-scan row needs ships in the APK today. Tables: `rules`, `faqs` (with
`card_ids`), and `link_graph` (`src/store/schema.js:35-53`), seeded from the bundled catalog.
Query surface: `src/store/codexRepository.js` - `getCard(id)`, `getRule(id)`,
`faqsForCard(cardId)`, `relatedFor(kind, id, name)` (related card/article edges over
`link_graph`), `resolveByName(name)`, plus the errata/FAQ indicator sets used by
`getCodexCards` (errata detected via `rules_text` starting "UPDATED"). The Codex card detail
screen already composes all of it - printings switcher, rulings/FAQ, related chips, errata
(`COMPENDIUM_ARCHITECTURE.md` §7.3). **A board-scan row tap therefore opens the EXISTING Codex
card detail - no bespoke digest screen, no new content plumbing, zero new content work.**

---

## 4. Answers to the brief's three open questions

**(a) Master images: full cards or art-only?** **Full cards - resolved, owner-confirmed and
verified at the pixel level.** Border, name banner, textbox, art, the lot, per printing and per
finish (foils have their own scans). Direct evidence: sampling the staged masters in
`CATALOG_DROP/cdn-art/<slug>.webp` (3,090 files) shows every image at full-card aspect 0.716 -
roughly half at 744x1039 (the `webp:w745:q80:v1` manifest tier) and half at 380x531 (older
low-res sources, still ample for a 224-256px encoder input); corroborated by the app rendering
them full-card (`CardArtViewer.jsx:321`, 5/7 and 531/380) and `GuideGeometry`'s 0.716 guide being
measured from them (`ScanModels.kt:43-47`). **Exact source path for the offline build job:** the
durable staging directory `CATALOG_DROP/cdn-art/<slug>.webp` (gitignored, one webp per
printing+finish variant slug), with `public/catalog/art-manifest.json` as the authoritative
slug -> key/hash map and Cloudflare R2 holding the same content-addressed objects
(`scripts/catalog/cdn-upload.mjs:22`, `scripts/update-catalog.mjs:41`). The augment -> train ->
index pipeline consumes staging + manifest directly; no external sourcing, and the art-only
re-source contingency is closed. Two caveats to enumerate at build time remain real: a handful of
variants borrow a sibling finish's scan (`scripts/catalog/images.mjs` `sharedSibling`), and any
card with no scan at all (`report.noScan`) gets no prototype and stays OCR-only.

**(b) Card DB reachable natively?** Yes in principle: SQLite on disk, no SQLCipher, known path
(Section 3.4). **But the design should not use it.** Embeddings do not belong in the app DB at all
(Section 1.2.3): they are catalog-derived build artifacts that version with the APK, and the
established boundary is that the native scanner never touches the app database
(`CardScannerPlugin.kt:21`). Embeddings + model ship as native assets; SQLite is unaffected; no
migration.

**(c) Bundle or CDN the model?** **Bundle.** Offline-first is invariant-grade here: recognition is
core scanner function, and the R2 precedent covers only *degradable* assets under invariant 6 (the
app must work zero-image; it must not work zero-scanner-model after a fresh offline install). The
size cost is real (measured at Gate 2 on the signed release build and reported for the owner to weigh;
the earlier "<= ~8MB" target is WITHDRAWN 2026-08-04, see §Fixed constraints > Size) with
int8 quantisation, 256-d fp16 index, and the approved arm64-only release ABI which, once it takes
effect at Gate 2 (Section 16), will ship native libraries once rather than per-ABI; a leaner runtime
is the remaining lever). If the budget cannot be met, the fallback is a smaller model - not a CDN model.

---

## 5. Proposed design

### 5.0 Shape at a glance

```
TitleStripAnalyzer (unchanged cadence, single-in-flight)
  upright bitmap
    ├─ BarcodeReader (QR, unchanged, still wins)
    ├─ QuadProvider                               the K-card abstraction
    │    GuideQuad     K=1, fixed guide rect      single-card MVP (no detector)
    │    DetectedQuads K>=1, detect + warp        Phase B, net-new (board scan)
    │      -> per quad: rectify -> RecogniserEngine.embed() -> top-5 (cardId, cosine)
    └─ StripExtractor (unchanged OCR strips)      run per policy (see 5.5)
  FrameObservation { strips, qr, visual: [per-quad top-5 + quadBounds] }
    -> FrameSelector / per-quad gating            pure Kotlin, extended
    -> session reducer (unchanged confirmation semantics)
    -> single-card: existing Recognition/sheet/write path (untouched)
    -> board mode: SNAPSHOT capture -> per-quad accepted set -> ONE read-only
       result array over the bridge -> JS list -> existing Codex card detail
```

The recogniser itself never knows whether it is in single-card or board mode - it embeds rectified
crops and returns neighbours. K=1 is the common case, not a separate codepath (owner direction,
adopted). No per-frame data crosses the Capacitor bridge in either mode. No schema change. The
feature is one new evidence source inside the existing, harness-measured decision path, behind a
flag that defaults OFF.

### 5.1 Artifacts (the matched pair), the canonical digest, and atomic promotion

One binary index file + one model file, shipped in `android/app/src/main/assets/recogniser/`:

- `encoder.<runtime-ext>` - quantised int8 backbone, input ~224x224 RGB, output D-dim (start
  256), L2-normalised. Licence-compatible backbone only (§1.1); licence recorded in the artifact
  header and NOTICE. **Separately versioned** (`encoderVersion`): the encoder changes
  exceptionally (retrain), the index changes with every catalog generation; the index header
  pins the `encoderVersion` it was embedded with, so an index can never be paired with a
  different encoder silently.
- `index.bin` - header: magic, `formatVersion`, `encoderVersion`, `recognitionDigest`, D, P;
  then P prototype records: card_id ref, source-scan ref (provenance), fp16[D] vector,
  collisionGroup (u16). **P ~= 3,087 (one prototype per distinct source scan, §5.3): ~1.6MB of
  vectors at 256-d fp16, plus metadata.** Loaded once per scanner open into a packed FloatArray.
- `prototype-manifest.json` (committed beside the catalog outputs, promoted with them) - the
  deterministic, human-reviewable record of what the index MUST contain: per card_id, the
  content-addressed source keys/hashes its prototypes derive from, each prototype's
  inclusion/exclusion decision (included, or excluded-by-new-card-gate with reason), and the
  `encoderVersion` used. This manifest - not the index - is the reviewable authority for
  inclusion decisions, and the §5.6 fail-closed new-card gate writes its verdicts here.

**The recognition digest is derived from AUTHORITY, never from the index's self-declaration
(Rev 4, Codex Major 1).** Rev 3's digest hashed the id set *the index itself declared*, and
runtime filtered the catalog to that same declared set - so an omitted card, a dropped
prototype, or an index stale after a corrected source scan would still "match". Corrected
contract:
- `recognitionDigest` = SHA-256 over (a) the **existing catalog-generation content hash**
  (`scripts/catalog/generation.mjs:87-102` - it already folds the serialised catalog AND the
  content-addressed art-manifest keys, so a corrected scan or catalog change moves it by
  construction) + (b) the canonical serialisation of the **prototype manifest** (source
  keys/hashes, card ids, inclusion/exclusion decisions, encoderVersion). The digest therefore
  describes the recognition INPUTS and decisions, not the index's contents.
- **The build gate independently DERIVES the expected prototype set** from the authoritative
  inputs (catalog generation + art manifest + the manifest's recorded exclusions), and verifies
  the index against that derivation: every derived-expected prototype present, none extra,
  vectors' count/dim/order consistent, `encoderVersion` matching the bundled encoder, and the
  header digest equal to the independently recomputed digest. The index's own header is treated
  as a CLAIM to be checked, never as the source of truth.
- **Runtime backstop:** the app ships the expected `recognitionDigest` as a build constant
  derived at build time from the same authoritative inputs (it is baked by the same gate that
  verified the index); native compares the index header against it AND cross-checks the JS-
  supplied catalog's generation identity (`catalogVersion`). Any mismatch - including an index
  that is internally consistent but stale against the shipped catalog - fails closed to
  OCR-only. An omitted prototype can no longer hide: it changes the derived expectation, not
  just the index's story about itself.
- The **identical projection + algorithm** is implemented once per surface and cross-verified
  with a shared test vector (pipeline, build gate, runtime constants generation), so the
  implementations cannot drift.

**Atomic, journalled promotion (Rev 3, Codex #3; extended by owner addition A).** Index +
prototype-manifest generation joins the EXISTING staged / journalled catalog-promotion
transaction (`scripts/catalog/journal.mjs`: staging tree -> validate -> journalled promote,
version token written LAST, `assertNoPendingPromote` blocking every packaging path, `--recover`
re-promoting deterministically from retained staging). The prospective index + manifest are
built in staging from the prospective catalog + prospective art manifest, validated (derived-set
verification, counts, collision report, new-card-gate report), and promoted **inside the same
journal entry** as the catalog JSON, art manifest, and version token - so catalog, art
manifest, version, prototype manifest, and index can never partially advance. **A catalog DROP
that adds cards therefore produces those cards' content-addressed image keys AND their
prototypes in the same governed transaction - the index never lags the catalog** (owner
addition A; a card whose prototypes fail the §5.6 gate is recorded excluded in the manifest,
which is itself part of the promoted, digested state). Interruption behaviour is inherited: a
stale in-progress journal hard-fails builds until `--recover` or an explicit restore; a **clean
checkout** rebuilds index + manifest deterministically from the committed catalog + art
manifest and the hash-verified art cache (§5.6) - derived artifacts with a reproducible build,
not hand-managed state. The encoder file is NOT part of routine promotion (it only changes on a
retrain, its own reviewed increment).

Coupling enforcement, two layers (both anchored on the authoritative derivation above):
1. **Build-time gate (primary):** a repo check (promote-gate style, wired into the
   `update:catalog` / gate scripts) performs the independent derived-set verification and
   digest recomputation described above, and fails the build on any disagreement between
   bundled catalog, art manifest, prototype manifest, index, or encoder pairing.
2. **Runtime backstop (fail closed to OCR):** on scanner open, native verifies the index header
   against the build-baked expected digest + the live catalog's generation identity; mismatch
   (or missing/corrupt artifacts, or runtime init failure) => encoder disabled for the session,
   OCR-only, one telemetry/log line. The scanner never refuses to scan.

### 5.2 Rectification, staged honestly

**Stage A (single-card MVP): no detector.** The encoder consumes the fixed `GuideGeometry.guide`
crop of the upright frame - the rectangle the user already aligns the card to. Robustness to the
resulting imperfection (off-axis up to ~20 deg, scale/position jitter) is **trained in** via the
synthetic capture pipeline (random homography then crop-jitter, exactly simulating "card roughly
in the guide"). Sites: the guide crop is additionally embedded at 90/270 degrees when the portrait
pass is weak (cheap at this model size), or covered by rotation in training - decided by measured
eval at Gate 1, not assumed.

**Stage B (board scan): quad detection + perspective warp, first-class and net-new.** Scoped as
its own gated increment because it is genuine CV work the repo does not have: downscaled-luma
edge/contour extraction, convex-quad fitting filtered by card aspect (~0.716 portrait / its
inverse for sites), non-max suppression, per-quad homography warp to the canonical card frame.
Classical CV is attempted first (zero model cost); if it proves brittle on cluttered dark-table
boards, the fallback is a tiny quad-detector model (an additional artifact, budgeted in 5.7).
The snapshot is expected at a **slight user-perspective angle** (owner-stated capture posture),
so the warp handles modest keystone, not overhead-orthographic input. Board reality check baked
into the design: **Sorcery stacks minions atop sites**, so partial occlusion is structural, not
an edge case - and the owner's rule is simple: **occluded cards are skipped** ("it picks what it
picks"). Detection may emit a partially visible quad, but the policy is free to drop it below
the confidence bar with no penalty (Section 5.5). Once Stage B exists, single-card mode MAY
adopt `DetectedQuads` with K=1 for warp-accurate crops - measured, not assumed.

### 5.3 Identity grain vs prototype grain: multi-prototype index (Rev 3, Codex #2)

**Identity stays card-grain (~1,109 card_ids - what a lock means is unchanged), but the
prototype grain is per distinct source scan.** A single mean vector per card assumes a card's
variants are one visual cluster; alternate arts, token printings, and foil vs standard scans can
be visually distinct, and averaging them produces a centroid resembling none of them. The
measured default is therefore:

- **One prototype per distinct source scan** (~3,087 - or per demonstrated visual cluster where
  Gate 1 shows scans of a printing are duplicates), each built from its master plus ~5 mild
  augmentations, L2-normalised, tagged with its card_id and source-scan provenance.
- **Search aggregates by card ID using the BEST prototype score:** score(card) = max over that
  card's prototypes.
- **The ambiguity margin compares best card vs best DIFFERENT card** - two prototypes of the
  same card can never compete with each other into a false "ambiguity".
- **Top-5 contains five DISTINCT card_ids**, not five variants of one card - so branch-4 OCR
  arbitration and collision gating always see genuine alternatives.
- **Gate 1 explicitly compares** this multi-prototype default against one-centroid-per-card
  (and per-cluster collapses in between); clusters may be collapsed ONLY where evaluation shows
  no recall or precision loss - including on the alternate-art, token-art, and foil-vs-standard
  slices, which the Gate-1 evaluation must contain by construction.

Cost: ~3,087 x 256-d fp16 ~= 1.6MB of vectors (§5.1) and ~3x the per-quad dot products - still
sub-millisecond on a packed array; irrelevant next to the ~10-30ms encode.

Collision groups are derived at build time over **card-level best-score similarity** (max
cross-card prototype cosine, clustered), regenerated every artifact build, stored in the index;
the per-build collision report is a **reviewed** output, not a log line (see Self-Critique 4).

### 5.4 Governed evaluation data (Gate 0's instrument, and the judge of everything after)

Extend the existing corpus system, do not fork it - and govern the data properly (Rev 3,
Codex #1 and #4).

**5.4.1 Corpus format extension.**
- `CorpusIO` grammar gains a versioned extension: an optional per-frame image reference
  (`F\t<atMs>\t<qr>\t<img:frame-000123.webp>\t<strips...>`), images resolved through the image
  manifest below; `Corpus.version` and `CorpusValidator` cover it. Old corpora remain decodable.
- **Board ground truth is per-INSTANCE, not a set of ids** (Codex #4): a `BOARD_MULTI` case
  carries instance annotations `{cardId, bounds, occluded/optional}` - one per physical card,
  so **duplicate copies are preserved** (three Rustic Homesteads are three instances). Scoring
  is **geometric**: each detected quad is matched to at most one ground-truth instance (IoU
  threshold, greedy or Hungarian assignment); a recognised match to the right instance's cardId
  = true positive; a confident id on an unmatched or wrongly-matched quad = false positive;
  `occluded` instances are optional - skipping them is correct, recognising them is uncredited
  bonus, and they can never be double-counted to absorb a wrong id. (The earlier
  `Expected.Identities(set)` sketch is superseded - a set cannot represent duplicates or
  geometry.) Board-schema work is Phase-B-directed and **must not block Phase A**: the
  single-card corpus and its splits are complete and scoreable without any board case.
- `CorpusRecorder` (capture builds only, existing `GuideGeometry.captureCorpus` switch) also
  saves the admitted upright frame per observation.

**5.4.2 Image governance (Codex #4).** Raw tester/board photos do NOT belong in public Git by
default.
- **Storage:** raw and processed evaluation images live in a **private governed store** (owner-
  controlled, outside the repository; the gitignored local mirror follows CATALOG_DROP
  discipline). The repository commits: the corpus text files, an **image manifest** (per image:
  SHA-256, pixel dimensions, byte size, format, condition tags, provenance/consent reference,
  split assignment), and a **small redacted committed fixture** (a handful of owner-shot,
  cleared images) so decode paths and validators are testable in CI. The governed evaluation
  dataset itself may stay private: the manifest's digests preserve provenance and make any
  substitution detectable, so a report remains reproducible against the private store.
- **Consent + provenance:** the tester intake contract records, per contributor: consent to use
  the photo for evaluation (and optionally training), an explicit **contribution-rights grant**
  (Codex #6), and whether publication in a public fixture is permitted (default NO).
- **Hygiene:** EXIF (including GPS) stripped at intake; images cropped/redacted to the play
  surface where surroundings are identifiable; retention/deletion honoured on contributor
  request (manifest rows are tombstoned, dependent corpus cases invalidated, sealed-set version
  bumped if affected).
- **Validation bounds** (fail-closed in `CorpusValidator`): image references must resolve inside
  the governed store root (no path traversal), format allowlist (webp/jpeg/png), dimension and
  byte-size caps, and decoder memory bounded by decode-to-target-size - a hostile or corrupt
  image fails the corpus, not the harness process.

**5.4.3 The three-way split + identity holdout (Codex #1).** All governed images are assigned,
at intake, to exactly one of:
- **(a) Training/synthetic** - masters + synthetic captures; real photos only if consented for
  training and never from sealed capture sessions.
- **(b) Calibration** - used for threshold selection (T_accept/T_consider/M_margin, board bars),
  model selection, augmentation tuning, and the Gate-1 prototype-strategy comparison.
- **(c) SEALED test** - **isolated by capture session AND device** (every frame from a sealed
  session is sealed; no session or device contributes to both calibration and sealed), frozen
  with a version + digest, and **used exactly once per evaluation event** (Gate 3; a Phase-B
  event for board). The sealed set must never tune augmentations, backbone, quantisation,
  thresholds, or policy - **any use of sealed data for tuning invalidates it and REQUIRES a new
  sealed corpus version** from fresh capture sessions before the next evaluation claim.

Additionally, a **stratified card-identity holdout**: a set of card_ids (stratified across
spell/site, element, rarity, art era, foil availability) **excluded entirely from ArcFace
training**. After training, their prototypes are built exactly as a future catalog addition
would be (embed masters, no gradient ever seen) and evaluated on real photos of those cards -
this is the direct test of the "new set without retraining" claim, and the fail-closed rule in
§5.6 is its production counterpart.

**5.4.4 Hard negatives / OOD (Codex #1).** A substantial negative set, split across calibration
and sealed like everything else: other TCGs' cards (several games, sleeved and bare), Sorcery
card BACKS, playmats and textured table surfaces, **arbitrary / non-card screen content and
moire artifacts** (OLED/LCD UIs, other apps - things that must never lock), partial cards at the
frame edge, empty scenes, and **visually-close non-targets** (the nearest confusable art the
collision derivation can find, photographed for real). The false-lock bars in §2/§8 are measured
against this set, not just against benign empty frames.

**Screen-scan policy (owner deferred to the process, 2026-08-03).** A GENUINE Sorcery card
displayed on a screen is a TOLERATED but UNGUARANTEED input, NOT a mandated negative: recognising
the correct card is not a false lock, so it may lock, but no recall is promised for it, and the
precision rule still holds (correct card or no lock, never a WRONG card - a moire-induced wrong
lock is a real defect and is checked). Its captures are tagged a distinct dev-only condition.
**Crucially, the sealed test set and every shipping recall/precision number are PHYSICAL cards
only** - screen captures (including the owner's current curiosa.io testing, since no physical
cards are on hand) never contribute to the gating evidence; they are a different medium and would
misrepresent field behaviour. Non-card screen content / moire stays a must-not-lock negative (above).

**5.4.5 Statistical honesty (Codex #1; hardened Rev 4, Codex Major 2).** Every headline metric
(per-slice recall, false-lock rate, board instance metrics) is reported **with a 95% confidence
interval** (Wilson score given the small-n). Three binding rules:
- **The statistical unit is the capture session/scene, not the frame.** Frames within a session
  are heavily correlated (same card, lighting, hands, device); counting them as independent
  trials fabricates confidence. Recall is per-case (as the harness already scores), and
  false-lock CIs are computed over independent sessions/scenes.
- **Zero observed failures is never restated as "100%"**: with n~=60 independent negative
  sessions and zero false locks, the honest claim is "false-lock rate below ~4.8% at 95%
  confidence on this corpus" - the proposal and every report say it that way.
- **The shipping threshold is an owner-accepted upper bound, and the corpus is sized to
  demonstrate it.** "Zero observed" is necessary but NOT sufficient to ship. The owner picks
  the acceptable false-lock upper bound (a §13 owner decision to confirm; illustratively: a 2%
  bound at 95% confidence needs ~150 independent negative sessions with zero failures, 1%
  needs ~300 - the rule-of-three makes the cost of the claim explicit). The independent
  negative corpus is grown (tester inflow, §5.4.6) until the sealed negative slice can
  demonstrate the chosen bound; Gate 3 cannot pass on a corpus too small to support it.
- **The interval method is frozen BEFORE the corpus is sized or sealed (Codex non-blocking
  follow-up, Rev 4).** The false-lock shipping bound is a **one-sided Wilson (score) upper
  confidence bound** at the owner-accepted confidence level; the rule-of-three sizing above is
  its zero-failure special case, and any nonzero failures are carried through the SAME one-sided
  Wilson upper bound - never a method re-chosen after seeing results. The method, sidedness,
  confidence level, and nonzero-failure treatment are recorded in the executable `RunSpec` /
  report provenance, so the calculation is fixed at intake and cannot be selected post hoc. (Two-
  sided Wilson intervals may still accompany point metrics such as recall for reporting; the
  gating quantity is this one-sided upper bound.)

**5.4.6 Content plan.** Shoot/collect **device-capture-v3**: >= 60 single-card cases spanning
the reserved categories that are empty today (foil under direct light, sleeved matte + glossy,
off-axis 10-25 deg, dim, motion blur, spells, sites both edges, similar-name pairs) + the
§5.4.4 negative set, **plus >= 15 board shots** (3-12 cards, mixed spells/sites, minions atop
sites, varied distance and lighting - Phase-B fuel, not a Phase-A dependency). **Tester photos
are inbound and are exactly this fuel** - intake per §5.4.2: labelled with expected `card_id`
(per instance for boards; printing/variant when known, for provenance) + condition tags, passing
`CorpusValidator`; unlabelled or unresolvable photos are excluded from scoring. One mechanical
note: ML Kit runs only on-device, so static photos yield OCR observations through a small
**on-device photo-replay runner** (a debug/instrumented mode that feeds corpus images through
the production `StripExtractor`/`BarcodeReader` and records observations into the corpus); the
JVM harness then replays those recorded observations as it does today. Encoder evaluation needs
no such step - it runs on the images directly, on either side.

This governed dataset serves every later purpose: replaying its text observations through the
existing harness gives the honest **OCR baseline** (calibration slice at Gate 0); its
calibration images tune the encoder and thresholds; its sealed images judge the fused policy
once at Gate 3; its board images (instance-annotated) are the eval set for the quad detector
and Phase B. Nothing evaluated is ever trained on; nothing sealed is ever tuned on.

### 5.5 Decision policy (pure Kotlin, measured before shipped)

Single-card - `FrameSelector` gains a `SelectionPolicy` variant (the extension point built for
exactly this - `FrameSelector.kt:15-19`), e.g. `VisualFirstPolicy`:

1. QR present -> unchanged, QR wins.
2. Embed the guide crop -> top-5 with scores s1..s5.
3. **Confident visual:** s1 >= T_accept AND (s1 - s2) >= M_margin AND top-1 not in a collision
   group -> emit `Candidate(cardId, source = VISUAL)`. OCR is skipped this frame (perf win).
4. **Ambiguous visual (distinct cards):** s1 >= T_consider but margin fails, or top-1 sits in a
   cross-card collision group -> run the OCR strips and match them against **only the top-5
   candidates' names** (a `Matcher` over a filtered `CardIndex`); an OCR-confirmed member wins;
   otherwise no candidate this frame. This is **name-level** arbitration only.
5. **No visual signal** (s1 < T_consider) -> today's full-catalog OCR path, unchanged.

**Failure stays honest (G5) - and Phase A ships a concrete recovery state (Rev 3, Codex #5).**
When no branch produces a candidate, the frame contributes nothing - the fused policy adds ways
to *succeed*, never a lower bar to lock. But Rev 2 promised "couldn't identify" while the
scanner in fact searches silently forever; that contradiction is resolved for Phase A with a
**sustained-search recovery state**, deliberately worded to never claim a card is present
(claiming presence would itself be a guess - the scanner cannot distinguish "hard card" from
"no card"):
- **Trigger:** continuous SEARCHING with no lock and no QR for a sustained interval (tunable in
  `ScanConfig`, indicatively ~8-10s, reset by any lock or scanner close). Detection of *frames
  with some OCR text or above-floor visual score* MAY tighten the copy ("Still looking - reduce
  glare or adjust the angle") vs a generic hint, but the state itself asserts only that nothing
  has been identified.
- **Presentation:** a quiet, non-blocking hint chip over the existing overlay - scanning never
  stops; no modal, no false "not a card" verdict.
- **Recovery actions:** torch toggle (if the device has one), one-line repositioning guidance
  (fill the guide, tilt to kill glare), and **Search by name** (the affordance the approved
  scanner-phase2 proposal already plans in its §10 - this state is its trigger, not a new
  surface).
- **A11y (hard requirements):** announced ONCE via TalkBack when entered (not per frame),
  targets >= 48dp, honours reduced-motion (no pulsing), Back behaviour unchanged (dismisses the
  hint layer if focused, else closes the scanner exactly as today).
- **Scope honesty:** this is scanner-UX work riding Gate 4 (flag-ON device evidence) and it is
  in the Phase-A acceptance (§2). If the owner defers it, the acceptance line MUST be struck
  and the accepted consequence stated: users who fail on a hard card get silent endless
  searching with no recovery guidance - Rev 3 does not leave that implicit.

**Printings are resolved by the user, never by OCR.** The set symbol is not OCR-readable (owner
confirmation), so once a card locks, art-identical printing ambiguity goes where it already goes
today: the result sheet's "WHICH PRINTING?" chip picker, which gates the add action for multi-set
cards (`RecognitionSheet.kt:173-185`) and auto-files single-set cards. The recogniser changes
nothing about that surface; embeddings narrow to the card, the human picks the printing.

**Is OCR still worth wiring for v1? Recommendation: yes - keep it, expect it to be quiet.**
Honest expectation: with a healthy encoder, branches 4-5 fire rarely for unique-art cards, and
OCR contributes nothing to printing choice, ever. It stays wired for v1 because it is (a) the
graceful-degradation path invariant 6 leans on (missing/corrupt/mismatched artifacts => OCR-only
scanning is what "the scanner never refuses to scan" *means*), (b) the only recogniser for cards
with no scan (`report.noScan` prototypes don't exist), and (c) the measured incumbent while the
encoder is still proving itself - removing the control group before the experiment concludes
would blind Gate 3/4's ON-vs-OFF comparisons. Removal (of the OCR *card path*; QR is untouched)
is a legitimate later cleanup **only** on field evidence - e.g. telemetry showing OCR resolving
~zero locks the encoder missed over a release cycle - via its own small proposal.

Temporal semantics are untouched: candidates confirm through the reducer (3 real observations
spanning >= 350ms, dropout-tolerant, suppression intact - `ScanSession.kt`). `Source` gains a
`VISUAL` member (additive; corpus encoding is by name, old corpora parse unchanged).
T_accept/T_consider/M_margin live beside the other tunables and are set from ROC curves on the
**calibration** slice (§5.4.3), frozen before the sealed Gate-3 run - never guessed, and never
tuned on sealed data.

Board mode - **snapshot, not live** (owner direction): the user frames the board and captures;
recognition runs on that captured frame (implementation MAY internally burst 2-3 consecutive
frames at the capture moment for stability, but there is no live tracking loop, no per-track
state, no ongoing analysis). Per quad, the same evidence rules apply with **no OCR rescue** (a
board-distance name strip is unreadable by physics): accept only s1 >= T_accept with margin
clear of collisions - and because temporal confirmation is unavailable in a snapshot, the
board-mode T_accept/M_margin are set **stricter** than single-card's, by the same ROC method run
on the frozen board corpus (Gates 5/6). A quad that misses the bar - occluded, blurred, too
small, ambiguous - is **skipped**
(or shown as an unidentified count), never guessed: "it picks what it picks". All of this is
pure Kotlin, replayable by the harness over v3 board cases.

The flag: a `recogniser` option on `scan()` (default false) AND the artifact health check - either
gate failing yields exactly today's scanner. Board mode is additionally `mode: 'board'`, Phase B.

### 5.6 Offline pipeline (new toolchain - the honest cost), reproducible from authority

New `tools/recogniser/` (Python, pinned, containerised, seed-fixed; deliberately outside the
Node `scripts/` gate surface).

**Inputs are reconstructed from authority, not read from a cache (Rev 3, Codex #3).**
`CATALOG_DROP/cdn-art` is a **cache**, not the source of truth - it is gitignored, mutable, and
unavailable on a clean checkout. The pipeline's inputs are the **prospective content-addressed
art manifest** (slug -> key/sha256) + the **prospective catalog**: every master is fetched from
the corresponding R2 object (or taken from the local cache when present), **hash-verified
against the manifest's sha256** into a verified local cache before use; a hash mismatch or a
missing object fails the build (promoteGate posture - never train or index against unaudited
bytes). The prospective index is therefore built from the prospective catalog + prospective art,
and a clean checkout reproduces it exactly (given `.env.r2`, as the existing catalog pipeline
already requires).

**Stages:** dataset synthesis (30-50 fake captures per master: homography, scale/crop jitter,
motion + defocus blur, brightness/contrast/gamma/warm shift, sensor noise + JPEG, elliptical
glare, rainbow streak for foils, sleeve border/reflection - Albumentations plus the two
hand-written effects); ArcFace fine-tune **excluding the §5.4.3 identity holdout** (~1-2h mid
GPU) producing **ONE frozen PyTorch checkpoint** - the single source every runtime export
derives from (Codex #7), with a pinned, scripted, deterministic export (fixed opset/converter
versions, committed conversion config, output-parity check against the checkpoint on a fixture
batch); PTQ int8 quantisation; prototype embedding + multi-prototype index build (§5.3);
collision derivation; artifact emission with digests into the **staging tree of the journalled
promotion** (§5.1).

**Fail-closed new-card gate (Codex #1).** At every index build, each card's prototypes must pass
the unseen-class quality checks (self-match on held-out augmentations; collision distance to
existing cards above floor). A card that fails is **excluded from the index, and its exclusion
is RECORDED as a decision in the prototype manifest** (Rev 4 - the manifest, folded into the
recognition digest, is what makes an exclusion an auditable decision rather than a silent
omission the digest cannot see, §5.1). It stays OCR-only and is listed in the reviewed build
report with the choice: accept OCR-only, or schedule a retrain. **A failing card is never
forced into the visual index.** "Routine new cards need no retraining" is thus a *conditional*
claim, re-proven at every build, not an assumption.

**Routine catalog updates run embed-only, inside the DROP pipeline (owner addition A, Rev 4).**
A catalog DROP that adds or corrects cards triggers, as part of the same `update:catalog` run:
content-addressed image keys for the new scans (existing art stage), prototype embedding for
the affected cards with the frozen encoder, the new-card gate verdicts, and the updated
prototype manifest - all staged and promoted in the one journalled transaction (§5.1). The
non-engineer one-command update stays one command; no GPU is required for embed-only runs.
Training reruns are exceptional and evidence-driven. Outputs: the artifacts + prototype
manifest (§5.1) + a build record of encoder version, checkpoint hash, digests, and full
training/export config for reproducibility.

### 5.7 Runtime + model stack (OQ-1 RESOLVED - Codex recommendation recorded, measured gates)

**Rev-3 disposition of OQ-1 (Codex #7):** Codex recommends, and this proposal records,
**standalone LiteRT + MobileNetV4-Conv-S PTQ-int8 as the PRIMARY measured candidate** under the
approved **API 29 / arm64-v8a** platform baseline (settled owner decision, status block). This
matches the owner's recorded preferred hypothesis. **ONNX Runtime is demoted to an optional
BOUNDED comparison** - a time-boxed measurement during the runtime/export spike (§8) if it
earns its keep, explicitly **NOT a requirement to build or maintain two full production
stacks**. Training produces **ONE frozen PyTorch checkpoint** from which the runtime export is
scripted and reproducible (§5.6); the export target is LiteRT unless the spike falsifies it.
The final choice is confirmed by the measured gates below; the decision frame and constraints
are retained for auditability.

**Fixed constraints (not open):**
- Bundle everything - offline-first invariant; no CDN model (Section 4(c)).
- **Platform baseline (approved 2026-08-03, Section 16):** minSdk 29 (Android 10), arm64-v8a-only
  release. The stack must support **API 29+ on arm64**; Android 5.1/API 22 compatibility is no
  longer a constraint on runtime or backbone choice. Native inference libraries ship for one ABI
  only. Takes effect at Gate 2, not before.
- **Size:** an OWNER-CONTROLLED tradeoff, NOT a fixed engineering cap. The earlier "~8MB fixed
  constraint" was author-proposed, never owner-set, and is **withdrawn** (owner direction,
  2026-08-04: "I get to decide if my app is 32MB or 80MB"). The owner sets the acceptable APK size;
  current release is ~23MB and growth into the tens of MB (a 45-70MB APK) is acceptable when it buys
  accuracy. Models are chosen **accuracy-first**; each candidate's measured runtime + model + index
  delta is REPORTED for the owner to weigh, never gated on a preset ceiling. This reopens licence-clean
  models previously excluded on size alone - notably **DINOv2-small (Apache-2.0)**. Size levers remain
  available if the owner later wants them (int8, fp16 index, ops-reduced build, arm64-only single-ABI).
- **Licensing:** Apache-2.0/MIT-compatible weights and runtime only (MobileCLIP-class research
  licences excluded, Section 1.1).
- **Portability weighting (owner-relaxed):** optimise **Android now**, port later. Do not pay a
  meaningful Android reliability, latency, or size tax purely for iOS portability; keep the door
  open where it is free, and Android wins ties. With minSdk 29 approved, Android 5.1/API 22 support
  is off the table, so candidates are judged on Android 10+ arm64 only.
- Perf bars regardless of stack: single-card adds one embed per admitted frame (<= 30ms p95)
  inside the existing 350ms cadence; board snapshot is K embeds + detection on one capture
  (~150-200ms at K=10 and ~15ms/embed - a one-shot cost, not a loop); thermal over a board
  session measured at Gate 5.

**The decision as recorded (primary candidate + rationale):** LiteRT is the smallest credible
runtime under the binding size budget, XNNPACK is mature on arm64/API 29+, and it sits
naturally beside the existing ML Kit/CameraX stack; MobileNetV4-Conv-S is current-generation,
Apache-2.0 in timm, strong accuracy/latency at 224px, and int8-friendly. The known cost - the
weak desktop-JVM story - is mitigated: the harness replays **recorded** embeddings (still
deterministic and versioned; it validates the decision layer against captured encoder output),
and encoder-output drift is separately pinned by artifact digests, the frozen-checkpoint parity
check (§5.6), and the Gate-1 eval numbers. ONNX Runtime's harness-parity advantage (ORT Java
recomputing embeddings in JVM tests) is real but does not justify a second production stack;
it may be measured as a bounded comparison in the spike, and adopted only if LiteRT *fails* a
gate that ONNX passes.

**Measured gates the primary candidate must pass (Codex #7 - any failure reopens the choice):**
- **Release APK delta** (runtime + model + index) measured on the real signed release build under the
  arm64-only baseline, and REPORTED for the owner to weigh (the earlier "~8MB budget" was author-proposed
  and WITHDRAWN 2026-08-04 - size is an owner-controlled tradeoff, see Fixed constraints > Size);
- **Cold init** (runtime + model load + index load) within the **numeric ceiling frozen at
  Spike R** (Rev 4, Codex minor 2): Spike R's indicative measurements are turned into
  owner-approved cold-init and memory ceilings BEFORE Gate 2 begins, so Gate 2 verifies against
  fixed numbers rather than christening whatever it measures;
- **Total preprocess + inference p95 <= 30ms** (crop/resize/normalise INCLUDED, not inference
  alone) at the production cadence;
- **Memory** within the Spike-R-frozen ceiling (peak native + Java heap during a scan session);
- **R8/minified release behaviour** proven (the release build gate exists because a minified
  release once blanked the app while every other gate was green - the runtime's reflection/JNI
  surface must survive R8 with documented keep rules);
- **Output/ranking parity** against the frozen checkpoint: embedding cosine agreement on a
  fixture batch AND identical top-5 card rankings on the calibration set within tolerance.

**Quantisation:** PTQ int8 first; **QAT only if PTQ measurably damages embedding ranking or
hard-slice quality** (a Gate-1/spike comparison, not a default).

### 5.8 Board-scan session and bridge contract (Phase B) - read-only snapshot

Native owns the capture and the gating; JS owns the result and the content. **The whole mode is
read-only: no writes exist in board scan, by definition.**

- `scan({ mode: 'board', recogniser: true, ... })` opens the same Activity in board mode: frame
  the board (a slight perspective angle is the expected posture), tap capture. A preview overlay
  may show detected quad outlines to help framing, but recognition runs on the **snapshot**, not
  a live loop.
- Native emits **one** payload for the capture:
  `{ kind: 'boardScan', cards: [{ cardId, name, score, quadBounds }...], skipped: n }` -
  session-level, exactly like today's `scanAction`/terminal contract
  (`CardScannerPlugin.kt:79-99`), never per-frame. `skipped` counts quads detected but below the
  confidence bar (occluded / blurred / too small) - surfaced honestly, never guessed.
- JS renders the list; **each row tap opens the EXISTING Codex card detail** - rulings/FAQ,
  related chips, errata, printings - via the confirmed content layer (Section 3.5:
  `getCard`/`faqsForCard`/`relatedFor`). No bespoke digest screen, no new content plumbing, no
  native catalog knowledge beyond the id+name it already holds.
- **Printings on board rows:** all board-row content (FAQs/rulings/related) attaches to
  `card_id`, not a printing, so rows are card-grain and need no picker; a per-row "WHICH
  PRINTING?" across a 10-card board would be punishing UX and there is nothing for it to gate in
  a read-only mode.
- **Future overlays - out of scope, deliberately reachable.** The per-quad
  `{ cardId, score, quadBounds }` contract is chosen so later features can join each recognised
  card against JS-side data and paint per-quad overlays without touching the recogniser: a
  binder **pricing** overlay (per-card price by `cardId`) and an **own/missing collection**
  overlay (cross-referencing `owned_cards` through the existing profile-scoped repositories -
  the catalog/profile boundary stays intact because the join happens in JS). Neither is proposed
  here; the contract just refuses to preclude them. This is why `quadBounds` is in the payload
  from day one.

Deliberate deviation from the owner's earlier sketch, with reasons: the sketch had TS doing
per-card temporal voting over per-frame arrays. Frame-level machinery stays native because
(a) the WebView is behind the full-screen Activity and subject to throttling, and (b) the
Phase 2a measurement architecture (shared pure selector + JVM replay) only proves policies that
run in Kotlin - and the Rev-2 snapshot semantics shrink the question anyway: there is no live
voting loop at all, just one gated capture. The *product* outcome - a list whose rows open Codex
- is exactly as the owner described.

---

## 6. Assumptions and confidence

1. Guide-aligned crops + homography-heavy augmentation reach >=95% top-1 on the single-card
   non-foil stress corpus without a detector (foils reported, not gating - Rev 2) - **medium**;
   validated at Gates 1/3; quad-warp (Stage B tech) is the named fallback.
2. Card-grain identity with per-scan prototypes (§5.3) makes cross-card collisions negligible -
   **medium-high**; validated mechanically by the derived collision stats at every artifact
   build, and the multi-prototype vs one-centroid question is measured at Gate 1, not assumed.
3. The confirmed full-card masters (744x1039 / 380x531, Section 4(a)) suffice for training -
   **high** (encoder input is 224-256px; even the low-res tier clears it comfortably).
4. Encoder inference fits budgets on 2020+ hardware - **high** single-card, **medium-high**
   board mode (one-shot snapshot cost, not a loop); measured at Spike R / Gates 2/5 including a
   low-end device.
5. Classical CV quad detection suffices for board snapshots - **low-medium**; the detector-model
   fallback and its size cost are pre-budgeted; the frozen board corpus decides.
6. OCR's hard-slice recall gap is large enough to be worth an encoder - **medium** (owner
   experience says yes, especially sites; the corpus history agrees directionally; Gate 0 turns
   it into a number). Gate 0 is bar-setting, not a coin-flip - but it keeps an honest off-ramp:
   if OCR's measured recall on sites/foils/angles/dim is unexpectedly strong, the owner
   reconsiders before any model work starts (Section 8, Gate 0).
7. The Phase 2a reducer->ViewModel integration lands first - **high**; in flight on this branch.
8. The encoder generalises to unseen cards well enough for embed-only catalog updates -
   **medium**; this is exactly what the §5.4.3 identity holdout measures at Gate 1, and the
   §5.6 fail-closed new-card gate makes production safe even where it fails per-card.
9. LiteRT + MobileNetV4-Conv-S PTQ-int8 survives its measured gates (§5.7) - **medium-high**;
   Spike R exists to falsify it cheaply before integration.
10. The owner's recorded legal determination (2026-08-03, §16) covering training, retention,
    repo storage, and distribution of weights derived from card art stands - **high as a
    process fact** (it is recorded); the underlying third-party risk it accepts is the owner's,
    outside engineering control, and flagged honestly in §13.

## 7. Affected systems and invariants (Constitution §3)

Native scanner (new `scanner/recognise/` engine, QuadProvider, `FrameSelector` policy, corpus
format extension, board-mode UI in Phase B), Android build (inference dependency, bundled assets,
size), offline artifact pipeline (new toolchain), repo gates (artifact/catalog coupling check),
JS (Phase B board-result list + Codex linking through existing repositories), docs. **Not
touched:** write paths, schema, web runtime, QR handling.

- **1 Catalog/profile boundary:** holds - embeddings are catalog-derived, read-only, shipped as
  assets; board rows read catalog/Codex content through existing JS repositories.
- **2 Profile isolation / 5 transactional writes:** not in play - no write paths change.
- **3 Durable offline-first:** holds and is the reason the model is bundled, never CDN-fetched.
- **4 Forward-only schema:** holds by not touching the schema (no BLOB column - the brief's
  SQLite plan is rejected partly on this invariant).
- **6 Graceful degradation:** holds - artifact missing/corrupt/mismatched => OCR-only scanning;
  board mode simply unavailable if the recogniser is unhealthy; the scanner never refuses to
  scan. (The brief's "refuse to scan" is rejected on this invariant.)
- **7 Content-is-data:** holds - new cards enter by data (prototypes via the DROP pipeline +
  prototype manifest, §5.6). Routine catalog growth needs no retraining **only if** the new
  cards pass the unseen-class + collision gates; a failing card stays OCR-only, recorded
  excluded in the manifest, never forced into the index (the conditional §5.6 contract - Rev 4
  aligns this wording with it). Board rows link content via data (`faqs`, `link_graph`).
- **8 Cross-runtime integrity:** scanner is native-only (web stub unchanged); harness parity is
  addressed head-on via the runtime choice + recorded-embedding replay.

## 8. Implementation plan - sequenced and gated

**Composition rule:** Gates 2+ build on the Phase 2a reducer->ViewModel integration (including its
lifecycle-reset acceptance condition); this work rides its own branch and does not touch the
in-flight scanner-phase2a scope. Gate 0 is independent and can start immediately - capture +
measurement, not production change.

**Phase A - single card.**
- **Gate 0 - governed data, splits, and the OCR baseline (BUILD FIRST).**
  Corpus image extension + instance-annotation schema + the §5.4.2 governance (private store,
  image manifest, consent/intake contract, validator bounds) + capture build; shoot/collect
  device-capture-v3 with **split assignment at intake** (training/calibration/SEALED by capture
  session and device, §5.4.3) and the §5.4.4 hard-negative/OOD set; fold in the labelled tester
  photos already being gathered. Replay the existing OCR path over the **calibration**
  single-card cases via the on-device photo-replay runner (the sealed set stays sealed for
  Gate 3). Deliverable: per-category **recall**/precision/false-lock table **with 95% CIs**
  (§5.4.5). Board shots are collected and instance-annotated as they arrive, but **board-schema
  work never blocks this gate's single-card evidence** (Codex #4).
  **Purpose - bar-setting, not a coin-flip (Rev 2).** The owner has effectively decided
  single-card reliability must be fixed; Gate 0's job is to (a) measure OCR's recall on the hard
  slices (sites / foils / angles / dim) so the win is sized, (b) set the encoder's recall bar
  per slice (the fused policy must beat these numbers), and (c) fix the precision constraint it
  must hold (expected zero observed false locks, stated with its CI - any false lock in the
  baseline run is itself a finding). **Honest off-ramp:** if OCR's hard-slice recall comes back
  unexpectedly strong (indicatively: >= 90% overall AND >= 80% on sites-under-stress and
  off-axis, zero false locks), the premise is wrong and the owner reconsiders before any model
  work starts - targeted OCR fixes and Phase-B-only scoping are the alternatives on the table.
  Expected outcome, per owner experience and the corpus history, is that sites and the stress
  slices are well below that - and then the recorded numbers become the bars.
- **Gate 1 - offline proof: unseen-card generalisation + prototype strategy.** Training
  pipeline + encoder (identity holdout excluded from training, §5.4.3) + multi-prototype index
  (§5.3); evaluate on **calibration** images only. Bars, all with CIs: top-1 >= 95% / top-5
  >= 99% (distinct-card top-5) on the non-foil stress slices (foil slices measured and reported
  - a lag is owner-accepted for v1, tracked for a later fine-tune); the **identity-holdout
  cards, prototyped post-training exactly as a future catalog addition, within stated tolerance
  of trained-class performance** - this bar is what makes "new sets without retraining"
  claimable at all; the **multi-prototype vs one-centroid comparison** decided on the
  alternate-art / token / foil-vs-standard slices (collapse only on proven no-loss);
  hard-negative separation measured; collision report reviewed; embed-only catalog-update path
  + fail-closed new-card gate demonstrated (§5.6). Pure tools work; zero app risk.
- **Spike R - runtime/export viability (small, time-boxed, BEFORE native integration)**
  (Codex #7). From the frozen checkpoint: scripted LiteRT export, int8 op-coverage check,
  output/ranking parity vs the checkpoint (§5.7 tolerance), an indicative on-device measurement
  of size / cold init / preprocess+inference p95 / peak memory on the primary device, and R8
  keep-rule reconnaissance on a throwaway branch build. Optional bounded ONNX comparison here
  and only here. **Exit deliverable (Rev 4, Codex minor 2): the measured cold-init and memory
  numbers are turned into owner-approved NUMERIC ceilings, frozen before Gate 2 begins** - Gate
  2 then verifies against those fixed ceilings (§5.7). Outcome: LiteRT confirmed as the Gate-2
  stack with its ceilings set, or falsified with numbers and the decision reopened - **before**
  any production integration work is spent.
- **Gate 2 - native integration, flag OFF, platform baseline lands.** Runtime dependency (per
  §5.7 / Spike R) + assets + `RecogniserEngine` + canonical-digest checks + the journalled
  index promotion + build-time coupling gate. Bar: the §5.7 measured gates on the real release
  APK (size delta, cold init, total preprocess+inference p95 <= 30ms, memory ceiling, R8
  release behaviour, parity) on primary AND a low-end device; artifact-corrupt and mismatch
  paths proven to degrade to OCR-only. Ships dark. **Boundary contract (Codex non-blocking
  follow-up, Rev 4):** `catalogGenerationHash` is a REQUIRED typed `scan()` input at the
  JS/native boundary, sourced from `catalogVersion.json`; if it is absent or does not match the
  bundled index's expected identity, embeddings are DISABLED for that session (OCR-only). This
  makes the §5.1 runtime backstop explicit and enforced at the bridge, not merely an internal
  native check. **This is where the approved platform
  baseline lands (owner decision 2026-08-03, Section 16): minSdk 29, arm64-v8a-only release,
  x86_64 retained in debug** - it is required anyway to ship the native inference libs for a
  single ABI, and it is not implemented before this gate (or an explicitly approved earlier
  platform-baseline increment). The baseline's own verification (release manifest minSdk 29;
  release APK arm64-v8a only; debug retains x86_64; signed upgrade preserves profile data;
  unsupported-ABI install fails cleanly; APK size before/after recorded) runs as part of this
  checkpoint, per the `BUILD.md` checklist.
- **Gate 3 - fused policy, evaluated ONCE against the sealed set (the recall-mandate gate;
  Rev-4 contract per Codex Major 2).** `VisualFirstPolicy` with thresholds fixed from
  **calibration** ROC curves BEFORE the sealed run; then the harness runs ON and OFF **once**,
  as a **paired comparison over the SAME sealed cases**, with execution-bound provenance. Bars:
  - **Primary recall bar - PAIRED improvement:** on each hard slice, visual-first (ON) beats
    OCR-only (OFF) *as measured on the identical sealed cases* - the Gate-0 calibration
    baseline sized the win, but the sealed acceptance is the within-set paired delta, so ON
    cannot pass by beating a different corpus's number while losing to OCR on the sealed cases
    themselves. Report per-slice paired deltas with CIs (and the discordant-case counts the
    pairing exposes).
  - **Precision bar - the owner-accepted upper bound:** zero new false locks AND the sealed
    independent negative corpus large enough (per §5.4.5 sizing, sessions as units) to
    demonstrate the owner-accepted false-lock upper confidence bound. A zero-failure run on an
    undersized corpus does not pass this gate.
  - No per-category recall regression anywhere; latency within budget.
  A failed sealed run means fix-and-reseal: tuning continues on calibration data, and the next
  sealed evaluation REQUIRES a new sealed corpus version from fresh sessions (§5.4.3). CI
  floors added (FullCatalogBaselineTest pattern) pin both the paired recall gains and the
  precision constraint.
- **Gate 4 - flag ON, device evidence.** Owner device pass on primary + low-end (foils under
  light, sleeves, dim, angles); the **sustained-search recovery state** (§5.5) implemented and
  verified (trigger timing, honest copy, torch/reposition/Search-by-name actions, TalkBack
  single announcement, reduced-motion, Back behaviour, >= 48dp); optional consent-gated
  telemetry (ids/counters only) records visual-vs-OCR agreement. Then default-on in a release.

**Phase B - board scan, the bonus (remains behind its own separately approved proposal;
pre-scoped here only so Phase A cannot preclude it).**
- **Gate 5 - quad detection offline.** Classical detector (fallback: tiny model) evaluated on
  the frozen v3 board images (slight-angle snapshots, per the owner's capture posture), scored
  **geometrically against per-instance ground truth** (§5.4.1: IoU-matched quads, duplicates
  preserved, occluded instances optional). Bar: >= 90% of visible unoccluded instances yield a
  usable quad; occluded instances are cleanly skipped; the one-shot detection + K-embed
  snapshot cost and device thermal measured.
- **Gate 6 - board mode end-to-end.** Snapshot capture + stricter per-quad gating + the
  read-only `boardScan` bridge payload + the JS list whose rows open the existing Codex card
  detail (Section 5.8). Bar: the Section-2 board acceptance (>= 90% visible-unoccluded
  ground-truth instances recognised, zero confident-wrong rows, skipped quads surfaced
  honestly), evaluated once against the sealed board slice, device evidence on both tiers.

## 9. Data migration and compatibility

**Not applicable - by design.** No schema change, no persisted user data, no export/import format
change. The corpus format extension is versioned and backward-decodable. Artifacts version with
the APK alongside the catalog they were built from.

## 10. Rollback and recovery

Every gate is independently revertable; the feature ships dark until Gate 4 (Phase B until
Gate 6). Runtime rollback is the flag (JS option) plus the fail-closed artifact check; removing
the feature entirely deletes assets + the `recognise/` package + one dependency, with no data
cleanup (nothing persisted). There is no point of no return.

## 11. Verification plan

- **Off-device:** JVM unit tests for index load/digest/corrupt-artifact handling, the
  **canonical-digest cross-implementation parity vector** (§5.1 - pipeline, build gate, and
  native must produce identical digests for the shared fixture), policy selection (all five
  branches of 5.5), best-score card aggregation + best-different-card margin + distinct-card
  top-5 (§5.3), collision gating, snapshot per-quad gating incl. the skip-below-bar rule and
  geometric instance scoring (Phase B), the extended corpus round-trip, and the §5.4.2
  validator bounds (path containment, format allowlist, dimension/byte caps) exercised via the
  small committed redacted fixture; harness ON/OFF reports with pinned provenance;
  recorded-embedding replay; existing reducer/selector tests unchanged and green.
- **Evaluation discipline:** split assignments enforced by the image manifest and checked by
  the validator (no image in two splits; no sealed session/device in calibration); thresholds
  frozen before the sealed run; the sealed set consumed once per evaluation event, re-versioned
  on any violation (§5.4.3); every reported metric carries its CI with **sessions/scenes as the
  statistical unit** (§5.4.5); Gate 3 scored as the **paired ON-vs-OFF contract** (§8) with the
  negative corpus sized to the owner-accepted false-lock bound.
- **Build gates:** the **independent derived-set verification** (§5.1 - expected prototype set
  derived from catalog-generation hash + art manifest + prototype-manifest exclusions, index
  checked against the derivation, header digest recomputed, never trusting the index's
  self-declaration) + encoderVersion pairing check + journalled-promotion integrity
  (interrupted promote blocks packaging, `--recover` path exercised; a DROP adding cards
  produces keys + prototypes in the same journal or the promote fails); `check:types`,
  `check:cycles`, `check:docs`, `build`; APK size assertion recorded in the Gate-2 checkpoint.
- **Device (release APK, named device/build):** Spike R indicative numbers; Gate-2
  latency/cold-init/memory/thermal + R8 release behaviour on primary + low-end; Gate-4 stress
  matrix + the §5.5 recovery-state a11y checks; Gate-5/6 board matrix incl. stacked
  minions-on-sites; degraded boot with deliberately corrupted assets; `check:smoke` unaffected
  routes.
- **Regression:** the frozen v1/v2 text corpora keep their floors (the OCR path is untouched when
  the flag is off, and still exercised as branch 5 of the policy when on).

## 12. Security, privacy, performance, operations

Frames never leave the device and are never persisted outside explicit capture builds (existing
`captureCorpus` discipline: flip false before merge). Board scan raises the privacy note, not the
risk: a board snapshot can include an opponent's cards and surroundings; it is processed in
memory and discarded like every analyzer frame (board mode persists nothing and writes nothing),
and the result payload contains card ids and geometry only.
**Evaluation-image privacy is governed by §5.4.2** (Rev 3): tester photos live in a private
store with consent/provenance rows, EXIF (incl. GPS) stripped at intake, redaction of
identifiable surroundings, contributor deletion honoured, and publication default-NO - the
repository carries only manifests, digests, and a small cleared fixture. Corpus image handling
is bounded fail-closed (path containment, format allowlist, size caps, decode-to-target
memory). **Legal/ops:** training, checkpoint retention, repository storage, and APK
distribution of weights derived from the card art proceed under the **owner's recorded
determination (2026-08-03, §16)**; the G7 licences/attribution surface in Settings carries
every bundled ML notice obligation (e.g. the Apache-2.0 backbone NOTICE).
No network at inference. Telemetry, if added, is consent-gated ids/counters through the existing
native telemetry authority. Perf budgets in Sections 5.7/8. Operational cost: the Python training
toolchain is a new, pinned, containerised surface with committed configs; `BUILD.md` documents the
embed-only update step so a routine catalog drop stays a one-command, no-GPU affair.

## 13. Risks and unanswered questions

- **Silent wrong match - the one failure the recall mandate forbids** (embeddings confidently
  wrong on out-of-distribution input: playmats, proxies, other games, screens/moire). Recall
  gains are worthless if they cost the ~100% precision. Mitigated by margin + collision gating,
  temporal confirmation, the negative corpus bar (zero false locks), and OCR arbitration on
  single-card ambiguity. Board snapshots cannot use OCR arbitration or temporal confirmation, so
  their per-quad bar is set stricter: skipped, never guessed. Highest-severity residual; owns
  the Gate-3/6 bars.
- **Version coupling** - build-time gate + runtime digest backstop (Section 5.1); the dangerous
  variant (stale index, confident wrong id) is structurally prevented by artifacts and catalog
  sharing one APK.
- **Board-scan resolution floor:** a card at board distance may be under ~150px tall in the
  snapshot; embedding quality degrades with quad size. Mitigations: minimum-quad-size threshold
  below which a quad is skipped; framing guidance; possibly a two-shot zoom flow. This is a
  Gate-5 measurement, and the honest possible outcome is "board scan works at half-board range,
  not full-table range" - acceptable for a bonus feature, stated up front.
- **Occlusion is structural** (minions atop sites) and the owner's rule is skip-not-guess:
  training still includes occlusion augmentation (it helps marginal cases), but the metric never
  rewards recognising an occluded card - board labels mark them optional, and skipping them is
  correct behaviour.
- **Foil/OLED realism gap:** synthetic glare may undershoot real foil rainbow and screen moire;
  v3 contains the real thing. Per Rev 2, an initial foil lag is owner-accepted (reported, not
  gating v1); if the gap is large, a small real-photo fine-tune set is the follow-up, not a
  blocker.
- **Size budget miss:** levers in §5.7; if all fail, the owner decides between a bigger APK and
  a reduced scope - never a CDN model.
- **Toolchain longevity:** one-person repo + a GPU pipeline = bit-rot risk; mitigated by
  embed-only updates as the routine path and pinned/containerised training as the exception.
- **Legal exposure on model weights (Codex #6):** weights trained on the card art may be a
  derived work of art the project does not own. The **owner's recorded determination
  (2026-08-03, §16)** authorises training, retention, repo storage, and distribution for this
  non-commercial application, with the G7 notices surface covering licence obligations. The
  honest residual: that determination is the owner's own risk acceptance, not a rights-holder
  licence - a third-party challenge would remain the owner's accepted risk, recorded here so it
  is never mistaken for engineering's call.
- **Evaluation-governance overhead:** the private store / splits / consent machinery (§5.4) is
  real process cost for a small project; skipping it is how sealed sets silently become tuning
  sets. Mitigated by keeping the machinery thin (a manifest + validator rules, not a platform).

**Remaining owner decisions (updated 2026-08-03 - owner cleared the near-term set):**
1. **The owner-accepted false-lock upper confidence bound (Codex Major 2b):** the shipping
   threshold for false-lock rate (e.g. <= 2% at 95% confidence), which also sizes the
   independent negative corpus Gate 3 requires (§5.4.5). Still open - needed before the sealed
   Gate-3 run is scheduled.
2. **Board mode's home surface** (Play pillar mid-match vs the universal scanner) - still open,
   product call, needed before Gate 6 UX.

**Resolved 2026-08-03 (owner):**
- **Gate-0 off-ramp thresholds - ACCEPTED as stated** (OCR >= 90% overall AND >= 80% on
  sites-under-stress / off-axis, zero false locks; below it, build the encoder). Owner: embeddings
  are the primary path, OCR refines the score in conflict (ambiguous) cases; OCR's angle/off-frame
  weakness is that the name text falls outside the fixed OCR read-zones, which is exactly what
  whole-card embedding sidesteps.
- **APK budget (~8MB) - WITHDRAWN 2026-08-04** (was owner-"confirmed a non-issue"; the ~8MB figure itself
  was author-proposed and is retired - size is now an owner-controlled tradeoff, see §Fixed constraints > Size).
- **Screen-scan policy - RESOLVED** per §5.4.4: a genuine card on a screen is a tolerated /
  unguaranteed dev-only input (not a mandated negative); non-card screen content stays a
  must-not-lock negative; the sealed set + all shipping numbers are PHYSICAL cards only. Owner
  deferred the crisp product line to the process and accepts this resolution.

**Decision timing (Codex non-blocking follow-up, Rev 4):**
- Gate-0 off-ramp thresholds and screen-scan policy: resolved above (were "before Gate-0 intake").
- False-lock confidence bound (#1): **before sizing and sealing the negative corpus.**
- APK budget: confirmed (was "before Spike R exits").
- Board home surface (#2): **before Phase-B UX work.**

*(Resolved and recorded, not open: the legal/licensing determination on model weights - owner,
2026-08-03, §16; the runtime/model stack - OQ-1, Codex recommendation in §5.7; the Android
platform baseline - minSdk 29 / arm64-only release, owner decision 2026-08-03, Section 16.)*

## 14. Self-Critique (strongest case against)

1. **The recall gap might be cheaper to close than an encoder.** The existing corpora show OCR
   at 13/15 and 12/13, and the known misses are framing issues that cheaper fixes (guide
   geometry, exposure lock, torch prompt) might close. The owner has decided reliability must be
   fixed - but *how* is still an engineering question, and Gate 0's off-ramp exists precisely
   because a surprisingly strong OCR baseline would mean the encoder is the expensive answer to
   a cheap problem. If that off-ramp triggers and board scan (a bonus with real physics risks -
   resolution floor, occlusion) becomes the sole carrier of the encoder's cost, that should be a
   deliberate owner decision, not a smuggled one. The plan makes it explicit either way.
2. **The training pipeline is the real long-term cost, and it lands on one person.** A Python/GPU
   toolchain in a Node/Kotlin repo is a foreign body. Embed-only updates blunt this, but the day
   real retraining is needed (art style drift, new card frame, recall regression), the pipeline
   must still run - years later, on someone's machine. If that risk is unacceptable, stop at
   Gate 0/1.
3. **Guide-crop-instead-of-warp could be the single-card design's hidden flaw, and board scan
   raises the stakes on the opposite side.** If casual holding angles exceed what augmentation
   absorbs, Gate 3 shows good corpus numbers (shot by a careful owner) and bad field behaviour;
   meanwhile Phase B bets on a classical quad detector that dark, cluttered, sleeve-reflective
   boards may defeat, pulling in a detector model (more size, more training surface). Honest v3
   capture with deliberately sloppy framing and ugly boards is the counterweight - but the
   residual risk is an eval set that flatters the design.
4. **The failure most likely to escape tests:** a *new* card printed with artwork visually close
   to an existing card, entering via embed-only update with no retrain - collision derivation
   and the §5.6 fail-closed new-card gate catch identical-ish art and weak prototypes, but a
   near-threshold pair that passes both, under foil glare, could still false-lock, and on a
   board (no OCR arbitration) it lands as a confident wrong row. The negative corpus cannot
   contain cards that don't exist yet; the per-build collision report and the new-card gate
   report are the tripwires, so both must be *reviewed* build outputs, not log lines - and the
   identity-holdout numbers (Gate 1) are the only forward-looking estimate of how often this
   happens.
5. **Multi-card scope creep.** Even as a snapshot, board scan touches detection, a new UX
   surface, and a new bridge payload; it could balloon into the tail that wags the scanner -
   and it is the bonus, not the mandate. That is why it is phased behind its own proposal and
   two gates, with the recogniser core (the shared part) proven on single-card recall first.
6. **Evidence that would change the decision:** a surprisingly strong Gate-0 hard-slice recall
   number (triggers the off-ramp - the encoder is the wrong fix); the owner withdrawing or a
   rights-holder challenging the recorded legal determination (stops artifact shipping; §13);
   Spike R falsifying LiteRT with no viable alternative inside the budget (re-scope); Gate-1
   non-foil stress accuracy below ~90% top-1, or identity-holdout performance collapsing vs
   trained classes (the generalisation thesis is wrong - stop before any native work); a
   Gate-3 sealed run where ON fails to beat OFF on the paired sealed cases, or that buys
   recall by spending precision (violates the mandate - the design is rejected as built);
   Gate-5 detection failing on real boards (the bonus re-scoped to "a few cards near the
   camera", or dropped - Phase A stands regardless).
7. **Governance can rot into theatre.** Splits, sealed sets, consent rows, and CIs only work if
   they are actually enforced by the validator and respected under schedule pressure; a solo
   project quietly "just checking the sealed set once more" is the classic failure. The
   re-version-on-violation rule (§5.4.3) is written to make that visible, but it is ultimately
   a discipline claim, and Codex should treat any future report whose sealed-set version has
   not changed after a failed run with suspicion.

## 15. Documentation impact

**Recogniser feature (future gates):** `COMPENDIUM_ARCHITECTURE.md` (scanner recognition posture,
artifact boundary, board-scan contract), `BUILD.md` (training/embed-only pipeline + the
DROP-pipeline prototype stage, capture workflow, image-corpus governance + tester intake
contract, journalled index promotion + recovery, size budget), `COMPENDIUM_FEATURE_MATRIX.md`
(camera-assisted entry gains visual recognition; Settings gains the G7 licences/attribution
surface; board
scan as a planned capability), `DESIGN_SYSTEM.md` (Phase B board-list surface when its UX proposal
lands), `COMPENDIUM_DATA_MODEL.md` (reviewed, no change - no schema impact),
`ENGINEERING_CONSTITUTION.md`/`AGENTS.md` (reviewed, no change). `check:docs` run at each gate.

**Platform-baseline decision (this documentation increment, 2026-08-03) - assessed under the
Documentation Impact gate:**
- `BUILD.md` - **updated now:** distinguishes the current shipping baseline (minSdk 22, arm64-v8a +
  armeabi-v7a) from the approved next baseline (minSdk 29, arm64-v8a-only release; x86_64 in debug),
  states the effective implementation gate (recogniser Gate 2 or an approved earlier increment),
  user impact, the required implementation verification checklist, and the separate targetSdk/
  compileSdk 35 -> 36 follow-up with its Play deadline.
- This proposal (Section 16) - **updated now:** the architecture record for the decision (no
  `docs/adr` convention exists; per instruction, no second governance pattern was invented).
- `COMPENDIUM_ARCHITECTURE.md` - **reviewed, no change.** It carries no Android API/ABI/device-support
  posture (AGENTS.md assigns it "runtime posture", but the concrete platform baseline lives in
  `BUILD.md`); its native-adapter and offline-durability posture is unaffected, so nothing there
  becomes stale. If it ever gains an explicit runtime-baseline section, it should reference the
  approved baseline.
- `COMPENDIUM_DATA_MODEL.md` - reviewed, no change: no schema, persistence, or migration impact.
- `COMPENDIUM_FEATURE_MATRIX.md` - reviewed, no change: supported-hardware is a build/distribution
  concern, not a pillar product capability.
- `DESIGN_SYSTEM.md` - reviewed, no change: no visual-language or token impact.
- `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` - reviewed, no change: no process or agent-policy impact.

## 16. Approval record

**Owner architecture decision - recorded 2026-08-03 (documentation only).** The owner has approved
the next Android platform baseline: **minSdk 29 (Android 10)** with **arm64-v8a as the only release
ABI**. Debug builds retain x86_64 for emulator development. Android 9 and earlier, and 32-bit-only
devices, keep their last compatible build and cannot install future releases. This deliberately
trades nominal obsolete-hardware support for a modern camera/ML experience, smaller native APKs,
current inference technology, and a narrower verification matrix. It does **not** itself move
compileSdk/targetSdk (a separate 35 -> 36 increment is required before future Play submissions).
**No Gradle, dependency, source, version, or APK change is authorised by this record** - the
baseline is implemented at recogniser **Gate 2**, or an explicitly approved earlier platform-baseline
increment, never before. Concrete numbers, user impact, and the implementation verification checklist
live in `BUILD.md`; this proposal is the architecture record for the decision (no `docs/adr`
convention exists, per Documentation Impact §15).

**Owner legal determination - recorded 2026-08-03 (owner addition B, resolving Codex Major 3).**
The owner determines that training model weights on the card-art images is permissible for this
non-commercial application (the app is not made for profit). A licences/attribution disclaimer
will be included in Settings covering all bundled ML technology whose licence requires notice
(e.g. the Apache-2.0 backbone NOTICE). **This determination covers training, checkpoint
retention, repository storage, and APK distribution of the derived weights.** It is the
owner's determination and risk acceptance, recorded here by engineering - not an engineering
authorization; the residual third-party risk it accepts is stated in §13. Gate-1 training and
all downstream artifact handling proceed under this record; the G7 Settings surface (§2) is
the notice deliverable.

**Rev 2 disposition (superseded):** Rev 2 went to Codex with OQ-1 open; Codex reviewed and
returned the findings resolved by Rev 3 (Appendix A), including the OQ-1 recommendation now
recorded in §5.7. The Android platform architecture-record increment above is Codex-APPROVED.

**Rev 3 disposition:** Codex returned **Changes required** - three contract corrections (the
self-referential digest, the Gate-3 statistical contract, the legal self-authorization) and
three internal drifts, all resolved in Rev 4 (Appendix A, Rev-4 rows), plus the two owner
additions folded in (DROP-pipeline artifact generation; the legal determination above).

**Rev 4 disposition: APPROVED by Codex on 2026-08-03, with non-blocking follow-ups.** The
proposal-review gate is cleared; the three Rev-3 Majors are resolved without reopening the
architecture. Codex's non-blocking follow-ups are folded into Rev 4 (no Rev 5 required): the
frozen one-sided-Wilson interval method in `RunSpec` provenance (§5.4.5), the
`catalogGenerationHash` typed `scan()` input at Gate 2 (§8), and the decision-timing schedule
(§13). Codex records the legal entry as the owner's recorded risk decision, not a legal opinion
or a representation that a rights-holder has granted permission.

**Owner approval - recorded 2026-08-03.** The owner approves the architecture and authorises
Gate 0. Near-term owner decisions resolved the same day (§13): the **Gate-0 off-ramp thresholds
are accepted as stated**, the ~~8MB APK budget~~ (**WITHDRAWN 2026-08-04**, see §Size), and the **screen-scan policy is
resolved** (genuine card on a screen = tolerated, unguaranteed, dev-only; sealed set + shipping
numbers are physical-card only; §5.4.4). Still open and timed: the **false-lock upper confidence
bound** before sizing/sealing the negative corpus, and the **board home surface** before Phase-B
UX. **Gate 1 (model training) begins only if Gate 0 does not trigger the OCR-only off-ramp.**
Phase B remains behind its own separately approved proposal.

**Data-sequencing reality (recorded honestly).** Gate 0's decision-number is the OCR hard-slice
recall baseline on **labelled PHYSICAL-card photos**; the owner currently has no physical cards
(dev testing is screen-based, excluded from gating evidence per §5.4.4), so that number is gated
on the inbound labelled tester photos. Gate 0's offline data-governance + intake + OCR-replay
tooling can be built ahead of that data; the baseline scoring runs once the labelled physical
corpus is in hand.

---

## Recommendation

**Proceed to Gate 0 now - it establishes the governed data and the bars for everything after.**
The owner has decided single-card reliability must be fixed, and the evidence agrees on the
shape of the problem: OCR is ~100% right when it locks and silently fails to lock on the hard
cases - a **recall** gap with a precision constraint. The embedding recogniser is the credible
fix, justified on single-card recall alone; board scan is the bonus quad detection unlocks,
kept honestly phased and separately approved. The brief's direction survives adversarial
review; its load-bearing premises about this repo do not (there is no quad/warp pipeline to
fork; the decision layer belongs in the measured Kotlin path, not TS; embeddings belong in an
APK asset, not a SQLite BLOB), and the baseline it correctly demands does not exist yet: the
frozen corpora contain zero foil/glare/sleeve/dim cases and zero board shots. Rev 3 hardened
the path Codex probed (sealed splits, identity holdout, multi-prototype index, journalled
artifacts, governed images, recovery UX, LiteRT-first with a cheap spike); Rev 4 closes the
three contract holes Codex found in it - the index is now verified against an independently
derived expectation (catalog-generation hash + prototype manifest), Gate 3 is a paired
ON-vs-OFF comparison on the same sealed cases with an owner-sized negative corpus behind the
false-lock bound, and the legal question is settled by the owner's recorded determination
rather than engineering fiat - and folds in the owner's DROP-pipeline scope (prototypes
promoted atomically with every catalog drop) and the Settings notices surface. Gate 0 is
cheap, reuses the existing harness, is fed by tester photos already arriving, and converts the
owner's decision into measurable bars - paired recall to win, a CI-honest precision bound to
hold - with an honest off-ramp if OCR surprises. Codex: approval-oriented review of Rev 4.
Owner: approve Gate 0 and set the false-lock bound.

---

## Appendix A - Codex finding -> disposition map (Rev 3, then Rev 4)

### A.1 Rev-3 dispositions of the Rev-2 findings

| # | Codex finding | Rev-3 disposition | Where |
|---|---|---|---|
| 1a | Evaluation independence: no train/calibration/test separation | Three-way split assigned at intake; SEALED test isolated by capture session AND device; sealed set never tunes anything; any tuning use invalidates it and requires a new sealed corpus version; thresholds frozen from calibration before the single sealed run | §5.4.3, §8 Gates 0/3, §11 |
| 1b | Future-card generalisation unproven | Stratified card-identity holdout excluded from ArcFace training, prototyped post-training as a future addition, gated at Gate 1 within tolerance of trained classes | §5.4.3, §8 Gate 1, §6 (A8) |
| 1c | Hard-negative/OOD coverage thin | Substantial defined OOD set (other TCGs, card backs, playmats, screens/moire, partial cards, empty scenes, visually-close non-targets), split like all data, false-lock bars measured against it | §5.4.4, §2, §8 Gate 3 |
| 1d | Zero failures in ~60 cases restated as 100% | All headline metrics carry 95% CIs (Wilson); zero-failure results stated as an upper bound, never "100% field precision" | §5.4.5, §2, §8 Gates 0/3 |
| 1e | "New cards need no retraining" asserted | Made conditional + fail-closed: per-card unseen-class and collision checks at every index build; failing cards stay OCR-only (excluded from index AND digest), never forced in | §5.6, §1.1, §6 (A8) |
| 2 | Single mean prototype per card smears distinct arts | Multi-prototype default: one per distinct source scan (~3,087), best-score aggregation to card ID, margin vs best DIFFERENT card, distinct-card top-5; centroid collapse only on Gate-1 proven no-loss incl. alternate/token/foil slices; index ~1.6MB | §5.3, §5.1, §1.2.4, §8 Gate 1 |
| 3a | CATALOG_DROP treated as authority | Reclassified as cache; inputs reconstructed hash-verified from the prospective content-addressed manifest / R2; clean checkout reproduces the index | §5.6 |
| 3b | Index promotion not atomic with catalog | Index joins the existing journalled catalog-promotion transaction (journal.mjs staging/promote/recover); encoder separately versioned, outside routine promotion | §5.1 |
| 3c | Digest ambiguity (ids+names vs ids-only) | ONE canonical recognition digest with a shared cross-implementation test vector - **projection superseded in Rev 4 (Major 1): the ids-only self-declared set was itself unsound; see A.2** | §5.1, §11, A.2 |
| 3d | Interruption/recovery undefined | Inherited journal semantics: stale journal blocks packaging, `--recover` deterministic, clean-checkout rebuild defined | §5.1, §5.6, §11 |
| 4a | Raw photos assumed into public Git; no consent/hygiene | Private governed store + committed manifest (SHA-256, dims, size, tags, consent ref, split); consent/provenance + contribution-rights intake; EXIF stripped; redaction; retention/deletion; publication default-NO; small redacted committed fixture for CI decode tests | §5.4.2, §12 |
| 4b | Validation unbounded on hostile images | Fail-closed validator bounds: path containment, format allowlist, dimension/byte caps, bounded decode memory | §5.4.2, §11 |
| 4c | `Expected.Identities(set)` cannot represent duplicates/geometry | Per-INSTANCE board annotations {cardId, bounds, occluded/optional}; duplicates preserved; geometric IoU matching; occluded = optional, never absorbs a wrong id | §5.4.1, §8 Gates 5/6 |
| 4d | Board schema must not block Phase A | Explicit: single-card corpus complete and scoreable without any board case; board annotation proceeds in parallel | §5.4.1, §8 Gate 0 |
| 5 | "Couldn't identify" promised but scanner searches silently forever | Concrete Phase-A sustained-search recovery state: presence-neutral copy, torch/reposition/Search-by-name, TalkBack-once, reduced-motion, Back unchanged, >= 48dp; in Gate-4 acceptance; deferral requires striking the acceptance line + stating the consequence | §5.5, §2, §8 Gate 4 |
| 6 | "App is MIT" false; weight-distribution rights unexamined | Corrected against README.md:76; licence compatibility separated from the right to train/distribute weights - **which Rev 3 left unresolved-but-locally-permitted; resolved in Rev 4 by the owner's recorded determination (Major 3 / addition B; see A.2)** | §1.1, §16, §12, §5.4.2 |
| 7 | Runtime decision needed | Recorded: LiteRT + MobileNetV4-Conv-S PTQ-int8 primary under API 29/arm64; ONNX bounded comparison only, no dual production stacks; ONE frozen PyTorch checkpoint + reproducible export; gates = release APK delta, cold init, total preprocess+inference p95, memory, R8 behaviour, output/ranking parity; QAT only on measured PTQ damage | §5.7, §5.6, §8 Spike R |
| G | Gate restructure | Gate 0 = governed data + splits + baseline; Gate 1 = unseen-card + prototype strategy; Spike R = runtime/export viability before integration; Gate 2 = inference + approved platform baseline; Gate 3 = single sealed evaluation; Phase B separately approved | §8 |

### A.2 Rev-4 dispositions of the Rev-3 findings + owner additions

| # | Finding / addition | Rev-4 disposition | Where |
|---|---|---|---|
| Major 1 | recognitionDigest hashed the index's self-declared id set; runtime filtered the catalog to that same set - an omitted prototype or a stale index still "matched" | Digest re-anchored on INDEPENDENT authority: the existing catalog-generation content hash (`generation.mjs:87-102`, already folding catalog content + content-addressed art keys) + a deterministic prototype manifest (source keys/hashes, card ids, inclusion/exclusion decisions, encoderVersion). The build gate DERIVES the expected prototype set from those inputs and verifies the index against the derivation (index header = claim, never truth); runtime compares against a build-baked expected digest + live catalog generation identity. Omission/staleness now fails closed to OCR | §5.1, §11 |
| Major 2 | Gate 3 compared ON to the separate calibration baseline (could pass while losing to OCR on the sealed cases); ~60 zero-failure negatives treated as sufficient; frames as trial units | (a) Primary bar = PAIRED ON-vs-OFF on the SAME sealed cases, per hard slice, with paired deltas + CIs; (b) shipping threshold = owner-accepted false-lock upper confidence bound with the independent negative corpus SIZED to demonstrate it (rule-of-three sizing made explicit; zero-observed necessary, not sufficient); (c) statistical unit = capture session/scene, not correlated frames | §8 Gate 3, §5.4.5, §2, §13 (decision 1) |
| Major 3 | The proposal itself declared local Gate-1 training permissible while calling the right unresolved (engineering self-authorization) | Replaced by the owner's RECORDED determination (2026-08-03): training on card art permissible for this non-commercial app; covers training, checkpoint retention, repo storage, APK distribution; Settings licences/attribution surface added as scope (G7); residual third-party risk stated as the owner's accepted risk | §16, §1.1, §2 (G7), §12, §13 |
| Minor 1 | Index size ~1.6MB (§5.1) vs ~0.6MB (§5.7) | Consistently ~1.6MB (3,087 prototypes x 256-d fp16); §5.7 lever corrected and the stale one-centroid figure labelled as superseded | §5.7 |
| Minor 2 | Cold-init/memory called gates without numeric ceilings | Spike R's exit deliverable FREEZES owner-approved numeric cold-init + memory ceilings BEFORE Gate 2 begins; Gate 2 verifies against those fixed numbers | §5.7, §8 Spike R |
| Minor 3 | Invariant 7 said catalog growth requires NO retraining, contradicting §5.6's conditional contract | Invariant-7 wording aligned: no retraining ONLY IF the unseen-class + collision gates pass; otherwise OCR-only, recorded excluded, never forced into the index | §7 |
| Addition A | DROP-pipeline artifact generation (owner scope) | First-class scope (G6): a catalog DROP that adds cards generates their content-addressed image keys AND prototypes, recorded in the prototype manifest, promoted atomically in the same journalled transaction; the index never lags the catalog; embed-only, no GPU, one command preserved | §2 (G6), §5.1, §5.6, §11 |
| Addition B | Owner legal determination (owner scope) | Recorded verbatim-faithful in §16 (dated 2026-08-03), replacing remaining-owner-decision #1; Settings notices surface = G7, landing Gate 2 (built) / Gate 4 (user-visible) | §16, §2 (G7), §13 |
