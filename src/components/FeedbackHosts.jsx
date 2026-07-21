// Toast + Confirm hosts - mounted once in App. They listen for the decoupled
// window events fired by src/feedback.js and render on the app's black chassis,
// so every mutation gets consistent feedback and every destructive action gets
// a real in-app confirm (no OS "localhost says…" dialogs).
import React, { useEffect, useRef, useState } from 'react';
import Sheet from './Sheet.jsx';

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
  return (
    <Sheet open title={opts.title || 'Confirm'} onClose={() => answer(false)}>
      <div style={{ padding: '0 16px' }}>
        {opts.body && <p style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body-2,#c9bfae)', margin: '0 0 18px' }}>{opts.body}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => answer(false)} style={btnGhost}>{opts.cancelLabel || 'Cancel'}</button>
          <button onClick={() => answer(true)} style={opts.danger ? btnDanger : btnGold}>{opts.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </Sheet>
  );
}

const btnBase = { flex: 1, padding: '12px 0', borderRadius: 12, font: "700 13px/1 var(--f-ui)", cursor: 'pointer' };
const btnGhost = { ...btnBase, background: 'transparent', color: 'var(--ink-status)', border: '1px solid var(--hair-22)' };
const btnGold = { ...btnBase, background: 'rgba(18,16,13,.85)', color: 'var(--gold-leaf)', border: '1px solid rgba(220,184,111,.45)' };
const btnDanger = { ...btnBase, background: 'rgba(60,20,16,.85)', color: '#e8a99e', border: '1px solid rgba(224,120,106,.5)' };
