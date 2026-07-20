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

// Per-set art treatment: 004 ships an opaque panel (feather its edge into the plate);
// 005/006 are self-luminous with a baked glow (dim the backlight so they don't bloom).
const BOXED = new Set(['004']);
const BRIGHT = new Set(['005', '006']);

const PLATE = {
  position: 'relative', overflow: 'hidden', width: '100%', cursor: 'pointer',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: 12, borderRadius: 12,
  background: 'linear-gradient(180deg, var(--plate-1), var(--plate-2))',
  border: '1px solid var(--edge-plate)',
  boxShadow: 'var(--shadow-plate), inset 0 1px 0 rgba(233,212,154,.05)',
};
const HERO = { position: 'relative', width: '100%', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' };
// minHeight keeps the Ring on a shared baseline whether the title runs one line or two.
const TITLE = {
  marginTop: 10, minHeight: 32, textAlign: 'center',
  font: "600 12.5px/1.25 var(--f-display)", letterSpacing: '.1em', textTransform: 'uppercase',
  color: 'var(--gold-leaf)', overflowWrap: 'anywhere',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
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
  const bright = BRIGHT.has(s.code);
  return (
    <button type="button" onClick={() => onOpen(s.code, s)} style={PLATE}>
      <div style={HERO}>
        <span aria-hidden="true" style={{ position: 'absolute', inset: '-42% -10%', pointerEvents: 'none',
          background: `radial-gradient(56% 66% at 50% 52%, ${bright ? 'var(--glow-warm-dim)' : 'var(--glow-warm)'}, transparent 72%)` }} />
        {hero ? (
          <img src={hero} alt="" aria-hidden="true" onError={hideOnErr}
            style={{ position: 'relative', maxWidth: boxed ? '74%' : '84%', maxHeight: '100%', objectFit: 'contain', display: 'block',
              ...(boxed ? { borderRadius: 7, boxShadow: '0 0 0 1px rgba(0,0,0,.4), 0 0 16px 9px rgba(10,8,5,.55)' } : {}) }} />
        ) : (
          // heroless / zero-image: engraved display initial where the art would be
          <span style={{ position: 'relative', font: "700 40px/1 var(--f-display)", color: '#171209', letterSpacing: '.04em',
            textShadow: '0 1px 0 rgba(233,212,154,.12), 0 -1px 1px rgba(0,0,0,.9)' }}>
            {(s.name || '?').charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div style={TITLE}>{s.name}</div>
      <div style={{ marginTop: 8 }}>
        <CountRing pct={s.pct} owned={s.ownedUnique} total={s.totalCollectible} />
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
        {completion.map((s) => <Plate key={s.code} s={s} onOpen={onOpenSet} />)}
      </div>
    </div>
  );
}
