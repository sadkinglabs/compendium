import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// REAL-CORPUS CONTRACT: every content-addressed art key the SHIPPED catalog references must resolve
// to an entry in the SHIPPED manifest. This is the executable proof that the Phase-2 activation is
// wired end to end - a card or variant pointing at a key the manifest cannot describe would fall
// back forever at runtime with every other gate still green. Runs against public/catalog, not a
// fixture, so it fails the moment cards.json and art-manifest.json drift out of lockstep.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cards = JSON.parse(readFileSync(join(ROOT, 'public', 'catalog', 'cards.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'catalog', 'art-manifest.json'), 'utf8'));

const manifestKeys = new Set(Object.values(manifest.objects || {}).map((o) => o.key));

// Every non-null `image` on a card and on each of its variants.
function* artKeys() {
  for (const card of Object.values(cards)) {
    if (card.image) yield [card.name, 'card', card.image];
    for (const v of card.variants || []) if (v.image) yield [card.name, v.slug || v.set, v.image];
  }
}

test('the shipped manifest is non-trivial and content-addressed', () => {
  assert.ok(manifestKeys.size > 2000, `expected the full corpus, got ${manifestKeys.size}`);
  for (const k of manifestKeys) { assert.match(k, /\.[0-9a-f]{64}\.webp$/, `key is content-addressed: ${k}`); break; }
});

test('every card/variant art key in cards.json resolves to a shipped manifest entry', () => {
  const missing = [];
  let checked = 0;
  for (const [name, where, key] of artKeys()) {
    checked++;
    if (!manifestKeys.has(key)) missing.push(`${name} [${where}] -> ${key}`);
  }
  assert.ok(checked > 2000, `expected to check the full corpus, checked ${checked}`);
  assert.deepEqual(missing, [], `unresolved art keys (${missing.length}):\n${missing.slice(0, 20).join('\n')}`);
});
