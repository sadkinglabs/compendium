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
```

All three are `node --test` over co-located `*.test.mjs` files; there is no browser
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

## Notes

- **Curiosa import** uses CapacitorHttp on device; in the browser it routes
  through a dev proxy (`/curiosa` in `vite.config.js`), so it works in `npm run dev`
  but a plain *web* production host would need its own proxy.
- **Graceful images**: set `localStorage['cx-no-images'] = '1'` to verify the app
  renders fully from data + fallbacks with zero card art (§5 release gate).
- Source-of-truth design/feature docs: `COMPENDIUM_ARCHITECTURE.md`,
  `COMPENDIUM_FEATURE_MATRIX.md`, `COMPENDIUM_DATA_MODEL.md`.
