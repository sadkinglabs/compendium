# Review packet - `capacitor-8` (Capacitor 6 -> 8, Android 16, Java 21)

**For:** Codex / ChatGPT, as independent adversarial reviewer.
**Author:** Claude Code (lead engineer). **Date:** 2026-08-10.
**Branch:** `capacitor-8`, 11 commits ahead of `main`. Nothing pushed; `main` is local-only.
**Ask:** disposition the diff. Blockers / Majors / Minors, and say plainly what does not hold up.

This packet does not re-argue the design - that is
[`capacitor-8-upgrade.md`](./capacitor-8-upgrade.md) Rev 5, already approved over three review rounds.
It reports **what was actually built and what was actually measured**, and points at the places most
likely to be wrong.

---

## 1. What changed

```
BUILD.md                                    |   44 +-
android/app/build.gradle                    |  111 +-
android/app/capacitor.build.gradle          |    4 +-
android/app/proguard-rules.pro              |   21 +-
android/app/src/main/AndroidManifest.xml    |   30 +-
android/.../scanner/ui/ScannerScreen.kt     |    4 +-
android/build.gradle                        |   10 +-
android/gradle/wrapper/gradle-wrapper.properties |  4 +-
android/variables.gradle                    |   58 +-
docs/WORK_IN_FLIGHT.md                      |   70 +
docs/proposals/capacitor-8-upgrade.md       |   27 +
package-lock.json                           | 3615 +++++-----
package.json                                |   43 +-
scripts/strip-native-wasm.mjs               |   24 +-
src/components/qrCode.test.mjs              |   58 +
src/store/db.js                             |    8 +-
vite.config.js                              |   15 +-
```

**Exactly one production source file outside build config changed:** `ScannerScreen.kt`, a single import
(`androidx.compose.ui.platform.LocalLifecycleOwner` -> `androidx.lifecycle.compose.LocalLifecycleOwner`,
same symbol, deprecated in the new Compose). Plus `src/store/db.js` (8 lines, wasm resolution) and
`vite.config.js`. **No app logic, no schema, no repository, no UI behaviour** other than the portrait lock.

Schema stays **v11**; `MIGRATIONS` untouched.

### Toolchain

| | From | To |
|---|---|---|
| Capacitor (11 packages) | 6.2.0 | **8.5.0** |
| AGP | 8.6.0 | **8.13.0** |
| Gradle | 8.7 | **8.14.4** |
| Java / Kotlin JVM target | 17 | **21** |
| Kotlin | 1.9.24 | **2.4.10** |
| compileSdk / targetSdk | 35 / 35 | **36 / 36** |
| cordova-android | 10.1.1 | **15.1.0** |
| CameraX | 1.4.1 | **1.6.1** |
| Firebase BoM | 33.7.0 | **34.17.0** |

Versions were chosen from each artifact's own published `minCompileSdk` / `minAndroidGradlePluginVersion`
(AAR metadata), not the Capacitor template. That rejected Kotlin 2.2.20 (KGP caps it at AGP 8.11.1, below
the 8.13.0 the template itself ships), Lifecycle 2.11.0 (needs sdk37 / AGP 9.1.0) and cordova-android
14.0.1 (API <= 35).

---

## 2. The result the change exists for

`libsqlcipher.so`, the last of seven 16 KB failures, verified **on the assembled artifacts**, not the AAR:

- **APK:** `zipalign -c -P 16 -v 4` -> "Verification successful", **zero BAD**. All 9 arm64 libs `STORED`
  with `PT_LOAD p_align 16384`. `extractNativeLibs=false`. arm64-only.
- **AAB:** `bundletool dump config` -> `"alignment": "PAGE_ALIGNMENT_16K"`.
- **Delivered splits:** `bundletool build-apks`, then **all 83 generated APKs** scanned, not one
  representative. Exactly one carries native libs; it passes independently under `zipalign`.
