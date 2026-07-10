// The Collection pillar's card-first "binder" row. Where CardRow is a dense
// stats readout (cost pill, power badge, threshold pips), this row is
// deliberately stat-free and built in TWO areas: the card's NAME, and a PILL
// RAIL beneath it - set capsule, playset jewel (a jade tick once you own the
// legal limit: 4 Ordinary / 3 Exceptional / 2 Elite / 1 Unique), wishlist ♡n,
// foil ✦n, plus any caller chip (owned-of-target in list detail). Big 72px art
// ringed in the card's rarity color carries a deep-ruby corner badge with the
// TOTAL copies owned (regular + foil) - the collector's number - while the
// stepper edits regular copies only (foils are edited in the card sheet).
// Unowned cards render with dimmed art so the binder visibly "fills in".
// Ruby stays chrome-only: buttons, never content.
import React from 'react';
import CardArt from './CardArt.jsx';
import { stepBtn } from './ownedUi.js';
import { RARITY_LIMITS, isUnlimited } from '../store/deckRepository.js';
import { haptic } from '../native.js';

const RARITY_COLOR = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };

// Same illustration crop as CardRow's thumb: Sites are stored portrait (a
// landscape card rotated), so rotate back before zooming; everything else
// scales up pinned near the top so the text box drops below the frame.
const artFit = (card) => card?.is_site
  ? { transform: 'rotate(90deg) scale(1.5)' }
  : { transformOrigin: '50% 30%', transform: 'scale(1.6)' };

// First set name from the card's JSON-string sets column; defensive because
// catalog rows sometimes carry null/garbage there.
function firstSetName(card) {
  try {
    const sets = JSON.parse(card?.sets || '[]');
    return (Array.isArray(sets) && sets[0]?.name) || null;
  } catch {
    return null;
  }
}

// The quiet capsule every rail pill shares.
const pillBase = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  font: "600 9.5px/1 var(--f-display)", letterSpacing: '.1em', textTransform: 'uppercase',
  padding: '4px 9px', borderRadius: 999, border: '1px solid var(--hair-16)', background: 'rgba(10,9,7,.5)',
};

// Playset achievement: a jade jewel (faceted diamond) holding a tick. Shown once
// you own the card's full legal limit - "collected".
function PlaysetJewel({ limit }) {
  return (
    <span title={`Playset collected — ${limit} of ${limit}`} style={{ display: 'inline-flex', flex: 'none' }} aria-label="Playset collected">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="rgba(143,211,168,.14)" stroke="var(--accent-jade)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M12 2 L12 6 M2 12 L6 12 M22 12 L18 12 M12 22 L12 18" stroke="rgba(143,211,168,.45)" strokeWidth="1" />
        <path d="M8 12.2 L11 15 L16.2 9.4" fill="none" stroke="var(--accent-jade)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * card    - full catalog row (name, sets, rarity, rules_text, image_slug, is_site…)
 * owned   - REGULAR copies; foil - foil copies; wanted - wishlist count.
 *           Total (owned+foil) drives the art badge + the playset jewel.
 * dim     - unowned-art treatment (caller decides; e.g. off in the wishlist filter)
 * chip    - optional extra rail pill(s) from the caller (owned-of-target, ✓)
 * stepper - optional { value, onStep(delta), disabled } - edits are the CALLER's
 *           ledger (regular copies / wishlist / list target); haptic lives here.
 */
export default function CollectionCardRow({ card, owned = 0, foil = 0, wanted = 0, dim = false, chip = null, stepper = null, onClick }) {
  const rarity = RARITY_COLOR[card?.rarity];
  const setName = firstSetName(card);
  const total = owned + foil;
  const limit = RARITY_LIMITS[card?.rarity];
  const playset = !!limit && total >= limit && !isUnlimited(card);
  const value = stepper?.value ?? 0;
  const step = (delta) => {
    if (stepper?.disabled) return;
    haptic('light');
    stepper.onStep(delta);
  };
  return (
    <div
      onClick={onClick} className="cx-row"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', minHeight: 94 }}
    >
      {/* Rarity ring rides on boxShadow, not border, so it never shifts layout. */}
      <span style={{
        width: 72, height: 72, flex: 'none', position: 'relative', borderRadius: 14,
        boxShadow: `0 0 0 1px ${rarity ? `color-mix(in srgb, ${rarity} 45%, transparent)` : 'var(--hair-16)'}`,
      }}>
        <div style={dim ? { opacity: 0.55, filter: 'saturate(.8)' } : undefined}>
          <CardArt card={card} radius={14} aspect="1/1" imgStyle={artFit(card)} />
        </div>
        {total > 0 && (
          <span title={`${total} cop${total === 1 ? 'y' : 'ies'} owned${foil > 0 ? ` (${foil} foil)` : ''}`} style={{
            position: 'absolute', bottom: -6, right: -6, minWidth: 21, height: 21, padding: '0 6px',
            borderRadius: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            font: "700 12px/1 var(--f-mono)", color: '#f4e9d2',
            background: '#8f2038', border: '1px solid rgba(16,5,8,.55)', boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}>{total}</span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Area 1: the name. Two-line clamp - names are the identity here. */}
        <span style={{
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          font: "600 16.5px/1.25 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden',
        }}>{card.name}</span>
        {/* Area 2: the pill rail - set · playset · wishlist · foils · caller chips. */}
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 7 }}>
          {setName && <span style={{ ...pillBase, color: 'var(--gold-leaf)' }}>{setName}</span>}
          {playset && <PlaysetJewel limit={limit} />}
          {wanted > 0 && <span title="On your wishlist" style={{ ...pillBase, font: "600 10.5px/1 var(--f-mono)", letterSpacing: 0, textTransform: 'none', color: 'var(--ink-faint)' }}>♡ {wanted}</span>}
          {foil > 0 && <span title="Foil copies" style={{ ...pillBase, font: "600 10.5px/1 var(--f-mono)", letterSpacing: 0, textTransform: 'none', color: 'var(--gold-head)' }}>✦ {foil}</span>}
          {chip}
        </span>
      </div>
      {stepper && (
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          <button
            aria-label="Decrease" disabled={stepper.disabled || value <= 0}
            onClick={() => step(-1)}
            style={{ ...stepBtn, ...(value <= 0 ? { opacity: 0.35, cursor: 'default' } : null) }}
          >−</button>
          <span style={{
            minWidth: 20, textAlign: 'center', font: "700 15px/1 var(--f-mono)",
            color: value > 0 ? 'var(--ink-body)' : 'var(--ink-faint)',
          }}>{value}</span>
          <button
            aria-label="Increase" disabled={stepper.disabled}
            onClick={() => step(1)}
            style={stepBtn}
          >+</button>
        </span>
      )}
    </div>
  );
}
