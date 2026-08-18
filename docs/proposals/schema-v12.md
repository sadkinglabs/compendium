# Proposal: Settings become data, migrations become statement-safe (schema v12)

**Revision 1** (2026-08-14).

## Status and classification

**Draft.** Risk: **High** - persisted schema change, import/export format change, and a change to the
migration runner on the boot path of both runtimes. Constitution §6 places every one of those in the
High-risk class independently; together they are not arguable.

Owner/approver: project owner. Author: Claude Code (designer). Reviewer: Codex.

## Problem and success criteria

Adding one user preference today is a six-place edit, and three of the six are hand-maintained
parallel lists that drift silently:

1. a `MIGRATIONS` entry plus `SCHEMA_VERSION` (`src/store/schema.js:6`, appended entry);
2. `DEFAULTS` in `src/store/playRepository.js:15-19`;
3. the hardcoded 12-column settings UPDATE in `src/store/profileTransfer.js:270-272`;
4. the mirrored 12-column list in `src/store/profileRoundTrip.test.mjs:108-109`;
5. the settings table listing in `COMPENDIUM_DATA_MODEL.md` §5 (enforced only as a version number by
   `scripts/check-docs.mjs:55-63`);
6. and, because `SCHEMA_VERSION` feeds `MAX_SUPPORTED_SCHEMA` (`src/store/importBoundary.js:19`),
   every bump makes a build one version behind refuse the entire bundle as `future`
   (`importBoundary.js:65-70`).

The drift is not hypothetical. Export is generic (`SELECT * FROM settings`,
`profileTransfer.js:96`); import is the hand-written UPDATE at line 270. Any column added without
editing that line is exported and then **silently discarded on import**, and the round-trip test
cannot catch it because it carries the same hand-written list. The pattern exists because settings
are stored as one column per preference - yet nothing in the codebase filters, joins, sorts, or
indexes on a settings column. The only SQL shapes that touch the table are `SELECT *`
(`playRepository.js:23`), `UPDATE one_col` (`playRepository.js:36`), and the bulk import UPDATE.
`getSettings` already fakes document semantics over the columns: `{ ...DEFAULTS, ...row }`
(`playRepository.js:26`). The storage is relational; the usage is a document.

Underneath that sits a defect that must land first: **the migration runner bumps the version after a
partial apply** (`src/store/db.js:27-45`). Details in Evidence below. Every future migration,
including the one this proposal adds, depends on the runner being correct.

### Success criteria

1. Adding a new setting is **one line in a registry module**: no migration, no `SCHEMA_VERSION`
   bump, no transfer edit, no test-list edit, no doc-schema bump. A coverage gate proves the new
   key round-trips through export/import automatically.
2. A migration interrupted at any statement boundary completes correctly on the next boot, with a
   test that simulates every partial-apply prefix of every shipped migration.
3. A device already stranded by the historical runner defect (version stamped 4+, v4 columns
   missing) boots, migrates to v12, and can import profiles again.
4. Cascade deletes and the hot read paths on `deck_history`, `collection_items`,
   `dashboard_layouts`, and `matches(deck_id)` stop full-scanning (indexes exist and are asserted).
5. Old bundles (v10/v11, settings-as-object) import with settings intact, minus the retired
   `accent_metal`, exactly as today. New bundles are refused by older builds with the existing
   `future` message - once, and then never again for a settings addition.

### Non-goals

- Dropping the legacy `settings` table (deferred to a future v13; see Rollback).
- Moving any non-settings data to KV storage. `resume`, dashboard state, and everything else keep
  their tables; this proposal covers the one table whose usage is provably a document.
- Migrating `localStorage`/Preferences state into the database.
- A general per-profile "app state" store. The registry is a closed, typed whitelist, not a junk
  drawer; anything that is not a user preference does not belong in it.

## Evidence and current architecture

All claims verified by reading the cited code on 2026-08-14.

