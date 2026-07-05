// Shared UI vocabulary - one definition each, reused across pillars (handoff §3/§6).
import React from 'react';
import { elementIconUrl } from '../store/cardArt.js';
import { GLYPH_ICON } from './icons.jsx';

/* Sheet button recipes - one source of truth for the black-glass primary and
   the ghost secondary used across every sheet (was copy-pasted in 6 files). */
export const BTN_GOLD = { padding: '12px 18px', borderRadius: 12, background: 'rgba(18,16,13,.85)', color: 'var(--gold-leaf)', font: "700 13px/1 var(--f-ui)", border: '1px solid rgba(220,184,111,.45)', cursor: 'pointer', flex: 'none' };
export const BTN_GHOST = { padding: '12px 0', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 13px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' };

/* The app's ONE blank-state block (the Decks-library look): a rotated diamond
   in the pillar's hue, a Cinzel title, a Garamond line, optional action.
   `hue` is "r,g,b" - decks violet "160,110,220", play jade "143,211,168". */
export function BlankState({ hue = '220,184,111', title, body, action, minHeight = '52vh' }) {
  return (
    <div style={{ minHeight, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 }}>
      <div style={{ width: 52, height: 52, border: `2px solid rgba(${hue},.28)`, transform: 'rotate(45deg)', marginBottom: 32, boxShadow: `0 0 28px rgba(${hue},.18)` }} />
      <h2 style={{ font: "600 20px/1.2 'Cinzel',Georgia,serif", color: '#dcb86f', marginBottom: 10 }}>{title}</h2>
      {body && <p style={{ font: "400 15px/1.6 'EB Garamond',Georgia,serif", color: 'var(--ink-muted)', marginBottom: action ? 24 : 0 }}>{body}</p>}
      {action}
    </div>
  );
}

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
  // Known glyphs render as the house SVG icon; anything else falls back to the
  // raw glyph (semantic bullets like §/◈ stay as-is).
  const Icon = GLYPH_ICON[glyph];
  return (
    <button
      onClick={onClick} title={title} aria-label={title} className="cx-iconbtn"
      style={{
        width: size, height: size, flex: 'none', position: 'relative',
        borderRadius: shape === 'circle' ? '50%' : 8,
        border: '1px solid var(--hair-40)', background: 'transparent',
        color, font: '15px/1 var(--f-ui)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {Icon ? <Icon style={{ width: Math.round(size * 0.46), height: Math.round(size * 0.46) }} /> : glyph}
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

/* Quiet shared loading beat - one treatment for every pillar's "fetching" gap. */
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

/* Focus trap for modal surfaces - moves focus into the panel on open, keeps Tab
   cycling inside it, and restores focus to the opener on close. Accessibility
   for keyboard / switch-access users; a no-op for touch. */
export function useFocusTrap(active) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!active || !ref.current) return;
    const panel = ref.current;
    const opener = document.activeElement;
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const first = panel.querySelector(sel);
    if (first) setTimeout(() => first.focus?.(), 0);
    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const items = [...panel.querySelectorAll(sel)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], b = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
      else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
    };
    panel.addEventListener('keydown', onKey);
    return () => { panel.removeEventListener('keydown', onKey); try { opener?.focus?.(); } catch { /* gone */ } };
  }, [active]);
  return ref;
}

/* Bottom sheet - scrim + slide-up panel. */
export function BottomSheet({ open, title, onClose, children }) {
  const trapRef = useFocusTrap(open);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 200, animation: 'cxfade .2s ease' }} />
      <div ref={trapRef} role="dialog" aria-modal="true" aria-label={title || 'Dialog'} style={{
        position: 'fixed', left: 0, right: 0, bottom: 'var(--kb,0px)', zIndex: 201,
        background: 'var(--surface-sheet)', borderTop: '1px solid var(--hair-30)',
        borderRadius: '26px 26px 0 0', padding: '14px 22px 26px',
        boxShadow: '0 -20px 50px -10px rgba(0,0,0,.5)', animation: 'cxsheet .28s cubic-bezier(.2,.9,.3,1)',
        maxHeight: '76%', overflowY: 'auto', transition: 'bottom .2s ease',
      }} className="cx-scroll">
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--hair-30)', margin: '0 auto 14px' }} />
        {title && <div style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)', textAlign: 'center', marginBottom: 16 }}>{title}</div>}
        {children}
      </div>
    </>
  );
}

/* Rich text: [[Name]] -> tappable link; first letter -> drop-cap. */
// Wrap any saved-highlight substrings inside a plain text run with a tinted
// <mark>. `hue` = 'gold' (rules) | 'violet' (cards). Longest marks first so a
// mark that contains another wins.
function markRuns(text, marks, hue, kctr) {
  if (!marks || !marks.length) return [text];
  const esc = [...marks].sort((a, b) => b.length - a.length).map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('(' + esc.join('|') + ')', 'g');
  const cls = hue === 'violet' ? 'cx-hl-violet' : 'cx-hl-gold';
  return text.split(re).filter((p) => p !== '').map((p) => (
    marks.includes(p) ? <mark key={kctr.k++} className={cls}>{p}</mark> : <React.Fragment key={kctr.k++}>{p}</React.Fragment>
  ));
}

// Inline renderer: [[Name]] → tappable link (gold for rules, violet for cards),
// with optional highlight marks on the plain runs between links.
export function inlineNodes(text, onOpenName, hue = 'gold', marks) {
  // Normalise any em dashes in reference text (card rules / articles) to spaced
  // hyphens - we never render an em dash, even from source data.
  const clean = String(text || '').replace(/\s*—\s*/g, ' - ');
  const linkClass = hue === 'violet' ? 'cx-inlink cx-inlink-violet' : 'cx-inlink cx-inlink-gold';
  const nodes = [];
  const kctr = { k: 0 };
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0, m;
  while ((m = re.exec(clean))) {
    if (m.index > last) nodes.push(...markRuns(clean.slice(last, m.index), marks, hue, kctr));
    const name = m[1];
    nodes.push(<span key={kctr.k++} className={linkClass} onClick={() => onOpenName?.(name)}>{name}</span>);
    last = m.index + m[0].length;
  }
  if (last < clean.length) nodes.push(...markRuns(clean.slice(last), marks, hue, kctr));
  return nodes;
}

// A formatted article: renders formatArticle() blocks (paragraphs + lists) with
// inline links + highlight marks. `lead` drop-caps the first paragraph.
export function Article({ blocks, onOpenName, lead, hue = 'gold', marks }) {
  return (
    <div className="cx-article">
      {(blocks || []).map((b, i) => {
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type === 'ol' ? 'ol' : 'ul';
          return <List key={i} className="cx-article-list">{b.items.map((it, j) => <li key={j}>{inlineNodes(it, onOpenName, hue, marks)}</li>)}</List>;
        }
        const dc = lead && i === 0;
        return <p key={i} className={`cx-article-p${dc ? ' lead' : ''}`}>{inlineNodes(b.text, onOpenName, hue, marks)}</p>;
      })}
    </div>
  );
}

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