- APK is **357,575 bytes smaller** (-0.47%) than the pre-upgrade rollback baseline.
- Release merged-manifest permissions **byte-identical** to the pre-upgrade baseline (7 entries, no
  `AD_ID`).

---

## 3. Three latent defects found, and the pattern they share

Each was a control that read correctly and protected nothing. **This is the part most worth attacking -
if the pattern generalises, there are more.**

1. **R8 keeps named a dead package.** Plugin 8.x replaced `net.zetetic:android-database-sqlcipher` with
   `net.zetetic:sqlcipher-android:4.17.0`, moving classes `net.sqlcipher.*` -> `net.zetetic.database.*`.
   `libsqlcipher.so`'s `JNI_OnLoad` resolves them by original name via `FindClass`, so R8 renaming them
   aborts at launch - **release only**, since debug is not minified. Confirmed by dex scan both
   directions, then confirmed live on device.
2. **The forbidden-permission gate bound to `assemble*` only**, leaving the **AAB ungated**.
   `gradlew bundleRelease` produced a shippable bundle that never checked for `AD_ID`.
3. **`checkRecogAssets` was fail-open**, bound via `tasks.matching { it.name ==~ /merge.*Assets/ }` - an
   AGP rename matches nothing, the gate silently stops running, the build stays green.

Both gates now bind with `tasks.named()` (throws on unknown task) inside `gradle.projectsEvaluated`
(**not** `afterEvaluate`, which runs before AGP creates variant tasks - the first attempt failed exactly
that way). Provoked rather than assumed: with `index.json` renamed away, `assembleRelease`,
`bundleRelease` and `installDebug` each went red naming the missing file.

**Fourth, a documentation-vs-code discrepancy:** the approved proposal asserted the app was portrait-only.
Only `ScannerActivity` declared `screenOrientation`; **`MainActivity` never had**, so the app rotated. The
opt-out property cannot create a lock that was never declared. Owner confirmed the lock; it is a separate
revertible commit, and the proposal now carries a correction rather than a silent edit.

---

## 4. Verification, stated exactly

**Passed.** 12/12 repository gates; **1,246 tests, 0 failures**. `assembleDebug`, `assembleRelease`,
`bundleRelease` all succeed. Zero Gradle deprecation warnings (was five plus a KGP notice). `cap doctor`
clean, Java 21, all nine plugin modules.

**Device (Pixel 9 Pro XL, build 218, release, signed, real user data).** `install -r`, never uninstalled.
targetSdk 36 confirmed by `aapt2 badging`. No fatal logcat lines. SQLite plugin opened the real database.
CameraX 1.6.1 streaming with ML Kit receiving frames. Edge-to-edge correct. Back navigation clean.
`check:smoke` **8/8 routes**. Owner exercised the scanner end to end; reports navigation and search
perceptibly faster.

**Rollback rehearsed, bidirectionally**, against the real upgrade build: upgrade -> rollback -> upgrade,
same `versionCode` 218, same signing certificate (SHA-256 verified equal), data identical at every step
(1832 cards / 4 decks / 9 matches / 2 marginalia).

### NOT verified - please weigh these, do not assume they are covered

- **>= 600dp portrait (device row 14). NOT RUN.** Owner deferred it to a dedicated tablet tune-up.
  `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` is declared and merging **without ever being observed
  doing its job**, with or without the property. Phones are exempt from the Android 16 override, so
  nothing shipping to phones is at risk; large-screen behaviour is simply unproven. **Is merging with
  this open acceptable, or does the property belong behind the tablet pass?**
- **Predictive-back gesture.** Only the BACK keyevent was exercised, which is not the same thing as the
  gesture animation.
- **`check:smoke` failed once**, on the first launch immediately after install, then passed every
  subsequent run (3/3). Read as ART warm-up, but that is an inference from one data point, not a
  diagnosis.
- **`App.jsx` has no test coverage** - a prior increment shipped a JSX syntax break that six green gates
  missed and only `npm run build` caught. Unchanged here; still owed.
