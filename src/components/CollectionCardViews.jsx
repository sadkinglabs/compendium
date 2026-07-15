// The Collection > Cards dual browser's two card presentations:
//  - LedgerRow: the List view, tuned for scanning + count editing (mini 5:7
//    thumb with owned/playset/missing frame states, playset pip progress, inline
//    frosted steppers, or a "+ Add" pill for a card you don't own yet).
//  - BinderTile: the Binder view, an album-page 5:7 tile, edit-light (tap opens
//    the detail sheet; a quick + on empty sleeves).
// Ownership counts come in as props (owned = regular copies, foil, wanted); the
// playset check reuses the deckbuilder's legal limits. Ruby stays chrome-only.
import React, { useState } from 'react';
import CardArt from './CardArt.jsx';
import { RARITY_LIMITS, isUnlimited } from '../store/deckRepository.js';
import { haptic } from '../native.js';

// Reference palette (from the design spec; kept literal - these are deliberate).
// exported so the wanted-list detail reuses the exact same gilt frame + glow.
export const GILT = 'linear-gradient(160deg, rgba(227,197,137,.85), rgba(203,167,95,.2) 45%, rgba(184,149,79,.7))';
export const GILT_BRIGHT = 'linear-gradient(160deg, #e8cd92, #c2a05a)';
export const GLOW = '0 0 12px rgba(203,167,95,.14)';
export const GLOW_BRIGHT = '0 0 12px rgba(203,167,95,.28)';
const TEAL = '#63c9a3';

// The thumb shows the WHOLE card (5:7), no magnification. Sites (stored portrait)
// are left unrotated - the portrait shape matches the frame, so no crop/rotate.

function firstSetName(card) {
  try { const s = JSON.parse(card?.sets || '[]'); return (Array.isArray(s) && s[0]?.name) || null; } catch { return null; }
}

// A card's playset state: the legal limit for its rarity (4/3/2/1), whether the
// total owned reaches it, and whether the card is exempt ("any number of").
function playsetOf(card, total) {
  const limit = RARITY_LIMITS[card?.rarity];
  const capped = !!limit && !isUnlimited(card);
  return { limit: capped ? limit : 0, complete: capped && total >= limit };
}

const setPillStyle = {
  display: 'inline-block', font: "600 9.5px/1 var(--f-display)", letterSpacing: '.1em', textTransform: 'uppercase',
  color: 'var(--gold-leaf)', padding: '4px 9px', borderRadius: 999, border: '1px solid var(--hair-16)', background: 'rgba(10,9,7,.5)',
};

// A flat frosted-glass round button (steppers + the missing-card quick add): a
// 31px rose-glass circle inside a >=44px hit area, with a pressed/hover lift.
export function Frost({ label, onClick, disabled, size = 31, children }) {
  const [act, setAct] = useState(false);
  const on = act && !disabled;
  const hit = Math.max(44, size);
  return (
    <button
      aria-label={label} disabled={disabled} onClick={onClick}
      onPointerDown={() => setAct(true)} onPointerUp={() => setAct(false)} onPointerLeave={() => setAct(false)}
      onMouseEnter={() => setAct(true)} onMouseLeave={() => setAct(false)}
      style={{ width: hit, height: hit, padding: 0, border: 'none', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1 }}
    >
      <span style={{
        width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? 'rgba(224,169,177,.20)' : 'rgba(224,169,177,.12)',
        border: `1px solid ${on ? 'rgba(240,190,198,.45)' : 'rgba(224,169,177,.28)'}`,
        color: '#f0c8ce', font: "600 18px/1 var(--f-ui)",
        transition: 'background .12s, border-color .12s',
      }}>{children}</span>
    </button>
  );
}

// A small jade jewel (faceted diamond + tick) - the playset-collected mark, shown
// in place of the old "PLAYSET" wordmark to keep the rail calm. Shared shape with
// CollectionCardRow so a completed playset always reads the same.
export function PlaysetSeal({ size = 16 }) {
  return (
    <span title="Playset collected" aria-label="Playset collected" style={{ display: 'inline-flex', flex: 'none' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="rgba(143,211,168,.16)" stroke="#63c9a3" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 12.2 L11 15 L16.2 9.4" fill="none" stroke="#63c9a3" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// Playset tracking for the rail: pips (one per legal copy) while collecting, the
// jade seal once complete. Nothing for a card you don't own / with no limit.
export function PlaysetProgress({ limit, total, complete }) {
  if (complete) return <PlaysetSeal />;
  if (!limit || total <= 0) return null;
  const filled = Math.min(total, limit);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} aria-label={`${filled} of ${limit} toward a playset`}>
      {Array.from({ length: limit }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i < filled ? TEAL : 'rgba(255,255,255,.12)' }} />
      ))}
    </span>
  );
}

/* ------------------------------ List view ------------------------------ */

