// Tests for the Gate-0 OCR baseline scorer (scripts/recog/score.mjs).
import { test } from 'node:test';
import assert from 'node:assert';
import { score, classify, wilsonInterval, wilsonUpperOneSided } from './score.mjs';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('classify: correct / miss / wrong', () => {
  assert.equal(classify('Ghoul', 'Ghoul'), 'correct');
  assert.equal(classify('Ghoul', null), 'miss');
  assert.equal(classify('Ghoul', 'Drown'), 'wrong');
});

test('wilson: zero-failure one-sided upper bound is the rule-of-three neighbourhood', () => {
  // n=60, k=0 wrong: one-sided 95% Wilson upper ~ 4.3% (rule-of-three 5% is the looser approximation).
  const u = wilsonUpperOneSided(0, 60, 0.95);
  assert.ok(u > 0.03 && u < 0.05, `got ${u}`);
  // A perfect recall interval has a sensible lower bound below 1 (never claims 100%).
  const rec = wilsonInterval(60, 60, 0.95);
  close(rec.p, 1);
  assert.ok(rec.lo < 1 && rec.lo > 0.9);
});

const row = (imageId, card, tags, extra = {}) =>
  ({ imageId, card, medium: 'physical', tags, sessionId: extra.session ?? 's1', ...extra });

test('screens are excluded; unmatched images are counted, not scored', () => {
  const manifest = { version: 1, rows: [
    row('a', 'Ghoul', ['class:spell']),
    { ...row('b', 'Beacon', ['class:site']), medium: 'screen' },   // excluded
    row('c', 'Ghoul', ['class:spell']),                            // no OCR result -> unmatched
  ] };
  const results = [{ imageId: 'a', ocrCardId: 'Ghoul' }];
  const r = score({ manifest, results });
  assert.equal(r.provenance.scoredImages, 1);
  assert.equal(r.provenance.physicalUnmatched, 1);
});

test('off-ramp TRIGGERS when every bar is met with zero false locks', () => {
  const rows = [];
  // 20 clean spells all correct, 20 off-axis sites all correct, spread across sessions.
  for (let i = 0; i < 20; i++) rows.push(row(`sp${i}`, 'Ghoul', ['class:spell'], { session: `sp${i}` }));
  for (let i = 0; i < 20; i++) rows.push(row(`si${i}`, 'Beacon', ['class:site', 'angle:>25deg', 'light:glare'], { session: `si${i}` }));
  const results = rows.map((r) => ({ imageId: r.imageId, ocrCardId: r.card }));
  const rep = score({ manifest: { version: 1, rows }, results });
  assert.equal(rep.slices.overall.wrong, 0);
  assert.equal(rep.offRamp.triggered, true);
});

test('a single false lock (wrong card) blocks the off-ramp', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(row(`sp${i}`, 'Ghoul', ['class:spell'], { session: `sp${i}` }));
  for (let i = 0; i < 20; i++) rows.push(row(`si${i}`, 'Beacon', ['class:site', 'angle:>25deg'], { session: `si${i}` }));
  const results = rows.map((r) => ({ imageId: r.imageId, ocrCardId: r.card }));
  results[0].ocrCardId = 'Drown';   // one wrong-card lock
  const rep = score({ manifest: { version: 1, rows }, results });
  assert.equal(rep.slices.overall.wrong, 1);
  assert.equal(rep.offRamp.triggered, false);
});

test('low site recall blocks the off-ramp even if overall passes', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push(row(`sp${i}`, 'Ghoul', ['class:spell'], { session: `sp${i}` }));
  // 10 off-axis sites, only 5 recognised -> off-axis + sites-under-stress recall 50%, below 0.80.
  for (let i = 0; i < 10; i++) rows.push(row(`si${i}`, 'Beacon', ['class:site', 'angle:>25deg'], { session: `si${i}` }));
  const results = rows.map((r) => ({ imageId: r.imageId, ocrCardId: r.card }));
  for (let i = 0; i < 5; i++) results.find((x) => x.imageId === `si${i}`).ocrCardId = null;  // 5 misses
  const rep = score({ manifest: { version: 1, rows }, results });
  assert.ok(rep.slices.overall.recall.p > 0.80);
  assert.ok(rep.slices['sites-under-stress'].recall.p < 0.80);
  assert.equal(rep.offRamp.triggered, false);
});

test('empty evidence fails closed (does not trigger the off-ramp)', () => {
  const rep = score({ manifest: { version: 1, rows: [] }, results: [] });
  assert.equal(rep.offRamp.triggered, false);
});
