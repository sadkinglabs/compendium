// Toast + Confirm hosts - mounted once in App. They listen for the decoupled
// window events fired by src/feedback.js and render on the app's black chassis,
// so every mutation gets consistent feedback and every destructive action gets
// a real in-app confirm (no OS "localhost says…" dialogs).
import React, { useEffect, useRef, useState } from 'react';
import { CenteredModal, BTN_DANGER, BTN_GOLD, BTN_GHOST } from './ui.jsx';

let seq = 0;

const TOAST_OUT_MS = 200;   // must match the cxToastOut duration in tokens.css

export function ToastHost() {
  // Single slot. The FIRST toast of a run animates in; while it is still showing, a new
  // message swaps its TEXT in place - same React key, so no remount and no replayed
  // animation, which reads as just the number updating. The last one animates out on the
  // reverse of the entrance.
  const [item, setItem] = useState(null);   // {id, message, tone, leaving}
  const hide = useRef(null);
  const drop = useRef(null);
  useEffect(() => {
    const onToast = (e) => {
      const { message, tone = 'default', ms = 2100 } = e.detail || {};
      if (!message) return;
      clearTimeout(hide.current);
      clearTimeout(drop.current);
      setItem((prev) => (prev && !prev.leaving
        ? { ...prev, message, tone }                 // update in place - keeps the key
        : { id: ++seq, message, tone, leaving: false }));   // fresh mount - plays cxToastIn
      hide.current = setTimeout(() => {
        setItem((prev) => (prev ? { ...prev, leaving: true } : null));
        drop.current = setTimeout(() => setItem(null), TOAST_OUT_MS);
      }, ms);
    };
    window.addEventListener('cx-toast', onToast);
    return () => {
      window.removeEventListener('cx-toast', onToast);
      clearTimeout(hide.current); clearTimeout(drop.current);
    };
  }, []);
  if (!item) return null;
  return (
    <div className="cx-toast-stack" role="status" aria-live="polite">
      <div key={item.id} className={`cx-toast${item.tone === 'danger' ? ' danger' : ''}${item.leaving ? ' leaving' : ''}`}>
        {item.message}
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);   // { opts, resolve }
  useEffect(() => {
    window.__cxConfirmHostMounted = true;
    const onConfirm = (e) => setReq(e.detail);
    window.addEventListener('cx-confirm', onConfirm);
    return () => { window.removeEventListener('cx-confirm', onConfirm); delete window.__cxConfirmHostMounted; };
  }, []);
  if (!req) return null;
  const { opts, resolve } = req;
  const answer = (v) => { setReq(null); resolve(v); };
  // A CENTERED DIALOG, deliberately not a sheet. Confirms are raised FROM sheets
  // (delete profile from the profile sheet, delete match from the match sheet), and
  // a second surface rising from the same edge with the same chrome reads as "the
  // sheet changed" rather than "stop, this is irreversible". A centered dialog
  // breaks the plane, and it cannot be flicked away - a destructive answer should
  // cost a deliberate button press, never a careless downward swipe. It is also
  // what both platforms specify: M3 puts destructive confirmation in a basic
  // dialog, Apple in an alert; neither stacks a sheet on a sheet to ask a question.
  // CenteredModal's z-700 already paints over the sheet chassis (the same route
  // Settings takes over the profile sheet).
  return (
    <CenteredModal open label={opts.title || 'Confirm'} maxWidth={340} closeButton={false} onClose={() => answer(false)}>
      <div style={{ padding: '22px 20px 18px' }}>
        <h2 style={{ font: "600 17px/1.3 var(--f-display)", color: 'var(--gold-leaf)', margin: '0 0 10px' }}>{opts.title || 'Confirm'}</h2>
        {opts.body && <p style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body-2,#c9bfae)', margin: '0 0 20px' }}>{opts.body}</p>}
        {/* Destructive confirmation pattern (DESIGN_SYSTEM §4): the affirmative wears
            BTN_DANGER, never BTN_GOLD - gold is the affirmative everywhere else, and
            an irreversible action must not wear the same clothes as "Add". */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => answer(false)} style={{ ...BTN_GHOST, flex: 1 }}>{opts.cancelLabel || 'Cancel'}</button>
          <button onClick={() => answer(true)} style={{ ...(opts.danger ? BTN_DANGER : BTN_GOLD), flex: 1, padding: '12px 0' }}>{opts.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </CenteredModal>
  );
}
