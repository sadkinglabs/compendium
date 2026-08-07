# Spike R report: DINOv2-small int8 export, quantization, and on-device runtime

## Status

**For Codex adversarial review.** Author: Claude Code (lead). Reviewer: Codex (principal / independent).
Approver: owner. Companion to [`card-recogniser-gate1-findings.md`](./card-recogniser-gate1-findings.md)
(the model-selection evidence) and the approved [`card-recogniser-embedding.md`](./card-recogniser-embedding.md)
(§8 Spike R defines the runtime/export spike). Owner authorised DINOv2-small, target int8, accuracy-first.

Spike R answers one question the model-selection bake-off could not: **is DINOv2-small actually deployable
on-device offline - real export, real quantization accuracy, real latency - within the app's constraints?**
It does NOT re-decide the model or prove the product architecture; those are Gate-1 findings and the (still
unbuilt) fused policy.

## Codex disposition: CHANGES REQUIRED (2026-08-04) - accepted

Codex's review was accepted in full; it falsified the "deployable" headline. Corrections:

- **BLOCKER - fails the approved latency contract.** The proposal (§Gate-2, line 931) requires total
  preprocess + inference **p95 <= 30ms at production cadence** - a PER-FRAME budget written for a lightweight
  CNN/OCR recogniser. A 660ms ViT cannot live in that loop; it fails by ~22x. **The corrected conclusion is:
  "runnable on Android; UNSUITABLE for the approved per-frame architecture at the measured configuration."**
  This is a *successful* spike result: it proved 448px DINO must NOT run on every admitted frame. Path forward
  needs owner approval - either meet the per-frame contract (a smaller backbone) OR revise the architecture and
  latency budget to a **best-frame escalation** model (run DINO ONCE on a stable/best frame, not per-frame; see
  below). Both are proposal revisions.
- **MAJOR - execution provider mislabeled.** The harness uses default `SessionOptions` and never registers
  XNNPACK, so results are **ORT CPU EP**, not "CPU/XNNPACK". Relabeled throughout. A separate XNNPACK session
  (and NNAPI/GPU) must be measured before any ORT-vs-LiteRT decision.
- **MAJOR - Android accuracy parity NOT established.** 73/79 is desktop ORT 1.28; Android runs ORT 1.20 and the
  latency harness discards outputs (zero tensor). No captured-card fixtures were run through Android and
  compared to the desktop canonical (embedding cosine + top-k parity). Until that runs, 73/79 is not proven for
  the shipping path.
- **MAJOR - artifact reproducibility (FIXED).** `build_artifact.py` is now the single command producing the
  exact per-channel, MatMul-only 448 int8 artifact and writing `_out/artifact.json` (full sha256s, quant
  settings, tool versions). Previously a clean rerun via `spike_r.py`'s default `quantize_dynamic` would have
  silently produced the known-bad per-tensor (52% top-1) model.
- **MAJOR - Spike-R exit criteria still UNMEASURED.** Cold-init, p95 (incl. preprocess), peak memory, R8/minified
  behaviour, and the **real signed-release APK delta** are not measured; ~28MB is an ESTIMATE and the current
  dep is the full prebuilt ORT Android AAR (a reduced/custom build is likely needed). **Spike R is therefore
  INCOMPLETE against its own frozen exit criteria** (proposal lines 925-938). Also: the proposal's remaining
  "~8MB" statements must be reconciled with the owner's withdrawal of that budget.
- **MINOR - docs-gate regression test** for the `.venv` exclusion: added.

### Proposed architecture revision (owner decision): best-frame visual escalation

Codex's counterproposal, which this report endorses as the way to reconcile the 660ms reality with the
product: keep cheap presence/geometry/OCR at camera cadence; when the crop is stable OR OCR stays uncertain,
capture the best frame and run DINO **once** (not per-frame), fuse its top-k with OCR + confidence/margin,
and use cross-frame crop stability for temporal evidence instead of repeated DINO inference. This preserves
DINO's glare/foil/OCR-failure rescue while making a ~0.6-1s one-shot potentially acceptable. If one-shot is
still too slow on the lower fleet, evaluate a smaller embedding backbone. This revises the approved per-frame
architecture and the 30ms budget, so it needs an owner-approved proposal revision before Gate 2.

