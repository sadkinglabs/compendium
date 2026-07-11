// The deckbuilder's card-tap sheet (Edit Deck > Search). Same "trophy" chassis
// as the Collection card sheet - GothicSheet, glowing card art, centered name +
// hairline meta row, frosted-rose steppers - so the three card sheets read as one
// surface. Its distinct job: ZONE steppers that add to the card's home zone
// (Spellbook / Atlas, auto by type) or the deck's Collection, optimistic with a
// toast for add / remove / limit-reached, plus the card's stats and rule text.
import React, { useEffect, useRef, useState } from 'react';
import GothicSheet from './GothicSheet.jsx';
import { Loading, ThresholdPips } from './ui.jsx';
import { SheetArt, SetPill, CountCol, RARITY_HUE, typeLabel, EYEBROW } from './CollectionCardSheet.jsx';
import { getCard } from '../store/codexRepository.js';
import { changeQty, deckQty } from '../store/deckRepository.js';
import { thresholdRuns } from '../store/cardArt.js';
import { haptic } from '../native.js';

const jp = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };
// Never render an em dash (app-wide rule) - swap for a spaced hyphen.
const noEm = (s) => String(s || '').replace(/\s*—\s*/g, ' - ');
const HAIR = { width: 1, height: 14, background: 'rgba(107,90,46,.6)', flex: 'none' };
const smallCaps = (color) => ({ font: "600 12.5px/1 var(--f-display)", letterSpacing: '.2em', color, textTransform: 'uppercase' });
const DIVIDER = { height: 1, background: 'linear-gradient(90deg, transparent, #4a3c22 30%, #4a3c22 70%, transparent)', margin: '22px 0 16px' };

export default function CardSheet({ cardId, deckId, onChange, onClose, onOpenCodex }) {
  const [c, setC] = useState(null);
  const [counts, setCounts] = useState({ main: 0, collection: 0 });
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

  // step(field, delta) - field is 'main' (Spellbook/Atlas) or 'collection'; the
  // CountCol steppers call this. Optimistic, reverting + toasting on rejection.
  async function step(which, delta) {
    const zone = which === 'main' ? (c.is_site ? 'atlas' : 'spellbook') : 'collection';
    const label = which === 'main' ? (c.is_site ? 'Atlas' : 'Spellbook') : 'Collection';
    const prev = counts[which];
    if (prev + delta < 0) return;
    haptic('light');
    setCounts((m) => ({ ...m, [which]: prev + delta }));           // optimistic - instant
    const res = await changeQty(deckId, zone, c, delta);
    if (!res.ok) {
      setCounts((m) => ({ ...m, [which]: prev }));                 // revert on rejection
      showToast(res.reason || 'Not allowed');
      return;
    }
    showToast(delta > 0 ? `Added to ${label}` : `Removed from ${label}`);
    onChange?.();
  }

  return (
    <>
      <GothicSheet open={!!cardId} onClose={onClose} label="Card">
        {!c ? <Loading /> : (() => {
          const subs = jp(c.sub_types, []) || [];
          const sets = jp(c.sets, []) || [];
          const setName = sets[0]?.name;
          const runs = thresholdRuns(c);
          const flavor = jp(c.variants, []).map((v) => v?.flavorText).filter(Boolean)[0];
          const isMinion = /minion/i.test(c.type || '');

          // Meta row: rarity + type + subtype(s) + threshold icons, hairline-
          // separated, centered, wrapping (identical to the Collection sheet).
          const meta = [];
          if (c.rarity) meta.push(<span key="r" style={smallCaps(RARITY_HUE[c.rarity] || 'var(--ink-muted)')}>{c.rarity}</span>);
          meta.push(<span key="ty" style={smallCaps('#cba75f')}>{typeLabel(c)}</span>);
          if (subs.length) meta.push(<span key="s" style={{ font: "italic 500 17.5px/1 var(--f-read)", color: '#a99a80' }}>{subs.join(', ')}</span>);
          if (runs.length) meta.push(<ThresholdPips key="t" runs={runs} size={20} />);
          const metaRow = meta.flatMap((node, i) => (i === 0 ? [node] : [<span key={`h${i}`} aria-hidden="true" style={HAIR} />, node]));

          // Open stat columns (no boxes). POWER only for minions; LIFE where set.
          const stats = [];
          if (c.cost != null) stats.push(['MANA', c.cost]);
          if (isMinion && c.attack != null) stats.push(['POWER', c.attack === c.defence || c.defence == null ? c.attack : `${c.attack}/${c.defence}`]);
          if (c.is_avatar && c.life != null) stats.push(['LIFE', c.life]);

          return (
            <>
              {setName && <div style={{ textAlign: 'center', marginTop: 2 }}><SetPill name={setName} /></div>}
              <SheetArt c={c} />
              <div style={{ font: "700 27px/1.1 var(--f-display)", color: '#efe7d8', textAlign: 'center', marginTop: 20 }}>{c.name}</div>

              {metaRow.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>{metaRow}</div>
              )}

              {stats.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 48, marginTop: 18 }}>
                  {stats.map(([l, v], i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                      <span style={{ font: "700 24px/1 var(--f-display)", color: '#e3c589' }}>{v}</span>
                      <span style={{ font: "500 9.5px/1 var(--f-display)", letterSpacing: '.2em', color: '#8a8175' }}>{l}</span>
                    </div>
                  ))}
                </div>
              )}

              {c.rules_text && (
                <div style={{ maxWidth: 320, margin: '18px auto 0', textAlign: 'center', font: "400 16px/1.55 var(--f-read)", color: '#d8cebb' }}>{noEm(c.rules_text)}</div>
              )}
              {flavor && (
                <div style={{ maxWidth: 320, margin: '12px auto 0', textAlign: 'center', font: "italic 400 14.5px/1.5 var(--f-read)", color: '#8a8175' }}>{noEm(flavor)}</div>
              )}

              {deckId && !c.is_avatar && (
                <>
                  <div style={DIVIDER} />
                  <div style={{ ...EYEBROW, marginBottom: 16 }}>ADD TO THIS DECK</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, maxWidth: 300, margin: '0 auto' }}>
                    <CountCol label={c.is_site ? 'Atlas' : 'Spellbook'} field="main" qty={counts} step={step} />
                    <CountCol label="Collection" field="collection" qty={counts} step={step} />
                  </div>
                </>
              )}

              {onOpenCodex && (
                <button onClick={() => { onClose?.(); onOpenCodex(c.card_id, c.name); }}
                  style={{ display: 'block', width: '100%', marginTop: 24, padding: '15px 0', borderRadius: 16, background: 'linear-gradient(180deg, #d8b872, #b8954f)', border: '1px solid #e3c589', color: '#1a1206', font: "600 13.5px/1 var(--f-display)", boxShadow: '0 6px 20px rgba(203,167,95,.22)', cursor: 'pointer' }}>
                  Open in Codex - rulings & FAQ ›
                </button>
              )}
            </>
          );
        })()}
      </GothicSheet>
      <div className={`arc a-toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  );
}
