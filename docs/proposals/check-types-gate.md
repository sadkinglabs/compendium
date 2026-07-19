# Proposal: a scoped `check:types` gate for the match-view typed boundaries (Option A)

## Status and classification

**Status: Rev 2 — revised after review; awaiting re-review** · Risk: **Standard** (adds build-time tooling + a baseline gate + JSDoc/ambient annotations in the seven owned files; **zero runtime/logic change** — no device gate, build-time only)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-18 · Roadmap §16 #5, the final item. **Diagnostic complete (see Evidence); no gate code written yet.**

> **Rev 2 (both Majors + the Minor accepted).** The scope/ownership mismatch and the `any` bridge were the same root cause — an *unfiltered* checked program. Fixed together:
> - **Major 1 (ownership boundary).** The checked program is the enumerated **23-file closure**, not seven files. The gate now **mechanically bounds ownership**: `scripts/check-types.mjs` runs `tsc` over the closure but **fails only on diagnostics in the seven owned files** (+ the ambient `.d.ts`). A transitive file's future diagnostic can never fail the gate; "narrow the include" is removed as a mitigation, replaced by this filter + an explicit policy (§ Checked closure and ownership boundary).
> - **Major 2 (broad `any`).** The `Capacitor?: any` / `CapacitorHttp?: any` declarations existed only because the *unfiltered* closure reached `deckRepository`. With the ownership filter, that file's `window.Capacitor` access is transitive and never gates — so those declarations are **removed entirely**. `ambient.d.ts` shrinks to a single non-`any` line (`declare module '*.css'`), needed by `LifeCounter.jsx`'s own CSS import. No `any` bridge is introduced; the native path is simply out of this gate's ownership, stated plainly rather than silenced.
> - **Minor (dependency lifecycle).** `typescript` is pinned **exactly** (`"6.0.3"`, no caret); `package-lock.json` is in the implementation and rollback scope; the clean-install claim is corrected (a fresh clone *does* fetch it as a direct dependency).

> **This is the honest revival of the rejected `checked-js-pilot.md`, as its own "Option A".** The pilot was rejected because TypeScript resolves a program *roots→imports, never backward*, so a `checkJs` gate on a pure module can't see a *caller's* mistake — it would have checked the controller (never wrong) and left the wiring (wrong twice: `enemy`, `deltaTimers`) outside. Roadmap #2/#3/#4 changed the board: the callers now import JSDoc-typed boundaries (`matchLife`, `matchRoll`, `matchSnapshot`, `importPlan`, `listGoalModel`, `navBack`). Option A's instruction was: *put the caller in the checked program and run the cheapest disproof first; if it emits substantial unrelated React diagnostics, stop.* **I ran that diagnostic.** It passed at the LifeCounter scope and **failed (correctly) at the app-wide scope** — so this proposal is scoped to exactly the part that passed.

## Problem and success criteria

**The same caller-key typo shipped twice and the unit tests could not see it either time** (`checked-js-pilot.md` §Problem): `LifeCounter.jsx` passed `enemy` where `ddArming` names sides `player|opponent`, arming the opponent's End-Match pill in a fresh match; `deltaTimers` had the same mismatch and leaked a timer per unmount. These are *wiring* defects — the fixtures pass their own keys, so `ddArming.test.mjs` is structurally blind to them. Runtime guards (`assertSide`) catch them, but only *when that line executes* (e.g. `reset()`'s guard fires only when someone resets).

**The diagnostic proved the fix now exists.** With `LifeCounter.jsx` in a `checkJs` program alongside the typed boundaries, a wrong value at a call site is an **author-time** error:
```
// injected at the real call site: applyStep(cur, 5)
src/pillars/LifeCounter.jsx(391,33): error TS2345:
  Argument of type '5' is not assignable to parameter of type 'Dir'.
```
That is the exact class of the shipped bugs — caught before the code runs, by tooling, not by hoping the guarded line executes in a test.

