// Avatar picker - VERBATIM visual port of Vitarum's #picker-screen (see counter.css).
// Uses Compendium's catalogue avatar cards for the grid data, plus a Compendium
// addition: pilot one of YOUR DECKS (sets your avatar and links the match to
// the deck - its W–L ledger updates on record).
import React, { useEffect, useState } from 'react';
import '../theme/counter.css';
import { listAvatars } from '../store/playRepository.js';
import { listDecks } from '../store/deckRepository.js';

const BASE = import.meta.env.BASE_URL;

export default function AvatarPicker({ onConfirm, onCancel }) {
  const [avatars, setAvatars] = useState([]);
  const [decks, setDecks] = useState([]);
  const [deck, setDeck] = useState(null);
  const [q, setQ] = useState('');
  const [you, setYou] = useState(null);
  const [opp, setOpp] = useState(null);

  useEffect(() => { listAvatars().then(setAvatars); listDecks().then(setDecks); }, []);

  function pick(a) {
    if (you?.card_id === a.card_id) { setYou(null); return; }
    if (opp?.card_id === a.card_id) { setOpp(null); return; }
    if (!you) setYou(a); else if (!opp) setOpp(a);
  }
  function pickDeck(d) {
    if (deck?.id === d.id) { setDeck(null); return; }   // tap again to unlink
    setDeck({ id: d.id, name: d.name });
    if (d.avatar) setYou({ card_id: d.avatar.card_id, name: d.avatar.name, image_slug: d.avatar.image_slug });
  }
  const roleClass = (a) => you?.card_id === a.card_id ? ' is-you' : opp?.card_id === a.card_id ? ' is-opp' : '';
  const list = avatars.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  const ready = you && opp;

  return (
    <div id="picker-screen" className="vc-root">
      <div className="picker-header">
        <h2>Choose Avatars</h2>
        <button className="picker-back" onClick={onCancel} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 16, height: 16 }}><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Match preview - tap a slot to clear that pick */}
      <div className="picker-matchup">
        <div className={`pm-slot${you ? ' filled' : ''}`} onClick={() => setYou(null)} role="button" aria-label="Your avatar">
          <div className="pm-thumb">{you ? <img src={`${BASE}cards/${you.image_slug}`} alt="" /> : '?'}</div>
          <div className="pm-role">YOU</div>
          <div className="pm-name">{you ? you.name : 'Tap an avatar'}</div>
        </div>
        <div className="pm-vs">VS</div>
        <div className={`pm-slot${opp ? ' filled' : ''}`} onClick={() => setOpp(null)} role="button" aria-label="Opponent avatar">
          <div className="pm-thumb">{opp ? <img src={`${BASE}cards/${opp.image_slug}`} alt="" /> : '?'}</div>
          <div className="pm-role">OPPONENT</div>
          <div className="pm-name">{opp ? opp.name : 'Tap an avatar'}</div>
        </div>
      </div>
      {/* Pilot one of your decks - Compendium cross-pillar link */}
      {decks.length > 0 && (
        <div className="picker-decks">
          <div className="picker-decks-label">PILOT A DECK</div>
          <div className="picker-decks-row">
            {decks.map((d) => (
              <button key={d.id} className={`picker-deck-chip${deck?.id === d.id ? ' on' : ''}`} onClick={() => pickDeck(d)}>
                {d.avatar?.image_slug && <img src={`${BASE}cards/${d.avatar.image_slug}`} alt="" />}
                <span>{d.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="picker-grid-wrap">
        <div className="avatar-grid">
          {list.map((a) => (
            <div key={a.card_id} className={`avatar-card${roleClass(a)}`} onClick={() => pick(a)}>
              <img src={`${BASE}cards/${a.image_slug}`} alt={a.name} loading="lazy" />
              <div className="avatar-card-name">{a.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="picker-footer">
        <div className={`picker-search${q ? ' has-text' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search avatars…" autoComplete="off" autoCapitalize="off" spellCheck="false" />
          <button className="picker-search-clear" onClick={() => setQ('')} aria-label="Clear search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ width: 12, height: 12 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <button className={`picker-confirm-btn${ready ? ' ready' : ''}`} onClick={() => ready && onConfirm(you, opp, deck)}>
          Continue
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
        </button>
      </div>
    </div>
  );
}
