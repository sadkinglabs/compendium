# Proposal: Storage - every copy is in exactly one place

## Status and classification

**APPROVED - revision 4.** Codex disposition: Approved, no revision 5 required. Six binding
implementation clarifications recorded inline below (coordination for the scanner and profile
switch, the deterministic missing-marker reconciliation, the canonicalisation map's positive-owned
scope, the shared colour registry, and Storage-aware import validating the Unfiled container
specifically). Human architecture approval still to be recorded before implementation begins; the
resulting migration and diff remain subject to the mandatory checkpoint and a final Codex review.

**Originally in review as revision 4.** Addresses Codex disposition "Changes required" on r3 (three blockers,
two majors, one minor), all accepted. The **model reversal was accepted by review** - "Unfiled is a
place; `qty_owned` is the materialised sum of places" stands, and r2's `needs_check` fallback is
formally retired. r4 fixes implementation-boundary and lifecycle defects, not the model.

The system container is named **Unfiled** (owner ruling; r3 called it "Loose").
Risk: **High.** Two new tables, a new unique index on `owned_cards`, a boot-time data backfill, a
change to the profile export/import format and its validation contract, and a new mutation boundary
in front of every ownership writer.
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: project owner

Design settled with the owner over a 30-question pass; decisions cite their number as **(Qn)**.

### What changed in revision 4

- **Coordination is tiered.** r3 put every ownership change under the exclusive barrier, which
  self-deadlocks the steppers. The transactional core now acquires nothing; the calling tier does.
- **Canonicalisation emits an ownership identity map**, so allocations can be re-parented before
  released rows are deleted. Boot ordering (canonicalise, then backfill) confirmed by review.
- **Exactly one Unfiled is established at every point a profile can appear**, and allocations are
  created only for `qty_owned > 0` - a wishlist-only row has none, and would otherwise have broken
  `CHECK (qty > 0)` at boot.
- **Bulk Set/Adjust and undo are specified**: operate against Unfiled, reject the whole atomic
  command with structured conflicts, and undo reverses total and allocation together.
- **Native foreign keys are enabled and verified at open, failing closed** - not merely observed.
- **"Unrepresentable" is corrected** to unreachable-through-sanctioned-paths.

### What changed in revision 3, and why it mooted a finding rather than answering it

Revision 2 accepted the review's drain finding and countered its remedy with a persistent
`needs_check` flag. **That entire exchange is withdrawn as unnecessary.** The owner's observation:

> Our problem is that the cards exist in two places, the collection AND the binders.

That is the root cause. `qty_owned` said one thing and the allocations said another, and every
difficult mechanism in revision 2 was scaffolding around the gap between them: an inequality
invariant policed across seven writers, a drain rule for when the gap opened, a flag for when the
drain had to guess, and a reconciliation sheet for when the flag was not enough.

**Revision 3 removes the gap instead of managing it.** "Unfiled" becomes a real place - a system
container, one per profile - so every owned copy is in exactly one place at all times and the
collection is the sum of the places. There is no second number, therefore nothing to reconcile.

Dissolved outright: the `<=` invariant (now an `=` derivation), drain-largest-first, `needs_check`
and its badge, the reconciliation sheet, and the ⚑ question revision 2 put to the reviewer.

**This reversed a point the review had blessed as sound** - "Unassigned should remain derived" - on
the claim that derived-Unassigned is precisely what manufactures the second number. **Review
accepted the reversal**, ruling location authoritative, the drain guess eliminated, read
performance and rollback visibility preserved, and the finite migration cost preferable to a
permanent uncertainty seam. Revision 2's `needs_check` design is therefore **retired, not held as a
fallback**.

**Everything else from the review survives intact and was not wasted** - the mutation boundary,
`owned_card_id` with composite profile-consistent foreign keys, triage and `canonicaliseBoot`
re-parenting, full import graph validation, the semantic round-trip, and the migration rebase. That
was the expensive part and it is all still required.

## Problem and success criteria

From an alpha tester, unprompted, twice:

> if I have 4 copies of a card from Beta, I would like to allocate 1 copy to my Beta binder, 2 to
> my whatever deck, and 1 in my storage box. With lists you are not really allocating your card
> inventory to certain spots that can be traced, but just making a list that has no reference to
> your actual collection quantities.

He was offered tagging and rejected it, then lists and rejected those, both for the same reason: a
label or list entry carries no quantity, so neither can say *one of my four*.

**The model.** Every owned copy is in exactly one place. "Unfiled" is a place. Your collection is what
the places add up to. Filing a card **moves** it between places; it never claims it against a
separate total.

**Success criteria**

1. Containers of the user's naming, of kind Binder / Box / Deck / Other **(Q7)**.
2. From a card owned 4 times, move 1 / 2 / 1 into three containers, with the remainder in Unfiled
   **(Q1, Q16)**.
3. A container shows its cards **with quantities**, searchable and arrangeable.
4. **`qty_owned` equals the sum of that item's allocations, always, for every writer in the app**
   - maintained by construction in one transaction, not policed after the fact **(Q3)**.
