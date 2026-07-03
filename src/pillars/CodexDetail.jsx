// Codex detail — rule (drop-cap reading + related + sub-entries) or card
// (art hero, stat boxes, rules, FAQs), plus the per-profile personal layer:
// save/star, marginalia notes, highlights, collections.
import React, { useEffect, useState, useRef } from 'react';
import {
  getCard, getRule, relatedFor, mentions, faqsForCard, resolveByName,
  isSaved, toggleSaved, notesFor, addNote, deleteNote,
  highlightsFor, addHighlight, deleteHighlight,
  listCollections, createCollection, collectionsForTarget, toggleCollectionItem,
  linksFor, addLink, deleteLink, searchCodex,
} from '../store/codexRepository.js';
import { decksWithCard, listDecks, deckQty, changeQty } from '../store/deckRepository.js';
import { query } from '../store/db.js';
import { thresholdRuns } from '../store/cardArt.js';
import { formatArticle } from '../store/articleFormat.js';
import { Chip, ChipRow, IconButton, SectionLabel, ThresholdPips, BottomSheet, Article, inlineNodes, Loading, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import CardArt from '../components/CardArt.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';

const jp = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

export default function CodexDetail({ kind, id, onOpenName, onOpenDeck, onChanged }) {
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
      const [appearsIn, faqs, notes, highlights, saved, links, inDecks] = await Promise.all([
        relatedFor('card', id, c.name), faqsForCard(id), notesFor(id), highlightsFor(id), isSaved(id), linksFor(id), decksWithCard(id),
      ]);
      setData({ kind, card: c, appearsIn, faqs, notes, highlights, saved, links, inDecks });
    } else {
      const r = await getRule(id);
      if (!r) return setData({ missing: true });
      const [ment, subs, notes, highlights, saved, links] = await Promise.all([
        mentions(id), query('SELECT rule_id id, title, content FROM rules WHERE parent_id=?;', [id]),
        notesFor(id), highlightsFor(id), isSaved(id), linksFor(id),
      ]);
      setData({ kind, rule: r, mentions: ment, subs, notes, highlights, saved, links });
    }
  }
  useEffect(() => { setData(null); load(); /* eslint-disable-next-line */ }, [kind, id]);

  if (!data) return <Loading />;
  if (data.missing) return <div style={{ padding: 24, color: 'var(--ink-faint)', fontStyle: 'italic' }}>This entry isn’t in the catalog.</div>;

  const targetType = kind;
  async function onStar() { await toggleSaved(targetType, id); await load(); onChanged?.(); }
  async function saveNote() {
    if (!noteText.trim()) return;
    await addNote(targetType, id, noteText.trim());
    setNoteText(''); setComposer(false); await load(); onChanged?.();
  }
  async function delNote(nid) { await deleteNote(nid); await load(); onChanged?.(); }
  async function saveLink(target, desc) {
    await addLink(targetType, id, target.kind, target.id, desc);
    setComposer(false); await load(); onChanged?.();
  }
  async function delLink(lid) { await deleteLink(lid); await load(); onChanged?.(); }
  async function captureHighlight() {
    const t = selection.trim();
    if (!t) return;
    await addHighlight(targetType, id, t, '');
    setSelection(''); window.getSelection()?.removeAllRanges(); await load();
  }
  function onSelect() {
    const s = window.getSelection?.();
    const t = s && !s.isCollapsed ? s.toString() : '';
    if (t && bodyRef.current && s.anchorNode && bodyRef.current.contains(s.anchorNode)) setSelection(t);
    else setSelection('');
  }
  const marks = (data.highlights || []).map((h) => h.text).filter(Boolean);
  const hue = kind === 'card' ? 'violet' : 'gold';           // card highlights purple, rule gold
  const appearsIn = kind === 'card' ? (data.appearsIn || []).filter((r) => r.type !== 'unresolved_article') : [];
  const ment = data.mentions || { cards: [], articles: [] };

  return (
    <div style={{ padding: '18px 22px 30px', animation: 'cxfade .2s ease' }}>
      {kind === 'card' ? <CardBody card={data.card} faqs={data.faqs} onOpenName={onOpenName} bodyRef={bodyRef} onSelect={onSelect} marks={marks} />
                       : <RuleBody rule={data.rule} subs={data.subs} onOpenName={onOpenName} bodyRef={bodyRef} onSelect={onSelect} marks={marks} />}

      {/* Cards Mentioned — carousel of card art referenced by this article. */}
      {kind === 'rule' && ment.cards.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel label="CARDS MENTIONED" count={ment.cards.length} />
          <div className="cx-mention-rail">
            {ment.cards.map((c) => (
              <div key={c.card_id} className="cx-mention-card" onClick={() => onOpenName(c.name)}>
                <CardArt card={c} radius={9} />
                <div className="cx-mention-name">{c.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related articles — pills that link to other articles. */}
      {kind === 'rule' && ment.articles.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel label="RELATED ARTICLES" count={ment.articles.length} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ment.articles.map((a) => (
              <span key={a.id} onClick={() => onOpenName(a.title)} className="cx-relpill">{a.title}</span>
            ))}
          </div>
        </div>
      )}

      {/* Card: the articles that cite it, as pills. */}
      {kind === 'card' && appearsIn.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionLabel label="MENTIONED IN" count={appearsIn.length} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {appearsIn.map((r, i) => <span key={i} onClick={() => onOpenName(r.name)} className="cx-relpill">{r.name}</span>)}
          </div>
        </div>
      )}

      {/* in your decks — the unification payoff: this card in the profile's decks */}
      {kind === 'card' && data.inDecks.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <SectionLabel glyph="◈" label="IN YOUR DECKS" count={data.inDecks.length} />
          {data.inDecks.map((d, i) => (
            <div key={d.id + d.zone} onClick={() => onOpenDeck?.(d.id, d.name)} className="cx-row"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', borderBottom: i < data.inDecks.length - 1 ? '1px solid var(--hair-12)' : 'none', cursor: 'pointer' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-violet)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0, font: "600 14.5px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              <span style={{ font: "500 11px/1 var(--f-ui)", color: 'var(--ink-muted)' }}>{d.zone === 'avatar' ? 'Avatar' : `${d.zone.charAt(0).toUpperCase() + d.zone.slice(1)} · ${d.quantity}×`}</span>
              <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>›</span>
            </div>
          ))}
        </div>
      )}

      {/* highlights — hued by target: card = violet (deck-builder link), rule = gold */}
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
          <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)' }}>⚜ YOUR MARGINALIA</span>
          <IconButton glyph="+" onClick={() => setComposer(true)} title="Add a note or link" />
        </div>
        {data.notes.length === 0 && data.links.length === 0 && (
          <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', padding: '6px 0 4px' }}>No marginalia yet. Tap ＋ to add a note or link.</div>
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
              <div onClick={() => onOpenName(l.otherName)} style={{ font: "600 14px/1.3 var(--f-read)", color: 'var(--link-violet)', cursor: 'pointer' }}>↔ {l.otherName}</div>
              {l.description && <div style={{ font: "400 12.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', fontStyle: 'italic', marginTop: 3 }}>{l.description}</div>}
            </div>
            <IconButton glyph="✕" tone="danger" size={22} onClick={() => delLink(l.id)} />
          </div>
        ))}
      </div>

      {/* selection -> highlight action */}
      {selection && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 88, display: 'flex', justifyContent: 'center', zIndex: 24 }}>
          <button onClick={captureHighlight} style={{ padding: '10px 18px', borderRadius: 22, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 13px/1 var(--f-ui)", border: 'none', cursor: 'pointer', boxShadow: '0 8px 22px -8px rgba(0,0,0,.6)' }}>＋ Highlight selection</button>
        </div>
      )}

      <MarginaliaComposer open={composer} onClose={() => setComposer(false)}
        noteText={noteText} setNoteText={setNoteText} onSaveNote={saveNote} onSaveLink={saveLink} selfId={id} />
      <CollectionPicker open={picker} targetType={targetType} targetId={id} onClose={() => { setPicker(false); load(); }} />
      {kind === 'card' && !data.card.is_avatar && (
        <AddToDeckSheet open={deckAdd} card={data.card} onClose={() => { setDeckAdd(false); load(); onChanged?.(); }} />
      )}

      {/* Save / Collect / Add-to-deck live in a FAB (consistent app-wide), not inline buttons. */}
      <Fab variant="deck" icon={<FabGlyph kind="dots" />} label="Entry options" items={[
        { label: data.saved ? 'Saved' : 'Save', keepOpen: true, state: data.saved ? '★' : '☆', onClick: onStar },
        { label: 'Collect', onClick: () => setPicker(true) },
        ...(kind === 'card' && !data.card.is_avatar ? [{ label: 'Add to a deck', onClick: () => setDeckAdd(true) }] : []),
      ]} />
    </div>
  );
}

