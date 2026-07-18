# Proposal: extract the roll-off decision core (`matchRoll.js`)

## Status and classification

**Status: Rev 2 — revised after review; awaiting re-review** · Risk: **Standard** (behavior-preserving extraction on the LifeCounter opening-ceremony path; device smoke check, lighter than the durable-resume gate)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-18 · Roadmap §16 #2, **second of two slices** (slice 1, the snapshot build/restore pair, merged as `d17d5ca`). **No implementation has begun.**

> **Rev 2 (all findings accepted):** the RNG test fixtures are corrected — a constant RNG (`() => 0`) deadlocks `rollOutcome` by design, so the bounds and tie tests now use **scripted multi-value sequences** that reach a distinct result, and the tie test uses **two consecutive tie re-rolls** so it actually falsifies a `while`→`if` regression. The injected-RNG **precondition** (values in `[0,1)`, must eventually yield a roll distinct from `pRoll`; no production retry cap) is documented on `rollOutcome`. The "phase vocabulary in one place" claim is **narrowed** to "three named phase decisions" — `LifeCounter` keeps its own phase literals in `rollCls`, the pill JSX, and the timer transitions. All four exports approved to ride along.

## Problem and success criteria

**The turn-order roll-off's decisions are inline, untested magic in a 1000-line component.** The contest that decides who plays first — two d20 rolls, re-rolled on a tie, higher roll wins — lives inside `LifeCounter._tumble` (`src/pillars/LifeCounter.jsx:455-458`), interleaved with the odometer animation, timers, and haptics. The phase vocabulary is scattered string literals: the opening phase is `resume ? null : 'armed'` (`:61`), the DD-suppression guard is `rollPhase === 'windup' || rollPhase === 'rolling' || rollPhase === 'result'` (`:277`), the start guard is `rollPhase !== 'armed'` (`:444`). None of it is tested, and the fairness invariant (winner is the strictly-higher roll, never a tie) is asserted nowhere.

Consequence: the contest is one careless edit from a subtle unfairness (a `while`→`if` on the tie re-roll would let equal rolls resolve to a fixed side; flipping the comparison would hand the win to the loser), and there is no test to catch it. The resume-skip rule — **a resumed match must never re-enter the ceremony**, because turn order was already decided — is a bare inline ternary with nothing naming or guarding it. This is exactly the surface slice 1 named as the deferred second half of roadmap #2.

**Success criteria**

1. One pure **pillar-layer** module, `src/pillars/matchRoll.js` (DOM/timer/haptic-free, mirrors `matchLife.js`), owns the roll-off **decisions**: the contest outcome and the phase predicates.
2. `rollOutcome(rng)` is the single definition of the contest, with the fairness invariant **proven by test**: two distinct d20 rolls, both in `[1,20]`, and the winner's roll is `max(pRoll, eRoll)`. `rng` is injectable so the tie path and the bounds are deterministic in tests — via **scripted multi-value sequences**, since a constant RNG cannot produce a no-tie outcome (see the precondition below).
3. **Three phase decisions** are named and centralized — **not** the complete phase vocabulary: `LifeCounter` keeps its own phase literals in `rollCls` (`:634-638`), the pill JSX (`:807-812`), `finishRollOff`, and the timer transitions. What moves is the three *decisions/guards*: `initialRollPhase(isResume)` (the resume-skip invariant), `isRollLocked(phase)` (the DD-suppression guard), and `canStartRoll(phase)` (the start guard). `LifeCounter` routes those three through the module.
4. **Zero behavior change** — same die, same tie handling, same winner rule, same phases, same timing/animation. The ceremony (odometer tumble, timers, haptics, aria, birth/colour) is untouched and stays in the component.

**Non-goals**

- **The ceremony itself.** The odometer tick animation (`:467-505`), the `setTimeout` chain (windup→tumble→roll→done→finish), haptics, aria wiring, the curtain remount (`openSeq`), and the `birth`/colour coupling stay in `LifeCounter`. They are presentation, not decisions, and have no invariant a pure test would protect.
- **Fake-timer lifecycle testing.** The roadmap line mused about making "start→resume→end→record testable with fake timers." That needs a DOM/timer harness the project deliberately does not have (component behavior is verified on device). This slice delivers the *decision* core that testability rests on; a timer harness is out of scope and not proposed.
- **The transition sequence as a reducer.** Modeling `armed→windup→rolling→result→null` as a pure `reduce(phase, event)` is deliberately **rejected** (see Options) — it would add indirection the component doesn't need, against the §16 continue-signal ("less indirection, not more").
- Any change to `birth`, Death's Door, the snapshot, or timing.

