# Proposal: Restore replaces, Import adds, and Primary is a role

**Revision 4** (2026-08-12). Rev 1-3 superseded. Product contract settled since Rev 2; Rev 3 closed both
Blockers; this revision closes the last cross-runtime Major and restores the §8 headings.

## Status and classification

**Draft, revision 4.** Risk: **High** - restore becomes a destructive user-data operation on an
offline-first app with no cloud copy.

Owner/approver: project owner (replace-only chosen 2026-08-12). Author: Claude Code.
Reviewer: Codex - Rev 1 *Changes required* (2 Blockers), Rev 2 *Changes required* (2 Blockers unclosed),
Rev 3 *Changes required* (both Blockers **closed**; 1 Major, 2 Minors).

### What Rev 3 got wrong

1. **The web fallback was not bound to what it protects.** When browser persistence is refused, Rev 3
   enabled replacement once the user exported and verified an external backup - but that happened
   *before* the exclusive session. A write settling in between meant the external artifact described
   state A while the replacement destroyed state B. The escape hatch guaranteed the wrong moment.
2. **Exclusive acquisition had no defined transition.** `admit('exclusive')` never said how admission
   closes relative to waiting for quiescence, which reopens the original capture gap through ordering,
   and left two simultaneous claimants possible.
3. **Capture was described as `session.tx`.** Capture is a *read*; naming it after the write path
   obscured which operation it is.
4. **Three §8 headings were dropped** while consolidating - the analysis survived, the formal record
   did not.

---

## Problem and success criteria

Restore currently **adds** the archive's profiles alongside what is on the device, so restoring your own
backup gives you two of everything. The imported profile also takes `is_default`, `deleteProfile()`
refuses to delete the default, and nothing in the app can move that flag - so every restore leaves a
profile the user can never remove.

| Operation | Meaning | Existing data |
|---|---|---|
| **Back up all data** | Portable snapshot of the entire app | Read-only |
| **Restore backup** | Return Compendium to that snapshot | **Replaced** |
| **Import profile** | Add one profile from a single-profile file | Preserved |

Industry-standard split (Anki replaces on collection import, adds on deck import; Firefox *Restore*
replaces, *Import* merges). **No merge during restore.**

### Primary is a role

Exactly one profile is Primary, enforced at initialisation. **Any profile can be made Primary.** The
sole remaining profile cannot be deleted; a Primary can be deleted once another is made Primary, offered
in the same confirmation. The starter `Sorcerer` is created only for a genuinely empty first launch and a
restore deletes it with everything else. The archive's Primary becomes Primary and the archive's active
profile becomes active - **they may differ**. Import creates an ordinary, non-Primary profile and opens it.

### Success criteria

1. After a restore, state is **canonically equivalent** to the archive (§7) - not byte-identical.
2. Restoring the same archive twice is canonically equivalent both times.
3. **No committed user write is lost between capture and replacement**, and no admitted write may still
   be in flight when capture begins.
4. A mistaken restore is recoverable without prior planning; the recovery point survives process death,
   a failed restore, and a subsequent restore.
5. An interrupted restore is **deterministically** finished or abandoned at startup.
6. **Every durable recovery artifact describes the exact state being replaced**, on both runtimes, or the
   destructive action is not offered.
7. Older archives migrate forward; newer-schema archives are refused.

### Non-goals

Merging during restore; selective restore; preserving physical UUIDs; cloud or scheduled backups.

---

## Evidence and current architecture

| Concern | Location |
|---|---|
| Gate admits then forgets | `db.js:65-72` |
| Snapshot's deliberate write-deadlock | `db.js:77-81` |
| Snapshot released before sealing | `backupService.js:57` |
| Re-keying, timestamps, sanitisation | `profileTransfer.js` - `planProfileUnit()` |
| Default flag and deletion shield | `profileRepository.js` - `deleteProfile()` |
| Zero Primaries repaired, multiple **not** | `profileRepository.js` - `initProfiles()` |
| No set-Primary control | `App.jsx` - `ProfileSheet` |
| Native write only to Cache + Share | `native.js:64` |
| Doc/code contradiction | `COMPENDIUM_DATA_MODEL.md:68` vs `backupService.js:71` (`changelogSeenBuild`) |

