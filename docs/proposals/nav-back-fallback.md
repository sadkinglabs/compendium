# Proposal: a tested hardware-back fallback-precedence contract (`navBack.js`)

## Status and classification

**Status: Rev 1 — awaiting review** · Risk: **Standard** (behavior-preserving relocation of hardware-back precedence — the app's highest-blast-radius interaction — so an installed-app back smoke is mandatory, but no logic changes)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-18 · Roadmap §16 #4, **scoped down to a narrow back-precedence contract after discovery**. **No implementation has begun.**

> **Scope decision (evidence-driven, ratified by the human).** Roadmap #4 was "`navStack`/`resolveBack` + `profileResetState`, delete the seven dead rows." Discovery collapsed it:
> - **Cold-boot `loadOngoing()` null → already fixed** (moved into the boot effect after `initProfiles()`, `App.jsx:137-144`).
> - **"Pre-React `activeId` flip" → does not exist** in current code (not corroborated; the only profile-key coupling is `KEY()`→`activeProfileId()` inside `ongoingMatch.js`, read only after the profile resolves).
> - **The seven dead rows are real but "harmless-dead"** — each is a sheet/modal on a self-registering chassis, peeled by `runBackConsumers()` before the `backStack` is consulted. **Deleting them is declined:** they sit on the app's highest-blast-radius array, and removing them strips a latent fallback (if a layer is ever rendered without that chassis) for a cosmetic gain — the #3-unification trap. They are **kept and explicitly labelled** as fallback paths.
> - **`profileResetState` is declined** — it would relocate ~11 setState calls (partly duplicated in `goTab`) without reducing meaningful complexity.
>
> What remains worth doing is one thing: the back **precedence** is the app's most-pressed interaction and has **no test**. This proposal extracts it into a small pure module with **table-driven tests**, and — per the reviewer's naming point — calls it **`resolveAppBackFallback`**, not `resolveBack`: it runs *only after* `runBackConsumers()` declines, so it resolves the App-fallback half, not the registered-consumer half.

## Problem and success criteria

**Hardware-back precedence — which layer BACK peels for a given nav state — is an untested 16-row inline array on the app's most-pressed control.** `App.jsx:330-347` declares the order; `App.jsx:350` evaluates `backStack.find(([active]) => active)`. A future edit that reorders a row (e.g. slips a low-priority row above `match`, so BACK *exits a live match* instead of peeling its modal) is a silent, app-wide regression with nothing to catch it. The registered-consumer half (`back.js`) — which runs first, LIFO — is likewise untested.

**Success criteria — a back-precedence *contract*, proven by table-driven tests:**

1. `src/navBack.js` (pure) single-sources the **fallback precedence**: `APP_BACK_ORDER` + `resolveAppBackFallback(state)` (the App half) and `COUNTER_BACK_ORDER` + `resolveCounterBackFallback(layers)` (the match-internal ladder). `App` and `LifeCounter.closeTopmost` route through them; the **actions stay in their components**.
2. The contract proves, by test:
   - **(a)** registered consumers run **first**, and in **LIFO** order, stopping at the first that handles it (`back.js`);
   - **(b)** the **`match`** fallback outranks ordinary app navigation (`resolveAppBackFallback`);
   - **(c)** BACK inside a live match closes the counter's **internal UI first** (confirm → end → sheet → fab), then **minimizes** (`resolveCounterBackFallback`);
   - **(d)** when no fallback row matches, `resolveAppBackFallback` returns **null** → App's home/double-back-to-exit path (the final fallback).
3. The **seven shadowed rows are kept and labelled** `(shadowed)` in `APP_BACK_ORDER`, with a test asserting each still resolves in declared order — so the fallback intent is documented and cannot silently drift.
4. **Zero behavior change** — same predicates, same order, same actions. Verified by an installed-app hardware-back smoke (a pure test cannot prove the Capacitor `backButton` event reaches the dispatcher).

**Non-goals / declined (recorded):** deleting the shadowed rows; `profileResetState`; any change to `back.js`'s mechanism, the consumer chassis, `switchProfile`, or the double-back-to-exit timing. **If this grows beyond one small pure module, a thin dispatch, and focused tests, #4 is deferred** — the evidence does not justify a broader navigation rewrite.

## Evidence and current architecture

- **Dispatcher** `App.jsx:348-356`: `runBackConsumers()` first; else `backStack.find(([active]) => active)`; else `homeApi.back()`; else double-back-to-exit.
- **`backStack`** `App.jsx:330-347` — 16 `[predicate, action]` rows. Verified DEAD (shadowed by a self-registering chassis) vs LIVE:
  - **7 DEAD:** `importMode`, `matchImport` (Sheet→GothicSheet), `resultPaste`, `searchHelpOpen`, `creditsOpen`, `settingsOpen` (CenteredModal), `profileSheet` (Sheet→GothicSheet). Each chassis calls `registerBackConsumer` when open (`GothicSheet.jsx:17`, `ui.jsx:260`), so `runBackConsumers()` peels it first.
  - **9 LIVE:** `match`, `preMatch`, `deckWizard`, `add`, `query`, `detail`, `deckEdit`, `deckOpen`, `tabHome` — plain views/overlays with no consumer.
- **`back.js:8-23`** — `consumers` array; `runBackConsumers()` iterates LIFO, stops at first `true`. Untested.
- **`match` row** `App.jsx:331` → `counterApi.current.closeTopmost()` (`LifeCounter.jsx:162-168`): a confirm→end→sheet→fab→`minimize()` ladder. The counter's internal modals are **not** consumers (they're plain state), so back reaches this row; the only counter consumer is `ShareQRModal` (`LifeCounter.jsx:1066`), which sits above and is peeled first — complementary, not shadowing.
- **Precedent pure modules under a `node --test` glob:** `matchLife.js`/`matchRoll.js` (`test:ui`), `matchSnapshot.js`/`importPlan.js` (`test:query`). `navBack.js` is App-shell logic (neither pillar nor store), so it needs its own glob — a new `test:app` script `node --test "src/*.test.mjs"` (covers `navBack.test.mjs` + `back.test.mjs`).

