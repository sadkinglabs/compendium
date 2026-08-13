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

---

# Round 1 disposition - response (2026-08-13)

All five findings addressed. Two gaps you named are **not** fully closed and are stated as such at the
end rather than counted as done.

## Blocker - post-commit failure could destroy the recovery point. FIXED.

Confirmed exactly as traced, and worse than a wording problem. The comment directly above that code
already read *"from here the operation is finished, not failed"* - true in prose, false in code,
because `promote()` and the journal retirement were unguarded. That is the same shape as the
fail-open build gates on `capacitor-8`: **a control that reads correctly and protects nothing.**

Your chain is the part that makes it severe. `planReplace` writes the journal with `INSERT OR
REPLACE`, so the retry the error message invited would capture the **already-replaced** state as its
candidate, overwrite the row naming the real pre-restore one, and leave the user's only copy of what
they had as an orphan for the next sweep.

**Two guards:**

1. **Past the commit there is no failure, only finished or DEFERRED.** `promote` and the journal
   delete are guarded; the result carries `settled: false`, and startup reconciliation completes it
   from the journal row - which is why the row is retired last.
2. **A pending journal row REFUSES a second replacement** (`ReplaceRefused('reconciliation-pending')`).
   A row still present means a previous replacement committed without finishing, so overwriting it is
   precisely the data-loss step. The way forward is a relaunch, which reconciles.

**Tests, as required - injected at pointer publication and at journal retirement, each followed by an
immediate retry:**

| Test | Removing the fix |
|---|---|
| pointer-publication failure is DEFERRED, not a rejection | fails |
| journal-retirement failure is DEFERRED, not a rejection | fails |
| after a deferred replacement a RETRY is refused and the recovery point survives | fails |
| and the next boot makes that deferred recovery point reachable | fails |

Removing the post-commit guard fails four; removing the pending-journal guard fails exactly the retry
test.

**Worth flagging, because it nearly produced a false pass:** my first injection matched on SQL text
and aborted the **commit** rather than the retirement - testing a pre-commit failure, which correctly
rejects. Both predicates are now pinned to the single-statement post-commit writes, because
`RESTORE_PENDING_KEY` and `DELETE FROM catalog_meta` both also appear inside the replacement
transaction itself.

## Major - routing was an untested App.jsx responsibility. BOUNDARY FIXED, coverage NOT as asked.

`restoreAll` now **refuses a whole-app archive outright** (`ReplaceRefused('whole-app-archive')`), so
a dropped or renamed `operation` field cannot silently reinstate additive whole-app restore. The
classifier decides which operation a file authorises; the executor now refuses to be the wrong one.

That refusal retired **thirteen tests** asserting the superseded additive contract. They are
**deleted, not rewritten to pass**, and the file carries an audit trail mapping every property they
protected to where it is now asserted on the replace path. One - *"NOTHING is deleted by a restore"* -
is explicitly **RETIRED**, because the owner reversed that property and the opposite is now asserted.
You warned that rewriting tests to match new behaviour is where a regression hides, so that mapping is
in the source rather than in this packet.

**Not closed:** there is still no component test executing the UI-to-executor decision or Undo. I
consider the boundary refusal the stronger control, but it is not the coverage you asked for.

## Major - the web fail-closed experience did not exist. IMPLEMENTED.

You were right that `bindExternalArchive` had no production caller. The policy is now asked **before**
the button is offered; when durability is refused the destructive button is **disabled**, the reason
is announced via `role="alert"` rather than left as a dead control, and the remedy is a real flow:
choose a backup, bind it, and it is re-checked against the **frozen capture** inside the session.

**Not closed:** no web runtime pass. This path is unit-tested and reasoned, never executed in a
browser.

## Minors - both fixed

- **`verify-archive.mjs`** ran the additive path and reported the surviving starter profile as
  expected. It now runs `replaceAll` through the real session, and **fails** if the starter survives.
  It also reports whether the recovery point was written and whether the operation settled.
- **`COMPENDIUM_DATA_MODEL.md`** placed the journal and pointer under Preferences. They are
  `catalog_meta` rows, now stated with the reason: the journal has to commit in the **same
  transaction** as the replacement, which is only possible inside the database.

## Gates

`test:query` **999**, plus `test:codex` 10, `test:app` 17, `test:ui` 185, `test:catalog` 124,
`test:docs` 3, `test:recog` 13, `check:types`, `check:cycles`, `check:source`, `build`, `check:docs`.
The count fell from 1,004 because thirteen superseded tests were retired and eight added.

## Still open, stated plainly

1. **No component test for UI routing or Undo.** Boundary-enforced instead.
2. **No web runtime pass.** The fail-closed flow has never run in a browser.
3. **Device evidence is from the previous build.** The fixes above are not re-verified on hardware;
   the destructive path was last exercised at build 221, before this round.
