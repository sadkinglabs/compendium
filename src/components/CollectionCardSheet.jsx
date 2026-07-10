// The COLLECTION pillar's card-tap detail sheet. Three surfaces show a card and
// each has a distinct job: CardSheet.jsx is the deckbuilder's (deck-zone
// steppers), CodexDetail.jsx is the full page (stats, rules, rulings, FAQ), and
// THIS sheet is about OWNING the card: a centered, symmetric "trophy" layout -
// glowing card art over its identity, then Owned / Foil / Wishlist counts and a
// pair of actions (add-to-list · open in Codex). No rule text; no decorative
// glyphs but the Foil ✦. Behaviour (open/close, hardware-back, drag-to-dismiss,
// the ledger writes) is unchanged - this is a presentational restructure.
import React, { useEffect, useState } from 'react';
import GothicSheet from './GothicSheet.jsx';
import { Loading, ThresholdPips } from './ui.jsx';
import CardArt from './CardArt.jsx';
import { thresholdRuns, cardImageUrl, cardFallbackArt } from '../store/cardArt.js';
import { getCard } from '../store/codexRepository.js';
import { listCardLists, listsWithCard, stepListEntry } from '../store/ownedRepository.js';
import { useOwnedLedger } from './OwnedControl.jsx';
import { haptic } from '../native.js';

const jp = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };

// The card-face glow, tinted by the card's dominant affinity (falls back to the
// spec's blue for colourless cards). rgba of store/cardArt.js's elementColor.
const GLOW = { air: 'rgba(103,182,196,.5)', earth: 'rgba(179,92,51,.5)', fire: 'rgba(210,100,90,.5)', water: 'rgba(91,135,214,.5)' };
function glowColor(c) {
  const th = jp(c?.thresholds, {}) || {};
  let best = null, n = 0;
  for (const el of ['air', 'earth', 'fire', 'water']) if ((th[el] || 0) > n) { n = th[el]; best = el; }
  if (!best) best = (jp(c?.elements, []) || [])[0]?.toLowerCase();
  return GLOW[best] || 'rgba(74,146,196,.5)';
}

// The card's type in small caps for the meta row: the base type (MINION, MAGIC,
// AURA, ARTIFACT) for spells, or SITE / AVATAR. No "spell" prefix; the subtype
// beside it already reads it as a spell.
function typeLabel(c) {
  if (c.is_site) return 'SITE';
  if (c.is_avatar) return 'AVATAR';
  return (c.type || '').trim().toUpperCase() || 'CARD';
}

/* ---- shared bits ---- */

const EYEBROW = { font: "600 13px/1 var(--f-display)", letterSpacing: '.24em', color: '#cba75f', textAlign: 'center' };

// A flat frosted-glass stepper button: 32px visual circle inside a >=44px hit
// area, with a pressed/hover accent lift (no gradients, no shadows). Ruby accent
// stays chrome-only.
function StepBtn({ dir, onClick, disabled }) {
  const [act, setAct] = useState(false);
  const on = act && !disabled;
  return (
    <button
      aria-label={dir > 0 ? 'Increase' : 'Decrease'} disabled={disabled} onClick={onClick}
      onPointerDown={() => setAct(true)} onPointerUp={() => setAct(false)} onPointerLeave={() => setAct(false)}
      onMouseEnter={() => setAct(true)} onMouseLeave={() => setAct(false)}
      style={{ width: 44, height: 44, padding: 0, border: 'none', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1 }}
    >
      <span style={{
        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? 'rgba(224,169,177,.16)' : 'rgba(224,169,177,.06)',
        border: `1px solid ${on ? 'rgba(240,190,198,.45)' : 'rgba(224,169,177,.28)'}`,
        color: '#f0c8ce', font: "600 19px/1 var(--f-ui)",
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', transition: 'background .12s, border-color .12s',
      }}>{dir > 0 ? '+' : '−'}</span>
    </button>
  );
}

