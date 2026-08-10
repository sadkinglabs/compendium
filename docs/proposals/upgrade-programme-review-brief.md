# Review brief: the two-increment upgrade programme

**To:** Codex (principal engineer, independent reviewer)
**From:** Claude Code (lead engineer)
**Date:** 2026-08-09
**Requested:** full adversarial review, both increments, per `AGENTS.md` §5 Phase C.
**State:** no production or build code has been modified. Four documents exist; nothing else.

## What is being reviewed

| Document | What it is |
|---|---|
| [backup-and-restore.md](./backup-and-restore.md) | **Increment A** - whole-app backup/restore. Revision 2, a complete rewrite; revision 1 was stale against schema v10/v11 |
| [capacitor-8-upgrade.md](./capacitor-8-upgrade.md) | **Increment B** - Capacitor 6 -> 8, Android 16 target API 36, and the whole-tree dependency upgrade. Revision 3 |
| [dependency-audit-2026-08.md](./dependency-audit-2026-08.md) | Discovery artifact: every dependency and toolchain component, each "latest" resolved from the authoritative registry |
| [../WORK_IN_FLIGHT.md](../WORK_IN_FLIGHT.md) | Deferred-upgrade register with the trigger that unblocks each |

Both increments are **High-risk** under Constitution §6. A is a hard prerequisite for B: it supplies both
B's data safety net and the **rollback source baseline** B rebuilds its recovery artifact from. A does not
produce B's rollback binary - that carries B's own `versionCode` and is built in B's Increment 0.

> **Status, 2026-08-10: APPROVED by the human project owner.** Codex round 3 returned "changes required,
> stale active instructions only" and stated the architecture is approval-ready once that sweep completes.
> The sweep is complete (Round 3 below); the owner has approved. The remaining gate is Codex's independent
> review of the actual implementation diff.

## Owner decisions already made - not open for review

Challenge the *consequences* of these, not the decisions themselves.

1. Full Capacitor 6 -> 8 upgrade. No `patch-package`.
2. compileSdk **and** targetSdk to API 36. Rationale is future-proofing.
3. Java 21, Kotlin 2.4.10, `org.jetbrains.kotlin.plugin.compose`.
4. A real app-level backup/restore protocol, leanest manual MVP first.
5. **The app is portrait-only, always.** No landscape support is wanted.
6. **One job:** the web tier (React 19, Vite 8, plugin-react 6, static-copy 4, sql.js, qrcode-generator 2,
   sharp, firebase-tools) is folded into Increment B rather than run separately.
7. CameraX 1.6.1 and Firebase BoM 34.17.0 are in scope.

## Where I want the review aimed

I am not asking for a completeness pass over prose. These are the claims that carry the risk, ordered by
how much damage a wrong one does. Several are places I already believe I am weak.

### A. My reasoning has one demonstrated failure mode - look for more of it

Revision 2 of the upgrade proposal recommended Kotlin 2.2.20 because it is the version Capacitor 8's
`@capacitor/filesystem` module declares. That was wrong: Kotlin's published matrix caps KGP 2.2.20 at
**AGP 8.11.1**, and Capacitor's template ships **AGP 8.13.0**, so the vendor's own pairing is out of band.
I treated "matches the vendor" as equivalent to "supported" without checking the other side.

**The audit's Tier-1 table is where that reasoning is most concentrated.** Every row there is justified by
"this is what Capacitor 8 declares". Please check whether any other row is a similarly unsupported pairing -
in particular androidx `core` 1.17.0 against compileSdk 36, Cordova framework 14.0.1 under AGP 8.13, and
`google-services` 4.4.4 under AGP 8.13.

### B. A gap I found while writing this brief, and have not yet fixed

The proposal replaces `checkRecogAssets`'s fail-open `tasks.matching { it.name ==~ /merge.*Assets/ }`
binding with an `androidComponents.onVariants` + `assemble<Variant>` binding, mirroring the
forbidden-permission gate. **But `assemble<Variant>` does not cover every path that produces an installable
artifact:** `bundleRelease` (AAB, which is what Play actually takes) and `installDebug` both produce output
without necessarily running `assemble`. The replacement may be narrower than the thing it replaces.

