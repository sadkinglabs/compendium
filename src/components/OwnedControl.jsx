// The ownership control for a single card - two stepper rows (Owned / Wishlist)
// over the owned_cards ledger. Self-contained: give it a { cardId } and it reads
// qtyFor, writes setOwned/setWanted (absolute + serialized), and live-refreshes
// via subscribeCollection. Header is "CARDS YOU OWN" (never the bare word
// "Collection", which already names a deck zone and the Codex table). Ruby is
// chrome-only - it rides the stepper buttons; the count stays gold/ink.
import React, { useEffect, useRef, useState } from 'react';
import { SectionLabel } from './ui.jsx';
import { qtyFor, setOwned, setWanted, setFoil, subscribeCollection } from '../store/ownedRepository.js';
import { stepBtn, serialChain, ownedChains } from './ownedUi.js';
import { haptic } from '../native.js';

// The optimistic ledger for one card's owned/foil/wanted counts: reads qtyFor,
// writes setOwned/setFoil/setWanted (absolute + serialized), live-refreshes via
// subscribeCollection. Owns ALL writes and the haptic on tap - consumers only
// render. Returns { qty, step }: qty is {owned, foil, wanted} (null until first
// read; steppers should stay inert until then), step(field, delta) mutates -
// field is 'owned' (regular copies), 'foil', or 'wanted'.
export function useOwnedLedger(cardId) {
  const [qty, setQty] = useState(null);            // {owned, foil, wanted} - null until first read
  const qtyRef = useRef({ owned: 0, foil: 0, wanted: 0 });  // synchronous optimistic mirror
  const pending = useRef(0);                        // in-flight writes

  // Apply a DB read only if no write is in flight. A read dispatched while the
  // ledger was settled can still resolve AFTER a later optimistic tap; applying it
  // then would stomp the optimistic value (it self-heals on the next drain, but
  // this avoids the visible flash).
  const applyIfCurrent = (v) => { if (pending.current === 0) { qtyRef.current = v; setQty(v); } };

  // Read on mount / card change.
  useEffect(() => {
    let alive = true;
    qtyFor(cardId).then((v) => { if (alive && pending.current === 0) { qtyRef.current = v; setQty(v); } });
    return () => { alive = false; };
  }, [cardId]);

  // Live refresh - but NEVER while our own writes are in flight: each write bumps
  // the very bus we subscribe to, so re-reading mid-chain would stomp the
  // optimistic value. The write path reconciles from the DB once writes drain, so
  // this handler only needs to catch edits made elsewhere while we sit idle.
  useEffect(() => subscribeCollection(() => {
    if (pending.current > 0) return;
    qtyFor(cardId).then(applyIfCurrent);
  }), [cardId]);

  function step(field, delta) {
    if (qty === null) return;                       // never write off the phantom {0,0} baseline - it would clobber the real row
    haptic('light');
    const next = { ...qtyRef.current, [field]: Math.max(0, (qtyRef.current[field] || 0) + delta) };
    qtyRef.current = next;
    setQty(next);                                   // optimistic, synchronous (pre-await)
    pending.current++;
    // Queue on the APP-WIDE per-card chain (not a hook-local one) and re-read the
    // committed count inside our turn: another surface (e.g. the Cards tab's row
    // stepper) may have written since our mirror last synced, and an absolute
    // write off a stale mirror would silently revert it. Delta-on-fresh-read
    // under the shared chain makes concurrent edits commute.
    serialChain(ownedChains, cardId, async () => {
      const cur = await qtyFor(cardId);
      const val = Math.max(0, (cur[field] || 0) + delta);
      return field === 'owned' ? setOwned(cardId, val) : field === 'foil' ? setFoil(cardId, val) : setWanted(cardId, val);
    })
      .finally(() => {
        pending.current--;
        if (pending.current === 0) qtyFor(cardId).then(applyIfCurrent);
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