- **No emulator/x86 pass.** Debug keeps all four ABIs, but only arm64 hardware was exercised.

---

## 5. Where I think this is most likely wrong

Ranked by my own confidence, lowest first. Attack these before the rest.

1. **`gradle.projectsEvaluated` for gate binding.** It works and is provoked-tested, but it is a
   coarse hook and I reached it after `afterEvaluate` failed. Is there a properly lazy AGP-idiomatic
   binding (variant artifact API) that is fail-closed without depending on evaluation order?
2. **`-keep class net.zetetic.database.** { *; }` may be broader than needed.** I kept the whole tree
   because JNI resolves by original name and I could not enumerate precisely which classes `JNI_OnLoad`
   touches. Over-keeping costs size and hides future breakage.
3. **`io.liteglue.**` keeps were deleted** on the evidence of a dex scan showing the package absent. If
   any path loads it reflectively at runtime rather than statically, a dex scan would not have seen it.
4. **Kotlin 2.4.10 over the vendor-declared 2.2.20.** I overrode what `@capacitor/filesystem` declares,
   on the argument that KGP's own matrix makes 2.2.20 + AGP 8.13.0 unsupported. If that reasoning is
   wrong, it is wrong across the whole build.
5. **`density` in `configChanges` on `MainActivity` only.** Asymmetric with `ScannerActivity` by
   deliberate choice; I may have the trade-off backwards.
6. **The wasm move to a Vite `?url` import.** It fixed a silent break (`vite-plugin-static-copy` v4 began
   preserving the source directory, so `db.js` requested a path that no longer existed and the web/dev
   SQLite backend would have stopped loading). Web-only path, no native impact, but it is the one change
   here with no device coverage by construction.

---

## 6. Known and deliberately deferred

- **AGP 9, TypeScript 7, ONNX Runtime** - the three deferrals from
  [`dependency-audit-2026-08.md`](./dependency-audit-2026-08.md) Rev 2, unchanged.
- **`PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` is removed at API 37.** Targeting 37 will make large
  screens rotate regardless. Recorded in the manifest and BUILD.md; a future product decision.
- **Compose `material-icons`** is frozen at BOM 1.7.8 and now declared explicitly (it used to arrive
  transitively via material3 1.2.1, which 1.4.0 dropped). Six inline vector paths would remove it.
- **Art re-fade on pillar switch** - diagnosed during this pass, **not a regression from this branch and
  not a cache failure**; `ArtImage` holds its loaded flag in component state. Queued to its own branch by
  owner decision so this diff stays purely toolchain.

---

# Round 1 disposition - response (2026-08-10)

All four Majors and the Minor are addressed. Two of the findings were correct about a defect I had
already "fixed" once, which is the useful part of this round.

## Major 1 - forbidden-permission gate bypassable. FIXED, and the diagnosis was mine to own.

Confirmed exactly as reported: `:app:installRelease --dry-run` scheduled `checkRecogAssets` and **not**
the permission gate, because `installRelease` depends on `packageRelease`, not `assembleRelease`.

The real defect is that I had bound this gate to **convenient names for the build** twice running - v1
to `assemble` only (so `bundleRelease` shipped an ungated AAB), v2 adding `bundle` (so `package` and
`install` still slipped past). Enumerating entry points and hoping the list is complete *is* the bug.

Now bound to `package<Variant>` and `package<Variant>Bundle` - the tasks that **write** the `.apk` and
`.aab`. Every route runs through one of them, so coverage is complete by construction and a new entry
point cannot open a new bypass.

**Graph evidence, all six entry points:**

| Entry point | Permission gate | Recogniser gate |
|---|---|---|
| `assembleRelease` | PRESENT | PRESENT |
| `bundleRelease` | PRESENT | PRESENT |
| `packageRelease` | PRESENT | PRESENT |
| `packageReleaseBundle` | PRESENT | PRESENT |
| `signReleaseBundle` | PRESENT | PRESENT |
| `installRelease` | PRESENT | PRESENT |

