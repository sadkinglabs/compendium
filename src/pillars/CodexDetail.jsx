// Codex detail - rule (drop-cap reading + related + sub-entries) or card
// (art hero, stat boxes, rules, FAQs), plus the per-profile personal layer:
// save/star, marginalia notes, highlights, collections.
import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getCard, getRule, relatedFor, mentions, faqsForCard,
  isSaved, toggleSaved, notesFor, addNote, deleteNote,
  highlightsFor, addHighlight, deleteHighlight,
  createCollection, collectionsForTarget, toggleCollectionItem,
  linksFor, addLink, deleteLink, searchCodex,
} from '../store/codexRepository.js';
import { decksWithCard, listDecks, deckQty, changeQty } from '../store/deckRepository.js';
import { query } from '../store/db.js';
import { thresholdRuns } from '../store/cardArt.js';
import { getDoc, getDocs, getFaqs } from '../store/codexDoc.js';
import { Chip, ChipRow, IconButton, SectionLabel, ThresholdPips, BottomSheet, RuleArticle, InlineText, Loading, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import CardArt from '../components/CardArt.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
// After acting on pointerdown, a touch still emits ONE synthetic click - swallow it
// (capture phase) so it never lands on the content that was under the pill/scrim.
function armClickGuard() {
  if (typeof window === 'undefined') return;
  const block = (e) => { e.stopPropagation(); e.preventDefault(); done(); };
  const done = () => { window.removeEventListener('click', block, true); clearTimeout(t); };
  const t = setTimeout(done, 600);
  window.addEventListener('click', block, true);
}
// Never render an em dash, even from reference data - swap for a spaced hyphen.
const noEm = (s) => String(s || '').replace(/\s*—\s*/g, ' - ');

// Small inline SVG icons - no Unicode glyphs anywhere in the Codex detail.
const IcoLink = ({ size = 13 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', verticalAlign: '-1px' }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
const IcoPlus = ({ size = 13 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ flex: 'none', verticalAlign: '-2px' }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IcoStar = ({ size = 13, fill }) => <svg viewBox="0 0 24 24" width={size} height={size} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
const CodexTypeIcon = ({ kind, size = 14 }) => kind === 'card'
  ? <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /></svg>
  : <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><polyline points="14 4 14 9 19 9" /></svg>;

export default function CodexDetail({ kind, id, onOpen, onOpenName, onOpenDeck, onChanged }) {
  const [data, setData] = useState(null);
  const [composer, setComposer] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [picker, setPicker] = useState(false);
  const [deckAdd, setDeckAdd] = useState(false);
  const bodyRef = useRef(null);
  const [selection, setSelection] = useState('');

  async function load() {
    if (kind === 'card') {
      const c = await getCard(id);
      if (!c) return setData({ missing: true });
      const [doc, appearsIn, faqs, notes, highlights, saved, links, inDecks] = await Promise.all([
        getDoc('card', id), relatedFor('card', id, c.name), faqsForCard(id), notesFor(id), highlightsFor(id), isSaved(id), linksFor(id), decksWithCard(id),
      ]);
      const faqDocs = await getFaqs(faqs.map((f) => f.faq_id));
      setData({ kind, card: c, doc, appearsIn, faqs, faqDocs, notes, highlights, saved, links, inDecks });
    } else {
      const r = await getRule(id);
      if (!r) return setData({ missing: true });
      const [doc, ment, subs, notes, highlights, saved, links] = await Promise.all([
        getDoc('rule', id), mentions(id), query('SELECT rule_id id, title FROM rules WHERE parent_id=?;', [id]),
        notesFor(id), highlightsFor(id), isSaved(id), linksFor(id),
      ]);
      const subDocs = await getDocs(subs.map((s) => ['rule', s.id]));
      setData({ kind, rule: r, doc, mentions: ment, subs, subDocs, notes, highlights, saved, links });
    }
  }
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line */ }, [kind, id]);

  // Text-selection -> "Highlight" affordance. Driven by the global selectionchange
  // event so the button appears the instant a selection commits (mobile long-press
  // included, no scroll/tap needed), rAF-debounced so drag-select doesn't thrash
  // state. The cleanup GUARANTEES teardown on unmount/navigation - it kills the
  // listener, the React state, AND the browser's own selection, so nothing lingers
  // over the next screen. Empty deps: it must persist across [kind,id] data reloads.
  useEffect(() => {
    let raf = 0;
    const read = () => {
      const s = window.getSelection?.();
      if (!s || s.isCollapsed || !bodyRef.current || !s.anchorNode || !bodyRef.current.contains(s.anchorNode)) { setSelection(''); return; }
      let t = s.toString();
      // Re-attach the lead paragraph's floated drop-cap, routinely dropped when the
      // drag starts at the very top, so a saved quote keeps its first letter.
      try {
        const r = s.getRangeAt(0);
        const startEl = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
        const lead = startEl?.closest?.('.cx-article-p.lead');
        if (lead && r.startOffset <= 1) {
          const first = (lead.textContent || '').replace(/^\s+/, '')[0];
          if (first && t && t[0] !== first) t = first + t;
        }
      } catch { /* noop */ }
      setSelection(t);
    };
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read); };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      cancelAnimationFrame(raf);
      setSelection('');
      window.getSelection?.()?.removeAllRanges();
    };
  }, []);

  if (!data) return <Loading />;
  if (data.missing) return <div style={{ padding: 24, color: 'var(--ink-faint)', fontStyle: 'italic' }}>This entry isn’t in the catalog.</div>;

  // Render + all writes key off the LOADED entry (data), never the raw props -
  // the props (kind/id) update a tick before the effect reloads data, so mixing
  // them is what caused the stale-kind crash. data.kind + the entry's own id are
  // always mutually consistent.
  const k = data.kind;
  const targetType = k;
  const entryId = k === 'card' ? data.card.card_id : data.rule.rule_id;
  async function onStar() { await toggleSaved(targetType, entryId); await load(); onChanged?.(); }
  async function saveNote() {
    if (!noteText.trim()) return;
    await addNote(targetType, entryId, noteText.trim());
    setNoteText(''); setComposer(false); await load(); onChanged?.();
  }
  async function delNote(nid) { await deleteNote(nid); await load(); onChanged?.(); }
  async function saveLink(target, desc) {
    await addLink(targetType, entryId, target.kind, target.id, desc);
    setComposer(false); await load(); onChanged?.();
  }
  async function delLink(lid) { await deleteLink(lid); await load(); onChanged?.(); }
  async function captureHighlight() {
    const t = selection.trim();
    if (!t) return;
    await addHighlight(targetType, entryId, t, '');
    setSelection(''); window.getSelection()?.removeAllRanges(); await load();
  }
  const marks = (data.highlights || []).map((h) => h.text).filter(Boolean);
  const hue = k === 'card' ? 'violet' : 'gold';           // card highlights purple, rule gold
  const appearsIn = k === 'card' ? (data.appearsIn || []).filter((r) => r.type !== 'unresolved_article') : [];
  const ment = data.mentions || { cards: [], articles: [] };

  // In-text [[links]] carry only a name. Resolve them against the entry's already-
  // resolved mentions (exact ids) first, and only fall back to name lookup for
  // anything not in the graph - so a card that shares a name with an article can't
  // mis-route.
  const linkBy = { card: {}, rule: {} };
  for (const c of ment.cards) linkBy.card[c.name.toLowerCase()] = ['card', c.card_id, c.name];
  for (const a of ment.articles) linkBy.rule[a.title.toLowerCase()] = ['rule', a.id, a.title];
  // Typed links resolve to their own kind first (so [[Charge]] the card and
  // ((Charge)) the rule can't cross-route), then fall back to name lookup.
  const openLink = (name, target) => {
    const key = String(name).toLowerCase();
    const hit = (target && linkBy[target]?.[key]) || linkBy.card[key] || linkBy.rule[key];
    if (hit) onOpen(hit[0], hit[1], hit[2]); else onOpenName(name, target);
  };

  return (
    <div style={{ padding: '18px 22px 30px', animation: 'cxfade .2s ease' }}>
      {k === 'card' ? <CardBody card={data.card} doc={data.doc} faqs={data.faqs} faqDocs={data.faqDocs} onOpenLink={openLink} bodyRef={bodyRef} marks={marks} />
                    : <RuleBody doc={data.doc} subs={data.subs} subDocs={data.subDocs} onOpenLink={openLink} bodyRef={bodyRef} marks={marks} />}

      {/* Cards Mentioned - carousel of card art referenced by this article. Opens
          by (kind, id) directly - no fragile name resolution. */}
      {k === 'rule' && ment.cards.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel label="CARDS MENTIONED" count={ment.cards.length} />
          <div className="cx-mention-rail">
            {ment.cards.map((c) => (
              <div key={c.card_id} className="cx-mention-card" onClick={() => onOpen('card', c.card_id, c.name)}>
                <CardArt card={c} radius={9} />
                <div className="cx-mention-name">{c.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related articles - pills that link to other articles by id. */}
      {k === 'rule' && ment.articles.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel label="RELATED ARTICLES" count={ment.articles.length} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ment.articles.map((a) => (
              <span key={a.id} onClick={() => onOpen('rule', a.id, a.title)} className="cx-relpill">{a.title}</span>
            ))}
          </div>
        </div>
      )}

      {/* Card: the articles that cite it, as pills. */}
      {k === 'card' && appearsIn.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel label="MENTIONED IN" count={appearsIn.length} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {appearsIn.map((r, i) => <span key={i} onClick={() => onOpenName(r.name)} className="cx-relpill">{r.name}</span>)}
          </div>
        </div>
      )}

      {/* in your decks - the unification payoff: this card in the profile's decks */}
      {k === 'card' && data.inDecks.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel label="IN YOUR DECKS" count={data.inDecks.length} />
          {data.inDecks.map((d, i) => (
            <div key={d.id + d.zone} onClick={() => onOpenDeck?.(d.id, d.name)} className="cx-row"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', borderBottom: i < data.inDecks.length - 1 ? '1px solid var(--hair-12)' : 'none', cursor: 'pointer' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-violet)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, font: "600 14.5px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              <span style={{ font: "500 11px/1 var(--f-ui)", color: 'var(--ink-muted)' }}>{d.zone === 'avatar' ? 'Avatar' : `${d.zone.charAt(0).toUpperCase() + d.zone.slice(1)} · ${d.quantity}×`}</span>
              <span style={{ color: 'var(--ink-faint)', display: 'flex' }}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
            </div>
          ))}
        </div>
      )}

      {/* highlights - hued by target: card = violet (deck-builder link), rule = gold */}
      {data.highlights.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel label="HIGHLIGHTS" count={data.highlights.length} />
          {data.highlights.map((h) => (
            <div key={h.id} style={{ borderLeft: `3px solid ${hue === 'violet' ? 'var(--link-violet)' : 'var(--gold-leaf)'}`, background: hue === 'violet' ? 'rgba(199,154,208,.08)' : 'rgba(220,184,111,.08)', borderRadius: '0 10px 10px 0', padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, font: "400 14px/1.45 var(--f-read)", color: 'var(--ink-body-2)', fontStyle: 'italic' }}>“{h.text}”{h.comment ? <span style={{ display: 'block', fontStyle: 'normal', color: 'var(--ink-muted)', fontSize: 12, marginTop: 4 }}>{h.comment}</span> : null}</div>
              <IconButton glyph="✕" tone="danger" size={22} onClick={async () => { await deleteHighlight(h.id); await load(); }} />
            </div>
          ))}
        </div>
      )}

      {/* marginalia */}
      <div style={{ marginTop: 18, borderRadius: 16, background: 'linear-gradient(180deg,rgba(30,22,15,.85),rgba(22,16,11,.6))', border: '1px solid var(--hair-16)', padding: 15 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
          <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)' }}>YOUR MARGINALIA</span>
          <IconButton glyph="+" onClick={() => setComposer(true)} title="Add a note or link" />
        </div>
        {data.notes.length === 0 && data.links.length === 0 && (
          <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', padding: '6px 0 4px' }}>No marginalia yet - add a note or link.</div>
        )}
        {data.notes.map((n) => (
          <div key={n.id} style={{ borderLeft: '2px solid var(--gold)', background: 'rgba(201,163,90,.06)', borderRadius: '0 10px 10px 0', padding: '11px 13px', marginBottom: 8, display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, font: "400 14px/1.45 var(--f-read)", color: 'var(--ink-body)', fontStyle: 'italic' }}>{n.body}</div>
            <IconButton glyph="✕" tone="danger" size={22} onClick={() => delNote(n.id)} />
          </div>
        ))}
        {data.links.map((l) => (
          <div key={l.id} style={{ borderLeft: '2px solid var(--link-violet)', background: 'rgba(199,154,208,.08)', borderRadius: '0 10px 10px 0', padding: '11px 13px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div onClick={() => onOpenName(l.otherName)} style={{ display: 'flex', alignItems: 'center', gap: 6, font: "600 14px/1.3 var(--f-read)", color: 'var(--link-violet)', cursor: 'pointer' }}><IcoLink />{l.otherName}</div>
              {l.description && <div style={{ font: "400 12.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 3 }}>{l.description}</div>}
            </div>
            <IconButton glyph="✕" tone="danger" size={22} onClick={() => delLink(l.id)} />
          </div>
        ))}
      </div>

      {/* selection -> highlight. A full-screen invisible layer is "highlight mode":
          tapping the pill saves, tapping ANYWHERE else rejects the selection and
          removes the pill - and nothing underneath ever fires (the layer catches the
          press, and armClickGuard eats the trailing synthetic click). Portaled into
          .cx-app; acts on pointerDown from the `selection` STATE so a collapse can't
          race it. */}
      {selection && createPortal(
        <div className="cx-hl-layer"
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); armClickGuard(); setSelection(''); window.getSelection?.()?.removeAllRanges(); }}>
          <button className="cx-hl-pill"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); armClickGuard(); captureHighlight(); }}>
            <IcoPlus size={14} />Highlight selection
          </button>
        </div>,
        document.querySelector('.cx-app') || document.body
      )}

      <MarginaliaComposer open={composer} onClose={() => setComposer(false)}
        noteText={noteText} setNoteText={setNoteText} onSaveNote={saveNote} onSaveLink={saveLink} selfId={entryId} />
      <CollectionPicker open={picker} targetType={targetType} targetId={entryId} onClose={() => { setPicker(false); load(); }} />
      {k === 'card' && !data.card.is_avatar && (
        <AddToDeckSheet open={deckAdd} card={data.card} onClose={() => { setDeckAdd(false); load(); onChanged?.(); }} />
      )}

      {/* Save / Collect / Add-to-deck live in a FAB (consistent app-wide), not inline buttons. */}
      <Fab variant="deck" icon={<FabGlyph kind="dots" />} label="Entry options" items={[
        { label: data.saved ? 'Saved' : 'Save', keepOpen: true, state: <IcoStar fill={data.saved} />, onClick: onStar },
        { label: 'Collect', onClick: () => setPicker(true) },
        ...(k === 'card' && !data.card.is_avatar ? [{ label: 'Add to a deck', onClick: () => setDeckAdd(true) }] : []),
      ]} />
    </div>
  );
}