function RuleBody({ rule, subs, onOpenName, bodyRef, onSelect, marks }) {
  return (
    <div ref={bodyRef} onMouseUp={onSelect} onTouchEnd={onSelect}>
      <Article blocks={formatArticle(rule.content)} onOpenName={onOpenName} lead hue="gold" marks={marks} />
      {subs.map((s) => (
        <div key={s.id} style={{ marginTop: 16 }}>
          <SectionLabel label={s.title.toUpperCase()} />
          <Article blocks={formatArticle(s.content)} onOpenName={onOpenName} hue="gold" marks={marks} />
        </div>
      ))}
    </div>
  );
}

function CardBody({ card, faqs, onOpenName, bodyRef, onSelect, marks }) {
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
          // Sites play sideways — show the art rotated 90° in a landscape footprint (deck-builder parity).
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
        <div ref={bodyRef} onMouseUp={onSelect} onTouchEnd={onSelect}
          style={{ border: '1px solid var(--hair-16)', borderRadius: 12, background: 'var(--surface-card)', padding: 14, marginBottom: 14 }}>
          {String(card.rules_text).split(/\r?\n/).filter(Boolean).map((line, i) => (
            <p key={i} style={{ margin: i ? '8px 0 0' : 0, font: "400 15.5px/1.5 var(--f-read)", color: 'var(--ink-body-2)' }}>{inlineNodes(line, onOpenName, 'violet', marks)}</p>
          ))}
        </div>
      )}

      {sets.length > 0 && (
        <div style={{ font: "500 11px/1.4 var(--f-ui)", color: 'var(--ink-faint)', marginBottom: 14 }}>
          Sets: {sets.map((s) => s.name).join(', ')}
        </div>
      )}

      {faqs.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <SectionLabel glyph="§" label="OFFICIAL FAQ" count={faqs.length} />
          {faqs.map((f, i) => (
            <div key={i} style={{ border: '1px solid var(--hair-14)', borderRadius: 12, background: 'var(--surface-card)', padding: '12px 13px', marginBottom: 8 }}>
              <div style={{ font: "600 13.5px/1.4 var(--f-read)", color: 'var(--ink-head)', marginBottom: 6 }}>{f.question}</div>
              <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body-2)' }}>{f.answer}</div>
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
              <span style={{ flex: 1, font: "600 14px/1 var(--f-read)", color: 'var(--link-violet)' }}>↔ {target.name}</span>
              <IconButton glyph="✕" tone="muted" size={22} onClick={() => setTarget(null)} />
            </div>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search a card or rule to link…"
                style={{ width: '100%', height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)", marginBottom: 8 }} />
              <div style={{ maxHeight: 180, overflowY: 'auto' }} className="cx-scroll">
                {results.map((r) => (
                  <div key={r.kind + r.id} onClick={() => { setTarget(r); setQ(''); }} className="cx-row" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
                    <span style={{ color: 'var(--gold)', width: 16, textAlign: 'center' }}>{r.kind === 'card' ? '◈' : '§'}</span>
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
// same changeQty machinery as the deckbuilder — rarity/zone limits included.
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
            No decks yet — build one in Decks first.
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
      {cols.length === 0 && <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', marginBottom: 12 }}>No collections yet — name one below.</div>}
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
