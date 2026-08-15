// Avatar picker - implements the visual design of Play pillar's #picker-screen (see counter.css).
// Uses Compendium's catalogue avatar cards for the grid data, plus a Compendium
// addition: pilot one of YOUR DECKS (sets your avatar and links the match to
// the deck - its W–L ledger updates on record).
import React, { useEffect, useReducer, useState } from 'react';
import '../theme/counter.css';
import { listAvatars } from '../store/playRepository.js';
import { listDecks } from '../store/deckRepository.js';
import { selectionReducer, initialSelection, rolesOf, isReady, armedRole } from './avatarPickerState.js';
import { ArtImg } from '../components/ArtImage.jsx';
import { haptic } from '../native.js';

// The reducer's role keys are the state keys ('you' | 'opponent'); the CSS uses the
// short forms that match the hue system's naming (.role-opp, .targeting-opp).
const ROLE_SUFFIX = { you: 'you', opponent: 'opp' };

// What a card tap will do, spoken aloud. The role badges are CSS ::after content,
// which is not a dependable accessible-state mechanism, so the button label - not
// the frame - is what actually carries the state to a screen reader.
function cardLabel(name, role, armed) {
  const held = role.you && role.opponent ? ', selected as both players'
    : role.you ? ', selected as your avatar'
    : role.opponent ? ', selected as opponent' : '';
  if (!armed) return `${name}${held}. Both sides are chosen; clear one from the matchup above first`;
  return `${name}${held}. Activate to set as ${armed === 'you' ? 'your avatar' : 'the opponent'}`;
}

