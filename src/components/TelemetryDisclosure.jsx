// The diagnostics disclosure - shown once, when consent is `unset`, on the centered
// chassis (Credits/What's New surface, so the three read as one family).
//
// WHY THIS COMPONENT EXISTS AT ALL
//
// It is one of exactly TWO surfaces allowed to grant consent (the other is the
// Settings PRIVACY row), because it is one of exactly two that show the user what
// they are agreeing to. See THE ONE RULE in src/telemetry.js. That is the whole
// point of it: build 37 collected without ever asking.
//
// Copy is data (src/content/telemetry.js, invariant 7). Nothing here is written by
// this file, and nothing here branches on what the copy says.
//
// THERE IS NO DISMISS. This asks for a decision and takes only a decision: no close
// button, no backdrop tap, no hardware back. CenteredModal drives all three from
// `onClose`, so withholding it closes all three at once - and its back consumer still
// returns true, which swallows the press rather than letting it fall through and exit
// the app underneath an unanswered question.
//
// Why it is not merely "safe to dismiss": tapping the scrim left consent `unset`, so
// reconciliation disabled everything and nothing was collected - the fail-safe held.
// But a privacy decision that can be answered by a stray tap on the background was
// never answered. Off-by-accident and off-by-choice are the same state and not the
// same event, and only one of them is consent.
//
// The user is not trapped: both buttons resolve it, and until one of them is pressed
// nothing runs. The modal never blocks boot.
import React, { useState } from 'react';
import { CenteredModal, BTN_GOLD, BTN_GHOST } from './ui.jsx';
import { TELEMETRY_DISCLOSURE as C } from '../content/telemetry.js';

export default function TelemetryDisclosure({ open, onAccept, onDecline }) {
  const [busy, setBusy] = useState(false);

  // The native write can fail. If it does, telemetry.js reports what is ACTUALLY
  // stored and the caller keeps the modal up - never close on an unconfirmed choice.
  const choose = (fn) => async () => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    // onClose is deliberately absent, not undefined-by-oversight: it is what disables
    // the backdrop tap, the close button, and hardware back. See the note above.
    <CenteredModal open={open} label={C.title} maxWidth={380} closeButton={false}
      boxStyle={{ overflow: 'hidden' }}>
      <div style={{ padding: '30px 0 0', textAlign: 'center', background: 'radial-gradient(ellipse at 50% 0%, rgba(220,184,111,.14) 0%, transparent 70%)' }}>
        <div style={{ font: "600 21px/1.1 var(--f-display)", color: 'var(--gold-leaf)', letterSpacing: '.02em' }}>{C.title}</div>
      </div>

      <div className="cx-scroll" style={{ maxHeight: 'min(56dvh, 420px)', overflowY: 'auto', padding: '18px 22px 0', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ font: "400 13px/1.55 var(--f-read)", color: 'var(--ink-body)' }}>{C.intro}</div>

        <ul style={{ margin: '10px 0 12px', padding: '0 0 0 18px', listStyle: 'none' }}>
          {C.sends.map((line) => (
            <li key={line} style={{ position: 'relative', font: "400 13px/1.55 var(--f-read)", color: 'var(--ink-body)', marginTop: 7 }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: -14, top: 7, width: 4, height: 4, borderRadius: '50%', background: 'var(--gold-leaf)', opacity: .7 }} />
              {line}
            </li>
          ))}
        </ul>

        <div style={{ font: "400 13px/1.55 var(--f-read)", color: 'var(--ink-body)' }}>{C.purpose}</div>
        <div style={{ font: "400 12.5px/1.55 var(--f-read)", color: 'var(--ink-muted)', marginTop: 14 }}>{C.never}</div>
        <div style={{ font: "500 12.5px/1.55 var(--f-read)", color: 'var(--ink-status)', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hair-12)' }}>{C.control}</div>
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '18px 22px calc(22px + env(safe-area-inset-bottom,0px))' }}>
        <button onClick={choose(onDecline)} disabled={busy} style={{ ...BTN_GHOST, flex: 1 }}>{C.decline}</button>
        <button onClick={choose(onAccept)} disabled={busy} style={{ ...BTN_GOLD, flex: 1, textAlign: 'center' }}>{C.accept}</button>
      </div>
    </CenteredModal>
  );
}
