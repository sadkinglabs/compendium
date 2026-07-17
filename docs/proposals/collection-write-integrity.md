# Proposal: Collection write integrity — profile-bound writes + a per-row mutation queue

## Status and classification

**Status: Rev 3 — narrow-review fixes applied; awaiting Stage-A approval** · Risk: **High** (fixes a profile-isolation invariant violation and a recorded-ownership corruption race across the interactive Collection ledger)
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner
Date: 2026-07-17 · Supersedes [`collection-goal-ledger.md`](./collection-goal-ledger.md). **No implementation has begun.**

> **Rev 2 changes (all Codex findings accepted):** the correctness mechanism is now **explicit
> profile-bound repository writes**, with the drain-before-switch barrier retained as a UX safeguard
> and the tripwire as diagnostics — not the integrity boundary (Major 1). A **complete mutation
> inventory** classifies every `owned_cards`/`card_list_entries` writer (Major 2); the contract is
> renamed to **every *interactive* ledger writer**. Row keys are built through the repository's
> canonical `vslug()` so key equality matches DB-row equality, incl. set-foil `:f` rows (Major 3).
> The queue's **error contract** is specified (Minor). `switchProfile` keeps its existence check
> *before* the drain, with no await between drain and flip.
>
> **Rev 3 (narrow-review fixes):** `setFoil` (the name-level `'foil'` row, written by
> `useOwnedLedger`) is added to the inventory, the profile-bound signatures, the migration, and the
> profile-switch test matrix — it had the same redirect defect (Major). The queue pseudocode is
> corrected so pending-state finalizes on an **already-handled** internal promise (no unhandled
> rejection from `.finally`), and `settleCollectionWrites` **removes timed-out waiters** from the
> idle set (Minor). An unhandled-rejection monitor is added to the test matrix.

## Problem and success criteria

**The persisted-row fact:** `owned_cards` is keyed `(profile_id, card_id, variant_slug)` (`schema.js:292-302`), and **`qty_wanted` and unspecified `qty_owned` live on the same `variant_slug=''` row** — `writeQty` reads and rewrites *both* columns (`ownedRepository.js:74-88`). Variant slugs are `vslug(set, foil)` = `''` | `'foil'` | `<set>` | `<set>:f` (`:140`). Two writers of one row must serialize together, and a queue key must equal the row identity.

Three defects:
1. **Recorded-ownership corruption (Major 3, prior review).** The Wishlist writer uses a local chain (`Collection.jsx:1205-1207`) while owned writers use `ownedChains`; same `''` row, two chains → a wishlist write rewrites a stale `qty_owned`, corrupting recorded ownership.
2. **Profile-switch write race — §3.2 violation (Major 2, prior).** Interactive steppers resolve the mutable `activeProfileId()` on both their read and write across awaits (e.g. `stepWanted` → `qtyFor` then `writeQty`, each re-resolving `pid`); `switchProfile` flips `activeId` immediately (`profileRepository.js:82`). A write scheduled under A can execute under B.
3. **Visible rapid-tap clobber (Major 1, prior).** `ListDetail` writes an absolute `next` from the `qty` React *state* (not a ref); two taps before re-render lose one visually.

**Success criteria**

1. **Profile safety is intrinsic, not timing-dependent.** Every *interactive* queued write is bound to the profile captured when it was scheduled: the repository read+write use that explicit `profileId`, never the mutable global. A profile switch cannot redirect a queued write **regardless of UI modal timing**.
2. **Row-level races closed.** A store-layer queue serializes interactive writes **per persisted row**, key ≡ `(profile_id, card_id, vslug(set,foil))` or `(list_id, card_id)`; `qty_wanted` and unspecified `qty_owned` share the `''` key.
3. **Barrier as UX safeguard.** `switchProfile` drains the queue before flipping `activeId`, so pending *visible* edits settle (preserved, not dropped) — but it is no longer the sole integrity boundary.
4. **Complete, deliberate inventory.** Every `owned_cards`/`card_list_entries` writer is classified as *queued*, *provably-safe-outside* (atomic + single-pid-bound + lifecycle-exclusive), and any exclusion is tested/justified.
5. **Goal editing:** synchronous `qtyRef` (no closure lag), delta steps, explicit serialized `clear` (not `delta:-current`), drain reconciliation.
6. **No behavior change** to any read UX, confirm-on-remove, wishlist/list routing, owned/foil editing, or single-tap interaction.

