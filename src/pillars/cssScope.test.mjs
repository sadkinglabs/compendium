// Guard: JSX must emit the canonical pillar styling scopes, never the pre-purge
// spellings they replaced.
// Run: npm run test:ui   (node --test)
//
// Why this exists: commit 3ee4a35 renamed three scope classes in the theme CSS -
//   .arc     -> .cx-decks           (arcanum.css -> decks.css)
//   .mh      -> .cx-match-history   (playhistory.css)
//   .vc-root -> .cx-life-tracker    (counter.css)
// - and left JSX still emitting two of the old names: ten `arc` call sites and one
// `mh`. Nothing defines the old classes any more, so those classNames became inert
// strings and every rule under the scope silently stopped matching. The FAB, its
// scrim, badge and menu fell back to UA defaults (white squares) on every pillar,
// and the whole Play hub rendered as raw unstyled text.
//
// Nothing caught it: a className is just a string, so the build passed, the types
// passed, and every other test passed. Only a human looking at the screen noticed -
// and only for the FAB; the Play hub went unnoticed for two days. This is the check
// that would have caught both at once.
//
// All three old names are guarded, not just the one that was reported: `mh` proves
// that fixing the reported symptom alone leaves the same bug live elsewhere.
//
// It lives here rather than in a lint config because `test:ui` is already a
// required gate (AGENTS.md §5), so it cannot be skipped by following the process.
//
// Scope of the scan: production source only. `*.test.mjs` is excluded so this
// file's own fixtures cannot trip it - and, belt and braces, the fixtures are
// assembled at runtime from parts, so no literal `className="arc"` exists in this
// source for the scanner to find even if that exclusion were removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Exactly the scopes 3ee4a35 renamed. Verify with:
//   git show 3ee4a35 -- 'src/theme/*.css' | rg '^[-+]\.[a-z]'
const RENAMED = { arc: 'cx-decks', mh: 'cx-match-history', 'vc-root': 'cx-life-tracker' };
const OBSOLETE = 'arc';          // the reported one, used by the fixtures below
const CANONICAL = RENAMED.arc;

// className="…" | className='…' | className={`…`} | className={"…"} | bodyClass="…"
const CLASS_ATTR = /\b(?:className|bodyClass)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/g;

/**
 * Every class token an attribute value can contribute. Only attribute VALUES are
 * read, which is what keeps prose out: a comment about a geometric arc, or a
 * variable named `arc`, never reaches here.
 */
function classTokens(source) {
  const out = [];
  for (const m of source.matchAll(CLASS_ATTR)) {
    const value = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    for (const token of value.split(/\s+/)) if (token) out.push(token);
  }
  return out;
}

/**
 * Exact-token match, so `arc-chart` is a different class and prose never counts -
 * only whole class tokens inside a class attribute reach here.
 */
export function findObsoleteScope(source, obsolete = Object.keys(RENAMED)) {
  const bad = new Set([].concat(obsolete));
  return classTokens(source).filter((t) => bad.has(t));
}

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { found.push(...sourceFiles(full)); continue; }
    if (!/\.(jsx|js)$/.test(entry.name)) continue;   // .test.mjs excluded by extension
    found.push(full);
  }
  return found;
}

test('no JSX emits a pre-purge styling scope', () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    for (const found of findObsoleteScope(readFileSync(file, 'utf8'))) {
      offenders.push(`${path.relative(SRC, file).replace(/\\/g, '/')}: \`${found}\` -> use \`${RENAMED[found]}\``);
    }
  }
  assert.deepEqual(offenders, [],
    'These emit a scope class no CSS defines, so their styling silently does not apply:\n  '
    + offenders.join('\n  '));
});

// --- the guard is itself tested -----------------------------------------------
// Fixtures are built from parts so this file contains no literal class attribute
// carrying the obsolete token.
const attr = (name, value) => `<div ${name}="${value}" />`;
const tpl = (value) => '<div className={`' + value + '`} />';

test('catches a static className', () => {
  assert.deepEqual(findObsoleteScope(attr('className', OBSOLETE)), [OBSOLETE]);
});

test('catches a compound class value', () => {
  assert.deepEqual(findObsoleteScope(attr('className', `${OBSOLETE} dpager`)), [OBSOLETE]);
});

test('catches a template-literal class value, interpolations and all', () => {
  assert.deepEqual(findObsoleteScope(tpl(OBSOLETE + ' fab-wrap fab-enter fab-${variant}')), [OBSOLETE]);
});

test('catches bodyClass', () => {
  assert.deepEqual(findObsoleteScope(attr('bodyClass', OBSOLETE)), [OBSOLETE]);
});

test('allows prose and comments - "arc" is an ordinary English word', () => {
  assert.deepEqual(findObsoleteScope('// centred so the fan reads as a clean arc, not a jagged pile'), []);
  assert.deepEqual(findObsoleteScope('const arcLength = r * theta;   // arc'), []);
  assert.deepEqual(findObsoleteScope('<p>Cards fan out along an arc.</p>'), []);
});

test('allows the canonical scope and unrelated arc-prefixed classes', () => {
  assert.deepEqual(findObsoleteScope(attr('className', `${CANONICAL} fab-wrap`)), []);
  assert.deepEqual(findObsoleteScope(attr('className', 'arc-chart arcade')), []);
});

test('catches every scope the purge renamed, not just the reported one', () => {
  // `mh` was live in Play.jsx for two days after `arc` was reported, because only
  // the reported symptom was looked for. Guarding one name would allow that again.
  for (const [old, canonical] of Object.entries(RENAMED)) {
    assert.deepEqual(findObsoleteScope(attr('className', old)), [old], `${old} must be rejected`);
    assert.deepEqual(findObsoleteScope(attr('className', canonical)), [], `${canonical} must be allowed`);
  }
});

test('the Fab carries the canonical scope on every pillar, not just Decks', () => {
  // The FAB is the app's interaction spine and its shell lives in decks.css, so the
  // scope rides it app-wide. If this ever stops being true, the FAB is unstyled.
  const fab = readFileSync(path.join(SRC, 'components', 'Fab.jsx'), 'utf8');
  assert.match(fab, new RegExp(`SCOPE\\s*=\\s*'${CANONICAL}'`), 'Fab must declare the canonical scope');
  assert.match(fab, /import\s+'\.\.\/theme\/decks\.css'/, 'Fab must import the stylesheet it depends on');
});
