// What a want gesture resolves to. The rule under test is the one the whole v11 effort exists
// to enforce: a new want always identifies its collector item, and the app never guesses which.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantTarget, needsPicker, pickerOptions, DEFAULT_WANT_FOIL } from './wantIntent.js';
import { UNCATEGORISED_BUCKET, UNCATEGORISED, UNCATEGORISED_FOIL } from './printings.js';

/* ---------------- when we already know ---------------- */

test('a surface scoped to a real set writes straight away', () => {
  // The card sheet has a set segment selected. That is the user's own choice of context, not
  // an inference, so there is nothing to ask.
  assert.deepEqual(wantTarget(['001', '002'], { set: '002' }), { kind: 'item', item: { set: '002', foil: false } });
});

test('a single-set card needs no picker, even with no context', () => {
  // Not a guess: a card printed once can only be wanted from that printing.
  assert.deepEqual(wantTarget(['004'], {}), { kind: 'item', item: { set: '004', foil: false } });
  assert.equal(needsPicker(['004'], {}), false);
});

/* ---------------- when we must ask ---------------- */

test('a REPRINT with no context asks, and never picks the first set', () => {
  // The original defect: the wishlist showed ALPHA for a card whose copies were Beta, purely
  // because Alpha sorted first. Asking is the entire fix.
  const t = wantTarget(['001', '002'], {});
  assert.equal(t.kind, 'ask');
  assert.deepEqual(t.options, ['001', '002']);
  assert.equal(needsPicker(['001', '002'], {}), true);
});

test('the UNCATEGORISED bucket is not accepted as a set - it asks instead', () => {
  // Honouring it would create exactly the unresolved want that §2.1 forbids new writers from
  // making. Only migration may produce one of those.
  const t = wantTarget(['001', '002'], { set: UNCATEGORISED_BUCKET });
  assert.equal(t.kind, 'ask');
});

test('an uncategorised context on a SINGLE-set card still resolves', () => {
  // The bucket is not a set, but the card still has only one possible answer.
  assert.deepEqual(wantTarget(['004'], { set: UNCATEGORISED_BUCKET }), { kind: 'item', item: { set: '004', foil: false } });
});

/* ---------------- when we cannot ask ---------------- */

test('a card the catalog does not place in any set is reported as unknown', () => {
  // Nothing to offer and nothing to infer. The caller decides what to do; it must not silently
  // become an uncategorised want.
  for (const sets of [[], null, undefined]) {
    assert.deepEqual(wantTarget(sets, {}), { kind: 'unknown' }, JSON.stringify(sets));
  }
});

/* ---------------- finish ---------------- */

test('finish is NEVER asked - it defaults to non-foil', () => {
  // §7.4: a set is completed in non-foil, so that is the copy a bare "I want this" refers to.
  // Wanting a foil is a deliberate act made in the picker, not a question on every heart.
  assert.equal(DEFAULT_WANT_FOIL, false);
  for (const ctx of [{ set: '001' }, {}]) {
    const t = wantTarget(['001'], ctx);
    assert.equal(t.item.foil, false, JSON.stringify(ctx));
  }
});

/* ---------------- picker ordering ---------------- */

test('picker options follow the app-wide set order', () => {
  const rank = (c) => ({ '001': 1, '002': 2, '004': 3 })[c];
  const labels = { '001': 'Alpha', '002': 'Beta', '004': 'Arthurian Legends' };
  assert.deepEqual(
    pickerOptions(['004', '001', '002'], rank, labels).map((o) => o.name),
    ['Alpha', 'Beta', 'Arthurian Legends'],
  );
});

test('an UNRANKED set sorts last rather than becoming the default choice', () => {
  // A set the app does not know about must not silently land at the top of the picker, where a
  // fast thumb would select it.
  const rank = (c) => ({ '001': 1 })[c];
  assert.deepEqual(pickerOptions(['999', '001'], rank, {}).map((o) => o.code), ['001', '999']);
});

test('picker options fall back to the raw code when there is no label', () => {
  assert.deepEqual(pickerOptions(['777'], () => 0, {}), [{ code: '777', name: '777' }]);
});

/* ---------------- a scoped context is not trusted blindly ---------------- */

test('a STALE context set is ignored, and the ordinary rules apply', () => {
  // Navigation goes stale: a set drill left open across a catalog update, or a card opened from
  // one grid and swiped to another. Trusting it would write a collector item that does not
  // exist - which no reader can bucket and no triage can resolve.
  const t = wantTarget(['001', '002'], { set: '999' });
  assert.equal(t.kind, 'ask', 'it falls back to asking rather than writing a phantom item');
  assert.deepEqual(t.options, ['001', '002']);
});

test('a stale context on a SINGLE-set card resolves to the real set', () => {
  assert.deepEqual(wantTarget(['004'], { set: '999' }), { kind: 'item', item: { set: '004', foil: false } });
});

test('a stale context on a card with NO sets reports unknown', () => {
  assert.deepEqual(wantTarget([], { set: '999' }), { kind: 'unknown' });
});

test('a canonical uncategorised KEY is never accepted as a context', () => {
  // Not just the empty bucket code - the storage keys themselves, in case one is passed through
  // from a row rather than from a set control.
  for (const set of [UNCATEGORISED, UNCATEGORISED_FOIL]) {
    assert.equal(wantTarget(['001', '002'], { set }).kind, 'ask', `accepted ${set}`);
  }
});

test('a DUPLICATED set does not make a single-set card look like a reprint', () => {
  // A catalog entry listing the same set twice would otherwise open a picker offering one
  // answer twice over.
  assert.deepEqual(wantTarget(['004', '004'], {}), { kind: 'item', item: { set: '004', foil: false } });
});

test('duplicates are collapsed in the picker options too', () => {
  const t = wantTarget(['001', '002', '001'], {});
  assert.equal(t.kind, 'ask');
  assert.deepEqual(t.options, ['001', '002']);
});