**Non-goals:** app-wide repository rewrite; schema/format change; `listTotals` extraction (**dropped**); the `App` navigation half of roadmap #4.

## Mutation inventory (Major 2)

Every writer of `owned_cards` / `card_list_entries`, classified:

| Writer | Path | Row(s) | Class |
|---|---|---|---|
| `writeQty` → `setOwned`/`setWanted` | `ownedRepository.js:74-91` | `''` (RMW both cols) | **Queue** — interactive stepper; profile-bound variant |
| `stepOwnedBucket` | `:93+` | `''` owned (delta) | **Queue** — interactive |
| `writeSetRow` → `setOwnedInSet`/`setFoilInSet` | `:181-193` | `<set>` / `<set>:f` (RMW) | **Queue** — interactive (Cards tab) |
| `setFoil` (name-level foil) | `:107-119` | `'foil'` (RMW) | **Queue** — interactive (`useOwnedLedger` name-level foil, `OwnedControl.jsx:81`) |
| `stepWanted`, `stepListEntry`, `setListEntry` | `:103,419-429` | `''` / list entry | **Queue** — interactive (delta, re-read) |
| `addOwnedCopies`/`addWantedCopies` | `:198-213` | `''` (atomic `+N` upsert) | **Outside — provably safe:** single synchronous `pid` capture; atomic `ON CONFLICT DO UPDATE col=col+excluded` (commutes); scanner-only, lifecycle-exclusive from list/sheet steppers |
| `addOwnedCopiesInSet` | `:218-230` | `<set>` (atomic `+N`) | **Outside — provably safe** (as above, per-set) |
| `backfillSingleSetOwned` | `:236-274` | `''`→`<set>` (single `tx`, `MAX(0,…)`) | **Outside — provably safe:** boot-only (runs before UI interactive), single `pid`, all-or-nothing `tx` |
| `importCollectionResolved` | `:302-322` | `''`/`<set>` (single `tx`, atomic `+N`) | **Outside — provably safe:** modal import flow, single `pid`, `tx` |
| `addMissingToWishlist` | `:326-343` | `''` wanted (single `tx`, `MAX`) | **Outside — provably safe:** deck action, single `pid`, `tx`, idempotent `MAX` |

**Why the "outside" set is safe on both axes:** each captures `const pid = activeProfileId()` **synchronously once** and uses it through a single atomic statement or one `tx`, so a mid-flight switch cannot redirect it (already profile-bound), and each is atomic/transactional (no partial read-modify-write to clobber). Their only theoretical hazard is racing a *queued* RMW write on the same row — but they are **lifecycle-exclusive** from the interactive steppers (scanner / import / deck / boot are separate full-screen or pre-interactive flows; the UI is single-threaded and these never coexist with list/sheet stepping). **This exclusion is deliberate; a test asserts the atomic upserts commute, and the exclusivity is documented as the contract.** Contract renamed accordingly: this proposal governs **every interactive ledger writer**, not literally every write.

**[verify at implementation]** grep confirms these nine are the complete set of `owned_cards`/`card_list_entries` mutators (`run(`/`tx(` touching those tables); profile-transfer restore writes via its own bulk `tx` path and is out of scope (a full-profile replace, not a concurrent edit).

## Proposed design

Three mechanisms, layered: explicit profile binding (integrity) · per-row queue (ordering) · drain barrier (UX). Tripwire = diagnostics.

