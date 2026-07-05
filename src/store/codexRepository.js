// Codex data - catalog reads (shared) + the profile-scoped personal layer
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

/** Every target carrying any marginalia (a note, a highlight, or a user link). */
async function margSet() {
  const pid = activeProfileId();
  const ids = new Set();
  for (const r of await query('SELECT DISTINCT target_id FROM notes WHERE profile_id=?;', [pid])) ids.add(r.target_id);
  for (const r of await query('SELECT DISTINCT target_id FROM highlights WHERE profile_id=?;', [pid])) ids.add(r.target_id);
  for (const r of await query('SELECT a_id, b_id FROM links WHERE profile_id=?;', [pid])) { ids.add(r.a_id); ids.add(r.b_id); }
  return ids;
}
/** Targets on either end of a user-authored link. */
async function linkedSet() {
  const ids = new Set();
  for (const r of await query('SELECT a_id, b_id FROM links WHERE profile_id=?;', [activeProfileId()])) { ids.add(r.a_id); ids.add(r.b_id); }
  return ids;
}
/** Articles that cite at least one card (link_graph card edges) - "examples". */
async function exampleRuleSet() {
  const rows = await query("SELECT DISTINCT source_id FROM link_graph WHERE target_type='card';");
  return new Set(rows.map((r) => r.source_id));
}
async function errataCardSet() {
  return new Set((await query("SELECT card_id FROM cards WHERE rules_text LIKE 'UPDATED%';")).map((r) => r.card_id));
}

