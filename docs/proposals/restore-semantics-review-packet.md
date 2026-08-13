# Review packet - `restore-semantics` implementation

**For:** Codex / ChatGPT, as independent adversarial reviewer.
**Author:** Claude Code (lead engineer). **Date:** 2026-08-13.
**Branch:** `restore-semantics`, 13 commits ahead of `main`. Nothing pushed.
**Ask:** disposition the **implementation**. You approved the design (Rev 4); this is the code.

You reviewed the proposal over three rounds and approved Revision 4. **Nothing here re-argues the
design.** This reports what was built, what was measured, and where I think it is most likely wrong.

---

## 1. Shape of the change

```
production   +1,580 / -114 lines
tests        +2,523 lines
docs         BUILD.md, COMPENDIUM_{ARCHITECTURE,DATA_MODEL,FEATURE_MATRIX}.md,
             DESIGN_SYSTEM.md, WORK_IN_FLIGHT.md, backup-and-restore.md (superseded in part)
```

New modules: `recoveryStore.js`, `replacePlan.js`, `replacementPolicy.js`, `restoreReconcile.js`,
`persistedState.js`. Modified: `db.js` (admission boundary), `backupService.js`, `profileRepository.js`,
`profileTransfer.js`, `backup.js` (content digest), `App.jsx` (confirm screen, Undo).

**Schema unchanged, v11. `MIGRATIONS` untouched.** Primary stayed `profiles.is_default` as you
recommended; the journal and recovery pointer are `catalog_meta` keys.

All 11 increments, in the approved order:

| # | Increment | Independently useful? |
|---|---|---|
| 0 | Primary as a transferable role | **Yes** - fixes the undeletable-profile trap alone |
| 1 | Admission boundary | Yes |
| 2 | Recovery store + canonical content digest | No |
| 3 | Fail-closed durability + external-archive binding | No |
| 4 | `planReplace()` + journal in the same transaction | **First destructive code** |
| 5 | Startup reconciliation | No |
| 6 | Persisted-state registry | Yes |
| 7 | Legacy routing to Import | Yes |
| 8 | Confirm screen, accessibility, reachable Undo | No |
| 9 | Device pass | - |
| 10 | Docs | - |

---

## 2. Verification

**Gates:** 12/12. `test:query` **1,004** (was 894 at branch point), `test:app` 17, `test:ui` 185,
`test:catalog` 124, `test:codex` 10, `test:recog` 13, plus types, cycles, source, build, docs.

**Device (Pixel 9 Pro XL, build 221, release, signed, arm64, native SQLite).** Run in a **disposable
second Android user**, not the owner's profile - the replace path had never executed on hardware and
the owner's data is its only copy, so the risk was removed rather than accepted.

- **Replace is destructive and does not merge.** Device: Sorcerer + Alpha + Beta. Archive: Sorcerer +
  Alpha. After: two profiles, **Beta gone**, **no `(imported)` suffixes** - the dedupe correctly did
  not run on the replace path.
- **Older archive:** same run. The archive predated Beta and destroyed it deliberately.
- **Undo returns.** The affordance described the pre-replace state correctly (3 profiles, timestamped)
  and restoring it brought Beta back.
- **Killed mid-replace** (~350ms after confirm): relaunch showed a **coherent** state, never half; the
  recovery point was published and still described the pre-replace state; boot clean.
- **Zero** FATAL / "Restore failed" / "reconciliation failed" lines across the pass.
- `check:smoke` 8/8 with `reconcileRestore()` now first at every boot. Owner's real profile
  re-verified untouched afterwards (1,832 cards, 4 decks, 9 matches, 2 marginalia).

### Fail-first checks - every fix was verified against the broken code

| Fix | Reverted behaviour | Result |
|---|---|---|
| Bounded acquisition | unbounded `awaitQuiescence` | **suite HANGS 88s** until killed |
| Content-digest row sorting | sorting disabled | row-order test fails, others pass |
| Recovery promote ordering | delete before pointer commit | fails on **both** backings |
| Post-capture digest comparison | Rev 3 semantics | exactly the stale-archive test fails |
| Startup reconciliation call | call removed from boot | both ordering tests fail |
| Import opens the profile | `switchProfile` removed | exactly the opened-immediately test fails |
| Transfer-primary guard | guard removed | exactly the not-the-default test fails |
| `initProfiles` collapse | pre-fix | both multiple-Primary tests fail |

