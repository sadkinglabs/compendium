// The ownership control for a single card - two stepper rows (Owned / Wishlist)
// over the owned_cards ledger. Self-contained: give it a { cardId } and it reads
// qtyFor, writes setOwned/setWanted (absolute + serialized), and live-refreshes
// via subscribeCollection. Header is "CARDS YOU OWN" (never the bare word
// "Collection", which already names a deck zone and the Codex table). Ruby is
// chrome-only - it rides the stepper buttons; the count stays gold/ink.
import React, { useEffect, useRef, useState } from 'react';
import { SectionLabel } from './ui.jsx';
import { qtyFor, setWanted, setFoil, stepOwnedBucket, qtyForInSet, setOwnedInSet, setFoilInSet, subscribeCollection } from '../store/ownedRepository.js';
import { stepBtn, serialChain, ownedChains } from './ownedUi.js';
import { haptic } from '../native.js';

// The optimistic ledger for one card's owned/foil/wanted counts: reads qtyFor,
// writes setOwned/setFoil/setWanted (absolute + serialized), live-refreshes via
// subscribeCollection. Owns ALL writes and the haptic on tap - consumers only
// render. Returns { qty, step }: qty is {owned, foil, wanted} (null until first
// read; steppers should stay inert until then), step(field, delta) mutates -
// field is 'owned' (regular copies), 'foil', or 'wanted'.
export function useOwnedLedger(cardId, set = null) {
  const [qty, setQty] = useState(null);            // {owned, foil, wanted} - null until first read
  const qtyRef = useRef({ owned: 0, foil: 0, wanted: 0 });  // synchronous optimistic mirror
  const pending = useRef(0);                        // in-flight writes

  // Scoped to a PRINTING when `set` is given: owned/foil are that (card, set)'s -
  // so Alpha and Beta are edited independently. Wishlist stays card-level (the
  // wishlist isn't per-printing). `set` null/undefined = name-level totals across
  // every printing (Codex/Overview); a set CODE or '' (the Unspecified bucket) scopes
  // to that one bucket. NOTE: '' is a real bucket, so test `!= null`, never truthiness
  // - `set ?` would fold '' into name-level and show the card's grand total.
  const read = () => (set != null
    ? Promise.all([qtyForInSet(cardId, set), qtyFor(cardId)]).then(([o, c]) => ({ owned: o.owned, foil: o.foil, wanted: c.wanted }))
    : qtyFor(cardId));

  // Apply a DB read only if no write is in flight. A read dispatched while the
  // ledger was settled can still resolve AFTER a later optimistic tap; applying it
  // then would stomp the optimistic value (it self-heals on the next drain, but
  // this avoids the visible flash).
  const applyIfCurrent = (v) => { if (pending.current === 0) { qtyRef.current = v; setQty(v); } };

  // Read on mount / card or set change.
  useEffect(() => {
    let alive = true;
    read().then((v) => { if (alive && pending.current === 0) { qtyRef.current = v; setQty(v); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, set]);

  // Live refresh - but NEVER while our own writes are in flight: each write bumps
  // the very bus we subscribe to, so re-reading mid-chain would stomp the
  // optimistic value. The write path reconciles from the DB once writes drain, so
  // this handler only needs to catch edits made elsewhere while we sit idle.
  useEffect(() => subscribeCollection(() => {
    if (pending.current > 0) return;
    read().then(applyIfCurrent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cardId, set]);

  function step(field, delta) {
    if (qty === null) return;                       // never write off the phantom {0,0} baseline - it would clobber the real row
    haptic('light');
    const next = { ...qtyRef.current, [field]: Math.max(0, (qtyRef.current[field] || 0) + delta) };
    qtyRef.current = next;
    setQty(next);                                   // optimistic, synchronous (pre-await)
    pending.current++;
    // Owned/foil for a printing serialize on the per-(card,set) chain - the SAME
    // key My Collection's row steppers use - so the sheet and the row commute.
    // Wishlist (card-level) rides the card chain. Each write re-reads the committed
    // count inside its turn so an absolute write can't clobber a concurrent edit.
    const perSet = set != null && field !== 'wanted';   // '' (Unspecified) is a real bucket too
    const key = perSet ? `${cardId}|${set}` : cardId;
    serialChain(ownedChains, key, async () => {
      if (field === 'wanted') { const cur = await qtyFor(cardId); return setWanted(cardId, Math.max(0, (cur.wanted || 0) + delta)); }
      if (perSet) {
        const cur = await qtyForInSet(cardId, set);
        const v = Math.max(0, (field === 'owned' ? cur.owned : cur.foil) + delta);
        return field === 'owned' ? setOwnedInSet(cardId, set, v) : setFoilInSet(cardId, set, v);
      }
      // Name-level (no printing): owned edits the '' bucket by delta; foil its own row.
      if (field === 'owned') return stepOwnedBucket(cardId, delta);
      const cur = await qtyFor(cardId);
      return setFoil(cardId, Math.max(0, (cur.foil || 0) + delta));
    })
      .finally(() => {
        pending.current--;
        if (pending.current === 0) read().then(applyIfCurrent);
      });
  }

  return { qty, step };
}

export default function OwnedControl({ cardId }) {
  const { qty, step } = useOwnedLedger(cardId);

  const row = (label, field) => {
    const v = qty?.[field] || 0;
    const loading = qty === null;                   // steppers inert until the real count is read
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
        <span style={{ flex: 1, minWidth: 0, font: "500 14.5px/1.2 var(--f-read)", color: 'var(--ink-muted)' }}>{label}</span>
        <button onClick={() => step(field, -1)} style={stepBtn} disabled={loading || v === 0} aria-label={`Decrease ${label}`}>−</button>
        <span style={{ minWidth: 22, textAlign: 'center', font: "700 16px/1 var(--f-mono)", color: v > 0 ? 'var(--ink-body)' : 'var(--ink-faint)' }}>{v}</span>
        <button onClick={() => step(field, 1)} style={stepBtn} disabled={loading} aria-label={`Increase ${label}`}>+</button>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 20 }}>
      <SectionLabel label="CARDS YOU OWN" />
      <div style={{ borderRadius: 14, background: 'rgba(255,255,255,.02)', border: '1px solid var(--hair-12)', padding: '4px 14px' }}>
        {row('Owned', 'owned')}
        <div style={{ height: 1, background: 'var(--hair-12)' }} />
        {row('Foil ✦', 'foil')}
        <div style={{ height: 1, background: 'var(--hair-12)' }} />
        {row('Wishlist', 'wanted')}
      </div>
    </div>
  );
}