export const LedgerRow = React.memo(function LedgerRow({ card, set, setLabel, owned = 0, foil = 0, wanted = 0, value = 0, onStep, onPeek }) {
  const total = owned + foil;
  const { limit, complete } = playsetOf(card, total);
  const missing = total === 0;
  const setName = setLabel || firstSetName(card);
  const nameColor = complete ? '#f4ecdc' : missing ? '#8a8175' : '#efe7d8';
  const stop = (e) => e.stopPropagation();
  return (
    <div className="cx-row" onClick={() => onPeek(card.card_id, set)}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', minHeight: 90, contentVisibility: 'auto', containIntrinsicSize: 'auto 90px' }}>
      {/* Thumb: the whole card (no zoom, sites unrotated), gilt frame when owned
          (brighter at playset), dark overlay when missing. */}
      <span style={{ width: 64, flex: 'none', position: 'relative' }}>
        {missing ? (
          <span style={{ display: 'block', position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
            <CardArt card={card} radius={8} aspect="5/7" />
            <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(6,5,5,.62)' }} />
          </span>
        ) : (
          <span style={{ display: 'block', position: 'relative', padding: 1, borderRadius: 9, background: complete ? GILT_BRIGHT : GILT, boxShadow: complete ? GLOW_BRIGHT : GLOW }}>
            <CardArt card={card} radius={8} aspect="5/7" />
            {/* Always show the copies-owned count (not just at playset). */}
            <span title={`${total} cop${total === 1 ? 'y' : 'ies'} owned${foil > 0 ? ` (${foil} foil)` : ''}`} style={{ position: 'absolute', bottom: -5, right: -5, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: "700 11px/1 var(--f-mono)", color: '#1a1206', background: '#e3c589', border: '1px solid rgba(16,5,8,.55)', boxShadow: '0 1px 4px rgba(0,0,0,.5)' }}>×{total}</span>
          </span>
        )}
      </span>

      {/* Middle: Name / Set · Foils / Playset tracking (stacked lines). */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', font: "600 16.5px/1.25 var(--f-read)", color: nameColor, overflow: 'hidden' }}>{card.name}</span>
        {(setName || foil > 0) && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
            {setName && <span style={setPillStyle}>{setName}</span>}
            {foil > 0 && <span title="Foil copies" style={{ font: "600 10.5px/1 var(--f-mono)", color: '#e3c589' }}>✦ {foil}</span>}
          </span>
        )}
        {(complete || (limit && total > 0)) && (
          <span style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
            <PlaysetProgress limit={limit} total={total} complete={complete} />
          </span>
        )}
      </div>

      {/* Right: steppers when you have some, else a single Add pill. Omitted
          entirely when the caller passes no onStep (read-only, e.g. Overview). */}
      {onStep && (
        <span onClick={stop} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center' }}>
          {value > 0 ? (
            <>
              <Frost label="Decrease" onClick={() => onStep(card.card_id, set, -1)}>−</Frost>
              <span style={{ minWidth: 20, textAlign: 'center', font: "500 16px/1 var(--f-display)", color: '#efe7d8' }}>{value}</span>
              <Frost label="Increase" onClick={() => onStep(card.card_id, set, 1)}>+</Frost>
            </>
          ) : (
            <button onClick={() => onStep(card.card_id, set, 1)} aria-label="Add one"
              style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, cursor: 'pointer', font: "600 12.5px/1 var(--f-display)", letterSpacing: '.04em', color: '#f0c8ce', background: 'rgba(224,169,177,.12)', border: '1px solid rgba(224,169,177,.28)' }}>+ Add</button>
          )}
        </span>
      )}
    </div>
  );
});

/* ------------------------------ Binder view ------------------------------ */

const chipDark = {
  display: 'inline-flex', alignItems: 'center', font: "700 11px/1 var(--f-mono)", color: '#e3c589',
  padding: '3px 7px', borderRadius: 8, background: 'rgba(8,6,4,.82)', border: '1px solid rgba(203,167,95,.3)',
};

export const BinderTile = React.memo(function BinderTile({ card, set, setLabel, owned = 0, foil = 0, wanted = 0, onStep, onPeek }) {
  const total = owned + foil;
  const { complete } = playsetOf(card, total);
  const missing = total === 0;
  const setName = setLabel || firstSetName(card);
  return (
    <div onClick={() => onPeek(card.card_id, set)} style={{ position: 'relative', cursor: 'pointer', contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' }}>
      {/* The tile face: gilt frame when owned, dashed "empty sleeve" when missing. */}
      <div style={{
        position: 'relative', borderRadius: 13, overflow: 'hidden',
        ...(missing
          ? { border: '1px dashed rgba(203,167,95,.22)' }
          : { padding: 1, background: complete ? GILT_BRIGHT : GILT, boxShadow: complete ? GLOW_BRIGHT : GLOW }),
      }}>
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
          <CardArt card={card} radius={12} aspect="5/7" />
          {missing && <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(6,5,5,.68)' }} />}
          {/* Bottom caption on a scrim: name + set. */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 9px 8px', background: 'linear-gradient(transparent, rgba(6,5,5,.92))' }}>
            <div style={{ font: "600 12px/1.2 var(--f-read)", color: missing ? '#a99a80' : '#efe7d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.name}</div>
            {setName && <div style={{ font: "600 8px/1 var(--f-display)", letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--gold-leaf)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{setName}</div>}
          </div>
        </div>
      </div>

      {/* Owned corners: count + foil top-left, playset seal top-right. */}
      {!missing && (
        <span style={{ position: 'absolute', top: 7, left: 7, display: 'inline-flex', gap: 5 }}>
          <span style={chipDark}>×{total}</span>
          {foil > 0 && <span style={chipDark}>✦{foil}</span>}
        </span>
      )}
      {complete && (
        <span title="Playset collected" style={{ position: 'absolute', top: 7, right: 7, width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,20,16,.8)', border: `1px solid ${TEAL}` }}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke={TEAL} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </span>
      )}
      {/* Missing sleeves get a quick add - ONLY where adding is enabled. Like
          LedgerRow, the add control is omitted entirely when the caller passes no
          onStep (read-only: the My Collection lens, Overview). Without this guard the
          read-view View-all / Not-owned binder showed a dead "+" on every unowned
          tile that threw on tap. */}
      {missing && onStep && (
        <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', bottom: 7, right: 7 }}>
          <Frost label={`Add ${card.name}`} size={30} onClick={() => onStep(card.card_id, set, 1)}>+</Frost>
        </span>
      )}
    </div>
  );
});
