// Shared UI vocabulary — one definition each, reused across pillars (handoff §3/§6).
import React from 'react';
import { elementIconUrl } from '../store/cardArt.js';

/* One chip language everywhere: filled-gold active, ghost inactive. */
export function Chip({ label, active, onClick, dot }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 18, cursor: 'pointer',
        font: "600 13px/1 var(--f-ui)", whiteSpace: 'nowrap',
        background: active ? 'var(--gold-leaf)' : 'var(--tint-07)',
        color: active ? '#1a1410' : 'var(--ink-status)',
        border: `1px solid ${active ? 'var(--gold-leaf)' : 'rgba(201,163,90,.2)'}`,
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />}
      {label}
    </button>
  );
}

export function ChipRow({ children, style }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', ...style }}>{children}</div>;
}

export function IconButton({ glyph, onClick, tone = 'gold', shape = 'circle', size = 28, title }) {
  const color = tone === 'danger' ? 'var(--destructive)' : tone === 'muted' ? 'var(--ink-muted)' : 'var(--gold-leaf)';
  return (
    <button
      onClick={onClick} title={title}
      style={{
        width: size, height: size, flex: 'none',
        borderRadius: shape === 'circle' ? '50%' : 8,
        border: '1px solid var(--hair-40)', background: 'transparent',
        color, font: '15px/1 var(--f-ui)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {glyph}
    </button>
  );
}

export function SectionLabel({ glyph, label, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 11 }}>
      <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--gold-leaf)' }}>
        {glyph ? glyph + ' ' : ''}{label}
      </span>
      {count != null && (
        <span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{count}</span>
      )}
    </div>
  );
}

export function ListRow({ icon, iconBg, title, sub, trailing, note, onClick }) {
  return (
    <div
      onClick={onClick} className="cx-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 4px',
        borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', minHeight: 48,
      }}
    >
      {icon != null && (
        <span style={{
          width: 34, height: 34, flex: 'none', borderRadius: 9,
          border: '1px solid var(--hair-16)', background: iconBg || 'var(--surface-well)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: "600 13px/1 var(--f-display)", color: 'var(--list-accent, var(--gold))',
        }}>{icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ font: "600 16px/1.15 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          {note && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--list-accent, var(--gold-leaf))', flex: 'none', boxShadow: '0 0 6px var(--list-glow, rgba(201,163,90,.5))' }} />}
        </div>
        {sub && <div style={{ font: "500 11px/1 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 4 }}>{sub}</div>}
      </div>
      {trailing != null ? trailing : <span style={{ color: 'var(--ink-faint)', fontSize: 16 }}>›</span>}
    </div>
  );
}

/* Horizontal swipe between paired views (native feel). Ignores gestures that
   start on inputs, sheets, modals or horizontal scrollers (they own their own
   horizontal motion), and only fires on decisively horizontal swipes. */
export function useSwipe(onLeft, onRight, { threshold = 56 } = {}) {
  const start = React.useRef(null);
  const onTouchStart = (e) => {
    if (e.target.closest('input, textarea, .cx-deck-carousel, .picker-decks-row, .a-sheet, .a-sheet-scrim, .vc-modal-overlay, .fab-menu, .ds-grid')) { start.current = null; return; }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!start.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.current.x, dy = t.clientY - start.current.y;
    start.current = null;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (dx < 0) onLeft?.(); else onRight?.();
  };
  return { onTouchStart, onTouchEnd };
}

/* Quiet shared loading beat — one treatment for every pillar's "fetching" gap. */
export function Loading({ pad = 24 }) {
  return <div style={{ padding: pad, textAlign: 'center', color: 'var(--ink-faint)', font: "400 14px/1 var(--f-read)", fontStyle: 'italic', letterSpacing: '.2em' }} aria-label="Loading">· · ·</div>;
}

export function ThresholdPips({ runs, size = 12 }) {
  if (!runs?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {runs.map((r, i) => <ElementPip key={i} el={r.el} color={r.c} size={size} />)}
    </span>
  );
}

// Real element/threshold icon (from public/icons), falling back to the ▲ glyph
// in the element colour when the asset is missing or images are suppressed (§5).
function ElementPip({ el, color, size }) {
  const [broken, setBroken] = React.useState(false);
  const url = el ? elementIconUrl(el) : null;
  if (url && !broken) {
    return <img src={url} width={size} height={size} alt={el} onError={() => setBroken(true)}
      style={{ display: 'inline-block', verticalAlign: 'middle', objectFit: 'contain' }} />;
  }
  return <span style={{ fontSize: size - 1, lineHeight: 1, color: color || '#9aa6b2' }}>▲</span>;
}

/* Bottom sheet — scrim + slide-up panel. */
export function BottomSheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 200, animation: 'cxfade .2s ease' }} />
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 201,
        background: 'var(--surface-sheet)', borderTop: '1px solid var(--hair-30)',
        borderRadius: '26px 26px 0 0', padding: '14px 22px 26px',
        boxShadow: '0 -20px 50px -10px rgba(0,0,0,.5)', animation: 'cxsheet .28s cubic-bezier(.2,.9,.3,1)',
        maxHeight: '76%', overflowY: 'auto',
      }} className="cx-scroll">
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--hair-30)', margin: '0 auto 14px' }} />
        {title && <div style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)', textAlign: 'center', marginBottom: 16 }}>{title}</div>}
        {children}
      </div>
    </>
  );
}

/* Rich text: [[Name]] -> tappable link; first letter -> drop-cap. */
export function RichText({ text, onOpenName, lead }) {
  const clean = String(text || '').replace(/\r/g, '').replace(/\n+/g, ' ').trim();
  const parts = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(clean))) {
    if (m.index > last) parts.push({ t: clean.slice(last, m.index), k: key++ });
    parts.push({ link: m[1], k: key++ });
    last = m.index + m[0].length;
  }
  if (last < clean.length) parts.push({ t: clean.slice(last), k: key++ });

  let dropped = false;
  return (
    <p style={{ margin: '0 0 15px', font: "400 16.5px/1.62 var(--f-read)", color: 'var(--ink-body-2)' }}>
      {parts.map((p) => {
        if (p.link) {
          return (
            <span key={p.k} onClick={() => onOpenName?.(p.link)}
              style={{ color: 'var(--link-violet)', borderBottom: '1px solid rgba(199,154,208,.4)', cursor: 'pointer' }}>
              {p.link}
            </span>
          );
        }
        if (lead && !dropped && p.t.trim()) {
          dropped = true;
          const ch = p.t.trimStart()[0];
          const rest = p.t.trimStart().slice(1);
          return (
            <React.Fragment key={p.k}>
              <span style={{ float: 'left', font: "600 47px/0.76 var(--f-display)", color: 'var(--gold)', margin: '5px 11px 0 0', textShadow: '0 2px 14px rgba(207,154,74,.3)' }}>{ch}</span>
              <span>{rest}</span>
            </React.Fragment>
          );
        }
        return <span key={p.k}>{p.t}</span>;
      })}
    </p>
  );
}
