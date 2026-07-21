# Compendium — Data and Profile Model

> **Purpose:** define Compendium's current persistence architecture, ownership boundaries, schema contracts, derived-data rules, transfer formats, and recovery requirements.
>
> **Executable authority:** `src/store/schema.js` defines the deployed SQLite schema and current `SCHEMA_VERSION`. This document explains the intended semantics of that schema. Any discrepancy is a defect to resolve explicitly; neither source may be silently assumed correct.

## 1. Current schema baseline

- **Schema version:** 11
- **Database:** `compendium.db` on Capacitor/SQLite; an exported SQLite image persisted in IndexedDB for the browser sql.js runtime
- **Schema version record:** `_meta.schema_version`
- **Ledger canonicalisation record:** `_meta.owned_cards_canonical_version` (see below)
- **Active profile singleton:** Capacitor Preferences key `activeProfileId`
- **Schema evolution:** ordered entries in `MIGRATIONS` within `src/store/schema.js`
- **Repository gate:** `activeProfileId()` in `src/store/profileRepository.js`

The schema is forward-evolving. Every schema change increments `SCHEMA_VERSION`, appends an ordered evolution step, and preserves retry safety. Persisted data must never depend on a component's transient state for durability.

## 2. Ownership boundary

Compendium has two data tiers.

### 2.1 Shared catalog

Cards, rules, FAQs, relationships, and catalog metadata are shared across profiles. Catalog rows have no `profile_id` and are treated as application-managed reference data.

### 2.2 Profile-owned data

Everything a user creates, records, arranges, or marks belongs to exactly one profile. This includes:

- owned and wanted cards;
- custom and wanted card lists;
- decks and deck history;
- saved references, notes, links, and named Codex collections;
- matches and match-log entries;
- Dashboard blocks, layouts, and resume state;
- settings.

Top-level profile tables carry `profile_id`. Child tables inherit ownership through a foreign-key parent:

```text
profiles
├─ owned_cards
├─ card_lists ── card_list_entries
├─ decks ─────── deck_entries
│                deck_history
├─ collections ─ collection_items
├─ matches ───── match_log_entries
├─ saved / notes / links
├─ dashboard_blocks / dashboard_layouts / resume
└─ settings
```

A child-table query is profile-safe only when it joins or first resolves through its profile-owned parent. Possession of a child or parent identifier is not authorization to access another profile's data.

## 3. Runtime storage architecture

| Concern | Browser | Capacitor/Android | Contract |
|---|---|---|---|
| Relational data | sql.js in memory, persisted as a database image in IndexedDB | `@capacitor-community/sqlite` | Same schema and repository API |
| Active profile | Capacitor Preferences web adapter | Native Preferences | One `activeProfileId` key |
| App-global install state | Capacitor Preferences web adapter | Native Preferences | Small, non-profile singletons. Currently one key: `changelogSeenBuild`, the last build whose release notes were dismissed |
| Files and sharing | Browser download, file picker, clipboard/share fallbacks | Filesystem and Share plugins | Same validated domain payloads |
| Catalog assets | Bundled application data and configured art sources | Bundled application data and configured art sources | Images are optional; catalog text remains usable |

`localStorage` may hold non-authoritative UI or diagnostic preferences, but it must not become a profile data store. Browser persistence is a supported runtime, not merely an in-memory preview.

**App-global Preferences keys are not user data and are never exported.** `changelogSeenBuild` describes *this install on this device*, not the person using it: it is deliberately outside the profile boundary and outside `profileTransfer`. A profile-owned equivalent would replay the release notes on every profile switch, and a profile imported from another device would carry a foreign stamp that either suppresses unread notes or replays read ones. Anything with that shape — install-local, not owned by whoever is signed in — belongs in this tier rather than in `settings`. Losing a key here costs at most one redundant modal, which is why it may live outside the durable-write guarantee that governs user data.

## 4. Shared catalog schema

### `cards`

