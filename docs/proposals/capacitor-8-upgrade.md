# Proposal: Capacitor 6 -> 8, Android 16, and the whole-tree dependency upgrade - Increment B

## Status and classification

**Revision 5.** Supersedes revision 4. Codex round 2 returned it as **Changes required** (rollback
sequencing, AAB proof, stale text); round 3 required a final semantic sweep of the active operational
sections. Both are applied here.
Status: **Draft, in review.** No production code changed.
Risk: **High** (Constitution §6).
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner.

High-risk on five triggers: native plugin and build configuration, a dependency change spanning every
Capacitor package **and** the Kotlin/Compose toolchain, a **platform behavior change** (target API 36), a
change that is difficult to roll back on a device holding real user data, and a change to the code path
that owns persisted data.

**This is Increment B of a two-increment programme.** Increment A
([backup-and-restore.md](./backup-and-restore.md)) ships first and is a **hard prerequisite**: it produces
the whole-app backup that protects the owner's data, and the **rollback source baseline** that B rebuilds
its recovery artifact from. A does not produce the installable rollback binary - that cannot exist until
B's `versionCode` is chosen.

**Companion discovery artifact:** [dependency-audit-2026-08.md](./dependency-audit-2026-08.md) audits every
**direct** dependency and toolchain component, with each "latest" resolved from the authoritative registry.
It establishes what moves and what does not - notably that **AGP 9 and TypeScript 7 are deliberate
deferrals with named triggers**, not impossibilities. "Current" here means *the newest version each
artifact's own published requirements permit*, which is neither "latest everywhere" nor vendor deference.

### What changed from revision 4 (Codex rounds 2 and 3)

| Revision 4 | Revision 5 | Finding |
|---|---|---|
| Rollback artifact one `versionCode` **above** the upgrade, installed before B | **Same `versionCode` as the upgrade**, so `adb install -r` flips either way as an ordinary same-version reinstall. Built and archived in Increment 0, **exercised in Increment 9** against the real upgrade build | Round 2, Blocker 5 - the ordering was not executable |
| Writer hashed the envelope before `integrity`; reader stripped only `integrity.digest` | One named preimage, `unsigned`, used by both sides | Round 2, Blocker 6 - every valid archive would have failed its own check |
| AAB proved by inspecting the generated APK set | Adds **`bundletool dump config --bundle`** requiring `"alignment": "PAGE_ALIGNMENT_16K"`, plus **every** delivered arm64 split | Round 2, Major 9 |
| Acceptance criterion 1, the prerequisite, Assumption 9 and the rollback table still prescribed the superseded design | All corrected; A supplies the **rollback source baseline**, not the binary | Round 3, Major 10 |

### What changed from revision 3 (Codex round 1)

| Revision 3 | Revision 4 | Finding |
|---|---|---|
| `lifecycle-runtime-compose` **2.11.0** | **2.10.0** | Blocker 3. Its AAR metadata declares `minCompileSdk=37`, `minAGP=9.1.0`; Increment 3 could not have built. 2.10.0 declares 35 / 8.6.0 |
| Versions justified by "Capacitor 8 declares this" | **Every AndroidX artifact verified from its own published `minCompileSdk` / `minAGP`**, in a new table | Blocker 3, Major 6 - the same reasoning error that produced the Kotlin mistake |
| Rollback = `adb install -r -d <baseline>`, "rehearsed" by installing it over itself | Downgrade semantics abandoned. *(The higher-`versionCode` artifact adopted here was itself **superseded in revision 5** - the ordering it implied could not be executed. See the revision-5 table above.)* | Blocker 4 |
| Gates bound to `assemble<Variant>` | **Gates bound to `assemble` + `bundle` + `install`**, and failure provoked on all three. The pre-existing permission gate had the same hole | Major 5 |
| 16 KB proven on the release APK | **Proven on the APK *and* the AAB via `bundletool`** - the AAB is what Play distributes | Major 5 |
| Cordova framework 14.0.1 per the template | **15.1.0.** cordova-android 14.0.x supports API 24-35; we target 36. Plus an explanation of why Cordova is present at all | Major 6 |
| Compose BOM described as coupled to Kotlin | **Corrected** - they are independently versioned; the BOM is selected on its members' own `minCompileSdk`/`minAGP` | Major 6 |
| Increment 3 moved everything including targetSdk at once | **Split 3a (target 35) / 3b (flip to 36)** | Codex recommendation, adopted |

### What changed from revision 2

| Revision 2 said | Revision 3 said | Why |
|---|---|---|
| Kotlin **2.2.20**, described as the safe vendor-matched choice | **Kotlin 2.4.10** | **My revision-2 analysis was wrong.** Kotlin's published compatibility matrix caps KGP 2.2.20 at **AGP 8.11.1**, so 2.2.20 under AGP 8.13.0 is an *unsupported* pairing - the opposite of what I claimed. 2.4.10 supports AGP 8.5.2-9.1.0 and Gradle 7.6.3-9.5.0, so it is the version that makes this toolchain legal. Owner decision, now evidenced |
| Compose BOM stays pinned at 2024.06.00 unless a failure forces it | **Compose BOM 2026.06.01**, plus `activity-compose` 1.13.0 and `lifecycle-runtime-compose` **2.10.0** | Every candidate is now selected against its own published `minCompileSdk` / `minAndroidGradlePluginVersion`, not by era. Lifecycle 2.11.0 is **excluded** on that evidence - see the Android stack table |
| CameraX, Firebase BoM, coroutines pinned unless a failure forces it | **CameraX 1.6.1, Firebase BoM 34.17.0, coroutines 1.11.0 are planned scope** | Owner decision. ONNX Runtime and ML Kit remain out - see Non-goals |
| Scope was Capacitor + toolchain only | **The web tier joins the same increment**: React 19, Vite 8, `@vitejs/plugin-react` 6, `vite-plugin-static-copy` 4, sql.js 1.14.1, qrcode-generator 2.0.4, sharp 0.35.3, firebase-tools 15.26.0 | Owner decision: one job. Recorded tradeoff in Self-Critique |
| `androidxActivityVersion` follows Capacitor's 1.11.0 | **Set explicitly to 1.13.0** | `activity-compose:1.13.0` requires `activity:1.13.0`; Gradle would resolve upward silently. The build file must not misreport what ships |
| The large-screen orientation override was the top target-36 risk, with an owner decision pending | **Resolved.** The app is portrait-only; the documented `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` opt-out holds portrait at target 36, and phones are exempt from the override entirely | Owner decision (portrait-only, always) plus verified Android documentation |

### What changed from revision 1

| Revision 1 said | Revision 2 said | Why |
|---|---|---|
| `targetSdk` stays 35; raising it is an owner option | **`targetSdk` moves to 36 as planned scope** | Owner decision: **future-proofing**. API 36 becomes the minimum required target within months, and the increment absorbs it now rather than scheduling a second native change |
| Kotlin 1.9.24 is kept; a probe decides, with a lower-AGP fallback and Kotlin 2.x as a last resort | **Kotlin 2.2.20 with `org.jetbrains.kotlin.plugin.compose` is planned scope.** The probe and the lower-AGP fallback are removed | Owner decision. The contingency ladder was the weakest part of revision 1 - it planned for a fork it had no intention of taking |
| `patch-package` presented as a live alternative | **Removed.** Full upgrade only | Owner decision |
| Backup was "per-profile export plus a best-effort `adb backup`" | **Increment A's whole-app protocol is a prerequisite** | Owner decision; revision 1's backup story was the weakest link in its rollback claim |
| "No source change" asserted as the expected outcome | **Conditional on the target-36 experiment**, with a pre-authorised, bounded correction surface | Codex: an untested assertion about a platform behavior change is not a plan |
| Migration notes were ad hoc | **Cumulative official 6 -> 7 and 7 -> 8 checklists**, applied item by item with template evidence | Codex |
| `checkRecogAssets` fail-open noted as a risk to watch | **Replaced with a fail-closed binding**, then proven to fail | Codex: a gate that can fail open is a defect, not a risk |

---

## Problem and success criteria

Compendium fails Google Play's 16 KB page-size check on one library, and targets an API level that will
shortly stop being accepted.

**The 16 KB gap.** Six of seven native libraries were fixed by the minSdk 29 + arm64-only baseline
(`android/variables.gradle:5`, `android/app/build.gradle:88`). `libsqlcipher.so` remains 4 KB aligned. It
arrives through `@capacitor-community/sqlite` 6.0.2, which pins the unmaintained
`net.zetetic:android-database-sqlcipher:4.5.3`. `android/app/build.gradle:125-131` already records that
substituting the aligned successor artifact crashes at launch with
`NoClassDefFoundError net/sqlcipher/database/SQLiteDatabase` (device-verified 2026-08-08), because the
successor moved its package namespace. Plugin 8.1.1 depends on `net.zetetic:sqlcipher-android:4.17.0@aar`
and imports the new namespace; it requires `@capacitor/core >= 8.0.0`.

**Target API 36.** Independent of the 16 KB issue, and taken now as **future-proofing**: API 36 becomes the
minimum required target within months, and absorbing it here avoids a second native change and a second
device verification pass. It brings Android 16 behavior changes that land directly on this app's chrome,
back handling, and the scanner.

> **How 16 KB is verified.** The warning dialog appears only on **debuggable** builds; its absence from a
> release build proves nothing. Verification is **static, against both shipping artifacts - the APK and the
> AAB**. The dialog is optional corroboration.

### Acceptance criteria

1. **16 KB compatibility is proven on both shipping artifacts.**
   **APK:** every `lib/arm64-v8a/*.so` has all `PT_LOAD` segments aligned to `0x4000` or greater, and every
   one is STORED uncompressed and 16 KB-aligned inside the archive. `libsqlcipher.so` is named explicitly.
   **AAB:** `bundletool dump config --bundle` reports `"alignment": "PAGE_ALIGNMENT_16K"`, **and** the same
   ELF and alignment checks pass on **every** delivered arm64 split APK, not one representative. The AAB is
   what Play distributes, so an APK-only proof does not satisfy this criterion.
2. `targetSdk` is 36 and the app behaves correctly against every Android 16 behavior change enumerated in
   the target-36 matrix below - each item reported PASS / FAIL / NOT RUN individually.
