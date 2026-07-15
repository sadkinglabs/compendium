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

- App id: `com.sadkinglabs.compendium`
- Native plugins: SQLite, App (back button), Filesystem, Haptics, Preferences,
  Share, Status Bar.

After any web change, re-run `npm run android` to re-sync `dist/` into the native
project before rebuilding.

## Notes

- **Curiosa import** uses CapacitorHttp on device; in the browser it routes
  through a dev proxy (`/curiosa` in `vite.config.js`), so it works in `npm run dev`
  but a plain *web* production host would need its own proxy.
- **Graceful images**: set `localStorage['cx-no-images'] = '1'` to verify the app
  renders fully from data + fallbacks with zero card art (§5 release gate).
- Source-of-truth design/feature docs: `COMPENDIUM_ARCHITECTURE.md`,
  `COMPENDIUM_FEATURE_MATRIX.md`, `COMPENDIUM_DATA_MODEL.md`.
