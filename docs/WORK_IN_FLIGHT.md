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

**Next step:** the manual device matrix that automation cannot cover - scanning a real card end to end,
the predictive-back gesture, and the **>= 600dp portrait check on a tablet or tablet emulator** (device
row 14, both with and without the opt-out property). Then Codex final review of the diff, then merge.
Nothing is pushed; `main` is local-only and ~66 commits ahead of `origin`.

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
