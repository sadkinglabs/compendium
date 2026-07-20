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

const PANEL = {
  position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 60, minWidth: 190,
  background: 'rgba(10,9,8,.94)', border: '1px solid var(--hair-22)', borderRadius: 16,
  boxShadow: '0 12px 36px rgba(0,0,0,.6)', overflow: 'hidden', padding: '4px 0',
  transition: 'opacity .16s ease, transform .16s cubic-bezier(.34,1.2,.64,1)',
};

const ITEM = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px',
  textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
  font: "600 14px/1.2 var(--f-ui)", color: 'var(--ink-body)', whiteSpace: 'nowrap',
};

/** The house dots glyph - three dots, drawn not typed (the app never ships Unicode glyphs). */
export function DotsGlyph({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
    </svg>
  );
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
  const shown = (items || []).filter(Boolean);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); } };
    // Hardware BACK closes the menu first - it is the topmost layer, same contract as the FAB.
    const unreg = registerBackConsumer(() => { setOpen(false); return true; });
    // Any tap outside closes. Pointerdown (not click) so it beats the item's own click.
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); unreg(); };
  }, [open]);

  if (!shown.length) return null;   // never render an empty affordance

  const run = (it) => {
    if (it.disabled) return;
    haptic('light');
    setOpen(false);
    it.onClick?.();
  };

  return (
    <span ref={wrapRef} style={{ position: 'relative', flex: 'none', display: 'inline-flex' }}>
      <button
        onClick={() => { haptic('light'); setOpen((o) => !o); }}
        aria-haspopup="menu" aria-expanded={open} aria-label={label}
        style={{
          width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: open ? 'var(--surface-well)' : 'transparent',
          border: '1px solid var(--hair-40)', cursor: 'pointer',
          color: tone === 'muted' ? 'var(--ink-muted)' : 'var(--gold-leaf)',
          WebkitTapHighlightColor: 'transparent', padding: 0,
        }}
      >
        <DotsGlyph />
      </button>
      <div
        role="menu" aria-label={label}
        style={{
          ...PANEL,
          ...(align === 'left' ? { right: 'auto', left: 0 } : null),
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(-6px)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {shown.map((it, i) => (
          <button
            key={i} role="menuitem" onClick={() => run(it)} disabled={it.disabled}
            style={{
              ...ITEM,
              color: it.danger ? 'var(--danger)' : ITEM.color,
              opacity: it.disabled ? 0.4 : 1,
              cursor: it.disabled ? 'default' : 'pointer',
              borderBottom: i < shown.length - 1 ? '1px solid rgba(220,184,111,.12)' : 'none',
            }}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </span>
  );
}
