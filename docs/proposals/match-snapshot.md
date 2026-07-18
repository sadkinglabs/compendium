# Proposal: single-source the ongoing-match snapshot (build/restore pair)

## Status and classification

**Status: Rev 2 — revised after review; awaiting re-review** · Risk: **Standard** (behavior-preserving extraction, but on the durable resume path — needs a device resume check)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-18 · Roadmap §16 #2, **first of two slices** (the roll-off phase machine is deferred — §7). **No implementation has begun.**

> **Rev 2 (all findings accepted):** the module moves to **`src/store/matchSnapshot.js`** — the
> snapshot is a durable serialized contract, so store ownership keeps the dependency direction
> right (`ongoingMatch` imports it locally; `LifeCounter`/`App` import *upward* from the store;
> tests under `test:query`). A **Documentation impact** section is added. The "one-module change"
> claim and the round-trip property are corrected: the extraction single-sources the serialized
> *mapping/defaults/validation/version* — not all producer/consumer behavior — and the honest
> round-trip is over a normalized resumable-state object, plus raw-v1 compatibility fixtures.

## Problem and success criteria

**The ongoing-match snapshot's shape is defined in one place but consumed in several, so build and restore can silently drift.** `LifeCounter.buildSnapshot` (`src/pillars/LifeCounter.jsx:137-142`) assembles ~15 fields into the resumable snapshot. Those fields are *restored* across scattered sites: `pRef`/`eRef` (`:51-52`), `log` (`:111`), `oppName` (`:109`), `clockOn` (`:114`), `recorded` (recordedRef), and `elapsedBase` (`:118`) inside `LifeCounter`, plus `mode`/`settings`/`you`/`opp`/`deck` consumed by `App.resumeMatch` (`App.jsx:254`). Validation lives in a third place (`ongoingMatch.isValidSnapshot`). Nothing ties these together.

Consequence: adding, renaming, or removing a snapshot field means updating every scattered consumer by hand. The LifeCounter classification already flagged `clockOn` and `recorded` as the drift-prone ones, and the **durable-autosave feature just shipped depends entirely on this snapshot being correct** — autosave writes `buildSnapshot()` on background, and boot restores it. A build/restore mismatch is a silent resume-data bug (lost log, wrong elapsed, a re-recordable finished match).

**Success criteria**

1. One pure **store-layer** module (`src/store/matchSnapshot.js`) single-sources the snapshot's serialized **mapping, defaults, validation, and version**: `buildMatchSnapshot`, `readMatchSnapshot`, `isValidMatchSnapshot`, `SNAP_VERSION`.
2. Every consumer routes through it: `LifeCounter.buildSnapshot` + its resume initializers, `App.resumeMatch`, and `ongoingMatch` validation (`ongoingMatch` imports it locally, store→store; `LifeCounter`/`App` import upward, ui→store).
3. The serialized mapping/defaults/version live in **one** module, so adding a field touches that module's `build`+`read` plus the producer/consumer that supply and use the value — never a fourth scattered validation or default site. A round-trip test over the normalized resumable state proves build/restore can't drift undetected: `readMatchSnapshot(buildMatchSnapshot(normalizedState))` deep-equals `normalizedState`.
4. **Zero behavior change** — same fields, same defaults, same `SNAP_VERSION` (1), same on-disk format. Minimize→resume and cold-boot (autosave) resume behave identically, incl. raw v1 snapshots from the current implementation.

**Non-goals**

- The roll-off / match phase machine (deferred, §7).
- Any change to the snapshot's shape, `SNAP_VERSION`, or `localStorage` format.
- Any change to `restoreSide`'s life/max clamping (that stays in `matchLife.js`; this module owns *field shape*, not life rules).
- Any UI or timing change.

## Evidence and current architecture

