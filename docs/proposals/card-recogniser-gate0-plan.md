# Gate 0 plan: governed data intake + OCR baseline (card recogniser)

**Classification:** Standard (offline dev tooling + one debug-flagged on-device harness; no production
runtime, no schema, no user data, no dependencies beyond dev tooling). **Author:** Claude Code (lead).
**Approver:** owner. **Status:** plan of record under the APPROVED
[`card-recogniser-embedding.md`](./card-recogniser-embedding.md) (Codex-approved 2026-08-03; owner
authorised Gate 0). This concretises that proposal's §5.4 (governed data) and §8 (Gate 0) into a
buildable spec plus a tester-facing intake contract. **No model training, download, or artifacts.**

---

## 1. What Gate 0 produces, and why the data must be right

Gate 0 produces ONE number: the OCR **hard-slice recall / precision / false-lock baseline** on
labelled **physical-card** photos. That number sets the encoder go/no-go (off-ramp: OCR >= 90% overall
AND >= 80% on sites-under-stress / off-axis, zero false locks - owner-accepted) and, if we proceed, the
per-slice bars the encoder must beat. The baseline is only meaningful on the medium we ship for, so
**screen captures are dev-only and never count toward Gate 0's number or the sealed set** (proposal
§5.4.4). This is a **data gate, not a code gate**: the tooling below can be built now, but the number
waits on labelled physical photos (the inbound tester contributions).

## 2. Intake contract (tester-facing - what makes a photo usable)

Each submitted photo needs, alongside the image:

- **Identity (required):** which card it is - the card name (a card_id if known). Printing is optional
  (matching is card-grain); "printing unknown" is fine.
- **Medium (required):** `physical` (counts toward the baseline + sealed set) or `screen` (dev-only,
  excluded from gating evidence).
- **Condition tags:** `foil|nonfoil`; `sleeve: none|matte|glossy`; `angle: flat|10-25deg|>25deg`;
  `light: normal|dim|glare`; `blur: y|n`; `class: spell|site`; sites also `edge: left|right`.
- **Capture context:** a `sessionId` (one shoot/sitting) and `device` (model). Splits are isolated by
  session AND device, so this is load-bearing, not bookkeeping.
- **Consent / provenance (required):** tester handle; consent that the image may be used to **evaluate
  and train** the recogniser (per the owner legal determination, proposal §16); confirmation the tester
  has the right to contribute it.

**Framing:** one card per single-card photo, reasonably filling the frame, shot at natural
hand-held angles (variety is good - that is the point). Board photos are a separate Phase-B intake and
are NOT needed for Phase A. **No other people or personal information in frame.** EXIF is stripped on
our side; testers need not.

**Formats:** JPEG / PNG / WebP; short side >= ~800px; <= ~30 MP.

A one-page tester brief will be generated from this section so contributors have a checklist.

## 3. Governance (proposal §5.4.2 / §5.4.3, concretised)

- **Private governed store**, outside version control (gitignored path), never published.
- **Committed manifest** (versioned JSON), the authority over the private images: one row per image =
  `{ imageId, sha256, width, height, bytes, medium, tags[], sessionId, device, consentRef, split }`.
- **Splits assigned at intake, immutable:** `calibration` (thresholds / model selection) vs **`sealed`**
  (final evaluation) vs training-source. Sealed is isolated by **session AND device** (a session or
  device never spans splits), is **physical-only**, and is used **once per evaluation event**; any
  tuning use invalidates it and forces a new sealed version.
- **EXIF stripped on intake**; retention / deletion policy recorded; **publication default NO**; a small
  **redacted, committed fixture** (a single owner-provided, redacted image) exercises the decode path in
  CI without publishing the governed set.
- **Validation fails closed:** path containment, format allowlist, dimension + byte-size bounds, bounded
  decode memory, and required metadata + `consentRef` present. A submission missing any of these is
  rejected with a per-image reason, not silently coerced.

## 4. Tooling to build (offline + one on-device harness; no cards, no model)

1. **`scripts/recog/intake.mjs`** (offline, Node): validates a submission folder against §2/§3, strips
   EXIF, computes `sha256`, deterministically assigns the split under the session/device isolation rule,
   and writes/updates the manifest. Emits a per-image accept/reject report. Idempotent + re-runnable.
2. **Manifest schema + validator test:** the redacted committed fixture proves decode + the fail-closed
   bounds; a schema check keeps manifest rows well-formed.
3. **On-device OCR-replay runner:** a debug-flagged harness (same discipline as `captureCorpus`) that
   loads each governed **physical** image, runs it through the **real** `StripExtractor` + matcher (the
   exact production OCR path, so the baseline reflects shipping behaviour), records the outcome, and
   emits the **per-slice recall / precision / false-lock table** with the frozen statistics method
   (one-sided Wilson, proposal §5.4.5) and execution-bound `RunSpec` provenance. OCR is native (ML Kit),
   so this runs on-device; images are pushed, scored, results pulled - mirroring the existing
   capture/replay loop, and reusing the `ReplayHarness` reporting shape.

No production runtime changes; everything is dev scripts plus a debug-flagged harness that is inert in
release.

## 5. Sequencing (what unblocks what)

1. **Now, no cards needed:** share the §2 intake contract with testers; build `intake.mjs` + manifest +
   validator; build the OCR-replay runner.
2. **As labelled physical photos arrive:** run them through intake into the governed store, then run the
   OCR-replay runner to produce the baseline table.
3. **Gate 0 decision:** the number either triggers the OCR-only off-ramp or sets the encoder's bars.
   Gate 1 (model training) begins only if the off-ramp does not trigger, and only under the recorded
   legal determination (proposal §16).

## 6. Guardrails

No model training / download / artifacts; no dependency beyond dev tooling; no Gradle / production /
schema / user-data change; board intake and Phase B deferred. **Branching:** the recogniser is a new
feature and should ride its **own branch**, separate from the in-flight `scanner-phase2a` scope (whose
unrelated working-tree changes, e.g. the reveal-flash fix, must not be swept in). The branch is created
at the point the first tooling code is written, not for this plan.