Please determine the correct binding. This is a gate whose failure mode is a silent one - a build that ships
a scanner reporting "Visual match unavailable" on every scan - so I would rather have it over-bound than
elegantly bound.

### C. Increment A - the claims that carry the data risk

1. **The completeness test is specified too narrowly and I said so in my own Self-Critique.** As written it
   asserts the *exporter's* table constant matches the schema-derived set. A future table added to the
   exporter but not to `restoreProfileUnit` would back up and never come back. Should the test assert the
   full round-trip instead, and is a schema-parsed table set even the right mechanism?
2. **Stage 2 refactors `importProfile`** (`src/store/profileTransfer.js:74-206`) into a shared unit. That
   function's comments record two separately paid-for bugs: the disconnected import boundary (`:75-78`) and
   the orphan-profile fix (`:102-112`). Its gate is "existing tests pass unchanged", but existing tests only
   cover what someone already thought to test. Is the extraction worth it, or should the whole-app path
   duplicate rather than share?
3. **Multi-profile atomicity is per-profile `tx()` plus a compensating delete** (Options / I), chosen over
   one transaction because `executeSet` materialises the whole statement set. Assumption 3 - that one
   profile is a safe batch size - is **unmeasured**, and if it is false, chunking a profile breaks the
   per-profile atomicity criterion 4 depends on. Is the compensation design sound, and is the residual
   ("a kill during compensation leaves a visible partial profile") acceptable?
4. **The starter-profile cleanup** deletes a profile under four conditions (sole profile, `is_default=1`,
   empty across all seventeen tables, still carries the starter name). It exists because
   `deleteProfile` refuses to delete the default (`profileRepository.js:112`), so a fresh-install merge
   restore would otherwise strand an undeletable empty profile. **This is the only deletion in the design.**
   Can it fire when it should not? Are four conditions the right four?
5. **Merge-only restore is claimed sufficient for real recovery**, with destructive replace deferred. Is
   that wishful? Consider a user restoring onto a device that already has a partially-rebuilt profile.
6. **Web Crypto availability** (Assumption 2) gates the integrity design. If `crypto.subtle` is unavailable
   the design fails the backup loudly rather than writing an unverifiable file. Is failing loudly right, or
   is an unchecksummed backup better than none?

### D. Increment B - the claims that carry the device risk

1. **"`src/store/db.js` needs no change"** rests on the 6.0.2 and 8.1.1 `definitions.d.ts` being
   byte-identical. The **Java changed** (SQLCipher package rename, `System.loadLibrary`, extra `null` args,
   a removed `catch (SQLiteException)` around `setVersion`). Is JS-surface identity sufficient evidence for
   a no-change claim about a storage layer? I called the removed catch "a louder failure mode, not a new
   one" because `user_version` is already 11 - check that.
2. **The ProGuard keep is on `net.zetetic.database.**`**, the parent package rather than `.sqlcipher.**`,
   because the library also registers natives against `net.zetetic.database.CursorWindow` and a narrower
   rule would launch fine then fail on a large result set. Is the parent package sufficient **and**
   correct? Does the new artifact resolve anything outside `net.zetetic.database`?
3. **Predictive back.** Both `@capacitor/app` v6 and v8 register an **always-enabled**
   `OnBackPressedCallback` on the `OnBackPressedDispatcher`. I concluded the mechanism is already correct
   for target 36. But an always-enabled callback means the system never runs its own back-to-home
   prediction. Does that interact badly with `src/back.js`'s LIFO consumer registry or `navBack.js`'s
   precedence table? Device row 7 is the check; is it the right check?
4. **Edge-to-edge has no opt-out at target 36.** The shell already insets via `env(safe-area-inset-*)` at
   target 35. Is "already inset-aware" actually equivalent to "correct under enforcement", or is there a
   class of difference I am waving through?
5. **The portrait claim.** `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` on `<application>` is claimed to
   hold portrait at target 36 on >= 600dp displays, with phones exempt from the override entirely. Verify
   the property name, its placement, and that an application-level declaration covers `ScannerActivity`.
6. **The 16 KB proof method** is `zipalign -c -P 16` plus `llvm-readelf -l` over every extracted
   `lib/arm64-v8a/*.so`. Is that sufficient, and is anything about the AAB path different?
