import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover } from './discover.mjs';

function drop(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cat-drop-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('classifies CSVs by header regardless of file name, and finds PNGs recursively', () => {
  const dir = drop({
    'codex-16 Jul 2026.csv': 'title,content,subcodexes\r\nA,B,\r\n',
    'faq-xyz.csv': 'card name,question,answer\r\nX,Y,Z\r\n',
    'Card Images high res/001-foo-b-s.png': 'PNG',
    'Card Images high res/nested/002-bar-b-s.png': 'PNG',
  });
  const d = discover(dir);
  assert.match(d.rulesCsv, /codex-16 Jul 2026\.csv$/);
  assert.match(d.faqCsv, /faq-xyz\.csv$/);
  assert.deepEqual(d.pngNames.sort(), ['001-foo-b-s.png', '002-bar-b-s.png']);
  rmSync(dir, { recursive: true, force: true });
});

test('two CSVs with the same header is a named failure, not a guess', () => {
  const dir = drop({
    'a.csv': 'title,content,subcodexes\r\nA,B,\r\n',
    'b.csv': 'title,content,subcodexes\r\nC,D,\r\n',
  });
  assert.throws(() => discover(dir), /two rules CSVs/);
  rmSync(dir, { recursive: true, force: true });
});

test('an absent input is legal (null), not an error', () => {
  const dir = drop({ 'faq.csv': 'card name,question,answer\r\nX,Y,Z\r\n' });
  const d = discover(dir);
  assert.equal(d.rulesCsv, null);
  assert.ok(d.faqCsv);
  rmSync(dir, { recursive: true, force: true });
});
