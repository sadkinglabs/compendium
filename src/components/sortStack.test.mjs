// Tests for the shared sort-stack reducer (docs/proposals/arrange-stacked-sort.md).
// Run: npm run test:ui
//
// These drive the ACTUAL exported option lists, not fixtures. That is deliberate: a fixture with
// a correct `defaultDir` proves nothing about the list the app really ships, and the failure most
// likely to escape review was exactly that - a reducer that works when handed a good option, wired
// to a surface that hands it something else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleSort, flipSort, sortIndex, isValidSortOption } from './sortStack.js';
import { DECK_SORT_OPTIONS, LIST_SORT_OPTIONS } from '../store/sortOptions.js';

const byKey = (opts, key) => opts.find((o) => o.key === key);

/* ---------------- both real option lists satisfy the contract ---------------- */

for (const [name, opts] of [['DECK_SORT_OPTIONS', DECK_SORT_OPTIONS], ['LIST_SORT_OPTIONS', LIST_SORT_OPTIONS]]) {
  test(`${name}: every shipped option is valid for the reducer`, () => {
    assert.ok(opts.length > 0);
    for (const o of opts) assert.ok(isValidSortOption(o), `${name}.${o.key} must declare key + defaultDir`);
  });

  test(`${name}: adding any shipped option uses ITS declared direction, never a hardcoded asc`, () => {
    for (const o of opts) {
      assert.deepEqual(toggleSort([], o), [{ key: o.key, dir: o.defaultDir }]);
    }
  });
}

/* ---------------- the regression this contract exists to prevent ---------------- */

test('tapping the real "Recently added" option yields newest-first, not oldest-first', () => {
  const added = byKey(LIST_SORT_OPTIONS, 'added');
  assert.equal(toggleSort([], added)[0].dir, 'desc',
    'the old reducer hardcoded asc here, which would have listed the OLDEST first');
});

test('every deck key still ascends, so Deck Add Cards is unchanged by the migration', () => {
  for (const o of DECK_SORT_OPTIONS) assert.equal(toggleSort([], o)[0].dir, 'asc');
});

/* ---------------- fail closed ---------------- */

test('an option that does not commit to a direction is rejected, not defaulted', () => {
  for (const bad of [null, undefined, {}, { key: 'name' }, { key: 'name', defaultDir: 'sideways' }, { defaultDir: 'asc' }, { key: '', defaultDir: 'asc' }]) {
    assert.equal(isValidSortOption(bad), false, `${JSON.stringify(bad)} must not validate`);
    const stack = [{ key: 'element', dir: 'desc' }];
    assert.deepEqual(toggleSort(stack, bad), stack, 'the tap is ignored and the stack is untouched');
  }
});

test('a malformed stack is tolerated rather than thrown over', () => {
  const name = byKey(DECK_SORT_OPTIONS, 'name');
  assert.deepEqual(toggleSort(undefined, name), [{ key: 'name', dir: 'asc' }]);
  assert.deepEqual(flipSort(undefined, 'name'), []);
  assert.equal(sortIndex(undefined, 'name'), -1);
});

/* ---------------- tap order is priority order ---------------- */

test('tap order is priority order, and re-tapping removes without disturbing the rest', () => {
  const [name, cost, element] = ['name', 'cost', 'element'].map((k) => byKey(DECK_SORT_OPTIONS, k));
  let s = toggleSort([], element);
  s = toggleSort(s, cost);
  s = toggleSort(s, name);
  assert.deepEqual(s.map((x) => x.key), ['element', 'cost', 'name']);
  assert.equal(sortIndex(s, 'cost'), 1);

  s = toggleSort(s, cost);                       // remove the middle key
  assert.deepEqual(s.map((x) => x.key), ['element', 'name'], 'the others keep their order');

  s = toggleSort(s, cost);                       // re-add: it goes to the END, not back to the middle
  assert.deepEqual(s.map((x) => x.key), ['element', 'name', 'cost']);
});

test('flip changes one key\'s direction and nothing else', () => {
  const [name, cost] = ['name', 'cost'].map((k) => byKey(DECK_SORT_OPTIONS, k));
  const s = toggleSort(toggleSort([], name), cost);
  const flipped = flipSort(s, 'name');
  assert.deepEqual(flipped, [{ key: 'name', dir: 'desc' }, { key: 'cost', dir: 'asc' }]);
  assert.deepEqual(flipSort(flipped, 'name'), s, 'flipping twice returns to the start');
  assert.deepEqual(flipSort(s, 'absent'), s, 'flipping a key that is not in the stack is a no-op');
});

test('the reducer never mutates the stack it is given', () => {
  const name = byKey(DECK_SORT_OPTIONS, 'name');
  const original = [{ key: 'cost', dir: 'asc' }];
  const copy = JSON.parse(JSON.stringify(original));
  toggleSort(original, name);
  flipSort(original, 'cost');
  assert.deepEqual(original, copy);
});

/* ---------------- exhaustiveness: an option without a comparator must fail here ---------------- */

test('DECK_SORT_OPTIONS and the deck pool comparator registry cover exactly the same keys', async () => {
  const { DECK_SORT_COMPARATOR_KEYS } = await import('../store/deckRepository.js');
  assert.deepEqual([...DECK_SORT_COMPARATOR_KEYS].sort(), DECK_SORT_OPTIONS.map((o) => o.key).sort());
});
