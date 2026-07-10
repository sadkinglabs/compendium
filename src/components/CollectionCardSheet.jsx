// The COLLECTION pillar's card-tap detail sheet. Three surfaces show a card and
// each has a distinct job: CardSheet.jsx is the deckbuilder's (deck-zone
// steppers - Spellbook/Atlas/Collection), CodexDetail.jsx is the full page
// (stats, rules, rulings, FAQ, notes), and THIS sheet is about OWNING the card:
// full card face beside Owned/Foil/Wishlist steppers over the owned_cards
// ledger, an add-to-list hand-off into the pillar's lists, and a link into the
// Codex. Deliberately calm - no rules text, no stat-chip grid; that all lives on
// the Codex page. Ruby stays chrome-only (stepper buttons); the content (art,
// name, counts, set capsules) stays gold/ink.
import React, { useEffect, useState } from 'react';
import { BottomSheet, Loading } from './ui.jsx';
import CardArt from './CardArt.jsx';
import { getCard } from '../store/codexRepository.js';
import { listCardLists, listsWithCard, stepListEntry } from '../store/ownedRepository.js';
import { useOwnedLedger } from './OwnedControl.jsx';
import { stepBtn } from './ownedUi.js';
import { haptic } from '../native.js';

const jp = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
const RARITY = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };

// The sheet's eyebrow reads WHAT the card is, Sorcery-style: minions, magics,
// auras and artifacts are all spells ("SPELL — MINION"); Sites and Avatars stand
// alone. Falls back to the raw type (or CARD) for anything unexpected.
function typeLabel(c) {
  if (c.is_site) return 'SITE';
  if (c.is_avatar) return 'AVATAR';
  const t = (c.type || '').trim();
  return /^(minion|magic|aura|artifact)$/i.test(t) ? `SPELL — ${t.toUpperCase()}` : (t.toUpperCase() || 'CARD');
}

// One ownership stepper row. The hook owns all writes AND the haptic on tap -
// this row only renders; do NOT add a second haptic/write here.
function LedgerRow({ label, field, qty, step }) {
  const v = qty?.[field] || 0;
  const loading = qty === null;                     // steppers inert until the real count is read
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <span style={{ flex: 1, minWidth: 0, font: "500 13.5px/1.2 var(--f-read)", color: 'var(--ink-muted)' }}>{label}</span>
      <button onClick={() => step(field, -1)} style={stepBtn} disabled={loading || v === 0} aria-label={`Decrease ${label}`}>−</button>
      <span style={{ minWidth: 22, textAlign: 'center', font: "700 16px/1 var(--f-mono)", color: v > 0 ? 'var(--ink-body)' : 'var(--ink-faint)' }}>{v}</span>
      <button onClick={() => step(field, 1)} style={stepBtn} disabled={loading} aria-label={`Increase ${label}`}>+</button>
    </div>
  );
}

