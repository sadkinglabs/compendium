// Migrations must be DDL. exec() cannot run a query.
//
// This exists because v11 shipped `SELECT 1;` as a harmless no-op and bricked boot on device:
// exec() maps to Android's execSQL(), which refuses queries - "Queries cannot be performed
// using execSQL(), use query() instead." Every gate passed, because the web backend is sql.js
// and its run() accepts a SELECT without complaint. Nothing we run exercises the native
// splitter, so the difference between the two backends is invisible until an install.
// Run: npm run test:query
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';

// Statement heads exec() cannot carry - anything that returns rows rather than changing shape.
// `values` is here because `VALUES (1);` is a row source in its own right, not just a clause.
const QUERY_STARTS = ['select', 'with ', 'explain', 'values'];

// Strip BOTH comment forms before classifying. Line comments only was a real gap: a block
// comment moves the query keyword off the start of the string, so `/* x */ SELECT 1` began with
// `/` and slipped past the detector - the exact kind of "looks like DDL" the guard is for.
const statementsOf = (sql) => String(sql)
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/--[^\r\n]*/g, '')         // line comments
  .split(';')
  .map((x) => x.trim())
  .filter(Boolean);

// PRAGMA is only safe in ASSIGNMENT form (`PRAGMA foreign_keys = ON`), which sets a value.
// The bare form (`PRAGMA foreign_keys`) READS it and returns a row, so exec() rejects it exactly
// as it rejects a SELECT. Distinguish by the presence of `=`.
const isForbidden = (stmt) => {
  const head = stmt.toLowerCase();
  if (head.startsWith('pragma')) return !head.includes('=');
  return QUERY_STARTS.some((q) => head.startsWith(q));
};

test('no migration contains a statement exec() cannot run', () => {
  const problems = [];
  for (const m of MIGRATIONS) {
    for (const stmt of statementsOf(m.sql)) {
      if (isForbidden(stmt)) problems.push(`migration ${m.version}: ${stmt.slice(0, 60)}`);
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('the check can fail, and it is not fooled by comments or VALUES', () => {
  // Guarding the guard, because this whole class of bug is "it looked fine".
  assert.equal(isForbidden(statementsOf('SELECT 1;')[0]), true, 'a bare SELECT is caught');
  assert.equal(isForbidden(statementsOf('/* harmless */ SELECT 1;')[0]), true, 'a block comment does not hide it');
  assert.equal(isForbidden(statementsOf('VALUES (1);')[0]), true, 'a VALUES row source is caught');
  assert.equal(isForbidden(statementsOf('PRAGMA foreign_keys;')[0]), true, 'the row-returning PRAGMA form is caught');

  // ...and real DDL is NOT flagged.
  assert.equal(isForbidden('PRAGMA foreign_keys = ON'), false, 'assignment PRAGMA is allowed');
  assert.equal(isForbidden('CREATE INDEX IF NOT EXISTS x ON t(a)'), false);
  assert.equal(isForbidden('ALTER TABLE t ADD COLUMN c TEXT'), false);
  assert.equal(isForbidden('INSERT OR REPLACE INTO _meta(key,value) VALUES(?,?)'), false, 'INSERT ... VALUES is not a VALUES row source');
});

test('every migration is idempotent in shape', () => {
  // runMigrations tolerates only "duplicate column" and "already exists" on re-run, so any
  // CREATE must say IF NOT EXISTS or a retry after a crash cannot get past it.
  const problems = [];
  for (const m of MIGRATIONS) {
    for (const stmt of statementsOf(m.sql)) {
      const head = stmt.toLowerCase();
      if (/^create (table|index|unique index|view|trigger)/.test(head) && !head.includes('if not exists')) {
        problems.push(`migration ${m.version}: ${stmt.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('SCHEMA_VERSION matches the highest migration', () => {
  assert.equal(SCHEMA_VERSION, Math.max(...MIGRATIONS.map((m) => m.version)));
});
