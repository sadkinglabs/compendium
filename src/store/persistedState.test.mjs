// Increment 6's gate: the persisted-state registry is complete, honest, and actually consumed.
//
// WHAT THIS SUITE CAN CATCH: a §8 row missing from the registry; a registry entry drifting from
// the key string the code really uses; a delete phase that no longer matches what the registry
// authorises; and - via the scanner - a persistence CALLSITE in src/** whose key matches no
// registered namespace, provided the callsite uses a surface the scanner knows (Capacitor
// Preferences, raw localStorage, catalog_meta/_meta SQL, the *KEY const convention, Android
// getSharedPreferences).
//
// WHAT IT CANNOT CATCH, stated plainly: a key persisted through a pattern nobody taught the
// scanner - a new plugin, a dynamically built key with no static prefix, an IndexedDB database
// opened directly. A fixture only contains keys its author put there, and a scanner only finds
// shapes its author imagined. That gap is not closed by this suite; it is made SAFE by the
// production default the registry encodes - unknown state is preserved, never deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PERSISTED_STATE, STORES, deletionStatements, replacementDeletes,
} from './persistedState.js';
import { RESTORE_PENDING_KEY } from './replacePlan.js';
import { RECOVERY_POINTER_KEY } from './recoveryStore.js';
import { CANONICAL_MARKER_KEY } from './canonicaliseBoot.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const REGISTRY_FILE = path.resolve(HERE, 'persistedState.js');

/* ------------------------------------------------------------------ */
/* The scanner                                                         */
/* ------------------------------------------------------------------ */

// Each find carries the GROUP of stores its surface can write to, so a localStorage key named
// `version` cannot satisfy itself against the catalog_meta entry of the same name.
const GROUP_STORES = {
  preferences: ['preferences'],
  localStorage: ['localStorage'],
  sqliteMeta: ['catalog_meta', '_meta'],
  any: STORES,   // the *KEY const convention names keys without revealing their store
};

const matchesEntry = (f, e) => GROUP_STORES[f.group].includes(e.store)
  && (f.kind === 'prefix'
    ? e.kind === 'prefix' && e.namespace === f.value
    : e.kind === 'prefix' ? f.value.startsWith(e.namespace) : e.namespace === f.value);

const unmatched = (found, entries) => found.filter((f) => !entries.some((e) => matchesEntry(f, e)));

function walk(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, ext));
    else if (ext.test(entry.name)) out.push(p);
  }
  return out;
}

// A template's static head is its namespace; a key built with NO static head has no namespace
// and is exactly the kind of write this scanner cannot see (the limit in the header).
const fromValue = (value) => {
  const i = value.indexOf('${');
  return i === -1 ? { kind: 'key', value } : { kind: 'prefix', value: value.slice(0, i) };
};

// `const NAME = 'k'`, `const NAME = \`p:${x}\``, or `const NAME = () => \`p:${x}\`` - the three
// shapes the codebase uses to name a key near its callsite.
function resolveIdent(name, text) {
  const m = text.match(new RegExp(
    `(?:const|let|var)\\s+${name}\\s*=\\s*(?:\\([^)]*\\)\\s*=>\\s*)?(['"\`])((?:(?!\\1).)*)\\1`));
  return m ? fromValue(m[2]) : null;
}