## Result summary

| Dimension | Result | Notes |
|---|---|---|
| Accuracy (real ORT int8, 448px) | **73% top-1 / 79% top-5** (n=33 dev) | matches fp32 top-1 (73%); top-5 fp32 = 82% |
| Quantization scheme | **per-channel, MatMul-only** dynamic int8 | per-tensor collapses top-1 to 52%; Conv must stay fp32 |
| Model size (real ONNX) | int8 **24.4MB** | fp16 44.3MB, fp32 88.4MB |
| APK delta (est.) | **~28MB** -> APK ~50MB | int8 model + ~2.4MB fp16 384-d index + ORT runtime |
| On-device latency | **~660ms/embed** (median 657) | ORT 1.20 **CPU EP** (XNNPACK NOT registered), 448px, Pixel 9 Pro XL |
| Licence | Apache-2.0 | clean to bundle |
| Runtime | ONNX Runtime Mobile | proposal assumed LiteRT (CNN); ORT ran the ViT as-is |

**Bottom line (corrected per Codex):** DINOv2-small per-channel int8 is **runnable on Android and licence-clean**,
with desktop top-1 (73%) matching fp32 - **but at 660ms it is UNSUITABLE for the approved per-frame <=30ms
architecture.** It only becomes viable under a best-frame escalation architecture (run DINO once, not per-frame)
that requires an owner-approved proposal revision. Android accuracy parity, the full exit criteria (p95, memory,
cold-init, R8, real APK delta), and the fused policy remain unmeasured. See the disposition block above.

## Method

1. **Export**: timm `vit_small_patch14_dinov2.lvd142m` (pretrained, `num_classes=0`, `dynamic_img_size=True`,
   `img_size=448`) -> ONNX opset 17, legacy exporter (`dynamo=False`; the dynamo path crashed on a Windows
   console-encoding quirk, not a model issue).
2. **Quantize**: ORT `quantize_dynamic(weight_type=QInt8, op_types_to_quantize=['MatMul'], per_channel=True)`.
   MatMul-only because quantizing the patch-embed Conv produces `ConvInteger`, unsupported by ORT Mobile's
   CPU EP (verified failure on-device). fp16 via `onnxconverter_common.float16` also produced (a `Cast`
   type-mismatch bug in that export path - fixable, not pursued since int8 is smaller/faster).
3. **Accuracy verification** (`onnx_verify.py`): one prototype index over all 3,083 masters embedded by the
   **torch fp32** model at 448px (this is the realistic deployment: the index is precomputed offline at full
   quality and shipped; only the query runs int8 on-device). Each of the 33 dev queries embedded BOTH by torch
   fp32 and by the **real ORT int8 ONNX**, identical preprocessing (448 square resize, ImageNet mean/std),
   card-grain nearest-prototype top-1/top-5.
4. **On-device latency** (`RecogEmbedLatencyTest.kt`, androidTest-only): push the int8 ONNX to the app-owned
   dir, ORT `OrtSession` CPU, 448x448 input, 2 warmup + 6 timed runs, report mean/median. Latency is
   input-independent for a fixed-shape dense ViT, so a zero tensor is a valid probe.

## Corrections made during the spike (disclosed for review)

- **"int8 lossless 70/88" was wrong.** That was a PyTorch per-channel fake-quant at 518px. The *actual* ORT
  int8 was measured only after building `onnx_verify.py`. At the 448 deploy config the honest fp32 baseline is
  73/82, and int8 depends entirely on the scheme (below).
- **Per-tensor vs per-channel matters enormously.** ORT `quantize_dynamic` defaults to per-tensor, which gave
  **52% top-1** (21-point drop). `per_channel=True` recovered **73% top-1** at the same size (24.4MB) and
  latency (~660ms). The shipped artifact must be per-channel.
