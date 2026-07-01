// Deck detail — Cards/Stats tabs + Edit Deck above the name (consistent detail
// structure), hero, zone groups, stats (counts/record/mana curve), and the deck
// actions sheet (star/rename/duplicate/export/delete) + Curiosa/Markdown export.
import React, { useEffect, useState } from 'react';
import {
  getDeck, zoneGroups, zoneCounts, ZONE_MIN, collectionMax,
  toggleStar, renameDeck, duplicateDeck, deleteDeck, setArchetype,
  exportMarkdown, exportCuriosa,
} from '../store/deckRepository.js';
import { Chip, ChipRow, ThresholdPips, SectionLabel, BottomSheet, ListRow, IconButton } from '../components/ui.jsx';
import CardArt from '../components/CardArt.jsx';
import { cardFallbackArt } from '../store/cardArt.js';
import DeckStats from './DeckStats.jsx';
import { shareText } from '../native.js';
import { shareDeckPoster } from '../store/deckPoster.js';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import { getSettings, setSetting } from '../store/playRepository.js';

const ZLABEL = { spellbook: 'Spellbook', atlas: 'Atlas', collection: 'Collection' };

export default function DeckDetail({ deckId, onEnterAdd, onOpenCard, onChanged, onDeleted, rev }) {
  const [tab, setTab] = useState('cards');
  const [d, setD] = useState(null);
  const [groups, setGroups] = useState({});
  const [counts, setCounts] = useState({});
  const [exp, setExp] = useState(false);
  const [rarity, setRarity] = useState(false);   // rarity-colours toggle (app setting)
  useEffect(() => { getSettings().then((s) => setRarity(!!s.rarity_colors)); }, []);

  async function load() {
    const deck = await getDeck(deckId);
    if (!deck) { onDeleted?.(); return; }
    const g = {};
    for (const z of ['spellbook', 'atlas', 'collection']) g[z] = await zoneGroups(deckId, z);
    setD(deck); setGroups(g); setCounts(await zoneCounts(deckId));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [deckId, rev]);
  if (!d) return <div style={{ padding: 24, color: 'var(--ink-faint)' }}>…</div>;

  const avatarArt = d.avatar ? { name: d.avatar.name, image_slug: d.avatar.image_slug, elements: d.avatar.elements, thresholds: d.avatar.thresholds, card_id: d.avatar.card_id } : null;

  async function reload() { await load(); onChanged?.(); }

  return (
    <div style={{ animation: 'cxfade .2s ease' }}>
      {/* tabs + edit, above the name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px 12px' }}>
        <Chip label="Cards" active={tab === 'cards'} onClick={() => setTab('cards')} />
        <Chip label="Stats" active={tab === 'stats'} onClick={() => setTab('stats')} />
        <span style={{ flex: 1 }} />
        <span onClick={() => onEnterAdd(deckId, d.name)} style={editChip}>Edit Deck</span>
      </div>

      {/* hero */}
      <div style={{ position: 'relative', height: 112, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: avatarArt ? 'transparent' : cardFallbackArt({ name: d.name, elements: '[]' }) }}>
          {avatarArt && <CardArt card={avatarArt} radius={0} aspect="auto" />}
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(18,13,9,.32),rgba(18,13,9,.1) 42%,rgba(18,13,9,.94))' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 12, textAlign: 'center' }}>
          <div style={{ font: "700 22px/1.05 var(--f-display)", color: '#f0e9d8', textShadow: '0 2px 12px rgba(0,0,0,.85)' }}>{d.name}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            {d.archetype && <span style={{ font: "600 11px/1 var(--f-ui)", color: 'var(--gold-leaf)' }}>{d.archetype}</span>}
            <ThresholdPips runs={d.elems} />
          </div>
        </div>
      </div>

      {tab === 'cards'
        ? <CardsTab groups={groups} counts={counts} d={d} onOpenCard={onOpenCard} />
        : <DeckStats deck={d} rev={rev} onReload={reload} />}

      <ExportSheet open={exp} deckId={deckId} onClose={() => setExp(false)} />

      {/* Deck-view / stats FAB — full deck actions (Arcanum's #deck-fab menu) */}
      <Fab variant="deck" icon={<FabGlyph kind="dots" />} label="Deck actions" items={[
        { label: d?.starred ? 'Unfavourite' : 'Favourite', state: d?.starred ? '★' : '', onClick: async () => { await toggleStar(deckId); reload(); } },
        { label: 'Rarity colours', state: rarity ? '✓' : '✕', onClick: async () => { const v = rarity ? 0 : 1; setRarity(!rarity); await setSetting('rarity_colors', v); } },
        { label: 'Deck Spread', onClick: async () => { try { await shareDeckPoster(deckId); } catch (e) { alert('Could not build spread: ' + e.message); } } },
        { label: 'Rename', onClick: async () => { const n = prompt('Rename deck', d.name); if (n?.trim()) { await renameDeck(deckId, n.trim()); reload(); } } },
        { label: 'Duplicate', onClick: async () => { await duplicateDeck(deckId); onChanged?.(); } },
        { label: 'Export', onClick: () => setExp(true) },
        { label: 'Share as image', onClick: async () => { try { await shareDeckPoster(deckId); } catch (e) { alert('Could not build image: ' + e.message); } } },
        { label: 'Clear Log', onClick: () => alert('This deck has no match log yet.') },
        { label: 'Delete Deck', danger: true, onClick: async () => { if (confirm(`Delete “${d.name}”?`)) { await deleteDeck(deckId); onDeleted?.(); } } },
      ]} />
    </div>
  );
}