**Provoked-negative:** with the `AD_ID` `tools:node="remove"` suppressed, `packageRelease`,
`packageReleaseBundle` and `installRelease` each exited non-zero and named `AD_ID`. Manifest restored
and verified byte-identical to HEAD afterwards.

## Major 2 - clean-database and backup/restore under the upgraded plugin. CLOSED, mostly natively.

The x86_64 emulator could not be used: this machine has no hypervisor driver and enabling one needs
admin rights plus a reboot. Owner chose a better substitute - **a temporary second Android user on the
Pixel**, which gives a genuinely empty app sandbox while running the **real arm64 minified release
APK** (an emulator could only have run the debug build, since release is arm64-only).

1. **Clean-install first-run database creation: PROVEN.** `pm install-existing --user 10`, empty data
   sandbox, cold launch. The app created its database and rendered first-run state: `WELCOME` (not
   `WELCOME BACK`), starter `Sorcerer` profile, 0 cards / 0 decks / 0 matches, owner data absent. No
   crash. Test user removed afterwards; device returned to Owner.
2. **Whole-app backup under the upgraded plugin: PROVEN, against real data.** Better than the empty
   sandbox: a backup of the owner's live 1832-card database. `db.snapshot()` completed and the file was
   produced - which is the specific concern raised ("transaction behavior breaks snapshot()").
   Compared byte-for-byte against the **pre-upgrade** backup taken at build 216: **every table row count
   identical** (991 `owned_cards`, 243 `deck_entries`, 184 `deck_history`, 34 `match_log_entries`, 9
   matches, 4 decks). A full deep diff found **exactly one differing field** in the entire dataset -
   one `owned_cards[].updated_at`, moved to today, consistent with the owner's scanner test writing
   that row. Nothing else changed across the plugin major.
3. **Restore into a fresh database with integrity verification: PROVEN.**
   `scripts/backup/verify-archive.mjs` restored the **post-upgrade** archive into a database that had
   never held it, reading through the production reader, **independently recomputing the digest**
   rather than trusting the reader's verdict. `RESULT: ALL CHECKS PASSED` - 4 decks, 243 deck entries,
   184 history rows, 9 matches, 34 log entries, **1832 owned copies**, exactly one default profile.
4. **The native restore path, on device, under Capacitor 8: PROVEN up to the write.** SAF picker,
   file selected, read and digest-verified on device, preview planned **1,476 rows**, Sadkingbilly
   4 decks / 991 cards / 9 matches. Closed without confirming; owner data verified unchanged (1832).

**Residual gap, stated precisely:** the final *write* of a native restore into a clean device install
was not executed. A secondary Android user cannot receive a file from `adb` (`push` and MediaStore
insert both denied), and the app saves backups through a share sheet the bare test user had no target
for. So restore's write path is proven by `verify-archive` into a fresh database and by the on-device
plan, but not by a native confirmed restore on an empty install. Confirming it in the owner's live
profile would add duplicate profiles to real data, which I did not do unasked.

## Major 3 - predictive back. TESTED, real edge gesture, three states.

Static basis first: `@capacitor/app` 8.1.1 registers an `OnBackPressedCallback` on the
`OnBackPressedDispatcher` - the predictive-back-compatible API, bridged to `OnBackInvokedCallback` by
AndroidX Activity 1.13.0. `enableOnBackInvokedCallback` is not declared, and the platform default at
target 36 is true. Then observed, with an edge swipe:

| State | Result |
|---|---|
| Sheet open (Profiles) | Sheet closed, stayed in app, `MainActivity` still resumed - the JS consumer received it |
| `ScannerActivity` | Returned to `MainActivity`; camera controller closed; 0 fatal / camera-error lines |
| App root | Consumed with the "Press back again to exit" toast - deliberate double-back-to-exit (`App.jsx:380`), not a missed gesture. A second swipe within 2s exited to the launcher. Relaunch intact, 1832 cards |

