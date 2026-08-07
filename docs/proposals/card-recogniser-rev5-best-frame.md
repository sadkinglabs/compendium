# Rev 5 (proposed): best-frame visual escalation, not per-frame embedding

## Status

**Proposal revision for Codex review.** Author: Claude Code (lead). Reviewer: Codex (principal / independent).
Approver: owner. Revises [`card-recogniser-embedding.md`](./card-recogniser-embedding.md). Evidence base:
[`card-recogniser-gate1-findings.md`](./card-recogniser-gate1-findings.md) (model selection) and
[`card-recogniser-spike-r-report.md`](./card-recogniser-spike-r-report.md) (runtime, incl. the Codex
"changes required" disposition). Classification: **High-risk** (architecture change + native inference).

This revision is deliberately short. It changes ONE thing and fences the scope, precisely because this effort
is at risk of an over-engineering loop. The concrete ask to Codex (§7) is to make it leaner, not richer.

---

## Rev 5.1 (AUTHORITATIVE) - Codex "changes required, narrow" applied; direction approved

Codex approved the architecture and required a narrow tightening. Rev 5.1 supersedes §2-§4 and §7 of Rev 5
where they differ. It is even leaner than Rev 5: **guided snapshot escalation** (the user is the best-frame
selector), not automatic best-frame selection.

**Why leaner:** Rev 5 claimed crop stability was "already available". It is not - `StabilityGate` measures
repeated OCR *identity*, not card geometry or image quality, so when OCR fails there is NO stability signal.
Building one would mean a tracker/detector - exactly the loop we are avoiding.

1. **Trigger (user-tapped).** No automatic escalation. After sustained unsuccessful OCR scanning, a quiet
   **"Try visual match"** action appears. The user aligns the card in the existing guide and taps; we capture
   the next upright guide crop and run DINO once. Removes tracking, best-frame scoring, presence detection,
   auto-debounce.

