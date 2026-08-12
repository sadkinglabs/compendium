# Proposal: Restore replaces, Import adds, and Primary is a role

**Revision 2** (2026-08-12). Revision 1 is superseded: it was dispositioned **Changes required** with two
Blockers, and the product architecture below replaces its framing.

## Status and classification

**Draft, revision 2.** Risk: **High** - restore becomes a destructive user-data operation on an
offline-first app with no cloud copy.

Owner/approver: project owner (replace-only chosen 2026-08-12). Author: Claude Code.
Reviewer: Codex / ChatGPT - Rev 1 dispositioned *Changes required*; the recommended contract in that
review is adopted here largely intact.

### What revision 1 got wrong, named rather than quietly patched

1. **"Partial failure is impossible by construction - one transaction."** False, and wrong in a way I
   should have caught: the snapshot **file**, the SQLite **transaction**, the in-memory **`activeId`**
   and **Preferences** are four separate authorities. A database transaction protects the data
   replacement; it says nothing about the boundaries between those four. This is the *same* error as
   the active-profile split fixed days earlier on `capacitor-8` - taking one authority's guarantee for
   the whole system's. Twice is a pattern, so §"Crash-safe protocol" below is written as a state
   machine rather than a sequence of steps.
2. **Snapshot and replacement were two operations.** `backupAll()` releases `db.snapshot()` after its
   reads (`backupService.js:57`) and seals/writes afterwards, so a write could commit into the gap and
   be destroyed by a replacement whose recovery snapshot never contained it.
3. **"Exact equality, field by field."** Unachievable and wrong to promise: `planProfileUnit()`
   re-keys every id, regenerates timestamps, sanitises URLs and recomputes deck results.
4. **Legacy files were left as an open question.** They are a decision, and it is made below.

---

## Problem and success criteria

Restoring a whole-app backup currently **adds** the archive's profiles alongside what is on the
device. Restore your own backup and you get two of everything. That is not what a backup means.

A second defect falls out of the same design: the imported profile takes the `is_default` flag,
`deleteProfile()` refuses to delete the default, and nothing in the app can move that flag - so every
restore leaves a profile the user can never remove.

### The contract this ships

| Operation | Meaning | Existing data |
|---|---|---|
| **Back up all data** | Portable snapshot of the entire app | Read-only |
| **Restore backup** | Return Compendium to that snapshot | **Replaced** |
| **Import profile** | Add one profile from a single-profile file | Preserved |

This is the industry-standard split (Anki replaces on collection import, adds on deck import; Firefox
*Restore* replaces bookmarks, *Import* merges). **No merge option during restore** - it drags
duplicate handling, name collisions, default-profile transfer and identity rules into the single most
dangerous workflow in the app.

### Primary is a role, not an immortal record

The undeletable-profile trap is a *default-profile* bug, not a restore bug, and it is fixed here
independently:

- Exactly one profile is **Primary**.
- **Any profile can be made Primary** - a control the app does not currently have at all.
- The sole remaining profile cannot be deleted.
- A Primary profile *can* be deleted once another is made Primary, offered in the same confirmation.
- The starter `Sorcerer` profile is created only for a genuinely empty first launch.
- A whole-app restore deletes the current starter along with everything else.
- The archive's Primary becomes Primary; the archive's active profile becomes active. **They may
  differ**, and the model must carry both.
- A single-profile **Import** creates an ordinary, non-Primary profile and opens it without stealing
  the role.

### Success criteria

1. After a restore, user-visible state is **canonically equivalent** to the archive: same profiles by
   name and content, same decks, entries, matches, lists, notes, the same Primary and the same active
   profile. Defined precisely in §"Idempotency and equivalence" - **not** byte-identical rows.
2. Restoring the same archive twice yields canonically equivalent state both times.
3. **No committed user write is lost between the recovery snapshot and the replacement.** No write may
   land in that window, and none may resume against a deleted profile id.
4. A mistaken restore is recoverable **without the user having planned ahead**, and the recovery point
   survives process death, a second restore attempt, and a failed restore.
5. An interrupted restore leaves the app in a state that startup can deterministically finish or
   abandon - never half-applied, never with an Undo that describes the wrong operation.
6. Restoring an older archive migrates it forward; a newer-schema archive is refused, as today.

### Non-goals

