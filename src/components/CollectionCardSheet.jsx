// The COLLECTION pillar's card-tap detail sheet. Three surfaces show a card and
// each has a distinct job: CardSheet.jsx is the deckbuilder's (deck-zone
// steppers - Spellbook/Atlas/Collection), CodexDetail.jsx is the full page
// (stats, rulings, FAQ, notes), and THIS sheet is about OWNING the card: full
// card face beside Owned/Wishlist steppers over the owned_cards ledger, plus a
// hand-off link into the Codex. Deliberately calm - no stat-chip grid; mana and
// power live on the Codex page. Ruby stays chrome-only (stepper buttons); the
// content (art, name, counts, set capsules) stays gold/ink.
import React, { useEffect, useState } from 'react';
import { BottomSheet, Loading } from './ui.jsx';
import CardArt from './CardArt.jsx';
import { getCard } from '../store/codexRepository.js';
import { useOwnedLedger } from './OwnedControl.jsx';
import { stepBtn } from './ownedUi.js';

const jp = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
const RARITY = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };

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

// Inner body split out so useOwnedLedger only mounts once the card row exists
// (hooks can't sit behind the early returns above).
function SheetBody({ c, onClose, onOpenCodex }) {
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
        {/* RIGHT: identity + the ownership ledger. */}
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "700 19px/1.2 var(--f-display)", color: 'var(--ink-head, var(--ink-body))' }}>{c.name}</div>
          {(c.type || subs.length > 0) && (
            <div style={{ font: "400 12.5px/1.4 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 4 }}>
              {[c.type, subs.join(', ')].filter(Boolean).join(' · ')}
            </div>
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
            <LedgerRow label="Wishlist" field="wanted" qty={qty} step={step} />
          </div>
        </div>
      </div>
      {c.rules_text && (
        <div style={{ font: "400 13px/1.55 var(--f-read)", color: 'var(--ink-body-2)', marginTop: 14, whiteSpace: 'pre-wrap' }}>{c.rules_text}</div>
      )}
      {flavor && (
        <div style={{ font: "italic 400 12px/1.5 var(--f-read)", color: 'var(--ink-faint)', marginTop: 10 }}>“{flavor}”</div>
      )}
      {onOpenCodex && (
        <button
          onClick={() => { onClose?.(); onOpenCodex(c.card_id, c.name); }}
          style={{
            background: 'none', border: 'none', color: 'var(--gold-head)', font: "600 13px/1 var(--f-ui)",
            padding: '14px 0 2px', width: '100%', textAlign: 'center', cursor: 'pointer',
          }}
        >Open in Codex — rulings & FAQ ›</button>
      )}
    </>
  );
}

export default function CollectionCardSheet({ cardId, onClose, onOpenCodex }) {
  const [c, setC] = useState(null);
  useEffect(() => { if (cardId) { setC(null); getCard(cardId).then(setC); } }, [cardId]);
  if (!cardId) return null;
  return (
    <BottomSheet open title="CARD" onClose={onClose}>
      {!c ? <Loading /> : <SheetBody c={c} onClose={onClose} onOpenCodex={onOpenCodex} />}
    </BottomSheet>
  );
}