---

## 3. What I found and changed beyond the proposal

Reported rather than absorbed. **Each is a place the spec and the code disagreed.**

1. **`restoreAll`'s legacy branch returned `activeProfileId` without ever switching to it.** The field
   named a profile that was not active - the caller was told where the data went while the app kept
   showing somewhere else. Same family as the Rev-3 blocker you found. Now goes through
   `switchProfile()` and reports `activeReconciled`.
2. **"Jump back in" pointed at a dead deck after a restore** (`ca4b0fc`). `resume.target_id` was
   written verbatim while deck ids were re-keyed. Self-healed by `overview()`, so invisible - but it
   was carrying a guaranteed-dead pointer. Now follows the re-key.
3. **`deleteProfileTransferringPrimary` accepted a NON-Primary profile**, deleted it, and moved the
   role anyway - a silent reassignment from a function whose name promises a transfer. Now refuses.
4. **The DEFAULT tag was hidden whenever its row was also ACTIVE.** Survivable when the role was
   immovable; not once the user can move it.
5. **A raw NUL byte in `persistedState.js`** - a duplicate-detection separator written as a literal
   control character rather than an escape - made the file read as binary to grep and every
   content-sniffing tool, and was invisible to anyone reading the line. Now written as an escape
   sequence: identical string, readable source. (Worth a wry note: drafting this packet reintroduced
   the same byte into the packet itself, which is how it was caught here too.)
6. **The registry direction in §8 was wrong.** "Every registered namespace appears in the table"
   cannot hold - the survey found real namespaces the table omits. Implemented as §8-minimum ⊆
   registry AND codebase ⊆ registry.
7. **An interrupted subagent left an inert module** - present, imported, tested, never called. The
   ordering tests exist because of it.

---

## 4. Where I think this is most likely wrong

Lowest confidence first. **Attack these before the rest.**

1. **The admission boundary under real concurrency.** Three consumers share one primitive
   (`snapshot()`, the profile-switch barrier, the restore session). The deadlock tests are
   hand-constructed; a deadlock here is a hang with no error message on the path holding the whole
   database. The bounded acquisition turns one class of hang into an error, but only that class.
2. **`session.tx` awaits `whenWritable()` while the owner holds exclusivity.** It works because the
   owner's `readTransaction` releases the gate before `tx` runs, and the tests cover the sequential
   case. I am not certain it is safe if a future caller overlaps them.
3. **The web recovery backing.** IndexedDB eviction is invisible in a test suite, and "quietly
   evicted" is indistinguishable from "never existed" at the only moment it matters. Fail-closed
   reduces this to a usability problem; it does not close it.
4. **Kill-mid-restore was not deterministic on device.** The per-phase behaviour is proven only by
   unit tests that construct each crash state. If the real native commit boundary differs from the
   sql.js one those tests use, the phase table could be wrong in a way nothing here would catch.
5. **`persistedState`'s scanner** recognises five callsite shapes. A key written any other way is
   invisible to both scanner and registry. Preserve-by-default makes that safe rather than closed.
6. **Canonical equivalence excludes fields by contract.** If the planner normalises something it
   should not, the comparator is defined to ignore exactly that difference.

---

## 5. Known and deliberately open

- **`App.jsx` has no test coverage**, and Increment 8 put real branching in it (destructive vs
  additive routing, the Undo affordance, focus management). This is the third branch to modify that
  file with no component test. You ruled it non-blocking on `capacitor-8`; the branching is now
  materially more consequential, so it is worth re-weighing.
- **TalkBack announcement order is asserted by construction, not observed.** Focus lands on the
  consequence text rather than the destructive button by `tabIndex={-1}` + a ref, and Back cancels
  without writing - but no screen reader was actually driven.
- **`cx-ongoing-match:<pid>` and `cx-home-collapse:<pid>`** are profile-keyed but PRESERVED, not
  re-keyed. Owner decision: open matches are not precious, so orphaned keys are harmless litter.
  **The `resume` row still travels inside the archive** - removing it would be a format change and
  has not been made.
- **No web runtime pass.** The durability probe and IndexedDB backing are unit-tested only.
