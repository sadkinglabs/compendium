# Compendium — Build & Run

Offline-first Capacitor app. React + Vite web layer, SQLite on device, sql.js in the browser.

## Develop (web, hot-reload)

```bash
npm install
npm run dev          # http://localhost:5000  (host:true → also reachable on LAN/Tailscale)
```

The browser uses **sql.js + IndexedDB** for storage and web fallbacks for the
native plugins (haptics → `navigator.vibrate`, share → clipboard, etc.), so the
full app runs in a plain browser.

## Test

```bash
npm run test:codex   # scripts/codex/**   - the build-time codex compiler
npm run test:query   # src/store/**       - card query grammar, collection compare engine
npm run test:ui      # src/pillars/**     - pure UI state (e.g. avatar picker selection)
npm run test:app     # src/*.test.mjs     - App-shell logic (hardware-back precedence, back registry)
npm run check:types  # tsc --noEmit       - fail-closed type gate over the match-view typed boundaries
npm run check:cycles # src/**             - fail-closed circular-import gate
npm run check:source # src/**             - fail-closed source guard: canvas-method corruption + art-seam bypass
npm run check:smoke  # installed APK      - drives a device, asserts each route rendered
```

The four `test:*` scripts are `node --test` over co-located `*.test.mjs` files; `check:types` runs its own wrapper tests then the compiler check (fail-closed, gates only on the owned files). There is no browser
test runner. Logic that carries a real invariant belongs in a plain module with
fixtures beside it rather than inside a component, so it can be tested without a
DOM — `src/pillars/avatarPickerState.js` is the pattern.

Run the suites whose surface a change touches, plus `npm run build`. Interactive
behaviour still needs to be exercised by hand; see **Verify on a device** below.

### Why `check:cycles` exists

A circular import between `GothicSheet.jsx` and `ui.jsx` sat latent in this repo
until an unrelated Collection import shifted Vite's chunking. The **minified**
release build then initialised the pair in an order that left a binding in its
temporal dead zone, and the app rendered nothing on launch with `Cannot access
'X' before initialization`. The unminified build was fine.

Every gate was green at the time - all four `test:*` suites, `check:types`,
`check:docs` **and** `npm run build`. Only installing the signed release APK on a
device surfaced it.

The gate therefore fails on **any** cycle rather than judging which are currently
harmless: a cycle is a live grenade whose pin gets pulled by an unrelated import
somewhere else. Dynamic `import()` is deliberately not an edge, since it defers
evaluation and is how lazy routes legitimately point back at shared code.

To fix a reported cycle, move the shared piece into a leaf module that imports
nothing from either side - `src/components/useFocusTrap.js` and
`src/store/elements.js` are the two worked examples.

`check:cycles` catches cycles, not every minified-only initialisation hazard.
`check:smoke` below covers the general case.

### `check:smoke` - does the installed app actually start?

```bash
npm run check:smoke
```

Drives the **installed release APK** on a connected device and asserts that each
route actually rendered. It needs exactly one device attached with the app
already installed, and fails closed on zero devices, several devices, or a
missing package - a gate that silently picks a device can silently test the
wrong thing.

It asserts **what drew**, not the absence of logged errors. The failure that
motivated it logged a single error and drew nothing; a log-grepping gate would
have needed to be told which errors are fatal, whereas "did the screen draw the
thing" needs no such judgement. Console errors are also reported when Capacitor
is forwarding them, but their absence is never treated as evidence of health,
because a stock release build does not forward console at all.

Elements are located by text and tapped at the centre of their reported bounds,
never at fixed pixels, so it survives a different device or display size. Each
route's tap path is self-contained from the bottom nav, so one broken route
reports one failure instead of cascading.

Verified by deliberately breaking the set drill and confirming the gate reports
`NOTHING RENDERED (empty view tree)` for that route and exits non-zero.

**Scope.** It proves the app starts and each pillar's first screen renders. It
does not exercise gestures, sheets, writes or the scanner. Interactive behaviour
still needs a human; see **Verify on a device**.