// One count column: label · big count · − + steppers. Foil's label carries a
// gold ✦.
function CountCol({ label, foil = false, field, qty, step }) {
  const v = qty?.[field] || 0;
  const loading = qty === null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
      <span style={{ font: "500 15px/1 var(--f-read)", color: '#a99a80' }}>
        {label}{foil && <span style={{ color: '#e3c589', marginLeft: 3, textShadow: '0 0 8px rgba(227,197,137,.5)' }}>✦</span>}
      </span>
      <span style={{ font: "500 29px/1 var(--f-display)", color: '#efe7d8', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StepBtn dir={-1} disabled={loading || v === 0} onClick={() => step(field, -1)} />
        <StepBtn dir={1} disabled={loading} onClick={() => step(field, 1)} />
      </div>
    </div>
  );
}

// The add-to-list picker: the profile's lists (wanted goals first, then custom),
// each tappable - a tap adds ONE copy and stays open, so multi-list / multi-copy
// adds are just taps, the per-list count confirming each.
function ListPicker({ cardId, onBack }) {
  const [lists, setLists] = useState(null);
  const [inLists, setInLists] = useState(new Map());
  useEffect(() => {
    let alive = true;
    Promise.all([listCardLists(), listsWithCard(cardId)]).then(([all, mine]) => {
      if (!alive) return;
      setLists(all);
      setInLists(new Map(mine.map((m) => [m.id, m.quantity])));
    });
    return () => { alive = false; };
  }, [cardId]);
  const add = async (list) => {
    haptic('light');
    setInLists((prev) => { const m = new Map(prev); m.set(list.id, (m.get(list.id) || 0) + 1); return m; });
    try { await stepListEntry(list.id, cardId, +1); } catch { /* refresh on next open */ }
  };
  const section = (title, items, hint) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ font: "600 10px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--accent-ruby)', margin: '2px 0 6px' }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ font: "italic 400 12.5px/1.4 var(--f-read)", color: 'var(--ink-faint)', padding: '4px 0 2px' }}>{hint}</div>
      ) : items.map((l) => {
        const n = inLists.get(l.id) || 0;
        return (
          <button key={l.id} onClick={() => add(l)} style={{
            display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '12px 4px', textAlign: 'left',
            background: 'none', border: 'none', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer',
          }}>
            <span style={{ flex: 1, minWidth: 0, font: "600 14.5px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
            {n > 0 && <span style={{ flex: 'none', font: "600 11px/1 var(--f-mono)", color: 'var(--accent-jade)', padding: '4px 7px', border: '1px solid var(--hair-12)', borderRadius: 999 }}>{l.kind === 'wanted' ? `want ${n}` : `× ${n}`}</span>}
            <span style={{ flex: 'none', font: "600 15px/1 var(--f-ui)", color: 'var(--accent-ruby)' }}>+</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <>
      <div style={{ ...EYEBROW, marginBottom: 16 }}>ADD TO LIST</div>
      {lists == null ? <Loading /> : (
        <>
          {section('WANTED LISTS', lists.filter((l) => l.kind === 'wanted'), 'No wanted lists yet - create goals in Collection › Lists.')}
          {section('CARD LISTS', lists.filter((l) => l.kind === 'custom'), 'No card lists yet - create them in Collection › Lists.')}
        </>
      )}
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--ink-muted)', font: "600 13px/1 var(--f-ui)", padding: '12px 0 2px', width: '100%', textAlign: 'center', cursor: 'pointer' }}>‹ Back to card</button>
    </>
  );
}

// A centered set pill (the sheet's top eyebrow slot).
function SetPill({ name }) {
  return (
    <span style={{ display: 'inline-block', padding: '5px 13px', borderRadius: 20, border: '1px solid #4a3c22', background: 'rgba(42,33,20,.5)', font: "500 11.5px/1 var(--f-display)", letterSpacing: '.16em', color: '#c9b487', textTransform: 'uppercase' }}>{name}</span>
  );
}

// Site art in its TRUE landscape orientation. Sites ship as a portrait image (a
// landscape card rotated 90° for storage), so the FRAME goes landscape (531:380,
// the real card ratio) and the image is sized to the swapped dimensions then
// counter-rotated to fill it upright - the canonical .sheet-site-wrap technique.
function SiteArt({ c }) {
  const [broken, setBroken] = useState(false);
  const url = cardImageUrl(c);
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '531 / 380', borderRadius: 11, overflow: 'hidden', background: cardFallbackArt(c) }}>
      {url && !broken && (
        <img src={url} alt={c.name || ''} loading="lazy" onError={() => setBroken(true)}
          style={{ position: 'absolute', top: '50%', left: '50%', width: 'calc(100% * 380 / 531)', height: 'calc(100% * 531 / 380)', objectFit: 'cover', transform: 'translate(-50%,-50%) rotate(90deg)', display: 'block' }} />
      )}
    </div>
  );
}

