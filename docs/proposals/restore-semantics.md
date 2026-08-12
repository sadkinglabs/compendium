# Proposal: Restore replaces, Import adds, and Primary is a role

**Revision 3** (2026-08-12). Rev 1 and Rev 2 are superseded. The product contract is settled and
unchanged since Rev 2; this revision makes it **executable and crash-deterministic**.

## Status and classification

**Draft, revision 3.** Risk: **High** - restore becomes a destructive user-data operation on an
offline-first app with no cloud copy.

Owner/approver: project owner (replace-only chosen 2026-08-12). Author: Claude Code.
Reviewer: Codex - Rev 1 *Changes required* (2 Blockers), Rev 2 *Changes required* (2 Blockers, 3
Majors, 1 Minor). Every finding is addressed below.

### What Rev 2 got wrong

Rev 2 answered "recovery must be a protocol" with a protocol that could not run on this codebase.

1. **The session could not deliver its own guarantee.** `db.js:70` awaits `whenWritable()` and then
   calls the backend - an admitted write is **never tracked again**. "Drain in-flight writes" was
   unimplementable against a gate that cannot see them. Worse, `snapshot()` deliberately deadlocks any
   write issued inside its gate (`db.js:77-81`), so restore holding that gate would deadlock **its own**
   replacement transaction.
2. **The recovery point was created before the user confirmed.** That either holds an exclusive session
   open across human deliberation, or releases it and reopens the exact write gap Blocker 1 forbids.
3. **`committed` was not atomic with the commit.** A crash between the database transaction and the
   marker write would leave startup reading `candidate-verified`, concluding the database was untouched,
   and **deleting the only recovery point for a replacement that had already happened.** Rev 2 made the
   marker a separate authority - the identical error it was written to fix.
4. **Promotion assumed atomic file replacement.** Capacitor's Filesystem documents `rename`, not atomic
   overwrite.
5. **Canonical comparison matched profiles by name.** Names are not unique in the schema.
6. **The unknown-key test was described as stronger than a test can be.** A fixture only contains keys
   its author put there.

---

## Problem and success criteria

Restore currently **adds** the archive's profiles alongside what is on the device, so restoring your own
backup gives you two of everything. The imported profile also takes `is_default`, `deleteProfile()`
refuses to delete the default, and nothing in the app can move that flag - so every restore leaves a
profile the user can never remove.

### The contract

| Operation | Meaning | Existing data |
|---|---|---|
| **Back up all data** | Portable snapshot of the entire app | Read-only |
| **Restore backup** | Return Compendium to that snapshot | **Replaced** |
| **Import profile** | Add one profile from a single-profile file | Preserved |

Industry-standard split (Anki replaces on collection import and adds on deck import; Firefox *Restore*
replaces, *Import* merges). **No merge during restore.**

### Primary is a role

- Exactly one profile is **Primary**, enforced at initialisation.
- **Any profile can be made Primary** - a control the app does not currently have.
- The sole remaining profile cannot be deleted.
- A Primary profile can be deleted once another is made Primary, offered in the same confirmation.
- The starter `Sorcerer` is created only for a genuinely empty first launch, and a restore deletes it
  along with everything else.
- The archive's Primary becomes Primary; the archive's active profile becomes active. **They may
  differ.**
- **Import** creates an ordinary, non-Primary profile and opens it.

### Success criteria

1. After a restore, state is **canonically equivalent** to the archive (§"Equivalence") - not
   byte-identical.
2. Restoring the same archive twice is canonically equivalent both times.
3. **No committed user write is lost between capture and replacement**, and no admitted write may still
   be in flight when capture begins.
4. A mistaken restore is recoverable without prior planning, and the recovery point survives process
   death, a failed restore, and a subsequent restore.
5. An interrupted restore is **deterministically** finished or abandoned at startup - never
   half-applied, never with a recovery point describing the wrong operation.
6. **The same guarantee on both runtimes, or the destructive action is not offered** (§"Web").
7. Older archives migrate forward; newer-schema archives are refused.

### Non-goals

Merging during restore; selective restore; preserving physical UUIDs; cloud or scheduled backups.

---

## Evidence and current architecture

| Concern | Location |
|---|---|
| Gate admits then forgets | `db.js:65-72` - `whenWritable()` then `backend.run/exec/tx` |
| Snapshot's deliberate write-deadlock | `db.js:77-81` |
| Snapshot released before sealing | `backupService.js:57` |
| Re-keying, timestamps, sanitisation | `profileTransfer.js` - `planProfileUnit()` |
| Default flag and deletion shield | `profileRepository.js` - `deleteProfile()` |
| Zero-Primary repaired, multiple **not** | `profileRepository.js` - `initProfiles()` |
| No set-Primary control | `App.jsx` - `ProfileSheet` |
| Native file write only to Cache + Share | `native.js:64` |
| Doc/code contradiction | `COMPENDIUM_DATA_MODEL.md:68` says app-global Preferences are never exported; `backupService.js:71` exports `changelogSeenBuild` |

