// The Collection pillar's card-first "binder" row (list detail). Stat-free and
// stacked: the whole 5:7 card thumb (no zoom, sites unrotated) ringed in the
// rarity hue with a deep-ruby TOTAL-owned badge, then Name / Set · Foils /
// Playset tracking - pips while collecting, a jade seal once complete (shared
// with the Cards LedgerRow via PlaysetProgress). Unowned art dims so the binder
// visibly "fills in". Ruby stays chrome-only: buttons, never content.
import React from 'react';
import CardArt from './CardArt.jsx';
import { PlaysetProgress } from './CollectionCardViews.jsx';
import { stepBtn } from './ownedUi.js';
import { RARITY_LIMITS, isUnlimited } from '../store/deckRepository.js';
import { haptic } from '../native.js';

const RARITY_COLOR = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };

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
  const capped = !!limit && !isUnlimited(card);
  const playset = capped && total >= limit;
  const value = stepper?.value ?? 0;
  const step = (delta) => {
    if (stepper?.disabled) return;
    haptic('light');
    stepper.onStep(delta);
  };
  const foilChip = foil > 0 && <span title="Foil copies" style={{ ...pillBase, font: "600 10.5px/1 var(--f-mono)", letterSpacing: 0, textTransform: 'none', color: 'var(--gold-head)' }}>✦ {foil}</span>;
  const wishChip = wanted > 0 && <span title="On your wishlist" style={{ ...pillBase, font: "600 10.5px/1 var(--f-mono)", letterSpacing: 0, textTransform: 'none', color: 'var(--ink-faint)' }}>♡ {wanted}</span>;
  const psVisible = playset || (capped && total > 0);
  return (
    <div
      onClick={onClick} className="cx-row"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', minHeight: 96 }}
    >
      {/* The whole card (5:7, no zoom, sites unrotated), ringed in the rarity hue;
          a deep-ruby corner badge carries the TOTAL copies owned. */}
      <span style={{
        width: 64, flex: 'none', position: 'relative', borderRadius: 9,
        boxShadow: `0 0 0 1px ${rarity ? `color-mix(in srgb, ${rarity} 45%, transparent)` : 'var(--hair-16)'}`,
      }}>
        <div style={dim ? { opacity: 0.55, filter: 'saturate(.8)' } : undefined}>
          <CardArt card={card} radius={8} aspect="5/7" />
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
      {/* Middle: Name / Set · Foils / Playset tracking (stacked lines). */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          font: "600 16.5px/1.25 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden',
        }}>{card.name}</span>
        {(setName || foilChip || wishChip) && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 }}>
            {setName && <span style={{ ...pillBase, color: 'var(--gold-leaf)' }}>{setName}</span>}
            {foilChip}
            {wishChip}
          </span>
        )}
        {(psVisible || chip) && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
            {psVisible && <PlaysetProgress limit={capped ? limit : 0} total={total} complete={playset} />}
            {chip}
          </span>
        )}
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