3. The release APK, installed over the existing install **without uninstalling**, launches.
4. Collection, Wishlist, Decks, and Play/match history read the user's existing rows, and counts match the
   record taken before the upgrade.
5. A write made after the upgrade survives force-stop and relaunch.
6. The card scanner completes a full OCR scan, a "Try visual match" (ONNX Runtime), and a QR scan.
7. `SCHEMA_VERSION` is still **11** and `MIGRATIONS` is unchanged: this increment performs **no** data
   migration.
8. `checkRecogAssets` is bound **fail-closed** and is proven to fail when an asset is absent;
   `checkReleaseForbiddenPermissions` is proven to still run.
9. The release merged-manifest permission list is unchanged from the baseline build's.
10. All applicable repository gates pass, reported with exact output.

### Non-goals

- **No schema change, no migration.** `src/store/schema.js` is untouched.
- **Three dependencies stay put** (audit §1). **AGP 9 / Gradle 9** - a deliberate deferral: temporary
  opt-outs exist but are being withdrawn, and all ten vendored Capacitor Gradle modules use the
  `lintOptions` DSL AGP 9 removed. **TypeScript 7** - a deliberate deferral: it ships without the stable
  programmatic compiler API that `scripts/check-types.mjs` depends on, and the `@typescript/typescript6`
  shim would buy nothing. **ONNX Runtime 1.22.0** - the one genuine correctness hold: the device runtime,
  the recogniser export toolchain and the prebuilt prototype index are one unit, with no gate that would
  catch embedding drift. (The export toolchain is **not currently pinned** - `requirements.txt` pins neither
  `onnx` nor `onnxruntime` - recorded as owed work, not fixed here.) **ML Kit is already at latest** and
  needs nothing.
- **No feature work, no UI redesign, no scanner refactor.** Dependency versions move; application behavior
  does not.
- **No adaptive or landscape layout work.** The app is portrait-only.
- **No permanent 16 KB Gradle gate.** Recommended follow-up.
- **iOS.** No iOS project exists.

---

## Prerequisite: Increment A

> **STAGE 7 HANDOFF - SATISFIED 2026-08-10.** Increment A is merged and every prerequisite below now
> has a concrete value:
>
> | Artifact | Value |
> |---|---|
> | **Rollback source baseline** | `b66289e6a6f13b1e7c685655e7b2cd4b3280bd63` (the `main` merge commit for Increment A) |
> | Baseline APK | `dist-apk/compendium-baseline-b217.apk`, `versionCode` **217**, installed on the owner's device |
> | Signing certificate SHA-256 | `c64bbee422da9fc47acc853e3f3eb26b9c866feff2c012ed98998c5e9aa38ba3` - **B's rollback build must match this**, or the reinstall is not an update |
> | Verified whole-app backup | `dist-apk/compendium-baseline-backup-b216.json` - both profiles, 1,832 owned copies, digest verified, and re-verified against the merged code with `scripts/backup/verify-archive.mjs` (ALL CHECKS PASSED) |
>
> `dist-apk/` is gitignored, so neither the APK nor the backup - which is real user data - enters
> history. B builds its rollback artifact by checking out that SHA and rebuilding at B's own
> `versionCode`.

B does not start until A is merged and:

1. A signed release APK has been built from `main` **with A included** and installed on the owner's device.
2. A whole-app backup of the owner's real data has been taken with A's protocol, verified, and stored
   off-device.
3. The **rollback source baseline** is identified - the `main` commit with A merged, from which B rebuilds
   its recovery artifact at B's own `versionCode`. The **binary is built and archived in Increment 0 and
   exercised in Increment 9**, against the real upgrade build; it is not installed beforehand.

Revision 1 proposed reusing the existing build-213 APK. That is superseded: the baseline must contain the
backup feature, or the rollback build cannot read the artifact that protects the data.

### The rollback artifact: a forward-installable baseline

Revisions 1-3 planned to roll back with `adb install -r -d <baseline APK>` and to "rehearse" it by
installing the baseline **over itself**. Codex is right on both halves, and the second is the more
embarrassing: installing an APK over an identical copy exercises the same-version update path and proves
nothing whatsoever about a downgrade.

The mechanism was also unreliable. `-d` requests `INSTALL_ALLOW_DOWNGRADE`, which is **not dependable on a
non-debuggable release build** on a normal user device. Betting the recovery path on it means discovering
it does not work at the exact moment it is needed.

**Revision 4's first attempt at this was also non-executable, and Codex was right again.** It set the
rollback artifact one `versionCode` *above* the upgrade (217 vs 216) **and** installed it before B began -
which would then have required installing 216 over 217, the very downgrade the design had just abandoned.
The sequence could not be run as written.

**The fix is a same-`versionCode`, same-key replacement.** The rollback artifact carries the **same**
`versionCode` as the upgrade build, so `adb install -r` treats it as an ordinary same-version reinstall in
either direction - never a downgrade, and freely reversible:

| Artifact | `versionCode` | Content |
|---|---|---|
| Baseline (A merged) | e.g. 215 | what the owner is running when B starts |
| **Upgrade (B)** | **216** | the increment under test |
| **Rollback artifact** | **216** | **baseline source, rebuilt at 216, same signing key** |

The sequence is monotonic and every step is a permitted install:

```text
215 (baseline, running)
 -> 216-upgrade     forward install, ordinary
 -> 216-rollback    SAME versionCode reinstall, ordinary   <- recovery
 -> 216-upgrade     SAME versionCode reinstall, ordinary   <- resume testing
```

**And it is provable against the real artifacts.** The rehearsal moves *into* the device pass rather than
before it: once 216-upgrade is installed and its data reads are verified, install 216-rollback, confirm the
app launches with counts intact, then reinstall 216-upgrade and continue. That exercises the actual recovery
path with the actual binaries, which "install the baseline over itself" never did.

**Increment A therefore produces the backup and the rollback *source baseline*, not the final installable
rollback binary** - that binary cannot exist until B's `versionCode` is chosen. It is built at the start of
B and archived outside `android/app/build/` as `dist-apk/compendium-rollback-b<code>.apk`, alongside
`dist-apk/compendium-baseline-b<code>.apk`. Both `versionCode`s are recorded here at that time.

A local artifact sharing a `versionCode` with a different build must **never** be distributed:
`scripts/distribute.mjs` compares the APK's `versionCode` against `package.json` and could not tell them
apart.

#### Operational refinement, found while building it (Increment 0, 2026-08-10)

The same-`versionCode` scheme is right, but it does not survive B **iterating**. The standing rule bumps
`build` on every device install, so B climbs 218, 219, 220 - and a rollback artifact frozen at 218 is a
*downgrade* from 220, which is the exact thing this design abandoned.

Freezing B's `versionCode` instead would break the standing rule and make installs
indistinguishable in a bug report, which is what that rule exists to prevent.

**So the artifact is disposable and the SHA is the asset.** The rollback APK is rebuilt from
`b66289e` at *whatever `versionCode` is currently installed* at the moment it is needed. That keeps
every install a same-version reinstall in both directions, costs one build, and needs no exception to
the bump rule.