| Concern | Location |
|---|---|
| Runner: tolerate at migration granularity, bump anyway | `db.js:31-44` - the `catch` swallows `duplicate column\|already exists` for the whole `exec(m.sql)`, then the bump at `db.js:43` runs unconditionally |
| Migrations non-atomic natively | `db.js:399` - `db.execute(sql, false)` (transaction flag false) |
| Migrations non-atomic on web | `db.js:297` - `sdb.run(sql)` autocommits per statement |
| Settings export generic | `profileTransfer.js:96` |
| Settings import hardcoded | `profileTransfer.js:270-272` |
| Round-trip test mirrors the list | `profileRoundTrip.test.mjs:108-109` |
| `getSettings` fakes document semantics | `playRepository.js:21-26` |
| `setSetting` interpolates an identifier behind a whitelist | `playRepository.js:30-37` |
| Settings row seeded at profile creation | `profileRepository.js:88`, `profileTransfer.js:193` |
| No index: `deck_history(deck_id)` | reads at `deckRepository.js:187,191,194,203`; export `profileTransfer.js:81`; `ON DELETE CASCADE` from `decks` |
| No index: `collection_items(collection_id)` | reads at `codexRepository.js:472,490,502,508,516`; `homeRepository.js:212`; export `profileTransfer.js:85`; cascade |
| No index: `dashboard_layouts(profile_id)` | reads at `homeRepository.js:82,86,98`; export `profileTransfer.js:94`; cascade |
| No index: `matches(deck_id)` | the single W-L writer `syncDeckRecordStmt` (`playRepository.js:160-170`) runs two correlated subqueries on it on **every** match record/edit/delete; `deckMatchCount` (`playRepository.js:174-177`); once per deck on every import (`profileTransfer.js:279-285`) |
| `profiles.schema_version` written, never read, never updated | written `profileRepository.js:82-86` and `profileTransfer.js:191-192`; no migration touches it; the only other appearances are test fixtures |
| Dormant second migration system | `db.js:394` passes `SCHEMA_VERSION` to `createConnection`; no `addUpgradeStatement` exists anywhere in `src/**`, so the plugin path never fires |
| Reads bypass the exclusive session | `db.js:172` - `query` is neither admitted nor token-checked; documented deliberate at `db.js:171` |
| DDL-only gate and why | `schema.js` v11 comment (`schema.js:357-375`), `schemaExec.test.mjs` |
| The model gate for parallel lists | `importBoundary.test.mjs:173-183` - scans `profileTransfer.js` source for `of bundle.X || []` and asserts every match is in `ITERATED_COLLECTIONS` |
| Bundle bounds + digest sorting keyed off `ITERATED_COLLECTIONS` | `backup.js:286` (bounds), `backup.js:183` (sort), `backup.js:174-178` (`rowKey` falls back to canonical JSON for id-less rows) |

### The runner defect, worked through (Finding 1, HIGH)

v4 is three `ALTER TABLE settings ADD COLUMN` statements (`schema.js:219-223`). A process kill after
statement 1 commits leaves `font_scale` present, `high_contrast`/`reduced_motion` absent, version
still 3. On the next boot, `exec(m.sql)` re-runs all three as one string; statement 1 throws
`duplicate column`; on both backends the remaining statements are **aborted**, the `catch` at
`db.js:40` matches and swallows, and `db.js:43` stamps version 4. The device now permanently lacks
two columns. It *looks* healthy because `getSettings` masks the hole with the `DEFAULTS` spread -
until a profile import reaches the hardcoded UPDATE at `profileTransfer.js:270`, which references
`high_contrast`, throws `no such column`, rolls back, and fails **every future import** on that
device.

The damage class is enumerable, and small. A multi-statement migration is stranded this way only if
an early statement is non-idempotent-in-shape (throws on re-run) while later statements still need
to run. Auditing all eleven shipped migrations: v1, v8, v9, v11 are `IF NOT EXISTS` throughout
(re-runs proceed, nothing aborts); v2, v5, v6 are single statements; v10 is `DROP IF EXISTS` +
idempotent `DELETE`s; **v3** (ALTER + UPDATE) can strand its backfill, but `initProfiles()`
re-asserts exactly-one-default every boot (`profileRepository.js:48-55`), so it self-heals; **v4**
is the only migration that stays broken. That means a targeted repair is possible (§Design 2).

### One correction to the brief this proposal was commissioned from

The constraint was stated as "migrations must contain DDL only". The code says something narrower
and the evidence supports the narrower rule: `exec()` maps to Android's `execSQL()`, which refuses
**row-returning** statements (`SELECT`, `WITH`, `EXPLAIN`, `VALUES`, bare `PRAGMA`), and that is
exactly the set `schemaExec.test.mjs:15,30-34` forbids. Non-returning DML is fine and is
device-proven: v3, v5, and v6 shipped `UPDATE`s - v6 with two correlated `SELECT` subqueries - and
ran on real devices at upgrade. So the settings copy in §Design 3 may lawfully be
`INSERT ... SELECT` (statement head `INSERT`, returns no rows, passes the existing gate). It is
still flagged for device verification because the OEM-build caution is legitimate, and a fallback is
specified.

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | No code path filters/joins/sorts/indexes on a settings column | **High** - all readers traced: `playRepository.js:21-37`, `profileTransfer.js:96,270`, `profileRoundTrip.test.mjs` | Codex re-verifies by search |
| 2 | `INSERT INTO ... SELECT` runs under native `execSQL` semantics on OEM builds | **Medium** - v6's correlated-subquery UPDATE is strong precedent, but `INSERT ... SELECT` specifically has not shipped | Device upgrade test before release; fallback designed (§Design 3) |
| 3 | Statement-level splitting of our own migration SQL is safe with a comment-stripping, quote-aware splitter | High - migrations are first-party DDL/DML gated by `schemaExec.test.mjs`; `stripSqlComments` (`db.js:361`) already handles the comment hazard | Splitter unit tests incl. semicolons inside string literals |
| 4 | `settings_kv` rows sort deterministically in the content digest via the canonical-JSON `rowKey` fallback | High - `(profile_id, key)` is unique, so no two rows canonicalise equal | Shuffle test (§Verification) |
| 5 | `INSERT OR REPLACE` upsert is available on every supported SQLite | High - used today for `_meta` (`db.js:43`) and `resume` (`profileTransfer.js:260`). Chosen over `ON CONFLICT DO UPDATE`, which needs SQLite 3.24+ and would be the first version-sensitive syntax in the schema | None needed |
| 6 | The existing `of bundle.X \|\| []` source-scan gate auto-covers a new iterated collection | High - read at `importBoundary.test.mjs:177-182` | The new loop uses the same idiom |

