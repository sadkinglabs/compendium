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

**The one scenario NOT reproducible on a release device — stated honestly:** injecting a *tampered* `pMax:999` ongoing snapshot to watch it clamp to 20 in the installed app. A release WebView is not remote-debuggable, the app itself never writes an out-of-range snapshot, and a non-rooted device cannot edit WebView `localStorage`. That specific behaviour change is instead proven by: the **unit test** `restoreSide({life:20,max:999}) → {life:20,max:20}` (passing), the **baseline repro** showing the pre-fix arithmetic climbs uncapped (metric #9), and the **verified diff** that routes resume through `restoreSide`. On device, the resume *path* itself was exercised end-to-end and preserves a normal in-range snapshot identically (`dev-09`), which is the behaviour-preservation half of the same change.

## Results after the increment (measured, both stages on branch `refactor/matchlife-safety-boundary`)

| # | Metric | Baseline | After | Verdict |
|---|---|---|---|---|
| 1 | `LifeCounter.jsx` lines | 1097 | **1100** (+3) | Component LOC barely moved - as intended; the win is *logic relocated to a tested module* (`matchLife.js`, 90 lines), not a shorter component. LOC was never the target (§2). |
| 2 | ≤20 cap enforced at N of 5 life entrances | 2 of 5 | **5 of 5** via one module (`initSide`, `restoreSide`, `applyStep`, `applyMax`, reset→`initSide`) | **Met** |
| 3 | Authoritative cap owner | 4 scattered sites | **1 module** (`matchLife.LIFE_CAP`). Two legacy component clamps remain (L47 fresh-seed, L902 stepper-widget bound) - now redundant/harmless defense-in-depth, not the authority | **Met** (noted for reviewer) |
| 4 | Pure life-arithmetic tests | 0 | **20** | **Met** |
| 5 | `npm run test:ui` total | 61 | **81** pass, 0 fail | **Met**, still green |
| 6 | `LifeCounter` JS chunk | 35.08 kB (gzip 10.55) | **35.95 kB (gzip 10.87)** | +0.32 kB gzip — within the ±<1 kB target; no dependency added |
| 7 | `index` / other chunks | 412.89 kB | unchanged (not touched) | Neutral |
| 8 | `dist/` total | 77 MB | unchanged | Neutral |
| 9 | **Resume cap correctness** (`pMax:999`) | Bypassed → life to 999 | **Clamped to 20** — unit-proven (`restoreSide` test) + baseline repro; resume *path* verified on installed build 61 (normal snapshot preserved, cap holds in play). Tampered-999 not injectable on a non-debuggable release WebView — see device section | **Met** (logic + device path; tampered case unit-proven) |
| 10 | Tap-event domain | Open integer | **Closed `-1 \| +1`**, fail-loud | **Met** |
| 11 | Non-finite handling | Undefined (NaN could propagate) | **Fail-loud throw at every entrance** | **Met** |
| — | Full automated gate | — | test:codex 10 · test:query 88 · test:ui 81 · build ✓ · check:docs ✓ | **All green** |

**Interpretation:** the safety/testability gains (metrics 2, 4, 9, 10, 11) landed at **no** bundle or dependency cost (6, 7, 8) and with the full suite green. The one remaining evidence item is the on-device confirmation of #9 on the shipping WebView.

## What "beneficial" will mean at review

The increment is **beneficial** if, at final verification: metric #9 flips to clamped-at-20 (device-confirmed), #2 reaches 5/5 through one module, #4 rises from 0 to a real suite, and #5/#6/#7/#8 show the safety/testability gains cost **no** measurable bundle or runtime regression. If #6 grew materially, or #5 could not be raised without DOM, or the device showed any observed behavioral/visual difference on reachable inputs, the redesign did **not** prove beneficial and we revert (owner's standing instruction).
