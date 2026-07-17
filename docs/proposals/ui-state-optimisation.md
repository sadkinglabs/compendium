# Maintainability and UI-State Optimisation Proposal

## Status and classification

**Status: Revised after review — awaiting re-review** · Risk: **High** (revised up: the first increment now closes a durable-resume invalid-state entrance and makes an intentional behavior change — see §3)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date drafted: 2026-07-17 · **Rev 2** (2026-07-17, in response to Codex "Changes required") · **No implementation has begun.**

> **Revision note (Rev 2).** Codex returned *Changes required* with three Major and two Minor
> findings. All five are **accepted**; none rebutted. The first increment has been reframed
> from a "behavior-preserving arithmetic move" into a **coherent, closed-domain life-safety
> boundary** that enforces the ≤20 invariant at *every* entrance including resume. The
> resolution of each finding is recorded in §20. This raised the increment's risk class from
> Standard to **High**, and it now requires explicit human approval for an intentional
> behavior change on the durable resume path.

> This document follows the owner's requested 19-section structure, plus a §20 review-response
> ledger. It also satisfies the Constitution §8 proposal contract (evidence, assumptions/
> confidence, options, migration, rollback, verification, security, self-critique, approval).

---

## 1. Outcome and success criteria

**Outcome.** Establish, while Compendium is still in alpha, one repeatable pattern for keeping consequential state and domain logic out of oversized React components and in plain, DOM-free modules under `npm run test:ui` — and prove it by turning the match's life model into a **single safety boundary** through which every life entrance flows. The proof-of-pattern and a real correctness fix are the same increment, because the defect lives *inside* the boundary being designed (Codex Major 1).

The pattern is **not new**: [`avatarPickerState.js`](../../src/pillars/avatarPickerState.js) (one atomic value + pure reducer + derived selectors) and [`ddArming.js`](../../src/pillars/ddArming.js) (pure transition table + timer-owning wrapper with injected timers and a closed-set `assertSide` guard) already embody it, and [`BUILD.md`](../../BUILD.md) already names it as intended. This proposal propagates that idiom — including its **closed-domain, fail-loud** discipline — not a framework.

**Success criteria for the first increment (measurable):**

1. A pure `src/pillars/matchLife.js` is the **only** place that enforces `1 ≤ max ≤ 20` and `0 ≤ life ≤ max`, and **every** life entrance routes through it: fresh init, a tap, a max change, reset, **and validated snapshot restoration on resume**.
2. **Stage A** (verbatim extraction) is behavior-preserving and its equivalence to the current component is established honestly — by a diff that is a literal move plus source-inspection-derived tests plus device observation — **not** by a copied shim (Codex Major 2).
3. **Stage B** (normalization + validated restore) is an **explicit, approved behavior change**: a resumed snapshot with `pMax: 999` restores to `20`, and the tap domain is closed to `-1 | +1` with a runtime guard (Codex Major 3). This is stated as a behavior change, not hidden inside "preservation."
4. The module follows the `ddArming`/`avatarPicker` shape, runs under the existing `npm run test:ui` gate, and adds **no dependency, no config, no build change**.
5. `test:ui`, `test:query`, `build`, and `check:docs` all pass; each stage is an independently reviewable, independently revertible commit.

**Not a success criterion:** reduced line count (§2).

---

## 2. Non-goals

- **No line-count target.** A file that merely moved code to look smaller has failed.
- **No UI redesign, no visual change, no interaction change** for any reachable input. (The only behavior change is on *unreachable/invalid* input: an out-of-range resumed snapshot, and a tap delta the UI never emits — see §3, §8.)
- **No schema or export-format change.** No `SNAP_VERSION` bump: clamping on *read* is backward-compatible (old in-range snapshots are unaffected; out-of-range ones were already the defect). See §15.
- **No new dependency**, no TypeScript migration, no repo-wide `checkJs` (§7).
- **No generic/shared abstraction.** `matchLife.js` is owned by the Play surface until multiple uses justify sharing (Constitution §4.3).
- **No opportunistic cleanup.** The other discovered defects (§5.2–§5.7) are **not** touched; they remain follow-ons (§16).
- **No extraction of DOM/animation/native glue.** Numeral animation, haptics, `dd.tap`, the FAB-dismiss early-return, keep-awake, immersive, portals, and hardware-back stay in the component (§8, §5.8).

---

## 3. Change classification and approval gates