**It cannot drive FAB menus.** `.fab-menu` transitions from `scale(.18)` to
`scale(1)` and the WebView accessibility tree keeps reporting the pre-transition
geometry, so tapping the reported centre hits the wrong item. A human tap works
correctly - rendering and hit-testing agree, only the a11y tree is stale - so
never conclude from this gate that a FAB menu is broken. Keep routes on nav tabs,
chips and tiles.

The stale bounds are still worth fixing for assistive tech (a menu reporting
itself at 18% of its size is wrong for TalkBack), but that is a shared-component
change affecting every pillar's FAB, tracked separately.


## Validate documentation

```bash
npm run check:docs
```

This checks that the required governance and source-of-truth documents exist,
the five-pillar contract is present, deleted/historical artifacts are not
referenced, local Markdown links resolve, and the documented schema version
matches `src/store/schema.js`. It supplements semantic documentation review;
passing the command does not prove that prose and implementation agree.

## Update the catalog

The bundled catalog data - cards, rules, FAQs, and the content-addressed `art-manifest.json` -
is regenerated from a drop folder by **one command**. Card **art itself is not bundled**: the
command converts each scan, publishes it to the CDN, and audits that the whole manifest is
published *before* it promotes the catalog. A routine content update needs no code edit.

```bash
npm run update:catalog              # fetch, build, validate, PUBLISH art to R2 + audit the whole manifest, then promote
npm run update:catalog -- --dry-run # build + validate + report; refreshes gitignored staging, writes nothing / uploads nothing
npm run update:catalog -- --recover # re-audit R2, then finish an interrupted promotion from staging
npm run update:catalog -- --repair-conflicts   # if a remote object conflicts: create repair keys, fold them back, re-audit, promote
```

> **Publish-before-promote (art-CDN Phase 5).** Because there is no bundled art fallback, the
> command promotes the catalog **only** once every object its manifest references is published on
> R2 and a whole-manifest audit is green (`scripts/catalog/promoteGate.mjs`, over the tested
> `runUpload` boundary). A conflicting remote object fails *before* promotion; `--recover`
> re-audits before finishing. It therefore needs the R2 credentials in `.env.r2` and internet.
> The command writes nothing under `public/`/`src/` and creates no promotion journal unless the
> audit is green. See `docs/proposals/art-cdn-migration.md`.

Drop the Curiosa exports into `CATALOG_DROP/` first: the high-res card PNGs, the Codex
rules CSV (header `title,content,subcodexes`), and the FAQ CSV (header
`card name,question,answer`). `CATALOG_DROP/README.md` is the non-engineer how-to, and
nothing in that folder is committed except the README. The command fetches card stats
from the Curiosa tRPC API and merges them, compiles the two CSVs, converts each
per-printing PNG to WebP with `sharp`, regenerates `link_graph.json` and the compiled
Codex documents, and - in steady state - promotes `public/catalog/*.json` (including the
content-addressed `art-manifest.json`) and the seed token `src/store/catalogVersion.json`.
Card art itself is uploaded to the CDN, not bundled (art-cdn Phase 5); there is no `public/cards/`.

**It is idempotent.** Every stage builds into a staging tree; nothing under `public/` or
`src/` is touched until the whole generation validates and a journaled promote runs. The
seed token carries a content hash, so a re-run with unchanged inputs writes nothing and
does not bump the version - only a real content change re-seeds installed devices. When it
prints **RESULT: OK**, review `git diff`, then bump the build and add a changelog entry as
you would for any install (see below).

> **A mid-promotion working tree must never be built or shipped.** If a promote is
> interrupted it leaves a journal at `.catalog-build/PROMOTE.json`, and every path to a
> shippable artifact fails closed until it is resolved: `prebuild`, `preandroid`,
> `precompile:codex`, and `precheck:docs` all run `scripts/assert-no-pending-catalog-promote.mjs`.
> Recover with one of: **A)** finish it - `npm run update:catalog -- --recover`; or **B)**
> restore the previous catalog AND clear the journal (both, or the build stays blocked) -
> `git checkout -- public/catalog src/store/catalogVersion.json src/store/setCatalog.json`
> then delete the `.catalog-build` directory (removes `PROMOTE.json` and the staging tree).