- Merging two devices' data. That capability is **withdrawn** from restore and lives only in Import.
- Selective/per-profile restore from a whole-app archive.
- Preserving physical UUIDs across a restore (see §"Idempotency and equivalence").
- Cloud or scheduled backups.

---

## Evidence and current architecture

| Concern | Location |
|---|---|
| Restore orchestration | `backupService.js` - `restoreAll()` |
| Snapshot released before sealing | `backupService.js:57`, gate released at `db.js:102` |
| Per-profile planning, and the re-keying | `profileTransfer.js` - `planProfileUnit()` |
| Name dedupe that exists only because restore is additive | `uniqueProfileName()` |
| Default flag, and the deletion shield | `profileRepository.js` - `deleteProfile()` |
| No set-default control anywhere | `App.jsx` - `ProfileSheet` reads `is_default` only to hide Delete |
| Native file write | `native.js:64` - `Directory.Cache` + Share; **no `Directory.Data`, no browser store** |
| Confirm copy promising the opposite | `App.jsx` - `RestorePreviewModal` |

**A documented contradiction this proposal must settle:** `COMPENDIUM_DATA_MODEL.md:68` states "App-global
Preferences keys are not user data and are **never exported**", while `backupService.js:71` puts
`changelogSeenBuild` in the archive's `appGlobal`. The document is right and the code is wrong - see the
disposition table.

---

## Assumptions and confidence

1. **A durable, app-private snapshot store exists on both runtimes.** Native: `Directory.Data`. Web:
   IndexedDB. Confidence: high native (the Filesystem plugin already writes files), **medium web** -
   IndexedDB is durable but evictable under storage pressure. Validation: §"Snapshot store" defines one
   interface with the same semantics on both, and the web implementation requests persistent storage
   and reports honestly when it is refused.
2. **An exclusive restore session can hold the write gate across file + database work.** Confidence:
   high - `db.js` already has a write gate with exactly this shape for `snapshot()`. Validation: the
   gate is extended, not reinvented.
3. **Refusing writes during a restore is acceptable.** Confidence: high - the confirm modal blocks the
   UI, and a restore is seconds. Validation: refusal is explicit and typed, not a silent queue.
4. **`DELETE FROM profiles` cascades all profile-owned rows.** Confidence: high. Validation: assert
   row counts across **every** profile-owned table, not just `profiles`.
5. **The archive's ~1,476-statement scale is representative.** Confidence: medium - measured once.
   Replace roughly doubles the work (snapshot + deletes + inserts). Validation: re-measure.

---

## Affected systems and invariants

**§3.5 Transactional user-data operations** - the deletes and inserts stay in one `tx()`.
**§3.2 Profile isolation** - the active id must never point at a deleted profile, transiently or after
a crash; queued writes must never resume against deleted identities.
**§3.3 Durable offline-first writes** - the recovery snapshot is only a safety net if it is durable and
**verified** before the destructive transaction begins.
**§3.4 Forward-only schema evolution** - older archives migrate forward; newer are refused.
**§3.8 Cross-runtime integrity** - the snapshot store must have equivalent guarantees on web and
native, or the destructive operation is not equally safe on both.

---

## Options considered

| Option | Verdict |
|---|---|
| A. Status quo (additive restore) | Rejected by the owner. Also leaves the undeletable-profile trap. |
| B. Replace, no recovery | **Rejected.** A data-loss feature. |
| C. Replace + best-effort snapshot file (**Rev 1**) | **Rejected by review.** The recovery guarantee was a file operation, not a protocol; it could be defeated by a crash, a second restore, or a write landing between capture and replacement. |
| D. **Replace + verified, crash-safe recovery point; Import stays additive; Primary becomes a role** | **PROPOSED.** |
| E. Additive + set-default control only | The self-critique's alternative. Materially smaller and safer, and it fixes the undeletable profile - but it does not deliver the owner's chosen meaning of *restore*. Recorded, not chosen. |

---

## Proposed design

### One exclusive restore session

Everything from capture to reconciliation runs inside a single boundary that owns the write gate:

```
validate archive (no writes)
  ↓
ENTER RESTORE SESSION ─ drain in-flight writes, then REFUSE new profile-scoped writes
  ↓
capture current state          (inside the same gate hold as the replacement)
  ↓
write candidate snapshot       → recovery/candidate-<id>.json
  ↓
read back + verify digest      (a snapshot that cannot be verified ABORTS the restore)
  ↓
ONE DB TRANSACTION: delete profile-owned state → insert archive state → set Primary
  ↓
reconcile Primary + active profile through profileRepository
  ↓
PROMOTE candidate → recovery/last.json   (the previous one is replaced only HERE)
  ↓
EXIT SESSION ─ resume writes
```