## Affected systems and invariants

Surfaces: `db.js` (runner), `schema.js` (v12), a new `settingsRegistry.js`, `playRepository.js`,
`profileRepository.js`, `profileTransfer.js`, `importBoundary.js`, tests across the store layer,
`COMPENDIUM_DATA_MODEL.md`. `backup.js` and the restore machinery are affected **by data**, not by
code: they key off `ITERATED_COLLECTIONS` and inherit `settings_kv` from the list change.

§3 invariants touched, how each holds, how each is verified:

- **§3.2 Profile isolation.** `settings_kv.profile_id` carries `REFERENCES profiles(id) ON DELETE
  CASCADE` like every profile-owned table; reads/writes go through `activeProfileId()` exactly as
  the current settings do. Verified by a two-profile isolation test and a cascade row-count test.
- **§3.3 Durable offline-first writes.** Settings stay in SQLite under the same `run`/`tx`
  admission boundary. This is precisely why the Capacitor-Preferences alternative is rejected
  (§Options C). Verified by the existing durable-write behavior plus the round-trip suite.
- **§3.4 Forward-only schema evolution.** v12 is appended, ordered, idempotent per statement, and
  never edits a shipped migration. The runner change *strengthens* retry safety. Verified by the
  partial-apply matrix (§Verification 1).
- **§3.5 Transactional user-data operations.** Import still plans pure statements and commits one
  `tx` (`profileTransfer.js:162-164`); `settings_kv` rows are simply more statements in that plan.
  The boot migration itself remains non-atomic on both backends - that is the pre-existing
  condition Stage 1 mitigates at statement granularity rather than pretending to fix with a
  transaction that `db.js:33`'s comment already records as unreliable.
- **§3.8 Cross-runtime integrity.** The runner change and v12 run on sql.js and native. The one
  statement with native-specific risk (`INSERT ... SELECT`) is named, device-gated, and has a
  designed fallback. `check:smoke` and a manual v11-data upgrade on device are release gates for
  both stages that touch boot.
- **§3.1 Catalog/profile boundary** - untouched; no catalog table changes. **§3.6 / §3.7** - not
  implicated (no assets, no catalog-driven concepts; arguably §3.7's spirit, "extensible by data",
  is what this proposal brings to settings).

## Options considered

| Option | Verdict |
|---|---|
| A. Status quo: column per setting, six-place edit | Rejected - the drift already produced a real silent-discard defect (Finding 2), and every setting costs a migration on the boot path of every existing device |
| B. One JSON blob column on `settings` | Rejected, see below |
| C. Capacitor Preferences / config file | Rejected - leaves the `ON DELETE CASCADE` graph, the import transaction, and the restore machinery; breaks §3.2/§3.3/§3.5 in one move. `COMPENDIUM_DATA_MODEL.md` §3 already reserves Preferences for install-local non-user-data |
| D. Keep columns, generate the six sites from a registry (codegen) | Rejected - fixes drift but keeps one migration + version bump per setting, which is the owner's actual complaint; adds a build step to avoid a schema that matches the usage |
| E. **`settings_kv(profile_id, key, value)` + typed JS registry** | **Proposed** |

**Why B loses, stated as a tradeoff and not a hardline.** A blob is genuinely simpler to read and
write whole. It loses on partial writes: updating one key means read-modify-write (a lost-update
window; thin in practice, since settings writes are single-user and low-frequency - the honest
version of this argument is "thin but nonzero and unnecessary") or SQLite's `json_set()`, whose
availability across OEM Android builds is exactly the class of native/web divergence that broke
boot in v11. The blob also re-creates the problem at one remove: the bundle would carry an opaque
document whose internal shape still needs a registry to validate, while giving up per-row bounds
checking (`backup.js:286`) and per-key SQL. If the owner weighs the lost-update window at zero and
would accept a `json_set()` device matrix, B is defensible; the designer's judgment is that E costs
one more table and buys strictly more of the properties this codebase already enforces elsewhere.

Within option E, three sub-decisions, each overridable:

