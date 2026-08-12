# Proposal: restore reverts the app to the archive, instead of adding a second copy of it

## Status and classification

**Draft.** Risk: **High** - this makes restore a destructive user-data operation and reverses a
decision that was deliberate in Increment A.

Owner/approver: project owner (direction already given 2026-08-12: "Replace only").
Author: Claude Code. Reviewer: Codex / ChatGPT.

## Problem and success criteria

Restoring a whole-app backup currently **adds** the archive's profiles alongside whatever is on the
device. Restore your own backup and you get two of everything, with the imported copies renamed
`(imported)`.

That is not what a backup means. A backup is a snapshot; restoring one is conventionally a revert. The
owner hit this on a real device on 2026-08-12 and reported it as wrong, which it is.

A second defect falls out of the same behaviour: the imported profile takes the `is_default` flag,
`deleteProfile()` refuses to delete the default, and **nothing in the app can move that flag** - so
every restore leaves a profile the user can never remove. Under replace semantics this disappears
rather than needing its own fix.

**Success criteria**

1. After a restore, the app's user data is **exactly** the archive's: same profiles, same names, same
   rows, same default, same active profile. No `(imported)` suffixes, no duplicates, no survivors from
   before the restore.
2. Restoring the same archive twice leaves the same state as restoring it once (idempotent).
3. A restore that fails at any point leaves the device **exactly** as it was - not partially reverted.
4. A mistaken restore is **recoverable without a file the user had to think about in advance**.
5. Restoring an older archive still works: its `schemaVersion` is migrated forward on arrival.

**Non-goals**

- Merging two devices' data. That capability disappears with this change and is not being replaced;
  say so plainly rather than pretending replace covers it.
