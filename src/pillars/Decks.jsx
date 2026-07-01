// Decks library — deck cards (avatar/element art, archetype, threshold pips,
// record, zone counts) + New Deck and Import (Curiosa/Markdown paste).
import React, { useEffect, useState } from 'react';
import { listDecks } from '../store/deckRepository.js';
import { BottomSheet } from '../components/ui.jsx';
import '../theme/arcanum.css';

const BASE = import.meta.env.BASE_URL;

// The library list. Creating/importing decks is FAB-driven (see App.jsx global
// FAB → New Deck / Import); this component just renders decks and the empty
// state. `rev` bumps re-fetch it after a create/import.
export default function Decks({ onOpenDeck, onNew, onImport, rev }) {
  const [decks, setDecks] = useState(null);

  async function refresh() { setDecks(await listDecks()); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [rev]);

  const filtered = decks || [];

  return (
    <div className="arc" style={{ padding: '6px 0 26px', animation: 'cxfade .2s ease' }}>
      {decks == null ? <div style={{ color: 'var(--muted)', padding: '0 12px' }}>…</div>
        : filtered.length === 0 ? (
          // Empty state — verbatim from renderLibrary's empty branch (diamond + copy)
          <div style={{ minHeight: '62vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 }}>
            <div style={{ width: 52, height: 52, border: '2px solid rgba(160,110,220,.28)', transform: 'rotate(45deg)', marginBottom: 32, boxShadow: '0 0 28px rgba(157,106,214,.18)' }} />
            <h2 style={{ font: "600 20px/1.2 'Cinzel',Georgia,serif", color: '#dcb86f', marginBottom: 10 }}>No Decks Yet</h2>
            <p style={{ font: "400 15px/1.6 'EB Garamond',Georgia,serif", color: '#9a8cae', marginBottom: 24 }}>Build or import a deck<br />to start your collection.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onNew} style={{ padding: '12px 28px', borderRadius: 16, background: 'linear-gradient(180deg,rgba(157,106,214,.28),rgba(122,71,184,.18))', border: '1px solid rgba(160,110,220,.35)', color: '#c9a9f0', font: "600 13px/1 'Hanken Grotesk',sans-serif", cursor: 'pointer' }}>New Deck</button>
              <button onClick={onImport} style={{ padding: '12px 28px', borderRadius: 16, background: 'transparent', border: '1px solid rgba(160,110,220,.35)', color: '#9a8cae', font: "600 13px/1 'Hanken Grotesk',sans-serif", cursor: 'pointer' }}>Import</button>
            </div>
          </div>
        ) : (
          <div>
            {filtered.map((d) => <DeckCard key={d.id} deck={d} onClick={() => onOpenDeck(d.id, d.name)} />)}
          </div>
        )}
    </div>
  );
}

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
    <BottomSheet open={open} title="IMPORT FROM CURIOSA" onClose={onClose}>
      <div style={{ font: "400 13px/1.5 var(--f-read)", color: 'var(--ink-muted)', margin: '2px 0 12px' }}>Paste a Curiosa deck URL to import it.</div>
      <input value={url} autoFocus onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="https://curiosa.io/decks/…" style={S.input} />
      {err && <div style={{ font: "400 12px/1.4 var(--f-read)", color: 'var(--destructive)', marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onClose} style={{ ...S.ghost, flex: 1 }}>Cancel</button>
        <button disabled={busy} onClick={go} style={{ ...S.gold, opacity: busy ? 0.6 : 1 }}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
    </BottomSheet>
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
  useEffect(() => { if (open) { setName(''); setText(''); setShowEg(false); } }, [open]);
  return (
    <BottomSheet open={open} title="IMPORT FROM TEXT" onClose={onClose}>
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
        <button onClick={() => text.trim() && onImport(text, name.trim())} style={S.gold}>Import</button>
      </div>
    </BottomSheet>
  );
}

const S = {
  search: { flex: 1, display: 'flex', alignItems: 'center', gap: 10, height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px' },
  searchInput: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" },
  newBtn: { flex: 'none', padding: '0 16px', borderRadius: 12, border: '1px solid var(--hair-30)', background: 'rgba(207,154,74,.1)', color: 'var(--gold-leaf)', font: "600 13px/1 var(--f-ui)", cursor: 'pointer' },
  input: { width: '100%', height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" },
  textarea: { width: '100%', height: 120, resize: 'none', background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: 12, color: 'var(--ink-body)', font: "400 14px/1.5 var(--f-mono)" },
  gold: { padding: '12px 18px', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 13px/1 var(--f-ui)", border: 'none', cursor: 'pointer', flex: 'none' },
  ghost: { padding: '12px 16px', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 13px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' },
};