## Evidence and current architecture

- `LifeCounter.jsx:455-458` — the contest, inline in `_tumble`:
  ```js
  const d20 = () => 1 + Math.floor(Math.random() * 20);
  let pVal = d20(), eVal = d20();
  while (eVal === pVal) eVal = d20();
  const winner = pVal > eVal ? 'player' : 'opponent';
  ```
  `pVal`/`eVal` become the landed odometer faces (`:484`); `winner` drives the verdict styling and aria (`:506-517`).
- `LifeCounter.jsx:61` — `useState(resume ? null : 'armed')`: the opening phase, and the resume-skip rule.
- `LifeCounter.jsx:277` — `const rollLocked = rollPhase === 'windup' || rollPhase === 'rolling' || rollPhase === 'result';` drives `overlayOpen`/`centredOverlay` and therefore DD-suppression (`:280-283`). One uninterrupted interval across the three ceremony phases is load-bearing (the comment at `:273-276` explains why it must not dip between phases).
- `LifeCounter.jsx:444` — `if (rollPhase !== 'armed') return;` the start guard in `startRollOff`.
- `LifeCounter.jsx:234` — `if (!resume) armRollOff();` a resumed match never arms; paired with `:61` and the `birth` seed at `:80` (`resume ? 1 : 0`).
- Precedent pure **pillar** module: `matchLife.js` — DOM-free life/max rules, node-tested under `npm run test:ui`, injected/consumed by `LifeCounter`. `matchRoll.js` sits beside it at the same layer, same test runner, same "provable without a DOM" charter.
- Sole consumer: `LifeCounter.jsx` (grep of `rollPhase`/`rollOff`/`Roll for Turn` finds no other file).

## Assumptions and confidence

1. **The contest at `:455-458` is the whole decision; everything else in `_tumble` is presentation.** Confidence: **high** — the rest of `_tumble` mutates DOM (`textContent`, `classList`, `--tk`) and schedules timers; only the four lines above decide anything.
2. **`rollOutcome` returning `{ pRoll, eRoll, winner }` covers every downstream use.** Confidence: **high** — the component needs both faces (to display) and the winner (to style/aria); nothing else is derived from the roll.
3. **The default `rng = Math.random` keeps behavior identical.** Confidence: **high** — same generator, same `1 + floor(rng()*20)` mapping, same tie loop.
4. **The phase predicates are behavior-identical substitutions.** Confidence: **high** — `isRollLocked`/`canStartRoll`/`initialRollPhase` are the same boolean/return expressions, relocated. Named `isRollLocked` (not `rollLocked`) precisely to avoid shadowing the existing local at `:277`.

## Affected systems and invariants

- **Eight §3 invariants:** none is touched. This is pure opening-ceremony UI logic — no catalog/profile boundary, no persistence, no schema, no user-data transaction, no image path, no content parsing.
- **Cross-runtime integrity (§3.8):** the module is pure and runtime-identical. The one intentional nondeterminism (the die) is unchanged and lives behind the injectable `rng`; web and native run the same code.
- **Turn-order fairness (product invariant, currently untested):** *hardened* — the "distinct rolls, higher wins" rule becomes a proven property instead of inline code.
- **Resume-skip (product invariant):** *hardened* — "a resumed match never re-rolls" becomes a named function (`initialRollPhase`) with a test, instead of a bare ternary.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** (contest + phase strings inline in `_tumble`/`LifeCounter`) | Rejected — an untested fairness invariant on a one-edit-from-wrong surface. |
| **Pure `matchRoll.js`: `rollOutcome` + phase predicates, `LifeCounter` routed through it** (proposed) | **Recommended.** Smallest change that makes the contest provable and names the phase rules; mirrors `matchLife`. |
| Also extract the transition sequence as `rollReduce(phase, event)` | Rejected — the component sets each phase imperatively inside its own timer callbacks; a reducer adds a layer without removing one. Fails the "less indirection" continue-signal. |
| Also extract `rollSideClass`/`rollWords` (the verdict CSS/text from `:634-661`) | Rejected for this slice — they are view-formatting (return class strings / JSX). Could be a later micro-extraction if a bug ever justifies it; not invariant-bearing today. |
| Extract the whole ceremony (timers/DOM/haptics) for fake-timer tests | Rejected — needs a harness the project doesn't have; high-risk rewrite of working animation for little invariant gain. |

