// The qrcode-generator API contract that QRCode.jsx depends on. Run: npm run test:ui
//
// WHY THIS EXISTS. `src/components/QRCode.jsx` is the only consumer of `qrcode-generator`, it has no
// other coverage, and the library went 1.4.4 -> 2.0.4 during the Capacitor 8 upgrade. A QR that
// renders but encodes nothing is the kind of failure nobody notices until an opponent's camera fails
// to read a shared match - at a table, away from a debugger.
//
// It asserts the exact five calls the component makes, plus that the output is a real QR code rather
// than merely a non-empty grid: the three finder patterns are checked by position, so a stub that
// returned "all dark" or "all light" fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import qrcode from 'qrcode-generator';

const build = (text) => {
  const qr = qrcode(0, 'M');          // auto version, error-correction M - as QRCode.jsx calls it
  qr.addData(text);
  qr.make();
  return qr;
};

test('the five calls QRCode.jsx makes all exist and behave', () => {
  const qr = build('compendium://match?d=abc123');
  assert.equal(typeof qr.addData, 'function');
  assert.equal(typeof qr.make, 'function');
  assert.equal(typeof qr.getModuleCount, 'function');
  assert.equal(typeof qr.isDark, 'function');
  const n = qr.getModuleCount();
  assert.ok(Number.isInteger(n) && n >= 21, `implausible module count: ${n}`);
});

test('the grid is a real QR code, not just a non-empty bitmap', () => {
  const qr = build('compendium://match?d=abc123');
  const n = qr.getModuleCount();
  // Finder patterns: a 7x7 marker in three corners. Their dark/light structure is fixed by the spec,
  // so this fails for an all-dark or all-light stub as well as for a scrambled grid.
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    assert.ok(qr.isDark(r0, c0), `finder corner (${r0},${c0}) should be dark`);
    assert.ok(qr.isDark(r0 + 6, c0), 'finder edge should be dark');
    assert.ok(!qr.isDark(r0 + 1, c0 + 1), 'finder inner ring should be light');
    assert.ok(qr.isDark(r0 + 3, c0 + 3), 'finder centre should be dark');
  }
  // The fourth corner has no finder pattern - proves the three above are not a coincidence.
  assert.ok(!(qr.isDark(n - 1, n - 1) && qr.isDark(n - 7, n - 7) && !qr.isDark(n - 6, n - 6)),
    'a finder pattern appeared in the bottom-right corner, where the spec has none');
});

test('a longer payload grows the grid - auto version selection works', () => {
  const small = build('x').getModuleCount();
  const large = build('compendium://match?d=' + 'y'.repeat(400)).getModuleCount();
  assert.ok(large > small, `expected a bigger grid for a bigger payload: ${small} -> ${large}`);
});

test('an empty string still produces a valid grid rather than throwing', () => {
  // QRCode.jsx passes `text || ''`, so the empty case is reachable from the UI.
  const qr = build('');
  assert.ok(qr.getModuleCount() >= 21);
});