---

## Proposed design

### 1. Admission boundary (replaces the write gate)

The gate becomes a boundary that **tracks admitted writes to settlement**:

```
admit(kind)         // kind: 'write' | 'snapshot' | 'exclusive'
  - refuses with RestoreInProgressError when an exclusive session is open
    and the caller does not hold the session token
  - otherwise increments inFlight and returns a settle() the caller MUST call

awaitQuiescence()   // resolves when inFlight === 0
```

- `run`/`exec`/`tx` admit as `write` and settle in a `finally`. A write is now visible from admission
  until completion, which is what "drain" requires.
- **Restore owns an escape hatch, and it is scoped, not a bypass.** The session issues its capture and
  its replacement through `session.tx(...)`, which carries the session token and therefore admits
  while external writes are refused. Rev 2's deadlock is structural, so the fix is structural: the
  owner is admitted *because* it is the owner.
- `snapshot()` keeps its write-deadlock property for external callers - it is a useful guarantee, and
  it is reimplemented on this primitive rather than replaced.

**Regression required by review:** a backend write that has passed admission and is deliberately held
unresolved. Capture must not begin until it settles.

### 2. Sequence - the recovery point is created after consent

Rev 2 created it during preview. Corrected:

```
1. Validate archive + build preview          READ ONLY, no session
2. User presses "Replace all data"           consent
3. ENTER EXCLUSIVE SESSION                   drain admitted writes, refuse new ones
4. Capture current state                     via session.tx
5. Write candidate under an IMMUTABLE id
6. Read back + verify digest                 failure here ABORTS, nothing destroyed
7. Replacement transaction                   (see 3)
8. Reconcile Primary + active
9. Publish recovery pointer, clear journal
10. EXIT SESSION
```

The session never spans human deliberation, and no window exists between capture and replacement.

### 3. The journal row is written *inside* the replacement transaction

This is the correction that makes crash recovery deterministic. `restore_pending` is **not** a separate
authority - it is a row in `catalog_meta`, written in the **same** `tx()` as the deletes and inserts, so
it commits exactly when the replacement does:

```
ONE TRANSACTION:
  delete profile-owned state
  insert archive state
  set Primary
  write restore_pending = { candidateId, intendedActiveId, intendedPrimaryId }
```

`catalog_meta` is device-owned and preserved by the replacement (§"Persisted state"), so the journal
survives the very operation it describes.

**Startup, after migrations and database open, BEFORE `initProfiles()`, any UI, or any repository
write:**

| Observed | Meaning | Action |
|---|---|---|
| no `restore_pending` | the replacement did **not** commit | abandon any candidate; nothing happened |
| `restore_pending` present | the replacement **did** commit | finish idempotently: reconcile active/Primary from the row, publish the recovery pointer, delete the row |

There is no phase where the wrong inference is possible, because the marker and the data commit
together. Rev 2's five phases collapse to one durable fact.

### 4. Recovery points: immutable files, durable pointer

Capacitor does not document atomic file replacement, so the design does not need it:

- Candidates are written under **immutable ids** (`recovery/<uuid>.json`) and never overwritten.
- The **pointer** to the current recovery point is a `catalog_meta` key - so "which recovery point is
  current" is decided by a database write, which *is* atomic.
- The previous recovery point is deleted **only after** the new pointer is committed. A crash leaves an
  orphan file, which the next startup sweeps - orphaned bytes are cheap; a missing recovery point is not.

### 5. Web fails closed

Rev 2 warned and continued. Corrected: **if `navigator.storage.persist()` is refused, "Replace all
data" is disabled.** The user is offered the alternative that restores the guarantee - export a backup
and re-open it to verify it arrived - which then enables replacement for that session. The same button
never ships with materially weaker guarantees on one runtime (§3.8).

### 6. Primary storage: DECIDED - keep `is_default`

No second singleton; a new authority is the thing this proposal keeps being punished for. Instead:

- `setPrimary(id)` - one transactional repository operation (clear all, set one).
- `deleteProfileTransferringPrimary(id, newPrimaryId)` - role transfer and deletion in **one**
  transaction, then active-profile reconciliation through `switchProfile()`.
- `initProfiles()` enforces **exactly one** Primary: it already repairs zero, and must now collapse
  **multiple** deterministically (lowest `created_at`, then lowest id - stable and order-independent).

### 7. Equivalence, and comparing profiles that share a name

