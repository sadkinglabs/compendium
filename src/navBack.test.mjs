// Fixtures for the hardware-back fallback precedence (src/navBack.js).
// Run: npm run test:app   (node --test)
//
// Table-driven proof of the back-precedence CONTRACT (the App/counter fallback half; the
// consumer-first LIFO half is proven in back.test.mjs):
//   (b) the `match` fallback outranks ordinary app navigation;
//   (c) BACK in a live match peels confirm -> end -> sheet -> fab, then minimizes;
//   (d) when no fallback row matches, resolveAppBackFallback returns null (App -> home/exit tail).
// Plus: every shadowed row still resolves in declared order, so the kept fallback can't drift.
//
// NOTE (honest): these tests assert the module's ABSTRACT keys. They do NOT prove App's real
// predicate/action wiring - that is guaranteed by the proposal's equivalence table reviewed
// against the diff, and by the device smoke. See docs/proposals/nav-back-fallback.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_BACK_ORDER, resolveAppBackFallback, COUNTER_BACK_ORDER, resolveCounterBackFallback } from './navBack.js';

const none = () => Object.fromEntries(APP_BACK_ORDER.map((k) => [k, false]));

// --- resolveAppBackFallback: precedence -----------------------------------------

test('(b) match outranks every lower row', () => {
  for (const lower of APP_BACK_ORDER.slice(1)) {
    const s = none(); s.match = true; s[lower] = true;
    assert.equal(resolveAppBackFallback(s), 'match', `match should beat ${lower}`);
  }
});

test('each row wins over all rows below it', () => {
  for (let i = 0; i < APP_BACK_ORDER.length; i++) {
    const s = none();
    for (let j = i; j < APP_BACK_ORDER.length; j++) s[APP_BACK_ORDER[j]] = true;   // this row + everything below
    assert.equal(resolveAppBackFallback(s), APP_BACK_ORDER[i], `${APP_BACK_ORDER[i]} should win when it and all below are set`);
  }
});

test('a single set flag resolves to itself - including every shadowed row (kept fallback cannot drift)', () => {
  for (const key of APP_BACK_ORDER) {
    const s = none(); s[key] = true;
    assert.equal(resolveAppBackFallback(s), key);
  }
});

test('(d) the empty state resolves to null (App falls through to home / double-back exit)', () => {
  assert.equal(resolveAppBackFallback(none()), null);
});

test('an unknown/extra flag never wins - only declared keys are precedence', () => {
  const s = none(); s.somethingElse = true;
  assert.equal(resolveAppBackFallback(s), null);
});

test('the declared order is exactly the contract (guards an accidental reorder)', () => {
  assert.deepEqual(APP_BACK_ORDER, [
    'match', 'preMatch', 'deckWizard',
    'importMode', 'matchImport', 'resultPaste', 'searchHelp', 'credits', 'settings', 'profileSheet',
    'add', 'query', 'detail', 'deckEdit', 'deckOpen', 'tabHome',
  ]);
});

// --- resolveCounterBackFallback: the match-internal ladder -----------------------

test('(c) counter back peels confirm -> end -> sheet -> fab, then minimizes', () => {
  assert.equal(resolveCounterBackFallback({ confirm: true, end: true, sheet: true, fab: true }), 'confirm');
  assert.equal(resolveCounterBackFallback({ confirm: false, end: true, sheet: true, fab: true }), 'end');
  assert.equal(resolveCounterBackFallback({ confirm: false, end: false, sheet: true, fab: true }), 'sheet');
  assert.equal(resolveCounterBackFallback({ confirm: false, end: false, sheet: false, fab: true }), 'fab');
  assert.equal(resolveCounterBackFallback({ confirm: false, end: false, sheet: false, fab: false }), 'minimize');
  assert.equal(resolveCounterBackFallback({}), 'minimize');
});

test('the counter ladder order is exactly the contract', () => {
  assert.deepEqual(COUNTER_BACK_ORDER, ['confirm', 'end', 'sheet', 'fab']);
});
