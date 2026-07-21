// Collection pillar data layer - the ownership LEDGER (owned_cards) + the two list
// kinds (card_lists / card_list_entries), plus every consumer of the pure
// compareEngine (deck buildability, wanted-list progress). Named ownedRepository
// (NOT "collection*") because the word is already taken by a deck zone and the
// Codex Marginalia tables. All writes are profile-scoped and route through a small
// revision counter so derived views (deck strips, list bars) refresh live.
//
// Variants: regular copies live on the variant_slug='' row, FOIL copies on the
// variant_slug='foil' row of the same card (foils are tracked as different copies,
// but a foil is still the card). Stats and buildability SUM across variant rows.
// OWNERSHIP FILTERS DO NOT, and that is deliberate: they use the three-state taxonomy in
// store/ownership.js (regular / foilOnly / missing), so a foil-only card is never counted
// as a non-foil copy and set completion stays non-foil. The wishlist is variant-agnostic
// and lives on the '' row only.
import { query, run, tx } from './db.js';
import {
  LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, UNCATEGORISED_BUCKET,
  parsePrinting, printingSlugs, canonicalPrinting, assertRealSetCode, SQL_IS_FOIL,
} from './printings.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { compareRequirements } from './compareEngine.js';
import { deckRequirements, deckRequirementsBulk, parseDeckText } from './deckRepository.js';

/* ---------------- freshness (in-memory revision) ---------------- */
let _rev = 0;
const _subs = new Set();
export function collectionRev() { return _rev; }
export function subscribeCollection(cb) { _subs.add(cb); return () => _subs.delete(cb); }
function bump() { _rev++; for (const cb of [..._subs]) { try { cb(_rev); } catch { /* ignore */ } } }
/** Announce that ownership changed outside this module's own writes - currently the bulk
 *  command, which owns its transaction and fires exactly ONE broadcast after confirmation
 *  rather than one per row. Callers must not use this to pre-announce intended work. */
export function notifyOwnedChanged() { bump(); }

/* ---------------- ownership reads ---------------- */

// A foil copy lives on either the legacy card-level 'foil' row OR a per-set
// '<code>:f' row (e.g. '001:f', written by the set picker). Foil-sensitive
// aggregates MUST recognise both; matching only 'foil' miscounts a set foil as a
// regular copy at the card level (the card view and the set view then disagree).
const isFoil = SQL_IS_FOIL;

// Map<card_id, totalOwned> - THE aggregation across printings, one indexed GROUP
// BY. Optionally narrowed to a set of card_ids. This is the only ownership read
// the engine ever needs; no caller aggregates itself.
export async function ownedMap(cardIds = null, pid = activeProfileId()) {
  let sql = 'SELECT card_id, SUM(qty_owned) t FROM owned_cards WHERE profile_id=?';
  const params = [pid];
  if (cardIds && cardIds.length) { sql += ` AND card_id IN (${cardIds.map(() => '?').join(',')})`; params.push(...cardIds); }
  sql += ' GROUP BY card_id HAVING t>0;';
  const rows = await query(sql, params);
  return new Map(rows.map((r) => [r.card_id, r.t]));
}

// Map<card_id, {owned, foil, wanted}> for decorating a search pool in one query.
// `owned` = REGULAR copies (the '' row); `foil` = the 'foil' row; total = owned+foil.
export async function ownWantMap() {
  const pid = activeProfileId();
  const rows = await query(
    `SELECT card_id,
            SUM(CASE WHEN ${isFoil()} THEN 0 ELSE qty_owned END) o,
            SUM(CASE WHEN ${isFoil()} THEN qty_owned ELSE 0 END) f,
            SUM(qty_wanted) w
     FROM owned_cards WHERE profile_id=? GROUP BY card_id;`, [pid]);
  return new Map(rows.map((r) => [r.card_id, { owned: r.o || 0, foil: r.f || 0, wanted: r.w || 0 }]));
}

// One card's ledger breakdown. `owned` = regular copies, `foil` = foil copies,
// `wanted` = wishlist (variant-agnostic). Same field names the write path takes.
export async function qtyFor(cardId, pid = activeProfileId()) {
  const r = (await query(
    `SELECT SUM(CASE WHEN ${isFoil()} THEN 0 ELSE qty_owned END) o,
            SUM(CASE WHEN ${isFoil()} THEN qty_owned ELSE 0 END) f,
            SUM(qty_wanted) w
     FROM owned_cards WHERE profile_id=? AND card_id=?;`, [pid, cardId]))[0];
  return { owned: r?.o || 0, foil: r?.f || 0, wanted: r?.w || 0 };
}

/* ---------------- ownership writes (upsert the '' row, delete at 0/0) ---------------- */

// Card-level owned edits land on the UNCATEGORISED row - copies whose set is not established.
// That is a legitimate v11 state (unlike an uncategorised WANT, which only migration may make).
// Looks across both schemas and rewrites to canonical, so a legacy row is converted rather than
// twinned.
async function writeQty(cardId, { owned, wanted }, pid = activeProfileId()) {
  const now = nowIso();
  const candidates = printingSlugs(UNCATEGORISED_BUCKET, false);
  const found = await query(
    `SELECT id, variant_slug, qty_owned, qty_wanted FROM owned_cards
      WHERE profile_id=? AND card_id=? AND variant_slug IN (${candidates.map(() => '?').join(',')});`,
    [pid, cardId, ...candidates],
  );
  const cur = found.find((r) => r.variant_slug === UNCATEGORISED) || found[0];
  const o = Math.max(0, owned != null ? owned : (cur?.qty_owned || 0));
  const w = Math.max(0, wanted != null ? wanted : (cur?.qty_wanted || 0));
  if (o === 0 && w === 0) {
    if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]);
  } else if (cur) {
    await run('UPDATE owned_cards SET variant_slug=?, qty_owned=?, qty_wanted=?, updated_at=? WHERE id=?;', [UNCATEGORISED, o, w, now, cur.id]);
  } else {
    await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?);',
      [uuid(), pid, cardId, UNCATEGORISED, o, w, '', now, now]);
  }
  bump();
}
export async function setOwned(cardId, qty, pid = activeProfileId()) { return writeQty(cardId, { owned: qty }, pid); }

