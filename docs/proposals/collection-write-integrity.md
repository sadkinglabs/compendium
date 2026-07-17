# Proposal: Collection write integrity — a profile-safe mutation queue for every ledger writer

## Status and classification

**Status: Draft — awaiting review** · Risk: **High** (fixes a profile-isolation invariant violation and a recorded-ownership corruption race across every Collection write path)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-17 · Supersedes [`collection-goal-ledger.md`](./collection-goal-ledger.md) (roadmap §16 #3, re-scoped after review). **No implementation has begun.**

## Problem and success criteria

Three defects, one root cause — Collection ledger writes are serialized inconsistently, on the wrong keys, and not bound to the profile that scheduled them.

**The persisted-row fact that drives everything:** `owned_cards` is keyed `(profile_id, card_id, variant_slug)` (`schema.js:292-302`), and **`qty_wanted` and unspecified `qty_owned` live on the *same* `variant_slug=''` row** — `writeQty` reads *both* columns and rewrites *both* (`ownedRepository.js:74-88`). So any two writers of that row must serialize together or one restores the other's stale column.

1. **Recorded-ownership corruption (author-confirmed; Codex Major 3).** The Wishlist writer in `ListDetail` calls `setWanted` on a **local** per-component chain (`Collection.jsx:1172, 1205-1207`), while `useOwnedLedger`/`Cards.stepSet` write the same `''` row's `qty_owned` on the app-wide `ownedChains` (`OwnedControl.jsx:71`, `Collection.jsx:526`). Two chains, one row → a Wishlist edit can read `qty_owned` before a concurrent owned edit commits and rewrite the **stale `qty_owned`**. This corrupts *recorded ownership*, not just a goal count.
2. **Profile-switch write race — a §3.2 invariant violation (Codex Major 2).** Every ledger write (`stepWanted`, `stepOwnedBucket`, `setOwnedInSet`, `stepListEntry`, …) resolves the **mutable** `activeProfileId()` on both its read and its write (`ownedRepository.js:75, 63`), and `switchProfile` flips `activeId` immediately (`profileRepository.js:82`). A write queued under profile A whose read/write awaits across a switch **executes against B** — a tap in A mutating B. This affects the owned ledger too, not only goals.
3. **Visible rapid-tap clobber (Codex Major 1).** `ListDetail.step/addStep` compute an **absolute** `next` from the `qty` React *state* Map (`Collection.jsx:1223, 1215`); two taps before a re-render both read `5`, both show/persist `6`. The optimistic value visibly loses a tap until the next reload.

**Honest stakes (revised up from the superseded proposal):** #2 is a hard profile-isolation invariant (§3.2) violated under a real, if low-probability, interleaving; #1 can miscount *recorded* `owned_cards` data. This is a genuine data-integrity fix, not a cosmetic goal-count tidy. It is still bounded to Collection — no app-wide repository rewrite.

**Success criteria**

1. A **store-layer** mutation queue serializes every Collection write **by persisted row**: `qty_wanted` and unspecified `qty_owned` (both the `''` row) share one key; per-set owned/foil key by variant; list entries key by `(list, card)`. Every surface writing a row shares that row's chain.
2. Queued work is **profile-safe**: `switchProfile` **drains the Collection queue before** changing `activeId` (a write barrier that *preserves* the user's edits rather than dropping them), and the queue lives in `src/store` so `switchProfile` never imports a UI module.
3. All five writers migrate onto it: `Cards.stepSet`, `useOwnedLedger`, Wishlist `ListDetail`, regular-list `ListDetail`, `CollectionCardSheet` list picker.
4. Goal editing gains a synchronous `qtyRef` (rapid taps accumulate with no closure lag), **delta** persistence for steps, **explicit serialized `clear`** for removal (not `delta:-current`), and drain reconciliation of ref+state from the repo.
5. Correctness is proven by **coordinator-level tests with deferred promises** that force the exact races — not pure-transition tests.
6. **No behavior change** to any read UX, the confirm-on-remove flow, wishlist-vs-list routing, owned/foil editing, or single-tap interaction.

**Non-goals**

- Any app-wide/general mutation framework beyond Collection.
- Any schema/format change (`owned_cards`, `card_list_entries` untouched).
- `listTotals` extraction — **dropped** (unrelated to write safety; moving the inline math doesn't single-source completeness while the index still uses `compareEngine`). A tiny goal step/clear helper may be retained only if it aids testability; **no totals**.
- The `App` navigation half of roadmap #4 (this addresses only the *write-race* half, for Collection).

## Evidence and current architecture

- `schema.js:292-302` — `owned_cards(profile_id, card_id, variant_slug, qty_owned, qty_wanted, …)`, unique on the triple. `qty_wanted` **is** the Wishlist (no separate table); the `''` row carries both unspecified owned and wanted.
- `ownedRepository.js:74-91` — `writeQty` upserts the `''` row reading+writing both columns; `setWanted`/`setOwned` wrap it. `:93+` `stepOwnedBucket` (delta on `''`), `qtyForInSet`/`setOwnedInSet` (per-set rows), `stepWanted`/`stepListEntry` (delta, re-read) all resolve `activeProfileId()` internally.
- `ownedUi.js:14-31` — `serialChain(ref, key, fn)` + `ownedChains` (module-level, **in the components layer** — must move to store). Re-read-inside-turn is the safe contract to generalize.
- `OwnedControl.jsx:58-87` — `useOwnedLedger`: the reference safe regime (optimistic ref + pending + serialChain re-read + drain self-heal). Wanted rides key `cardId`; per-set rides `cardId|set`.
- `Collection.jsx:518-530` (`Cards.stepSet`), `:1156-1239` (`ListDetail`), `:1374-1383` (bulk) — the writers; `ListDetail` uses a local chain + absolute writes + `qty` state (not a ref) + swallowed errors.
- `CollectionCardSheet.jsx:113` — second unserialized `card_list_entries` writer.
- `profileRepository.js:82` — `switchProfile` sets `activeId` with no barrier.

## Assumptions and confidence

1. **Keying by persisted row (wanted+unspecified-owned sharing the `''` key) serializes the corruption race.** Confidence: **high** — it is literally the same row.
2. **A drain-before-switch barrier makes queued work profile-safe.** Confidence: **high** for the reachable path (Collection edits and the profile sheet are mutually-exclusive modals, so no new Collection write is scheduled *during* a switch); the queue also captures the scheduling profile in the key as defense-in-depth. A deferred-promise test proves a switch cannot flip `activeId` while a write is pending.
3. **`stepWanted`/`stepListEntry`/`stepOwnedBucket` re-read inside the serialized turn, so deltas commute.** Confidence: **high** — verified in the repo.
4. **A synchronous `qtyRef` removes the visible clobber.** Confidence: **high** — mirrors `useOwnedLedger`.
5. **Migrating five writers changes no observable single-tap behavior.** Confidence: **medium-high** — validated by device regression; the risk is a missed writer or a key mismatch.

## Affected systems and invariants

- **Profile isolation (§3.2):** the invariant this fixes. After the barrier, no queued write executes under a different profile than the one that scheduled it. Verified by a switch-during-pending-write test.
- **Transactional user-data ops (§3.5):** the corruption race is closed by keying wanted+owned on one chain with re-read; no multi-row transaction added.
- **Durable/offline (§3.3):** unchanged store; optimistic state self-heals on drain.
- **Cross-runtime (§3.8):** the queue is pure JS, runtime-identical; device pass is regression, and specifically exercises a real profile switch mid-edit.
- **Dependency direction:** the queue lives in `src/store`; `profileRepository.switchProfile` imports it (store→store). The UI writers import it (ui→store). This *removes* the current wrong-direction fact that the shared write chain lives in `src/components/ownedUi.js`.

## Options considered

| Option | Verdict |
|---|---|
| **Status quo** | Rejected — invariant violation + recorded-data corruption. |
| **`qtyRef` patch only** | Rejected — fixes the visible symptom, leaves the ownership-corruption race and profile race. (Owner: do not ship.) |
| **Goal-only profile coordinator** | Rejected — knowingly leaves the owned ledger exposed to the same race. |
| **Store-layer profile-safe queue for every Collection writer + drain-before-switch barrier** (proposed) | **Recommended.** Fixes #1/#2/#3 once for the whole Collection ledger, leaves a reusable tested boundary, avoids an app-wide framework. |
| **App-wide repository rewrite / explicit `profileId` on every repo call** | Rejected — disproportionate; the barrier achieves profile-safety without threading ids through the repo. (Kept as the fallback if the barrier proves insufficient.) |
| **Abort queued edits on switch** | Rejected per owner — the barrier *preserves* edits; aborting drops the user's taps. |

## Proposed design

A store-layer coordinator plus a `switchProfile` barrier, then writer migration, then the goal-editing polish.

**`src/store/collectionWrites.js` (new, store layer):**
```js
// Profile-safe serialized write queue for the Collection ledger (owned_cards +
// card_list_entries). One chain PER PERSISTED ROW. switchProfile drains this queue
// BEFORE flipping the active profile, so a queued write can never execute under -
// or be redirected into - another profile. Lives in the store layer so switchProfile
// does not depend on a UI module.
const chains = {};                 // rowKey -> tail Promise
let pending = 0;
let idle = [];                     // settle() resolvers

// One key per persisted row. wanted + unspecified owned share the '' row -> same key.
export const ownedRowKey = (profileId, cardId, variant = '') => `o:${profileId}:${cardId}:${variant}`;
export const listRowKey  = (profileId, listId, cardId)       => `l:${profileId}:${listId}:${cardId}`;

export function enqueueWrite(rowKey, fn) {
  const captured = /* activeProfileId() */ ;             // bind to the scheduling profile
  pending++;
  const run = (chains[rowKey] || Promise.resolve())
    .then(() => fn(captured))                            // fn may assert activeProfileId()===captured (tripwire)
    .catch(() => {});
  chains[rowKey] = run.finally(() => { if (--pending === 0) { const r = idle; idle = []; r.forEach((res) => res()); } });
  return chains[rowKey];
}

// Resolves when the queue is idle. switchProfile awaits this before changing activeId.
export function settleCollectionWrites() {
  return pending === 0 ? Promise.resolve() : new Promise((res) => idle.push(res));
}
```

**`profileRepository.switchProfile` (the barrier):**
```js
export async function switchProfile(id) {
  await settleCollectionWrites();   // let pending Collection writes finish UNDER the current profile
  activeId = id;                     // only then flip (no awaited work between settle and flip)
  …                                  // (unchanged remainder)
}
```
The scheduling profile is also captured in the row key and passed to `fn`; a migrated write may `if (activeProfileId() !== captured) throw` as a **tripwire** — with the barrier it never fires, but it fails safe (aborts rather than mutating the wrong profile) if the barrier is ever bypassed. The reachable guarantee, though, is the barrier: Collection edits and the profile picker are mutually-exclusive modals, so no Collection write is scheduled during a switch.

**Writer migration (Stage B):** replace `serialChain(ownedChains, key, fn)` and the `ListDetail` local chain with `enqueueWrite(rowKey, fn)`:
- `useOwnedLedger` / `Cards.stepSet`: `ownedRowKey(pid, cardId, variant)` where variant is `''` (unspecified owned **and** wanted), the set slug (per-set), or `'foil'`. **wanted and unspecified-owned now share the `''` key** — closing race #1.
- Wishlist `ListDetail`: `enqueueWrite(ownedRowKey(pid, cardId, ''), () => stepWanted(cardId, delta))`.
- Regular-list `ListDetail` + `CollectionCardSheet` picker: `enqueueWrite(listRowKey(pid, listId, cardId), () => stepListEntry(listId, cardId, delta))` — one shared chain for both list-entry writers.
- `ownedChains` retired from `ownedUi.js` (or re-exported from the store shim during migration).

**Goal editing (Stage C):** in `ListDetail`, add `qtyRef` (updated synchronously before `setQty`); `step`/`addStep` compute a **delta** and `enqueueWrite` it; **remove** is an explicit `clear` op that enqueues a serialized absolute set-to-0 on the same row chain (not `delta:-current`); a `pending` counter + drain re-read reconciles `qtyRef`+state from `wishlistCards()`/`listCards()` on settle. Persistence intent is explicit: `{ op:'step', delta }` | `{ op:'clear' }`.

## Implementation plan

- **Stage A — the queue + barrier, tested.** `collectionWrites.js`; `switchProfile` drains it. Coordinator-level tests (deferred promises / fake repo) prove: (a) two rapid steps commit twice, in order; (b) a profile switch cannot flip `activeId` while a write is pending (barrier), and the write runs under the original profile; (c) settle resolves only when idle; (d) failure in one write doesn't wedge the chain. **Checkpoint:** `test:query` green, no writer migrated yet.
- **Stage B — migrate all five writers** onto row keys; retire `ownedChains`. Tests: wanted+unspecified-owned share a chain; both list-entry surfaces share a chain. **Checkpoint:** `test:query`/`test:ui`/`build`/`check:docs` green.
- **Stage C — `ListDetail` `qtyRef` + explicit step/clear + drain self-heal.** Tests: rapid taps accumulate; clear wins per queue order under optimistic-vs-authoritative drift; drain reconciles after a failed write. **Checkpoint:** full gate green.
- **Device + docs** (below).

## Data migration and compatibility

**Not applicable to schema** — no table/format change; `SCHEMA_VERSION` unchanged. Only *when/how* existing writes are serialized changes. Old data reads/writes identically.

## Rollback and recovery

Each stage is an independent revert. Retiring `ownedChains` is the only cross-file move; a shim re-export keeps Stage B bisectable. No point of no return; no persisted-format change.

## Verification plan

- **Automated (load-bearing):** `collectionWrites.test.mjs` (Stage A/B properties above) + the Stage C goal tests, all deterministic via injected deferred promises and a fake repo recording the `activeProfileId()` seen at execution. `test:query`/`test:ui`/`test:codex`/`build`/`check:docs`.
- **The six race properties Codex named**, each a deterministic test: two rapid steps commit twice in order; Wishlist and sheet ops share one queue for the `''` row; both list-entry surfaces share one queue; a failed write drains and reconciles; `clear` wins by queue order under drift; **a profile switch cannot redirect queued work** (barrier holds `activeId` until drain).
- **Device (regression + the real switch case):** installed release — step owned + wishlist + list goals (incl. floor→confirm-remove and rapid taps); edit the same card's wanted from the card sheet and the Wishlist and confirm owned is never disturbed; **switch profiles while a write is pending and confirm the edit lands in the origin profile, not the target**; owned counts redraw live; zero-image spot-check.
- **Negative:** floor step opens remove-confirm and does not write; a cleared entry stays cleared after drain.

## Security, privacy, performance, and operations

No new data, telemetry, or dependency. The barrier adds a short awaited drain to a profile switch (writes are sub-ms to a few ms); imperceptible and it *preserves* edits. One store module + a `switchProfile` prepend.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A write is scheduled *during* a switch (barrier already resolved) and runs under the new profile | Low | High (the invariant) | Collection/profile UIs are mutually-exclusive modals (no such schedule reachable); profile captured in key + tripwire guard; if a non-modal path ever appears, fall back to explicit-`profileId` repo calls |
| A writer missed in migration keeps a private chain → race persists | Low | Med | Grep every `serialChain`/`setWanted`/`setListEntry`/`stepListEntry` call site; the five are enumerated; test that wanted+owned share a chain |
| `clear` vs concurrent `step` ordering surprises under drift | Low | Low | Both on one row chain; explicit `clear` = serialized absolute-0; drift test |
| Barrier deadlock if a queued write never settles | Low | Med | Each `fn` is `.catch`-guarded so a rejection still decrements `pending`; settle can't hang on a rejected write |

**Open:** keep a tiny pure goal step/clear helper for Stage C testability, or inline and cover via coordinator tests? Recommendation: inline unless the helper earns its keep; **no `listTotals`** either way.

## Documentation impact

| Document | Disposition |
|---|---|
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) | **Update.** State that all `owned_cards`/`card_list_entries` writes serialize through a store-layer per-row queue, that the `''` row's `qty_owned`+`qty_wanted` share a chain, and that `switchProfile` drains the queue before changing the active profile (the profile-safety barrier). No schema change. |
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Update — short note.** Record the Collection write-integrity boundary: a store-layer mutation queue is the single ordering point for ledger writes, and the profile switch is barriered on it. Also note the dependency-direction fix (shared write chain moves components→store). |
| [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Reviewed — likely no change.** No user-facing capability changes; the Collection §3.2 invariant "quantities cannot become negative, and invalid imports cannot partially mutate the ledger" is *strengthened* (concurrent edits can't corrupt a row). Add a clause only if that invariant list should mention concurrency. |
| [`BUILD.md`](../../BUILD.md) | **Reviewed — no change.** Its installed-app verification is used. |
| [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) / [`AGENTS.md`](../../AGENTS.md) | **Reviewed — no change.** |

## Self-Critique

- **Strongest reason it's wrong / risky:** it touches *every* Collection write path plus `switchProfile` — a broad blast radius for a race whose reachability (a profile switch landing inside a sub-millisecond write await) is low. If the migration misses a writer or mis-keys a row, I could *introduce* a race while claiming to close one. Mitigation: the five writers are enumerated and the "wanted+owned share a chain" property is a test, not a hope.
- **Highest-consequence assumption:** that the drain-before-switch barrier is sufficient because Collection edits and the profile picker never coexist. If some non-modal path can schedule a Collection write during a switch, the barrier has a gap and the fallback (explicit `profileId` repo calls) is needed. I assert the modal exclusivity from the current UI but cannot prove it for all future screens — hence the tripwire guard.
- **Simpler rejected option:** the `qtyRef`-only patch. Genuinely smaller, and if the owner had judged the corruption/profile race acceptable it would have been right; the owner explicitly did not.
- **Coupling I could still miss:** a writer outside the five (e.g. an import path, `backfillSingleSetOwned`, or a profile-transfer restore) that mutates `owned_cards` outside the queue. Those are batch/transactional and not concurrent with taps, but I must audit them before claiming "every writer."
- **Failure most likely to escape tests:** the true wall-clock interleaving on device (switch mid-write) — the deterministic tests force the ordering with deferred promises, but a real device timing is the only cross-runtime confirmation, and I can exercise it only on the test Pixel.
- **Evidence that would change direction:** if the audit finds a non-modal Collection writer that can race a switch, escalate to explicit-`profileId` repo binding; if the barrier measurably janks a profile switch, reconsider.

## Approval requested

Build a store-layer, profile-safe Collection mutation queue keyed per persisted row, barrier `switchProfile` on its drain, migrate all five ledger writers onto it, and give `ListDetail` a synchronous `qtyRef` with explicit step/clear and drain self-heal — closing a §3.2 profile-isolation violation and a recorded-ownership corruption race. **High-risk.** Decisions: (1) approve the store-layer queue + drain-before-switch barrier (vs explicit-`profileId` binding); (2) approve the three-stage plan and the writer list (incl. `CollectionCardSheet`); (3) confirm `listTotals` is dropped. Coordinator-level deferred-promise tests are the correctness proof; a device switch-mid-edit pass is the completion gate. **No code written yet.**

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted (supersedes `collection-goal-ledger.md`) | 2026-07-17 |
| Codex (reviewer) | *pending* | |
| Human (approver) | *pending* | |
