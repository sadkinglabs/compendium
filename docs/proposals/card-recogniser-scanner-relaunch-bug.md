# Bug handoff: the scanner cannot be launched a second time

## Status

**RESOLVED 2026-08-09** (kept as the post-mortem). Root cause: an earlier bulk text edit of mine, replacing
everything between two markers to extract the correction-store codec, silently deleted
`ScannerActivity.onDestroy` - the only place the session terminal was sent. It compiled because an override
is optional and nothing referenced it, so every test suite stayed green while no session could ever
terminate. Fixed by restoring `onDestroy` and finishing the Activity from `onStop`, since navigating away by
gesture only stops it. Codex independently reproduced Home / Back / relaunch / exit / third launch on the
Pixel and confirmed the retained call now releases each time, and its forensic diff of the offending commit
found NO other accidental deletion - the only other removal was the intended codec extraction.

The lasting lesson is in the method, not the bug: I diagnosed from the outside three times and each fix
targeted a different layer. Instrumenting the lifecycle and reading the log found it immediately - and my
"the Activity is never destroyed" reading was itself wrong, because the method no longer existed at all.
Verify that instrumentation is present in the build before trusting what its absence appears to prove.

**Original report, retained.** Author: Claude Code (lead). Reporter: owner (device). Branch
`card-recogniser`, local. I have attempted three fixes and each targeted the wrong layer; the instrumented
evidence below finally localises it, and I am handing over rather than guessing a fourth time.

## Symptom

Reproducible on a Pixel 9 Pro XL, every time:

1. Open the scanner from any pillar - works, scans, recognises.
2. Exit the scanner.
3. Open it again - fails immediately with the "Scanner error" toast.

Recovery requires killing the app. It is a hard blocker: the scanner is effectively single-use per app
launch.

## Evidence (instrumented build, logcat `ScannerVisual`)

```
08-09 11:33:25.812  I ScannerVisual: activity onCreate
08-09 11:33:30.674  I ScannerVisual: shutter->result 2448ms  atlantean_fate=0.89, ...
08-09 11:33:51.477  I ScannerVisual: scan REJECTED as busy; activityAlive=true
```

**`activity onDestroy` never appears**, 21 seconds after the user exited. The instrumentation logs
`onCreate`, `onDestroy`, `terminal <action> handler=<bool>`, and `resolveOnce -> releasing active`; only
`onCreate` fires.

Chain of consequence, all confirmed by the absence of those lines:

- `ScannerActivity.onDestroy` does not run, so `sendTerminal("cancelled")` never runs;
- so `ScannerChannel.onTerminal` is never invoked, so `CardScannerPlugin.resolveOnce` never runs;
- so `active` is never cleared AND the retained `scan()` PluginCall never resolves (JS confirms this: the
  Capacitor log shows no `removeListener` after the first `scan`, i.e. `launchScanner` is still awaiting);
- so the second `scan()` is rejected with `code: "busy"`.

The stale-session reclaim I added is working correctly and is not the problem: it refuses precisely because
`ScannerActivity.isAlive()` is genuinely `true`.

**So: the scanner Activity is not being destroyed when the user leaves it.** Everything downstream is a
symptom.

## What I tried, and why each was wrong

1. **A write-acknowledgement timeout** - correct in itself (a stuck `writing` flag disabled the close
   control and swallowed Back), but not this. This reproduction involves no write at all.
2. **Fixing the self-cancelling success snackbar** - a real bug (a `LaunchedEffect` keyed on state it
   cleared first), but unrelated to relaunching.
3. **Reclaiming a stale `active` flag** - correct defensive behaviour, but it deliberately does not fire
   while an Activity is alive, which is exactly this case.

All three are committed and worth keeping; none addresses the actual fault.

## Suspects, in the order I would check them

1. **The exit gesture never calls `finish()`.** The gold X is wired `onClick = onClose` -> `finish()` and is
   only disabled while a write is pending (not the case here). If the owner exits with system Back, the
   `BackHandler` chain in `ScannerScreen.kt` may consume it: handlers exist for a pending write, a shown
   sheet, an open search, and a non-Ready snapshot state. If any of those stays enabled - for example a
   `SnapState` that never returns to `Ready` after a result, or `writing` stuck true - Back is swallowed
   for ever and the user can only leave via Home, which backgrounds rather than finishes. I did not
   establish which gesture the owner used; that is the first thing to determine.
2. **Task/launch configuration.** `ScannerActivity` is started with a plain `startActivity` from the plugin.
   Worth checking its manifest entry (launchMode, taskAffinity, `noHistory`, `excludeFromRecents`) - if it
   lives in its own task, returning to the WebView may background it indefinitely.
3. **Nothing finishes it on backgrounding.** There is no `onStop`/`onPause` handling that finishes a
   scanner the user has visibly left, so a Home press strands it alive by design.

## Suggested direction (not implemented, for Codex to rule on)

The robust fix is probably to stop making liveness the sole authority and instead make the SESSION
terminate deterministically: finish the Activity when it is no longer visible (`onStop` with
`isChangingConfigurations == false`), and/or treat a backgrounded scanner as terminable by the plugin. A
narrower alternative is to guarantee Back always reaches the Activity by making every `BackHandler`
strictly hierarchical with a final always-available exit.

I would rather have that decided than patch it a fourth time.

## Reproduction and instrumentation

Instrumented logging is committed on this branch (`ScannerVisual` tag). To reproduce:

```
npm run android && (cd android && ./gradlew :app:installDebug)
adb logcat -c && adb logcat -s ScannerVisual:I
# open scanner, exit it, open again
```

Ask the owner which gesture they use to exit - the X, system Back, Home, or a swipe - as the suspects above
diverge on that answer.
