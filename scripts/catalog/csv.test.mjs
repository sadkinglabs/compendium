import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvWithHeader } from './csv.mjs';

test('parses quoted fields with embedded commas and newlines', () => {
  const rows = parseCsv('a,b,c\r\n"has, comma","has\nnewline",plain');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['has, comma', 'has\nnewline', 'plain']]);
});

test('handles escaped double-quotes and a leading BOM', () => {
  const rows = parseCsv('﻿"say ""hi""",x');
  assert.deepEqual(rows, [['say "hi"', 'x']]);
});

test('tolerates LF, CRLF, and a missing final newline', () => {
  assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('a,b\r\nc,d\r\n'), [['a', 'b'], ['c', 'd']]);
});

test('an empty trailing field is preserved', () => {
  assert.deepEqual(parseCsv('a,'), [['a', '']]);
});

test('throws on an unterminated quote', () => {
  assert.throws(() => parseCsv('"open,field'), /unterminated/);
});

test('parseCsvWithHeader asserts the expected header (case-insensitive)', () => {
  const { rows } = parseCsvWithHeader('Title,Content,Subcodexes\r\nT,C,S', ['title', 'content', 'subcodexes']);
  assert.deepEqual(rows, [['T', 'C', 'S']]);
  assert.throws(() => parseCsvWithHeader('a,b\n1,2', ['title', 'content', 'subcodexes'], 'rules CSV'), /unexpected header/);
});