/**
 * Thrown when a want gesture cannot tell which collector item the user means.
 *
 * Not an error condition so much as a request for input: the caller catches it and opens the
 * printing picker. Named so a UI can distinguish it from a genuine failure.
 */
export class NeedsPrintingChoice extends Error {
  constructor(cardId, options) {
    super(`Which printing of ${cardId}?`);
    this.name = 'NeedsPrintingChoice';
    this.cardId = cardId;
    this.options = options;
  }
}

/**
 * Which row a card-level want gesture should act on.
 *
 * v10 had one answer for every card: the empty-string row. v11 has as many answers as the card
 * has collector items, so the question has to be asked properly:
 *
 *   an existing want    -> act on THAT row, whichever key it is on. Stepping a want the user can
 *                          see must change the number they are looking at, not create a sibling.
 *   no want, one set    -> that set, non-foil. Not a guess; the card has one printing.
 *   no want, a reprint  -> ask. This is the defect v11 exists to remove.
 *
 * Legacy rows are honoured as targets so a mixed ledger still edits correctly; writing through
 * one converts it, because writeQtyAt rewrites the key it lands on.
 */
async function resolveWantTarget(cardId, pid) {
  const existing = await query(
    'SELECT variant_slug FROM owned_cards WHERE profile_id=? AND card_id=? AND qty_wanted>0;',
    [pid, cardId],
  );
  if (existing.length === 1) {
    const { set, foil } = parsePrinting(existing[0].variant_slug);
    // An uncategorised want is a migration leftover. Editing it in place is correct - triage is
    // what resolves it, and a heart tap must not silently file it to a set on the user's behalf.
    return existing[0].variant_slug === LEGACY_UNCATEGORISED || existing[0].variant_slug === UNCATEGORISED
      ? UNCATEGORISED
      : canonicalPrinting(set, foil);
  }
  if (existing.length > 1) {
    // Several collector items wanted at once: a card-level gesture cannot say which.
    throw new NeedsPrintingChoice(cardId, await setCodesFor(cardId));
  }
  const sets = await setCodesFor(cardId);
  if (sets.length === 1) return canonicalPrinting(sets[0], false);
  throw new NeedsPrintingChoice(cardId, sets);
}

async function setCodesFor(cardId) {
  const row = (await query('SELECT sets FROM cards WHERE card_id=?;', [cardId]))[0];
  try {
    const parsed = JSON.parse(row?.sets || '[]');
    return Array.isArray(parsed) ? parsed.map((x) => x?.code).filter(Boolean) : [];
  } catch { return []; }
}

/**
 * Absolute want on ONE row, preserving whatever else that row holds.
 *
 * Looks for the row across BOTH schemas and rewrites whatever it finds to the canonical key.
 * Looking only for the canonical spelling would insert a SECOND row whenever the want was still
 * sitting on a legacy one - the same orphaning shape as the inflation this activation fixes,
 * and it is only the profile-scope tests that caught it.
 */
async function writeQtyAt(cardId, slug, wanted, pid) {
  const now = nowIso();
  const { set, foil } = parsePrinting(slug);
  const candidates = printingSlugs(set, foil);
  const found = await query(
    `SELECT id, variant_slug, qty_owned, qty_wanted FROM owned_cards
      WHERE profile_id=? AND card_id=? AND variant_slug IN (${candidates.map(() => '?').join(',')});`,
    [pid, cardId, ...candidates],
  );
  const cur = found.find((r) => r.variant_slug === slug) || found[0];
  const w = Math.max(0, wanted | 0);
  const o = cur?.qty_owned || 0;
  if (w === 0 && o === 0) {
    if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]);
  } else if (cur) {
    // Rewrites the key too, so editing a legacy row converts it rather than leaving a twin.
    await run('UPDATE owned_cards SET variant_slug=?, qty_wanted=?, updated_at=? WHERE id=?;', [slug, w, now, cur.id]);
  } else {
    await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?);',
      [uuid(), pid, cardId, slug, w, '', now, now]);
  }
  bump();
}

/**
 * Card-level want. Resolves to a collector item first, then writes exactly one row.
 *
 * The v10 version summed every row's want and wrote the total to the empty-string row, which is
 * why an imported canonical want inflated: it read 2 across all rows, added one, and wrote 3
 * somewhere else while the original stayed put.
 */
export async function setWanted(cardId, qty, pid = activeProfileId(), item = null) {
  // An explicit collector item goes through the SAME validated boundary as every other want
  // writer - it may not name an uncategorised key, and its finish must be a real boolean.
  // Calling canonicalPrinting directly here would have bypassed both.
  if (item?.set != null) {
    assertRealSetCode(item.set, 'setWanted');
    if (typeof item.foil !== 'boolean') throw new Error('setWanted: foil must be a boolean.');
    return writeQtyAt(cardId, canonicalPrinting(item.set, item.foil), qty, pid);
  }
  return writeQtyAt(cardId, await resolveWantTarget(cardId, pid), qty, pid);
}