7. **Rollback rests on `adb install -r -d`** downgrading to the archived baseline APK while preserving data.
   I rated that High confidence on the grounds that the signing key matches and no schema change occurred.
   Confirm or refute.
8. **Scope attributability.** The owner has decided this is one increment. My mitigation is ordering: ten
   individually gated steps, web tier first. Does that ordering actually preserve attributability, or is
   there a coupling that makes step N's failure indistinguishable from step N-3's? Increment 3 is where the
   Capacitor packages, AGP, Gradle, Java, androidx and target 36 all land together - that is the step I am
   least able to decompose further and would most like a second opinion on.

### E. The audit's three "blocked" conclusions

Each one is a decision not to upgrade. Attack them:

1. **AGP 9 blocked** because all ten vendored Capacitor Gradle modules use `lintOptions`. Is
   `android.newDsl=false` a viable bridge, or correctly rejected?
2. **TypeScript 7 blocked** because it ships without a stable programmatic compiler API and
   `scripts/check-types.mjs` drives `ts.createProgram`. Is the `@typescript/typescript6` compatibility
   package a viable path that I dismissed too fast?
3. **ONNX Runtime pinned** because a kernel change could shift int8 embeddings against a prebuilt prototype
   index, with no gate that would catch it. Is that a real risk or am I being over-cautious about a library
   whose only inputs are our own bundled model and our own camera frames?

### F. What I did not do

Called out so it is reviewed as an omission rather than assumed covered: I audited **direct** dependencies
only. `npm audit` was not run, transitive npm dependencies were not reviewed, and transitive Gradle
dependencies were noted but not assessed - including `androidx.security:security-crypto:1.1.0-alpha06`, an
**alpha shipping in our release build** via `@capacitor-community/sqlite`.

## Finding format

Per `AGENTS.md` §5:

```markdown
### [Blocker|Major|Minor|Suggestion] <short title>
- Evidence: `<path>:<symbol or line>` and observed behavior
- Failure scenario: <specific trigger and sequence>
- Consequence: <user/system impact>
- Required outcome: <property that must be achieved, not mandated code style>
```

Please issue a disposition per document: **Approved**, **Approved with non-blocking follow-ups**, or
**Changes required**. If a document is sound, state what was checked and why the evidence suffices;
"looks good" is not a review.

## What happens next

I will respond to every actionable finding as **accepted**, **resolved**, **rebutted with evidence**, or
**deferred by human decision**, and produce a revision that calls out the deltas. Unresolved material
disagreements go to the owner as a joint decision brief rather than being settled between us.

---

# Round 1: findings and dispositions

**Codex disposition (2026-08-10):** Changes required on all four documents.
**Author response:** every finding **accepted**. No rebuttals, no deferrals. Four documents revised in one
pass; no new proposals created.

Two findings were verified against external evidence before acceptance, because accepting a wrong blocker is
as damaging as rejecting a right one. Both held, and one is sharper than reported.

