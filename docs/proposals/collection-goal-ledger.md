# Proposal: unify the Collection goal ledger onto the serialized re-read write path

## Status and classification

**Status: Draft — awaiting review** · Risk: **High** (mutates live profile-owned write paths across two surfaces and two tables)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-17 · Roadmap item §16 #3 from [`ui-state-optimisation.md`](./ui-state-optimisation.md). **No implementation has begun.**

## Problem and success criteria

**The Collection has three optimistic-step write regimes; two are safe and one — the goal/wishlist ledger — is not, and it drifts.** The owned ledger (`Cards.stepSet`, `Collection.jsx:518-530`) and the shared sheet hook (`useOwnedLedger.step`, `OwnedControl.jsx:58-87`) both write through `serialChain(ownedChains, …)` and **re-read the committed count inside each serialized turn**, so overlapping edits commute (`ownedUi.js:14-31`). The goal ledger in `ListDetail` (`Collection.jsx:1205-1239`) does neither:

1. **Absolute-write clobber (author-confirmed).** `write(cardId, next)` (`:1205-1208`) commits an **absolute** `next` computed from the `qty` React *state* Map (`:1223`, `:1215`, `:1379`). Two rapid `+1` taps in one render batch both read `qty=5`, both compute `next=6`, and the optimistic map + both DB writes land on `6` — one tap lost. (Contrast `useOwnedLedger`, which reads a synchronously-updated **ref** and writes by **delta** re-read inside `serialChain`, so rapid taps accumulate correctly.)
2. **Wishlist writes ride the wrong chain (author-confirmed).** For the Wishlist, `write` calls `setWanted(cardId, next)` on a **local** per-component `chains` ref (`:1172`, `:1207`). But `qty_wanted` lives in the **same `owned_cards` row** as owned, and `useOwnedLedger` serializes wanted on the app-wide `ownedChains` by `cardId` (`OwnedControl.jsx:71-72`). Two different chains for one row → a Wishlist edit in `ListDetail` and a wanted/owned edit in the card sheet for the same card can race an absolute write against a re-read write.
3. **List entries are edited from two surfaces, both unserialized.** `ListDetail` (absolute, local chain) and `CollectionCardSheet`'s list picker (`stepListEntry(list.id, cardId, +1)` directly, `CollectionCardSheet.jsx:113`) both mutate `card_list_entries` with no shared serialization.
4. **No self-heal.** `write`'s `.catch(()=>{})` (`:1207`) swallows a failed write and leaves the optimistic `qty` diverged until the list is reopened (owned edits self-heal via `useOwnedLedger`'s drain re-read; the goal ledger has nothing).
5. **`totals` duplicates `compareEngine`.** `ListDetail.totals` (`:1241`) hand-computes `min(owned, target)` completeness, while the index card derives the same figure through `compareRequirements` (`compareEngine.js`). They agree today but can drift independently (classifier finding).

**Honest stakes:** none of this loses *recorded* data or crosses a profile boundary — the repo writes stay profile-scoped (`ownedRepository` resolves `activeProfileId()` per call). The clobber costs at most a mis-counted goal quantity on rapid taps; the cross-surface race is a narrow window. The value is **correctness of goal counts under concurrent edits + collapsing three regimes toward one tested pattern + removing a drift risk** — not a data-integrity emergency. Scoped accordingly.

**Success criteria**

1. Every goal/wishlist write is **delta-based and serialized with a re-read inside its turn**, on the correct chain: Wishlist on `ownedChains` (by `cardId`), list entries on a shared `listEntryChains` (by `listId|cardId`) used by *both* `ListDetail` and `CollectionCardSheet`.
2. Rapid `+1/-1` taps on a goal accumulate exactly (no lost taps), proven by a pure unit test of the model and observed on device.
3. The goal transition rules (floor-1 + confirm-remove; floor-0 + silent-delete; bulk add) and the `totals` math live in a pure, tested `listGoalModel.js`, single-sourcing the completeness computation.
4. A failed write self-heals from the DB (drain re-read), so the optimistic map cannot stay diverged.
5. **No behavior change** to the read UX, the confirm-on-remove flow, the wishlist-vs-list routing, or any single-tap interaction.

**Non-goals**

