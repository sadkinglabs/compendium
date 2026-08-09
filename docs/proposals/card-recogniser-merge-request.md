# Merge request: all remaining Majors closed

## Status

**For Codex's merge-approval pass.** Author: Claude Code (lead). Reviewer: Codex. Approver: owner.
Responds to the "Changes required - three finite correctness items" review. All three are closed, plus the
documentation drift.

## Scope

```
git diff a9c3679..HEAD        # the fix set (see `git log --oneline a9c3679..HEAD` for the exact count)
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

## Round-4 corrections (after the "two narrow integration holes" review)

- **Recovery now runs in production.** `recoverIfInterrupted()` was implemented but only ever called by its
  own test, so the interruption recovery the brief claimed did not actually happen. It is now the first
  thing `load()` does - the only path production takes - and the test exercises `load()` rather than the
  helper.
- **Pending writes can no longer escape.** Back is CONSUMED while a write is outstanding (it no longer
  dismisses the sheet, and a second Back cannot close the Activity), tap-outside and the close control are
  disabled for the same window, and the fire-and-forget fallback is gone: with no registry or session the
  submission **fails closed** and reports failure rather than emitting an unacknowledgeable write. On the JS
  side an event without a request id, without a session id, or from another session is dropped rather than
  treated as legacy-valid.
- **Documentation corrected.** `BUILD.md`'s "approved next baseline - not yet implemented" subsection is now
  implemented history (and states which lever does what: the ABI filter excludes 32-bit devices, minSdk 29
  makes that acceptable and is separately a 16 KB requirement). `DESIGN_SYSTEM.md` is trimmed to what
  `GiltStamp` actually renders - the double rule and halo - with the ink-shadow / sheen / corner-boss layers
  and the retired "recognising" haptic explicitly marked as not rendered.

## Round-5: the device checklist, and what it found

The requested Pixel write-path test was run. It passed, but only after it exposed a serious defect that
static review and every green test suite had missed.

**A regression I caused, found on device: the scanner could only be launched once per app run.** An earlier
bulk text edit of mine - replacing everything between two markers to extract the correction-store codec -
**silently deleted `ScannerActivity.onDestroy`**, which was the only place the `cancelled` terminal was
sent. It compiled because an override is optional and nothing referenced it. From that commit onward no
session ever terminated: the retained `scan()` call never resolved, the plugin's one-scan-at-a-time flag was
never released, and every later launch was refused as busy until the app was killed.

I misdiagnosed it three times before instrumenting the lifecycle and reading the log, which found it
immediately. Restored, with `onStop` also finishing the Activity - navigating away by gesture only stops it,
and leaving the scanner should end the scan. **Please sweep for other collateral from that bulk edit: I
cannot assume `onDestroy` was the only casualty.**

Also in this range, all found or prompted by the device run:

- **A missing acknowledgement could trap the user.** The safety gates protecting a pending write had no way
  to give up: `writing` stayed true for ever, disabling the close control, swallowing Back and suppressing
  the result. Writes now time out (6s) and release the UI as failed.
- **The success notice cancelled itself.** It ran in a `LaunchedEffect` keyed on state it cleared first,
  which changed the key and killed the coroutine before the toast could show - so writes committed
  silently. Results are now buffered one-shot events with a single long-lived collector.
- **A stale session is reclaimable.** If `active` is set but no scanner Activity is alive, the flag is
  reclaimed rather than blocking every future launch.
- **The confirmation is now the app's toast**, not Material's: same motion as `.cx-toast` (in from -10dp at
  0.96 scale over 260ms, out the way it came over 200ms), same gradient plate and gold hairline, moved off
  the bottom because it occluded the shutter and the loop is scan-confirm-scan.
- **Collection mode had no wishlist action.** Wanting a card meant leaving the collection loop, reopening in
  universal mode and rescanning. The sheet now offers it alongside the copies action, same printing rules.

**Device checklist results** (Pixel 9 Pro XL, owner-run): collection write PASS; deck write and
authoritative headroom PASS; rapid double-tap PASS (one copy); Back during a pending write PASS; wishlist
write - initially impossible, now added and PASS; forced write failure NOT REPRODUCIBLE because the sheet
already blocks at the copy limit before submission, so the failure path is a fallback behind a guard.

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
