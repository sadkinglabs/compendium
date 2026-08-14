// Collection pillar data layer - the ownership LEDGER (owned_cards) + the two list
// kinds (card_lists / card_list_entries), plus every consumer of the pure
// compareEngine (deck buildability, wanted-list progress). Named ownedRepository
// (NOT "collection*") because the word is already taken by a deck zone and the
// Codex Marginalia tables. All writes are profile-scoped and route through a small
// revision counter so derived views (deck strips, list bars) refresh live.
//
// COLLECTOR ITEMS (schema v11): a row is card + set + finish - '001', '001:f',
// 'uncategorised', 'uncategorised:f'. The v10 keys ('' and 'foil') are still READ so a
// partially converted ledger buckets correctly, but no writer emits them.
// Stats and buildability SUM across a card's items. OWNERSHIP FILTERS DO NOT, and that is
// deliberate: they use the three-state taxonomy in store/ownership.js (regular / foilOnly /
// missing), so a foil-only card is never counted as a non-foil copy and set completion stays
// non-foil. A WANT belongs to a collector item, not to a card - "I need the Beta one" is the
// whole point of v11 - so the wishlist is per collector item, not per card name.
import { query, run, tx } from './db.js';
import { enqueueWrite } from './collectionWrites.js';
import {
  LEGACY_UNCATEGORISED, LEGACY_FOIL, UNCATEGORISED, UNCATEGORISED_FOIL, UNCATEGORISED_BUCKET,
  parsePrinting, printingSlugs, canonicalPrinting, assertRealSetCode, SQL_IS_FOIL, SQL_IS_UNCATEGORISED,
} from './printings.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { compareRequirements } from './compareEngine.js';
import { deckRequirements, deckRequirementsBulk } from './deckRepository.js';
import { parseItemText, formatItemLine } from './itemLineGrammar.js';
import { printingFinishes } from './printingRows.js';
import { getCard } from './codexRepository.js';
import { MAX_BATCH_ITEMS } from './bulkWriteContract.js';

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
// `wanted` = wishlist (per collector item). Same field names the write path takes.
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
   "001:f" = Alpha foil). The wishlist is per collector item on the '' row. Legacy
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

/**
 * Chain key for a CARD-LEVEL want edit, where the target row is resolved at write time.
 *
 * ownedRowKey cannot serve here: it needs the collector item up front, and setWanted/stepWanted
 * only discover theirs by reading the ledger. Keying on a guessed item produced a chain that did
 * not match the row eventually written, so the card sheet and the wishlist could serialize edits
 * to the SAME want on two different chains and lose one.
 *
 * Deliberately coarser than a row: every want edit on this card shares one chain. Slightly more
 * serialisation than strictly required, and correct regardless of which row the write resolves
 * to - which is the trade worth making for a gesture whose target is not known in advance.
 */
export const cardWantKey = (pid, cardId) => `o:${pid}:${cardId}:*want`;

/**
 * Bind a want edit to its serialisation chain. THE only way any surface should queue one.
 *
 * Both surfaces previously chose their own key - the card sheet used cardWantKey while the
 * Wishlist rows used ownedRowKey - so two edits to the same want ran on different chains and
 * one could clobber the other. A test that reproduces the intended keys by hand cannot catch
 * that, because it is testing its own assumption rather than the code. Routing every caller
 * through one helper makes the binding a fact about the module instead of a convention.
 *
 * The exact collector item lives INSIDE `fn`; the key is deliberately coarser, so any two want
 * edits to one card serialise regardless of which items they touch.
 */
export function queueWantWrite(pid, cardId, write) {
  // The captured profile is passed INTO the write, not only encoded in the key. Encoding it in
  // the key alone was a real isolation hole: a parked A-bound write that read activeProfileId()
  // when it finally ran would mutate B if the profile had switched in the meantime. The key
  // decides which chain serialises; the argument decides which profile is written.
  return enqueueWrite(cardWantKey(pid, cardId), () => write(pid));
}
export const listRowKey = (pid, listId, cardId) => `l:${pid}:${listId}:${cardId}`;