**1. Explicit profile-bound repository writes (the integrity boundary).** The interactive read+write functions the queue uses take an optional `profileId` defaulting to `activeProfileId()`, threaded through their internal reads and writes:
```js
qtyFor(cardId, pid = activeProfileId())
qtyForInSet(cardId, set, pid = activeProfileId())
writeQty(cardId, { owned, wanted }, pid = activeProfileId())
writeSetRow(cardId, set, foil, qty, pid = activeProfileId())
setFoil(cardId, qty, pid = activeProfileId())               // the name-level 'foil' row
stepOwnedBucket(cardId, delta, pid = activeProfileId())
stepWanted(cardId, delta, pid = activeProfileId())          // passes pid to qtyFor + writeQty
setListEntry(listId, cardId, qty, pid = activeProfileId())
stepListEntry(listId, cardId, delta, pid = activeProfileId())// passes pid to its read + setListEntry
```
Default-param keeps every existing caller unchanged; the queue passes the captured `pid`. A queued `stepWanted(cardId, delta, pidA)` now reads *and* writes under `pidA` even if `activeId` becomes B mid-flight. **This removes the highest-consequence assumption** — profile safety no longer depends on modal exclusivity.

**2. Store-layer per-row queue — `src/store/collectionWrites.js` (a *leaf*: imports nothing from the repo/profile layer, because `profileRepository` imports *it* — Codex Stage-A note).** The queue is keyed by an opaque string built by the caller, which also supplies the captured profile; the canonical key helpers live beside `vslug` in `ownedRepository.js`:
```js
// ownedRepository.js (owns vslug): key equality ≡ persisted-row equality
export const ownedRowKey = (pid, cardId, set = '', foil = false) => `o:${pid}:${cardId}:${vslug(set, foil)}`;
export const listRowKey  = (pid, listId, cardId) => `l:${pid}:${listId}:${cardId}`;

// collectionWrites.js (pure leaf — NO activeProfileId / vslug import; avoids the
// profileRepository -> collectionWrites -> ownedRepository -> profileRepository cycle):
const chains = {}; let pending = 0; let idle = [];
function finalize() { if (--pending === 0) { const r = idle; idle = []; r.forEach((f) => f()); } }
export function enqueueWrite(rowKey, fn) {           // fn: () => Promise (already profile-bound by its caller)
  pending++;
  const result = (chains[rowKey] || Promise.resolve()).then(() => fn());   // caller-facing: reflects success/failure
  // Recover the row tail so a rejection can't wedge the next write AND so `result` is handled even
  // if the caller ignores it (no unhandled rejection). finalize() runs on the recovered tail, so the
  // `.finally` promise itself never rejects either.
  chains[rowKey] = result.catch(() => {}).finally(finalize);
  return result;                                    // caller MAY .catch to reconcile; already handled by the tail otherwise
}
export function settleCollectionWrites(timeoutMs = 4000) {   // bounded so a hung write can't freeze a profile switch
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; const i = idle.indexOf(finish); if (i >= 0) idle.splice(i, 1); resolve(); };
    idle.push(finish);                              // drain calls this when pending hits 0…
    setTimeout(finish, timeoutMs);                  // …or the timeout fires first and removes it from idle
  });
}
```
`vslug` is exported from `ownedRepository.js` and imported here (one canonical slug function → key equality ≡ row equality; Major 3).

**3. `switchProfile` barrier (UX; existence check preserved, no await between drain and flip):**
```js
export async function switchProfile(id) {
  const exists = await query('SELECT id FROM profiles WHERE id=?;', [id]);   // unchanged, BEFORE the drain
  if (!exists.length) throw new Error(`No such profile ${id}`);
  await settleCollectionWrites();     // let pending VISIBLE edits settle under the current profile
  activeId = id;                      // flip immediately — no awaited work in between
  …
}
```
Because writes are now explicitly profile-bound (mechanism 1), even a write that somehow slips past the drain writes to *its* captured profile, not B. The barrier just preserves the user's in-flight edits; the tripwire (`if (activeProfileId() !== captured) log/throw`) is retained as a diagnostic that should never fire.

