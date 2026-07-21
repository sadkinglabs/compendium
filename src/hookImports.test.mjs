// Every React hook a component USES must be IMPORTED.
//
// This exists because a missing `useReducer` import shipped through every gate. Vite resolves
// the module graph, not identifier scope, so `build` happily compiled a file that threw
// `ReferenceError: useReducer is not defined` the moment the sheet opened. Types and cycles are
// equally blind to it. Nothing we run catches a bare undefined identifier in a component, so
// this does.
//
// The cause is worth recording: a patch targeted `{ useState, useEffect, useRef }` while the
// file actually said `{ useEffect, useState, useRef }`, so the edit silently did nothing and
// the call was added without its import. An anchored edit that misses is a no-op, and a no-op
// is invisible - which is why the check has to be on the result, not on the edit.
// Run: npm run test:app
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HOOKS = [
  'useState', 'useEffect', 'useRef', 'useReducer', 'useMemo', 'useCallback',
  'useLayoutEffect', 'useContext', 'useId', 'useTransition', 'useDeferredValue',
  'useImperativeHandle', 'useSyncExternalStore',
];

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const WORD = /[A-Za-z0-9_$]/;
const isWordChar = (ch) => ch !== undefined && WORD.test(ch);

// Deliberately scanned rather than pattern-matched. The first version of this file was written
// through a shell heredoc that ate its backslashes, leaving a pattern that did not compile -
// the same class of silent mangling this check exists to catch.
function callsBare(src, name) {
  let i = src.indexOf(name);
  while (i !== -1) {
    const before = src[i - 1];
    const after = src.slice(i + name.length).trimStart()[0];
    // A call, not a property access (React.useState) and not part of a longer identifier.
    if (before !== '.' && !isWordChar(before) && after === '(') return true;
    i = src.indexOf(name, i + 1);
  }
  return false;
}

function reactNamedImports(src) {
  const named = new Set();
  const NEEDLE = "from 'react'";
  let i = src.indexOf(NEEDLE);
  while (i !== -1) {
    const open = src.lastIndexOf('{', i);
    const close = src.lastIndexOf('}', i);
    if (open !== -1 && close > open) {
      for (const part of src.slice(open + 1, close).split(',')) {
        const name = part.trim().split(' as ')[0].trim();
        if (name) named.add(name);
      }
    }
    i = src.indexOf(NEEDLE, i + 1);
  }
  return named;
}

const files = walk('src').filter((f) => f.endsWith('.jsx'));

test('every hook called in a .jsx file is imported there', () => {
  assert.ok(files.length > 5, `the sweep found component files, saw ${files.length}`);
  const problems = [];

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const named = reactNamedImports(src);
    for (const hook of HOOKS) {
      if (callsBare(src, hook) && !named.has(hook)) {
        problems.push(`${file}: calls ${hook}() without importing it`);
      }
    }
  }

  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('the check can actually fail - it is not vacuous', () => {
  // A guard that cannot fail is worse than none: it reports safety it never measured.
  const bad = "import React, { useState } from 'react';\nfunction C() { const [a, b] = useReducer(r, {}); }";
  assert.equal(callsBare(bad, 'useReducer'), true, 'a bare call is detected');
  assert.equal(reactNamedImports(bad).has('useReducer'), false, 'and it is not imported');

  const good = "import React, { useReducer } from 'react';\nfunction C() { useReducer(r, {}); }";
  assert.equal(reactNamedImports(good).has('useReducer'), true);
});

test('a property access is not a bare call', () => {
  assert.equal(callsBare('React.useReducer(r, {})', 'useReducer'), false);
  assert.equal(callsBare('const myUseReducer = 1; myUseReducer(2)', 'useReducer'), false);
});