// Map "cardId|set" -> { owned, foil, updated } for the whole collection, grouped by printing.
// `updated` is the LATEST updated_at across the printing's rows (standard + foil) - collector-record
// activity, NOT a first-owned time: a want can create the row before any copy is acquired, so
// created_at is not an acquisition date. It drives the "Recently updated" sort. A true "first owned"
// would need a persisted per-item ownership timestamp (a separate migration).
export async function ownedBySet() {
  const pid = activeProfileId();
  const rows = await query('SELECT card_id, variant_slug, qty_owned, updated_at FROM owned_cards WHERE profile_id=? AND qty_owned>0;', [pid]);
  const m = new Map();
  for (const r of rows) {
    const { set, foil } = parseVslug(r.variant_slug);
    const key = r.card_id + '|' + set;
    const cur = m.get(key) || { owned: 0, foil: 0, updated: '' };
    cur[foil ? 'foil' : 'owned'] += r.qty_owned;
    if (r.updated_at && r.updated_at > cur.updated) cur.updated = r.updated_at;   // MAX(updated_at)
    m.set(key, cur);
  }
  return m;
}

/** Set codes for a batch of cards: Map<card_id, string[]>. One read, chunked for the host-parameter limit. */
export async function cardSetsFor(cardIds = []) {
  const out = new Map();
  const ids = [...new Set(cardIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400);
    for (const c of await query(`SELECT card_id, sets FROM cards WHERE card_id IN (${slice.map(() => '?').join(',')});`, slice)) {
      try {
        const parsed = JSON.parse(c.sets || '[]');
        out.set(c.card_id, Array.isArray(parsed) ? [...new Set(parsed.map((x) => x?.code).filter(Boolean))] : []);
      } catch { out.set(c.card_id, []); }
    }
  }
  return out;
}

/**
 * Every row in the To Be Categorised pile, for the active profile.
 *
 * Reads all four uncategorised keys, not just the canonical pair: a ledger can still hold a
 * legacy row from an import or an interrupted conversion, and those need triaging too.
 */