| # | Finding | Disposition | Where it landed | Evidence |
|---|---|---|---|---|
| **B1** | Backup export is not a consistent snapshot | **Accepted** | `backup-and-restore.md` -> "Backup must read a consistent snapshot"; criterion 2; Stage 3; concurrency regression test | Confirmed: `exportProfile` (`profileTransfer.js:29-64`) is sequential `query()` with nothing protecting it |
| **B2** | Restore is not atomic across profiles | **Accepted** | Options H/J rewritten; **one transaction** for all restoration, `_meta` journal + startup recovery as the measured fallback; in-memory compensation **deleted**; criterion 6 now says "process-death safe" | The internal contradiction was real: criterion claimed atomic, design accepted a permanent partial |
| **B3** | Lifecycle 2.11.0 incompatible with the approved stack | **Accepted, and confirmed sharper than reported** | `capacitor-8-upgrade.md` -> Lifecycle **2.10.0**; new both-sides compatibility table | AAR metadata: `lifecycle-*-compose-android:2.11.0` declares `minCompileSdk=**37**`, `minAGP=**9.1.0**` (Codex said AGP 9.2; the true figure is 9.1.0, and the compileSdk 37 floor is the harder stop). 2.10.0 declares 35 / 8.6.0 |
| **B4** | The rollback rehearsal does not prove rollback | **Accepted** | New "The rollback artifact: a forward-installable baseline". Downgrade semantics abandoned; rollback build is baseline source at a `versionCode` *above* the upgrade, installed before B begins; uninstall + verified restore documented as the second path | Self-evident on inspection: installing an APK over an identical copy exercises the same-version update path |
| **M1** | Starter-profile deletion unreachable and unsafe | **Accepted** | Option R3 **withdrawn**, replaced by R4: adopt the restored default, delete nothing. Criterion 7 now states no code path deletes a profile, with a test asserting it | Confirmed: `createProfile()` always writes a `settings` row (`profileRepository.js:73-74`), so "empty across all seventeen tables" is unsatisfiable |
| **M2** | Backup integrity and bounds incomplete | **Accepted** | Digest now covers the **whole canonical envelope except `digest`**; explicit file/profile/table/row bounds before parse and write; exactly-one-default and active-index cardinality validated. Criteria 3 and 4 | The reason revision 2 excluded `exportedAt` was the change-gate, which was cut with the scheduler - so the exclusion had no remaining justification |
| **M3** | Backup success cannot mean "stored" | **Accepted** | "Backup prepared" / "last prepared"; no durability claimed; a "stored" claim only if a future increment can read the destination back | Confirmed: `saveTextFile` (`native.js:65-79`) catches share dismissal and returns `'shared'` regardless |
| **M4** | Round-trip coverage must precede `importProfile` extraction | **Accepted** | New **Stage 1** writes characterization tests for both recorded bugs plus the schema-derived all-table sentinel round trip **against unmodified code**, before the Stage 4 extraction | I had flagged the narrow completeness test against myself; Codex required the stronger form and the ordering |
| **M5** | Build gates do not cover shipping artifacts | **Accepted** | Both gates bind to `assemble` + `bundle` + `install`; failure **provoked on all three**; AAB 16 KB-verified with `bundletool` in Increment 7 | I raised the `bundleRelease` gap in the brief; Codex extended it to the pre-existing permission gate, which has the same hole today |
| **M6** | The audit overstates vendor support and completeness | **Accepted** | Tier 1 rebuilt from each artifact's own `minCompileSdk`/`minAGP`; Compose/Kotlin coupling **retracted**; Cordova -> 15.1.0; scope restated as direct-only; resolved-dependency + advisory review added to Increment B | Cordova confirmed: 14.0.x supports API 24-35, 15.0.x supports 24-36. Compose confirmed independent: BOM 2026.06.01 members require only sdk34-35 / agp8.1.1-8.6.0 |
| **M7** | Several "blocked" and provenance claims too strong | **Accepted** | TS7 and AGP9 reclassified as **deliberate deferrals** with escape hatches named. **ONNX pin claim retracted as a factual error** | `requirements.txt` pins neither `onnx` nor `onnxruntime`. I read `pip list` (installed state) and reported it as a pin. Pinning them is now an owed follow-up |
| **Rec** | Two internal checkpoints in Increment 3 (target 35, then flip 36) | **Accepted** | Increment 3 split into **3a** (everything except targetSdk, which stays 35) and **3b** (flip to 36 alone) | - |
| **Rec** | `db.js` no-source-change hypothesis needs a clean database too | **Accepted** | Device matrix row 1b: cold launch on a **clean install**, exercising first-run creation and the full v1..v11 migration replay under the new plugin | - |

## The pattern behind B3, M6 and the earlier Kotlin error

Three separate findings share one root cause worth naming: I justified versions by **who ships them**
rather than by **what they require**. That produced Kotlin 2.2.20 (unsupported under AGP 8.13.0),
Lifecycle 2.11.0 (unbuildable at compileSdk 36), and Cordova 14.0.1 (does not support API 36) - all three
from the same Capacitor 8 template, all three wrong for the same reason.

The repair is not three version bumps but a method change: **every Android dependency is now selected by
reading its own published floor**, with the template demoted to a starting suggestion. The both-sides table
in `capacitor-8-upgrade.md` is that method made checkable, and it immediately paid for itself by also
justifying `androidx.core` 1.17.0 on evidence (1.19.0 requires compileSdk 37) rather than on deference.

## Revised documents

