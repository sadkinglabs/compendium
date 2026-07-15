# Proposal: checked JavaScript, scoped to the Match View's pure modules

## Status and classification

**Status: Rejected** (2026-07-15) · Risk: **Standard**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

> **Rejected as scoped, and kept as decision evidence.** Codex disproved the central
> assumption *by construction*, not by measurement: TypeScript resolves a program from
> its roots **into their imports**, never backward into modules that import them. With
> `include` listing only `ddArming.js` and `avatarPickerState.js`, `LifeCounter.jsx` is
> never part of the checked program, so **step 3 could not have fired and neither
> motivating bug would have been caught**. The pilot would have checked the controller -
> the one part that was never wrong - and left the wiring, which was wrong twice, outside.
> The Self-Critique rated this "medium likelihood" and made it a stop condition; it was
> in fact certain, and a reviewer found it before a line was written.
>
> **A second, independent error:** the Options table and Self-Critique claim
> `SIDE.ENEMY` is "a `ReferenceError` at author time". **It is not.** Property access on
> a missing key returns `undefined`. The counterproposal's entire claimed advantage over
> `checkJs` does not exist; constants aid discoverability and autocomplete, and nothing
> more. The runtime guard would still catch it *when executed* - which is exactly the
> status quo this proposal was trying to improve on.
>
> **If revived**, per Codex, it must take one of two honest shapes:
> - **Option A** - put `LifeCounter.jsx` in the checked program and run the cheapest
>   disproof first: can it be checked without broad refactoring, `any`, or suppression?
>   If it emits substantial unrelated React diagnostics, **stop** - do not restructure a
>   component to justify a pilot.
> - **Option B** - extract a genuinely typed boundary owning the side-sensitive
>   operations (side→ref resolution, life commits, reset, per-side timer records). This
>   would also cover the `deltaTimers` leak. **That is a production refactor and needs
>   its own proposal; it must not be smuggled into a tooling pilot.**
>
> Codex's preference, and mine: try Option A **diagnostically** after the refurb closes.
> If noisy, defer until a natural extraction appears. **Runtime closed-set guards are
> adequate in the meantime** - they are correct, they are tested, and they already caught
> both bugs.

## Problem and success criteria

**The same typo shipped twice, and the test suite could not see it either time.**

`ddArming.js` names its sides `player` | `opponent`. `LifeCounter.jsx` twice passed `enemy`:

1. `createDdArming({ initialLife: { player, enemy } })` → `initialLife.opponent` was `undefined` → `undefined > 0` is false → `initialPhase` returned `FALLEN` → **the opponent's End Match pill armed itself seconds into a fresh match**, with nobody at zero.
2. `reset()` called `commitLife('enemy', …)` → `commitLife` tests `who === 'player'`, so it wrote the *correct* ref, while the controller call quietly invented `phases['enemy']` and **left the real opponent armed**.

Both were **structurally invisible to `ddArming.test.mjs`**, and this is the crux: the fixtures pass their own keys, so the unit tests can never observe a call-site key mismatch. The suite proves the reducer; the defect is in the wiring.

Runtime guards now exist (`assertSide`, the `initialLife` constructor check, `SIDES.includes`) and they are correct — but they fire **when that line executes**, which for `reset()` means when a player resets a match. `enemy` is a real concept in the view layer (`.enemy-half`, `eRef`, `eNumRef`), so the wrong word is always in reach and reads as natural.

**Success criteria**

1. `who: 'enemy'` at any `ddArming` call site is an **author-time error**, before the code runs.
2. A gate command that fails on it, runnable locally and in CI.
3. **Zero production behaviour change.** Runtime guards stay — this is defence in depth, not a replacement.
4. Zero `any`-suppression and zero refactoring-to-please-the-checker. If a file needs restructuring to pass, it leaves the pilot.
5. The pilot is **three files or fewer** and produces no diagnostics outside them.

**Non-goals**

- Repository-wide `checkJs`. Explicitly out of scope, per Codex.
- Migrating to TypeScript. Not proposed, now or implied.
- Typing JSX, components, hooks, or the store.
- Removing any runtime guard.
- Typing `LifeCounter.jsx` itself — see Risks.

