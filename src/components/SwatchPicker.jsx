// A colour control that is a CONTROL, not a row of coloured squares you have to see to use.
//
// Written as a general primitive rather than a Storage-local widget, per the reuse instruction: the
// next surface that needs a named colour must not build a second one. It knows nothing about
// containers - it takes named options and reports the name back.
//
// WHY RADIO SEMANTICS AND NOT BUTTONS. Picking one of four mutually exclusive values IS a radio
// group, and saying so is what gets the user a single tab stop, arrow-key movement between options,
// and "gold, selected, 1 of 4" from a screen reader. A row of <button>s gives four tab stops and
// announces nothing about the choice. The roving tabindex below is the standard pattern for that:
// exactly one option is tabbable, and the arrows move both focus and selection.
//
// COLOUR IS NEVER THE ONLY SIGNAL. The selected swatch carries a ring AND a check mark, because a
// colour picker whose selection is indicated by colour alone is unusable for the people most likely
// to be relying on the label in the first place.
import { useRef } from 'react';

/** Touch target floor from DESIGN_SYSTEM §5. The swatch is drawn smaller; the hit area is not. */
const TARGET = 44;

/**
 * @param options  [{ value, label, css }] - `css` is a colour VALUE (a var() reference), `value` the
 *                 stored name. The caller owns the mapping; this never invents a colour.
 * @param value    the currently selected `value`
 * @param onChange (value) => void
 * @param label    accessible name for the group
 */
export default function SwatchPicker({ options = [], value, onChange, label = 'Colour' }) {
  const refs = useRef([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  // Arrow keys move selection AND focus together, which is what a radio group does - tabbing away
  // and back must land on the chosen option, not on the first one.
  const onKeyDown = (e) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange?.(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
      style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex: one stop for the whole group, landing on the current choice.
            tabIndex={i === index ? 0 : -1}
            onClick={() => onChange?.(o.value)}
            title={o.label}
            style={{
              width: TARGET, height: TARGET, display: 'grid', placeItems: 'center',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer', borderRadius: 10,
            }}>
            {/* The visible swatch, inset inside the full-size target. */}
            <span aria-hidden="true" style={{
              width: 26, height: 26, borderRadius: 999, background: o.css,
              display: 'grid', placeItems: 'center',
              boxShadow: selected ? '0 0 0 2px var(--ink-body), 0 0 0 4px rgba(0,0,0,.55)' : 'inset 0 0 0 1px rgba(0,0,0,.45)',
            }}>
              {selected && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(12,10,8,.92)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            {/* The name, for anything that is not looking at pixels. */}
            <span style={{
              position: 'absolute', width: 1, height: 1, overflow: 'hidden',
              clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
            }}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