- **Resolution changes top-5.** 518px (timm crop) gave 88% top-5 in Gate-1; 448px square gives 79%. 448 has
  higher top-1 and lower latency but lower top-5. Since the product plan uses the visual top-k as the OCR
  refiner's candidate list, top-5 recall is load-bearing - this tradeoff is unresolved.

## Threats to validity

- **n = 33 dev photos, 7 cards.** Point estimates, wide CIs, no sealed set (sealed v1 consumed, see Gate-1
  findings). This is a runtime/deployability spike, not the accuracy gate. ±1 card ~= 3%.
- **Single device, flagship.** Pixel 9 Pro XL, Android 17, arm64. ~660ms is a best case; mid-range tester
  devices (S23, Pixel 8) are unmeasured and will be slower.
- **CPU only.** No NNAPI/GPU delegate tried (dynamic-int8 ViT support there is uncertain). Default ORT thread
  count. Latency headroom therefore unknown in both directions.
- **Index embedded by torch fp32, not on-device.** Realistic (offline-precomputed index), but the on-device
  index-build path (if any) and its numeric parity with desktop torch are untested.
- **Fused OCR+visual policy NOT tested.** No lock threshold, margin, OOD/false-lock, or paired ON/OFF numbers.
  Top-5 = 79% is a ceiling for a perfect refiner, not a product result.
- **Preprocessing.** Verification used square resize (no aspect-preserving crop/pad); the on-device pipeline's
  exact preprocessing must match whatever the shipped index is built with, or accuracy will drift.

## Reproducibility

Branch `card-recogniser` (nothing committed to main, nothing pushed). Env: Python 3.12, torch 2.11.0+cu128,
onnxruntime 1.28.0 + onnxruntime-android 1.20.0, timm `vit_small_patch14_dinov2.lvd142m`, opset 17.
Deployed artifact: `dinov2_s448_int8.onnx`, 24,400,820 bytes, sha256 `44770a907c13c90e...`.

- `scripts/recog/train/spike_r.py` - fp32/fp16/fake-quant-int8 accuracy + ONNX size export (desktop).
- `scripts/recog/train/onnx_verify.py` - REAL ORT int8 vs fp32 accuracy at 448 (the authoritative accuracy).
- `android/app/src/androidTest/.../scanner/RecogEmbedLatencyTest.kt` - on-device latency (ORT androidTest-only).
- `scripts/recog/train/fm.py` - the cold bake-off that selected DINOv2-small.
- Run notes / adb gotcha: Git-Bash mangles `/sdcard` paths - prefix adb calls with `MSYS_NO_PATHCONV=1`.

Not reproducible-clean yet (for Codex to note): outputs are console logs, not a single machine-readable run
report; randomness is not fully seeded (the eval is deterministic - no augmentation in the query path - but
this is not asserted); `_out/`, checkpoints, and images are gitignored and not shipped.

## Claims made / NOT made

MADE: DINOv2-small exports and runs offline on-device via ORT Mobile; per-channel int8 is 24.4MB, ~660ms on a
flagship, and preserves fp32 top-1 (73%) on the dev set; it is Apache-2.0.

NOT made: that it hits any sealed-gate bar; that mid-range latency is acceptable; that the fused OCR+visual
product works; that 448px is the final resolution; that a learned detector is justified (still deferred).

## Open questions for Codex

1. **Accuracy method** - is int8-query vs fp32-index (offline-precomputed index) the right thing to measure,
   or should the index also be int8/on-device-built for parity? Is n=33 square-resize a fair probe?
2. **Resolution** - 448 (73/79, 660ms) vs 518 (higher top-5 ~88, slower). Which optimises the *fused* system,
   and should this be swept properly before committing?
3. **Runtime** - ORT Mobile vs LiteRT for a ViT on Android (NNAPI/GPU delegate viability, int8 kernel quality,
   binary size). The approved proposal assumed LiteRT; is switching to ORT acceptable?
4. **Latency budget** - what per-device latency is acceptable for point-and-scan, and what fleet coverage do we
   need before committing (the spike used one flagship)?
5. **What must be true before a native build** - specifically the fused-policy evidence and a fresh sealed set.
