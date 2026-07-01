// Avatar picker — VERBATIM visual port of Vitarum's #picker-screen (see counter.css).
// Uses Compendium's catalogue avatar cards for the grid data.
import React, { useEffect, useState } from 'react';
import '../theme/counter.css';
import { listAvatars } from '../store/playRepository.js';

const BASE = import.meta.env.BASE_URL;

export default function AvatarPicker({ onConfirm, onCancel }) {
  const [avatars, setAvatars] = useState([]);
  const [q, setQ] = useState('');
  const [you, setYou] = useState(null);
  const [opp, setOpp] = useState(null);

  useEffect(() => { listAvatars().then(setAvatars); }, []);

  function pick(a) {
    if (you?.card_id === a.card_id) { setYou(null); return; }
    if (opp?.card_id === a.card_id) { setOpp(null); return; }
    if (!you) setYou(a); else if (!opp) setOpp(a);
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

      {/* Match preview — tap a slot to clear that pick */}
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
      <div className="picker-grid-wrap">
        <div className={`picker-search${q ? ' has-text' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search avatars…" autoComplete="off" autoCapitalize="off" spellCheck="false" />
          <button className="picker-search-clear" onClick={() => setQ('')} aria-label="Clear search">✕</button>
        </div>
        <div className="avatar-grid">
          {list.map((a) => (
            <div key={a.card_id} className={`avatar-card${roleClass(a)}`} onClick={() => pick(a)}>
              <img src={`${BASE}cards/${a.image_slug}`} alt={a.name} loading="lazy" />
              <div className="avatar-card-name">{a.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="picker-confirm">
        <button className={`picker-confirm-btn${ready ? ' ready' : ''}`} onClick={() => ready && onConfirm(you, opp)}>Continue →</button>
      </div>
    </div>
  );
}