```sql
cards(
  card_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  sub_types TEXT,             -- JSON string[]
  rarity TEXT,
  elements TEXT,              -- JSON string[]
  cost INTEGER,
  attack INTEGER,
  defence INTEGER,
  life INTEGER,
  thresholds TEXT,            -- JSON object
  rules_text TEXT,
  is_avatar INTEGER DEFAULT 0,
  is_site INTEGER DEFAULT 0,
  sets TEXT,                  -- JSON array
  variants TEXT,              -- JSON array
  image_slug TEXT,
  system TEXT DEFAULT 'sorcery'
)
```

`card_id` is the durable identity used by profile data. Display names are searchable and import-friendly but are not durable foreign keys.

`variants` holds one entry per physical printing: `{ slug, set, setName, finish, product, artist, flavorText, image }`. `image` is the bundled per-printing WebP (the finish-stripped base name), or `null` for a printing with no bundled art. No external image URL is stored - art is bundled for the offline-first constraint. `sets` is the card-level distinct-set list, each `{ name, code }`. Set codes: `001` Alpha, `002` Beta, `004` Arthurian Legends, `005` Dragonlord, `006` Gothic, `999` Promotional (there is no `003`). **Set metadata is data-derived, not hardcoded:** the pipeline writes the code-to-name map to `src/store/setCatalog.json`, and `src/store/sets.js` reads those names while deriving display order from the numeric code (sequential by design). A new set therefore needs no source edit - its name arrives with its cards and its order slots in by code.

### Rules and relationships

```sql
rules(rule_id PRIMARY KEY, parent_id, title, content, system)
faqs(faq_id PRIMARY KEY, question, answer, card_ids, source)
link_graph(source_id, source_type, target_id, target_type)
catalog_meta(key PRIMARY KEY, value)
```

`rules.parent_id` distinguishes top-level articles from sub-entries. `link_graph` supports indexed source and target lookups. `catalog_meta` stores catalog and application seed metadata; callers must namespace keys to avoid collisions.

### Catalog versioning and reseed

The shared catalog is bundled reference data that is reseeded whole when its content changes. `src/store/catalogVersion.json` is a generated `{ version, hash }` token: `version` is a human-facing integer (currently **5**), and `hash` is a SHA-256 over the exact serialised generation (cards, articles, FAQs, link graph, the sorted image manifest, and the compiled Codex build hash). `src/store/catalog.js` imports it as `CATALOG_VERSION`.

On boot, the seeder compares `catalog_meta.version` against `CATALOG_VERSION` by **string equality**, not ordering. On a mismatch it clears and reloads `cards`, `rules`, `faqs`, and `link_graph` in one atomic `tx()`, then writes the new token; a matching token is a warm boot that does nothing. No profile-owned table is touched by a reseed, and `card_id` stays `cardSlug(name)` across generations, so `owned_cards.card_id`, `deck_entries.card_id`, and marginalia targets keep resolving with no migration when the catalog is replaced.

The token is written by the catalog-update pipeline (`npm run update:catalog`, see `BUILD.md`), never by hand, and the pipeline only bumps `version` when the content hash actually changes. A routine content update therefore edits no source, and an unchanged catalog never re-seeds. This is a content-generation mechanism, not schema evolution: `SCHEMA_VERSION` is unaffected by a catalog update.

## 5. Profiles and settings

### `profiles`

```sql
profiles(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,                -- JSON descriptor or null
  accent TEXT DEFAULT 'gold',
  system TEXT DEFAULT 'sorcery',
  schema_version INTEGER NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
)
```

Compendium guarantees at least one profile and exactly one protected default profile. First launch creates the default `Sorcerer` profile. The default and sole remaining profile cannot be deleted. Profile switching persists `activeProfileId`; the application then clears cross-profile UI state and reloads the new partition.

### `settings`

