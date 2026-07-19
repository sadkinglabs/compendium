// Collection · My Collection landing (Collection UX redesign, Phase 1c).
// Sets-are-home / completion-is-goal: a grid of set plates, each a completion Ring over
// owned/total for that set, plus a total-completion header. Tapping a plate drills into
// that set's ledger/binder (the parent swaps in <Cards setDrill=…>). Completion is over
// the WHOLE catalog (buildSetCompletion), independent of any search/filter in the drill.
// Vector + text only → zero-image safe by construction.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { getCatalog } from '../store/catalogCache.js';
import { ownedBySet, subscribeCollection } from '../store/ownedRepository.js';
import { buildSetCompletion } from '../store/setCompletion.js';
import { SET_LABEL } from '../store/sets.js';
import Ring from '../components/Ring.jsx';
import { Loading } from '../components/ui.jsx';

const fmt = (n) => (n || 0).toLocaleString('en-US');
const pctLabel = (p) => `${(p * 100).toFixed(1)}%`;

const PLATE = {
  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
  padding: '16px 14px 14px', borderRadius: 16, background: 'var(--surface-card)',
  border: '1px solid var(--hair-12)', boxShadow: '0 12px 30px -16px rgba(0,0,0,.7)',
};
const PLATE_NAME = {
  display: 'block', font: "700 13px/1.3 var(--f-display)", letterSpacing: '.1em',
  textTransform: 'uppercase', color: 'var(--ink-head)', minHeight: 34,
};

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '10px 2px 20px' }}>
        <Ring value={totals.pct} size={46} stroke={4} color="var(--accent-ruby)" showPct={false} />
        <div>
          <div style={{ font: "400 20px/1 var(--f-mono)", color: 'var(--ink-head)' }}>{fmt(totals.owned)} / {fmt(totals.total)}</div>
          <div style={{ font: "400 12px/1.4 var(--f-ui)", color: 'var(--ink-muted)', letterSpacing: '.04em', marginTop: 3 }}>
            cards owned · {pctLabel(totals.pct)}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {completion.map((s) => (
          <button key={s.code} type="button" onClick={() => onOpenSet(s.code, s)} style={PLATE}>
            <span style={PLATE_NAME}>{s.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 2px' }}>
              <Ring value={s.pct} size={52} stroke={5} color="var(--accent-ruby)" />
              <span style={{ font: "400 12.5px/1.3 var(--f-mono)", color: 'var(--ink-body-2)' }}>
                {fmt(s.ownedUnique)} / {fmt(s.totalCollectible)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
