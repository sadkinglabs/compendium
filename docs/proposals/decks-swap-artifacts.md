# Proposal + Codex review brief: the Decks view-swap paint artifacts

## Status and classification

Draft, for Codex adversarial review before any further implementation. Risk: Standard
(rendering boundary only, no data writes) - but the defect has now SURVIVED four shipped
fixes, so the bar here is "convince us the mechanism is fully understood", not "try the
next patch". Owner directive: stop iterating, get review.

## The symptoms (owner-reported, device: Pixel, Android 16, WebView Chromium)

1. **The streak**: a 1-2 frame bright vertical line at the same x on every Library deck
   card, when card art arrives.
2. **The broken image**: the My Deck hero briefly shows the browser's broken-image glyph
   (device-captured, rec6 f016) before painting correctly one frame later.
3. **The decisive new constraint (owner, 2026-08-14 evening)**: both artifacts appear
   ONLY on the within-pillar Library ⇄ My Deck swap. Cross-pillar entry (Home → Decks)
   does not show them.

## Measured evidence (frame forensics, builds 232-234)

Method: `adb shell screenrecord --bugreport`, frames extracted with ffmpeg, a transient
vertical-seam detector (`scripts/diag/seam.mjs`: per-column vertical-edge energy, spike =
local `E(x)` over neighbourhood median AND over the same column in the previous frame)
plus a timeline differ (`scripts/diag/timeline.mjs`). Recordings + extracted frames live
in the session scratchpad; the scripts are committed and reproducible on any capture.

- **Build 232** (fade-only entrances + hide-until-load ArtImg): seam present. Detector:
  transient spike `x=1010-1013`, magnitude ~47k, exactly one frame before the card art
  paints (rec2 f054 line, f055 art). The line: brightness 155 vs 10 background, spans
  each card's full height (three runs of ~270px matching the card boxes), dimmed by the
  card's overlay gradient - so it is drawn UNDER `.dli-hero-grad`, i.e. by the hero img
  subtree itself.
- **Geometry**: card hero img = 64% of a 1271px card = 813px wide, left edge x≈495.
  495 + 512 (Chromium raster tile width) = 1007 ≈ the measured 1010-1013. The historical
  "tile boundary 1024 minus slide offset" numerology from builds 226-231 was a
  coincidence pointing at the same sum. **The seam is the img layer's own raster-tile
  boundary, flashing on the img's first-raster frame** - a texture-edge bleed where an
  uploaded tile meets a not-yet-uploaded one.
- **Build 233** (pre-raster at opacity 0.02 + will-change, compositor-only flip): seam
  STILL present, stronger (spike ~77k, rec3 f049). Conclusion: tile priorities defeat
  low-opacity pre-rastering - the flip still outruns tile upload.
- **Build 234** (reveal via 160ms compositor opacity TRANSITION, cold loads only):
  **library-entry seam measurably GONE** - detector over the full entry window shows
  only card-border paints (x=36/1308 family), nothing at 1010-1013 (rec4). The My Deck
  hero error-glyph was also captured on this build (rec6 f016; recovers f017): the
  hero's first candidate src transiently errors - the Cap-8 boot-race lesson ("onError
  lies") resurfacing - and the paint-once fast path made the failing img visible from
  mount, so the glyph painted.
- **Owner retest on 234**: artifacts still visible, now constrained to the
  within-pillar swap. Consistent with the measurements: my entry-window captures were
  cross-pillar or first-population events; the warm within-pillar swap takes the
  paint-once INSTANT path, which skips the seam-masking fade - first raster of a fresh
  img element at full opacity → seam. The glyph shares the same root: visibility granted
  by key history rather than element state.

## Why the within-pillar swap is special (answers the owner's question - yes, it IS something)

- Cross-pillar: the whole pillar remounts under a 300ms entrance fade (fade-only since
  build 232), so first-raster happens under an alpha ramp; and art keys are usually
  already warm AND still composited from the previous frame? No - the subtree is new,
  but the entrance fade masks it. Either way: measured clean.
- Within-pillar: `DecksPager` swaps `view === 'library' ? <Library/> : <Dashboard/>` -
  a synchronous subtree replacement with NO covering animation. Every ArtImg remounts as
  a fresh element (fresh layer, fresh tiles) while its KEY is warm, so the current code
  reveals instantly at full opacity. All the artifact windows concentrate exactly there.

## Current state

- `main`: ArtImg at its build-232 state (hide-until-load + paint-once instant reveal).
  The build-234 fade-reveal code was measured but never committed to main - it exists
  only in this branch's commit `1c6dad5`, combined with the lifecycle fix. Device builds
  233/234 were made from then-uncommitted working trees; this branch is the reproducible
  source of the current best-known state.
- Branch `decks-swap-artifacts`, commit `1c6dad5` (UNVERIFIED on device): visibility
  strictly follows the element's own load lifecycle - an img that has not fired `load`
  for its current src is never visible (kills the glyph); warm reveals remain instant
  after load (so the warm-reveal seam is NOT addressed by this commit alone).

## Candidate designs for review (pick one, or name what we missed)

A. **Universal micro-fade**: every reveal - warm included - goes through a compositor
   opacity transition; warm uses a short one (~90ms) so re-entries feel instant. One
   mechanism, at the art boundary, covers every mount site app-wide. Cost: a barely
   perceptible fade on warm re-entries, softening the art-first-paint "instant warm
   paint" contract. This is the author's preferred option: it is the only approach so
   far with a MEASURED kill of the seam (234's cold path), extended to the one path
   measured dirty.
B. **Keep both Decks views mounted**, toggle with `visibility`/`content-visibility`
   instead of unmount: img elements and their rastered layers survive the swap, so
   nothing re-rasters at all; scroll positions persist as a bonus. Cost: double DOM held
   in the pillar, edit-mode/effect semantics need auditing, and it fixes only Decks -
   any other surface that remounts warm art keeps the defect.
C. **Per-element "has ever rastered" registry** (element-identity paint-once instead of
   key-identity): closest to current semantics, but element identity does not survive
   remounts, so it degenerates to (A) in practice.
D. Something we have not seen. The review should specifically probe: is the transient
   hero src error (rec6) fully explained by the boot-race lesson, or is there a second
   defect in the candidate chain worth chasing (it recovers in one frame, but WHY does a
   just-loaded local file error at all)?

## Requested disposition

- Verdict on the mechanism characterization (img-layer tile boundary + key-vs-element
  visibility), given the measurements above.
- A choice among A/B/C/D with reasoning, sized to this app (offline-first WebView,
  Manuscript design language, art everywhere).
- Review of branch commit `1c6dad5` (the glyph fix) - correct, incomplete, or wrong.
- Findings as Blocking / Should-fix / Nit with file:line where applicable.

## Reproduction harness

1. `npm run android && (cd android && ./gradlew assembleRelease)` + install.
2. `adb shell screenrecord --bugreport /sdcard/rec.mp4` (device-side `nohup`; the
   capture link drops ~12s in, so start recording just before the interaction).
3. Drive: cold-launch → Decks; or Library → tap deck card (the dirty path).
4. `ffmpeg -i rec.mp4 -vsync 0 frames/f%03d.png`, then
   `node scripts/diag/seam.mjs frames` - a transient spike at x≈1010 on a card, or at
   img-left-edge + 512 generally, is the seam. `node scripts/diag/timeline.mjs` (expects
   `tl/` at 1/8 scale) locates events.
