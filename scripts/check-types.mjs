// Fail-closed type gate for the match-view typed boundaries. Runs the TypeScript compiler API
// over the tsconfig closure, then GATES only on diagnostics in the seven OWNED files. A
// known-transitive file's own diagnostics are discarded; a global/config diagnostic (no source
// file), an unknown/new closure member, a missing diagnostics array, or a compiler crash all
// FAIL CLOSED - the gate can never report green when the compiler did not actually run.
// See docs/proposals/check-types-gate.md. Run: npm run check:types
import ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The gate's OWNERSHIP. Adding to OWNED is a deliberate edit. TRANSITIVE is the measured
// 28-file closure minus the owned seven (tsc --listFiles). A file in NEITHER set -> fail closed
// (closure drift: a human must classify it, not have it silently absorbed). The five art-boundary
// files entered the closure via LifeCounter's useArtSource (Phase 2); they are store-layer infra like
// cardArt/db/native and use the same import.meta.env / window.Capacitor patterns, so TRANSITIVE.
export const OWNED = [
  'src/pillars/LifeCounter.jsx',
  'src/pillars/matchLife.js', 'src/pillars/matchRoll.js', 'src/navBack.js',
  'src/store/matchSnapshot.js', 'src/store/importPlan.js', 'src/store/listGoalModel.js',
  // Counter Band (2026-08-15): pure band rules + the band component are match-view
  // typed boundaries, same standing as matchLife/matchRoll.
  'src/pillars/bandState.js', 'src/pillars/CounterBand.jsx',
  'src/types/ambient.d.ts',
];
export const TRANSITIVE = [
  'src/back.js', 'src/native.js', 'src/components/QRCode.jsx', 'src/pillars/ddArming.js',
  'src/store/cardArt.js', 'src/store/cardQuery.js', 'src/store/catalogCache.js',
  'src/store/collectionWrites.js', 'src/store/db.js', 'src/store/deckRepository.js',
  'src/store/ids.js', 'src/store/matchShare.js', 'src/store/matchStats.js',
  'src/store/playRepository.js', 'src/store/profileRepository.js', 'src/store/schema.js',
  'src/store/artSource.js', 'src/store/artCache.js', 'src/store/artCacheInstance.js',
  'src/store/artCacheAdapter.js', 'src/components/ArtImage.jsx',
  // Entered via CounterBand (2026-08-15): the element-pip leaf (kept a LEAF precisely
  // so the closure did not swallow ui.jsx; presentation shim over cardArt, so TRANSITIVE).
  'src/components/ElementPip.jsx',
];

const norm = (root, p) => path.relative(root, p).split(path.sep).join('/');

/**
 * Classify diagnostics by their source file. Pure.
 *   - owned file            -> gated       (fails the gate)
 *   - known-transitive file -> discarded   (the intended filter)
 *   - no file OR unknown    -> unclassified (fails the gate, fail-closed)
 * @returns {{ gated: {rel:string|null,d:any}[], discarded: any[], unclassified: any[] }}
 */
export function classify(diagnostics, { owned, transitive, root }) {
  const ownedSet = new Set(owned), transSet = new Set(transitive);
  const gated = [], discarded = [], unclassified = [];
  for (const d of diagnostics) {
    const rel = d && d.file && d.file.fileName ? norm(root, d.file.fileName) : null;
    const item = { rel, d };
    if (rel && ownedSet.has(rel)) gated.push(item);
    else if (rel && transSet.has(rel)) discarded.push(item);
    else unclassified.push(item);   // no file (global/config) OR an unknown closure member
  }
  return { gated, discarded, unclassified };
}

const fmt = ({ rel, d }) => {
  let where = rel || '<global>';
  if (rel && d.file && typeof d.file.getLineAndCharacterOfPosition === 'function' && typeof d.start === 'number') {
    where = `${rel}(${d.file.getLineAndCharacterOfPosition(d.start).line + 1})`;
  }
  const msg = ts.flattenDiagnosticMessageText ? ts.flattenDiagnosticMessageText(d.messageText, '\n') : String(d.messageText);
  return `  ${where}: TS${d.code} ${msg}`;
};

/**
 * Orchestrate the gate. `loadProgram` is injected so the throw / no-array / config-failure
 * branches are exercised by real tests, not simulated. Returns an exit code:
 *   2 = compiler did not run (threw, or produced no diagnostics array) - fail closed
 *   1 = owned or unclassified diagnostics present
 *   0 = compiled cleanly with only known-transitive diagnostics (if any)
 */
export function run({ loadProgram, root = ROOT, owned = OWNED, transitive = TRANSITIVE, log = console.error }) {
  let diagnostics;
  try {
    const res = loadProgram();
    diagnostics = res && res.diagnostics;
  } catch (e) {
    log(`check:types FAILED (fail-closed): compiler crashed - ${(e && e.message) || e}`);
    return 2;
  }
  if (!Array.isArray(diagnostics)) {
    log('check:types FAILED (fail-closed): compiler produced no diagnostics array (it did not run)');
    return 2;
  }
  const { gated, unclassified } = classify(diagnostics, { owned, transitive, root });
  if (unclassified.length) {
    log(`check:types FAILED (fail-closed): ${unclassified.length} unattributable / global / unknown-file diagnostic(s):`);
    unclassified.forEach((u) => log(fmt(u)));
  }
  if (gated.length) {
    log(`check:types FAILED: ${gated.length} diagnostic(s) in owned files:`);
    gated.forEach((g) => log(fmt(g)));
  }
  const ok = gated.length === 0 && unclassified.length === 0;
  if (ok) log('check:types OK - owned diagnostic surface is clean.');
  return ok ? 0 : 1;
}

// Production loader: the real compiler. Config read/parse errors come back AS diagnostics
// (no source file -> unclassified -> fail closed); a compiler exception propagates to run's catch.
function loadProgramFromTsconfig(root) {
  const configPath = path.join(root, 'tsconfig.json');
  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error) return { diagnostics: [readResult.error] };
  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, root);
  if (parsed.errors && parsed.errors.length) return { diagnostics: parsed.errors };
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return { diagnostics: ts.getPreEmitDiagnostics(program) };
}

// Entry point only when executed directly (not when imported by the test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run({ loadProgram: () => loadProgramFromTsconfig(ROOT) }));
}
