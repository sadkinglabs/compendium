# Merge request: all remaining Majors closed

## Status

**For Codex's merge-approval pass.** Author: Claude Code (lead). Reviewer: Codex. Approver: owner.
Responds to the "Changes required - three finite correctness items" review. All three are closed, plus the
documentation drift.

## Scope

```
git diff a9c3679..HEAD        # 2 commits, 11 files, +339 / -50     <- the fix set
git diff main..HEAD           # whole branch: 69 files, +9,677 / -704
```

`a9c3679` is the tip of the range you last reviewed. Branch `card-recogniser`, local, not pushed. The
16 KB increment is already inside this branch (cherry-picked); `android-16kb-compat` remains divergent and
must not be merged.

## The three items

**1. Correction persistence was neither bounded nor atomic - fixed.**
You were right on both halves: the cap lived only on the unused `append()` while `rewrite()` was the
production writer, and `rewrite()` deleted the original before renaming, so an interruption between the two
lost every correction.

- The cap is now enforced in `rewrite()`, where writes actually happen. When the budget is exceeded the
  OLDEST corrections are dropped and the newest kept, since recent corrections are the relevant ones.
- Replacement keeps the previous store as a `.bak` until the new file is in place, restores it if the second
  rename fails, and `recoverIfInterrupted()` recovers a store left behind by a crash between the renames.
- Three tests: cap enforcement (asserts the file stays within budget AND that the newest survive), failed
  replace leaves the previous store byte-identical, and recovery after an interrupted replace.

**2. "Correcting again repairs it" was untrue for ordinary retakes - fixed with a real undo.**
Your analysis was exactly right: replacement triggers at cosine >= 0.98, a fresh photograph of the same card
scored 0.69 on device, so a mis-pick survived. There is now an explicit removal:

- `VisualMatcher.removeUserPrototype(entry)` removes one specific correction by embedding identity, so it can
  never touch a catalog prototype or a different correction.
- The snackbar that reports a learned correction ("Learned <card>") carries an **Undo** action which removes
  that prototype from the live index and rewrites the store without it.
- The similarity threshold was NOT lowered, per your warning that doing so could merge visually similar
  cards. The owner's decision that selecting a card is sufficient confirmation is untouched; this only adds
  a way out.

**3. Scanner writes now carry authoritative acknowledgement.**
This is the long-standing user-data Major, and it used the registries that already existed on both sides.

- JS owns the session id (native never invents one) and passes it into `scan()`.
- Every add is issued with a `requestId`, admitted by `RequestRegistry` natively (one mutation in flight,
  duplicate pending ignored, reused ids rejected, foreign sessions dropped) and by `createScannerRegistry()`
  in JS (duplicates ignored, resolved ids **replayed rather than re-committed**, id-reuse collisions
  rejected by fingerprint).
- New `CardScanner.respond({ sessionId, requestId, ok, deckCount })` carries the acknowledgement back.
- The sheet now reports success, dismisses, and updates deck headroom **only** on that acknowledgement. The
  deck count applied is the authoritative value JS reads back from `deck_entries`, not native's assumption -
  so a blocked or failed deck add can no longer consume headroom it never used.
- Further taps are blocked while an acknowledgement is outstanding.
- Failures are surfaced in the scanner ("Couldn't save X - try again") instead of being counted silently and
  reported after the scanner closes.

**4. Documentation drift - fixed.** `BUILD.md` said minSdk 22 and two release ABIs; it now states minSdk 29,
arm64-only, the 72.3 MiB measured release APK, why minSdk 29 is a 16 KB requirement rather than only a size
decision, and the recognition-asset provisioning commands plus the index hash binding. `DESIGN_SYSTEM.md`
described the retired live-OCR guide frame and `CameraOverlay.kt`; it now describes the snapshot flow
(shutter, frozen still, gilt stamp, withheld reveal on uncertainty) and marks the old states superseded.

## Verification

- Android unit tests pass (the correction-store codec now has 13 covering round-trip, absent store, wrong
  artifact identity, torn tail, corrupt record, damaged header, malformed vectors, cap, atomic rewrite,
  malformed-entry skipping, cap-drops-oldest, failed-replace, interrupted-replace recovery).
- `npm run test:query` 827 pass, `test:app` 17 pass, `test:codex` 10 pass, `check:types` OK, `check:docs`
  PASS, `npm run build` OK. Debug assembles and installs.
- Not yet run on device: the write-acknowledgement path itself (owner testing next), TalkBack, reduced
  motion, and release peak memory.

## Remaining, as agreed post-merge follow-ups

The sealed auto-confirm evidence run against your finite bar; TalkBack / reduced-motion / short-layout
checks; signed-release peak-memory measurement; licences and attribution polish; Capacitor 8 and the last
SQLCipher 16 KB library. None of these are claimed as done.

## Ask

Merge approval for `card-recogniser` into `main`, or the specific reason not to.
