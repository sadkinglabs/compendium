// Shared UI vocabulary - one definition each, reused across pillars (handoff §3/§6).
import React from 'react';
import { elementIconUrl } from '../store/cardArt.js';
import { GLYPH_ICON } from './icons.jsx';
import { registerBackConsumer } from '../back.js';
import GothicSheet from './GothicSheet.jsx';   // the one bottom-sheet chassis (BottomSheet is a thin titled adapter over it)

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
// The app's tab/filter pill: gilt-gradient gold when active, flat dark when not
// (the Manuscript pattern shared across Collection / Decks / Codex).
export function Chip({ label, active, onClick, dot }) {
  return (
    <button
      onClick={onClick} aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 16px', borderRadius: 18, cursor: 'pointer',
        font: "600 13px/1 var(--f-ui)", whiteSpace: 'nowrap',
        background: active ? 'linear-gradient(180deg, #d8b872, #b8954f)' : 'rgba(42,33,20,.5)',
        color: active ? '#1a1206' : '#c9bda6',
        border: `1px solid ${active ? '#e3c589' : '#4a3c22'}`,
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

// Section rubric - Cinzel gold caps trailed by a fade hairline that fills the
// row, with an optional count sitting at the far right. The Manuscript header
// shared by the Codex article view and the Collection ownership control.
export function SectionLabel({ label, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <span style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.22em', color: '#cba75f', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#4a3c22,transparent)' }} />
      {count != null && (
        <span style={{ font: "600 15px/1 var(--f-display)", color: '#c9b487' }}>{count}</span>
      )}
    </div>
  );
}

// One flat text-ledger row (search results): EB Garamond title, warm hairline
// separator, a quiet chevron - the Manuscript row shared with the Codex/deck
// listings. The 34px entity-icon slot + geometry are kept so it lines up with
// CardRow in a mixed result list; the per-pillar --list-accent still tints it.
export function ListRow({ icon, iconBg, title, sub, trailing, note, onClick }) {
  return (
    <div
      onClick={onClick} className="cx-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 4px',
        borderBottom: '1px solid rgba(74,60,34,.3)', cursor: 'pointer', minHeight: 48,
      }}
    >
      {icon != null && (
        <span style={{
          width: 34, height: 34, flex: 'none', borderRadius: 9,
          border: '1px solid rgba(255,255,255,.1)', background: iconBg || 'rgba(20,16,10,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: "600 13px/1 var(--f-display)", color: 'var(--list-accent, #cba75f)',
        }}>{icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ font: "600 16.5px/1.2 var(--f-read)", color: '#efe7d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          {note && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--list-accent, #cba75f)', flex: 'none', boxShadow: '0 0 6px var(--list-glow, rgba(203,167,95,.5))' }} />}
        </div>
        {sub && <div style={{ font: "400 12.5px/1 var(--f-read)", color: '#8a8175', marginTop: 5 }}>{sub}</div>}
      </div>
      {trailing != null ? trailing : <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#5c554b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }} aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>}
    </div>
  );
}

/* Horizontal swipe between paired views (native feel). Ignores gestures that
   start on inputs, sheets, modals or horizontal scrollers (they own their own
   horizontal motion), and only fires on decisively horizontal swipes. */
export function useSwipe(onLeft, onRight, { threshold = 56 } = {}) {
  const start = React.useRef(null);
  const onTouchStart = (e) => {
    if (e.target.closest('input, textarea, .cx-deck-carousel, .picker-decks-row, .a-sheet, .a-sheet-scrim, .fsheet, .fsheet-scrim, .cx-picker-modal, #counter-screen, .vc-modal-overlay, .fab-menu, .ds-grid')) { start.current = null; return; }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!start.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.current.x, dy = t.clientY - start.current.y;
    start.current = null;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    // A callback returns true when it CONSUMES the swipe (paged an inner view). When
    // it does, stop the touchend bubbling so an ancestor swipe (e.g. cross-pillar)
    // doesn't ALSO fire. At an inner boundary the callback returns falsy and the
    // gesture bubbles up - that's what lets a swipe chain from a pane out to a pillar.
    const consumed = dx < 0 ? onLeft?.() : onRight?.();
    if (consumed) e.stopPropagation();
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

/* Titled bottom sheet - a thin adapter over the canonical GothicSheet chassis
   (portal, drag-to-dismiss, gold hairline, grab handle), with an optional
   centered Cinzel title. One chassis app-wide; Sheet.jsx is the same adapter. */
export function BottomSheet({ open, title, onClose, children }) {
  return (
    <GothicSheet open={open} onClose={onClose} label={title || 'Dialog'}>
      {title && <div style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)', textAlign: 'center', margin: '0 0 16px' }}>{title}</div>}
      {children}
    </GothicSheet>
  );
}

// Centered modal chassis (scrim + black-gold box + optional close X). Was inlined
// byte-for-byte in 4 places; this is the single source. `boxStyle` overrides the
// box for per-modal needs (maxWidth, padding, overflow, a violet chassis). Adds a
// focus trap + hardware-back close for free.
export function CenteredModal({ open, label, maxWidth = 360, onClose, closeButton = true, boxStyle, children }) {
  const trapRef = useFocusTrap(open);
  const closeRef = React.useRef(onClose); closeRef.current = onClose;
  React.useEffect(() => { if (open) return registerBackConsumer(() => { closeRef.current?.(); return true; }); }, [open]);
  if (!open) return null;
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={label}
      style={{ position: 'fixed', inset: 0, zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 24px calc(24px + var(--kb,0px) / var(--ui-scale,1))', background: 'rgba(4,3,2,.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', animation: 'cxfade .18s ease' }}>
      <div ref={trapRef} onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth, borderRadius: 20, background: 'linear-gradient(180deg,#151109,#0b0806)', border: '1px solid var(--hair-24)', boxShadow: '0 24px 64px rgba(0,0,0,.7)', ...boxStyle }}>
        {closeButton && (
          <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--hair-22)', background: 'rgba(0,0,0,.3)', color: 'var(--ink-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

// One-line empty state (the "No X yet" italic recipe, ~15 inlined copies). For a
// full-pane empty use BlankState; this is the inline/section variant, with an
// optional gold "cta ›" action. `size` preserves each call site's exact size.
export function EmptyCta({ text, cta, onClick, size = 13, pad = '4px 0' }) {
  return (
    <div style={{ font: `400 ${size}px/1.6 var(--f-read)`, color: 'var(--ink-faint)', fontStyle: 'italic', padding: pad, textAlign: cta ? 'left' : 'center' }}>
      {text}{cta && <> <span onClick={onClick} style={{ color: 'var(--gold-leaf)', fontStyle: 'normal', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' }}>{cta} ›</span></>}
    </div>
  );
}

/* RuleArticle - renders a compiled Codex Document (canon + typed link spans +
   blocks) produced by the build-time compiler. The renderer is a PURE projection:
   it holds no source of truth, invents no structure, and works entirely in canon
   character offsets. Inline content is decomposed into flat runs at link and
   highlight boundaries (an interval sweep, never nested <mark>s), so overlapping
   decorations are a set on a run. Highlight ranges come from RESOLVED annotation
   canon offsets (annotations.js), never from matching text - so duplicate words
   can't cross-mark and overlaps are exact. */

// canon[s,e] -> flat runs at link + annotation boundaries; each run carries its
// covering link (or null) and the SET of annotations covering it (interval sweep;
// arbitrary overlap is a set on a run, never nested <mark>s).
function runsFor(canon, s, e, links, annRanges) {
  const clip = (x) => Math.max(s, Math.min(e, x));
  const L = links.filter((l) => l.end > s && l.start < e).map((l) => ({ ...l, start: clip(l.start), end: clip(l.end) }));
  const H = annRanges.filter((r) => r.end > s && r.start < e).map((r) => ({ ...r, start: clip(r.start), end: clip(r.end) }));
  const bounds = new Set([s, e]);
  for (const x of [...L, ...H]) { bounds.add(x.start); bounds.add(x.end); }
  const pts = [...bounds].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b <= a) continue;
    runs.push({ start: a, end: b, link: L.find((l) => l.start <= a && l.end >= b) || null, anns: H.filter((r) => r.start <= a && r.end >= b) });
  }
  return runs;
}

const markClass = (ann) => (ann && ann.color === 'violet' ? 'cx-hl-violet' : 'cx-hl-gold');

// Render canon[span] (default: whole string) as flat runs: in-text links (all gold;
// the link's target drives navigation, not colour) plus highlight marks from
// resolved annotation canon RANGES. A run under both a link and an annotation nests
// the <mark> inside the link span. Exported so FAQ text renders links the same way.
export function InlineText({ canon, links = [], span, annRanges = [], onOpenLink }) {
  const [s, e] = span || [0, canon.length];
  const runs = runsFor(canon, s, e, links, annRanges);
  return runs.map((r) => {
    const text = canon.slice(r.start, r.end);
    const ann = r.anns[0];
    const ids = r.anns.length ? r.anns.map((x) => x.id).join(' ') : undefined;
    if (r.link) return <span key={r.start} className="cx-inlink cx-inlink-gold" data-off={r.start} onClick={() => onOpenLink?.(r.link.name, r.link.target)}>{ann ? <mark className={markClass(ann)} data-ann={ids}>{text}</mark> : text}</span>;
    if (ann) return <mark key={r.start} className={markClass(ann)} data-off={r.start} data-ann={ids}>{text}</mark>;
    return <React.Fragment key={r.start}>{text}</React.Fragment>;   // bare text keeps ::first-letter drop-cap intact
  });
}

function DocBlock({ canon, block, links, annRanges, onOpenLink }) {
  const inline = (span) => <InlineText canon={canon} links={links} span={span} annRanges={annRanges} onOpenLink={onOpenLink} />;
  switch (block.type) {
    case 'ol':
    case 'ul': {
      const List = block.type === 'ol' ? 'ol' : 'ul';
      return <List className="cx-article-list" data-block-id={block.id}>{block.items.map((it) => <li key={it.id} data-block-id={it.id}>{inline(it.span)}</li>)}</List>;
    }
    case 'note':
    case 'example':
    case 'warning':
      return <aside className={`cx-callout cx-callout-${block.type}`} data-block-id={block.id}>{inline(block.span)}</aside>;
    case 'heading':
      return <h3 className="cx-article-h" id={block.slug || undefined} data-block-id={block.id}>{inline(block.span)}</h3>;
    default:
      return <p className={`cx-article-p${block.lead ? ' lead' : ''}`} data-block-id={block.id}>{inline(block.span)}</p>;
  }
}

// `annotations` = RESOLVED ranges for THIS doc: [{ id, color, start, end }] (canon
// offsets). data-doc-* lets selection capture map a DOM point back to this doc.
export function RuleArticle({ doc, annotations = [], onOpenLink }) {
  if (!doc) return null;
  return (
    <div className="cx-article" data-doc-type={doc.docType} data-doc-id={doc.docId}>
      {doc.blocks.map((b) => (
        <DocBlock key={b.id} canon={doc.canon} block={b} links={doc.links} annRanges={annotations} onOpenLink={onOpenLink} />
      ))}
    </div>
  );
}