export async function uncategorisedRows(pid = activeProfileId()) {
  return query(
    `SELECT card_id, variant_slug, qty_owned, qty_wanted FROM owned_cards
      WHERE profile_id=? AND ${SQL_IS_UNCATEGORISED()} AND (qty_owned>0 OR qty_wanted>0);`,
    [pid],
  );
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

// A POSITIVE want-write must name a printing the catalog actually lists. The durable v11 ledger is
// the source of truth for the collection; a phantom item - a foil on a set whose printing is
// non-foil only (Promotional 999 for a card without a foil promo) - would survive forever and
// misreport buildability. The heart and the reprint picker are UI and can be wrong, so the invariant
// is enforced HERE, at the one boundary every want passes through (defense in depth, not instead of
// the UI fix).
//
// Only POSITIVE writes validate. Setting a want to 0, or stepping one DOWN, must always succeed so a
// user can clear a historical malformed row this guard would now reject on the way in. A malformed
// catalog variant (printingFinishes throws) is treated as "no such printing" and also rejected -
// refusing a dubious write beats seeding a ledger row nothing can describe. `foil` is already an
// exact boolean here - requireBooleanFinish runs first in every exported writer.
async function assertRealPrinting(cardId, set, foil, action) {
  const card = cardId ? await getCard(cardId) : null;
  let f = null;
  if (card) { try { f = printingFinishes(card, set); } catch { f = null; } }
  if (!(f && (foil ? f.foil : f.nonFoil))) {
    const e = new Error(`${action}: no ${foil ? 'foil' : 'non-foil'} printing of ${cardId} in set ${set}`);
    e.name = 'InvalidPrinting';
    throw e;
  }
}

// The finish must be an EXACT boolean before canonicalisation. `!!foil` was a real hole: a caller
// passing `foil:'false'` coerced to true, and on a card that genuinely HAS a foil printing the
// catalog check then passed - silently storing a non-foil intent as foil. A malformed finish is a
// caller bug; reject it, never guess. Every exported item writer calls this first, so the SQL
// primitive below can trust its input.
function requireBooleanFinish(foil, action) {
  if (typeof foil !== 'boolean') {
    const e = new Error(`${action}: foil must be an exact boolean, got ${typeof foil} (${JSON.stringify(foil)})`);
    e.name = 'InvalidPrinting';
    throw e;
  }
}

// PRIVATE set-absolute write for one collector item's want. NOT exported and takes NO validate flag:
// there is deliberately no public seam that reaches the ledger without passing through a validating
// writer, so the phantom-item invariant is structural, not a default a caller can opt out of. Input
// is already validated (resolved set, exact-boolean finish, catalog membership checked by the caller
// where required). The row is deleted only when BOTH quantities reach zero - the uncategorised row is
// shared with ownership, so dropping it on wanted=0 would take owned copies with it.
async function writeWantedRow(cardId, set, foil, qty, pid) {
  const now = nowIso();
  const slug = canonicalPrinting(set, foil);
  const cur = await resolveItemRow(cardId, set, foil, pid);
  const o = cur?.qty_owned || 0;
  if (qty === 0 && o === 0) {
    if (cur) await run('DELETE FROM owned_cards WHERE id=?;', [cur.id]);
  } else if (cur) {
    await run('UPDATE owned_cards SET variant_slug=?, qty_wanted=?, updated_at=? WHERE id=?;', [slug, qty, now, cur.id]);
  } else {
    await run('INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?);',
      [uuid(), pid, cardId, slug, qty, '', now, now]);
  }
  bump();
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
export async function setWantedForItem(cardId, { set, foil } = {}, qty, pid = activeProfileId()) {
  requireResolvedSet(set, 'setWantedForItem');
  requireBooleanFinish(foil, 'setWantedForItem');
  const w = Math.max(0, qty | 0);
  // A positive SET creates or raises the row - it must name a real printing. Setting to 0 (clear)
  // is exempt so a historical malformed row can always be cleared.
  if (w > 0) await assertRealPrinting(cardId, set, foil, 'setWantedForItem');
  await writeWantedRow(cardId, set, foil, w, pid);
}

/** Step a collector item's want by a delta, floored at zero. */
export async function stepWantedForItem(cardId, item = {}, delta = 1, pid = activeProfileId()) {
  requireResolvedSet(item.set, 'stepWantedForItem');
  requireBooleanFinish(item.foil, 'stepWantedForItem');
  // An INCREASE must name a real printing; a decrement bypasses ONLY catalog membership (never the
  // set/finish-type checks), so a historical malformed item can still be walked down and cleared.
  if (delta > 0) await assertRealPrinting(cardId, item.set, item.foil, 'stepWantedForItem');
  const cur = await resolveItemRow(cardId, item.set, item.foil, pid);
  await writeWantedRow(cardId, item.set, item.foil, Math.max(0, (cur?.qty_wanted || 0) + delta), pid);
}

/**
 * Atomic +N want on one collector item, for callers that cannot serialize their writes.
 *
 * Upsert rather than read-modify-write, same reason as addCopies: overlapping increments from
 * independent events would otherwise lose each other. It targets the canonical key only, so a
 * legacy row for the same item is NOT merged here - that is left to the boot pass, because
 * doing it atomically would need the read this function exists to avoid.
 */
export async function addWantedForItem(cardId, { set, foil } = {}, n = 1, pid = activeProfileId()) {
  requireResolvedSet(set, 'addWantedForItem');
  requireBooleanFinish(foil, 'addWantedForItem');
  if (!cardId || !(n > 0)) return;
  await assertRealPrinting(cardId, set, foil, 'addWantedForItem');   // +N is always an increase
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
export async function addOwnedCopiesInSet(cardId, set, n = 1, foil = false) {
  if (!cardId || !set || !(n > 0)) return;
  const pid = activeProfileId();
  const now = nowIso();
  // Ownership is per collector ITEM, so the finish is part of the row identity: a foil copy
  // upserts onto '001:f', a standard one onto '001'. The scanner can never read foil off a
  // photograph, so this only ever reflects a finish the user declared on the sheet.
  const slug = canonicalPrinting(set, foil);
  await run(
    `INSERT INTO owned_cards(id,profile_id,card_id,variant_slug,qty_owned,qty_wanted,notes,created_at,updated_at)
     VALUES(?,?,?,?,?,0,'',?,?)
     ON CONFLICT(profile_id,card_id,variant_slug)
     DO UPDATE SET qty_owned=qty_owned+excluded.qty_owned, updated_at=excluded.updated_at;`,
    [uuid(), pid, cardId, slug, n, now, now]
  );
  bump();
}

// backfillSingleSetOwned lived here. Canonicalisation converts the empty-string rows it used
// to look for, so it would find nothing; and retargeting it at the uncategorised key would
// contradict the approved triage model, which requires the user to be present when previously
// recorded copies are moved. Removed rather than rewritten.

// Match a set annotation token against a card's own sets, by numeric code or full name,
// case-insensitively. Returns the real set code or null. The token is raw user text; matching it
// to the catalog is the caller's job (the grammar stays catalog-free).
function matchSetToken(setToken, sets) {
  if (!setToken) return null;
  const t = String(setToken).trim().toLowerCase();
  for (const s of sets) {
    if (String(s?.code || '').toLowerCase() === t) return s.code;
    if (String(s?.name || '').toLowerCase() === t) return s.code;
  }
  return null;
}

// Decide whether a line's printing is fully DETERMINED (files directly, no review) or must fall to
// the review step. A determined line returns { setCode, foil }; anything ambiguous returns null.
//   - annotated valid set + available finish -> determined at that printing;
//   - single-set card -> determined by P6: a bare line takes non-foil, or foil where the sole
//     printing is FOIL-ONLY (Winter River in Alpha); an explicit [Foil] resolves only if that
//     printing has foil;
//   - unknown set, a set the card lacks, a finish the printing lacks, or a multi/zero-set bare
//     line -> null (falls to review, carrying the intended finish so it can still land foil).
// printingFinishes is strict (throws on malformed catalog variants); a throw here reads as "not
// determined" (fall to review) rather than crashing this read.
function resolveLinePrinting({ sets, setToken, foil }, card) {
  const finishesOf = (setCode) => { try { return printingFinishes(card, setCode); } catch { return null; } };
  if (setToken) {
    const setCode = matchSetToken(setToken, sets);
    if (!setCode) return null;                                   // unknown / absent set -> review
    const f = finishesOf(setCode);
    if (f && (foil ? f.foil : f.nonFoil)) return { setCode, foil };
    return null;                                                 // the requested finish does not exist
  }
  if (sets.length !== 1) return null;                            // multi/zero-set bare line -> review
  const setCode = sets[0].code;
  const f = finishesOf(setCode);
  if (!f) return null;
  if (foil) return f.foil ? { setCode, foil: true } : null;     // explicit [Foil], single set
  if (f.nonFoil) return { setCode, foil: false };               // bare: non-foil where it exists
  if (f.foil) return { setCode, foil: true };                   // P6: a foil-only sole printing
  return null;
}

// PREVIEW a bulk import without writing. Every card line runs through the real line grammar
// (parseItemText), so grammar problems reach the review model rather than being discarded:
//   - flagged : lines with a grammar problem (bad quantity, duplicate finish, two sets, ...).
//               Surfaced, NEVER written - "flag, never clamp or drop".
//   - items   : recognised, writable collector items. Grouped by (card, set annotation, finish)
//               for display, but each groups its per-line quantities as `parts` and does NOT
//               pre-sum them into one item that could exceed the per-line 999 bound - the durable
//               writer owns the merge, and a legitimate `999 x + 999 x` paste must reach it as two
//               contributions that merge to 1998, not one item it would reject.
//   - unresolved : names that matched no card.
// The 2000-line paste ceiling is enforced BEFORE any catalog query, so 2001 duplicate lines cannot
// slip past by merging down to a smaller item count.
export async function previewCollectionText(text) {
  const parsed = parseItemText(text);
  if (parsed.length > MAX_BATCH_ITEMS) {
    const e = new Error(`Too many lines to import (max ${MAX_BATCH_ITEMS}).`);
    e.name = 'ImportTooLarge';
    throw e;
  }

  const flagged = [];
  const byItem = new Map();   // collector-item key -> { key, name, setToken, foil, parts:[qty] }
  for (const line of parsed) {
    if (line.problems.length) {
      flagged.push({ raw: line.raw, name: line.name, qty: line.qty, problems: line.problems });
      continue;   // never resolved, never written
    }
    const key = `${line.name.toLowerCase()}|${(line.setToken || '').toLowerCase()}|${line.foil ? 1 : 0}`;
    const prev = byItem.get(key);
    if (prev) prev.parts.push(line.qty);
    else byItem.set(key, { key, name: line.name, setToken: line.setToken, foil: line.foil, parts: [line.qty] });
  }

  // Two lines that resolve to the SAME collector item are one review row and one printing count,
  // even when they were typed as different aliases (`Card [Beta]` and `Card [002]`). Identity is
  // canonical - (card_id, resolved setCode, resolved foil) - once resolution succeeds; an
  // unresolved row keeps its source identity so two genuinely different pending choices stay apart.
  const items = [];
  const unresolved = [];
  const byResolved = new Map();
  for (const g of byItem.values()) {
    const c = (await query('SELECT card_id, name, sets, variants FROM cards WHERE lower(name)=? LIMIT 1;', [g.name.toLowerCase()]))[0];
    if (!c) { unresolved.push(g.name); continue; }
    let sets = []; try { sets = JSON.parse(c.sets || '[]'); } catch { /* leave empty */ }
    sets = Array.isArray(sets) ? sets : [];
    const resolved = resolveLinePrinting({ sets, setToken: g.setToken, foil: g.foil }, c);
    if (resolved) {
      const ckey = `${c.card_id}|${resolved.setCode}|${resolved.foil ? 1 : 0}`;
      const existing = byResolved.get(ckey);
      if (existing) { existing.parts.push(...g.parts); existing.qty += g.parts.reduce((s, x) => s + x, 0); continue; }
      const item = { card_id: c.card_id, name: c.name, key: ckey, sets, foil: resolved.foil, setToken: g.setToken || null, resolved, parts: [...g.parts], qty: g.parts.reduce((s, x) => s + x, 0) };
      byResolved.set(ckey, item);
      items.push(item);
    } else {
      items.push({ card_id: c.card_id, name: c.name, key: g.key, sets, foil: g.foil, setToken: g.setToken || null, resolved: null, parts: [...g.parts], qty: g.parts.reduce((s, x) => s + x, 0) });
    }
  }
  return { items, unresolved, flagged };
}

// The reviewed-import WRITE moved to ownedImportRepository.js (importCollectionResolved), where it
// gained the barrier, authoritative catalog validation, the foil term, and the write-outcome
// contract - the same hardening the want command carries. It could not stay a bare one-tx writer:
// it accepted only { card_id, qty, setCode }, dropped finish, and wrote without validation. This
// module keeps only the READ side (previewCollectionText) and the pure planner is in importPlan.js.

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
/** Generate (or REgenerate) a named wanted list from compare-report missing
 *  lines [{card_id, missing}] - the "Missing for <deck>" flow (owner call
 *  2026-08-14: a shareable dedicated list, not the Wishlist). Deterministic by
 *  name: an existing same-named list is REPLACED in one tx, so regenerating
 *  after pulls or deck edits refreshes one list instead of spawning "(1)"
 *  clutter. Returns { id, created, count }. */
export async function generateMissingList(name, lines) {
  const pid = activeProfileId();
  const clean = String(name || '').trim() || 'Missing cards';
  const items = (lines || []).filter((l) => l?.card_id && (l.missing | 0) > 0);
  const existing = (await query('SELECT id FROM card_lists WHERE profile_id=? AND lower(name)=? LIMIT 1;', [pid, clean.toLowerCase()]))[0];
  const now = nowIso();
  const id = existing?.id || uuid();
  const stmts = existing
    ? [['DELETE FROM card_list_entries WHERE list_id=?;', [id]],
       ['UPDATE card_lists SET updated_at=? WHERE id=? AND profile_id=?;', [now, id, pid]]]
    : [['INSERT INTO card_lists(id,profile_id,kind,name,description,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?);',
       [id, pid, 'wanted', clean, '', now, now]]];
  for (const l of items) {
    stmts.push(['INSERT INTO card_list_entries(id,list_id,card_id,quantity,variant_slug,added_at) VALUES(?,?,?,?,?,?);',
      [uuid(), id, l.card_id, l.missing | 0, '', now]]);
  }
  await tx(stmts);
  bump();
  return { id, created: !existing, count: items.length };
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
  // ONE ROW PER COLLECTOR ITEM, not per card.
  //
  // Grouping by card_id collapsed an Alpha want and a Beta want into a single row, so the
  // primary Wishlist surface could not display the model it stores - and editing that row could
  // not say which item it meant, which is what raised NeedsPrintingChoice. Grouping by
  // (card_id, variant_slug) is what makes the row editable at all.
  //
  // `owned` is THIS ITEM's ownership, not the card's total. Owning an Alpha copy does not
  // satisfy a Beta want, and a non-foil copy does not satisfy a foil want - they are different
  // collector items, which is the whole premise. A card-level sum would report a Beta want as
  // already met because some other printing sits in the binder.
  const rows = await query(
    `SELECT o.card_id, o.variant_slug, o.qty_wanted quantity, o.qty_owned owned, o.created_at,
            c.name, c.type, c.cost, c.attack, c.defence, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.rules_text, c.sets, c.variants
     FROM owned_cards o JOIN cards c ON c.card_id=o.card_id
     WHERE o.profile_id=? AND o.qty_wanted>0 ORDER BY c.name, o.variant_slug;`,
    [pid]
  );
  // A stable per-item identity the UI can key state on, plus the set/finish it must show.
  return rows.map((r) => {
    const { set, foil } = parsePrinting(r.variant_slug);
    return { ...r, item_id: `${r.card_id}|${r.variant_slug}`, set, foil, owned: r.owned || 0 };
  });
}

// Flat "qty name" text of a list - the Curiosa deck-export format, so it pastes
// straight into Curiosa, a deck's Import from text, or back into Collection's
// own bulk import.
export async function exportListText(listId) {
  const rows = await listCards(listId);
  return rows.map((r) => `${r.quantity} ${r.name}`).join('\n');
}

// Item-grain export for the Wishlist (qty_wanted ledger) - take it to a shop. Emits the collector-item
// grammar `N Card [Set] [Foil]` (optional tags), so a wishlist round-trips back through the bulk
// importer to the same printings: `1 Lone Wolves [Alpha] [Foil]`. A set-less (uncategorised) want
// emits a bare `N Card` line, exactly as the grammar reads it.
export async function wishlistExportText() {
  const rows = await wishlistCards();
  return rows.map((r) => {
    let setName = '';
    if (r.set) { try { setName = JSON.parse(r.sets || '[]').find((s) => s?.code === r.set)?.name || ''; } catch { setName = ''; } }
    return formatItemLine({ qty: r.quantity, name: r.name, set: setName, foil: !!r.foil });
  }).join('\n');
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
// One row per COLLECTOR ITEM (card + set), not per card. v11 stores ownership per printing, so a
// card owned across several sets is several rows here, each wearing THAT set's pill, art, and
// counts. Grouping by card_id collapsed them into one row stamped with whichever printing was
// touched last (the Promotional pill over Beta art defect). The set bucket folds the four
// uncategorised keys and both finishes of a set together; foil is a per-row sub-count, not a
// separate row. `variants` is selected so the row can resolve its per-set art.
export async function recentlyAdded(limit = 8) {
  const pid = activeProfileId();
  const SET_BUCKET = `CASE
      WHEN o.variant_slug IN ('', 'foil', 'uncategorised', 'uncategorised:f') THEN ''
      WHEN o.variant_slug LIKE '%:f' THEN substr(o.variant_slug, 1, length(o.variant_slug) - 2)
      ELSE o.variant_slug END`;
  return query(
    `SELECT o.card_id,
            ${SET_BUCKET} AS set_code,
            SUM(CASE WHEN ${isFoil('o.variant_slug')} THEN 0 ELSE o.qty_owned END) qty_owned,
            SUM(CASE WHEN ${isFoil('o.variant_slug')} THEN o.qty_owned ELSE 0 END) qty_foil,
            SUM(o.qty_wanted) qty_wanted,
            c.name, c.type, c.cost, c.elements, c.thresholds, c.image_slug, c.is_site, c.rarity, c.sets, c.rules_text, c.variants
     FROM owned_cards o JOIN cards c ON c.card_id=o.card_id
     WHERE o.profile_id=?
     GROUP BY o.card_id, set_code HAVING SUM(o.qty_owned)>0
     ORDER BY MAX(o.updated_at) DESC LIMIT ?;`,
    [pid, limit]
  );
}