## Evidence and current architecture

- `src/pillars/ddArming.js` — pure, no JSX, no React, dependency-free except injected timers. `SIDES = ['player', 'opponent']`; `assertSide` throws on anything else; the header documents the two shipped typos at length.
- `src/pillars/ddArming.test.mjs` — ~30 fixtures, fake timers. **Passes for both bugs.** Fixtures supply their own `initialLife` keys, so a mismatch between `LifeCounter.jsx` and the controller is outside its reach by construction. This is not a gap to be filled with more fixtures; it is the wrong instrument.
- `src/pillars/avatarPickerState.js` — the other pure Match View reducer. Same shape, same suitability.
- `src/pillars/LifeCounter.jsx` — the call site. React + JSX + ~20 hooks. **Not a pilot candidate.**
- `package.json` — no `typescript`, no `tsconfig.json`, no type gate of any kind. `typescript@6.0.3` resolves in `node_modules` **transitively**. As with `postcss`, Codex is right: depending on an undeclared transitive edge for a gate is a latent break nobody will connect to this change.
- Related: `deltaTimers` was keyed `{ player, enemy }` while written as `opponent` — **the opponent's release timer leaked on every unmount**. Pre-existing, same root cause, same family of module. It is evidence the naming hazard is not confined to `ddArming`.

## Assumptions and confidence

1. **`tsc --noEmit --checkJs` on `ddArming.js` produces zero diagnostics today.** Confidence: **medium**. It is pure, small, and JSDoc-friendly, but unverified. **Validation: step 1 of the plan is to run it and report the raw output before anything else.** If it is noisy, the proposal shrinks or dies.
2. **A `DdSide` typedef catches the literal `'enemy'`.** Confidence: **high** — a string literal against a union is the checker's most basic job.
3. **It catches the *object-key* form** (`{ player, enemy }` against a typed `initialLife`). Confidence: **medium-high** — excess-property checking applies to object literals, which is what the call site passes. This is the form of bug #1, so it must be **proven in step 3, not assumed**.
4. **Typing the module does not require restructuring it.** Confidence: **medium**. Criterion 4 makes this a stop condition rather than a hope.
5. **`typescript` as a devDependency ships nothing.** Confidence: **high** — dev-only, absent from the bundle and the APK.

## Affected systems and invariants

- **UI / runtime:** none. `--noEmit`; no transpilation; no emitted artefact; JSDoc comments do not reach the bundle.
- **Build:** one direct devDependency, one `tsconfig.json`, one script. `vite build` is untouched and does not consult it.
- **Invariants:** none of the eight are modified. This **defends** cross-runtime integrity and the DD guard's correctness rather than altering either.
- **Docs:** if the gate becomes required, `AGENTS.md` §5 and `ENGINEERING_CONSTITUTION.md` §10 must name `check:types` alongside `test:ui`, and `BUILD.md` must document the command. **That is a completion gate, not a courtesy** — see the plan.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo (runtime guards only)** | Rejected — but note it is *already better than nothing*, and it is what caught these bugs in the end. The gap it leaves is timing: `reset()`'s guard fires only when someone resets. |
| **Scoped `checkJs` pilot** (proposed) | Accepted. Smallest change that moves the error from run-time to author-time. |
| **Repo-wide `checkJs`** | Rejected. Codex is right, and specifically: a React JSX codebase with no established type gate produces a large unrelated cleanup, which buries the actual signal and gets the whole idea abandoned. |
| **Migrate the pure modules to `.ts`** | Rejected. Stronger, but it changes the build's shape, and `node --test` currently runs `.mjs` directly with no transpile step — the tests would need a loader. Large cost, same benefit as JSDoc. |
| **A symbolic constant (`SIDE.PLAYER`) instead of string literals** | **Genuinely competitive, and cheaper.** `ddArming.SIDE.OPPONENT` makes `enemy` a `ReferenceError` at the call site with no dependency, no gate, no config. Rejected only because it fixes *this* family and nothing else, and it touches production code where this proposal does not. **A reviewer preferring it has a real case, and I would not argue hard.** |
| **More unit-test fixtures** | Rejected. The instrument cannot see call sites; that is the whole finding. |

