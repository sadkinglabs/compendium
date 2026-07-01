// Create-deck wizard — VERBATIM port of Arcanum's #onboard flow (openOnboarding
// / obNext, templates/index.html L1984-2085). Two mandatory steps:
//   1. Name the deck.
//   2. Pick an avatar — you CANNOT create a deck without one (obNext refuses).
// Visual shell is arcanum.css (.ob-* / .btn / .sheet-*). Avatar data comes from
// the unified catalogue via listAvatarCards().
import React, { useEffect, useRef, useState } from 'react';
import { listAvatarCards, createDeck } from '../store/deckRepository.js';
import '../theme/arcanum.css';

const BASE = import.meta.env.BASE_URL;

export default function CreateDeckWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [avatars, setAvatars] = useState([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);        // selected avatar card
  const nameRef = useRef(null);

  useEffect(() => { const t = setTimeout(() => nameRef.current?.focus(), 100); return () => clearTimeout(t); }, []);
  // Debounced avatar search (Arcanum: 250ms).
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
    // Step 2 — mandatory avatar.
    if (!sel) return;                            // Create button is disabled without one
    const id = await createDeck(name.trim(), { avatarCardId: sel.card_id });
    onCreated(id, name.trim());
  }

  const meta = (c) => {
    const parts = [];
    if (c.life != null) parts.push(`♥${c.life}`);
    if (c.attack != null) parts.push(`⚔${c.attack}`);
    const power = (c.subTypes || []).join(' · ') || c.rarity || '';
    if (power) parts.push(power);
    return parts.join(' · ');
  };

  return (
    <div className="arc ob-overlay" role="dialog" aria-modal="true">
      <div className="ob-inner">
        <div className="sheet-handle" />
        <div className="ob-header">
          <h2>{step === 1 ? 'New Deck' : 'Choose Avatar'}</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ob-steps">
          <div className={`ob-step done`}>1</div>
          <div className={`ob-step-line${step === 2 ? ' done' : ''}`} />
          <div className={`ob-step${step === 2 ? ' active' : ''}`}>2</div>
        </div>

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
              <div className={`ob-search-pill${q ? ' has-text' : ''}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search avatars…" autoComplete="off" />
                {q && <button className="search-clear-btn" onClick={() => setQ('')} aria-label="Clear">✕</button>}
              </div>
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
                    {c.image_slug && <img src={`${BASE}cards/${c.image_slug}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />}
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

        <div className="ob-footer">
          {step === 2 && <button className="btn" onClick={() => setStep(1)}>← Back</button>}
          <button className={`btn primary${step === 2 && !sel ? ' disabled' : ''}`} disabled={step === 2 && !sel}
            onClick={next} style={{ flex: 1 }}>
            {step === 1 ? 'Next →' : 'Create Deck ✓'}
          </button>
        </div>
      </div>
    </div>
  );
}
