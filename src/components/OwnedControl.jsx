// The ownership control for a single card - two stepper rows (Owned / Wishlist)
// over the owned_cards ledger. Self-contained: give it a { cardId } and it reads
// qtyFor, writes setOwned/setWanted (absolute + serialized), and live-refreshes
// via subscribeCollection. Header is "CARDS YOU OWN" (never the bare word
// "Collection", which already names a deck zone and the Codex table). Ruby is
// chrome-only - it rides the stepper buttons; the count stays gold/ink.
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { SectionLabel } from './ui.jsx';
import { qtyFor, setWanted, setFoil, stepOwnedBucket, qtyForInSet, setOwnedInSet, setFoilInSet, subscribeCollection, ownedRowKey } from '../store/ownedRepository.js';
import { enqueueWrite } from '../store/collectionWrites.js';
import { createOwnedStepController } from '../store/ownedStepController.js';
import { activeProfileId } from '../store/profileRepository.js';
import { stepBtn } from './ownedUi.js';
import { haptic } from '../native.js';
import { toast } from '../feedback.js';
import { stepFailureMessage } from '../store/ownedStepMessage.js';

// The optimistic ledger for one card's owned/foil/wanted counts: reads qtyFor,
// writes setOwned/setFoil/setWanted (absolute + serialized), live-refreshes via
// subscribeCollection. Owns ALL writes and the haptic on tap - consumers only
// render. Returns { qty, step }: qty is {owned, foil, wanted} (null until first
// read; steppers should stay inert until then), step(field, delta) mutates -
// field is 'owned' (regular copies), 'foil', or 'wanted'.
export function useOwnedLedger(cardId, set = null) {
  const [loaded, setLoaded] = useState(false);      // steppers stay inert until the real count is read
  const [, rerender] = useReducer((n) => n + 1, 0);
  const aliveRef = useRef(true);
  const ctlsRef = useRef(null);

  // Scoped to a PRINTING when `set` is given: owned/foil are that (card, set)'s -
  // so Alpha and Beta are edited independently. Wishlist stays card-level (the
  // wishlist isn't per-printing). `set` null/undefined = name-level totals across
  // every printing (Codex/Overview); a set CODE or '' (the Unspecified bucket) scopes
  // to that one bucket. NOTE: '' is a real bucket, so test `!= null`, never truthiness
  // - `set ?` would fold '' into name-level and show the card's grand total.
  const readAll = useCallback(() => (set != null
    ? Promise.all([qtyForInSet(cardId, set), qtyFor(cardId)]).then(([o, c]) => ({ owned: o.owned, foil: o.foil, wanted: c.wanted }))
    : qtyFor(cardId)
  ), [cardId, set]);

  // The durable write for one tap on one field. Serialized on the PERSISTED-ROW key via the
  // store-layer queue, bound to the profile captured now - so a switch mid-flight can't
  // redirect it, and the wishlist (which shares the '' row with unspecified owned) commutes
  // with the row steppers because they land on the same chain. Each write re-reads in its turn.
  const writeField = useCallback((field, delta) => {
    const pid = activeProfileId();
    const perSet = set != null && field !== 'wanted';   // '' (Unspecified) is a real bucket too
    const key = ownedRowKey(pid, cardId, perSet ? set : '', field === 'foil');
    return enqueueWrite(key, async () => {
      if (field === 'wanted') { const cur = await qtyFor(cardId, pid); return setWanted(cardId, Math.max(0, (cur.wanted || 0) + delta), pid); }
      if (perSet) {
        const cur = await qtyForInSet(cardId, set, pid);
        const v = Math.max(0, (field === 'owned' ? cur.owned : cur.foil) + delta);
        return field === 'owned' ? setOwnedInSet(cardId, set, v, pid) : setFoilInSet(cardId, set, v, pid);
      }
      // Name-level (no printing): owned edits the '' bucket by delta; foil its own row.
      if (field === 'owned') return stepOwnedBucket(cardId, delta, pid);
      const cur = await qtyFor(cardId, pid);
      return setFoil(cardId, Math.max(0, (cur.foil || 0) + delta), pid);
    });
  }, [cardId, set]);

  // One controller per editable quantity: each owns its own row chain, provisional delta and
  // drain reconcile, and surfaces a failure once per drained chain (see ownedStepController).
  const key = `${cardId}|${set}`;
  if (ctlsRef.current === null || ctlsRef.current.key !== key) {
    const mk = (field) => createOwnedStepController({
      read: async () => (await readAll())[field] || 0,
      write: (delta) => writeField(field, delta),
      // A refusal is not a malfunction: stepFailureMessage tells a storage conflict apart from a
      // failed write, because reporting the wall as a bug teaches distrust of a wall that is
      // protecting the user's filing.
      notify: (reason, cause) => { const m = stepFailureMessage(reason, cause); toast(m.text, { tone: m.tone }); },
      isAlive: () => aliveRef.current,
      onChange: () => rerender(),
    });
    ctlsRef.current = { key, owned: mk('owned'), foil: mk('foil'), wanted: mk('wanted') };
  }
  const ctls = ctlsRef.current;
  const anyPending = () => ctls.owned.pending() + ctls.foil.pending() + ctls.wanted.pending() > 0;

  // Seed the confirmed counts on mount / card or set change.
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    setLoaded(false);
    readAll().then((v) => {
      if (cancelled || anyPending()) return;
      ctls.owned.init(v.owned || 0); ctls.foil.init(v.foil || 0); ctls.wanted.init(v.wanted || 0);
      setLoaded(true);
    });
    return () => { cancelled = true; aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, set]);

  // Live refresh - but NEVER while our own writes are in flight: each write bumps the very bus
  // we subscribe to, so re-reading mid-chain would stomp the optimistic value. Each controller
  // reconciles itself once its chain drains, so this only catches edits made elsewhere.
  useEffect(() => subscribeCollection(() => {
    if (anyPending()) return;
    readAll().then((v) => {
      if (!aliveRef.current || anyPending()) return;
      ctls.owned.init(v.owned || 0); ctls.foil.init(v.foil || 0); ctls.wanted.init(v.wanted || 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cardId, set]);

  function step(field, delta) {
    if (!loaded) return;   // never write off the phantom {0,0} baseline - it would clobber the real row
    haptic('light');
    ctls[field].step(delta);
  }

  // Displayed = confirmed + provisional, clamped at 0 (the controller's contract).
  const qty = loaded
    ? { owned: ctls.owned.displayed(), foil: ctls.foil.displayed(), wanted: ctls.wanted.displayed() }
    : null;

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
