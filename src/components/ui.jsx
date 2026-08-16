// Shared UI vocabulary - one definition each, reused across pillars (architecture §3/§6).
import React from 'react';
import { elementIconUrl } from '../store/cardArt.js';
import { ElementPip } from './ElementPip.jsx';
import { linkRuns } from '../store/inlineRuns.js';
import { GLYPH_ICON } from './icons.jsx';
import { registerBackConsumer } from '../back.js';
import { useFocusTrap } from './useFocusTrap.js';
import Sheet from './Sheet.jsx';   // the one titled adapter over the GothicSheet chassis (BottomSheet aliases it)
import * as Dialog from '@radix-ui/react-dialog';   // the SAME layer manager vaul builds the sheet on - see CenteredModal
import { DIAMOND_PATH, DIAMOND_GOLD } from './brandMark.js';   // one mark for every wait - see Loading

/* Sheet button recipes - one source of truth for the black-glass primary and
   the ghost secondary used across every sheet (was copy-pasted in 6 files). */
export const BTN_GOLD = { padding: '12px 18px', borderRadius: 12, background: 'rgba(18,16,13,.85)', color: 'var(--gold-leaf)', font: "700 13px/1 var(--f-ui)", border: '1px solid rgba(220,184,111,.45)', cursor: 'pointer', flex: 'none' };
export const BTN_GHOST = { padding: '12px 0', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 13px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' };
// For the one action that DESTROYS user data. Deliberately not gold: gold is the affirmative
// throughout the app, and an irreversible replacement must not wear the same clothes as "Add".
// A shared token rather than an inline style, so a second destructive button cannot invent its own
// idea of what danger looks like.
export const BTN_DANGER = { padding: '12px 18px', borderRadius: 12, background: 'rgba(46,18,18,.9)', color: 'var(--ink-danger, #e2777a)', font: "700 13px/1 var(--f-ui)", border: '1px solid rgba(226,119,122,.5)', cursor: 'pointer', flex: 'none' };

/* The app's ONE blank-state block (the Decks-library look): a rotated diamond
   in the pillar's hue, a Cinzel title, a Garamond line, optional action.
   `hue` is "r,g,b" - decks violet "160,110,220", play jade "143,211,168". */
export function BlankState({ hue = '220,184,111', title, body, action, minHeight = '52vh' }) {
  // The diamond stays gold (a large chrome mark); the pillar hue lives only in
  // the soft glow behind it - subtle tint, never a large fill.
  return (
    <div style={{ minHeight, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 }}>
      <div style={{ width: 52, height: 52, border: '2px solid rgba(220,184,111,.28)', transform: 'rotate(45deg)', marginBottom: 32, boxShadow: `0 0 28px rgba(${hue},.2)` }} />
      <h2 style={{ font: "600 20px/1.2 var(--f-display)", color: '#dcb86f', marginBottom: 10 }}>{title}</h2>
      {body && <p style={{ font: "400 15px/1.6 var(--f-read)", color: 'var(--ink-muted)', marginBottom: action ? 24 : 0 }}>{body}</p>}
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
      onClick={onClick} aria-pressed={active} className="cx-hit44 cx-press"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 16px', borderRadius: 18, cursor: 'pointer',
        font: "600 13px/1 var(--f-ui)", whiteSpace: 'nowrap',
        background: active ? 'linear-gradient(180deg, #d8b872, #b8954f)' : 'var(--surface-brown-50)',
        color: active ? '#1a1206' : '#c9bda6',
        border: `1px solid ${active ? 'var(--gold-num)' : 'var(--edge-brown)'}`,
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

/* The ONE in-content view/segment toggle (pick-one): a gothic segmented pill -
   border #4a3c22 r20, active #d8c9a4 caps on rgba(42,33,20,.7). One source of
   truth, replacing the copy-pasted cx-view-toggle / view-toggle-wrap / ds-seg
   classes, Collection's frosted List/Binder toggle, and the Decks pip-bar. Each
   option: { key, label?, icon? } - icon is an inline SVG (no Unicode glyphs). */
export function SegTabs({ options, value, onChange, ariaLabel, style }) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'inline-flex', border: '1px solid var(--edge-brown)', borderRadius: 20, overflow: 'hidden', ...style }}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button key={o.key} onClick={() => onChange(o.key)} aria-pressed={on} aria-label={o.label || o.key} className="cx-press"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              // minHeight (not a cx-hit44 pseudo): the container's overflow:hidden would
              // clip an expander, so the segment itself grows to the 44px floor.
              minHeight: 44, padding: o.label ? '8px 17px' : '8px 15px', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--f-display)', fontSize: 12.5, fontWeight: on ? 600 : 500, letterSpacing: '.08em', textTransform: 'uppercase',
              color: on ? '#d8c9a4' : 'var(--ink-muted-warm)', background: on ? 'var(--surface-brown-70)' : 'transparent',
              transition: 'background .16s, color .16s', WebkitTapHighlightColor: 'transparent',
            }}>
            {o.icon}{o.label}
          </button>
        );
      })}
    </div>
  );
}