// The glowing card frame - portrait for cards, flipped landscape for Sites.
function SheetArt({ c }) {
  const site = !!c.is_site;
  return (
    <div style={{ position: 'relative', width: site ? 244 : 172, margin: '14px auto 0' }}>
      <div aria-hidden="true" style={{ position: 'absolute', inset: -16, borderRadius: 24, background: `radial-gradient(circle at 50% 45%, ${glowColor(c)}, transparent 70%)`, filter: 'blur(16px)', zIndex: 0 }} />
      <div style={{ position: 'relative', zIndex: 1, borderRadius: 12, padding: 1, background: 'linear-gradient(160deg, rgba(203,167,95,.7), rgba(203,167,95,.12) 45%, rgba(203,167,95,.5))' }}>
        {site ? <SiteArt c={c} /> : <CardArt card={c} radius={11} aspect="5/7" />}
      </div>
    </div>
  );
}

// The centered card body. useOwnedLedger only mounts here (once the card exists).
function CardBody({ c, onOpenCodex, onPick }) {
  const { qty, step } = useOwnedLedger(c.card_id);
  const subs = jp(c.sub_types, []) || [];
  const sets = jp(c.sets, []) || [];
  const runs = thresholdRuns(c);
  const setName = sets[0]?.name;
  const hair = <span aria-hidden="true" style={{ width: 1, height: 14, background: 'rgba(107,90,46,.6)', flex: 'none' }} />;
  const smallCaps = (color) => ({ font: "600 12.5px/1 var(--f-display)", letterSpacing: '.2em', color, textTransform: 'uppercase' });
  // Meta row: rarity + type sit together (the type moved down off the header),
  // then subtype(s), then threshold icons. Hairline-separated, wraps if tight.
  const meta = [];
  if (c.rarity) meta.push(<span key="r" style={smallCaps('#c48b6a')}>{c.rarity}</span>);
  meta.push(<span key="ty" style={smallCaps('#cba75f')}>{typeLabel(c)}</span>);
  if (subs.length) meta.push(<span key="s" style={{ font: "italic 500 17.5px/1 var(--f-read)", color: '#a99a80' }}>{subs.join(', ')}</span>);
  if (runs.length) meta.push(<ThresholdPips key="t" runs={runs} size={20} />);
  const metaRow = meta.flatMap((node, i) => (i === 0 ? [node] : [React.cloneElement(hair, { key: `h${i}` }), node]));

  return (
    <>
      {/* Header slot: the set pill (was the type eyebrow; the type moved to meta). */}
      {setName && <div style={{ textAlign: 'center', marginTop: 2 }}><SetPill name={setName} /></div>}

      <SheetArt c={c} />

      <div style={{ font: "700 27px/1.1 var(--f-display)", color: '#efe7d8', textAlign: 'center', marginTop: 20 }}>{c.name}</div>

      {metaRow.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>{metaRow}</div>
      )}

      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, #4a3c22 30%, #4a3c22 70%, transparent)', margin: '22px 0 18px' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <CountCol label="Owned" field="owned" qty={qty} step={step} />
        <CountCol label="Foil" foil field="foil" qty={qty} step={step} />
        <CountCol label="Wishlist" field="wanted" qty={qty} step={step} />
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 26 }}>
        <button onClick={onPick} style={{ flex: 1, padding: '15px 0', borderRadius: 16, background: 'transparent', border: '1px solid #4a3c22', color: '#d8c9a4', font: "500 13.5px/1 var(--f-display)", cursor: 'pointer' }}>Add to a list</button>
        {onOpenCodex && (
          <button onClick={() => onOpenCodex(c.card_id, c.name)} style={{ flex: 1.15, padding: '15px 0', borderRadius: 16, background: 'linear-gradient(180deg, #d8b872, #b8954f)', border: '1px solid #e3c589', color: '#1a1206', font: "600 13.5px/1 var(--f-display)", boxShadow: '0 6px 20px rgba(203,167,95,.22)', cursor: 'pointer' }}>Open in Codex ›</button>
        )}
      </div>
    </>
  );
}

export default function CollectionCardSheet({ cardId, onClose, onOpenCodex }) {
  const [c, setC] = useState(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (cardId) { setC(null); setPicking(false); getCard(cardId).then(setC); } }, [cardId]);
  return (
    <GothicSheet open={!!cardId} onClose={onClose} label="Card">
      {!c ? <Loading /> : picking
        ? <ListPicker cardId={c.card_id} onBack={() => setPicking(false)} />
        : <CardBody c={c} onOpenCodex={onOpenCodex} onPick={() => setPicking(true)} />}
    </GothicSheet>
  );
}
