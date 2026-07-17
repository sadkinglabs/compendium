import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promote, recover, isPending, assertNoPendingPromote, readJournal, serializeJson } from './journal.mjs';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'cat-journal-'));
  const staging = join(dir, 'staging');
  const artFrom = join(staging, 'cards');
  mkdirSync(artFrom, { recursive: true });
  writeFileSync(join(artFrom, 'a.webp'), 'A');
  writeFileSync(join(artFrom, 'b.webp'), 'B');
  mkdirSync(join(staging, 'catalog'), { recursive: true });
  writeFileSync(join(staging, 'catalog', 'cards.json'), 'CARDS');
  writeFileSync(join(staging, 'version.json'), 'VERSION');
  const build = join(dir, 'build');
  const plan = {
    journalPath: join(dir, 'PROMOTE.json'),
    hash: 'deadbeef',
    artDir: { from: artFrom, to: join(build, 'public', 'cards') },
    files: [
      { from: join(staging, 'catalog', 'cards.json'), to: join(build, 'public', 'catalog', 'cards.json') },
      { from: join(staging, 'version.json'), to: join(build, 'src', 'catalogVersion.json') }, // version token LAST
    ],
  };
  return { dir, plan, build };
}

test('serializeJson is 2-space CRLF (matches the committed catalog files)', () => {
  assert.equal(serializeJson([{ a: 1 }]), '[\r\n  {\r\n    "a": 1\r\n  }\r\n]');
});

test('a clean promote installs all files and removes the journal', () => {
  const { plan, build } = scratch();
  promote(plan);
  assert.equal(readFileSync(join(build, 'public', 'cards', 'a.webp'), 'utf8'), 'A');
  assert.equal(readFileSync(join(build, 'public', 'catalog', 'cards.json'), 'utf8'), 'CARDS');
  assert.equal(readFileSync(join(build, 'src', 'catalogVersion.json'), 'utf8'), 'VERSION');
  assert.equal(existsSync(plan.journalPath), false);
  assert.equal(isPending(plan.journalPath), false);
});

test('an interrupted promote leaves a pending journal that blocks the build, and --recover finishes it from journal + staging ALONE', () => {
  const { plan, build } = scratch();
  // fail after the art phase (before JSON + version token)
  assert.throws(() => promote(plan, { failAfter: 1 }), /injected failure/);
  assert.equal(isPending(plan.journalPath), true);
  assert.throws(() => assertNoPendingPromote(plan.journalPath), /MIXED catalog/);
  // version token never appeared, so the seed would not have re-triggered
  assert.equal(existsSync(join(build, 'src', 'catalogVersion.json')), false);
  // recover from ONLY the journal path (no plan object) - as the orchestrator's
  // --recover branch really calls it in a fresh process. It must rebuild the plan
  // from the journal's recorded from->to pairs + the retained staging on disk.
  const res = recover(plan.journalPath);
  assert.equal(res.recovered, true);
  // every target file actually landed, not just the journal cleared
  assert.equal(readFileSync(join(build, 'public', 'cards', 'a.webp'), 'utf8'), 'A');
  assert.equal(readFileSync(join(build, 'public', 'catalog', 'cards.json'), 'utf8'), 'CARDS');
  assert.equal(readFileSync(join(build, 'src', 'catalogVersion.json'), 'utf8'), 'VERSION');
  assert.equal(isPending(plan.journalPath), false);
});

test('assertNoPendingPromote passes when the journal is absent or complete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cat-journal-'));
  const jp = join(dir, 'PROMOTE.json');
  assert.doesNotThrow(() => assertNoPendingPromote(jp));      // absent
  writeFileSync(jp, JSON.stringify({ status: 'complete' }));
  assert.doesNotThrow(() => assertNoPendingPromote(jp));      // complete
  assert.equal(readJournal(jp).status, 'complete');
  rmSync(dir, { recursive: true, force: true });
});
