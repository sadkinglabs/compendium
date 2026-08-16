# Sheet jank scales with page element count - investigation report

Status: OPEN. Author: Claude (lead engineer). For: Codex (principal engineer / independent reviewer).
Date: 2026-08-16. Build under test: 261-263, `main`, the vaul chassis (`docs/bottom-sheet-spec.md`).

Owner report: *"in pages with lots of elements (My Collection > Sets > Arthurian Legends), the bottom sheets come up sluggishly. The more elements on a page, the worse it loads."* And separately: *"our filter sheet is the jankiest of all sheets (background elements pending too!)"*, plus *"a lot of images stuck on loading even though the phone is connected"* (Annual Fair, Arc Lightning - both Arthurian Legends).

**I am bringing this to review rather than continuing, because I have now guessed wrong three times in a row on this problem and my measurement method is confounded. I would rather have your disposition than a fourth guess.**

---

## 1. The one thing that IS measured

Android frame stats (`dumpsys gfxinfo`), 5 sheet open+close cycles per run, same device (Pixel 9 Pro XL), release build 262:

| | Arthurian Legends (~400 cards) | Dragonlord (13 cards) |
|---|---|---|
| Janky frames | **191 (20.17%)** | 13 (2.12%) |
| 50th percentile | 26ms | 14ms |
| 95th percentile | 65ms | 24ms |
| 99th percentile | 81ms | 36ms |
| **Slow UI thread frames** | **43** | **2** |

The effect is real and large, and "slow UI thread" says it is **main-thread work**, not GPU compositing. That is the only claim in this document I would defend without further evidence.

## 2. Why my subsequent numbers cannot be trusted

I then ran A/B comparisons and they were incoherent - total frames rendered swung 947 / 1386 / 1022 across supposedly identical runs.

**The confound I failed to control: card art streams from the CDN and decodes on demand.** Every run force-stops the app and re-navigates, so each run does a different amount of image fetching and decoding. That is main-thread work, it varies run to run, and it is almost certainly larger than whatever I was trying to measure. The owner's *"images stuck on loading"* report is direct evidence the art pipeline is under sustained stress during exactly these runs.

Any future measurement of this must either warm the art cache first and prove it is warm, or measure with art disabled (`localStorage['cx-no-images']`, the documented zero-image mode), or both.

## 3. What I tried, and reverted

All three were reverted; `main` carries none of them.

| Attempt | Hypothesis | Outcome |
|---|---|---|
| vaul body scroll lock | vaul sets `position:fixed` on `<body>`, forcing full-document relayout | **Refuted from source before shipping.** The code path is `if (!isSafari()) return` - it never runs on Android. |
| `modal={false}` on `Drawer.Root` | Radix's `RemoveScroll` + `aria-hidden`'s `hideOthers` invalidate style document-wide on open | **Measured no gain, arguably worse** (median 36ms vs 26ms, slow-UI 59 vs 43). Reverted rather than trade away modality for nothing. |
| `useMemo` the drill grid's ~400 tile elements | `React.memo` stops each tile re-rendering, but the parent still re-creates and reconciles 400 children when `sheetCard` changes at the Collection root | **Measured worse** (29.75% jank, median 53ms, slow-UI 126). Possibly real noise from §2 rather than a real regression - but unproven, so reverted. |

The third one still seems mechanically sound to me and may simply have been drowned in art-loading noise. It needs re-measuring under controlled conditions before being dismissed.

## 4. Candidate causes, ranked, with the evidence I have