- De-duplicating `Cards.stepSet` and `useOwnedLedger` into one hook (they are already safe; a further merge is a separate, lower-value cleanup).
- Any schema change (`card_list_entries` / `owned_cards` untouched).
- Any change to owned/foil editing, filtering, import review, or the Cards tab.
- Changing the confirm-on-remove UX or the read/edit-mode split.

## Evidence and current architecture

- `ownedUi.js:18-31` — `serialChain(ref, key, fn)` serializes per key on a ref-held promise chain; `ownedChains` is the app-wide owned-row chain. The re-read-inside-turn contract is documented here.
- `OwnedControl.jsx:58-87` — the reference regime: optimistic ref mirror + `pending` counter + `serialChain(ownedChains, key)` with re-read + `.finally` drain re-read (self-heal). Wishlist rides `cardId`; per-set owned/foil ride `cardId|set`.
- `Collection.jsx:518-530` — `Cards.stepSet`: owned ledger, serialized + re-read, optimistic mirror; no self-heal but `subscribeCollection` covers it. **Safe; out of scope.**
- `Collection.jsx:1156-1239` — `ListDetail`: `qty` state Map (`:1166`), local `chains` ref (`:1172`), `write` absolute+local+swallow (`:1205`), `step` floor-1-confirm (`:1222`), `addStep` floor-0-delete (`:1212`), `removeEntry` (`:1234`), `bulk onApply` absolute (`:1374-1383`), `totals` (`:1241`).
- `ownedRepository.js:419-429` — `setListEntry(listId,cardId,qty)` (absolute; 0 deletes) and **`stepListEntry(listId,cardId,delta)`** (re-reads `cur` then sets) already exist. `:91/:103` — `setWanted` / **`stepWanted`** (re-reads) exist. The delta-based, re-reading primitives the fix needs are already in the repo.
- `CollectionCardSheet.jsx:113` — the list picker's `stepListEntry(list.id, cardId, +1)`, unserialized (second writer of `card_list_entries`).
- `compareEngine.js` — pure `compareRequirements`; the index card's completeness source, duplicated by `ListDetail.totals`.
- Precedent pure modules in `src/store`: `collectionGroups.js`, `compareEngine.js` (both node-tested, header-documented).

## Assumptions and confidence

1. **`qty` state (not a ref) is why rapid taps clobber.** Confidence: **high** — `step`/`addStep` read `qty.get(id)` from the render closure; two taps in one batch see the same value.
2. **Routing wishlist writes onto `ownedChains` makes them commute with sheet edits.** Confidence: **high** — same key (`cardId`), same re-read contract as `useOwnedLedger`.
3. **A module-level `listEntryChains` shared by `ListDetail` + `CollectionCardSheet` serializes the two list-entry writers.** Confidence: **high** — mirrors `ownedChains` exactly.
4. **Delta-based writes remove the need to read cur in the component.** Confidence: **high** — the write applies a delta; `stepListEntry`/`stepWanted` re-read the authoritative value inside the serialized turn.
5. **`listTotals` can reproduce `ListDetail.totals` exactly.** Confidence: **medium-high** — validated by porting the `:1241` math verbatim first (Stage A), then optionally reconciling with `compareEngine`.

## Affected systems and invariants