No case exposed the underlying Activity, exited unexpectedly, or left the scanner mis-lifecycled.

## Major 4 - resolved graph and advisories. CLOSED, and the declared version was worse than stale.

`androidxCoreVersion = '1.17.0'` was **referenced by nothing** - a dead knob carrying a comment shaped
like a decision, so the documented version could never have won. Release resolved `androidx.core:core`
to **1.18.0** via `activity:1.13.0` then `core-ktx:1.18.0`.

**Adopted 1.18.0 and declared it explicitly.** Its AAR metadata says `minCompileSdk=36`,
`minAndroidGradlePluginVersion=8.9.1`; the build is 36 / 8.13.0, so it is legal under the same
both-sides test as everything else. Constraining to 1.17.0 would fight activity 1.13.0 to no benefit.
`core:1.19.0` verified genuinely out of reach (`minCompileSdk=37`, `minAGP=9.1.0`). The resolved graph
(228 modules) is recorded in the audit addendum.

**Advisories dispositioned by hand.** Production surface: **0**. `npm audit fix` would **downgrade
`@capacitor/cli` to 8.4.2 and `firebase-tools` to 14.23.0**, partially undoing this upgrade. Removed
`@capacitor/assets` - a one-off icon generator no script references, unpatchable in place, and the sole
source of the only **critical** (`tar`); it runs via `npx` when needed. `firebase-tools`,
`@capacitor/cli` and `sharp` accepted with reasons (server-side or iOS-only advisories against tooling
used as a client, with no `ios/` directory present). **22 to 17, critical eliminated, production still
0.** Full table in the audit addendum.

## Minor - wasm strip. FIXED, and the first fix was wrong too.

Now matched by **specific name** (`sql-wasm.wasm` / `sql-wasm-<hash>.wasm`), so a future
native-required wasm cannot be deleted for sharing an extension. More importantly it now walks the
**whole synced asset tree**, because both earlier versions read a single directory - which is exactly
how a relocated asset shipped 640 kB silently.

I did not implement fail-on-zero as literally specified, and want that flagged rather than glossed:
a hard error on zero breaks idempotency, since after a successful strip the file is legitimately
absent. The recursive search is what makes "absent" trustworthy, so zero is reported with its reason
and **multiple matches is the hard error**. All four branches exercised, including the relocation case
that reproduces the original bug.

## Still open, unchanged

- **>= 600dp portrait.** Deferred by owner to a dedicated tablet pass. `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` merges declared but never observed working. Phones are exempt from the override, so nothing shipping to a phone is affected.
- **`App.jsx` has no test coverage.** Unchanged, still owed.
- **No x86 pass.** The emulator could not run; the multi-user substitute is arm64.

---

# Round 2 disposition - response (2026-08-10)

Both Majors and the Minor are addressed. All three findings were correct, and the first two were both
cases of a fix that looked complete because the check I used could not see the hole.

## Major - recogniser gate retained the producer bypass. FIXED.

Correct, and the way it hid is the point: after moving the permission gate onto the producers I ran a
six-entry-point graph table, saw `checkRecogAssets` PRESENT everywhere, and treated that as done. It
was present at `packageRelease` only via the `merge.*Assets` line whose own comment calls it
non-guaranteeing. My verification method could not distinguish "bound to the producer" from "inherited
through the fail-open binding", so it confirmed what I wanted rather than what I needed.

Now bound to `package<Variant>` and `package<Variant>Bundle`, the same producers as the permission
gate. The opportunistic `merge.*Assets` binding remains for a faster trip, explicitly not as the
guarantee.

**Verified by simulating the failure rather than by re-reading the graph.** With the `merge.*Assets`
binding commented out - an AGP rename, in effect - the gate is still scheduled by every producing path:

