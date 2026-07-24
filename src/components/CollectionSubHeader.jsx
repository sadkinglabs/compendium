// The pinned sub-header shared by BOTH My-Collection views (Sets landing + All grid), so the two are
// pixel-identical in size AND colour - the earlier drift (All had a band, Sets didn't; All's warm band
// cut a panel out of the fixed maroon wash) came from two hand-rolled headers. One component removes it.
//
// The band is a NEUTRAL near-black frost (the page base is pure #000 with a fixed radial wash behind
// everything at z-index -1; a warm brown band clashed with the ruby wash, a neutral one blends). It is
// opaque enough to hide cards scrolling underneath while `backdrop-filter` softens the seam. Marked
// data-rail-sticky so the A-Z rail measures its bottom edge as the top floor. Every text line is
// single-line (nowrap + ellipsis) so a wider action pill or a long count can never wrap and grow it.
import React from 'react';

const BAND = {
  position: 'sticky', top: 0, zIndex: 6, margin: '0 -20px 10px', padding: '8px 20px 12px',
  background: 'rgba(0,0,0,.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
  borderBottom: '1px solid var(--hair-12)',
};
const NOWRAP = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

export default function CollectionSubHeader({ title, tally, tallyLive = false, tallyEmphasis = false, action = null }) {
  return (
    <div data-rail-sticky style={BAND}>
      {/* minHeight reserves the action pill's footprint so its presence/absence never resizes the row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--accent-ruby)', ...NOWRAP }}>Collection</div>
          <div style={{ font: "700 22px/1.1 var(--f-display)", letterSpacing: '.06em', color: 'var(--ink-head)', margin: '6px 0', ...NOWRAP }}>{title}</div>
          <div aria-live={tallyLive ? 'polite' : undefined}
            style={{ font: `${tallyEmphasis ? 600 : 400} 11.5px/1 var(--f-mono)`, letterSpacing: '.04em', color: tallyEmphasis ? 'var(--gold-leaf)' : 'var(--ink-muted)', ...NOWRAP }}>
            {tally}
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}