- **Profile isolation (§3.2):** unchanged — all writes still go through `ownedRepository`, which scopes by `activeProfileId()`. Serialization is per (card/list) key, not per profile; no key crosses profiles. **Verified by the profile-switch note below.**
- **Transactional user-data ops (§3.5):** each write remains a single repo call; delta+re-read *strengthens* consistency under concurrency. No multi-row transaction introduced.
- **Durable writes (§3.3):** unchanged store; the optimistic map is non-authoritative and now self-heals.
- **Content is data (§3.7):** the goal model is pure logic over data, no new UI conditionals.
- **Cross-runtime (§3.8):** pure model is runtime-identical; the serialization is JS-only. Device check is a regression smoke test, not the load-bearing proof (unlike autosave).
- **Profile-switch hazard (noted, not introduced):** `ownedChains` is module-level; the App classifier flagged a general stale-`activeId`-on-switch concern (roadmap #4). This proposal does **not** widen that surface — it moves goal writes onto the *same* module chains the owned ledger already uses, so it inherits, not worsens, that behavior. Called out for the reviewer; its fix is roadmap #4.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** | Rejected — the clobber and cross-surface race are real. |
| **Make `ListDetail` write deltas through `serialChain` (correct chains) + extract a pure `listGoalModel`** (proposed) | **Recommended.** Reuses the proven owned-ledger pattern and the existing delta repo primitives; smallest change that closes all three write bugs. |
| Keep absolute writes but add a `qtyRef` so rapid taps read fresh | Rejected — fixes clobber #1 but not the wrong-chain race (#2) or the two-writer list-entry race (#3); still absolute. |
| Merge everything into one `useGoalLedger` hook now | Rejected as scope — valuable later, but a bigger refactor than the bug warrants; do the safety fix first. |
| Wrap goal writes in a DB transaction | Rejected — heavier than needed; serialize+re-read is the established, sufficient pattern here. |

## Proposed design

Two reviewed stages, mirroring the established split (pure extraction, then the live-path change).

**Stage A — pure `src/store/listGoalModel.js` (behavior-preserving).** Alongside `collectionGroups.js`/`compareEngine.js`, node-tested:
```js
// All pure. qty is a Map<cardId, goalQty>. Steppers return the DELTA to persist
// plus the next optimistic map, so the caller never writes an absolute from stale state.
stepGoal(qty, cardId, delta)            // floor 1; at floor & delta<0 -> { confirmRemove: cardId } (no change)
  -> { qty, delta } | { confirmRemove }
addGoal(qty, cardId, delta)             // floor 0; delete at <=0 (in-list curate path)
  -> { qty, delta }
removeGoal(qty, cardId)                 // -> { qty, delta: -current }  (explicit clear)
bulkAddGoals(qty, adds)                 // -> { qty, writes: [{ cardId, delta }] }
listTotals(qty, ownedByCard)            // verbatim of ListDetail.totals (:1241) -> { req, have, names, done, complete, percent, missing }
```
Stage A ports the transition + totals logic out of the component and points the component at it; **writes are unchanged** (still `write(cardId, next)`), so no behavior changes. Characterization tests pin the current floor/confirm/delete/totals behavior.

**Stage B — serialized, delta-based writes on the correct chains (the fix).**
- Add `export const listEntryChains = { current: {} };` to `ownedUi.js` (a second app-wide chain, same shape as `ownedChains`).
- Replace `ListDetail.write(cardId, next)` with a delta writer:
  ```js
  const persist = (cardId, delta) => {
    if (!delta) return;
    if (isWishlist) serialChain(ownedChains, cardId, () => stepWanted(cardId, delta));
    else serialChain(listEntryChains, `${list.id}|${cardId}`, () => stepListEntry(list.id, cardId, delta));
  };
  ```
  Remove/clear goes through the same chain as an explicit set-to-0 (`setWanted`/`setListEntry(...,0)`), which is idempotent for a delete.
- `step`/`addStep`/`removeEntry`/`bulk` compute their `{ qty, delta }` from `listGoalModel`, apply the optimistic map, and call `persist(cardId, delta)`.
- Route `CollectionCardSheet.jsx:113`'s list add through `serialChain(listEntryChains, …, () => stepListEntry(…, +1))` so both list-entry writers share one chain.
- **Self-heal:** a `pending` counter + a `.finally` drain re-read (`isWishlist ? wishlistCards() : listCards(list.id)` → `setQty`), mirroring `useOwnedLedger`, so a failed or raced write reconciles from the DB.
- Point `ListDetail.totals` at `listGoalModel.listTotals` (single source with the model; a follow-up may reconcile the index card onto the same function).

## Implementation plan

1. **Stage A:** add `listGoalModel.js` + `listGoalModel.test.mjs` (characterization: floor-1-confirm, floor-0-delete, remove, bulk, totals). Point `ListDetail` at the model; writes unchanged. Checkpoint: `test:query` green (new suite runs under it — `src/store/**`), no behavior change.
2. **Stage B:** `listEntryChains`; delta writer; route `ListDetail` + `CollectionCardSheet` writes; self-heal drain. Checkpoint: `test:query`/`test:ui`/`build`/`check:docs` green.
3. Device regression (§Verification).

## Data migration and compatibility

**Not applicable** — no schema, format, or stored-shape change. Same tables, same repo functions (delta variants already exist). Not a migration.

## Rollback and recovery

Each stage is one commit; revert restores the prior writer. No persisted-format change. A goal count mis-set by a pre-fix clobber is corrected by the user's next edit (and now self-heals). No point of no return.

## Verification plan

- **Automated (the load-bearing proof for the clobber):** `listGoalModel.test.mjs` — rapid deltas accumulate; floor-1 confirm; floor-0 delete; bulk; `listTotals` equals the ported `:1241` math over a grid. `test:query`/`test:ui`/`test:codex`/`build`/`check:docs`.
- **Device (regression smoke, not the load-bearing proof):** installed release — add cards to the Wishlist and a custom list; step goals up/down (incl. to the floor → confirm-remove); rapid-tap a goal and confirm the number lands correctly; edit the same card's wishlist from the card sheet and the Wishlist list and confirm no clobber; verify owned counts still redraw live. Zero-image spot-check.
- **Profile isolation:** switch profiles with a list open elsewhere and confirm goal edits land under the right profile (repo is profile-scoped; this confirms the chain keys carry no cross-profile leakage).
- **Negative:** a step at the floor still opens the remove-confirm and does not write.

## Security, privacy, performance, and operations

No new data, no telemetry, no dependency. Serialization adds a promise hop per write — negligible. One new module-level chain object.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Delta writes double-apply if a write and its optimistic update disagree on delta | Low | Med | The model returns one `delta`; both the map and the write consume the same value; self-heal reconciles |
| `listTotals` port silently diverges from `:1241` | Low | Low | Characterization test pins it to the current output before the move |
| Widening `CollectionCardSheet` scope introduces a sheet regression | Low | Med | Change is one call-site → serialized; device checks the sheet's list-add path |
| Remove-to-0 via absolute set races a concurrent add | Low | Low | Same chain serializes them; delete is idempotent |

**Open:** should the index card's completeness also move onto `listTotals` now, or as a follow-up? Recommendation: follow-up (keeps this increment focused on the write safety + one totals home).

## Self-Critique

- **Strongest reason it's wrong / not worth it:** the bug is low-frequency and loses only a goal count on rapid taps — a skeptic can fairly say the safety win doesn't justify touching two live write surfaces. My answer: the *wrong-chain wishlist race* (#2) is the sharper issue (a shared row on two chains), the fix reuses a proven pattern rather than inventing one, and the pure model + single-sourced totals have standalone maintainability value. But if the reviewer judges the risk/reward marginal, deferring is defensible — the clobber is not data-loss.
- **Highest-consequence assumption:** that delta+serialize+re-read fully removes the clobber. If some path still writes an absolute (e.g. remove-to-0 racing an add), a count could still slip. Mitigated by routing *every* goal write through the chains and by the self-heal.
- **Simpler rejected option:** a `qtyRef` fix for clobber #1 alone. Rejected because it leaves #2/#3; but it's genuinely smaller if only the rapid-tap case matters.
- **Coupling missed?** `CollectionCardSheet`'s list-add is a second writer I almost overlooked — pulling it onto the shared chain is required for the fix to actually hold, and it widens the diff into the sheet. Flagged.
- **Failure likely to escape tests:** a true cross-surface race (sheet + list, same card, same instant) is hard to reproduce deterministically on device; the unit test proves the model, and serialization correctness is inherited from the already-proven `ownedChains` pattern — I'm relying on that inheritance, not a fresh concurrency test.
- **Evidence that would change direction:** if `stepWanted`/`stepListEntry` turn out not to re-read atomically enough under the chain, or if the totals port can't match `:1241`, shrink to the `qtyRef`-only fix.

## Approval requested

Route the goal/wishlist ledger onto delta-based, serialized, re-reading writes (Wishlist → `ownedChains`; list entries → a shared `listEntryChains` used by `ListDetail` and `CollectionCardSheet`), with a pure tested `listGoalModel.js` owning the transitions and totals and a self-heal drain. **High-risk** (live profile-owned write paths). Decisions: (1) approve the two-stage design and the `CollectionCardSheet` scope inclusion; (2) approve proceeding to implementation with unit tests as the clobber proof and a device regression pass as the completion gate. **No code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted | 2026-07-17 |
| Codex (reviewer) | *pending* | |
| Human (approver) | *pending* | |
