// Collection · My Collection landing (Collection UX redesign, Phase 1).
// Sets-are-home / completion-is-goal: a 2-up grid of set plates. Each plate stacks the set
// logo (staged as a lit hero over a warm backlight), the set title, and a completion Ring
// housing the owned/total count. The title gets its own full-width line so long single-word
// names (DRAGONLORD, PROMOTIONAL) never clip. Tapping a plate drills into that set's
// ledger/binder. Completion is over the WHOLE catalog (buildSetCompletion), non-foil only,
// independent of any search/filter in the drill. Vector + text carry the meaning, so a
// heroless/zero-image plate stays legible via an engraved initial.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { getCatalog } from '../store/catalogCache.js';
import { ownedBySet, subscribeCollection } from '../store/ownedRepository.js';
import { buildSetCompletion } from '../store/setCompletion.js';
import { setHeroUrl } from '../store/cardArt.js';
import { SET_LABEL } from '../store/sets.js';
import Ring from '../components/Ring.jsx';
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

// The completion Ring, housing owned/total as a stacked fraction (no percentage).
function CountRing({ pct, owned, total, size = 50 }) {
  return (
    <span style={{ flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '50%',
      background: 'radial-gradient(closest-side, var(--ring-halo), transparent 76%)' }}>
      <Ring value={pct} size={size} stroke={4} color="var(--accent-ruby)">
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
          <span style={{ font: `600 ${Math.round(size * 0.23)}px/1 var(--f-mono)`, color: 'var(--ink-head)' }}>{fmt(owned)}</span>
          <span style={{ width: Math.round(size * 0.3), height: 1, background: 'var(--hair-30)', margin: '2px 0' }} />
          <span style={{ font: `400 ${Math.round(size * 0.155)}px/1 var(--f-mono)`, color: 'var(--ink-muted)' }}>{fmt(total)}</span>
        </span>
      </Ring>
    </span>
  );
}

function Plate({ s, onOpen }) {
  const hero = setHeroUrl(s.code);
  const boxed = BOXED.has(s.code);
  const has = s.ownedUnique > 0;                 // owned set vs empty set
  const pct = s.pct;
  const countColor = has ? 'var(--gold-num)' : 'var(--ink-muted-warm)';
  const labelColor = has ? 'var(--ink-muted-warm)' : 'var(--ink-dimmest)';
  return (
    <button type="button" onClick={() => onOpen(s.code, s)} style={tileStyle(has)}>
      {/* corner completion ring - the tile's single completion indicator */}
      <span style={{ position: 'absolute', top: 10, right: 10 }}>
        {/* Ring strokes are in its 40-unit viewBox, so scale to render 3.5px at 44px. */}
        <Ring value={pct} size={44} stroke={3.5 * 40 / 44} track="var(--ring-track-neutral)"
          color={pct > 0 ? 'var(--completion)' : 'transparent'}>
          <span style={{ font: "700 11px/1 var(--f-display)", color: pct > 0 ? 'var(--ink-head)' : 'var(--ink-muted-warm)' }}>
            {Math.round(pct * 100)}%
          </span>
        </Ring>
      </span>

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

  return (
    <div style={{ padding: '0 20px 150px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '8px 2px 20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--accent-ruby)' }}>Collection</div>
          <div style={{ font: "700 22px/1.1 var(--f-display)", letterSpacing: '.06em', color: 'var(--ink-head)', margin: '6px 0' }}>Sets</div>
          <div style={{ font: "400 11px/1 var(--f-ui)", letterSpacing: '.06em', color: 'var(--ink-muted)' }}>non-foil owned</div>
        </div>
        <CountRing pct={totals.pct} owned={totals.owned} total={totals.total} size={64} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {completion.map((s) => <Plate key={s.code} s={s} onOpen={onOpenSet} />)}
      </div>
    </div>
  );
}
