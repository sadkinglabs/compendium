// OverflowMenu - the app's ONE header overflow: a dots trigger and a small anchored menu.
//
// WHERE IT BELONGS. Screen-level commands that are not the primary action and do not deserve
// permanent chrome: rename, duplicate, export, delete, import-from-text. The FAB stays the
// single obvious "add" action; the overflow is everything else. If a command is used every
// visit, it does not belong here - promote it to real chrome.
//
// WHY IT IS NOT `Fab items={…}`. The FAB is docked bottom-right and owns the add gesture; an
// overflow is anchored to the header it acts on, and a screen may need both at once (list
// detail has a camera FAB, a filter FAB and list commands). Sharing one component would mean
// one of them lying about where it is anchored.
//
// A11Y NOTE, LEARNED THE HARD WAY. The FAB menu animates with `transform: scale(.18 -> 1)`,
// and the WebView accessibility tree keeps reporting the PRE-transition geometry - a menu
// 170 CSS px wide reports itself at ~36. Fingers are fine (hit-testing uses the real box) but
// assistive tech and any automation get the wrong target, and it makes the menu undriveable
// by `check:smoke`. So this panel animates with OPACITY and a small TRANSLATE only. Never add
// a scale transform here.
import React, { useState, useEffect, useRef } from 'react';
import { registerBackConsumer } from '../back.js';
import { haptic } from '../native.js';

// The panel matches the FAB menu's chassis (decks.css `.fab-menu`): the same frosted gilt glass, so
// a header overflow and the docked FAB read as one menu language. It does NOT copy the FAB's SCALE
// morph - the a11y note above is load-bearing - so it plays a small opacity+translate entrance
// (`cx-ofm-in`, reduced-motion-safe) instead.
const PANEL = {
  position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60, minWidth: 200,
  background: 'rgba(10,9,8,.72)', border: '1px solid rgba(220,184,111,.25)', borderRadius: 18,
  backdropFilter: 'blur(16px) saturate(1.15)', WebkitBackdropFilter: 'blur(16px) saturate(1.15)',
  boxShadow: '0 8px 32px rgba(0,0,0,.6)', overflow: 'hidden', padding: '4px 0',
};

// Mirrors `.fab-menu button` (decks.css): same font, padding, colour and hairline, so the two menus
// are indistinguishable.
const ITEM = {
  display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '12px 16px',
  textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
  font: "600 14px/1.2 var(--f-ui)", color: '#e9dcc0', whiteSpace: 'nowrap',
};

/** The house dots glyph - three dots, drawn not typed (the app never ships Unicode glyphs). */
export function DotsGlyph({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
    </svg>
  );
}

