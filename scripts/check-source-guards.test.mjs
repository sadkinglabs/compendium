import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, stripComments, scanTree } from './check-source-guards.mjs';

const rules = (rel, src) => scanSource(rel, stripComments(src)).map((v) => v.rule);

// --- Canvas-method corruption -------------------------------------------------------------------

test('flags the ident.cx-<word> corruption fingerprint in JS', () => {
  const src = 'const rrect = () => x.cx-decksTo(a, b, c, d, r);';
  assert.deepEqual(rules('src/store/deckPoster.js', src), ['canvas-method-corruption']);
});

test('the corrected arcTo call is clean (mutation counterfactual)', () => {
  const src = 'const rrect = () => x.arcTo(a, b, c, d, r);';
  assert.deepEqual(rules('src/store/deckPoster.js', src), []);
});

test('CSS classes and JSX className strings are NOT corruption', () => {
  assert.deepEqual(rules('src/pillars/Decks.jsx', '<div className="cx-decks cx-app">'), []);
  assert.deepEqual(rules('src/theme/x.jsx', 'const css = ".cx-decks { color: gold }";'), []);
});

// --- Deleted cardImageUrl -----------------------------------------------------------------------

test('flags any live use of the removed cardImageUrl', () => {
  assert.deepEqual(rules('src/pillars/Home.jsx', 'const u = cardImageUrl(card);'), ['deleted-cardImageUrl']);
});

test('a comment naming cardImageUrl is stripped, not flagged', () => {
  assert.deepEqual(rules('src/store/printingRows.js', '// historically routed through cardImageUrl'), []);
});

// --- Bundled cards/ path bypass (imported formatter + dynamic template) --------------------------

test('flags a dynamic template that builds a bundled cards/ url outside cardArt.js', () => {
  const formatter = 'export const fmtArt = (base, slug) => `${base}cards/${slug}`;';   // imported-formatter shape
  assert.deepEqual(rules('src/store/printingRows.js', formatter), ['bundled-cards-path-bypass']);
});

test('Phase 5: a bundled cards/ path is flagged EVEN inside cardArt.js (no sanctioned bundled path)', () => {
  const legacy = 'export function legacyUrl(k) { return `${BASE}cards/${k}`; }';
  assert.deepEqual(rules('src/store/cardArt.js', legacy), ['bundled-cards-path-bypass']);
});

test('a quoted cards/ literal outside cardArt.js is flagged', () => {
  assert.deepEqual(rules('src/pillars/Play.jsx', "const p = base + 'cards/' + slug;"), ['bundled-cards-path-bypass']);
});

// --- artUrl outside the cache-composition boundary ----------------------------------------------

test('flags artUrl used outside cardArt.js / artCacheInstance.js', () => {
  assert.deepEqual(rules('src/components/CardArt.jsx', 'const src = artUrl(key);'), ['artUrl-outside-boundary']);
});

test('artUrl wired in the boundary instance is allowed', () => {
  assert.deepEqual(rules('src/store/artCacheInstance.js', 'const io = { remoteUrl: artUrl };'), []);
});

// --- stripComments does not eat a URL's // ------------------------------------------------------

test('stripComments keeps https:// but removes real comments', () => {
  const s = stripComments("const u = 'https://cdn.example/x'; // trailing note\n// whole line");
  assert.match(s, /https:\/\/cdn\.example\/x/);
  assert.doesNotMatch(s, /trailing note/);
  assert.doesNotMatch(s, /whole line/);
});

// --- The live tree is clean (the guard's real job) ----------------------------------------------

test('the current source tree has zero violations', () => {
  const v = scanTree();
  assert.deepEqual(v, [], `unexpected violations:\n${v.map((x) => `[${x.rule}] ${x.file}:${x.line}`).join('\n')}`);
});
