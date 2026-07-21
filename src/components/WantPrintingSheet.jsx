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
import React, { useState } from 'react';
import { BottomSheet, BTN_GOLD } from './ui.jsx';
import { pickerOptions, DEFAULT_WANT_FOIL } from '../store/wantIntent.js';
import { SET_LABEL, SET_RANK } from '../store/sets.js';

const setRank = (code) => SET_RANK[code] ?? 99;

export default function WantPrintingSheet({ open, cardName, setCodes = [], onPick, onClose }) {
  const [foil, setFoil] = useState(DEFAULT_WANT_FOIL);
  const options = pickerOptions(setCodes, setRank, SET_LABEL);

  const choose = (code) => {
    onPick?.({ set: code, foil });
    setFoil(DEFAULT_WANT_FOIL);   // the next card starts from the default again
    onClose?.();
  };

  return (
    <BottomSheet open={open} title="WHICH PRINTING?" onClose={onClose}>
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
            onClick={() => setFoil(o.v)}
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

      <button onClick={onClose} style={{ ...BTN_GOLD, width: '100%', justifyContent: 'center', marginTop: 16, opacity: .8 }}>
        Cancel
      </button>
    </BottomSheet>
  );
}
