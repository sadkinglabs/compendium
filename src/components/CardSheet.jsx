// Card-tap detail sheet — VERBATIM Arcanum #card-sheet layout on the shared
// Arcanum Sheet: art · name/type · rarity·subtypes · flavor · stat chips · rules,
// and (in a deck) zone steppers that add to the card's home zone (Spellbook or
// Atlas, auto by type) or Collection. Steppers are optimistic (instant) with a
// toast for add / remove / limit-reached.
import React, { useEffect, useRef, useState } from 'react';
import Sheet from './Sheet.jsx';
import { getCard } from '../store/codexRepository.js';
import { changeQty, deckQty } from '../store/deckRepository.js';

const BASE = import.meta.env.BASE_URL;
const jp = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
const RARITY = { Ordinary: 'var(--ordinary)', Exceptional: 'var(--exceptional)', Elite: 'var(--elite)', Unique: 'var(--unique)' };

export default function CardSheet({ cardId, deckId, onChange, onClose }) {
  const [c, setC] = useState(null);
  const [counts, setCounts] = useState({ main: 0, collection: 0 });
  const [pop, setPop] = useState({ main: 0, collection: 0 });
  const [toast, setToast] = useState('');
  const toastT = useRef();

  useEffect(() => { if (cardId) { setC(null); getCard(cardId).then(setC); } }, [cardId]);
  useEffect(() => {
    if (!c || !deckId) return;
    let alive = true;
    const mainZone = c.is_site ? 'atlas' : 'spellbook';
    Promise.all([deckQty(deckId, mainZone, c.card_id), deckQty(deckId, 'collection', c.card_id)])
      .then(([m, co]) => { if (alive) setCounts({ main: m, collection: co }); });
    return () => { alive = false; };
  }, [c, deckId]);

  function showToast(msg) { setToast(msg); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(''), 1700); }

  async function step(which, delta) {
    const zone = which === 'main' ? (c.is_site ? 'atlas' : 'spellbook') : 'collection';
    const label = which === 'main' ? (c.is_site ? 'Atlas' : 'Spellbook') : 'Collection';
    const prev = counts[which];
    if (prev + delta < 0) return;
    setCounts((m) => ({ ...m, [which]: prev + delta }));           // optimistic — instant
    setPop((p) => ({ ...p, [which]: p[which] + 1 }));
    const res = await changeQty(deckId, zone, c, delta);
    if (!res.ok) {
      setCounts((m) => ({ ...m, [which]: prev }));                 // revert on rejection
      showToast(res.reason || 'Not allowed');
      return;
    }
    showToast(delta > 0 ? `Added to ${label}` : `Removed from ${label}`);
    onChange?.();
  }

  if (!cardId) return null;

  const th = c ? jp(c.thresholds, {}) : {};
  const subs = c ? jp(c.sub_types, []) : [];
  const flavor = c ? (jp(c.variants, []).map((v) => v?.flavorText).filter(Boolean)[0]) : null;
  const thIcons = ['air', 'earth', 'fire', 'water'].flatMap((el) => Array(th?.[el] || 0).fill(el));

  const StepRow = ({ label, which }) => (
    <div className="zone-stepper-row">
      <span className="zone-stepper-label">{label}</span>
      <button className="zone-stepper-btn" onClick={() => step(which, -1)}>−</button>
      <span key={pop[which]} className={`zone-stepper-count${pop[which] ? ' pop' : ''}`}>{counts[which]}</span>
      <button className="zone-stepper-btn" onClick={() => step(which, 1)}>+</button>
    </div>
  );

  return (
    <>
      <Sheet open onClose={onClose}>
        {!c ? <div style={{ color: 'var(--muted)', padding: 16 }}>…</div> : (
          <>
            {c.image_slug && (c.is_site
              ? <div className="sheet-site-wrap"><img src={`${BASE}cards/${c.image_slug}`} onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }} alt="" /></div>
              : <img className="sheet-card-img" src={`${BASE}cards/${c.image_slug}`} onError={(e) => { e.currentTarget.style.display = 'none'; }} alt="" />)}
            <div className="sheet-name-row">
              <span className="sheet-name">{c.name}</span>
              {c.type && <span className="sheet-type-inline">{c.type}</span>}
            </div>
            {(c.rarity || subs.length > 0) && (
              <div className="sheet-meta">
                {c.rarity && <span style={{ color: RARITY[c.rarity] || 'var(--muted)' }}>{c.rarity}</span>}
                {subs.length > 0 ? (c.rarity ? ' · ' : '') + subs.join(', ') : ''}
              </div>
            )}
            {flavor && <div className="sheet-flavor">"{flavor}"</div>}
            <div className="sheet-stats">
              {c.cost != null && <div className="stat-chip"><div className="label">Mana</div><div className="value">{c.cost}</div></div>}
              {thIcons.length > 0 && <div className="stat-chip"><div className="label">THR</div><div className="value">{thIcons.map((el, i) => <img key={i} src={`${BASE}icons/${el}.png`} style={{ width: 13, height: 13 }} alt="" />)}</div></div>}
              {/minion/i.test(c.type || '') && c.attack != null && (c.attack === c.defence
                ? <div className="stat-chip"><div className="label">Power</div><div className="value">{c.attack}</div></div>
                : <><div className="stat-chip"><div className="label">ATK</div><div className="value">{c.attack}</div></div><div className="stat-chip"><div className="label">DEF</div><div className="value">{c.defence}</div></div></>)}
              {!!c.is_avatar && c.life != null && <div className="stat-chip"><div className="label">Life</div><div className="value">{c.life}</div></div>}
            </div>
            {c.rules_text && <div className="sheet-rules">{c.rules_text}</div>}
            {deckId && !c.is_avatar && (
              <div className="zone-stepper">
                <StepRow label={c.is_site ? 'Atlas' : 'Spellbook'} which="main" />
                <StepRow label="Collection" which="collection" />
              </div>
            )}
          </>
        )}
      </Sheet>
      <div className={`arc a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}