// Card-level owned edit as a DELTA on the '' ("Uncategorised") bucket. qtyFor sums
// owned across EVERY row (incl. the per-set '001'… rows My Collection writes), so
// reading that total and writing it back to '' (setOwned) double-counts the set
// rows - the +2-on-plus / dead-minus bug. Stepping the '' bucket directly composes
// correctly with the set rows the card sheet doesn't manage.
export async function stepOwnedBucket(cardId, delta, pid = activeProfileId()) {
  const cur = (await query(
    `SELECT SUM(qty_owned) qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug IN (${printingSlugs(UNCATEGORISED_BUCKET, false).map(() => '?').join(',')});`,
    [pid, cardId, ...printingSlugs(UNCATEGORISED_BUCKET, false)]))[0];
  return writeQty(cardId, { owned: Math.max(0, (cur?.qty_owned || 0) + delta) }, pid);
}
export async function stepOwned(cardId, delta, pid = activeProfileId()) { const { owned } = await qtyFor(cardId, pid); return setOwned(cardId, owned + delta, pid); }
export async function stepWanted(cardId, delta, pid = activeProfileId(), item = null) {
  let slug;
  if (item?.set != null) {
    assertRealSetCode(item.set, 'stepWanted');
    if (typeof item.foil !== 'boolean') throw new Error('stepWanted: foil must be a boolean.');
    slug = canonicalPrinting(item.set, item.foil);
  } else {
    slug = await resolveWantTarget(cardId, pid);
  }
  // Reads THAT row, not the card-level total. Summing across rows and writing the sum to one of
  // them is precisely how a single tap could add three.
  const cur = (await query('SELECT qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug]))[0];
  return writeQtyAt(cardId, slug, Math.max(0, (cur?.qty_wanted || 0) + delta), pid);
}

// Foil copies: the variant_slug='foil' row's qty_owned (wishlist never lives here).
// Same upsert/delete-at-0 shape as writeQty, on its own row.
export async function setFoil(cardId, qty, pid = activeProfileId()) {
  const now = nowIso();
  const q = Math.max(0, qty | 0);
  // Card-level FOIL copies with no set recorded: the uncategorised foil item. Found across both
  // schemas and rewritten to canonical, so the legacy 'foil' row is converted rather than twinned.
  const candidates = printingSlugs(UNCATEGORISED_BUCKET, true);
  const found = await query(
    `SELECT id, variant_slug FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug IN (${candidates.map(() => '?').join(',')});`,
    [pid, cardId, ...candidates],
  );
  const cur = found.find((r) => r.variant_slug === UNCATEGORISED_FOIL) || found[0];
  if (q === 0) {
    if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]);
  } else if (cur) {
    await run('UPDATE owned_cards SET variant_slug=?, qty_owned=?, updated_at=? WHERE id=?;', [UNCATEGORISED_FOIL, q, now, cur.id]);
  } else {
    await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);',
      [uuid(), pid, cardId, UNCATEGORISED_FOIL, q, '', now, now]);
  }
  bump();
}

/* ---------------- per-set ownership (My Collection) ----------------
   Alpha and Beta are physically distinct printings, so OWNED copies live on a
   per-set row: variant_slug = the numeric set code ("001" = Alpha regular,
   "001:f" = Alpha foil). The wishlist stays card-level on the '' row. Legacy
   card-level owned (scanner/import/old card sheet, written on '' / 'foil') has
   no set and surfaces under an "Uncategorised" group ('' key) so nothing is lost.
   ownedMap() still SUMs every owned row, so deck buildability is unaffected. */
const SET_UNSPEC = UNCATEGORISED_BUCKET;   // group key for owned copies with no recorded set

// Delegated so v10 and v11 keys bucket identically. A ledger mid-migration holds both, and a
// reader that knew only one would drop the other out of the Collection entirely.
const parseVslug = parsePrinting;
// Foil slug: a named set's foil is "<code>:f" (e.g. "001:f"); the Uncategorised
// bucket's foil is the legacy card-level "foil" row (what setFoil/qtyFor/ownWantMap
// read), NOT ":f" - so an Uncategorised foil reads and writes the same row everywhere.
// ACTIVATED. Writers now emit canonical v11 keys; readers have understood them since the
// compatibility foundation landed, so a ledger holding both is read correctly throughout.
const vslug = canonicalPrinting;

// Write-queue keys: ONE per persisted row, so key equality === owned_cards /
// card_list_entries row equality. Built with the canonical vslug so the 'foil' and
// '<set>:f' rows land on their own chains. The Collection write coordinator
// (src/store/collectionWrites.js) is keyed by these opaque strings and imports
// nothing from here (it stays a leaf); the CALLER supplies the captured profile id.
export const ownedRowKey = (pid, cardId, set = '', foil = false) => `o:${pid}:${cardId}:${vslug(set, foil)}`;
export const listRowKey = (pid, listId, cardId) => `l:${pid}:${listId}:${cardId}`;

// Map "cardId|set" -> { owned, foil } for the whole collection, grouped by printing.
export async function ownedBySet() {
  const pid = activeProfileId();
  const rows = await query('SELECT card_id, variant_slug, qty_owned FROM owned_cards WHERE profile_id=? AND qty_owned>0;', [pid]);
  const m = new Map();
  for (const r of rows) {
    const { set, foil } = parseVslug(r.variant_slug);
    const key = r.card_id + '|' + set;
    const cur = m.get(key) || { owned: 0, foil: 0 };
    cur[foil ? 'foil' : 'owned'] += r.qty_owned;
    m.set(key, cur);
  }
  return m;
}

// Every set bucket a card is owned in (incl '' Uncategorised), for the card sheet's
// set picker: Map<setCode, { owned, foil }>. Same parse as ownedBySet, one card.
export async function ownedSetsForCard(cardId) {
  const pid = activeProfileId();
  const rows = await query('SELECT variant_slug, qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND qty_owned>0;', [pid, cardId]);
  const m = new Map();
  for (const r of rows) {
    const { set, foil } = parseVslug(r.variant_slug);
    const cur = m.get(set) || { owned: 0, foil: 0 };
    cur[foil ? 'foil' : 'owned'] += r.qty_owned;
    m.set(set, cur);
  }
  return m;
}

