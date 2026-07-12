// Toast + Confirm hosts - mounted once in App. They listen for the decoupled
// window events fired by src/feedback.js and render on the app's black chassis,
// so every mutation gets consistent feedback and every destructive action gets
// a real in-app confirm (no OS "localhost says…" dialogs).
import React, { useEffect, useRef, useState } from 'react';
import Sheet from './Sheet.jsx';

let seq = 0;

export function ToastHost() {
  const [items, setItems] = useState([]);   // {id, message, tone}
  const timers = useRef({});
  useEffect(() => {
    const onToast = (e) => {
      const id = ++seq;
      const { message, tone = 'default', ms = 2100 } = e.detail || {};
      if (!message) return;
      setItems((xs) => [...xs, { id, message, tone }]);
      timers.current[id] = setTimeout(() => {
        setItems((xs) => xs.filter((x) => x.id !== id));
        delete timers.current[id];
      }, ms);
    };
    window.addEventListener('cx-toast', onToast);
    return () => { window.removeEventListener('cx-toast', onToast); Object.values(timers.current).forEach(clearTimeout); };
  }, []);
  if (!items.length) return null;
  return (
    <div className="cx-toast-stack" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`cx-toast${t.tone === 'danger' ? ' danger' : ''}`}>{t.message}</div>)}
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