```sql
settings(
  profile_id PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  accent_metal TEXT DEFAULT 'gilded',   -- retained compatibility column; not restored by profile import
  film_grain INTEGER DEFAULT 1,
  keep_awake INTEGER DEFAULT 1,
  immersive INTEGER DEFAULT 1,
  default_max_life INTEGER DEFAULT 20,
  die_type INTEGER DEFAULT 6,
  haptics INTEGER DEFAULT 1,
  rarity_colors INTEGER DEFAULT 0,
  theme TEXT DEFAULT 'grimoire',
  persist_search INTEGER DEFAULT 0,
  font_scale REAL DEFAULT 1,
  high_contrast INTEGER DEFAULT 0,
  reduced_motion INTEGER DEFAULT 0
)
```

Setting column names are whitelisted in `playRepository.js` before interpolation into SQL. New settings require coordinated schema, default, transfer, UI, and documentation updates.

## 6. Collection data

Collection owns physical-card inventory, wanted quantities, and card lists.

```sql
owned_cards(
  id TEXT PRIMARY KEY,
  profile_id REFERENCES profiles(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  variant_slug TEXT NOT NULL DEFAULT '',
  qty_owned INTEGER NOT NULL DEFAULT 0,
  qty_wanted INTEGER NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(profile_id, card_id, variant_slug)
)

card_lists(
  id TEXT PRIMARY KEY,
  profile_id REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'custom',  -- custom | wanted
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
)

card_list_entries(
  id TEXT PRIMARY KEY,
  list_id REFERENCES card_lists(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  variant_slug TEXT NOT NULL DEFAULT '',
  added_at TEXT,
  UNIQUE(list_id, card_id, variant_slug)
)
```

### The `owned_cards.variant_slug` vocabulary

`variant_slug` records *which set* a copy belongs to. Ownership is per set (v1), so a card's copies are spread across one row per bucket it is owned in; the `UNIQUE(profile_id, card_id, variant_slug)` key and every `ON CONFLICT` upsert key on that triple.

| `variant_slug` | Meaning |
|---|---|
| `''` | Unspecified - owned without a recorded set. The wishlist (`qty_wanted`) lives only on this row |
| `'foil'` | legacy card-level foil, no recorded set |
| `'<code>'`, e.g. `'001'` | owned in that set (Alpha) |
| `'<code>:f'`, e.g. `'001:f'` | that set's foil |

**Foil classification recognises both forms.** A copy is foil when `variant_slug = 'foil'` OR `variant_slug LIKE '%:f'`. Foil-sensitive card-level aggregates (`ownWantMap`, `qtyFor`, `recentlyAdded`) must honour both, or a per-set foil reads as a regular copy and the card view disagrees with the set view. `ownedMap` and buildability sum `qty_owned` across every row regardless of set or finish, so the per-set key never affects ownership totals or deck comparison.

**Single-set boot backfill.** `backfillSingleSetOwned()` (run once per boot from `App.jsx`) moves owned copies out of the `''` bucket onto their set row for any card that exists in exactly one set, where the printing is then unambiguous. It runs in one transaction that adds the exact quantity to the set row and subtracts that same quantity from `''` (subtract-exact, not blind-delete), so a copy added to `''` concurrently - a scanner scan mid-boot - is not lost; any leftover stays in `''` for the next pass, and the `''` row is deleted only once it fully drains (preserving a wishlist that lives on it). Multi-set cards (Alpha/Beta reprints) stay Unspecified because the printing is not knowable from the name. The backfill is idempotent and forward-only: an app-level data canonicalisation, not schema evolution - it makes no `SCHEMA_VERSION` bump and adds no `MIGRATIONS` entry.

Collection invariants:

- Ownership is a ledger, not an allocator; decks never reserve cards.
- Negative quantities are normalized away by the repository.
- Rows with zero owned and zero wanted quantity are removed rather than retained as empty state.
- Buildability and wanted-list progress are derived reads.
- Token cards do not count toward collectible ownership totals.
- `owned_cards` is unrelated to the deck zone named `collection`.
- `card_lists` is unrelated to Codex `collections`.

