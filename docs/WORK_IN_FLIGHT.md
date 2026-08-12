# Work in flight

The ledger of **unmerged branches** - what each one is, where it stopped, and what it needs to finish.
Git records what changed; this records **what is left and how to resume**. Without it, a branch that was
"paused for one quick thing" becomes an orphan nobody can safely delete or restart.

**Keep it honest:**

- Add a row when a branch starts; delete the row when it merges to `main`.
- Update **Next step** whenever work pauses - that is the whole point of the file.
- Verify before trusting: `git log --oneline main..<branch>` shows a branch's unique commits, and
  `git merge-base --is-ancestor <a> <b>` proves whether one branch is already contained in another.
- A branch fully contained in another (0 unique commits) is safe to delete; say so in **Status**.

## Open

### `capacitor-8` - Increment B, Capacitor 6 -> 8 + Android 16 + whole-tree dependency upgrade

**Status:** ACTIVE, started 2026-08-10. Proposal
[proposals/capacitor-8-upgrade.md](./proposals/capacitor-8-upgrade.md) (Rev 5), owner-approved.
**Increment 0 DONE:** branch created off `main` at the Increment A merge; rollback artifact built from
the baseline SHA `b66289e` and archived as `dist-apk/compendium-rollback-b218.apk`, signing certificate
verified equal to the baseline's. Build is at **218**.
**Recorded refinement:** the rollback APK is **disposable** - it must be rebuilt from `b66289e` at
whatever `versionCode` is installed at the moment it is needed, because B's build number climbs as it
iterates and a frozen artifact would become a downgrade. The SHA is the asset, not the APK.

**Increments 1-9 DONE (2026-08-10).** Web tier, Kotlin 2.4.10 + Compose compiler plugin, Capacitor
6 -> 8 with the whole toolchain (3a) then targetSdk 36 alone (3b), CameraX/Firebase, the manifest
checklist and Gradle syntax, R8 keeps and gate bindings, the static 16 KB proof, the full gate set, and
device install + rollback rehearsal on the Pixel 9 Pro XL.

**The blocker is closed.** Every arm64 library in both the APK and the AAB is 16 KB aligned,
`libsqlcipher.so` included; `bundletool dump config` reports `PAGE_ALIGNMENT_16K`. APK is 357,575 bytes
SMALLER than the pre-upgrade baseline. Gates: 1,246 tests, 0 failures, 12/12 green, `check:smoke` 8/8
routes. Rollback proven bidirectional with data identical (1832 cards / 4 decks / 9 matches) at every
step.

**Three latent defects found and fixed**, each a control that read correctly while protecting nothing:
R8 keeps still naming `net.sqlcipher.*` after the package moved to `net.zetetic.database.*` (a
release-only launch abort); the forbidden-permission gate bound to `assemble*` only, leaving the AAB
that Play distributes entirely ungated; and `checkRecogAssets` fail-open on an AGP-internal task-name
pattern. Also found: `MainActivity` never declared `screenOrientation`, so the app rotated despite
being "portrait-only" - owner confirmed the lock.

**Device pass done by the owner:** the scanner was exercised end to end and works; navigation and search
are perceptibly faster.

**>= 600dp check: DONE 2026-08-12, and it changed the decision.** Run on a Lenovo TB321FU (Android 16,
arm64, 640dp smallest width), both with and without the opt-out property, device forced to landscape:
**with** it `ROTATION_0` / 1600x2560, **without** it `ROTATION_90` / 2560x1600 full screen. The control
is what makes it evidence rather than an observation - it proves the tablet genuinely enforces the
Android 16 override at target 36.

Seeing it on hardware, the owner reversed the goal: a letterboxed phone-shaped app on a 12-inch screen
is worse than either alternative. **`PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` is now REMOVED** -
phones stay portrait (exempt from the override), tablets rotate full screen. The implementation is a
deletion, and it retires the API 37 expiry the property carried.

**Caveat:** the opt-out is application-level, so the scanner cannot be pinned to portrait while the app
rotates. On a tablet `ScannerActivity` rotates too - it works (recognised a real card in landscape,
zero camera errors) but its sheets are portrait-designed. Landscape layout remains a non-goal and a
recorded follow-up.

