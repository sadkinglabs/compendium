// The Collection pillar's card-first "binder" row. Where CardRow is a dense
// stats readout (cost pill, power badge, threshold pips), this row is
// deliberately stat-free: a big 56px art thumb ringed in the card's rarity
// color, the name, one set capsule - and that's it. Unowned cards render with
// dimmed art so the binder visibly "fills in" as you collect. The right edge
// hosts an optional caller-supplied chip (wants / deck-need / owned tick) and
// an inline ruby stepper (accent stays chrome-only: buttons, never content).
import React from 'react';
import CardArt from './CardArt.jsx';
import { stepBtn } from './ownedUi.js';
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

export default function CollectionCardRow({ card, badge = 0, dim = false, chip = null, stepper = null, onClick }) {
  const rarity = RARITY_COLOR[card?.rarity];
  const setName = firstSetName(card);
  const value = stepper?.value ?? 0;
  const step = (delta) => {
    if (stepper?.disabled) return;
    haptic('light');
    stepper.onStep(delta);
  };
  return (
    <div
      onClick={onClick} className="cx-row"
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', minHeight: 72 }}
    >
      {/* Rarity ring rides on boxShadow, not border, so it never shifts layout. */}
      <span style={{
        width: 56, height: 56, flex: 'none', position: 'relative', borderRadius: 12,
        boxShadow: `0 0 0 1px ${rarity ? `color-mix(in srgb, ${rarity} 45%, transparent)` : 'var(--hair-16)'}`,
      }}>
        <div style={dim ? { opacity: 0.55, filter: 'saturate(.8)' } : undefined}>
          <CardArt card={card} radius={12} aspect="1/1" imgStyle={artFit(card)} />
        </div>
        {badge > 0 && (
          <span title="Copies owned" style={{
            position: 'absolute', bottom: -5, right: -5, minWidth: 20, height: 20, padding: '0 6px',
            borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            font: "700 12px/1 var(--f-mono)", color: '#f4e9d2',
            background: '#8f2038', border: '1px solid rgba(16,5,8,.55)', boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}>{badge}</span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Two-line clamp, not a one-line ellipsis: the 72px row has the height,
            and card names are the identity here - don't amputate them. */}
        <span style={{
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          font: "600 15.5px/1.25 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden',
        }}>{card.name}</span>
        {setName && (
          <span style={{ display: 'block', marginTop: 5 }}>
            <span style={{
              display: 'inline-block', font: "600 9.5px/1 var(--f-display)", letterSpacing: '.1em',
              textTransform: 'uppercase', color: 'var(--gold-leaf)', padding: '4px 9px',
              borderRadius: 999, border: '1px solid var(--hair-16)', background: 'rgba(10,9,7,.5)',
            }}>{setName}</span>
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        {chip}
        {stepper && (
          <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
    </div>
  );
}
