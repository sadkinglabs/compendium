# Proposal: a semantic contract test for the life tracker's CSS

## Status and classification

**Status: Approved with revisions** (2026-07-15) · Risk: **Standard**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

> **Implementation deferred** until build 33's release gates are closed. Codex's three
> required revisions are folded into the body below and marked **[R1]**, **[R2]**, **[R3]**.

## Problem and success criteria

**Build 26 shipped visibly broken and every gate passed.** A `re.sub` cleanup silently deleted `#counter-screen { --birth }` and the ash twin's `opacity: calc(1 - var(--birth))`. `npm run build`, `test:codex`, `test:query`, and `test:ui` were all green. Only the screen knew: the realm never came out of ash.

The reason is structural, not incidental. **Deleting valid declarations leaves valid CSS.** A syntax error would have been caught; an absence is not an error. No gate in this repository observes what `counter.css` *means*, only that it parses and that the bundle builds. The same deletion today would ship the same way.

**Success criteria**

1. A test that **fails on the exact build-26 mutation** (delete `--birth` from `#counter-screen`; delete the ash's birth-derived opacity), demonstrated by making the mutation locally and observing red.
2. `npm run test:ui` covers it; no new runner, no new framework.
3. The test asserts **meaning, not text**: it must survive reformatting, reordering, added comments, and changed timing values.
4. `postcss` becomes a **direct** dev dependency.
5. Zero production-code change.

**Non-goals**

- Proving the screen *looks* right. This test cannot and must not claim to.
- Testing rendering, hit-testing, or the compositor. Those remain device-verified.
- Guarding CSS beyond `counter.css`. Other surfaces have not demonstrated this failure.
- Replacing the `cx-no-images` or reduced-motion device gates.

## Evidence and current architecture

- `src/theme/counter.css` — all six contracts exist today and were confirmed in the current tree:
  - `:335` `--birth` declared on `#counter-screen`, with `--birth-ms`, `--birth-ease`, `--dd-fall-ms`
  - `:344` `.half-bg-dd { opacity: calc(1 - var(--birth)); transition: opacity var(--birth-ms) var(--birth-ease); }`
  - `:363-365` `.half-birth-rim` — birth-derived opacity, delayed birth-duration transition
  - `:351` `.counter-half.dd .half-bg-dd { opacity: 1; transition: opacity var(--dd-fall-ms) ease; }` — DD overrides birth at (0,3,0)
  - `:447` `.dd-pill.dd-armed { pointer-events: auto; }`
  - `:453` `.dd-pill.dd-rearming { pointer-events: none; }`
- `src/pillars/cssScope.test.mjs` — **the precedent**. A test already guards `counter.css`-adjacent invariants (the renamed `cx-` scopes) and runs under `test:ui`. This proposal is its sibling, not a new category.
- `package.json` — `"test:ui": "node --test \"src/pillars/**/*.test.mjs\""`. Plain `node --test`, no framework, no DOM.
- `postcss@8.5.16` resolves in `node_modules` **transitively via Vite**. It is not declared. Codex's objection is correct: a test that imports it directly must declare it, or a Vite major that drops or moves the transitive edge breaks the gate for reasons no one will connect to this test.
- `src/pillars/ddArming.js:37-47` — the pass-through property that `pointer-events: none` implements during `REVEALING`/`REARMING` is load-bearing and documented at length. The CSS is the other half of that guard, and nothing currently ties them together.

## Assumptions and confidence

1. **`postcss` parses `counter.css` without a plugin chain.** Confidence: **high** — no custom at-rules; nesting is not used in this file.
2. **The six contracts are the right set.** Confidence: **medium**. They are Codex's list, and they cover the observed failure plus the DD guard. They are not provably exhaustive. Validation: the mutation test in criterion 1 proves the set covers build 26; it proves nothing about a seventh contract nobody has broken yet.
3. **Asserting "opacity references `--birth`" is stable under legitimate refactors.** Confidence: **medium**. It survives value and timing changes. It would *correctly* fail if the birth mechanism were redesigned — at which point the test should be updated deliberately, which is the point.
4. **`node --test` can import `postcss` from an `.mjs` test.** Confidence: **high** — it is ESM-ready and the existing tests are `.mjs`.

## Affected systems and invariants

- **UI:** none at runtime. The test is read-only over a source file.
- **Build:** one new direct devDependency. No bundling change.
- **Invariants:** touches **graceful zero-image degradation** only in the sense that `--birth` drives the ash used by that mode — the test defends it, cannot weaken it. No catalog/profile, persistence, schema, or transaction surface. **Cross-runtime integrity:** unaffected; this is a build-time source assertion, identical on web and native.
- **Docs:** `AGENTS.md` §5 / `ENGINEERING_CONSTITUTION.md` §10 already name `test:ui` as a gate. No doc change required — the new test runs inside an already-documented gate. `BUILD.md` needs no change for the same reason.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** | Rejected. The failure is demonstrated, not theoretical, and it is silent by construction. |
| **A regex/substring assertion** over `counter.css` | Rejected. It is the same class of tool that caused the incident, it breaks on reformatting, and it cannot distinguish a declaration from the same text inside a comment. Codex named this explicitly. |
| **PostCSS AST contract test** (proposed) | Accepted. Parses what the browser parses; assertions survive formatting. |
| **Snapshot the whole file** | Rejected. Fails on every legitimate edit, trains people to regenerate it without reading, and would have been regenerated in build 26 without a second thought. |
| **A DOM/rendering test (jsdom + a renderer)** | Rejected for now. It would catch more, but jsdom does not implement the cascade or hit-testing faithfully, so it would produce false confidence about the very property (`pointer-events` pass-through) that most needs the device. Large dependency, no existing precedent in this repo. |
| **Visual regression / screenshot diffing** | Rejected. Correct tool for "does it look right", but it needs a device or a browser in CI, which this offline-first repo does not currently have. Revisit if that changes. |

## Proposed design

**New file:** `src/pillars/counterContract.test.mjs` — picked up by the existing `test:ui` glob, sibling to `cssScope.test.mjs`.

**Shape:** parse once with PostCSS; walk rules; assert each contract as a **predicate over declarations**, not a string match.

```js
import postcss from 'postcss';
// Assert MEANING, never text: `opacity` must be DERIVED FROM --birth, while the exact
// expression, the timing values, and the formatting stay free to change. That is the
// difference between a contract and a snapshot - build 26 deleted the declaration
// outright, and no legitimate refactor does that while keeping the feature.
//
// [R2] NAMED FOR WHAT IT ACTUALLY DOES. This collects declarations from rules whose
// selector matches EXACTLY, textually. It is NOT the cascade: it cannot see a
// higher-specificity selector, !important, a media condition, a later rule with a
// different selector, or an inline style. Anything that needs those needs a browser.
// The narrow claim is the honest one, and the name has to carry it - a helper called
// "winning declaration" would license conclusions this file cannot support.
const declarationsForExactSelector = (root, selector, prop) => { /* … */ };
```

**The contracts** (each with a comment naming *what breaks in the app* if it fails - a test that only says "expected true" teaches nobody):

| Selector | Assertion |
|---|---|
| `#counter-screen` | **[R1]** `--birth` is present **and parses as numeric `0`** · `--birth-ms` present and is a **time value** · `--dd-fall-ms` present and is a **time value** · `--birth-ease` present |
| `.half-bg-dd` | `opacity` references `var(--birth)`; `transition` references `var(--birth-ms)` |
| `.half-birth-rim` | `opacity` references `var(--birth)`; `transition` references `var(--birth-ms)` and carries a delay |
| `.counter-half.dd .half-bg-dd` | `opacity` is `1`; `transition` references `var(--dd-fall-ms)` |
| `.dd-pill.dd-armed` | `pointer-events: auto` |
| `.dd-pill.dd-rearming` | `pointer-events: none` |

**[R1] Why asserting `--birth: 0` is a contract and not a snapshot.** My original draft
identified `--birth: 1` as an equally-broken, equally-silent inverse of build 26 and then
*accepted* that the test would miss it, on the grounds that asserting a value is
snapshotting. **Codex is right that this was avoidable and the reasoning was wrong.**
Zero is not an incidental value; it is **the defined semantic state - a fresh match begins
unborn**. Any other value changes product behaviour, which is precisely what a contract
should refuse. The distinction that matters is not value-versus-structure: it is whether
the assertion encodes *meaning* (`0` = unborn) or *incident* (`450ms` felt right on a
Pixel). So the default is pinned; the timings are only type-checked.

**Uniqueness:** assert that `.dd-pill.dd-armed { pointer-events }` and `.counter-half.dd .half-bg-dd { opacity }` each appear exactly once. A duplicate later rule silently wins the cascade — that is a distinct silent-failure mode from deletion and costs one assertion to close.

**Error behaviour:** a failure names the selector, the property, and the user-visible consequence ("the realm never leaves ash"), so the next engineer learns the contract from the failure rather than from this document.

**Dependency:** add `"postcss": "^8.5.16"` to `devDependencies`, pinned to the version already resolving, so the change is a declaration of existing reality rather than an upgrade.

## Implementation plan

1. Add `postcss` to `devDependencies`; `npm install`; confirm the lockfile records it as direct.
2. Write `counterContract.test.mjs` with the six contracts plus the two uniqueness assertions. **Checkpoint:** `npm run test:ui` green.
3. **The checkpoint that matters — prove it fails. [R2]** Three mutations, each applied locally, run, observed red, and reverted. **A guard that has never been seen to fail is not known to be a guard.** Report all three outputs verbatim.
   1. Delete `--birth` from `#counter-screen` → red *(the observed build-26 failure)*
   2. Delete `.half-bg-dd`'s `opacity` → red *(the other half of build 26)*
   3. **Change `--birth: 0` to `--birth: 1` → red** *(the exact inverse: a table that is never ash. Previously undetectable; this is what [R1] buys.)*
4. **[R3]** Add the execution rule to `AGENTS.md` (see below). It is part of this change, not a follow-up.
5. `npm run test:ui && npm run test:codex && npm run test:query && npm run build && npm run check:docs`.

Increments 2 and 3 are one unit: the test is not done until it has been observed failing.

**[R3] The process rule — the part that actually addresses the cause.** The Self-Critique
concedes this test does not make regex source rewrites safe, and build 26 was the *third*
regex-related incident in a single session. Codex is right that the fix belongs in
`AGENTS.md` as an execution rule, not in a test:

> After every bulk or regex-based source rewrite, inspect the complete resulting diff
> before running formatters, tests, builds, or further rewrites.

**Tests validate a result; they do not replace reading a mechanically transformed diff.**
Every one of those three incidents would have been caught by looking at the diff, and none
of them was caught by a green gate.

## Data migration and compatibility

**Not applicable** — no persisted data, no schema, no stored format, no user-visible surface. The change adds one dev-only test file and one dev dependency.

## Rollback and recovery

Delete the file and the dependency line. **No point of no return; no runtime code path exists to roll back.** If the test proves brittle in practice (false failures on legitimate CSS edits), that is a design defect in the assertions, not a reason to keep a broken gate — tighten or delete it deliberately and say so.

## Verification plan

- **Automated:** `test:ui` covers it. The mutation exercise in step 3 is the real verification and its output goes in the commit message.
- **Native/web:** not applicable — a build-time source assertion, runtime-independent.
- **Accessibility:** not applicable.
- **Regression:** full gate set above.
- **Manual:** none. **This test asserts nothing about appearance and must never be cited as evidence the screen renders correctly.** The `cx-no-images` and reduced-motion device gates are untouched by this proposal and remain outstanding.

## Security, privacy, performance, and operations

No threats, no sensitive data, no telemetry, no deployment impact. One extra file parse (~50ms) on `test:ui`. `postcss` is already installed, so no new bytes are downloaded and **nothing ships in the APK** — devDependencies do not enter the bundle, so the offline-first/no-CDN posture is unaffected.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The test becomes a change-detector people silence rather than read | **Medium** | Medium | Assert meaning not text; every assertion carries the user-visible consequence in its message. Six contracts, not sixty. |
| The six contracts are not the right six | Medium | Medium | Accepted. It closes the observed hole; it does not claim to close all of them. |
| False confidence — "CSS is tested now" | **Medium** | **High** | Named in this proposal, in the file's header comment, and in the commit message: this test cannot see the screen. |
| A Vite major moves the transitive `postcss` edge | Low | Low | Closed by declaring it directly - the reason for that clause. |

**Unanswered:** should `cssScope.test.mjs` and this file merge into one CSS-contract module? I lean no — different failure modes, different lifetimes — but a reviewer may disagree.

## Self-Critique

**The strongest case that this is wrong:** *it treats a process failure as a code failure.* Build 26 broke because I ran a regex over source and did not read the result — the third such failure in one session. The honest fix is that I stop doing that. This test makes one specific mutation loud while leaving the practice that caused it intact, and it risks reading as absolution: the tooling now "covers" CSS, so the next regex feels safer. **It is not safer.** I would rather this land alongside the plain statement that the practice was the defect, than instead of it.

**Hidden coupling:** the test hard-codes structural knowledge of `counter.css` — selector names and custom-property names — into a second file. Renaming `--birth` becomes a two-file change, and the test will fail in a way that looks like a bug rather than a rename. Given the `cx-` scope-rename regression that cost two days, adding *more* selector-name coupling deserves to be said out loud. Mitigated by the failure messages naming the consequence; not eliminated.

**Simpler alternative:** move the contracts into `counter.css` as a comment block and rely on review. Costs nothing, catches nothing automatically — but it is honest about where the enforcement actually lives. I reject it only because build 26 proves review did not catch this: I wrote the regex, ran the gates, saw green, and shipped.

**The failure most likely to escape** — ~~a declaration that is *present but wrong*: `--birth: 1` as the default would pass every assertion and ship a screen that is never ash, the exact inverse of build 26. Asserting the value would be a snapshot, which I rejected above.~~ **[R1] retracted.** That reasoning was wrong, and Codex caught it: `0` is the *defined semantic state*, so pinning it is a contract, not a snapshot. Mutation 3 now covers this exact case. I had identified the hole, mis-classified the fix as snapshotting, and talked myself out of closing it — **the weakness was in my reasoning, not in the technique.**

The failure most likely to escape *now* is **an override this test cannot see**: a later rule with a different but higher-specificity selector, an `!important`, or a media condition that re-declares `opacity` and wins the cascade. `declarationsForExactSelector` matches selector text and **does not implement the cascade** — the uniqueness assertions catch a *duplicate of the same selector* and nothing more. **A different selector overriding these declarations is invisible here and always will be.** That needs a browser, which is why the device gates are not replaced by this.

**Evidence that would change the decision:** if the mutation exercise in step 3 does not produce red, the design is wrong and must not land. If a rendering gate (device screenshot diffing) becomes available, this test is largely superseded and should be reconsidered rather than kept out of habit.

## Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted | 2026-07-15 |
| Codex (reviewer) | *pending* | |
| Human (approver) | *pending* | |