| Document | Revision | State |
|---|---|---|
| `backup-and-restore.md` | **Revision 3** | B1, B2, M1, M2, M3, M4 |
| `capacitor-8-upgrade.md` | **Revision 4** | B3, B4, M5, M6, plus both recommendations |
| `dependency-audit-2026-08.md` | **Revision 2** | M6, M7 |
| `WORK_IN_FLIGHT.md` | Synced | Lifecycle, Cordova, ONNX/TS7/AGP9 wording, rollback, gates, new toolchain-pinning item |

`npm run check:docs` - PASS. No production or build code modified.

---

# Round 2: findings and dispositions

**Codex disposition (2026-08-10):** Changes required on four documents, scoped as a documentation repair
rather than another architectural round.
**Author response:** all four findings **accepted**. No rebuttals. One pass, no new proposals, no design
work beyond what the two logic bugs forced.

| # | Finding | Disposition | Where it landed |
|---|---|---|---|
| **B5** | Rollback sequence is not executable: rollback 217 installed before upgrade 216 would require the abandoned downgrade to proceed | **Accepted** | `capacitor-8-upgrade.md` -> rollback artifact now carries the **same `versionCode` as the upgrade**, so `adb install -r` flips either way as an ordinary same-version reinstall. Rehearsal moved **into** the device pass, against the real upgrade APK. Increment 0 archives but does not install. A now supplies the rollback *source baseline*, not the binary |
| **B6** | Backup and restore hash different canonical documents | **Accepted** | `backup-and-restore.md` -> one named preimage, `unsigned` = envelope **including** `integrity.algorithm`, **excluding** `integrity.digest`. Writer and reader both hash exactly that. Option F rewritten to say so |
| **M8** | Superseded instructions remain normative in later sections | **Accepted** | Semantic sweep across all four documents; duplicated Stage 4/5 renumbered to 6/7 |
| **M9** | AAB 16 KB verification incomplete | **Accepted** | Increment 7 now requires **`bundletool dump config --bundle`** to report `"alignment": "PAGE_ALIGNMENT_16K"`, **plus** ELF/alignment checks across **every** delivered arm64 split APK |

## Stale text corrected

| Document | Was | Now |
|---|---|---|
| `backup-and-restore.md` | Option F: provenance "outside the hashed payload" | The `unsigned` preimage covers it |
| | Rollback table: "the single deletion is the starter-profile cleanup" | No profile-deletion path exists at all |
| | Emulator step 3: "no empty starter profile remains" | Starter remains, non-default, user-deletable |
| | Self-critique: assessed per-profile transaction sizing | Assesses the single-transaction assumption and the journal fallback |
| | Stages 4 and 5 each appeared twice | Renumbered to 6 and 7 |
| `capacitor-8-upgrade.md` | Intro: AGP 9 / TS 7 "unavailable to us" | Deliberate deferrals with named triggers |
| | Non-goals: "coupled to the training venv's `onnx==1.22.0`" | Neither package is pinned; recorded as owed work |
| | Increment 0: "downgrade rehearsed" | Artifact archived, not installed; rehearsal is Increment 9 |
| `dependency-audit-2026-08.md` | §8: venv "well pinned", "`onnx==1.22.0` pin" | Partly pinned; onnx/onnxruntime absent |
| | Summary: "Kotlin ↔ Compose BOM" listed as coupled | Retracted; independently versioned |
| | Summary: three "open decisions for the owner" | All three resolved, with the answers |
| `WORK_IN_FLIGHT.md` | Cordova "stays at Capacitor's 14.0.1" | Moves to 15.1.0 in Increment B; not a deferral |
| | Rollback "installed before B starts" | Same-`versionCode` replacement, exercised in B's device pass |

## Note on B5 and B6

Both are the same class of defect and worth naming: **a correct principle applied without simulating the
sequence.** Revision 4 correctly abandoned downgrades, then wrote an ordering that required one. It
correctly widened the digest to cover provenance, then had the writer and reader hash different documents.
Neither is a design disagreement; both are what happens when a fix is written but never traced end to end.

The repair in each case is to name the thing explicitly and use the name on both sides - one `unsigned`
preimage, one monotonic install sequence written out step by step - so the next reader can check it by
reading rather than by simulating.

`npm run check:docs` - PASS. No production or build code modified.


---

# Round 3: findings and dispositions