**Success criteria**

1. A committed `tsconfig.json` + a `check:types` script gate the **seven owned files** — `LifeCounter.jsx` + the six typed boundary modules — with **mechanical ownership bounding**: `tsc` checks the full reachable closure (so callee types inform the boundary checks), but the gate **fails only on diagnostics in the owned files** (+ ambient `.d.ts`). `typescript` is a direct, exactly-pinned devDependency.
2. `check:types` is **green at rest** — the closure is brought to zero diagnostics via **ambient declarations + JSDoc annotations only**. **No production logic is restructured** (`checked-js-pilot.md` criterion 4 — if a file needs restructuring to pass, it leaves the gate).
3. **It bites, proven:** re-injecting `applyStep(cur, 5)` and both historical bugs at their real call sites makes `check:types` fail; reverting makes it pass. Output captured in the commit.
4. `check:types` joins the enumerated baseline gates (Constitution / AGENTS / CLAUDE.md / BUILD.md), like `test:app`.
5. **Zero runtime behaviour change.** `--noEmit`; JSDoc/`.d.ts` never reach the bundle. Runtime guards (`assertSide`, snapshot validation) **stay** — this is defence in depth, a second net, not a replacement.

**Non-goals / declined on evidence**

- **App.jsx / Collection.jsx (and the wider component tree).** Measured: the three-caller scope is **306 diagnostics across ~24 files, ~170 (56%) inferred JSX prop-shape noise** (`Collection.jsx` alone is 77% noise), because `tsc` checks the whole reachable graph and every inline component contributes. That is Option A's explicit **stop** condition ("substantial unrelated React diagnostics… do not restructure a component to justify a pilot"). Deferred until/unless those components' props are typed for other reasons.
- `strictNullChecks` / full `strict` (the pure modules alone emit 36 `noImplicitAny` diagnostics under `strict:true` — pedantry, not signal). A future tightening, not v1.
- TypeScript migration; typing JSX/hooks/the store broadly; removing any runtime guard.

## Evidence and current architecture (the diagnostic)

Run on a throwaway branch, `tsc 6.0.3` (already resolving transitively), config `checkJs/allowJs/noEmit, strict:false, noImplicitAny:false, jsx:preserve, types:[]`:

- **Pure typed modules alone:** 4 diagnostics — clean-able in the modules.
- **+ `LifeCounter.jsx` (its full type-closure):** **30 diagnostics**, breaking down as:
  - ~6 environmental (`import.meta.env`, `window.Capacitor`, a CSS side-effect import) → **2–3 ambient `.d.ts` declarations**.
  - ~13 `= {}` default-param family (`players`, `restoreSide` arg, native share opts) → one JSDoc `@param` each.
  - ~7 inferred prop-shapes on `LifeCounter`'s in-file `VModal`/sheet sub-components → one props `@typedef`.
  - ~4 real **type-accuracy** findings (below).
- **The bite proof:** `applyStep(cur, 5)` → `TS2345 … not assignable to 'Dir'` at the caller. ✔
- **Real findings (type-accuracy, no runtime bugs — all confirmed to work at runtime):**
  - `navBack.js:56` — `resolveCounterBackFallback`'s `@returns` claims `'confirm'|…|'minimize'`, but `.find()` on a `string[]` returns `string`; the annotation over-promises. Fix: type `COUNTER_BACK_ORDER` as a `const`/readonly tuple so `.find` narrows.
  - `matchSnapshot.js` / `matchLife.restoreSide` — untyped destructured params (`{}`), widened to `any`. Fix: `@param` shapes.
  - (Transitive, out of this scope: `trimHistorySql` tuple widening; `Play.jsx` `isNaN(new Date())` coercion idiom; `ownedRepository` partial-object updates — noted for a future extension, not fixed here.)