## 7. Deck data

```sql
decks(
  id TEXT PRIMARY KEY,
  profile_id REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  archetype TEXT,
  avatar_card_id TEXT,
  avatar_slug TEXT,
  cover_slug TEXT,
  notes TEXT,
  curiosa_url TEXT,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  starred INTEGER DEFAULT 0,
  lib_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
)

deck_entries(
  id TEXT PRIMARY KEY,
  deck_id REFERENCES decks(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,          -- spellbook | atlas | collection
  card_id TEXT,               -- null permits an unresolved imported entry
  quantity INTEGER DEFAULT 1,
  variant_slug TEXT DEFAULT ''
)

deck_history(id PRIMARY KEY, deck_id REFERENCES decks(id) ON DELETE CASCADE, ts, text)
```

Deck legality, copy limits, special-avatar rules, and zone constraints are domain logic derived from catalog data. They are not encoded as per-card SQL constraints.

`decks.wins` and `decks.losses` are synchronized derivatives of linked matches. Matches are the source of truth for the record. Deck history is bounded by repository logic.

## 8. Codex personal data

### Document-level records

```sql
saved(id, profile_id, target_type, target_id, created_at)
notes(id, profile_id, target_type, target_id, body, created_at, updated_at)
links(id, profile_id, kind, a_type, a_id, b_type, b_id, description, created_at, updated_at)
```

`saved` represents whole-target bookmarks. `notes` and `links` remain supported persisted records.

### The collector item (schema v11)

One collector item is exactly `card_id + set + finish`. Alpha non-foil, Alpha foil, Beta
non-foil and Beta foil are four distinct items for a card printed in both sets. Catalog
`variants[]` may hold several art or product records inside one set; those are NOT additional
ownership identities.

`owned_cards.variant_slug` stores that identity:

| key | meaning |
|---|---|
| `001` | Alpha, non-foil |
| `001:f` | Alpha, foil |
| `uncategorised` | owned copies whose set is not established yet, non-foil |
| `uncategorised:f` | the same, foil |

v11 changed no DDL. The column was already `TEXT NOT NULL DEFAULT ''` inside the unique index
`(profile_id, card_id, variant_slug)`; the canonical keys are different *string values* in that
column, so there was no table to rebuild and no default to change.

**The v10 keys it replaced.** `''` meant both "set not established" for `qty_owned` AND the only
row a `qty_wanted` could live on - so a want identified neither its set nor its finish, and
dropping stale `''` rows would have destroyed the wishlist. `'foil'` was the card-level foil row.
Both are still *readable* (`printings.js` recognises all four forms) so a partially converted
ledger reads correctly, but no writer emits them.

**Wants.** A want is a property of a collector item, exactly like ownership. New wants always
identify set and finish; entry points ask when either is unknown. An *uncategorised want* is a
transitional state that only migration, import and triage may create or hold - the want
repository refuses to produce one.

**Canonicalisation, not migration.** Deciding where an ambiguous legacy want belongs requires
the catalog, and `openDatabase()` applies `MIGRATIONS` before `seedCatalogIfNeeded()`. So the
data conversion is a separate boot step:

    DDL -> seed catalog -> canonicalise ledger -> initProfiles() -> Collection reachable

It runs in one transaction over every profile, asserts no legacy key survived, and records
`_meta.owned_cards_canonical_version = 11` in that same transaction. The marker is an
optimisation only: a boot that finds legacy rows converts them regardless of what it says,
because the ledger shape is the invariant. Failure is closed - the transaction rolls back and
boot fails rather than exposing a half-converted ledger.

**Import.** Profile bundles carry `schemaVersion`. Import validates and normalises the whole
bundle in memory *before* creating anything, rejecting bundles from newer builds; profile,
settings and imported rows share one transaction, so a rejection or failure leaves no orphan.

### Anchored annotations (removed in schema v10)

