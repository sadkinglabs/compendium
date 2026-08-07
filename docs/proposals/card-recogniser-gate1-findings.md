# Gate 1 findings: cold pretrained representations show signal; no shippable model or detector is justified yet

## Status and classification

**Diagnostic findings. Codex disposition: CHANGES REQUIRED (2026-08-04).** Author: Claude Code (lead).
Reviewer: Codex (principal / independent). Approver: owner. The sections below the "Review outcome" block are
the pre-review draft, retained for history and **superseded** by it where they disagree.

## Spike R result (DINOv2-small int8, measured 2026-08-04)

Owner approved DINOv2-small, int8, accuracy-first. Full report: `card-recogniser-spike-r-report.md`.
Headline (VERIFIED on the actual deployed int8 ONNX, 448px deploy config, real ORT runtime):

- **Accuracy**: real ORT **per-channel** int8 = **73% top-1 / 79% top-5**, matching fp32 top-1 (73%) with a
  1-card top-5 drop (fp32 82%). CRITICAL: the default per-*tensor* dynamic quant collapses top-1 to 52% -
  int8 must be **per-channel, MatMul-only** (Conv -> ConvInteger is unsupported by ORT Mobile). The earlier
  "int8 lossless 70/88" was a PyTorch fake-quant approximation at 518px and is superseded by this measurement.
- **Size** (real ONNX export): int8 **24.4MB** (fp16 44.3, fp32 88.4) + ~2.4MB fp16 index + runtime
  ~= **~28MB APK delta -> APK ~50MB** (from ~23MB).
- **On-device latency** (ONNX Runtime 1.20, CPU/XNNPACK, 448px, **Pixel 9 Pro XL**): int8 **~660ms/embed**
  (median 657), faster than fp32 (~1.1s) and smaller. Flagship device - mid-range testers (S23, Pixel 8) will
  be slower; measure the fleet before a latency budget. Headroom: NNAPI/GPU delegate, threads, resolution.
- **Licence**: Apache-2.0. **Runtime**: ONNX Runtime Mobile (approved proposal assumed LiteRT for a CNN; ORT
  ran the ViT out of the box). ORT dep is androidTest-only, not production.

Net: DINOv2-small per-channel int8 is a deployable, licence-clean visual matcher whose top-1 (73%) matches
fp32 and edges OCR (~70%). Top-5 at 448px is 79% (vs 88% at 518px fp32) - a resolution/latency tradeoff to
settle in the build phase. Learned detector deferred. Open: per-fleet latency, resolution vs top-5, fused
OCR+visual policy (margins/OOD/false-lock), rebuild sealed set.

## Review outcome and corrections (post-Codex, authoritative)

Codex's review was accepted. The proven, useful conclusion is narrow: **synthetic-only metric-learning recipes
regress badly, while cold pretrained representations show a real retrieval signal.** The evidence does **not**
select a shippable model, and does **not** justify a learned detector. Corrections to the draft below:

- **Sealed corpus v1 is CONSUMED.** All eval scripts selected every physical image regardless of split, so the
  20 "sealed" images were used to choose crop/model/architecture. Sealed v1 is burned. **All 33 photos are now
  development data.** A fresh sealed set is collected only after the engine, preprocessing and fusion policy are
  frozen. (Also: Samsung S23 appears in both splits, violating device isolation - the split-policy contract must
  be resolved by the owner: whole-device isolation, or session isolation + device stratification.)
- **MobileCLIP-S2 is NOT a shipping candidate** - RETRACTED. It is diagnostic teacher/reference only: Apple's
  `apple-amlr` licence is research-only and excludes product development, and at 35.7M params (~145MB fp32) it
  violates the approved ~8MB budget (embedding proposal §, "MobileCLIP research licences" excluded). DINOv2-small
  is Apache-2.0 but ~21M params, also over budget.
- **The 3% model was NOT trained from scratch** - RETRACTED. MobileNetV4 was `pretrained=True`; the 3% shows
  synthetic-only end-to-end fine-tuning *destroyed* useful pretrained geometry, not that a compact backbone lacks
  a prior. The MobileCLIP head *underfit* (synth 1/30), so "specialised to synthetic" is also RETRACTED.
