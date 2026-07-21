# Codex review — schema v11 set-and-finish wants

**Disposition:** Changes required before implementation. This report supersedes the earlier
Codex wording that treated catalog `variants[]` as Collection ownership identities.

## Correction and locked domain model

Codex's earlier "exact physical printing" criticism was wrong and is withdrawn.

For Collection, one collector item is exactly:

```text
card_id + set + finish
```

A set is a release. Finish is foil or non-foil. Alpha non-foil, Alpha foil, Beta
non-foil and Beta foil are distinct collector items. Multiple catalog art/product variants
inside one set do not create additional Collection ownership identities.

The landed pill behavior is correct: when a name belongs to several sets, say nothing rather
than selecting `sets[0]`. The helper should be named `soleSetName` or `unambiguousSetName`, not
`solePrintingName`, because it establishes a set and nothing more.

## Required proposal corrections

### 1. Encode unknown set without losing finish

The canonical keys should distinguish at least:

```text
001                 Alpha non-foil
001:f               Alpha foil
002                 Beta non-foil
002:f               Beta foil
uncategorised       set unknown, non-foil
uncategorised:f     set unknown, foil
```

The old generic wishlist heart did not store set and may not have stored finish intent either.
The owner must rule whether it historically meant non-foil. If finish was unspecified, use an
explicit migration-only representation such as `uncategorised:?`; do not infer non-foil from
the fact that the implementation stored the heart on the old `''` row.

### 2. Make ambiguous wants a transitional state, not a contradiction

New wants always identify set and finish. Only migration/import may create an unresolved
legacy want. Triage resolves its wanted quantity independently from any owned quantity on the
same card. Ordinary writers must never create another unresolved want.

Parking ambiguous old wants is correct. Dropping the owner's wishlist is not justified when a
lossless transition exists.

### 3. Run catalog-dependent canonicalisation after catalog seed

`openDatabase()` currently runs schema migrations before `seedCatalogIfNeeded()`. A migration
that decides whether a card belongs to one or several sets cannot use the pre-seed database
catalog as authority.

The required boot order is:

1. apply schema-compatible v11 DDL;
2. seed the current bundled catalog;
3. run a transactional, marker-backed ledger canonicalisation;
4. initialize profiles and expose Collection only after success.

Changing the SQLite default from `''` also needs an explicit table-rebuild plan or a decision
that every writer supplies the key and the default is removed. SQLite does not support a
simple `ALTER COLUMN DEFAULT`.

### 4. Ship the migration, new writers and triage as one release boundary

The pure constant/predicate refactor may land separately. The migration cannot ship ahead of
the set+finish heart behavior and To Be Categorised surface: migrated wants would otherwise
exist without an honest editing path, and old heart writers would continue targeting the
wrong bucket.

### 5. Specify collision and conservation rules

The migration must define how it merges when a destination row already exists and preserve:

- total `qty_owned` per profile/card;
- total `qty_wanted` per profile/card;
- foil/non-foil finish for owned copies;
- notes and relevant timestamps;
- the `(profile_id, card_id, variant_slug)` uniqueness invariant.

Tests must cover rows containing both owned and wanted quantities, existing destination rows,
unknown cards, multiple profiles, transaction failure, and idempotent retry. No `0/0` rows may
remain.

### 6. Use the existing export version

Profile exports already carry `schemaVersion`. Import should map v10 explicitly, accept v11,
reject unsupported future versions, and validate before creating the destination profile. Do
not infer the source format from an empty or truthy `variant_slug`.

## Rulings on the six proposal questions

1. **Table asymmetry:** correct for `deck_entries`; a deck legitimately accepts any collector
   item. Decide `card_list_entries` by list semantics rather than copying the Deck ruling.
2. **Old ambiguous wants:** preserve them for triage; do not delete them.
3. **Import:** use the existing `schemaVersion`; no second version stamp.
4. **Name-level wants:** ask for all unknown dimensions. Auto-select the set only when exactly
   one set exists; finish must still be chosen or have an explicit product default.
5. **Count:** honest but quiet. Show it on the To Be Categorised entry, not as a persistent
   global nag.
6. **Migration failure:** fail closed and retry from the untouched v10 state. Do not run v10
   semantics under v11 code without a deliberately designed compatibility layer.

## Final reviewer position

The durable direction is sound once expressed at the correct grain: **card → set → finish**.
There is no requirement for exact catalog-variant ownership in v11. Approval remains blocked
only on historical finish semantics, post-catalog migration ordering, merge/conservation
rules, and an atomic migration+UI+triage release plan.