Earlier builds stored offset-anchored highlights in `annotations` and `anchors`. The
feature was pruned and both tables were dropped by migration v10: an anchor pinned to a
canonical character offset could not be kept correct as the catalog was rephrased, so a
content update orphaned highlights wholesale. Notes, links, and bookmarks - which attach
to a whole reference target rather than a text offset - are unaffected and remain.

### Named Codex collections

```sql
collections(id, profile_id, name, created_at)
collection_items(id, collection_id REFERENCES collections(id) ON DELETE CASCADE,
                 target_type, target_id, added_at)
```

These collections group reference targets. They do not represent physical ownership or Collection pillar lists.

## 9. Play data

```sql
matches(
  id TEXT PRIMARY KEY,
  profile_id REFERENCES profiles(id) ON DELETE CASCADE,
  played_at TEXT,
  mode TEXT,                   -- full | quick
  player_avatar TEXT,
  opponent_name TEXT,
  opponent_avatar TEXT,
  player_final_life INTEGER,
  opponent_final_life INTEGER,
  winner TEXT,                 -- player | opponent | draw
  duration_sec INTEGER,        -- NULL/<=0 = untimed. See "Match duration" below.
  notes TEXT,
  deck_id TEXT                 -- soft link; match survives deck deletion
)

match_log_entries(
  id TEXT PRIMARY KEY,
  match_id REFERENCES matches(id) ON DELETE CASCADE,
  t TEXT,
  who TEXT,                    -- player | opponent
  kind TEXT,                   -- life | max
  delta INTEGER,
  to_life INTEGER,
  to_max INTEGER
)
```

Match completion and its log commit together. When a valid active-profile deck is linked, its history and derived record update in the same transaction. `deck_id` is intentionally a soft link so deleting a deck does not delete match history.

Opponents are match attributes, not profiles or cross-profile relationships.

### Ongoing match (resumable snapshot)

An in-progress match is **not** a `matches` row. It is a transient, resumable snapshot held
in `localStorage` under a profile-scoped key (`cx-ongoing-match:<profile_id>`,
`src/store/ongoingMatch.js`) carrying life/max, the in-match log, banked elapsed time,
avatars, and a `recorded` flag. Its **serialized shape, defaults, and `SNAP_VERSION` are
owned by `src/store/matchSnapshot.js`** (`buildMatchSnapshot`/`readMatchSnapshot`/
`isValidMatchSnapshot`) - the single contract that `LifeCounter` (producer), `App.resumeMatch`,
and `ongoingMatch.js` (the localStorage adapter) all import, so build and restore cannot drift. It is authoritative only for *resuming*; completed history
lives in `matches` above, written on record. This is the §"localStorage is non-authoritative
UI state" rule in practice: losing the snapshot costs at most an in-progress game's
resumability, never recorded history.

Lifecycle: it is written when the live counter is minimized **and** whenever the app is
backgrounded or torn down (`visibilitychange → hidden` / `pagehide`), so a live match
survives process death. It is cleared on exit, record-then-exit, new-match, and when a resume
consumes it. On load it is validated (finite fields, `SNAP_VERSION`) and its life/max are
clamped to `1..20` / `0..max` by `matchLife.js` on restore, so a stale or malformed snapshot
cannot resume into an impossible total. Because the key is resolved from the active profile at
write time it is profile-isolated; on boot it is reconciled **after** `initProfiles()` has
resolved the active profile (a first-render read has no profile to scope to and is discarded).

### Match duration

`duration_sec` is nullable and encodes three states, two of which mean the same thing:

| value | meaning |
|---|---|
| `> 0` | timed — the live tracker measured it, or a person entered it |
| `<= 0` | untimed, historical — earlier writers coerced unknown durations to `0` |
| `NULL` | untimed, current |

**Untimed is not zero-length.** A match of zero seconds cannot occur, so `> 0` reads
correctly over every row ever written and no migration was required when the distinction
was introduced.