/** Codex entries for a scope + optional filters, alphabetised, with note/saved
 *  indicators. Filters are scope-specific:
 *    both  - fav (saved only) · marg (has any marginalia) · linked (user links)
 *    rules - subs (has sub-articles) · examples (article cites a card)
 *    cards - faq · errata (rules_text starts UPDATED) · sets (set-name array) */
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
    ? await query('SELECT card_id id, name, type, cost, image_slug, elements, thresholds, sets FROM cards;')
    : [];
  const { noted, saved } = await indicatorSets();
  const items = [
    ...rules.map((r) => ({ id: r.id, name: r.name, kind: 'rule', meta: 'Codex Article', subs: subMap[r.id] || [] })),
    ...cards.map((c) => ({
      id: c.id, name: c.name, kind: 'card', meta: cardMeta(c),
      image_slug: c.image_slug, elements: c.elements, thresholds: c.thresholds, sets: c.sets,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  for (const it of items) {
    it.hasNote = noted.has(it.id);
    it.saved = saved.has(it.id);
  }
  let out = items;
  if (filters.fav) out = out.filter((i) => i.saved);
  // marg: any marginalia at all (notes + highlights + links). `notes` kept as a
  // legacy alias - old presets (Home "All notes") still work.
  if (filters.marg || filters.notes) {
    const ms = await margSet();
    out = out.filter((i) => ms.has(i.id));
  }
  if (filters.linked) {
    const ls = await linkedSet();
    out = out.filter((i) => ls.has(i.id));
  }
  if (filters.subs) out = out.filter((i) => i.kind !== 'rule' || (i.subs || []).length > 0);
  if (filters.examples) {
    const ex = await exampleRuleSet();
    out = out.filter((i) => i.kind !== 'rule' || ex.has(i.id));
  }
  if (filters.errata) {
    const er = await errataCardSet();
    out = out.filter((i) => i.kind === 'card' && er.has(i.id));
  }
  if (filters.faq) {
    const fs = await faqCardSet();
    out = out.filter((i) => i.kind === 'card' && fs.has(i.id));
  }
  if (filters.sets?.length) {
    const want = new Set(filters.sets);
    out = out.filter((i) => {
      if (i.kind !== 'card') return false;
      try { return JSON.parse(i.sets || '[]').some((s) => want.has(s.name)); } catch { return false; }
    });
  }
  return out;
}

/* ── Codex search with deckbuilder-style syntax ──
   Plain words match names/titles AND full text (card rules, article bodies).
   Tokens narrow the card results the way the deckbuilder's filters do:
     t:minion (type) · e:fire (element threshold) · set:gothic (set name)
     has:faq · has:marginalia · is:errata · is:saved
     is:article / is:card - restrict results to one side of the Codex
   "quoted phrases" match as one string. */
const SET_NAMES = ['Alpha', 'Beta', 'Arthurian Legends', 'Gothic', 'Dragonlord', 'Promotional'];
const ELEMENTS = ['air', 'earth', 'fire', 'water'];

export function parseCodexQuery(q) {
  const tokens = q.match(/[a-z]+:"[^"]*"|[a-z]+:\S+|"[^"]*"|\S+/gi) || [];
  const f = { text: [], types: [], els: [], sets: [], has: [], is: [] };
  for (const t of tokens) {
    const m = /^([a-z]+):(.+)$/i.exec(t);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^"|"$/g, '').toLowerCase();
      if (key === 't' || key === 'type') { f.types.push(val); continue; }
      if (key === 'e' || key === 'el' || key === 'element') { if (ELEMENTS.includes(val)) { f.els.push(val); continue; } }
      if (key === 's' || key === 'set') {
        const hit = SET_NAMES.find((n) => n.toLowerCase().startsWith(val));
        if (hit) { f.sets.push(hit); continue; }
      }
      if (key === 'has') { f.has.push(val); continue; }
      if (key === 'is') { f.is.push(val); continue; }
    }
    f.text.push(t.replace(/^"|"$/g, '').toLowerCase());
  }
  f.textStr = f.text.join(' ').trim();
  f.hasTokens = f.types.length + f.els.length + f.sets.length + f.has.length + f.is.length > 0;
  return f;
}

/** Categorised Codex search. Returns
 *  { articles, cards, cardText, articleText } - name/title hits first, then
 *  entries whose TEXT contains the words ("airborne" → the Airborne article,
 *  then every minion whose rules mention airborne, grouped by type). */
export async function searchCodex(q) {
  const f = parseCodexQuery(q);
  const like = f.textStr ? `%${f.textStr}%` : null;

  // Card pool: SQL narrows by name/text where possible, tokens filter after.
  let cardRows = await query('SELECT card_id id, name, type, cost, rarity, rules_text, thresholds, sets FROM cards;');
  if (f.types.length) cardRows = cardRows.filter((c) => f.types.some((t) => (c.type || '').toLowerCase().startsWith(t)));
  if (f.els.length) cardRows = cardRows.filter((c) => { try { const th = JSON.parse(c.thresholds || '{}'); return f.els.some((e) => (th[e] || 0) > 0); } catch { return false; } });
  if (f.sets.length) cardRows = cardRows.filter((c) => { try { return JSON.parse(c.sets || '[]').some((s) => f.sets.includes(s.name)); } catch { return false; } });
  if (f.has.includes('faq')) { const fs = await faqCardSet(); cardRows = cardRows.filter((c) => fs.has(c.id)); }
  if (f.has.some((h) => h.startsWith('marg') || h === 'notes')) { const ms = await margSet(); cardRows = cardRows.filter((c) => ms.has(c.id)); }
  if (f.is.includes('errata')) { const er = await errataCardSet(); cardRows = cardRows.filter((c) => er.has(c.id)); }
  if (f.is.includes('saved')) { const { saved } = await indicatorSets(); cardRows = cardRows.filter((c) => saved.has(c.id)); }

  const asCard = (c) => ({ id: c.id, name: c.name, kind: 'card', meta: cardMeta(c) });
  let cards = [], cardText = [];
  if (like) {
    const needle = f.textStr;
    cards = cardRows.filter((c) => c.name.toLowerCase().includes(needle));
    const named = new Set(cards.map((c) => c.id));
    // text hits, grouped by type then name - "all minions with airborne" reads
    // as one run of Minions, then Auras, etc.
    cardText = cardRows
      .filter((c) => !named.has(c.id) && (c.rules_text || '').toLowerCase().includes(needle))
      .sort((a, b) => (a.type || '').localeCompare(b.type || '') || a.name.localeCompare(b.name));
    cards.sort((a, b) => a.name.localeCompare(b.name));
  } else if (f.hasTokens) {
    cards = [...cardRows].sort((a, b) => a.name.localeCompare(b.name));   // tokens only: the filtered pool IS the result
  }

  // Articles: title hits (sub-entries fold up to their parent), then body hits.
  let articles = [], articleText = [];
  if (like) {
    const titleRows = await query('SELECT rule_id id, parent_id, title FROM rules WHERE lower(title) LIKE ? ORDER BY title;', [like]);
    const seen = new Set();
    for (const r of titleRows) {
      const id = r.parent_id || r.id;
      if (seen.has(id)) continue; seen.add(id);
      const title = r.parent_id ? (await query('SELECT title FROM rules WHERE rule_id=?;', [r.parent_id]))[0]?.title || r.title : r.title;
      articles.push({ id, name: title, kind: 'rule', meta: r.parent_id ? `Codex Article · ${r.title}` : 'Codex Article' });
    }
    const bodyRows = await query('SELECT rule_id id, parent_id, title FROM rules WHERE lower(content) LIKE ? ORDER BY title;', [like]);
    for (const r of bodyRows) {
      const id = r.parent_id || r.id;
      if (seen.has(id)) continue; seen.add(id);
      const title = r.parent_id ? (await query('SELECT title FROM rules WHERE rule_id=?;', [r.parent_id]))[0]?.title || r.title : r.title;
      articleText.push({ id, name: title, kind: 'rule', meta: 'Codex Article' });
    }
  }

  // is:article / is:card - collapse the other side entirely.
  const onlyArticles = f.is.some((v) => v.startsWith('article') || v === 'rule' || v === 'rules');
  const onlyCards = f.is.some((v) => v === 'card' || v === 'cards');
  if (onlyArticles) { cards = []; cardText = []; }
  if (onlyCards) { articles = []; articleText = []; }

  return {
    articles: articles.slice(0, 40),
    cards: cards.slice(0, 60).map(asCard),
    cardText: cardText.slice(0, 80).map((c) => asCard(c)),
    articleText: articleText.slice(0, 40),
    // legacy flat shape (resolveByName-era callers)
    rules: articles.slice(0, 40),
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

/** Everything an article references, resolved for display below its body:
    cards (with art) it mentions, and other articles it links to. Fixes the old
    breakage - article/sub-entry link targets are rule_ids (a sub-entry's id is
    `parent__slug`), so they resolve by id, not by name; sub-entries fold up to
    their parent article. Garbage `unresolved_article` edges are dropped. */
export async function mentions(ruleId) {
  const rows = await query('SELECT DISTINCT target_id, target_type FROM link_graph WHERE source_id=?;', [ruleId]);
  const cards = [], articles = [];
  const seenCard = new Set(), seenArt = new Set();
  for (const r of rows) {
    if (r.target_type === 'card') {
      const key = r.target_id.toLowerCase();
      if (seenCard.has(key)) continue; seenCard.add(key);
      const c = (await query('SELECT card_id, name, image_slug, type, cost, is_site, elements, thresholds FROM cards WHERE lower(name)=? LIMIT 1;', [key]))[0];
      if (c) cards.push(c);
    } else if (r.target_type === 'article' || r.target_type === 'subentry') {
      const ru = (await query('SELECT rule_id, parent_id, title FROM rules WHERE rule_id=? LIMIT 1;', [r.target_id]))[0];
      if (!ru) continue;
      const openId = ru.parent_id || ru.rule_id;               // sub-entry → its parent article
      if (seenArt.has(openId)) continue; seenArt.add(openId);
      const title = ru.parent_id ? ((await query('SELECT title FROM rules WHERE rule_id=?;', [ru.parent_id]))[0]?.title || ru.title) : ru.title;
      articles.push({ id: openId, title });
    }
  }
  return { cards, articles };
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

/** Everything in the personal layer at once - the Codex Marginalia section.
 *  Notes, highlights and links profile-wide, each resolved to the entry it
 *  annotates so rows can tap through. */
export async function marginaliaAll() {
  const pid = activeProfileId();
  const saved = await query('SELECT id, target_type, target_id, created_at FROM saved WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
  for (const s of saved) s.on = await nameOf(s.target_type, s.target_id);
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
  return { saved, notes, highlights, links: linkRows };
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
  await run('DELETE FROM collection_items WHERE collection_id=?;', [id]);   // explicit - don't rely on FK cascade
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
