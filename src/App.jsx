import React, { useEffect, useState, useRef } from 'react';
import { openDatabase } from './store/db.js';
import {
  initProfiles, getActiveProfile, listProfiles, profileStats,
  createProfile, switchProfile, renameProfile, deleteProfile,
} from './store/profileRepository.js';
import { seedCatalogIfNeeded } from './store/catalog.js';
import { resolveByName } from './store/codexRepository.js';
import { searchAll } from './store/searchRepository.js';
import Codex from './pillars/Codex.jsx';
import CodexDetail from './pillars/CodexDetail.jsx';
import { ImportUrlSheet, ImportTextSheet } from './pillars/Decks.jsx';
import DecksPager from './pillars/DecksPager.jsx';
import Fab, { FabGlyph } from './components/Fab.jsx';
import CreateDeckWizard from './components/CreateDeckWizard.jsx';
import { importFromText, importCuriosaUrl } from './store/deckRepository.js';
import DeckAddCards from './pillars/DeckAddCards.jsx';
import Play from './pillars/Play.jsx';
import LifeCounter from './pillars/LifeCounter.jsx';
import AvatarPicker from './pillars/AvatarPicker.jsx';
import Home from './pillars/Home.jsx';
import { getSettings, recordMatch } from './store/playRepository.js';
import { loadOngoing, saveOngoing, clearOngoing } from './store/ongoingMatch.js';
import { setResume } from './store/homeRepository.js';
import { exportToFile, pickAndImport, duplicateProfile } from './store/profileTransfer.js';
import { onBackButton, exitApp } from './native.js';
import { ListRow, IconButton, Loading } from './components/ui.jsx';
import Sheet from './components/Sheet.jsx';

const PILLARS = [
  { key: 'home',  glyph: '⌂', label: 'Home',  eyebrow: 'YOUR WORKSPACE',   accent: 'var(--accent-gold)' },
  { key: 'codex', glyph: '▤', label: 'Codex', eyebrow: 'RULES & CARDS',     accent: 'var(--accent-gold)' },
  { key: 'decks', glyph: '◈', label: 'Decks', eyebrow: 'YOUR DECKS',        accent: 'var(--accent-violet)' },
  { key: 'play',  glyph: '♥', label: 'Play',  eyebrow: 'DUEL & TRACK LIFE', accent: 'var(--accent-jade)' },
];