- `LifeCounter.jsx:137-142` — `buildSnapshot()` → `{ v:1, mode, settings, you, opp, deck, pLife, pMax, eLife, eMax, log, elapsedSec, oppName, recorded, clockOn }`. Reads refs (`pRef`/`eRef`/`recordedRef`), state (`log`/`oppName`/`clockOn`), and computes `elapsedSec()`.
- Restore-side seeds: `:51-52` (`pRef`/`eRef` via `restoreSide`), `:109` (`oppName`), `:111` (`log`), `:114` (`clockOn`), `:118` (`elapsedBase` ← `elapsedSec`), `recordedRef` (← `recorded`). Identity fields consumed by `App.jsx:254` (`resumeMatch` destructures `ongoing.mode/settings/you/opp/deck`).
- `ongoingMatch.js:18-22` — `isValidSnapshot`: `v === SNAP_VERSION` + `Number.isFinite` on the four life/max fields. `restoreSide` (matchLife) already clamps those on read.
- Precedent pure **store** modules (the right layer for a serialized contract): `collectionGroups.js`, `compareEngine.js`, `matchStats.js`, `collectionWrites.js` — node-tested under `npm run test:query`. `ongoingMatch.js` already lives in `src/store` and is the localStorage adapter this module supplies the contract to.

## Assumptions and confidence

1. **The ~15 fields above are the complete snapshot surface.** Confidence: **high** — `buildSnapshot` is the sole producer; validated by a grep of `ongoing.`/`resume?.` reads at implementation.
2. **A round-trip `read(build(x)) === x` is achievable for the resumable fields.** Confidence: **high** — they are plain data; defaults (`log||[]`, `elapsedSec||0`, `recorded||false`, `oppName||''`, `clockOn??false`) are the only transform.
3. **Routing consumers through the module changes no behavior.** Confidence: **medium-high** — same fields/defaults; the risk is a missed field or a changed default, which the round-trip + field-completeness tests and the device resume check catch.

## Affected systems and invariants

- **Durable, offline-first writes (§3.3):** unchanged format; this *hardens* the resume path by making the shape single-sourced (directly de-risks the autosave feature). No `SNAP_VERSION` bump.
- **Cross-runtime integrity (§3.8):** the module is pure/runtime-identical; resume is runtime-sensitive, hence the device check.
- **No double-record (Feature Matrix §5.2):** `recorded` continues to round-trip, so a recorded match can't be re-recorded after resume.
- **Schema/format:** unchanged.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** (scattered build + restore) | Rejected — the drift risk the autosave feature now leans on. |
| **Pure `matchSnapshot.js` build/restore/validate, all consumers routed through it** (proposed) | **Recommended.** Smallest change that single-sources the shape; mirrors `matchLife`. |
| Extract the whole match lifecycle (phase machine + snapshot) at once | Rejected — the roll-off machine is DOM/animation-coupled and higher-risk; do the clean pure slice first (matchLife precedent). |
| A TypeScript/JSDoc type for the snapshot instead of a build/restore pair | Rejected as the primary fix — a type documents the shape but doesn't single-source the *defaults* or give a round-trip test; JSDoc typedefs can ride along (§ optional). |

## Proposed design

**`src/store/matchSnapshot.js` (pure):**
```js
export const SNAP_VERSION = 1;

// Assemble the resumable snapshot from live match values. ONE definition of the shape.
export function buildMatchSnapshot({ mode, settings, you, opp, deck, p, e, log, elapsedSec, oppName, recorded, clockOn }) {
  return {
    v: SNAP_VERSION, mode, settings, you: you || null, opp: opp || null, deck: deck || null,
    pLife: p.life, pMax: p.max, eLife: e.life, eMax: e.max,
    log: log || [], elapsedSec: elapsedSec || 0, oppName: oppName || '', recorded: !!recorded, clockOn: !!clockOn,
  };
}

// Read a snapshot into the normalized values every consumer needs, with defaults. Life/max
// are returned raw as { p, e }; the caller clamps via matchLife.restoreSide (life rules live there).
export function readMatchSnapshot(s) {
  return {
    mode: s.mode, settings: s.settings, you: s.you || null, opp: s.opp || null, deck: s.deck || null,
    p: { life: s.pLife, max: s.pMax }, e: { life: s.eLife, max: s.eMax },
    log: s.log || [], elapsedSec: s.elapsedSec || 0, oppName: s.oppName || '', recorded: !!s.recorded, clockOn: s.clockOn ?? false,
  };
}

// Structural validity for resume (finite life/max + version). restoreSide still clamps range.
export function isValidMatchSnapshot(s) {
  return !!s && s.v === SNAP_VERSION
    && Number.isFinite(s.pLife) && Number.isFinite(s.pMax)
    && Number.isFinite(s.eLife) && Number.isFinite(s.eMax);
}
```