export default function AvatarPicker({ onConfirm, onCancel }) {
  const [avatars, setAvatars] = useState([]);
  const [decks, setDecks] = useState([]);
  const [q, setQ] = useState('');
  // One atomic selection value. Search and the loaded lists stay out of it - they
  // are not selection. See avatarPickerState.js for why this is a reducer.
  const [sel, dispatch] = useReducer(selectionReducer, initialSelection);
  const { you, opponent: opp, deck } = sel;
  // Derived, never stored: the glow and the next tap read the same value, so they
  // cannot disagree. YOU is lit on open; filling it lights OPPONENT on its own.
  const armed = armedRole(sel);

  useEffect(() => { listAvatars().then(setAvatars); listDecks().then(setDecks); }, []);

  const pick = (a) => { haptic('light'); dispatch({ type: 'tapAvatar', card: a }); };
  const tapSlot = (role) => dispatch({ type: 'tapSlot', role });
  const pickDeck = (d) => dispatch({ type: 'pickDeck', deck: d });

  // Both roles, not the first that matches: a mirrored pick is is-you AND is-opp,
  // and an earlier ternary short-circuited so the opponent half went invisible.
  const roleClass = (a) => {
    const r = rolesOf(sel, a);
    return `${r.you ? ' is-you' : ''}${r.opponent ? ' is-opp' : ''}`;
  };
  const mirrored = (a) => { const r = rolesOf(sel, a); return r.you && r.opponent; };
  const slotLabel = (role, filled, name) => {
    if (filled) return `Clear ${role === 'you' ? 'your avatar' : 'the opponent'}, ${name}`;
    if (armed === role) return `${role === 'you' ? 'Your avatar' : 'Opponent'} slot, ready. Choose an avatar below`;
    return `${role === 'you' ? 'Your avatar' : 'Opponent'} slot, empty. Activate to choose this side next`;
  };
  // One search, both lists: the query narrows the avatar grid AND the deck rail
  // (a 50-deck stable is unusable as a blind horizontal scroll). A deck matches
  // on its own name OR its avatar's name, so typing "Battlemage" surfaces every
  // deck piloted by one. The selected deck always stays visible so a search
  // can't hide your own pick.
  const needle = q.trim().toLowerCase();
  const list = avatars.filter((a) => !needle || a.name.toLowerCase().includes(needle));
  const deckList = decks.filter((d) => !needle
    || d.name.toLowerCase().includes(needle)
    || d.avatar?.name?.toLowerCase().includes(needle)
    || d.id === deck?.id);
  const ready = isReady(sel);

  return (
    // `targeting-*` on the root is what lets the grid preview in pure CSS: the card
    // already holding the other role grows a dashed ghost badge in the slot this tap
    // would fill. No per-card JSX, no state threaded into 100+ cards.
    <div id="picker-screen" className={`cx-life-tracker${armed ? ` targeting-${ROLE_SUFFIX[armed]}` : ' both-chosen'}`}>
      <div className="picker-header">
        <h2>Choose Avatars</h2>
        <button className="picker-back" onClick={onCancel} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 16, height: 16 }}><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Match preview. A filled slot clears that role; an empty one targets it, so
          the next card tap lands there - which is how the same avatar reaches both
          sides. Targeting is visible state, never history. */}
      <div className="picker-matchup">
        {[['you', you, 'YOU'], ['opponent', opp, 'OPPONENT']].map(([role, val, caption], i) => (
          <React.Fragment key={role}>
            {i === 1 && <div className="pm-vs">VS</div>}
            <button type="button"
              className={`pm-slot role-${ROLE_SUFFIX[role]}${val ? ' filled' : ''}${armed === role ? ' armed' : ''}`}
              onClick={() => tapSlot(role)}
              aria-label={slotLabel(role, !!val, val?.name)}>
              {/* The role title heads its frame, so each side reads top-down:
                  who -> which avatar -> what a tap does. */}
              <div className="pm-role">{caption}</div>
              <div className="pm-thumb">
                {val ? <ArtImg artKey={val.image_slug} alt="" />
                     : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>}
              </div>
              {/* Name and hint always render so the two slots stay the same height and
                  VS never drifts; CSS reserves the rows.
                  The empty state says nothing on purpose - the glow already does. The
                  hint appears only once a slot is filled, because that is the one thing
                  the visuals cannot state: that this slot, not the card, is where
                  deselection lives. Project owner: "After picking, show 'Tap to
                  deselect' under the picked avatar." */}
              <div className="pm-name">{val ? val.name : ''}</div>
              <div className="pm-hint">{val ? 'Tap to deselect' : ''}</div>
            </button>
          </React.Fragment>
        ))}
      </div>
      {/* Pilot one of your decks - Compendium cross-pillar link */}
      {deckList.length > 0 && (
        <div className="picker-decks">
          <div className="picker-decks-label">PILOT A DECK</div>
          <div className="picker-decks-row">
            {deckList.map((d) => (
              <button key={d.id} className={`picker-deck-chip${deck?.id === d.id ? ' on' : ''}`} onClick={() => pickDeck(d)}>
                {d.avatar?.image_slug && <ArtImg artKey={d.avatar.image_slug} alt="" />}
                <span>{d.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search ABOVE the grid: keyboard-open shrinks the panel from the bottom only,
          so the results stay visible under the field (the old footer placement left a
          sliver). The matchup also compacts while the field is focused (CSS :has). */}
      <div className="picker-search-wrap">
        <div className={`picker-search${q ? ' has-text' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={decks.length ? 'Search avatars or decks…' : 'Search avatars…'} autoComplete="off" autoCapitalize="off" spellCheck="false" enterKeyHint="search" onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <button className="picker-search-clear" onClick={() => setQ('')} aria-label="Clear search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ width: 12, height: 12 }}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>

      <div className="picker-grid-wrap">
        <div className="avatar-grid">
          {list.map((a) => (
            <button type="button" key={a.card_id}
              className={`avatar-card${roleClass(a)}`}
              onClick={() => pick(a)}
              disabled={!armed}
              aria-pressed={rolesOf(sel, a).you || rolesOf(sel, a).opponent}
              aria-label={cardLabel(a.name, rolesOf(sel, a), armed)}>
              <ArtImg artKey={a.image_slug} alt="" loading="lazy" />
              {mirrored(a) && <span className="avatar-split" aria-hidden="true" />}
              <div className="avatar-card-name" aria-hidden="true">{a.name}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="picker-footer">
        <button className={`picker-confirm-btn${ready ? ' ready' : ''}`} onClick={() => ready && onConfirm(you, opp, deck)}>
          Continue
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
        </button>
      </div>
    </div>
  );
}