**Error contract (Minor):** `enqueueWrite` returns a promise that **rejects to its caller** on `fn` failure (so a writer can react), while the **internal chain tail is `.catch`-recovered** so a rejection never wedges the row's chain — and, because that recovered tail is what `result` is chained through, `result` is handled even if the caller ignores it (no unhandled rejection). `finalize()` runs on the recovered tail, so the pending counter is settled on an already-handled promise. Primary UI reconciliation is the **drain re-read** (self-heal): on settle, each migrated surface re-reads its rows from the repo and reconciles `qtyRef`+state, correcting any failed/raced write. **Residual, stated:** a storage op that *never settles* keeps `pending>0`; the bounded `settleCollectionWrites(timeout)` prevents it from freezing a profile switch, but a permanently hung write remains an unhandled durability risk (as it is today).

**Writer migration (the five interactive):** replace `serialChain(ownedChains, …)` and the `ListDetail` local chain with:
```js
const pid = activeProfileId();
enqueueWrite(ownedRowKey(pid, cardId, set, foil), () => stepWanted(cardId, delta, pid));   // etc.
```
- `useOwnedLedger` / `Cards.stepSet` → `ownedRowKey(pid, cardId, set, foil)` (wanted & unspecified-owned collapse to the `''` key; name-level foil → `ownedRowKey(pid, cardId, '', true)` = `'foil'` + `setFoil(cardId, qty, pid)`).
- Wishlist `ListDetail` → `ownedRowKey(pid, cardId, '', false)` + `stepWanted(cardId, delta, pid)`.
- Regular-list `ListDetail` + `CollectionCardSheet` picker → `listRowKey(pid, listId, cardId)` + `stepListEntry(listId, cardId, delta, pid)`.
- Retire `ownedChains` from `ownedUi.js` (store queue replaces it).

**Goal editing (`ListDetail`, Stage C):** synchronous `qtyRef` updated before `setQty`; `step`/`addStep` emit `{op:'step', delta}` and enqueue the delta; **remove** emits `{op:'clear'}` → a serialized absolute set-to-0 on the same row chain; `pending` + drain re-read reconciles ref+state from `wishlistCards()`/`listCards()`.

## Implementation plan

- **Stage A — profile-bound repo params + the queue + the barrier, tested.** Add the `profileId` params; `collectionWrites.js`; `switchProfile` drain. Deterministic tests (deferred promises + fake repo recording the `pid` seen): profile-bound write ignores a mid-flight `activeId` change; barrier holds `activeId` until drain; settle bounded; failure rejects to caller yet recovers the tail. **Checkpoint:** `test:query` green, no UI migrated.
- **Stage B — migrate the five interactive writers**; retire `ownedChains`; table-driven **key-equality test** (`ownedRowKey`/`listRowKey` collide iff the DB rows collide, incl. `:f`). **Checkpoint:** full gate.
- **Stage C — `ListDetail` `qtyRef` + step/clear + drain self-heal.** **Checkpoint:** full gate.
- **Device + docs.**

## Data migration and compatibility

**Not applicable to schema** — no table/format change; `SCHEMA_VERSION` unchanged. Only serialization/binding of existing writes changes. Optional `profileId` params default to today's behavior for non-queued callers.

## Rollback and recovery

Each stage reverts independently; the profile-bound params are backward-compatible additions; retiring `ownedChains` is a single move with a shim for bisectability. No persisted-format change.

## Verification plan