1. **Value encoding: raw TEXT + typed registry parse**, not JSON-encoded values. The SQL copy in
   v12 can then be a plain column reference, SQLite's implicit text coercion does the rest, and the
   registry (which must exist anyway for defaults) owns parsing. JSON encoding would buy nested
   values, which no setting has or is expected to have.
2. **Upsert via `INSERT OR REPLACE`**, not `ON CONFLICT DO UPDATE` (assumption 5). The row is fully
   specified, so REPLACE semantics are identical here.
3. **Unknown keys are preserved on import, not dropped.** A key is a bound *value*, never an
   interpolated identifier, so an unknown key is inert: readers consult the registry and ignore it.
   Preserving means a bundle exported by a build with a newer registry survives a round trip
   through an older v12 build with zero loss - which is the whole point of decoupling settings from
   `SCHEMA_VERSION`. Bounds are enforced by the existing `rowsPerTable` ceiling. The retired
   `accent_metal` never enters KV at all (§Design 4), so the accent_metal exclusion policy is
   preserved by construction, not by a filter. If the owner prefers a strict whitelist at the
   boundary, it is a five-line change in the legacy converter plus one loop, at the cost of the
   forward-compat property.

## Proposed design

### 1. Migration runner: statement granularity, tolerate-and-continue (lands first, alone)

`runMigrations` (`db.js:27-45`) changes from per-migration `exec(m.sql)` to:

1. Split `m.sql` into statements with a comment-stripping, quote-aware splitter (the comment logic
   already exists as `stripSqlComments`, `db.js:361`; the split respects single-quoted literals the
   same way).
2. Execute each statement individually - on native this also means each statement reaches the
   plugin alone, bypassing the plugin's quote-unaware multi-statement splitter entirely for
   migrations.
3. On error matching `/duplicate column|already exists/i`, **continue to the next statement**
   instead of aborting the migration. Any other error still throws, and the version does not bump -
   fail closed, forward repair, unchanged from today's posture for unknown errors.
4. Bump the version only after every statement of the migration has been attempted.

The worked example now resolves: kill after v4 statement 1, re-boot, statement 1 throws
`duplicate column` and is tolerated, statements 2-3 **run**, version 4 is stamped truthfully.

Extraction: the loop moves to a small pure module (`src/store/migrations.js`) taking
`{ query, run, execOne }`, so the partial-apply matrix (§Verification 1) runs under `node --test`
against bare sql.js exactly as the rest of the store suite does. `db.js` keeps a thin call.

The tolerance list deliberately does **not** grow (`no such column` stays fatal). A broad tolerance
would let a genuinely broken migration stamp itself complete. Devices already damaged by the old
runner are healed by v12's repair preamble instead:

### 2. v12 opens by re-asserting the columns it is about to read

The only stranding the old runner can have produced in the field is v4's trio (Evidence above). v12
therefore begins with the same three `ALTER TABLE settings ADD COLUMN` statements, verbatim. On a
healthy device all three throw `duplicate column` and are tolerated per statement; on a stranded
device the missing ones apply. After the preamble, every device has all twelve columns, so the copy
below can never hit `no such column`, and stranded devices are fully repaired as a side effect -
including their previously broken import path, for the interval until Stage 2's code stops using
the wide UPDATE at all.

This ordering is why Stage 1 must ship before v12 exists: under the old runner, the preamble's
first tolerated error would abort the rest of v12.

### 3. Migration v12

```sql
-- repair preamble (see §Design 2)
ALTER TABLE settings ADD COLUMN font_scale REAL DEFAULT 1;
ALTER TABLE settings ADD COLUMN high_contrast INTEGER DEFAULT 0;
ALTER TABLE settings ADD COLUMN reduced_motion INTEGER DEFAULT 0;

-- FK-child and hot-path indexes (Finding 3)
CREATE INDEX IF NOT EXISTS idx_deck_history_deck ON deck_history(deck_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_profile ON dashboard_layouts(profile_id);
CREATE INDEX IF NOT EXISTS idx_matches_deck ON matches(deck_id);

-- the settings document store
CREATE TABLE IF NOT EXISTS settings_kv (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (profile_id, key)
);

-- copy every live setting; absent row = default thereafter. One statement per key so a
-- failure is per-key, INSERT OR IGNORE so every statement is retry-safe under the
-- statement-granular runner. accent_metal is retired and deliberately not copied.
INSERT OR IGNORE INTO settings_kv(profile_id, key, value)
  SELECT profile_id, 'film_grain', film_grain FROM settings;
-- ... eleven more, one per registry key ...
```

Notes:

- The composite primary key gives the profile-leading index the cascade and the `getSettings` read
  need; no separate index.
- `idx_matches_deck` is single-column on purpose. `syncDeckRecordStmt` filters
  `deck_id + profile_id + winner`, but matches-per-deck is small and `winner` has three values; a
  composite index would buy nothing measurable and encode a query shape into the schema. Rejected,
  overridable.