Profile names are **not unique**, so name matching is wrong. Equivalence compares a **multiset of
complete canonical profile signatures** - each signature covering the profile's own fields plus its
decks, entries, collection items, matches, log entries, lists and notes - and additionally checks the
**ordered archive-unit mapping** so position is verified where the archive defines it.

Excluded from comparison: physical UUIDs, planner-regenerated timestamps, and fields the planner
normalises by contract - enumerated in one reviewable helper. **A duplicate-profile-name case is a
required test**, with the two profiles holding different decks.

### 8. Persisted state - ownership, and preserve-by-default

| State | Owner | Disposition |
|---|---|---|
| `profiles` + all profile-owned tables | Profile | **Replace** |
| `dash_seeded:<pid>` | Profile (keyed) | **Re-key** - drop deleted pids, write restored pids |
| `catalog_meta.version`, catalog rows | Device/catalog | **Preserve** |
| `restore_pending` journal | Device (transient) | **Written in the replacement tx**, cleared on completion |
| Recovery pointer + metadata | Device | **Preserve** - it must outlive the data it protects |
| `activeProfileId` | Profile authority | **Reconcile** via `switchProfile()` |
| `is_default` (Primary) | Profile role | **Reconcile** inside the transaction |
| `changelogSeenBuild` | Device install | **Exclude** - stop exporting and restoring; `COMPENDIUM_DATA_MODEL.md:68` already forbids it and the code contradicted the document |
| Native telemetry consent | Device | **Exclude** |

**Unknown state is PRESERVED, not deleted** - the safe default, and the correction to Rev 2's
overclaim. Deletion is targeted by ownership (`dash_seeded:<pid>` for deleted pids), never by "everything
that looks app-global". A **key-namespace registry consumed by production code** is the discovery
mechanism; a test asserts every namespace the registry declares appears in this table. That is an honest
guarantee: it catches an unregistered *namespace*, and it cannot catch a key nobody registered - which is
why the default is preserve.

### 9. Archive compatibility

| File | Route | Behaviour |
|---|---|---|
| `bundleFormat: 2` | **Restore backup** | Replaces everything |
| absent / `bundleFormat: 1` | **Import profile** | Additive, non-Primary, opened after import |

A single-profile export is never authority to delete the whole app. Whole-app archives must carry at
least one profile and exactly one Primary; older archives lacking Primary migrate deterministically
(archived active, else first).

### 10. The restore experience

Validate and preview writing nothing; show backup date and version, what is being restored, **the
corresponding counts currently on the device**, and "Everything currently in Compendium will be
replaced."; destructive **Replace all data** button (no typed phrase); atomic replacement; then
"Backup restored · **Return to previous state**", persisting in Settings across restarts.

---

## Implementation plan

| # | Increment | Gate |
|---|---|---|
| 0 | **Primary as a role**: `setPrimary`, `deleteProfileTransferringPrimary`, init enforces exactly one (collapse multiples) | Unit + device. Independently useful; fixes the undeletable profile alone |
| 1 | **Admission boundary**: track to settlement, `awaitQuiescence`, session token, `snapshot()` re-based on it | Unit: held-unresolved write blocks capture; external write refused mid-session; owner's own tx does **not** deadlock |
| 2 | Snapshot store: immutable ids, verify, pointer in `catalog_meta`, orphan sweep - native + web | Unit both backings; corrupted candidate rejected |
| 3 | Web durability probe + **fail-closed** disable of Replace | Unit + manual with persistence refused |
| 4 | `planReplace()` + journal row **in the same tx** | Canonical-equivalence incl. duplicate names; idempotent |
| 5 | Startup reconciliation before `initProfiles()` | Kill after commit / before commit / mid-publish; assert the two-row table, and that a failed attempt keeps the previous point |
| 6 | Persisted-state registry + disposition | Unit: unregistered namespace fails |
| 7 | Legacy routing → **Import profile** | Unit + copy |
| 8 | UI + accessibility | Manual both runtimes |
| 9 | Device pass | Real archive; undo; kill-and-restart mid-restore |
| 10 | Docs | Impact table below |

---

## Data migration and compatibility

No schema change: Primary stays `profiles.is_default`, and the journal and pointer are `catalog_meta`
keys. `bundleFormat` 2 is unchanged, so existing archives restore under the new semantics. New archives
omit `changelogSeenBuild`; readers ignore it when present, so old and new archives stay mutually
readable.

## Rollback and recovery

Code: revert; format unchanged. Data: the published recovery point, reachable from Settings.
Partial failure: governed by the journal row, which commits with the data.
**Point of no return: the `tx()` commit - and past it the operation is finishable, not abandoned.**

## Verification plan

- **Automated:** canonical equivalence incl. duplicate names; idempotency; atomicity at three injection
  points; a held-unresolved write blocks capture; an external write mid-session is refused; the owner's
  transaction does not deadlock; kill before/after commit and mid-publish; a failed restore preserves the
  previous recovery point; corrupted candidate rejected; unregistered namespace fails.