// The add-to-list picker: the profile's lists (wanted = tracked goals first,
// then custom lists), each tappable - a tap adds ONE copy of the card and stays
// open, so "add it to three lists" (or "want two of it") is three taps, with the
// per-list count confirming each one.
function ListPicker({ cardId, onBack }) {
  const [lists, setLists] = useState(null);
  const [inLists, setInLists] = useState(new Map());  // list_id -> qty of THIS card
  useEffect(() => {
    let alive = true;
    Promise.all([listCardLists(), listsWithCard(cardId)]).then(([all, mine]) => {
      if (!alive) return;
      setLists(all);
      setInLists(new Map(mine.map((m) => [m.id, m.quantity])));
    });
    return () => { alive = false; };
  }, [cardId]);

  const add = async (list) => {
    haptic('light');
    setInLists((prev) => { const m = new Map(prev); m.set(list.id, (m.get(list.id) || 0) + 1); return m; });
    try { await stepListEntry(list.id, cardId, +1); } catch { /* refresh on next open */ }
  };

  const section = (title, items, hint) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-ruby)', margin: '2px 0 6px' }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: 'var(--ink-faint)', padding: '4px 0 2px' }}>{hint}</div>
      ) : items.map((l) => {
        const n = inLists.get(l.id) || 0;
        return (
          <button key={l.id} onClick={() => add(l)} style={{
            display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '12px 4px', textAlign: 'left',
            background: 'none', border: 'none', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer',
          }}>
            <span style={{ flex: 1, minWidth: 0, font: "600 14.5px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
            {n > 0 && (
              <span style={{ flex: 'none', font: "600 11px/1 var(--f-mono)", color: 'var(--accent-jade)', padding: '4px 7px', border: '1px solid var(--hair-12)', borderRadius: 999 }}>
                {l.kind === 'wanted' ? `want ${n}` : `× ${n}`}
              </span>
            )}
            <span style={{ flex: 'none', font: "600 15px/1 var(--f-ui)", color: 'var(--accent-ruby)' }}>+</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {lists == null ? <Loading /> : (
        <>
          {section('WANTED LISTS', lists.filter((l) => l.kind === 'wanted'), 'No wanted lists yet — create goals in Collection › Lists.')}
          {section('CARD LISTS', lists.filter((l) => l.kind === 'custom'), 'No card lists yet — create them in Collection › Lists.')}
        </>
      )}
      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: 'var(--ink-muted)', font: "600 13px/1 var(--f-ui)",
        padding: '12px 0 2px', width: '100%', textAlign: 'center', cursor: 'pointer',
      }}>‹ Back to card</button>
    </>
  );
}

// Inner body split out so useOwnedLedger only mounts once the card row exists
// (hooks can't sit behind the early returns above).
function SheetBody({ c, onOpenCodex }) {
  const { qty, step } = useOwnedLedger(c.card_id);
  const subs = jp(c.sub_types, []) || [];
  const sets = jp(c.sets, []) || [];
  const flavor = (jp(c.variants, []) || []).map((v) => v?.flavorText).filter(Boolean)[0];
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(118px, 40%) 1fr', gap: 16, alignItems: 'start' }}>
        {/* LEFT: the full card face - no illustration crop. Sites are stored
            portrait (a landscape card rotated), so counter-rotate the image
            inside the frame so it reads upright. */}
        <div>
          {c.is_site
            ? <div><CardArt card={c} radius={14} aspect="5/7" imgStyle={{ transform: 'rotate(90deg) scale(1.42)' }} /></div>
            : <CardArt card={c} radius={14} aspect="5/7" />}
          {c.rarity && (
            <div style={{
              marginTop: 8, textAlign: 'center', font: "600 10.5px/1 var(--f-display)",
              letterSpacing: '.12em', textTransform: 'uppercase', color: RARITY[c.rarity] || 'var(--ink-muted)',
            }}>{c.rarity}</div>
          )}
        </div>
        {/* RIGHT: identity + the ownership ledger. The type lives in the sheet
            title, so this column only adds what the header doesn't say. */}
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "700 19px/1.2 var(--f-display)", color: 'var(--ink-head, var(--ink-body))' }}>{c.name}</div>
          {subs.length > 0 && (
            <div style={{ font: "400 12.5px/1.4 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 4 }}>{subs.join(' · ')}</div>
          )}
          {sets.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {sets.map((s, i) => s?.name && (
                <span key={s.code || i} style={{
                  display: 'inline-block', font: "600 9.5px/1 var(--f-display)", letterSpacing: '.1em',
                  textTransform: 'uppercase', color: 'var(--gold-leaf)', padding: '4px 9px',
                  borderRadius: 999, border: '1px solid var(--hair-16)', background: 'rgba(10,9,7,.5)',
                }}>{s.name}</span>
              ))}
            </div>
          )}
          <div style={{ marginTop: 14, borderRadius: 12, background: 'rgba(255,255,255,.02)', border: '1px solid var(--hair-12)', padding: '2px 12px' }}>
            <LedgerRow label="Owned" field="owned" qty={qty} step={step} />
            <div style={{ height: 1, background: 'var(--hair-12)' }} />
            <LedgerRow label="Foil ✦" field="foil" qty={qty} step={step} />
            <div style={{ height: 1, background: 'var(--hair-12)' }} />
            <LedgerRow label="Wishlist" field="wanted" qty={qty} step={step} />
          </div>
        </div>
      </div>
      {flavor && (
        <div style={{ font: "italic 400 12px/1.5 var(--f-read)", color: 'var(--ink-faint)', marginTop: 12, textAlign: 'center' }}>“{flavor}”</div>
      )}
    </>
  );
}

export default function CollectionCardSheet({ cardId, onClose, onOpenCodex }) {
  const [c, setC] = useState(null);
  const [picking, setPicking] = useState(false);    // add-to-list picker view
  useEffect(() => { if (cardId) { setC(null); setPicking(false); getCard(cardId).then(setC); } }, [cardId]);
  if (!cardId) return null;
  return (
    <BottomSheet open title={picking ? 'ADD TO LIST' : (c ? typeLabel(c) : ' ')} onClose={onClose}>
      {!c ? <Loading /> : picking ? (
        <ListPicker cardId={c.card_id} onBack={() => setPicking(false)} />
      ) : (
        <>
          <SheetBody c={c} onOpenCodex={onOpenCodex} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => setPicking(true)} style={{
              flex: 1, padding: '12px 0', borderRadius: 12, cursor: 'pointer', font: "600 13px/1 var(--f-ui)",
              background: 'rgba(255,255,255,.03)', color: 'var(--ink-body)', border: '1px solid var(--hair-22)',
            }}>Add to a list</button>
            {onOpenCodex && (
              <button onClick={() => onOpenCodex(c.card_id, c.name)} style={{
                flex: 1, padding: '12px 0', borderRadius: 12, cursor: 'pointer', font: "600 13px/1 var(--f-ui)",
                background: 'none', color: 'var(--gold-head)', border: '1px solid var(--hair-22)',
              }}>Open in Codex ›</button>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