## Proposed design

**`tsconfig.json`** (repo root, consulted only by the new script):

```jsonc
{
  "compilerOptions": {
    "checkJs": true, "allowJs": true, "noEmit": true,
    "target": "es2022", "module": "es2022", "moduleResolution": "bundler",
    "strict": true, "types": []
  },
  // The pilot. Deliberately a list, not a glob: adding a file is a decision someone
  // makes, not something a wildcard does to them. Every entry is pure - no JSX, no
  // React, no DOM.
  "include": ["src/pillars/ddArming.js", "src/pillars/avatarPickerState.js"]
}
```

**In `ddArming.js`** — JSDoc only; no logic touched:

```js
/** @typedef {'player' | 'opponent'} DdSide */
/** @typedef {{ player: number, opponent: number }} DdLife */

/** @param {DdSide} who */
const assertSide = (who) => { … };   // the runtime guard STAYS. Static checking covers
                                     // literal call sites; the guard covers computed
                                     // ones, and both shipped bugs were literals.
```

**`package.json`:** `"check:types": "tsc --noEmit"` and `"typescript": "^6.0.3"` in `devDependencies` — pinned to the version already resolving, declaring existing reality rather than upgrading.

**Ownership:** the typedef lives in `ddArming.js` beside `SIDES`, which is already the single source of truth for the closed set. **One concept, one home** — a shared types file would be a second place to forget.

**Error behaviour:** `check:types` exits non-zero with file, line, and the offending literal. No runtime behaviour is added or removed.

## Implementation plan

Ordered so the cheapest disproof comes first.

1. **Prove the premise.** Add `typescript` + `tsconfig.json`; run `npx tsc --noEmit`. **Report the raw output.** If either file is noisy, **STOP** — report and re-scope rather than fixing code to please a checker that was not approved to reshape it (criterion 4).
2. Add the `DdSide` / `DdLife` typedefs and the `@param` annotations. **Checkpoint:** `check:types` green, `test:ui` green, no source logic changed (the diff is comments).
3. **Prove it bites — the checkpoint that matters.** Temporarily reintroduce **both** historical bugs at their real call sites in `LifeCounter.jsx`: `initialLife: { player, enemy }` and `commitLife('enemy', …)` → `dd.syncLife('enemy', …)`. Run `check:types`. **It must fail on both.** Revert. Report both outputs verbatim.
   **`LifeCounter.jsx` is not in `include`, so this step also asks a real question: does the checker see across the boundary from an unchecked caller?** If it does not, the pilot catches nothing that matters and **the proposal has failed** — say so plainly and prefer the `SIDE.PLAYER` constant instead.
4. Only if 1-3 pass: extend `include` to the life-write boundary if that module is extracted. **Not before** — this proposal does not authorise an extraction.
5. Docs: add `check:types` to `AGENTS.md` §5, `ENGINEERING_CONSTITUTION.md` §10, and `BUILD.md`. **Not optional if the gate is required.**
6. Full gates: `check:types && test:ui && test:codex && test:query && build && check:docs`.

## Data migration and compatibility

**Not applicable** — no persisted data, no schema, no stored format, no wire format. The change adds comments, one config file, one script, and one dev dependency.

## Rollback and recovery

Delete `tsconfig.json`, the script, and the dependency; the JSDoc comments are inert and may stay or go. **No point of no return; no runtime code path exists to roll back.** If `check:types` becomes a required gate and then proves obstructive, removing it is a one-line revert plus the doc updates from step 5.

## Verification plan

- **Automated:** `check:types` is the gate. Step 3's dual mutation is the proof it works; its output belongs in the commit message.
- **Regression:** `test:ui` must stay green — the runtime guards' tests are untouched, which is itself evidence nothing was traded away.
- **Native/web:** not applicable — build-time only, runtime-identical on both.
- **Accessibility:** not applicable.
- **Manual:** none. **This gate proves nothing about the Match View's behaviour and must never be cited as evidence for the outstanding `cx-no-images` or reduced-motion device gates.**

