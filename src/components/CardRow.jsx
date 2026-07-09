// One rich card row, shared by Codex search results and the deckbuilder list.
// Matches ListRow's geometry exactly - 48px min-height, a 34px left slot, 12px
// gap, hairline divider - so card rows and article ListRows sit in one search
// list without a ragged gutter or height break. Accent touches (glyph, cost pill,
// power badge) inherit var(--list-accent), which the App shell sets per pillar
// (gold in the Codex, amethyst in Decks), so the row is unified-gold in search
// with zero per-pillar code. Kind is signalled by the glyph, never hue.
import React from 'react';
import CardArt from './CardArt.jsx';
import { ThresholdPips } from './ui.jsx';
import { thresholdRuns } from '../store/cardArt.js';

const RARITY_COLOR = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };

// The thumbnail crops the illustration out of the full card face: for a minion
// it scales up and pins to the top (the text box drops below the frame); for a
// Site the stored image is portrait (a landscape card rotated), so we rotate it
// 90° clockwise back to true orientation before zooming.
const artFit = (card) => card?.is_site
  ? { transform: 'rotate(90deg) scale(1.5)' }
  : { transformOrigin: '50% 30%', transform: 'scale(1.6)' };

// A minion's combat stats: attack==defence collapses to one "power" value (deck-
// builder parity), else attack/defence. Sword glyph marks it apart from mana.
function powerOf(card) {
  if (!/minion/i.test(card.type || '') || card.attack == null) return null;
  return card.attack === card.defence ? `${card.attack}` : `${card.attack}/${card.defence}`;
}

function Sword({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" y1="19" x2="19" y2="13" />
      <line x1="16" y1="16" x2="20" y2="20" />
      <line x1="19" y1="21" x2="21" y2="19" />
    </svg>
  );
}

export default function CardRow({ card, icon, thumb = false, rarityTint = false, count = 0, countTint = '#4d2e8c', countTitle = 'Copies in this deck', trailing, onClick }) {
  const runs = thresholdRuns(card);
  const power = powerOf(card);
  return (
    <div
      onClick={onClick} className="cx-row"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', minHeight: 48 }}
    >
      <span style={{ width: 34, height: 34, flex: 'none', position: 'relative' }}>
        {thumb
          ? <CardArt card={card} radius={9} aspect="1/1" imgStyle={artFit(card)} />
          : (
            <span style={{
              width: 34, height: 34, borderRadius: 9, border: '1px solid var(--hair-16)',
              background: 'var(--surface-well)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--list-accent, var(--gold))',
            }}>{icon}</span>
          )}
        {count > 0 && (
          <span title={countTitle} style={{
            position: 'absolute', top: -5, left: -5, minWidth: 18, height: 18, padding: '0 5px',
            borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            font: "700 11px/1 var(--f-mono)", color: '#efe8ff',
            background: countTint, border: '1px solid rgba(8,5,16,.55)', boxShadow: '0 1px 4px rgba(0,0,0,.5)',
          }}>{count}</span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block', font: "600 16px/1.15 var(--f-read)",
          color: rarityTint ? (RARITY_COLOR[card.rarity] || 'var(--ink-body)') : 'var(--ink-body)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{card.name}</span>
      </div>
      {/* Stats cluster: tight internal spacing so it never starves the name.
          Rounded pill = mana (cost); squared sword badge = power (combat). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
        {runs.length > 0 && <ThresholdPips runs={runs} size={11} />}
        {card.cost != null && (
          <span title="Mana cost" style={{
            minWidth: 21, height: 20, padding: '0 6px', borderRadius: 10,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            font: "600 12px/1 var(--f-mono)", color: 'var(--list-accent, var(--gold-leaf))',
            border: '1px solid var(--hair-16)',
          }}>{card.cost}</span>
        )}
        {power != null && (
          <span title="Power (attack/defence)" style={{
            height: 20, padding: '0 6px 0 5px', borderRadius: 6, gap: 3,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            font: "600 12px/1 var(--f-mono)", color: 'var(--list-accent, var(--gold-leaf))',
            border: '1px solid var(--hair-16)',
          }}><Sword /> {power}</span>
        )}
        {trailing}
      </div>
    </div>
  );
}