**Consumers:**
- `LifeCounter.buildSnapshot` → `buildMatchSnapshot({ mode, settings, you: players.you, opp: players.opp, deck, p: pRef.current, e: eRef.current, log, elapsedSec: elapsedSec(), oppName, recorded: recordedRef.current, clockOn })`.
- `LifeCounter` initializers → `const r = resume ? readMatchSnapshot(resume) : null;` then seed from `r` (`pRef = useRef(r ? restoreSide(r.p) : initSide(start))`, `log` ← `r?.log`, `oppName` ← `r?.oppName`, `clockOn` ← `r?.clockOn`, `elapsedBase` ← `r?.elapsedSec`, `recordedRef` ← `r?.recorded`).
- `App.resumeMatch` → `const r = readMatchSnapshot(ongoing); setMatch({ mode: r.mode, settings: r.settings, you: r.you, opp: r.opp, deck: r.deck, resume: ongoing });`
- `ongoingMatch.isValidSnapshot` → delegate to `isValidMatchSnapshot` (single validation home; `ongoingMatch` stays the localStorage adapter).

Optional JSDoc `@typedef MatchSnapshot` in the module (free, documents the shape).

## Implementation plan

1. Add `src/store/matchSnapshot.js` + `matchSnapshot.test.mjs` (round-trip, field-completeness, defaults, validity, raw-v1 compat). **Checkpoint:** `test:query` green.
2. Route the four consumers through it; `ongoingMatch` imports its validation/version locally (store→store). **Checkpoint:** `test:query`/`test:ui`/`build`/`check:docs` green; diff is a wiring swap.
3. Device: minimize→resume and background→kill→cold-boot→resume (the autosave path) both restore life/log/elapsed/clock/recorded identically on the installed build.

## Data migration and compatibility

**Not applicable** — no format/version change. Snapshots written by prior builds read identically (same field names/defaults). `SNAP_VERSION` stays 1.

## Documentation impact

Per Constitution §13, every source-of-truth document is classified:

| Document | Disposition |
|---|---|
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) | **Update.** In §9 "Ongoing match (resumable snapshot)", name `src/store/matchSnapshot.js` as the owner of the serialized shape, defaults, and `SNAP_VERSION`; `ongoingMatch.js` remains the profile-scoped `localStorage` adapter (it imports the contract). No schema/format change. |
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Update — short note.** Record the pure snapshot contract as a store-layer module and the dependency direction (adapter and UI both depend on the store-owned shape; the shape depends on neither). |
| [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Reviewed — no change.** Resume behavior is unchanged; the Play §5 capabilities/invariants are preserved. |
| [`BUILD.md`](../../BUILD.md) | **Reviewed — no change.** The existing installed-app resume workflow supplies the device verification. |
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) / [`AGENTS.md`](../../AGENTS.md) | **Reviewed — no change.** No process change. |

## Rollback and recovery

One-commit revert per checkpoint; no persisted-format change, nothing to migrate back.

## Verification plan