5. Unfiled is always visible, openable and **bulk-fillable** **(Q13, Q14)**.
6. Deleting a container moves its copies to Unfiled and never deletes a card **(Q26)**.
7. Export/import round-trips the complete container graph, not merely its row counts **(Q27)**.
8. No join to any deck record **(Q23)**.
9. **A copy is never nowhere, and never in two places.** Over-allocation is **unreachable through
   every sanctioned production mutation path** - not literally unrepresentable, since `qty_owned`
   stays materialised and direct SQL could still move one side alone. Backed by a source guard and
   in-transaction assertions rather than by the schema alone.
10. **A collector-item key move carries its allocations with it** - triage filing, boot
    canonicalisation, or any future re-keying.
11. **A profile that never opens Storage behaves exactly as it does today**, including every
    stepper, bulk edit and import path.
12. **Ordinary ownership taps never block on themselves.** The transactional core acquires no
    coordination; the calling tier chooses it.
13. **Exactly one Unfiled exists per profile at every moment of a profile's life** - boot, creation,
    duplication, legacy import, Storage-aware import.
14. **Native foreign-key enforcement is established and verified at connection open**, or the app
    fails closed rather than shipping structural guarantees that hold only on web.

**Non-goals**

Tags (a yes/no property of a card, unconstrained by quantity - the separating test is *does the
answer need a number?*); nesting; capacity; deck coupling in any form; instance identity; allocating
wishlisted copies **(Q5)**; scanner container targets **(Q18, Q24)**; locations in shareable text
exports **(Q25)**; dropping the legacy `settings` table (the v12 line of work).

## Evidence and current architecture