## Proposed design

**`src/pillars/matchRoll.js` (pure):**
```js
// The turn-order roll-off's decision core - pure, DOM/timer/haptic-free, so contest fairness
// and the phase guards are provable without a running component. Run: npm run test:ui
//
// SCOPE: this owns the DECISIONS, not the ceremony. The odometer tumble, the timers, the
// haptics, the aria wiring, and the birth/colour coupling stay in LifeCounter - they are
// presentation with no invariant a test would protect. What lives here has one:
//   - rollOutcome     : the d20 contest is fair - two DISTINCT rolls, winner is strictly higher.
//   - initialRollPhase: a RESUMED match never re-enters the ceremony (turn order already set).
//   - isRollLocked    : the ceremony-owns-the-screen guard that gates DD-suppression.
//   - canStartRoll    : only an armed offer may start a roll (no double-roll).

/** @typedef {'armed'|'windup'|'rolling'|'result'|null} RollPhase */
/** @typedef {'player'|'opponent'} Side */

export const ROLL_DIE = 20;   // turn order is a d20 roll-off

/**
 * The turn-order contest. Two d20 rolls, re-rolled until DISTINCT (a tie has no winner), and
 * the winner is the side that rolled strictly higher. Pure given `rng`; inject a deterministic
 * rng in tests. Provable invariant: pRoll !== eRoll, both in [1, ROLL_DIE], and the winner's
 * roll === max(pRoll, eRoll).
 *
 * PRECONDITION: `rng` returns values in [0, 1) and must EVENTUALLY yield a roll distinct from
 * pRoll. A permanently constant rng (e.g. `() => 0`) makes every roll equal and the tie re-roll
 * loops forever - that is by design: a fair contest has no valid tied outcome, and a production
 * retry cap would change behavior (a capped tie would have to invent a winner). Math.random
 * satisfies the precondition with probability 1.
 * @param {() => number} rng  0 <= rng() < 1, eventually distinct from pRoll; defaults to Math.random
 * @returns {{ pRoll: number, eRoll: number, winner: Side }}
 */
export function rollOutcome(rng = Math.random) {
  const d20 = () => 1 + Math.floor(rng() * ROLL_DIE);
  const pRoll = d20();
  let eRoll = d20();
  while (eRoll === pRoll) eRoll = d20();
  return { pRoll, eRoll, winner: pRoll > eRoll ? 'player' : 'opponent' };
}

/**
 * The phase a match OPENS in. Fresh match arms the offer; a resumed match already rolled for
 * turn order, so it opens with no ceremony (null). This is the resume-skip invariant, named
 * once instead of a scattered `resume ? null : 'armed'`.
 * @param {boolean} isResume  @returns {RollPhase}
 */
export function initialRollPhase(isResume) {
  return isResume ? null : 'armed';
}

/**
 * True while the ceremony owns the screen (windup -> rolling -> result): ONE uninterrupted
 * interval, so DD-suppression cannot dip between phases. 'armed' is NOT locked - the offer
 * coexists with live life tracking.
 * @param {RollPhase} phase
 */
export function isRollLocked(phase) {
  return phase === 'windup' || phase === 'rolling' || phase === 'result';
}

/** The one legal entry: only an armed offer may start a roll (guards double-roll). */
export function canStartRoll(phase) {
  return phase === 'armed';
}
```

**Consumers (`LifeCounter.jsx`, all behavior-identical swaps):**
- `_tumble` `:455-458` → `const { pRoll: pVal, eRoll: eVal, winner } = rollOutcome();` (the rest of `_tumble` — faces, ticks, timers — unchanged).
- `:61` → `useState(initialRollPhase(!!resume))`.
- `:277` → `const rollLocked = isRollLocked(rollPhase);` (local name kept; import is `isRollLocked`, so no shadow).
- `:444` → `if (!canStartRoll(rollPhase)) return;`.

