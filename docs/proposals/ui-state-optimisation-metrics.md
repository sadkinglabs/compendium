# UI-State Optimisation — Baseline & Change Metrics

Companion to [`ui-state-optimisation.md`](./ui-state-optimisation.md). Records the measured
**before** state so the increment's effect is answerable with numbers, not impressions
(human owner's request at approval, 2026-07-17). Post-change columns are filled at final
verification (§7 of the proposal). Reduced line count is **descriptive here, never an
acceptance criterion** (proposal §2).

## Environment of measurement

- **Repo state:** branch `refactor/matchlife-safety-boundary`, off `main` @ package build 60.
- **Node test runner:** `node --test` (`npm run test:ui`).
- **Build:** `npm run build` (Vite 6), measured 2026-07-17.
- **Device:** Pixel 9 Pro XL · Android 16 · Chromium WebView **150.0.7871.46** · installed Compendium **build 60** (current).

## Baseline metrics (before)

| # | Metric | Baseline (measured) | How measured | Post-change target |
|---|---|---|---|---|
| 1 | `LifeCounter.jsx` lines | **1097** | `wc -l` | Slightly lower (descriptive only) |
| 2 | ≤20 hard-cap enforced at N of the life entrances | **2 of 5** — fresh seed (L47), max stepper (L902). Tap (L374) & setMax (L403) clamp to `max` only; **resume (L50-51) is unvalidated** | source inspection | **5 of 5**, via one `matchLife.js` boundary |
| 3 | Distinct cap/clamp sites for life/max | **4 scattered** (L47, L374, L403, L902) | `git grep` | 1 module owns the rules |
| 4 | Pure (DOM-free) tests over life arithmetic | **0** | `ls src/pillars/matchLife*` → none | ≥ ~15 fixtures under `test:ui` |
| 5 | `npm run test:ui` total | **61 pass**, 0 fail, ~104 ms | test runner | > 61 (new fixtures), still green |
| 6 | `LifeCounter` JS chunk | **35.08 kB (gzip 10.55 kB)** | Vite build report | ~flat (±< 1 kB); pure module, no dep |
| 7 | `index` JS chunk | 412.89 kB (gzip 128.64 kB) | Vite build report | unchanged |
| 8 | `dist/` total | 77 MB (art-dominated, per `BUILD.md`) | `du -sh dist` | unchanged |
| 9 | **Correctness — resume cap:** a snapshot with `pMax:999` | **Bypassed.** `isValidSnapshot` accepts it (only `Number.isFinite`); resume seeds `max=999`; taps climb uncapped (repro: life 20 → **70** after 50 taps, ceiling = 999) | deterministic repro of the verbatim arithmetic (`ongoingMatch.js:18-22`, `LifeCounter.jsx:50-51,374`) | **Clamped to 20** (Stage B), device-confirmed |
| 10 | Tap-event domain | **Open integer** (`change(who, delta)`; `Math.min(max, life+delta)` would compute negative for an unreachable delta < −life) | source inspection | Closed `-1 \| +1`, fail-loud (Stage B) |
| 11 | Non-finite input handling at the life boundary | **Undefined** — bare `Math.min/max` would propagate `NaN` | source inspection | Fail-loud throw at every entrance (Stage B) |

## On-device verification (installed release, build 61)

Runtime: Pixel 9 Pro XL · Android 16 · Chromium WebView 150.0.7871.46 · `assembleRelease` (signed, minified, ProGuard) installed over build 60 with data preserved. Driven via `adb input` + screencap; screenshots in the session scratchpad (`dev-02`…`dev-09`).

> **Provenance:** the device screenshots were captured on **build 61 (Stage B code)**. The subsequent review fixes (`validateSide` input-guarding; moving the fresh-seed clamp into `initSide`; the stepper referencing `LIFE_CAP`/`MIN_MAX`) are **behaviour-neutral for every reachable input** — they only reject invalid inputs the app never produces and relocate a clamp to an identical-valued site — and are covered by the +2 new unit tests. So the build-61 device behaviour is representative of the final code. A fresh install (build 62) can be produced on request if the owner wants device evidence on the exact merged bits; it is not expected to differ.

| Check | Result | Evidence |
|---|---|---|
| Build 61 boots on the real WebView | **Pass** — Home renders with live data (452 cards, 6 matches, 67% winrate); no runtime error from `matchLife.js` | `dev-03` |
| Changelog renders for build 61 | **Pass** — "What's New" shows the build-61 note verbatim | `dev-02` |
| Fresh match seeds both sides at 20 (`initSide` cap) | **Pass** | `dev-04` |
| Minus decrements | **Pass** — 20 → 17 (−3 delta shown) | `dev-05` |
| **Plus caps at 20** (`applyStep` cap on device) | **Pass** — from 17, five +1 taps landed at **20**, not 22 (+3 delta, last two capped no-ops) | `dev-06` |
| Minimize saves the ongoing snapshot | **Pass** — Home shows "Return to Match" with the active indicator | `dev-08` |
| **Resume preserves state** (`restoreSide` on device) | **Pass** — resumed at player 18 / opponent 20 exactly as left; roll already dismissed, colours intact | `dev-09` |
| Animations / deltas / colour / roll dismissal | **Pass** — "First Light" colour, delta pills, and the 5-tap roll retire all intact | `dev-05`, `dev-06` |
| Life-counter tap → render feel | **Neutral** — no observed change; the extraction touches no render/effect path | observation |

### Accepted verification deviation (requires human risk acceptance)

**The one approved acceptance criterion NOT met by direct device observation:** injecting a *tampered* `pMax:999` ongoing snapshot to watch it clamp to 20 *in the installed app*. A release WebView is not remote-debuggable, the app itself never writes an out-of-range snapshot, and a non-rooted device cannot edit WebView `localStorage`. Rather than present this as device-confirmed (it is not), it is recorded as an explicit **verification deviation** with a substitute evidence chain, for the human owner to accept:

1. **Unit proof** of the clamp: `restoreSide({life:20,max:999}) → {life:20,max:20}` (passing).
2. **Source proof** that native resume routes through `restoreSide`: `LifeCounter.jsx:51-52` seeds `pRef`/`eRef` via `restoreSide(...)`; verified in the diff.
3. **Installed-app proof** that normal snapshot restoration executes correctly on the shipping WebView: `dev-09` (minimize → resume preserved player 18 / opponent 20).
4. **Baseline repro** that the *pre-fix* arithmetic climbs uncapped (metric #9), establishing the before/after contrast.

This chain is a reasonable substitute, but it is a **deviation from the direct-device criterion and must be accepted as such by the owner** — it is not direct device confirmation of the tampered case.

**Owner disposition (2026-07-17): deviation ACCEPTED.** Rationale: the tampered-snapshot threat model is negligible for an offline single-user life counter (no adversary; the realistic trigger for an out-of-range snapshot is a bug or a legacy snapshot, not injection), and a release WebView cannot inject a snapshot the app never writes. The value banked is the testable pure-module pattern and the structural single-sourcing of the cap against ordinary future bugs — not a security control. A build-62 re-verify was declined as effort-for-its-own-sake (it could not make the tampered case injectable regardless). Codex concurred.

## Results after the increment (measured, both stages on branch `refactor/matchlife-safety-boundary`)

| # | Metric | Baseline | After | Verdict |
|---|---|---|---|---|
| 1 | `LifeCounter.jsx` lines | 1097 | **1100** (+3) | Component LOC barely moved - as intended; the win is *logic relocated to a tested module* (`matchLife.js`, 90 lines), not a shorter component. LOC was never the target (§2). |
| 2 | ≤20 cap enforced at N of 5 life entrances | 2 of 5 | **5 of 5** via one module (`initSide`, `restoreSide`, `applyStep`, `applyMax`, reset→`initSide`) | **Met** |
| 3 | Authoritative cap owner | 4 scattered sites | **1 module** (`matchLife`). After the review fix, the component holds **no** independent cap: `LifeCounter.jsx:48` passes the raw/defaulted seed into `initSide` (which clamps), and the `MaxLifeModal` stepper references `LIFE_CAP`/`MIN_MAX` instead of restating `20`/`1`. No duplicated policy remains | **Met** (single-sourced; review fix) |
| 4 | Pure life-arithmetic tests | 0 | **22** (incl. finite-but-invalid-side guards, review fix) | **Met** |
| 5 | `npm run test:ui` total | 61 | **83** pass, 0 fail | **Met**, still green |
| 6 | `LifeCounter` JS chunk | 35.08 kB (gzip 10.55) | **36.16 kB (gzip 10.95)** | +0.40 kB gzip — small, no dependency added |
| 7 | `index` JS chunk | 412.89 kB (gzip 128.64) | **413.19 kB (gzip 128.75)** | **+0.30 kB / +0.11 kB gzip** — *not* unchanged; the build-61 changelog entry lives in `ChangelogModal`, bundled in the index chunk. Acceptable, but named |
| 8 | `dist/` total | 77 MB | 77 MB (art-dominated; the ~0.3 kB code delta is negligible) | Neutral |
| 9 | **Resume cap correctness** (`pMax:999`) | Bypassed → life to 999 | **Clamped to 20** in logic (unit + baseline-repro proven); resume *path* device-verified (`dev-09`). The *tampered-snapshot on installed app* case is an **accepted verification deviation** (substitute chain above), pending owner risk acceptance | **Deviation** — see the device section; needs human sign-off |
| 10 | Tap-event domain | Open integer | **Closed `-1 \| +1`**, fail-loud | **Met** |
| 11 | Invalid-input handling at the boundary | Undefined (NaN could propagate; finite-but-invalid sides accepted) | **Fail-loud** on non-finite AND on finite-but-out-of-range sides, at every entrance/transition (`validateSide`, review fix) | **Met** |
| — | Full automated gate | — | test:codex 10 · test:query 88 · test:ui 83 · build ✓ · check:docs ✓ | **All green** |

**Interpretation:** the safety/testability gains (metrics 2, 3, 4, 10, 11) landed at a small, named bundle cost (+0.40 kB gzip on the LifeCounter chunk, +0.11 kB gzip on index from the changelog note) and no dependency, with the full suite green. The single open item is **not** an unmet metric but a **verification deviation** on metric #9's tampered-snapshot case, which needs the owner's explicit risk acceptance.

## What "beneficial" will mean at review

The increment is **beneficial** if, at final verification: metric #9 clamps at 20 (unit + baseline-repro proven, resume-path device-verified, tampered case an accepted deviation), #2 reaches 5/5 through one module with #3 truly single-sourced, #4 rises from 0 to a real suite, and #6/#7/#8 show the safety/testability gains cost only a **small, named** bundle delta (no dependency, no runtime regression). If the chunk had grown materially, or #5 could not be raised without a DOM, or the device showed any observed behavioral/visual difference on reachable inputs, the redesign would **not** have proved beneficial and we revert (owner's standing instruction). None of those fired; the one thing outstanding is the owner's acceptance of the metric-#9 verification deviation.
