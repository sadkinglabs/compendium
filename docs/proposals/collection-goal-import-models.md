# Proposal: Collection goal + import models, and the `stepSet` barrier

## Status and classification

**Status: Rev 1 — Stages 1-2 APPROVED; Stage 3 DEFERRED (Codex + human)** · Risk: **Standard**, reduced to **Contained** for the approved scope (stages 1-2 are behavior-preserving pure extractions with no device gate beyond a proportionate import/progress smoke)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-18 · Roadmap §16 #3, **scoped down after discovery**. **Implementing Stages 1-2 only.**

> **Disposition (2026-07-18):** Codex approved Stages 1-2 and the scope decision (decline the unification); **Stage 3 is deferred**. Stage 3's `pending()===0` idle check does not close the race it names — a subscription can observe idle, start `ownedBySet()`, a tap lands (optimistic update + tracked write), then the stale read resolves and stomps the display (TOCTOU). Closing it correctly requires a version guard on *every* `ownedBySet → setOwBySet` path (initial + subscription + settle), i.e. extending `createGoalDrain` with a guarded `refresh()` — larger than the proposed reuse-only change, and not justified by a cosmetic, self-healing flicker. If a real device-visible flicker later justifies it, it returns as its own proposal: a generic reconcile controller with a guarded `refresh()` and deterministic "refresh starts → tap begins → stale refresh resolves" coverage. **Minor accepted:** `importTallies` models the Collection printing import only; `ListBulkAddSheet` keeps its local `totalQ` reduce (it has `{adds, unresolved}`, no single/multi partition).

> **Scope decision (evidence-driven).** Roadmap #3's headline was a *three-way reducer unification onto `useOwnedLedger`*, justified by three concurrency hazards: a goal-ledger stale-closure clobber race, a cross-profile `ownedChains` drain hazard, and a wishlist/owned shared-row race. **A read-only discovery pass confirmed all three are already fixed** by the merged collection-write-integrity work (delta writes re-read in a serialized turn; `ownedChains` retired and profile captured at schedule time; wishlist/owned share one row-key → one chain; `writeSetRow` routes the `''` row through `writeQty`). The unification's remaining value is therefore **de-duplication only, not correctness** — and it is a behavior-changing rewrite on the app's most data-loss-prone surface. **This proposal declines the unification** and instead delivers the parts that still pay off: two pure extractions of genuinely testable inline logic, plus giving the one under-hardened optimistic machine (`stepSet`) the same barrier its two siblings already have — by *adopting the existing* `createGoalDrain`, not inventing a new abstraction.

## Problem and success criteria

**Two pieces of consequential Collection logic are untested and tangled inside sheet/detail components, and one of three optimistic machines lacks the reconcile barrier the others have.**

1. **Import planning** — the "which printing does this card land in" routing (single-set files automatically; multi/zero-set needs a choice, defaulting to Unspecified; unresolved is skipped) lives inline in `ImportTextSheet.review`/`confirm` (`Collection.jsx:137-167`). This is *user-facing collection correctness* — the same printing-routing class that produced the earlier wishlist-wipe grief — and it has no test.
2. **Goal/progress math** — the completion model (`req/have/names/done/missing/percent/complete`) that drives every wishlist and list progress bar and the `complete` flag lives inline in `ListDetail.totals` (`Collection.jsx:1281-1290`), with the per-row `goalMet` at `:1077-1080`. Pure, consequential, untested.
3. **`stepSet` reconcile barrier** — of the three optimistic machines, `useOwnedLedger` (`OwnedControl.jsx:21-94`) and the `ListDetail` goal machine (via `createGoalDrain`) both suppress a live reconcile while their own writes are in flight and re-read on settle. **`stepSet` (`Collection.jsx:521-536`) does not**: its reconcile is a debounced 250 ms `subscribeCollection → refreshOwnership` (`:512-516`) with no `pending` guard, so a reconcile that lands between an optimistic step and its DB write can momentarily revert the displayed count (self-healing on the next reconcile; the DB write itself is serialized and correct).

**Success criteria**

1. `src/store/importPlan.js` single-sources the Collection-import partition + choice-defaulting + confirm-item assembly + tallies, consumed by `ImportTextSheet`, proven by test. (`ListBulkAddSheet` keeps its own local `totalQ` reduce — it has no single/multi partition, so routing it here would need fake categories; Codex Minor accepted.)
2. `src/store/listGoalModel.js` single-sources `goalTotals` and `goalRowState`, consumed by `ListDetail` and `ListCardRow`, proven by test.
3. `stepSet`'s optimistic `owBySet` reconcile is guarded by the **existing** `createGoalDrain` (versioned, `pending`-barriered), so an in-flight step can't be transiently stomped. `wishSet` (not stepped in this grid) keeps refreshing eagerly.
4. Stages 1-2 are **zero behavior change**. Stage 3 changes only *when* the optimistic owned display reconciles (never the DB, never a durable write, never a persisted value).