export default function App() {
  const [boot, setBoot] = useState({ status: 'loading' });
  const [tab, setTab] = useState('home');
  const [detail, setDetail] = useState(null);     // {kind,id,title}
  const [history, setHistory] = useState([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [codexPreset, setCodexPreset] = useState(null);   // one-shot filter preset (e.g. Home "All notes ›")
  const [rev, setRev] = useState(0);
  const [profileSheet, setProfileSheet] = useState(false);
  const [profile, setProfile] = useState(null);
  const [addMode, setAddMode] = useState(null);     // {deckId, deckName}
  const [addQuery, setAddQuery] = useState('');
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [addFilterCount, setAddFilterCount] = useState(0);
  const [match, setMatch] = useState(null);          // {mode, settings, you, opp, resume?}
  const [preMatch, setPreMatch] = useState(null);    // {mode, settings} — avatar picker step
  const [ongoing, setOngoing] = useState(() => loadOngoing());  // minimized, resumable match snapshot
  const counterApi = useRef(null);                   // {minimize} — set by the live counter
  const [deckWizard, setDeckWizard] = useState(false);   // create-deck 2-step wizard
  const [importMode, setImportMode] = useState(null);    // 'url' | 'text' — which import sheet
  const [deckOpen, setDeckOpen] = useState(null);        // {id,name} deck loaded in the Decks pillar
  const booted = useRef(false);
  const backRef = useRef(null);   // latest hardware-back handler (set each render)
  useEffect(() => onBackButton(() => backRef.current?.()), []);

  useEffect(() => {
    if (booted.current) return;   // run boot once (StrictMode double-invokes effects)
    booted.current = true;
    (async () => {
      try {
        await openDatabase();
        const { counts } = await seedCatalogIfNeeded();
        const p = await initProfiles();
        setProfile(p);
        if (import.meta.env.DEV) {
          window.__cx = {
            transfer: await import('./store/profileTransfer.js'),
            deck: await import('./store/deckRepository.js'),
            codex: await import('./store/codexRepository.js'),
            profile: await import('./store/profileRepository.js'),
          };
        }
        setBoot({ status: 'ready', counts });
      } catch (e) {
        setBoot({ status: 'error', error: String(e?.message || e) });
      }
    })();
  }, []);

  if (boot.status === 'loading') return <Splash text="Opening the grimoire…" />;
  if (boot.status === 'error') return <Splash text={'Store error: ' + boot.error} error />;

  const addActive = !!addMode;
  const hasQuery = query.trim().length > 0 && !addActive;
  const viewDetail = detail && !hasQuery && !addActive;
  const pillar = PILLARS.find((p) => p.key === tab);

  const goTab = (t) => { setTab(t); setDetail(null); setHistory([]); setQuery(''); setAddMode(null); };
  const enterAdd = (deckId, deckName) => { setAddMode({ deckId, deckName }); setAddQuery(''); setAddFilterOpen(false); };
  const exitAdd = () => { setAddMode(null); bump(); };
  const openNewMatch = async (mode) => {
    const settings = await getSettings();
    if (mode === 'quick') setMatch({ mode, settings, you: null, opp: null });
    else setPreMatch({ mode, settings });
  };
  const startMatch = async (mode) => {
    if (ongoing && !confirm('You have a match in progress. Start a new one? The current match will be discarded.')) return;
    setOngoing(null); clearOngoing();
    openNewMatch(mode);
  };
  const beginMatch = (you, opp, deck) => { setMatch({ ...preMatch, you, opp, deck: deck || null }); setPreMatch(null); };
  // Ongoing-match lifecycle: minimize preserves a resumable snapshot; resume
  // re-opens the counter from it; record saves to history (counter stays open);
  // exit / new discard the in-progress game.
  const minimizeMatch = (snap) => { setOngoing(snap); saveOngoing(snap); setMatch(null); };
  const resumeMatch = () => {
    if (!ongoing) return;
    setMatch({ mode: ongoing.mode, settings: ongoing.settings, you: ongoing.you, opp: ongoing.opp, deck: ongoing.deck || null, resume: ongoing });
    setOngoing(null); clearOngoing();
  };
  const recordMatchResult = async (result) => { await recordMatch(result); bump(); };
  const exitMatch = () => { setMatch(null); setOngoing(null); clearOngoing(); bump(); };
  const newMatchFromEnd = (mode) => { setMatch(null); setOngoing(null); clearOngoing(); openNewMatch(mode); };
  const open = (kind, id, title) => {
    // Decks always open in the Decks pager (My Deck), NOT the legacy DeckDetail
    // route. Every deck link (Home carousel, search, resume, marginalia) lands here.
    if (kind === 'deck') {
      if (title) setResume('deck', id, title).catch(() => {});
      setQuery(''); goTab('decks'); setDeckOpen({ id, name: title });
      return;
    }
    setHistory((h) => [...h, { detail, query }]);
    setDetail({ kind, id, title }); setQuery('');
    if (['card', 'rule'].includes(kind) && title) setResume(kind, id, title).catch(() => {});
  };
  const back = () => {
    setHistory((h) => {
      const n = [...h]; const prev = n.pop();
      setDetail(prev ? prev.detail : null);
      return n;
    });
  };
  const openName = async (name) => {
    const t = await resolveByName(name);
    if (t) open(t.kind, t.id, name);
  };
  const bump = () => setRev((r) => r + 1);

  async function reloadProfile() { setProfile(await getActiveProfile()); }
  async function onSwitchProfile(id) {
    await switchProfile(id);
    await reloadProfile();
    setOngoing(loadOngoing());   // ongoing match is profile-scoped
    setProfileSheet(false); setDetail(null); setHistory([]); setQuery(''); setTab('home'); bump();
  }

  const initial = (profile?.name || '?').charAt(0).toUpperCase();
  const searchable = true;   // universal search on every pillar
  const placeholders = { home: 'Search rules, cards, decks…', codex: 'Search the codex…', decks: 'Search decks…', play: 'Search matches…' };

  // Hardware back: close the topmost layer, else go home, else exit.
  backRef.current = () => {
    if (match) return counterApi.current?.minimize?.();   // back preserves the match
    if (preMatch) return setPreMatch(null);
    if (deckWizard) return setDeckWizard(false);
    if (importMode) return setImportMode(null);
    if (profileSheet) return setProfileSheet(false);
    if (addActive) return exitAdd();
    if (hasQuery) return setQuery('');
    if (viewDetail) return back();
    if (tab !== 'home') return goTab('home');
    return exitApp();
  };

  // Per-pillar top-down colour wash (over pure black). Home is pure black (no
  // wash) to signal active engagement; Codex=warm gold · Decks=Arcanum amethyst ·
  // Play=Vitarum green.
  const WASH = { home: '#000', codex: '#33260e', decks: '#2a1c44', play: '#18301f' };
  // Canonical list-row accent, morphing per pillar (grimoire gold default;
  // amethyst in Decks, jade in Play) — consumed by ListRow via --list-accent.
  const LIST = {
    home:  { a: 'var(--gold-leaf)',     g: 'rgba(201,163,90,.5)' },
    codex: { a: 'var(--gold-leaf)',     g: 'rgba(201,163,90,.5)' },
    decks: { a: 'var(--accent-violet)', g: 'rgba(199,154,208,.5)' },
    play:  { a: 'var(--accent-jade)',   g: 'rgba(143,211,168,.5)' },
  };
  const list = LIST[tab] || LIST.home;
  // The Decks pillar is now Arcanum's single-page pager, which owns its own
  // panels, search bars and FAB. App chrome (bottom search, FAB) steps aside for it.
  const deckPagerActive = tab === 'decks' && !viewDetail && !hasQuery && !addActive;
  // Search bar only on Codex browse (and add-cards); Decks/Home/Play have none
  // in App chrome, and the Marginalia scope is a curated list — no search.
  const showSearch = addActive || (!viewDetail && !preMatch && tab === 'codex' && scope !== 'marginalia');
  const searchVal = addActive ? addQuery : query;
  const setSearchVal = addActive ? setAddQuery : setQuery;
  const searchPlaceholder = addActive ? 'Search cards to add…' : (placeholders[tab] || 'Search…');

  return (
    <div className="cx-app" style={{ ...S.app, '--wash': WASH[tab] || WASH.home, '--list-accent': list.a, '--list-glow': list.g }}>
      {/* BRAND BAR */}
      <div style={S.brandBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={S.diamond} />
          <span style={S.wordmark}>Compendium</span>
        </div>
        <button onClick={() => setProfileSheet(true)} style={S.profileChip} title={profile?.name}>{initial}</button>
      </div>

      {/* CONTEXT HEADER (no eyebrow) — shown on every screen except the immersive
          life tracker. The avatar picker keeps its own in-body header, so we only
          show the brand bar + divider above it. */}
      {addActive ? (
        <div style={S.detailHeader}>
          <button onClick={exitAdd} style={S.back}>‹ Done</button>
          <div style={S.addEyebrow}>EDITING · {addMode.deckName}</div>
          <span style={{ width: 56 }} />
        </div>
      ) : viewDetail ? (
        <div style={S.detailHeader}>
          <button onClick={back} style={S.back}>‹ Back</button>
          <div style={S.detailTitle}>{detail.title || ''}</div>
          <span style={{ width: 44 }} />
        </div>
      ) : (
        <div style={S.contextHeader}>
          <div style={S.title}>{pillar.label}</div>
        </div>
      )}

      {/* BODY — Decks pillar is the full-height single-page pager; everything
          else scrolls in the standard body. */}
      {deckPagerActive ? (
        <DecksPager onNew={() => setDeckWizard(true)} onImport={(mode) => setImportMode(mode)}
          deckOpen={deckOpen} onOpenDeck={setDeckOpen} onChanged={bump}
          onOpenCodex={(id, name) => open('card', id, name)}
          onAddCards={() => deckOpen && enterAdd(deckOpen.id, deckOpen.name)} rev={rev} />
      ) : (
      <div className="cx-scroll" style={S.body}>
        {addActive ? (
          <DeckAddCards deckId={addMode.deckId} q={addQuery} setQ={setAddQuery}
            filterOpen={addFilterOpen} setFilterOpen={setAddFilterOpen}
            onChanged={bump} registerCount={setAddFilterCount} />
        ) : hasQuery ? (
          <SearchResults query={query} onOpen={open} onDuel={() => goTab('play')} />
        ) : viewDetail ? (
          <CodexDetail kind={detail.kind} id={detail.id} onOpenName={openName}
            onOpenDeck={(id, name) => open('deck', id, name)} onChanged={bump} />
        ) : tab === 'codex' ? (
          <Codex scope={scope} setScope={setScope}
                 preset={codexPreset} onPresetApplied={() => setCodexPreset(null)}
                 onOpen={(k, id, t) => open(k, id, t)} rev={rev} />
        ) : tab === 'play' ? (
          <Play onStart={startMatch} ongoing={ongoing} onResume={resumeMatch}
            onOpenDeck={(id, name) => open('deck', id, name)} rev={rev} />
        ) : (
          <Home onOpen={(t, id, title) => open(t, id, title)} ongoing={ongoing} onResume={resumeMatch}
            onGoTab={goTab} onAllNotes={() => { setCodexPreset({ notes: true }); goTab('codex'); }}
            profile={profile} rev={rev} />
        )}
      </div>
      )}

      {/* BOTTOM SEARCH — frosted pill in line with the FAB; tint morphs per page. */}
      {showSearch && (
        <div className="cx-searchbar">
          <div className="cx-search-pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={searchVal} onChange={(e) => setSearchVal(e.target.value)} placeholder={searchPlaceholder} autoComplete="off" />
            {searchVal && <button className="cx-search-clear" onClick={() => setSearchVal('')} aria-label="Clear">✕</button>}
          </div>
        </div>
      )}

      {/* GLOBAL CONTEXT FAB — the gold interaction spine, on every page. Its icon
          mutates by context: Decks library = + (New/Import menu); deck editing /
          Codex = filter sliders; Home / Play = three dots. Actions beyond the
          Decks menu + add-cards filters are TBD. Hidden on the avatar picker. */}
      {/* App-owned FAB contexts. Codex detail and the Decks pager render their
          OWN FAB since those actions live inside them. */}
      {!preMatch && (addActive ? (
        <Fab variant="deck" icon={<FabGlyph kind="filters" />} label="Filters & sort"
          onClick={() => setAddFilterOpen(true)} badge={addFilterCount} />
      ) : tab === 'home' && !viewDetail && !hasQuery ? (
        <Fab variant="deck" icon={<FabGlyph kind="dots" />} label="User options" items={[
          { label: 'Export User', onClick: async () => { try { await exportToFile(profile.id); } catch (e) { alert('Export failed: ' + e.message); } } },
          { label: 'Import User', onClick: async () => { try { const pid = await pickAndImport(); if (pid) await onSwitchProfile(pid); } catch (e) { alert('Import failed: ' + e.message); } } },
        ]} />
      ) : tab === 'play' && !viewDetail && !hasQuery ? (
        <Fab variant="lib" icon="+" label="Match options" items={[
          { label: 'New Match', prominent: true, onClick: () => startMatch('full') },
          { label: 'Quick Match', onClick: () => startMatch('quick') },
        ]} />
      ) : null)}

      {/* BOTTOM NAV — verbatim Arcanum shell, bigger icons: house / book /
          stacked squares / crossed swords. */}
      <nav className="cx-nav">
        {PILLARS.map((p) => {
          const active = !viewDetail && !hasQuery && !addActive && !preMatch && p.key === tab;
          return (
            <button key={p.key} className={`cx-nav-btn${active ? ' active' : ''}`} onClick={() => goTab(p.key)}>
              <NavIcon icon={p.key} />
              {p.label}
            </button>
          );
        })}
      </nav>
      <ProfileSheet open={profileSheet} active={profile} onClose={() => setProfileSheet(false)}
        onSwitch={onSwitchProfile} onChanged={reloadProfile}
        onExport={async () => { try { await exportToFile(profile.id); } catch (e) { alert('Export failed: ' + e.message); } }}
        onImport={async () => { try { const pid = await pickAndImport(); if (pid) await onSwitchProfile(pid); } catch (e) { alert('Import failed: ' + e.message); } }} />

      {/* Create-deck wizard (mandatory name → avatar) */}
      {deckWizard && (
        <CreateDeckWizard onClose={() => setDeckWizard(false)}
          onCreated={(id, name) => { setDeckWizard(false); bump(); goTab('decks'); setDeckOpen({ id, name }); }} />
      )}

      {/* Import from Curiosa URL — separate flow, lands on the deck in the pager */}
      <ImportUrlSheet open={importMode === 'url'} onClose={() => setImportMode(null)}
        onImportUrl={async (url) => {
          const { id, name, warnings } = await importCuriosaUrl(url);
          setImportMode(null); bump();
          if (warnings.length) alert(`Imported “${name}”. Unrecognised: ${warnings.join(', ')}`);
          goTab('decks'); setDeckOpen({ id, name });
        }} />

      {/* Import from pasted text (Arcanum Format) */}
      <ImportTextSheet open={importMode === 'text'} onClose={() => setImportMode(null)}
        onImport={async (text, name) => {
          const { id, unresolved } = await importFromText(text, name); setImportMode(null); bump();
          if (unresolved) alert(`Imported. ${unresolved} card(s) weren’t recognised and are kept as placeholders.`);
          goTab('decks'); setDeckOpen({ id, name: name || 'Imported deck' });
        }} />

      {/* Pre-match avatar picker — centered modal over the (dimmed) app, so it
          doesn't take over the interface. Scrim tap cancels. */}
      {preMatch && (
        <div className="cx-picker-modal" onClick={() => setPreMatch(null)}>
          <div className="cx-picker-box" onClick={(e) => e.stopPropagation()}>
            <AvatarPicker onConfirm={beginMatch} onCancel={() => setPreMatch(null)} />
          </div>
        </div>
      )}
      {match && (
        <LifeCounter settings={match.settings} mode={match.mode} players={{ you: match.you, opp: match.opp }}
          deck={match.deck || null} resume={match.resume || null} registerApi={(api) => { counterApi.current = api; }}
          onMinimize={minimizeMatch} onRecord={recordMatchResult} onExit={exitMatch} onNewMatch={newMatchFromEnd} />
      )}
    </div>
  );
}

// Bottom-nav icons — house · book · stacked squares (Arcanum's deck icon) ·
// crossed swords (Lucide).
function NavIcon({ icon }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (icon === 'home') return <svg viewBox="0 0 24 24" {...p}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>;
  if (icon === 'codex') return <svg viewBox="0 0 24 24" {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
  if (icon === 'decks') return <svg viewBox="0 0 24 24" {...p}><rect x="3" y="5" width="13" height="17" rx="2" /><rect x="8" y="2" width="13" height="17" rx="2" /></svg>;
  // play — crossed swords
  return <svg viewBox="0 0 24 24" {...p}><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" y1="19" x2="19" y2="13" /><line x1="16" y1="16" x2="20" y2="20" /><line x1="19" y1="21" x2="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" y1="14" x2="9" y2="18" /><line x1="7" y1="17" x2="4" y2="20" /><line x1="3" y1="19" x2="5" y2="21" /></svg>;
}

function SearchResults({ query, onOpen, onDuel }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => searchAll(query.trim()).then((r) => alive && setRes(r)), 130);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);
  if (!res) return <Loading />;
  const total = res.codex.length + res.decks.length + res.duels.length + (res.marginalia?.length || 0);
  if (total === 0) return <div style={{ padding: '50px 20px', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>No entries match “{query}.”</div>;
  const group = (label, dot, items, onItem) => items.length > 0 && (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 11 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--gold-leaf)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{label}
        </span>
        <span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{items.length}</span>
      </div>
      {items.map((it) => <ListRow key={(it.kind || it.glyph) + it.id} icon={it.glyph || (it.kind === 'card' ? '◈' : '§')} title={it.name} sub={it.meta} onClick={() => onItem(it)} />)}
    </div>
  );
  return (
    <div style={{ padding: '6px 20px 26px' }}>
      {group('CODEX', 'var(--accent-gold)', res.codex, (it) => onOpen(it.kind, it.id, it.name))}
      {group('MARGINALIA', 'var(--link-violet)', res.marginalia || [], (it) => onOpen(it.kind, it.id, it.name))}
      {group('DECKS', 'var(--accent-violet)', res.decks, (it) => onOpen('deck', it.id, it.name))}
      {group('MATCHES', 'var(--accent-jade)', res.duels, () => onDuel())}
    </div>
  );
}

// Profiles — the spine of the app, so the picker earns some ceremony: monogram
// discs, per-profile digests (decks · matches), gold ring on the active one.
// The default (oldest) profile is load-bearing and cannot be deleted; any
// profile can be renamed (data keys off the id — names are just labels),
// duplicated (full re-keyed copy) or exported.
function ProfileSheet({ open, active, onClose, onSwitch, onChanged, onExport, onImport }) {
  const [list, setList] = useState([]);
  const [stats, setStats] = useState({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);   // {id, name} — inline rename
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (!open) return;
    const ps = await listProfiles();
    setList(ps);
    const st = {};
    for (const p of ps) st[p.id] = await profileStats(p.id);
    setStats(st);
  }
  useEffect(() => { refresh(); if (!open) { setEditing(null); setAdding(false); } /* eslint-disable-next-line */ }, [open]);
  async function add() {
    if (!name.trim()) return;
    await createProfile(name.trim()); setName(''); setAdding(false); refresh();
  }
  async function saveRename() {
    const nn = editing?.name.trim();
    if (nn) { await renameProfile(editing.id, nn); await onChanged(); refresh(); }
    setEditing(null);
  }
  async function duplicate(p) {
    if (busy) return;
    setBusy(true);
    try { await duplicateProfile(p.id); await refresh(); }
    catch (e) { alert('Could not duplicate: ' + e.message); }
    finally { setBusy(false); }
  }
  async function remove(p) {
    if (!confirm(`Delete “${p.name}” and everything it owns — decks, matches, marginalia?`)) return;
    try { await deleteProfile(p.id); await onChanged(); refresh(); }
    catch (e) { alert(e.message); }
  }
  if (!open) return null;
  const defaultId = list.find((p) => p.is_default)?.id;   // explicit flag — the protected default
  const meta = (p) => {
    const s = stats[p.id];
    return s ? `${s.decks} deck${s.decks === 1 ? '' : 's'} · ${s.matches} match${s.matches === 1 ? '' : 'es'}` : '…';
  };
  return (
    <Sheet open={open} title="Profiles" onClose={onClose}>
      <div style={{ padding: '0 16px' }}>
      {list.map((p) => {
        const isActive = p.id === active?.id;
        return (
          <div key={p.id} className={`pf-row${isActive ? ' active' : ''}`}>
            <span className="pf-disc" onClick={() => onSwitch(p.id)}>{p.name.charAt(0).toUpperCase()}</span>
            {editing?.id === p.id ? (
              <>
                <input value={editing.name} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditing(null); }}
                  style={{ ...S.input, height: 38 }} />
                <IconButton glyph="✓" size={28} onClick={saveRename} title="Save name" />
              </>
            ) : (
              <>
                <span className="pf-copy" onClick={() => onSwitch(p.id)}>
                  <span className="pf-name">
                    {p.name}
                    {isActive && <span className="pf-tag">ACTIVE</span>}
                    {p.id === defaultId && !isActive && <span className="pf-tag dim">DEFAULT</span>}
                  </span>
                  <span className="pf-meta">{meta(p)}</span>
                </span>
                <span className="pf-actions">
                  <IconButton glyph="✎" tone="muted" size={27} onClick={() => setEditing({ id: p.id, name: p.name })} title="Rename" />
                  <IconButton glyph="⧉" tone="muted" size={27} onClick={() => duplicate(p)} title="Duplicate" />
                  {p.id !== defaultId && list.length > 1 && <IconButton glyph="✕" tone="danger" size={27} onClick={() => remove(p)} title="Delete" />}
                </span>
              </>
            )}
          </div>
        );
      })}
      {busy && <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '8px 0' }}>Duplicating…</div>}
      {adding ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Profile name…"
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }} style={S.input} />
          <button onClick={add} style={S.btnGold}>Create</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...S.btnGhost, marginTop: 16, width: '100%' }}>＋ New profile</button>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button onClick={onExport} style={{ ...S.btnGhost, flex: 1 }}>⤓ Export</button>
        <button onClick={onImport} style={{ ...S.btnGhost, flex: 1 }}>⤒ Import</button>
      </div>
      </div>
    </Sheet>
  );
}