- Copying **all** values, including ones equal to their defaults, is deliberate: it preserves
  today's semantics exactly ("this profile has this value") rather than guessing which values were
  intentional. The absent-row-means-default rule applies to keys written *after* v12.
- The `INSERT ... SELECT` statements pass the `schemaExec` gate (head `INSERT`) and match the
  device-proven v6 precedent, but they are the flagged native risk (assumption 2). **Fallback if
  device verification fails:** ship v12 without the copy statements; `getSettings` reads KV first
  and falls back per missing key to the legacy row for one release; a later migration drops the
  fallback once writers have organically re-persisted values. The fallback is strictly worse
  (two-table reads, longer legacy lifetime), which is why it is the contingency and not the plan.

`SCHEMA_VERSION` becomes 12 and `MAX_SUPPORTED_SCHEMA` becomes 12. The legacy `settings` table is
**kept and frozen** - no production code reads or writes it after Stage 2; dropping it is a future
v13 once the KV path has a release of device evidence behind it (see Rollback).

### 4. The registry and the repository

New module `src/store/settingsRegistry.js` - the single source of truth:

```js
// Adding a setting = adding ONE row here. No migration, no version bump, no transfer edit.
export const SETTINGS = [
  { key: 'film_grain',       type: 'int',    default: 1 },
  { key: 'keep_awake',       type: 'int',    default: 1 },
  { key: 'immersive',        type: 'int',    default: 1 },
  { key: 'default_max_life', type: 'int',    default: 20 },
  { key: 'die_type',         type: 'int',    default: 6 },
  { key: 'haptics',          type: 'int',    default: 1 },
  { key: 'rarity_colors',    type: 'int',    default: 0 },
  { key: 'theme',            type: 'string', default: 'grimoire' },
  { key: 'persist_search',   type: 'int',    default: 0 },
  { key: 'font_scale',       type: 'number', default: 1 },
  { key: 'high_contrast',    type: 'int',    default: 0 },
  { key: 'reduced_motion',   type: 'int',    default: 0 },
];
```

Plus two pure functions: `parseSetting(key, rawText)` (registry-typed; a malformed or non-finite
value yields the default - fail-safe, which is exactly what the `DEFAULTS` spread does today for a
missing column) and `defaultSettings()`.

`playRepository.js`:

- `getSettings()` = `SELECT key, value FROM settings_kv WHERE profile_id=?` folded over
  `defaultSettings()`. **Callers see the identical object shape and types they see today**,
  including numeric types for int/number keys. The row-seeding insert disappears: absent means
  default, structurally.
- `setSetting(key, value)` = registry membership check, then
  `INSERT OR REPLACE INTO settings_kv(profile_id,key,value) VALUES(?,?,?)`. The identifier
  interpolation at `playRepository.js:36` and its whitelist **cease to exist** - the key is a bound
  parameter. One entire class of SQL-injection surface is deleted rather than guarded.
- `DEFAULTS` is deleted; anything needing defaults imports the registry.

`profileRepository.js:88` (settings seed at profile creation) and `profileTransfer.js:193` (seed
inside the import plan) are deleted - a new profile owns zero KV rows and reads all defaults.

### 5. Transfer, boundary, backup

- `buildProfileUnit` exports `settings_kv` rows (`SELECT * ... WHERE profile_id=?`) **instead of**
  the scalar `settings` field. The unit shape changes; the legacy wrapper question does not arise
  because `exportProfile` stamps `schemaVersion: 12` and carries the new collection.
- `planProfileUnit` gains one generic loop, written in the house idiom so the source-scan gate
  auto-covers it: `for (const s of bundle.settings_kv || []) ins('settings_kv', ['profile_id','key','value'], [pid, s.key, s.value])`.
  The hardcoded UPDATE at `profileTransfer.js:270-272` is **deleted**. Finding 2 does not get a
  compensating mechanism; the mechanism that produced it is removed.
- `importBoundary.js`: `'settings_kv'` joins `ITERATED_COLLECTIONS` (buying array validation,
  bounds at `backup.js:286`, and digest sorting at `backup.js:183` for free), and `normaliseBundle`
  gains the shape-first adaptation it already performs for v10 ownership keys: a bundle carrying a
  legacy `settings` **object** is converted to `settings_kv` rows through the registry - only
  registry keys convert, so `accent_metal` dies at the boundary, matching the deliberate exclusion
  at `profileTransfer.js:267-269`. A bundle with neither imports as all-defaults, unchanged from
  today's `bundle.settings == null` behavior.
- Per-key value validation at the boundary stays shallow on purpose (strings in, registry parse on
  read); the reader is the enforcement point, and a hostile value can at worst select a default.
