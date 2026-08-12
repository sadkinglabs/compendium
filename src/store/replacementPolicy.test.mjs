// The replacement policy and the external-archive binding. Run: npm run test:query
//
// Two properties carry Increment 3, and both are pinned here:
//
//   FAIL CLOSED. Replacement is allowed only on a probe that literally reports durable - a probe
//   that throws, is missing, or reports anything else refuses, because "cannot be determined"
//   and "not durable" must be the same answer.
//
//   THE BINDING IS TO THE FROZEN CAPTURE. Codex's Rev 3 finding: an archive verified before the
//   session can describe state A while the replacement destroys state B. The stale-archive test
//   below mirrors that hole exactly - bind an archive, change the data, and the comparison
//   against the capture must abort.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, seal, contentDigestOf } from './backup.js';
import { __setBackingForTests } from './recoveryStore.js';
import {
  ReplaceRefused, replacementPolicy, bindExternalArchive, assertBoundArchiveMatches,
} from './replacementPolicy.js';

afterEach(() => { __setBackingForTests(null); });

/* ------------------------------------------------------------------ */
/* Fixtures - the same envelope grammar the store exports              */
/* ------------------------------------------------------------------ */

const deck = (id, name) => ({ id, name, created_at: '2026-01-01', updated_at: '2026-01-01' });

