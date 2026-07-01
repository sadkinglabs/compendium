// Decks pillar — Library / My Deck toggle in the app's own chip style (matching
// Home/Codex), NOT a bespoke pager. Search isn't a tab: adding cards is an
// "Add cards to deck" action on My Deck that opens the existing add-cards flow.
// `deckOpen` (the loaded deck) is lifted to App so it survives that flow.
import React, { useEffect, useState } from 'react';
import { listDecks } from '../store/deckRepository.js';
import { DeckCard } from './Decks.jsx';
import { Chip, ChipRow } from '../components/ui.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import DeckDashboard from './DeckDashboard.jsx';
import '../theme/deckpager.css';

export default function DecksPager({ onNew, onImport, onAddCards, deckOpen, onOpenDeck, rev }) {
  const [view, setView] = useState(deckOpen ? 'mydeck' : 'library');
  const [statTab, setStatTab] = useState('list');   // My Deck inner: list | stats
  const [decks, setDecks] = useState(null);
  const [libQ, setLibQ] = useState('');

  async function refresh() { setDecks(await listDecks()); }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [rev]);
  // Opening/creating/importing a deck (deckOpen changes id) jumps to My Deck;
  // the user can still toggle back to Library freely afterward.
  useEffect(() => { if (deckOpen) { setView('mydeck'); setStatTab('list'); } }, [deckOpen?.id]);

  function openDeck(d) { onOpenDeck({ id: d.id, name: d.name }); setView('mydeck'); }

  const libList = (decks || []).filter((d) => !libQ
    || d.name.toLowerCase().includes(libQ.toLowerCase())
    || (d.avatar?.name || '').toLowerCase().includes(libQ.toLowerCase()));

  return (
    <div className="arc dpager">
      <div className="dp-topbar">
        <ChipRow>
          <Chip label="Library" active={view === 'library'} onClick={() => setView('library')} />
          <Chip label="My Deck" active={view === 'mydeck'} onClick={() => setView('mydeck')} />
        </ChipRow>
        <div className="dp-topbar-spacer" />
        {view === 'mydeck' && deckOpen && (
          <button className="dp-add-pill" onClick={onAddCards}>＋ Add cards to deck</button>
        )}
      </div>

      {view === 'library' ? (
        <div className="dp-view">
          <div className="dpage-scroll">
            {decks == null ? <div style={{ color: 'var(--muted)', padding: '10px 16px' }}>…</div>
              : libList.length === 0 ? (
                <div style={{ minHeight: '52vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 }}>
                  <div style={{ width: 52, height: 52, border: '2px solid rgba(160,110,220,.28)', transform: 'rotate(45deg)', marginBottom: 32, boxShadow: '0 0 28px rgba(157,106,214,.18)' }} />
                  <h2 style={{ font: "600 20px/1.2 'Cinzel',Georgia,serif", color: '#dcb86f', marginBottom: 10 }}>{decks.length === 0 ? 'No Decks Yet' : 'No matches'}</h2>
                  {decks.length === 0 && <p style={{ font: "400 15px/1.6 'EB Garamond',Georgia,serif", color: '#9a8cae' }}>Build or import a deck<br />to start your collection.</p>}
                </div>
              ) : libList.map((d) => <DeckCard key={d.id} deck={d} onClick={() => openDeck(d)} />)}
          </div>
          <div className="pill-bar-outer">
            <div className={`bottom-pill-bar${libQ ? ' has-text' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="search" value={libQ} onChange={(e) => setLibQ(e.target.value)} placeholder="Search decks…" autoComplete="off" />
            </div>
          </div>
        </div>
      ) : (
        <div className="dp-view">
          {deckOpen ? (
            <>
              <div className="dpage-scroll">
                <DeckDashboard deckId={deckOpen.id} rev={rev} statTab={statTab} />
              </div>
              <div className="deck-pip-bar">
                <div className="pip-seg" onClick={() => setStatTab('list')}>
                  <span className={`pip-dot${statTab === 'list' ? ' active' : ''}`} />
                  <span className={`pip-seg-label${statTab === 'list' ? ' active' : ''}`}>List</span>
                </div>
                <span className="pip-divider" />
                <div className="pip-seg" onClick={() => setStatTab('stats')}>
                  <span className={`pip-seg-label${statTab === 'stats' ? ' active' : ''}`}>Stats</span>
                  <span className={`pip-dot${statTab === 'stats' ? ' active' : ''}`} />
                </div>
              </div>
            </>
          ) : (
            <div className="deck-blank">
              <div style={{ width: 52, height: 52, border: '2px solid rgba(160,110,220,.28)', transform: 'rotate(45deg)', marginBottom: 32, boxShadow: '0 0 28px rgba(157,106,214,.18)' }} />
              <h2 style={{ font: "600 20px/1.2 'Cinzel',Georgia,serif", color: '#dcb86f', marginBottom: 10 }}>No Deck Open</h2>
              <p style={{ font: "400 15px/1.6 'EB Garamond',Georgia,serif", color: '#9a8cae', marginBottom: 24 }}>Choose a deck from your Library<br />to start building.</p>
              <button onClick={() => setView('library')} style={{ padding: '12px 28px', borderRadius: 16, background: 'linear-gradient(180deg,rgba(157,106,214,.28),rgba(122,71,184,.18))', border: '1px solid rgba(160,110,220,.35)', color: '#c9a9f0', font: "600 13px/1 'Hanken Grotesk',sans-serif", cursor: 'pointer' }}>Open Library</button>
            </div>
          )}
        </div>
      )}

      {/* Per-view FAB */}
      {view === 'library' && (
        <Fab variant="lib" icon="+" label="New deck options" items={[
          { label: 'New Deck', onClick: onNew },
          { label: 'Import from Curiosa', onClick: () => onImport('url') },
          { label: 'Import from text', onClick: () => onImport('text') },
        ]} />
      )}
      {view === 'mydeck' && deckOpen && (
        <Fab variant="deck" icon={<FabGlyph kind="dots" />} label="Deck actions" onClick={() => {}} />
      )}
    </div>
  );
}