- `backup.js` needs **no code change**: `settings_kv` rows have no `id`, so `rowKey`
  (`backup.js:174-178`) falls back to canonical JSON, which is deterministic because
  `(profile_id, key)` is unique per row. This is asserted by a new shuffle test rather than
  trusted. Restore/replace machinery (`replacePlan`, `replaceAll`) operates by profile deletion +
  re-plan, so cascade plus the planner change covers it; `replaceAll.test.mjs:361`'s table list
  gains `settings_kv` and eventually loses `settings`.

### 6. Owner decisions surfaced (not folded in silently)

| Finding | Options | Recommendation |
|---|---|---|
| **F4** `profiles.schema_version` lies (stamped at creation/import, never migrated, never read) | (a) document as vestigial; (b) maintain it (adds a write path with zero readers); (c) drop the column (SQLite table rebuild - real risk, zero value) | **(a)** - one sentence in `COMPENDIUM_DATA_MODEL.md` §5 and a comment at the column. Revisit only if a per-profile version ever gains a reader |
| **F5** dormant plugin migration path (`db.js:394` passes `SCHEMA_VERSION`; plugin `user_version` stays 0) | (a) document + a guard comment forbidding `addUpgradeStatement`, plus a mechanical test asserting no call exists in `src/**`; (b) pass a constant `1` to sever it | **(a)** - zero behavioral change; (b) changes an argument whose downstream plugin behavior on existing installs is unverified, for no functional gain |
| **F6** `query` bypasses the exclusive session (`db.js:172`) | (a) keep, document; (b) token-check reads during a session | **(a)** - on web the replacement `tx` body is synchronous (`db.js:303-308`), on native it is one `executeSet` call, so a read cannot observe a torn mid-transaction state; it sees pre- or post-commit, both consistent. Gating reads would buy freshness, not integrity, at the cost of failing innocent UI reads during a restore |

## Implementation plan

| # | Stage | Contents | Gate to proceed |
|---|---|---|---|
| 1 | **Runner** | statement-granular `runMigrations` extracted to `migrations.js`; splitter; partial-apply matrix test | All listed gates green; Codex review; **device**: fresh install + upgrade-over-v11 boot |
| 2 | **v12 + KV** | `schema.js` v12; `settingsRegistry.js`; `playRepository` KV read/write; seed deletions; transfer/boundary/backup changes; `MAX_SUPPORTED_SCHEMA` 12; all behavior tests; `COMPENDIUM_DATA_MODEL.md` | Gates green; Codex review; **device**: upgrade with populated settings, verify values survive; import an old bundle |
| 3 | **Recurrence gates** | registry-driven round-trip coverage test replacing the hand list at `profileRoundTrip.test.mjs:108`; frozen-legacy-table test (no production reference to the `settings` table outside `schema.js`); F4/F5 documentation + the no-`addUpgradeStatement` test per owner decision | Gates green; Codex final diff review |

Stage 2 is one increment, not two, because `settings_kv` without transfer support would silently
lose settings on every export in between - the exact defect class this proposal exists to end.
Stage 3 is separable and code-inert (tests and docs only).

Per-stage file lists:

**Stage 1:** `src/store/db.js`, `src/store/migrations.js` (new), `src/store/migrations.test.mjs`
(new). No schema change, no format change.

**Stage 2:** `src/store/schema.js`, `src/store/settingsRegistry.js` (new),
`src/store/playRepository.js`, `src/store/profileRepository.js`, `src/store/profileTransfer.js`,
`src/store/importBoundary.js`, `src/store/settingsRegistry.test.mjs` (new), updates to
`profileRoundTrip.test.mjs`, `importBoundary.test.mjs`, `backup.test` digest shuffle,
`replaceAll.test.mjs` table list, `schemaExec.test.mjs` (nothing to change, but it now guards v12),
`COMPENDIUM_DATA_MODEL.md`.

**Stage 3:** test files above plus `COMPENDIUM_DATA_MODEL.md` §5 (F4 note), `db.js` comment (F5),
optionally `scripts/` if the frozen-table check lands as a script rather than a test (test
preferred - it needs no new npm surface).

Gates per stage (exact commands): `npm run test:codex`, `npm run test:query`, `npm run test:app`,
`npm run check:types`, `npm run check:cycles`, `npm run build`, `npm run check:docs`.
`npm run check:smoke` (device required) before merging Stage 1 and Stage 2, because both touch
boot. `check:types` is expected NOT RUN-relevant only if none of its owned files change (none do);
it runs anyway as part of the block and should pass untouched.

## Data migration and compatibility

- **Versioning:** v12 appended; `SCHEMA_VERSION` 12; exports stamp 12; `MAX_SUPPORTED_SCHEMA` 12.
  Builds at 11 refuse v12 bundles with the existing `future` rejection (`importBoundary.js:65-70`).
  That is the one-time cost named in success criterion 5; after it, registry additions never bump
  again. During the alpha window, testers exchanging bundles must upgrade in step for one release.
