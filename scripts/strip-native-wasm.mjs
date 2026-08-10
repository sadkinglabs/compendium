// Post-`cap sync` step for the Android build. sql.js (the WEB SQLite backend)
// needs sql-wasm.wasm, so vite copies it into dist/ and cap sync then packages
// it into the APK assets - but on Android the native @capacitor-community/sqlite
// backend is used and sql.js is NEVER imported or fetched (see store/db.js:
// webBackend is dynamic-imported only when isWeb). So the ~640 kB wasm is dead
// weight in the APK. Delete it from the synced native assets (NOT from dist, so
// the web build/preview keep working).
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

// Matched by EXTENSION, not by a fixed name. The file used to be copied to a hardcoded
// assets/sql-wasm.wasm; it now goes through Vite's asset pipeline and arrives hashed
// (sql-wasm-UFUCzYNW.wasm). A fixed name silently stopped matching when that changed, and the script
// reported "nothing to remove" while 640 kB of dead weight shipped in the APK - a strip step that
// quietly strips nothing is worse than no strip step, because the log line reads like success.
const dir = 'android/app/src/main/assets/public/assets';
const found = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.wasm')) : [];
if (found.length === 0) {
  console.log('strip-native-wasm: nothing to remove (no .wasm in the synced assets)');
} else {
  for (const f of found) {
    const target = join(dir, f);
    const kb = Math.round(statSync(target).size / 1024);
    rmSync(target, { force: true });
    console.log(`strip-native-wasm: removed ${target} (${kb} kB) - web-only, unused on native`);
  }
}
