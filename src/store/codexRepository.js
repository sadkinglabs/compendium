// Codex data - catalog reads (shared) + the profile-scoped personal layer
// (saved, marginalia notes, highlights, collections). Every profile-scoped read
// and write passes through activeProfileId(), so isolation is structural.
import { query, run } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { parseQuery, cardMatchesQuery } from './cardQuery.js';   // the one shared card-search grammar

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
  for (const r of await query('SELECT DISTINCT doc_id FROM annotations WHERE profile_id=?;', [pid])) ids.add(r.doc_id);
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
      id: c.id, name: c.name, kind: 'card', meta: cardMeta(c), type: c.type, cost: c.cost,
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

/* ── Codex search (one grammar, shared with the deckbuilder) ──
   parseQuery (cardQuery.js) does all tokenising: plain words match names/titles
   AND full text (card rules, article bodies); rich clauses (t:/r:/kw:/el:/e:/
   attack>/cost/th:/set:/rarity) narrow the card pool exactly as the deckbuilder's
   filters do; and the Codex-only scope channel rides the same parse:
     has:faq · has:marginalia · is:errata · is:saved (is:bookmarked)
     is:article / is:card - restrict results to one side of the Codex
   "quoted phrases" match as one string. */

/** Categorised Codex search. Returns
 *  { articles, cards, cardText, articleText } - name/title hits first, then
 *  entries whose TEXT contains the words ("airborne" → the Airborne article,
 *  then every minion whose rules mention airborne, grouped by type). */