// The ONE menu-item glyph language, sized once here so callers never hand-size an icon (the reason
// the old ad-hoc SVGs read too big/too small). Mirrors Fab.jsx's FabGlyph; every glyph is a 17px
// stroke line-icon, `.cx-ofm-glyph svg` in tokens.css is the backstop for any raw icon.
export function MenuGlyph({ kind }) {
  const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const svg = (children) => <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" {...P}>{children}</svg>;
  switch (kind) {
    case 'edit': return svg(<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />);
    case 'duplicate': return svg(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
    case 'delete': return svg(<><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>);
    case 'import': return svg(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></>);
    case 'export': return svg(<><path d="M12 15V4" /><polyline points="8 8 12 4 16 8" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></>);
    case 'missing': return svg(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.3" y2="16.3" /><line x1="8" y1="11" x2="14" y2="11" /></>);
    default: return svg(<circle cx="12" cy="12" r="9" />);
  }
}

/**
 * @param items  [{ label, onClick, icon?, danger?, disabled? }] - a `null` entry is skipped,
 *               so callers can inline conditionals without building arrays by hand.
 * @param label  accessible name for the trigger (say what it acts on: "List actions").
 * @param align  'right' (default) | 'left' - which edge the panel hangs from.
 */
export default function OverflowMenu({ items = [], label = 'More actions', align = 'right', tone = 'gold' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);
  const shown = (items || []).filter(Boolean);
  // Index of the first actionable item, as a PRIMITIVE. The focus effect below must not
  // depend on `shown` - that array is rebuilt every render, so any parent re-render while the
  // menu is open would re-run the effect and yank focus back to the top of the list while
  // someone was arrowing through it.
  const firstEnabled = shown.findIndex((it) => !it.disabled);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus?.({ preventScroll: true }); } };
    // Hardware BACK closes the menu first - it is the topmost layer, same contract as the FAB.
    const unreg = registerBackConsumer(() => { setOpen(false); return true; });   // no focus grab: back is a navigation gesture
    // Any tap outside closes. Pointerdown (not click) so it beats the item's own click.
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); unreg(); };
  }, [open]);

  // Focus lands on the first item when the menu opens, and returns to the trigger when it
  // closes - the menu-button contract. Without the return, dismissing with Escape strands
  // keyboard focus on a node that no longer exists.
  useEffect(() => {
    // Focus the first ACTIONABLE item: `disabled` is part of the declared API, so focusing
    // index 0 blindly could strand focus on a control that cannot be used.
    if (!open || firstEnabled < 0) return undefined;
    const id = setTimeout(() => itemRefs.current[firstEnabled]?.focus?.({ preventScroll: true }), 0);
    return () => clearTimeout(id);
  }, [open, firstEnabled]);

  if (!shown.length) return null;   // never render an empty affordance

  const close = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus?.({ preventScroll: true });
  };

  const run = (it) => {
    if (it.disabled) return;
    haptic('light');
    close();
    it.onClick?.();
  };

  // Arrow / Home / End move between items; Escape closes and hands focus back.
  const onItemKey = (e, i) => {
    const n = shown.length;
    // Step over disabled items rather than landing on them. Wrapping is bounded by `n` so a
    // menu of entirely-disabled items cannot spin forever.
    const step = (dir) => {
      e.preventDefault();
      for (let k = 1; k <= n; k += 1) {
        const j = (((i + dir * k) % n) + n) % n;
        if (!shown[j].disabled) { itemRefs.current[j]?.focus?.({ preventScroll: true }); return; }
      }
    };
    const edge = (from, dir) => {
      e.preventDefault();
      for (let k = 0; k < n; k += 1) {
        const j = from + dir * k;
        if (j >= 0 && j < n && !shown[j].disabled) { itemRefs.current[j]?.focus?.({ preventScroll: true }); return; }
      }
    };
    if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'Home') edge(0, 1);
    else if (e.key === 'End') edge(n - 1, -1);
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <span ref={wrapRef} style={{ position: 'relative', flex: 'none', display: 'inline-flex' }}>
      {/* One 44px circle at the §5 touch floor. It is not a 34px circle in a larger hit box:
          an inner styling <span> made the WebView expose that span as the button content and
          the button lost its accessible name entirely. */}
      <button
        ref={triggerRef} type="button"
        onClick={() => { haptic('light'); setOpen((o) => !o); }}
        aria-haspopup="menu" aria-expanded={open} aria-label={label}
        style={{
          width: 44, height: 44, borderRadius: '50%', padding: 0, flex: 'none',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--surface-well)' : 'transparent',
          border: '1px solid var(--hair-40)', cursor: 'pointer',
          color: tone === 'muted' ? 'var(--ink-muted)' : 'var(--gold-leaf)',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <DotsGlyph size={17} />
        {/* A VISUALLY-HIDDEN text label, not just aria-label.
            Measured on device: with aria-label alone this button came back from the Android
            accessibility tree as `content-desc="" NAF="true"` - Chromium's own "not
            accessibility friendly" flag, meaning TalkBack would announce it as an unnamed
            "Button". Naming it by CONTENT is what the WebView actually honours here, and it
            costs nothing visually. Keep both: aria-label for engines that do honour it, and
            this for the one we ship on. */}
        <span style={{
          position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
        }}>{label}</span>
      </button>
      {/* UNMOUNTED while closed. Hiding it with opacity left every command tabbable and
          readable by assistive tech - an invisible "Delete list" you could reach with Tab -
          and it leaked into UI-automation text. */}
      {open && (
        <div
          role="menu" aria-label={label} className="cx-ofm-panel"
          style={{ ...PANEL, ...(align === 'left' ? { right: 'auto', left: 0 } : null) }}
        >
          {shown.map((it, i) => (
            <button
              key={i} type="button" role="menuitem"
              ref={(el) => { itemRefs.current[i] = el; }}
              onClick={() => run(it)} onKeyDown={(e) => onItemKey(e, i)} disabled={it.disabled}
              style={{
                ...ITEM,
                color: it.danger ? 'var(--destructive)' : ITEM.color,
                opacity: it.disabled ? 0.4 : 1,
                cursor: it.disabled ? 'default' : 'pointer',
                borderBottom: i < shown.length - 1 ? '1px solid rgba(220,184,111,.14)' : 'none',
              }}
            >
              {it.icon && <span className="cx-ofm-glyph" style={{ display: 'inline-flex', flex: 'none', opacity: 0.75 }}>{it.icon}</span>}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
