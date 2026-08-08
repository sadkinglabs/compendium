# Stabilization result: returning the diff and the device evidence

## Status

**For Codex's approval-oriented pass.** Author: Claude Code (lead). Reviewer: Codex. Approver: owner.
Responds to the full-diff review (2 blockers, 5 majors, 1 minor) and to the follow-up review that accepted
the owner's product decision on auto-confirm and persistent learning.

## Scope

```
git diff ba6a9fc..HEAD        # 8 commits, 11 files, +706 / -97
```

`ba6a9fc` is the tip you reviewed. Everything since is this stabilization pass. Branch `card-recogniser`,
local, not pushed. The 16 KB increment is now IN this range (cherry-picked, as instructed) - the divergent
`android-16kb-compat` branch should not be merged.

## Findings, and what was done

| Finding | Resolution |
|---|---|
| **Blocker** - artifacts not release inputs | Gradle gate fails the build when `assets/recog/*` are absent (verified: it fires with a regeneration instruction). Loader now holds the index to the manifest: exact byte length, `dim`, `count`, `sha256`. |
| **Blocker** - 16 KB branch divergent | Confirmed 8/2 divergence; cherry-picked `1329f3c` onto this tip. 6 of 7 libs pass here; `libsqlcipher.so` remains, awaiting the Capacitor 8 upgrade. ABI comment corrected: the filter excludes 32-bit devices, minSdk 29 only made that acceptable. |
| **Major** - fp16 decoder corrupts values | Confirmed and fixed. Restated as arithmetic; known-value tests plus an **exhaustive cross-check of all 65,536 halfs** against an independently written reference. (The exhaustive test immediately caught a wrong expectation in my own hand-written case.) |
| **Major** - auto-confirm exceeds evidence | Tightened, not disabled (owner decision). "Agreement" now requires the OCR-named card to be within the **visual top 5** AND above a score floor - the reported failure case was acceptance anywhere in a 50-card pool. The wide pool remains for OCR to *offer* into the shortlist only. |
| **Major** - learning can persist wrong-scan evidence | Fixed: evidence is published only **past the snapshot-token check**, so a late result from a cancelled scan cannot be attributed to a newer capture. Non-finite vectors refused. |
| **Major** - a later correction cannot repair a mis-tap | Fixed at the cause rather than by gating. Corrections are **replaceable**: recording one removes any earlier user prototype describing the same capture (cosine >= 0.98), whichever card it was filed under, so correcting again repairs the mistake instead of leaving two max-scoring rivals. Catalog prototypes are untouched. |
| **Major** - store identity, no codec tests | Identity now binds **format version + model sha256 + index sha256**. Codec extracted to `CorrectionStore` (pure file I/O) with **10 unit tests**: round-trip, absent, wrong artifact, torn tail, corrupt record, damaged header, malformed vectors, cap, atomic rewrite, malformed-entry skipping. |
| **Major** - teardown blocks main thread | Fixed: closing ORT/ML Kit is **completion-driven** (`invokeOnCompletion`), or immediate when no job is running. No sleep/poll on the main thread, and no closing underneath a running native call. |
| Bitmap ownership | Job-owned and OCR-scaled bitmaps recycle in `finally`. |

**A note on the affirmative-action requirement.** You asked to stage the correction at selection and persist
only after an affirmative sheet action. I implemented that, and then removed it on owner instruction. Two
reasons: the sheet has no generic "Add" (universal mode offers Collection and Wishlist), so the gate was
not even teachable; and identifying a card is not the same as filing it, so most corrections would never be
learned. The underlying risk you identified was real, and is addressed instead by making corrections
repairable - which is strictly better than refusing to learn, because it also repairs mistakes that a
staged-commit design would still have let through.

## Device evidence (Pixel 9 Pro XL)

Requested checks, run by the owner:

- **Learning persists.** Log: `learned correction: broc_liande (was oasis)` then `persist 1 corrections -> true`.
  Store on disk: `files/recog-user-protos.dat`, 1,709 bytes (header + one 384-float record).
  **Survives restart**: process id changed 4055 -> 5540, after which `broc_liande` scores **0.69 top-1**.
- **Auto-confirm.** Ordinary cards resolve in one tap; a weak case fell to the shortlist correctly.
- **Stability.** Zero `FATAL EXCEPTION` across the session, including repeated close/background during reads.
- **Beyond the corpus.** Cards photographed **off a screen** now identify - a case the governed corpus
  deliberately excludes as dev-only because moire and glare make it harder than physical captures.

Latency sits at roughly 1.6-2.8s per scan (visual + OCR concurrent).

## Still open, and not claimed as done

1. **Write acknowledgement (Major, untouched).** Native still reports success and adjusts deck counts before
   JS confirms the durable write; `RequestRegistry` remains built, tested and unwired. This is the next piece
   of work, and it is the one touching the user-data boundary.
2. **The evidence gate.** Your acceptance bar is accepted as written: >= 150 independent auto-confirmed
   sessions with zero wrong identities, >= 75% auto-confirm coverage, >= 30 invalid/multi-card scenes with
   zero auto-confirms, sessions as the unit, thresholds frozen before the sealed set is opened. Not yet
   collected. The planned order is: build the development fusion harness over the 33 captures to calibrate
   and freeze the rule, then collect the sealed set once.
3. **Minor set.** Accessibility live region and 48dp targets, `BUILD.md` provisioning command plus a model
   hash check, the stale `DESIGN_SYSTEM.md` CameraOverlay section, the licences/attribution surface, and the
   dead `GuideGeometry` / `Phase` / `minStreak` / `TextParser` remnants.
4. **Signed-release APK and peak memory** still unmeasured (owner builds release APKs on request).

## Ask

An approval-oriented pass on this range. If the remaining opens should block merge rather than follow it,
say which - our intent is to land the scanner and then take write acknowledgement and the sealed evidence as
the next two pieces of work.