The first increment is **two stages in one proposal**, so its equivalence and its behavior change stay separable in review (Codex Major 2's option a):

| Stage | What | Class | Behavior change? |
|---|---|---|---|
| **A** | Extract the current life/max arithmetic **verbatim** into pure exported functions; route the component's existing call-sites through them | **Standard** | **None** — reproduces today's arithmetic for every reachable input |
| **B** | Close the tap domain to `-1 \| +1` with a runtime guard; add validated `restoreSide` and route resume through it; enforce `1..20 / 0..max` at every entrance; trim returned flags | **High-risk** | **Yes, intended** — out-of-range resumed snapshots clamp to 20; non-`±1` deltas throw. Both inputs are currently unreachable from the UI, but the durable resume path can carry a corrupt/legacy/tampered snapshot (§5.1) |

**The increment as a whole is classified High-risk** (it contains Stage B, which touches the durable resume path and a named invariant) and **requires explicit human approval** before any code. Stage A may be reviewed and even merged on its own; Stage B must not merge without the human decision in §19.

**Mandatory stop conditions carried into implementation** (Constitution §12): if Stage A's source-inspection table does not match observed device behavior, stop — the model is wrong. If the pure module needs a forbidden import (React, store, native), stop — that is a redesign. If Stage B's clamp changes behavior for any *reachable* (in-range) snapshot, stop — that is scope beyond the approved behavior change.

---

## 4. Current-state evidence

Provenance: the two precedent modules and their tests, `db.js`, `ongoingMatch.js`, the four governing docs, the §5.1 cap bypass, and the `change`/`setMax`/`reset` source were read **directly by the author**. The large-file structural line references for App/Collection/Home come from a structured read-only discovery pass; the highest-consequence of those are flagged **[verify]**.

### 4.1 The surfaces

| File | Lines | State character |
|---|---|---|
| [`Collection.jsx`](../../src/pillars/Collection.jsx) | ~1,390 | Three optimistic-step reducers, subtly different; goal-ledger is the weakest |
| [`App.jsx`](../../src/App.jsx) | ~1,252 | Layer/back-stack as an imperative array; profile-switch reset as a hand-maintained denylist |
| [`LifeCounter.jsx`](../../src/pillars/LifeCounter.jsx) | ~1,098 | No single lifecycle reducer; life in refs; **≤20 cap enforced at four sites, bypassable on resume** |
| [`Home.jsx`](../../src/pillars/Home.jsx) | ~697 | Dashboard drag machine; mostly presentation |
| [`Play.jsx`](../../src/pillars/Play.jsx) | ~687 | **Already clean** — stats math already lives in pure [`matchStats.js`](../../src/store/matchStats.js) |

`Play.jsx` is the target end-state, not a candidate: its shared logic already sits in `matchStats.js` with fixtures and a bug-history header.

### 4.2 The template to copy (and improve on)

`ddArming.js`: pure `ddReduce(phase, event) -> { phase, timer }`; `createDdArming` owns timers with **injected** clocks; `assertSide` **throws** on any key outside the closed `SIDES` set; the header documents two real shipped bugs. `ddArming.test.mjs`: a manual-clock harness, fixtures pinning both the invariant and the historical failures. `avatarPickerState.js`: selection is one atomic value; the armed slot is *derived, never stored* — "that is the whole safety argument."

### 4.3 The governing constraints this touches

- **Durable, offline-first writes** (Constitution §3.3): the resume snapshot is authoritative-adjacent user state; a restore path that admits an out-of-range value violates the spirit of a validated durable boundary.
- **Cross-runtime integrity** (§3.8): browser success is not native proof.
- Game rule (memory + [LifeCounter.jsx:47](../../src/pillars/LifeCounter.jsx#L47)): **life ≤ 20, hard cap.** Feature Matrix §5.2: *"Minimizing a match preserves enough state to resume without fabricating a completed match."* Strengthening restore validation *supports* this invariant; it does not weaken the resume capability.

---

## 5. Complexity and risk inventory

Facts vs inference labelled. §5.1 is now **in scope** (Codex Major 1); §5.2–§5.7 remain follow-ons.

### 5.1 LifeCounter — the ≤20 cap is enforced at four sites and is bypassable on resume  **[FACT — author-verified]** — NOW IN SCOPE

The cap on life is a cap on `max`, bounded to 20 in only two UI spots: the fresh seed `start = Math.min(20, settings.default_max_life || 20)` ([L47](../../src/pillars/LifeCounter.jsx#L47)) and the `MaxLifeModal` stepper. The tap handler `change` clamps life to `cur.max` ([L374](../../src/pillars/LifeCounter.jsx#L374)) but never re-checks 20. On resume, `pRef`/`eRef` seed **directly** from the snapshot ([L50-51](../../src/pillars/LifeCounter.jsx#L50-L51)), and `isValidSnapshot` validates only `Number.isFinite` — **not `≤ 20`** ([ongoingMatch.js:18-22](../../src/store/ongoingMatch.js#L18-L22)). A snapshot with `pMax: 999` restores `max = 999`, after which taps climb to 999. This is the invalid-state entrance *into the very module* whose job is the cap — which is exactly why Codex was right that it cannot be deferred out of the boundary's own proposal.

### 5.2 LifeCounter — a live match is durably persisted only at explicit minimize  **[INFERENCE — one caller by grep; device-verify]**

`saveOngoing` has a single caller (`App.jsx minimizeMatch`); no `pagehide`/`visibilitychange` autosave, unlike `db.js`. An OS kill mid-match loses life, log, and elapsed. Follow-on §16, not this increment.

### 5.3 LifeCounter — the match lifecycle has no single reducer  **[FACT]**

State is the tuple `(rollPhase, endInfo, recordedRef, pRef/eRef)` across initializers, a mount effect, callbacks, and imperative `setTimeout` chains. This is the *large* extraction (§16). The first increment deliberately takes only the life/max core, which already funnels through one function, `commitLife`.

### 5.4–5.7 (summary — all follow-ons, unchanged from Rev 1)

- **5.4** Record-failure is silent (no `catch`/toast); a dismiss-during-await can spread `null` into end-info. **[INFERENCE]**
- **5.5** Collection has three optimistic-step reducers; the goal ledger writes absolute values from stale closure → clobber race. The high-value move is *unification* onto `useOwnedLedger` (High-risk). **[FACT + INFERENCE]**
- **5.6** Collection's module-level `ownedChains` reads `activeProfileId()` at drain time → cross-profile write hazard on switch. **[INFERENCE — verify]**
- **5.7** App: seven dead `backStack` rows shadowed by self-registering sheets; a likely always-null `loadOngoing()` on cold boot; a pre-React `activeId` flip. Points at a pure `navStack`/`resolveBack` extraction — but highest blast radius, so last. **[INFERENCE — verify]**

### 5.8 What deliberately stays in the components  **[JUDGMENT]**

In `change` specifically: `dd.tap(who)` (the safety-first arming tap, L364) and the FAB-dismiss early-return (L365) stay — they are effects, not arithmetic. Also: numeral animation (`setNum`/`renderLife`/`bump`), `refuseAtFloor` animation, `appendLog`, `showDelta`, `bumpFallSeq`, haptics, keep-awake/immersive/grain, `visibilitychange` re-assert, `closeTopmost`/`registerApi`, all modal sub-components. And app-wide: `useOwnedLedger` (already the strongest recovery regime), the Collection `session` effects, the App back-consumer registry. The reducer says *what happened*; the component *does* it.

---

## 6. Candidate starting points

Scored on the brief's four axes — not file length. (Lower is better for Blast radius.)

| Axis | LifeCounter: life model | App: navStack | Collection: goal-ledger |
|---|---|---|---|
| **Risk reduction** | **Highest** — closes a live invalid-state entrance (§5.1) *and* single-sources the ≤20 invariant | High — kills 7 dead rows, but they are currently harmless-dead | Medium — clobber race is real but low-stakes (goals, not life) |
| **Testability** | **Highest** — pure arithmetic; fake-timer precedent next door | High — but needs a faithful model of ~16 UI flags | High — pure over two Maps |
| **Coupling / blast radius** | **Lowest** — `commitLife` is already the one write funnel | **Highest** — a mistake breaks hardware-back app-wide | Medium — best move is a risky three-way unification |
| **Reusable precedent** | **Strongest** — canonical pure-module-beside-pillar under the same gate | Weak — a bespoke one-off | Medium — Collection-specific |

**LifeCounter's life model wins on three axes and, post-review, is *more* clearly the right first surface**: the correctness defect it closes lives inside the boundary itself, so the extraction and the fix are genuinely one coherent unit rather than a refactor with a bug bolted on. App-nav stays last (blast radius); Collection stays deferred (its prize is a High-risk unification).

---

## 7. Alternatives and trade-offs

| Option | Verdict |
|---|---|
| **Status quo** | Rejected. Two bugs already shipped from state-too-close-to-JSX (`ddArming` header); the cap bypass (§5.1) is live now. |
| **Big-bang refactor of a whole file** | Rejected (Constitution §4.8, §11). The lifecycle machine (§5.3) is genuinely large; taking it whole first maximizes blast radius. |
| **Start with Collection / App** | Rejected as first (§6). |
| **Behavior-preserving extraction that leaves the resume bypass in place** (Rev 1's plan) | **Rejected — this was the review's Major 1.** It cannot claim to single-source the invariant while preserving an uncapped entrance into the same module. |
| **First increment = closed-domain `matchLife.js` incl. validated restore + cap correction, two stages** | **Recommended.** Coherent safety boundary; the fix is intrinsic to the boundary, not bolted on. |
| **Fix the cap with a one-line clamp and do no extraction** | Genuinely simpler, and it *does* fix §5.1. Rejected as the *whole* answer because it establishes no pattern for the growing surfaces — but it is the honest fallback if the extraction is judged not worth it (§18 Q3). |
| **`useReducer` / a state library** | Rejected. The proven idiom is a pure function + thin wrapper, no dependency. |

**Type-safety assessment** (unchanged from Rev 1; builds on the already-rejected [`checked-js-pilot.md`](./checked-js-pilot.md)). TypeScript resolves roots→imports, never backward, so a `checkJs` gate on a pure module cannot see a *caller's* error — the pilot's dispositive finding.

| Type option | Recommendation | Reason |
|---|---|---|
| Targeted JSDoc `@typedef` on `matchLife.js` | **Adopt, with the increment** | Zero dependency/config, inert at runtime; documents the closed `Dir = -1 \| 1` and `Side` shapes; mirrors what `ddArming` carries. |
| `// @ts-check` / a `check:types` gate | **Defer — diagnostic-first, post-extraction** | Per the pilot's Option A: worthwhile only once `LifeCounter.jsx` (the caller) can be checked without broad React noise. More viable *after* this extraction, since the caller now imports a typed boundary. |
| Repo-wide `checkJs` | Rejected | Large unrelated cleanup buries the signal (Codex's original finding). |
| TypeScript migration | Rejected | Changes the build shape; `node --test` runs `.mjs` directly. Same benefit as JSDoc at higher cost. |

Sequencing: JSDoc rides with the extraction; any gate is a separate, later, diagnostic-first decision.

---

## 8. Recommended first increment

**Route every life entrance in `LifeCounter.jsx` through a pure, closed-domain `src/pillars/matchLife.js`, delivered in two reviewed stages.** Stage A is a verbatim extraction (no behavior change). Stage B closes the domain, adds validated restore, and single-sources the ≤20 invariant (intended behavior change).

### Affected symbols and source regions (author-verified)

- `change` ([L351-378](../../src/pillars/LifeCounter.jsx#L351)) — the floor-refusal predicate (L372) and the `Math.min(cur.max, cur.life+delta)` clamp + `next===cur.life` no-op (L374-375) move to the module. `dd.tap(who)` (L364) and the FAB-dismiss return (L365) **stay**.
- `setMax` ([L401-404](../../src/pillars/LifeCounter.jsx#L401)) — the `Math.min(cur.life, max)` life-follow moves; `commitLife`/`setSheet`/`force` stay.
- `reset` ([L406-415](../../src/pillars/LifeCounter.jsx#L406)) — uses the module's seed helper; all effect/teardown stays.
- Init ([L47](../../src/pillars/LifeCounter.jsx#L47), [L50-51](../../src/pillars/LifeCounter.jsx#L50-L51)) — fresh seed via `initSide`; **resume via `restoreSide`** (Stage B).
- The single write funnel preserved throughout: `commitLife` (L~212) — the module *feeds* it; it is never replaced, so `dd.syncLife` crossing detection stays authoritative (Minor 1).

### Public API (final, Stage B; JSDoc-typed)

```js
/** @typedef {{ life: number, max: number }} Side */
/** @typedef {-1 | 1} Dir */

export const LIFE_CAP = 20;
export const MIN_MAX  = 1;

// FAIL LOUD ON NON-FINITE INPUT. Every entrance rejects NaN / Infinity / non-number
// BEFORE any clamp: a bare Math.min/Math.max would propagate NaN and silently defeat
// the boundary (a caller that bypasses isValidSnapshot, or a stray settings value).
// A shared `finite(n)` guard throws — the ddArming.assertSide precedent applied to
// values as well as to `dir`. This keeps "the one place" true for EVERY invocation.
// (Codex Rev-2 non-blocking follow-up; adopted as fail-loud.)

/** Fresh-match seed. Enforces MIN_MAX..LIFE_CAP once, here. Throws on non-finite seed. */
export function initSide(seedMax)            // -> Side  { life: clamp(1,20,seedMax), max: same }

/** THE RESUME ENTRANCE. Clamps a snapshot's fields to the SAME invariant every other
 *  entrance enforces: max -> [1,20], life -> [0, max]. This is the entrance that is
 *  unguarded today (ongoingMatch.js:18-22 / LifeCounter.jsx:50-51). */
export function restoreSide({ life, max })   // -> Side

/** One step. CLOSED DOMAIN: dir must be -1 | 1 — throws otherwise (ddArming.assertSide
 *  precedent). Reproduces today's reachable arithmetic exactly: cap at max, and the
 *  door-holds refusal at/under zero. */
export function applyStep(side, dir)         // -> { side: Side, changed: boolean, refused: boolean }
//   refused : side.life <= 0 && dir < 0     (the L372 "door holds" case)
//   changed : life actually moved           (not a capped no-op, L375)

/** Change max; life follows down; max clamped [1,20]. */
export function applyMax(side, nextMax)      // -> Side
```

Returned flags are **only** `changed` and `refused` (+ the next `side`) — `fell`/`recovered` are **not** returned; crossings stay owned by `commitLife → dd.syncLife` (Minor 1, single-source rule).

### Stage A vs Stage B — the honest sequence (Codex Major 2 & 3)

- **Stage A (Standard, behavior-preserving).** Extract the arithmetic **verbatim**: `stepLife(side, delta)` accepting the current open integer delta and reproducing `Math.min(cur.max, cur.life + delta)` plus a separate `refusedAtFloor(side, delta)` predicate mirroring L372 exactly — including the currently-unreachable quirk that a delta more negative than current life would compute a negative result (the UI never emits it, so this is faithful, not a bug introduced). Point the component's existing call-sites at these. **No behavior change for any input.** Tests characterize this from **direct source inspection** (not a shim) and are honest that they execute the new module, with equivalence to the component established by the verbatim diff + device observation (§10, §12).
- **Stage B (High-risk, intended behavior change).** Replace `stepLife`→`applyStep` with the closed `-1 | 1` domain + runtime guard (so the negative-life quirk becomes structurally impossible and the "never below zero" property becomes *true*); add `restoreSide` and route resume through it; make `initSide`/`applyMax` enforce `1..20`. **Behavior changes only for unreachable/invalid inputs:** an out-of-range resumed snapshot clamps to 20; a non-`±1` delta throws. New invariant/property tests assert the *new* contract (§10).

### Dependencies allowed / prohibited

Allowed: none beyond the language. Prohibited: any import from `store/`, `components/`, `native.js`, `feedback.js`, React, `window`, timers. If the module needs one, the boundary is wrong — stop (§3).

### Acceptance criteria

- **Stage A:** `matchLife.test.mjs` passes; the diff is a literal move + call-site swap; device shows no observed behavioral or visual difference across the enumerated scenarios (§13). `test:ui`/`test:query`/`build`/`check:docs` green.
- **Stage B:** `applyStep` throws on any dir ∉ {−1,+1}; **every entrance throws on non-finite input** (NaN/Infinity/non-number); `restoreSide({life:50,max:999})` → `{life:20,max:20}`; property tests hold over a range (never `life>max`, `life<0`, `max>20`, `max<1`); a `pMax:999` **resume** now yields 20 on device; a normal in-range resume is unchanged on device. Human approval (§19) recorded before merge.

### Stopping point

When every life entrance flows through `matchLife.js`, the ≤20 invariant is single-sourced, Stage B's behavior change is verified on device, and both stages are green and revertible — **stop.** Do not proceed to the phase machine (§16) without a fresh proposal.

---

## 9. Proposed module/API design

Design rationale against the two precedents:

- **From `ddArming.js`:** a pure function returning `{ nextState, whatHappened }`; the component owns effects; **fail loud** on invalid input — `applyStep` throws on a non-`±1` dir exactly as `assertSide` throws on an unknown side. This is what closes Codex Major 3: the domain is closed, not silently clamped.
- **From `avatarPickerState.js`:** the ≤20 invariant is a *derivation at every entrance*, never stored-then-trusted (Constitution §4.4). `restoreSide` is the entrance that was missing; adding it is what makes "the one place" true (Codex Major 1).
- **Improving on `ddArming`'s two documented flaws** (do not copy them): (a) it mirrors derived phase into first render via an `eslint-disable react-hooks/rules-of-hooks` mutate-in-render — `matchLife` avoids this by exposing `initSide`/`restoreSide` the component passes straight into its `useRef` initializers (L50-51 become `useRef(restoreSide(resume) )` / `useRef(initSide(start))`). (b) `ddArming` splits truth (phase in module, life in component); `matchLife` owns the life *rules* while the component holds the *value* in its refs.

---

## 10. Characterization and regression test plan

Following the `ddArming.test.mjs` idiom (`node --test`, co-located `.mjs`). **The copied-shim method from Rev 1 is withdrawn (Codex Major 2).**

### Stage A — characterization from direct source inspection

The expected table is derived by reading `change`/`setMax`/`reset` (cited lines), not by copying logic into a shim. It executes the **new module**; equivalence to the component rests on (i) the diff being a verbatim move, reviewable line-for-line, and (ii) device observation (§13). This is stated in the test header, honestly.

| Input | Expected (today's reachable arithmetic) |
|---|---|
| `stepLife({life:20,max:20}, +1)` | `changed:false` (capped no-op, L375) |
| `stepLife({life:20,max:20}, -1)` | `{life:19}`, `changed:true` |
| `stepLife({life:1,max:20}, -1)` | `{life:0}`, `changed:true` |
| `refusedAtFloor({life:0,max:20}, -1)` | `true` (door holds, L372) |
| `stepLife({life:0,max:20}, +1)` | `{life:1}`, `changed:true` |
| `applyMax({life:15,max:20}, 10)` | `{life:10,max:10}` (L403) |
| `initSide(20)` | `{life:20,max:20}` |

*(Stage A does **not** assert "never below zero" — under the verbatim open-delta contract it would be false for an unreachable −5. That assertion belongs to Stage B, which is the whole point of Codex Major 3.)*

### Stage B — behavior-change + invariant tests

| Input | Expected (new contract) |
|---|---|
| `applyStep(side, -5)` | **throws** (closed domain) |
| `applyStep(side, 0)` | **throws** |
| `restoreSide({life:999,max:999})` | `{life:20,max:20}` — the fix |
| `restoreSide({life:5,max:10})` | `{life:5,max:10}` — in-range unchanged |
| `restoreSide({life:99,max:10})` | `{life:10,max:10}` — life clamped to max |
| `restoreSide({life:NaN,max:20})` | **throws** (non-finite) |
| `applyMax(side, Infinity)` | **throws** (non-finite) |
| `initSide('20')` | **throws** (non-number) |
| property: `applyStep` over any reachable `side` | never `life>max`, `life<0`, `max>20`, `max<1` |
| `initSide(999)` | `{life:20,max:20}` |

**Not covered, honestly** (mirroring `ddArming.test.mjs`'s own disclosure): the numeral roll animation, haptic feel, and pointer hit-testing are DOM/compositor behavior with no harness here — device-verified (§13), never claimed from the unit test.

---

## 11. Implementation stages and checkpoints

Two checkpoints, Constitution §12 format:

```
## Checkpoint: Stage A — matchLife extracted verbatim
- Completed: matchLife.js (verbatim fns) + matchLife.test.mjs (characterization); call-sites swapped
- Remaining: Stage B
- Divergence: <none | describe>
- Risks/assumptions: behavior-preserving for all reachable inputs; resume bypass still present (closes in B)
- Verification: test:ui / test:query / build / check:docs + device notes (no observed difference)
- Decision requested: proceed to Stage B

## Checkpoint: Stage B — closed domain + validated restore (BEHAVIOR CHANGE)
- Completed: applyStep closed domain + guard; restoreSide; enforced 1..20/0..max at every entrance; flags trimmed
- Remaining: none in this increment
- Divergence: intended behavior change on invalid/unreachable input only (999-snapshot -> 20; non-±1 -> throw)
- Risks/assumptions: no reachable-input behavior changed; SNAP_VERSION unchanged (read-clamp is compatible)
- Verification: invariant tests + device (999 resume -> 20; normal resume unchanged)
- Decision requested: human approval of the behavior change (§19) before merge
```

---

## 12. Verification plan

- **Automated:** `npm run test:ui` (new fixtures + existing `ddArming`/`avatarPicker` stay green), `test:query`, `build`, `check:docs`. Exact results reported, never "expected to pass."
- **Regression:** existing `test:ui` green is evidence nothing was traded away.
- **Manual browser** (§13): fresh full + quick match — tap up caps at 20, tap down floors at 0, minus-at-zero refuses with the heavy haptic/animation, max change pulls life down; roll-off and end unaffected. **Stage B:** seed a `localStorage` ongoing snapshot with `pMax:999`, resume, confirm max shows 20.
- **Native/Capacitor** (§13): the same in the installed **release** APK (life/tap/haptic are engine- and plugin-sensitive).
- **Zero-image** (§13): exercise with `localStorage['cx-no-images']='1'` per the release gate, since the surface is touched.

---

## 13. Runtime and device considerations

- **Cross-runtime:** the reducer is pure and identical across runtimes, but its callers fire haptics/keep-awake/immersive that differ in the WebView. Verify on the installed **release** APK (`assembleRelease`, never debug — `BUILD.md`), not only a browser (Gecko ≠ the Chromium WebView).
- **Resume:** exercise minimize→resume explicitly. Stage A must leave it identical; Stage B intentionally clamps an out-of-range snapshot — verify both the 999→20 case and that a normal in-range resume is unchanged.
- **Zero-image:** release gate applies to any touched surface.
- **Build discipline:** any device install → bump `package.json` `build` +1 and add a changelog entry (`BUILD.md`), independent of this proposal.
- **Recording language:** report "no observed behavioral or visual difference across the enumerated scenarios," with device, OS, WebView version, build type, and observations recorded (Codex Minor 2). "Byte-for-byte identical" is withdrawn.

---

## 14. Documentation impact

| Document | Disposition |
|---|---|
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Unaffected by the increment.** Pillar boundaries/dependency direction unchanged. A note on the "pure-state-module beside the pillar" pattern would belong here only if the §16 roadmap is later adopted. |
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) | **Review — likely a one-line note (Stage B).** If this doc records the ongoing-match snapshot validation contract, it should note that restoration now enforces `1..20 max / 0..max life` (no `SNAP_VERSION` change). If it does not mention snapshot validation, **unaffected.** Confirm at implementation. |
| [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Unaffected.** Every Play capability is preserved; the ≤20 invariant (its §5.2 / life-counter row) is *strengthened*, not changed in contract. Resume still resumes; it just cannot resume an impossible life total. |
| [`BUILD.md`](../../BUILD.md) | **Reviewed, no change.** Already documents `test:ui` and the pure-module pattern. |
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) | **Unaffected.** No process change. |
| [`AGENTS.md`](../../AGENTS.md) | **Unaffected.** (A future `check:types` gate would touch §5 — deferred, §7.) |

`npm run check:docs` must pass at completion; each doc reported as updated or reviewed-with-reason (Constitution §13).

---

## 15. Rollback and recovery

- **Code:** each stage is one commit. Stage A revert restores the prior inline arithmetic exactly; Stage B revert restores the pre-fix (bypass-present) behavior. No point of no return.
- **Data (Stage B):** the change is **read-side clamping only** — it never rewrites stored snapshots, so there is nothing to migrate and no `SNAP_VERSION` bump (clamping on read is backward-compatible: in-range snapshots are untouched; out-of-range ones were already the defect). If Stage B were reverted, a previously-clamped session simply reverts to accepting the out-of-range value — nil-cost recovery, because that acceptance *was* the bug.
- **Partial-failure:** Stage A can ship without Stage B (leaving the bypass, as today) if the human defers the behavior change; Stage B cannot ship without Stage A.

---

## 16. Follow-on roadmap

Ordered by value-over-risk. **Each is a separate proposal; approving this increment authorizes none of them.** A surface earns an extraction only when a concrete invariant or demonstrated bug justifies it (as `matchStats.js`/`ddArming.js` did).

1. **LifeCounter durable autosave (§5.2)** — `pagehide`/`visibilitychange` `saveOngoing`, mirroring `db.js`. High-value durability; High-risk.
2. **LifeCounter phase/roll-off machine + pure snapshot build/restore pair (§5.3)** — the large lifecycle extraction; makes start→resume→end→record testable with fake timers.
3. **Collection `listGoalModel.js` + `importPlan.js` (§5.5)**, then the three-way reducer unification onto `useOwnedLedger` — the unification is the prize and the risk.
4. **App `navStack`/`resolveBack` + `profileResetState` (§5.7)** — formalizes back-order, deletes the seven dead rows. Last (blast radius).
5. **Type-safety Option-A diagnostic (§7)** — only after (2)/(3) create typed boundaries their callers import.

*(The Rev 1 "cap-fix micro-decision" is no longer a roadmap item — it is folded into this increment's Stage B, per Codex Major 1.)*

**Continue-signal:** proceed only when the previous item shipped with no observed reachable-behavior change, its tests caught a real edge, and the result read as *less* indirection, not more (§17, §18 Q8).

---

## 17. Risks and unresolved questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Stage A is not truly verbatim (a missed branch in `change`/`setMax`) | Medium | High — silent life-tracking regression | Source-inspection table written first; verbatim diff reviewable line-for-line; device verification |
| Stage B clamp changes a *reachable* (in-range) resume unexpectedly | Low | High | Property tests + explicit device check that a normal resume is unchanged; stop-condition in §3 |
| `applyStep`'s `{changed,refused}` contract misses a case `change` relies on | Medium | Medium | Derive the flag set by reading every branch of `change` (L351-378) before finalizing; stop if a branch doesn't map |
| Reviewer judges even the combined increment ceremony-over-value | Low–Medium | Low | The payoff is a closed safety boundary + a real fix, not a line move; the §7 one-line-clamp fallback exists if so |
| Roadmap read as pre-approved | Low | Medium | §16 states each needs its own proposal |

**Unresolved, genuinely open:**
1. ~~Should Stage B block or merge-behind Stage A?~~ **Resolved (Codex, Rev 2 review): gate together.** Stage A remains a separate commit and an internal review checkpoint, but does **not** merge or ship on its own — alone it adds indirection, leaves the cap bypass live, and does not reach the safety-boundary outcome. Both stages merge together after final approval. Awaiting the human's ratification of this in §19 decision 3.
2. Does `COMPENDIUM_DATA_MODEL.md` document the snapshot-validation contract? If yes, Stage B carries a one-line doc update; if no, none (§14). Confirm at implementation.
3. Does `Play.jsx` need anything? Discovery says no; confirming "leave it alone" is a valid disposition.

---

## 18. Self-Critique

1. **Strongest reason this is wrong:** even combined, the increment moves ~40 lines of arithmetic plus a clamp, and a skeptic can say a one-line resume clamp (§7 fallback) fixes the *only* urgent thing (§5.1) with none of the extraction. My answer: the extraction is what makes the invariant *structural* (one entrance function) rather than a fifth scattered clamp — but the fallback is real, and if the owner values only the fix, they should take it and skip the module. I would not fight that hard.
2. **Highest-consequence assumption if false:** that Stage A is genuinely verbatim. A mis-modeled branch in a *life counter* is the worst regression here. Mitigated by source-inspection-first tests and a line-for-line reviewable diff — but it remains load-bearing, which is why Stage A is walled off from the behavior change.
3. **Simpler option rejected, fairly?** The one-line resume clamp with no extraction. Fair, and it now lives explicitly as the §7 fallback and §18 Q1 — not buried.
4. **Coupling possibly missed:** `commitLife → dd.syncLife` owns life-crossing detection for Death's Door. By returning only `{changed,refused}` and **not** `fell/recovered` (Minor 1), the reducer cannot become a second, drifting crossing source. But the increment must feed `commitLife` unchanged; if it ever reroutes `dd` through reducer flags, that is a different, safety-critical change and out of scope.
5. **Failure most likely to escape the tests:** anything DOM — the roll landing on the wrong value, a haptic on a capped no-op, the pill arming under a finger. The unit tests explicitly cannot see these (§10); device verification is the only net, and the proposal says so.
6. **Evidence that would change direction:** if reading `change`/`setMax` shows the arithmetic is already effectively one clamp (the "four sites" are really one), the extraction's value shrinks toward the §7 fallback. If Stage A can't be written without a DOM, the boundary is wrong and the increment is abandoned.
7. **How this could become fragmented indirection:** a reader who today sees the clamp inline must now open `matchLife.js`. Justified *only* because the clamp is an invariant with four (soon five) entrances and the module is testable. The §16 items must each clear that bar alone; the roadmap is not a licence.
8. **When to stop refactoring:** when a surface looks like `Play.jsx` — no untested invariant, no duplicated decision left in the component. Length alone is never the trigger (§2); a hidden rule or a clobber race is. When the §16 continue-signal stops being met, the roadmap ends.

---

## 19. Approval requested

**One recommended first increment:** route every life entrance through a pure, closed-domain `src/pillars/matchLife.js` — `initSide`, `restoreSide`, `applyStep(-1|1)`, `applyMax`, `LIFE_CAP` — delivered as **Stage A** (verbatim, Standard, behavior-preserving) then **Stage B** (closed domain + validated restore + single-sourced ≤20 invariant; intended behavior change; High-risk).

**Exact acceptance criteria:** §8 ("Acceptance criteria") and the §10 Stage A / Stage B matrices.

**Proposed review checkpoints:** the two in §11 — reported before each merge, with exact command results and device notes.

**Decisions required from the human owner:**
1. Approve the first increment as scoped (**High-risk**, includes an intentional behavior change on the durable resume path), or redirect the first surface.
2. **Approve Stage B's behavior change** specifically: an out-of-range resumed snapshot clamps to 20, and non-`±1` tap deltas throw (both currently unreachable from the UI; the resume path can carry a corrupt/legacy snapshot). This is the approval Codex's Major 1 requires.
3. Ratify the stage-gating: Codex's review resolved §17 Q1 to **gate both stages together** (Stage A is an internal checkpoint/commit, not an independent merge). Confirm or override.
4. Acknowledge the §16 roadmap as a **map, not an approval**.

Recommended sequence once approved (per Codex): human approves the complete increment → implement Stage A → Codex reviews the Stage A diff + evidence → implement Stage B → final automated + browser + zero-image + installed-release verification → Codex reviews the complete two-commit diff → merge both together.

**No implementation has begun. No production code, test, configuration, or existing document has been modified.** This proposal (Rev 2) is the only artifact produced. Stopping here for Codex's re-review and your decision.

---

## 20. Review-response ledger (Rev 1 → Rev 2)

| # | Finding | Disposition | Resolution |
|---|---|---|---|
| Major 1 | Invariant remains false after extraction (uncapped resume) | **Accepted** | Chose Codex's recommended option 1: `restoreSide` added as the resume entrance; ≤20 enforced at *every* entrance; increment reclassified **High-risk** with explicit human approval (§3, §8, §19). The Rev 1 "deferred micro-fix" is withdrawn and folded in (§16). |
| Major 2 | Copied-shim characterization is circular | **Accepted** | Shim withdrawn. Stage A characterization is now source-inspection-derived and honestly scoped: tests execute the new module; equivalence rests on a verbatim, line-reviewable diff + device observation (§10, §8). |
| Major 3 | Delta contract wider than behavior | **Accepted** | Domain closed to `Dir = -1 \| 1` with a runtime guard (`ddArming.assertSide` precedent). "Never below zero" is now a Stage B property that holds *because* the domain is closed, not asserted against open-delta verbatim arithmetic (§8, §9, §10). |
| Minor 1 | Returned flags broader than needed (`fell`/`recovered`) | **Accepted** | Trimmed to `{ changed, refused }` + next side; crossings stay single-sourced in `commitLife → dd.syncLife` (§8, §9, §18 Q4). |
| Minor 2 | "Byte-for-byte identical" overstates manual proof | **Accepted** | Replaced with "no observed behavioral or visual difference across the enumerated scenarios," recording device/OS/WebView/build/observations (§12, §13). |
| Follow-up (Rev 2 review) | Non-finite input (NaN/Infinity) behavior undefined at the boundary | **Accepted — fail-loud** | Every entrance (`initSide`/`restoreSide`/`applyMax`/`applyStep`) throws on non-finite/non-number input before any clamp, via a shared `finite()` guard (the `assertSide` precedent for values). Tests added to the Stage B matrix (§8, §9, §10). Non-blocking; captured here so implementation cannot lose it. |
| Gating (Rev 2 review) | Stage A must not merge/ship alone | **Accepted** | Both stages gate together; Stage A stays an internal checkpoint (§17 Q1, §19). |

*Note on `.claude/` (raised in review): it is an untracked local session/config directory, not part of this or any proposed change; the tracked tree remains untouched.*

---

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted Rev 1 | 2026-07-17 |
| Codex (reviewer) | Changes required (3 Major, 2 Minor) | 2026-07-17 |
| Claude Code (author) | **Resubmitted Rev 2** (all findings accepted) | 2026-07-17 |
| Codex (reviewer) | **Approved with non-blocking follow-ups** (non-finite fail-loud; gate stages together) | 2026-07-17 |
| Claude Code (author) | Folded both follow-ups into the artifact (§8–§10, §17, §19, §20) | 2026-07-17 |
| Human (approver) | **Approved** — implement on branch; establish baseline + record metrics theoretically and on device | 2026-07-17 |
| Claude Code (author) | Implemented Stage A → Stage B → build 61 device verification; Stage A checkpoint reviewed by Codex | 2026-07-17 |
| Codex (reviewer) | Stage A **Approved to proceed**; complete-diff **Changes required** (3 Major) | 2026-07-17 |
| Claude Code (author) | Resolved all 3 Major (`validateSide` input guard; cap single-sourced; metrics corrected + deviation framed) | 2026-07-17 |
| Codex (reviewer) | **Approved** — contingent only on the owner accepting the metric-#9 verification deviation | 2026-07-17 |
| Human (approver) | **Accepted the verification deviation and approved merge** (threat model negligible for an offline single-user counter; value is the pattern + structural invariant) | 2026-07-17 |
| — | **Merged to `main`** (both stages together, per the gate-together decision) | 2026-07-17 |
