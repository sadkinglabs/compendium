// THE screen-header primitive (nav/search cohesion Phase 5). One chassis, three
// variants, replacing the audit's six screen-level header families and their
// eight hand-typed Cinzel title recipes with a 3-step scale:
//   root - the pillar title. An <h1> at 27px, pinned above the scroller, no chrome.
//   sub  - back + [lead] + eyebrow/title/meta + trailing. 22px/700/.06em title.
//          `sticky` wraps the row in the promoted frost band (the recipe
//          CollectionSubHeader proved: STATIC near-black frost + gold hairline -
//          the Codex-required either/or was decided for static, no scroll-state
//          machinery). Sticky bands carry data-rail-sticky so the A-Z rail can
//          measure their bottom edge as its top floor.
//   mode - a thin editing banner: a leading action + right-aligned accent
//          eyebrow · 13px title.
// Deliberate boundaries (documented in DESIGN_SYSTEM §3): sheet titles belong to
// the sheet chassis (GothicSheet/BottomSheet/.ob-header), and the AvatarPicker
// keeps its sanctioned green-scope header. Those are not screen app bars.
//
// Route-aware focus (the a11y contract's forward half): a sub bar with
// `announce` moves focus to its heading on mount, so TalkBack hears the new
// screen. Back-restore of the initiating control is deferred until it can be
// TalkBack-verified on device.
import React, { useEffect, useRef } from 'react';

const NOWRAP = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const BAND = {
  position: 'sticky', top: 0, zIndex: 6, margin: '0 -20px 10px', padding: '8px 20px 12px',
  background: 'rgba(0,0,0,.92)', backdropFilter: 'blur(12px)',
  borderBottom: '1px solid var(--hair-12)',
};

/** The one back affordance: a 44px gold circle + house chevron (family B2,
 *  promoted). Negative margin keeps existing header layouts optically tight
 *  while the touch box stays on the floor. */
export function BackButton({ onClick, label = 'Back', margin = -3 }) {
  return (
    <button onClick={onClick} aria-label={label} className="cx-press" style={{
      width: 44, height: 44, margin, flex: 'none', borderRadius: '50%', cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--gold-leaf)', background: 'transparent', border: '1px solid var(--hair-40)',
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
  );
}

export default function AppBar({
  variant = 'root', sticky = false, bandMargin,       // sticky sub band; bandMargin overrides the bleed (drill cancels the root 4px)
  onBack, backLabel = 'Back',
  lead = null,                                        // node between back and the text block (e.g. the completion Ring)
  eyebrow, eyebrowColor = 'var(--gold-leaf)',         // small caps line; colour is the pillar accent - chrome only
  title, meta, metaLive = false, metaEmphasis = false, // meta = the small mono line under the title
  trailing = null, leading = null,                    // mode: leading action node
  announce = false,
}) {
  const headingRef = useRef(null);
  useEffect(() => {
    if (announce) headingRef.current?.focus?.({ preventScroll: true });
  }, [announce]);

  if (variant === 'root') {
    return (
      <div style={{ padding: '4px 20px 12px' }}>
        <h1 style={{ font: "600 27px/1 var(--f-display)", color: 'var(--ink-head)', margin: 0 }}>{title}</h1>
      </div>
    );
  }

  if (variant === 'mode') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 12px', minHeight: 48 }}>
        {leading}
        <div ref={headingRef} tabIndex={announce ? -1 : undefined} style={{ flex: 1, minWidth: 0, textAlign: 'right', outline: 'none' }}>
          <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.18em', color: eyebrowColor }}>{eyebrow}</span>
          <span style={{ font: "600 13px/1.25 var(--f-display)", color: 'var(--gold-num)' }}> · {title}</span>
        </div>
      </div>
    );
  }

  // variant === 'sub'
  const row = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
      {onBack && <BackButton onClick={onBack} label={backLabel} />}
      {lead}
      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.22em', textTransform: 'uppercase', color: eyebrowColor, marginBottom: 6, ...NOWRAP }}>{eyebrow}</div>
        )}
        <h2 ref={headingRef} tabIndex={announce ? -1 : undefined}
          style={{ font: "700 22px/1.1 var(--f-display)", letterSpacing: '.06em', color: 'var(--ink-head)', margin: 0, outline: 'none', ...NOWRAP }}>{title}</h2>
        {meta != null && (
          <div aria-live={metaLive ? 'polite' : undefined}
            style={{ font: `${metaEmphasis ? 600 : 400} 11.5px/1 var(--f-mono)`, letterSpacing: '.04em', color: metaEmphasis ? 'var(--gold-leaf)' : 'var(--ink-muted)', marginTop: 5, ...NOWRAP }}>
            {meta}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );

  if (!sticky) return <div style={{ padding: '4px 20px 12px' }}>{row}</div>;
  return <div data-rail-sticky style={{ ...BAND, ...(bandMargin ? { margin: bandMargin } : null) }}>{row}</div>;
}
