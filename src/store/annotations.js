// Annotation layer - highlights (and, later, notes/bookmarks) anchored to CANON
// character offsets in a compiled Codex document, with a W3C-style TextQuoteSelector
// fallback. This replaces the old text-matching highlights: an annotation stores
// WHERE it is (doc canon offsets), not just the words, so duplicate substrings can
// never cross-mark and a rule update can re-anchor or honestly orphan it rather
// than silently drift. The renderer is fed resolved canon ranges; it never matches
// text. See [[rule-architecture]].
import { query, run, tx } from './db.js';
import { activeProfileId } from './profileRepository.js';
import { uuid, nowIso } from './ids.js';
import { getDoc } from './codexDoc.js';

/* ---------------- DOM selection -> canon anchor ---------------- */

// Offset of (node, off) within blockEl's rendered text. blockEl's text content
// equals canon.slice(block.span), so this maps straight onto canon; a Range's
// toString handles text- and element-container endpoints uniformly, and never
// includes the CSS ::first-letter drop cap (a pseudo-element, not real text).
function offsetInBlock(blockEl, node, off) {
  const r = document.createRange();
  r.setStart(blockEl, 0);
  r.setEnd(node, off);
  return r.toString().length;
}
function findBlock(doc, id) {
  for (const b of doc.blocks) {
    if (b.id === id) return b;
    if (b.items) for (const it of b.items) if (it.id === id) return it;
  }
  return null;
}
// Keep an anchor edge from bisecting an inline link token: snap outward.
function snapOut(doc, pos, dir) {
  for (const l of doc.links || []) if (pos > l.start && pos < l.end) return dir < 0 ? l.start : l.end;
  return pos;
}
function endpoint(node, off, docFor) {
  const el = node.nodeType === 3 ? node.parentElement : node;
  const blockEl = el?.closest?.('[data-block-id]');
  const docEl = el?.closest?.('[data-doc-id]');
  if (!blockEl || !docEl) return null;
  const doc = docFor(docEl.dataset.docType, docEl.dataset.docId);
  const blk = doc && findBlock(doc, blockEl.dataset.blockId);
  if (!blk) return null;
  return { doc, blockId: blockEl.dataset.blockId, canon: blk.span[0] + offsetInBlock(blockEl, node, off) };
}

/** A live text Selection -> a canon anchor, or null. `docFor(type,id)` resolves a
 *  rendered [data-doc-*] container to its compiled Document. Selections are kept to
 *  ONE document (a cross-doc drag clips to the start doc). */
export function anchorFromSelection(sel, docFor) {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const a = endpoint(r.startContainer, r.startOffset, docFor);
  const b = endpoint(r.endContainer, r.endOffset, docFor);
  if (!a || !b) return null;
  const doc = a.doc;
  let start = a.canon;
  let end = b.doc === doc ? b.canon : doc.canon.length;   // cross-doc: clip to the start doc
  if (end < start) [start, end] = [end, start];
  start = snapOut(doc, start, -1);
  end = snapOut(doc, end, +1);
  if (end <= start) return null;
  const canon = doc.canon;
  return {
    docType: doc.docType, docId: doc.docId, buildHash: doc.buildHash,
    canonStart: start, canonEnd: end, blockHint: a.blockId,
    quote: { exact: canon.slice(start, end), prefix: canon.slice(Math.max(0, start - 32), start), suffix: canon.slice(end, end + 32) },
  };
}

/* ---------------- resolution (render + re-anchor) ---------------- */

// Whitespace-flexible search for `text` in canon, returning ALL match ranges.
function findAll(canon, text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'g');
  const out = [];
  let m;
  while ((m = re.exec(canon))) { out.push({ start: m.index, end: m.index + m[0].length }); if (m.index === re.lastIndex) re.lastIndex++; }
  return out;
}

/** Resolve a stored annotation against the CURRENT doc canon.
 *  Fast path: offsets still slice to the exact quote. Else re-anchor by quote,
 *  requiring BOTH prefix AND suffix to agree when the quote is ambiguous; on any
 *  ambiguity or zero match, orphan (never guess). */
export function resolveAnnotation(a, doc) {
  const canon = doc.canon;
  if (a.canonStart != null && canon.slice(a.canonStart, a.canonEnd) === a.quote.exact) {
    return { start: a.canonStart, end: a.canonEnd, state: 'anchored' };
  }
  const hits = findAll(canon, a.quote.exact);
  if (hits.length === 1) return { ...hits[0], state: 'reanchored' };
  if (hits.length > 1) {
    const agree = hits.filter((h) =>
      canon.slice(Math.max(0, h.start - a.quote.prefix.length), h.start).endsWith(a.quote.prefix) &&
      canon.slice(h.end, h.end + a.quote.suffix.length).startsWith(a.quote.suffix));
    if (agree.length === 1) return { ...agree[0], state: 'reanchored' };
  }
  return { start: null, end: null, state: 'orphaned' };
}

