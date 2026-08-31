// Codex detail - rule (drop-cap reading + related + sub-entries) or card
// (art hero, stat boxes, rules, FAQs), plus the per-profile personal layer:
// save/star, marginalia notes, folios.
import React, { useEffect, useState, useRef } from 'react';
import {
  getCard, getRule, relatedFor, mentions, faqsForCard,
  notesFor, addNote, deleteNote,
  linksFor, addLink, deleteLink, searchCodex,
} from '../store/codexRepository.js';
import { decksWithCard, listDecks, deckQty, changeQty } from '../store/deckRepository.js';
import { qtyFor } from '../store/ownedRepository.js';
import { query } from '../store/db.js';
import { thresholdRuns } from '../store/cardArt.js';
import { SET_RANK } from '../store/sets.js';
import { getDoc, getDocs, getFaqs } from '../store/codexDoc.js';
import { Chip, ChipRow, IconButton, SectionLabel, ThresholdPips, BottomSheet, RuleArticle, InlineText, Loading, SegTabs, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import CardArt from '../components/CardArt.jsx';
import CollectionCardSheet from '../components/CollectionCardSheet.jsx';
import FolioPicker from '../components/FolioPicker.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import SearchPill from '../components/SearchPill.jsx';
import { cardStorageSummary } from '../store/storageDirectory.js';
import { UNFILED_NAME } from '../store/storageVocabulary.js';

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
// Never render an em dash, even from reference data - swap for a spaced hyphen.
const noEm = (s) => String(s || '').replace(/\s*—\s*/g, ' - ');

// Small inline SVG icons - no Unicode glyphs anywhere in the Codex detail.
const IcoLink = ({ size = 13 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', verticalAlign: '-1px' }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
const IcoPlus = ({ size = 13 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ flex: 'none', verticalAlign: '-2px' }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
// Quiet marginalia remove - a muted ✕ with a generous invisible hit box; reads
// as incidental chrome, not a danger action (deletion is immediate by design).
const MargRemove = ({ onClick }) => (
  <button onClick={onClick} title="Remove"
    style={{ flex: 'none', width: 32, height: 32, marginTop: -3, marginRight: -6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: '#5c554b', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
  </button>
);
const CodexTypeIcon = ({ kind, size = 14 }) => kind === 'card'
  ? <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /></svg>
  : <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><polyline points="14 4 14 9 19 9" /></svg>;

// One read-only ledger row for "In Your Compendium": a left label, a right
// value/summary (children), and a quiet chevron when tappable. Flat, hairline-
// separated - no boxes.
const LedgerRow = ({ label, onClick, children }) => (
  <div onClick={onClick} className={onClick ? 'cx-row' : undefined}
    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 0', borderBottom: '1px solid rgba(74,60,34,.3)', cursor: onClick ? 'pointer' : 'default' }}>
    <span style={{ flex: 'none', font: "400 16px/1.2 var(--f-read)", color: '#d8cebb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '58%' }}>{label}</span>
    <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, textAlign: 'right' }}>{children}</span>
    {onClick && <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#5c554b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><polyline points="9 18 15 12 9 6" /></svg>}
  </div>
);

// The Collection summary shown on the ledger's Collection row: gold counts with
// EB Garamond labels ("3 owned · ✦ 1 foil"), or a dimmed "not owned" note.
const CollectionSummary = ({ qty }) => {
  const owned = qty?.owned || 0, foil = qty?.foil || 0;
  if (owned === 0 && foil === 0) return <span style={{ font: "400 14.5px/1.4 var(--f-read)", color: '#5c554b' }}>Not in your collection</span>;
  const num = (n) => <span style={{ font: "600 15px/1 var(--f-display)", color: '#e3c589' }}>{n}</span>;
  const lab = (t) => <span style={{ font: "400 14.5px/1.4 var(--f-read)", color: '#8a8175', marginLeft: 4 }}>{t}</span>;
  const dot = (k) => <span key={k} style={{ color: '#5c554b', margin: '0 7px' }}>·</span>;
  const parts = [];
  if (owned > 0) parts.push(<span key="o">{num(owned)}{lab('owned')}</span>);
  if (foil > 0) parts.push(<span key="f"><span style={{ color: '#e3c589', marginRight: 3 }}>✦</span>{num(foil)}{lab('foil')}</span>);
  return <>{parts.flatMap((p, i) => (i === 0 ? [p] : [dot('d' + i), p]))}</>;
};

const StorageSummary = ({ places = [] }) => {
  if (!places.length) return <span style={{ font: "400 14.5px/1.4 var(--f-read)", color: '#5c554b' }}>No owned copies</span>;
  return (
    <span style={{ font: "400 13.5px/1.4 var(--f-read)", color: '#8a8175', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {places.map((p) => `${p.name || UNFILED_NAME} ${p.qty}`).join(' · ')}
    </span>
  );
};

export default function CodexDetail({ kind, id, target, onOpen, onOpenName, onOpenDeck, onChanged }) {
  const [data, setData] = useState(null);
  const [composer, setComposer] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [picker, setPicker] = useState(false);
  const [deckAdd, setDeckAdd] = useState(false);
  const [sheetCard, setSheetCard] = useState(null);    // the card's Collection ownership sheet
  const scrolledRef = useRef(null);                    // deep-link: scroll to a target block once per navigation

  async function load() {
    if (kind === 'card') {
      const c = await getCard(id);
      if (!c) return setData({ missing: true });
      const [doc, appearsIn, faqs, notes, links, inDecks, qty, storage] = await Promise.all([
        getDoc('card', id), relatedFor('card', id, c.name), faqsForCard(id), notesFor(id), linksFor(id), decksWithCard(id), qtyFor(id), cardStorageSummary(id),
      ]);
      const faqDocs = await getFaqs(faqs.map((f) => f.faq_id));
      setData({ kind, card: c, doc, appearsIn, faqs, faqDocs, notes, links, inDecks, qty, storage });
    } else {
      const r = await getRule(id);
      if (!r) return setData({ missing: true });
      const [doc, ment, subs, notes, links] = await Promise.all([
        getDoc('rule', id), mentions(id), query('SELECT rule_id id, title FROM rules WHERE parent_id=?;', [id]),
        notesFor(id), linksFor(id),
      ]);
      const subDocs = await getDocs(subs.map((s) => ['rule', s.id]));
      setData({ kind, rule: r, doc, mentions: ment, subs, subDocs, notes, links });
    }
  }
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line */ }, [kind, id]);

  // Every article opens at the TOP - a related-article tap from a scrolled position
  // must not land you mid-page (you'd have to scroll up to see the header). A
  // deep-link target (below) scrolls itself, so skip when one is present. Keyed on
  // [kind,id] only, so re-renders from note edits never yank the scroll.
  useEffect(() => {
    if (target) return;
    const sc = document.querySelector('.cx-scroll');
    if (sc) sc.scrollTop = 0; else window.scrollTo(0, 0);
    /* eslint-disable-next-line */
  }, [kind, id]);

  // Deep link: scroll to a target block (bookmark jump / cross-ref to a section)
  // with a brief flash. Gated on `data` so it fires only once the blocks have
  // rendered AND the render is stable (an earlier imperative flash got wiped by the
  // async load's re-render). Guarded to run once per (kind,id,target) navigation.
  useEffect(() => {
    const key = `${kind}:${id}:${target || ''}`;
    if (!target || !data || data.missing || scrolledRef.current === key) return;
    const el = document.querySelector(`[data-block-id="${CSS.escape(target)}"]`);
    if (!el) return;
    scrolledRef.current = key;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('cx-block-flash');
    const t = setTimeout(() => el.classList.remove('cx-block-flash'), 1700);
    return () => clearTimeout(t);
  }, [kind, id, target, data]);

  if (!data) return <Loading />;
  if (data.missing) return <div style={{ padding: 24, color: 'var(--ink-faint)', fontStyle: 'italic' }}>This entry isn’t in the catalog.</div>;

  // Render + all writes key off the LOADED entry (data), never the raw props -
  // the props (kind/id) update a tick before the effect reloads data, so mixing
  // them is what caused the stale-kind crash. data.kind + the entry's own id are
  // always mutually consistent.
  const k = data.kind;
  const targetType = k;
  const entryId = k === 'card' ? data.card.card_id : data.rule.rule_id;
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
    // The shared page/section transition (tokens.css .cx-surface-enter), KEYED on the entry
    // so following a link from one Codex entry to the next replays it - the body swaps under
    // a header that stays put, which is the same surface-swap this app does everywhere else.
    <div key={`${k}:${id}`} className="cx-surface-enter" style={{ padding: '18px 22px 30px' }}>
      {k === 'card' ? <CardBody key={data.card.card_id} card={data.card} doc={data.doc} faqs={data.faqs} faqDocs={data.faqDocs} onOpenLink={openLink} />
                    : <RuleBody doc={data.doc} subs={data.subs} subDocs={data.subDocs} onOpenLink={openLink} />}

      {/* Cards Mentioned - carousel of card art referenced by this article. Opens
          by (kind, id) directly - no fragile name resolution. */}
      {k === 'rule' && ment.cards.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel label="CARDS MENTIONED" count={ment.cards.length} />
          <div className="cx-mention-rail">
            {ment.cards.map((c) => (
              <div key={c.card_id} className="cx-mention-card" onClick={() => onOpen('card', c.card_id, c.name)}>
                <span className="cx-mention-frame"><CardArt card={c} radius={10} aspect="5/7" /></span>
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

      {/* Marginalia - hand-annotations in the margin, not a boxed panel: a gold
          rubric with the frosted-rose add control, then borderless entries each
          led by a coloured vertical rule (gold = your note, violet = a card link). */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.22em', color: '#cba75f', whiteSpace: 'nowrap' }}>YOUR MARGINALIA</span>
          <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#4a3c22,transparent)' }} />
          <button onClick={() => setComposer(true)} title="Add a note or link"
            style={{ flex: 'none', width: 44, height: 44, marginRight: -7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
            <span style={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(224,169,177,.09)', border: '1px solid rgba(224,169,177,.28)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: '#f0c8ce' }}><IcoPlus size={14} /></span>
          </button>
        </div>
        {data.notes.length === 0 && data.links.length === 0 && (
          <div style={{ font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '2px 0 2px 13px' }}>No marginalia yet - add a note or link.</div>
        )}
        {data.notes.map((n) => (
          <div key={n.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '2px 0 2px 13px', borderLeft: '2px solid #cba75f', marginBottom: 14 }}>
            <div style={{ flex: 1, font: "400 16px/1.5 var(--f-read)", color: '#d8cebb', fontStyle: 'italic' }}>{n.body}</div>
            <MargRemove onClick={() => delNote(n.id)} />
          </div>
        ))}
        {data.links.map((l) => (
          <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '2px 0 2px 13px', borderLeft: '2px solid #a08cc0', marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div onClick={() => onOpenName(l.otherName)} style={{ display: 'flex', alignItems: 'center', gap: 6, font: "600 16px/1.3 var(--f-read)", color: '#c9a8e8', cursor: 'pointer' }}><IcoLink />{l.otherName}</div>
              {l.description && <div style={{ font: "400 13.5px/1.4 var(--f-read)", color: '#8a8175', fontStyle: 'italic', marginTop: 3 }}>{l.description}</div>}
            </div>
            <MargRemove onClick={() => delLink(l.id)} />
          </div>
        ))}
      </div>

      {/* In Your Compendium - the profile-layer ledger (read-only): where this card
          sits in your Collection and decks. Ownership is EDITED in the tapped
          Collection sheet, never here (this is the knowledge base). */}
      {k === 'card' && (
        <div style={{ marginTop: 24 }}>
          <SectionLabel label="IN YOUR COMPENDIUM" />
          <LedgerRow label="Collection" onClick={() => setSheetCard(data.card.card_id)}>
            <CollectionSummary qty={data.qty} />
          </LedgerRow>
          <LedgerRow label="Storage">
            <StorageSummary places={data.storage} />
          </LedgerRow>
          {data.inDecks.length > 0 ? data.inDecks.map((d) => (
            <LedgerRow key={d.id + d.zone} label={d.name} onClick={() => onOpenDeck?.(d.id, d.name)}>
              <span style={{ font: "600 15px/1 var(--f-display)", color: '#e3c589' }}>{d.zone === 'avatar' ? 'Avatar' : `${d.quantity}×`}</span>
            </LedgerRow>
          )) : (
            <LedgerRow label="Decks">
              <span style={{ font: "400 14.5px/1.4 var(--f-read)", color: '#5c554b' }}>In no decks</span>
            </LedgerRow>
          )}
        </div>
      )}

      <MarginaliaComposer open={composer} onClose={() => setComposer(false)}
        noteText={noteText} setNoteText={setNoteText} onSaveNote={saveNote} onSaveLink={saveLink} selfId={entryId} />
      <FolioPicker open={picker} targetType={targetType} targetId={entryId} onClose={() => { setPicker(false); load(); }} />
      {/* The card's ownership sheet (owned / foil / wishlist steppers) - the one
          place counts are edited; reloads the ledger summary on close. */}
      <CollectionCardSheet cardId={sheetCard} onClose={() => { setSheetCard(null); load(); }} />
      {k === 'card' && !data.card.is_avatar && (
        <AddToDeckSheet open={deckAdd} card={data.card} onClose={() => { setDeckAdd(false); load(); onChanged?.(); }} />
      )}

      {/* Bookmarking lives in the header ribbon toggle. Add to Folio / Add-to-deck
          live in a FAB (consistent app-wide), not inline buttons. */}
      <Fab variant="deck" icon={<FabGlyph kind="dots" />} label="Entry options" items={[
        { label: 'Add to Folio', onClick: () => setPicker(true) },
        ...(k === 'card' && !data.card.is_avatar ? [{ label: 'Add to a deck', onClick: () => setDeckAdd(true) }] : []),
      ]} />
    </div>
  );
}

function RuleBody({ doc, subs, subDocs, onOpenLink }) {
  return (
    <div className="cx-selectable">
      {/* Codex eyebrow - violet caps trailed by a fade hairline, marking the
          article as a codex entry (the header above is shared with card detail). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px' }}>
        <span style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.2em', color: '#a08cc0', whiteSpace: 'nowrap' }}>CODEX ARTICLE</span>
        <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(160,140,192,.45),transparent)' }} />
      </div>
      <RuleArticle doc={doc} onOpenLink={onOpenLink} />
      {subs.map((s, i) => (
        <div key={s.id}>
          <div className="cx-article-h">{s.title.toUpperCase()}</div>
          <RuleArticle doc={subDocs[i]} onOpenLink={onOpenLink} />
        </div>
      ))}
    </div>
  );
}

// A printing base is a variant slug minus its finish token (-s/-f/-rf); each base
// is one distinct art. Set display order (SET_RANK) is the shared catalog table.
const printingBase = (slug) => String(slug).replace(/-(s|f|rf)$/, '');

// The card's distinct PRINTINGS (one per art), each with its own image, set and
// artist. Cards reprinted across sets (40% of the catalog) get an art switcher;
// single-printing cards get none. Duplicate set labels (token cards with several
// printings in one set) are numbered so every segment is distinct.
function cardPrintings(variants) {
  const seen = new Set();
  const out = [];
  for (const v of variants) {
    const base = printingBase(v.slug);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ base, setName: v.setName || '', setCode: v.set || '', image: v.image ?? null, artist: v.artist || null });
  }
  out.sort((a, b) => (SET_RANK[a.setCode] ?? 4.5) - (SET_RANK[b.setCode] ?? 4.5) || a.base.localeCompare(b.base));
  const counts = {};
  for (const p of out) counts[p.setName] = (counts[p.setName] || 0) + 1;
  const nth = {};
  for (const p of out) {
    if (counts[p.setName] > 1) { nth[p.setName] = (nth[p.setName] || 0) + 1; p.label = `${p.setName} ${nth[p.setName]}`; }
    else p.label = p.setName || 'Printing';
  }
  return out;
}

function CardBody({ card, doc, faqs, faqDocs, onOpenLink }) {
  const sets = jp(card.sets, []);
  const variants = jp(card.variants, []);
  const printings = cardPrintings(variants);
  // Default to the card's own default art (planImages picks the lowest-set standard).
  const defIdx = Math.max(0, printings.findIndex((p) => p.image && p.image === card.image_slug));
  const [sel, setSel] = useState(defIdx);
  const cur = printings[sel] || printings[0] || null;
  // Drive the hero art from the selected printing. A no-scan printing (image null)
  // resolves to the deterministic fallback, exactly like any imageless card.
  const artCard = cur && cur.image !== card.image_slug ? { ...card, image_slug: cur.image } : card;
  const selBase = cur?.base;
  const flavour = noEm(
    (variants.find((v) => selBase && printingBase(v.slug) === selBase && v.flavorText)?.flavorText)
    || (variants.find((v) => v && v.flavorText)?.flavorText) || '');
  const pips = thresholdRuns(card);
  const isMinion = /minion/i.test(card.type || '');
  const typeText = card.is_site ? 'Site' : card.is_avatar ? 'Avatar' : (card.type || 'Card');

  // Meta line: type (violet) · rarity (canonical rarity token) · sets (#c9b487),
  // hairline-separated, centered, wrapping. No subtype/pills - the art carries them.
  const rarityToken = card.rarity ? `var(--${card.rarity.toLowerCase()}, var(--ink-muted))` : null;
  const meta = [];
  meta.push(<span key="ty" style={{ font: "500 11px/1 var(--f-display)", letterSpacing: '.16em', textTransform: 'uppercase', color: '#a08cc0' }}>{typeText}</span>);
  if (card.rarity) meta.push(<span key="r" style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.08em', textTransform: 'uppercase', color: rarityToken }}>{card.rarity}</span>);
  if (sets.length) meta.push(<span key="s" style={{ font: "500 11px/1 var(--f-display)", letterSpacing: '.08em', textTransform: 'uppercase', color: '#c9b487' }}>{sets.map((s) => s.name).join(' · ')}</span>);
  const metaRow = meta.flatMap((n, i) => (i === 0 ? [n] : [<span key={`h${i}`} aria-hidden="true" style={{ width: 1, height: 12, background: 'rgba(107,90,46,.6)', flex: 'none' }} />, n]));

  // Stats as open columns (no boxes). POWER only for minions; LIFE where present
  // (avatars). THRESHOLD renders the PNG icons in the value slot.
  const stats = [];
  if (card.cost != null) stats.push(['MANA', card.cost]);
  if (pips.length) stats.push(['THRESHOLD', <ThresholdPips runs={pips} size={20} />]);
  if (isMinion && card.attack != null) stats.push(['POWER', card.attack === card.defence || card.defence == null ? card.attack : `${card.attack}/${card.defence}`]);
  if (card.is_avatar && card.life != null) stats.push(['LIFE', card.life]);   // life is avatar-only

  return (
    <div>
      {/* Card image - centered, no gilding (reference context). Sites play sideways.
          Art is the SELECTED printing; keyed on `sel` so a switch crossfades in. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: printings.length > 1 ? 14 : (cur?.artist ? 12 : 20) }}>
        {card.is_site ? (
          <div style={{ position: 'relative', width: 300, aspectRatio: '7 / 5' }}>
            <div key={sel} style={{ position: 'absolute', top: '50%', left: '50%', width: 'calc(300px * 5 / 7)', transform: 'translate(-50%,-50%) rotate(90deg)', borderRadius: 13, overflow: 'hidden', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 16px 40px rgba(0,0,0,.6)', animation: 'cxfade .25s ease' }}>
              <CardArt card={artCard} radius={13} />
            </div>
          </div>
        ) : (
          <div key={sel} style={{ width: 248, borderRadius: 13, overflow: 'hidden', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 16px 40px rgba(0,0,0,.6)', animation: 'cxfade .25s ease' }}>
            <CardArt card={artCard} radius={13} aspect="5/7" />
          </div>
        )}
      </div>

      {/* Printing switcher - one segment per printing; tapping flips the hero art
          and the artist credit. Scrolls sideways for cards with many printings. */}
      {printings.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <div style={{ maxWidth: '100%', overflowX: 'auto', padding: 1 }}>
            <SegTabs ariaLabel="Card printing"
              options={printings.map((p, i) => ({ key: String(i), label: p.label }))}
              value={String(sel)} onChange={(key) => setSel(Number(key))} />
          </div>
        </div>
      )}

      {/* Artist credit - shown for every card; follows the selected printing. */}
      {cur?.artist && (
        <div style={{ textAlign: 'center', marginBottom: 18, font: "italic 400 13px/1.4 var(--f-read)", color: '#8a8175' }}>
          Illustrated by {noEm(cur.artist)}
        </div>
      )}

      {metaRow.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>{metaRow}</div>
      )}

      {stats.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 56, marginBottom: 24 }}>
          {stats.map(([l, v], i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ font: "700 26px/1 var(--f-display)", color: '#e3c589', display: 'flex', alignItems: 'center', minHeight: 26 }}>{v}</span>
              <span style={{ font: "500 9.5px/1 var(--f-display)", letterSpacing: '.2em', color: '#8a8175' }}>{l}</span>
            </div>
          ))}
        </div>
      )}

      {card.rules_text && (
        <div style={{ maxWidth: 340, margin: '0 auto 18px', padding: 1, borderRadius: 15, background: 'linear-gradient(160deg, rgba(203,167,95,.7), rgba(203,167,95,.14) 45%, rgba(203,167,95,.5))', boxShadow: '0 10px 26px -14px rgba(0,0,0,.6)' }}>
          <div className="cx-cardrule cx-selectable" style={{ borderRadius: 14, background: '#0e0b08', padding: '18px 20px' }}>
            <RuleArticle doc={doc} onOpenLink={onOpenLink} />
          </div>
        </div>
      )}

      {flavour && (
        <div style={{ maxWidth: 340, margin: '0 auto', textAlign: 'center', font: "italic 400 15px/1.55 var(--f-read)", color: '#8a8175' }}>{flavour}</div>
      )}

      {faqs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionLabel label="OFFICIAL FAQ" count={faqs.length} />
          {faqs.map((f, i) => (
            <div key={i} style={{ padding: '14px 0', borderBottom: i < faqs.length - 1 ? '1px solid rgba(74,60,34,.3)' : 'none' }}>
              <div style={{ font: "600 15px/1.45 var(--f-read)", color: '#efe7d8', marginBottom: 6 }}>
                {faqDocs?.[i]?.q ? <InlineText canon={faqDocs[i].q.canon} links={faqDocs[i].q.links} onOpenLink={onOpenLink} /> : noEm(f.question)}
              </div>
              <div style={{ font: "400 15px/1.6 var(--f-read)", color: '#d8cebb' }}>
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
              <div style={{ marginBottom: 8 }}>
                <SearchPill inline autoFocus value={q} onChange={setQ} placeholder="Search a card or rule to link…" ariaLabel="Search a card or rule to link" />
              </div>
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

const btnGold = BTN_GOLD;
const btnGhost = { ...BTN_GHOST, flex: 1 };