## Assumptions and confidence

| # | Assumption | Confidence | Validated by |
|---|---|---|---|
| 1 | An admission boundary can serve `snapshot()`, the profile-switch barrier and the restore session without deadlock | **Medium** - three consumers, one lock | Increment 1 is gated on explicit deadlock tests; if it fails, §Self-Critique's exit applies |
| 2 | `catalog_meta` survives the replacement and is a safe home for the journal and pointer | High - it is device/catalog state, `Preserve` in §8 | Increment 4 asserts the journal row exists post-commit |
| 3 | IndexedDB with `navigator.storage.persist()` is durable enough to call "recovery" | **Medium** | Increment 3; **failure is designed for** - Replace is disabled (§5) |
| 4 | `DELETE FROM profiles` cascades all profile-owned rows | High | Row counts across **every** profile-owned table |
| 5 | A canonical content digest can be computed identically for a captured state and an exported archive | **Medium** - requires excluding volatile envelope fields | Increment 2; the primitive is defined in §5 |
| 6 | ~1,476 statements is representative; replace roughly doubles the work | Medium - measured once | Re-measure at Increment 4 |

## Affected systems and invariants

**§3.5 Transactional user-data operations** - deletes, inserts and the journal row are one `tx()`.
**§3.2 Profile isolation** - the active id must never point at a deleted profile, transiently or after a
crash; no admitted write may resume against deleted identities.
**§3.3 Durable offline-first writes** - the recovery point must be durable *and verified* before the
destructive transaction.
**§3.4 Forward-only schema evolution** - older archives migrate forward; newer are refused.
**§3.8 Cross-runtime integrity** - equivalent guarantees on web and native, or the action is not offered.
**§3.1 Catalog/profile boundary** - the catalog is never touched by a restore.

Surfaces: `db.js` (admission), `backupService.js`, `profileTransfer.js`, `profileRepository.js`
(Primary role), `App.jsx` (confirm + Undo), a new snapshot store, and the documents in §Documentation.

## Options considered

| Option | Verdict |
|---|---|
| A. Status quo (additive restore) | Rejected by owner; also leaves the undeletable-profile trap |
| B. Replace, no recovery | **Rejected** - a data-loss feature |
| C. Replace + best-effort snapshot file (Rev 1) | **Rejected by review** - recovery was a file operation, not a protocol |
| D. Replace + verified crash-safe recovery; Import additive; Primary a role | **PROPOSED** |
| E. Additive + a set-Primary control only | Materially smaller and cannot destroy anything; fixes the undeletable profile. **Does not deliver the owner's settled meaning of *restore*.** Recorded, not chosen - see §Self-Critique |

---

## Proposed design

### 1. Admission boundary (replaces the write gate)

```
admit(kind, token?)   // 'write' | 'snapshot' | 'exclusive'
  - refused with RestoreInProgressError when an exclusive session is open
    and the caller does not hold its token
  - otherwise increments inFlight and returns settle(), which the caller MUST call
awaitQuiescence()     // resolves when inFlight === 0
```

`run`/`exec`/`tx` admit as `write` and settle in a `finally`, so a write is visible from admission to
completion - which is what "drain" requires and what `db.js:70` cannot do today.

**Exclusive acquisition is one explicit, ordered transition:**

1. **Atomically claim exclusivity.** A single compare-and-set publishes the owner token. A second
   claimant does not queue - it is **refused**, so two sessions can never both believe they own it.
2. **Admission for external callers closes at that instant**, before any waiting begins. Nothing can
   enter between the quiescence check and the publication of exclusivity, which was the ordering hole.