function CardsTab({ groups, counts, d, onOpenCard }) {
  const zones = ['spellbook', 'atlas', 'collection'].filter((z) => groups[z]?.length);
  if (!zones.length) return <Empty text="No cards yet. Tap Edit Deck to add some." />;
  return (
    <div style={{ padding: '8px 20px 26px' }}>
      {zones.map((z) => (
        <div key={z} style={{ marginBottom: 18 }}>
          <SectionLabel glyph="◆" label={ZLABEL[z].toUpperCase()} count={`${counts[z] || 0}${ZONE_MIN[z] ? '/' + ZONE_MIN[z] + '+' : '/' + collectionMax(d)}`} />
          {groups[z].map((g) => (
            <div key={g.label} style={{ marginBottom: 10 }}>
              <div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.12em', color: 'var(--ink-muted)', margin: '4px 0 6px' }}>{g.label} · {g.count}</div>
              {g.cards.map((c) => (
                <ListRow key={c.card_id} title={c.name} onClick={() => onOpenCard(c.card_id, c.name)}
                  icon={c.qty + '×'} iconBg="rgba(201,163,90,.07)"
                  trailing={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ThresholdPips runs={c.thr} /><span style={{ font: "500 12px/1 var(--f-mono)", color: 'var(--ink-muted)' }}>{c.cost ?? '–'}</span></span>} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DeckActions({ open, d, onClose, onStar, onRename, onArchetype, onDuplicate, onExport, onShareImage, onDelete }) {
  const item = (glyph, label, onClick, danger) => (
    <div onClick={onClick} className="cx-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}>
      <span style={{ width: 26, textAlign: 'center', color: danger ? 'var(--destructive)' : 'var(--gold-leaf)' }}>{glyph}</span>
      <span style={{ font: "600 14px/1 var(--f-ui)", color: danger ? 'var(--destructive)' : 'var(--ink-body)' }}>{label}</span>
    </div>
  );
  return (
    <BottomSheet open={open} title="DECK ACTIONS" onClose={onClose}>
      {item(d?.starred ? '★' : '☆', d?.starred ? 'Unstar' : 'Star deck', onStar)}
      {item('✎', 'Rename', onRename)}
      {item('◆', 'Set archetype', onArchetype)}
      {item('⎘', 'Duplicate', onDuplicate)}
      {item('⤓', 'Export (Markdown / Curiosa)', onExport)}
      {item('▦', 'Share as image', onShareImage)}
      {item('✕', 'Delete deck', onDelete, true)}
    </BottomSheet>
  );
}

function ExportSheet({ open, deckId, onClose }) {
  const [fmt, setFmt] = useState('arcanum');
  const [text, setText] = useState('');
  useEffect(() => {
    if (!open) return;
    (fmt === 'arcanum' ? exportMarkdown(deckId) : exportCuriosa(deckId)).then(setText);
  }, [open, fmt, deckId]);
  return (
    <BottomSheet open={open} title="EXPORT DECK" onClose={onClose}>
      <ChipRow style={{ marginBottom: 12 }}>
        <Chip label="Markdown" active={fmt === 'arcanum'} onClick={() => setFmt('arcanum')} />
        <Chip label="Curiosa" active={fmt === 'curiosa'} onClick={() => setFmt('curiosa')} />
      </ChipRow>
      <textarea readOnly value={text} style={{ width: '100%', height: 200, resize: 'none', background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: 12, color: 'var(--ink-body)', font: "400 13px/1.5 var(--f-mono)" }} />
      <button onClick={() => shareText('Deck export', text)} style={{ width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 13px/1 var(--f-ui)", border: 'none', cursor: 'pointer' }}>Share / Copy</button>
    </BottomSheet>
  );
}

const Empty = ({ text }) => <div style={{ padding: '40px 20px', textAlign: 'center', font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>{text}</div>;
const editChip = { padding: '7px 14px', borderRadius: 18, cursor: 'pointer', font: "600 12px/1 var(--f-ui)", color: 'var(--gold-leaf)', border: '1px solid var(--hair-40)', background: 'rgba(207,154,74,.12)', whiteSpace: 'nowrap' };