Every path that persists or serialises a duration normalises it through
`normalizeDurationSec()` (`src/store/matchStats.js`), which maps absent, empty,
unparseable, negative, and zero to `NULL` and guarantees its result is `NULL` or `> 0`.
The earlier `|| 0` idiom destroyed the distinction before it reached a column that had
always permitted it. The paths are `recordMatch`, `addManualMatch`, `updateMatch`,
profile-bundle import (`profileTransfer.js`), and the outbound match share
(`matchShare.js` — a serialisation boundary rather than a writer, normalised for the same
reason). **Profile restoration is deliberately not a fidelity exception:** `0`, negative,
and malformed values already *mean* untimed, so mapping them to `NULL` preserves the
semantics rather than bending them, and loses no information because there was none.

Aggregates come from `computeMatchStats()` in the same module, and it is the **only**
implementation. It reads through the same normaliser, so a malformed or hostile row
cannot poison a total. `avgSec`/`avgMin` divide by the timed matches — the ones actually
summed — and are `NULL`, never `0`, when none are timed: *no timed matches* and *an
average of zero minutes* are different statements. Dividing by the full match count
instead is a defect that silently worsens as untimed matches accumulate.

Two surfaces read these aggregates and **describe different populations**: the Play hub
computes over at most `listMatches(500)`, while `historyStats()` queries the profile's
entire history. That difference predates the shared calculation and is not corrected by
it.

## 10. Home data

```sql
dashboard_blocks(id, profile_id, type, width, config, sort_order, created_at)
dashboard_layouts(id, profile_id, name, blocks, saved_at)
resume(profile_id PRIMARY KEY, target_type, target_id, title, at)
```

Dashboard blocks store type-specific JSON configuration and ordering. Named layouts store snapshots of the block arrangement. Home reads domain repositories to build cross-pillar widgets; it does not duplicate domain records.

## 11. Repository and transaction boundaries

- Repositories resolve the active profile rather than accepting an arbitrary profile from UI code; the interactive Collection ledger writers additionally accept an explicit `profileId` (defaulting to the active one) so a queued edit stays bound to the profile it was scheduled under.
- **Interactive Collection ledger writes** (the `owned_cards` / `card_list_entries` steppers) serialize through a store-layer per-row queue (`src/store/collectionWrites.js`), keyed per persisted row. `qty_wanted` and unspecified `qty_owned` share the `variant_slug=''` row, so they commit on **one** chain and a re-read inside each turn stops either from restoring the other's stale column. Every queued write is bound to the `profileId` captured at schedule time, so a mid-edit profile switch cannot redirect it, and `switchProfile` **drains the queue before** changing the active profile (preserving the in-flight edit).
- **Batch/atomic ledger writers** (scanner add, resolved import, single-set backfill, add-missing-to-wishlist) stay *outside* that queue by design: each captures the profile once and writes atomically or in a single `tx`, and is lifecycle-exclusive from the interactive steppers.
- **Bulk ledger commands** (`src/store/bulkOwnedRepository.js`) are the exception, and they do **not** merely stay outside the queue - they take an **exclusive barrier** over it (`withExclusiveCollectionWrites`). A bulk command computes absolute after-values from an authoritative read, so without exclusivity a per-row write can commit between that read and the transaction and be overwritten by it: an atomic transaction that still silently loses a concurrent edit. The barrier admits work already in flight, parks anything arriving after it, and **fails closed** - if in-flight writes do not drain, the command does not run. `switchProfile` takes the same barrier (tolerant variant: queued writes carry their own `profileId`, so a hung write cannot trap the user in a profile).
- **Bulk results are confirmed or nothing.** Counts come from an authoritative read-back, never from the plan. If the read-back fails or disagrees, the result is `confirmed: false` with **null** counts and **no undo offered** - reversing a write we cannot describe is worse than offering nothing. A broadcast still fires whenever a transaction executed, as cache invalidation rather than a success claim.
- **Bulk undo is conditional, not an inverse delta.** The undo record stores each row's before **and** committed-after value, and the restore statement only touches a row while it still holds the committed-after value (`UPDATE … WHERE qty_owned = ?`). An inverse delta cannot express "ensure at least 1" and would silently discard any edit made in between; conflicts are reported from a read-back after the restore. Undo is session-scoped - durable cross-restart undo would need persisted operation history (v11).
- Mutations that affect multiple rows use `tx()` where atomicity is required.
- Imported collection quantities and lists are planned/validated before batch writes.
- Deck imports preserve unresolved cards visibly rather than silently discarding them.
- Match completion, log persistence, deck history, and record synchronization share a transaction.
- Profile deletion relies on `ON DELETE CASCADE`; the protected default and last-profile rules are enforced before deletion.
- Dynamic SQL identifiers are permitted only through explicit whitelists.
- Profile-import boundaries sanitize external URLs, and rendered external links must pass `safeHref`.