function scanSources() {
  const found = [];
  const problems = [];
  for (const file of walk(SRC, /\.(js|jsx)$/)) {
    if (file === REGISTRY_FILE) continue;   // the registry naming its own strings proves nothing
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const text = readFileSync(file, 'utf8');

    // Capacitor Preferences - key is a literal or a same-file const.
    for (const m of text.matchAll(/Preferences\.(?:get|set|remove)\(\s*\{\s*key:\s*('(?:[^'\\]|\\.)*'|"[^"]*"|[A-Za-z_$][\w$]*)/g)) {
      const arg = m[1];
      const r = /^['"]/.test(arg) ? fromValue(arg.slice(1, -1)) : resolveIdent(arg, text);
      if (r) found.push({ group: 'preferences', ...r, where: rel });
      else problems.push(`${rel}: Preferences key "${arg}" is not statically resolvable - use a same-file string const so it can be checked against the registry.`);
    }

    // Raw localStorage - literal, inline template, const, or nullary key-builder.
    for (const m of text.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*('(?:[^'\\]|\\.)*'|`(?:(?!`).)*`|[A-Za-z_$][\w$]*(?:\(\))?)/g)) {
      const arg = m[1];
      const r = /^['`]/.test(arg)
        ? fromValue(arg.slice(1, -1))
        : resolveIdent(arg.replace(/\(\)$/, ''), text);
      if (r) found.push({ group: 'localStorage', ...r, where: rel });
      else problems.push(`${rel}: localStorage key "${arg}" is not statically resolvable - use a same-file string const so it can be checked against the registry.`);
    }

    // The sqlite key-value tables. Keys reach them as SQL literals (per line, so a `key='x'`
    // against some other table in the same file cannot leak in) or as `prefix:${id}` templates.
    if (/catalog_meta|\b_meta\b/.test(text)) {
      for (const line of text.split('\n')) {
        if (!/catalog_meta|\b_meta\b/.test(line)) continue;
        for (const m of line.matchAll(/\bkey\s*=\s*'([^']+)'/g)) {
          found.push({ group: 'sqliteMeta', ...fromValue(m[1]), where: rel });
        }
      }
      for (const m of text.matchAll(/`([A-Za-z0-9_.-]*:)\$\{/g)) {
        found.push({ group: 'sqliteMeta', kind: 'prefix', value: m[1], where: rel });
      }
    }

    // The naming convention: an all-caps `...KEY` const holding a string names a persisted key
    // wherever it is later bound as a parameter (RESTORE_PENDING_KEY, RECOVERY_POINTER_KEY,
    // CANONICAL_MARKER_KEY reach their tables this way, invisible to the SQL rules above).
    for (const m of text.matchAll(/(?:export\s+)?const\s+[A-Z][A-Z0-9_]*KEY\s*=\s*'([^']+)'/g)) {
      found.push({ group: 'any', ...fromValue(m[1]), where: rel });
    }
  }
  return { found, problems };
}

const scanned = scanSources();

/* ------------------------------------------------------------------ */
/* The registry against §8                                             */
/* ------------------------------------------------------------------ */

test('every namespace §8 lists is registered, with the disposition §8 assigns', () => {
  // The proposal's table, transcribed. `restore_pending` carries `reconcile` because §8 defines
  // it operationally (written in the tx, cleared on completion) - the reconciliation machinery
  // owns its lifecycle.
  const S8 = [
    ['sqlite', 'profiles', 'replace'],
    ['sqlite', 'profiles.is_default', 'reconcile'],
    ['catalog_meta', 'dash_seeded:', 're-key'],
    ['catalog_meta', 'version', 'preserve'],
    ['catalog_meta', 'restore_pending', 'reconcile'],
    ['catalog_meta', 'recovery_point', 'preserve'],
    ['preferences', 'activeProfileId', 'reconcile'],
    ['preferences', 'changelogSeenBuild', 'exclude'],
    ['nativePrefs', 'telemetry_consent', 'exclude'],
  ];
  for (const [store, namespace, disposition] of S8) {
    const e = PERSISTED_STATE.find((x) => x.store === store && x.namespace === namespace);
    assert.ok(e, `§8 names "${namespace}" (${store}) but the registry does not`);
    assert.equal(e.disposition, disposition, `"${namespace}" must be ${disposition}, is ${e.disposition}`);
  }
});

test('the registry names the exact key strings the code exports - they may never drift apart', () => {
  // The registry cannot import these modules (replacePlan imports the registry - a cycle), so
  // this test is the binding between the declared strings and the live constants.
  const of = (ns) => PERSISTED_STATE.find((e) => e.namespace === ns);
  assert.equal(of(RESTORE_PENDING_KEY)?.store, 'catalog_meta');
  assert.equal(of(RECOVERY_POINTER_KEY)?.store, 'catalog_meta');
  assert.equal(of(CANONICAL_MARKER_KEY)?.store, '_meta');
});

/* ------------------------------------------------------------------ */
/* Production consumption - the delete phase is the registry's         */
/* ------------------------------------------------------------------ */

test('replacementDeletes derives exactly the Increment 4 delete phase - registry refactor, not redesign', () => {
  assert.deepEqual(replacementDeletes(['p-one', 'p-two']), [
    ['DELETE FROM profiles;'],
    ['DELETE FROM catalog_meta WHERE key=?;', ['dash_seeded:p-one']],
    ['DELETE FROM catalog_meta WHERE key=?;', ['dash_seeded:p-two']],
  ]);
  assert.deepEqual(replacementDeletes([]), [['DELETE FROM profiles;']]);
});

test('nothing is deleted unless registered destructive, and a destructive entry the planner cannot express throws', () => {
  // Preserve/reconcile/exclude produce NO statements - preserve-by-default in executable form.
  const inert = PERSISTED_STATE.filter((e) => e.disposition !== 'replace' && e.disposition !== 're-key');
  assert.deepEqual(deletionStatements(inert, ['p-one']), []);

  // A destructive disposition in a store the planner has no deletion path for must be loud:
  // a silently skipped "delete this" is worse than either deleting or preserving.
  assert.throws(() => deletionStatements(
    [{ namespace: 'cx-ongoing-match:', kind: 'prefix', store: 'localStorage', disposition: 're-key' }], ['p']),
  /no deletion path/);
  assert.throws(() => deletionStatements(
    [{ namespace: 'version', kind: 'key', store: 'catalog_meta', disposition: 'replace' }], ['p']),
  /no deletion path/);
  assert.throws(() => deletionStatements(
    [{ namespace: 'x', kind: 'key', store: 'catalog_meta', disposition: 'obliterate' }], ['p']),
  /no defined deletion semantics/);
});

/* ------------------------------------------------------------------ */
/* The scanner against the registry                                    */
/* ------------------------------------------------------------------ */

test('the scanner still sees the known surfaces - it may never pass by finding nothing', () => {
  // The canary: if a refactor changes a callsite shape and a rule goes blind, the completeness
  // test below would pass VACUOUSLY. Pinning known finds makes rot loud instead.
  const expectHits = [
    ['preferences', 'key', 'activeProfileId'],
    ['preferences', 'key', 'changelogSeenBuild'],
    ['localStorage', 'key', 'cx-no-images'],
    ['localStorage', 'key', 'cx-marg-collapse'],
    ['localStorage', 'prefix', 'cx-ongoing-match:'],
    ['localStorage', 'prefix', 'cx-home-collapse:'],
    ['sqliteMeta', 'key', 'version'],
    ['sqliteMeta', 'key', 'schema_version'],
    ['sqliteMeta', 'key', 'highlights_migrated'],
    ['sqliteMeta', 'prefix', 'dash_seeded:'],
    ['any', 'key', 'restore_pending'],
    ['any', 'key', 'recovery_point'],
    ['any', 'key', 'owned_cards_canonical_version'],
  ];
  for (const [group, kind, value] of expectHits) {
    assert.ok(scanned.found.some((f) => f.group === group && f.kind === kind && f.value === value),
      `the scanner no longer finds ${kind} "${value}" (${group}) - a rule has gone blind`);
  }
});

test('every persisted key namespace the scanner finds in src/** is registered', () => {
  assert.deepEqual(scanned.problems, [], 'every persisted key must be statically resolvable');
  const missing = unmatched(scanned.found, PERSISTED_STATE);
  assert.deepEqual(
    missing.map((f) => `${f.where}: ${f.kind} "${f.value}" (${f.group})`), [],
    'unregistered persisted-state namespaces - add them to persistedState.js WITH an owner and a disposition, or they are preserved forever by default');
});

test('fail-first: deleting a registry entry makes the completeness check fail', () => {
  // The previous test proven able to fail - run it against a registry with holes.
  const sansDash = PERSISTED_STATE.filter((e) => e.namespace !== 'dash_seeded:');
  assert.ok(unmatched(scanned.found, sansDash).some((f) => f.value === 'dash_seeded:'));
  const sansToggle = PERSISTED_STATE.filter((e) => e.namespace !== 'cx-no-images');
  assert.ok(unmatched(scanned.found, sansToggle).some((f) => f.value === 'cx-no-images'));
});

test('no registered scannable namespace is dead - each is found at a real callsite', () => {
  // The reverse direction: an entry nothing writes any more is a claim the codebase no longer
  // backs. (files/nativePrefs/sqlite tables are outside the JS scanner's sight and exempt.)
  const scannable = new Set(['preferences', 'localStorage', 'catalog_meta', '_meta']);
  for (const e of PERSISTED_STATE.filter((x) => scannable.has(x.store))) {
    assert.ok(scanned.found.some((f) => matchesEntry(f, e)),
      `registered namespace "${e.namespace}" (${e.store}) matches no callsite the scanner can see`);
  }
});

/* ------------------------------------------------------------------ */
/* Native SharedPreferences - file-level discovery only                */
/* ------------------------------------------------------------------ */

test('every native file touching SharedPreferences is surveyed, and its keys registered', () => {
  // Kotlin is beyond the JS scanner, so discovery is per FILE: a new getSharedPreferences
  // callsite fails here until its keys are surveyed into the registry by hand.
  const javaRoot = path.resolve(SRC, '..', 'android', 'app', 'src', 'main', 'java');
  if (!existsSync(javaRoot)) return;   // web-only checkout
  const surveyed = new Set(['TelemetrySdk.kt']);
  for (const file of walk(javaRoot, /\.kt$/)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('getSharedPreferences')) continue;
    assert.ok(surveyed.has(path.basename(file)),
      `${path.basename(file)} uses SharedPreferences but has not been surveyed into persistedState.js`);
  }
  const consent = PERSISTED_STATE.find((e) => e.store === 'nativePrefs' && e.namespace === 'telemetry_consent');
  assert.equal(consent?.disposition, 'exclude');
});