// NOTE: the old SettingsSheet was removed — counter comforts live in the life
// tracker's Tweaks (player FAB); a proper Settings surface off the profile
// sheet is planned but not yet designed.

function Splash({ text, error }) {
  return (
    <div style={{ ...S.app, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ font: "600 16px/1.4 var(--f-display)", color: error ? 'var(--destructive)' : 'var(--gold-leaf)', textAlign: 'center', padding: 24 }}>{text}</div>
    </div>
  );
}

const S = {
  app: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink-body)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', position: 'relative', overflow: 'hidden' },
  brandBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px 10px' },
  diamond: { width: 14, height: 14, transform: 'rotate(45deg)', border: '1.5px solid var(--gold-leaf)', borderRadius: 3, boxShadow: '0 0 8px rgba(201,163,90,.35)' },
  wordmark: { font: "600 20px/1 var(--f-display)", color: 'var(--ink-head)', letterSpacing: '.01em' },
  profileChip: { width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(140deg,#cf9a4a,#8c5a2a)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 12px/1 var(--f-display)", color: '#1a1410', border: 'none', cursor: 'pointer' },
  contextHeader: { padding: '4px 20px 12px' },
  detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 12px' },
  back: { background: 'none', border: 'none', color: 'var(--gold-leaf)', font: "600 14px/1 var(--f-ui)", cursor: 'pointer', width: 56, textAlign: 'left' },
  detailTitle: { flex: 1, textAlign: 'center', font: "600 16px/1.1 var(--f-display)", color: 'var(--ink-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px' },
  addEyebrow: { flex: 1, textAlign: 'center', font: "600 11px/1.2 var(--f-ui)", letterSpacing: '.14em', color: 'var(--gold-leaf)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px' },
  title: { font: "600 27px/1 var(--f-display)", color: 'var(--ink-head)' },
  body: { flex: 1, overflowY: 'auto', paddingBottom: 'calc(62px + env(safe-area-inset-bottom) + 92px)' },
  input: { flex: 1, height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" },
  btnGold: { padding: '12px 18px', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 13px/1 var(--f-ui)", border: 'none', cursor: 'pointer', flex: 'none' },
  btnGhost: { padding: '12px 0', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 13px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' },
};