**Deliberately left in `LifeCounter`:** the `birth` resume seed (`:80`, `resume ? 1 : 0`) is birth-system state with its own writer (`setBirth`), not a roll phase — it stays. `armRollOff`/`startRollOff`/`_tumble`/`_rollDone`/`finishRollOff`/`fadeOutRoll` keep their timer/DOM/haptic bodies; only the four decision points above change.

## Implementation plan

1. Add `src/pillars/matchRoll.js` + `matchRoll.test.mjs` (contest invariant with a seeded rng incl. the tie path and the `[1,20]` bounds; `initialRollPhase`; `isRollLocked`; `canStartRoll`). **Checkpoint:** `test:ui` green.
2. Route the four decision points in `LifeCounter` through the module. **Checkpoint:** `test:ui`/`test:query`/`test:codex`/`build`/`check:docs` green; `git diff --check` clean; diff is a four-point swap plus one import.
3. Device smoke on the installed build: a fresh **full** match rolls (pill → Roll for Turn → tumble → verdict → countdown → unlock) and a fresh **quick** match likewise; a **resumed** match opens with **no** ceremony (coloured, tracking live) — the resume-skip invariant, on device.

## Data migration and compatibility

**Not applicable** — no persisted data, format, or schema. Pure logic relocation.

## Documentation impact

Per Constitution §13, every source-of-truth document is classified:

| Document | Disposition |
|---|---|
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Update — short note.** Record `matchRoll.js` as a pure pillar-layer decision module beside `matchLife.js` (Play pillar), DOM-free, `test:ui`. |
| [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Reviewed — no change.** Roll-off behavior (fairness, resume-skip) is preserved exactly. |
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) | **Reviewed — no change.** No data/schema/persistence touched. |
| [`BUILD.md`](../../BUILD.md) | **Reviewed — no change.** Existing installed-app match workflow supplies the device smoke. |
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) / [`AGENTS.md`](../../AGENTS.md) | **Reviewed — no change.** No process change. |

## Rollback and recovery

One-commit revert per checkpoint; no persisted-format change, nothing to migrate. Reverting step 2 restores the inline contest/predicates verbatim.

## Verification plan

- **Automated (load-bearing):** `matchRoll.test.mjs` under `test:ui`. A `scripted([...])` rng helper returns the next value per call and exposes `.calls()`; **every fixture ends on a value distinct from `pRoll`** so `rollOutcome` terminates (a constant rng deadlocks by design — the precondition above).
  - **Contest invariant** across many draws from a seeded (LCG) rng: `pRoll !== eRoll`, both in `[1,20]`, `winner`'s roll `=== max(pRoll,eRoll)`, `winner ∈ {player,opponent}`.
  - **Tie path — falsifies `while`→`if`:** an rng with **two consecutive tie re-rolls** before a distinct value:
    ```js
    // p=10, e=10 (tie), e=10 (tie again), e=11 (distinct)
    const rng = scripted([0.45, 0.45, 0.45, 0.50]);
    assert.deepEqual(rollOutcome(rng), { pRoll: 10, eRoll: 11, winner: 'opponent' });
    assert.equal(rng.calls(), 4);
    ```
    A one-tie fixture passes under both `while` and a broken `if`; two consecutive ties fail under `if`.
  - **Bounds** (scripted so the two rolls differ — never a constant rng):
    - lower: `scripted([0, 0.1])` → `pRoll 1`, `eRoll 3` (`1 + floor(0*20)=1`, `1 + floor(0.1*20)=3`).
    - upper: `scripted([1 - 1e-9, 0])` → `pRoll 20`, `eRoll 1` (`1 + floor(0.9999…*20)=20`).
  - `initialRollPhase(true) === null`, `initialRollPhase(false) === 'armed'`.
  - `isRollLocked`: true for `windup`/`rolling`/`result`; false for `armed`/`null`.
  - `canStartRoll`: true only for `armed`.
  - Default-rng smoke: `rollOutcome()` returns a valid shape (uses real `Math.random`; asserts shape/invariant, not a fixed value).
- **Device (ceremony smoke):** installed release — fresh full match and quick match both run the full roll ceremony to unlock; a resumed match shows no ceremony. (Timing/animation unchanged, so this is a smoke check, not the durable-resume gate.)
- **Regression:** the wiring diff is inspected line-for-line against `:455-458/:61/:277/:444` to confirm each swap is expression-identical.

## Security, privacy, performance, and operations