- **Cross-runtime:** the snapshot-store suite runs against both backings; web persistence-refused path
  disables Replace (§3.8).
- **Manual:** restore an **older** archive and confirm newer data is genuinely gone, then Undo. Kill the
  app mid-restore and confirm startup resolves it.
- **Accessibility:** the confirm screen announces what will be **removed**; focus lands on the
  consequence, not the destructive button; Back cancels without writing; Undo is focusable and
  announced afterwards, and reachable by screen reader from Settings.
- **Regression:** the 19 existing backup/restore tests, each change reviewed individually.

## Documentation impact

| Document | Impact |
|---|---|
| `COMPENDIUM_FEATURE_MATRIX.md` | **Changes** - Restore/Import split; Primary-as-role |
| `COMPENDIUM_DATA_MODEL.md` | **Changes** - ownership table; `changelogSeenBuild` contradiction; journal + pointer keys; Primary/active as separate authorities |
| `COMPENDIUM_ARCHITECTURE.md` | **Changes** - admission boundary and snapshot store as owned boundaries across both runtimes |
| `BUILD.md` | **Changes** - exercising recovery and interrupted restores |
| `DESIGN_SYSTEM.md` | **Changes** - destructive-confirmation pattern + accessibility contract |
| `backup-and-restore.md` | **Superseded in part** - marked, not rewritten |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Unchanged** |

## Security, privacy, performance, and operations

Recovery points are unencrypted user data in app-private storage, never leaving the device, containing
opponent names - never logged, shared, or in diagnostics. **On web, IndexedDB is origin-scoped, not
app-private in the same sense.** Cost: one extra whole-database write per restore (~0.4 MiB), bounded by
single-point retention plus orphan sweeping.

## Risks and unanswered questions

| Risk | Impact | Mitigation |
|---|---|---|
| Replace destroys data the user did not intend to lose | **Severe** | Verified recovery point; both-sides counts; persistent Undo |
| Web durability refused | High | **Fail closed** - Replace disabled until an external backup is saved and verified |
| A persisted key is missed | Medium | Preserve-by-default + namespace registry |
| Crash between commit and reconciliation | Medium | Journal row commits with the data; startup finishes |
| Three features on one lock (snapshot, profile-switch barrier, restore session) | Medium | One primitive, one owner concept; deadlock tests are explicit gates in Increment 1 |
| Larger transaction hits a native limit | Low | Re-measure at Increment 4 |

**No open questions remain for the reviewer.** Primary storage is decided (§6); legacy routing is decided
(§9); web durability is decided (§5).

## Self-Critique

**The strongest case against this proposal is its size, and it has grown twice under review.** Rev 1 was
a file write. Rev 3 is an admission boundary, a snapshot store on two runtimes, a journal that commits
with the data, a startup reconciliation phase, and a profile-role redesign - to change what one verb
means. **Option E (additive + a set-Primary control) still fixes the undeletable profile, still cannot
destroy anything, and is roughly Increment 0 alone.** If the owner's complaint had been the duplicates
rather than the meaning of *restore*, E wins outright, and the correct read of two review rounds is that
the cost of replace-only is being discovered rather than paid down.

**Hidden coupling:** `snapshot()`, the profile-switch write barrier and the restore session now share one
primitive. That is right - three locks would be worse - but a deadlock there is a hang with no error
message, on the path that holds the user's whole database.

**The failure most likely to escape tests:** the web snapshot backing. Eviction is invisible in a suite,
and "quietly evicted" is indistinguishable from "never existed" at the moment it matters. Failing closed
reduces this to a usability problem instead of a data-loss one, which is why §5 changed.

**Second most likely:** the startup reconciliation running at the wrong moment. It must execute after
migrations and before `initProfiles()`. Anything that reads a profile earlier - a lazy import, a
telemetry init, a splash-screen query - silently reintroduces the pre-restore profile, and the symptom
appears one boot later.

**Evidence that would change the decision:** if Increment 1 cannot produce an admission boundary with no
deadlock under the existing three consumers, the honest conclusion is that this codebase cannot carry a
destructive restore safely yet, and option E is the answer.

## Approval record

| Date | Who | Disposition |
|---|---|---|
| 2026-08-12 | Owner | Replace-only chosen |
| 2026-08-12 | Codex | **Rev 1: Changes required** - 2 Blockers, 4 Majors, 2 Minors |
| 2026-08-12 | Codex | **Rev 2: Changes required** - 2 Blockers unclosed, 3 Majors, 1 Minor |
| 2026-08-12 | Claude | **Rev 3** - all findings addressed; no open questions returned to the reviewer |
| | Owner | Pending final approval |
