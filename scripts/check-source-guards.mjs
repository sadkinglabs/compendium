// Static source guards for two failure classes the type checker and build cannot see:
//
//  1. CANVAS-METHOD CORRUPTION - a find/replace once rewrote real canvas calls (`x.arcTo(...)`)
//     into a nonexistent `x.cx-decksTo(...)`. It compiles and only throws when the poster is drawn
//     at runtime. The guard rejects the `identifier.cx-<word>` property-call shape in JS/JSX.
//
//  2. ART-SEAM BYPASS - after the CDN activation, card art must resolve ONLY through the art
//     boundary. Three sanctioned constructors live in cardArt.js: `legacyUrl` (the one bundled
//     `${BASE}cards/` path), `artUrl` (the CDN url, wired once in artCacheInstance.js), and no
//     `cardImageUrl` at all (removed). The guard rejects any re-introduction: a raw bundled
//     `cards/` url built anywhere else, a call to the deleted `cardImageUrl`, or `artUrl` used
//     outside the cache-composition boundary. A regressed render site would otherwise silently
//     fall back forever with every gate still green.
//
// Both scans run over COMMENT-STRIPPED source so a doc comment naming the pattern is not a false
// positive, while a string/template that actually builds the path still is (that is the point).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Files where a given otherwise-forbidden token is the sanctioned definition/wiring.
const ALLOW_BUNDLED_CARDS = new Set(['src/store/cardArt.js']);           // legacyUrl lives here
const ALLOW_ARTURL = new Set(['src/store/cardArt.js', 'src/store/artCacheInstance.js']);

export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/^\s*\/\/.*$/gm, '')           // whole-line // comments
    .replace(/([^:])\/\/.*$/gm, '$1');      // trailing // comments, but not the // in https://
}

// A JS/JSX property call `ident.cx-word` - the corruption fingerprint. A CSS class (`.cx-deck`,
// preceded by whitespace) and a JSX className string (`"cx-deck"`, no leading `ident.`) do NOT match.
const CANVAS_CORRUPTION = /[A-Za-z0-9_$)\]]\s*\.\s*cx-[a-z]/;

// A bundled card url built in code: `cards/${...}`, `}cards/`, or a quoted `cards/` literal.
const BUNDLED_CARDS = /cards\/\$\{|\}cards\/|['"`]cards\//;

const DELETED_CARDIMAGEURL = /\bcardImageUrl\b/;
const ARTURL_TOKEN = /\bartUrl\b/;

// Returns [{ rule, line, snippet }] for one file's stripped source.
export function scanSource(rel, stripped) {
  const out = [];
  const lines = stripped.split('\n');
  const push = (rule, i) => out.push({ rule, line: i + 1, snippet: lines[i].trim().slice(0, 120) });
  lines.forEach((ln, i) => {
    if (CANVAS_CORRUPTION.test(ln)) push('canvas-method-corruption', i);
    if (DELETED_CARDIMAGEURL.test(ln)) push('deleted-cardImageUrl', i);
    if (BUNDLED_CARDS.test(ln) && !ALLOW_BUNDLED_CARDS.has(rel)) push('bundled-cards-path-bypass', i);
    if (ARTURL_TOKEN.test(ln) && !ALLOW_ARTURL.has(rel)) push('artUrl-outside-boundary', i);
  });
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|jsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

export function scanTree() {
  const violations = [];
  for (const abs of walk(SRC)) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    for (const v of scanSource(rel, stripComments(readFileSync(abs, 'utf8')))) violations.push({ ...v, file: rel });
  }
  return violations;
}

// Run as a script (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = scanTree();
  if (violations.length) {
    console.error(`check:source FAILED - ${violations.length} art-seam / canvas-corruption violation(s):`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.file}:${v.line}  ${v.snippet}`);
    process.exit(1);
  }
  console.log('check:source OK - no canvas-method corruption and no art-seam bypass.');
}