## Assumptions and confidence

1. **The precedence relocates behavior-identically.** Confidence: **high** — `resolveAppBackFallback` returns the first truthy key in `APP_BACK_ORDER`; the App builds the same booleans it computes today; actions are unchanged closures. Equivalent to the current `.find`.
2. **`closeTopmost` routing is behavior-identical.** Confidence: **high** — `resolveCounterBackFallback` returns the first open layer in `COUNTER_BACK_ORDER` (confirm→end→sheet→fab) or `'minimize'`, matching the if-ladder exactly.
3. **`back.js` is testable in isolation.** Confidence: **high** — `register`/`run` over the module-level array; tests register/unregister within each case.
4. **A new `test:app` glob is the honest home.** Confidence: **high** — the module is neither `store` nor `pillar`; co-locating its test elsewhere would misfile it.

## Affected systems and invariants

- **Eight §3 invariants:** none touched. This is UI-shell precedence logic — no persistence, schema, profile, or content path.
- **Hardware-back precedence (app-wide UX invariant, currently untested):** *hardened* — the order becomes a tested pure contract; the LIFO consumer rule and the match-first / home-last rules gain tests.
- **Cross-runtime integrity (§3.8):** the module is pure/runtime-identical; the Capacitor event delivery is runtime-sensitive, hence the mandatory device smoke.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** (inline 16-row array, untested) | Rejected — the app's most-pressed control has no regression guard. |
| **`navBack.js`: `resolveAppBackFallback` + `resolveCounterBackFallback`, table-driven tests, keep+label rows** (proposed) | **Recommended.** Narrow; makes the precedence a tested contract; behavior-preserving. |
| Delete the 7 shadowed rows | **Declined** — cosmetic; removes a latent fallback; churn on the worst surface. |
| `profileResetState` extraction | **Declined** — relocates setters without cutting complexity. |
| A full `navStack` model (history/stack machine) | **Declined** — a navigation rewrite the evidence doesn't justify (the defer threshold). |

## Proposed design

