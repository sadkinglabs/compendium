// Profile export / import - a single self-describing JSON bundle (§4-E).
// Export gathers every profile-scoped row; import re-keys all ids and writes the
// bundle into a NEW profile in one transaction. Catalogue refs (card_id/rule_id)
// are preserved as-is. Forward-only: an older schemaVersion still imports.
import { query, tx } from './db.js';
import { activeProfileId, switchProfile, renameProfile } from './profileRepository.js';
import { SCHEMA_VERSION } from './schema.js';
import { prepareBundle } from './importBoundary.js';
import { uuid, nowIso } from './ids.js';
import { normalizeDurationSec } from './matchStats.js';
import { filterImportedBlocks, filterLayoutBlocks, shouldMarkDashboardSeeded } from './widgetRegistry.js';
import { safeHref } from '../util.js';
import { SYSTEM_KIND, UNFILED_NAME, DEFAULT_COLOUR, isContainerColour, isUserContainerKind } from './storageVocabulary.js';

const inClause = (ids) => ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)';

/**
 * A profile name not already in `taken`. Pure, and the ONE implementation of this rule.
 *
 * There were two, and only one was right: the whole-app restore looped until the name was free while
 * `importProfile` appended "(imported)" exactly once, so importing the same profile a third time
 * produced a SECOND profile with an identical name. Nothing in the schema forbids that - names carry
 * no unique index - which is precisely why it went unnoticed: the database accepts it and the profile
 * picker then shows two rows a user cannot tell apart.
 */
