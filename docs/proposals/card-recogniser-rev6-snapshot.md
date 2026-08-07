# Rev 6 (proposed): pure-snapshot scanner - image recognition primary, OCR refines

## Status

**Proposal revision for Codex review.** Author: Claude Code (lead). Reviewer: Codex (principal / independent).
Approver: owner. Supersedes Rev 5.1 (`card-recogniser-rev5-best-frame.md`). Interaction/visual/a11y design is
a companion doc: [`card-recogniser-rev6-snapshot-interaction.md`](./card-recogniser-rev6-snapshot-interaction.md)
(authored by Fable). Classification: **High-risk** (rewrites the shipped scanner's core interaction).

Owner directive, from a real device test: the live-lock scanner is being replaced by a **pure snapshot**
model. This doc covers the technical/ML architecture only; the UX lives in the companion doc.

## Codex disposition (Changes required) - corrections recorded

Accepted. The crop blocker was RUN; the four contract corrections and the lean state model are folded in
below. **This section is authoritative where it differs from the original Rev 6 text.**

**BLOCKER RESOLVED - frameless crop experiment** (`scripts/recog/train/crop_experiment.py`; exact shipping
int8 ONNX + index.f16; 33 governed raw captures; top-1/top-5 by slice):

| preprocessing | all t1/t5 | spell (portrait) | site (landscape) |
|---|---|---|---|
| whole raw frame | 48% / 79% | 61% / 78% | 33% / 80% |
| **centre-square crop** | **76% / 88%** | **78% / 89%** | **73% / 87%** |
| rectify_card (control) | 73% / 79% | 72% / 78% | 73% / 80% |

Decision: the single preprocessing path is a **fixed centre-square crop** - it beats the whole frame
(background dominates top-1; sites collapse to 33%) AND the classical rectifier, on every slice, and it is
the simplest possible on-device step (no detector, no rectifier port, one preprocessor). Sites clear the 80%
top-5 bar (87%). Rotated/upside-down capture is UNMEASURED (corpus has off-axis tilt but no orientation tag),
so the UX promise narrows to **"portrait or landscape"** - arbitrary rotation is not claimed until measured.
§4's three-way option is closed.

**Correction 1 - identity is cardId, never name.** Index, shortlist, and fusion carry
`Candidate(cardId, displayName, score)`. The UI shows `displayName`; every lookup, margin, printing decision,
and write uses `cardId`. `cardByName` is removed; the index build emits the catalog id per prototype.

**Correction 2 - OCR restriction is risk REDUCTION, not elimination.** OCR can still promote a quoted card
IF it happens to sit in the visual top-5 (two visually-related cards collide, one quoted). Fusion tests must
include the known quoted-site case + synthetic "quoted candidate already in top-5" cases. **Automatic single
Result is NOT authorized from the 33-photo dev set.** Rollout: **Shortlist is always safe (user confirms);
automatic single Result is eligible ONLY after the frozen sealed evaluation demonstrates the owner-approved
false-confirm bound.** If that evidence is not ready, snapshot recognition **ships Shortlist-only** first.

**Correction 3 - artifact failure fails CLOSED, never to unrestricted OCR.** Missing/corrupt/mismatched model
or index yields an honest unavailable/Empty with Try again + Search by name. OCR must NOT introduce a card
when no validated visual shortlist exists (that recreates the site mis-ID this redesign fixes). QR stays. No
crash, placeholder candidate, or silent return to the live-lock scanner. Overrides the base proposal's
"degrade to OCR-only."

**Correction 4 - the <=80ms freeze.** The current `armCapture` waits for the next *throttled* analyzer frame
(<=350ms, possibly busy), so the freeze can lag. Fix: an armed shutter capture **bypasses the analyzer
throttle** and grabs the current frame immediately when none is in flight; <=80ms is then a **measured
target**, not an assumption. Do not add a cached bitmap or a second camera stack before proving the
throttle-bypass insufficient.

**Lean state model** (smaller than proposed): `SnapState = Ready | Capturing | Identifying | Shortlist |
Empty`. **No persistent Result state** - a confident match directly populates the existing `RecognitionCard`
and triggers its reveal. The captured bitmap is **memory-only**: never logged, persisted, or crossed into
JavaScript; recycled on retry / result / Back / teardown; owned by ONE snapshot token so a late OCR/ORT
result can never update a newer scan.

**Interaction dispositions** (recorded in the companion doc): 650ms reveal APPROVED (owner may restore
800ms); shutter-as-progress-ring APPROVED; **match captions REMOVED from MVP** (they overstate what OCR
knows and would modify the otherwise-untouched sheet); **first-run hint REMOVED** for one permanent line
("Fill the frame with one card, portrait or landscape, then tap"); the card-name-over-stamp geometry is
corrected (the sheet owns the accessible title; no overlapping "above the frame" placement).

**Ship-and-stop condition** (authoritative): centre-crop path >= 80% top-5 on the frozen OCR-miss/sites slice
(portrait + landscape reported separately); automatic single Result only after the sealed false-confirm bound
is met, else Shortlist-only; warm snapshot-to-result p95 <= 1.5s / first-use <= 2.5s (Pixel 9 Pro XL); 20
capture/retry/Back/background cycles with no stale result, crash, ANR, or leaked bitmap/session; corrupt or
missing model+index -> retry/Search-by-name only; TalkBack + reduced motion + zero-image + QR + collection
writes pass; signed-release APK + peak memory measured and owner-accepted. After that: no detector,
fine-tuning, board mode, extra runtime, confidence visualisation, or extra motion.

**Scope-record corrections:** Rev 5.1 is an **uncommitted prototype**, not an architectural baseline or
migration source. `CandidatePanel` and `VisualMatcher` are **prototype code**, not shipping components reused
"unchanged." `RecognitionCard` stays unchanged **because** captions are removed. Acceptance is measured by
fewer states and fewer competing recognition paths, **not** net line deletion.

The sections below are the original Rev 6 draft, retained for context and superseded by the above.

## 1. Why (the device test settled it)

Testing the Rev 5.1 build on a Pixel 9 Pro XL, with real cards, produced two findings:

1. **OCR actively mis-identifies sites** - a site whose rules text references another card gets locked as
   the *referenced* card, because OCR reads that name off the rules text. This is worse than a miss.
2. **Image recognition returned the correct site first, every time.** It matches the whole card image, so
   it cannot be fooled by quoted card names.

The owner's reframe removes the constraint that shaped Rev 5.1: if every scan is one deliberate tap, the
660ms matcher runs **once per tap**, which is exactly the budget it fits. The ~30ms *per-frame* contract
that forced "OCR-first, escalate on failure" no longer applies. So image recognition becomes the primary
identifier and OCR becomes a refiner - the model the owner has described since the outset.

## 2. Architecture

One deliberate act per scan (full interaction in the companion doc):

```
tap shutter -> freeze frame -> [ image-rec embed  +  OCR read ] on the SAME still
            -> fuse (S3) -> Result (one) | Shortlist (<=5) | Empty -> existing RecognitionCard sheet
```

- **Primary: image recognition** - the existing on-device `VisualMatcher` (DINOv2-small int8, 448px, the
  fp16 prototype index) embeds the captured still and returns a ranked shortlist of card names.
- **Refiner: OCR** - ML Kit reads the same still. It can only **promote or confirm a card already in the
  visual shortlist**; it can never introduce a card the image matcher did not propose. This is the
  structural fix for finding (1): a referenced card the player is not holding is not visually similar to
  the site, so it is never in the shortlist, so OCR can never select it.
- **No guide frame.** Cards are captured in natural orientation (portrait spells, landscape sites).
- **Output feeds the existing sheet unchanged** (`RecognitionCard`: collection / wishlist / deck + printing
  picker). A confirmed identity is the only thing Rev 6 produces; every write still needs a sheet action.

## 3. OCR-refine fusion rule

The decision rule (one confident answer vs a pick-list) is specified in the interaction doc S3. Technically:

- Inputs per snapshot: visual shortlist `V = [(card, s)…]` (top-5 by cosine), and the OCR read.
- **TEXT-CONFIRMED(c):** OCR tokens fuzzy-match `c`'s canonical name at >= `T_text` normalised similarity
  (reusing the existing `Norm` + `Fuzzy` matcher). Weak matches only re-order `V`, never surface.
- **DECISIVE:** `s1 >= T_high` AND `s1 - s2 >= T_margin` (the sites case: near-certain, well-separated).
- **FLOOR:** `s1 >= T_floor`, below which nothing is shown.
- Rule order: text-confirmed top-1 -> Result; text-confirmed exactly-one-other -> promote -> Result;
  text-confirmed two-plus -> Shortlist; decisive & no text -> Result; floor & not decisive -> Shortlist;
  else Empty.

**Thresholds are provisional and owned here, not in the UI.** `T_high 0.62 / T_margin 0.10 / T_floor 0.35 /
T_text 0.85` are starting points. They must be **calibrated** on the Gate-1 dev corpus (the 33 photos,
sliced by sites / spells / OCR-miss) and re-frozen against the eventual sealed set, with the explicit
targets: zero false auto-confirms (a wrong card presented as the single Result), and the sites slice
resolving to a single Result as often as possible. Calibration is a required pre-ship task.

## 4. Open technical risk #1: framing without a guide (must measure before committing)

The validated numbers (73% top-1 / 79-82% top-5) were measured on tester photos **cropped to the card by
the classical rectifier** (`rectify_card`). Rev 6 removes the guide, so the on-device input changes, and the
current `VisualMatcher` crops to a fixed `GuideGeometry` rect that will no longer exist. This is the biggest
accuracy risk and it is unmeasured on-device. Options, cheapest first:

1. **Whole-frame embed** - simplest; relies on the user filling the frame. Risk: a landscape site in a
   portrait frame is letterboxed, and the 448 square-resize then distorts it vs the landscape master.
2. **Centre-square crop** - assumes the card fills the frame; still weak for landscape sites.
3. **Classical card-detect + rectify** (the `rectify_card` approach, ported to Kotlin) - crops to the card's
   own bounds and orientation before embedding. This is what the 73/79 was measured with. It is **not** the
   deferred learned detector; it is the classical contour rectifier already validated on desktop.

Recommendation: measure (1) and (2) on-device first (they may suffice given the "fill the frame" instruction
and are near-free), and fall back to (3) if the sites/landscape number regresses. Orientation (portrait vs
landscape, and rotated captures) rides on this: (3) resolves it via the detected card aspect; (1)/(2) need a
rotation strategy (do NOT reuse confidence-selected rotation-TTA - it manufactured false locks in Spike R).
This must be resolved and measured before the native build is trusted.

## 5. Reuse / remove / new

**Reuse unchanged:** `VisualMatcher` + int8 model + fp16 index + bundled assets; `RecognitionCard` sheet +
printing picker; `Norm`/`Fuzzy`/`Matcher` (as the OCR refiner and `cardByName`); `ScannerHaptics`; the Gilt
Impression recipe + shared reveal clock; `CandidatePanel` chassis; QR handling; permission prompt.

**Remove (live-lock era):** the guide frame + `GuideGeometry` UI geometry; the live OCR lock loop
(`Phase.SEARCHING/DETECTING`, `StabilityGate`, the breathing frame); the Rev 5.1 `VisualFallback` offer pill
+ `VisualState` escalation machine (visual is now primary, not an opt-in fallback); the "freeze OCR while a
result shows" workaround (snapshot has no stream to freeze); the `missStreak` offer trigger.

**New:** a shutter-driven capture (freeze the current frame on tap - the analyzer's `armCapture` copy hook
already does the capture-a-frame part; the trigger moves from auto to the shutter); the `SnapState` machine
(Ready/Capturing/Identifying/Result/Shortlist/Empty) replacing `Phase`+`VisualState`; the S3 fusion; and the
framing/crop decision from S4.

## 6. Latency budget + stop-conditions (revised from Rev 5.1)

The per-frame <=30ms contract is retired (owner-approved architecture change). The new budget is
snapshot-shaped:

- **Ready** does zero heavy work (QR only, as today). Shutter press to frozen still <= 80ms perceived.
- **Snapshot-to-result p95** (freeze -> embed + OCR + fuse -> reveal starts): target **<= 1.5s warm /
  <= 2.5s first-use** on the Pixel 9 Pro XL, measured across the tester fleet before a budget is frozen.
- **Accuracy** (calibrated, S3): sites resolve to a correct single Result >= the owner-agreed bar; **zero
  false auto-confirms** on the dev slice; correct card in the Shortlist top-5 >= 80% on OCR-miss + sites.
- Cold init, peak memory, R8/minified behaviour, and the **signed-release arm64 APK delta vs the 80MB
  ceiling** (debug is 108MB; a reduced ORT build is the likely lever) all still owed - unchanged from the
  Spike-R exit criteria.
- Accessibility (companion doc S6): TalkBack, reduced motion, 48dp targets, zero-image - all ship gates.

## 7. Migration from Rev 5.1

Rev 5.1 is built but uncommitted. Rev 6 **simplifies** it: the inference core, assets, candidate UI, and
sheet wiring carry over; the escalation trigger + `VisualState` + `VisualFallback` pill are deleted in favour
of the shutter + `SnapState`. Net less code. Nothing from Rev 5.1 needs to ship first.

## 8. Self-critique + ask to Codex

**Self-critique.** Risks: (a) the frameless crop/orientation question (S4) could dent the validated accuracy
and is unmeasured; (b) losing hands-free auto-lock is a real UX change for the common standard-card case
(mitigated by OCR-confirm making those instant); (c) threshold calibration on n=33 is thin until the sealed
set exists; (d) this is the third architecture in this effort - the risk now is re-building rather than
shipping.

**Ask to Codex (the point of this revision): return the LEANEST buildable path, not the richest.**
1. Confirm pure-snapshot + the S3 fusion as the right shape, or a simpler one.
2. Resolve S4: is whole-frame / centre-crop good enough to try first, or must the classical rectifier port
   be in the MVP? What is the minimum that protects the sites accuracy?
3. Name every over-engineering risk here and cut it - assume we will be tempted to add detectors, rotation
   heuristics, and threshold machinery we do not yet need.
4. Give a concrete "good enough, ship" condition (a stop, not another gate), extending the Rev 5.1 one.
5. Confirm the migration deletes more than it adds.
