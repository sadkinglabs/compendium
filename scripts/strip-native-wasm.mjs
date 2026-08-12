// Post-`cap sync` step for the Android build. sql.js (the WEB SQLite backend) needs sql-wasm.wasm,
// so vite emits it into dist/ and cap sync then packages it into the APK assets - but on Android the
// native @capacitor-community/sqlite backend is used and sql.js is NEVER imported or fetched (see
// store/db.js: webBackend is dynamic-imported only when isWeb). So the ~640 kB wasm is dead weight in
// the APK. Delete it from the synced native assets (NOT from dist, so the web build keeps working).
//
// THREE DEFECTS THIS SCRIPT HAS SHIPPED OR ALMOST SHIPPED. Each fix created the next hole:
//
// 1. FIXED NAME. It matched a hardcoded `assets/sql-wasm.wasm`. vite-plugin-static-copy v4 changed
//    its path semantics, the name stopped matching, and 640 kB shipped while the log said "nothing to
//    remove" - success-shaped output for a silent failure.
// 2. ANY .wasm, ONE DIRECTORY. The fix over-corrected to "any top-level .wasm", which would delete a
//    future native-REQUIRED wasm for merely sharing an extension, and still read a single directory,
//    so a MOVED asset was indistinguishable from a deleted one.
// 3. NAME-PATTERN SEARCH ONLY. Searching recursively but only for the expected basename means a
//    RENAME (Vite emitting `sqljs-<hash>.wasm`, say) matches nothing - and the "is it still emitted?"
//    cross-check used the same pattern, so both would report zero while the renamed file shipped.
//    That is defect 1 again, wearing a different hat.
//
// So the script no longer searches for what it expects. It ENUMERATES EVERY .wasm in the synced tree
// and classifies each one:
//   - matches STRIP  -> delete it (dead web-only weight)
//   - matches KEEP   -> leave it (a wasm the native app genuinely needs)
//   - matches NEITHER-> HARD ERROR, naming the file
// An unclassified wasm is the signal that something was renamed or newly added, and it stops the
// build instead of being silently packaged or silently deleted. Adding a native wasm on purpose means
// adding it to KEEP - one line, and a deliberate decision rather than an accident.
//
// Zero wasm anywhere is SUCCESS, not failure: the tree was enumerated in full, so absent means
// absent, and after a successful strip the file is legitimately gone. Failing there would break
// idempotent re-runs while proving nothing.
import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

const NATIVE_ROOT = 'android/app/src/main/assets/public';
const DIST_ROOT = 'dist';

// Web-only, safe to delete: sql-wasm.wasm or Vite's content-hashed sql-wasm-<hash>.wasm.
const STRIP = [/^sql-wasm(-[A-Za-z0-9_-]+)?\.wasm$/];
// Wasm the NATIVE app requires. Empty today. Add here (with a reason) rather than loosening STRIP.
const KEEP = [];

const isStrip = (n) => STRIP.some((re) => re.test(n));
const isKeep = (n) => KEEP.some((re) => re.test(n));

/** Every .wasm under `dir`, at any depth. */
function findWasm(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findWasm(full, out);
    else if (entry.name.toLowerCase().endsWith('.wasm')) out.push(full);
  }
  return out;
}

const base = (p) => p.split(/[\\/]/).pop();
const all = findWasm(NATIVE_ROOT);
const unknown = all.filter((p) => !isStrip(base(p)) && !isKeep(base(p)));
const strip = all.filter((p) => isStrip(base(p)));
const keep = all.filter((p) => isKeep(base(p)));

if (unknown.length) {
  console.error(`strip-native-wasm: FAILED - ${unknown.length} unrecognised .wasm in ${NATIVE_ROOT}:`);
  for (const f of unknown) console.error(`  - ${f}`);
  console.error('');
  console.error('Every .wasm must be classified, because an unrecognised one is how this went wrong');
  console.error('before: a renamed sql.js wasm matches no expected name and ships silently.');
  console.error('  - if it is the web-only sql.js wasm under a new name, widen STRIP');
  console.error('  - if the native app genuinely needs it, add it to KEEP');
  process.exit(1);
}

if (strip.length > 1) {
  console.error(`strip-native-wasm: FAILED - expected at most ONE sql.js wasm, found ${strip.length}:`);
  for (const f of strip) console.error(`  - ${f}`);
  console.error('The build now emits more than one. Refusing to guess which is dead weight.');
  process.exit(1);
}

for (const f of keep) console.log(`strip-native-wasm: keeping ${f} (native-required, allowlisted)`);

if (strip.length === 0) {
  // Enumerated the whole tree, so absent is absent. Distinguish the two benign reasons, and use a
  // RECURSIVE ANY-WASM scan of dist/ - not the STRIP pattern - so a rename in dist is still visible.
  const distWasm = findWasm(DIST_ROOT);
  const why = distWasm.length
    ? `already stripped this sync (the web build emits ${distWasm.length}: ${distWasm.map(base).join(', ')})`
    : 'the web build emits no wasm at all';
  console.log(`strip-native-wasm: nothing to remove - ${why}. Enumerated every .wasm under ${NATIVE_ROOT}.`);
} else {
  const target = strip[0];
  const kb = Math.round(statSync(target).size / 1024);
  rmSync(target, { force: true });
  console.log(`strip-native-wasm: removed ${target} (${kb} kB) - web-only, unused on native`);
}