// Shared toggle icons (inline SVG - the app speaks SVG, never Unicode glyphs).
const seg = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const IcList = ({ size = 15 }) => <svg viewBox="0 0 24 24" width={size} height={size} {...seg} aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>;
export const IcGrid = ({ size = 15 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>;
export const IcStats = ({ size = 15 }) => <svg viewBox="0 0 24 24" width={size} height={size} {...seg} aria-hidden="true"><line x1="6" y1="20" x2="6" y2="12" /><line x1="12" y1="20" x2="12" y2="5" /><line x1="18" y1="20" x2="18" y2="9" /></svg>;

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
    if (e.target.closest('input, textarea, .cx-deck-carousel, .picker-decks-row, .cx-picker-modal, .cx-sheet-layer, #counter-screen, .vc-modal-overlay, .fab-menu, .ds-grid')) { start.current = null; return; }
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

/* The shared loading beat: the app's mark, breathing. ONE treatment for every wait
   in the app - screens, sheets and in-place sections alike - so a pause always looks
   deliberate and always looks like Compendium. It replaced a "· · ·" ellipsis that
   read as an unfinished frame rather than an intentional state (owner report).
   `PillarLoading` is the same mark at full-area size for a whole pillar arriving;
   this is the in-place size for everything else. Both share the geometry in
   brandMark.js and the compositor-only breath in tokens.css, and both fall back to a
   still mark under reduced motion. */
export function Loading({ pad = 24, size = 44 }) {
  return (
    <div style={{ padding: pad, display: 'flex', justifyContent: 'center' }} role="status" aria-label="Loading">
      <div className="cx-pillar-load-mark" style={{ lineHeight: 0 }}>
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
          <path d={DIAMOND_PATH} fill="none" stroke={DIAMOND_GOLD} strokeWidth="4" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function ThresholdPips({ runs, size = 12 }) {
  if (!runs?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {runs.map((r, i) => <ElementPip key={i} el={r.el} color={r.c} size={size} />)}
    </span>
  );
}

// ElementPip moved to its own leaf module (components/ElementPip.jsx) so the
// Counter Band can import the pip without pulling all of ui.jsx into
// LifeCounter's type-gate closure. Re-imported here for ThresholdPips.

/* Focus trap for modal surfaces - moves focus into the panel on open, keeps Tab
   cycling inside it, and restores focus to the opener on close. Accessibility
   for keyboard / switch-access users; a no-op for touch. */
// The focus trap lives in its own leaf module: ui.jsx imports GothicSheet (for BottomSheet)
// and GothicSheet needs the trap, which was a circular import. Imported AND re-exported, not
// `export ... from` - a bare re-export creates no local binding, and BottomSheet below calls
// the hook itself.
export { useFocusTrap };

/* Titled bottom sheet - now a straight alias of Sheet.jsx (the DESIGN_SYSTEM's
   pending BottomSheet -> Sheet merge). Titles are PINNED headers everywhere;
   the in-scroll title variant is gone (spec section 5, owner-approved change). */
export function BottomSheet(props) {
  return <Sheet {...props} />;
}

// Centered modal chassis (scrim + black-gold box + optional close X). Was inlined
// byte-for-byte in 4 places; this is the single source. `boxStyle` overrides the
// box for per-modal needs (maxWidth, padding, overflow, a violet chassis).
//
// BUILT ON RADIX DIALOG, deliberately - the same primitive vaul builds the sheet
// chassis on. This is not decoration: Radix manages a LAYER STACK, and its modal
// behaviour (`pointer-events:none` on <body>, react-remove-scroll's scroll lock)
// exempts only surfaces inside that stack. While this modal was hand-rolled it was
// invisible to that manager, so opening it over a sheet left it completely dead and
// unscrollable while the sheet beneath stayed live - the Settings bug. Two competing
// modal systems is the actual defect; one system is the fix, and it also hands us
// the focus trap, Escape, scroll locking and correct stacking for free rather than
// re-implemented here.
//
// Hardware back stays ours: Android's back button is not Escape, so it routes
// through the app's LIFO consumer stack exactly as every other surface does.
export function CenteredModal({ open, label, maxWidth = 360, onClose, closeButton = true, boxStyle, children }) {
  const closeRef = React.useRef(onClose); closeRef.current = onClose;
  React.useEffect(() => { if (open) return registerBackConsumer(() => { closeRef.current?.(); return true; }); }, [open]);
  // Same portal target as the sheet chassis: position:fixed must escape the pillar's
  // transformed slide-pane.
  const root = typeof document !== 'undefined' ? (document.querySelector('.cx-app') || document.body) : null;
  return (
    <Dialog.Root open={!!open} onOpenChange={(o) => { if (!o) closeRef.current?.(); }}>
      <Dialog.Portal container={root}>
        <Dialog.Overlay
          style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(4,3,2,.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', animation: 'cxfade .18s ease' }}
        />
        <Dialog.Content
          aria-label={label}
          onOpenAutoFocus={(e) => e.preventDefault()}   /* keep the WebView from scrolling to the first control */
          style={{
            position: 'fixed', zIndex: 701, left: '50%',
            /* centred, then lifted by half the keyboard inset so the box clears the
               IME the way the previous flex+padding layout did. */
            top: 'calc(50% - var(--kb,0px) / var(--ui-scale,1) / 2)',
            transform: 'translate(-50%, -50%)',
            width: 'calc(100% - 48px)', maxWidth,
            borderRadius: 20, background: 'linear-gradient(180deg,#151109,#0b0806)',
            border: '1px solid var(--hair-24)', boxShadow: '0 24px 64px rgba(0,0,0,.7)',
            outline: 'none', ...boxStyle,
          }}
        >
          {/* Radix wants a title for the accessible name; ours is visually hidden
              because each modal draws its own heading in the Manuscript treatment. */}
          <Dialog.Title style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{label || 'Dialog'}</Dialog.Title>
          {closeButton && (
            <button onClick={() => closeRef.current?.()} aria-label="Close" className="cx-hit44 cx-press" style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--hair-22)', background: 'rgba(0,0,0,.3)', color: 'var(--ink-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
   character offsets. Inline content is decomposed into flat runs at link boundaries
   (see linkRuns), so a run is either plain text or a single in-text link span. */

// Render canon[span] (default: whole string) as flat runs: plain text and in-text
// links (all gold; the link's target drives navigation, not colour). Exported so FAQ
// text renders links the same way.
export function InlineText({ canon, links = [], span, onOpenLink }) {
  const [s, e] = span || [0, canon.length];
  const runs = linkRuns(canon, s, e, links);
  return runs.map((r) => {
    const text = canon.slice(r.start, r.end);
    if (r.link) return <span key={r.start} className="cx-inlink cx-inlink-gold" data-off={r.start} onClick={() => onOpenLink?.(r.link.name, r.link.target)}>{text}</span>;
    return <React.Fragment key={r.start}>{text}</React.Fragment>;   // bare text keeps ::first-letter drop-cap intact
  });
}

function DocBlock({ canon, block, links, onOpenLink }) {
  const inline = (span) => <InlineText canon={canon} links={links} span={span} onOpenLink={onOpenLink} />;
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

// Blocks carry data-block-id so a deep-link or cross-ref can scroll to one.
export function RuleArticle({ doc, onOpenLink }) {
  if (!doc) return null;
  return (
    <div className="cx-article" data-doc-type={doc.docType} data-doc-id={doc.docId}>
      {doc.blocks.map((b) => (
        <DocBlock key={b.id} canon={doc.canon} block={b} links={doc.links} onOpenLink={onOpenLink} />
      ))}
    </div>
  );
}
