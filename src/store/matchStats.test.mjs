import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMatchStats, normalizeDurationSec, validDurationMinutes, MAX_DURATION_MINUTES } from './matchStats.js';

// The fixtures the defect demanded: all-timed, all-untimed, and MIXED. The mixed case is
// the whole point - it is the one that was wrong, it is the one users actually have, and
// it was untestable while the calculation lived inline in a React component.

const timed = (sec) => ({ duration_sec: sec });

test('mixed: untimed matches do not drag the average', () => {
  // THE BUG, as a fixture. Ten 30-minute matches + ten untimed ones.
  // Old behaviour: 18000 / 20 / 60 = 15 - a number describing no match anyone played.
  const matches = [
    ...Array.from({ length: 10 }, () => timed(1800)),
    ...Array.from({ length: 10 }, () => timed(0)),
  ];
  const s = computeMatchStats(matches);
  assert.equal(s.avgMin, 30, 'the average must equal the TIMED average, unmoved by untimed matches');
  assert.equal(s.timedCount, 10);
  assert.equal(s.totalSec, 18000, 'untimed matches contribute no known time - not zero time');
});

test('mixed with nulls: the current untimed shape reads the same as the historical one', () => {
  const a = computeMatchStats([timed(1800), timed(1800), { duration_sec: null }]);
  const b = computeMatchStats([timed(1800), timed(1800), timed(0)]);
  assert.deepEqual(a, b, 'null (new writers) and 0 (historical rows) are both untimed');
  assert.equal(a.avgMin, 30);
});

test('all timed: the ordinary case is unchanged', () => {
  const s = computeMatchStats([timed(600), timed(1200)]);
  assert.equal(s.totalSec, 1800);
  assert.equal(s.timedCount, 2);
  assert.equal(s.avgSec, 900);
  assert.equal(s.avgMin, 15);
});

test('all untimed: null, never zero', () => {
  const s = computeMatchStats([timed(0), { duration_sec: null }, {}]);
  // "no timed matches" is not "an average of zero minutes". A UI that cannot tell them
  // apart reprints the conflation this module exists to remove.
  assert.equal(s.avgMin, null);
  assert.equal(s.avgSec, null);
  assert.equal(s.timedCount, 0);
  assert.equal(s.totalSec, 0);
});

test('empty and absent lists do not throw', () => {
  for (const input of [[], null, undefined]) {
    const s = computeMatchStats(input);
    assert.equal(s.avgMin, null);
    assert.equal(s.totalSec, 0);
  }
});

test('negative durations are untimed, not credit', () => {
  // A negative can only be corruption or a malformed import. It must never subtract from
  // a total or count toward a denominator.
  const s = computeMatchStats([timed(1800), timed(-600)]);
  assert.equal(s.avgMin, 30);
  assert.equal(s.timedCount, 1);
  assert.equal(s.totalSec, 1800);
});

test('string durations from a form or an import payload still count', () => {
  const s = computeMatchStats([{ duration_sec: '1800' }, { duration_sec: '1800' }]);
  assert.equal(s.timedCount, 2);
  assert.equal(s.avgMin, 30);
});

test('malformed rows cannot poison the totals', () => {
  // A restored profile or a shared payload can carry anything. Reading through the same
  // normaliser the writers use means one definition of "a duration" on both sides of the
  // database - an Infinity here would otherwise make every total Infinity.
  const s = computeMatchStats([
    { duration_sec: 1800 }, { duration_sec: Infinity }, { duration_sec: 'abc' },
    { duration_sec: -Infinity }, { duration_sec: NaN }, { duration_sec: 1800 },
  ]);
  assert.equal(s.timedCount, 2);
  assert.equal(s.totalSec, 3600);
  assert.equal(s.avgMin, 30);
});

test('validDurationMinutes: empty is valid - untimed is a real answer', () => {
  assert.equal(validDurationMinutes(''), true);
  assert.equal(validDurationMinutes(null), true);
  assert.equal(validDurationMinutes(undefined), true);
});

test('validDurationMinutes: the bound is enforced at both edges', () => {
  assert.equal(validDurationMinutes(String(MAX_DURATION_MINUTES)), true, '600 is allowed');
  assert.equal(validDurationMinutes(String(MAX_DURATION_MINUTES + 1)), false, '601 is not');
  assert.equal(validDurationMinutes('999'), false);
  assert.equal(validDurationMinutes('1'), true);
});

test('validDurationMinutes: zero, negative, and non-numeric are refused', () => {
  // Zero is refused rather than silently treated as untimed: a person who TYPED 0 meant
  // something, and it was not "I didn't time it" - clearing the field is how you say that.
  for (const v of ['0', '-1', '-600', 'abc', '12abc', ' ', '1e400']) {
    assert.equal(validDurationMinutes(v), false, `${JSON.stringify(v)} must be refused`);
  }
});

test('normalizeDurationSec: everything unknown becomes null', () => {
  // The empty string is not hypothetical - it is what a cleared number input yields.
  for (const v of [null, undefined, '', 0, -1, -900, NaN, Infinity, -Infinity, 'abc', {}]) {
    assert.equal(normalizeDurationSec(v), null, `${JSON.stringify(String(v))} must be untimed`);
  }
});

test('normalizeDurationSec: a real duration survives, rounded to whole seconds', () => {
  assert.equal(normalizeDurationSec(1800), 1800);
  assert.equal(normalizeDurationSec('1800'), 1800);
  assert.equal(normalizeDurationSec(1800.4), 1800);
});

test('normalizeDurationSec: sub-second durations never round down into "untimed"', () => {
  // THE HOLE THIS CLOSES. Positivity was tested BEFORE rounding, so 0.4 passed the guard
  // and came back as 0 - a value the function promises never to return and that every
  // reader treats as untimed. The old fixture only probed 0.6, which rounds UP, so the
  // test agreed with the bug. Anything above zero is measured time and stays measured.
  for (const v of [0.1, 0.4, 0.5, 0.6, 1]) {
    const out = normalizeDurationSec(v);
    assert.equal(out, 1, `${v}s must normalise to 1, got ${out}`);
    assert.ok(out > 0, 'the contract is null or > 0 - never 0');
  }
});