function unit(name, { isDefault = 0, decks = [] } = {}) {
  return {
    profile: {
      name, avatar: null, accent: 'gold', system: 'sorcery', is_default: isDefault ? 1 : 0,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    dashSeeded: true,
    decks,
    deck_entries: [], deck_history: [], saved: [], notes: [], collections: [],
    collection_items: [], owned_cards: [], card_lists: [], card_list_entries: [], links: [],
    matches: [], match_log_entries: [], dashboard_blocks: [], dashboard_layouts: [],
    resume: null, settings: null,
  };
}

const alpha = () => unit('Alpha', { isDefault: 1, decks: [deck('d-1', 'One'), deck('d-2', 'Two')] });

async function sealedEnvelope({ profiles = [alpha()], exportedAt = '2026-08-12T10:00:00.000Z', appBuild = 213 } = {}) {
  return seal(buildEnvelope({
    schemaVersion: 11, appBuild, exportedAt,
    appGlobal: { activeProfileIndex: 0, changelogSeenBuild: null },
    profiles,
  }));
}

const archiveText = async (opts) => JSON.stringify(await sealedEnvelope(opts));

/* ------------------------------------------------------------------ */
/* replacementPolicy - durable allows, everything else refuses         */
/* ------------------------------------------------------------------ */

test('a durable backing allows replacement with no external archive', async () => {
  // Native app-private storage and web with persistence granted are the same case to the policy:
  // the probe reports durable, so no substitute artifact is required.
  for (const report of [
    { persistent: true, reason: 'App-private storage (Directory.Data) is kept until the app is uninstalled.' },
    { persistent: true, reason: 'The browser granted persistent storage for this origin.' },
  ]) {
    const p = await replacementPolicy({ probe: async () => report });
    assert.equal(p.allowed, true);
    assert.equal(p.code, null);
    assert.equal(p.reason, report.reason);
    assert.equal(p.remedy, null, 'nothing to remedy - no external archive is needed');
  }
});

test('web with persistence refused: replacement is refused, with the remedy reported', async () => {
  const p = await replacementPolicy({
    probe: async () => ({ persistent: false, reason: 'Persistent storage is not granted - the browser may evict IndexedDB under storage pressure.' }),
  });
  assert.equal(p.allowed, false, 'disabled, not warned about');
  assert.equal(p.code, 'not-durable');
  assert.match(p.reason, /not granted/);
  assert.match(p.remedy, /Export a backup/i, 'the remedy names the way forward');
});

test('a probe that throws, or reports garbage, is treated as NOT durable', async () => {
  // Every way the report can fail to say `persistent: true` collapses to refusal.
  const probes = [
    async () => { throw new Error('storage API exploded'); },
    async () => undefined,
    async () => ({}),
    async () => ({ persistent: 'yes', reason: 'truthy but not true' }),
  ];
  for (const probe of probes) {
    const p = await replacementPolicy({ probe });
    assert.equal(p.allowed, false, 'never default to allowed');
    assert.equal(p.code, 'not-durable');
    assert.equal(typeof p.remedy, 'string');
  }
});

test('the default probe is the real durability(), and in an environment without StorageManager it refuses', async () => {
  // node has no navigator.storage, which is exactly the "cannot be confirmed" case: the real
  // probe must report non-persistent and the policy must refuse - the wiring, not a stand-in.
  __setBackingForTests({ kind: 'web' });
  const p = await replacementPolicy();
  assert.equal(p.allowed, false);
  assert.equal(p.code, 'not-durable');
});

/* ------------------------------------------------------------------ */
/* bindExternalArchive - what may stand in for durability              */
/* ------------------------------------------------------------------ */

test('binding retains the canonical content digest, not the envelope', async () => {
  const env = await sealedEnvelope();
  const binding = await bindExternalArchive(JSON.stringify(env));
  assert.equal(binding.contentDigest, await contentDigestOf(env),
    'the key is the COMPARABLE digest - the identity that survives re-export');
  assert.equal(binding.exportedAt, '2026-08-12T10:00:00.000Z');
  assert.equal(binding.profiles, 1);
});

test('a corrupt or tampered archive is refused at binding time', async () => {
  // Tampered user data under an intact envelope: only the recomputed digest can notice, and a
  // file that fails it is not a safety net. The refusal is readBackup's own typed error.
  const tampered = (await archiveText()).replace('"One"', '"Won"');
  await assert.rejects(() => bindExternalArchive(tampered),
    (e) => e.name === 'ImportRejected' && e.code === 'corrupt');
  await assert.rejects(() => bindExternalArchive('{not even json'),
    (e) => e.name === 'ImportRejected' && e.code === 'malformed');
});

test('a legacy single-profile file is refused as a substitute', async () => {
  // A perfectly valid legacy export - the per-profile import path accepts this shape - but one
  // profile is never authority to protect (or destroy) the whole app.
  const legacy = JSON.stringify({ app: 'compendium', schemaVersion: 11, decks: [deck('d-1', 'One')] });
  await assert.rejects(() => bindExternalArchive(legacy),
    (e) => e instanceof ReplaceRefused && e.code === 'single-profile');
});

/* ------------------------------------------------------------------ */
/* assertBoundArchiveMatches - the comparison inside the session       */
/* ------------------------------------------------------------------ */

test('a bound archive whose content matches the capture passes', async () => {
  const binding = await bindExternalArchive(await archiveText());
  const capture = await sealedEnvelope();
  await assertBoundArchiveMatches(binding, capture);   // resolves - nothing thrown
});

test('a STALE bound archive aborts: the capture differs from what the user exported', async () => {
  // THE Codex finding, replayed: the user exports and binds a backup, a write settles before the
  // session freezes the state, and the capture no longer matches the artifact. Rev 3 would have
  // called this safe; the binding to the frozen capture must abort it instead.
  const binding = await bindExternalArchive(await archiveText());
  const mutated = alpha();
  mutated.decks.push(deck('d-3', 'Settled after export'));   // the write the archive never saw
  const capture = await sealedEnvelope({ profiles: [mutated] });
  await assert.rejects(() => assertBoundArchiveMatches(binding, capture),
    (e) => e instanceof ReplaceRefused && e.code === 'stale-archive' && /Export a fresh backup/.test(e.message));
});

test('identical data exported at different times still binds and matches - the content digest is what is compared', async () => {
  // The envelope digest covers exportedAt and appBuild, so it differs between these two files by
  // construction. If the comparison ever regressed to the envelope digest, this test catches it:
  // the user would be told their perfectly current backup is stale, on every single attempt.
  const early = await sealedEnvelope({ exportedAt: '2026-08-12T10:00:00.000Z', appBuild: 213 });
  const late = await sealedEnvelope({ exportedAt: '2026-08-12T10:05:00.000Z', appBuild: 214 });
  assert.notEqual(early.integrity.digest, late.integrity.digest, 'premise: the envelope digests really differ');
  const a = await bindExternalArchive(JSON.stringify(early));
  const b = await bindExternalArchive(JSON.stringify(late));
  assert.equal(a.contentDigest, b.contentDigest, 'same data, same binding key');
  await assertBoundArchiveMatches(a, late);    // early file against the later capture
  await assertBoundArchiveMatches(b, early);   // and the reverse
});

test('no binding fails closed - the destructive step cannot proceed on a missing artifact', async () => {
  const capture = await sealedEnvelope();
  for (const binding of [undefined, null, {}, { contentDigest: '' }]) {
    await assert.rejects(() => assertBoundArchiveMatches(binding, capture),
      (e) => e instanceof ReplaceRefused && e.code === 'nothing-bound');
  }
});
