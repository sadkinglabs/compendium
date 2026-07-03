// Decks shared pieces — the library DeckCard (rendered by DecksPager) and the
// two import sheets (Curiosa URL / pasted text), mounted from App.
import React, { useEffect, useState } from 'react';
import Sheet from '../components/Sheet.jsx';
import { BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import '../theme/arcanum.css';

const BASE = import.meta.env.BASE_URL;

// VERBATIM port of renderLibrary()'s .dli card (Arcanum templates/index.html
// ~L1540). Same DOM nesting, same classes, same inline styles.
export function DeckCard({ deck, onClick }) {
  const hero = deck.avatar?.image_slug;                       // avatar card art
  const matches = (deck.wins || 0) + (deck.losses || 0);
  const record = matches ? `${deck.wins}W – ${deck.losses}L · ${matches} played` : 'No games recorded';
  const VALID_ELS = new Set(['air', 'earth', 'fire', 'water']);
  const elPips = (deck.elems || []).map((e) => e.el).filter((e) => VALID_ELS.has(e));
  return (
    <div className="dli" onClick={onClick}>
      {hero && <img className="dli-hero" src={`${BASE}cards/${hero}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />}
      <div className="dli-hero-grad" />
      <div className="dli-content">
        <div className="dli-name-row" style={{ cursor: 'pointer' }}>
          <div className="dli-name">{deck.name}</div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
        </div>
        <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {deck.avatar?.name && <span className="dash-avatar-chip">{deck.avatar.name}</span>}
            {elPips.map((el) => <img key={el} src={`${BASE}icons/${el}.png`} style={{ width: 13, height: 13, flexShrink: 0 }} alt={el} />)}
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{record}</span>
        </div>
      </div>
      {deck.starred ? <span className="dli-fav">★</span> : null}
    </div>
  );
}

// Import from a Curiosa URL — Arcanum's "Paste Curiosa Deck URL" flow.
export function ImportUrlSheet({ open, onClose, onImportUrl }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setUrl(''); setErr(''); setBusy(false); } }, [open]);
  async function go() {
    if (!url.trim()) return; setBusy(true); setErr('');
    try { await onImportUrl(url.trim()); } catch (e) { setErr(e.message || 'Import failed'); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} title="Import from Curiosa" onClose={onClose}>
      <div style={{ padding: '0 16px' }}>
      <div style={{ font: "400 13px/1.5 var(--f-read)", color: 'var(--ink-muted)', margin: '2px 0 12px' }}>Paste a Curiosa deck URL to import it.</div>
      <input value={url} autoFocus onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="https://curiosa.io/decks/…" style={S.input} />
      {err && <div style={{ font: "400 12px/1.4 var(--f-read)", color: 'var(--destructive)', marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...S.ghost, flex: 1 }}>Cancel</button>
        <button disabled={busy} onClick={go} style={{ ...S.gold, opacity: busy ? 0.6 : 1 }}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
      </div>
    </Sheet>
  );
}

// Import from a pasted list — Arcanum's "Bulk Import" flow (Arcanum Format).
const BULK_EXAMPLE = `# My Deck

## Avatar
- Elementalist

## Spellbook
- 3× Headless Haunt
- 2× Fey Changeling

## Atlas
- 4× Pond

## Collection
- 1× Disenchant`;
export function ImportTextSheet({ open, onClose, onImport }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [showEg, setShowEg] = useState(false);
  const [busy, setBusy] = useState(false);   // in-flight guard — no double import
  useEffect(() => { if (open) { setName(''); setText(''); setShowEg(false); setBusy(false); } }, [open]);
  async function go() {
    if (busy || !text.trim()) return;
    setBusy(true);
    try { await onImport(text, name.trim()); } catch { setBusy(false); }
  }
  return (
    <Sheet open={open} title="Import from Text" onClose={onClose}>
      <div style={{ padding: '0 16px' }}>
      <p style={{ font: "400 13px/1.55 var(--f-read)", color: 'var(--ink-muted)', margin: '2px 0 12px' }}>
        Paste a deck list. Start with a <b style={{ color: 'var(--ink-body)' }}>#</b> deck name, then <b style={{ color: 'var(--ink-body)' }}>## Avatar / Spellbook / Atlas / Collection</b> sections, each with <b style={{ color: 'var(--ink-body)' }}>N× Card</b> lines.
      </p>
      <button onClick={() => setShowEg((v) => !v)} style={{ background: 'none', border: 'none', color: 'var(--gold-leaf)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer', padding: 0, marginBottom: showEg ? 8 : 12 }}>
        {showEg ? '▾ Hide format example' : '▸ Show format example'}
      </button>
      {showEg && <pre style={{ background: 'var(--surface-well)', border: '1px solid var(--hair-12)', borderRadius: 10, padding: 12, margin: '0 0 12px', font: "400 12px/1.5 var(--f-mono)", color: 'var(--ink-status)', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{BULK_EXAMPLE}</pre>}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck name (optional)…" style={{ ...S.input, marginBottom: 10 }} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        placeholder="# My Deck&#10;## Avatar&#10;- Elementalist&#10;## Spellbook&#10;- 3× Headless Haunt&#10;## Atlas&#10;- 4× Pond" style={S.textarea} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...S.ghost, flex: 1 }}>Cancel</button>
        <button onClick={go} disabled={busy} style={{ ...S.gold, opacity: busy ? 0.6 : 1 }}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
      </div>
    </Sheet>
  );
}

const S = {
  input: { width: '100%', height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" },
  textarea: { width: '100%', height: 120, resize: 'none', background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: 12, color: 'var(--ink-body)', font: "400 14px/1.5 var(--f-mono)" },
  gold: BTN_GOLD,
  ghost: { ...BTN_GHOST, padding: '12px 16px' },
};