// One (card, set) breakdown, for the optimistic-step re-read.
export async function qtyForInSet(cardId, set, pid = activeProfileId()) {
  // Names EVERY slug the pair can occupy in either schema - a two-slug IN() stopped matching
  // the moment canonicalisation rewrote the row it was looking for.
  const slugs = [...printingSlugs(set, false), ...printingSlugs(set, true)];
  const rows = await query(`SELECT variant_slug, qty_owned FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug IN (${slugs.map(() => '?').join(',')});`, [pid, cardId, ...slugs]);
  let owned = 0, foil = 0;
  for (const r of rows) { if (parseVslug(r.variant_slug).foil) foil += r.qty_owned; else owned += r.qty_owned; }
  return { owned, foil };
}

async function writeSetRow(cardId, set, foil, qty, pid = activeProfileId()) {
  const slug = vslug(set, foil);
  // The UNCATEGORISED row can carry a want as well as copies - a migrated want on an ambiguous
  // reprint lives exactly there. Route it through writeQty, which preserves qty_wanted, rather
  // than the delete-at-0 below, which would take the want with it.
  //
  // This guard used to read `slug === ''` and became DEAD the moment writers went canonical:
  // vslug now returns 'uncategorised', so every uncategorised reduction fell through to the
  // delete. Comparing against the canonical constant instead of a literal is the whole reason
  // those constants exist.
  if (slug === UNCATEGORISED) return writeQty(cardId, { owned: qty }, pid);
  const now = nowIso();
  const q = Math.max(0, qty | 0);
  const cur = (await query('SELECT id FROM owned_cards WHERE profile_id=? AND card_id=? AND variant_slug=?;', [pid, cardId, slug]))[0];
  if (q === 0) { if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]); }
  else if (cur) await run('UPDATE owned_cards SET qty_owned=?, updated_at=? WHERE id=?;', [q, now, cur.id]);
  else await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?);', [uuid(), pid, cardId, slug, q, '', now, now]);
  bump();
}
export async function setOwnedInSet(cardId, set, qty, pid = activeProfileId()) { return writeSetRow(cardId, set, false, qty, pid); }
export async function setFoilInSet(cardId, set, qty, pid = activeProfileId()) { return writeSetRow(cardId, set, true, qty, pid); }

/* ---------------- v11 wants: per collector item ---------------- */
//
// DORMANT. Nothing routes here yet - the picker and triage surfaces land next, and the
// activation commit switches the existing card-level writers over. These exist now so the
// canonical write path can be built and tested before anything depends on it.
//
// The v10 writers above put every want on the card-level '' row, so "I need the Beta one" was
// unrepresentable: a want knew neither its set nor its finish. These take a collector item -
// card + set + finish - and write the canonical key for it, and only ever that key.

/**
 * Find the row for a collector item, in EITHER schema.
 *
 * During the transition the same collector item can be sitting on a legacy key or a canonical
 * one. Looking only for the canonical key would create a SECOND row meaning the same thing,
 * and the two would drift apart. Canonical is preferred when both somehow exist.
 */
/**
 * Refuse to create an unresolved want.
 *
 * §2.1 reserves uncategorised wants for MIGRATION and import alone: they are a transitional
 * state triage exists to remove, not something ordinary code may produce. A caller that skips
 * wantIntent, or hands over a half-built item, would otherwise manufacture exactly the state
 * this whole effort is removing - and nothing downstream would object, because the row is
 * perfectly well-formed.
 *
 * Throws BEFORE any mutation or notification, so a rejected call leaves nothing behind and no
 * subscriber sees a change that did not happen.
 *
 * canonicalPrinting stays permissive on purpose: ownership migration genuinely needs to write
 * uncategorised keys. The invariant belongs here, at the want boundary, not in the key helper.
 *
 * The check is assertRealSetCode, shared with every other writer that may not create an
 * unresolved row. An earlier version listed the forbidden values inline and missed half of
 * them: the legacy 'foil' key passed as a "set", and '001:f' produced the malformed '001:f:f'.
 * A hand-written list of what to reject is the wrong shape - the rule is what a set code IS.
 */
const requireResolvedSet = assertRealSetCode;

async function resolveItemRow(cardId, set, foil, pid) {
  const slugs = printingSlugs(set, foil);
  const rows = await query(
    `SELECT id, variant_slug, qty_owned, qty_wanted FROM owned_cards
      WHERE profile_id=? AND card_id=? AND variant_slug IN (${slugs.map(() => '?').join(',')});`,
    [pid, cardId, ...slugs],
  );
  const canonical = canonicalPrinting(set, foil);
  return rows.find((r) => r.variant_slug === canonical) || rows[0] || null;
}

/**
 * Set the wanted quantity for one collector item.
 *
 * Writing over a legacy row REWRITES it to the canonical key rather than leaving it behind.
 * That is deliberate: it is the same collector item either way, and converting on write means
 * an edited row stops being a straggler the boot pass would otherwise have to catch.
 *
 * The row is deleted only when BOTH quantities reach zero. The uncategorised row is shared
 * between ownership and the wishlist, so deleting it on wanted=0 would silently take the
 * user's owned copies with it - the exact shape of the bug that made '' unsafe to drop.
 */
export async function setWantedForItem(cardId, { set, foil = false } = {}, qty, pid = activeProfileId()) {
  requireResolvedSet(set, 'setWantedForItem');
  const now = nowIso();
  const slug = canonicalPrinting(set, foil);
  const cur = await resolveItemRow(cardId, set, foil, pid);
  const w = Math.max(0, qty | 0);
  const o = cur?.qty_owned || 0;
  if (w === 0 && o === 0) {
    if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]);
  } else if (cur) {
    await run('UPDATE owned_cards SET variant_slug=?, qty_wanted=?, updated_at=? WHERE id=?;', [slug, w, now, cur.id]);
  } else {
    await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?);',
      [uuid(), pid, cardId, slug, w, '', now, now]);
  }
  bump();
}

