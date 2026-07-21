# Schema v11 — per-set-and-finish wants, and an *uncategorised* state that means something

**Status:** Revised twice - after Codex critique, then to close the three technical gaps its
review left open (boot ordering §3.1, the SQLite `DEFAULT` §3.2, merge and conservation §3.3).
**All owner decisions are now made** (§7.4 ruled: legacy wants migrate as non-foil,
`uncategorised:?` dropped). Ready for Codex's approval pass. No `src/**` change beyond the already-landed set-pill fix until
approved.
**Class:** High-risk — forward-only migration over live user data, touching the ownership
ledger and the profile export format.
**Invariants engaged (§3):** forward-only schema evolution, transactional user-data
operations, durable offline-first writes, profile isolation.

---

## 1 · What is actually wrong

### Terminology lock — the Collection grain

For Collection, one collector item is exactly:

```text
card_id + set + finish
```

For example, Alpha non-foil, Alpha foil, Beta non-foil and Beta foil are four distinct
collector items for a card name shared between Alpha and Beta. A set is a release; finish is
foil or non-foil. Catalog `variants[]` may contain multiple art/product records inside one set,
but those are **not** additional Collection ownership identities. This proposal does not add
exact catalog-variant ownership.

The repository has historically called the set/finish key a "printing" and stores it in
`variant_slug`. In this proposal, **collector item** means the Collection identity above;
**catalog variant** means an individual `cards.variants[]` record. They must not be conflated.

Three separate defects that look like one.

**1. You cannot want a specific collector item.** Every write of `qty_wanted` targets
`variant_slug=''` and nowhere else — `writeQty` (via `setWanted`/`stepWanted`) and
`addWantedCopies` both hardcode it. "I need the Beta one" is unrepresentable. The owner's
model of the feature — wants are tied to their set and foil/non-foil finish — is the intended
product behaviour and the storage has never supported it.

**2. The UI asserted a printing anyway.** The list-row set pill returned `sets[0].name`, an
array index. A wishlisted *Albespine Pikemen* rendered **ALPHA** because Alpha sorts first in
its catalog entry, while the copies in hand were Beta. It was right exactly when it could not
be wrong (single-printing cards) and silently wrong on every reprint — which is how the owner
came to believe wants were tied to a stored collector item. *Already fixed:* the pill now shows a set only when
the card has exactly one printing. That is a stopgap, not the answer.