**`src/navBack.js` (pure):**
```js
// Hardware-back precedence for the App shell. back.js's registered consumers (FAB menus and
// the sheet/modal chassis) run FIRST and LIFO; ONLY when they all decline does the App consult
// these FALLBACK orderings. Named *Fallback for exactly that reason - they do not resolve the
// consumer half of the system. Pure and table-tested. Run: npm run test:app

// App-level fallback precedence, highest first. Rows marked (shadowed) are normally peeled by a
// self-registering chassis before this runs; they are KEPT as a declared fallback in case a
// layer is ever rendered without that chassis. Adding a layer = one row here (order = precedence).
export const APP_BACK_ORDER = [
  'match', 'preMatch', 'deckWizard',
  'importMode' /*(shadowed)*/, 'matchImport' /*(shadowed)*/, 'resultPaste' /*(shadowed)*/,
  'searchHelp' /*(shadowed)*/, 'credits' /*(shadowed)*/, 'settings' /*(shadowed)*/, 'profileSheet' /*(shadowed)*/,
  'add', 'query', 'detail', 'deckEdit', 'deckOpen', 'tabHome',
];
export function resolveAppBackFallback(state) {
  return APP_BACK_ORDER.find((key) => state[key]) || null;
}

// The `match` row's own internal precedence: BACK in a live match peels the counter's open
// layers, and only when none is open does it minimize (preserving the resumable match).
export const COUNTER_BACK_ORDER = ['confirm', 'end', 'sheet', 'fab'];
export function resolveCounterBackFallback(layers) {
  return COUNTER_BACK_ORDER.find((k) => layers[k]) || 'minimize';
}
```

**Thin App dispatch (`App.jsx`):**
```js
const key = resolveAppBackFallback({
  match, preMatch, deckWizard, importMode, matchImport, resultPaste,
  searchHelp: searchHelpOpen, credits: creditsOpen, settings: settingsOpen, profileSheet,
  add: addActive, query: hasQuery, detail: !!viewDetail,
  deckEdit: tab === 'decks' && !!deckOpen && deckEditMode,
  deckOpen: tab === 'decks' && !!deckOpen, tabHome: tab !== 'home',
});
if (key) { BACK_ACTIONS[key](); return; }
```
where `BACK_ACTIONS` is the same closures as today (`match: () => counterApi.current?.closeTopmost?.()`, … `tabHome: () => goTab('home')`). `runBackConsumers()` still runs first; the home-api / double-back-to-exit tail is unchanged.

**Thin LifeCounter dispatch (`closeTopmost`):**
```js
switch (resolveCounterBackFallback({ confirm: confirmRef.current, end: endRef.current, sheet: sheetRef.current, fab: fabRef.current })) {
  case 'confirm': return setConfirm(null);
  case 'end':     return setEndInfo(null);
  case 'sheet':   return setSheet(null);
  case 'fab':     return void (setFabP(false), setFabE(false));
  default:        return minimize();
}
```

## Implementation plan

1. **Stage 1** — add `src/navBack.js` + `src/navBack.test.mjs` + `src/back.test.mjs`; add the `test:app` npm script. **Checkpoint:** `test:app` green (no wiring yet).
2. **Stage 2** — thin dispatch: `App` builds the state object → `resolveAppBackFallback` → `BACK_ACTIONS`; `LifeCounter.closeTopmost` → `resolveCounterBackFallback`. **Checkpoint:** all gates green; diff is a relocation reviewable line-for-line against `App.jsx:330-356` and `LifeCounter.jsx:162-168`.
3. **Device (mandatory):** installed-app hardware-back smoke — see verification.

`test:app` joins the standing gate set.

## Data migration and compatibility

**Not applicable** — no persisted data, format, or schema. Pure logic relocation.

## Documentation impact

| Document | Disposition |
|---|---|
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Update — short note.** Record the two-phase back model (LIFO consumers via `back.js`, then `navBack.js` App fallback), and that the 7 shadowed rows are retained as labelled fallback. |
| [`BUILD.md`](../../BUILD.md) | **Update — one line.** Add `npm run test:app` to the quality-gate commands. |
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) / [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Reviewed — no change.** No data/capability change. |
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) / [`AGENTS.md`](../../AGENTS.md) | **Reviewed — no change.** |

## Rollback and recovery

One-commit revert per stage; no persisted-format change. Reverting stage 2 restores the inline `backStack.find` and the `closeTopmost` if-ladder verbatim.

## Verification plan