## Security, privacy, performance, and operations

No threats, no sensitive data, no telemetry. `tsc` on two small pure files is ~1-2s locally. Dev-only: **nothing enters the bundle or the APK**, so the offline-first/no-CDN posture is unaffected. `typescript` is already installed, so no new download.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **The checker cannot see the bug from an unchecked caller** | **Medium** | **High — it would void the whole proposal** | Step 3 is designed to find this out before anything is committed. Named as a fail condition, not a hope. |
| Scope creep — "while we're here, type the store" | **Medium** | Medium | `include` is an explicit list; non-goals are stated; step 4 is gated. |
| The gate becomes noise people learn to skip | Low-Medium | High | Two files, zero diagnostics required at rest. If it is ever noisy, it has already failed criterion 4. |
| False security — "the sides are typed now" | Medium | Medium | Runtime guards stay, deliberately; both mechanisms are documented as complementary. Computed sides remain runtime-only. |
| A transitive `typescript` disappears | Low | Low | Closed by declaring it directly. |

**Unanswered, and genuinely open:**
1. **Is `SIDE.PLAYER` simply better?** It needs no dependency, no config, and no gate, and it fails *louder* (`ReferenceError`) — but it edits production code and only fixes this family. **I have not resolved this and I do not think I should be the one to.**
2. Should `check:types` be *required* or advisory at first?
3. Does `deltaTimers`' key mismatch (`{player, enemy}` written as `opponent`) fall inside a future `include`? It is the same root cause and it currently leaks a timer on every unmount, but it lives in `LifeCounter.jsx`, which is explicitly out of scope.

## Self-Critique

**The strongest case that this is wrong:** *the bugs are already fixed, and by a mechanism that works.* `assertSide` and the constructor check throw loudly on exactly these inputs. So this proposal buys **earlier detection of a class of bug that is currently caught**, at the cost of a dependency, a config file, a gate, and a doc change. Measured against the outstanding work — two unobserved release gates on build 33 — that is not obviously the best use of the next hour, and a reviewer who says "not now" is not wrong.

**The counterproposal I cannot dismiss:** `SIDE.PLAYER` / `SIDE.OPPONENT` exported from `ddArming.js`. `dd.syncLife(SIDE.ENEMY, …)` is a `ReferenceError` at author time in any editor, with **no dependency, no config, no gate, and no doc change**, and it fails harder than a type error. Its weakness is that it fixes only this family and only where people use it, while `checkJs` generalises. **But "generalises" is doing suspicious work in that sentence, since the non-goals forbid generalising it anywhere.** If step 1 or step 3 disappoints, this is the answer.

**Hidden coupling:** the pilot's value depends entirely on diagnostics crossing from `LifeCounter.jsx` — a file deliberately *outside* `include` — into a checked module. If TypeScript will not check an unchecked file's call sites, **the pilot catches literally none of the two bugs that motivate it**, and it would be a gate that guards an empty room. I rate this medium likelihood, which is uncomfortably high for a load-bearing assumption, and it is why step 3 exists and why step 1 comes before any annotation work.

**The failure most likely to escape:** a **computed** side (`who = isPlayer ? 'player' : 'enemy'`) typed as `string`, which the checker accepts and the runtime guard then catches — proving the guards must stay, and proving this is a second net, not a better one. Worse: the `deltaTimers` leak is *exactly* this shape and lives in a file this proposal does not touch. **The nearest live instance of the root cause is outside the pilot's scope.**

**Evidence that would change the decision:** step 1 producing diagnostics in either pure file → shrink or abandon. Step 3 failing to flag either historical bug → abandon and take `SIDE.PLAYER`. A reviewer showing that excess-property checking does not apply to the `initialLife` call site → the proposal only half-works, and half is not worth a gate.

## Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted | 2026-07-15 |
| Codex (reviewer) | *pending* | |
| Human (approver) | *pending* | |
