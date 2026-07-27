# Diagnostic: scanner recognition reveal "snaps" instead of animating

**Branch:** `scanner-reveal-redesign` (uncommitted working tree; diff is vs `main`)
**For:** Codex — please diagnose from the diff.
**Author:** Claude Code

## Symptom (owner, device-observed on build 205, a Pixel-class device)

- Reduce motion is **OFF** (app setting) and OS animation scales are **1.0** (verified via
  `adb settings get global {animator,transition,window}_animation_scale`). Installed `versionCode`
  is **205** (verified via `dumpsys package`). So it is not a stale APK, not the OS animation
  scale, and not the app reduce-motion toggle.
- The **building/culminating haptic works** ("I feel the haptic building pulse which is great").
- The owner "sees motion" generally, BUT:
  - the **card name reveal does not play** — "the title just snaps into the new state" (no rise /
    scale-in as intended);
  - the **frame reveal has looked the same for the last two builds (204 & 205)** despite tuning
    changes to the press/rebound and the gold bloom in 205.

So: the haptic path (fire-and-forget on `lockEvent`) animates/fires; the **visual reveal appears to
jump to its end state** rather than playing its 0→0.8s timeline.

## How the reveal is wired (current implementation)

Native Compose, `ScannerActivity` (NOT the WebView). Recognition pipeline unchanged.

- **State flows** (`ScannerViewModel`): `phase` (SEARCHING/DETECTING), `sheet: Recognition?`
  (sticky), `lockEvent: Int` (bumped once per accepted card). On a lock, `onResult` sets
  `_sheet.value = rec` and `_lockEvent.value++` synchronously.
- **`ScannerScreen`** collects all three with `collectAsStateWithLifecycle` and passes
  `phase, lockEvent, sheet` into `CameraOverlay(phase, lockEvent, rec, reduceMotion)`.
- **Haptics** (`ScannerActivity`): `LaunchedEffect(lockEvent){ culminate() }` and
  `LaunchedEffect(phase){ tick() }` — independent of the visual timeline. These are confirmed
  working by the owner.
- **The visual timeline** lives entirely in `CameraOverlay` and is driven by ONE clock
  (`scanner/ui/CameraOverlay.kt`):

  ```kotlin
  val motion = !reduceMotion
  val t: Float = if (motion) {
      val clock = remember { Animatable(0f) }
      LaunchedEffect(lockEvent) {
          if (lockEvent > 0) { clock.snapTo(0f); clock.animateTo(0.8f, tween(800)) }
      }
      clock.value                 // <-- the only per-frame state read that should drive the reveal
  } else 0f
  ```

  `t` is then consumed in two places, both re-derived from `t` each recomposition:
  1. the `Canvas(Modifier.fillMaxSize()) { … }` draw lambda (frame press `scaleV`, `core` alpha,
     `haloW/haloA`, `inkA`, `sheenA`, `bossA`), inside a `scale(scaleV, scaleV, pivot=g.center){…}`;
  2. `StatusText(phase, rec, t, motion, accent, …)` — the card name uses
     `graphicsLayer { alpha = nameA; s = 0.90f + 0.10f*nameA; scaleX = s; scaleY = s }` where
     `nameA = Settle.transform(seg(t, 0.09f, 0.26f))`.

  `seg(t,a,b) = ((t-a)/(b-a)).coerceIn(0,1)`; easings `Press`, `PressBack (.2,1.5,.4,1)`,
  `Settle (.4,0,.2,1)`, `Decay (.33,0,.67,1)`.

### Intended vs what 205 tuned
- name: `scaleX/Y 0.90→1.0` + alpha over `t∈[0.09,0.26]` (≈90–260ms of the 800ms clock).
- press: `scaleV 1.06→1.0` via `PressBack` over `t∈[0,0.16]` (a slight rebound below 1.0).
- halo: alpha `0→0.34`, width `3→14dp` over `t∈[0.09,0.26]`, then decay to `0.10/5dp` by `t=0.82`.

## Hypotheses (ranked) — for Codex to confirm/refute against the diff

**H1 — Tuning too subtle; the timeline IS playing but is imperceptible (leading).**
- name: a **10%** scale (0.90→1.0) over **~170ms** while simultaneously fading in reads as a plain
  fade / "snap", not a rise. 
- frame: `core` alpha ramps `0→92%` over the first **90ms** (a fast fade-in) and the 6% press
  rebound is *masked by* that simultaneous fade — so it "just appears".
