import test from 'node:test';
import assert from 'node:assert/strict';
import { linkRuns } from './inlineRuns.js';

// canon: "see Charge now"  (indices: 'Charge' = [4,10))
const CANON = 'see Charge now';
const link = { start: 4, end: 10, name: 'Charge', target: 'rule' };

test('plain text with no links is one bare run', () => {
  const runs = linkRuns(CANON, 0, CANON.length, []);
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].start, runs[0].end, runs[0].link], [0, CANON.length, null]);
});

test('a link in the middle splits into before / link / after', () => {
  const runs = linkRuns(CANON, 0, CANON.length, [link]);
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((r) => [r.start, r.end]), [[0, 4], [4, 10], [10, 14]]);
  assert.equal(runs[0].link, null);
  assert.equal(runs[1].link.name, 'Charge');   // the link run carries the link
  assert.equal(runs[2].link, null);
  // text reconstructs exactly, in order
  assert.equal(runs.map((r) => CANON.slice(r.start, r.end)).join(''), CANON);
});

test('a link at the very start has no empty leading run', () => {
  const runs = linkRuns('Charge now', 0, 10, [{ start: 0, end: 6, name: 'Charge', target: 'rule' }]);
  assert.deepEqual(runs.map((r) => [r.start, r.end, !!r.link]), [[0, 6, true], [6, 10, false]]);
});

test('a link at the very end has no empty trailing run', () => {
  const runs = linkRuns('see Charge', 0, 10, [{ start: 4, end: 10, name: 'Charge', target: 'rule' }]);
  assert.deepEqual(runs.map((r) => [r.start, r.end, !!r.link]), [[0, 4, false], [4, 10, true]]);
});

test('text entirely inside one link is a single link run', () => {
  const runs = linkRuns('Charge', 0, 6, [{ start: 0, end: 6, name: 'Charge', target: 'rule' }]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].link.name, 'Charge');
});

test('a link straddling the span window is clipped to the window', () => {
  // window [4,10); link [0,14) covers the whole slice -> one clipped link run
  const runs = linkRuns(CANON, 4, 10, [{ start: 0, end: 14, name: 'x', target: 'rule' }]);
  assert.deepEqual(runs.map((r) => [r.start, r.end, !!r.link]), [[4, 10, true]]);
});
