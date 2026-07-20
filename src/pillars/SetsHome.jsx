// Collection · My Collection landing (Collection UX redesign, Phase 1).
// Sets-are-home / completion-is-goal: a 2-up grid of set tiles. Each tile stacks the set logo
// (the hero), the set title, an owned/total + foil stat line, and a completion bar flush to
// its bottom edge. Owned sets get a gilt edge and a lift; empty sets drop to a warm-brown
// edge, dimmed art and muted text. Tapping a tile drills into that set's cards. Completion is
// over the WHOLE catalog (buildSetCompletion), non-foil only, independent of any search or
// filter in the drill. Text + vector carry the meaning, so a heroless/zero-image tile stays
// legible via an engraved initial.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { getCatalog } from '../store/catalogCache.js';
import { ownedBySet, subscribeCollection } from '../store/ownedRepository.js';
import { buildSetCompletion } from '../store/setCompletion.js';
import { setHeroUrl } from '../store/cardArt.js';
import { SET_LABEL } from '../store/sets.js';
import { Loading } from '../components/ui.jsx';

const fmt = (n) => (n || 0).toLocaleString('en-US');

// 004 ships an opaque panel behind its wordmark - round its corners so it sits on the tile.
const BOXED = new Set(['004']);

// Tile shell. Owned sets (>=1 card) get the gilt edge, fuller gradient and a lift; empty sets
// drop to a warm-brown edge, lighter gradient, no shadow, dimmed art and muted text.
const tileStyle = (has) => ({
  position: 'relative', overflow: 'hidden', width: '100%', cursor: 'pointer',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: 0, borderRadius: 16,
  border: `1px solid ${has ? 'rgba(var(--gilt-rgb),.45)' : 'var(--hair-warm-50)'}`,
  background: has
    ? 'linear-gradient(180deg, rgba(var(--tile-top-rgb),.55), rgba(var(--tile-bottom-rgb),.55))'
    : 'linear-gradient(180deg, rgba(var(--tile-top-rgb),.35), rgba(var(--tile-bottom-rgb),.35))',
  boxShadow: has ? 'var(--shadow-tile)' : 'none',
});
// ~92px hero slot; the logo is contained, never cropped.
const HERO = {
  width: '100%', height: 92, padding: '16px 18px 0', boxSizing: 'border-box',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const TITLE = {
  marginTop: 10, padding: '0 12px', textAlign: 'center',
  font: "600 11.5px/1.35 var(--f-display)", letterSpacing: '.18em', textTransform: 'uppercase',
  overflowWrap: 'anywhere',
};
const hideOnErr = (e) => { e.currentTarget.style.display = 'none'; };

function Plate({ s, onOpen }) {
  const hero = setHeroUrl(s.code);
  const boxed = BOXED.has(s.code);
  const has = s.ownedUnique > 0;                 // owned set vs empty set
  const pct = s.pct;
  const countColor = has ? 'var(--gold-num)' : 'var(--ink-muted-warm)';
  const labelColor = has ? 'var(--ink-muted-warm)' : 'var(--ink-dimmest)';
  return (
    <button type="button" onClick={() => onOpen(s.code, s)} style={tileStyle(has)}>
      <div style={HERO}>
        {hero ? (
          <img src={hero} alt="" aria-hidden="true" onError={hideOnErr}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block',
              opacity: has ? 1 : 0.55, ...(boxed ? { borderRadius: 7 } : {}) }} />
        ) : (
          // heroless / zero-image: engraved display initial in the same slot
          <span style={{ font: "700 34px/1 var(--f-display)", color: '#171209', letterSpacing: '.04em', opacity: has ? 1 : 0.55,
            textShadow: '0 1px 0 rgba(233,212,154,.12), 0 -1px 1px rgba(0,0,0,.9)' }}>
            {(s.name || '?').charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div style={{ ...TITLE, color: has ? 'var(--gold-num)' : 'var(--ink-dim)' }}>{s.name}</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 10, paddingBottom: 15 }}>
        <span>
          <span style={{ font: "600 13.5px/1 var(--f-display)", color: countColor }}>{fmt(s.ownedUnique)}</span>
          <span style={{ font: "400 13px/1 var(--f-read)", color: labelColor }}>/{fmt(s.totalCollectible)}</span>
        </span>
        <span style={{ width: 1, height: 11, background: 'var(--rule-warm)' }} />
        <span>
          <span style={{ font: "600 13.5px/1 var(--f-display)", color: countColor }}>✦ {fmt(s.foilUnique)}</span>
          <span style={{ font: "400 13px/1 var(--f-read)", color: labelColor }}> foil</span>
        </span>
      </div>

      {/* Completion bar, flush to the tile's bottom edge - replaces the corner ring, which
          fought the logo art. Gold -> ruby fill; empty sets show the bare track. */}
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'var(--track-neutral)' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, pct * 100)}%`, background: 'var(--completion-fill)' }} />
      </span>
    </button>
  );
}

export default function SetsHome({ onOpenSet, rev }) {
  const [completion, setCompletion] = useState(null);

  const load = useCallback(async () => {
    const [cards, obs] = await Promise.all([getCatalog(), ownedBySet()]);
    setCompletion(buildSetCompletion(cards, obs, SET_LABEL));
  }, []);
  useEffect(() => { load(); }, [load, rev]);
  // Live-refresh with edits made in a drilled set (steppers) or elsewhere, debounced so
  // optimistic writes settle first.
  useEffect(() => {
    let t = null;
    const off = subscribeCollection(() => { clearTimeout(t); t = setTimeout(load, 250); });
    return () => { clearTimeout(t); off(); };
  }, [load]);

  const totals = useMemo(() => {
    let owned = 0, total = 0;
    for (const s of (completion || [])) { owned += s.ownedUnique; total += s.totalCollectible; }
    return { owned, total, pct: total ? owned / total : 0 };
  }, [completion]);

  if (completion == null) return <Loading />;

  // No docked FAB or search pill on this landing, so it needs no deep bottom reserve - the
  // 150px it used to carry made the page scroll even when the tiles already fitted.
  return (
    <div style={{ padding: '0 20px 24px' }}>
      <div style={{ margin: '8px 2px 20px' }}>
        <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--accent-ruby)' }}>Collection</div>
        <div style={{ font: "700 22px/1.1 var(--f-display)", letterSpacing: '.06em', color: 'var(--ink-head)', margin: '6px 0' }}>Sets</div>
        <div style={{ font: "400 11.5px/1 var(--f-mono)", letterSpacing: '.04em', color: 'var(--ink-muted)' }}>
          {fmt(totals.owned)} / {fmt(totals.total)} non-foil owned
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {completion.map((s) => <Plate key={s.code} s={s} onOpen={onOpenSet} />)}
      </div>
    </div>
  );
}