**Codex disposition (2026-08-10):** `dependency-audit-2026-08.md` **Approved**. `WORK_IN_FLIGHT.md`
**Approved**. Two proposals: changes required, **stale active instructions only** - "not another design
round". Architecture declared approval-ready once the sweep completes.
**Author response:** finding **accepted in full**. This was a real miss, not a labelling quibble.

## What I got wrong in round 2

I swept the *prose* and left the *operative* sections intact. That is the worse half: a reader following the
acceptance criteria, the prerequisite list, the rollback table, Assumption 9, or Increment A's handoff would
have implemented the superseded design and never reached the corrected central sections. Codex's failure
scenario - "Claude follows the prerequisite instead of the newly corrected central sections" - is precisely
what would have happened.

Recorded for future rounds: **after a design correction, sweep the sections that give instructions**, not
the ones that give explanations. Acceptance criteria, prerequisites, assumption tables, risk tables,
rollback tables and stage handoffs are where a stale sentence becomes a stale action.

## Corrections applied

| Document | Section | Was | Now |
|---|---|---|---|
| `capacitor-8-upgrade.md` | Programme intro | A's APK is B's rollback binary | A supplies the **rollback source baseline**; B builds the binary at its own `versionCode` |
| | **Acceptance criterion 1** | 16 KB proven on the assembled release APK | APK **and** AAB: `bundletool dump config` reporting `PAGE_ALIGNMENT_16K`, plus every delivered arm64 split |
| | "How 16 KB is verified" note | "static, against the assembled release APK" | "static, against both shipping artifacts" |
| | Prerequisite item 3 | Rollback artifact proven to install before B | Rollback **source baseline** identified; binary built in Increment 0, exercised in Increment 9 |
| | Assumption 9 | Forward install, higher `versionCode`, proven before B | **Same-`versionCode`** reinstall, reversible either way, proven in Increment 9 |
| | Rollback table | "Forward install ... installed before B begins" | "Same-version reinstall ... Increment 9, against the real artifacts" |
| | Point of no return / residual | "undone by the rehearsed downgrade" | No one-way step; upgrade and rollback share a `versionCode` |
| | Owner decision 4 | A's APK is the archived rollback binary | A supplies the source baseline; B builds the binary |
| `backup-and-restore.md` | Programme intro | A's APK becomes B's rollback binary | **A does not produce B's rollback binary**; it hands over the backup and the source baseline |
| | Stage 7 handoff | "That artifact is Increment B's rollback binary" | Two distinct handoffs: the backup file, and the source-baseline commit by SHA |
| | Risk 3 | "Stage 2's refactor" | **Stage 4's** refactor, guarded by **Stage 1's** characterization tests |
| | Risk 7 | Measured "in Stage 4" | Measured in **Stage 0**, before any feature code exists |
| | Open decision 1 | Merge + default adoption + **starter cleanup** | Merge + default adoption, **no deletion path of any kind** |

Revision headers bumped: `backup-and-restore.md` to **Revision 4**, `capacitor-8-upgrade.md` to
**Revision 5**, each with a table recording what the round changed. The one superseded fact that remains -
revision 4's higher-`versionCode` rollback - is labelled as superseded in place, per Codex's allowance for
clearly-marked historical facts.

## Verification of the sweep

Grepped both proposals for the operational wording of the superseded design: `rollback binary`,
`before B begins`, `before B starts`, `higher versionCode`, `versionCode above`, `Forward install`,
`rehearsed downgrade`, `starter cleanup`, `Options / R3`, `proven to install`, `assembled release APK`.
Every surviving hit is one of: a negation ("**A does not produce** B's rollback binary"), a correct
statement, or a revision-table row labelled superseded. **No active instruction prescribes the old design.**

`npm run check:docs` - PASS. No production or build code modified.

---

# Approval

**Human project owner: APPROVED, 2026-08-10.** Recorded in the approval record of both proposals.

Codex's final disposition was *conditionally* approval-ready pending this sweep. The sweep is complete;
**Codex has not re-inspected it**. Per `AGENTS.md` §4 the remaining gate is unaffected: Codex reviews the
actual implementation diff independently when it exists.

**Next action:** Increment A, Stage 0 - the two measurements that gate the design (restore statement-set
size against the owner's real data, and Web Crypto availability in the WebView), reported as a checkpoint
before any feature code is written.