- **Transaction boundaries:** the migration is statement-granular and every statement is
  individually idempotent (`ALTER` tolerated, `CREATE IF NOT EXISTS`, `INSERT OR IGNORE`), so any
  interruption point resumes to the same terminal state. Import remains one `tx`.
- **Old format in:** v10/v11 bundles (settings object) convert at the boundary; missing settings
  import as defaults; `accent_metal` is dropped by construction. **New format in old build:**
  refused as `future`, loudly, unchanged mechanism. **Old data on disk:** copied once into KV; the
  wide table is frozen, not dropped.
- **Whole-app archives:** `bundleFormat` 2 unchanged; units carry `settings_kv` arrays; the content
  digest sorts them deterministically (assumption 4); `summarise` row counts now include settings
  rows (a preview-count cosmetic change, noted so it is not reported as a defect).

## Rollback and recovery

- **Stage 1:** code-only; revert the commit. No data shape changed. A device that booted the new
  runner is indistinguishable from one that did not, except possibly *healthier* (completed
  partials).
- **Stage 2:** v12 is purely additive (new table, new indexes, repaired columns, copied rows).
  Reverting the APK to a v11 build leaves `settings_kv` and the indexes in place - the v11 code
  never references them, and `_meta.schema_version=12` is above the old build's ceiling but the old
  runner only compares `m.version <= current` and simply runs nothing. **Settings edits made under
  v12 code live only in KV and would not be visible to reverted v11 code** - severity is cosmetic
  (preferences, not user-created content), and the legacy table still holds the values as of the
  copy. This is the stated residual risk of the stage, accepted or not by the owner.
- **Point of no return:** none in this proposal. It arrives only with the future v13 `DROP TABLE
  settings`, which is exactly why the drop is deferred until KV has device history.
- **Partial v12 apply:** any prefix of v12's statements leaves a strictly-additive subset; the next
  boot completes the remainder (matrix-tested).

## Verification plan

New gates, mapped to the finding each prevents from recurring:

1. **Partial-apply matrix** (Finding 1): for every shipped migration and every prefix length k,
   build the schema through version n-1, apply the first k statements of migration n manually,
   run the runner, and assert the resulting schema equals a fresh-build schema (compare
   `sqlite_master` SQL, normalised). Plus: the v4-stranded-then-import scenario end-to-end - stamp
   version 4 with columns missing, migrate to 12, import a bundle, assert success. Plus splitter
   tests (comments, semicolons inside string literals).
2. **Registry-driven round trip** (Finding 2): for every `SETTINGS` key, write a non-default
   sentinel via `setSetting`, export, import, assert the value survives on the new profile. The
   test iterates the registry, so a key added tomorrow is covered the day it exists - the
   `ITERATED_COLLECTIONS` pattern (`importBoundary.test.mjs:173`) applied to settings. The hand
   list at `profileRoundTrip.test.mjs:108` is deleted, not extended.
3. **Index presence** (Finding 3): after migrations, assert the four v12 indexes exist in
   `sqlite_master`. (An EXPLAIN QUERY PLAN assertion was considered and rejected: EQP output is not
   contractual across SQLite versions; presence plus the schema is the durable claim.)
4. **Digest determinism** (constraint on the backup contract): two envelopes differing only in
   `settings_kv` row order produce identical `contentDigestOf`; differing in one value produce
   different digests.
5. **Frozen legacy table** (prevents resurrection): a source-scan test asserting no file outside
   `schema.js` references the `settings` table in SQL.
6. **Boundary behavior:** legacy-object conversion (incl. `accent_metal` dropped, unknown keys
   preserved), non-array `settings_kv` rejected `malformed`, absent settings yields defaults,
   `future` rejection at 13.
7. **Isolation and cascade:** two profiles' KV rows never cross via `getSettings`/`setSetting`;
   deleting a profile removes its KV rows.
8. **Existing suites** run unmodified except where the contract genuinely changed
   (`profileRoundTrip` settings handling, `replaceAll` table list); each such edit is called out
   individually in review, per the never-weaken-a-test rule.
9. **Device (both stages):** fresh install; upgrade over real v11 data with non-default settings;
   settings UI exercised; profile import of a pre-v12 bundle; `check:smoke`. Report device, OS,
   WebView version, build type per `AGENTS.md` §Phase F.

## Security, privacy, performance, and operations

- **Security:** the identifier-interpolation surface in `setSetting` is deleted (key becomes a
  bound value). Imported keys/values are inert strings bounded by `rowsPerTable`; readers parse
  through the registry, so a crafted value degrades to a default, never executes or renders.
- **Privacy:** settings contain no personal content beyond preferences; unchanged exposure.
- **Performance:** `getSettings` goes from one row to ≤12 rows via the primary key - unmeasurable.
  The four indexes strictly remove full scans on paths that run per deck on every import and on
  every match write. Index storage cost is trivial at this data scale. Migration v12 is a one-time
  ≤17-statement boot step.