## Version and build number

`package.json` is the **single source** for both:

```json
{ "version": "1.0.1-alpha", "build": 15 }
```

Everything else reads it, so there is nothing to keep in sync:

| Consumer | Reads | Becomes |
|---|---|---|
| `vite.config.js` (`define`) | `version`, `build` | `__APP_VERSION__`, `__APP_BUILD__` → the Credits screen |
| `android/app/build.gradle` | `version`, `build` | `versionName`, `versionCode` |

**Bump `build` by 1 every time an APK is installed on a device.** `build` is the
Android `versionCode`, so it must be an integer and must never go backwards — a
lower `versionCode` refuses to install over a higher one. `version` moves only on
a real release. Credits prints both, and **build is the number to quote in a bug
report**: it identifies the exact APK, where the version alone cannot.

### Write the release note with the bump

Beside the `build` bump, add or update that build's entry in
[`src/content/changelog.js`](./src/content/changelog.js). On first launch of a
new build, testers are shown the notes for every build they skipped; the entry's
`build` field is what they are matched against, so an entry keyed to a build that
never ships is never seen.

> **This step fails quietly.** Bumping `build` with no matching entry is benign by
> design — nothing is shown, nothing is recorded, and the next release that *does*
> carry notes sweeps the skipped build up with it. So nothing breaks, no test goes
> red, and the only symptom is a release whose changes are never announced. The
> note is only written if you remember to write it.

Notes may be authored ahead of the bump: an entry whose `build` is above the
running one stays invisible until that build actually ships. `version` is display
only — several builds sharing one `version` is the normal case in alpha.

## Build the Android app

The native APK is built in **Android Studio** (needs JDK + Android SDK, same as
the sibling apps).

```bash
npm run android      # vite build + cap sync android  (copies the web build into android/)
npm run cap:open     # opens the project in Android Studio
```

Then in Android Studio: **Build → Build APK** (or Run on a device/emulator).

### Or from the command line

Needed whenever a change must be *observed* in the shipping runtime rather than a
browser (see the engine note above). Android Studio is not required:

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"   # the bundled JDK
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
npm run android                       # vite build + cap sync + strip wasm
cd android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

> **Build `assembleRelease`, not `assembleDebug`.** A debug APK is signed with the
> debug key, so it will not install over an existing release install
> (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) and the only way through is to uninstall —
> **which destroys that profile's on-device data**. The release config signs from
> `android/keystore.properties` (gitignored), so `install -r` matches signatures and
> preserves everything. Release is also the honest thing to verify: it is the config
> that ships, with `minifyEnabled`, `shrinkResources`, and ProGuard applied.

- App id: `com.sadkinglabs.compendium`
- Native plugins: SQLite, App (back button), Filesystem, Haptics, Preferences,
  Share, Status Bar.

After any web change, re-run `npm run android` to re-sync `dist/` into the native
project before rebuilding.

## Verify on a device

The dev server can be driven from a USB-connected phone without building an APK.
`adb reverse` points the phone's own `localhost` back at the host, so hot reload
works on real hardware:

```bash
adb reverse tcp:5000 tcp:5000
adb shell am start -a android.intent.action.VIEW -d "http://localhost:5000/"
adb exec-out screencap -p > shot.png     # from a POSIX shell, NOT PowerShell
```

> **PowerShell mangles binary redirection.** `> shot.png` writes UTF-16 and
> corrupts the PNG. Use `adb shell screencap -p /sdcard/s.png && adb pull …`
> instead, and set `MSYS_NO_PATHCONV=1` in Git Bash or it rewrites `/sdcard/…`
> into a Windows path.

**This is not native verification.** The phone's browser is whatever engine that
browser ships — Firefox is Gecko. The app ships inside the Capacitor **WebView**,
which is Chromium (`com.google.android.webview`). They disagree on exactly the
things worth verifying: vendor-prefixed CSS, mask compositing, plugin behaviour.
Anything engine-sensitive must be seen in the installed app, or at minimum in a
Chromium browser on the device; say which one was used when reporting it.

