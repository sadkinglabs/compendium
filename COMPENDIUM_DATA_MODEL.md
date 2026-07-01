# Compendium — Unified Data & Profile Model (§0 Step 2 / Handoff §4)

> The highest-care piece. Built from zero (no legacy migration — D1/D2). Profiles are universal and tied to **everything** the user creates. This document defines the on-device store, the profile partition, every table, the settings model, and how the deck import/export and universal search sit on top. **Reviewed before any UI or store code is written.**

---

## 1. Principles (the boundary, decided day one)

1. **Two tiers, never blurred:**
   - **Catalog** = shared, read-only reference content (cards, rules, FAQs, link graph). Ships with the app, updatable as *data*. **No `profileId`.** Identical for every profile.
   - **Profile data** = everything the user creates or marks (decks, marginalia, highlights, collections, links, saved, matches, match logs, dashboards, settings, resume). **Every row owns exactly one `profileId`.**
2. **Profile isolation by construction.** No screen, query, or repository call reads profile data without the active `profileId` injected by a single gate. It is structurally impossible to show profile A's decks beside profile B's matches.
3. **Offline-first, native-backed.** Every write commits to the native store immediately. No authoritative state lives only in webview memory or `localStorage`.
4. **Expandable by data, not code.** New card sets, elements, types, archetypes, even a second game `system` are additive rows + a tag — not a schema rewrite.
5. **Fresh start.** No reading of legacy `lexicum-*` / `arc-*` / `vitarum-*` stores. Ever.

---

## 2. Storage technology (Capacitor-native, per §4-C)

| Concern | Tech | Why |
|---|---|---|
| Catalog + all list-shaped profile data | **SQLite** (`@capacitor-community/sqlite`) | Indexed + transactional; powers universal search (FTS) and atomic deck/match writes. One DB file: `compendium.db`. |
| App singletons (`activeProfileId`, `globalSchemaVersion`, `lastBackupAt`, onboarding flag) | **`@capacitor/preferences`** | Native `UserDefaults`/`SharedPreferences`; survives backup rules; tiny. **Never** holds profile *content*. |
| Export / import files, card-art cache | **`@capacitor/filesystem`** (+ `@capacitor/share`) | Portable profile bundles; native share sheet; art cache dir. |
| Haptics / status bar / keep-awake / back button | Capacitor plugins | Per §6 — native over web shims. |

**Partition strategy — single DB, enforced `profile_id` (LOCKED).** One `compendium.db`; catalog tables have no `profile_id`; every profile-data table has `profile_id NOT NULL` + FK to `profiles(id)` + index. All access goes through a `ProfileRepository` that injects `activeProfileId` into every statement. Profile switch = swap the in-memory active id + reload; it never mixes partitions because no query omits the id.

**Per-profile export works fully under this model** and is the preferred "safe keeping" artifact: export = `SELECT … WHERE profile_id = ?` for every user table → one self-describing JSON bundle (§6). This is superior to copying a per-profile `.db` file (which would be opaque, schema-version-coupled, and brittle to re-import). The bundle is human-readable, version-stamped, and forward-migratable.
*(Per-file partition was considered and rejected: it does not improve export, costs open/close churn on switch, and complicates any future cross-profile read.)*

---

## 3. Catalog (shared, read-only) — one catalog, from scratch (D2)

Built once from the existing Sorcery data (Lexicum/Arcanum already ship the **same 1104-card set**; Lexicum adds rules + FAQs). Card identity = a **stable `card_id`** (canonical slug); `name` kept for display and import matching.

```sql
cards(
  card_id TEXT PRIMARY KEY,         -- stable slug, e.g. 'alp-apprentice_wizard'
  name TEXT NOT NULL,
  type TEXT,                        -- Minion|Site|Avatar|Magic|Aura|Artifact|...
  sub_types TEXT,                   -- json string[]
  rarity TEXT,                      -- Ordinary|Exceptional|Elite|Unique
  elements TEXT,                    -- json string[]  (Air|Earth|Fire|Water; [] = Neutral)
  cost INT, attack INT, defence INT, life INT,   -- nullable
  thresholds TEXT,                  -- json {air,earth,fire,water:int}
  rules_text TEXT,
  is_avatar INT, is_site INT,       -- 0/1
  sets TEXT,                        -- json [{name,code}]
  variants TEXT,                    -- json [{slug,finish,set,artist,flavorText}]
  image_slug TEXT,                  -- best slug; art at cards/<slug>.webp (optional)
  system TEXT DEFAULT 'sorcery'     -- future second game system
)
rules(rule_id TEXT PRIMARY KEY, parent_id TEXT NULL, title TEXT, content TEXT, system TEXT DEFAULT 'sorcery')
faqs(faq_id TEXT PRIMARY KEY, question TEXT, answer TEXT, card_ids TEXT /*json*/, source TEXT)
link_graph(source_id TEXT, source_type TEXT, target_id TEXT, target_type TEXT)
catalog_meta(key TEXT PRIMARY KEY, value TEXT)   -- catalog_version, built_at
```
`rules` holds both articles (`parent_id` NULL) and sub-entries (`parent_id` = article). **No user FKs into catalog are stored as denormalized titles** — user data references `card_id`/`rule_id`, and because the catalog is authoritative-from-zero there is nothing to orphan.