- halo: a translucent gold stroke peaking at **34% alpha** over a live camera feed is easy to miss;
  the 204→205 delta (0.28→0.34, 11→14dp) is within perceptual noise → "same as last version".
- If H1 is the cause, there is no bug — the fix is bolder values (bigger/longer name rise, an
  explicit hold, a stronger flare), which the owner pre-authorised.

**H2 — Per-frame invalidation not happening; `t` effectively jumps to end (wiring).**
- The reveal depends on `clock.value` (a snapshot read) recomposing `CameraOverlay` every frame,
  re-supplying a new draw lambda to `Canvas`'s `drawBehind` and a new `t` to `StatusText`. If
  something breaks that chain (e.g. the draw lambda not re-capturing `t`, or the composable being
  skipped), intermediate frames never render and only the final state shows → "snap", while the
  `lockEvent`-keyed haptic still fires. Codex: verify the `clock.value → CameraOverlay recomposition
  → Canvas redraw / StatusText recomposition` chain, and whether the `scale{}`/`graphicsLayer` block
  actually re-executes per animation frame.

**H3 — `reduceMotion` is being passed `true` at `scan()` despite the app toggle being off.**
- Source: `src/cardScanner.js` sends `reduceMotion = document.body.classList.contains('reduce-motion')`.
  If the body class is set for any reason at scan-launch time, `motion=false` snaps ALL visuals
  while the haptic (unaffected) still fires — which matches the symptom. The owner reports the
  toggle is off, but Codex should confirm the class isn't set by some other path.

## On-device disambiguation (cheap, separates H1 from H2/H3)
1. While pointing at a card **before it locks**, does the **violet recognising frame visibly
   breathe** (pulse alpha, ~1.1s)? That breath is the same motion path (an `Animatable`/infinite
   transition read per frame). **Breath animating ⇒ per-frame rendering works ⇒ H2 unlikely ⇒ H1.**
2. On lock, does the **bottom result panel slide up**, or snap? (Also motion-gated:
   `RecognitionSheet` `reveal.animateTo(tween(240))`.) **Slides ⇒ `reduceMotion=false` ⇒ H3 out.**

If both animate, the reveal timeline is almost certainly running and the issue is H1 (tuning).

## Files in the diff (vs `main`, all uncommitted on the branch)
```
scanner/ui/CameraOverlay.kt      — the reveal timeline + states (primary suspect)
scanner/ui/ScannerScreen.kt      — passes phase/lockEvent/rec/reduceMotion; close button
scanner/ui/RecognitionSheet.kt   — sheet reveal (de-sprung); fonts
scanner/ui/ScannerTheme.kt       — font families + typography
scanner/ScannerActivity.kt       — haptics (tick + culminate); reduceMotion snapshot
scanner/ScannerHaptics.kt        — tick + culminate
scanner/ScannerChannel.kt, CardScannerPlugin.kt, ScannerViewModel.kt, model/ScanModels.kt
                                 — reduceMotion + hardened ownership handoff
src/cardScanner.js               — reduceMotion + owned/ownedKnown handoff
DESIGN_SYSTEM.md                 — the scanner-reveal §6 entry
```

## Resolution (Codex diagnosed; implemented in Rev 7)
Codex confirmed **H1 (substantially), refuted H2** (`clock.value` at line 115 does subscribe
composition), and found H3 unlikely. Root causes were choreography, not a broken clock: the title
only changed opacity+scale (no vertical movement) over ~170ms; the frame's largest size change
happened while it was still fading in; and the tray ran an independent 240ms clock that overpowered
the frame/title beats. Rev 7 replaces title scale with a 14dp vertical translation, removes frame
scaling (impact via brightness + stroke weight + haptic sync), unifies overlay + tray on one
`ScannerScreen` clock (tray arrives late), freezes the recognised identity, and removes ownership
from the ceremony. See `scanner-reveal-redesign.md` §3.15. Device verification of the full sequence
(motion, reduced motion, TalkBack, incorrect-match recovery, short screens, dropped frames) remains
the outstanding gate.

## Claude's leaning
H1 (tuning too subtle), because the haptic and "some motion" are present and the OS/app motion
switches are confirmed off. The name at 10%/170ms and the halo at ≤34% alpha are plausibly
sub-perceptual over a camera feed. But the "snap" wording for the title is strong enough that H2
deserves an explicit check of the `t → Canvas/StatusText` per-frame render chain before I just
crank the numbers.