## Telemetry, and the manifest that actually ships

Compendium sends the developer crash reports and open-counts **only** after the user
answers the diagnostics disclosure. Until then Firebase starts but transmits nothing —
measured at **0 bytes over 3 minutes on a virgin install**, against **13,666** for
build 37, which collected without ever asking.

**Read the release artifact, never the source manifest.** `AndroidManifest.xml`
declares 3 permissions; the merged manifest declared **12** — including
`com.google.android.gms.permission.AD_ID`, a cross-app advertising identifier that
`firebase-analytics` adds silently. It shipped for 37 builds because the file everyone
read is not the file that ships.

```bash
# what the app ACTUALLY asks for
aapt2 dump badging android/app/build/outputs/apk/release/app-release.apk | grep uses-permission
# who added a given permission
grep -B1 AD_ID android/app/build/outputs/logs/manifest-merger-release-report.txt
```

`assembleRelease` **fails** if one of the six forbidden permissions returns -
`checkReleaseForbiddenPermissions` in `android/app/build.gradle` reads the merged
manifest via AGP's artifact API and fails closed on anything it cannot verify. It is
not a lint; you cannot ship past it. Prove it still bites by deleting a
`tools:node="remove"` line and running `assembleRelease`: it must go red.

**The collection flags are the initial default, not a floor.** Once
`setXCollectionEnabled` runs, that override persists and beats the manifest forever
after. Boot reconciliation (`src/store/telemetry.js` → `TelemetryPlugin.kt`) is what
keeps a denied user off, and it asserts on every launch rather than assuming.

**Consent semantics are not symmetric**, and the copy must not pretend otherwise:

| | Effect of turning it off |
|---|---|
| Analytics | persists; overrides the manifest |
| Crashlytics | **does not apply until the next run** |

Disabling stops *transmission*, not *capture* — Crashlytics still writes crashes to
disk. That is why granting deletes unsent reports **before** enabling, and why boot
deletes them on every `unset`/`denied` launch. Between them, a crash captured before
consent can never be submitted.

### The permission list, and why it needs a machine

The APK went from **12 declared permissions to 6**. Not one of the six removed was ever
in `AndroidManifest.xml` - every one arrived through manifest merging from a transitive
dependency, which is exactly why reading the source manifest tells you nothing:

| Removed | Came from | Why it goes |
|---|---|---|
| `AD_ID`, `ACCESS_ADSERVICES_AD_ID`, `ACCESS_ADSERVICES_ATTRIBUTION`, `BIND_GET_INSTALL_REFERRER_SERVICE` | `play-services-measurement*` (firebase-analytics) | Advertising and attribution. Compendium serves no ads and runs no campaigns. |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | `androidx.biometric`, via `@capacitor-community/sqlite` | Biometric unlock of an **encrypted** database. Compendium never encrypts, so the code cannot run. `USE_FINGERPRINT` is deprecated as well: API 28 superseded it with `USE_BIOMETRIC`. |

What remains is either declared by us or functionally required: `INTERNET`, `CAMERA`,
`VIBRATE`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, and the AndroidX dynamic-receiver
permission.

**Biometrics are unreachable, not merely unused.** `capacitor.config.json` sets
`"androidIsEncryption": false`, `db.js` opens every connection with `'no-encryption'`,
and in the plugin's `CapacitorSQLite` constructor the biometric branch is nested inside
`if (isEncryption)`. The permissions go but `androidx.biometric` stays: the plugin's own
Java imports `BiometricPrompt`, so excluding the library stops it compiling. Dead classes
are cheap; a sensitive permission on a store listing is not.

**If encryption is ever enabled, the two `tools:node="remove"` entries and the gate's
list must change in the same commit** - otherwise the feature fails at runtime with a
`SecurityException` while the source manifest still looks innocent.

### Verifying telemetry on a device

Web tests prove nothing here: node and the browser have no Firebase, so
`src/store/telemetry.js` no-ops in every automated gate. The real surface is native.

