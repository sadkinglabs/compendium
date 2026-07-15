# Compendium — Data and Profile Model

> **Purpose:** define Compendium's current persistence architecture, ownership boundaries, schema contracts, derived-data rules, transfer formats, and recovery requirements.
>
> **Executable authority:** `src/store/schema.js` defines the deployed SQLite schema and current `SCHEMA_VERSION`. This document explains the intended semantics of that schema. Any discrepancy is a defect to resolve explicitly; neither source may be silently assumed correct.

## 1. Current schema baseline

- **Schema version:** 9
- **Database:** `compendium.db` on Capacitor/SQLite; an exported SQLite image persisted in IndexedDB for the browser sql.js runtime
- **Schema version record:** `_meta.schema_version`
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
- saved references, notes, highlights, anchored annotations, links, and named Codex collections;
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
├─ annotations ─ anchors
├─ saved / notes / highlights / links
├─ dashboard_blocks / dashboard_layouts / resume
└─ settings
```

A child-table query is profile-safe only when it joins or first resolves through its profile-owned parent. Possession of a child or parent identifier is not authorization to access another profile's data.

## 3. Runtime storage architecture

| Concern | Browser | Capacitor/Android | Contract |
|---|---|---|---|
| Relational data | sql.js in memory, persisted as a database image in IndexedDB | `@capacitor-community/sqlite` | Same schema and repository API |
| Active profile | Capacitor Preferences web adapter | Native Preferences | One `activeProfileId` key |
| Files and sharing | Browser download, file picker, clipboard/share fallbacks | Filesystem and Share plugins | Same validated domain payloads |
| Catalog assets | Bundled application data and configured art sources | Bundled application data and configured art sources | Images are optional; catalog text remains usable |

`localStorage` may hold non-authoritative UI or diagnostic preferences, but it must not become a profile data store. Browser persistence is a supported runtime, not merely an in-memory preview.

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

### Rules and relationships

```sql
rules(rule_id PRIMARY KEY, parent_id, title, content, system)
faqs(faq_id PRIMARY KEY, question, answer, card_ids, source)
link_graph(source_id, source_type, target_id, target_type)
catalog_meta(key PRIMARY KEY, value)
```

`rules.parent_id` distinguishes top-level articles from sub-entries. `link_graph` supports indexed source and target lookups. `catalog_meta` stores catalog and application seed metadata; callers must namespace keys to avoid collisions.

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
highlights(id, profile_id, target_type, target_id, text, comment, created_at)
links(id, profile_id, kind, a_type, a_id, b_type, b_id, description, created_at, updated_at)
```

`saved` represents whole-target bookmarks. `notes` and `highlights` remain supported persisted records.

### Anchored annotations

```sql
annotations(
  id TEXT PRIMARY KEY,
  profile_id REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  group_id TEXT,
  doc_type TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  build_hash TEXT,
  color TEXT,
  comment TEXT,
  state TEXT NOT NULL DEFAULT 'anchored',
  created_at TEXT,
  updated_at TEXT
)

anchors(
  annotation_id PRIMARY KEY REFERENCES annotations(id) ON DELETE CASCADE,
  canon_start INTEGER,
  canon_end INTEGER,
  quote_exact TEXT NOT NULL DEFAULT '',
  quote_prefix TEXT NOT NULL DEFAULT '',
  quote_suffix TEXT NOT NULL DEFAULT '',
  block_hint TEXT
)
```

Anchors use canonical offsets plus quote context so catalog changes can re-anchor honestly or mark an annotation orphaned. `block_hint` is a rendering aid, not durable identity.

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
  duration_sec INTEGER,
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

## 10. Home data

```sql
dashboard_blocks(id, profile_id, type, width, config, sort_order, created_at)
dashboard_layouts(id, profile_id, name, blocks, saved_at)
resume(profile_id PRIMARY KEY, target_type, target_id, title, at)
```

Dashboard blocks store type-specific JSON configuration and ordering. Named layouts store snapshots of the block arrangement. Home reads domain repositories to build cross-pillar widgets; it does not duplicate domain records.

## 11. Repository and transaction boundaries

- Repositories inject the active profile rather than accepting an arbitrary profile from UI code.
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

1. `annotations` and `anchors` are not included in profile export/import.
2. `schemaVersion` is written but is not currently used to reject unsupported future bundles or run explicit bundle transformations.
3. The destination profile is created before the row-import transaction; a failed import can therefore leave an empty profile requiring cleanup.

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
