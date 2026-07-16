import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSupportedWidget, filterImportedBlocks, filterLayoutBlocks, shouldMarkDashboardSeeded,
} from './widgetRegistry.js';

// The dashboard ingress guard: retired widget types (e.g. 'highlights' after v10) must be
// rejected everywhere a block can enter (import blocks, imported/saved layout snapshots,
// listBlocks, loadLayout), while aliased legacy kinds still resolve to a live widget. These
// are the pure helpers those call sites apply - tested here without a database.

/* ---- the predicate ---- */

test('a defined widget kind is supported', () => {
  assert.equal(isSupportedWidget('notes'), true);
  assert.equal(isSupportedWidget('winRate'), true);
  assert.equal(isSupportedWidget('title'), true);      // structural block
  assert.equal(isSupportedWidget('separator'), true);
});

test('a retired widget kind is NOT supported', () => {
  assert.equal(isSupportedWidget('highlights'), false);
});

test('an aliased legacy kind resolves to its survivor and is supported', () => {
  assert.equal(isSupportedWidget('errata'), true);   // ALIAS: errata -> notes
  assert.equal(isSupportedWidget('saved'), true);    // ALIAS: saved -> pinned
  assert.equal(isSupportedWidget('urls'), true);     // ALIAS: urls -> links
});

test('an unknown kind is NOT supported', () => {
  assert.equal(isSupportedWidget('nonsense'), false);
  assert.equal(isSupportedWidget(''), false);
  assert.equal(isSupportedWidget(undefined), false);
});

/* ---- filterImportedBlocks: import blocks + listBlocks + loadLayout all route through this ---- */

test('imported live highlights blocks are dropped', () => {
  const out = filterImportedBlocks([{ type: 'highlights' }, { type: 'notes' }, { type: 'highlights' }]);
  assert.deepEqual(out.map((b) => b.type), ['notes']);
});

test('mixed imports retain supported and aliased blocks, drop only the retired', () => {
  const out = filterImportedBlocks([
    { type: 'notes' }, { type: 'errata' }, { type: 'highlights' }, { type: 'winRate' },
  ]);
  assert.deepEqual(out.map((b) => b.type), ['notes', 'errata', 'winRate']);
});

test('filterImportedBlocks tolerates null/undefined and typeless blocks', () => {
  assert.deepEqual(filterImportedBlocks(null), []);
  assert.deepEqual(filterImportedBlocks(undefined), []);
  assert.deepEqual(filterImportedBlocks([{}, { type: 'highlights' }]), []);
});

/* ---- filterLayoutBlocks: imported layout snapshots (JSON text) ---- */

test('an imported layout snapshot drops unsupported entries', () => {
  const snapshot = JSON.stringify([{ type: 'notes' }, { type: 'highlights' }, { type: 'title' }]);
  const kept = JSON.parse(filterLayoutBlocks(snapshot));
  assert.deepEqual(kept.map((b) => b.type), ['notes', 'title']);
});

test('a highlights-only layout snapshot filters to an empty array', () => {
  assert.equal(filterLayoutBlocks(JSON.stringify([{ type: 'highlights' }])), '[]');
});

test('filterLayoutBlocks returns non-array or unparseable input unchanged', () => {
  assert.equal(filterLayoutBlocks('{"not":"an array"}'), '{"not":"an array"}');
  assert.equal(filterLayoutBlocks('not json at all'), 'not json at all');
});

/* ---- shouldMarkDashboardSeeded: the highlights-only-dashboard outcome ---- */

test('a highlights-only imported dashboard is left UNSEEDED (so first load seeds defaults)', () => {
  const bundleBlocks = [{ type: 'highlights' }];
  const imported = filterImportedBlocks(bundleBlocks);   // -> []
  assert.equal(shouldMarkDashboardSeeded(bundleBlocks, imported), false);
});

test('a deliberately-empty dashboard is marked seeded (kept empty, not repopulated)', () => {
  assert.equal(shouldMarkDashboardSeeded([], []), true);
  assert.equal(shouldMarkDashboardSeeded(undefined, []), true);
});

test('a partly-supported dashboard is marked seeded (faithful restore)', () => {
  const bundleBlocks = [{ type: 'notes' }, { type: 'highlights' }];
  const imported = filterImportedBlocks(bundleBlocks);   // -> [{notes}]
  assert.equal(shouldMarkDashboardSeeded(bundleBlocks, imported), true);
});