**Non-goals**

- **The three-way reducer unification.** Declined (evidence above). No shared "optimistic machine" abstraction is created; `stepSet` reuses `createGoalDrain` as-is.
- Any change to the write queue, row keys, `ownedRepository`, profile binding, or the durable write path.
- Any change to the resolvers (`previewCollectionText`, `importCollectionResolved`, `resolveCardList`) or persisted progress (`listProgress`).
- Any UI/visual change.

## Evidence and current architecture

- **Import (extractable):** `Collection.jsx:143-146` (`single`/`multi` partition + `choiceDefaults`), `:154-157` (confirm items: single→`sets[0].code`, multi→`choice[card_id] || ''`), `:164-167` (tallies). Impure neighbours that stay: `previewCollectionText`/`importCollectionResolved` (repo), `toast`, `setStep`/`setPreview` (state). Bulk tally: `:261` (`totalQ`).
- **Goal math (extractable):** `Collection.jsx:1281-1290` (`totals` reduction over `qty`×`ownQty`), `:1078` (`goalMet = isWanted && target > 0 && owned >= target`). The optimistic mirror (`qtyRef`), `applyGoal`, `persist`, `track`, and `createGoalDrain` wiring stay in the component — this extraction owns only the *math*, not the machine.
- **`stepSet` (barrier target):** optimistic `setOwBySet` + `enqueueWrite(ownedRowKey(...), re-read delta)` (`:521-536`); reconcile via `refreshOwnership` (`:504-508`) on a debounced bus (`:512-516`) with **no `pending` guard**.
- **The barrier to reuse:** `createGoalDrain({ read, apply, isAlive })` (`collectionGoalDrain.js:11-35`) — monotonic `version` + `pending` counter; `track(p)` schedules a settle-reconcile that applies only if still current. Already node-tested.
- **Precedent pure store modules:** `collectionGroups.js`, `collectionWrites.js`, `matchStats.js` — node-tested under `test:query`. `importPlan`/`listGoalModel` join them (pure, no timing).

## Assumptions and confidence

1. **The import partition/assembly at `:143-157` is pure over `previewCollectionText`'s output.** Confidence: **high** — it filters by `i.sets.length` and maps to `{card_id, qty, setCode}`; no I/O.
2. **`goalTotals` is pure over the two Maps.** Confidence: **high** — a reduction; `ownQty.get(id) || 0` and per-card `Math.min` are the only transforms.
3. **`stepSet` adopting `createGoalDrain` changes only reconcile timing, never the DB.** Confidence: **medium-high** — the write path (`enqueueWrite`) is untouched; only the *apply* of a re-read is gated. The risk is a missed external edit during a write, which the settle-reconcile re-read picks up (self-healing, exactly as `useOwnedLedger` and reducer C already behave). Device smoke covers it.
4. **`wishSet` needs no barrier here.** Confidence: **high** — it is not optimistically stepped in this grid (only `owBySet` is); it can keep refreshing eagerly.

## Affected systems and invariants

- **Eight §3 invariants:** none is touched. Notably **transactional user-data (§3.5)** and **durable offline-first writes (§3.3)** are untouched — stage 3 changes optimistic *display* reconcile timing, never a write, row key, or persisted value. **Profile isolation (§3.2)** is unchanged (`stepSet` already captures `pid` at schedule time).
- **Import printing-routing (product correctness):** *hardened* — the single/multi/Unspecified routing becomes a tested pure function.
- **List completion reporting (product correctness):** *hardened* — `goalTotals`'s `complete`/`percent` becomes tested.
- **Cross-runtime integrity (§3.8):** modules are pure/runtime-identical; stage 3's timing change is runtime-sensitive, hence the device smoke.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** (import + goal math inline, `stepSet` unbarriered) | Rejected — untested user-facing routing/completion math; one machine can transiently flicker. |
| **Two pure extractions + `stepSet` adopts `createGoalDrain`** (proposed) | **Recommended.** Delivers #3's real value; smallest change; reuses hardened code. |
| **Full three-way unification onto `useOwnedLedger`** | **Declined** — its three target bugs are already fixed; remaining value is de-dup only, at high risk on the most data-loss-prone surface. Fails the "less indirection, not more" continue-signal when the prize is gone. |
| **`stepSet` gets a new inline `pending` barrier (4th copy of the pattern)** | Rejected — `createGoalDrain` already exists and is tested; a 4th inline copy is the duplication we're trying not to add. |
| Extract a shared `createOptimisticLedger` and move A/B/C onto it | Rejected — that *is* the unification in disguise; out of scope. |

## Proposed design

