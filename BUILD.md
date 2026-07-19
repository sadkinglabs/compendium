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
```

The four `test:*` scripts are `node --test` over co-located `*.test.mjs` files; `check:types` runs its own wrapper tests then the compiler check (fail-closed, gates only on the owned files). There is no browser
test runner. Logic that carries a real invariant belongs in a plain module with
fixtures beside it rather than inside a component, so it can be tested without a
DOM — `src/pillars/avatarPickerState.js` is the pattern.

Run the suites whose surface a change touches, plus `npm run build`. Interactive
behaviour still needs to be exercised by hand; see **Verify on a device** below.

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

The bundled catalog - cards, rules, FAQs, and card art - is regenerated from a drop
folder by **one command**. A routine content update needs no code edit.

```bash
npm run update:catalog              # fetch, build, validate, promote from CATALOG_DROP/
npm run update:catalog -- --dry-run # build + validate + report, write NOTHING
npm run update:catalog -- --recover # finish an interrupted promotion from staging
```

Drop the Curiosa exports into `CATALOG_DROP/` first: the high-res card PNGs, the Codex
rules CSV (header `title,content,subcodexes`), and the FAQ CSV (header
`card name,question,answer`). `CATALOG_DROP/README.md` is the non-engineer how-to, and
nothing in that folder is committed except the README. The command fetches card stats
from the Curiosa tRPC API and merges them, compiles the two CSVs, converts each
per-printing PNG to WebP with `sharp`, regenerates `link_graph.json` and the compiled
Codex documents, and writes `public/catalog/*.json`, the art in `public/cards/`, and the
seed token `src/store/catalogVersion.json`.

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
> `git checkout -- public/catalog public/cards src/store/catalogVersion.json src/store/setCatalog.json`
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
## APK size and ABIs

Release builds ship **arm64-v8a + armeabi-v7a only**. That took the APK from **82.7 MB
to 66.2 MB** (-20%): `x86`/`x86_64` are emulator architectures and no phone that can
install this APK can execute them, so they were pure carry.

The scanner is what makes ABIs expensive � ML Kit's OCR and barcode `.so` files plus
SQLCipher are per-architecture, so each extra ABI is a full duplicate set.

**Debug keeps all four**, so the emulator still works on an x86_64 host. The filter is
scoped to `buildTypes.release` in `android/app/build.gradle`; moving it to
`defaultConfig` would strip them everywhere and quietly break emulator testing.

**`armeabi-v7a` and `minSdkVersion` move together.** minSdk 22 admits 32-bit devices, so
dropping that ABI without raising minSdk would let such a phone install the app and then
crash in the scanner, rather than being cleanly excluded from the store listing. Do not
drop one without the other.

```bash
# what the APK actually ships
aapt2 dump badging <apk> | grep native-code
```

**Size is dominated by card art, not code.** `assets/public/cards` is ~72 MB of the ~90 MB
release APK: ~1,600 WebP files (one per printing) averaging ~46 KB, already compressed,
bundled deliberately for the
offline-first constraint. Native libs are ~14 MB. Anyone chasing further size reduction
should start there and treat it as a product decision (resolution or coverage), not a
build fix.

## Notes

- **Curiosa import** uses CapacitorHttp on device; in the browser it routes
  through a dev proxy (`/curiosa` in `vite.config.js`), so it works in `npm run dev`
  but a plain *web* production host would need its own proxy.
- **Graceful images**: set `localStorage['cx-no-images'] = '1'` to verify the app
  renders fully from data + fallbacks with zero card art (§5 release gate).
- Source-of-truth design/feature docs: `COMPENDIUM_ARCHITECTURE.md`,
  `COMPENDIUM_FEATURE_MATRIX.md`, `COMPENDIUM_DATA_MODEL.md`.
