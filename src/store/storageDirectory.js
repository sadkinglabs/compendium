// The Storage pillar's reads and container lifecycle - what the UI asks for and what it changes
// about the CONTAINERS themselves. Copies moving between places is `storageRepository`'s business;
// this module never invents or destroys one.
//
// WHY IT IS NOT IN storageRepository. That module is the transactional core: DOM-free, node-testable,
// and deliberately returning STATEMENTS rather than executing them, so a caller can compose them into
// a transaction it already owns. Reads bound to `db.js` would take that property away from it. This
// module is the bound half, and it composes the core's statements rather than writing its own SQL for
// anything that touches an allocation.
//
// COORDINATION, per the tiering the core documents: container lifecycle is profile-wide rather than
// one collector item, so it takes `withExclusiveCollectionWrites` - the same barrier bulk edits use.
// The reads take nothing.
import { query, tx } from './db.js';
import { withExclusiveCollectionWrites } from './collectionWrites.js';
import { activeProfileId } from './profileRepository.js';
import { notifyOwnedChanged } from './ownedRepository.js';
import { uuid, nowIso } from './ids.js';
import {
  SYSTEM_KIND, UNFILED_NAME, DEFAULT_COLOUR, isContainerColour, isUserContainerKind,
} from './storageVocabulary.js';

/** Longest a container name may be. The column is TEXT; this is the product limit. */
export const MAX_CONTAINER_NAME = 60;
export const MAX_CONTAINER_DESC = 240;

/**
 * Every container for a profile, with what it holds.
 *
 * ONE grouped query, not one per container - the listDecks N+1 lesson. `cards` counts DISTINCT
 * collector items and `copies` sums the physical cards, because those are different questions a
 * binder answers ("how many different cards" vs "how many sleeves used") and a single number would
 * have to pick one and be wrong for the other.
 *
 * Unfiled sorts first (`sort_order -1`), then user containers by their order, then name - so the
 * list is stable across renames rather than resequencing under the user's thumb.
 */
export async function listContainers(pid = activeProfileId()) {
  return query(
    `SELECT c.id, c.kind, c.name, c.description, c.colour, c.sort_order, c.is_system,
            COUNT(a.id) cards,
            COALESCE(SUM(a.qty), 0) copies
       FROM storage_containers c
       LEFT JOIN storage_allocations a ON a.container_id = c.id
      WHERE c.profile_id = ?
      GROUP BY c.id
      ORDER BY c.sort_order, c.name COLLATE NOCASE;`,
    [pid],
  );
}

/**
 * What is inside one container: a row per collector item, with the card fields the list rows render.
 *
 * `qty` is the number of copies IN THIS CONTAINER, never the owned total - the whole point of a
 * container view is what is physically in it. `qty_owned` rides along so a surface can say "3 of
 * your 5" without a second query.
 */
export async function containerContents(containerId, pid = activeProfileId()) {
  return query(
    `SELECT a.id alloc_id, a.qty, o.id owned_id, o.card_id, o.variant_slug, o.qty_owned,
            cd.name, cd.type, cd.rarity, cd.elements, cd.sets
       FROM storage_allocations a
       JOIN owned_cards o ON o.id = a.owned_card_id
       LEFT JOIN cards cd ON cd.card_id = o.card_id
      WHERE a.container_id = ? AND a.profile_id = ?
      ORDER BY cd.name COLLATE NOCASE, o.variant_slug;`,
    [containerId, pid],
  );
}

/** One container's own row, or null. For a detail screen that was opened from a stale list. */
export async function getContainer(containerId, pid = activeProfileId()) {
  return (await query(
    'SELECT id, kind, name, description, colour, sort_order, is_system FROM storage_containers WHERE id=? AND profile_id=?;',
    [containerId, pid],
  ))[0] || null;
}

/**
 * Validate a name the user typed. Returns the trimmed name or throws.
 *
 * TWO refusals and ONE tolerance, and the difference is deliberate (Q9).
 *
 * A blank name is refused: it is unnameable in every later surface. The reserved name is refused:
 * a second "Unfiled" is indistinguishable from the system place in a list.
 *
 * A DUPLICATE IS ALLOWED. Q9: "must container names be unique? No, but warn on exact duplicate."
 * Two binders really can both be called "Beta", and the app is not the arbiter of what someone
 * calls their own shelves - the deck-name paths already work this way. The warning is the caller's
 * job, which is why duplicateName() below is a separate read: refusing here would put a wall in
 * front of a legitimate thing.
 */