- Selective/per-profile restore. Explicitly rejected by the owner already ("Backup the whole app, then
  if you don't want a profile, just delete it").
- Any change to the backup *format*. `bundleFormat` 2 stays as it is.
- Cloud or scheduled backups.

## Evidence and current architecture

| Concern | Location |
|---|---|
| Restore orchestration | `src/store/backupService.js` - `restoreAll()` |
| Per-profile planning (pure) | `src/store/profileTransfer.js` - `planProfileUnit()`, `uniqueProfileName()` |
| Name dedupe that exists only because restore is additive | `uniqueProfileName()` |
| Default adoption, in-transaction | `backupService.js`, `UPDATE profiles SET is_default=...` |
| Active-profile reconciliation | `backupService.js` -> `switchProfile()` (fixed 2026-08-12) |
| Deletion, and the default shield | `profileRepository.js` - `deleteProfile()` |
| Confirm copy that promises additive | `src/App.jsx` - `RestorePreviewModal` |
| Round-trip coverage | `src/store/backupService.test.mjs` (19 tests) |

Current shape: everything is planned into one `statements[]` array and committed by a single
`tx(statements)`. **That single-transaction property is the most valuable thing in the existing design
and this proposal must not lose it.**

The additive choice was not an oversight. From the Increment A commit: *"NOTHING IS DELETED. No
profile-deletion path exists."* It was chosen because Compendium is offline-first with no cloud copy,
so a destructive restore can annihilate data that exists nowhere else.

## Assumptions and confidence

1. **The owner accepts losing merge-across-devices.** Confidence: high - stated directly. Validation:
   named as a non-goal here for the reviewer to challenge.
2. **A pre-restore snapshot can be written to `Directory.Data` without any user interaction.**
   Confidence: high - `Filesystem.writeFile` already does exactly this in `saveTextFile()` before the
   share sheet; only the share step needs a human. Validation: exercised on device in Increment 2.
3. **The owner's real archive (~1,476 statements, 0.38 MiB) is representative of the size a
   delete-then-insert transaction must carry.** Confidence: medium - measured once, on one profile.
   Validation: re-measure with the pre-restore snapshot included, since replace doubles the work.
4. **`DELETE FROM profiles` cascades all profile-owned rows.** Confidence: high - `deleteProfile()`
   already relies on `ON DELETE CASCADE`. Validation: assert row counts across every profile-owned
   table after a replace, not just `profiles`.
5. **App-global state outside profiles is small and enumerable** (`activeProfileId`,
   `changelogSeenBuild`, `dash_seeded:*`). Confidence: medium - this is the likeliest place to miss
   something. Validation: enumerate `catalog_meta` keys and Preferences keys in a test, and fail on an
   unrecognised one.

## Affected systems and invariants

**Invariants engaged (ENGINEERING_CONSTITUTION.md §3):**

- **§3.5 Transactional user-data operations.** The one that matters most. Delete-then-insert must be a
  single transaction; a failure must leave the device untouched, never with neither its own data nor
  the archive's. Held by keeping the existing single-`tx()` shape and adding deletes to the *front* of
  the same statement list.
- **§3.2 Profile isolation.** Restore ends with every pre-existing `profile_id` gone. The active id
  must be reconciled through `switchProfile()` - already fixed - and must never point at a deleted
  profile, even transiently.
- **§3.3 Durable offline-first writes.** The pre-restore snapshot is only a safety net if it is
  durable *before* the destructive transaction begins. It must be written and flushed first, and a
  failure to write it must ABORT the restore.
- **§3.4 Forward-only schema evolution.** An older archive restores into a newer schema; migrations
  run forward as today. Restoring a **newer** archive into an older app must be refused, as now.
- **§3.8 Cross-runtime integrity.** Both backends must be exercised; a passing `node --test` is not
  proof of the native path.

**Also affected:** `RestorePreviewModal` copy and confirm affordance; `uniqueProfileName()` becomes
dead for this path; `WORK_IN_FLIGHT.md`; `COMPENDIUM_DATA_MODEL.md` (restore semantics);
`backup-and-restore.md` (superseded in part).

## Options considered

| Option | Verdict |
|---|---|
| **A. Status quo (additive)** | Rejected by the owner. Safe, but surprising, and it leaves an undeletable profile after every restore. |
| **B. Replace, no safety net** | **Rejected.** This is a data-loss feature. Restoring a three-month-old archive silently destroys three months of work that exists nowhere else. |
| **C. Replace + automatic pre-restore snapshot** | **PROPOSED.** Matches the expected meaning of restore; the snapshot makes a mistaken revert undoable without the user having planned ahead. |
| **D. Offer replace *or* merge at confirm time** | Rejected for now. More capable, but it doubles the paths through the most dangerous operation in the app, and the merge path drags `uniqueProfileName` and the default-flag problem along with it. Owner chose "Replace only". |
| **E. Replace, with a soft-delete/trash period** | Rejected. Needs schema support and a reaper; option C achieves recoverability with a file and no schema change. |

## Proposed design

### Order of operations

1. **Read and validate the archive** (unchanged): digest, bounds, schema version, shape.
2. **Write the pre-restore snapshot.** `backupAll()` into `Directory.Data` as
   `pre-restore-<ISO8601>.json`. **If this fails, the restore does not start** - report it plainly and
   stop. This is the point where refusing is cheap.
3. **Plan one statement list**, deletes first: `DELETE FROM profiles;` (cascades all profile-owned
   rows) plus the enumerated app-global keys, then every insert exactly as planned today - but with
   `uniqueProfileName()` **not applied**, because there is nothing left to collide with.
4. **Commit once.** `tx(statements)` as today.
5. **Reconcile after the commit** through `switchProfile()`, as fixed on 2026-08-12, with post-commit
   failures reported as caveats rather than failures.

### Recovery surface

Settings gains **"Undo last restore"**, visible only while a `pre-restore-*.json` exists, which
restores that snapshot through the same path. Deliberately not automatic and not silent: a rollback is
as destructive as the restore it reverses.

Retention: keep the most recent snapshot only. It is a safety net for the operation just performed,
not a backup history - and unbounded copies of the whole database in app storage is its own defect.

### Confirm copy

Today it reads *"These profiles are added alongside what is already on this device. Nothing is deleted
or overwritten."* That becomes the opposite, and must state the consequence in the user's terms: what
is on the device now will be **replaced**, how many profiles will be removed, and that a snapshot is
taken first. The confirm button says **Replace**, not Restore.

## Implementation plan

| # | Increment | Gate |
|---|---|---|
| 0 | Pre-restore snapshot to `Directory.Data`, behind no UI yet | unit: written before any write; a snapshot failure aborts and changes nothing |
| 1 | `planReplace()` - deletes + inserts in one list, no name dedupe | unit: exact archive equality after restore; idempotent on second run |
| 2 | Atomicity | unit: injected failure at first/middle/last statement leaves the DB byte-identical |
| 3 | App-global enumeration | unit: unrecognised `catalog_meta`/Preferences key FAILS the test rather than being silently dropped |
| 4 | UI: confirm copy, Replace button, "Undo last restore" | manual, both runtimes |
| 5 | Device pass | real archive on a real device; counts equal; undo returns to the prior state |
| 6 | Docs | `COMPENDIUM_DATA_MODEL.md`, `backup-and-restore.md` marked superseded in part, `check:docs` |

## Data migration and compatibility

No schema change. `bundleFormat` 2 is unchanged, so **existing archives restore under the new
semantics** - the file did not change, only what restoring it does. Legacy per-profile exports
(`bundleFormat` absent/1) currently route to `importProfile()`, which is additive by nature: they must
either be refused under replace semantics or keep additive behaviour with copy that says so. **Open
question for the reviewer** - the honest options are refuse, or keep-and-label; silently treating a
single-profile file as a whole-app snapshot would be the worst of the three.

## Rollback and recovery

- **Code:** revert the branch; the format is unchanged, so archives written under it stay readable.
- **Data:** the pre-restore snapshot, plus "Undo last restore".
- **Partial failure:** impossible by construction - one transaction, so it commits or it does not.
- **Point of no return:** the `tx()` commit. Everything before it is abortable; everything after is
  reconciliation whose failure is a caveat, not a failure.

## Verification plan

- **Automated:** exact-equality round trip (restore == archive, field by field, not just counts);
  idempotency; atomicity at three injection points; app-global enumeration; active id and default
  correct immediately without relaunch; snapshot-write failure aborts.
- **Native:** device pass with the real archive on both backends - `node --test` uses sql.js and is
  not proof of the native path (§3.8).
- **Manual:** restore an OLDER archive and confirm the newer data is genuinely gone (the destructive
  case, verified deliberately rather than avoided); then "Undo last restore" and confirm it returns.
- **Regression:** the existing 19 backup/restore tests, updated where they assert additive behaviour -
  each such change reviewed individually, because a test that changes to match new behaviour is
  exactly where a real regression hides.

## Security, privacy, performance, and operations

The snapshot is unencrypted user data in app-private storage - the same posture as the archives the
app already writes, and it never leaves the device. It contains opponent names (third-party data), so
it must not be logged, shared, or included in diagnostics. Size: one extra whole-database write per
restore (~0.4 MiB today). Deleting the previous snapshot before writing the new one bounds it.

## Risks and unanswered questions

| Risk | Impact | Mitigation |
|---|---|---|
| Replace destroys data the user did not intend to lose | **Severe** | Pre-restore snapshot; explicit Replace copy naming what goes; undo affordance |
| An app-global key is missed and silently lost | Medium | Enumerate and fail on unknown keys, rather than allow-listing quietly |
| The snapshot cannot be written (storage full) | Medium | Abort before the destructive step - never proceed unprotected |
| Larger transaction (deletes + inserts) hits a native limit | Low | Re-measure at Increment 2; the current plan is ~1,476 statements and cascades add few |
| Legacy single-profile exports become ambiguous | Medium | Open question above; must be decided before Increment 4 |

## Self-Critique

**The strongest case that this is wrong:** additive restore cannot destroy data, and this replaces a
property with a procedure. "The snapshot protects you" is a claim about a file being written correctly
at the exact moment storage is under pressure - which is precisely when it will not be. Option A never
needs that argument. If the owner's real complaint is the duplicates and the undeletable profile, a
set-default control plus better dedupe copy fixes both **without making any operation destructive**,
and that is a materially smaller change.

**Hidden coupling:** `uniqueProfileName()` exists only because restore is additive, and legacy import
shares it. Removing it from one path leaves it live in another, so the dedupe rules must stay correct
in a path this proposal is not otherwise touching.

**The failure most likely to escape tests:** an app-global or `catalog_meta` key that no test
enumerates - dashboard seeding, appearance, telemetry consent. Under additive restore a missed key was
invisible because the old profile still held it. Under replace it is **deleted and not restored**, and
the user notices as "my settings reset" long after the restore. That is why Increment 3 fails on
unrecognised keys instead of allow-listing.

**Second most likely:** tests updated to match the new behaviour. Nineteen tests assert additive
semantics today; changing them is necessary and is also the ideal hiding place for a real regression.

**Evidence that would change the decision:** if the pre-restore snapshot cannot be made reliable on
device under low storage, option C loses its safety argument and the honest answer is to stay
additive and fix the symptoms instead.

## Approval record

| Date | Who | Disposition |
|---|---|---|
| 2026-08-12 | Owner | Direction given: replace-only, snapshot + one-transaction + confirm-copy agreed. Proposal not yet reviewed. |
| | Codex | Pending |
| | Owner | Pending final approval |