---

## 4. Profiles (the spine)

```sql
profiles(
  id TEXT PRIMARY KEY,              -- uuid
  name TEXT NOT NULL,
  avatar TEXT,                      -- json {kind:'initial'|'card', value} | null  (initial-disc fallback always works)
  accent TEXT,                      -- wayfinding accent, default gold
  system TEXT DEFAULT 'sorcery',
  schema_version INT NOT NULL,
  created_at TEXT, updated_at TEXT
)
```
Singletons in Preferences: `activeProfileId`, `globalSchemaVersion`, `lastBackupAt`, `onboarded`.

**Profile lifecycle (all wired — the mockup's sheet is currently stubbed):** create, rename, switch (atomic), delete (with confirm; cannot delete the last/active without choosing a successor), export, import. There is always ≥1 profile; first launch creates a default and prompts for a name. Switching loads the new partition fully, then renders (never mid-swap).

> **Every table in §5 carries `profile_id` and is reachable only through the active-profile gate.**

---

## 5. Profile data tables

**Decks (Arcanum model, full fidelity — D3).** Three zones, avatar, variants, rarity rules preserved.
```sql
decks(id, profile_id, name, slug, archetype, avatar_card_id NULL, avatar_slug NULL,
      cover_slug NULL, notes, curiosa_url, wins INT, losses INT, starred INT,
      lib_order INT, created_at, updated_at)
deck_entries(id, deck_id, zone TEXT /* spellbook|atlas|collection */,
      card_id, quantity INT, variant_slug TEXT)
deck_history(id, deck_id, ts, text)     -- capped 200 newest-first
```
Zone minimums/maximums (Spellbook 60+, Atlas 30+, Collection ≤10/11-Dragonlord), rarity copy-limits (4/3/2/1), unlimited-copy cards, and Pathfinder/Spellslinger/Dragonlord rules live in **deck-validation logic**, derived from catalog data — not hardcoded per card.

**Codex personal layer (Lexicum model).**
```sql
saved(id, profile_id, target_type /* card|rule|deck */, target_id, created_at)
notes(id, profile_id, target_type, target_id, body, created_at, updated_at)        -- marginalia
highlights(id, profile_id, target_type, target_id, text, comment, created_at)      -- articles
collections(id, profile_id, name, created_at)
collection_items(id, collection_id, target_type, target_id, added_at)
links(id, profile_id, kind /* card_card|card_article|article_article */,
      a_type, a_id, b_type, b_id, description, created_at, updated_at)
```

**Play (Vitarum model) — match log persisted (D4).**
```sql
matches(id, profile_id, played_at, mode /* full|quick */,
        player_avatar, opponent_name, opponent_avatar,
        player_final_life, opponent_final_life, winner /* player|opponent|draw */,
        duration_sec, notes)
        -- Q1 LOCKED: per-profile owned. Each profile sees only its own matches;
        -- opponent is a free-text name (no opponent_profile_id, no pass-and-play link).
match_log_entries(id, match_id, t, who /* player|opponent */, kind /* life|max */,
                  delta INT, to_life INT, to_max INT)   -- now persisted, not in-memory
```

**Home / Dashboard (Lexicum model — all 14 widget types, D5).**
```sql
dashboard_blocks(id, profile_id, type, width /* half|full */, config TEXT /*json*/, sort_order INT, created_at)
dashboard_layouts(id, profile_id, name, blocks TEXT /*json snapshot*/, saved_at)
resume(profile_id PRIMARY KEY, target_type, target_id, title, at)   -- jump-back-in
```
Widget `type` ∈ the 14 Lexicum kinds (`favourites, highlights, notes, collections, collection, stats, resume, errata, text, article, card, url-collection, random-article, random-card`) **+ new cross-pillar kinds** `decks` (Arcanum) and `duels` (Vitarum). `config` is type-specific JSON, exactly as Lexicum stores it.

**Settings — per-profile (§7 of the matrix, unified).**
```sql
settings(profile_id PRIMARY KEY,
  accent_metal TEXT DEFAULT 'gilded',     -- gilded|verdigris|pewter
  film_grain INT DEFAULT 1,
  keep_awake INT DEFAULT 0,
  immersive INT DEFAULT 1,
  default_max_life INT DEFAULT 20,
  die_type INT DEFAULT 6,
  haptics INT DEFAULT 1,                   -- NEW: a real toggle (Vitarum had none)
  rarity_colors INT DEFAULT 0,
  theme TEXT DEFAULT 'grimoire',           -- NEW: today everything is dark-only
  persist_search INT DEFAULT 0)
```
App-level (not per-profile): card-art source (bundled vs CDN) + art-cache controls → Preferences/app config.

---

## 6. Deck import / export — works as present, remapped (your explicit ask)

These are v1 and must behave exactly like Arcanum today; only the storage target changes.

| Feature | Source behaviour | New mapping |
|---|---|---|
| **Curiosa URL import** | scrape Curiosa tRPC (`deck.getById`/`getDecklistById`/`getSideboardById`) via CapacitorHttp; Spell→spellbook, Site→atlas, sideboard→collection; warn unknown | same network logic → write `decks` + `deck_entries(zone=…)` for the active profile; unknown cards kept as `card_id=null` placeholder (graceful, §5 of handoff) |
| **Bulk import (Markdown)** | parse Arcanum MD (`# name`, `## Spellbook/Atlas/Collection`, `### type` groups, `- N× Name`) | same parser → `deck_entries`; resolve names→`card_id` via catalog, keep unresolved as placeholder |
| **Arcanum export (Markdown)** | `# / ## zone / ### type / - N× Name` | render from `deck_entries` grouped by zone+type — byte-compatible |
| **Curiosa export** | header-less `"<qty> <name>"` (and slug variant) | render from `deck_entries` |
| **Share as image (deck poster)** | offline canvas → share sheet | **D7: deferred**; data ready, reuse existing canvas later |

Unified **profile export** (separate from per-deck export) = one self-describing JSON: `{ app:"compendium", schemaVersion, exportedAt, profile:{…}, decks, deckEntries, notes, highlights, collections, collectionItems, links, saved, matches, matchLog, dashboardBlocks, dashboardLayouts, settings }` via filesystem + share. Import runs forward-migrations on `schemaVersion`.

---

## 7. Universal search & Home aggregation (the unification payoff)

- **SQLite FTS** index over catalog (`cards.name/rules_text`, `rules.title/content`, `faqs`) + the active profile's `decks.name`, `notes.body`, `matches`. One query → grouped results (Codex / Decks / Duels), exactly as the mockup's `buildSearch` previews on toy data.
- **Home Overview & Dashboard** read only the active profile's tables → "Your Decks", "Recent Duels", live-match strip, Saved, Notes, Random Card all aggregate *within* the active profile. Cross-pillar, single-profile.

---

## 8. Profile decisions — RESOLVED

- **Q1 — Match ownership: per-profile owned.** Match log is persisted (not ephemeral) and each profile sees only its own matches. Opponent is a free-text name; no pass-and-play link between two on-device profiles. (No `opponent_profile_id`.)
- **Q2 — Partition: single `compendium.db` + enforced `profile_id`** through `ProfileRepository`. Per-profile export via the self-describing JSON bundle (§6), which is the canonical backup/"safe keeping" artifact.

---

## 9. Build order (after data model sign-off)

1. **Project skeleton + data layer** — Capacitor app scaffold, SQLite schema, catalog loader, `ProfileRepository` (active-profile gate), profile lifecycle (create/rename/switch/delete/export/import).
2. **Shell + shared components** — chrome, 4-pillar nav, adaptive search/FAB; chip, list row, detail header, bottom sheet, fallback-art generator.
3. **Codex** (read-only first) — catalog browse/search, detail, marginalia, highlights, collections, links, FAQs.
4. **Decks** — library, detail (Cards/Stats), scoped add (zones), filters/sort, **import/export (working, remapped)**, stats viz.
5. **Play** — life counter (ported), persisted Match Log, history.
6. **Home / Dashboard** — Overview + all 14 widgets (+ cross-pillar decks/duels).
7. **Graceful-no-images audit** — release gate on every screen throughout.

*Foundational choice still open before scaffolding: the app's UI stack (see chat).*