function cleanName(raw) {
  const name = String(raw ?? '').trim().slice(0, MAX_CONTAINER_NAME);
  if (!name) throw Object.assign(new Error('A place needs a name.'), { name: 'InvalidContainer' });
  if (name.toLowerCase() === UNFILED_NAME.toLowerCase()) {
    throw Object.assign(new Error(`"${UNFILED_NAME}" is the place for cards you have not filed - pick another name.`), { name: 'InvalidContainer' });
  }
  return name;
}

/**
 * Does another place already carry this name? For the WARNING Q9 asks for, not a refusal.
 *
 * Read-only and caller-driven, so a surface can say "you already have one called that" and still
 * let the user proceed. Case-insensitive, because "beta" and "Beta" are the same shelf to a person.
 */
export async function duplicateName(name, { selfId = null, pid = activeProfileId() } = {}) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return false;
  const all = await listContainers(pid);
  return all.some((c) => c.id !== selfId && !c.is_system && String(c.name).toLowerCase() === wanted);
}

/** Create a user container. Never the system one - that is the backfill's and profile creation's job. */
export async function createContainer({ name, kind = 'binder', colour = DEFAULT_COLOUR, description = '' } = {}, pid = activeProfileId()) {
  if (!isUserContainerKind(kind)) throw Object.assign(new Error(`Unknown kind ${JSON.stringify(kind)}.`), { name: 'InvalidContainer' });
  if (!isContainerColour(colour)) throw Object.assign(new Error(`Unknown colour ${JSON.stringify(colour)}.`), { name: 'InvalidContainer' });
  const id = uuid();
  await withExclusiveCollectionWrites(async () => {
    const existing = await listContainers(pid);
    const clean = cleanName(name);
    // Appended, not inserted: a new place goes at the end of the user's order rather than
    // renumbering everything they have already arranged.
    const order = existing.reduce((n, c) => Math.max(n, Number(c.sort_order) || 0), 0) + 1;
    const now = nowIso();
    await tx([[
      `INSERT INTO storage_containers(id,profile_id,kind,name,description,colour,sort_order,is_system,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,0,?,?);`,
      [id, pid, kind, clean, String(description ?? '').slice(0, MAX_CONTAINER_DESC), colour, order, now, now],
    ]]);
  });
  notifyOwnedChanged();
  return id;
}

/** Rename / recolour / re-describe. The system container is immutable: it is not the user's to name. */
export async function updateContainer(containerId, { name, colour, description, kind } = {}, pid = activeProfileId()) {
  if (colour != null && !isContainerColour(colour)) {
    throw Object.assign(new Error(`Unknown colour ${JSON.stringify(colour)}.`), { name: 'InvalidContainer' });
  }
  // Q8: a kind changes after creation, because "cards move from a deck into a box constantly". The
  // kind describes what the place IS today, not what it was when it was made.
  if (kind != null && !isUserContainerKind(kind)) {
    throw Object.assign(new Error(`Unknown kind ${JSON.stringify(kind)}.`), { name: 'InvalidContainer' });
  }
  await withExclusiveCollectionWrites(async () => {
    const all = await listContainers(pid);
    const self = all.find((c) => c.id === containerId);
    if (!self) throw Object.assign(new Error('That place no longer exists.'), { name: 'InvalidContainer' });
    if (self.is_system) throw Object.assign(new Error(`${UNFILED_NAME} cannot be renamed.`), { name: 'InvalidContainer' });
    const sets = [];
    const params = [];
    if (name != null) { sets.push('name=?'); params.push(cleanName(name)); }
    if (colour != null) { sets.push('colour=?'); params.push(colour); }
    if (description != null) { sets.push('description=?'); params.push(String(description).slice(0, MAX_CONTAINER_DESC)); }
    if (kind != null) { sets.push('kind=?'); params.push(kind); }
    if (!sets.length) return;
    sets.push('updated_at=?'); params.push(nowIso());
    await tx([[`UPDATE storage_containers SET ${sets.join(', ')} WHERE id=? AND profile_id=?;`, [...params, containerId, pid]]]);
  });
  notifyOwnedChanged();
}

/**
 * Delete a container. Its copies go to Unfiled first (Q26).
 *
 * Under this model that is ARITHMETIC, not a policy choice: copies cannot be nowhere. Deleting a
 * binder does not mean the cards evaporated, it means they are no longer filed - which is exactly
 * what Unfiled represents. So no quantity changes and `qty_owned` is untouched throughout; only the
 * container_id of some allocations does.
 *
 * The move MERGES rather than inserting, because a card can already be unfiled as well as filed - the
 * unique index on (container_id, owned_card_id) is what would otherwise reject the whole delete.
 */