export async function searchCodex(q) {
  const parsed = parseQuery(q);           // ONE grammar: needle + rich clauses + has:/is: scopes
  const { scopes } = parsed;
  const needle = parsed.name.trim().toLowerCase();
  const like = needle ? `%${needle}%` : null;
  const hasScope = scopes.has.length + scopes.is.length > 0;

  // Card pool - WIDE select so every rich predicate (rules_text/attack/elements/etc.)
  // can evaluate. Mirrors the deckbuilder's getPool columns.
  let cardRows = await query('SELECT card_id id, name, type, sub_types, rarity, elements, cost, attack, defence, life, thresholds, rules_text, sets, variants, image_slug, is_site FROM cards;');
  if (parsed.clauses.length) cardRows = cardRows.filter((c) => cardMatchesQuery(c, parsed));
  if (scopes.has.includes('faq')) { const fs = await faqCardSet(); cardRows = cardRows.filter((c) => fs.has(c.id)); }
  if (scopes.has.some((h) => h.startsWith('marg') || h === 'notes')) { const ms = await margSet(); cardRows = cardRows.filter((c) => ms.has(c.id)); }
  if (scopes.is.includes('errata')) { const er = await errataCardSet(); cardRows = cardRows.filter((c) => er.has(c.id)); }
  if (scopes.is.includes('saved') || scopes.is.includes('bookmarked')) { const { saved } = await indicatorSets(); cardRows = cardRows.filter((c) => saved.has(c.id)); }

  // Rich projection: the wide SELECT already fetched these, so the search result
  // carries enough for CardRow (art/pips/cost/rarity) - no second query, no
  // second shape. meta stays for any legacy ListRow consumer.
  const asCard = (c) => ({
    id: c.id, name: c.name, kind: 'card', meta: cardMeta(c),
    type: c.type, cost: c.cost, rarity: c.rarity, attack: c.attack, defence: c.defence,
    elements: c.elements, thresholds: c.thresholds, image_slug: c.image_slug, is_site: c.is_site,
  });
  let cards = [], cardText = [];
  if (like) {
    cards = cardRows.filter((c) => c.name.toLowerCase().includes(needle));
    const named = new Set(cards.map((c) => c.id));
    // text hits, grouped by type then name - "all minions with airborne" reads
    // as one run of Minions, then Auras, etc.
    cardText = cardRows
      .filter((c) => !named.has(c.id) && (c.rules_text || '').toLowerCase().includes(needle))
      .sort((a, b) => (a.type || '').localeCompare(b.type || '') || a.name.localeCompare(b.name));
    cards.sort((a, b) => a.name.localeCompare(b.name));
  } else if (parsed.clauses.length || hasScope) {
    cards = [...cardRows].sort((a, b) => a.name.localeCompare(b.name));   // filters/clauses only: the narrowed pool IS the result
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
  const onlyArticles = scopes.is.some((v) => v.startsWith('article') || v === 'rule' || v === 'rules');
  const onlyCards = scopes.is.some((v) => v === 'card' || v === 'cards');
  if (onlyArticles) { cards = []; cardText = []; }
  if (onlyCards) { articles = []; articleText = []; }

  // Bookmark state for the result rows (parity with the browse A-Z index, whose
  // rows show a gold bookmark when saved). One indicator read, mapped onto both
  // domains by id (saved.target_id is the card_id or rule_id).
  const { saved } = await indicatorSets();
  const withSaved = (it) => ({ ...it, saved: saved.has(it.id) });

  return {
    articles: articles.slice(0, 40).map(withSaved),
    cards: cards.slice(0, 60).map((c) => withSaved(asCard(c))),
    cardText: cardText.slice(0, 80).map((c) => withSaved(asCard(c))),
    articleText: articleText.slice(0, 40).map(withSaved),
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
  if (!rows.length) return [];
  const ids = rows.map((r) => r.source_id);
  const found = await query(`SELECT rule_id, title FROM rules WHERE rule_id IN (${ids.map(() => '?').join(',')});`, ids);
  const byId = new Map(found.map((x) => [x.rule_id, x.title]));
  const out = [];
  for (const r of rows) { if (byId.has(r.source_id)) out.push({ name: byId.get(r.source_id), type: 'rule' }); }
  return out;
}

/** Everything an article references, resolved for display below its body:
    cards (with art) it mentions, and other articles it links to. Fixes the old
    breakage - article/sub-entry link targets are rule_ids (a sub-entry's id is
    `parent__slug`), so they resolve by id, not by name; sub-entries fold up to
    their parent article. Garbage `unresolved_article` edges are dropped. */
export async function mentions(ruleId) {
  const rows = await query('SELECT DISTINCT target_id, target_type FROM link_graph WHERE source_id=?;', [ruleId]);
  // First pass: collect the card names (deduped, lowercased, first-seen order)
  // and the article/subentry target ids (in order) so the lookups can be batched.
  const cardKeys = [], seenCard = new Set(), artTargetIds = [];
  for (const r of rows) {
    if (r.target_type === 'card') {
      const key = r.target_id.toLowerCase();
      if (!seenCard.has(key)) { seenCard.add(key); cardKeys.push(key); }
    } else if (r.target_type === 'article' || r.target_type === 'subentry') {
      artTargetIds.push(r.target_id);
    }
  }
  // One IN query for the cards (keyed by lower(name), first match wins == old LIMIT 1).
  const cardByName = new Map();
  if (cardKeys.length) {
    const found = await query(`SELECT card_id, name, image_slug, type, cost, is_site, elements, thresholds FROM cards WHERE lower(name) IN (${cardKeys.map(() => '?').join(',')});`, cardKeys);
    for (const c of found) { const k = String(c.name).toLowerCase(); if (!cardByName.has(k)) cardByName.set(k, c); }
  }
  const cards = [];
  for (const key of cardKeys) { const c = cardByName.get(key); if (c) cards.push(c); }
  // One IN query for the article rules, then one more for the parent titles they fold up to.
  const ruleById = new Map();
  if (artTargetIds.length) {
    const uniq = [...new Set(artTargetIds)];
    const found = await query(`SELECT rule_id, parent_id, title FROM rules WHERE rule_id IN (${uniq.map(() => '?').join(',')});`, uniq);
    for (const ru of found) ruleById.set(ru.rule_id, ru);
  }
  const parentIds = [...new Set([...ruleById.values()].filter((ru) => ru.parent_id).map((ru) => ru.parent_id))];
  const parentTitle = new Map();
  if (parentIds.length) {
    const found = await query(`SELECT rule_id, title FROM rules WHERE rule_id IN (${parentIds.map(() => '?').join(',')});`, parentIds);
    for (const p of found) parentTitle.set(p.rule_id, p.title);
  }
  const articles = [], seenArt = new Set();
  for (const tid of artTargetIds) {
    const ru = ruleById.get(tid);
    if (!ru) continue;
    const openId = ru.parent_id || ru.rule_id;               // sub-entry → its parent article
    if (seenArt.has(openId)) continue; seenArt.add(openId);
    const title = ru.parent_id ? (parentTitle.get(ru.parent_id) || ru.title) : ru.title;
    articles.push({ id: openId, title });
  }
  return { cards, articles };
}

export async function faqsForCard(cardId) {
  // card_ids stored as a JSON array of curiosa slugs (== card_id)
  return query("SELECT faq_id, question, answer FROM faqs WHERE card_ids LIKE ? ORDER BY rowid LIMIT 50;", [
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

// isSaved / toggleSaved back the doc-level BOOKMARK ribbon (the `saved` table is
// named for history; see its schema note). A plain pin - not an anchored annotation.
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

/* user-authored cross-links (the "Link" half of marginalia).
   Batch name resolver: instead of one query per row (the old per-row nameOf),
   resolve many {type,id} targets in a single IN query per table, chunked for
   SQLite's ~999-variable cap. Returns a Map keyed `card:<id>` / `rule:<id>`;
   nameFrom applies the same `|| id` fallback the per-row nameOf had. */
async function namesFor(pairs) {
  const cardIds = [...new Set(pairs.filter((p) => p.type === 'card').map((p) => p.id))];
  const ruleIds = [...new Set(pairs.filter((p) => p.type !== 'card').map((p) => p.id))];
  const map = new Map();
  const load = async (ids, table, idCol, nameCol, prefix) => {
    for (let i = 0; i < ids.length; i += 900) {
      const chunk = ids.slice(i, i + 900);
      const rows = await query(`SELECT ${idCol} id, ${nameCol} nm FROM ${table} WHERE ${idCol} IN (${chunk.map(() => '?').join(',')});`, chunk);
      for (const r of rows) map.set(prefix + r.id, r.nm);
    }
  };
  await load(cardIds, 'cards', 'card_id', 'name', 'card:');
  await load(ruleIds, 'rules', 'rule_id', 'title', 'rule:');
  return map;
}
const nameFrom = (names, type, id) => names.get((type === 'card' ? 'card:' : 'rule:') + id) || id;

export async function linksFor(targetId) {
  const pid = activeProfileId();
  const rows = await query('SELECT * FROM links WHERE profile_id=? AND (a_id=? OR b_id=?) ORDER BY created_at DESC;', [pid, targetId, targetId]);
  const others = rows.map((l) => (l.a_id === targetId ? { type: l.b_type, id: l.b_id } : { type: l.a_type, id: l.a_id }));
  const names = await namesFor(others);
  return rows.map((l, i) => ({
    id: l.id, description: l.description,
    otherType: others[i].type, otherId: others[i].id, otherName: nameFrom(names, others[i].type, others[i].id),
  }));
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
  const hls = await query("SELECT a.doc_type target_type, a.doc_id target_id, n.quote_exact text, a.comment FROM annotations a JOIN anchors n ON n.annotation_id=a.id WHERE a.profile_id=? AND a.kind='highlight' AND (lower(n.quote_exact) LIKE ? OR lower(a.comment) LIKE ?) ORDER BY a.created_at DESC LIMIT 20;", [pid, like, like]);
  const names = await namesFor([...notes, ...hls].map((r) => ({ type: r.target_type, id: r.target_id })));
  const out = [];
  for (const n of notes) out.push({ kind: n.target_type, id: n.target_id, name: nameFrom(names, n.target_type, n.target_id), meta: 'Note', glyph: '⚜' });
  for (const h of hls) out.push({ kind: h.target_type, id: h.target_id, name: nameFrom(names, h.target_type, h.target_id), meta: 'Highlight', glyph: '✦' });
  return out;
}

/** Everything in the personal layer at once - the Codex Marginalia section.
 *  Notes, highlights and links profile-wide, each resolved to the entry it
 *  annotates so rows can tap through. */
export async function marginaliaAll() {
  const pid = activeProfileId();
  const saved = await query('SELECT id, target_type, target_id, created_at FROM saved WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
  const notes = await query('SELECT id, target_type, target_id, body, updated_at FROM notes WHERE profile_id=? ORDER BY updated_at DESC;', [pid]);
  const highlights = await query("SELECT a.id, a.doc_type target_type, a.doc_id target_id, n.quote_exact text, a.comment, a.created_at FROM annotations a JOIN anchors n ON n.annotation_id=a.id WHERE a.profile_id=? AND a.kind='highlight' ORDER BY a.created_at DESC;", [pid]);
  const links = await query('SELECT * FROM links WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
  const names = await namesFor([
    ...saved.map((r) => ({ type: r.target_type, id: r.target_id })),
    ...notes.map((r) => ({ type: r.target_type, id: r.target_id })),
    ...highlights.map((r) => ({ type: r.target_type, id: r.target_id })),
    ...links.flatMap((l) => [{ type: l.a_type, id: l.a_id }, { type: l.b_type, id: l.b_id }]),
  ]);
  for (const s of saved) s.on = nameFrom(names, s.target_type, s.target_id);
  for (const n of notes) n.on = nameFrom(names, n.target_type, n.target_id);
  for (const h of highlights) h.on = nameFrom(names, h.target_type, h.target_id);
  const linkRows = links.map((l) => ({
    id: l.id, description: l.description,
    aType: l.a_type, aId: l.a_id, aName: nameFrom(names, l.a_type, l.a_id),
    bType: l.b_type, bId: l.b_id, bName: nameFrom(names, l.b_type, l.b_id),
  }));
  return { saved, notes, highlights, links: linkRows };
}

/* collections */
export async function listCollections() {
  const pid = activeProfileId();
  const cols = await query('SELECT * FROM collections WHERE profile_id=? ORDER BY created_at DESC;', [pid]);
  if (cols.length) {
    const counts = await query(`SELECT collection_id, COUNT(*) n FROM collection_items WHERE collection_id IN (${cols.map(() => '?').join(',')}) GROUP BY collection_id;`, cols.map((c) => c.id));
    const byId = new Map(counts.map((r) => [r.collection_id, r.n]));
    for (const c of cols) c.count = byId.get(c.id) || 0;
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
  const names = await namesFor(rows.map((r) => ({ type: r.target_type, id: r.target_id })));
  for (const r of rows) r.name = nameFrom(names, r.target_type, r.target_id);
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