```bash
adb shell setprop log.tag.FA VERBOSE          # Analytics
adb logcat -d | grep -E "App measurement (collection )?(enabled|disabled)|FirebaseApp"
# bytes actually sent - re-resolve the uid, it CHANGES on uninstall/reinstall
adb shell pm list packages -U | grep sadkinglabs
adb shell dumpsys netstats detail | grep -A3 "uid=<uid>"
```

`App measurement disabled via the manifest` is the pre-consent state. A byte counter
that never moves is not proof of silence — Analytics batches uploads ~58 minutes out,
so a short window sees nothing either way. Establish a positive control first.
## Card-recogniser assets (required to build)

The recogniser's model and prototype index are **generated artifacts** (~27 MB), too large to track
in git, so `android/app/src/main/assets/recog/` is gitignored. A build without them would succeed and
then fail every scan with "Visual match unavailable", so `:app:checkRecogAssets` **fails the build**
when they are missing. Regenerate them with the pinned Python toolchain (`scripts/recog/train/`):

```bash
cd scripts/recog/train
./.venv/Scripts/python build_artifact.py     # dinov2_s448_int8.onnx (+ _out/artifact.json provenance)
./.venv/Scripts/python build_index.py        # index.f16 + index.json (card ids, dim, count, sha256)
cp _out/dinov2_s448_int8.onnx _out/index.f16 _out/index.json ../../../android/app/src/main/assets/recog/
```

`index.json` records the index `sha256`, `dim` and `count`; the loader refuses to start on a
mismatch, so a model and index from different builds can never be paired silently.

## APK size and ABIs

Release builds ship **arm64-v8a only**, and `minSdkVersion` is **29** (Android 10). Those two
move together: the ABI filter is what excludes 32-bit-only devices, and the minSdk floor is what
makes that acceptable, since a 32-bit-only phone new enough for Android 10 is vanishingly rare.
Dropping `x86`/`x86_64` came first (emulator architectures no phone can execute); dropping
`armeabi-v7a` followed with the minSdk raise. The assembled arm64 release APK measures
**72.3 MiB**, which includes the ~27 MB card-recogniser model and prototype index.

minSdk 29 is also a **16 KB page-size** requirement, not only a size decision: below API 23 the
Android Gradle Plugin packages native libraries compressed, and compressed libraries cannot be
mapped directly from the APK, which fails Android's 16 KB check. See the recognition asset and
alignment notes below.

The scanner is what makes ABIs expensive - ML Kit's OCR and barcode `.so` files, SQLCipher and
ONNX Runtime are per-architecture, so each extra ABI is a full duplicate set.

**Debug keeps all four**, so the emulator still works on an x86_64 host. The filter is
scoped to `buildTypes.release` in `android/app/build.gradle`; moving it to
`defaultConfig` would strip them everywhere and quietly break emulator testing.

**`armeabi-v7a` and `minSdkVersion` move together as a product baseline, not a technical
dependency.** `minSdkVersion` and release ABIs are independent technical filters, but they move
together in the approved product baseline: API 29 excludes older Android releases, and arm64-only
excludes 32-bit devices. They are coupled by the owner's support decision, not because minSdk
controls CPU architecture. An install with no compatible ABI (or below the minSdk) must fail
cleanly - excluded, not install-then-crash - and that is verified when the baseline is implemented
(checklist below). The owner has approved making both moves together as the **approved next
baseline** below.

```bash
# what the APK actually ships
aapt2 dump badging <apk> | grep native-code
```

### Android platform baseline (minSdk 29, arm64-only) - IMPLEMENTED

**Owner architecture decision of 2026-08-03, implemented 2026-08-08** on the card-recogniser branch.
`variables.gradle` sets **minSdk 29 (Android 10)** and the release build filters to **arm64-v8a only**;
debug still carries all four ABIs so the x86_64 emulator keeps working. compileSdk / targetSdk are
**36 (Android 16)** as of the Capacitor 8 upgrade - see the toolchain table below.