/* ---------------- DB ---------------- */

const rowToAnn = (r) => ({
  id: r.id, kind: r.kind, color: r.color, comment: r.comment, state: r.state,
  buildHash: r.build_hash, canonStart: r.canon_start, canonEnd: r.canon_end,
  quote: { exact: r.quote_exact, prefix: r.quote_prefix, suffix: r.quote_suffix },
});

/** All annotations for one document (current profile), with their anchors. */
export async function annotationsForDoc(docType, docId) {
  const rows = await query(
    `SELECT a.id,a.kind,a.color,a.comment,a.state,a.build_hash,
            n.canon_start,n.canon_end,n.quote_exact,n.quote_prefix,n.quote_suffix
     FROM annotations a JOIN anchors n ON n.annotation_id=a.id
     WHERE a.profile_id=? AND a.doc_type=? AND a.doc_id=? ORDER BY a.created_at;`,
    [activeProfileId(), docType, docId]);
  return rows.map(rowToAnn);
}

/** Create an annotation from a captured anchor. Returns the new id. */
export async function addAnnotation({ kind = 'highlight', color = 'gold', comment = '', groupId = null, anchor }) {
  const id = uuid();
  const ts = nowIso();
  await tx([
    ['INSERT INTO annotations(id,profile_id,kind,group_id,doc_type,doc_id,build_hash,color,comment,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?);',
      [id, activeProfileId(), kind, groupId, anchor.docType, anchor.docId, anchor.buildHash, color, comment, 'anchored', ts, ts]],
    ['INSERT INTO anchors(annotation_id,canon_start,canon_end,quote_exact,quote_prefix,quote_suffix,block_hint) VALUES(?,?,?,?,?,?,?);',
      [id, anchor.canonStart, anchor.canonEnd, anchor.quote.exact, anchor.quote.prefix, anchor.quote.suffix, anchor.blockHint || null]],
  ]);
  return id;
}

export async function deleteAnnotation(id) {
  await run('DELETE FROM annotations WHERE id=? AND profile_id=?;', [id, activeProfileId()]);
}
export async function updateAnnotationComment(id, comment) {
  await run('UPDATE annotations SET comment=?, updated_at=? WHERE id=? AND profile_id=?;', [comment, nowIso(), id, activeProfileId()]);
}

/* ---------------- one-time migration of legacy `highlights` ---------------- */

/** Backfill every legacy `highlights` row into the annotation model, anchoring its
 *  stored text against the document canon (first occurrence; ambiguity keeps the
 *  first, matching today's visible "mark all" behaviour; zero match -> orphaned,
 *  kept for the recovery tray). Idempotent via a durable catalog_meta flag that
 *  survives catalog reseeds. Runs at boot AFTER migrations + catalog seed. */
export async function migrateAnnotationsIfNeeded() {
  const done = (await query("SELECT value FROM catalog_meta WHERE key='highlights_migrated';"))[0]?.value;
  if (done === '1') return { skipped: true };
  const rows = await query('SELECT id,profile_id,target_type,target_id,text,comment,created_at FROM highlights;');
  const docCache = new Map();
  const stmts = [];
  let anchored = 0, orphaned = 0;
  for (const h of rows) {
    const key = h.target_type + ':' + h.target_id;
    if (!docCache.has(key)) docCache.set(key, await getDoc(h.target_type, h.target_id));
    const doc = docCache.get(key);
    const id = uuid();
    const color = h.target_type === 'card' ? 'violet' : 'gold';
    let start = null, end = null, state = 'orphaned';
    let quote = { exact: (h.text || '').trim(), prefix: '', suffix: '' };
    if (doc && h.text) {
      const hit = findAll(doc.canon, h.text)[0];
      if (hit) { start = hit.start; end = hit.end; state = 'anchored';
        quote = { exact: doc.canon.slice(start, end), prefix: doc.canon.slice(Math.max(0, start - 32), start), suffix: doc.canon.slice(end, end + 32) }; }
    }
    state === 'orphaned' ? orphaned++ : anchored++;
    const ts = h.created_at || nowIso();
    stmts.push(['INSERT INTO annotations(id,profile_id,kind,group_id,doc_type,doc_id,build_hash,color,comment,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?);',
      [id, h.profile_id, 'highlight', null, h.target_type, h.target_id, doc?.buildHash || null, color, h.comment || '', state, ts, ts]]);
    stmts.push(['INSERT INTO anchors(annotation_id,canon_start,canon_end,quote_exact,quote_prefix,quote_suffix,block_hint) VALUES(?,?,?,?,?,?,?);',
      [id, start, end, quote.exact, quote.prefix, quote.suffix, null]]);
  }
  stmts.push(["INSERT OR REPLACE INTO catalog_meta(key,value) VALUES('highlights_migrated','1');"]);
  await tx(stmts);
  return { total: rows.length, anchored, orphaned };
}