**The grain already exists.** `owned_cards` is collector-item grain, `UNIQUE(profile_id, card_id,
variant_slug)` with `qty_owned` ([`schema.js:292-303`](../../src/store/schema.js#L292-L303)).

**`qty_owned` is read everywhere** - the ALL grid, set drills, playset maths, deck buildability,
dashboard stats, exports. It stays exactly where it is and every reader is untouched. It stops being
the value the user *edits* and becomes the **materialised total** the mutation boundary keeps equal
to the sum of the places, in the same transaction that moves them. Nothing computes a sum at read
time: no new joins, no N+1, no change to grid performance.

### Every writer that can change owned quantity

Revision 1 said "the repository enforces the invariant" without establishing which repository. There
are **seven** mutation sites across six modules, and Storage's own is none of them:

| Module | What it does |
|---|---|
| [`ownedRepository.js`](../../src/store/ownedRepository.js) | the interactive steppers - update, and delete when a row empties |
| [`bulkOwnedRepository.js`](../../src/store/bulkOwnedRepository.js) | bulk Adjust / Set, including Set-to-0 as bulk delete |
| [`ownedImportRepository.js`](../../src/store/ownedImportRepository.js) | typed/bulk import reconciliation |
| [`triageRepository.js:124-150`](../../src/store/triageRepository.js#L124-L150) | **key move**: draws a slug's count to 0, re-files under a set-coded slug, deletes the emptied source row |
| [`canonicaliseBoot.js:60-100`](../../src/store/canonicaliseBoot.js#L60-L100) | **key move at boot, across EVERY profile, before a profile is resolved**: rewrites `variant_slug`, *merges* duplicate rows by releasing some ids and retaining others, deletes the released ones |
| `profileTransfer.js` | import inserts |

Scanner writes only increase quantities. No Curiosa writer touches ownership.

`canonicaliseBoot` is the one neither the review nor revision 1 named, and it is the most dangerous:
it runs at boot, it **merges** rows, and a naive `ON DELETE RESTRICT` would make it throw before the
app starts.

### Coordination

[`collectionWrites.js`](../../src/store/collectionWrites.js) states the rule this proposal must
respect: `enqueueWrite` **orders** writes per row, while `withExclusiveCollectionWrites` **excludes**
all row writes for a command - "anything that reads-then-writes needs the barrier, not a drain".

### Import validation

[`importBoundary.js:27-31`](../../src/store/importBoundary.js#L27-L31) defines
`ITERATED_COLLECTIONS` as the contract, asserted by a test to cover every
`for (const ... of bundle.X || [])` in `profileTransfer`. The loop at
[line 80](../../src/store/importBoundary.js#L80) validates only that each named collection is an
*array*; row-level validation exists for `owned_cards` alone. Backup bounds, digests and recovery
counts inherit from the same contract.

### Foreign-key enforcement is not uniform

`PRAGMA foreign_keys = ON` is set for the web backend at [`db.js:261`](../../src/store/db.js#L261),
and appears in migration SQL at [`schema.js:12`](../../src/store/schema.js#L12) - but a PRAGMA binds
a *connection*, and the native path (`createConnection` then `db.open()`,
[`db.js:389-395`](../../src/store/db.js#L389-L395)) sets nothing. Structural constraints are
**confirmed on web, unverified on native**. Structure is adopted, but the boundary enforces
unconditionally and the native FK state is an explicit device gate.

### Precedent for a boot-time data backfill

Revision 3 needs one Unfiled allocation per existing owned row - **data, not DDL**, so it cannot ride
in migration SQL, because the native `execute()` splitter is quote-unaware.
[`canonicaliseBoot.js`](../../src/store/canonicaliseBoot.js) is exactly this shape already: it plans
in JS, issues parameterised statements, runs across every profile before one is resolved, and is
idempotent on re-run. The backfill follows that pattern rather than inventing one.

## Assumptions and confidence

1. Partitioning a quantity satisfies the request; per-copy identity is unnecessary. **High.**
2. Keeping `qty_owned` as a maintained total leaves every reader untouched. **High** - it is the
   same column with the same meaning; only the writer changes.
3. Every ownership change can route through one boundary without deadlocking. **Medium** -
   `canonicaliseBoot` runs before a profile is resolved and cannot take the interactive barrier.
4. The backfill is safe and idempotent across every profile at boot. **Medium** - it is the
   riskiest single step in the proposal, and it runs before the app is usable.
5. Sync-readiness needs timestamps now and tombstones later **(Q28)**. **Medium.**

## Affected systems and invariants

- **Schema:** two new tables, `UNIQUE(id, profile_id)` on `owned_cards`, plus a boot backfill.
- **Repositories:** new `storageRepository.js`; a new ownership-mutation boundary six modules route
  through; `profileTransfer.js` and `importBoundary.js` extended.
- **UI:** Storage section in My Collection; container detail; card-sheet ledger; Codex read-only
  line; bulk Put Away inside Storage's own selection context.
- **Native/web:** DDL-only migration plus a JS backfill; native FK enforcement verified on device.

**Invariants engaged** (§3): profile isolation (composite profile-consistent FKs *and* repository
scoping); forward-only evolution (additive DDL; the backfill is idempotent and additive);
transactional user-data operations (allocation moves and the `qty_owned` total commit together);
durable offline-first writes; cross-runtime integrity (the FK divergence and the splitter
constraint); catalog/profile boundary (no catalog write); zero-image degradation (text and
quantities, reusing `CardArt`); content-is-data (untouched).

**Documentation classification** (all source-of-truth documents):

| Document | Disposition | Reason |
|---|---|---|
| `COMPENDIUM_DATA_MODEL.md` | **Updated** | Two tables, a new index, the backfill, export/import format, and `qty_owned` restated as a maintained total |
| `COMPENDIUM_ARCHITECTURE.md` | **Updated** | A mutation boundary six modules must route through is a boundary statement |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Updated** | New Storage capability rows |
| `DESIGN_SYSTEM.md` | **Updated** | Container rows, the move affordance, the Unfiled place |
| `BUILD.md` | **Reviewed, no change** | No new command, dependency, env var or gate; native checks ride the existing device pass |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed, no change** | No process or agent-behaviour change |

## Options considered

**A. Status quo (lists)** and **B. tags** - rejected by the tester himself; neither references owned
quantity.

**C. Instance model** - one row per physical copy. Delivers per-copy provenance and costs a rewrite
of every stepper, playset and import path for a distinction never requested.

**D. Surface the dead `owned_cards.notes` field** - nearly free, unstructured, unsearchable,
uncountable, cannot be browsed by container.

**E. Allocations as a claim against a separate total** (revisions 1-2). Unassigned derived. Rejected
in revision 3: it creates two numbers that can disagree, and every mechanism needed to manage that
disagreement - inequality invariant, drain, flag, reconciliation - is scaffolding around a seam of
our own making.

**F. Recommended: allocations ARE the ownership, Unfiled is a place.** One number per place, the total
materialised. The reference implementation of this idea in the wild (Cursedrealm's vault) is
disliked by the owner on execution, not on model; the model is right.

## Proposed design

### Schema (additive DDL, plus a JS backfill)

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_id_profile ON owned_cards(id, profile_id);

CREATE TABLE IF NOT EXISTS storage_containers (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'binder',        -- binder | box | deck | other | unfiled   (Q7)
  name TEXT NOT NULL,                         -- not unique (Q9); duplicates warn, never block
  description TEXT DEFAULT '',                -- "top shelf, spare room"                (Q12)
  -- A TOKEN NAME from the shared allow-list registry, never a hex string and never anything
  -- CSS-like, so a theme can retint every container and the value stays content rather than
  -- presentation. ONE registry is used by creation, rendering, import validation and the picker;
  -- an imported unknown value is REJECTED, never interpolated into a CSS variable. Q11 reversed by
  -- the owner: colour is not decoration on a container, it is how you identify the physical binder
  -- on a shelf, and it is the attribute a user reaches for first in a list of eight.
  colour TEXT NOT NULL DEFAULT 'gold',
  sort_order INTEGER DEFAULT 0,               -- manual, like card_lists                (Q10)
  -- The system Unfiled place: exactly one per profile, undeletable, unrenameable. Modelled as a row
  -- rather than a derived remainder BECAUSE a remainder is a second number, and a second number is
  -- the thing every difficult mechanism in revisions 1-2 existed to police.
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_containers_id_profile ON storage_containers(id, profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_containers_one_unfiled
  ON storage_containers(profile_id) WHERE is_system = 1;    -- one Unfiled per profile, structurally
CREATE INDEX IF NOT EXISTS idx_containers_profile ON storage_containers(profile_id, sort_order);

CREATE TABLE IF NOT EXISTS storage_allocations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  owned_card_id TEXT NOT NULL,                -- HARD ref: survives a variant_slug rewrite
  qty INTEGER NOT NULL CHECK (qty > 0),       -- zero and negative are structurally impossible
  created_at TEXT, updated_at TEXT,
  FOREIGN KEY (container_id, profile_id)
    REFERENCES storage_containers(id, profile_id) ON DELETE CASCADE,
  FOREIGN KEY (owned_card_id, profile_id)
    REFERENCES owned_cards(id, profile_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alloc_key ON storage_allocations(container_id, owned_card_id);
CREATE INDEX IF NOT EXISTS idx_alloc_owned ON storage_allocations(profile_id, owned_card_id);
```

Composite foreign keys make a cross-profile allocation structurally impossible: a row cannot name a
container from one profile and an owned row from another, because both relationships must agree on
the same `profile_id`. `owned_card_id` is a hard reference because `canonicaliseBoot` rewrites
`variant_slug` in place **by id** - a soft `(card_id, variant_slug)` key would strand every
allocation on every boot canonicalisation. `RESTRICT` plus reconcile-before-delete is the correct
shape; revision 1's objection to `CASCADE` did not justify having no referential protection.

**Sync readiness (Q28):** timestamps on both tables from birth; tombstones noted, not built;
migration sequenced separately from v12.

### The ownership-mutation boundary, and who coordinates it

Revision 3 put **every** ownership change under `withExclusiveCollectionWrites`. That
**self-deadlocks**, and the review is right. Interactive steppers already run *inside* the queue -
`OwnedControl` enqueues on the collector-item key and calls the repository from within that callback
([`OwnedControl.jsx:40-46`](../../src/components/OwnedControl.jsx#L40-L46)). By the time that
callback executes, its write is **admitted**. A boundary that then requests exclusivity waits for
admitted work to drain ([`collectionWrites.js:125`](../../src/store/collectionWrites.js#L125)) -
which includes itself. Every ownership tap would hang until the timeout.

The fix is to **separate the transactional core from the coordination that wraps it**:

| Tier | Coordination | Why |
|---|---|---|
| **The core** - plan and execute one atomic ownership/allocation change | **None. It acquires nothing.** | A core that coordinates cannot be composed by a caller that already has |
| **Interactive, one collector item** (steppers, quick add, a single move) | the caller's existing `enqueueWrite` on the **collector-item key** | The change is confined to one row and its allocations, which the per-row chain already serialises. Keeping the same key preserves the wishlist/ownership commutation on the shared `''` row that `OwnedControl` depends on |
| **Multi-item** (bulk Set/Adjust, undo, import, triage) | `withExclusiveCollectionWrites` around the core | These read-then-write across many rows, which is exactly what the barrier exists for. `undoBulkOwned` already takes it |
| **Scanner** (one collector item per capture) | the **same** `enqueueWrite` chain and `ownedRowKey(profile, card, set, foil)` `OwnedControl` uses, with `profile_id` captured **before** enqueueing | Scanner writes only increase quantities, but two overlapping captures of the same printing on different chains would lose an increment |
| **Profile switch** | `withProfileSwitchWriteBarrier` - the **tolerant** barrier, NOT the fail-closed bulk one | The two semantics are deliberately separate exported functions so a caller has to name the tolerant path; a profile switch must not fail closed on a slow in-flight write |
| **Boot** (canonicalisation, backfill) | its own boot transaction, no interactive barrier | Runs before a profile is resolved; nothing interactive exists yet |

The rule stated once: **coordination is chosen by the calling tier; the core never acquires it.**
That is also what makes the core node-testable without a queue.

Its contract is a **derivation**, not a validation:

> After any operation, for every owned row: `qty_owned = SUM(allocations for that row)`.

Responsibilities:

1. **Increase** adds to Unfiled (or the container the user is standing in), and raises `qty_owned` in
   the same statement set.
2. **Decrease** subtracts from a **named place**. From a container view, that place is the container.
   From the global stepper, that place is Unfiled.
3. **Move** shifts qty between two containers; `qty_owned` does not change, and cannot, because no
   statement touches it.
4. **Key move** re-parents allocations by `owned_card_id`. Triage: allocations follow the copies.
   Canonicalisation: see the identity-mapping section immediately below.
5. **Global Set / Adjust** operate against Unfiled, and **reject the entire atomic command** if any
   selected item's requested target would fall below its non-Unfiled total. The rejection returns
   **structured conflicts** - item, requested target, non-Unfiled total, and the containers holding
   them - so the UI can name the places rather than saying "cannot". A mixed selection where some
   items are satisfiable and some are not fails whole; a bulk command that half-applies is worse
   than one that explains itself. Set-to-zero is the same rule with a target of 0.
6. **Undo** reverses both the total and the exact Unfiled allocation it changed, under the same
   expected-state guards `undoBulkOwned` already applies
   ([`bulkOwnedRepository.js:145`](../../src/store/bulkOwnedRepository.js#L145)) - a row is restored
   only while it still holds what the bulk write left, and the guard now covers the allocation too.

### Canonicalisation needs an explicit identity mapping

`planLedger` returns `{ rows, releasedIds, touched }`
([`canonicalise.js:155`](../../src/store/canonicalise.js#L155)) - **final rows and the ids to
delete, with no mapping from a released id to the destination that absorbed its quantity**. Revision
3 required re-parenting before deletion without providing the information re-parenting needs. A
released row can also split into an owned destination and a wanted destination, and only the owned
one can carry allocations.

The pure planner is extended to emit an **ownership identity map**, `releasedId -> destinationRowId`,
generating destination ids in the planner before any SQL is composed. **The map covers only released
rows contributing positive owned quantity.** A released wishlist-only row may legitimately have no
destination mapping - but it must be *proven* to hold zero allocations, and any allocation attached
to such a row is corruption that **aborts the transaction** rather than being re-homed by guesswork. The adapter then executes, in
one transaction, in this order:

1. insert / update destination owned rows;
2. re-parent allocations through the map, **summing** where two allocations for one container land
   on one destination row;
3. delete the released owned rows (now unreferenced, so `RESTRICT` is satisfied);
4. assert no legacy keys remain **and** `qty_owned = SUM(allocations)` for every touched row;
5. write the canonicalisation marker.

**Boot ordering, confirmed by review:** canonicalisation runs **first**, the Unfiled backfill
**second**. On a first upgrade there are no allocations, so canonicalisation reduces the ledger to
its final row identities before the backfill attaches places. The re-parent path is still required,
because canonicalisation is shape-first and may re-run later, after Storage exists.
5. **Container deletion** moves its allocations to Unfiled, then deletes the container **(Q26)**.
   Under this model that is arithmetic rather than a policy: copies cannot be nowhere.

`canonicaliseBoot` is the exception that proves the rule - it runs before a profile is resolved and
cannot take the interactive barrier, so its re-parenting rides inside its own boot transaction. That
asymmetry is the sharpest implementation risk in the proposal.

### What the user sees

**Nothing changes in My Collection.** Same grid, same counts, same playsets, same buildability. The
total is the same column it always was.

**The global stepper takes from Unfiled.** For a profile with no containers - which is every profile
until someone makes one - everything is Unfiled, so every stepper, bulk edit and import behaves
**exactly as it does today** (criterion 11). Once a card is filed, the global minus reaches only the
unfiled copies; when Unfiled is empty it says where the copies actually are, with a one-tap route to the
container. That is a wall, but an informative one, and it appears only for cards the user
deliberately filed.

**Removal at a place is unambiguous and silent** - it is the natural path for anyone who files, and
it mirrors the physical act.

There is no drain, no flag, no reconciliation sheet, and no moment where the app guesses which copy
left. The question cannot arise, because a decrease always names its place.

**Other interaction, unchanged from revision 2:** ledger with steppers in the card sheet **(Q16)**;
direct move between containers **(Q19)**; new copies land in Unfiled, never prompting **(Q18)**;
container view on the list-detail chassis **(Q20, Q21)**; read-only ownership line in the Codex card
detail **(Q22)**; empty zero state with a create prompt **(Q30)**.

**The wishlist is untouched.** `qty_wanted` is not owned, so it is in no place **(Q5)**.

### Reuse inventory

Owner instruction: reuse before writing; anything new must itself be reusable.

| Need | Reused |
|---|---|
| Selection, counts, hidden-by-filter | `SelectionBar`, `useCollectionBulkActions`, `selectionSummary` |
| Create / rename a container | `ListNameSheet` - already takes `chooseKind` |
| Container detail screen | the list-detail chassis, headers, overflow menu |
| Ordering inside a container | `stackComparator`, `SortRow`, `LIST_SORT_OPTIONS` |
| Steppers | `StepBtn` |
| Sheets, chips, labels, FABs | `GothicSheet`/`BottomSheet`, `Chip`, `SectionLabel`, `Fab`, `OverflowMenu` |
| Destructive confirmation with counts | `confirmAction` + the DESIGN_SYSTEM pattern |
| Write coordination | `withExclusiveCollectionWrites`, `enqueueWrite`, `persist()` |
| Boot-time idempotent backfill | the `canonicaliseBoot` pattern |
| Card rows and tiles | `LedgerRow` / `BinderTile` / `CardArt` |
| Container colour palette | the shipped `--accent-*` tokens (gold, violet, jade, ruby), by NAME |

**New, and deliberately reusable:** the ownership-mutation boundary; `storageRepository.js` (pure,
node-testable, DOM-free); and a **swatch picker** over the shared colour registry, written as a
general primitive rather than a Storage-local control so the next surface that needs one does not
build a second. It exposes **named radio options with keyboard navigation, `aria-checked`, and touch
targets meeting the §5 floor** - a colour control that can only be operated by sighted tapping is
not a control. It does not reach into any other feature's colour state - `profiles.accent` belongs
to profiles and is out of scope here. **Withdrawn:** `PickerSheet`, "group by container", `needs_check`
and its badge, and the reconciliation sheet.

## Implementation plan

**Rebase first.** Land after v12, take the next free schema version, and test the in-place upgrade
from the actually shipped predecessor - not from a version that exists only in a draft.

1. **Boundary + schema + backfill + repository.** Tables, indexes, the boundary maintaining the
   equality, the Unfiled place per profile, the idempotent boot backfill, re-parenting for triage and
   `canonicaliseBoot`. No UI. *Checkpoint: production-path tests for steppers, bulk Set and Adjust,
   typed import, triage filing and boot canonicalisation, each asserting `qty_owned = SUM(allocations)`
   afterwards. Concurrency test for the read/check/write race. Backfill idempotency across a
   multi-profile database. Device check that native FK enforcement is on.*
2. **Export/import + validation.** Both tables through `profileTransfer`, `ITERATED_COLLECTIONS`
   extended, full graph validation before planning the transaction: positive safe-integer
   quantities, unique source ids, known container mappings, same-profile relationships, resolvable
   collector items, **and the totals reconciling to `qty_owned` exactly**. Backup bounds, digests,
   recovery counts and fixtures updated. *Checkpoint: the semantic round-trip below.*
3. **Storage section + container detail.**
4. **Card-sheet ledger + Codex line.**
5. **Bulk Put Away, inside Storage's own selection context** - no change to `AddToListSheet`, no
   dock reshuffle in existing surfaces.
6. **Docs**, including adding storage to the delete-profile confirmation **(Q29)**.

Increments 1 and 2 ship together or not at all: a UI over an unexported table produces data a
restore destroys silently.

## Data migration and compatibility

DDL is additive and free of data statements, because the native `execute()` splitter is
quote-unaware. The Unfiled backfill is a **separate, idempotent, parameterised JS step** on the
`canonicaliseBoot` pattern, running immediately after canonicalisation.

**Exactly one Unfiled per profile, established at every point a profile can come into existence.**
The partial unique index guarantees *at most* one; these guarantee *at least* one:

| Moment | Rule |
|---|---|
| Boot backfill | one Unfiled for **every existing profile, including empty ones** |
| `createProfile` | Unfiled created **in the same transaction** as the profile row - never a follow-up write |
| `duplicateProfile` | same, for the copy |
| Import of a **Storage-aware** bundle | validate that the sole system container **is specifically the immutable Unfiled container** - not merely that some row carries `is_system = 1` - and reject the bundle otherwise |
| Import or restore of a **legacy** bundle | synthesise Unfiled and allocate every positive owned quantity to it |

**Allocations are created only for `qty_owned > 0`.** Revision 3 said "every owned row", which was
wrong: a wishlist-only row legitimately has `qty_owned = 0` and `qty_wanted > 0`, and inserting a
zero allocation violates `CHECK (qty > 0)` - boot would fail on any profile holding a want for a
card it does not own. Such a row simply has no allocations, and `0 = SUM(∅)` satisfies the equality
exactly.

**The backfill closes its own transaction with assertions**: exactly one Unfiled per profile, and
`qty_owned = SUM(allocations)` for every owned row. **The marker is written in the same
transaction**, so "runs once" is a fact rather than a hope - an interrupted pass leaves no marker
and no partial state, and re-running is a no-op.

**A missing marker uses a deterministic reconciliation, per owner ruling** - it never assumes a
clean slate and never guesses:

| Owned quantity | Allocation sum | Action |
|---|---|---|
| 0 | 0 | leave empty - a wishlist-only row correctly has no allocations |
| > 0 | 0 | create the full quantity in Unfiled |
| any | equal to `qty_owned` | preserve the existing locations untouched |
| any | **anything else** | **fail closed** - the missing or excess location cannot be inferred, and guessing is what this whole model exists to avoid |

Before recording the marker, the pass asserts exactly one valid Unfiled container per profile and
exact equality for every owned row.

A profile that has never opened Storage remains indistinguishable from today in every reader: all
its copies are in Unfiled, and every stepper, bulk edit and import behaves exactly as before
(criterion 11).

Older builds reject a newer export via the existing `importBoundary` future-version rule.

## Rollback and recovery

**Before any user has filed cards:** reverting leaves unused tables and a harmless Unfiled row per
item.

**After users have filed cards, ordinary code rollback is UNSAFE.** An older build does not know the
tables, so it omits Storage from every export it takes - and a backup made by that build silently
lacks the user's filing. Recovery is **forward-fix, or restore from a Storage-aware backup**. The
point of no return is increment 3 reaching a device.

A rolled-back build still reads `qty_owned` correctly, because it remains a real materialised column
- the collection survives a rollback intact even though the filing does not. That is a deliberate
consequence of not making the total derived at read time.

## Verification plan

- **Automated:** boundary tests on production paths (steppers, bulk Set/Adjust, import, triage, boot
  canonicalisation) each asserting the equality afterwards; a concurrency test for the
  read/check/write race; re-parenting tests including a canonicalisation **merge** that sums two
  allocations onto one row; backfill idempotency on a multi-profile database, including a profile
  mid-backfill; container deletion; and the import-validation matrix (negative and non-integer
  quantities, duplicate source ids, dangling containers, cross-profile references, totals that do
  not reconcile).
- **The round-trip compares a canonical semantic graph, not counts.** Container names are not unique
  **(Q9)**, so name-to-card is insufficient: compare a multiset of
  `(kind, name, description, sort_order)` each mapped to sorted `(card_id, variant_slug, qty)`, ids
  stripped. A count-based test passes while `container_id` remaps to the wrong container - cards
  silently changing binders on restore is the failure this feature would otherwise ship.
- **Coordination tests, called out because r3 got this wrong:** an explicit "does not self-deadlock"
  test driving the core from inside `enqueueWrite`; rapid-tap on one item; a stepper racing a bulk
  command; a profile switch mid-write; **two overlapping scanner captures of the same printing, and
  a scanner capture racing a bulk command** (both must land on the same chain, so no increment is
  lost); and wishlist/ownership ordering preserved on the shared `''` row.
- **Lifecycle tests:** fresh install, empty profile, profile created after boot, duplicated profile,
  legacy import, Storage-aware import, wishlist-only rows, several profiles, and an interrupted
  backfill resuming correctly.
- **Bulk tests:** Set-to-zero, a mixed selection where some items are blocked, and an undo whose
  expected-state guard fails on either the total or the allocation.
- **Gates:** `test:codex/query/ui/app`, `check:types/cycles/source/docs`, `build`; `check:smoke`
  pre-merge.
- **Manual, on device:** the tester's case, 4 Beta copies moved 1/2/1. Remove one from inside a
  container and confirm the total drops with no prompt. Empty Unfiled, then confirm the global stepper
  says where the copies are instead of guessing. File an uncategorised card through triage that
  already has allocations and confirm they follow. **Upgrade in place from the shipped predecessor
  with a real collection and confirm the backfill produces exactly one Unfiled allocation per item.**
  Delete a container. Export, wipe, import, verify the semantic graph. Zero-image mode on both new
  views. **On the installed app specifically:** composite-mismatch rejection, `RESTRICT`, profile
  cascade and container cascade, to prove foreign keys are actually live on Android.

## Security, privacy, performance, and operations

No network, telemetry, or new permissions. Storage is private inventory, excluded from shareable
text exports **(Q25)**. Performance: reads are unchanged because `qty_owned` is still materialised;
the card ledger is one indexed lookup; the Storage section computes per-container totals in a single
grouped query (the `listDecks` N+1 lesson). Writes touch two tables instead of one, transactionally.
The backfill is one pass at boot, bounded by collection size, and runs once.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| The boot backfill is wrong, partial, or non-idempotent | Medium | **Critical - it runs before the app is usable, on every existing collection** | Marker written in the same transaction; closing assertions; shape-first fallback; multi-profile, empty-profile, wishlist-only and interrupted-pass tests; in-place upgrade is a release gate | Claude |
| A caller wraps the core in the barrier from inside the queue and deadlocks | Medium | High - ordinary taps hang | The core acquires no coordination; an explicit self-deadlock test; tiering documented in ARCHITECTURE | Claude |
| A profile appears without an Unfiled container | Medium | High - increases have no destination | Created in the same transaction as the profile row at every creation path; import validates or synthesises; backfill assertion | Claude |
| Native FK enforcement unavailable at runtime | Low-medium | High | Enabled and verified at open, fail closed; boundary enforces regardless | Claude |
| Container colour becomes a third dead column | Medium | Low | Chosen at creation rather than buried in an edit sheet, and rendered on every container row - `profiles.accent` and `owned_cards.notes` both died by being storable but never surfaced | Claude |
| `canonicaliseBoot` re-parenting is wrong, or `RESTRICT` throws at boot | Medium | **Critical - the app fails to start** | Re-parent inside the existing boot transaction before deletes; merge test | Claude |
| The global minus wall confuses a user who filed everything | Medium | Medium | It names the places and offers a one-tap route; only reachable for deliberately filed cards | Owner |
| A writer added later bypasses the boundary and breaks the equality | Medium | High | The boundary is the only path that may write `qty_owned`; a source guard can assert no other module does | Claude |
| Import accepts a schema-valid graph whose totals do not reconcile | Medium | High | Totals reconciliation is part of graph validation, not just row shape | Claude |

**Unanswered, for the reviewer:** whether the reversal of derived-Unassigned is accepted - see the
Self-Critique.

## Self-Critique

**The strongest case that this is wrong.** The model survived review, so the remaining doubt is not
about the model. It is that r3 shipped a coordination design that would have hung every ownership
tap the first time anyone touched a stepper - and I wrote "under `withExclusiveCollectionWrites`"
having already read and quoted the module comment explaining that a queued write is admitted before
its callback runs. I had the fact and did not apply it. The same is true of `CHECK (qty > 0)` versus
wishlist-only rows: I wrote both constraints, in the same document, and did not cross them.

**The historical version of this criticism**, kept because it is still the pattern: I reversed a
design point the reviewer had blessed, one revision after he blessed it, on an argument I did not
make myself - the owner did. That is exactly the pattern that produces churn: each revision looks locally
better while the design oscillates. The honest defence is that the two revisions differ in kind
rather than degree - revision 2 managed a gap, revision 3 removes it - but a reviewer would be
right to ask why I designed the gap in the first place when the tester's own sentence ("allocate 1
copy to my Beta binder") describes movement, not claiming. I had the evidence for this model in
revision 1 and read it as a partition problem instead of a location problem.

**What three review rounds have exposed.** Every finding has been the same species: I reason about a
system from the parts I have read, and describe the rest. `renderSignature` on the sort work,
`triageRepository` and `canonicaliseBoot` here. The one encouraging sign is that verifying findings
at source keeps surfacing things the reviewer did not raise, which suggests the method works even
where my initial coverage does not.

**Hidden coupling, and the thing that scares me most.** The boot backfill runs on every existing
collection, before the app is usable, before a profile is resolved, on data shapes produced by old
builds. It shares that window with `canonicaliseBoot`, which is itself rewriting and merging the
rows the backfill needs to read. The ordering between those two steps is load-bearing. It is now
**settled**: canonicalisation first, backfill second, because on a first upgrade there are no
allocations, so canonicalisation reduces the ledger to its final row identities before the backfill
attaches places. Review confirmed the reasoning rather than my having to guess at it. What remains
uncomfortable is not the order but the window: both run before the app is usable, on data shapes
produced by builds I cannot inspect.

**Simpler alternative I am no longer taking.** Revision 2's `needs_check` model was the stated
fallback until review ruled the backfill risk finite and the r2 seam permanent. It is retired. The
remaining simpler option is the one that has been available since revision 1 - surfacing the dead
`owned_cards.notes` field - which fails the browse-by-container half of the request and which I
would still rather name than pretend the choice is obvious.

**Failure most likely to escape tests.** The **canonicalisation merge under the new model**: two
owned rows for one card collapsing into one, each carrying a Unfiled allocation, whose quantities must
sum rather than collide under the unique index - and whose summed total must still equal the merged
`qty_owned`. That path runs at boot, on real data shapes produced by old builds, and no fixture in
the repo naturally contains it.

**On the colour column, against my own earlier argument.** I cut colour at Q11 as scope creep and
used `owned_cards.notes` - stored since v11, written as `''`, read by nothing - as evidence that
unrequested fields die. That evidence still stands and I am reversing anyway on the owner's ruling,
so the argument has to be that colour is different in kind: it is the attribute by which a person
identifies the physical object the container stands for. What makes that safe is not that the risk
is absent but that the mitigation is structural - colour is chosen at creation and rendered on every
container row, so it cannot quietly become storable-but-invisible, which is exactly how `notes`
died. If it ships buried in an edit sheet, I was wrong.

**Evidence that would change the decision.** If the tester files a collection once and never opens
Storage again, this is a feature that demos better than it lives. Under this model the tell is
different from revision 2's: Unfiled staying full means filing was too tedious; the global minus wall
being hit repeatedly means removal-at-a-place is not discoverable.

## Approval record

- **Owner:** design agreed over a 30-question pass, decisions cited inline. Root-cause observation
  that produced revision 3: *"our problem is that the cards exist in two places, the collection AND
  the binders"*. Standing instruction: reuse before writing; anything new must be reusable. Formal
  approval of revision 3 pending.
- **Reviewer (Codex), r1:** Changes required - two blockers, four majors, one minor. All accepted;
  six adopted as prescribed and carried into revision 3 unchanged (mutation boundary, structural
  references, import graph validation, semantic round-trip, migration rebase, increment 5 split,
  documentation classification).
- **Reviewer (Codex), r2:** not issued - revision 3 superseded the ⚑ counterproposal by removing the
  condition that made the question necessary.
- **Reviewer (Codex), r3:** Changes required, **model reversal accepted** and r2 formally ruled out
  as a fallback. All six findings accepted:
  1. *Coordination deadlocks interactive writes* - the core now acquires no coordination; the
     calling tier chooses it; self-deadlock, rapid-tap, stepper-versus-bulk and profile-switch tests
     specified.
  2. *Canonicalisation needs an identity-transfer plan* - the pure planner emits
     `releasedId -> destinationRowId` with destination ids generated before SQL; transaction order
     and closing assertions specified; the reviewer's boot-ordering ruling adopted.
  3. *Exactly-one Unfiled across lifecycles* - established at boot, creation, duplication and both
     import paths; allocations only for `qty_owned > 0`; marker written in the same transaction with
     a shape-first fallback.
  4. *Bulk and undo underspecified* - global Set/Adjust operate against Unfiled and reject the whole
     atomic command with structured conflicts; undo reverses total and allocation under one guard.
  5. *Native foreign keys must be established* - enabled and verified at open, failing closed;
     exercised in the installed app.
  6. *"Unrepresentable" overstated* - corrected to unreachable through sanctioned mutation paths,
     backed by a source guard and in-transaction assertions.
- **Reviewer (Codex), r4: APPROVED.** "The location-authoritative model is coherent, the coordination
  split removes the self-deadlock, canonicalisation precedes backfill for the right reason, and
  wishlist-only rows now satisfy the equality without fabricated allocations." Six binding
  implementation clarifications issued and recorded in the design above; editorial residue cleaned
  (duplicate native-FK risk, the obsolete reversal question, the settled boot-ordering claim, the
  coordination table's profile-switch entry).
- **Human architecture approval: GRANTED**, 2026-08-18, after the reviewer-feedback merge landed on
  main: *"implement on branch, let's go homie!"*. Implementation proceeds on branch
  `collection-storage`. The resulting migration and diff remain subject to the mandatory checkpoint
  and a final Codex review before merge.
- **Increment 1 COMPLETE**, on branch `collection-storage`. Device evidence, 2026-08-18: an
  **in-place upgrade from the shipped predecessor** (build 276, schema v11, a real collection) to
  build 277 (v12), followed by `check:smoke` reporting **8/8 routes rendered**. Because every new
  guard fails closed, a successful boot IS the assertion: the v12 migration applied through the
  native execSQL path; foreign keys were enabled and verified, or the database would have refused
  to open; the backfill's in-transaction assertions held (`qty_owned = SUM(allocations)` for every
  row, exactly one Unfiled per profile) or boot would have rolled back; and canonicalisation found
  no allocation on a row holding no copies. Repo gates: `test:query` 1116/1116, `test:ui`,
  `test:app`, `check:types/cycles/source/docs`, `build`.
- Increments 2-6 (UI, bulk, docs) not started. The diff still requires the mandatory checkpoint and
  a final Codex review before merge.