| Entry point (merge-assets binding disabled) | `checkRecogAssets` |
|---|---|
| `packageRelease` | PRESENT |
| `packageReleaseBundle` | PRESENT |
| `assembleRelease` | PRESENT |
| `bundleRelease` | PRESENT |

`app/build.gradle` restored and confirmed unmodified afterwards.

## Major - native restore-write acceptance. NOW EXECUTED, with one honest limitation.

Executed end to end through the native plugin, on the real arm64 minified release APK, in a
**disposable second Android user** (id 11) created for the purpose and removed afterwards:

1. Fresh sandbox, cold launch: database created, first-run state (`WELCOME`, 0 cards / 0 decks /
   0 matches, starter `Sorcerer`).
2. Whole-app backup prepared **by the app under plugin 8.x** and saved to that user's Downloads.
3. `pm clear --user 11` - app data wiped, a genuine fresh-install state. Relaunch confirmed first-run
   again (second independent proof of clean-database creation).
4. **Restore executed and CONFIRMED** through the production path: SAF picker, on-device read,
   `"The file passed its checksum, so it is intact"`, then the confirm button - the real
   `executeSet(..., true)` write, not a preview.
5. **Result verified:** a new profile `Sorcerer (imported)` exists and is active. Name dedupe applied,
   and the archive's default was adopted, which is the default-profile handling the criterion asks
   for. No `SQLiteException`, no `FATAL EXCEPTION` (the logcat `AndroidRuntime` lines present are
   uiautomator's own debug output, not crashes - checked rather than assumed).
6. Device returned to Owner, user 11 removed, owner data verified untouched (1832 cards / 4 decks /
   9 matches).

**The limitation, stated plainly: this restore was ~0 rows, not ~1,476.** The archive came from an
empty first-run profile, because a secondary Android user cannot receive a file from `adb` (`push` and
MediaStore insert both denied) and so could not be given the owner's real archive. What is now proven
is that the native `executeSet` transaction path executes, commits, dedupes the profile name and
adopts the default under plugin 8.x. What is still **not** proven natively is behaviour at scale - the
~1,476-statement boundary specifically raised. That boundary is covered only by `verify-archive`
against the real archive on a different backend.

Two ways to close the remainder, neither taken unilaterally:
- restore the owner's real archive into their live profile and delete the imported duplicates
  afterwards (touches real data), or
- accept scale as unproven natively and record it.

**Also observed, minor and worth recording:** immediately after the restore the profile sheet still
listed only the pre-restore profile; the imported profile appeared after relaunch. Home reflected the
restore, the sheet did not. Not data loss - the write had committed - but the UI-refresh-after-restore
fix does not appear to reach the profile sheet.

## Minor - renamed SQL WASM could still evade the stripper. FIXED.

Correct, and it was the original defect wearing a third hat: searching recursively but only for the
expected basename misses a rename, and my dist cross-check reused the same pattern, so both would have
reported zero while the renamed file shipped.

The script no longer searches for what it expects. It **enumerates every `.wasm`** in the synced tree
and classifies each: `STRIP` (delete), `KEEP` (native-required, allowlisted, currently empty), or
neither - which is a **hard error naming the file**. An unclassified wasm is exactly the rename signal.
Adding a native wasm deliberately is a one-line `KEEP` entry. The dist cross-check is now an any-wasm
recursive scan too.

Idempotent zero-total success is preserved, as you allowed: the tree is enumerated in full, so absent
means absent.

**Four branches exercised:** normal strip (removed 644 kB); idempotent re-run (exit 0, explains why);
**renamed `sqljs-XYZ123.wasm` (exit 1, names the file)**; relocated-but-correctly-named (found at depth
and removed).

## Unchanged from round 1

- **>= 600dp portrait** - deferred by owner to a dedicated tablet pass; declared but never observed working.
- **`App.jsx` has no test coverage.**
- **No x86 pass** - the emulator cannot run on this machine (no hypervisor driver; enabling it needs admin plus a reboot). The multi-user substitute is arm64.