- **The pivotal missing experiment, now run: cold pretrained MobileNetV4-Conv-S, no trained head** - the only
  budget-and-licence-clean backbone. Result on the (now-dev) 33: **33% top-1 / 39% top-5**, and **42% / 55% with
  rotation TTA** (fair handling; the neural encoders are not rotation-invariant, so the shared SIFT-oriented crop
  had been depressing them). Far above the 3% trained version - confirming the destroyed-geometry reading - but
  below OCR's ~70% and below the reference models.
- **Orientation fairness:** the draft's 61%/70% for MobileCLIP/DINOv2 used the orientation-preserving crop that
  helps rotation-invariant SIFT and penalises neural encoders; they are understated. Re-run with explicit
  orientation handling before any comparison is treated as final.
- **top-5 = 88% "makes the architecture work" is UNPROVEN** - RETRACTED as a claim. It was never run through the
  actual OCR fusion policy; there are no fused-lock, margin, or OOD false-lock numbers yet.
- **A learned detector stays deferred** - the measured crop gain came from a classical contour rectifier on SIFT;
  no learned detector was tested, and adding one breaches the approved Stage-A "no detector" boundary.

### Cold-backbone bake-off (the corrected, licence/size-aware picture)

| Cold engine (no fine-tune) | top-1 | top-5 | Shippable? |
|---|---|---|---|
| MobileNetV4-Conv-S, rotation-fair | 42% | 55% | Yes - small + licence clean, but weak |
| SIFT + RANSAC (classical) | 58% | 58% | reference; heavy over 4k masters, foil-weak |
| **DINOv2-small** | 70%* | 88%* | **Yes if owner accepts APK size** - Apache-2.0, ~21M params |
| MobileCLIP-S2 | 61%* | 88%* | Only as owner legal-risk call - Apple `apple-amlr` research licence |

*orientation-understated. **CORRECTION (2026-08-04):** the "~8MB budget" that previously ruled DINOv2 out was
author-proposed, not owner-set, and is withdrawn - the owner controls APK size. With size treated as an owner
dial, **DINOv2-small (Apache-2.0, licence-clean, ~70/88) is a genuine shipping candidate that beats OCR (~70%)
at top-1 and dominates at top-5**, at the cost of a larger APK (~21M params; measure the real int8/fp16 export
delta in Spike R). MobileCLIP-S2 (61/88) stays teacher-only unless the owner accepts Apple's research-licence
risk. So "no shippable model" was WRONG - it was an artifact of a constraint the owner never bought into.
Synthetic-only *training* is still exhausted as a lever, but a strong **cold** licence-clean model is on the
table.

### Recommended next move

1. **Re-run the bake-off fairly and settle the size question.** DINOv2-small's 70/88 was orientation-understated;
   re-measure it (and MobileNetV4) with explicit orientation handling, and measure the real int8/fp16 export
   size, so the owner weighs a concrete accuracy-vs-APK-size tradeoff. A licence-clean cold model that beats OCR
   may already exist (DINOv2-small); that would justify Spike R (export/quant), NOT more synthetic training.
2. **Freeze synthetic-only metric training.** It regresses; further tuning is not the path. (A real-photo
   training tier remains the route to a *smaller* strong model later, if size becomes a concern.)
3. **Owner decisions needed:** (a) the acceptable APK-size ceiling (the model choice depends on it); (b) whether
   to accept Apple's research licence for MobileCLIP or stay licence-clean with DINOv2; (c) the split-policy
   contract (whole-device vs session + stratification) for the *next* sealed set.

Learned detector still deferred (breaches approved Stage-A boundary). Sealed set still rebuilt after freeze.

Everything below is the pre-review draft, superseded where it disagrees with the above.

---

**Diagnostic findings + recommended architecture revision. Awaiting Codex adversarial review and owner
decision.** Author: Claude Code (lead). Reviewer: Codex (principal / independent). Approver: owner.

This document reports the empirical result of Gate 1 of the card recogniser and recommends a change to the
**primary visual engine** named in [`card-recogniser-embedding.md`](./card-recogniser-embedding.md). It does
**not** change that proposal's governance, gate structure, statistics method, data splits, or digest binding -
only which model produces the embedding, and the addition of a learned card-detector front end.

These are **spike / diagnostic** numbers on the current governed corpus (n = 33 physical photos, 7 cards). They
are point estimates, not the sealed Gate-1 evaluation, and carry wide confidence intervals. They are decisive
enough to choose a direction; they are not the final acceptance evidence. The sealed eval still runs under the
frozen Wilson method (embedding proposal §5.4.5) once the engine is chosen and built.

## What the approved proposal assumed, and what Gate 1 found

