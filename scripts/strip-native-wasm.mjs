// Post-`cap sync` step for the Android build. sql.js (the WEB SQLite backend)
// needs sql-wasm.wasm, so vite copies it into dist/ and cap sync then packages
// it into the APK assets - but on Android the native @capacitor-community/sqlite
// backend is used and sql.js is NEVER imported or fetched (see store/db.js:
// webBackend is dynamic-imported only when isWeb). So the ~640 kB wasm is dead
// weight in the APK. Delete it from the synced native assets (NOT from dist, so
// the web build/preview keep working).
import { existsSync, rmSync, statSync } from 'fs';

const target = 'android/app/src/main/assets/public/assets/sql-wasm.wasm';
if (existsSync(target)) {
  const kb = Math.round(statSync(target).size / 1024);
  rmSync(target, { force: true });
  console.log(`strip-native-wasm: removed ${target} (${kb} kB) - web-only, unused on native`);
} else {
  console.log('strip-native-wasm: nothing to remove (no synced wasm found)');
}