**Phone half VERIFIED 2026-08-12** on the Pixel 9 Pro XL with landscape forced: `ROTATION_0`, app
renders 1344x2992 portrait. Both sides of the split are now measured rather than reasoned - phone
locked, tablet free.

**Codex round 1: "Changes required" - all four Majors and the Minor now addressed** (response in the
packet). The two findings worth remembering:

- **The forbidden-permission gate was STILL bypassable** after I had already "fixed" it once.
  `installRelease` depends on `packageRelease`, not `assembleRelease`. Both earlier bindings attached to
  convenient LIFECYCLE names instead of the tasks that write the artifact. Now bound to
  `package<Variant>` / `package<Variant>Bundle`, so coverage is complete by construction; all six entry
  points verified, and provoked-negative on the three producers.
- **`androidxCoreVersion` was referenced by nothing** - a dead knob whose comment read like a decision
  while the release graph shipped `androidx.core:core` 1.18.0. Adopted 1.18.0 and declared it; the
  resolved 228-module graph is now recorded in the audit addendum.

Also: clean-install first-run DB creation proven on a temporary second Android user (real arm64 minified
release APK, empty sandbox); backup under plugin 8.x proven against real data and diffed against the
pre-upgrade backup (every row count identical, exactly one `updated_at` differs); restore into a
never-used database verified with an independently recomputed digest; native SAF picker + on-device
digest + restore preview exercised without writing. npm advisories dispositioned by hand, critical
removed, production surface 0.

**Codex rounds 2 and 3 also closed.** Round 2: the recogniser gate had the SAME producer bypass I had
just fixed beside it - my six-entry-point table showed it PRESENT everywhere only because
`packageRelease` inherited it through the fail-open `merge.*Assets` line. Now producer-bound, proven by
disabling the opportunistic binding and re-checking. The wasm stripper now enumerates and classifies
every `.wasm` rather than searching for the expected name.

Round 3 was a **Blocker**: restore wrote the active id straight to Preferences, so the database,
Preferences and `profileRepository`'s in-memory `activeId` disagreed - the running process kept
writing the PRE-restore profile while the next launch was promised another. A profile-isolation break,
now reconciled through `switchProfile()`, with post-commit failures reported as caveats (a retry after
a committed restore re-imports the whole archive). Device-verified 2026-08-12 at full scale on the
owner's real archive (~1,476 statements): active profile and profile sheet both settle immediately, no
relaunch.

**Build is 219** (device install, standing rule). The archived rollback APK is at 218 and is therefore
now a downgrade - per the refinement above it is disposable and must be rebuilt from `b66289e` at the
installed `versionCode` when actually needed.

**Next step:** Codex round 4 sign-off on the updated packet
([proposals/capacitor-8-review-packet.md](./proposals/capacitor-8-review-packet.md)), then **merge**.
The >= 600dp check is now DONE (above). **One gap is deliberately carried:** `App.jsx` still has no
test coverage while this branch has modified it three times (BackupSection, the `rev` prop, the
restore-reporting branch). Nothing is pushed; `main` is
local-only and ~66 commits ahead of `origin`.

### `restore-semantics` - QUEUED, own branch, HIGH-RISK, needs a proposal first

**Status:** raised by the owner 2026-08-12 after watching a real restore. Not started. Not caused by
the Capacitor upgrade; it questions a decision made in Increment A.

**The owner's question, which is the real one:** a backup is a snapshot, and restoring a snapshot is
conventionally a REVERT - the state becomes the backup's state. Compendium's restore instead ADDS the
archive's profiles alongside what is already there, so restoring your own backup gives you two of
everything. That is not what "restore" means to most people, and the undeletable-profile symptom below
is a consequence of it rather than a separate bug.

**History, because this reverses an approved decision rather than filling a gap.** Additive was
deliberate in Increment A and survived three adversarial review rounds: "NOTHING IS DELETED. No
profile-deletion path exists." The reasoning was that a destructive restore on an offline-first app
with no cloud copy can annihilate data that exists nowhere else - restore an older archive by mistake
and everything since is gone, with no undo. Additive can never do that.

