// Pure tests for the stacked List sort (docs/proposals/arrange-stacked-sort.md).
// Run: npm run test:query
//
// The fixture below deliberately carries an avatar, a rarity-less card, an unrecognised element
// and an untimestamped row, because the failure this feature is most likely to ship is a
// comparator that inverts its WHOLE result under `desc` - which passes any test whose fixture
// happens to lack those, and every list in casual testing lacks all four.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIST_SORT_OPTIONS, LIST_SORT_COMPARATOR_KEYS, stackComparator, normaliseSort,
} from './collectionFilter.js';

// List rows are card-shaped (the List passes cardOf = identity), plus row-level list fields.
const row = (over) => ({ variant_slug: '', created_at: '', ...over });

const AIR_ORD = row({ card_id: 'a1', name: 'Aeromancer', elements: '["Air"]', rarity: 'Ordinary', created_at: '2026-01-01' });
const AIR_UNI = row({ card_id: 'a2', name: 'Alpha Wind', elements: '["Air"]', rarity: 'Unique', created_at: '2026-03-01' });
const EARTH_ELI = row({ card_id: 'e1', name: 'Bedrock', elements: '["Earth"]', rarity: 'Elite', created_at: '2026-02-01' });
const FIRE_EXC = row({ card_id: 'f1', name: 'Cinder', elements: '["Fire"]', rarity: 'Exceptional', created_at: '' });
const NO_RARITY = row({ card_id: 'n1', name: 'Nomad', elements: '["Water"]', rarity: null, created_at: '2026-04-01' });
const AVATAR = row({ card_id: 'v1', name: 'Templar', elements: '["Air"]', rarity: 'Elite', is_avatar: 1, created_at: '2026-05-01' });
const ODD_EL = row({ card_id: 'x1', name: 'Xenolith', elements: '["Chaos"]', rarity: 'Ordinary', created_at: '2026-06-01' });

const ALL = [AIR_ORD, AIR_UNI, EARTH_ELI, FIRE_EXC, NO_RARITY, AVATAR, ODD_EL];
const identityOf = (r) => r.item_id ?? r.card_id;          // mirrors the List's rowKey
const ids = (rows) => rows.map((r) => r.card_id);
const sortBy = (stack, rows = ALL) => ids([...rows].sort(stackComparator(stack, { identityOf })));

/* ---------------- the option contract ---------------- */

test('every option declares an explicit asc/desc default, and "Recently added" defaults desc', () => {
  for (const o of LIST_SORT_OPTIONS) {
    assert.ok(o.key && o.label, `option needs key + label: ${JSON.stringify(o)}`);
    assert.ok(o.defaultDir === 'asc' || o.defaultDir === 'desc', `${o.key} must declare a real direction`);
  }
  assert.equal(LIST_SORT_OPTIONS.find((o) => o.key === 'added').defaultDir, 'desc',
    'the label says "Recently", so the first tap must show newest first');
  for (const key of ['name', 'element', 'rarity']) {
    assert.equal(LIST_SORT_OPTIONS.find((o) => o.key === key).defaultDir, 'asc');
  }
});

test('registry exhaustiveness: every option has a comparator and every comparator has an option', () => {
  const opts = LIST_SORT_OPTIONS.map((o) => o.key).sort();
  const cmps = [...LIST_SORT_COMPARATOR_KEYS].sort();
  assert.deepEqual(cmps, opts, 'adding a key without a comparator (or vice versa) must fail here');
});

/* ---------------- the complete chain: keys -> implicit name -> identity ---------------- */

test('a single non-name key still orders alphabetically within it (criterion 4)', () => {
  // Rarity alone: Ordinary run must stay A-Z. Aeromancer before Xenolith, both Ordinary.
  const out = sortBy([{ key: 'rarity', dir: 'asc' }]);
  assert.deepEqual(out, ['a1', 'x1', 'f1', 'e1', 'a2', 'n1', 'v1']);
});

test('the tester\'s stack: element, then rarity, then name', () => {
  // Air: Aeromancer (Ordinary) before Alpha Wind (Unique), avatar last within Air.
  const out = sortBy([{ key: 'element', dir: 'asc' }, { key: 'rarity', dir: 'asc' }, { key: 'name', dir: 'asc' }]);
  assert.deepEqual(out, ['a1', 'a2', 'v1', 'e1', 'f1', 'n1', 'x1']);
});

test('implicit name is a no-op when Name is selected descending', () => {
  const out = sortBy([{ key: 'name', dir: 'desc' }]);
  assert.deepEqual(out, ['x1', 'v1', 'n1', 'f1', 'e1', 'a2', 'a1']);
});

test('an empty stack is Name ascending - the historical default', () => {
  assert.deepEqual(sortBy([]), ids([...ALL].sort((a, b) => a.name.localeCompare(b.name))));
});

/* ---------------- tail buckets hold in BOTH directions ---------------- */

test('rarity ascending: knowns, then unknown, then avatar dead last', () => {
  assert.deepEqual(sortBy([{ key: 'rarity', dir: 'asc' }]).slice(-2), ['n1', 'v1']);
});

test('rarity descending reverses ONLY the knowns; unknown then avatar stay last', () => {
  const out = sortBy([{ key: 'rarity', dir: 'desc' }]);
  assert.deepEqual(out, ['a2', 'e1', 'f1', 'a1', 'x1', 'n1', 'v1'],
    'Unique->Ordinary, then the two tails in their fixed order');
});

