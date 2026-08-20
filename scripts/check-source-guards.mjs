// Static source guards for three failure classes the type checker and build cannot see:
//
//  1. CANVAS-METHOD CORRUPTION - a find/replace once rewrote real canvas calls (`x.arcTo(...)`)
//     into a nonexistent `x.cx-decksTo(...)`. It compiles and only throws when the poster is drawn
//     at runtime. The guard rejects the `identifier.cx-<word>` property-call shape in JS/JSX.
//
//  2. ART-SEAM BYPASS - card art resolves ONLY through the art boundary. `artUrl` (the CDN url) is
//     wired once in artCacheInstance.js; there is no `cardImageUrl` (removed) and, since Phase 5,
//     NO bundled `${BASE}cards/` path anywhere (the bundle + `legacyUrl` were deleted). The guard
//     rejects any re-introduction: a raw bundled `cards/` url built ANY file, a call to the deleted
//     `cardImageUrl`, or `artUrl` used outside the cache-composition boundary. It also asserts the
//     bundle directory itself (`public/cards`) is absent, so no build can re-ship it.
//
//  3. UNBOUND JSX COMPONENT - `<Foo/>` compiles to `jsx(Foo, …)`, so a component the module never
//     binds is a FREE IDENTIFIER, not a syntax error. Rollup cannot resolve it, assumes a global,
//     and emits the name into the bundle intact while every real local is mangled. So the build
//     stays green, `check:types` (a 28-file closure) never sees the file, no test renders it, and
//     the defect surfaces only when a person taps the screen: ReferenceError during render, no
//     ErrorBoundary anywhere in this app, React unmounts the root, black screen. That is exactly
//     how Collection > Storage shipped in build 293 - StorageDetail rendered `<FileCopiesSheet/>`
//     and the component had been lost from the working tree, so every place row blanked the app.
//     Same lesson as `check:cycles`: passing gates did not prove the app rendered.
//
// Every scan runs over COMMENT-STRIPPED source so a doc comment naming the pattern is not a false
// positive, while a string/template that actually builds the path still is (that is the point).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// Files where a given otherwise-forbidden token is the sanctioned definition/wiring.
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

// A JSX element naming a COMPONENT: capitalised, and rooted at the namespace for `<Ns.Thing/>`.
// The lookbehind keeps `a<B` (a comparison) out; the lookahead keeps `a < B` out by requiring the
// name to be followed by what a tag is followed by - an attribute, `>`, `/>` or a member `.`.
const JSX_COMPONENT = /(?<![A-Za-z0-9_$])<\/?([A-Z][A-Za-z0-9_$]*)(?=[\s/>.])/g;

/**
 * Component tags whose name appears NOWHERE else in the module - see failure class 3 above.
 *
 * Deliberately crude, and that is exactly what makes it false-positive-free rather than clever: an
 * import, a declaration, a destructured prop and a parameter ALL leave a non-tag occurrence of the
 * name behind, so a name that only ever appears in TAG POSITION cannot be bound by any means. It
 * needs no scope analysis, so it cannot disagree with the linker in the subtle direction (a false
 * alarm on legitimate code); it can only under-report, which a reviewer notices and a black screen
 * does not. Measured over the whole tree it flags the real defect and nothing else.
 *
 * Returns [{ name, line }] for the FIRST use of each unbound name.
 */
export function unboundComponents(stripped) {
  const elsewhere = stripped.replace(JSX_COMPONENT, '<');
  const found = new Map();
  for (const m of stripped.matchAll(JSX_COMPONENT)) {
    const name = m[1];
    if (found.has(name) || new RegExp(`\\b${name}\\b`).test(elsewhere)) continue;
    found.set(name, stripped.slice(0, m.index).split('\n').length);
  }
  return [...found].map(([name, line]) => ({ name, line }));
}

// Returns [{ rule, line, snippet }] for one file's stripped source.
export function scanSource(rel, stripped) {
  const out = [];
  const lines = stripped.split('\n');
  const push = (rule, i) => out.push({ rule, line: i + 1, snippet: lines[i].trim().slice(0, 120) });
  lines.forEach((ln, i) => {
    if (CANVAS_CORRUPTION.test(ln)) push('canvas-method-corruption', i);
    if (DELETED_CARDIMAGEURL.test(ln)) push('deleted-cardImageUrl', i);
    if (BUNDLED_CARDS.test(ln)) push('bundled-cards-path-bypass', i);   // Phase 5: no sanctioned bundled path
    if (ARTURL_TOKEN.test(ln) && !ALLOW_ARTURL.has(rel)) push('artUrl-outside-boundary', i);
  });
  // Whole-file, not per-line: a component is bound somewhere ELSE in the module than where it is used.
  for (const { name, line } of unboundComponents(stripped)) {
    out.push({ rule: 'unbound-jsx-component', line, snippet: `<${name}> - never imported or declared in this file` });
  }
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

/** Phase 5: the bundled card-art directory must not exist (nothing can re-ship it into the APK). */
export function bundleAbsent() { return !existsSync(join(ROOT, 'public', 'cards')); }

// Run as a script (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = scanTree();
  if (!bundleAbsent()) {
    console.error('check:source FAILED - public/cards still exists (the bundled card art must be gone in Phase 5; card art ships from the CDN).');
    process.exit(1);
  }
  if (violations.length) {
    console.error(`check:source FAILED - ${violations.length} source-guard violation(s):`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.file}:${v.line}  ${v.snippet}`);
    process.exit(1);
  }
  console.log('check:source OK - no canvas-method corruption, no art-seam bypass, no bundled card art, no unbound JSX component.');
}