**(a) The art pipeline, and it may explain BOTH symptoms.** A 400-card set mounts hundreds of `<img>` against one host. Browsers cap parallel connections per host (~6), so several hundred images queue; each decode lands on the main thread; and every not-yet-painted tile runs a `.cx-art-shimmer` animation, which animates `background-position` - a **paint-phase** animation, repainting every frame per visible element (`tokens.css:552-558`, and the original audit's P7 confirmed the mechanism while correcting my element counts downward via `content-visibility`). This predicts: jank proportional to element count; images that look "stuck" because they are queued behind hundreds of others; and worse jank on the sheet that sits over the most pending art. All three match the owner's reports. **This is my leading hypothesis and I have not tested it.**

**(b) Two findings from the original audit that were confirmed and never fixed.**
- **P6 - `backdrop-filter` inside the animating panel.** `StepBtn` sets `backdropFilter: blur(10px)` (`CollectionCardSheet.jsx:76`). The verification pass confirmed the Chromium mechanism (a backdrop-filter element forces its own render surface, and its invalidation is positional, so it re-runs the readback and blur every frame while an ancestor transform animates) while correcting the counts: 2-14 elements, GPU-side, "real but modest". Note the audit found these in the card sheet and RefineSheet's comparator rows - the owner reports the filter sheet is the worst, which is consistent, though the current grep shows only 1 remaining `backdropFilter` in `CollectionCardSheet` and 0 in `RefineSheet`, so **the count needs re-establishing before acting**.
- **P7 - the shimmer**, as described in (a).

**(c) React reconciliation of the grid.** The audit's P1. The tile-memo half was fixed (callbacks are identity-stable). The half never fixed is that sheet state lives at the grid root, so the grid component itself re-renders and rebuilds its element array on every open and close. My §3 attempt targeted this and measured worse; I do not trust that result either way.

**(d) Something in the vaul/Radix mount path that I have not found.** §3 removed the two obvious candidates with no gain, so if it is here, it is elsewhere.

## 5. What the owner's reference article suggests (Flutter, but transferable)

[Flutter bottom sheet performance fix](https://medium.com/easy-flutter/flutter-bottom-sheet-performance-fix-fd4fd32cd7c4) diagnoses four causes and fixes them by **spreading work across frames instead of concentrating it in the presentation frame**:

1. Eager construction of the whole list - fixed with lazy/windowed rendering.
2. **Several images decoding simultaneously in the first frame** - fixed by deferring image work to a post-frame callback.
3. An async fetch inside the sheet's own lifecycle - fixed by prefetching earlier in the flow.
4. Non-const static widgets causing redundant work - the Flutter analogue of our stable-element-reference problem in (c).

Points 2 and 3 map directly onto us. Our chassis already exposes `onSettled` (now wired to vaul's `onAnimationEnd`) precisely so heavy consumers can defer data swaps past the opening motion - **and no call site uses it.** The audit recorded that `CollectionCardSheet` does `getCard` + `ownedSetsForCard` + `wantedItemsForCard` + two store subscriptions on open, with a `Loading` -> full-body swap landing mid-animation.

## 6. Questions for Codex

1. **Method first:** what is the controlled way to measure this on a release WebView build? Is warming the art cache and asserting warmth sufficient, or should this be measured in zero-image mode and treated as two separate problems (sheet-open cost vs art-pipeline cost)?
2. Do you accept (a) as the leading hypothesis, and is the right first move to bound art work - cap concurrent decodes, stop the shimmer animating while a sheet is open, or defer offscreen art entirely?
3. Is the P1 remainder in (c) worth fixing on principle regardless of what the noisy measurement said - i.e. should the grid's element array be stabilised, or should sheet state be moved off the grid root instead (the larger refactor the audit deferred)?
4. Should consumers start using `onSettled` to defer their data swaps past the opening motion (article point 3)? `CollectionCardSheet` and `CardSheet` are the obvious first candidates.
5. Re-establish and dispose of P6: how many `backdrop-filter` elements actually remain inside animating panels today, and do they matter at the measured magnitude?

## 7. Separately: images stuck loading (Annual Fair, Arc Lightning)

Both are Arthurian Legends (set 004). What I established locally:

- Both keys **are** present in `public/catalog/art-manifest.json`, and set 004 has ~900 entries - so this is not a whole-set publish gap.
- I **could not** check whether the CDN actually serves those objects: this workstation cannot reach `cdn.sadkinglabs.com` at all (a control request for a known-working Beta image failed identically), and WebFetch failed too. **This needs to be checked from the device or a networked machine**, e.g. `npm run update:catalog`'s audit step (`promoteGate.mjs`), which already audits the whole manifest against R2 and needs `.env.r2` + internet.

Candidate explanations, untested: the connection-queue saturation in (a) (most likely, and it would make "stuck" mean "queued"); objects missing on R2 despite being in the manifest; or a key stuck in the art layer's quarantine from an earlier failure (the art-first-paint work added verify-before-quarantine specifically because a Cap 8 boot race made `onError` lie - worth confirming that path cannot strand a key permanently).