**`src/store/importPlan.js` (pure):**
```js
// Partition previewCollectionText output into the review model (single files automatically;
// multi/zero-set need a set choice, default Unspecified; unresolved is skipped).
export function planCollectionImport({ items, unresolved }) {
  const single = items.filter((i) => i.sets.length === 1);
  const multi  = items.filter((i) => i.sets.length !== 1);   // 0 or 2+ sets need a choice
  const choiceDefaults = {};
  for (const i of multi) choiceDefaults[i.card_id] = '';       // '' = Unspecified
  return { single, multi, unresolved: unresolved || [], choiceDefaults };
}
// Assemble importCollectionResolved's write items from the reviewed plan + user choices.
export function buildImportItems({ single, multi }, choice = {}) {
  return [
    ...single.map((i) => ({ card_id: i.card_id, qty: i.qty, setCode: i.sets[0].code })),
    ...multi.map((i)  => ({ card_id: i.card_id, qty: i.qty, setCode: choice[i.card_id] || '' })),
  ];
}
// Review tallies for the sheet header/CTA.
export function importTallies({ single, multi, unresolved }) {
  const nBad = (unresolved || []).length;
  return { nSingle: single.length, nMulti: multi.length, nBad,
           totalCopies: [...single, ...multi].reduce((s, i) => s + i.qty, 0) };
}
```

**`src/store/listGoalModel.js` (pure):**
```js
// Reduce the optimistic goal map (card_id -> wanted target) and the live owned map into the
// list's progress totals. Entries with target <= 0 are ignored; `have` is capped per card.
export function goalTotals(qty, ownQty) {
  let req = 0, have = 0, names = 0, done = 0;
  for (const [id, t] of qty) {
    if (t <= 0) continue;
    names++; req += t;
    const h = Math.min(ownQty.get(id) || 0, t);
    have += h; if (h >= t) done++;
  }
  return { req, have, names, done, missing: req - have,
           percent: req ? Math.round((have / req) * 100) : 0,
           complete: req > 0 && have >= req };
}
// One card row's goal state. Only 'wanted' lists show completion.
export function goalRowState({ owned, target, isWanted }) {
  return { goalMet: isWanted && target > 0 && owned >= target, ownedAny: owned >= 1 };
}
```

**`stepSet` barrier (`Collection.jsx`):** introduce an owned-drain via the existing module —
```js
const ownDrainRef = useRef(null);
// created alongside refreshOwnership setup:
ownDrainRef.current = createGoalDrain({ read: ownedBySet, apply: setOwBySet, isAlive: () => alive });
```
`stepSet` tracks its write: `ownDrainRef.current?.track(enqueueWrite(ownedRowKey(...), ...))`. The debounced `subscribeCollection` handler refreshes `wishSet` eagerly but reconciles `owBySet` only when the drain is idle (`pending() === 0`); the drain's own settle-reconcile catches up `owBySet` (including any external edit) once writes land. No change to the write itself.

## Implementation plan

1. **Stage 1** — add `src/store/importPlan.js` + `importPlan.test.mjs`; route `ImportTextSheet.review`/`confirm`/tallies and `ListBulkAddSheet` tally through it. **Checkpoint:** `test:query` green; diff is a wiring swap.
2. **Stage 2** — add `src/store/listGoalModel.js` + `listGoalModel.test.mjs`; route `ListDetail.totals` and `ListCardRow.goalMet` through it. **Checkpoint:** `test:query` green.
3. **Stage 3 (behavior change — display only)** — `stepSet` adopts `createGoalDrain`; guarded `owBySet` reconcile. **Checkpoint:** `test:ui`/`test:query`/`build`/`check:docs` green; **device smoke** (below). Requires explicit human sign-off on the timing change before merge.

Stages 1-2 can merge without stage 3; stage 3 is independent.

## Data migration and compatibility

**Not applicable** — no persisted data, format, schema, or write-path change. Stage 3 is optimistic-display timing only.

## Documentation impact

| Document | Disposition |
|---|---|
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Update — short note.** List `importPlan.js`/`listGoalModel.js` as pure Collection store modules; note `stepSet` now shares the `createGoalDrain` reconcile-barrier regime. |
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) | **Reviewed — likely no change.** No persistence/schema change; confirm the §11 write-queue note still reads true (it does — the queue is untouched). |
| [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Reviewed — no change.** Import and list-progress behavior preserved. |
| [`BUILD.md`](../../BUILD.md) | **Reviewed — no change.** Existing installed-app Collection workflow supplies the device smoke. |
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) / [`AGENTS.md`](../../AGENTS.md) | **Reviewed — no change.** |

## Rollback and recovery

One-commit revert per stage; no persisted-format change. Reverting stage 3 restores the eager (unbarriered) reconcile — i.e. the current transient-flicker behavior, which was cosmetic and self-healing.