/** Step a collector item's want by a delta, floored at zero. */
export async function stepWantedForItem(cardId, item = {}, delta = 1, pid = activeProfileId()) {
  requireResolvedSet(item.set, 'stepWantedForItem');
  const cur = await resolveItemRow(cardId, item.set, !!item.foil, pid);
  return setWantedForItem(cardId, item, Math.max(0, (cur?.qty_wanted || 0) + delta), pid);
}

/**
 * Atomic +N want on one collector item, for callers that cannot serialize their writes.
 *
 * Upsert rather than read-modify-write, same reason as addCopies: overlapping increments from
 * independent events would otherwise lose each other. It targets the canonical key only, so a
 * legacy row for the same item is NOT merged here - that is left to the boot pass, because
 * doing it atomically would need the read this function exists to avoid.
 */
export async function addWantedForItem(cardId, { set, foil = false } = {}, n = 1, pid = activeProfileId()) {
  requireResolvedSet(set, 'addWantedForItem');
  if (!cardId || !(n > 0)) return;
  const now = nowIso();
  await run(
    `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
     VALUES(?,?,?,?,0,?,'',?,?)
     ON CONFLICT(profile_id,card_id,variant_slug)
     DO UPDATE SET qty_wanted=qty_wanted+excluded.qty_wanted, updated_at=excluded.updated_at;`,
    [uuid(), pid, cardId, canonicalPrinting(set, foil), n, now, now],
  );
  bump();
}

/** Every collector item this card is wanted on: Map<canonical slug, qty>. */
export async function wantedItemsForCard(cardId, pid = activeProfileId()) {
  const rows = await query('SELECT variant_slug, qty_wanted FROM owned_cards WHERE profile_id=? AND card_id=? AND qty_wanted>0;', [pid, cardId]);
  const m = new Map();
  for (const r of rows) {
    const { set, foil } = parsePrinting(r.variant_slug);
    m.set(canonicalPrinting(set, foil), (m.get(canonicalPrinting(set, foil)) || 0) + r.qty_wanted);
  }
  return m;
}

// Atomic +N to owned/wanted via a single upsert (no read-modify-write). For callers
// that can't serialize their writes - notably the scanner's rapid, independent
// scanAction events, where step*'s read-then-write would lose overlapping increments.
export async function addOwnedCopies(cardId, n = 1) { return addCopies(cardId, 'qty_owned', n); }
export async function addWantedCopies(cardId, n = 1, pid = activeProfileId()) {
  // Resolves first, then upserts onto that one row. Still overlap-safe: the upsert is atomic,
  // and the resolve is a read that only decides WHICH row the atomic add lands on.
  const slug = await resolveWantTarget(cardId, pid);
  const now = nowIso();
  await run(
    `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
     VALUES(?,?,?,?,0,?,'',?,?)
     ON CONFLICT(profile_id,card_id,variant_slug)
     DO UPDATE SET qty_wanted=qty_wanted+excluded.qty_wanted, updated_at=excluded.updated_at;`,
    [uuid(), pid, cardId, slug, n, now, now],
  );
  bump();
}
async function addCopies(cardId, col, n) {
  if (!cardId || !(n > 0)) return;
  const pid = activeProfileId();
  const now = nowIso();
  // col is an internal constant ('qty_owned' | 'qty_wanted'), never user input.
  //
  // Lands on the UNCATEGORISED row: copies whose set the scanner could not establish. That is a
  // legitimate v11 state for ownership, and the To Be Categorised pile is where it is resolved.
  // It stays an upsert rather than a read-modify-write because scan events arrive faster than
  // they can be serialised, and overlapping increments must not lose each other.
  await run(
    `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
     VALUES(?,?,?,?,?,?,'',?,?)
     ON CONFLICT(profile_id,card_id,variant_slug)
     DO UPDATE SET ${col}=${col}+excluded.${col}, updated_at=excluded.updated_at;`,
    [uuid(), pid, cardId, UNCATEGORISED, col === 'qty_owned' ? n : 0, col === 'qty_wanted' ? n : 0, now, now]
  );
  bump();
}

// Atomic +N owned onto a specific PRINTING (set-coded row). Same overlap-safe
// upsert as addOwnedCopies, but on the '001'/'002'/… row - the scanner uses this
// to file a recognised single-set card under its (only) set instead of Uncategorised.
export async function addOwnedCopiesInSet(cardId, set, n = 1) {
  if (!cardId || !set || !(n > 0)) return;
  const pid = activeProfileId();
  const now = nowIso();
  await run(
    `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
     VALUES(?,?,?,?,?,0,'',?,?)
     ON CONFLICT(profile_id,card_id,variant_slug)
     DO UPDATE SET qty_owned=qty_owned+excluded.qty_owned, updated_at=excluded.updated_at;`,
    [uuid(), pid, cardId, set, n, now, now]
  );
  bump();
}

// backfillSingleSetOwned lived here. Canonicalisation converts the empty-string rows it used
// to look for, so it would find nothing; and retargeting it at the uncategorised key would
// contradict the approved triage model, which requires the user to be present when previously
// recorded copies are moved. Removed rather than rewritten.