3. **Then** await quiescence of operations admitted *before* the claim. **The owner is not counted in
   the set it drains** - otherwise it waits for itself forever.
4. The owner proceeds through token-carrying operations.

Owner-scoped operations, named for what they are:

- **`session.readTransaction(fn)`** - the owner-scoped consistent read. **This is what capture uses.**
  Rev 3 called it `session.tx`, which named a write path for a read.
- **`session.tx(statements)`** - the owner-scoped write, used only for the replacement transaction.

`snapshot()` keeps its write-deadlock property for external callers and is re-based on this primitive.

### 2. Sequence - recovery is created after consent

```
1. Validate archive + build preview           READ ONLY, no session
2. User presses "Replace all data"            consent
3. ACQUIRE EXCLUSIVE (§1)                     close admission, then drain
4. Capture via session.readTransaction
5. [web-without-persistence only] bind the external archive to this capture (§5)
6. Write candidate under an IMMUTABLE id
7. Read back + verify digest                  failure ABORTS; nothing destroyed
8. Replacement transaction (§3)
9. Reconcile Primary + active
10. Publish recovery pointer, clear journal
11. RELEASE EXCLUSIVE
```

The session never spans human deliberation, and no window exists between capture and replacement.

### 3. The journal row commits *inside* the replacement transaction

`restore_pending` is not a separate authority - it is a `catalog_meta` row written in the **same** `tx()`
as the deletes and inserts:

```
ONE TRANSACTION:
  delete profile-owned state
  insert archive state
  set Primary
  write restore_pending = { candidateId, intendedActiveId, intendedPrimaryId }
```

`catalog_meta` is device-owned and preserved by the replacement, so the journal survives the operation it
describes.

**Startup - after migrations and database open, BEFORE `initProfiles()`, any UI, or any repository write:**

| Observed | Meaning | Action |
|---|---|---|
| no `restore_pending` | the replacement did **not** commit | abandon any candidate |
| `restore_pending` present | the replacement **did** commit | finish idempotently: reconcile active/Primary from the row, publish the pointer, delete the row |

No phase permits the wrong inference, because the marker and the data commit together.

### 4. Recovery points: immutable files, database pointer

Capacitor does not document atomic file replacement, so the design does not require it. Candidates are
written under **immutable ids** and never overwritten; the **pointer** to the current recovery point is a
`catalog_meta` key, so "which point is current" is decided by a database write, which *is* atomic. The
previous point is deleted only **after** the new pointer commits. A crash leaves an orphan file, swept at
next startup - orphaned bytes are cheap, a missing recovery point is not.

### 5. Web: fail closed, and bind the external artifact to the capture

If `navigator.storage.persist()` is refused, **"Replace all data" is disabled.** The user may instead
export an external backup - but an external file verified *before* the session describes a state that may
already be stale, which was Rev 3's hole.

So the artifact is bound to the capture, inside the session:

- A **canonical content digest** is computed over the archive *payload only*, excluding volatile envelope
  fields (`exportedAt`, `appBuild`, `integrity`). Two backups of identical data taken minutes apart must
  produce the **same** content digest - the existing envelope digest cannot be compared directly, because
  it covers those fields and would differ every time.
- After drain and capture (step 4), the capture's content digest is compared with the verified external
  archive's. **They must be equal or the restore aborts**, telling the user their backup is out of date
  and to export again.

A committed write can therefore never be absent from every durable artifact while the UI calls
replacement safe.

### 6. Primary storage: DECIDED - keep `is_default`

No second singleton; a new authority is what this proposal keeps being punished for.

- `setPrimary(id)` - one transactional operation (clear all, set one).
- `deleteProfileTransferringPrimary(id, newPrimaryId)` - role transfer and deletion in **one** transaction,
  then active reconciliation via `switchProfile()`.
- `initProfiles()` enforces **exactly one** Primary: it repairs zero today and must now collapse
  **multiple** deterministically (lowest `created_at`, then lowest id - stable, order-independent).