The approved Rev 4 proposal named the primary engine as a **from-scratch learned embedding** (MobileNetV4-Conv-S
+ ArcFace, PTQ-int8), trained **only on synthetic augmentations** of the clean card masters, with OCR as the
recall-recovery refiner. Gate 1 built exactly that and evaluated it, then benchmarked alternatives on the same
corpus with the same front-end crop.

**Headline result** (top-1 / top-5, nearest-prototype retrieval, card-grain, same hardened crop applied to every
engine, n = 33):

| Engine | top-1 | top-5 | Notes |
|---|---|---|---|
| MobileNetV4-Conv-S + ArcFace, **synthetic-trained** (the proposal's engine) | 3% | 3% | seen 4%, unseen 0% |
| SIFT + Lowe ratio + RANSAC homography, **training-free** | 58% | 58% | foil-weak; decisive inlier separation |
| **MobileCLIP-S2, foundation, COLD (zero fine-tune)** | **61%** | **88%** | the on-device candidate |
| DINOv2-small, foundation, COLD | 70% | 88% | reference upper bound; larger model |
| MobileCLIP-S2 + **synthetic-only** projection-head fine-tune | 0% | 0% | regressed below cold - see §Fine-tune |

## Interpretation

1. **The proposal's engine failed, and we know why.** The synthetic-trained encoder reaches train-acc 1.000 and
   recognises clean masters 30/30 and synthetic augmentations 30/30, but scores 3% on real photos: real captures
   embed out of distribution (max cosine to any prototype ~0.3 where a true match is ~0.5+). It is a textbook
   synthetic-to-real domain gap. Training on synthetic-only, with a tiny model that has no real-world prior, is
   the root cause.

2. **The images are matchable.** Training-free SIFT gets 58% cold with a clean confidence signal (true matches
   36-159 geometric inliers, false matches cap ~17-33). So the 3% was never a data problem - it was the wrong
   engine.

3. **A pretrained foundation embedding wins, used COLD.** MobileCLIP-S2 with zero fine-tuning beats SIFT at top-1
   and dominates at top-5 (88%), and it survives foils that break SIFT (Vanishment all-foil 3/4, "harshest foil"
   Great Drowning 4/5) because a semantic embedding is not destroyed by holographic glare the way local features
   are. DINOv2-small shows there is headroom above MobileCLIP if we can afford a larger model.

4. **top-5 = 88% cold is the number that makes the product architecture work.** The correct card is in the visual
   engine's top-5 candidates 88% of the time with no training. That is exactly the owner's design: the visual
   engine proposes a short list, OCR reads the title to narrow/confirm, and the printing-picker resolves
   art-identical or foil collisions. Visual proposes, OCR refines.

5. **Cropping is the single biggest lever.** A hardened card-quad detector (see §Front end) took SIFT from 45% to
   58% and recovered the foils. Every engine above assumes a card-filling crop; the residual misses are dominated
   by detector failures and by genuine near-twin site art (Simple Village vs Common Village), the latter being
   precisely where the OCR refiner earns its place.

## The fine-tune result, and its caveat

A light fine-tune of MobileCLIP-S2 on our cards **regressed it to 0%**. The diagnostic (`check_clip.py`) is
unambiguous about the mechanism: with the fine-tuned head, clean masters retrieve 30/30, synthetic augmentations
1/30, real photos 0/33. The head **sharpened** clean-master separation while **shattering** invariance to any
perturbation - it specialised to the augmented-synthetic feature distribution and made real photos out of
distribution to itself. Fine-tuning on synthetic-only erodes exactly the real-world prior that is the foundation
model's entire value.

**Honest caveat for review.** This fine-tune under-invested: it froze the backbone, used a linear projection
head, trained with an aggressive augmentation set, and the head underfit (24% train-acc on 1000 classes). So the
proven claim is "**this quick synthetic-only fine-tune regresses**," not "fine-tuning is impossible." The likely
correct reading is that **productive fine-tuning needs real scans** (PokeScope reached 95% by fine-tuning CLIP
with data from 50k users), and that the governed tester-photo intake is the training-data flywheel that makes it
possible later. Whether a fairer synthetic fine-tune (LoRA / partial unfreeze at low LR, gentler augmentation, a
stronger head) could beat cold is an open question for Codex (§Open questions).

## Recommended architecture revision

Keep everything in the approved proposal except the engine identity. Specifically:

- **Primary matcher: a pretrained foundation embedding used COLD, on-device** - MobileCLIP-S2 as the deployable
  candidate (chosen over DINOv2-small because it is built for phones), bundled in the APK, matched by brute-force
  cosine over the multi-prototype index. No training in v1.
- **Front end: a learned card-quad detector** (the role PokeScope fills with YOLOv8). Cropping is the biggest
  lever and the assumed input for every engine. In-product this is easier than the free tester stills because the
  live camera + guide overlay roughly frames the card and the quad can be tracked across frames.
- **Refiner: OCR (existing ML Kit path) reads the title to narrow/confirm the visual top-5**, plus the
  printing-picker for art-identical and foil collisions. top-5 = 88% cold makes this the product-shaping fact.
- **Fine-tuning deferred** until a real-scan corpus exists via the governed intake; v1 ships cold.

This preserves the proposal's recall-not-precision framing, off-ramp logic, three-way governed splits + unseen
holdout, frozen Wilson statistics, digest binding, and gate cadence. What changes: the engine is a cold
foundation embedding instead of a synthetic-trained one, and a learned detector is added to the pipeline.

## Threats to validity (read before trusting the numbers)

- **n = 33, 7 cards.** Point estimates only; no CIs reported here. Not the sealed eval. Grow the corpus.
- **Uniform crop, imperfect detector.** The same `rectify_card` is applied to all engines (fair), but it misfires
  on ~4/33; some misses are crop failures, not engine failures. A better detector lifts every engine.
- **Fine-tune underfit** (see caveat above) - do not over-read "0%" as "fine-tuning is doomed."
- **On-device feasibility unproven.** MobileCLIP-S2 latency, its reparameterised blocks under NNAPI/ANE, int8
  accuracy retention, and cosine over a ~3-4k-vector index on a phone are all Spike-R questions, not yet measured.
  Desktop SIFT here is diagnostic only; it is not the on-device design.
- **Model licensing not yet cleared.** Bundling MobileCLIP-S2 (Apple) or DINOv2 (Meta) weights in the APK must be
  checked for redistribution terms; this is an owner risk decision, consistent with how legal is handled in the
  embedding proposal, not an engineering opinion.

## Open questions for Codex

1. **Was the fine-tune a fair test?** The head underfit at 24% train-acc; backbone frozen; aggressive aug. Is the
   "synthetic-only regresses" conclusion robust, or would LoRA / partial unfreeze at low LR / gentler aug / a
   better head plausibly beat cold? If there is a fair synthetic recipe that helps, we want it.
2. **Is the eval methodology clean?** Uniform crop, prototype index over all masters including held-out
   identities, card-grain top-1/top-5. Any leakage or asymmetry favouring one engine?
3. **On-device feasibility.** MobileCLIP-S2 int8 latency and accuracy, reparam blocks under NNAPI, and
   ~4k-vector cosine budget on target hardware. Is S2 the right size, or is a distilled/smaller variant needed?
4. **Finesse without real data.** Test-time augmentation, multi-crop pooling, MobileCLIP+DINO ensembling,
   re-ranking the visual top-5 with SIFT inliers or OCR - which are worth building for v1?
5. **The real-scan flywheel.** How to design the governed intake so collected scans become fine-tuning data that
   lifts the model over time without contaminating the sealed eval.

## Reproducibility

Branch `card-recogniser` (nothing committed to main, nothing pushed). Scripts under `scripts/recog/train/`:

- `eval.py` - `rectify_card` hardened card-quad detector (shared front end) + the synthetic-encoder eval.
- `diag.py` - encoder probes (clean / synth / real rank).
- `retr.py` - training-free SIFT + RANSAC retrieval.
- `fm.py` - cold foundation-embedding retrieval (`--model MobileCLIP-S2` | `dinov2-s`).
- `train_clip.py` - the frozen-backbone synthetic fine-tune (features cached to `_out/clip_feats_v*.pt`).
- `check_clip.py` - the fine-tuned-head clean/synth/real diagnostic.

Environment: Python 3.12, torch 2.11.0+cu128 (RTX 5070 Laptop), open_clip_torch 3.3.0 (MobileCLIP-S2 /
`datacompdr`), timm DINOv2 `vit_small_patch14_dinov2.lvd142m`. Gotcha recorded: fp16 autocast on the frozen
forward produced ~101/27900 non-finite feature rows - sanitize (nan_to_num + drop) before head training or the
loss is NaN from step 1.