// PREVIEW a bulk import without writing: resolve each "qty name" line to a card and
// its sets, merging duplicate names. The import review sheet uses this to let the
// user pick a printing for multi-set cards before committing. Returns
// { items: [{ card_id, name, qty, sets:[{code,name}] }], unresolved: [name] }.
export async function previewCollectionText(text) {
  const { avatar, zones } = parseDeckText(text);
  const lines = [...zones.spellbook, ...zones.atlas, ...zones.collection];
  if (avatar) lines.push({ name: avatar, qty: 1 });
  const byName = new Map();   // lower(name) -> { name, qty }
  for (const { name, qty } of lines) {
    const key = String(name).toLowerCase();
    byName.set(key, { name, qty: (byName.get(key)?.qty || 0) + Math.max(1, qty | 0) });
  }
  const items = [];
  const unresolved = [];
  for (const { name, qty } of byName.values()) {
    const c = (await query('SELECT card_id, name, sets FROM cards WHERE lower(name)=? LIMIT 1;', [name.toLowerCase()]))[0];
    if (!c) { unresolved.push(name); continue; }
    let sets = []; try { sets = JSON.parse(c.sets || '[]'); } catch { /* leave empty */ }
    items.push({ card_id: c.card_id, name: c.name, qty, sets: Array.isArray(sets) ? sets : [] });
  }
  return { items, unresolved };
}

// Commit a reviewed import: each item files its copies into a chosen bucket. setCode
// '' (or falsy) = the Uncategorised bucket; a set code files that printing. One tx.
export async function importCollectionResolved(items) {
  const pid = activeProfileId();
  const now = nowIso();
  const stmts = [];
  let copies = 0, names = 0;
  for (const { card_id, qty, setCode } of items || []) {
    const n = Math.max(0, qty | 0);
    if (!card_id || n <= 0) continue;
    names++; copies += n;
    stmts.push([
      `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
       VALUES(?,?,?,?,?,0,'',?,?)
       ON CONFLICT(profile_id,card_id,variant_slug)
       DO UPDATE SET qty_owned=qty_owned+excluded.qty_owned, updated_at=excluded.updated_at;`,
      // A resolved set when the review sheet established one, otherwise the uncategorised row -
      // never the v10 empty string, which a v11 reader would not recognise as ownership.
      [uuid(), pid, card_id, setCode ? canonicalPrinting(setCode, false) : UNCATEGORISED, n, now, now],
    ]);
  }
  if (stmts.length) await tx(stmts);
  bump();
  return { copies, names };
}

/**
 * Add a shortfall to the Wishlist. MAX (not +=) so re-running a deck's "add missing" never
 * inflates a want beyond the largest shortfall.
 *
 * v11: every want it creates names a collector item. It used to write them all to the
 * empty-string row, which under v11 would be an unresolved want created by ordinary code - the
 * one thing §2.1 forbids outside migration, import and triage.
 *
 * A card printed once resolves on its own. A REPRINT cannot: the deck does not say which
 * printing the player wants, and guessing is the defect this whole schema change removes. So
 * those are reported back UNRESOLVED rather than written, and the caller decides - either by
 * asking, or by telling the user plainly that they were skipped.
 *
 * @returns { added, unresolved } - `unresolved` is `[{ card_id, sets }]`, ready to feed a picker.
 */
export async function addMissingToWishlist(lines) {
  const pid = activeProfileId();
  const now = nowIso();
  const stmts = [];
  const unresolved = [];

  const wanted = (lines || []).filter((l) => l.card_id && l.missing > 0);
  if (!wanted.length) return { added: 0, unresolved: [] };

  // One catalog read for the whole batch rather than one per line.
  const ids = [...new Set(wanted.map((l) => l.card_id))];
  const catalog = new Map();
  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400);
    for (const c of await query(`SELECT card_id, sets FROM cards WHERE card_id IN (${slice.map(() => '?').join(',')});`, slice)) {
      try {
        const parsed = JSON.parse(c.sets || '[]');
        catalog.set(c.card_id, Array.isArray(parsed) ? [...new Set(parsed.map((x) => x?.code).filter(Boolean))] : []);
      } catch { catalog.set(c.card_id, []); }
    }
  }

  for (const l of wanted) {
    const sets = catalog.get(l.card_id) || [];
    if (sets.length !== 1) { unresolved.push({ card_id: l.card_id, sets }); continue; }
    stmts.push([
      `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
       VALUES(?,?,?,?,0,?,'',?,?)
       ON CONFLICT(profile_id,card_id,variant_slug)
       DO UPDATE SET qty_wanted=MAX(qty_wanted, excluded.qty_wanted), updated_at=excluded.updated_at;`,
      [uuid(), pid, l.card_id, canonicalPrinting(sets[0], false), l.missing, now, now],
    ]);
  }
  if (stmts.length) await tx(stmts);
  if (stmts.length) bump();
  return { added: stmts.length, unresolved };
}

/* ---------------- lists (one model, kind: 'wanted' | 'custom') ---------------- */

export async function listCardLists(kind = null) {
  const pid = activeProfileId();
  const rows = kind
    ? await query('SELECT * FROM card_lists WHERE profile_id=? AND kind=? ORDER BY sort_order ASC, name ASC;', [pid, kind])
    : await query('SELECT * FROM card_lists WHERE profile_id=? ORDER BY kind DESC, sort_order ASC, name ASC;', [pid]);
  if (!rows.length) return rows;
  const ids = rows.map((l) => l.id);
  const counts = await query(`SELECT list_id, COUNT(*) n FROM card_list_entries WHERE list_id IN (${ids.map(() => '?').join(',')}) GROUP BY list_id;`, ids);
  const byId = new Map(counts.map((c) => [c.list_id, c.n]));
  for (const l of rows) l.entryCount = byId.get(l.id) || 0;
  return rows;
}