**3. `''` means two unrelated things.** It is both the not-yet-categorised bucket for
`qty_owned` **and** the only home of `qty_wanted`. This is why "discard the old `''` cards,
nothing is lost at alpha" is unsafe today: dropping those rows deletes the entire wishlist
(80 cards on the owner's device), because the two share a row.

Fixing (1) dissolves (3) as a consequence rather than as a goal. That ordering is the whole
proposal.

## 2 · The model

A want becomes a property of a **collector item**, exactly like ownership:

| row | means |
|---|---|
| `('ancient-dragon', '002')` qty_owned 1 | I own the Beta non-foil item |
| `('ancient-dragon', '002:f')` qty_owned 1 | I own the Beta foil item |
| `('ancient-dragon', '002')` qty_wanted 1 | I want the Beta non-foil item |
| `('ancient-dragon', '002:f')` qty_wanted 1 | I want the Beta foil item |
| `('ancient-dragon', UNCATEGORISED)` qty_owned 1 | I own a non-foil copy; its set is not recorded |
| `('ancient-dragon', UNCATEGORISED_FOIL)` qty_owned 1 | I own a foil copy; its set is not recorded |

No new table. `qty_wanted` moves onto the collector-item row it already sits beside, and the
ownership ledger keeps one shape.

**`''` is renamed to what it is.** "Unspecified" describes a category; **uncategorised**
describes a state that is expected to be *resolved*. After this change it has exactly one
meaning: **you own copies whose set has not been established yet.** Finish remains known:
`UNCATEGORISED` is non-foil and `UNCATEGORISED_FOIL` is foil. Those rows are the
contents of the **To Be Categorised** pile, and nothing else lives there.

### 2.1 · Wants are never uncategorised

New wants are never uncategorised: they identify both set and finish. Name-level entry points
must ask when either dimension is unknown. Migration is the sole exception because old hearts
stored neither dimension reliably. Those legacy wants are an explicitly supported
**transitional** state until triage resolves them; ordinary writers must never create another.

## 3 · Migration (v10 → v11)

Runs once at startup, in one transaction, before any Collection read.

**Owned rows.**

- `variant_slug='' AND qty_owned>0` → `UNCATEGORISED` (set unknown, non-foil).
- legacy `variant_slug='foil' AND qty_owned>0` → `UNCATEGORISED_FOIL` (set unknown, foil).

These are pure relabels. Finish is preserved; only the set remains unresolved.

**Wanted rows** — the only lossy-looking case, and it need not be:

Finish is settled for every legacy want by the §7.4 ruling: **non-foil**. Only the set can be
unresolved, so there are three cases, not four.

| case | action | rationale |
|---|---|---|
| card has exactly one set | move to that set's non-foil row | both dimensions known; strictly better data |
| card has several sets | park as `UNCATEGORISED` (non-foil) for triage | the set is unknowable from a name match; the user knows |
| card has no catalog match | keep as `UNCATEGORISED` (non-foil) | catalog gap, not a user decision |

Ambiguous legacy wants are the reason the To Be Categorised pile must temporarily hold
**wants as well as owned copies**. This does not make uncategorised wants a normal domain
state. The migration may create them; the triage flow removes them; new writers may not.

**Deliberately NOT migrated:** `deck_entries.variant_slug` and `card_list_entries.variant_slug`
keep `''`. There it legitimately means *"any printing will do"* — a deck does not care which
Lightning Bolt. Only `owned_cards` gains the new state. This is a real asymmetry and §7 asks
Codex whether it is the right call.

## 3.1 · Boot order — the migration cannot run where migrations run

**Verified, not assumed.** `openDatabase()` applies `MIGRATIONS` (`db.js`), and `App.jsx:134`
calls it *before* `seedCatalogIfNeeded()` at line 135. A step that must ask "does this card
belong to one set or several?" therefore cannot be a schema migration: at that moment the
catalog may be absent or stale.

So v11 is **two things with different homes**:

| step | where | may read the catalog? |
|---|---|---|
| v11 DDL (shape only) | `MIGRATIONS`, as today | no |
| ledger **canonicalisation** (data) | a new step after `seedCatalogIfNeeded()` | yes |

Boot becomes: apply DDL → seed catalog → canonicalise ledger (transactional, marker-backed) →
`initProfiles()` → expose Collection. Collection must not render before canonicalisation
succeeds, or a user could edit rows mid-conversion.

**Marker.** A row in `settings` (or a dedicated `migrations_data` table) records that
canonicalisation completed for a given version. It is written **inside the same transaction**
as the data change: a marker written afterwards can be lost to a crash and the pass would
re-run, and a marker written before can strand half-converted data as "done".

**Idempotence is still required**, marker or not. The transaction is the guarantee; the marker
is the optimisation. Every rule below is expressible as "convert rows still in the old shape",
so a re-run over converted data is a no-op.

## 3.2 · The SQLite `DEFAULT` problem

SQLite cannot `ALTER COLUMN ... SET DEFAULT`, and every migration in this repo to date is
`ADD COLUMN`. There is no precedent here for changing one.

Two options, and the proposal takes the second:

1. **Table rebuild** — create `owned_cards_new` with the new default, copy, drop, rename,
   recreate both indexes. Standard, but it rewrites the entire ledger and both indexes for a
   default value that only matters when a writer omits the column.
2. **Remove the reliance instead.** Every writer already supplies `variant_slug` explicitly -
   `writeQty`, `setFoil`, `writeSetRow`, `addCopies`, the bulk upsert, `profileTransfer`. The
   default is dead weight. Keep the column `NOT NULL`, leave the stored default alone, and add
   a test asserting no INSERT omits the column. No rebuild, no data movement.

Option 2 is smaller and reversible; option 1 buys tidiness the app cannot observe. If Codex
prefers the rebuild, it belongs in the DDL step (no catalog needed), not in canonicalisation.

## 3.3 · Merge and conservation rules

Canonicalisation moves rows onto keys that may already exist, so merging is the norm, not the
exception. For every `(profile_id, card_id)`:

| quantity | rule |
|---|---|
| `qty_owned` | **conserved** — the per-card total across all rows is identical before and after |
| `qty_wanted` | **conserved** per card |
| finish | preserved for owned copies; never inferred for wants (§7.4) |

On collision with an existing destination row: **sum the quantities, keep the earliest
`created_at`, take the latest `updated_at`, and concatenate distinct non-empty `notes`**
rather than letting either side win silently. Source rows are then deleted, and any row left
at `0/0` is deleted rather than kept as a tombstone.

Uniqueness on `(profile_id, card_id, variant_slug)` holds throughout because merging is what
happens *instead of* inserting a duplicate.

**Required tests** (Codex §5, plus two of mine):
rows carrying both owned and wanted quantities; an existing destination row; a card absent
from the catalog; several profiles in one database; transaction failure leaving v10 untouched;
idempotent re-run; no `0/0` rows remaining; and - mine - a card whose set membership *changed*
between catalog versions, and a profile whose rows are already fully v11 (the re-run case a
marker would normally skip).

## 4 · The sentinel value

At minimum:

```text
UNCATEGORISED      = 'uncategorised'    // set unknown, non-foil
UNCATEGORISED_FOIL = 'uncategorised:f'  // set unknown, foil
```

**Exactly two, now that §7.4 is ruled.** An unknown-finish state (`uncategorised:?`) was
considered and rejected: legacy wants migrate as non-foil, so finish is always known and only
the set is ever unresolved. That keeps one transitional exception rather than two, and keeps
triage to a single question.

- **Truthy**, which kills the `if (slug)` footgun the empty string has caused repeatedly.
- Cannot collide: categorised collector items are numeric set codes with an optional `:f`
  suffix.
- The DDL `DEFAULT ''` on `owned_cards` changes with it; the unique index
  `(profile_id, card_id, variant_slug)` is unaffected in shape.

`printings.js` already centralises this, so the change is one constant plus the migration.

## 5 · Consequences worth stating

**The To Be Categorised count becomes honest.** The earlier decision to make Unspecified a
quiet, non-nagging pseudo-set was forced by `''` being unable to distinguish *pending triage*
from *accepted unspecified*. Under this model every uncategorised row IS pending by
definition, so a count on Overview is truthful and the owner's original inbox is back on the
table. **Open question in §7:** whether it nags.

**Completion is unaffected.** It counts `regular` ownership per set, and uncategorised rows
have never counted. Migration does not move any number the user sees on a set plate.

**It does, however, unblock the milestone ladder.** The owner has since named what Collection
is for - *set* (every non-foil), *master set* (non-foil and foil), *playset* (per card) - all
game lingo, framed as achievements. The card+set+finish grain is exactly what a per-finish
completion track needs, and `setCompletion.js` already computes `foilUnique`, so the numerator
exists. That work is a **separate increment**; v11 only ensures it will not need a second
migration. See [`completion-milestones.md`](./completion-milestones.md), which also records an
inconsistency the framing exposed: playsets currently count foils while set completion does
not.

**Export/import.** `profileTransfer` carries `variant_slug` verbatim, so older backups contain
`''`. Import must run the same mapping as the migration, or a restore silently reintroduces
the old state. This is the part most likely to be forgotten.

**The wishlist gains a set-and-finish picker.** A sheet scoped to a set already knows the set
but must still identify foil/non-foil. A name-level surface must ask for every unknown
dimension. It must not create new uncategorised wants.

## 6 · Phasing

- **A — landed behavior, naming cleanup required.** Set pill stops guessing. Rename
  `solePrintingName` to `soleSetName` or `unambiguousSetName`: it establishes a set, not an
  exact catalog variant or a finish.
- **B.** `UNCATEGORISED` constant + predicates; rename in code only, value still `''`. Pure
  refactor, no migration, no behaviour change.
- **C–E, one releasable increment.** Seed the current catalog; run the transactional migration
  and import mapping; switch the write/read paths to set+finish wants; ship the To Be
  Categorised surface that resolves every transitional row. These may be implemented in
  checkpoints but may not ship separately: migrated wants need an honest editing and triage
  path in the same release.

B remains separable on purpose: a rename that cannot lose data should not be entangled with
the migration. The schema flip and its user-visible consumers are one release boundary.

## 7 · Decisions and remaining owner question

1. **Table asymmetry — Codex ruling:** keep `deck_entries` as "any collector item". Decide
   `card_list_entries` by list semantics rather than copying the Deck ruling. `owned_cards`
   alone gains the uncategorised collector-item states.
2. **Ambiguous old wants — Codex ruling:** preserve them for transitional triage; do not drop
   the owner's wishlist when a lossless path exists.
3. **Import mapping — Codex ruling:** use the existing profile-export `schemaVersion`; do not
   add another stamp or infer the source version from sentinel values.
4. **Historical finish semantics — OWNER RULED: legacy wants migrate as NON-FOIL.**
   `uncategorised:?` is dropped; there is no unknown-finish state.

   The justification is deliberately not "that is where the row was". It is that the product
   already defines the default copy: set completion counts non-foil only, on the owner's
   instruction that foils are not the collecting target. Reading old hearts as non-foil applies
   an existing product rule rather than inferring intent from a storage detail - which is the
   distinction Codex was right to insist on.

   Owner's standard, recorded because it should govern the rest of this work: *"we want
   fireproof assertions that are clearly inferred from design intent and user behaviour."*

   Consequence: §2.1 keeps exactly one transitional exception (ambiguous SET), not two.
   Triage asks which set, never which finish.

5. **Count — Codex ruling:** honest but quiet; show it on the To Be Categorised entry, not as a
   persistent global nag.
6. **Migration failure — Codex ruling:** fail closed and retry from untouched v10 data. Do not
   run v10 semantics under v11 code without an explicitly designed compatibility layer.

## 8 · Self-critique

- **The migration is the risk, and it is on live data.** A relabel is easy to reason about;
  the multi-printing want split is not. It reads the catalog to decide, so a catalog that
  disagrees with the one at write time changes the outcome. Belt: the decision is per-row and
  idempotent, so a re-run cannot compound.
- **I am extending a state, not removing one.** After this, `owned_cards.variant_slug` has
  categorised set/finish keys, uncategorised non-foil and uncategorised foil, plus a narrowly
  bounded migration-only legacy-want state if finish was historically unspecified. The win is
  that each value states what is known instead of making `''` mean two unrelated things.
- **The user-visible conversion is the risky release boundary.** Set-and-finish wants touch
  the card sheet, the wishlist, Codex entry points and the scanner. That is why migration,
  writers and triage form one releasable increment even if developed in checkpoints.
- **"Nothing is lost at alpha" is doing a lot of work.** It is true for uncategorised owned
  rows and false for wants, and that distinction only became visible after tracing the writes.
  I would not accept a similar claim about the other tables without tracing them too.
- **The honest inbox may be a trap.** Making the count truthful invites making it loud, and a
  user with 300 uncategorised imports does not want a permanent 300 on their home screen.
  Honest and quiet is a coherent position; I have not defended it here.
