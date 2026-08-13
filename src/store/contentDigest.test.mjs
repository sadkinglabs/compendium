// The canonical content digest - "do these two archives describe the same data?"
// Run: npm run test:query
//
// The envelope digest cannot answer that question: its preimage includes exportedAt and appBuild,
// so two backups of identical data taken minutes apart hash differently by construction. These
// tests pin the property Increment 3 depends on - equal data compares equal, across capture time,
// SQL row order and unit order - and that unequal data never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelope, seal, contentDigestOf, contentPreimage } from './backup.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const deck = (id, name) => ({ id, name, created_at: '2026-01-01', updated_at: '2026-01-01' });
const owned = (id, cardId, qty) => ({ id, card_id: cardId, variant_slug: '004', qty_owned: qty });

function unit(name, { isDefault = 0, decks = [], owned_cards = [] } = {}) {
  return {
    profile: {
      name, avatar: null, accent: 'gold', system: 'sorcery', is_default: isDefault ? 1 : 0,
      created_at: '2026-01-01', updated_at: '2026-01-01',
    },
    dashSeeded: true,
    decks, owned_cards,
    deck_entries: [], deck_history: [], saved: [], notes: [], collections: [],
    collection_items: [], card_lists: [], card_list_entries: [], links: [], matches: [],
    match_log_entries: [], dashboard_blocks: [], dashboard_layouts: [],
    resume: null, settings: null,
  };
}

const alpha = () => unit('Alpha', {
  isDefault: 1,
  decks: [deck('d-1', 'One'), deck('d-2', 'Two')],
  owned_cards: [owned('oc-1', 'sentinel_card', 3), owned('oc-2', 'other_card', 1)],
});
const beta = () => unit('Beta', { decks: [deck('d-3', 'Three')] });

async function sealedEnvelope({ profiles, activeProfileIndex = 0, exportedAt = '2026-08-12T10:00:00.000Z', appBuild = 213, changelogSeenBuild = 200 } = {}) {
  return seal(buildEnvelope({
    schemaVersion: 11, appBuild, exportedAt,
    appGlobal: { activeProfileIndex, changelogSeenBuild },
    profiles,
  }));
}

/* ------------------------------------------------------------------ */

test('identical data captured at different times produces the same content digest', async () => {
  const a = await sealedEnvelope({ profiles: [alpha(), beta()], exportedAt: '2026-08-12T10:00:00.000Z', appBuild: 213 });
  const b = await sealedEnvelope({ profiles: [alpha(), beta()], exportedAt: '2026-08-12T10:05:00.000Z', appBuild: 214 });
  // The premise first: the ENVELOPE digests really do differ, which is why this digest must exist.
  assert.notEqual(a.integrity.digest, b.integrity.digest, 'envelope digests cover volatile fields');
  assert.equal(await contentDigestOf(a), await contentDigestOf(b));
});

test('identical data in a different SQL row order produces the same content digest', async () => {
  // Codex's flag at approval: row order is an accident of storage, and an unsorted digest would
  // report a safe but frustrating false mismatch. Reverse every collection AND swap unit order,
  // keeping activeProfileIndex pointed at the same logical profile (Alpha).
  const ordered = await sealedEnvelope({ profiles: [alpha(), beta()], activeProfileIndex: 0 });
  const shuffledAlpha = alpha();
  shuffledAlpha.decks.reverse();
  shuffledAlpha.owned_cards.reverse();
  const shuffled = await sealedEnvelope({ profiles: [beta(), shuffledAlpha], activeProfileIndex: 1 });
  assert.equal(await contentDigestOf(ordered), await contentDigestOf(shuffled));
});

test('different data produces a different digest', async () => {
  const a = await sealedEnvelope({ profiles: [alpha()] });
  const changed = alpha();
  changed.owned_cards[0].qty_owned = 4;   // one copy more of one card
  const b = await sealedEnvelope({ profiles: [changed] });
  assert.notEqual(await contentDigestOf(a), await contentDigestOf(b));
});

test('the active profile is part of the data - same rows, different active profile, different digest', async () => {
  const activeAlpha = await sealedEnvelope({ profiles: [alpha(), beta()], activeProfileIndex: 0 });
  const activeBeta = await sealedEnvelope({ profiles: [alpha(), beta()], activeProfileIndex: 1 });
  assert.notEqual(await contentDigestOf(activeAlpha), await contentDigestOf(activeBeta));
});

test('changelogSeenBuild is excluded - reading the release notes does not change the data', async () => {
  const before = await sealedEnvelope({ profiles: [alpha()], changelogSeenBuild: 200 });
  const after = await sealedEnvelope({ profiles: [alpha()], changelogSeenBuild: 213 });
  assert.equal(await contentDigestOf(before), await contentDigestOf(after));
});

test('an absent collection and an empty collection are the same data', async () => {
  const explicit = alpha();
  const sparse = alpha();
  delete sparse.saved;
  delete sparse.matches;
  const a = await sealedEnvelope({ profiles: [explicit] });
  const b = await sealedEnvelope({ profiles: [sparse] });
  assert.equal(await contentDigestOf(a), await contentDigestOf(b));
});

test('the preimage is pure and deterministic', () => {
  const env = { schemaVersion: 11, payload: { appGlobal: { activeProfileIndex: 0 }, profiles: [alpha(), beta()] } };
  assert.deepEqual(contentPreimage(env), contentPreimage(env));
  // And it does not mutate its input - the caller's envelope keeps its own row order.
  const before = JSON.stringify(env);
  contentPreimage(env);
  assert.equal(JSON.stringify(env), before);
});