- **Automated (load-bearing for drift):** `matchSnapshot.test.mjs` under `test:query` — the round-trip `readMatchSnapshot(buildMatchSnapshot(normalizedState))` deep-equals `normalizedState`; every field present; `isValidMatchSnapshot` accepts a good snapshot and rejects wrong-version / non-finite. **Plus raw-v1 compatibility fixtures** (a snapshot as the current implementation writes it), covering: omitted optional fields (default in), **explicit `false` for `clockOn` and `recorded`** (preserved, not defaulted away — `clockOn` via `??`), empty `log`, `deck: null`, real identity/`settings` objects passed through unchanged, and finite-but-out-of-range life values left **raw** (unclamped — `restoreSide` clamps later). `test:ui`/`test:codex`/`build`/`check:docs` for the wiring.
- **Device (resume path):** installed release — minimize a match mid-game and resume (life, log, clock, elapsed intact); background→kill→cold-boot→**Return to Match** resumes identically; a recorded-then-resumed match cannot be re-recorded.
- **Regression:** a fresh (non-resumed) match still seeds correctly (initSide, rollPhase armed, birth 0).

## Security, privacy, performance, and operations

No new data, dependency, or telemetry. Pure functions; negligible cost. `docs/proposals/durable-ongoing-autosave.md` (the autosave feature) is the direct beneficiary.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A snapshot field missed in the module (e.g. a future field) | Low | Medium | Field-completeness test; grep every `ongoing.`/`resume?.` read at implementation |
| A default subtly changes on read (e.g. `clockOn ?? false` vs `|| false`) | Low | Medium | `clockOn` uses `??` to preserve an explicit `false`; tests pin each default |
| The identity fields (`mode`/`settings`) carry structure the read flattens | Low | Low | `readMatchSnapshot` passes them through unchanged |

**Resolved (Rev 2, Codex):** `SNAP_VERSION`/`isValidMatchSnapshot` live in `src/store/matchSnapshot.js`; `ongoingMatch.js` imports them **locally within the store layer** (store→store) and remains the profile-scoped localStorage adapter. This keeps the dependency direction right and puts shape + validity + version in one place.

## Self-Critique

- **Strongest reason it's marginal:** the snapshot is ~15 plain fields and drift hasn't *shipped* a bug yet — a skeptic can call this preventive tidying. Fair, but the autosave feature now depends on this shape, `clockOn`/`recorded` were already flagged fragile, and the cost is one small pure module. Preventive is the right posture on a durable path.
- **Highest-consequence assumption:** that routing consumers changes no behavior. A missed field or changed default would be a silent resume bug — caught by the round-trip/field tests and the device resume check, which is why the device step is mandatory despite the pure core.
- **Simpler rejected option:** a JSDoc type only. It documents but doesn't single-source defaults or give a round-trip guarantee; it can ride along, not replace.
- **Coupling I might miss:** `App` and `ongoingMatch` are consumers too, not just `LifeCounter` — all four must route through the module or the drift persists. Enumerated in the plan.
- **Failure likely to escape tests:** a runtime-only resume nuance (e.g. `settings` object identity affecting a re-render) — hence the device resume pass.
- **Evidence that would change direction:** if the grep finds the snapshot is read in more places than the four, widen the wiring; if a round-trip can't be made exact, the extraction isn't clean and I reconsider.

## Approval requested

Extract a pure `matchSnapshot.js` that single-sources the ongoing-match snapshot shape (`build`/`read`/`validate` + `SNAP_VERSION`), route `LifeCounter`, `App.resumeMatch`, and `ongoingMatch` through it, behavior-preserving. **Standard** risk (durable resume path → device check is the completion gate). This is the first of two slices of roadmap #2; the roll-off phase machine is a separate later proposal. Decisions: (1) approve the extraction + the four-consumer wiring; (2) approve `SNAP_VERSION`/validation moving into `matchSnapshot`. **No code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted Rev 1 | 2026-07-18 |
| Codex (reviewer) | **Changes required** — 2 Major (module location reverses dep direction; missing docs-impact) + 1 Minor (one-module/round-trip wording) | 2026-07-18 |
| Claude Code (author) | **Rev 2** — module → `src/store`; docs-impact added; success-criterion + round-trip corrected; raw-v1 compat fixtures | 2026-07-18 |
| Codex (reviewer) | *pending re-review* | |
| Human (approver) | *pending* | |