## Verification plan

- **Automated (load-bearing):**
  - `importPlan.test.mjs` (`test:query`): single/multi/zero-set partition; `choiceDefaults` all `''`; `buildImportItems` routes single→`sets[0].code`, multi→`choice||''`, and an unspecified (`''`) choice stays `''`; tallies incl. `totalCopies` summing single+multi only (unresolved excluded); empty/`undefined` `unresolved` tolerated.
  - `listGoalModel.test.mjs` (`test:query`): `goalTotals` over mixed owned/target maps — `have` capped per card, `done` counts met cards, `missing = req - have ≥ 0`, `percent` rounding, `complete` iff `req>0 && have≥req`, empty map → all-zero/`complete:false`; `goalRowState` truth table (wanted vs custom, target 0, owned≥target).
  - `test:ui`/`test:codex`/`build`/`check:docs` for wiring + stage 3.
- **Device (stage 3 smoke):** installed release — in My Collection, rapidly step a printing's owned count up/down; the displayed count must not flicker/revert and must settle correct; an edit from the card sheet still reflects in the grid (self-heal). Import: paste a list with a single-set card, a multi-set card, and an unrecognised line → review shows the three buckets, choosing a set routes correctly, import lands the right printings. Wishlist/list bars update as owned grows.
- **Regression:** the wiring diffs (stages 1-2) inspected line-for-line against the cited lines to confirm expression-identity.

## Security, privacy, performance, and operations

No new data, dependency, or telemetry. Pure functions; negligible cost. Stage 3 slightly *reduces* redundant reconcile applies under rapid stepping.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A wiring swap isn't expression-identical (a changed default, e.g. `choice[id] \|\| ''`) | Low | Medium | Line-for-line diff vs. `:143-157`/`:1281-1290`; tests pin each default |
| Stage 3 suppresses a *needed* `owBySet` refresh (external edit missed) | Low | Low–Medium | Settle-reconcile re-reads on drain idle (self-heal, as A/C already do); device cross-edit check |
| `wishSet` and `owBySet` reconcile diverge after the split | Low | Low | `wishSet` stays eager; only `owBySet` is gated — they read independently already |
| Reviewer reads stage 3 as creeping toward the declined unification | Low | Low | It reuses `createGoalDrain` unchanged; no new abstraction; A keeps its own inline barrier |

## Self-Critique

- **Strongest reason it's marginal:** with the three races already fixed, a skeptic can call all of this tidying. Fair on the *unification* (which is why it's declined) — but `importPlan` guards live user-facing printing-routing that has bitten this app before, and `goalTotals` guards completion reporting; both are currently untested. The `stepSet` barrier is the most marginal piece (cosmetic flicker) and is explicitly the smallest, reuse-only change.
- **The part most likely to be over-built:** stage 3. If the reviewer judges the flicker not worth any write-path-adjacent change, stages 1-2 ship alone and stage 3 is dropped — they are independent by construction.
- **Highest-consequence assumption:** that stage 3 never affects the DB. If discovery at implementation finds `refreshOwnership` feeds anything but display state, I stop and reassess. (Read says it sets `owBySet`/`wishSet` only.)
- **Coupling I might miss:** `ListBulkAddSheet`'s `onApply` fan-out (`:1414-1423`) is caller wiring, not import planning — it stays in the component; only its tally is a candidate. Named so I don't over-pull.
- **Failure likely to escape the pure tests:** a live reconcile-timing nuance under real rapid taps — hence the device smoke is the stage-3 gate.
- **Evidence that would change direction:** if the import partition turns out to be read/used somewhere beyond the two sheets, widen the wiring; if `goalTotals` can't reproduce the current bar exactly, the seam is wrong.

## Approval requested

Deliver roadmap #3's **real** value and **decline its declined-in-evidence unification**: two pure store modules (`importPlan.js`, `listGoalModel.js`) that single-source the import-routing and goal-completion math, plus `stepSet` adopting the existing `createGoalDrain` barrier. **Standard** risk; stages 1-2 behavior-preserving, stage 3 a contained optimistic-display timing change gated on a device smoke. Decisions: (1) approve declining the three-way unification on the recorded evidence; (2) approve the two extractions + four-point wiring; (3) approve the stage-3 barrier timing change (or defer it and ship 1-2 alone). **No code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted Rev 1 | 2026-07-18 |
| Codex (reviewer) | **Approved Stages 1-2 + scope decision; Stage 3 deferred** (1 Major: idle-check TOCTOU doesn't guard async refresh) + 1 Minor (importTallies scoped to Collection import; ListBulkAddSheet keeps local reduce) | 2026-07-18 |
| Human (approver) | **Approved Stages 1-2; defer Stage 3; ratify declining the unification** | 2026-07-18 |