Pending writes are **drained** before capture and **refused** thereafter, with a typed
`RestoreInProgressError`. They are not queued: a queued write carrying a now-deleted `profile_id` is
precisely the isolation break §3.2 forbids.

### Crash-safe protocol

A durable **restore marker** records the phase. It is the only thing that makes recovery a property
rather than a hope.

| Phase | Meaning | Startup action if found |
|---|---|---|
| `capturing` | Session opened, nothing written | Delete candidate; nothing happened |
| `candidate-written` | Candidate exists, not yet verified | Delete candidate; DB untouched |
| `candidate-verified` | Candidate durable and digest-checked | Delete candidate; DB untouched |
| `committed` | **DB transaction committed** | **Finish**: reconcile Primary/active, promote candidate, clear marker |
| `promoted` | Recovery point published | Clear marker; nothing to do |

Two properties fall out, and both were broken in Rev 1:

- **A failed attempt never discards the last good recovery point.** `recovery/last.json` is replaced
  only at `promoted`; a candidate that never commits is deleted.
- **A crash after commit is finishable.** The marker carries the intended active/Primary ids, so
  startup completes the reconciliation instead of booting into the pre-restore profile.

### Snapshot store - one interface, two backings

```
listRecoveryPoints() -> [{id, createdAt, profiles, rows, digest}]
writeCandidate(text) -> id        // temp name, never the published name
verifyCandidate(id)  -> boolean   // read back, recompute digest
promote(id)                       // atomic rename/replace of the published point
readRecoveryPoint(id) -> text
deleteRecoveryPoint(id)
```

**Native:** `Directory.Data`, temp file then rename.
**Web:** IndexedDB object store, request `navigator.storage.persist()`, and **surface refusal** - if
the browser will not persist, the confirm screen says the recovery point may be evicted rather than
implying a guarantee that does not exist.

Retention: **one** published recovery point. Unbounded copies of the whole database in app storage is
its own defect.

### Persisted-state disposition

Deletion targets state **by ownership**, not by the vague category "app-global".

| State | Owner | Disposition on restore |
|---|---|---|
| `profiles` and all profile-owned tables | Profile | **Replace** - deleted, re-created from archive |
| `dash_seeded:<pid>` in `catalog_meta` | Profile (keyed by pid) | **Re-key** - delete keys for deleted pids; write keys for restored pids |
| `catalog_meta.version` and catalog rows | Device/catalog | **Preserve** - never touched; the catalog is shared, read-only (§3.1) |
| `activeProfileId` (Preferences) | Profile authority | **Reconcile** - set through `switchProfile()`, never written directly |
| Primary/`is_default` | Profile role | **Reconcile** - archive's Primary, inside the transaction |
| `changelogSeenBuild` (Preferences) | **Device install** | **Exclude** - stop exporting and stop restoring it. `COMPENDIUM_DATA_MODEL.md:68` already says install-global keys are never exported; the code contradicted the document. Losing it costs one redundant modal |
| Native telemetry consent | Device | **Exclude** - deliberately device-owned and non-exportable |

**Unknown keys fail the build, not the user.** A test enumerates every `catalog_meta` key prefix and
every Preferences key and fails on one this table does not classify. An allow-list only protects
against what its author already thought of; this fails closed on the thing nobody thought of, which is
the actual risk.

### Idempotency and equivalence

`planProfileUnit()` re-keys ids, regenerates timestamps, sanitises URLs, drops retired dashboard
blocks and recomputes deck results. **Byte equality is therefore impossible without redesigning the
format and the planner, and that redesign buys the user nothing.**

Success is **canonical logical equivalence**: profiles matched by name; per profile the same decks,
entries, collection items, matches, log entries, lists and notes by content; relationships intact;
same Primary; same active profile. Explicitly **excluded** from comparison: physical UUIDs, `created_at`
/ `updated_at` regenerated by the planner, and fields the planner normalises by contract. The
comparison lives in a test helper so what is ignored is enumerated in one reviewable place, not
scattered through assertions.

### Archive compatibility

| File | Route | Behaviour |
|---|---|---|
| `bundleFormat: 2` (whole-app) | **Restore backup** | Replaces everything |
| absent / `bundleFormat: 1` (single profile) | **Import profile** | Additive, non-Primary, opened after import |