test('an unrecognised element sorts last in both directions', () => {
  assert.equal(sortBy([{ key: 'element', dir: 'asc' }]).at(-1), 'x1');
  assert.equal(sortBy([{ key: 'element', dir: 'desc' }]).at(-1), 'x1');
});

test('a blank timestamp sorts last in both directions', () => {
  assert.equal(sortBy([{ key: 'added', dir: 'desc' }]).at(-1), 'f1', 'newest first, blank still last');
  assert.equal(sortBy([{ key: 'added', dir: 'asc' }]).at(-1), 'f1', 'oldest first, blank still last');
});

test('added: asc is oldest-first, desc is newest-first', () => {
  const dated = ALL.filter((r) => r.created_at);
  assert.deepEqual(sortBy([{ key: 'added', dir: 'asc' }], dated), ['a1', 'e1', 'a2', 'n1', 'v1', 'x1']);
  assert.deepEqual(sortBy([{ key: 'added', dir: 'desc' }], dated), ['x1', 'v1', 'n1', 'a2', 'e1', 'a1']);
});

test('rows tied inside a tail bucket continue to the next key', () => {
  // Two blank-timestamp rows: `added` cannot separate them, so name decides.
  const b1 = row({ card_id: 'b1', name: 'Zeta', rarity: 'Ordinary' });
  const b2 = row({ card_id: 'b2', name: 'Beta', rarity: 'Ordinary' });
  assert.deepEqual(sortBy([{ key: 'added', dir: 'desc' }], [b1, b2]), ['b2', 'b1']);
});

/* ---------------- totality and stability ---------------- */

test('two same-name Wishlist printings are ordered by identity, not left to chance', () => {
  // One card, two collector items - standard and foil. Same name, so name cannot separate them.
  const std = row({ card_id: 'w1', item_id: 'w1|alpha', name: 'Twinned', rarity: 'Elite', variant_slug: 'alpha' });
  const foil = row({ card_id: 'w1', item_id: 'w1|alpha_f', name: 'Twinned', rarity: 'Elite', variant_slug: 'alpha_f' });
  const cmp = stackComparator([{ key: 'rarity', dir: 'asc' }], { identityOf });
  assert.notEqual(cmp(std, foil), 0, 'identity must break the tie');
  assert.equal(cmp(std, foil) + cmp(foil, std), 0, 'and it must be antisymmetric');
  assert.deepEqual([foil, std].sort(cmp).map(identityOf), ['w1|alpha', 'w1|alpha_f']);
});

test('the order is stable regardless of input order when identity is supplied', () => {
  const stack = [{ key: 'element', dir: 'asc' }, { key: 'rarity', dir: 'desc' }];
  const shuffles = [
    [6, 0, 3, 1, 5, 2, 4],
    [2, 5, 1, 6, 4, 0, 3],
    [4, 3, 6, 5, 0, 1, 2],
  ].map((perm) => perm.map((i) => ALL[i]));
  const expected = sortBy(stack);
  for (const s of shuffles) assert.deepEqual(sortBy(stack, s), expected);
});

test('unknown keys are dropped rather than guessed at', () => {
  assert.deepEqual(sortBy([{ key: 'nonsense', dir: 'asc' }]), sortBy([]));
});

/* ---------------- legacy normalisation preserves direction ---------------- */

test('every legacy sort value maps to a stack that preserves its present behaviour', () => {
  assert.deepEqual(normaliseSort('name'), []);
  assert.deepEqual(normaliseSort('name-asc'), []);
  assert.deepEqual(normaliseSort('name-desc'), [{ key: 'name', dir: 'desc' }]);
  assert.deepEqual(normaliseSort('element'), [{ key: 'element', dir: 'asc' }]);
  assert.deepEqual(normaliseSort('rarity'), [{ key: 'rarity', dir: 'asc' }]);
  assert.deepEqual(normaliseSort('rarity-asc'), [{ key: 'rarity', dir: 'asc' }]);
  // The one that would have silently reversed: "Recently added" has always meant newest-first.
  assert.deepEqual(normaliseSort('added'), [{ key: 'added', dir: 'desc' }]);
  assert.deepEqual(normaliseSort('updated'), [{ key: 'added', dir: 'desc' }]);
});

test('normaliseSort passes arrays through, cleaning bad keys and directions', () => {
  assert.deepEqual(normaliseSort([{ key: 'rarity', dir: 'desc' }]), [{ key: 'rarity', dir: 'desc' }]);
  assert.deepEqual(normaliseSort([{ key: 'rarity', dir: 'sideways' }]), [{ key: 'rarity', dir: 'asc' }]);
  assert.deepEqual(normaliseSort([{ key: 'bogus', dir: 'asc' }]), []);
  assert.deepEqual(normaliseSort(undefined), []);
});

test('a legacy value and its normalised stack sort identically', () => {
  // The whole point of normalisation: the arrangement a user already had must not move.
  const legacyAdded = [...ALL].sort((a, b) => {
    const av = a.created_at || '', bv = b.created_at || '';
    if (av === bv) return a.name.localeCompare(b.name);
    if (!av) return 1;
    if (!bv) return -1;
    return bv < av ? -1 : 1;                       // the old inline comparator, verbatim
  });
  assert.deepEqual(sortBy(normaliseSort('added')), ids(legacyAdded));
});