The two levers do different jobs and the distinction matters: **the ABI filter is what excludes
32-bit-only devices** (a build without their ABI is not offered to them), while **minSdk 29 is what makes
that loss acceptable** - a 32-bit-only phone new enough for Android 10 is vanishingly rare. minSdk 29 is
additionally a **16 KB page-size requirement**: below API 23 the Android Gradle Plugin packages native
libraries compressed, and compressed libraries cannot be mapped directly from the APK.

### Build toolchain (Capacitor 8 / Android 16) - IMPLEMENTED 2026-08-10

| | Version | Note |
|---|---|---|
| Capacitor | **8.5.0** | core / android / cli, plus all nine plugins |
| Android Gradle Plugin | **8.13.0** | AGP 9 deferred, see the dependency audit |
| Gradle wrapper | **8.14.4** | not 8.14.3: KGP 2.4.10 deprecates it, and Kotlin 2.5.0 sets its floor at 8.14.4 |
| Java / Kotlin JVM target | **21** | both, or the build fails "Inconsistent JVM-target compatibility" |
| Kotlin | **2.4.10** | KGP's matrix caps 2.2.20 at AGP 8.11.1, below the 8.13.0 Capacitor ships |
| compileSdk / targetSdk | **36 / 36** | Android 16 |
| minSdk | **29** | unchanged |
| cordova-android | **15.1.0** | not the template's 14.0.1, which supports API <= 35 |

**You need JDK 21.** Android Studio's bundled JBR is 21; if `./gradlew` picks a different JDK, set
`JAVA_HOME` to it.

Versions here were chosen from each artifact's **own** published `minCompileSdk` /
`minAndroidGradlePluginVersion` (its AAR metadata), not from the Capacitor template and not from
release dates. That method rejected three answers the template would have given: Kotlin 2.2.20,
Lifecycle 2.11.0 (needs sdk37 / AGP 9.1.0) and cordova-android 14.0.1.

**Portrait on phones, free rotation on tablets.** Both activities declare
`android:screenOrientation="portrait"`. From Android 16, displays with smallest width **>= 600dp**
ignore that attribute, and phones (< 600dp) are exempt from the override - so the platform default
already splits where we want it, and **no manifest property is needed to get it**.

`PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` would force portrait on large screens too. It was
declared briefly and **removed on owner decision (2026-08-12)** after seeing the result on hardware: a
letterboxed phone-shaped app on a 12-inch tablet. Measured on a Lenovo TB321FU (Android 16, 640dp),
device forced landscape - **with** the property `ROTATION_0` and 1600x2560; **without** it
`ROTATION_90` and 2560x1600 full screen. Do not re-add it to "fix" tablet rotation; rotation there is
the intent.

Consequence worth knowing: the opt-out is application-level, so the scanner cannot be pinned to
portrait while the rest of the app rotates. On a tablet `ScannerActivity` rotates too. It works, but
its sheets are portrait-designed - landscape layout is a known follow-up, not a supported design.

### Verifying 16 KB page alignment

Both shipping artifacts must be checked; proving only the sideload APK proves the wrong one.

```bash
# APK: every lib/arm64-v8a/*.so must be STORED and 16 KB aligned
zipalign -c -P 16 -v 4 app-release.apk        # expect "Verification successful", zero BAD

# AAB: the bundle-level request that makes Play's generated APKs align
bundletool dump config --bundle=app-release.aab   # expect "alignment": "PAGE_ALIGNMENT_16K"

# AAB: then check the APKs Play would actually deliver, every arm64 split, not one sample
bundletool build-apks --bundle=app-release.aab --output=out.apks --mode=default
```

## Notes

- **Curiosa import** uses CapacitorHttp on device; in the browser it routes
  through a dev proxy (`/curiosa` in `vite.config.js`), so it works in `npm run dev`
  but a plain *web* production host would need its own proxy.
- **Graceful images**: set `localStorage['cx-no-images'] = '1'` to verify the app
  renders fully from data + fallbacks with zero card art (§5 release gate).
- Source-of-truth design/feature docs: `COMPENDIUM_ARCHITECTURE.md`,
  `COMPENDIUM_FEATURE_MATRIX.md`, `COMPENDIUM_DATA_MODEL.md`.