- **Operations:** no new commands, no dependency, no native config change. The distribution note
  for the v12 release names the one-time bundle-compatibility break for testers.

## Risks and unanswered questions

| Risk | Likelihood | Impact | Mitigation / owner |
|---|---|---|---|
| `INSERT ... SELECT` misbehaves on some OEM native build | Low (v6 precedent) | Boot failure on upgrade - severe | Device gate before release; designed fallback (lazy read-through); Claude owns |
| A settings consumer depends on SQLite's column typing in a way the registry parse misses | Low | Wrong-typed preference value | Registry tests assert exact output types vs today's `getSettings`; callers traced in review |
| Restore/equivalence machinery treats the unit's `settings_kv` unexpectedly (e.g. `replaceAll` fixtures, recovery previews) | Medium | Test churn, or a false stale-archive mismatch in the field | Digest shuffle test; explicit review of `replacePlan`/`recoveryStore` consumers in Stage 2; Codex directed at it |
| Reverted-APK scenario loses post-v12 settings edits | Certain if a revert happens | Cosmetic (preferences) | Stated in Rollback; owner accepts or rejects the stage on it |
| The one-time `future` break annoys testers mid-alpha | Certain | Low | Release-note callout; it is also the last such break for settings |

**Decisions required from the owner:** F4/F5/F6 dispositions (§Design 6 recommendations); the
unknown-keys-preserved choice (§Options E.3); acceptance of the reverted-APK settings caveat; and
timing of the eventual v13 drop (not part of this proposal).

## Self-Critique

**Strongest case this design is wrong.** Twelve settings in five years is not a crisis, and this
proposal spends a schema version, an import-format change, and edits across the most safety-critical
files in the repository (`db.js`, `profileTransfer.js`, `importBoundary.js`) to optimize the cost of
adding a thirteenth. Option D (codegen over columns) or even disciplined use of the existing pattern
plus one drift-detection test would remove the *silent* part of the failure for a tenth of the
diff. The rebuttal is that the runner fix is mandatory regardless, the indexes are mandatory
regardless, and once those are paid for, the KV table is the only piece bought purely for the
six-place problem - and it deletes two standing hazards (the hardcoded import UPDATE and the
identifier interpolation) rather than adding machinery. But the reviewer should weigh the diff
honestly: most of this proposal's risk lives in Stage 2, and most of its non-negotiable value lives
in Stages 1 and the four `CREATE INDEX` lines.

**Highest-consequence assumption if false:** assumption 2 (`INSERT ... SELECT` under native
`execSQL`). Consequence is boot failure on upgrade - the worst failure this app has. It is also the
best-mitigated: device-gated before ship, per-key statement isolation, and a designed fallback that
removes the statement class entirely.

**Simpler solution rejected, and was it rejected fairly?** The JSON blob. Partially fair: the
lost-update window argument is real but thin for single-user, low-frequency writes, and this
proposal says so rather than leaning on it. The load-bearing rejection is `json_set()` availability
across OEM builds - a class of divergence this project has been bitten by twice (v11 `SELECT 1;`,
the native statement splitter) - plus losing per-row bounds checking. If the owner reads the blob's
risks differently, the boundary and registry work transfers to it almost unchanged; the schema
migration gets smaller; only the per-key SQL properties are lost.

**Coupling the analysis may have missed:** everything that consumes a profile *unit* by shape -
`replaceAll`, `recoveryStore`, equivalence comparison in the restore design, `summarise` counts -
inherits `settings_kv` through `ITERATED_COLLECTIONS`. That inheritance is the design working as
intended, but it means Stage 2's blast radius is "every consumer of the list", and one of them
(restore equivalence, `restore-semantics.md` §7) is itself still pre-implementation. If both land
in the same window, coordination is required or one will rebase over the other's unit shape.

**Failure most likely to escape the test plan:** a field device in a migration state the matrix
does not model - the matrix simulates statement-prefix interruptions of *our* migrations, but a
device that hit the old runner's bug in some other sequence (e.g. tolerated-abort inside v10's
DELETEs after a manual data edit) could present a shape no test constructs. Mitigation is the
posture, not a test: every v12 statement is individually idempotent and the preamble re-asserts
the only columns v12 reads, so the runner converges rather than assuming.

**Evidence that would change the direction:** an OEM device failing the `INSERT ... SELECT` copy
(switch to the lazy read-through fallback); Codex demonstrating that unit-shape consumers need
non-trivial rework (fold `settings_kv` handling into the restore effort's timeline instead of this
one); or the owner deciding the bundle-compat break mid-alpha is unacceptable this cycle (Stage 1
and the indexes still ship - they are severable and carry no format change; only the KV table
waits).

## Approval record

| Date | Who | Disposition |
|---|---|---|
| 2026-08-14 | Claude | Revision 1 drafted |
| | Codex | Pending review |
| | Owner | Pending decisions (§Risks) and approval |
