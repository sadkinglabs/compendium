// Codex data — catalog reads (shared) + the profile-scoped personal layer
// (saved, marginalia notes, highlights, collections). Every profile-scoped read
// and write passes through activeProfileId(), so isolation is structural.
import { query, run } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';

/* ---------------- catalog (shared, read-only) ---------------- */

const cardMeta = (c) => `${c.type ?? 'Card'} · ${c.cost ?? 0} mana`;

export async function getCard(id) {
  return (await query('SELECT * FROM cards WHERE card_id=?;', [id]))[0] || null;
}
export async function getRule(id) {
  return (await query('SELECT * FROM rules WHERE rule_id=?;', [id]))[0] || null;
}

async function faqCardSet() {
  const rows = await query('SELECT card_ids FROM faqs;');
  const set = new Set();
  for (const r of rows) { try { for (const id of JSON.parse(r.card_ids || '[]')) set.add(id); } catch { /* noop */ } }
  return set;
}

/** Combined Codex entries for a scope + optional filters (fav/notes/faq/errata),
 *  alphabetised, with note/saved indicators. */
export async function getCodexEntries(scope, filters = {}) {
  const wantRules = scope !== 'cards';
  const wantCards = scope !== 'rules';
  const rules = wantRules
    ? await query('SELECT rule_id id, title name FROM rules WHERE parent_id IS NULL;')
    : [];
  // Sub-entries (children) per top-level rule → the expandable chevron in the list.
  const subMap = {};
  if (wantRules && rules.length) {
    const kids = await query('SELECT rule_id id, title, parent_id FROM rules WHERE parent_id IS NOT NULL ORDER BY title;');
    for (const k of kids) (subMap[k.parent_id] = subMap[k.parent_id] || []).push({ id: k.id, name: k.title, kind: 'rule' });
  }
  const cards = wantCards
    ? await query('SELECT card_id id, name, type, cost, image_slug, elements, thresholds FROM cards;')
    : [];
  const { noted, saved } = await indicatorSets();
  const items = [
    ...rules.map((r) => ({ id: r.id, name: r.name, kind: 'rule', meta: 'Codex Article', subs: subMap[r.id] || [] })),
    ...cards.map((c) => ({
      id: c.id, name: c.name, kind: 'card', meta: cardMeta(c),
      image_slug: c.image_slug, elements: c.elements, thresholds: c.thresholds,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  for (const it of items) {
    it.hasNote = noted.has(it.id);
    it.saved = saved.has(it.id);
  }
  let out = items;
  if (filters.fav) out = out.filter((i) => i.saved);
  if (filters.notes) out = out.filter((i) => i.hasNote);
  if (filters.errata) {
    const er = new Set((await query("SELECT card_id FROM cards WHERE rules_text LIKE 'UPDATED%';")).map((r) => r.card_id));
    out = out.filter((i) => i.kind === 'card' && er.has(i.id));
  }
  if (filters.faq) {
    const fs = await faqCardSet();
    out = out.filter((i) => i.kind === 'card' && fs.has(i.id));
  }
  return out;
}

export async function searchCodex(q) {
  const like = `%${q.toLowerCase()}%`;
  const cards = await query(
    "SELECT card_id id, name, type, cost FROM cards WHERE lower(name) LIKE ? ORDER BY name LIMIT 60;",
    [like]
  );
  const rules = await query(
    "SELECT rule_id id, title name FROM rules WHERE parent_id IS NULL AND lower(title) LIKE ? ORDER BY title LIMIT 60;",
    [like]
  );
  return {
    cards: cards.map((c) => ({ ...c, kind: 'card', meta: cardMeta(c) })),
    rules: rules.map((r) => ({ ...r, kind: 'rule', meta: 'Codex Article' })),
  };
}

/** Resolve a display name to a Codex target (for [[inline]] links / related chips). */
export async function resolveByName(name) {
  const n = name.toLowerCase();
  const r = (await query('SELECT rule_id id FROM rules WHERE lower(title)=? LIMIT 1;', [n]))[0];
  if (r) return { kind: 'rule', id: r.id };
  const c = (await query('SELECT card_id id FROM cards WHERE lower(name)=? LIMIT 1;', [n]))[0];
  if (c) return { kind: 'card', id: c.id };
  return null;
}

/** Related entries for a rule (outgoing links) or a card (rules that cite it). */
export async function relatedFor(kind, id, name) {
  if (kind === 'rule') {
    const rows = await query('SELECT target_id, target_type FROM link_graph WHERE source_id=?;', [id]);
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.target_id)) continue;
      seen.add(r.target_id);
      out.push({ name: r.target_id, type: r.target_type });
    }
    return out.slice(0, 12);
  }
  // card: rules that reference this card by name
  const rows = await query(
    "SELECT DISTINCT source_id FROM link_graph WHERE target_type='card' AND lower(target_id)=? LIMIT 12;",
    [String(name).toLowerCase()]
  );
  const out = [];
  for (const r of rows) {
    const ru = (await query('SELECT title FROM rules WHERE rule_id=?;', [r.source_id]))[0];
    if (ru) out.push({ name: ru.title, type: 'rule' });
  }
  return out;
}

export async function faqsForCard(cardId) {
  // card_ids stored as a JSON array of curiosa slugs (== card_id)
  return query("SELECT question, answer FROM faqs WHERE card_ids LIKE ? ORDER BY rowid LIMIT 50;", [
    `%"${cardId}"%`,
  ]);
}

/* ---------------- profile-scoped personal layer ---------------- */

async function indicatorSets() {
  const pid = activeProfileId();
  const noted = await query('SELECT DISTINCT target_id FROM notes WHERE profile_id=?;', [pid]);
  const saved = await query('SELECT target_id FROM saved WHERE profile_id=?;', [pid]);
  return {
    noted: new Set(noted.map((r) => r.target_id)),
    saved: new Set(saved.map((r) => r.target_id)),
  };
}

export async function isSaved(targetId) {
  const pid = activeProfileId();
  const r = await query('SELECT 1 FROM saved WHERE profile_id=? AND target_id=? LIMIT 1;', [pid, targetId]);
  return r.length > 0;
}

export async function toggleSaved(targetType, targetId) {
  const pid = activeProfileId();
  if (await isSaved(targetId)) {
    await run('DELETE FROM saved WHERE profile_id=? AND target_id=?;', [pid, targetId]);
    return false;
  }
  await run('INSERT INTO saved(id,profile_id,target_type,target_id,created_at) VALUES(?,?,?,?,?);', [
    uuid(), pid, targetType, targetId, nowIso(),
  ]);
  return true;
}

export async function notesFor(targetId) {
  return query('SELECT * FROM notes WHERE profile_id=? AND target_id=? ORDER BY updated_at DESC;', [
    activeProfileId(), targetId,
  ]);
}

export async function addNote(targetType, targetId, body) {
  const ts = nowIso();
  await run(
    'INSERT INTO notes(id,profile_id,target_type,target_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?);',
    [uuid(), activeProfileId(), targetType, targetId, body, ts, ts]
  );
}

export async function deleteNote(id) {
  await run('DELETE FROM notes WHERE id=? AND profile_id=?;', [id, activeProfileId()]);
}

export async function highlightsFor(targetId) {
  return query('SELECT * FROM highlights WHERE profile_id=? AND target_id=? ORDER BY created_at DESC;', [
    activeProfileId(), targetId,
  ]);
}

export async function addHighlight(targetType, targetId, text, comment) {
  await run(
    'INSERT INTO highlights(id,profile_id,target_type,target_id,text,comment,created_at) VALUES(?,?,?,?,?,?,?);',
    [uuid(), activeProfileId(), targetType, targetId, text, comment || '', nowIso()]
  );
}

export async function deleteHighlight(id) {
  await run('DELETE FROM highlights WHERE id=? AND profile_id=?;', [id, activeProfileId()]);
}

/* user-authored cross-links (the "Link" half of marginalia) */
async function nameOf(type, id) {
  if (type === 'card') return (await query('SELECT name FROM cards WHERE card_id=?;', [id]))[0]?.name || id;
  return (await query('SELECT title FROM rules WHERE rule_id=?;', [id]))[0]?.title || id;
}

export async function linksFor(targetId) {
  const pid = activeProfileId();
  const rows = await query('SELECT * FROM links WHERE profile_id=? AND (a_id=? OR b_id=?) ORDER BY created_at DESC;', [pid, targetId, targetId]);
  const out = [];
  for (const l of rows) {
    const other = l.a_id === targetId ? { type: l.b_type, id: l.b_id } : { type: l.a_type, id: l.a_id };
    out.push({ id: l.id, description: l.description, otherType: other.type, otherId: other.id, otherName: await nameOf(other.type, other.id) });
  }
  return out;
}

export async function addLink(aType, aId, bType, bId, description) {
  const kind = aType === 'card' && bType === 'card' ? 'card_card' : aType === 'rule' && bType === 'rule' ? 'article_article' : 'card_article';
  const ts = nowIso();
  await run(
    'INSERT INTO links(id,profile_id,kind,a_type,a_id,b_type,b_id,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?);',
    [uuid(), activeProfileId(), kind, aType, aId, bType, bId, description || '', ts, ts]
  );
}

export async function deleteLink(id) {
  await run('DELETE FROM links WHERE id=? AND profile_id=?;', [id, activeProfileId()]);
}

/** Search the active profile's own notes + highlights text (Lexicum's
 *  highlight/note search filters), returning the entries they're attached to. */
export async function searchPersonal(q) {
  const pid = activeProfileId();
  const like = `%${q.toLowerCase()}%`;
  const notes = await query('SELECT target_type, target_id, body FROM notes WHERE profile_id=? AND lower(body) LIKE ? ORDER BY updated_at DESC LIMIT 20;', [pid, like]);
  const hls = await query('SELECT target_type, target_id, text, comment FROM highlights WHERE profile_id=? AND (lower(text) LIKE ? OR lower(comment) LIKE ?) ORDER BY created_at DESC LIMIT 20;', [pid, like, like]);
  const out = [];
  for (const n of notes) out.push({ kind: n.target_type, id: n.target_id, name: await nameOf(n.target_type, n.target_id), meta: 'Note', glyph: '⚜' });
  for (const h of hls) out.push({ kind: h.target_type, id: h.target_id, name: await nameOf(h.target_type, h.target_id), meta: 'Highlight', glyph: '✦' });
  return out;
}

/** Everything in the personal layer at once — the Codex Marginalia section.
 *  Notes, highlights and links profile-wide, each resolved to the entry it
 *  annotates so rows can tap through. */
export async function marginaliaAll() {
  const pid = activeProfileId();
  const notes = await query('SELECT id, target_type, target_id, body, updated_at FROM notes WHERE profile_id=? ORDER BY updated_at DESC;', [pid]);
  const highlights = await query('SELECT id, target_type, target_id, text, comment, created_at FROM highlights WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
  const links = await query('SELECT * FROM links WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
  for (const n of notes) n.on = await nameOf(n.target_type, n.target_id);
  for (const h of highlights) h.on = await nameOf(h.target_type, h.target_id);
  const linkRows = [];
  for (const l of links) {
    linkRows.push({
      id: l.id, description: l.description,
      aType: l.a_type, aId: l.a_id, aName: await nameOf(l.a_type, l.a_id),
      bType: l.b_type, bId: l.b_id, bName: await nameOf(l.b_type, l.b_id),
    });
  }
  return { notes, highlights, links: linkRows };
}

/* collections */
export async function listCollections() {
  const pid = activeProfileId();
  const cols = await query('SELECT * FROM collections WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
  for (const c of cols) {
    c.count = (await query('SELECT COUNT(*) n FROM collection_items WHERE collection_id=?;', [c.id]))[0].n;
  }
  return cols;
}

export async function createCollection(name) {
  const id = uuid();
  await run('INSERT INTO collections(id,profile_id,name,created_at) VALUES(?,?,?,?);', [
    id, activeProfileId(), name, nowIso(),
  ]);
  return id;
}

export async function collectionsForTarget(targetId) {
  return query(
    `SELECT c.id, c.name, EXISTS(
        SELECT 1 FROM collection_items ci WHERE ci.collection_id=c.id AND ci.target_id=?
     ) AS inIt
     FROM collections c WHERE c.profile_id=? ORDER BY c.created_at DESC;`,
    [targetId, activeProfileId()]
  );
}

export async function renameCollection(id, name) {
  await run('UPDATE collections SET name=? WHERE id=? AND profile_id=?;', [name, id, activeProfileId()]);
}

export async function deleteCollection(id) {
  await run('DELETE FROM collection_items WHERE collection_id=?;', [id]);   // explicit — don't rely on FK cascade
  await run('DELETE FROM collections WHERE id=? AND profile_id=?;', [id, activeProfileId()]);
}

/** A collection's items, resolved to names for display. */
export async function collectionItems(collectionId) {
  const rows = await query('SELECT id, target_type, target_id FROM collection_items WHERE collection_id=? ORDER BY added_at DESC;', [collectionId]);
  for (const r of rows) r.name = await nameOf(r.target_type, r.target_id);
  return rows;
}

export async function toggleCollectionItem(collectionId, targetType, targetId) {
  const exists = await query(
    'SELECT id FROM collection_items WHERE collection_id=? AND target_id=? LIMIT 1;',
    [collectionId, targetId]
  );
  if (exists.length) {
    await run('DELETE FROM collection_items WHERE id=?;', [exists[0].id]);
    return false;
  }
  await run('INSERT INTO collection_items(id,collection_id,target_type,target_id,added_at) VALUES(?,?,?,?,?);', [
    uuid(), collectionId, targetType, targetId, nowIso(),
  ]);
  return true;
}