**A single-profile export is never authority to delete the whole app.** This is Codex's recommendation
and it is right: it keeps legacy files working, keeps their existing meaning, and does not contradict
replace-only for whole-app backups.

Whole-app archives must contain at least one profile and exactly one Primary. Older valid archives
lacking Primary use a deterministic migration: archived active profile, else the first profile.

### The restore experience

1. Select a whole-app backup.
2. **Validate completely, writing nothing.**
3. Show: backup date and app version; profiles/decks/collection/matches **being restored**; the
   **corresponding counts currently on the device**; and "Everything currently in Compendium will be
   replaced."
4. Create and verify the recovery point automatically.
5. Destructive button: **Replace all data**. No typed confirmation phrase - clear consequence copy, a
   destructive button and a verified recovery point are sufficient.
6. Replace atomically.
7. Result: "Backup restored · **Return to previous state**", and that action persists in Settings
   across restarts.

Today's copy promises the opposite ("added alongside... Nothing is deleted or overwritten") and is
rewritten wholesale.

---

## Implementation plan

| # | Increment | Gate |
|---|---|---|
| 0 | **Primary as a role**: set-Primary control, delete-Primary-after-reassign, starter only on empty first launch | Unit + device. Independently useful; fixes the undeletable profile on its own |
| 1 | Snapshot store interface + both backings, with listing/verify/promote/delete | Unit both runtimes; web persistence refusal surfaced |
| 2 | Restore session: drain, refuse, single gate hold across capture + replacement | Unit: a write attempted mid-session is refused, not queued; no write lands in the window |
| 3 | Restore marker + startup reconciliation | Unit: kill at each of the five phases; assert the table's startup action, and that a failed attempt keeps the previous recovery point |
| 4 | `planReplace()` - deletes + inserts in one list, no name dedupe | Canonical-equivalence test; idempotent on second run |
| 5 | Persisted-state disposition + the unknown-key test | Unit: an unclassified key fails the suite |
| 6 | Legacy routing: single-profile → **Import profile** | Unit + UI copy |
| 7 | UI: validate screen with both-sides counts, Replace button, persistent Undo | Manual, both runtimes, **plus accessibility below** |
| 8 | Device pass | Real archive; undo returns to prior state; kill-and-restart mid-restore |
| 9 | Docs | Per the impact table |

---

## Data migration and compatibility

No schema change for the restore mechanics. **One schema question is deliberately raised, not assumed:**
Primary is currently `profiles.is_default`, which is adequate for a transferable role, so the intent is
**no migration** - but if review prefers an explicit `primary_profile_id` singleton, that is a schema
change and belongs in Increment 0.

`bundleFormat` 2 is unchanged, so **existing archives restore under the new semantics**. Archives
written after this change omit `changelogSeenBuild`; readers ignore it when present, so old and new
archives are mutually readable.

---

## Rollback and recovery

- **Code:** revert; the format is unchanged and archives stay readable.
- **Data:** the published recovery point, reachable from Settings, surviving restarts.
- **Partial failure:** governed by the marker state machine, not by an assertion that it cannot happen.
- **Point of no return:** the `tx()` commit - **and past it the operation is finishable, not abandoned**,
  which is the property Rev 1 lacked.

---

## Verification plan

- **Automated:** canonical equivalence; idempotency; atomicity at three injection points; a write
  attempted mid-session is refused; kill at each marker phase; a failed restore preserves the previous
  recovery point; an unclassified persisted key fails; snapshot verify rejects a corrupted candidate.
- **Cross-runtime:** the snapshot store suite runs against both backings (§3.8). `node --test` uses
  sql.js and is not proof of native.
- **Manual:** restore an **older** archive and confirm newer data is genuinely gone - the destructive
  case verified deliberately rather than avoided - then Undo and confirm return. Kill the app mid-restore
  and confirm startup resolves it.
- **Accessibility (destructive flow):** the confirm screen announces what will be **removed**, not only
  what will be added; focus lands on the consequence text, not the destructive button; Back/predictive
  back cancels without writing; after restore, focus reaches the Undo affordance and it is announced;
  Undo is reachable by screen reader from Settings afterwards.
- **Regression:** the 19 existing backup/restore tests, each change reviewed individually - a test
  updated to match new behaviour is the ideal hiding place for a real regression.