### 7. Equivalence, with non-unique names

Profile names are not unique, so name matching is wrong. Equivalence compares a **multiset of complete
canonical profile signatures** - profile fields plus decks, entries, collection items, matches, log
entries, lists and notes - and additionally checks the **ordered archive-unit mapping**. Excluded:
physical UUIDs, planner-regenerated timestamps, and contract-normalised fields, enumerated in one
reviewable helper. **A duplicate-profile-name case is a required test**, the two profiles holding
different decks.

### 8. Persisted state - ownership, preserve by default

| State | Owner | Disposition |
|---|---|---|
| `profiles` + profile-owned tables | Profile | **Replace** |
| `dash_seeded:<pid>` | Profile (keyed) | **Re-key** - drop deleted pids, write restored |
| `catalog_meta.version`, catalog rows | Device/catalog | **Preserve** |
| `restore_pending` journal | Device (transient) | Written in the replacement tx, cleared on completion |
| Recovery pointer + metadata | Device | **Preserve** - must outlive the data it protects |
| `activeProfileId` | Profile authority | **Reconcile** via `switchProfile()` |
| `is_default` (Primary) | Profile role | **Reconcile** inside the transaction |
| `changelogSeenBuild` | Device install | **Exclude** - stop exporting and restoring; the document already forbids it and the code contradicted it |
| Native telemetry consent | Device | **Exclude** |

**Unknown state is PRESERVED, not deleted.** Deletion is targeted by ownership, never by "everything that
looks app-global". A **key-namespace registry consumed by production code** is the discovery mechanism,
with a test asserting every declared namespace appears in this table. Honest limit: it catches an
unregistered *namespace*, not a key nobody registered - which is why the default is preserve.

### 9. Archive compatibility

`bundleFormat: 2` → **Restore backup** (replaces). Absent/`1` → **Import profile** (additive,
non-Primary, opened after import). A single-profile export is never authority to delete the whole app.
Whole-app archives carry at least one profile and exactly one Primary; older ones lacking Primary migrate
deterministically (archived active, else first).

### 10. The restore experience

Validate and preview writing nothing; show backup date and version, what is being restored, **the
corresponding counts currently on the device**, and "Everything currently in Compendium will be
replaced."; a destructive **Replace all data** button (no typed phrase); atomic replacement; then
"Backup restored · **Return to previous state**", persisting in Settings across restarts.

---

## Implementation plan

| # | Increment | Gate |
|---|---|---|
| 0 | **Primary as a role** | Unit + device; independently useful, fixes the undeletable profile alone |
| 1 | **Admission boundary** + acquisition transition | Unit: held-unresolved write blocks capture; external write refused mid-session; **two simultaneous exclusive claimants - one refused**; admit-at-boundary; owner's own operations do **not** deadlock |
| 2 | Snapshot store (immutable ids, verify, pointer, orphan sweep) + **canonical content digest** | Unit both backings; corrupted candidate rejected; identical data at different times → identical content digest |
| 3 | Web durability probe, fail-closed, external-archive binding | Unit + manual with persistence refused; **stale external archive aborts the restore** |
| 4 | `planReplace()` + journal row in the same tx | Canonical equivalence incl. duplicate names; idempotent |
| 5 | Startup reconciliation before `initProfiles()` | Kill before/after commit and mid-publish |
| 6 | Persisted-state registry + disposition | Unregistered namespace fails |
| 7 | Legacy routing → Import profile | Unit + copy |
| 8 | UI + accessibility | Manual both runtimes |
| 9 | Device pass | Real archive; undo; kill-and-restart mid-restore |
| 10 | Docs | Impact table below |

## Data migration and compatibility

No schema change: Primary stays `profiles.is_default`; journal and pointer are `catalog_meta` keys.
`bundleFormat` 2 unchanged, so existing archives restore under the new semantics. New archives omit
`changelogSeenBuild`; readers ignore it when present, so old and new archives stay mutually readable.

