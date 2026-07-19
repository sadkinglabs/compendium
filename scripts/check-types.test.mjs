// Proof that the check:types wrapper is FAIL-CLOSED (scripts/check-types.mjs).
// Run: node --test scripts/check-types.test.mjs   (also runs first inside `npm run check:types`)
//
// Two seams are tested: the pure `classify` (which bucket each diagnostic lands in) and the
// `run` orchestration with an INJECTED loadProgram (so the compiler-throw, no-array, and
// config-failure branches are exercised for real, not merely simulated as classification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, run, OWNED, TRANSITIVE } from './check-types.mjs';

const ROOT = '/repo';
const opts = { owned: OWNED, transitive: TRANSITIVE, root: ROOT };
const silent = () => {};
// A diagnostic-shaped object; fileName=null models a global/config diagnostic (no source file).
const diag = (fileName, code = 2345) => ({
  file: fileName ? { fileName: `/repo/${fileName}` } : undefined,
  start: fileName ? 0 : undefined, code, messageText: 'x',
});

// --- classify (pure) -------------------------------------------------------------

test('classify: an owned-file diagnostic is gated', () => {
  const r = classify([diag('src/pillars/LifeCounter.jsx')], opts);
  assert.equal(r.gated.length, 1);
  assert.equal(r.discarded.length + r.unclassified.length, 0);
});

test('classify: a known-transitive diagnostic is discarded', () => {
  const r = classify([diag('src/store/deckRepository.js')], opts);
  assert.equal(r.discarded.length, 1);
  assert.equal(r.gated.length + r.unclassified.length, 0);
});

test('classify: a diagnostic with no source file is unclassified (fail-closed)', () => {
  const r = classify([diag(null)], opts);
  assert.equal(r.unclassified.length, 1);
});

test('classify: an unknown/new closure member is unclassified (drift -> fail-closed)', () => {
  const r = classify([diag('src/store/brandNewModule.js')], opts);
  assert.equal(r.unclassified.length, 1);
  assert.equal(r.discarded.length, 0);
});

// --- run (orchestration, injected loadProgram) -----------------------------------

test('run: a compiler crash (loadProgram throws) fails closed', () => {
  assert.equal(run({ loadProgram: () => { throw new Error('boom'); }, root: ROOT, log: silent }), 2);
});

test('run: no diagnostics array (compiler did not run) fails closed', () => {
  assert.equal(run({ loadProgram: () => ({}), root: ROOT, log: silent }), 2);
});

test('run: a config/global diagnostic (no file) fails', () => {
  assert.equal(run({ loadProgram: () => ({ diagnostics: [diag(null)] }), root: ROOT, log: silent }), 1);
});

test('run: an owned-file diagnostic fails', () => {
  assert.equal(run({ loadProgram: () => ({ diagnostics: [diag('src/navBack.js')] }), root: ROOT, log: silent }), 1);
});

test('run: an unknown-file diagnostic fails closed', () => {
  assert.equal(run({ loadProgram: () => ({ diagnostics: [diag('src/mystery.js')] }), root: ROOT, log: silent }), 1);
});

test('run: only known-transitive diagnostics pass (discarded)', () => {
  assert.equal(run({ loadProgram: () => ({ diagnostics: [diag('src/store/db.js'), diag('src/native.js')] }), root: ROOT, log: silent }), 0);
});

test('run: a clean program passes', () => {
  assert.equal(run({ loadProgram: () => ({ diagnostics: [] }), root: ROOT, log: silent }), 0);
});