- **Automated (load-bearing) — deferred-promise coordinator tests** proving the six properties: (1) two rapid steps commit twice, in order; (2) wishlist + sheet ops on the `''` row share one queue; (3) both list-entry surfaces share one queue; (4) a failed write rejects to caller, recovers the tail, and drain reconciles — **with an unhandled-rejection monitor asserting no unhandled promise escapes** (Rev 3 Minor), including when the caller ignores the returned promise; (5) `clear` wins by queue order under optimistic-vs-authoritative drift; (6) **a profile switch cannot redirect queued work** — a write scheduled under A executes under A even though `activeId` became B (proves mechanism 1, independent of the barrier), covering **each interactive write incl. the name-level `'foil'` row via `setFoil`** (Rev 3 Major); a timed-out `settleCollectionWrites` leaves no retained waiter in `idle`. Plus the **key-equality table test** (Major 3) and a test that the atomic "outside" upserts commute. `test:query`/`test:ui`/`test:codex`/`build`/`check:docs`.
- **Device (regression + the real switch case):** step owned/wishlist/list goals (incl. floor→confirm-remove, rapid taps); edit one card's wanted from the sheet and the Wishlist and confirm owned is never disturbed; **switch profiles while a write is pending and confirm the edit lands in the origin profile**; owned counts redraw live; zero-image spot-check.
- **Negative:** floor step opens remove-confirm without writing; cleared entry stays cleared after drain.

## Security, privacy, performance, and operations

No new data/telemetry/dependency. The barrier adds a bounded drain to a profile switch (sub-ms writes; imperceptible) and preserves edits. One store module + optional repo params.

## Documentation impact