export async function createList(kind, name, description = '') {
  const pid = activeProfileId();
  const id = uuid();
  const now = nowIso();
  await run('INSERT INTO card_lists(id,profile_id,kind,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?);',
    [id, pid, kind === 'wanted' ? 'wanted' : 'custom', name.trim() || 'Untitled', description || '', now, now]);
  bump();
  return id;
}
export async function renameList(listId, name, description) {
  const pid = activeProfileId();
  await run('UPDATE card_lists SET name=?, description=?, updated_at=? WHERE id=? AND profile_id=?;',
    [name.trim() || 'Untitled', description || '', nowIso(), listId, pid]);
  bump();
}
export async function deleteList(listId) {
  const pid = activeProfileId();
  await run('DELETE FROM card_lists WHERE id=? AND profile_id=?;', [listId, pid]);   // entries cascade
  bump();
}
export async function duplicateList(listId) {
  const pid = activeProfileId();
  const src = (await query('SELECT * FROM card_lists WHERE id=? AND profile_id=?;', [listId, pid]))[0];
  if (!src) return null;
  const nid = await createList(src.kind, `${src.name} (copy)`, src.description);
  const entries = await query('SELECT card_id, quantity, variant_slug FROM card_list_entries WHERE list_id=?;', [listId]);
  if (entries.length) {
    const now = nowIso();
    await tx(entries.map((e) => [
      'INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,?,?,?);',
      [uuid(), nid, e.card_id, e.quantity, e.variant_slug || '', now],
    ]));
  }
  bump();
  return nid;
}

// EVERY child-list read joins card_lists and filters on profile_id.
//
// Writes already refused a foreign list id, but reads did not, and the Collection session
// cache is a module singleton: open profile A's list, switch to B, come back, and A's name,
// entries, progress and EXPORT could render under B. Scoping the parent in SQL means the
// boundary holds even if a stale id reaches the repository - defence at the layer that owns
// the data, not only at the layer that happens to call it.
export async function listEntries(listId, pid = activeProfileId()) {
  return query(
    `SELECT e.card_id, e.quantity FROM card_list_entries e
     JOIN card_lists l ON l.id = e.list_id
     WHERE e.list_id=? AND l.profile_id=? ORDER BY e.added_at ASC;`,
    [listId, pid]
  );
}

// The first few cards' art per list, for the index's card-art "fan" (Map<listId,
// [{card_id, image_slug, is_site}]>, up to `perList`). One query for all lists,
// sliced in JS (the lists page has only a handful of lists).
export async function listThumbsBulk(listIds, perList = 3) {
  if (!listIds || !listIds.length) return new Map();
  const pid = activeProfileId();
  const rows = await query(
    `SELECT e.list_id, c.card_id, c.image_slug, c.is_site
     FROM card_list_entries e
     JOIN cards c ON c.card_id=e.card_id
     JOIN card_lists l ON l.id = e.list_id
     WHERE e.list_id IN (${listIds.map(() => '?').join(',')}) AND l.profile_id=?
     ORDER BY e.list_id, e.added_at ASC;`, [...listIds, pid]);
  const m = new Map();
  for (const r of rows) {
    const arr = m.get(r.list_id) || [];
    if (arr.length < perList) { arr.push(r); m.set(r.list_id, arr); }
  }
  return m;
}
// Set a card's quantity in a list (0 deletes). variant_slug='' in v1.
export async function setListEntry(listId, cardId, qty, pid = activeProfileId()) {
  // card_list_entries has no profile_id of its own - it is owned via card_lists. Verify
  // the list belongs to the supplied profile, so a stale/foreign listId (e.g. a write
  // scheduled under one profile after a switch) can never mutate another profile's list.
  const list = (await query('SELECT id FROM card_lists WHERE id=? AND profile_id=?;', [listId, pid]))[0];
  if (!list) return;   // not this profile's list -> refuse (the queue key claimed this profile; the boundary enforces it)
  const q = Math.max(0, qty | 0);
  const cur = (await query('SELECT id FROM card_list_entries WHERE list_id=? AND card_id=? AND variant_slug=?;', [listId, cardId, '']))[0];
  if (q === 0) { if (cur) await run('DELETE FROM card_list_entries WHERE id=?;', [cur.id]); }
  else if (cur) await run('UPDATE card_list_entries SET quantity=? WHERE id=?;', [q, cur.id]);
  else await run('INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,?,?,?);', [uuid(), listId, cardId, q, '', nowIso()]);
  bump();
}
export async function stepListEntry(listId, cardId, delta, pid = activeProfileId()) {
  // Read scoped to the profile's list too, so both the read and the write of this
  // step trust the same captured profile (a foreign list reads 0 and then refuses).
  const cur = (await query(
    'SELECT e.quantity q FROM card_list_entries e JOIN card_lists l ON l.id=e.list_id WHERE e.list_id=? AND e.card_id=? AND e.variant_slug=? AND l.profile_id=?;',
    [listId, cardId, '', pid]))[0];
  return setListEntry(listId, cardId, (cur?.q || 0) + delta, pid);
}

// Card-level requirement of a list (mirrors deckRequirements shape).
async function listRequirements(listId, pid = activeProfileId()) {
  const rows = await query(
    `SELECT e.card_id, SUM(e.quantity) q FROM card_list_entries e
     JOIN card_lists l ON l.id = e.list_id
     WHERE e.list_id=? AND l.profile_id=? GROUP BY e.card_id;`,
    [listId, pid]
  );
  return rows.map((r) => ({ card_id: r.card_id, qty: r.q }));
}

// A list's cards joined to the catalog (for the list detail view). quantity =
// target (wanted) or copies (custom).
export async function listCards(listId, pid = activeProfileId()) {
  return query(
    `SELECT e.card_id, e.quantity, c.name, c.type, c.cost, c.attack, c.defence, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.rules_text, c.sets
     FROM card_list_entries e
     JOIN cards c ON c.card_id=e.card_id
     JOIN card_lists l ON l.id = e.list_id
     WHERE e.list_id=? AND l.profile_id=? ORDER BY c.name;`,
    [listId, pid]
  );
}

