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