export async function deleteContainer(containerId, pid = activeProfileId()) {
  await withExclusiveCollectionWrites(async () => {
    const all = await listContainers(pid);
    const self = all.find((c) => c.id === containerId);
    if (!self) return;
    if (self.is_system) throw Object.assign(new Error(`${UNFILED_NAME} cannot be deleted.`), { name: 'InvalidContainer' });
    const unfiled = all.find((c) => c.is_system);
    if (!unfiled) throw new Error('deleteContainer: this profile has no Unfiled container.');

    const now = nowIso();
    await tx([
      // MERGE with what is already in Unfiled. `ON CONFLICT` cannot help here - the conflicting row is the
      // one we are moving FROM, so the upsert would add a row to itself.
      [`UPDATE storage_allocations
           SET qty = qty + COALESCE((SELECT m.qty FROM storage_allocations m
                                      WHERE m.container_id=? AND m.owned_card_id = storage_allocations.owned_card_id), 0),
               updated_at = ?
         WHERE container_id = ?;`, [containerId, now, unfiled.id]],
      // Now the moved rows carry no information the Unfiled row does not already have.
      [`DELETE FROM storage_allocations
         WHERE container_id = ?
           AND owned_card_id IN (SELECT owned_card_id FROM storage_allocations WHERE container_id = ?);`,
        [containerId, unfiled.id]],
      // Whatever is left was filed ONLY here, so it re-parents wholesale.
      ['UPDATE storage_allocations SET container_id=?, updated_at=? WHERE container_id=?;', [unfiled.id, now, containerId]],
      ['DELETE FROM storage_containers WHERE id=? AND profile_id=?;', [containerId, pid]],
      // The equality, in the same transaction. Nothing above may change a count - if the merge
      // arithmetic is wrong, this refuses the delete rather than losing the user's copies.
      [`INSERT INTO storage_allocations(id,profile_id,container_id,owned_card_id,qty,created_at,updated_at)
          SELECT ?, o.profile_id, 'delete-container-equality-violated', o.id, 0, '', ''
            FROM owned_cards o
           WHERE o.profile_id=?
             AND o.qty_owned <> COALESCE((SELECT SUM(a.qty) FROM storage_allocations a WHERE a.owned_card_id=o.id), 0);`,
        [uuid(), pid]],
    ]);
  });
  notifyOwnedChanged();
}

/**
 * Move one place one step earlier or later in the user's own order (Q10: "manual with sort_order").
 *
 * Implemented as a SWAP of two sort_order values rather than a renumber, so it is one small write
 * and any other ordering the user has built is left alone. Unfiled is excluded from both ends: it
 * is pinned first and not draggable (Q15), so it is neither a mover nor a neighbour.
 *
 * A move past either end is a no-op rather than an error - the button is simply at its limit.
 */
export async function moveContainer(containerId, direction, pid = activeProfileId()) {
  const step = direction === 'up' ? -1 : 1;
  await withExclusiveCollectionWrites(async () => {
    const mine = (await listContainers(pid)).filter((c) => !c.is_system);
    const i = mine.findIndex((c) => c.id === containerId);
    const j = i + step;
    if (i < 0 || j < 0 || j >= mine.length) return;
    const a = mine[i];
    const b = mine[j];
    const now = nowIso();
    // Their stored values may be equal (two places created in the same breath), in which case a
    // straight swap changes nothing. Fall back to index-derived orders, which is also the repair.
    const [oa, ob] = Number(a.sort_order) === Number(b.sort_order)
      ? [j + 1, i + 1]
      : [Number(b.sort_order) || 0, Number(a.sort_order) || 0];
    await tx([
      ['UPDATE storage_containers SET sort_order=?, updated_at=? WHERE id=? AND profile_id=?;', [oa, now, a.id, pid]],
      ['UPDATE storage_containers SET sort_order=?, updated_at=? WHERE id=? AND profile_id=?;', [ob, now, b.id, pid]],
    ]);
  });
  notifyOwnedChanged();
}

/** The Unfiled container's id for a profile, for surfaces that need to name the default place. */
export async function unfiledId(pid = activeProfileId()) {
  return (await query('SELECT id FROM storage_containers WHERE profile_id=? AND is_system=1;', [pid]))[0]?.id || null;
}

export { SYSTEM_KIND, UNFILED_NAME };