**The trade, stated plainly.** Additive is safe and surprising; replace is expected and destructive.
The mitigation that makes replace defensible is an automatic pre-restore snapshot written to app
storage (`Directory.Data`) - no share sheet, no picker, no user interaction - so a mistaken revert is
always undoable. Without that, replace is a data-loss feature.

**Symptom that surfaced it:** after ANY whole-app restore the user keeps a profile they can never delete.

**Mechanism, and the correct half first:** `restoreAll` adopts the archive's default in the same
transaction as the rows, so the database is never momentarily without a default or with two. That part
is deliberate and right. The consequence is not: the imported profile now holds `is_default`,
`deleteProfile()` refuses to delete the default (`profileRepository.js` - "The default profile cannot
be deleted"), and **nothing in the app can move the flag**. `ProfileSheet` reads `is_default` only to
hide the Delete button; there is no "set default" action anywhere in the UI.

The user's original starter is demoted to non-default and stays deletable, while the imported copy is
permanently stuck at the top of the profile picker. The only escape through the UI is to delete the
ORIGINAL and rename the import - which is what was done on the owner's device to restore its prior
state, and is not something a user should have to work out.

**Owner decision 2026-08-12: REPLACE ONLY**, with the pre-restore snapshot, the one-transaction
property and the rewritten confirm copy all agreed. Proposal drafted at
[proposals/restore-semantics.md](./proposals/restore-semantics.md); awaiting Codex review, then
implementation.

**Why a proposal and not code.** This is High-risk under the constitution - it makes restore a
destructive user-data operation and touches the transactional-integrity and profile-isolation
invariants. The proposal must settle:

1. **Replace or merge, and is it a choice?** A single "Restore (replace everything)" is honest and
   simple. Offering both on the confirm screen is more capable and doubles the ways to get it wrong.
2. **The automatic pre-restore snapshot** - mandatory if restore becomes destructive. To
   `Directory.Data`, before the transaction, with a visible way back.
3. **One transaction still.** Delete-then-insert must commit or change nothing, or a failed restore
   leaves the user with neither their data nor the archive's. This is the property the current design
   already has and the new one must not lose.
4. **The confirm copy**, which currently promises the opposite: "These profiles are added alongside
   what is already on this device. Nothing is deleted or overwritten."
5. **Whether the default flag still transfers** - the undeletable-profile symptom disappears under
   replace semantics, so this may need no separate fix. If merge survives as an option, it does: add a
   set-default control to the profile sheet.

### `art-fade-fix` - QUEUED, own branch after `capacitor-8` merges

**Status:** diagnosed 2026-08-10, not started. Owner decision: do it after the upgrade merges, as its own
branch, so the Capacitor diff stays purely toolchain for Codex.

**Symptom:** card art appears to reload on every pillar switch.

**It is not a caching failure and not an upgrade regression.** `git diff main..capacitor-8` touches no art
file. `artCache.resolved` (`src/store/artCache.js:42`) is a module-level session memo that survives pillar
switches, and `peek()` returns it synchronously, so nothing is re-downloaded.

**Actual cause:** `ArtImage` holds `loaded` in COMPONENT state (`src/components/ArtImage.jsx:68`). A pillar
switch unmounts the pillar, so on return `loaded` resets, `shown` is false, and line 82 paints the `<img>`
at `opacity: 0` behind a shimmer with a `.3s` transition - for every card, every time. The bytes are local;
only the animation re-runs. Faster post-upgrade navigation made it more noticeable.

**Measured on device (Pixel 9 Pro XL, build 218):** returning to Home with art already cached, deck panels
are black at t=0, fully painted by 400ms, byte-identical at 400ms and 1.9s. A CDN round trip would be
neither that fast nor that consistent.

**Next step:** when `peek()` already supplies the candidate at first render, or the `<img>` reports
`complete` on mount, paint at full opacity with no shimmer and no transition. Guard against the reverse
regression - a genuine first load must still shimmer and fade - and cover both in `artSource`-level tests.

### `android-16kb-compat` - DO NOT MERGE

**Status:** superseded. Its single useful commit was cherry-picked onto `card-recogniser` and is now in
`main`; the branch itself diverged before later scanner work, so merging it would REGRESS the scanner.
**Next step:** delete it.

### `catalog-update-pipeline` - catalog drop + one-command update process

**Status:** PARKED since 2026-07-17 with ~30 unmerged commits. The oldest orphan; confirm it is still
wanted before investing.
**Next step:** review what remains relevant (README, `.gitignore` hardening for signing secrets, catalog
recovery runbook), then either finish and merge or close it out deliberately.

## Post-merge follow-ups (card recogniser, agreed with Codex)

Merged to `main` 2026-08-09. None of these blocks release of what shipped, but each is owed:

- **Sealed auto-confirm evidence.** The bar is fixed and finite: >= 150 independent auto-confirmed capture
  sessions with ZERO wrong identities, >= 75% auto-confirm coverage, >= 30 invalid/multi-card scenes with
  zero auto-confirms, sessions as the unit, thresholds frozen before the sealed set is opened. Sealed v1 was
  consumed as development data, so this needs a fresh collection. Until it exists, auto-confirm ships on a
  reasoned rule plus device evidence, not a measured false-confirm bound.
- **Accessibility matrix** - TalkBack, reduced motion and short layouts on device. Semantics and
  reduced-motion paths are written but unverified by a real screen reader.
- **Release peak-memory measurement** on the signed build.
- **Licences and attribution** for DINOv2 (Apache-2.0) and ONNX Runtime.
- **Capacitor 8** - closes `libsqlcipher.so`, the last library failing the 16 KB check. High-risk: a major
  SQLite plugin upgrade against a live v11 schema holding real user data.

## Planned, not started

### Increment B - Capacitor 6 -> 8, Android 16, and the whole-tree dependency upgrade

**READY TO START.** Increment A merged 2026-08-10 (`b66289e6a6f1`) and Stage 7 handed over:
rollback source baseline = that SHA; baseline APK `dist-apk/compendium-baseline-b217.apk`
(versionCode 217, on the device); signing cert SHA-256 `c64bbee422da9fc4...`;
verified backup `dist-apk/compendium-baseline-backup-b216.json`.

**Proposals:** [proposals/capacitor-8-upgrade.md](./proposals/capacitor-8-upgrade.md) (Rev 5, owner-approved),
with [proposals/dependency-audit-2026-08.md](./proposals/dependency-audit-2026-08.md) as the evidence base.
**Why:** closes `libsqlcipher.so`, the last 16 KB library, and future-proofs the target API level.
**Scope (owner decision 2026-08-09: one job, everything folded in):** Capacitor 6 -> 8, target/compileSdk
36, Java 21, Kotlin 2.4.10 + Compose plugin, AGP 8.13.0 / Gradle 8.14.3, the Capacitor 8 androidx set,
CameraX 1.6.1, Firebase BoM 34.17.0, Lifecycle **2.10.0** (not 2.11.0 - it requires compileSdk 37/AGP 9.1),
Cordova framework **15.1.0** (not the template's 14.0.1 - 14.x tops out at API 35), plus the web tier -
React 19, Vite 8 + plugin-react 6, static-copy 4, sql.js, qrcode-generator 2, sharp, firebase-tools.
**Risk:** High. Schema v11 and `MIGRATIONS` stay unchanged throughout.
**Rollback:** a **same-`versionCode`, same-key replacement** - baseline source rebuilt at B's own
`versionCode`, so `adb install -r` flips between upgrade and rollback in either direction as an ordinary
same-version reinstall. The `adb install -r -d` downgrade path is **not** relied upon. The artifact is built
and archived at the start of B and exercised inside B's device pass against the real upgrade build; A
supplies the rollback *source baseline*, not the installable binary.
**Gates:** `checkRecogAssets` and `checkReleaseForbiddenPermissions` bind to `assemble` + `bundle` +
`install`, not `assemble` alone; the AAB is 16 KB-verified with `bundletool`.

## Compose material-icons is a frozen dependency the scanner now declares

Increment 2 surfaced it: `Icons.Filled.*` in `RecognitionSheet.kt` and `ScannerScreen.kt` used to
resolve only because **material3 1.2.1 depended on `material-icons` transitively**. material3 1.4.0
dropped that, so the symbols vanished the moment the Compose BOM moved. It was always a real
dependency of the scanner UI and is now declared explicitly.

Google has **frozen** that library - the BOM pins it at 1.7.8 and it is deprecated. Six icons are used
across two files (Add x5, Check x3, FavoriteBorder x2, Close x2, Search, PlayArrow). Inlining them as
vector paths would drop the dependency entirely, and there is precedent: the web layer already has its
own set in `src/components/icons.jsx`. **Feature work, not an upgrade** - recorded rather than done.

## App.jsx has no automated coverage - found the hard way

While retiring the Export/Import buttons I broke `App.jsx` with an unclosed JSX comment, and **all six
`node --test` gates reported PASS while the app did not compile**. `test:ui` covers `src/pillars/**`
and `src/components/**`; nothing imports `App.jsx`. Only `npm run build` caught it, and only because
esbuild refused to parse the file.

`App.jsx` is ~1,900 lines carrying the shell, tab routing, hardware-back dispatch, the profile sheet,
Settings and now the Backup surfaces. Its entire automated protection is "does it parse".

**Not a proposal yet, but the vehicle already exists:** the UI-state extraction pattern (pure,
DOM-free modules under `test:ui`) is how `matchLife`, `navBack` and the alphabet rail were made
testable. The same treatment applied to the App shell's state would close this. Worth doing before
the shell grows again.

## Owner direction 2026-08-10

### Retire the per-profile Export / Import UI - DONE

Done on the `backup-and-restore` branch (2026-08-10), owner decision taken inline. Small Standard
change; no schema, no stored data, no capability lost - Restore already reads legacy export files via
`readBackup`'s shape routing.
Removed: the two buttons, their handlers, the now-callerless `exportToFile` / `pickAndImport`, the
then-unused `saveTextFile` import and two orphaned icon definitions.
**Kept, deliberately:** `exportProfile` / `importProfile`. `duplicateProfile` is built on them and the
whole-app restore routes legacy files through `importProfile`.
Verified on device (build 217): the profile sheet is now New profile -> Settings.

### Prompt for, or automate, backups - with a user-designated directory

**Why (owner):** users should not be nagged, and **an uninstall should stop being destructive**. A
first-launch prompt to designate a directory means backups can happen without asking again.
**This deliberately re-opens what Increment A cut.** The SAF folder picker, the scheduler and
retention were all explicit non-goals of A's MVP, on the owner's own "leanest first" directive. That
was the right call for A and this is a legitimate next step - but it is a **new increment**, not an
extension of A, and it needs its own proposal and Codex round.
**What it actually requires:** a native plugin for `ACTION_OPEN_DOCUMENT_TREE` + persisted URI
permission (`@capacitor/filesystem` cannot write tree URIs), a scheduler, and retention - unattended
writes accumulate, so rotation stops being optional the moment writing is automatic.
**The prize, precisely:** it is what would let the app honestly say **"stored"** instead of
"prepared". Today `saveTextFile` cannot observe where the file went, which is why the UI refuses to
claim durability. With a persisted tree URI the app can read the file back and verify it - the claim
becomes true rather than hopeful.
**Classification:** High-risk - new native plugin, new pattern, new scheduling surface.
**Sequencing recommendation (owner's call):** **after** Increment B. A native plugin written against
Capacitor 6 would be rewritten against Capacitor 8 within weeks; doing it after means writing it once,
against the toolchain it will live on.

## Deferred upgrades - with the trigger that unblocks each

Recorded so they are decisions with conditions rather than things nobody looked at. Full evidence in
[proposals/dependency-audit-2026-08.md](./proposals/dependency-audit-2026-08.md).

### AGP 9 / Gradle 9 - the one with a real deadline attached

**Held at:** AGP 8.13.0, Gradle 8.14.3 (Capacitor 8's declared baseline).
**Deferred, not impossible.** AGP 9 offers temporary opt-outs (`android.newDsl=false`, built-in-Kotlin
escape hatches), but all ten vendored Capacitor Gradle modules use `lintOptions` and the legacy DSL AGP 9
removed, and those opt-outs are themselves being withdrawn - so adopting it now buys a migration we would
immediately redo, on modules we cannot patch.
**Cost of waiting:** AGP 8.13 caps compileSdk at 36. **Targeting API 37 requires AGP 9**, and API 37 is
also when the `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` opt-out that holds this portrait-only app
portrait on >= 600dp displays is removed. Those two land together and should be planned together.
**Trigger:** Capacitor ships modules on the AGP 9 DSL, or we need to target API 37 - whichever comes first.

### TypeScript 7

**Held at:** 6.0.3.
**Deferred, not impossible.** TS 7.0 ships without a stable programmatic compiler API, and
`scripts/check-types.mjs` drives `ts.createProgram` directly. Microsoft's `@typescript/typescript6`
side-by-side package would let us move today, but carrying a shim until 7.1 buys nothing.
**Cost of waiting:** low. `skipLibCheck: true` already mutes most third-party type drift.
**Trigger:** TypeScript 7.1 ships its API. That is a **rewrite** of `check-types.mjs`, not a version bump.

### ONNX Runtime

**Held at:** 1.22.0 (latest 1.28.0).
**Blocked by:** the device runtime, the recogniser export toolchain, and the shipped `index.f16` prototype
index are one unit. **Correction:** an earlier note here claimed `requirements.txt` pins `onnx==1.22.0`. It
does not - **neither `onnx` nor `onnxruntime` is pinned there at all**, so the export toolchain is currently
unpinned. Pinning them is owed regardless of any version change.

The loader validates the index file's sha256/dim/count - that is
integrity on the index, **not parity on the model's outputs**. An int8 kernel change could shift embeddings
and degrade retrieval with no gate catching it.
**Cost of waiting:** missed inference performance; no security patches to a native library - though its only
inputs are our own bundled model and our own camera frames, so the exposure is small.
**Trigger:** the **sealed auto-confirm evidence** collection already owed above. That run produces the
measured retrieval baseline an ORT bump needs, so bump it then and not before.

### androidx held below latest - by the artifacts' own requirements

Not template deference: each was checked against its published `minCompileSdk` / `minAGP`.
`core` **1.17.0** because 1.19.0 requires compileSdk 37 + AGP 9.1.0. `lifecycle-*-compose` **2.10.0**
because 2.11.0 requires the same. `webkit` 1.14.0 (latest 1.16.0) is unverified and not required.
**Trigger:** the AGP 9 / API 37 move above, which lifts all three at once.

### Pin the recogniser export toolchain

`scripts/recog/train/requirements.txt` pins neither `onnx` nor `onnxruntime`, so the exported model is not
reproducible from the recorded requirements. Owed independently of any ONNX version change, and a
prerequisite for the ONNX trigger above being meaningful.

Two related notes: `androidx.activity` will resolve to **1.13.0**, above Capacitor's declared 1.11.0,
because `activity-compose:1.13.0` requires it - Increment B declares that explicitly rather than letting
Gradle drift it silently. And `@capacitor-community/sqlite` pulls
**`androidx.security:security-crypto:1.1.0-alpha06`** - an alpha shipping in our release build. The code
path is unreachable (we never encrypt), it is not ours to fix, and it is recorded here so it is not
rediscovered as a surprise.

### Node

Node stays on the **24 LTS** line (latest is 26.x) deliberately - Capacitor 8's CLI needs >= 22 and nothing
needs 26.

(Cordova is **not** deferred: it moves to **15.1.0** in Increment B, because 14.0.x supports only API 24-35
and we target 36. The framework is unavoidable - `@capacitor/android`'s own runtime depends on it - even
though the bridge module contains zero Cordova plugins.)

### Backup features cut from Increment A's MVP

Scheduler, tiered retention, optional passphrase encryption, and the SAF folder picker were all deliberately
excluded (owner directive: leanest MVP first). **Encryption is the first one worth revisiting** - the bundle
carries opponent names, a social graph of third parties, in plaintext.

## Retired

- `scanner-phase2a` - OCR scanner hardening. Fully absorbed into `card-recogniser`; safe to delete.