function RuleBody({ doc, subs, subDocs, onOpenLink, bodyRef, marks }) {
  return (
    <div ref={bodyRef}>
      <RuleArticle doc={doc} onOpenLink={onOpenLink} markHue="gold" marks={marks} />
      {subs.map((s, i) => (
        <div key={s.id} style={{ marginTop: 16 }}>
          <SectionLabel label={s.title.toUpperCase()} />
          <RuleArticle doc={subDocs[i]} onOpenLink={onOpenLink} markHue="gold" marks={marks} />
        </div>
      ))}
    </div>
  );
}

function CardBody({ card, doc, faqs, faqDocs, onOpenLink, bodyRef, marks }) {
  const subTypes = jp(card.sub_types, []);
  const sets = jp(card.sets, []);
  const pips = thresholdRuns(card);
  const isAvatar = !!card.is_avatar;
  const stats = [];
  if (card.cost != null) stats.push(['MANA', card.cost]);
  if (pips.length) stats.push(['THRESHOLD', <ThresholdPips runs={pips} />]);
  // Power model (deck-builder parity): a minion whose attack equals its defence
  // shows a single POWER; if they differ, show ATTACK and DEFENCE separately.
  if (card.attack != null || card.defence != null) {
    if (card.attack != null && card.attack === card.defence) stats.push(['POWER', card.attack]);
    else { stats.push(['ATTACK', card.attack ?? '–']); stats.push(['DEFENCE', card.defence ?? '–']); }
  }
  if (isAvatar && card.life != null) stats.push(['LIFE', card.life]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        {card.is_site ? (
          // Sites play sideways - show the art rotated 90° in a landscape footprint (deck-builder parity).
          <div style={{ position: 'relative', width: 264, aspectRatio: '7 / 5' }}>
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 'calc(264px * 5 / 7)', transform: 'translate(-50%,-50%) rotate(90deg)', boxShadow: '0 18px 40px -16px rgba(0,0,0,.6)' }}>
              <CardArt card={card} />
            </div>
          </div>
        ) : (
          <div style={{ width: 200, boxShadow: '0 18px 40px -16px rgba(0,0,0,.6)' }}>
            <CardArt card={card} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ font: "600 11px/1 var(--f-ui)", letterSpacing: '.06em', color: 'var(--gold-leaf)' }}>{card.type}</span>
        {card.rarity && <><Dot /><span style={{ font: "500 11px/1 var(--f-ui)", color: 'var(--ink-muted)' }}>{card.rarity}</span></>}
        {subTypes.length > 0 && <><Dot /><span style={{ font: "500 11px/1 var(--f-ui)", color: 'var(--ink-muted)' }}>{subTypes.join(' · ')}</span></>}
      </div>

      {stats.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {stats.map(([l, v], i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', border: '1px solid var(--hair-16)', borderRadius: 11, padding: '11px 4px', background: 'var(--surface-well)' }}>
              <div style={{ font: "600 16px/1.1 var(--f-mono)", color: 'var(--gold-leaf)' }}>{v}</div>
              <div style={{ font: "600 9px/1 var(--f-ui)", letterSpacing: '.1em', color: 'var(--ink-faint)', marginTop: 6 }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {card.rules_text && (
        <div ref={bodyRef}
          style={{ border: '1px solid var(--hair-16)', borderRadius: 12, background: 'var(--surface-card)', padding: '4px 14px 14px', marginBottom: 14 }}>
          <RuleArticle doc={doc} onOpenLink={onOpenLink} markHue="violet" marks={marks} />
        </div>
      )}

      {sets.length > 0 && (
        <div style={{ font: "500 11px/1.4 var(--f-ui)", color: 'var(--ink-faint)', marginBottom: 14 }}>
          Sets: {sets.map((s) => s.name).join(', ')}
        </div>
      )}

      {faqs.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <SectionLabel label="OFFICIAL FAQ" count={faqs.length} />
          {faqs.map((f, i) => (
            <div key={i} style={{ border: '1px solid var(--hair-14)', borderRadius: 12, background: 'var(--surface-card)', padding: '12px 13px', marginBottom: 8 }}>
              <div style={{ font: "600 13.5px/1.4 var(--f-read)", color: 'var(--ink-head)', marginBottom: 6 }}>
                {faqDocs?.[i]?.q ? <InlineText canon={faqDocs[i].q.canon} links={faqDocs[i].q.links} onOpenLink={onOpenLink} /> : noEm(f.question)}
              </div>
              <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body-2)' }}>
                {faqDocs?.[i]?.a ? <InlineText canon={faqDocs[i].a.canon} links={faqDocs[i].a.links} onOpenLink={onOpenLink} /> : noEm(f.answer)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarginaliaComposer({ open, onClose, noteText, setNoteText, onSaveNote, onSaveLink, selfId }) {
  const [mode, setMode] = useState('note');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [target, setTarget] = useState(null);
  const [desc, setDesc] = useState('');
  useEffect(() => {
    if (mode !== 'link' || !q.trim()) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(() => searchCodex(q.trim()).then((r) => alive && setResults([...r.rules, ...r.cards].filter((x) => x.id !== selfId).slice(0, 8))), 150);
    return () => { alive = false; clearTimeout(t); };
  }, [q, mode, selfId]);
  // reset when closed
  useEffect(() => { if (!open) { setMode('note'); setQ(''); setTarget(null); setDesc(''); } }, [open]);

  return (
    <BottomSheet open={open} title="MARGINALIA" onClose={onClose}>
      <ChipRow style={{ marginBottom: 14 }}>
        <Chip label="Note" active={mode === 'note'} onClick={() => setMode('note')} />
        <Chip label="Link" active={mode === 'link'} onClick={() => setMode('link')} />
      </ChipRow>

      {mode === 'note' ? (
        <>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} autoFocus
            placeholder="Write a note, ruling, or reminder…"
            style={{ width: '100%', height: 108, resize: 'none', background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: 12, color: 'var(--ink-body)', font: "400 15px/1.5 var(--f-read)" }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={onSaveNote} style={btnGold}>Save note</button>
          </div>
        </>
      ) : (
        <>
          {target ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--hair-22)', marginBottom: 10 }}>
              <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, font: "600 14px/1 var(--f-read)", color: 'var(--link-violet)' }}><IcoLink />{target.name}</span>
              <IconButton glyph="✕" tone="muted" size={22} onClick={() => setTarget(null)} />
            </div>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search a card or rule to link…"
                style={{ width: '100%', height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)", marginBottom: 8 }} />
              <div style={{ maxHeight: 180, overflowY: 'auto' }} className="cx-scroll">
                {results.map((r) => (
                  <div key={r.kind + r.id} onClick={() => { setTarget(r); setQ(''); }} className="cx-row" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
                    <span style={{ color: 'var(--gold)', width: 16, display: 'flex', justifyContent: 'center' }}><CodexTypeIcon kind={r.kind} size={14} /></span>
                    <span style={{ flex: 1, font: "500 14px/1 var(--f-read)", color: 'var(--ink-body)' }}>{r.name}</span>
                    <span style={{ font: "500 10px/1 var(--f-ui)", color: 'var(--ink-faint)' }}>{r.meta}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {target && (
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Why are they linked? (optional)"
              style={{ width: '100%', height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 14px/1 var(--f-read)", marginBottom: 4 }} />
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={() => target && onSaveLink(target, desc.trim())} style={{ ...btnGold, opacity: target ? 1 : 0.5 }}>Save link</button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

// Add this card to one of your decks, right from its Codex page. Steppers
// write to the card's home zone (Atlas for sites, Spellbook otherwise) via the
// same changeQty machinery as the deckbuilder - rarity/zone limits included.
function AddToDeckSheet({ open, card, onClose }) {
  const [decks, setDecks] = useState(null);
  const [qtys, setQtys] = useState({});          // deckId → qty in home zone
  const [msg, setMsg] = useState('');
  const zone = card.is_site ? 'atlas' : 'spellbook';
  const zoneLabel = card.is_site ? 'Atlas' : 'Spellbook';

  useEffect(() => {
    if (!open) { setMsg(''); return; }
    let alive = true;
    (async () => {
      const ds = await listDecks();
      const q = {};
      for (const d of ds) q[d.id] = await deckQty(d.id, zone, card.card_id);
      if (alive) { setDecks(ds); setQtys(q); }
    })();
    return () => { alive = false; };
    /* eslint-disable-next-line */
  }, [open]);

  async function step(deck, delta) {
    const prev = qtys[deck.id] || 0;
    if (prev + delta < 0) return;
    const res = await changeQty(deck.id, zone, card, delta);
    if (!res.ok) { setMsg(res.reason || 'Not allowed'); return; }
    setMsg('');
    setQtys((m) => ({ ...m, [deck.id]: prev + delta }));
  }

  return (
    <BottomSheet open={open} title={`ADD TO A DECK · ${zoneLabel.toUpperCase()}`} onClose={onClose}>
      {decks == null ? <Loading />
        : decks.length === 0 ? (
          <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', padding: '8px 0' }}>
            No decks yet - build one in Decks first.
          </div>
        ) : (
          <>
            {msg && <div style={{ font: "500 12.5px/1.4 var(--f-read)", color: 'var(--destructive)', marginBottom: 10 }}>{msg}</div>}
            {decks.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', borderBottom: '1px solid var(--hair-12)' }}>
                <span style={{ flex: 1, minWidth: 0, font: "600 15px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                <IconButton glyph="−" tone="muted" size={28} onClick={() => step(d, -1)} />
                <span style={{ font: "700 15px/1 var(--f-mono)", color: (qtys[d.id] || 0) > 0 ? 'var(--gold-leaf)' : 'var(--ink-faint)', minWidth: 20, textAlign: 'center' }}>{qtys[d.id] || 0}</span>
                <IconButton glyph="+" size={28} onClick={() => step(d, 1)} />
              </div>
            ))}
          </>
        )}
    </BottomSheet>
  );
}

function CollectionPicker({ open, targetType, targetId, onClose }) {
  const [cols, setCols] = useState([]);
  const [name, setName] = useState('');
  async function refresh() { if (open) setCols(await collectionsForTarget(targetId)); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [open]);
  async function create() {
    if (!name.trim()) return;
    const cid = await createCollection(name.trim());
    await toggleCollectionItem(cid, targetType, targetId);
    setName(''); refresh();
  }
  return (
    <BottomSheet open={open} title="ADD TO COLLECTION" onClose={onClose}>
      {cols.length === 0 && <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', marginBottom: 12 }}>No collections yet - name one below.</div>}
      {cols.map((c) => (
        <div key={c.id} onClick={async () => { await toggleCollectionItem(c.id, targetType, targetId); refresh(); }}
          className="cx-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
          <span style={{ font: "600 15px/1 var(--f-read)", color: 'var(--ink-body)' }}>{c.name}</span>
          <span style={{ width: 22, height: 22, borderRadius: 6, border: '1px solid var(--hair-40)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1410', background: c.inIt ? 'var(--gold-leaf)' : 'transparent', fontSize: 13 }}>{c.inIt ? '✓' : ''}</span>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection…"
          style={{ flex: 1, height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" }} />
        <button onClick={create} style={btnGold}>Add</button>
      </div>
    </BottomSheet>
  );
}

const Dot = () => <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(201,163,90,.5)' }} />;
const btnGold = BTN_GOLD;
const btnGhost = { ...BTN_GHOST, flex: 1 };
