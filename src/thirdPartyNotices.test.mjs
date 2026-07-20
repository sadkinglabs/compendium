// The notice obligation is binding, so it is enforced rather than trusted: if the shipped
// notices and the repo-root mirror drift apart, this fails. Run: npm run test:app
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THIRD_PARTY_NOTICES, noticesText } from './thirdPartyNotices.js';

const root = readFileSync(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url), 'utf8');

test('every shipped notice appears in full in THIRD-PARTY-NOTICES.md', () => {
  for (const n of THIRD_PARTY_NOTICES) {
    assert.ok(root.includes(n.text), `${n.id}: full licence text missing from the root mirror`);
    assert.ok(root.includes(n.source), `${n.id}: source URL missing from the root mirror`);
  }
});

test('each notice carries a copyright line and the permission clause MIT requires', () => {
  for (const n of THIRD_PARTY_NOTICES) {
    assert.match(n.text, /Copyright \(c\) \S/, `${n.id}: no copyright holder`);
    assert.ok(n.text.includes('shall be included in all'), `${n.id}: permission notice missing`);
    assert.ok(n.author && n.source && n.retrieved, `${n.id}: provenance incomplete`);
  }
});

test('the rendered document is non-empty and includes provenance', () => {
  const doc = noticesText();
  assert.ok(doc.length > 500);
  assert.ok(doc.includes('Retrieved:'));
});