---

## Documentation impact

| Document | Impact |
|---|---|
| `COMPENDIUM_FEATURE_MATRIX.md` | **Changes** - Restore/Import become distinct capabilities; Primary-as-role is new |
| `COMPENDIUM_DATA_MODEL.md` | **Changes** - persisted-state ownership table; resolves the `changelogSeenBuild` contradiction; Primary/active as separate authorities |
| `COMPENDIUM_ARCHITECTURE.md` | **Changes** - the snapshot store is a new owned boundary spanning both runtimes |
| `BUILD.md` | **Changes** - how to exercise recovery and interrupted restores on device |
| `DESIGN_SYSTEM.md` | **Changes** - destructive-confirmation pattern and its accessibility contract |
| `backup-and-restore.md` | **Superseded in part** - marked, not rewritten |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Unchanged** - no process change |

---

## Security, privacy, performance, and operations

Recovery points are unencrypted user data in app-private storage - the same posture as the archives the
app already writes, and they never leave the device. They contain opponent names (third-party data), so
they must not be logged, shared, or included in diagnostics. **On web, IndexedDB is origin-scoped and
not app-private in the same sense** - stated plainly rather than glossed. Cost: one extra whole-database
write per restore (~0.4 MiB today), bounded by single-point retention.

---

## Risks and unanswered questions

| Risk | Impact | Mitigation |
|---|---|---|
| Replace destroys data the user did not intend to lose | **Severe** | Verified recovery point; both-sides counts before confirming; persistent Undo |
| Browser evicts the recovery point | High (web) | Request persistence; **surface refusal in the confirm copy** rather than implying a guarantee |
| A persisted key is missed and silently deleted | Medium | Unknown-key test fails closed |
| Crash between commit and reconciliation | Medium | Marker + startup completion |
| Larger transaction hits a native limit | Low | Re-measure at Increment 4 |
| Primary-as-role interacts with existing deletion rules | Medium | Increment 0 lands first, independently tested |

**Open for the reviewer:** whether Primary stays `is_default` or becomes an explicit
`primary_profile_id` (schema change). I lean to keeping `is_default`; I do not feel strongly.

---

## Self-Critique

**The strongest case against this proposal is now narrower than in Rev 1, and worth stating exactly.**
Rev 1's safety argument genuinely lost to the self-critique: a best-effort file write is not a recovery
guarantee. Rev 2 answers that by making recovery a protocol - but the honest cost is that this is no
longer a small change. It is a snapshot store on two runtimes, a session boundary, a durable state
machine, and a profile-role redesign. **Option E (additive + set-default) still fixes the undeletable
profile and still cannot destroy anything, at a fraction of the size.** If the owner's real complaint
had been the duplicates rather than the meaning of the word *restore*, E would be the right answer, and
this proposal would be over-engineering with a data-loss risk attached.

**Hidden coupling:** `uniqueProfileName()` stops being needed by restore but stays live for Import, so
its dedupe rules must remain correct in a path this proposal barely touches. The restore session's
write gate is shared with `snapshot()` and the profile-switch barrier - three features on one lock, and
a deadlock there is a hang with no error message.

**The failure most likely to escape tests:** the web snapshot backing. It is the runtime nobody uses
daily, IndexedDB eviction is invisible in a test suite, and "the recovery point was quietly evicted"
looks identical to "there was never one" at exactly the moment it is needed.

**Second most likely:** the marker state machine's `committed` phase. It is the only phase where the
correct action is *finish* rather than *abandon*, it is reached only by a crash in a millisecond-wide
window, and getting it backwards means a restored database with the pre-restore profile active - which
looks like the restore failed and invites the retry that re-imports everything.

**Evidence that would change the decision:** if the web snapshot store cannot be made durable enough to
justify the word "recovery", the honest options are to restrict replace-only to native and keep the web
build additive, or to take option E. Shipping the same destructive button with materially weaker
guarantees on one runtime is not one of them.

---

## Approval record

| Date | Who | Disposition |
|---|---|---|
| 2026-08-12 | Owner | Replace-only chosen; snapshot + one-transaction + confirm-copy agreed |
| 2026-08-12 | Codex | **Rev 1: Changes required** - 2 Blockers, 4 Majors, 2 Minors; recommended contract adopted |
| 2026-08-12 | Claude | **Rev 2** addressing all findings; awaiting review |
| | Owner | Pending final approval |
