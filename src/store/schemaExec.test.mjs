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

// Statements exec() cannot carry. SELECT is the one that actually bit; the others are the same
// class - anything that returns rows rather than changing shape.
const QUERY_STARTS = ['select', 'pragma ', 'with ', 'explain'];

const statementsOf = (sql) => String(sql)
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))          // strip line comments
  .join('\n')
  .split(';')
  .map((x) => x.trim())
  .filter(Boolean);

test('no migration contains a statement exec() cannot run', () => {
  const problems = [];
  for (const m of MIGRATIONS) {
    for (const stmt of statementsOf(m.sql)) {
      const head = stmt.toLowerCase();
      // PRAGMA foreign_keys is a setting, not a query, and has always run fine here.
      if (head.startsWith('pragma foreign_keys')) continue;
      if (QUERY_STARTS.some((q) => head.startsWith(q))) {
        problems.push(`migration ${m.version}: ${stmt.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('the check can fail - it is not vacuous', () => {
  // Guarding the guard, because this whole class of bug is "it looked fine".
  const fake = statementsOf('SELECT 1;');
  assert.equal(fake.length, 1);
  assert.ok(QUERY_STARTS.some((q) => fake[0].toLowerCase().startsWith(q)), 'a bare SELECT is caught');
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
