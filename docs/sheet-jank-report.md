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

The effect is real, large, and correlated with set size.

> **CORRECTED 2026-08-16 (Codex).** I wrote that "slow UI thread" proves main-thread work and excludes the GPU. It does not. `gfxinfo` proves severe frame-deadline misses correlated with set size; it does **not** attribute them to JavaScript, native bridge calls, decode, layout or raster, and does not fully exclude concurrent GPU pressure. Raw framestats are trend evidence, not causal evidence - attribution requires a trace.

So the defensible claim is narrower than I stated: **something scales badly with element count, and it is severe.** Nothing more.

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

**(a) The art pipeline - leading hypothesis, but NOT for the reason I first gave.**

> **CORRECTED 2026-08-16 (Codex).** My original explanation - browser connection limits (~6 per host) queueing hundreds of `<img>` requests, with decode on the main thread - is **wrong for this app** and is struck. On native the art path never reaches browser image loading first: every mounted `CardArt` calls `useArtSource()`, and for a cold key that immediately enters `artCache.resolve()` (`src/store/artCache.js:116`), which does a filesystem stat and potentially `Filesystem.downloadFile` **before any `<img loading="lazy">` exists**. `loading="lazy"` therefore gates nothing here, and `content-visibility` does not stop React effects either. The connection-count claim is also unsafe generally under HTTP/2/3, and Chromium normally decodes and rasters off the main thread, so decode cannot be assigned to the UI thread without evidence.

The corrected mechanism: **unbounded, render-driven native resolution.** Arthurian Legends mounts ~400 `BinderTile`s, so hundreds of native stat/download/bridge operations can start concurrently. `resolve()` dedupes by key via its `inflight` map but has **no global concurrency cap** - only the separate offline-pack API limits concurrency. Each completion then lands a React resolution commit plus a local image load. That predicts jank proportional to element count and images that look "stuck" because a stampede is in flight, which matches both owner reports.

The `.cx-art-shimmer` animation (`tokens.css:552-558`) is a genuine paint-phase animation and remains a *possible* contributor, but per Codex it must **not** be the first thing changed - it is a diagnostic, not a suspected cause, until the measurements below say otherwise.

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

## 5a. Codex disposition (2026-08-16): investigation accepted, no production fix approved

The experiment contract below is Codex's, and supersedes my ad-hoc method. **Three conditions**, each run for both Arthurian Legends and Dragonlord:

1. **Zero-image** (`cx-no-images=1`). Keeps all ~400 React tiles but removes art resolution, native I/O, `<img>` and shimmer entirely - `resolve()` short-circuits at `artCache.js:117`. This is the decisive fork.
2. **Proven warm.** Every art key for the set locally present and boot-seeded. *"Images eventually appeared"* is not proof: instrument zero resolve-misses and zero download-starts inside the measured window.
3. **Cold.** Empty relevant cache, with counters for resolution starts/completions, **max inflight**, download latency, `<img>` load/error, and unresolved operations at end.

Method rules: fixed navigation and open/close cadence; reset framestats immediately before the measured journey; **alternate condition order across multiple independent runs** (not repeated cycles inside one uncontrolled run); **do not force-stop between sheet cycles** (force-stop only when deliberately testing boot seeding); stock release `gfxinfo` for acceptance numbers; a temporary minified, release-like **WebView-debuggable** build for a Chrome Performance trace to attribute scripting vs style/layout vs paint vs native callbacks - **never shipped**.

Interpretation table:

| Result | Conclusion |
|---|---|
| Large still bad in zero-image | Grid/root reconciliation - trace, then fix structurally |
| Zero-image clean, warm clean, cold bad | Art resolution/download stampede confirmed |
| Zero-image clean but warm still bad | Local load / decode / reveal work implicated |
| Static-shimmer diagnostic improves warm | Shimmer is material; otherwise leave it alone |

Standing instructions from the same disposition:

- **P1 - do not optimise the grid "on principle".** My failed `useMemo` proves nothing under the confound, but memoising a JSX array is not the preferred structural fix either. If zero-image still scales badly: trace first, then isolate the grid behind a memoised **component** boundary, or move overlay-open state below/outside the grid owner, preserving stable data and callback identities.
- **`onSettled` - narrow use, and never delay fetching.** No blanket adoption. RefineSheet, the worst-reported surface, has no async content swap to defer at all. For `CollectionCardSheet` / `CardSheet`, only if tracing shows the `Loading` -> full-body commit overlaps the entrance: begin fetching immediately on user intent, keep stable/reserved sheet geometry, gate only the heavy subtree *replacement* until settle, and show late-arriving data normally. Waiting until settle to *start* queries would trade jank for visible latency.
- **P6 - my grep was wrong; the audit's count stands.** There is one `backdropFilter` *source declaration* because every `StepBtn` shares it; RefineSheet can instantiate **fourteen** across seven comparator rows, so the runtime count is 2-14 as the audit said. The effect is real but principally compositor/GPU-side and modest, and does not explain 43 slow UI-thread frames. Combined with the owner's standing ruling that blur is not stripped speculatively: **leave P6 alone unless a trace indicts it.**
- **Do not** touch the shimmer or add a decode limiter as a first move.

## 5b. RESULT - condition 1 (zero-image) run 2026-08-16: the grid is exonerated, art is indicted

Measurement build: `imagesDisabled()` forced true (a temporary source edit, reverted immediately after; shipping build restored as 264). Same device, same fixed navigation and 5-cycle cadence, framestats reset after navigation.

| Condition | Set | Janky | 50th | 99th | Slow UI | Total frames |
|---|---|---|---|---|---|---|
| With art (262) | Arthurian ~400 | **191 (20.17%)** | 26ms | 81ms | **43** | 947 |
| With art (262) | Dragonlord 13 | 13 (2.12%) | 14ms | 36ms | 2 | 614 |
| **Zero-image** | **Arthurian ~400** | **15 (2.47%)** | **12ms** | 38ms | **2** | 607 |
| **Zero-image** | Arthurian ~400 (repeat) | 13 (2.08%) | 12ms | 34ms | 2 | 624 |
| **Zero-image** | Dragonlord 13 | 13 (2.09%) | 12ms | 34ms | 5 | 622 |

**With art suppressed, a ~400-tile page is indistinguishable from a 13-tile page.** Element count is not the driver; art *per element* is. Two supporting observations:

- The three zero-image runs are tightly clustered (2.1-2.5% jank, 607-624 total frames), where the with-art runs swung 947/1386/1022 total frames. The instability I mistook for measurement noise **was the art pipeline itself**, which is consistent with sustained, variable background work.
- Zero-image renders *fewer total frames* for the same journey, as expected once continuous shimmer animation and per-resolution React commits stop.

Against Codex's interpretation table this reads: **"Large remains bad in zero-image mode" is FALSE**, so grid/root reconciliation is exonerated as the primary cause - which also retroactively explains why my `useMemo` attempt changed nothing except adding noise. The remaining branch is warm-vs-cold, which discriminates a **resolution/download stampede** (cold-only) from **local load/decode/reveal cost** (present even warm).

### What this does not yet establish

Warm vs cold is untested, so the specific art mechanism is still open, and per Codex the counters needed to prove warmth do not exist yet: resolution starts/completions, **max inflight**, download latency, `<img>` load/error, and unresolved-at-end. Building that instrumentation is the next step, not a fix.

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