No new data, dependency, or telemetry. Pure functions; negligible cost. No runtime branch, so no cross-runtime divergence.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A swap is not truly expression-identical (e.g. `!!resume` vs `resume` truthiness) | Low | Medium | Line-for-line diff review against the four cited lines; `initialRollPhase(!!resume)` coerces exactly as the old ternary did |
| `isRollLocked` import shadows the `:277` local `rollLocked` | Low | Low | Export is named `isRollLocked`; the local keeps its name — no shadow. Called out in design. |
| Reviewer judges the predicates (`isRollLocked`/`canStartRoll`/`initialRollPhase`) ceremony-over-value | Low–Medium | Low | `rollOutcome` is the load-bearing extraction; the predicates name three specific phase decisions (entry, resume-skip, lock) next to it — not the whole phase machine. If rejected, ship `rollOutcome` alone (see Self-Critique). |
| The die's nondeterminism makes a test flaky | Low | Low | Tests inject a deterministic `rng`; only one smoke assertion uses the real `Math.random` and checks shape, not value |
| A test uses a constant rng and deadlocks `rollOutcome` | Low | Medium | Precondition documented on `rollOutcome`; every fixture ends on a value distinct from `pRoll`; no production retry cap (a cap would change behavior by inventing a winner for a tie) |

## Self-Critique

- **Strongest reason it's marginal:** three of the four exports are one-liners, and the contest has not *shipped* a bug — a skeptic calls this tidying. Fair on the predicates; not on `rollOutcome`. The fairness invariant is real, currently untested, and one edit from wrong; a die-roll that silently favours a side is precisely the kind of bug that never surfaces in manual play. The predicates ride along cheaply because they name three specific phase *decisions* (entry, resume-skip, lock) next to the contest — not the whole phase vocabulary, which stays in the component's `rollCls`/JSX/timers.
- **The fallback if the predicates are judged over-built:** ship `rollOutcome` alone (the invariant-bearing core), inline the three predicates. I'd rather land all four to name three phase decisions in one place, but the contest is the part that must be extracted.
- **Highest-consequence assumption:** that the four swaps are behavior-identical. A mis-coerced `resume` or a flipped predicate is a real (if low-odds) regression — caught by the line-for-line diff and the device smoke, which is why both are gates.
- **Coupling I might miss:** `birth`'s resume seed and `armRollOff`'s call at mount (`:234`) are adjacent to the phase logic but are NOT part of it; pulling them in would over-reach (the matchLife Rev 1 mistake). They stay put, named explicitly as out of scope.
- **Failure likely to escape the pure tests:** a timing/animation nuance in the live ceremony (the tumble reading wrong, the verdict not showing) — pure tests can't see it, hence the on-device ceremony smoke.
- **Evidence that would change direction:** if discovery at implementation finds the contest is read anywhere but `_tumble`, widen the consumer list; if `rollOutcome` can't return exactly what the faces + verdict need, the seam is wrong and I reconsider the shape.

## Approval requested

Extract a pure `src/pillars/matchRoll.js` owning the roll-off **decisions** — `rollOutcome` (the fairness invariant, proven by test) plus `initialRollPhase`/`isRollLocked`/`canStartRoll` (the named phase guards) — and route `LifeCounter`'s four inline decision points through it, behavior-preserving. The ceremony (timers/DOM/haptics/birth) stays in the component. **Standard** risk (opening-ceremony path → device smoke is the completion gate). This is the second and final slice of roadmap #2. **All four exports approved by Codex (Rev 2)**; the reducer/timer-harness work stays out of scope. Remaining decision: human approval of the extraction + four-point wiring to proceed to implementation. **No code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted Rev 1 | 2026-07-18 |
| Codex (reviewer) | **Changes required** — 1 Major (constant-rng bounds test deadlocks; one-tie fixture can't detect `while`→`if`; document the rng precondition) + 1 Minor ("phase vocabulary" too broad) | 2026-07-18 |
| Claude Code (author) | **Rev 2** — scripted multi-value rng fixtures (two consecutive ties in the tie test; scripted bounds); rng precondition + no-retry-cap documented on `rollOutcome`; "three named phase decisions" narrowed. All four exports approved. | 2026-07-18 |
| Codex (reviewer) | *pending re-review* | |
| Human (approver) | *pending* | |
