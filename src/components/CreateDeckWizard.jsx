// Create-deck wizard - implements Deckbuilder's #onboard flow (openOnboarding
// / obNext, templates/index.html L1984-2085). Two mandatory steps:
//   1. Name the deck.
//   2. Pick an avatar - you CANNOT create a deck without one (obNext refuses).
// Visual shell is decks.css (.ob-* / .btn / .sheet-*). Avatar data comes from
// the unified catalogue via listAvatarCards().
import React, { useEffect, useRef, useState } from 'react';
import { listAvatarCards, createDeck } from '../store/deckRepository.js';
import { ArtImg } from './ArtImage.jsx';
import SearchPill from './SearchPill.jsx';
import GothicSheet from './GothicSheet.jsx';
import { toast } from '../feedback.js';
import '../theme/decks.css';


export default function CreateDeckWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [avatars, setAvatars] = useState([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);        // selected avatar card
  const [busy, setBusy] = useState(false);     // in-flight create guard (no double deck)
  const [closing, setClosing] = useState(false);   // plays the chassis exit motion before onClose unmounts us
  const nameRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => nameRef.current?.focus(), 100); return () => clearTimeout(t); }, []);
  // Debounced avatar search (Deckbuilder: 250ms).
  useEffect(() => {
    if (step !== 2) return;
    const t = setTimeout(() => { listAvatarCards(q).then(setAvatars); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [step, q]);

  async function next() {
    if (step === 1) {
      if (!name.trim()) { nameRef.current?.focus(); return; }
      setStep(2);
      return;
    }
    // Step 2 - mandatory avatar.
    if (!sel || busy) return;                    // Create button is disabled without one / while creating
    setBusy(true);
    try {
      const id = await createDeck(name.trim(), { avatarCardId: sel.card_id });
      onCreated(id, name.trim());
    } catch (e) { setBusy(false); toast('Could not create deck: ' + e.message, { tone: 'danger' }); }
  }
  const nextDisabled = (step === 1 && !name.trim()) || (step === 2 && (!sel || busy));

  const meta = (c) => {
    const parts = [];
    if (c.life != null) parts.push(`${c.life} HP`);
    if (c.attack != null) parts.push(`${c.attack} ATK`);
    const power = (c.subTypes || []).join(' · ') || c.rarity || '';
    if (power) parts.push(power);
    return parts.join(' · ');
  };

  // On the canonical chassis (spec section 6, phase 5). LOCKED by owner ruling
  // (spec Open Question 5): no scrim tap, no drag - the X (and Android back, which
  // the chassis consumes) are the only exits, so a stray swipe cannot abandon the
  // mandatory 2-step flow. `closing` plays the exit motion before the caller
  // unmounts us (conditional-render caller + onExited handshake).
  return (
    <GothicSheet
      open={!closing} dismissible={false}
      label={step === 1 ? 'New Deck' : 'Choose Avatar'}
      onClose={onClose} onExited={() => { if (closing) onClose(); }}
      header={(
        <div className="cx-decks">
          <div className="ob-header">
            <h2>{step === 1 ? 'New Deck' : 'Choose Avatar'}</h2>
            <button className="sheet-close" onClick={() => setClosing(true)} aria-label="Close">{XSvg}</button>
          </div>
          <div className="ob-steps">
            <div className={`ob-step done`}>1</div>
            <div className={`ob-step-line${step === 2 ? ' done' : ''}`} />
            <div className={`ob-step${step === 2 ? ' active' : ''}`}>2</div>
          </div>
        </div>
      )}
      footer={(
        <div className="cx-decks">
          <div className="ob-footer">
            {step === 2 && <button className="btn" onClick={() => setStep(1)}>{BackSvg}Back</button>}
            <button className={`btn primary${nextDisabled ? ' disabled' : ''}`} disabled={nextDisabled}
              onClick={next} style={{ flex: 1 }}>
              {step === 1 ? <>Next{NextSvg}</> : busy ? 'Creating…' : <>{CheckSvg}Create Deck</>}
            </button>
          </div>
        </div>
      )}
    >
      <div className="cx-decks">
        {step === 1 ? (
          <div className="ob-step1">
            <input ref={nameRef} type="text" value={name} maxLength={40} placeholder="Name your deck…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') next(); }}
              autoComplete="off" aria-label="Deck name" />
          </div>
        ) : (
          <div className="ob-step2">
            <div className="ob-search-pill-wrap">
              {/* Folded onto the canonical chassis (owner ruling D2) - the gold-hairline
                  clone is retired. The 250ms/0ms scheduling stays with this owner. */}
              <SearchPill inline value={q} onChange={setQ} placeholder="Search avatars…" ariaLabel="Search avatars" />
            </div>
            {sel && (
              <div className="ob-preview">
                <div className="ob-preview-name">{sel.name}</div>
                <div className="ob-preview-stats">
                  {sel.life != null && <span className="ob-preview-stat"><span className="label">HP</span><span>{sel.life}</span></span>}
                  {sel.attack != null && <span className="ob-preview-stat"><span className="label">ATK</span><span>{sel.attack}</span></span>}
                </div>
                <div className="ob-preview-type">{(sel.subTypes || []).join(' · ') || sel.rarity || ''}</div>
                <div className="ob-preview-rules">{sel.rules_text || ''}</div>
              </div>
            )}
            <div className="ob-avatar-list">
              <div className="ob-avatar-grid">
                {avatars.map((c) => (
                  <div key={c.card_id} className={`ob-av-card${sel?.card_id === c.card_id ? ' selected' : ''}`} onClick={() => setSel(c)}>
                    {c.image_slug && <ArtImg artKey={c.image_slug} alt="" />}
                    <div className="ob-av-card-grad" />
                    <div className="ob-av-card-info">
                      <div className="ob-av-card-name">{c.name}</div>
                      <div className="ob-av-card-meta">{meta(c)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </GothicSheet>
  );
}

/* icons - the app speaks SVG, never glyph characters */
export const XSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ width: 13, height: 13 }} aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>;
const BackSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="14 6 8 12 14 18" /></svg>;
const NextSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>;
const CheckSvg = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;
