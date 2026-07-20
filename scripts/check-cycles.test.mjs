// Tests for the circular-import gate.
//
// The gate's whole value is that it FAILS on a cycle, so the tests that matter are the ones
// proving it detects each shape - a two-module cycle, a longer ring, a self-import, and two
// independent cycles at once. A gate that only ever passes is indistinguishable from no gate,
// which is a lesson this repo learned the expensive way.
//
// Pure: the graph is built from an in-memory file map, so nothing touches disk.
// Run: npm run check:cycles
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildGraph, findCycles, resolveSpecifier, run, formatCycles } from './check-cycles.mjs';

const DIR = path.resolve('/proj/src');
const f = (name) => path.join(DIR, name);

/** Build a graph from { 'a.js': "import './b.js'" } without touching disk. */
function graphOf(files) {
  const abs = Object.fromEntries(Object.entries(files).map(([k, v]) => [f(k), v]));
  return buildGraph(Object.keys(abs), (p) => abs[p]);
}

test('a clean graph has no cycles', () => {
  const g = graphOf({
    'a.js': "import { x } from './b.js';",
    'b.js': "import { y } from './c.js';",
    'c.js': "export const y = 1;",
  });
  assert.deepEqual(findCycles(g), []);
});

test('detects a two-module cycle', () => {
  // The exact shape that shipped: ui.jsx <-> GothicSheet.jsx.
  const g = graphOf({
    'ui.jsx': "import Sheet from './sheet.jsx';",
    'sheet.jsx': "import { useTrap } from './ui.jsx';",
  });
  const cycles = findCycles(g);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].map((p) => path.basename(p)).sort(), ['sheet.jsx', 'ui.jsx']);
});

test('detects a longer ring', () => {
  const g = graphOf({
    'a.js': "import './b.js';",
    'b.js': "import './c.js';",
    'c.js': "import './a.js';",
  });
  assert.equal(findCycles(g).length, 1);
  assert.equal(findCycles(g)[0].length, 3);
});

test('detects TWO independent cycles, not just the first reachable one', () => {
  // The bug in this gate's own first draft: a global visited set found one cycle and
  // reported the graph clean while a second was still live.
  const g = graphOf({
    'a.js': "import './b.js';",
    'b.js': "import './a.js';",
    'x.js': "import './y.js';",
    'y.js': "import './x.js';",
  });
  assert.equal(findCycles(g).length, 2);
});

test('detects a cycle reachable only through an already-visited module', () => {
  const g = graphOf({
    'entry.js': "import './a.js';\nimport './b.js';",
    'a.js': "import './b.js';",
    'b.js': "import './c.js';",
    'c.js': "import './b.js';",
  });
  const cycles = findCycles(g);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0].map((p) => path.basename(p)).sort(), ['b.js', 'c.js']);
});

test('detects a self-import', () => {
  const g = graphOf({ 'a.js': "import './a.js';" });
  assert.equal(findCycles(g).length, 1);
});

test('`export ... from` is an edge - it forces the target to evaluate', () => {
  const g = graphOf({
    'ui.jsx': "export { useTrap } from './sheet.jsx';",
    'sheet.jsx': "import { x } from './ui.jsx';",
  });
  assert.equal(findCycles(g).length, 1);
});

test('dynamic import() is NOT an edge - it defers evaluation', () => {
  // Lazy routes legitimately point back at shared code; treating that as a cycle would make
  // the gate unusable and train people to ignore it.
  const g = graphOf({
    'app.jsx': "const C = lazy(() => import('./collection.jsx'));",
    'collection.jsx': "import { thing } from './app.jsx';",
  });
  assert.deepEqual(findCycles(g), []);
});

test('imports outside the scanned set are ignored, not crashed on', () => {
  const g = graphOf({ 'a.js': "import React from 'react';\nimport './missing.js';" });
  assert.deepEqual(findCycles(g), []);
});

test('a side-effect import is still an edge', () => {
  const g = graphOf({
    'a.js': "import './b.js';",
    'b.js': "import './a.js';",
  });
  assert.equal(findCycles(g).length, 1);
});

test('the report names the offending edges', () => {
  const g = graphOf({
    'ui.jsx': "import './sheet.jsx';",
    'sheet.jsx': "import './ui.jsx';",
  });
  const text = formatCycles(findCycles(g), g, path.resolve('/proj'));
  assert.match(text, /src\/ui\.jsx -> src\/sheet\.jsx/);
  assert.match(text, /src\/sheet\.jsx -> src\/ui\.jsx/);
});

test('run() exits non-zero on a cycle and zero when clean', () => {
  const files = { 'a.js': "import './b.js';", 'b.js': "import './a.js';" };
  const abs = Object.fromEntries(Object.entries(files).map(([k, v]) => [f(k), v]));
  assert.equal(run({ files: Object.keys(abs), read: (p) => abs[p] }), 1);

  const clean = { [f('a.js')]: "export const x = 1;" };
  assert.equal(run({ files: Object.keys(clean), read: (p) => clean[p] }), 0);
});

test('run() FAILS CLOSED when the scan finds nothing', () => {
  // An empty list means the walker broke, not that the tree is clean. Reporting green there
  // would be the worst possible failure for a gate.
  assert.equal(run({ files: [], read: () => '' }), 1);
});

test('resolveSpecifier tries extensionless, .js and .jsx like the bundler', () => {
  const present = new Set([path.join(DIR, 'b.jsx')]);
  assert.equal(resolveSpecifier(f('a.js'), './b', (p) => present.has(p)), path.join(DIR, 'b.jsx'));
  assert.equal(resolveSpecifier(f('a.js'), './nope', () => false), null);
});
