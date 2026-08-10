// Post-`cap sync` step for the Android build. sql.js (the WEB SQLite backend) needs sql-wasm.wasm,
// so vite emits it into dist/ and cap sync then packages it into the APK assets - but on Android the
// native @capacitor-community/sqlite backend is used and sql.js is NEVER imported or fetched (see
// store/db.js: webBackend is dynamic-imported only when isWeb). So the ~640 kB wasm is dead weight in
// the APK. Delete it from the synced native assets (NOT from dist, so the web build keeps working).
//
// TWO DEFECTS THIS SCRIPT HAS ALREADY SHIPPED, and how each is now prevented:
//
// 1. TOO NARROW, then TOO BROAD. It first matched a hardcoded `assets/sql-wasm.wasm`.
//    vite-plugin-static-copy v4 changed its path semantics, the fixed name stopped matching, and
//    640 kB shipped in the APK while the log read "nothing to remove" - success-shaped output for a
//    silent failure. The fix over-corrected to "any top-level .wasm", which would delete a future
//    native-REQUIRED wasm merely for sharing an extension.
//    Now: matched by SPECIFIC NAME (sql-wasm.wasm or Vite's hashed sql-wasm-<hash>.wasm), anchored
//    at both ends, so nothing else is ever swept up.
//
// 2. LOOKING IN ONE PLACE. Both earlier versions read a single directory, so an asset that MOVED was
//    indistinguishable from an asset that was GONE - which is exactly how defect 1 hid.
//    Now: the whole synced asset tree is walked recursively. A relocation cannot hide, because there
//    is nowhere in the bundle left to hide in.
//
// That recursion is what makes "found nothing" trustworthy, and therefore safe to report rather than
// fail on. A hard error on zero matches would also break idempotency: after a successful strip, the
// file is legitimately absent, and re-running must not invent a failure. Genuine ambiguity - more
// than one match, meaning the naming assumption changed - IS a hard error, because there a human
// should decide rather than a script guess.
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

const NATIVE_ROOT = 'android/app/src/main/assets/public';
const DIST_ROOT = 'dist';
const SQL_WASM = /^sql-wasm(-[A-Za-z0-9_-]+)?\.wasm$/;

/** Every path under `dir` whose basename matches `re`, at any depth. */
function findDeep(dir, re, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findDeep(full, re, out);
    else if (re.test(entry.name)) out.push(full);
  }
  return out;
}

const found = findDeep(NATIVE_ROOT, SQL_WASM);

if (found.length > 1) {
  console.error(`strip-native-wasm: FAILED - expected at most ONE sql.js wasm under ${NATIVE_ROOT}, found ${found.length}:`);
  for (const f of found) console.error(`  - ${f}`);
  console.error('The build now emits more than one, so the naming assumption has changed.');
  console.error('Refusing to guess which is dead weight - inspect the build output.');
  process.exit(1);
}

if (found.length === 0) {
  // Not a failure: the tree was searched in full, so absent means absent. Say WHY it is absent, since
  // "no longer emitted" and "already stripped" are both fine but only one of them is expected.
  const inDist = findDeep(DIST_ROOT, SQL_WASM);
  const why = inDist.length
    ? `already stripped this sync (the web build still emits ${inDist.length}: ${inDist.join(', ')})`
    : 'the web build no longer emits one';
  console.log(`strip-native-wasm: nothing to remove - ${why}. Searched all of ${NATIVE_ROOT}.`);
} else {
  const target = found[0];
  const kb = Math.round(statSync(target).size / 1024);
  rmSync(target, { force: true });
  console.log(`strip-native-wasm: removed ${target} (${kb} kB) - web-only, unused on native`);
}