- **Automated (table-driven, load-bearing):**
  - `back.test.mjs` (`test:app`) — **(a)**: three consumers registered A,B,C; `runBackConsumers` calls C→B→A (LIFO) and stops at the first returning `true`; returns `false` when none handles; the unregister closure removes exactly its own consumer. *(Tests clean up their registrations.)*
  - `navBack.test.mjs` (`test:app`) — **(b)** `resolveAppBackFallback` returns `match` when `match` and any lower flag are both set; each row wins over all lower rows; **(d)** returns `null` for the empty state; **(3)** each shadowed row (`settings`, `credits`, …) resolves to itself when it is the only/highest set flag (documents the fallback path). **(c)** `resolveCounterBackFallback`: `confirm`→`end`→`sheet`→`fab` precedence, and `'minimize'` when no layer is open.
  - `test:query`/`test:ui`/`test:codex`/`build`/`check:docs` for the wiring.
- **Device (mandatory — the Capacitor event path):** installed release —
  1. In a live **match**, open a sheet (e.g. Match Log) → BACK closes the sheet, match stays; BACK again → minimizes to Home with "Return to Match" (item c).
  2. Open **Settings** (a shadowed row) → BACK closes Settings only (consumer path, item a).
  3. On a **deck** open in Decks → BACK returns to Library, not Home (live row order); on **Codex detail** → BACK returns to results.
  4. On **Home** root → BACK once shows "Press back again to exit", BACK again exits (item d).
- **Regression:** the two dispatch diffs inspected line-for-line for predicate/order/action identity.

## Security, privacy, performance, and operations

No new data, dependency, or telemetry. Pure functions; negligible cost.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A predicate is mis-built into the state object (e.g. `deckOpen` truthiness) | Low | High (app-wide back) | Line-for-line diff vs. `App.jsx:330-347`; `!!` coercions explicit; device smoke exercises each live row |
| `closeTopmost` switch drifts from the if-ladder | Low | Medium | `COUNTER_BACK_ORDER` is the single source; the switch maps 1:1; device item (c) |
| A shadowed row silently rots (chassis stops registering) | Low | Low | Rows kept + labelled + resolve-in-order test; the fallback still fires |
| The `test:app` glob misses files or double-runs | Low | Low | `node --test "src/*.test.mjs"` scoped to root; CI list updated in BUILD.md |
| Judged to exceed "one module + thin dispatch" | Low | — | Counter half is in the *same* module and is part of proving item (c); if still judged over-scope, drop `resolveCounterBackFallback` and prove (c) by device smoke alone |

## Self-Critique

- **Strongest reason it's marginal:** the precedence is a linear `find` that isn't currently buggy — a skeptic calls the test preventive. Fair, but it guards the single most-pressed control in the app, where a reorder regression is silent and app-wide, and there is no test today. Preventive is the right posture for hardware-back.
- **The part most likely to be over-built:** the counter half (`resolveCounterBackFallback` + `closeTopmost` rewire). It adds a little verbosity to a clean if-ladder. It earns its place only because the reviewer's contract explicitly asks item (c) to be proven by an ordering test; if that's not wanted, it's the first thing to cut (device-smoke item c instead), leaving a strictly App-only module.
- **Highest-consequence assumption:** that building the state object reproduces every predicate exactly. A mis-coerced `deckOpen`/`tab` guard is a real (if low-odds) app-wide back regression — caught by the line-for-line diff and the device smoke, which is why the device step is mandatory despite the pure core.
- **What I'm explicitly NOT doing, and why it's right:** not deleting the shadowed rows (removes a fallback for cosmetics), not extracting `profileResetState` (relocation without simplification), not building a `navStack` (a rewrite the evidence doesn't justify). Each was a roadmap ambition that discovery retired.
- **Failure likely to escape the pure tests:** the Capacitor `backButton` event not reaching `backRef.current` on device — which no unit test can see, hence the mandatory installed-app smoke.

## Approval requested

Extract a small pure `src/navBack.js` (`resolveAppBackFallback` + `resolveCounterBackFallback`) that makes hardware-back **fallback precedence** a table-tested contract, route `App`'s dispatch and `LifeCounter.closeTopmost` through it (actions unchanged), add `back.js` LIFO tests and a `test:app` glob — behavior-preserving, with a mandatory installed-app back smoke. **Ratify the obsolete #4 claims as closed** (cold-boot `loadOngoing`, `activeId` flip), **decline** the shadowed-row deletion and `profileResetState`. Decisions: (1) ratify the closed claims + declines; (2) approve the extraction + thin two-site dispatch; (3) confirm the counter half is in-scope (or cut it to device-smoke). **No code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted Rev 1 | 2026-07-18 |
| Codex (reviewer) | *pending review* | |
| Human (approver) | *pending* | |
