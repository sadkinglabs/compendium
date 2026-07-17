// Build-wide guard: refuse to package anything while a catalog promotion is mid-flight.
//
// `npm run update:catalog` promotes its output (JSON + ~1,600 images + the version
// token) under a journal at .catalog-build/PROMOTE.json marked "in-progress". If the
// process is interrupted between deleting the old generation and installing the new,
// the working tree is a MIXED catalog - JSON that references missing art, or compiled
// documents from another input generation - which must never be built or shipped.
//
// This assertion is wired into `prebuild`, `preandroid`, `precompile:codex`, and
// `precheck:docs`, so every path to a shippable artifact crosses it. `update:catalog`
// calls its own recovery logic instead of this guard, because recovery must be able to
// finish the promotion rather than be blocked by it.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const JOURNAL = fileURLToPath(new URL('../.catalog-build/PROMOTE.json', import.meta.url));

if (existsSync(JOURNAL)) {
  let status = 'unreadable';
  try { status = JSON.parse(readFileSync(JOURNAL, 'utf8')).status ?? 'unknown'; } catch { /* stale/unreadable */ }
  if (status !== 'complete') {
    console.error(
      `\n✗ Catalog promotion incomplete (.catalog-build/PROMOTE.json: ${status}).\n` +
      `  The working tree may be a MIXED catalog and must not be built or shipped.\n\n` +
      `  Recover with one of:\n` +
      `    A) finish it:     npm run update:catalog -- --recover\n` +
      `    B) restore + clear the journal (both, or the build stays blocked):\n` +
      `         git checkout -- public/catalog public/cards src/store/catalogVersion.json src/store/setCatalog.json\n` +
      `         then delete the .catalog-build directory (PROMOTE.json + staging)\n`,
    );
    process.exit(1);
  }
}