## Rollback and recovery

Code: revert; format unchanged. Data: the published recovery point, reachable from Settings. Partial
failure: governed by the journal row, which commits with the data. **Point of no return: the `tx()`
commit - past it the operation is finishable, not abandoned.**

## Verification plan

- **Automated:** canonical equivalence incl. duplicate names; idempotency; atomicity at three injection
  points; held-unresolved write blocks capture; external write refused mid-session; simultaneous
  exclusive claim refused; owner operations do not deadlock; kill before/after commit and mid-publish; a
  failed restore preserves the previous point; corrupted candidate rejected; **stale external archive
  aborts**; unregistered namespace fails.
- **Cross-runtime:** snapshot-store suite against both backings; persistence-refused path disables
  Replace (§3.8).
- **Manual:** restore an **older** archive, confirm newer data is genuinely gone, then Undo. Kill the app
  mid-restore and confirm startup resolves it.
- **Accessibility:** the confirm screen announces what will be **removed**; focus lands on the
  consequence, not the destructive button; Back cancels without writing; Undo is focusable, announced,
  and reachable from Settings afterwards.
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
| Web durability refused | High | Fail closed; external archive **bound to the capture** |
| A persisted key is missed | Medium | Preserve-by-default + namespace registry |
| Crash between commit and reconciliation | Medium | Journal commits with the data; startup finishes |
| Three consumers on one lock | **Medium** | One primitive, one owner concept; deadlock tests gate Increment 1 |
| Larger transaction hits a native limit | Low | Re-measure at Increment 4 |

**No open questions remain for the reviewer.** Primary storage (§6), legacy routing (§9) and web
durability (§5) are decided.

## Self-Critique

**The strongest case against this proposal is its size, and it has grown under three review rounds.**
Rev 1 was a file write; Rev 4 is an admission boundary with a defined acquisition transition, a two-runtime
snapshot store, a canonical content digest, a journal that commits with the data, a startup reconciliation
phase and a profile-role redesign - to change what one verb means. **Option E is roughly Increment 0
alone**, cannot destroy anything, and fixes the undeletable profile. If the owner's complaint had been the
duplicates rather than the meaning of *restore*, E wins outright.

What has changed across revisions is that the machinery is no longer speculative: each piece exists
because a specific failure was traced, not because it seemed prudent. That is an argument for the design
being *correct*, not for it being *small*.

**Hidden coupling:** `snapshot()`, the profile-switch barrier and the restore session now share one
primitive. Right, but a deadlock there is a hang with no error message, on the path holding the user's
whole database.

**The failure most likely to escape tests:** the web snapshot backing. Eviction is invisible in a suite,
and "quietly evicted" is indistinguishable from "never existed" at the moment it matters. Failing closed
and binding the external artifact reduce this to a usability problem rather than data loss.

**Second most likely:** startup reconciliation running at the wrong moment. It must execute after
migrations and before `initProfiles()`; anything reading a profile earlier - a lazy import, telemetry
init, a splash query - silently reintroduces the pre-restore profile, and the symptom appears one boot
later.

**Evidence that would change the decision:** if Increment 1 cannot produce a deadlock-free admission
boundary under its three consumers, the honest conclusion is that this codebase cannot yet carry a
destructive restore, and option E is the answer.

## Approval record

| Date | Who | Disposition |
|---|---|---|
| 2026-08-12 | Owner | Replace-only chosen |
| 2026-08-12 | Codex | Rev 1: Changes required - 2 Blockers, 4 Majors, 2 Minors |
| 2026-08-12 | Codex | Rev 2: Changes required - 2 Blockers unclosed, 3 Majors, 1 Minor |
| 2026-08-12 | Codex | Rev 3: Changes required - **both Blockers closed**; 1 Major, 2 Minors |
| 2026-08-12 | Claude | **Rev 4** - Major and both Minors addressed; §8 headings restored |
| | Owner | Pending final approval |
