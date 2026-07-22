// "Which one do you need?" - the picker a want opens when the set is genuinely unknowable.
//
// DORMANT. Nothing renders this yet; the activation commit routes the heart through it. It is
// built now so the canonical write path has a finished surface behind it before anything
// depends on either.
//
// It only ever appears for a REPRINT with no set context. A card printed once, or a heart
// tapped inside a set-scoped surface, writes immediately - see wantIntent.js. Asking when the
// answer is already known would tax every common case to serve the rare one.
//
// Finish is not a question here either, it is a toggle with a default. §7.4 rules that a set is
// completed in non-foil, so that is what a want means unless the user says otherwise.
import React, { useReducer, useEffect } from 'react';
import { BottomSheet, BTN_GOLD } from './ui.jsx';
import { pickerOptions } from '../store/wantIntent.js';
import { wantPickerReducer, initialWantPicker } from './wantPickerState.js';
import { SET_LABEL, SET_RANK } from '../store/sets.js';

const setRank = (code) => SET_RANK[code] ?? 99;

export default function WantPrintingSheet({ open, cardId, cardName, setCodes = [], onPick, onClose }) {
  const [state, dispatch] = useReducer(wantPickerReducer, initialWantPicker);
  const { foil } = state;
  const options = pickerOptions(setCodes, setRank, SET_LABEL);

  // Opening on a new card resets the finish. The reducer treats a repeat open on the SAME card
  // as a no-op, so a re-render cannot undo a tap the user just made.
  useEffect(() => { if (open) dispatch({ type: 'open', cardId }); }, [open, cardId]);

  // ONE exit for cancel, backdrop and hardware back. The finish used to be reset only on
  // confirm, so cancelling left it set and the NEXT card's want was silently stored as foil.
  const close = () => { dispatch({ type: 'close' }); onClose?.(); };

  const choose = (code) => {
    onPick?.({ set: code, foil });
    close();
  };

  return (
    <BottomSheet open={open} title="WHICH PRINTING?" onClose={close}>
      {cardName && (
        <div style={{ font: "600 15px/1.3 var(--f-read)", color: 'var(--gold-leaf)', textAlign: 'center', marginBottom: 3 }}>
          {cardName}
        </div>
      )}
      <div style={{ font: "400 12.5px/1.4 var(--f-ui)", color: 'var(--ink-muted)', textAlign: 'center', marginBottom: 14 }}>
        This card was printed more than once. Which one are you after?
      </div>

      {/* Finish first, because it applies to whichever set is then tapped - choosing the set
          last is what commits, so the toggle must already be settled. */}
      <div role="group" aria-label="Finish" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[{ v: false, label: 'Non-foil' }, { v: true, label: 'Foil' }].map((o) => (
          <button
            key={String(o.v)}
            onClick={() => dispatch({ type: 'setFoil', foil: o.v })}
            aria-pressed={foil === o.v}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
              font: "600 12px/1 var(--f-display)", letterSpacing: '.14em', textTransform: 'uppercase',
              color: foil === o.v ? 'var(--ink-ink)' : 'var(--ink-muted)',
              background: foil === o.v ? 'var(--gold-leaf)' : 'rgba(10,9,7,.5)',
              border: `1px solid ${foil === o.v ? 'var(--gold-leaf)' : 'var(--hair-16)'}`,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {options.map((o) => (
        <button
          key={o.code}
          onClick={() => choose(o.code)}
          className="cx-row"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            width: '100%', padding: '13px 4px', background: 'none', cursor: 'pointer',
            border: 'none', borderBottom: '1px solid var(--hair-12)', textAlign: 'left',
          }}
        >
          <span style={{ font: "500 15px/1.2 var(--f-read)", color: 'var(--ink-body)' }}>{o.name}</span>
          <span aria-hidden="true" style={{ font: "600 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>
            {foil ? 'FOIL' : ''}
          </span>
        </button>
      ))}

      {options.length === 0 && (
        <div style={{ font: "400 13px/1.4 var(--f-ui)", color: 'var(--ink-muted)', textAlign: 'center', padding: '18px 0' }}>
          The catalog does not list a printing for this card.
        </div>
      )}

      <button onClick={close} style={{ ...BTN_GOLD, width: '100%', justifyContent: 'center', marginTop: 16, opacity: .8 }}>
        Cancel
      </button>
    </BottomSheet>
  );
}