| Document | Disposition |
|---|---|
| [`COMPENDIUM_DATA_MODEL.md`](../../COMPENDIUM_DATA_MODEL.md) | **Update.** Interactive `owned_cards`/`card_list_entries` writes are profile-bound and serialized through a store-layer per-row queue (the `''` row's owned+wanted share a chain); batch/atomic writers (scanner/import/backfill/deck) are single-`pid`-bound and transactional and stay outside the queue by design; `switchProfile` drains the queue before flipping the active profile. No schema change. |
| [`COMPENDIUM_ARCHITECTURE.md`](../../COMPENDIUM_ARCHITECTURE.md) | **Update — short note.** The Collection write-integrity boundary: profile-bound repo writes + a store-layer per-row mutation queue as the single ordering point for interactive ledger writes, barriered at profile switch. Notes the shared write chain moving components→store (dependency-direction fix). |
| [`COMPENDIUM_FEATURE_MATRIX.md`](../../COMPENDIUM_FEATURE_MATRIX.md) | **Reviewed — likely no change.** Collection §3.2 invariant ("quantities cannot become negative, and invalid imports cannot partially mutate the ledger") is *strengthened*; add a concurrency clause only if desired. |
| [`BUILD.md`](../../BUILD.md) / [`ENGINEERING_CONSTITUTION.md`](../../ENGINEERING_CONSTITUTION.md) / [`AGENTS.md`](../../AGENTS.md) | **Reviewed — no change.** |

## Self-Critique

- **Strongest reason it's risky:** it adds a `profileId` param through several repo functions *and* migrates five writers *and* barriers `switchProfile` — broad surface for a race of low wall-clock probability. A mis-threaded `pid` (a read that still resolves the global) would leave the invariant violated while the tests pass on the queue path. Mitigation: the deferred-promise test asserts the *repo* write records the captured `pid`, not just the queue key — it fails if any internal read/write re-resolves the global.
- **Highest-consequence assumption (now much smaller):** that the nine writers are the complete inventory and the five "outside" are truly lifecycle-exclusive from interactive stepping. If a future screen lets a scanner add and a list step coexist, a queued RMW could clobber an atomic add. Mitigation: the atomic upserts commute (tested); if such a screen appears, route those onto the queue too. The inventory `[verify]` grep is a required implementation step.
- **Simpler rejected option:** barrier-only (Rev 1). Rejected by review — it left integrity dependent on UI timing.
- **Coupling I could still miss:** profile-transfer *restore* writes `owned_cards` in bulk; I classified it out of scope (full-profile replace, not concurrent editing), but I must confirm it can't run concurrently with interactive stepping (it shouldn't — it's a settings/restore flow).
- **Failure likely to escape tests:** true device wall-clock interleaving of a switch and a write; the deterministic tests force ordering, the device pass is the only cross-runtime confirmation and only on the test Pixel.
- **Evidence that would change direction:** the inventory grep finding a tenth interactive writer, or profile-transfer proving concurrently reachable → widen scope; a measurable jank on the barriered switch → tune the drain timeout.

## Approval requested

Make interactive Collection writes **profile-bound at the repository** (explicit `profileId` threaded through their reads+writes), serialize them through a **store-layer per-row queue** (`vslug`-exact keys; owned+wanted share the `''` row), keep a **bounded drain-before-switch barrier** to preserve in-flight edits, and give `ListDetail` a synchronous `qtyRef` with explicit step/clear + drain self-heal — closing a §3.2 profile-isolation violation and a recorded-ownership corruption race across every *interactive* ledger writer. Batch/atomic writers stay outside by a documented, tested exclusion. **High-risk.** Decisions: (1) approve the hybrid (profile-bound writes primary + barrier UX); (2) approve the inventory classification and the "interactive writers" contract; (3) approve the three-stage plan. Deferred-promise coordinator tests (incl. profile-bound + key-equality) are the proof; a device switch-mid-edit pass is the completion gate. **No code written yet.**

## Verification results

**Automated (all green):** `test:query` 108 · `test:ui` 83 · `test:codex` 10 · `build` · `check:docs` · `diff --check`. Coordinator + profile-binding tests prove: per-row serialization, cross-row concurrency, reject-to-caller with no unhandled rejection, bounded settle, key-equality ≡ row-equality (incl. `foil`/`:f`), a write bound to A committing under A after a mid-flight switch to B, the `switchProfile` drain barrier, list-entry profile scoping/refusal, the two shared-chain properties (wishlist+owned `''`; both list surfaces), and the device-found shared-`''` -row wishlist-preservation fix.

**Device (installed release, Pixel 9 / WebView 150):** build 63 surfaced a data-loss bug — dropping a card's Unspecified owned to 0 wiped a wishlist entry on the same `''` row (`writeSetRow` deleted the shared row without checking `qty_wanted`). Reproduced in an automated test, fixed by routing the `''` row through `writeQty`, re-verified on **build 64**: the wishlist survives, rapid-tap quantities land correctly, owned/per-set stepping and profile isolation behave. Owner confirmed "the work sticks."

> **Follow-up (owner, not part of this increment):** the Collection edit *UX* reads as strange now (read/edit split, confirm-remove, the Unspecified bucket) and merits a dedicated UX pass. The write path is correct; the interaction design is the open item.

### Approval record

| Role | Disposition | Date |
|---|---|---|
| Claude Code (author) | Submitted Rev 1 (supersedes goal-ledger) | 2026-07-17 |
| Codex (reviewer) | **Changes required** — 3 Major (barrier not atomic → profile-bind; incomplete inventory; row-key/variant mismatch) + 1 Minor (error contract) | 2026-07-17 |
| Claude Code (author) | **Rev 2** — all accepted: profile-bound writes primary + barrier UX; full inventory; `vslug` keys; error contract | 2026-07-17 |
| Codex (reviewer) | Narrow re-review: **Changes required** — 1 Major (`setFoil` still mutable-profile-bound) + 1 Minor (`.finally` unhandled rejection; retained timed-out waiter). Hybrid architecture approved. | 2026-07-17 |
| Claude Code (author) | **Rev 3** — `setFoil` added to inventory/signatures/migration/tests; queue finalizes on a handled tail; timed-out waiters removed from `idle`; unhandled-rejection monitor added | 2026-07-17 |
| Codex (reviewer) | *pending — expected approvable for Stage A* | |
| Human (approver) | *pending* | |