export function uniqueProfileName(base, taken) {
  const root = base || 'Imported';
  if (!taken.has(root)) return root;
  let candidate = `${root} (imported)`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${root} (imported ${n})`;
  return candidate;
}

/** Strip unsafe URLs from an imported 'urls' widget's config JSON so a crafted
 *  bundle can't smuggle a javascript: link past the render-time guard. */
function sanitizeBlockConfig(type, configJson) {
  if (type !== 'urls' || !configJson) return configJson;
  try {
    const cfg = JSON.parse(configJson);
    if (Array.isArray(cfg.links)) cfg.links = cfg.links.filter((l) => safeHref(l?.url));
    return JSON.stringify(cfg);
  } catch { return '{}'; }
}

/**
 * Every profile-owned row for one profile, in the WHOLE-APP unit shape.
 *
 * Extracted from `exportProfile` so the per-profile path and the whole-app backup share one
 * implementation - two would drift, and the drift would only ever show on restore, the least
 * exercised path in the app (the same argument importBoundary.js makes about the shared planner).
 *
 * Richer than the legacy bundle in exactly two ways, both of which the whole-app format needs and
 * the legacy wrapper narrows away again:
 *   - the FULL profile row, not just name/avatar/accent
 *   - `dashSeeded`, the per-profile dashboard flag that lives in `catalog_meta`
 */
export async function buildProfileUnit(profileId) {
  const profile = (await query('SELECT * FROM profiles WHERE id=?;', [profileId]))[0];
  if (!profile) throw new Error('Profile not found.');

  const decks = await query('SELECT * FROM decks WHERE profile_id=?;', [profileId]);
  const collections = await query('SELECT * FROM collections WHERE profile_id=?;', [profileId]);
  const matches = await query('SELECT * FROM matches WHERE profile_id=?;', [profileId]);
  const cardLists = await query('SELECT * FROM card_lists WHERE profile_id=?;', [profileId]);
  const containers = await query('SELECT * FROM storage_containers WHERE profile_id=?;', [profileId]);
  const deckIds = decks.map((d) => d.id);
  const colIds = collections.map((c) => c.id);
  const matchIds = matches.map((m) => m.id);
  const listIds = cardLists.map((l) => l.id);
  // Profile-owned, but stored in a catalog table (homeRepository.js:34). Carried inside the unit and
  // re-keyed on restore; without it a faithfully restored dashboard is repopulated with starters.
  const dashSeeded = (await query('SELECT 1 FROM catalog_meta WHERE key=?;', [`dash_seeded:${profileId}`])).length > 0;

  return {
    profile: {
      name: profile.name, avatar: profile.avatar, accent: profile.accent,
      system: profile.system, is_default: profile.is_default,
      created_at: profile.created_at, updated_at: profile.updated_at,
    },
    dashSeeded,
    decks,
    deck_entries: await query(`SELECT * FROM deck_entries WHERE deck_id IN ${inClause(deckIds)};`, deckIds),
    deck_history: await query(`SELECT * FROM deck_history WHERE deck_id IN ${inClause(deckIds)};`, deckIds),
    saved: await query('SELECT * FROM saved WHERE profile_id=?;', [profileId]),
    notes: await query('SELECT * FROM notes WHERE profile_id=?;', [profileId]),
    collections,
    collection_items: await query(`SELECT * FROM collection_items WHERE collection_id IN ${inClause(colIds)};`, colIds),
    // Collection pillar (v8): the ownership ledger + card/wanted lists.
    owned_cards: await query('SELECT * FROM owned_cards WHERE profile_id=?;', [profileId]),
    card_lists: cardLists,
    card_list_entries: await query(`SELECT * FROM card_list_entries WHERE list_id IN ${inClause(listIds)};`, listIds),
    // Storage (v12): where each owned copy physically lives. Allocations ARE the ownership, so an
    // export that carried owned_cards without these would restore a collection whose every copy had
    // silently moved to Unfiled - the filing lost with no error anywhere.
    storage_containers: containers,
    storage_allocations: await query('SELECT * FROM storage_allocations WHERE profile_id=?;', [profileId]),
    links: await query('SELECT * FROM links WHERE profile_id=?;', [profileId]),
    matches,
    match_log_entries: await query(`SELECT * FROM match_log_entries WHERE match_id IN ${inClause(matchIds)};`, matchIds),
    dashboard_blocks: await query('SELECT * FROM dashboard_blocks WHERE profile_id=?;', [profileId]),
    dashboard_layouts: await query('SELECT * FROM dashboard_layouts WHERE profile_id=?;', [profileId]),
    resume: (await query('SELECT * FROM resume WHERE profile_id=?;', [profileId]))[0] || null,
    settings: (await query('SELECT * FROM settings WHERE profile_id=?;', [profileId]))[0] || null,
  };
}

/**
 * The portable single-profile bundle (defaults to the active profile).
 *
 * A NARROWING of `buildProfileUnit`: the legacy format carries only name/avatar/accent and has no
 * `dashSeeded`, and that contract is asserted by profileRoundTrip.test.mjs. Widening it here would
 * change a file format that already exists on users' devices, which is Increment A's job to do
 * deliberately - not a side effect of an extraction.
 */
export async function exportProfile(profileId = activeProfileId()) {
  const { profile, dashSeeded, ...tables } = await buildProfileUnit(profileId);
  return {
    app: 'compendium', schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(),
    profile: { name: profile.name, avatar: profile.avatar, accent: profile.accent },
    ...tables,
  };
}

/** Duplicate a profile - the export/import round-trip re-keys every id, so the
 *  copy is fully independent of the original. Returns the new profileId. */
export async function duplicateProfile(profileId) {
  const bundle = await exportProfile(profileId);
  return importProfile(bundle, { name: `${bundle.profile?.name || 'Profile'} (copy)` });
}

/** Import a bundle into a brand-new profile. Returns the new profileId. */
export async function importProfile(rawBundle, { name } = {}) {
  // THE BOUNDARY, reconnected. It was disconnected for two checkpoints because normalisation
  // wrote canonical keys while the active want writers still targeted the legacy row and
  // derived their new value from the card-level total - one heart tap on an imported want
  // added three. Those writers now resolve to a collector item first, so the two agree.
  //
  // Validation and normalisation happen in memory, before anything is created. The catalog read
  // below is the only query and it creates nothing.
  const setsById = new Map();
  for (const c of await query('SELECT card_id, sets FROM cards;')) {
    try {
      const parsed = JSON.parse(c.sets || '[]');
      setsById.set(c.card_id, Array.isArray(parsed) ? parsed.map((x) => x?.code).filter(Boolean) : []);
    } catch { setsById.set(c.card_id, []); }
  }
  const { bundle } = prepareBundle(rawBundle, (cardId) => setsById.get(cardId) || []);

  // Restore under the original name, disambiguated if that name is already on the device. This
  // applies to an explicitly-supplied name too: `duplicateProfile` passes "X (copy)", and duplicating
  // twice would otherwise produce two profiles called "X (copy)".
  const taken = new Set((await query('SELECT name FROM profiles;')).map((p) => p.name));
  const pname = uniqueProfileName(name || bundle.profile?.name, taken);
  // avatar is stored as a JSON string and is re-stringified on write, so parse it back.
  let avatar = null;
  try { avatar = bundle.profile?.avatar ? JSON.parse(bundle.profile.avatar) : null; } catch { avatar = null; }

  // THE PROFILE IS CREATED INSIDE THE SAME TRANSACTION AS ITS ROWS.
  //
  // This used to call createProfile() first, which issues two un-transacted INSERTs, and only
  // then open a transaction for the imported data. Any failure after that point - a constraint,
  // a full disk, a malformed row the validator did not anticipate - left a profile behind with
  // partial or no contents, and the user had to find and delete it themselves.
  //
  // Validating the bundle harder narrows the window but cannot close it: constraint, transaction
  // and storage failures are not properties of the input. Only atomicity closes it. So the
  // profile and settings rows are simply the first two statements below, and a rollback takes
  // the profile with it.
  const { pid, statements } = planProfileUnit(bundle, { pid: uuid(), name: pname, avatar });
  if (statements.length) await tx(statements);
  return pid;
}

/**
 * PURE. Turn one prepared bundle/unit into the statement set that restores it under `pid`.
 *
 * No I/O: no query, no transaction, and no id taken from the database. That is what lets the
 * whole-app restore concatenate the plans for every profile into ONE transaction (Options / H in
 * backup-and-restore.md) instead of committing profile by profile and bookkeeping the difference.
 *
 * Extracted verbatim from `importProfile`, whose comments record two separately paid-for bugs. The
 * safety net for that move is `profileRoundTrip.test.mjs` plus the orphan-profile and
 * import-boundary characterizations, all written before this extraction existed.
 *
 * @param bundle  a PREPARED bundle (validated + normalised) or a whole-app profile unit
 * @param pid     the profile id to restore under - generated by the caller, never by the database
 * @param name    the resolved profile name (collision handling is the caller's, it needs a query)
 * @param avatar  the parsed avatar object, or null
 * @param dashSeeded  optional override; when undefined the legacy heuristic decides
 */
export function planProfileUnit(bundle, { pid, name, avatar = null, dashSeeded } = {}) {
  const pts = nowIso();
  const stmts = [];
  const ins = (table, cols, vals) => stmts.push([`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')});`, vals]);

  // is_default is always 0 here. Exactly-one-default is re-asserted at boot (profileRepository.js:39),
  // and the whole-app restore moves the flag deliberately in its own statement after every unit.
  ins('profiles', ['id', 'name', 'avatar', 'accent', 'system', 'schema_version', 'is_default', 'created_at', 'updated_at'],
    [pid, name, avatar ? JSON.stringify(avatar) : null, bundle.profile?.accent || 'gold', 'sorcery', SCHEMA_VERSION, 0, pts, pts]);
  stmts.push(['INSERT OR IGNORE INTO settings(profile_id) VALUES(?);', [pid]]);

  // id remaps (old -> new), so two imports never collide.
  const deckMap = new Map(), colMap = new Map(), matchMap = new Map(), listMap = new Map();
  for (const d of bundle.decks || []) deckMap.set(d.id, uuid());
  for (const c of bundle.collections || []) colMap.set(c.id, uuid());
  for (const m of bundle.matches || []) matchMap.set(m.id, uuid());
  for (const l of bundle.card_lists || []) listMap.set(l.id, uuid());

  for (const d of bundle.decks || [])
    ins('decks', ['id', 'profile_id', 'name', 'slug', 'archetype', 'avatar_card_id', 'avatar_slug', 'cover_slug', 'notes', 'curiosa_url', 'wins', 'losses', 'starred', 'lib_order', 'created_at', 'updated_at'],
      [deckMap.get(d.id), pid, d.name, d.slug, d.archetype, d.avatar_card_id, d.avatar_slug, d.cover_slug, d.notes, safeHref(d.curiosa_url) || null, d.wins, d.losses, d.starred, d.lib_order, d.created_at, d.updated_at]);
  for (const e of bundle.deck_entries || [])
    ins('deck_entries', ['id', 'deck_id', 'zone', 'card_id', 'quantity', 'variant_slug'], [uuid(), deckMap.get(e.deck_id), e.zone, e.card_id, e.quantity, e.variant_slug]);
  for (const h of bundle.deck_history || [])
    ins('deck_history', ['id', 'deck_id', 'ts', 'text'], [uuid(), deckMap.get(h.deck_id), h.ts, h.text]);
  for (const r of bundle.saved || [])
    ins('saved', ['id', 'profile_id', 'target_type', 'target_id', 'created_at'], [uuid(), pid, r.target_type, r.target_id, r.created_at]);
  for (const n of bundle.notes || [])
    ins('notes', ['id', 'profile_id', 'target_type', 'target_id', 'body', 'created_at', 'updated_at'], [uuid(), pid, n.target_type, n.target_id, n.body, n.created_at, n.updated_at]);
  for (const c of bundle.collections || [])
    ins('collections', ['id', 'profile_id', 'name', 'created_at'], [colMap.get(c.id), pid, c.name, c.created_at]);
  for (const ci of bundle.collection_items || [])
    ins('collection_items', ['id', 'collection_id', 'target_type', 'target_id', 'added_at'], [uuid(), colMap.get(ci.collection_id), ci.target_type, ci.target_id, ci.added_at]);
  // Owned rows get fresh ids, and Storage allocations point AT those ids - so the new id is
  // captured per source row rather than generated inline. A legacy bundle loses its source ids in
  // normaliseBundle (canonicalisation reshapes the ledger), which is exactly why a legacy import
  // synthesises allocations below instead of trying to remap ones it does not have.
  const ownedMap = new Map();
  const ownedRows = [];
  // The count is sanitised ONCE and the SAME number is both stored and used to place the copies.
  // They used to diverge: the allocation arithmetic read `Number(o.qty_owned) || 0` while the row
  // stored `o.qty_owned` verbatim. A hand-edited bundle carrying -5, "3" or null therefore wrote a
  // count the places could never match, and the equality was broken before the profile existed.
  // A count is a number of physical cards; it cannot be negative and it cannot be a string.
  const safeQty = (v) => { const n = Math.trunc(Number(v)); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
  for (const o of bundle.owned_cards || []) {
    const newId = uuid();
    if (o.id != null) ownedMap.set(o.id, newId);
    const owned = safeQty(o.qty_owned);
    ownedRows.push({ id: newId, qty_owned: owned, created_at: o.created_at, updated_at: o.updated_at });
    ins('owned_cards', ['id', 'profile_id', 'card_id', 'variant_slug', 'qty_owned', 'qty_wanted', 'notes', 'created_at', 'updated_at'],
      [newId, pid, o.card_id, o.variant_slug ?? '', owned, safeQty(o.qty_wanted), o.notes, o.created_at, o.updated_at]);
  }

  /* ---------------- Storage: every owned copy lands in exactly one place ----------------
   *
   * Two paths, because a bundle either knows about places or predates them:
   *
   *  - STORAGE-AWARE (v12+): carry the containers and remap the allocations. Ids are remapped, so
   *    the round trip is verified against the semantic graph - container name and contents - never
   *    against row counts, which match even when container_id has been remapped to the WRONG
   *    container and every card has quietly changed binder.
   *  - LEGACY: synthesise Unfiled and put every positive owned quantity in it. The equality holds
   *    from the first moment the profile exists rather than being repaired later.
   *
   * Either way the profile ends with exactly one system container, and qty_owned equals the sum of
   * that row's allocations. A wishlist-only row (qty_owned 0) gets NO allocation - `0 = SUM(none)`
   * satisfies the equality, while a zero-quantity row would violate CHECK (qty > 0).
   */
  const srcContainers = bundle.storage_containers || [];
  const srcAllocs = bundle.storage_allocations || [];
  const containerMap = new Map();
  let unfiledId = null;

  for (const c of srcContainers) {
    const newId = uuid();
    containerMap.set(c.id, newId);
    const system = c.is_system ? 1 : 0;
    if (system) unfiledId = newId;
    ins('storage_containers', ['id', 'profile_id', 'kind', 'name', 'description', 'colour', 'sort_order', 'is_system', 'created_at', 'updated_at'],
      [newId, pid,
        system ? SYSTEM_KIND : (isUserContainerKind(c.kind) ? c.kind : 'other'),
        system ? UNFILED_NAME : String(c.name ?? '').slice(0, 120),
        String(c.description ?? '').slice(0, 240),
        // Allow-listed, never passed through: this value ends up inside a CSS custom property.
        isContainerColour(c.colour) ? c.colour : DEFAULT_COLOUR,
        Number(c.sort_order) || 0, system, c.created_at || nowIso(), c.updated_at || nowIso()]);
  }

  // Every profile has an Unfiled container, always - a bundle that lacked one (legacy, or one whose
  // system row did not survive) gets it synthesised rather than the profile being left with nowhere
  // for a copy to live.
  if (!unfiledId) {
    unfiledId = uuid();
    ins('storage_containers', ['id', 'profile_id', 'kind', 'name', 'description', 'colour', 'sort_order', 'is_system', 'created_at', 'updated_at'],
      [unfiledId, pid, SYSTEM_KIND, UNFILED_NAME, '', DEFAULT_COLOUR, -1, 1, nowIso(), nowIso()]);
  }

  const carried = srcAllocs.length > 0 && ownedMap.size > 0;
  if (carried) {
    // THE INCOMING GRAPH IS VALIDATED, NOT TRUSTED. A bundle is a file: it can be hand-edited,
    // truncated, merged by hand, or written by a build with a bug. Three things it can claim that
    // the ledger cannot represent, each of which used to get written verbatim:
    //
    //   OVER-PLACEMENT - more copies placed than the row owns. The surplus was inserted anyway and
    //     the shortfall arithmetic went negative, so the profile was born violating the equality
    //     and every later decrease misbehaved on it. Copies are conserved and the count wins:
    //     each allocation is taken up to the row's remaining capacity and the rest is DROPPED. The
    //     filing is partly lost, which is the same trade this module already makes for a legacy
    //     bundle - and strictly better than refusing someone's backup.
    //   DUPLICATE PLACES - two rows for one (container, owned) pair. `idx_alloc_key` forbids it, so
    //     this failed the entire import on a raw index error. They are MERGED, which is what the
    //     upsert everywhere else in the app would have done.
    //   MALFORMED QUANTITIES - a negative, fractional or non-numeric qty. Dropped, as before, but
    //     now via the same sanitiser the counts use rather than a looser one.
    //
    // What is NOT tolerated: nothing here can raise a count. An import may lose filing; it may
    // never invent a copy the bundle did not claim to own.
    const capacity = new Map(ownedRows.map((r) => [r.id, r.qty_owned]));
    const merged = new Map();   // `${contId}|${ownedId}` -> { contId, ownedId, qty, created_at, updated_at }
    for (const a of srcAllocs) {
      const ownedId = ownedMap.get(a.owned_card_id);
      const contId = containerMap.get(a.container_id);
      const want = safeQty(a.qty);
      // An allocation whose container or owned row did not survive is not silently discarded: the
      // copies it held are still owned, so they fall through to the Unfiled shortfall below.
      if (!ownedId || !contId || !want) continue;
      const room = capacity.get(ownedId) || 0;
      const qty = Math.min(want, room);
      if (!qty) continue;
      capacity.set(ownedId, room - qty);
      const key = `${contId}|${ownedId}`;
      const prev = merged.get(key);
      if (prev) { prev.qty += qty; prev.updated_at = a.updated_at || prev.updated_at; }
      else merged.set(key, { contId, ownedId, qty, created_at: a.created_at || nowIso(), updated_at: a.updated_at || nowIso() });
    }
    for (const m of merged.values()) {
      ins('storage_allocations', ['id', 'profile_id', 'container_id', 'owned_card_id', 'qty', 'created_at', 'updated_at'],
        [uuid(), pid, m.contId, m.ownedId, m.qty, m.created_at, m.updated_at]);
    }
    // Whatever the bundle did not account for is unfiled. `capacity` is what is left after every
    // accepted place, so this closes the equality by construction rather than by hope.
    for (const r of ownedRows) {
      const short = capacity.get(r.id) || 0;
      if (short > 0) {
        ins('storage_allocations', ['id', 'profile_id', 'container_id', 'owned_card_id', 'qty', 'created_at', 'updated_at'],
          [uuid(), pid, unfiledId, r.id, short, r.created_at || nowIso(), r.updated_at || nowIso()]);
      }
    }
  } else {
    for (const r of ownedRows) {
      if (r.qty_owned > 0) {
        ins('storage_allocations', ['id', 'profile_id', 'container_id', 'owned_card_id', 'qty', 'created_at', 'updated_at'],
          [uuid(), pid, unfiledId, r.id, r.qty_owned, r.created_at || nowIso(), r.updated_at || nowIso()]);
      }
    }
  }
  for (const l of bundle.card_lists || [])
    ins('card_lists', ['id', 'profile_id', 'kind', 'name', 'description', 'sort_order', 'created_at', 'updated_at'],
      [listMap.get(l.id), pid, l.kind, l.name, l.description, l.sort_order, l.created_at, l.updated_at]);
  for (const e of bundle.card_list_entries || [])
    ins('card_list_entries', ['id', 'list_id', 'card_id', 'quantity', 'variant_slug', 'added_at'],
      [uuid(), listMap.get(e.list_id), e.card_id, e.quantity, e.variant_slug || '', e.added_at]);
  for (const l of bundle.links || [])
    ins('links', ['id', 'profile_id', 'kind', 'a_type', 'a_id', 'b_type', 'b_id', 'description', 'created_at', 'updated_at'], [uuid(), pid, l.kind, l.a_type, l.a_id, l.b_type, l.b_id, l.description, l.created_at, l.updated_at]);
  for (const m of bundle.matches || [])
    ins('matches', ['id', 'profile_id', 'played_at', 'mode', 'player_avatar', 'opponent_name', 'opponent_avatar', 'player_final_life', 'opponent_final_life', 'winner', 'duration_sec', 'notes', 'deck_id'],
      // duration_sec normalises on the way in like every other writer. A bundle can be
      // hand-edited or come from an older build, and 0 / negative / malformed all already
      // MEAN untimed - so mapping them to null preserves the semantics rather than
      // bending them. This is not a fidelity exception: no information is lost, because
      // there was none to lose.
      [matchMap.get(m.id), pid, m.played_at, m.mode, m.player_avatar, m.opponent_name, m.opponent_avatar, m.player_final_life, m.opponent_final_life, m.winner, normalizeDurationSec(m.duration_sec), m.notes,
        m.deck_id ? (deckMap.get(m.deck_id) || null) : null]);   // piloted deck follows the re-keyed deck
  for (const e of bundle.match_log_entries || [])
    ins('match_log_entries', ['id', 'match_id', 't', 'who', 'kind', 'delta', 'to_life', 'to_max'], [uuid(), matchMap.get(e.match_id), e.t, e.who, e.kind, e.delta, e.to_life, e.to_max]);
  // Drop any widget type this build no longer supports (e.g. a retired 'highlights'
  // widget in an older bundle) so an import can't strand an unrenderable block.
  const importedBlocks = filterImportedBlocks(bundle.dashboard_blocks);
  for (const b of importedBlocks)
    ins('dashboard_blocks', ['id', 'profile_id', 'type', 'width', 'config', 'sort_order', 'created_at'], [uuid(), pid, b.type, b.width, sanitizeBlockConfig(b.type, b.config), b.sort_order, b.created_at]);
  for (const l of bundle.dashboard_layouts || [])
    ins('dashboard_layouts', ['id', 'profile_id', 'name', 'blocks', 'saved_at'], [uuid(), pid, l.name, filterLayoutBlocks(l.blocks), l.saved_at]);
  // "Jump back in" - the last deck, card or rule opened. Navigation memory, not game state: a
  // half-played duel lives in localStorage and has never travelled in an archive.
  //
  // THE TARGET MUST FOLLOW THE RE-KEY. A `deck` target is a profile-owned id that this plan
  // rewrites, so writing it verbatim guaranteed a dead pointer - and nothing looked broken because
  // overview() deletes a resume row whose target no longer resolves, which is precisely why it went
  // unnoticed: the deck case silently never worked. `card` and `rule` targets are catalog ids, stable
  // across a restore, and those were always fine. Same treatment matches.deck_id already gets.
  if (bundle.resume) {
    const t = bundle.resume.target_type;
    const target = t === 'deck' ? (deckMap.get(bundle.resume.target_id) || null) : bundle.resume.target_id;
    // A deck target that is not in this bundle has nothing to point at; drop the row rather than
    // write a pointer we know is dead.
    if (target) {
      stmts.push(['INSERT OR REPLACE INTO resume(profile_id,target_type,target_id,title,at) VALUES(?,?,?,?,?);',
        [pid, t, target, bundle.resume.title, bundle.resume.at]]);
    }
  }
  if (bundle.settings) {
    const s = bundle.settings;
    // Restore EVERY live setting, including the accessibility trio (font_scale /
    // high_contrast / reduced_motion) - older bundles without them fall back to
    // sensible defaults rather than null. accent_metal (the retired counter-skin
    // picker) is deliberately NOT restored - the counter is gold, full stop.
    stmts.push(['UPDATE settings SET film_grain=?,keep_awake=?,immersive=?,default_max_life=?,die_type=?,haptics=?,rarity_colors=?,theme=?,persist_search=?,font_scale=?,high_contrast=?,reduced_motion=? WHERE profile_id=?;',
      [s.film_grain, s.keep_awake, s.immersive, s.default_max_life, s.die_type, s.haptics, s.rarity_colors, s.theme, s.persist_search,
        s.font_scale ?? 1, s.high_contrast ?? 0, s.reduced_motion ?? 0, pid]]);
  }
  // A deck's W-L is DERIVED from its matches (the single source of truth), so
  // recompute every imported deck from its imported matches rather than trusting
  // the bundle's stored wins/losses - a bundle from an older, pre-derivation
  // build could carry a drifted record. Runs last in the tx, after the matches
  // above are inserted, so the counts see them.
  for (const newDeckId of deckMap.values())
    stmts.push([
      `UPDATE decks SET
         wins   = (SELECT COUNT(*) FROM matches WHERE deck_id=? AND profile_id=? AND winner='player'),
         losses = (SELECT COUNT(*) FROM matches WHERE deck_id=? AND profile_id=? AND winner='opponent')
       WHERE id=? AND profile_id=?;`,
      [newDeckId, pid, newDeckId, pid, newDeckId, pid]]);

  // Mark the imported dashboard as already seeded so a faithfully-restored layout -
  // even a deliberately empty one - is not repopulated with starter widgets; but an
  // old highlights-only dashboard (every block dropped) is left unseeded so first load
  // lays down the starter set rather than showing blank. See shouldMarkDashboardSeeded.
  // A whole-app unit carries the flag explicitly; a legacy bundle has no such field, so the
  // heuristic still decides for it. Same outcome for every file that exists today.
  const markSeeded = dashSeeded === undefined
    ? shouldMarkDashboardSeeded(bundle.dashboard_blocks, importedBlocks)
    : dashSeeded;
  if (markSeeded)
    stmts.push(["INSERT OR REPLACE INTO catalog_meta(key,value) VALUES(?, '1');", [`dash_seeded:${pid}`]]);

  return { pid, statements: stmts };
}

/* NOTE: `exportToFile` and `pickAndImport` were removed with the profile Export/Import buttons
   (owner decision 2026-08-10) - they had no other callers. `exportProfile` and `importProfile`
   REMAIN and are load-bearing: `duplicateProfile` is built on them, and the whole-app restore routes
   legacy single-profile files through `importProfile`. */

export { renameProfile, switchProfile };