2. **Frame ownership + result authority (minimal contract).** Three local states:
   **Scanning -> VisualRunning -> VisualCandidates**. On tap: pause normal analysis; copy ONE guide crop owned
   by the inference job (never touch the analyzer's recycled bitmap); allow only one job; a request token
   discards late results; Back cancels and resumes OCR; Activity/ViewModel teardown cancels; failure resumes
   OCR and offers Search by name. **One coroutine Job + token - no new reducer, coordinator, or protocol.**

3. **Two sequential decisions (un-conflated).** (1) User picks the card IDENTITY from up to five distinct-card
   visual suggestions; (2) the EXISTING printing picker runs ONLY after identity is confirmed. MVP **cuts
   algorithmic OCR/DINO fusion** - OCR already failed, so present DINO's five candidates text-first and let the
   human be the precision layer. Include "None of these", "Search by name", "Try another photo". **No visual
   result auto-locks or writes anything.**

4. **Performance invariant (corrected).** Drop the inaccurate "per-frame <=30ms" claim - production already
   throttles OCR to a single in-flight analyzer admitted at most ~every 350ms, and ~30ms total OCR is
   unmeasured. Real invariant: **existing OCR cadence/behaviour must not regress, and visual inference does
   ZERO work during normal scanning** - it runs only after an explicit tap. Measure the visual path separately
   as **tap-to-suggestions** (crop prep + lazy model/session init + inference + ranking).

### Lean MVP (only this)

Existing OCR scanner unchanged; a quiet "Try visual match" fallback after sustained failure; tap freezes and
captures the guide crop and pauses OCR; one DINO inference; a text-first list of up to five identities
(thumbnails optional, must degrade cleanly); user confirms one -> existing result/printing flow;
Back/cancel/failure/"None of these" -> OCR or Search by name; model/session loaded **lazily**, retained only
for the scanner Activity lifetime. **Not in scope:** confidence bands, learned fusion, auto-retry, crop
scoring, tracking, detectors, ANN indexes, telemetry.

### "Good enough, stop" (freeze before build; ship when ALL hold, then stop tuning)

- correct identity in top-5 for **>=80%** of the predefined real-capture OCR-miss slice;
- **zero** automatic visual locks and zero writes before explicit confirmation;
- tap-to-suggestions **warm p95 <=1.5s** (Pixel 9 Pro XL), **first-use <=2.5s**, one agreed previous-gen arm64
  device usable without ANR/OOM;
- 20 capture/cancel/background cycles: no crash, stale result, or runaway inference;
- Back, TalkBack, reduced motion, zero-image mode, Search by name all work;
- signed-release APK delta + peak memory disclosed and within an owner-recorded ceiling.

If 448px misses latency, allow ONE controlled 336px comparison; if that also misses, **defer the feature** or
separately consider a smaller model - do NOT start another open-ended bake-off.

### Retain / cut (for the eventual cleanup + commits, per Codex)

Retain after cleanup: the three evidence/proposal docs; `build_artifact.py` once resolution + checkpoint
source/hash are pinned; ONE consolidated accuracy/parity evaluator; ONE Android integration/benchmark harness
measuring the final path; the `.venv` docs exclusion + its test (own commit). Do NOT commit as production
infra: `.claude/`, `check_clip.py`, `diag.py`, `fm.py`, `retr.py`, `train_clip.py`, the old default-quant
`spike_r.py`, the current latency harness unchanged, or the ORT test dep inside an unrelated docs commit.
Commit in groups (not one batch): (1) corrected proposal/evidence docs; (2) the check-docs fix + test;
(3) reproducible final artifact/eval tooling after owner approval; (4) native implementation + dependency only
after this architecture is approved.

Rev 5's §2-§4 and §7 below are retained for history; where they differ, Rev 5.1 wins.

---

## 1. What Spike R falsified

The approved architecture assumed the visual recogniser runs **per frame** under a preprocess+inference
**p95 <= 30ms** budget (line 931). That budget was written for a lightweight CNN. The Gate-1 winner is a
ViT (DINOv2-small) at **~660ms/embed** on a flagship - it cannot run per-frame. But it recovers exactly the
recall OCR misses (glare, foil, sites) and its top-1 (73%) matches fp32. So the model is right; the *loop* was
wrong.

## 2. The revision: best-frame escalation

Keep the existing scanner as-is; add one bounded escalation step.

- **Per-frame layer (unchanged, stays <=30ms):** the current native scanner - presence/geometry + OCR strip
  extraction + frame selection - keeps running at camera cadence and remains the PRIMARY recogniser. When OCR
  locks (its ~100%-precise cases), we are done; the visual engine never runs.
- **Escalation trigger (new, cheap):** when OCR does NOT lock **and** the crop is geometrically stable across a
  few frames (stability is already available from the scanner), capture that one best frame.
- **One-shot visual (new):** run DINOv2-small **once** on the captured crop (off the hot path, async, with a
  brief "reading..." affordance). Produce top-k card candidates.
- **Fuse + present:** combine the top-k with any weak OCR signal and the embedding margin. Because top-1 is
  73% / top-5 79%, the visual result is a **candidate list for confirmation / printing-picker**, not a silent
  auto-lock - which is exactly the owner-accepted "couldn't identify -> here are the likely cards" UX.
- **Temporal evidence = crop stability**, NOT repeated DINO inference. One escalation per stable presentation,
  debounced.

This preserves the proposal's recall-not-precision spine: OCR stays the precise primary; the visual engine is
the recall rescue, now triggered only when OCR fails, once.

## 3. Revised latency contract

Split the single per-frame budget into two:

- **Per-frame cadence work: p95 <= 30ms** (unchanged) - presence/geometry/OCR only. DINO is NOT in this path.
- **One-shot escalation: bounded, off-cadence** - target an owner-approved ceiling (e.g. <= ~1.5s on the
  reference device) with a visible progress affordance; this is a deliberate user-initiated-feel moment, not a
  frame-rate number. Debounced to one inference per stable presentation.

## 4. Scope fence (anti-over-engineering) - explicitly OUT of this revision

- **No learned card detector** - reuse the existing guide crop / scanner geometry. (Deferred; only if measured
  live-crop failures justify it.)
- **No per-frame or continuous embedding.**
- **No board / multi-card scan** - that stays a separate future Phase B.
- **No parallel runtimes** - one runtime, one precision (per-channel int8). No fp16/LiteRT/ORT dual maintenance
  unless a measurement forces it.
- **No elaborate index infra** - brute-force cosine over the prototype set is trivially fast; no ANN/vocab-tree.
- **No training / fine-tuning** - ship the cold model; the real-scan flywheel is a separate later track.

## 5. Unchanged from the approved proposal

Governance, offline-first bundling, the three-way governed splits + unseen holdout, frozen Wilson statistics,
digest binding, the printing-picker for art-identical/foil collisions, and the gate cadence all stand. Size is
owner-controlled (the ~8MB budget was withdrawn). What changes is only §2-§3.

## 6. Open items - gated to "only if the owner approves this direction"

Not to be built speculatively. In rough dependency order: (a) Android accuracy parity (real captures through
ORT 1.20, vs desktop canonical); (b) a 224/336/448 resolution sweep evaluated through the *fused* policy (do
NOT jump to 518 - it moves against latency); (c) the one-shot escalation's real exit criteria (cold-init, its
own p95, memory, R8, signed-release APK delta, likely via a reduced ORT build); (d) per-fleet one-shot latency
(mid-range devices, not just the flagship); (e) a fresh sealed set built after the pipeline freezes.

## 7. Self-critique + the ask to Codex

**Self-critique.** Risks: (a) the escalation trigger could mis-fire or feel laggy; (b) a 73%-top-1 candidate
list may frustrate if presented poorly; (c) "off the hot path, async" hides real engineering (threading,
cancellation, lifecycle); (d) this whole recognition effort has already consumed many spikes - the failure
mode now is *gold-plating the escalation* into a mini-framework.

**Ask to Codex - and this is the point of the revision:** pressure-test the architecture, but your primary
job is to return the **LEANEST implementation that clears the bar**, not the most complete one. Specifically:

1. Confirm or correct the best-frame escalation as the right shape, or propose a simpler one.
2. Define the **MVP**: the minimum that ships a useful "point at a site/foil OCR can't read -> get the right
   card in a short list" experience. What is the smallest set of moving parts?
3. Name every place this plan risks an **over-engineering loop** and cut it - including anything in §2-§6 above
   that is premature. Assume we will be tempted to add detectors, fusion heuristics, and infra we do not yet
   need; tell us what to NOT build.
4. Give a concrete **"good enough, stop" condition** - the measurable bar at which we ship rather than keep
   spiking. We need a stop, not another gate.
5. Flag anything already gold-plated in the current diagnostic code / docs that we should delete or defer.
