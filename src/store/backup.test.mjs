// The pure backup core: canonical JSON, the digest preimage, and every reason to refuse a file.
// Run: npm run test:query
//
// The headline test in here is `seal -> parseBackup` accepting. It looks trivial and is not: revision
// 3 of the proposal had the writer and the reader hashing DIFFERENT documents, so every valid archive
// would have failed its own integrity check. That defect is invisible to any test that only checks
// "a tampered file is rejected" - you have to assert that an untampered one is ACCEPTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUNDLE_FORMAT, DIGEST_ALGORITHM, LIMITS,
  canonicalJson, sha256Hex, unsignedOf, buildEnvelope, seal, parseBackup, isLegacyBundle, summarise,
} from './backup.js';
import { MAX_SUPPORTED_SCHEMA } from './importBoundary.js';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const unit = (over = {}) => ({
  profile: { name: 'Sentinel', avatar: null, accent: 'gold', system: 'sorcery', is_default: 1,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
  dashSeeded: true,
  decks: [{ id: 'd1', name: 'Deck' }],
  deck_entries: [], deck_history: [], saved: [], notes: [],
  collections: [], collection_items: [],
  owned_cards: [{ id: 'o1', card_id: 'sentinel_card', variant_slug: '', qty_owned: 2, qty_wanted: 0 }],
  card_lists: [], card_list_entries: [], links: [],
  matches: [], match_log_entries: [], dashboard_blocks: [], dashboard_layouts: [],
  resume: null, settings: null,
  ...over,
});

const envelope = (over = {}, units = [unit()]) => buildEnvelope({
  schemaVersion: MAX_SUPPORTED_SCHEMA,
  appBuild: 214,
  exportedAt: '2026-08-10T10:00:00.000Z',
  appGlobal: { activeProfileIndex: 0, changelogSeenBuild: 213 },
  profiles: units,
  ...over,
});

const sealedText = async (over, units) => JSON.stringify(await seal(envelope(over, units)));
const mutate = (text, fn) => { const o = JSON.parse(text); fn(o); return JSON.stringify(o); };
const rejects = (p, code) => assert.rejects(p, (e) => e.name === 'ImportRejected' && e.code === code,
  `expected ImportRejected(${code})`);

/* ------------------------------------------------------------------ */
/* canonical JSON                                                      */
/* ------------------------------------------------------------------ */

test('canonicalJson sorts object keys, so insertion order cannot change the digest', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('canonicalJson sorts nested keys too', () => {
  assert.equal(canonicalJson({ x: { z: 1, y: 2 } }), '{"x":{"y":2,"z":1}}');
});

test('canonicalJson preserves ARRAY order - arrays are data, not sets', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('canonicalJson handles null, booleans, empty containers and unicode', () => {
  assert.equal(canonicalJson({ a: null, b: false, c: [], d: {} }), '{"a":null,"b":false,"c":[],"d":{}}');
  assert.equal(canonicalJson({ n: 'Aurë' }), '{"n":"Aurë"}');
});

test('canonicalJson drops undefined members exactly as JSON.stringify does', () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonicalJson([1, undefined, 2]), '[1,null,2]');
});

test('canonicalJson THROWS on non-finite numbers rather than encoding them as null', () => {
  // JSON.stringify turns NaN into null. Silently encoding a NaN into a backup would hide a bug
  // upstream and make the digest agree with corrupt content.
  assert.throws(() => canonicalJson({ x: NaN }), TypeError);
  assert.throws(() => canonicalJson({ x: Infinity }), TypeError);
});

/* ------------------------------------------------------------------ */
/* digest + preimage                                                   */
/* ------------------------------------------------------------------ */

test('sha256Hex matches a known vector', async () => {
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('unsignedOf keeps integrity.algorithm and removes ONLY integrity.digest', () => {
  const u = unsignedOf({ app: 'compendium', integrity: { algorithm: 'SHA-256', digest: 'deadbeef' }, payload: {} });
  assert.deepEqual(u.integrity, { algorithm: 'SHA-256' });
  assert.ok(!('digest' in u.integrity));
});

test('THE PREIMAGE CONTRACT: a sealed envelope verifies against its own digest', async () => {
  // Blocker 6. If writer and reader disagree about what is hashed, this fails and nothing else does.
  const text = await sealedText();
  const env = await parseBackup(text);
  assert.equal(env.integrity.algorithm, DIGEST_ALGORITHM);
  assert.equal(env.bundleFormat, BUNDLE_FORMAT);
});

test('the digest covers PROVENANCE too - editing appBuild or exportedAt invalidates the file', async () => {
  // Revision 2 hashed only `payload`, leaving the provenance the restore preview SHOWS THE USER
  // editable without invalidating anything.
  const text = await sealedText();
  await rejects(parseBackup(mutate(text, (o) => { o.appBuild = 999; })), 'corrupt');
  await rejects(parseBackup(mutate(text, (o) => { o.exportedAt = '2000-01-01T00:00:00.000Z'; })), 'corrupt');
});

test('a single edited row invalidates the file', async () => {
  const text = await sealedText();
  await rejects(parseBackup(mutate(text, (o) => { o.payload.profiles[0].owned_cards[0].qty_owned = 99; })), 'corrupt');
});

test('a truncated file is refused', async () => {
  const text = await sealedText();
  await rejects(parseBackup(text.slice(0, text.length - 20)), 'malformed');
});

test('a missing or wrong-algorithm digest is refused, never treated as "good enough"', async () => {
  const text = await sealedText();
  await rejects(parseBackup(mutate(text, (o) => { delete o.integrity.digest; })), 'no-digest');
  await rejects(parseBackup(mutate(text, (o) => { o.integrity.algorithm = 'MD5'; })), 'malformed');
});

/* ------------------------------------------------------------------ */
/* version gates                                                       */
/* ------------------------------------------------------------------ */

test('a NEWER bundleFormat is refused loudly', async () => {
  const text = await sealedText();
  await rejects(parseBackup(mutate(text, (o) => { o.bundleFormat = BUNDLE_FORMAT + 1; })), 'future');
});

test('a NEWER schemaVersion is refused loudly', async () => {
  const text = await sealedText();
  await rejects(parseBackup(mutate(text, (o) => { o.schemaVersion = MAX_SUPPORTED_SCHEMA + 1; })), 'future');
});

test('a non-Compendium file is refused', async () => {
  const text = await sealedText();
  await rejects(parseBackup(mutate(text, (o) => { o.app = 'something-else'; })), 'not-compendium');
});

test('unreadable versions are refused rather than coerced', async () => {
  const text = await sealedText();
  await rejects(parseBackup(mutate(text, (o) => { o.schemaVersion = 10.5; })), 'malformed');
  await rejects(parseBackup(mutate(text, (o) => { o.bundleFormat = 'two'; })), 'malformed');
});

test('isLegacyBundle recognises the v1 single-profile bundle', () => {
  assert.equal(isLegacyBundle({ app: 'compendium' }), true);
  assert.equal(isLegacyBundle({ app: 'compendium', bundleFormat: 1 }), true);
  assert.equal(isLegacyBundle({ app: 'compendium', bundleFormat: 2 }), false);
});

/* ------------------------------------------------------------------ */
/* bounds                                                              */
/* ------------------------------------------------------------------ */

test('an oversize file is refused BEFORE it is parsed', async () => {
  // Not merely "is refused": the ceiling exists so a hostile file is never turned into an object
  // graph several times its size. A string over the limit that is not even valid JSON still yields
  // the SIZE rejection, which proves the order.
  const huge = 'x'.repeat(LIMITS.fileBytes + 1);
  await rejects(parseBackup(huge), 'too-large');
});

test('too many profiles is refused', async () => {
  const many = Array.from({ length: LIMITS.profiles + 1 }, (_, i) =>
    unit({ profile: { name: `P${i}`, is_default: i === 0 ? 1 : 0 } }));
  await rejects(parseBackup(await sealedText({}, many)), 'too-large');
});

test('an implausible row count in one table is refused', async () => {
  const u = unit();
  u.saved = { length: LIMITS.rowsPerTable + 1 };   // array-like, not an array
  await rejects(parseBackup(await sealedText({}, [u])), 'malformed');

  const u2 = unit({ saved: new Array(LIMITS.rowsPerTable + 1).fill({ id: 's' }) });
  await rejects(parseBackup(await sealedText({}, [u2])), 'too-large');
});

test('a non-array collection is refused', async () => {
  await rejects(parseBackup(await sealedText({}, [unit({ decks: 'lots' })])), 'malformed');
});

test('a non-object profile entry is refused', async () => {
  await rejects(parseBackup(await sealedText({}, [['not', 'an', 'object']])), 'malformed');
});

/* ------------------------------------------------------------------ */
/* cardinality                                                         */
/* ------------------------------------------------------------------ */

test('exactly one default profile is required - zero is refused, not repaired', async () => {
  const u = unit(); u.profile.is_default = 0;
  await rejects(parseBackup(await sealedText({}, [u])), 'malformed');
});

test('two default profiles are refused, not repaired', async () => {
  const a = unit(); const b = unit();
  await rejects(parseBackup(await sealedText({ appGlobal: { activeProfileIndex: 0 } }, [a, b])), 'malformed');
});

test('activeProfileIndex must be in range, and may be absent', async () => {
  await rejects(parseBackup(await sealedText({ appGlobal: { activeProfileIndex: 5 } })), 'malformed');
  await rejects(parseBackup(await sealedText({ appGlobal: { activeProfileIndex: -1 } })), 'malformed');
  const ok = await parseBackup(await sealedText({ appGlobal: {} }));
  assert.equal(ok.payload.appGlobal.activeProfileIndex, null);
});

/* ------------------------------------------------------------------ */
/* shape reuse + preview                                               */
/* ------------------------------------------------------------------ */

test('unit shapes are validated by the SAME rules as the live per-profile import', async () => {
  // owned_cards rows without a card_id are rejected by importBoundary.validateBundle; reusing it
  // means the whole-app path cannot drift from the per-profile path.
  const u = unit({ owned_cards: [{ id: 'o1', variant_slug: '' }] });
  await rejects(parseBackup(await sealedText({}, [u])), 'malformed');
});

test('summarise reports per-profile counts for the restore preview', async () => {
  const env = await parseBackup(await sealedText());
  assert.deepEqual(summarise(env), [{
    name: 'Sentinel', isDefault: true, decks: 1, ownedCards: 1, matches: 0, rows: 2,
  }]);
});

test('a rejection never mutates the envelope it rejected', async () => {
  const text = await sealedText();
  const bad = mutate(text, (o) => { o.appBuild = 999; });
  const before = JSON.parse(bad);
  await rejects(parseBackup(bad), 'corrupt');
  assert.deepEqual(JSON.parse(bad), before, 'parseBackup must be side-effect free');
});