// The Wishlist: every card you want (qty_wanted>0), joined to the catalog, with
// its owned + wanted quantities. A virtual, un-deletable "list" backed by the
// ownership ledger (qty_wanted) rather than a card_lists row - so `quantity` here
// is the wanted goal, matching listCards' shape for a shared detail view.
export async function wishlistCards() {
  const pid = activeProfileId();
  return query(
    `SELECT o.card_id, SUM(o.qty_wanted) quantity, SUM(o.qty_owned) owned,
            c.name, c.type, c.cost, c.attack, c.defence, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.rules_text, c.sets
     FROM owned_cards o JOIN cards c ON c.card_id=o.card_id
     WHERE o.profile_id=? GROUP BY o.card_id HAVING SUM(o.qty_wanted)>0 ORDER BY c.name;`,
    [pid]
  );
}

// Flat "qty name" text of a list - the Curiosa deck-export format, so it pastes
// straight into Curiosa, a deck's Import from text, or back into Collection's
// own bulk import.
export async function exportListText(listId) {
  const rows = await listCards(listId);
  return rows.map((r) => `${r.quantity} ${r.name}`).join('\n');
}

// Same flat export for the Wishlist (qty_wanted ledger) - take it to a shop.
export async function wishlistExportText() {
  const rows = await wishlistCards();
  return rows.map((r) => `${r.quantity} ${r.name}`).join('\n');
}

// Lists a card appears in (for card detail "Appears in").
export async function listsWithCard(cardId) {
  const pid = activeProfileId();
  return query(
    `SELECT l.id, l.name, l.kind, e.quantity FROM card_list_entries e JOIN card_lists l ON l.id=e.list_id
     WHERE e.card_id=? AND l.profile_id=? ORDER BY l.kind DESC, l.name ASC;`,
    [cardId, pid]
  );
}

/* ---------------- engine callers (the one primitive, everywhere) ---------------- */

export async function deckBuildability(deckId) {
  const { required, unresolved } = await deckRequirements(deckId);
  const owned = await ownedMap(required.map((r) => r.card_id));
  return compareRequirements(required, owned, unresolved);
}
// Deck library: all decks against ONE owned map (no N+1).
export async function deckBuildabilityBulk(deckIds) {
  const reqByDeck = await deckRequirementsBulk(deckIds);
  const owned = await ownedMap();   // full map once
  const out = new Map();
  for (const [id, { required, unresolved }] of reqByDeck) out.set(id, compareRequirements(required, owned, unresolved));
  return out;
}
// CAPTURE THE PROFILE ONCE. Progress is two reads with an await between them, and each used
// to resolve the active profile independently - so a switch landing in that gap could combine
// one profile's requirements with another's ownership. Binding both reads to a single pid
// makes the whole calculation belong to one profile by construction.
export async function listProgress(listId, pid = activeProfileId()) {
  const required = await listRequirements(listId, pid);
  const owned = await ownedMap(required.map((r) => r.card_id), pid);
  return compareRequirements(required, owned, 0);
}
export async function listProgressBulk(listIds, pid = activeProfileId()) {
  const out = new Map();
  if (!listIds.length) return out;
  const owned = await ownedMap(null, pid);   // full map once, bound to the captured profile
  // One grouped query for all lists' requirements (no N+1, mirrors deckRequirementsBulk).
  const rows = await query(
    `SELECT e.list_id, e.card_id, SUM(e.quantity) q FROM card_list_entries e
     JOIN card_lists l ON l.id = e.list_id
     WHERE e.list_id IN (${listIds.map(() => '?').join(',')}) AND l.profile_id=?
     GROUP BY e.list_id, e.card_id;`,
    [...listIds, pid]
  );
  const byList = new Map(listIds.map((id) => [id, []]));
  for (const r of rows) byList.get(r.list_id)?.push({ card_id: r.card_id, qty: r.q });
  for (const id of listIds) out.set(id, compareRequirements(byList.get(id), owned, 0));
  return out;
}

/* ---------------- dashboard stats ---------------- */

export async function collectionStats() {
  const pid = activeProfileId();
  const own = (await query('SELECT COALESCE(SUM(qty_owned),0) total, COUNT(DISTINCT CASE WHEN qty_owned>0 THEN card_id END) unique_cards, COALESCE(SUM(qty_wanted),0) wishlist FROM owned_cards WHERE profile_id=?;', [pid]))[0];
  return {
    owned: own?.total || 0,
    unique: own?.unique_cards || 0,
    wishlist: own?.wishlist || 0,
  };
}

// card_id -> name, for labelling engine output (missing lists) without the engine
// (which is pure) knowing about the catalog.
export async function cardNames(ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(`SELECT card_id, name FROM cards WHERE card_id IN (${ids.map(() => '?').join(',')});`, ids);
  return new Map(rows.map((r) => [r.card_id, r.name]));
}

// Recently touched owned cards (for the Overview strip), joined to the catalog.
// Grouped by card so a card's regular + foil rows read as ONE entry, with the
// regular/foil split the binder row's pill rail renders (rules_text rides along
// for the playset check's any-number-of exemption).
export async function recentlyAdded(limit = 8) {
  const pid = activeProfileId();
  return query(
    `SELECT o.card_id,
            SUM(CASE WHEN ${isFoil('o.variant_slug')} THEN 0 ELSE o.qty_owned END) qty_owned,
            SUM(CASE WHEN ${isFoil('o.variant_slug')} THEN o.qty_owned ELSE 0 END) qty_foil,
            SUM(o.qty_wanted) qty_wanted,
            (SELECT o2.variant_slug FROM owned_cards o2
             WHERE o2.profile_id=o.profile_id AND o2.card_id=o.card_id AND o2.qty_owned>0
             ORDER BY o2.updated_at DESC LIMIT 1) owned_slug,
            c.name, c.type, c.cost, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.sets, c.rules_text
     FROM owned_cards o JOIN cards c ON c.card_id=o.card_id
     WHERE o.profile_id=?
     GROUP BY o.card_id HAVING SUM(o.qty_owned)>0
     ORDER BY MAX(o.updated_at) DESC LIMIT ?;`,
    [pid, limit]
  );
}
