// Decks shared pieces - the library DeckCard (rendered by DecksPager) and the
// two import sheets (Curiosa URL / pasted text), mounted from App.
import React, { useEffect, useState } from 'react';
import Sheet from '../components/Sheet.jsx';
import { BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import '../theme/arcanum.css';

const BASE = import.meta.env.BASE_URL;

// Small icons - no Unicode glyphs. Filled star = favourite; check = buildable.
const StarSvg = () => <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.06 6.6.62-4.98 4.42 1.46 6.5L12 16.9l-5.98 3.2 1.46-6.5L2.5 9.18l6.6-.62L12 2.5z" /></svg>;
const CheckSvg = () => <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;

// The library deck card - a compact echo of the My-Deck gilt hero: avatar art
// fading in from the right, Cinzel name, rose archetype eyebrow, threshold pips,
// record, and a buildability badge from the collection.
export function DeckCard({ deck, build, onClick }) {
  const hero = deck.avatar?.image_slug;                       // avatar card art
  const matches = (deck.wins || 0) + (deck.losses || 0);
  const record = matches ? `${deck.wins}W - ${deck.losses}L · ${matches} played` : 'No games recorded';
  const VALID_ELS = new Set(['air', 'earth', 'fire', 'water']);
  const elPips = (deck.elems || []).map((e) => e.el).filter((e) => VALID_ELS.has(e));
  return (
    <div className="dli" onClick={onClick}>
      {hero && <img className="dli-hero" src={`${BASE}cards/${hero}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />}
      <div className="dli-hero-grad" />
      <div className="dli-content">
        <div className="dli-name-row" style={{ cursor: 'pointer' }}>
          <div className="dli-name">{deck.name}</div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#8a8175', flexShrink: 0, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.7))' }}><polyline points="9 18 15 12 9 6" /></svg>
        </div>
        <div style={{ padding: '0 14px 13px', display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {deck.avatar?.name && <span className="dash-avatar-chip">{deck.avatar.name}</span>}
            {deck.avatar?.name && elPips.length > 0 && <span style={{ width: 1, height: 12, background: 'rgba(107,90,46,.6)', flexShrink: 0 }} />}
            {elPips.map((el) => <img key={el} src={`${BASE}icons/${el}.png`} style={{ width: 14, height: 14, flexShrink: 0 }} alt={el} />)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ font: "400 13px/1 var(--f-read)", color: '#8a8175' }}>{record}</span>
            {build && build.totalRequired > 0 && (
              <span title="Buildability from your collection" style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 10, font: "600 10.5px/1 var(--f-ui)", letterSpacing: '.04em',
                color: build.complete ? 'var(--accent-jade)' : '#c76d85',
                background: build.complete ? 'rgba(143,211,168,.1)' : 'rgba(199,109,133,.1)',
                border: `1px solid ${build.complete ? 'rgba(143,211,168,.3)' : 'rgba(199,109,133,.3)'}`,
              }}>{build.complete ? <><CheckSvg />Buildable</> : `${build.totalMissing} missing`}</span>
            )}
          </div>
        </div>
      </div>
      {deck.starred ? <span className="dli-fav"><StarSvg /></span> : null}
    </div>
  );
}

// Import from a Curiosa URL - Arcanum's "Paste Curiosa Deck URL" flow.
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

// Import from a pasted list - Arcanum's "Bulk Import" flow (Arcanum Format).
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
  const [busy, setBusy] = useState(false);   // in-flight guard - no double import
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