- **Owned files (the gate's ownership):** `src/pillars/LifeCounter.jsx` + `src/pillars/matchLife.js`, `src/pillars/matchRoll.js`, `src/store/matchSnapshot.js`, `src/store/importPlan.js`, `src/store/listGoalModel.js`, `src/navBack.js`. **Owned-file diagnostics: 22** (12 `TS2339` `= {}`/prop-access params, 7 `TS2739`/`TS2741` in-file sheet prop-shapes, 2 `TS2322` incl. the `navBack` over-promise, 1 `TS2882` CSS import) — all annotation-shaped, none `env`/`Capacitor`. Precedent gate: `test:app` (#4).

## Checked closure and ownership boundary (Rev 2 — Codex Major 1)

`tsc` type-checks a whole program, not a file list: seeding it with the seven owned files pulls in their entire reachable import graph. The **measured closure is 23 `src` files** (`tsc --listFiles`):

```
LifeCounter.jsx · matchLife.js · matchRoll.js · navBack.js · matchSnapshot.js · importPlan.js
· listGoalModel.js   (the seven owned)
back.js · ddArming.js · components/QRCode.jsx · native.js · cardArt.js · cardQuery.js
· catalogCache.js · collectionWrites.js · db.js · deckRepository.js · ids.js · matchShare.js
· matchStats.js · playRepository.js · profileRepository.js · schema.js   (16 transitive)
```

**The gate owns the seven, not the twenty-three.** `scripts/check-types.mjs` runs `tsc --noEmit` over the closure and then **filters diagnostics to the owned paths**, failing only if an *owned-file* diagnostic remains. This is the mechanical bound Codex asked for, and it defines the maintenance policy exactly:

- **Transitive files are type-checked but never gate.** Their exported signatures still flow into the owned files' checks (a wrong argument LifeCounter passes to `deckRepository` surfaces as a `TS2345` *at the LifeCounter call site* — owned — and is caught). Their *internal* diagnostics (e.g. `deckRepository`'s `window.Capacitor`, `db`'s `import.meta.env`) are **discarded**. A future unrelated edit to a transitive file therefore **cannot** fail the baseline gate.
- **Annotation cleanup is allowed only in the seven owned files.** A fix that would require touching a transitive file, or restructuring *logic* in any file, is **out of scope — stop and re-scope** (`checked-js-pilot.md` criterion 4). The gate never pressures the store layer.
- **Closure growth is irrelevant by construction** — the filter keys on the owned allowlist, not the closure, so the closure may grow or shrink freely. "Narrow the `include`" is **removed** as a mitigation (it cannot bound a TypeScript program anyway).
- **Boundary soundness:** TypeScript reports argument/shape/excess-property mismatches *at the call site*, which for these boundaries is an owned file — so the owned-only filter does not blind the gate to the target bug class (the `applyStep(cur,5)` bite fires in `LifeCounter.jsx`). The one gap it accepts, stated plainly: a mismatch that surfaces *only inside a transitive callee* is not gated — acceptable, because the target class (caller-key/shape/literal) surfaces at the caller.

## Assumptions and confidence

1. **The seven owned files reach zero with annotations only (no logic change).** Confidence: **high** — the 22 owned-file diagnostics are all CSS-ambient or `@param`/`@typedef` shaped; none requires restructuring, and none touches a transitive file. Stop condition if any does (criterion 2).
2. **The gate keeps biting after cleanup.** Confidence: **high** — the bite proof already fired under this exact config; cleanup adds types, it doesn't remove the boundary checks.
3. **`strict:false` is enough for the target bug class** (wrong literal / wrong shape / wrong key at a call site). Confidence: **high** — `applyStep(cur,5)`→TS2345 and the object-shape TS2739/2741 all fire under `strict:false`.
4. **Declaring `typescript` directly changes nothing at runtime.** Confidence: **high** — devDependency, `--noEmit`, absent from bundle/APK.

## Affected systems and invariants

- **Eight §3 invariants:** none touched. This *defends* cross-runtime integrity and the DD-guard correctness rather than altering either. No persistence, schema, or content path.
- **Build:** one direct devDependency (declaring existing reality), one `tsconfig.json`, one script. `vite build` is untouched and never consults it.
- **Runtime:** none. `--noEmit`; nothing enters the bundle; offline-first/no-CDN posture unaffected.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo (runtime guards only)** | Rejected — but note it *did* catch the bugs; the gap it leaves is timing (guard fires only when the line runs). |
| **Scoped `check:types`: LifeCounter + typed boundaries** (proposed) | **Recommended.** The one scope that passes Option A's diagnostic; catches the caller-mismatch class at author time. |
| App-wide `check:types` (all callers) | **Declined on measurement** — 306 diagnostics, 56% React prop-shape noise; Option A's stop condition. |
| `checkJs` on pure modules only | Rejected — the pilot's original mistake; checking modules, not callers, catches no caller mismatch. |
| A `SIDE.PLAYER` constant instead | Complementary, not exclusive — helps `ddArming` only; the gate generalises to every typed boundary. Runtime guards already provide the loud-failure path. |
| Full `strict` / TS migration | Rejected — pedantry (36 implicit-any) or build-shape change for the same benefit. |

## Proposed design

**`tsconfig.json`** (repo root; consulted only by the gate — Vite uses esbuild and ignores it; editors get inline checking for free):
```jsonc
{
  "compilerOptions": {
    "checkJs": true, "allowJs": true, "noEmit": true,
    "target": "es2022", "module": "esnext", "moduleResolution": "bundler",
    "strict": false, "noImplicitAny": false, "types": [], "skipLibCheck": true,
    "jsx": "preserve"
  },
  // The seven owned roots + the ambient decl. tsc pulls in the 23-file closure to
  // resolve types; scripts/check-types.mjs decides which diagnostics GATE.
  "include": [
    "src/pillars/LifeCounter.jsx",
    "src/pillars/matchLife.js", "src/pillars/matchRoll.js", "src/navBack.js",
    "src/store/matchSnapshot.js", "src/store/importPlan.js", "src/store/listGoalModel.js",
    "src/types/ambient.d.ts"
  ]
}
```

**`scripts/check-types.mjs`** (the mechanical ownership bound — Major 1): spawn `tsc --noEmit -p tsconfig.json`, parse `path(line,col): error TSxxxx` lines, keep only those whose path is in the **owned allowlist** (the seven files + `src/types/ambient.d.ts`), print the kept ones, `process.exit(kept.length ? 1 : 0)`. The allowlist is a literal array in the script — adding a file to the gate is a deliberate edit, and the closure can grow freely without ever failing the gate.

**`src/types/ambient.d.ts`** (new — one line, no `any` bridge; Major 2):
```ts
declare module '*.css';   // LifeCounter's side-effect CSS import; no meaningful type
```
No `Capacitor`/`import.meta.env` declarations: those needs live in *transitive* files (`deckRepository`, `db`, `cardArt`), which the ownership filter excludes. The Capacitor bridge is **explicitly out of this gate's scope**, not silenced with `any`.

**Annotations (JSDoc only; no logic touched; owned files only):** `players` prop shape and the in-file `VModal`/sheet prop `@typedef`s in `LifeCounter.jsx`; `restoreSide` arg shape in `matchLife.js`; the `buildMatchSnapshot`/`readMatchSnapshot` param shapes in `matchSnapshot.js`; `COUNTER_BACK_ORDER` as a readonly tuple in `navBack.js` (fixes the over-promising `@returns`).

**`package.json` + `package-lock.json` (Minor):** add `"check:types": "node scripts/check-types.mjs"` and `"typescript": "6.0.3"` — an **exact pin** (no caret), matching the version already resolving transitively. Running `npm install` updates `package-lock.json` to record `typescript` as a **direct** dependency; that lockfile change is committed with the gate. A clean `npm install` (fresh clone) *does* fetch `typescript` — it was only ever present as a transitive of `firebase-tools`, and is now a declared direct dependency; it is dev-only and still ships nothing.

**Runtime guards stay.** `assertSide`, `isValidMatchSnapshot`, the closed-set checks — untouched. A *computed* side (`who = isPlayer ? 'player' : 'enemy'`) still types as `string` and is caught only at runtime; that's why both nets exist.

## Implementation plan

1. **Stage 1 — tooling + zero-at-rest.** Add `tsconfig.json`, `scripts/check-types.mjs`, `src/types/ambient.d.ts`, the exact-pinned `typescript` devDep (committing the `package-lock.json` update), and the `check:types` script; apply the CSS ambient + JSDoc annotations in the **seven owned files** until `check:types` is green. **If a fix would require touching a transitive file or restructuring *logic*, STOP and re-scope** (criterion 2 + the ownership policy). **Checkpoint:** `check:types` green; `test:ui`/`test:app`/`test:query`/`test:codex`/`build`/`check:docs` green; the diff is config + `package-lock` + annotations only.
2. **Stage 2 — prove it bites (the checkpoint that matters).** Re-inject `applyStep(cur, 5)`, `initialLife: { player, enemy }`-shaped mismatch, and `dd.syncLife('enemy', …)` at their real call sites; run `check:types`; confirm each fails; revert. Capture the raw output in the commit message.
3. **Docs:** add `check:types` to the enumerated baseline gates in `ENGINEERING_CONSTITUTION.md`, `AGENTS.md`, `CLAUDE.md`, `BUILD.md` (mirrors `test:app`).

## Data migration and compatibility

**Not applicable** — no persisted data, schema, or format. Comments, one config, one script, one devDep.

## Documentation impact

| Document | Disposition |
|---|---|
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) / [`AGENTS.md`](../../AGENTS.md) / [`CLAUDE.md`](../../CLAUDE.md) / [`BUILD.md`](../../BUILD.md) | **Update.** Add `npm run check:types` to the enumerated baseline gate commands (like `test:app`), noting it is a build-time type gate over the match-view typed boundaries. |
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Update — short note.** Record the `check:types` gate + its scope, and that App/Collection are deferred (measured React-prop noise). |
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) / [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Reviewed — no change.** |

## Rollback and recovery

Delete `tsconfig.json`, `scripts/check-types.mjs`, `src/types/ambient.d.ts`, the `check:types` script, and the doc lines; remove `typescript` from `devDependencies` and **revert the `package-lock.json` entry** (`npm install` regenerates it). The JSDoc comments are inert and may stay. **No runtime code path to roll back.** One-commit revert.

## Verification plan

- **Automated (the gate):** `check:types` green at rest is the standing proof. **Stage 2's inject/revert is the proof it works** and belongs in the commit message.
- **Regression:** `test:ui`/`test:app`/`test:query`/`test:codex` stay green (guards' tests untouched — evidence nothing was traded away); `build` unaffected (Vite ignores tsconfig).
- **Native/web:** N/A — build-time only, runtime-identical. **This gate must never be cited as evidence for any runtime/device behaviour** (`checked-js-pilot.md` §Verification).
- **No device gate** — nothing ships.

## Security, privacy, performance, and operations

No data or telemetry. **Dependency:** `typescript` becomes a *direct* dev dependency; it already resolves transitively (via `firebase-tools`), so an existing workspace re-uses it, but a **clean install fetches it as a declared direct dep** (dev-only, absent from bundle/APK — the offline-first/no-CDN runtime posture is unaffected). `tsc` on the 23-file closure is ~1–3 s locally.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| An owned file needs *logic* restructuring to pass | Low | Medium | Criterion 2 is a stop condition; the 22 owned diagnostics are all annotation-shaped (measured) |
| A shared transitive file (e.g. `deckRepository`) later emits a diagnostic and fails the gate | — | — | **Resolved (Rev 2):** the ownership filter discards non-owned diagnostics; a transitive edit can never fail the gate |
| A `any` bridge hides a defect on the native path | — | — | **Resolved (Rev 2):** no `any` declarations; the Capacitor bridge is transitive, out of ownership, and stated as such |
| The gate becomes noise people skip | Low | Medium | Green-at-rest required; owned-file filter; `strict:false` keeps it signal-focused |
| False security — "types cover it now" | Medium | Medium | Runtime guards stay, documented as complementary; computed values remain runtime-only |
| Reviewer judges even the scoped gate ceremony-over-value (no live bug found) | Low–Medium | Low | Fair — the value is author-time capture of a class that *shipped twice*; the diagnostic + bite-proof are the evidence, and the cost is annotations, not logic |

## Self-Critique

- **Strongest reason it's marginal:** the diagnostic found **no live bug**, and the historical bugs are already fixed by runtime guards. So this buys *earlier* detection of a class currently caught late — at the cost of a devDep, a config, a gate, and an annotation pass. A reviewer who says "the guards are enough, defer" is not wrong; the honest answer is that the class *shipped twice*, was invisible to tests both times, and author-time capture is cheap now that the boundaries are typed.
- **The part most likely to be over-built:** the in-file `VModal` prop `@typedef`s (~7 diagnostics). If typing them reads as "annotating to please the checker," the fallback is to exclude `LifeCounter.jsx` and gate only the six pure boundaries — but that regresses toward the pilot's rejected shape (no caller = no caller-mismatch catch), so I'd rather annotate than gut the value.
- **Highest-consequence assumption:** zero-at-rest without logic change. Measured as annotation-shaped, but if a file resists, criterion 2 says stop and re-scope, not restructure.
- **What I explicitly did NOT do:** app-wide `check:types` (306 diagnostics, measured, declined), `strict` (36 implicit-any, declined), typing the component tree. Each was tested against Option A's stop rule and failed it.
- **Failure most likely to escape:** a *computed* side/key typed as `string`, which the checker accepts and the runtime guard then catches — proving the two nets are complementary, not redundant.

## Approval requested

Add a scoped, committed `check:types` gate — `tsconfig.json` + `scripts/check-types.mjs` (the owned-file ownership filter) + exact-pinned `typescript` devDep — over `LifeCounter.jsx` and the six typed boundary modules, brought to green-at-rest by a single CSS ambient decl + JSDoc annotations in the owned files (no logic change, no `any`), with the historical-bug inject/revert as the bite-proof, and `check:types` added to the baseline gates. **Decline** the app-wide scope (measured 306 diagnostics / 56% React prop-noise — Option A stop condition) and `strict`. **Standard** risk, build-time only, no device gate. Rev 2 resolves both Majors (ownership boundary via the filter; no `any` bridge) and the Minor (exact pin, lockfile, clean-install). Decisions: (1) approve the scoped gate + owned-file annotation cleanup; (2) ratify declining app-wide/`strict`; (3) approve `typescript` as an exact-pinned direct devDep + `check:types` in the baseline. **No gate code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted Rev 1 (diagnostic-backed) | 2026-07-18 |
| Codex (reviewer) | **Changes required** — 2 Major (checked scope broader than ownership model; broad ambient `any` violates the no-`any` condition) + 1 Minor (dependency lifecycle) · ratified declining app-wide + `strict`, approved TS devDep in principle | 2026-07-18 |
| Claude Code (author) | **Rev 2** — mechanical ownership filter (`scripts/check-types.mjs`) + 23-file closure enumerated + policy; `any` bridge removed (ambient is CSS-only); exact pin + `package-lock` + clean-install corrected | 2026-07-18 |
| Codex (reviewer) | *pending re-review* | |
| Human (approver) | *pending* | |