`dist-apk/compendium-rollback-b218.apk` is therefore a **proof that the procedure works from the
recorded SHA** - baseline source builds cleanly and signs with the same certificate
(`c64bbee4...8ba3`, verified equal to the baseline APK's) - and not a permanently valid artifact.
Increment 9 rebuilds it at the then-current number before rehearsing.

**The second recovery path, stated because a binary is not a data guarantee:** uninstall plus restore from
A's verified backup. That is the answer if the app is somehow unbootable in both directions, and it is why
A ships first. It costs the user nothing but time, and it is only credible because A's restore is proven on
a disposable environment before B starts.

---

## Evidence and current architecture

### Current state (verified 2026-08-09)

| Fact | Location |
|---|---|
| `@capacitor/core` 6.2.0, `android` 6.2.1, `cli` 6.2.0, sqlite 6.0.2, keep-awake 5.0.1, app/filesystem/haptics/keyboard/preferences/share/status-bar v6 | `package.json:39-56` |
| minSdk 29, compileSdk 35, targetSdk 35 | `android/variables.gradle:5-7` |
| Java 17 (app), Kotlin `jvmTarget` 17 | `android/app/build.gradle:38-43` |
| Java 17 is **also re-imposed** by the generated `capacitor.build.gradle`, applied at the **bottom** of the app module, so it wins | `android/app/capacitor.build.gradle:3-8`, `android/app/build.gradle:265` |
| AGP 8.6.0, Gradle 8.7, Kotlin 1.9.24, google-services 4.4.2, crashlytics-gradle 3.0.2 | `android/build.gradle:10-17`, `gradle-wrapper.properties:3` |
| Compose compiler extension 1.5.14, Compose BOM 2024.06.00, CameraX 1.4.1, ML Kit text 16.0.1 / barcode 17.3.0, coroutines 1.8.1, cordovaAndroidVersion 10.1.1 | `android/variables.gradle:20-29` |
| The **entire androidx block is still at the Capacitor 6 template's values** (activity 1.8.0, appcompat 1.6.1, core 1.12.0, fragment 1.6.2, webkit 1.9.0, splashscreen 1.0.1) | `android/variables.gradle:8-14` |
| ONNX Runtime 1.22.0, Firebase BoM 33.7.0 | `android/app/build.gradle:144,177` |
| Release: `minifyEnabled true`, `shrinkResources true`, arm64-v8a only (release-scoped; **debug keeps all four ABIs**) | `android/app/build.gradle:64-90` |
| 24 Kotlin files, 3,778 lines - scanner (Compose + CameraX + ML Kit + ONNX) and telemetry | `find android/app/src/main/java -name '*.kt'` |
| `MainActivity` registers two app-module plugins by hand; forgetting a line compiles and ships | `MainActivity.java:11-16` |
| ProGuard keeps `net.sqlcipher.**` because libsqlcipher's `JNI_OnLoad` resolves classes by original name; the identical failure already bit ONNX Runtime, release-only | `android/app/proguard-rules.pro:38-54` |
| `checkRecogAssets` binds by **task-name pattern** `tasks.matching { it.name ==~ /merge.*Assets/ }` | `android/app/build.gradle:123` |
| `checkReleaseForbiddenPermissions` binds via `androidComponents.onVariants` + `assembleRelease.dependsOn`, and fails closed | `android/app/build.gradle:220-262` |
| `ScannerActivity` declares `android:screenOrientation="portrait"` | `AndroidManifest.xml:74` |
| `Theme.Compendium.Scanner` sets `android:statusBarColor` and `android:navigationBarColor` | `res/values/styles.xml` |
| Hardware back is a LIFO consumer registry plus a tested fallback precedence table | `src/back.js`, `src/navBack.js` (`npm run test:app`) |
| Safe-area handling is CSS `env(safe-area-inset-*)` plus a `--kb` variable from the VisualViewport API | `src/App.jsx:1270,1284`, `src/appearance.js:13-20`, `src/theme/counter.css:25-28` |
| Local `JAVA_HOME` is Android Studio's JBR = **OpenJDK 21.0.10**; local Node is **24.16.0** | this session |

### The de-risking finding: the SQLite plugin barely changed

This narrows the framing that makes the change High-risk, and it is the most important discovery in the
document.

**The JS API is byte-identical.** `diff` of `dist/esm/definitions.d.ts` between 6.0.2 and 8.1.1 produces
**no output**. `createConnection`, `open`, `query`, `run`, `execute`, `executeSet`, `isConnection`,
`retrieveConnection` keep identical signatures at identical line numbers. **`src/store/db.js` needs no
change.** (Confidence: High.)

**The Android diff is the artifact rename plus formatting.** Substantive changes across the whole
`android/src/main/java` tree:

- `net.sqlcipher.Cursor` -> `net.zetetic.database.sqlcipher.SQLiteCursor`;
  `net.sqlcipher.database.SQLiteDatabase` -> `net.zetetic.database.sqlcipher.SQLiteDatabase`
  (`Database.java`, `UtilsSQLite.java`, `UtilsSQLCipher.java`).
- `SQLiteDatabase.loadLibs(context)` -> **`System.loadLibrary("sqlcipher")`**.
- `openOrCreateDatabase` / `openDatabase` gain a trailing `null` argument.
- Password bytes: `SQLiteDatabase.getBytes(char[])` -> `String.getBytes(UTF_8)` (encryption-only path;
  Compendium never encrypts).
- `Database.java` **removed** the `catch (SQLiteException)` around `setVersion` (v6 lines 304-309): that
  failure now propagates out of `open()`. The device's `user_version` is already 11, so `setVersion` is a
  no-op; this is a louder failure mode, not a new one. Named because it is the only behavioral difference in
  the open path.
- Everything else is prettier reformatting.

**The statement splitter is unchanged.** `UtilsSQLStatement.java` differs only by indentation. The
quote-unaware splitter that `stripSqlComments` (`src/store/db.js:161-186`) exists to work around still
behaves identically, so that workaround remains necessary and sufficient. (Confidence: High.)

### Capacitor Android API surface

`Plugin.java`'s public method signatures are **identical** between 6.2.1 and 8.5.0, and
`BridgeActivity.registerPlugin(Class<? extends Plugin>)` is unchanged. `MainActivity.java`,
`CardScannerPlugin.kt`, and `TelemetryPlugin.kt` should compile untouched.

---

## The cumulative migration checklist (6 -> 7 -> 8)

Every row below is evidenced by extracting the `android-template.tar.gz` from `@capacitor/cli` at 6.2.0,
7.4.4, and 8.5.0 and diffing. This is the authoritative statement of what a project on 6 owes when it lands
on 8 - and because this project skips 7 entirely, **both steps' items are owed**.

| Item | v6 template | v7 template | v8 template | Ours today | Action |
|---|---|---|---|---|---|
| `minSdkVersion` | 22 | 23 | 24 | **29** | None - already above |
| `compileSdkVersion` | 34 | 35 | 36 | 35 | **-> 36** |
| `targetSdkVersion` | 34 | 35 | 36 | 35 | **-> 36** (owner decision) |
| AGP | 8.2.1 | 8.7.2 | 8.13.0 | 8.6.0 | **-> 8.13.0** |
| Gradle | 8.2.1 | 8.11.1 | 8.14.3 | 8.7 | **-> 8.14.3** |
| Java source/target | 17 | 21 | 21 | 17 | **-> 21** (v7 item) |
| `android:configChanges` | base | base **+ `navigation`** | base + `navigation` **+ `density`** | base only | **Add both** (one v7 item, one v8 item) |
| `androidxActivityVersion` | 1.8.0 | 1.9.2 | **1.11.0** | 1.8.0 | **-> 1.11.0** - see Predictive Back |
| `androidxAppCompatVersion` | 1.6.1 | 1.7.0 | 1.7.1 | 1.6.1 | **-> 1.7.1** |
| `androidxCoreVersion` | 1.12.0 | 1.15.0 | 1.17.0 | 1.12.0 | **-> 1.17.0** (forces compileSdk 36) |
| `androidxFragmentVersion` | 1.6.2 | 1.8.4 | 1.8.9 | 1.6.2 | **-> 1.8.9** |
| `androidxWebkitVersion` | 1.9.0 | 1.12.1 | 1.14.0 | 1.9.0 | **-> 1.14.0** |
| `androidxCoordinatorLayoutVersion` | 1.2.0 | 1.2.0 | 1.3.0 | 1.2.0 | **-> 1.3.0** |
| `coreSplashScreenVersion` | 1.0.1 | 1.0.1 | 1.2.0 | 1.0.1 | **-> 1.2.0** |
| `androidxJunitVersion` / `androidxEspressoCoreVersion` | 1.1.5 / 3.5.1 | 1.2.1 / 3.6.1 | 1.3.0 / 3.7.0 | 1.1.5 / 3.5.1 | **-> 1.3.0 / 3.7.0** |
| `cordovaAndroidVersion` | 10.1.1 | 10.1.1 | 14.0.1 | 10.1.1 | **-> 15.1.0, not the template's 14.0.1** - see below |
| `google-services` | 4.4.0 | 4.4.2 | **4.4.4** | 4.4.2 | **-> 4.4.4** |

### Every Android dependency verified from both sides

Codex found that revision 3 justified versions by "this is what Capacitor 8 declares" without checking the
dependency's own requirements, and that this had already produced one wrong answer (Kotlin) and one
unbuildable one (Lifecycle). Every AndroidX artifact publishes its floor in
`META-INF/com/android/build/gradle/aar-metadata.properties`. Extracted from each candidate AAR:

| Artifact | Version | `minCompileSdk` | `minAGP` | Fits AGP 8.13.0 / SDK 36? |
|---|---|---|---|---|
| `androidx.core:core` | **1.17.0** | 36 | 8.9.1 | **Yes** |
| `androidx.core:core` | 1.19.0 (latest) | **37** | **9.1.0** | **No** - excluded on evidence, not by template deference |
| `androidx.activity:activity` | **1.13.0** | 36 | 8.9.1 | **Yes** |
| `androidx.activity:activity-compose` | **1.13.0** | 36 | 8.9.1 | **Yes** |
| `androidx.lifecycle:lifecycle-runtime-compose-android` | 2.11.0 | **37** | **9.1.0** | **No - this was Codex Blocker 3** |
| `androidx.lifecycle:lifecycle-runtime-compose-android` | **2.10.0** | 35 | 8.6.0 | **Yes** - the latest that fits |
| `androidx.lifecycle:lifecycle-viewmodel-compose-android` | **2.10.0** | 35 | 8.6.0 | **Yes** |
| `androidx.compose.runtime:runtime-android` | 1.11.4 (BOM 2026.06.01) | 34 | 8.1.1 | **Yes** |
| `androidx.compose.ui:ui-android` | 1.11.4 (BOM 2026.06.01) | 35 | 8.6.0 | **Yes** |
| `androidx.compose.material3:material3-android` | 1.4.0 (BOM 2026.06.01) | 35 | 8.6.0 | **Yes** |
| `androidx.camera:camera-core` / `camera-view` | **1.6.1** | 36 | 8.9.1 | **Yes** |
| `androidx.appcompat:appcompat` | **1.7.1** | 34 | 1.0.0 | **Yes** |
| `androidx.webkit:webkit` | **1.14.0** | 34 | 8.1.1 | **Yes** |
| `androidx.fragment:fragment` | **1.8.9** | 34 | 1.0.0 | **Yes** |
| `androidx.core:core-splashscreen` | **1.2.0** | 35 | 8.6.0 | **Yes** |

Two corrections fall out of this, beyond the Lifecycle blocker:

- **`androidx.core` 1.17.0 is now justified by evidence, not by deference.** 1.19.0 requires compileSdk 37
  and AGP 9.1.0, so it is genuinely unavailable rather than merely off-template.
- **The Compose BOM is not coupled to the Kotlin version.** Revision 3 claimed it was, and Codex was right
  that this is wrong: the Compose compiler plugin and the Compose libraries are independently versioned.
  BOM 2026.06.01's members require only compileSdk 34-35 / AGP 8.1.1-8.6.0 and are therefore compatible
  with our stack on their own terms. The compiler plugin enforces a *minimum runtime*, which 1.11.4
  satisfies comfortably.

### Cordova, and why it is here at all

Worth stating plainly because it is a reasonable thing to be surprised by: **Compendium uses no Cordova
plugins.** `android/capacitor-cordova-android-plugins/src/main/java/` contains only a `.gitkeep`. But the
framework is not optional - `@capacitor/android`'s own runtime declares
`implementation "org.apache.cordova:framework:$cordovaAndroidVersion"`, and `cap sync` regenerates the empty
bridge module unconditionally. The dependency ships whether or not we use it.

That makes Codex's finding land: **cordova-android 14.0.x supports API 24-35, and 15.0.x supports 24-36.**
Capacitor 8's template pins 14.0.1, which does not cover our target. We therefore set
`cordovaAndroidVersion = '15.1.0'` - a deliberate, documented deviation from the template. The risk is
minimal precisely because the module is empty: nothing of ours compiles against the Cordova API, and its
minSdk 24 floor is below our 29. Verified at Increment 3's `assembleDebug`.

### JS-side breaking changes, item by item

| Package | Change | Affects us? |
|---|---|---|
| `@capacitor/core` 8 | Removes `CapacitorPlatforms`, `addPlatform`, `setPlatform`, `Plugins`, `registerWebPlugin`, `WebPluginConfig`, and the legacy types (`CallbackID`, `CancellableCallback`, `ISODateString`, `PluginConfig`, `PluginRegistry`). Adds `SystemBars`. Retains `Capacitor` and `registerPlugin`. | **No.** `grep` of `src/` shows we import only `Capacitor` and `registerPlugin`. `SystemBars` becomes relevant only if the edge-to-edge experiment demands it |
| `@capacitor/filesystem` 8 | `writeFile` tightened: **without `encoding`, `data` must be base64 or it throws** | **No, but it is the closest call.** Three call sites: `src/native.js:68` (`Encoding.UTF8`), `src/native.js:86` (base64, no encoding), `src/store/artCacheAdapter.js:85` (base64 from `CapacitorHttp`, no encoding). All comply; all three are on the device checklist |
| `@capacitor/haptics` 8 | Drops deprecated `HapticsImpactOptions` / `HapticsNotificationOptions` / `HapticsNotificationType` / `HapticsImpactStyle` | **No.** `src/native.js:5` imports `Haptics`, `ImpactStyle` |
| `@capacitor/app` 7.1+ | Adds `disableBackButtonHandler` config and `toggleBackButtonHandler`. Back handling is `OnBackPressedDispatcher` + `OnBackPressedCallback` in **both** v6 and v8 | **Not a break**, and it is the reason predictive back is survivable - see below |
| `@capacitor/keyboard` 8 | Adds iOS `autoBackdropColor`; `setResizeMode`, `setScroll`, `KeyboardResize.None` retained | **No** |
| `@capacitor/status-bar` 8 | Documents that `backgroundColor` / `overlaysWebView` are inert on Android 15+ | Already true at targetSdk 35; **more consequential at 36** - see the matrix |
| `share`, `preferences`, `keep-awake` | No definition change affecting our calls | **No** |

### Deprecated Gradle syntax (owner directive)

The v8 template uses assignment syntax throughout. In the three files we own
(`android/build.gradle`, `android/app/build.gradle`, `android/variables.gradle`):

- `namespace "x"` -> `namespace = "x"`; `compileSdk rootProject…` -> `compileSdk = …`;
  `ignoreAssetsPattern '…'` -> `ignoreAssetsPattern = '…'`.
- `kotlinOptions { jvmTarget = '21' }` -> Kotlin 2.x's `kotlin { compilerOptions { jvmTarget = … } }`
  (`kotlinOptions` is deprecated in Kotlin 2.2).
- `composeOptions { kotlinCompilerExtensionVersion … }` -> **removed entirely**; the Compose Gradle plugin
  replaces it, and leaving it in place is an error. `composeCompilerVersion` in `variables.gradle` becomes
  dead and is deleted.
- **Stated honestly:** `task clean(type: Delete) { delete rootProject.buildDir }` in `android/build.gradle:33`
  uses `buildDir`, deprecated in recent Gradle in favour of `layout.buildDirectory`. **The v8 template still
  ships the old form**, so this is a recommended cleanup, not a Capacitor 8 requirement. Included because it
  is one line and it will otherwise resurface at Gradle 9.
- Generated files (`capacitor.build.gradle`, `capacitor.settings.gradle`,
  `capacitor-cordova-android-plugins/`) are **never hand-edited**; `cap sync` rewrites them.

---

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | `libsqlcipher.so` from `sqlcipher-android:4.17.0` has 16 KB-aligned `PT_LOAD` segments on arm64-v8a | **High (owner-verified)** | Owner parsed the AAR's ELF headers 2026-08-09. I could not re-verify - `repo1.maven.org` is unreachable from this session. **Re-verified in Increment 4 against the assembled APK**, which is the authoritative artifact. If it fails there, stop |
| 2 | `src/store/db.js` needs no change | **High** | Byte-identical JS definitions; the Android open/query/execute paths differ only by the artifact rename |
| 3 | Kotlin **2.4.10** + `org.jetbrains.kotlin.plugin.compose` 2.4.10 compiles the 3,778-line scanner without source changes | **Medium-Low** | K2 is stricter than the 1.9 frontend and Compose 2.x defaults to strong skipping, which changes recomposition behavior. A 1.9 -> 2.4 jump is a wider delta than 1.9 -> 2.2. Isolated into Increment 2 so a failure is attributable, and the Compose surfaces are device-verified |
| 4 | Compose BOM **2026.06.01** (runtime 1.11.4) pairs correctly with the 2.4.10 Compose plugin | **High** | Contemporaneous versions. Revision 2's risk here was an artefact of pinning an old BOM under a new plugin; choosing Kotlin 2.4.10 and the matching BOM removes it |
| 4b | React 19 needs no source change | **High** | Scanned for every React 19 removal: no `defaultProps`, `propTypes`, `findDOMNode`, string refs, legacy context, or `forwardRef` (0 occurrences); already `createRoot`; only `react-dom` import is `createPortal`. Proven by Increment 1's gates |
| 5 | Predictive back does not break the app's back system | **Medium-High** | Both `@capacitor/app` v6 and v8 register an **enabled** `OnBackPressedCallback` on the `OnBackPressedDispatcher` - the AndroidX mechanism that bridges to `OnBackInvokedCallback`. Combined with androidx.activity 1.11.0 this is the supported path. Bounded fallback: `android:enableOnBackInvokedCallback="false"` on the activity, still honored at 36 |
| 6 | compileSdk 36 is effectively mandatory | **High** | Both v8 modules default to 36 and Java 21; `androidx.core` 1.17.0 refuses lower |
| 7 | The existing release Gradle gates survive AGP 8.13 | **Medium** | `checkRecogAssets` binds by task-name pattern and **fails open**; it is being replaced rather than trusted. `checkReleaseForbiddenPermissions` uses `SingleArtifact.MERGED_MANIFEST` and fails closed; proven by its log line |
| 8 | Firebase BoM 33.7.0 / crashlytics-gradle 3.0.2 build under AGP 8.13 | **Low-Medium** | google-services goes to 4.4.4 per the template. Any further bump is a reported trigger, per the pinning directive |
| 9 | The rollback artifact installs and preserves data | **High** | It carries the **same `versionCode`** as the upgrade and the same signing key, so `adb install -r` treats it as an ordinary same-version reinstall in either direction - never a downgrade, and no schema change to undo. The `-d` downgrade path is explicitly not relied upon: it is not dependable on a non-debuggable release build. Proven **inside Increment 9**, against the real upgrade build |

---

## Options considered

### A. Status quo
Rejected. Blocks Play on two independent counts and leaves the app on an unmaintained Capacitor line.

### B. Gradle-level artifact substitution into the v6 plugin
Rejected, and **already tried and reverted** (`android/app/build.gradle:125-131`, device-verified): the v6
plugin hard-imports `net.sqlcipher.*`.

### B'. `patch-package` the v6 plugin's sources
**Presented and rejected in revision 1; removed by owner decision.** Recorded here only so it is not
re-raised: it would close the 16 KB gap with a smaller diff but leaves the app on Capacitor 6, which
cannot reach target API 36's supported toolchain, and forks a vendored dependency indefinitely. Since
target 36 is now in scope, B' does not solve the whole problem anyway.

### C. Remove SQLCipher from the plugin
Rejected. `Database.java` imports the SQLCipher `SQLiteDatabase` for all connections; there is no plain
path.

### D. Replace `@capacitor-community/sqlite`
Rejected. A new storage implementation under a live v11 database is strictly more dangerous than upgrading
the one already in production.

### E (chosen). Full Capacitor 6 -> 8 on the vendor's toolchain baseline, plus target API 36
Adopt the v8 template's AGP, Gradle, compileSdk, Java, and androidx set; move `targetSdk` to 36; move Kotlin
to 2.4.10 with the Compose Gradle plugin. Keep the owner-approved product decisions (minSdk 29, arm64-only
release, `minifyEnabled`). Change nothing else.

### F. Capacitor 8 with compileSdk held at 35
Rejected as unsupported: `androidx.core` 1.17.0 refuses it, and both v8 modules declare 36 and Java 21.

---

## Proposed design

### Versions

```
@capacitor/core 8.5.0 · @capacitor/android 8.5.0 · @capacitor/cli 8.5.0 (dev)
@capacitor-community/sqlite 8.1.1 · @capacitor-community/keep-awake 8.0.1
@capacitor/app 8.1.1 · filesystem 8.1.2 · haptics 8.0.2 · keyboard 8.0.5
@capacitor/preferences 8.0.1 · share 8.0.1 · status-bar 8.0.3

AGP 8.13.0 · Gradle 8.14.3 · compileSdk 36 · targetSdk 36 · minSdk 29 (unchanged)
Java 21 · Kotlin 2.4.10 · org.jetbrains.kotlin.plugin.compose 2.4.10
google-services 4.4.4 · androidx per the v8 template, EXCEPT activity and lifecycle (below)
cordova framework 15.1.0 (NOT the template's 14.0.1 - see below)

Compose + scanner (owner decision: in scope)
Compose BOM 2026.06.01 (runtime 1.11.4) · activity-compose 1.13.0
lifecycle-runtime-compose 2.10.0 · androidx.activity 1.13.0 (declared explicitly)
CameraX 1.6.1 · kotlinx-coroutines-android 1.11.0
Firebase BoM 34.17.0 · crashlytics-gradle 3.0.7

Web tier (owner decision: same increment)
react 19.2.8 · react-dom 19.2.8 · vite 8.2.1 · @vitejs/plugin-react 6.0.5
vite-plugin-static-copy 4.1.1 · sql.js 1.14.1 · qrcode-generator 2.0.4
sharp 0.35.3 · firebase-tools 15.26.0

HELD, each with an evidenced blocker (Non-goals; audit §1)
AGP 9 / Gradle 9 · TypeScript 6.0.3 · ONNX Runtime 1.22.0
ML Kit text 16.0.1 / barcode 17.3.0 (already latest) · Node 24 LTS
```

**`androidx.activity` is declared explicitly at 1.13.0**, deviating from Capacitor's 1.11.0. Not a
preference: `activity-compose:1.13.0` requires `activity:1.13.0`, so Gradle resolves it upward whatever we
write. Declaring it makes the build file state what actually ships. The same reasoning applies to
`kotlinxCoroutinesVersion`, which today claims 1.8.1 while Capacitor's default of 1.10.2 silently wins.

**Ordering hazard, named because it otherwise wastes a build cycle.** `capacitor.build.gradle` is generated
and its `compileOptions` are applied **after** the app module's own (`android/app/build.gradle:265`), so it
wins. Java 21 does not take effect from `app/build.gradle` alone; it lands with `cap sync`.

### Kotlin 2.4.10 and the Compose Gradle plugin

**Revision 2 got this backwards and the correction matters.** It proposed Kotlin 2.2.20 on the grounds that
it is Capacitor 8's declared baseline - which it is: `@capacitor/filesystem@8.1.2/android/build.gradle:11`
declares `ext.kotlin_version = … : '2.2.20'`, and that is the only Kotlin-bearing Capacitor module. But the
Kotlin Gradle plugin's published compatibility matrix reads:

| KGP version | Gradle min-max | AGP min-max |
|---|---|---|
| **2.4.0-2.4.10** | 7.6.3-9.5.0 | **8.5.2-9.1.0** |
| 2.3.20-2.3.21 | 7.6.3-9.3.0 | 8.2.2-9.0.0 |
| **2.2.20-2.2.21** | 7.6.3-8.14 | **7.3.1-8.11.1** |

Capacitor 8's template pairs **AGP 8.13.0** with **Gradle 8.14.3**. Kotlin 2.2.20's AGP ceiling is
**8.11.1**, so *Capacitor's own declared combination is outside Kotlin's supported window*. Following the
vendor baseline would have produced an unsupported toolchain, not a safe one.

**Kotlin 2.4.10 + AGP 8.13.0 + Gradle 8.14.3 is fully supported** - 8.13.0 sits inside 8.5.2-9.1.0 and
8.14.3 inside 7.6.3-9.5.0. Because the Capacitor module reads `rootProject.ext.kotlin_version` before its
own default, setting it applies to that module too.

Mechanics:

- Root `buildscript`: `org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.10` **and**
  `org.jetbrains.kotlin:compose-compiler-gradle-plugin:2.4.10` (both confirmed present on Maven Central).
- App module: `apply plugin: 'org.jetbrains.kotlin.plugin.compose'`.
- **Delete** `composeOptions { kotlinCompilerExtensionVersion composeCompilerVersion }` and the
  `composeCompilerVersion` variable - mutually exclusive with the plugin.
- `kotlinOptions { jvmTarget = '17' }` -> `compilerOptions { jvmTarget = JvmTarget.JVM_21 }`.
- Compose BOM to **2026.06.01** (runtime 1.11.4), the line contemporaneous with Kotlin 2.4.x.

**A latent discrepancy found during the audit:** the Capacitor filesystem module defaults
`kotlinxCoroutinesVersion` to **1.10.2**, while `android/variables.gradle:29` pins **1.8.1**. Both reach one
classpath and Gradle resolves to the highest, so the app already runs 1.10.2 while its own build file claims
1.8.1. This increment sets it explicitly to 1.11.0.

**Named risk, unchanged in kind but larger in degree:** Kotlin 2.x uses the K2 frontend and Compose 2.x
enables strong skipping by default. That is a *runtime* behavior change in recomposition, not a compile
error, across 3,778 lines of scanner Kotlin. Moving from 1.9.24 to 2.4.10 rather than 2.2.20 widens that
delta. It is why the scanner's Compose surfaces are device-verified rather than assumed, and why the
implementation plan lands Kotlin and Compose as their own gated step.

The comment at `android/app/build.gradle:35-36` explaining why the Kotlin JVM target must equal the Java
target stays accurate and is updated to 21. The Compose surfaces most exposed to strong skipping are
`ScannerScreen.kt` and `RecognitionSheet.kt`; both are on the device checklist.

### ProGuard - the trap that only shows in a release build

`android/app/proguard-rules.pro:38-43` keeps `net.sqlcipher.**` because libsqlcipher's `JNI_OnLoad`
resolves classes **by original name**. The new artifact moves that namespace, so the existing rules become
inert no-ops and the app would launch straight into the failure the comment describes.

Replace with a keep on **`net.zetetic.database.**`** - the parent package, deliberately **not** the narrower
`net.zetetic.database.sqlcipher.**`:

```proguard
# SQLCipher (net.zetetic:sqlcipher-android). libsqlcipher.so's JNI_OnLoad resolves these Java
# classes by their ORIGINAL names - R8 renaming them aborts the native load at launch.
# The keep is on the PARENT package, not just .sqlcipher: the library also registers natives
# against net.zetetic.database.CursorWindow, which is only reached once a result set is large
# enough to page. A narrower rule would launch fine and fail later, on a big query.
-keep class net.zetetic.database.** { *; }
-keep interface net.zetetic.database.** { *; }
-keepclassmembers class net.zetetic.database.** { *; }
-dontwarn net.zetetic.database.**
```

The `io.liteglue.**` keep above it is audited against 8.1.1 and removed if it no longer corresponds to
anything. ONNX Runtime and ML Kit rules are untouched.

### `checkRecogAssets`: fail-open -> fail-closed

Today the gate binds with `tasks.matching { it.name ==~ /merge.*Assets/ }` (`android/app/build.gradle:123`).
If AGP renames or restructures that task, **nothing matches, nothing throws, and the build ships a scanner
that reports "Visual match unavailable" on every scan.** A gate that can silently stop running is worse
than no gate.

Revision 3 proposed binding to `assemble<Variant>`. **That was still too narrow, and Codex extended the
finding to the existing permission gate as well.** `assemble` is not on the path of every artifact that can
reach a user:

| Path | Produces | Covered by `assemble<Variant>`? |
|---|---|---|
| `assembleRelease` | the APK we sideload to testers | Yes |
| **`bundleRelease`** | **the AAB Play actually distributes** | **No** |
| `installDebug` / `installRelease` | a device install | Not reliably |

So the "fix" for a fail-open gate would itself have failed open on the path that matters most for
publishing, and `checkReleaseForbiddenPermissions` - which has been live for many builds - has the same
hole today. A Play upload could ship without recogniser assets **and** without permission validation.

**Both gates bind to all three task families**, enumerated from AGP's public task-name contract rather than
matched by pattern:

```groovy
androidComponents.onVariants { variant ->
  def v = variant.name.capitalize()
  tasks.matching { it.name in ["assemble${v}", "bundle${v}", "install${v}"] }
       .configureEach { dependsOn checkTask }
}
```

Each gate keeps a lifecycle log line on success, so **its absence is visible** rather than silent.

**Verification deliberately provokes failure on each path** (Increment 6): with a recogniser asset renamed,
`assembleRelease`, `bundleRelease` and `installDebug` must each go red naming the missing file. A gate is
not accepted as fixed because it passes; it is accepted because it was made to fail.

Coverage extends to debug, so an emulator build cannot silently ship without recogniser assets either.

### Target API 36: what actually changes, and how each is handled

| Android 16 behavior change | Surface it lands on | Handling |
|---|---|---|
| **Predictive back is default-on** at target 36; the legacy `KeyEvent` path is gone | `src/back.js` consumer registry, `src/navBack.js` precedence table, `App.addListener('backButton')`, scanner Activity back | Both v6 and v8 `@capacitor/app` use `OnBackPressedDispatcher`, the AndroidX mechanism that bridges to `OnBackInvokedCallback`; androidx.activity 1.11.0 is the matching runtime. Verified device-side across every layer. **Bounded fallback:** `android:enableOnBackInvokedCallback="false"` on the activity |
| **Edge-to-edge enforced**; the opt-out is ignored at 36 | The whole shell: `S.app` uses `env(safe-area-inset-top/bottom)` (`App.jsx:1270`), sheets and the counter use their own insets | Already inset-aware today at target 35. Verified visually; a bounded correction is pre-authorised |
| `statusBarColor` / `navigationBarColor` **deprecated and ignored** | `Theme.Compendium.Scanner` sets both (`styles.xml`); `StatusBar.setBackgroundColor` in `initNative()` (`src/native.js:20`) | Both already no-ops at 35; at 36 they are dead code. Removed from the theme if verification confirms; the `setBackgroundColor` call already sits inside a `try` |
| **Orientation and resizability restrictions ignored on displays >= 600dp** | `ScannerActivity android:screenOrientation="portrait"` (`AndroidManifest.xml:74`); the app is portrait-only by product decision | **Declare the documented opt-out app-wide** (below). Phones (< 600dp) are exempt from the override entirely, so portrait already holds there unconditionally |
| Keyboard / IME inset behavior | `Keyboard.setResizeMode(None)` + `--kb` from VisualViewport (`src/appearance.js:13-20`) | Verified in a search field and a bottom sheet |
| `elegantTextHeight` deprecated and ignored | Arabic, Thai and several Indic scripts | **Not applicable** - the app is Latin-only |
| Local network access will require `NEARBY_WIFI_DEVICES` (enforcement 26Q2) | Art CDN traffic | **Not applicable** - the app talks to a public CDN, never to LAN devices |

### Portrait-only under target 36

> **CORRECTION, found during implementation (2026-08-10).** This section asserted the app was already
> portrait-only and treated the opt-out property as sufficient. It was not. Only `ScannerActivity`
> declared `android:screenOrientation`; **`MainActivity` never has**, so the main app rotated into
> landscape on phones. The property below only makes a declared orientation be HONOURED on >= 600dp
> displays - it cannot create a lock that was never asked for, so on its own it would have left device
> row 14 failing. `MainActivity` was locked to portrait in its own commit, owner-confirmed. The
> intent recorded here was right; the claim about the existing code was wrong.

The app is portrait-only, always, by product decision. Verified against the Android documentation:

- The override applies **only to displays with smallest width >= 600dp** - tablets, unfolded foldables, and
  desktop windowing. **Phones are exempt**, so `android:screenOrientation="portrait"` keeps working there
  regardless of target level.
- On >= 600dp displays at target 36, `android:screenOrientation`, `android:resizeableActivity`,
  `android:minAspectRatio`, `android:maxAspectRatio` and `setRequestedOrientation()` are ignored **unless**
  the app declares the documented opt-out.
- This increment therefore declares it **app-wide**, on `<application>`, so it covers `MainActivity` and
  `ScannerActivity` together:

```xml
<property android:name="android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY"
          android:value="true" />
```

With that in place **portrait holds on every display class at target 36**, and no layout work is needed.

> **A product fact to record, not act on here.** The opt-out is **removed at API 37**: apps targeting 37 or
> higher cannot opt out, and the restrictions are always ignored on >= 600dp displays. Portrait therefore
> remains enforceable on phones indefinitely and on tablets/foldables only until we target 37. That is a
> future decision and is explicitly **out of scope** for this increment; it is flagged so it is not
> discovered later.

### "No source change" is a hypothesis, not a claim

The working hypothesis is that `src/**` needs no change: `db.js` is proven safe, and every plugin call site
already complies with the v8 contracts. **That hypothesis is tested by the target-36 matrix, not asserted.**

A **bounded** compatibility correction is pre-authorised within this named surface only:

- `src/native.js` `initNative()` - status bar / system bars setup, including adopting `SystemBars` from
  `@capacitor/core` 8 if the StatusBar plugin proves inert where it is still needed.
- `src/appearance.js` - the `--kb` keyboard inset.
- Safe-area CSS in `src/App.jsx`, `src/components/GothicSheet.jsx`, `src/theme/counter.css`.
- `android/app/src/main/res/values/styles.xml` - removing the dead deprecated bar-colour attributes.

Anything outside that surface is a **scope expansion requiring a §12 checkpoint and approval**, not
something to write while debugging. In particular, no adaptive or landscape layout work is in scope: the
app is portrait-only and the manifest opt-out holds it that way at target 36.

### What does not change

`src/store/db.js`, `src/store/schema.js`, `src/cardScanner.js`, `src/store/telemetry.js`,
`src/store/artCacheAdapter.js`, `MainActivity.java`, `CardScannerPlugin.kt`, `TelemetryPlugin.kt`,
`capacitor.config.json`.

---

## Implementation plan

**Increment 0 - Prerequisite gate.** Increment A merged; baseline APK archived; whole-app backup taken and
verified; pre-upgrade counts recorded; branch `capacitor-8` created and its `docs/WORK_IN_FLIGHT.md` row
added. The **rollback artifact is built and archived here** (baseline source at B's `versionCode`) but is
**not installed** - it is exercised inside Increment 9's device pass, against the real upgrade build.
*Checkpoint: report both `versionCode`s, the backup evidence, and the archived artifact paths.*

> **Ordering principle for the one-job scope.** The owner has decided this is a single increment. That
> decision is about the *unit of delivery*, not about how the work is executed. The steps below are ordered
> so each independent risk source lands behind its own gate, cheapest and most isolated first, so a failure
> is still attributable. Web tier first: it is the only part with no device dependency, so getting it green
> means the later device pass is not simultaneously debugging a React major.

**Increment 1 - Web tier, alone.** React 18.3.1 -> 19.2.8 (+ react-dom), Vite 6 -> 8 with
`@vitejs/plugin-react` 4 -> 6 (they move together, peer-locked), `vite-plugin-static-copy` 4.1.1,
sql.js 1.14.1, qrcode-generator 2.0.4, sharp 0.35.3, firebase-tools 15.26.0. **Nothing native changes.**
The audit found no React 19 blockers in this codebase - no `defaultProps`, `propTypes`, `findDOMNode`,
string refs, legacy context, or `forwardRef`; already on `createRoot`; the only `react-dom` import anywhere
is `createPortal`.
*Gate:* `npm run build`, `test:codex`, `test:query`, `test:ui`, `test:app`, `check:types`, `check:cycles`,
`check:source`, plus `npm run dev` exercised by hand including a QR render (the one `qrcode-generator`
consumer) and the sql.js web backend.

**Increment 2 - Kotlin 2.4.10 and Compose, alone.** Kotlin 1.9.24 -> 2.4.10, add
`org.jetbrains.kotlin.plugin.compose` 2.4.10, remove `composeOptions` and `composeCompilerVersion`, migrate
`kotlinOptions` -> `compilerOptions`, Compose BOM -> 2026.06.01, `activity-compose` 1.13.0,
`lifecycle-runtime-compose` 2.10.0, coroutines 1.11.0. **AGP, Gradle, Java, compileSdk and Capacitor all
stay where they are** - AGP 8.6.0 is inside Kotlin 2.4.x's supported band (8.5.2-9.1.0), so this step is
legal on its own. It isolates the K2 / Compose-2.x migration, the largest source-level risk in the whole
increment.
*Gate:* `./gradlew assembleDebug` compiles all 24 Kotlin files.

**Increment 3 - Capacitor 6 -> 8 and the toolchain.** All 11 packages; `npm install`; `npm run android`
(vite build + `cap sync android` + `strip-native-wasm`), which regenerates `capacitor.build.gradle`,
`capacitor.settings.gradle` and the cordova bridge module at Java 21. AGP 8.13.0, Gradle 8.14.3,
compileSdk 36, **targetSdk 36**, Java 21, the v8 androidx/splashscreen set, cordova framework 15.1.0,
google-services 4.4.4.
**Two internal checkpoints inside this step** (Codex recommendation, adopted - diagnostic isolation, not
scope expansion): **3a** move everything *except* `targetSdk`, which stays at **35**, and get a clean
`assembleDebug`. **3b** flip `targetSdk` to **36** alone. A behavior failure after 3b is then attributable
to the platform change rather than to the Capacitor move.
*Gate:* `./gradlew assembleDebug` at both 3a and 3b; `npx cap doctor`; the regenerated
`capacitor.build.gradle` says Java 21 and lists all nine plugin modules.

**Increment 4 - Scanner and Firebase dependency bumps.** CameraX 1.4.1 -> 1.6.1, Firebase BoM
33.7.0 -> 34.17.0, crashlytics-gradle 3.0.2 -> 3.0.7. Held separate from Increment 3 so a camera or
telemetry regression is not attributed to the Capacitor move. **ONNX Runtime and ML Kit are untouched.**
*Gate:* `assembleDebug`; the merged-manifest permission list is unchanged (the `AD_ID` lesson).

**Increment 5 - Manifest and Gradle syntax (the checklist's remaining items).** Add `navigation` (v7) and
`density` (v8) to `android:configChanges`; declare
`android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` on `<application>` to hold portrait at
target 36; apply assignment syntax in the three files we own. *Gate:* `assembleDebug`; the merged manifest
shows both configChanges values and the property.

**Increment 6 - ProGuard, the recog gate, and the release build.** New SQLCipher keeps; audit
`io.liteglue.**`; replace the `checkRecogAssets` binding; replace the stale "KNOWN REMAINING GAP" comment at
`android/app/build.gradle:125-131`. *Gate:* `./gradlew assembleRelease` and `./gradlew bundleRelease` both succeed; **both gates provoked on
all three paths** - with a recog asset renamed, `assembleRelease`, `bundleRelease` and `installDebug` must
each go red naming the missing file, then restore it; confirm both gates' lifecycle log lines.

**Increment 7 - Static 16 KB proof on both shipping artifacts.** APK: `zipalign -c -P 16 -v 4` (every
`lib/arm64-v8a/*.so` STORED and 16 KB aligned) plus `llvm-readelf -l` over each extracted `.so` with a
per-library `PT_LOAD Align` table, `libsqlcipher.so` named.

**AAB, in two parts.** Inspecting only the generated APK set can show aligned test APKs while the uploaded
bundle carries the wrong configuration, so the bundle's own setting is checked directly:
1. **`bundletool dump config --bundle=app.aab`** must report `"alignment": "PAGE_ALIGNMENT_16K"`. That is
   the bundle-level request which makes Play's generated APKs align; AGP >= 8.5.1 emits it and we ship
   8.13.0.
2. **`bundletool build-apks`**, then the same ELF and alignment checks across **every delivered arm64 split
   APK**, not one representative.

The AAB is what Play distributes, so proving only the sideload APK proves the wrong artifact. APK/AAB size before/after; release
merged-manifest permission list diffed against the baseline. *If `libsqlcipher.so` is not aligned, stop and checkpoint* - the change has lost half
its purpose and a device pass cannot recover it.

**Increment 8 - Full repository gates.** `test:codex`, `test:query`, `test:ui`, `test:app`, `check:types`,
`check:cycles`, `check:source`, `build`, `check:docs`, with exact output.

**Increment 9 - Device verification.** Bump `build`, rebuild, `adb install -r` (never uninstall). Run the
full matrix below. `npm run check:smoke`. *If the target-36 matrix demands a source change, checkpoint
against the pre-authorised surface before writing it.*

**Increment 10 - Documentation and handoff.** `BUILD.md`, `docs/WORK_IN_FLIGHT.md`, `check:docs`, completion
handoff, Codex final review of the diff.

---

## Data migration and compatibility

**No migration. This remains the single most important risk fact.**

`SCHEMA_VERSION` stays 11 and `MIGRATIONS` is not edited, so `runMigrations()` reads
`_meta.schema_version = 11`, matches, and executes nothing (`src/store/db.js:31-32`). No table is created,
altered, backfilled, or read-modified-written. The plugin's `createConnection(…, 11, …)` argument is
unchanged and the device's `user_version` is already 11.

**Database file compatibility.** Every connection is opened `'no-encryption'` (`src/store/db.js:194`;
`capacitor.config.json:12` sets `androidIsEncryption: false`). In unencrypted mode both the old and new
SQLCipher wrappers operate on a plain SQLite file. `compendiumSQLite.db` is not rewritten, re-keyed, or
reformatted - it is the same file, opened by a differently-named Java class.

**The realistic failure mode is "the app cannot open the database", not "the data was transformed."** That
is a recoverable failure with an intact file, which is what makes the rollback credible - and it is exactly
why no schema change is bundled into this release.

**Export-format compatibility:** unchanged. Increment A's bundles written before and after are identical in
shape.

---

## Rollback and recovery

| Layer | Mechanism | Proven by |
|---|---|---|
| Code | Work on `capacitor-8`; `main` untouched until the device pass is green | Trivially |
| Device binary | **Same-version reinstall** of `dist-apk/compendium-rollback-b<code>.apk` - baseline source rebuilt at **B's own `versionCode`**. Ordinary `adb install -r`, no downgrade semantics, same signing key, so **app data is preserved**, and it reverses freely back to the upgrade | **Increment 9**: install upgrade, verify reads, install rollback, verify counts, reinstall upgrade - the real artifacts, in order |
| Data | Increment A's whole-app backup, taken and verified in Increment 0 | Increment A's own verification |

**Point of no return: none.** No migration means no irreversible data transformation, and nothing about the
install is one-way: upgrade and rollback share a `versionCode`, so either replaces the other as an ordinary
same-version reinstall.

**Partial-failure rule, stated in advance so it is not decided under pressure:** if the app launches but a
pillar cannot read, roll back the binary immediately and diagnose from logcat off-device. Do not attempt a
forward fix on the owner's live install.

**Residual:** reverting the binary cannot help if the new build *writes* something the old cannot read.
This increment writes nothing new - no schema change, no new column, no format change - which is why that
residual is negligible rather than merely unlikely.

---

## Verification plan

### Repository gates

```powershell
npm run test:codex ; npm run test:query ; npm run test:ui ; npm run test:app
npm run check:types ; npm run check:cycles ; npm run check:source
npm run build ; npm run check:docs
```

**Stated plainly: none of these touch the native path.** They prove the web bundle and pure logic are
unaffected. That is the entire content of invariant 8 and the reason the device matrix below is not
optional.

### Build gates

- `./gradlew assembleDebug` after Increments 1, 2, 3.
- `./gradlew assembleRelease` after Increment 4.
- **`checkRecogAssets` proven fail-closed** under the new binding: rename `index.f16`, confirm
  `assembleRelease` **and** `assembleDebug` both go red naming the missing file, restore it.
- **`checkReleaseForbiddenPermissions` proven live**: its
  `Forbidden-permission gate: clean (N permissions…)` line appears in the release build log.
- Release merged-manifest `uses-permission` list diffed against the baseline APK's, plus
  `aapt2 dump badging <apk> | grep uses-permission` on the shipped artifact.

### The 16 KB proof (criterion 1)

- `zipalign -c -P 16 -v 4 app-release.apk`.
- `llvm-readelf -l` over every extracted `lib/arm64-v8a/*.so`; per-library `PT_LOAD Align` table.
- Optional corroboration only: a **local, never-committed** `debuggable true` release variant to surface the
  on-device dialog. It installs over the release build because the signing config is unchanged.

### Device matrix (release APK, `adb install -r`, no uninstall)

Report must name device, Android version, WebView version, build type, and `versionCode`. Every row reported
PASS / FAIL / NOT RUN individually.

**Data and storage**
1. Cold launch succeeds on the **existing v11 database** - this alone proves the R8 keeps for the new
   SQLCipher namespace.
1b. Cold launch succeeds on a **clean install with no database**, so first-run creation and the full
   migration replay v1..v11 are exercised under the new plugin, not just the already-migrated case. Codex
   required both halves before "db.js needs no source change" can be accepted.
2. Collection, Wishlist, Decks, Play/match history populate; counts match Increment 0's record.
3. **Large result set:** full collection list plus a broad catalog search - forces `CursorWindow` paging,
   the failure a too-narrow ProGuard keep would hide.
4. Write and persist: adjust an owned-copy count and record a match; force-stop; relaunch; both survived.
5. Transaction path: save a deck edit (`tx()`), reopen, verify.
6. **Increment A's whole-app backup still works** and produces a file that restores on the emulator.

**Target-36 behavior (owner directive)**
7. **Predictive back**, every layer: system back gesture from a sheet, a modal, the FAB menu, a deck
   detail, a live match, and the root tab - each peels the expected layer per `navBack.js`'s tested
   precedence, and root back exits rather than stranding. Includes the gesture's animation not leaving the
   app in a wedged state.
8. **Scanner back states:** back from the camera preview, from the recognition sheet, and mid-scan; the
   scanner Activity finishes cleanly and returns to the WebView.
9. **Edge-to-edge / system bars:** status and navigation bar areas render correctly on a gesture-nav device
   and a 3-button-nav device; no content under the bars; the counter's `--safe-*` variables still hold.
10. **Immersive match mode** enters and exits (`StatusBar.hide()/show()`).
11. **Keyboard / insets:** focus a search field and a bottom-sheet input; `--kb` lifts the correct element;
    the header does not shove and the nav does not appear.
12. **Deep links:** `compendium://deck?…` and `compendium://match?…` open the import screen, both from cold
    start and from background.
13. **Reduced motion:** with the per-profile setting on, animated surfaces respect it.
14. **>= 600dp portrait lock:** on a `600dp+` emulator (a tablet profile), rotate the device and open the
    scanner. **The app and the scanner must both stay portrait**, proving the
    `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` opt-out is being honoured. Then temporarily remove the
    property and confirm the app *does* rotate - proving the property is what is holding it, rather than an
    emulator that was never going to rotate anyway.

**Plugins**
15. **Scanner:** full OCR scan, "Try visual match" (ONNX under R8), QR scan (ML Kit barcode).
16. **Filesystem + Share:** profile export via share sheet (`Encoding.UTF8` path) and match-image share
    (base64 path) - both call sites of the tightened v8 `writeFile` contract.
17. **Art cache:** an uncached card downloads and renders (`downloadFile`, and the `CapacitorHttp` ->
    base64 -> `writeFile` fallback).
18. **Haptics** on a life-counter tap; **keep-awake** during a match.
19. **Zero-image**: with images disabled, every pillar remains *usable* - build a deck, read a rule, add a
    card to the collection, run the life counter. The bar is function, not appearance (Constitution §3.6);
    art slots showing their deterministic fallback is a PASS, not a defect.
20. `npm run check:smoke` - every route rendered.

### Web

`npm run dev` - the sql.js backend is untouched; confirm it opens, reads, and writes.

### Stated gaps

No automated regression test covers any native or target-36 behavior, and this increment adds none. Rows
7-20 are manual and their failure modes are release-only. A row that cannot be run is reported NOT RUN with
the reason; it is never inferred as a pass.

---

## Security, privacy, performance, and operations

**Security.** No new permission, capability, or network surface. The forbidden-permission gate is
re-verified rather than trusted and the merged manifest is diffed against the baseline, because an androidx
and Firebase-adjacent bump is precisely how `AD_ID` arrived unnoticed for 37 builds
(`AndroidManifest.xml:86-104`). sqlite 8.1.1 still declares `androidx.biometric:1.1.0`, so the two
`tools:node="remove"` entries at `AndroidManifest.xml:111-129` remain correct and stay.

**Privacy.** Unchanged. Telemetry consent is owned natively by `TelemetryPlugin` and is untouched.

**Performance.** APK size moves in both directions (new SQLCipher artifact, androidx bumps, a different R8).
Reported as a before/after measurement against the baseline, not asserted. Cold start is watched; no budget
is claimed.

**Operations.** The build now requires **JDK 21** - already what `JAVA_HOME` points at (Android Studio JBR,
OpenJDK 21.0.10) - and **Node >= 22** for the Capacitor 8 CLI (local 24.16.0). `npm run android`,
`assembleRelease`, and `scripts/distribute.mjs` are unchanged in shape; `distribute.mjs` only compares the
APK's `versionCode` to `package.json`.

---

## Documentation impact

| Document | Disposition |
|---|---|
| `BUILD.md` | **Update.** JDK 21 / Node 22 requirement (lines 205-226 currently say only "JDK"); the 16 KB status at lines 378-381 and 404-414, which records `libsqlcipher.so` as an open gap and "compileSdk / targetSdk remain 35"; the new static 16 KB verification commands; the plugin list at lines 237-238; the target-36 behavior notes; the `checkRecogAssets` binding change; the biometric note at lines 319-329 re-confirmed against sqlite 8.1.1 |
| `docs/WORK_IN_FLIGHT.md` | **Update.** Add the `capacitor-8` row at start; on merge delete it, delete the "Planned, not started" section at lines 48-55, and strike the Capacitor 8 follow-up at line 44 |
| `COMPENDIUM_ARCHITECTURE.md` | **Reviewed - no change expected.** It names plugins by role, never by version (lines 153-155, 203); no pillar ownership, boundary, or dependency direction changes. Re-read before completion; updated if the final diff proves otherwise |
| `COMPENDIUM_DATA_MODEL.md` | **Reviewed - no change expected.** Schema stays 11; the browser/native contract table (lines 58-62) stays true; no table or transfer format changes. `check:docs` asserts the documented schema version matches `src/store/schema.js`, which is untouched |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Reviewed - no change required** *unless* the target-36 matrix forces a user-visible behavior change (row 14 is the candidate), in which case it is updated in the same change |
| `DESIGN_SYSTEM.md` | **Conditional.** Untouched if no source change is needed. If the edge-to-edge/inset correction fires, the platform-render rules are updated to record the target-36 behavior |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed - no change required.** |

---

## Risks and unanswered questions

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | Kotlin 2.4 / K2 + Compose 2.x strong skipping changes scanner recomposition behavior in a way only a human eye catches | Med | **High** | Isolated in Increment 2; scanner rows 8 and 15 on the device matrix | Claude |
| 2 | React 19 or Vite 8 regresses UI behavior that no test covers | Med | Med | Increment 1 lands alone with the full web gate suite plus a hand pass in `npm run dev`; device rows re-check the same surfaces in the shipping WebView | Claude |
| 2b | The single-increment scope makes a failure hard to attribute | **High** | Med | Owner decision, accepted. Mitigated by ordering: ten individually gated steps, cheapest and most isolated first | **Owner (accepted)** |
| 3 | The `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` opt-out is not honoured, so the app rotates on >= 600dp despite being portrait-only | Low | **High** | Device row 14 proves it both ways (with and without the property). Phones are exempt from the override regardless | Claude |
| 4 | Predictive back breaks a back layer despite the AndroidX dispatcher path | Low-Med | **High** | Device row 7 covers every layer; bounded fallback `enableOnBackInvokedCallback="false"` | Claude |
| 5 | R8 keep correct at launch but wrong for `CursorWindow`, failing only on a large result set | Med | **High** | Parent-package keep; device row 3 forces paging | Claude |
| 6 | Edge-to-edge enforcement shifts chrome or insets | Med | Med | Device rows 9-11; bounded correction surface pre-authorised | Claude |
| 7 | `libsqlcipher.so` in the assembled APK is not 16 KB aligned | Low | **High** | Increment 5 checks the artifact before the device pass; if it fails, stop | Claude |
| 8 | Firebase/crashlytics Gradle plugins need bumps under AGP 8.13, widening the diff | Med | Low | google-services already at 4.4.4; further bumps reported with their forcing error | Claude |
| 9 | The device matrix is 20 manual rows and manual passes get skipped when the diff looks finished | Med | Med | Every row reported individually; NOT RUN is a valid, visible outcome | Claude |

**Decision still required from the owner:**

1. **Confirm the pre-authorised correction surface** listed under "No source change is a hypothesis" is the
   right boundary, i.e. that anything beyond it stops for approval. Note that Increment 1 widens the
   *possible* source-change surface in practice: React 19 and Vite 8 could surface a UI defect anywhere in
   `src/**`, and fixing such a defect is repair of this increment's own change rather than scope creep. The
   boundary that still holds is the **target-36 compatibility** surface; a React/Vite regression fix is
   in-scope wherever it lands, and is reported in the change ledger.

---

## Self-Critique

**The strongest case this design is wrong.** It couples two changes that do not have to travel together. The
16 KB fix requires Capacitor 8. Target API 36 requires a toolchain Capacitor 8 happens to supply, but it is
future-proofing rather than a consequence of the SQLCipher defect - and it is the half carrying genuine
behavior-change risk: predictive back and edge-to-edge enforcement land on live UI, and neither is covered
by any automated test in this repository. Bundled, a failure in the target-36 half will be diagnosed
against a diff that also moved every Capacitor package, AGP, Gradle, Java, Kotlin, and Compose. The
counter-argument is real - one device verification pass instead of two - and the owner has decided. But a
reviewer should notice that Increment 2 is where four independent risk sources merge into one commit, and
should press on whether targetSdk 36 could land as its own increment *after* the upgrade is proven, at the
cost of a second device pass. (The orientation override, which revision 1 treated as the largest target-36
risk, is now resolved by a documented manifest opt-out and is no longer part of this argument.)

**The assumption with the highest consequence if false.** Assumption 3 - Kotlin 2.4.10 compiles the scanner
unchanged. K2 is a different frontend, and 3,778 lines of Compose/CameraX/coroutine code is enough surface
for a real incompatibility; 1.9.24 -> 2.4.10 is a wider jump than the 2.2.20 revision 2 proposed. If it
fails to *compile*, that is loud and cheap. What worries me is the case where it compiles and strong
skipping silently changes when a composable recomposes - a scanner that misses a frame update or stops
reflecting a state change is exactly the kind of defect a five-minute device pass does not catch, and there
is no test that would.

**Where revision 2's reasoning failed, and what that implies.** Revision 2 recommended Kotlin 2.2.20 on the
grounds that it was the vendor's declared baseline, and treated "matches the vendor" as equivalent to
"supported". It is not: Kotlin's own matrix caps 2.2.20 at AGP 8.11.1, so Capacitor's declared pairing is
itself out of band. I did not check the Kotlin side of a Kotlin decision, and a reviewer should assume the
same class of error may exist elsewhere in this document wherever I have justified a version by citing who
ships it rather than by checking its stated compatibility. The audit's Tier-1 table is the place that
reasoning is most concentrated.

**Coupling the analysis might have missed.** Three build-level items, all invisible to every test:
(a) `checkRecogAssets`'s fail-open binding, which I am fixing but which existed unnoticed through every
prior release; (b) the generated `capacitor.build.gradle` overriding the app module's `compileOptions`, so
the Java version is not controlled where it appears to be; (c) `shrinkResources true` plus a Compose
compiler change, where a resource reachable only through Compose could in principle be shrunk away. I found
(a) and (b) by reading rather than building, which means there is plausibly a fourth of the same kind.

**The failure most likely to escape the plan.** A ProGuard keep that is correct for startup and wrong for
one JNI-reached class - the exact shape of the two failures already recorded in `proguard-rules.pro:38-54`,
once for SQLCipher and once for ONNX Runtime, both release-only, both discovered after every gate was green.
The new artifact registers natives against `net.zetetic.database.CursorWindow` as well as the `.sqlcipher`
classes, and a cursor window is only exercised once a result set is large enough to page. An app that
launches, shows a deck, and passes a casual device pass can still abort on the owner's full collection list.
The parent-package keep and device row 3 exist for that, but a manual checklist item is a weaker control
than a test and I cannot make it stronger inside this change.

**Evidence that would change the decision.**
- `libsqlcipher.so` in the assembled APK is still 4 KB aligned -> half the premise is void; stop.
- Kotlin 2.4.10 cannot compile the scanner without source changes -> checkpoint; the increment acquires a
  Compose migration it was not scoped for.
- React 19 or Vite 8 regresses UI behavior no test covers -> repair is in scope (it is this increment's own
  change), but a large or architectural fix is a checkpoint.
- Row 14 shows the scanner is unusable on large screens -> owner decision 1, and possibly a separate
  proposal.
- Any device read failure after install -> roll back the binary immediately and re-open the design.

---

## Approval record

| Gate | Disposition | Date |
|---|---|---|
| Proposal review (Codex) - revision 1 | Superseded | 2026-08-09 |
| Proposal review (Codex) - revision 2 | **Changes required** - 2 blockers, 4 majors | 2026-08-09 |
| Proposal review (Codex) - revision 3 | **Changes required** - hash preimage, stale text | 2026-08-10 |
| Proposal review (Codex) - revision 4 | **Changes required** - stale active instructions only; "once that exact semantic sweep is complete, the architecture is approval-ready" | 2026-08-10 |
| Semantic sweep | Complete. Every active section Codex cited is corrected; superseded facts survive only in revision tables explicitly labelled as such | 2026-08-10 |
| **Architecture approval (human project owner)** | **APPROVED** | **2026-08-10** |

**What the approval covers, stated precisely.** The owner has approved the architecture and may proceed to
implementation of the approved design. Codex issued its final disposition as *conditionally* approval-ready
pending the semantic sweep; the sweep is now complete but **Codex has not re-inspected it**. Per
`AGENTS.md` §4, the remaining gate is the **final review of the actual diff**, which is unaffected: Codex
reviews the implementation independently when it exists. Any divergence discovered during implementation
stops at the §12 checkpoints rather than being absorbed silently.


### Owner decisions recorded (2026-08-09) - do not re-litigate

1. **Proceed with the full Capacitor 6 -> 8 upgrade. Do not use `patch-package`.**
2. **Move both `compileSdk` and `targetSdk` to API 36.**
3. **Java 21 and Kotlin 2.2.20**, using the matching `org.jetbrains.kotlin.plugin.compose` plugin.
4. **Increment A (whole-app backup/restore) is a prerequisite.** It supplies the data safety net and the
   **rollback source baseline**; this increment builds and archives the rollback binary itself, at its own
   `versionCode`.
5. **Target API 36 is future-proofing.** It becomes the minimum required target within months, so it is
   absorbed by this increment rather than deferred into a second native change and a second device pass.
6. **The app is portrait-only, always.** It needs no landscape support whatsoever. Portrait is a fixed
   product property, not a question for this increment to resolve.
7. Remove the Kotlin-1.9 / AGP-8.13 probe and the lower-AGP fallback.

### Owner decisions recorded (2026-08-09, second round) - do not re-litigate

8. **Kotlin 2.4.10**, not 2.2.20. Evidence subsequently confirmed this is also the only *supported* pairing
   with AGP 8.13.0. Compose BOM follows to 2026.06.01.
9. **One job: fold everything in.** The web tier (React 19, Vite 8 + plugin-react 6, static-copy 4, sql.js,
   qrcode-generator 2, sharp, firebase-tools) joins this increment rather than running separately.
10. **CameraX 1.6.1 and Firebase BoM 34.17.0 are in scope.**
11. Superseding decision 6 above: only **AGP 9, TypeScript 7 and ONNX Runtime** stay pinned, each with an
    evidenced blocker recorded in `docs/WORK_IN_FLIGHT.md` with the trigger that unblocks it. ML Kit needs
    no action - it is already at latest.

### Codex disposition -> Rev-2 section map

The disposition was relayed as a directive list rather than numbered findings. Each relayed requirement is
mapped below; if Codex's original numbering is supplied, this table will be re-keyed to it.

| Required change | Where it is answered in Rev 2 |
|---|---|
| Rewrite with targetSdk 36 and Kotlin 2.2.20 as **planned scope**, not contingencies | "What changed from revision 1"; Proposed design / Versions; Kotlin section |
| Remove the Kotlin-1.9/AGP-8.13 probe and lower-AGP fallback | Options (ladder deleted); Implementation plan Increment 1, explicitly labelled sequencing rather than a probe |
| Apply the cumulative official 6->7 and 7->8 migration checklists | "The cumulative migration checklist (6 -> 7 -> 8)" - full table with per-version template evidence |
| …including navigation + density `configChanges` | Same table (`navigation` dated to v7, `density` to v8, both missing today); Increment 3 |
| …and deprecated Gradle syntax | "Deprecated Gradle syntax"; Increment 3 |
| Keep Compose BOM, CameraX, ML Kit, ONNX, Firebase BoM pinned initially | Non-goals; Versions block ("PINNED"); Assumption 4; Risk 2 |
| Add target-36 verification for predictive Back, edge-to-edge/system bars, keyboard/insets, deep links, scanner Back states, reduced motion, >=600dp adaptive/orientation | "Target API 36: what actually changes"; Device matrix rows 7-14 |
| Make "no source change" conditional on that experiment | "'No source change' is a hypothesis, not a claim" |
| Allow a bounded System Bars / CSS-inset compatibility correction if required | Same section - the four-item pre-authorised surface, with everything beyond it a checkpoint |
| Replace the fail-open `checkRecogAssets` task-name pattern with a stable fail-closed release binding | "`checkRecogAssets`: fail-open -> fail-closed"; Increment 4 |
| …then prove it fails when an asset is absent | Verification / Build gates - rename `index.f16`, confirm red, restore |
| Archive and rehearse downgrade using the signed post-backup baseline APK | Prerequisite section; Increment 0; Rollback table |
| Preserve schema v11 and `MIGRATIONS` unchanged | Criterion 7; Non-goals; Data migration and compatibility |
| Update the approval record with owner decisions | This section |
