// Tests for the Gate-0 governed intake (scripts/recog/intake.mjs).
// Generates images with sharp into a temp dir (no committed binary fixtures, no real card art).
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { runIntake, splitFor } from './intake.mjs';

const jpeg = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 90, b: 40 } } }).jpeg().toBuffer();

function bed() {
  const root = mkdtempSync(join(tmpdir(), 'recog-intake-'));
  return {
    root,
    inbox: join(root, 'inbox'),
    store: join(root, 'store'),
    manifestPath: join(root, 'data', 'manifest.json'),
  };
}
async function submission(inbox, name, meta, files) {
  const dir = join(inbox, name);
  mkdirSync(dir, { recursive: true });
  for (const [fn, buf] of Object.entries(files)) writeFileSync(join(dir, fn), buf);
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
}
const okMeta = (images) => ({ sessionId: 'sess-x', device: 'Pixel 7', contributor: 'alice@example.com', consent: 'evaluate-and-train', images });

test('accepts a valid physical submission, records it, keeps PII out of the manifest', async () => {
  const b = bed();
  await submission(b.inbox, 's1', okMeta([{ file: 'a.jpg', card: 'Ghoul', medium: 'physical', tags: ['nonfoil', 'angle:flat', 'class:spell'] }]), { 'a.jpg': await jpeg(1000, 1400) });
  const res = await runIntake(b);
  assert.equal(res.accepted, 1);
  const man = JSON.parse(readFileSync(b.manifestPath, 'utf8'));
  assert.equal(man.rows.length, 1);
  const row = man.rows[0];
  assert.equal(row.card, 'Ghoul');
  assert.ok(['sealed', 'calibration'].includes(row.split));
  assert.ok(!JSON.stringify(row).includes('alice'), 'raw contributor PII must not appear');
  assert.ok(row.contributorId.startsWith('c-'));
  assert.ok(existsSync(join(b.store, `${row.imageId}.jpg`)), 'normalised image filed into the store');
});

test('rejects too-small image, bad tag, bad medium, and bad consent (fail-closed)', async () => {
  const b = bed();
  await submission(b.inbox, 'small', okMeta([{ file: 'a.jpg', card: 'X', medium: 'physical', tags: [] }]), { 'a.jpg': await jpeg(400, 560) });
  await submission(b.inbox, 'badtag', okMeta([{ file: 'a.jpg', card: 'X', medium: 'physical', tags: ['sparkly'] }]), { 'a.jpg': await jpeg(1000, 1400) });
  await submission(b.inbox, 'badmed', okMeta([{ file: 'a.jpg', card: 'X', medium: 'hologram', tags: [] }]), { 'a.jpg': await jpeg(1000, 1400) });
  await submission(b.inbox, 'noconsent', { sessionId: 's', device: 'd', contributor: 'c', consent: 'no', images: [] }, {});
  const res = await runIntake(b);
  assert.equal(res.accepted, 0);
  assert.ok(res.rejected.length >= 4);
  assert.equal(JSON.parse(readFileSync(b.manifestPath, 'utf8')).rows.length, 0);
});

test('accepts a high-resolution (~50MP) phone shot and normalises the stored long side', async () => {
  const b = bed();
  const big = await sharp({ create: { width: 6144, height: 8160, channels: 3, background: { r: 100, g: 110, b: 120 } } }).jpeg().toBuffer();
  await submission(b.inbox, 'big', okMeta([{ file: 'a.jpg', card: 'Big', medium: 'physical', tags: [] }]), { 'a.jpg': big });
  const res = await runIntake(b);
  assert.equal(res.accepted, 1);
  const row = JSON.parse(readFileSync(b.manifestPath, 'utf8')).rows[0];
  assert.ok(Math.max(row.width, row.height) <= 3000, `stored long side capped, got ${row.width}x${row.height}`);
});

test('screen medium is always the dev split, never sealed', () => {
  for (let i = 0; i < 50; i++) assert.equal(splitFor(`sess-${i}`, 'Dev', 'screen'), 'dev');
});

test('physical split is deterministic and isolated by session+device', () => {
  const a = splitFor('sess-7', 'Pixel 7', 'physical');
  assert.equal(a, splitFor('sess-7', 'Pixel 7', 'physical'));   // stable
  assert.ok(['sealed', 'calibration'].includes(a));
});

test('idempotent: re-running the same inbox does not duplicate', async () => {
  const b = bed();
  await submission(b.inbox, 's1', okMeta([{ file: 'a.jpg', card: 'Ghoul', medium: 'physical', tags: [] }]), { 'a.jpg': await jpeg(1000, 1400) });
  await runIntake(b);
  const res2 = await runIntake(b);
  assert.equal(res2.accepted, 0);
  assert.equal(res2.skipped, 1);
  assert.equal(JSON.parse(readFileSync(b.manifestPath, 'utf8')).rows.length, 1);
  assert.equal(readdirSync(b.store).length, 1);
});