## 12. Import, export, and sharing contracts

### Decks and lists

- Curiosa URL import resolves supported deck data into one profile-owned deck and its three zones.
- Text import supports the documented deck formats and reports unresolved cards.
- Deck exports are derived from authoritative `deck_entries` and catalog data.
- Collection/list exports are derived from the ownership and list repositories.
- Deck posters and share payloads are derived artifacts, never authoritative stores.

### Profile bundles

A profile bundle is self-describing JSON containing:

```text
app: "compendium"
schemaVersion: integer
exportedAt: ISO timestamp
profile: portable profile metadata
profile-owned table payloads
```

Import creates a new profile and re-keys profile-owned entity identifiers. Catalog identifiers remain stable. URLs in imported configuration are sanitized, and deck records are recomputed from imported matches.

### Current transfer gaps

The current `profileTransfer.js` implementation does not yet satisfy the complete data contract:

1. `schemaVersion` is written but is not currently used to reject unsupported future bundles or run explicit bundle transformations.
2. The destination profile is created before the row-import transaction; a failed import can therefore leave an empty profile requiring cleanup.

These are known data-integrity gaps. They require a reviewed proposal and focused transfer tests before profile export can be considered a complete backup of all profile-owned data.

## 13. Search and derived data

Universal search is implemented through domain repositories, not a SQLite FTS table:

- Codex searches rules, cards, card text, article text, and active-profile marginalia.
- Deck and match result sets are loaded through profile-scoped repositories and filtered for the query.
- Results are grouped by domain for the application shell.

Derived values are never treated as independent authority:

- deck buildability derives from `deck_entries` and `owned_cards`;
- wanted-list progress derives from `card_list_entries` and `owned_cards`;
- deck records derive from linked `matches`;
- Home summaries derive from active-profile repositories;
- card and deck presentation metadata derives from catalog rows.

If performance requires indexing or FTS, that change must preserve repository contracts and profile isolation and must be justified with measurements.

## 14. Schema evolution and recovery

Schema evolution is forward-only and ordered by integer version. Each step must:

- be safe to re-run where the database adapter may retry after interruption;
- preserve existing profile ownership;
- create indexes needed for changed access paths;
- avoid destructive assumptions about rollback;
- define validation and forward-recovery behavior;
- run against both sql.js and native SQLite semantics.

Code rollback does not imply data rollback. Once a device has opened a newer schema, recovery normally means forward repair or restoring a separately verified backup.

## 15. Data-model verification requirements

Changes affecting persistence must verify, as applicable:

- fresh database creation at the current schema version;
- ordered upgrade from representative earlier schema versions;
- interruption and retry behavior;
- active-profile isolation for reads, writes, updates, and deletes;
- foreign-key cascade behavior for parent/child tables;
- transaction rollback under a failing multi-row operation;
- malformed, duplicate, future-version, and partially valid imports;
- browser sql.js/IndexedDB and native SQLite behavior;
- export/import round trips for every profile-owned data class;
- derived-data reconciliation after imports and deletions.

The feature is not complete if a persisted user record can be silently lost, crossed into another profile, or omitted from the documented backup contract.
