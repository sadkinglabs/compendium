// Compendium SQLite schema - see COMPENDIUM_DATA_MODEL.md.
// Catalog = shared, read-only (no profile_id). Everything user-created carries
// profile_id and is reachable only through the active-profile gate.
// Forward-only migrations keyed by version; bump SCHEMA_VERSION and append.

export const SCHEMA_VERSION = 11;

export const MIGRATIONS = [
  {
    version: 1,
    sql: `
    PRAGMA foreign_keys = ON;

    /* ---------- catalog (shared, read-only) ---------- */
    CREATE TABLE IF NOT EXISTS cards (
      card_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      sub_types TEXT,            -- json string[]
      rarity TEXT,
      elements TEXT,             -- json string[]
      cost INTEGER, attack INTEGER, defence INTEGER, life INTEGER,
      thresholds TEXT,           -- json {air,earth,fire,water}
      rules_text TEXT,
      is_avatar INTEGER DEFAULT 0,
      is_site INTEGER DEFAULT 0,
      sets TEXT,                 -- json [{name,code}]
      variants TEXT,             -- json [{slug,finish,set,artist,flavorText}]
      image_slug TEXT,
      system TEXT DEFAULT 'sorcery'
    );
    CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
    CREATE INDEX IF NOT EXISTS idx_cards_type ON cards(type);

    CREATE TABLE IF NOT EXISTS rules (
      rule_id TEXT PRIMARY KEY,
      parent_id TEXT,            -- null = article; else sub-entry of an article
      title TEXT, content TEXT,
      system TEXT DEFAULT 'sorcery'
    );
    CREATE INDEX IF NOT EXISTS idx_rules_parent ON rules(parent_id);

    CREATE TABLE IF NOT EXISTS faqs (
      faq_id TEXT PRIMARY KEY,
      question TEXT, answer TEXT,
      card_ids TEXT,             -- json string[]
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS link_graph (
      source_id TEXT, source_type TEXT,
      target_id TEXT, target_type TEXT
    );

    CREATE TABLE IF NOT EXISTS catalog_meta (key TEXT PRIMARY KEY, value TEXT);

    /* ---------- profiles (the spine) ---------- */
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,               -- json {kind:'initial'|'card', value} | null
      accent TEXT DEFAULT 'gold',
      system TEXT DEFAULT 'sorcery',
      schema_version INTEGER NOT NULL,
      created_at TEXT, updated_at TEXT
    );

    /* ---------- profile data (every row owns one profile_id) ---------- */
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL, slug TEXT, archetype TEXT,
      avatar_card_id TEXT, avatar_slug TEXT, cover_slug TEXT,
      notes TEXT, curiosa_url TEXT,
      wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
      starred INTEGER DEFAULT 0, lib_order INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decks_profile ON decks(profile_id);

    CREATE TABLE IF NOT EXISTS deck_entries (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      zone TEXT NOT NULL,        -- spellbook | atlas | collection
      card_id TEXT,              -- null = unresolved placeholder (graceful)
      quantity INTEGER DEFAULT 1,
      variant_slug TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_deck_entries_deck ON deck_entries(deck_id);

    CREATE TABLE IF NOT EXISTS deck_history (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      ts TEXT, text TEXT
    );

    -- The saved table = doc-level BOOKMARKS (the corner ribbon toggle). Named
    -- "saved" for history; it is a plain PIN on any entry (rule/card/deck), no
    -- offset anchor: decks have no document to anchor into, and a bookmark never
    -- moves with the text.
    CREATE TABLE IF NOT EXISTS saved (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      target_type TEXT, target_id TEXT, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_saved_profile ON saved(profile_id);

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      target_type TEXT, target_id TEXT,
      body TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notes_profile ON notes(profile_id);
    CREATE INDEX IF NOT EXISTS idx_notes_target ON notes(target_type, target_id);

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      target_type TEXT, target_id TEXT,
      text TEXT, comment TEXT, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_highlights_profile ON highlights(profile_id);

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_collections_profile ON collections(profile_id);

    CREATE TABLE IF NOT EXISTS collection_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      target_type TEXT, target_id TEXT, added_at TEXT
    );

    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT,                 -- card_card | card_article | article_article
      a_type TEXT, a_id TEXT, b_type TEXT, b_id TEXT,
      description TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_links_profile ON links(profile_id);

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      played_at TEXT, mode TEXT,
      player_avatar TEXT, opponent_name TEXT, opponent_avatar TEXT,
      player_final_life INTEGER, opponent_final_life INTEGER,
      winner TEXT, duration_sec INTEGER, notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_matches_profile ON matches(profile_id);

    CREATE TABLE IF NOT EXISTS match_log_entries (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      t TEXT, who TEXT, kind TEXT,   -- life | max
      delta INTEGER, to_life INTEGER, to_max INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_matchlog_match ON match_log_entries(match_id);

    CREATE TABLE IF NOT EXISTS dashboard_blocks (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      type TEXT, width TEXT, config TEXT, sort_order INTEGER, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dash_blocks_profile ON dashboard_blocks(profile_id);

    CREATE TABLE IF NOT EXISTS dashboard_layouts (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT, blocks TEXT, saved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS resume (
      profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      target_type TEXT, target_id TEXT, title TEXT, at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      accent_metal TEXT DEFAULT 'gilded',   -- retired (counter-skin picker removed); column kept for compatibility
      film_grain INTEGER DEFAULT 1,
      keep_awake INTEGER DEFAULT 1,
      immersive INTEGER DEFAULT 1,
      default_max_life INTEGER DEFAULT 20,
      die_type INTEGER DEFAULT 6,
      haptics INTEGER DEFAULT 1,
      rarity_colors INTEGER DEFAULT 0,
      theme TEXT DEFAULT 'grimoire',
      persist_search INTEGER DEFAULT 0
    );
    `,
  },
  {
    // v2 - a match remembers which deck was piloted (Play ↔ Decks link).
    // Plain TEXT, no FK: matches must survive the deck being deleted (the
    // deck chip simply disappears - resolved by LEFT JOIN at read time).
    version: 2,
    sql: 'ALTER TABLE matches ADD COLUMN deck_id TEXT;',
  },
  {
    // v3 - the default profile is marked EXPLICITLY (an "oldest created_at"
    // heuristic proved deletable under timestamp ties). Best-effort mark of
    // the oldest existing profile here; initProfiles() re-asserts the
    // exactly-one-default invariant on every boot.
    version: 3,
    sql: `
    ALTER TABLE profiles ADD COLUMN is_default INTEGER DEFAULT 0;
    UPDATE profiles SET is_default=1 WHERE id=(SELECT id FROM profiles ORDER BY created_at ASC, rowid ASC LIMIT 1);
    `,
  },
  {
    // v4 - accessibility settings (per-profile, applied to the app root).
    version: 4,
    sql: `
    ALTER TABLE settings ADD COLUMN font_scale REAL DEFAULT 1;
    ALTER TABLE settings ADD COLUMN high_contrast INTEGER DEFAULT 0;
    ALTER TABLE settings ADD COLUMN reduced_motion INTEGER DEFAULT 0;
    `,
  },
  {
    // v5 - keep-screen-awake is now the default during a match (a life tracker
    // you stare at should never let the screen sleep). The lock is engaged only
    // while the counter is mounted, so "on by default" still means match-scoped.
    // Buried + off-by-default until now, so flip every existing profile on too;
    // anyone who prefers otherwise still has the Tweaks toggle.
    version: 5,
    sql: 'UPDATE settings SET keep_awake=1;',
  },
  {
    // v6 - a deck's W-L is now DERIVED SOLELY from its matches (the manual
    // Stats steppers are gone; matches are the single source of truth). Reconcile
    // every existing deck once so any hand-entered or drifted record snaps to the
    // true count of its linked matches. Decks with no linked matches become 0-0.
    version: 6,
    sql: `
    UPDATE decks SET
      wins   = (SELECT COUNT(*) FROM matches m WHERE m.deck_id=decks.id AND m.profile_id=decks.profile_id AND m.winner='player'),
      losses = (SELECT COUNT(*) FROM matches m WHERE m.deck_id=decks.id AND m.profile_id=decks.profile_id AND m.winner='opponent');
    `,
  },
  {
    // v7 - annotation model (highlights/notes/bookmarks). An annotation anchors to
    // CANONICAL character offsets in its compiled document (canon_start/end), plus a
    // W3C-style TextQuoteSelector fallback (prefix/exact/suffix over canon) so it can
    // be re-anchored or honestly orphaned when the catalog updates. block_hint is a
    // non-durable render/scroll handle.
    // SUPERSEDED by v10: anchored highlights were removed as a feature and these two
    // tables are dropped there. Kept here because migrations are append-only.
    version: 7,
    sql: `
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      group_id TEXT,
      doc_type TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      build_hash TEXT,
      color TEXT,
      comment TEXT,
      state TEXT NOT NULL DEFAULT 'anchored',
      created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(profile_id, doc_type, doc_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_state ON annotations(profile_id, state);
    CREATE TABLE IF NOT EXISTS anchors (
      annotation_id TEXT PRIMARY KEY REFERENCES annotations(id) ON DELETE CASCADE,
      canon_start INTEGER, canon_end INTEGER,
      quote_exact TEXT NOT NULL DEFAULT '',
      quote_prefix TEXT NOT NULL DEFAULT '',
      quote_suffix TEXT NOT NULL DEFAULT '',
      block_hint TEXT
    );
    `,
  },
  {
    // v8 - the Collection pillar (card ownership + wants + lists). A LEDGER, not an
    // allocator: decks never reserve cards, so buildability/progress are pure reads
    // over this ledger (see ownedRepository + compareEngine). Table names are
    // collision-free with the DECK ZONE string 'collection' and the Codex Marginalia
    // 'collections'/'collection_items' tables. variant_slug mirrors deck_entries
    // (printing; '' = unspecified) and is forward-ready - v1 only ever writes ''.
    version: 8,
    sql: `
    -- Ownership ledger: one row per profile+card+printing. qty_wanted IS the general
    -- Wishlist (no separate table). A 0/0 row is deleted by the repository on write.
    CREATE TABLE IF NOT EXISTS owned_cards (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,            -- catalog cards.card_id; soft ref (like matches.deck_id)
      variant_slug TEXT NOT NULL DEFAULT '',
      qty_owned INTEGER NOT NULL DEFAULT 0,
      qty_wanted INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_key ON owned_cards(profile_id, card_id, variant_slug);
    CREATE INDEX IF NOT EXISTS idx_owned_profile_card ON owned_cards(profile_id, card_id);

    -- One list model for both Wanted Lists (kind='wanted', goal + progress) and
    -- Card Lists (kind='custom', plain grouping). Progress is COMPUTED, never stored.
    CREATE TABLE IF NOT EXISTS card_lists (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'custom',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_card_lists_profile ON card_lists(profile_id, kind);

    -- List membership, mirroring deck_entries. quantity = target (wanted) or copies (custom).
    CREATE TABLE IF NOT EXISTS card_list_entries (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES card_lists(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      variant_slug TEXT NOT NULL DEFAULT '',
      added_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_list_entries_key ON card_list_entries(list_id, card_id, variant_slug);
    CREATE INDEX IF NOT EXISTS idx_list_entries_card ON card_list_entries(card_id);
    `,
  },
  {
    // link_graph (card<->article edges) shipped with NO indexes, so every card /
    // article detail open (relatedFor/mentions: WHERE source_id=?) and the Codex
    // "examples" filter (exampleRuleSet: WHERE target_type='card') full-scanned it.
    version: 9,
    sql: `
    CREATE INDEX IF NOT EXISTS idx_linkgraph_source ON link_graph(source_id);
    CREATE INDEX IF NOT EXISTS idx_linkgraph_target ON link_graph(target_type, target_id);
    `,
  },
  {
    // v10 - anchored highlights removed (feature pruned; offset anchors were
    // unmaintainable against an evolving catalog). Notes, links and bookmarks stay.
    // Hard delete by owner decision, tester-confirmed. Forward-only and retry-safe:
    // anchors (child) drops before annotations (parent); every statement tolerates a
    // re-run after a partial apply. Only highlight rows and the Highlights dashboard
    // widget go - all other tables and rows are untouched.
    version: 10,
    sql: `
    DROP TABLE IF EXISTS anchors;
    DROP TABLE IF EXISTS annotations;
    DROP TABLE IF EXISTS highlights;
    DELETE FROM dashboard_blocks WHERE type='highlights';
    DELETE FROM catalog_meta WHERE key='highlights_migrated';
    `,
  },
  {
    version: 11,
    // v11 has NO DDL. `owned_cards.variant_slug` is already TEXT NOT NULL DEFAULT '' and the
    // unique index is already (profile_id, card_id, variant_slug); the canonical keys are just
    // different STRING VALUES in that column, so there is no table to rebuild and no default to
    // change. The whole of v11 is data plus code.
    //
    // The entry exists so SCHEMA_VERSION advances and profile exports stamp 11, which is what
    // the import boundary reads. The statement is a harmless no-op rather than empty SQL,
    // because the native backend's exec() splitter dislikes blank statements.
    sql: `SELECT 1;`,
  },
];
