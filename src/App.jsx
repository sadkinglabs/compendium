import React, { useEffect, useState, useRef } from 'react';
import { openDatabase } from './store/db.js';
import {
  initProfiles, getActiveProfile, listProfiles, profileStats,
  createProfile, switchProfile, renameProfile, deleteProfile,
} from './store/profileRepository.js';
import { seedCatalogIfNeeded } from './store/catalog.js';
import { migrateAnnotationsIfNeeded } from './store/annotations.js';
import { resolveByName, isSaved, toggleSaved } from './store/codexRepository.js';
import { searchAll } from './store/searchRepository.js';
import Codex from './pillars/Codex.jsx';
import CodexDetail from './pillars/CodexDetail.jsx';
import { ImportUrlSheet, ImportTextSheet } from './pillars/Decks.jsx';
import DecksPager from './pillars/DecksPager.jsx';
import Fab, { FabGlyph } from './components/Fab.jsx';
import BottomDock from './components/BottomDock.jsx';
import SearchPill from './components/SearchPill.jsx';
import CardRow from './components/CardRow.jsx';
import Collection from './pillars/Collection.jsx';
import CreateDeckWizard from './components/CreateDeckWizard.jsx';
import { importFromText, importCuriosaUrl } from './store/deckRepository.js';
import DeckAddCards from './pillars/DeckAddCards.jsx';
import Play, { ImportMatchSheet } from './pillars/Play.jsx';
import LifeCounter from './pillars/LifeCounter.jsx';
import AvatarPicker from './pillars/AvatarPicker.jsx';
import Home from './pillars/Home.jsx';
import { getSettings, setSetting, recordMatch } from './store/playRepository.js';
import { loadOngoing, saveOngoing, clearOngoing } from './store/ongoingMatch.js';
import { setResume } from './store/homeRepository.js';
import { exportToFile, pickAndImport, duplicateProfile } from './store/profileTransfer.js';
import { onBackButton, onAppUrlOpen, exitApp, haptic } from './native.js';
import { runBackConsumers } from './back.js';
import { parseMatchShare } from './store/matchShare.js';
import { parseDeckShare } from './store/deckShare.js';
import { importDeckShare } from './store/deckRepository.js';
import { applyAppearance, clampFontScale, FONT_MIN, FONT_MAX, FONT_STEP } from './appearance.js';
import { ListRow, IconButton, Loading, Chip, ChipRow, BTN_GOLD, BTN_GHOST, CenteredModal } from './components/ui.jsx';
import { parseQuery } from './store/cardQuery.js';
import Sheet from './components/Sheet.jsx';
import { ToastHost, ConfirmHost } from './components/FeedbackHosts.jsx';
import { toast, confirmAction } from './feedback.js';

const PILLARS = [
  { key: 'home',  glyph: '⌂', label: 'Home',  eyebrow: 'YOUR WORKSPACE',   accent: 'var(--accent-gold)' },
  { key: 'codex', glyph: '▤', label: 'Codex', eyebrow: 'RULES & CARDS',     accent: 'var(--accent-gold)' },
  { key: 'collect', glyph: '◆', label: 'Collection', eyebrow: 'CARDS YOU OWN', accent: 'var(--accent-ruby)' },
  { key: 'decks', glyph: '◈', label: 'Decks', eyebrow: 'YOUR DECKS',        accent: 'var(--accent-violet)' },
  { key: 'play',  glyph: '♥', label: 'Play',  eyebrow: 'DUEL & TRACK LIFE', accent: 'var(--accent-jade)' },
];
const SWIPE_TABS = PILLARS.map((p) => p.key);   // cross-pillar swipe order

export default function App() {
  const [boot, setBoot] = useState({ status: 'loading' });
  const [tab, setTab] = useState('home');
  const [detail, setDetail] = useState(null);     // {kind,id,title,target}
  const [detailSaved, setDetailSaved] = useState(false);   // doc-level BOOKMARK state of the open entry
  const [history, setHistory] = useState([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('rules');   // browse side: 'rules' | 'cards' | 'marginalia'
  const [searchKind, setSearchKind] = useState('all');   // search post-filter: 'all' | 'rule' | 'card'
  const [pillSlot, setPillSlot] = useState(null);   // shared header slot; Home/Decks portal their top pills here
  const [codexPreset, setCodexPreset] = useState(null);   // one-shot filter preset (e.g. Home "All notes ›")
  const [rev, setRev] = useState(0);
  const [profileSheet, setProfileSheet] = useState(false);
  const [profile, setProfile] = useState(null);
  const [addMode, setAddMode] = useState(null);     // {deckId, deckName}
  const [addQuery, setAddQuery] = useState('');
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  const [addFilterCount, setAddFilterCount] = useState(0);
  const [match, setMatch] = useState(null);          // {mode, settings, you, opp, resume?}
  const [preMatch, setPreMatch] = useState(null);    // {mode, settings} - avatar picker step
  const [ongoing, setOngoing] = useState(() => loadOngoing());  // minimized, resumable match snapshot
  const counterApi = useRef(null);                   // {minimize} - set by the live counter
  const homeApi = useRef(null);                       // {back} - Home edit mode / Overview<->Dashboard subtab
  const lastBackAt = useRef(0);                       // double-back-to-exit timestamp (Home root)
  const [settingsSheet, setSettingsSheet] = useState(false);   // app Settings (accessibility + prefs)
  const [creditsOpen, setCreditsOpen] = useState(false);       // centered Credits/About modal
  const [searchHelpOpen, setSearchHelpOpen] = useState(false); // centered search-syntax cheatsheet
  const [matchImport, setMatchImport] = useState(null);        // parsed mirrored-match payload (from a shared QR / deep link)
  const [resultPaste, setResultPaste] = useState(false);       // manual "paste a result link" fallback
  const [deckWizard, setDeckWizard] = useState(false);   // create-deck 2-step wizard
  const [importMode, setImportMode] = useState(null);    // 'url' | 'text' - which import sheet
  const [deckOpen, setDeckOpen] = useState(null);        // {id,name} deck loaded in the Decks pillar
  const [deckEditMode, setDeckEditMode] = useState(false); // My-Deck quick-edit - lifted so it survives the add-cards flow
  const booted = useRef(false);
  const backRef = useRef(null);   // latest hardware-back handler (set each render)
  const [storageFull, setStorageFull] = useState(false);
  useEffect(() => onBackButton(() => backRef.current?.()), []);
  // Dev aid: exercise the hardware-back chain from a desktop browser (no Capacitor).
  useEffect(() => { if (import.meta.env.DEV) window.__back = () => backRef.current?.(); }, []);
  // A shared QR / link opens compendium://match?d=... (review sheet) or
  // compendium://deck?d=... (import + open), whatever tab we're on.
  useEffect(() => onAppUrlOpen((url) => {
    const m = parseMatchShare(url); if (m) { setMatchImport(m); return; }
    const d = parseDeckShare(url);
    if (d) importDeckShare(d)
      .then((r) => { open('deck', r.id, r.name); toast(`Imported “${r.name}”${r.missing ? ` · ${r.missing} unknown` : ''}`); })
      .catch(() => toast('Couldn’t import that deck.', { tone: 'danger' }));
  }), []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Storage-full / persist failure - the DB layer broadcasts when a save is
  // rejected (quota, blocked). Warn once so the user knows changes aren't saving.
  useEffect(() => {
    const h = () => setStorageFull(true);
    window.addEventListener('cx-storage-error', h);
    return () => window.removeEventListener('cx-storage-error', h);
  }, []);

  useEffect(() => {
    if (booted.current) return;   // run boot once (StrictMode double-invokes effects)
    booted.current = true;
    (async () => {
      try {
        await openDatabase();
        const { counts } = await seedCatalogIfNeeded();
        // One-time backfill of legacy highlights into the annotation model (runs
        // after migrations create the tables + the catalog is seeded; gated so it's
        // idempotent). Never blocks boot - a failure just retries next launch.
        try { await migrateAnnotationsIfNeeded(); } catch (e) { console.error('annotation migration failed', e); }
        const p = await initProfiles();
        setProfile(p);
        try { applyAppearance(await getSettings()); } catch { /* pre-settings profile */ }
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

  // Doc-level BOOKMARK state of the open entry, for the header ribbon toggle.
  useEffect(() => {
    if (detail && (detail.kind === 'card' || detail.kind === 'rule')) {
      isSaved(detail.id).then(setDetailSaved).catch(() => setDetailSaved(false));
    }
  }, [detail]);

  // Derived view flags + navigation.
  const addActive = !!addMode;
  const hasQuery = query.trim().length > 0 && !addActive;
  const viewDetail = detail && !hasQuery && !addActive;
  // One scope control (contextHeader): browse Rules/Cards ⇄ search All/Rules/Cards.
  // is:card / is:article tokens DERIVE (lock) the search chip so it can never
  // disagree with what searchCodex returns; otherwise the manual searchKind wins.
  const searchIs = hasQuery ? parseQuery(query).scopes.is : [];
  const tokenKind = searchIs.some((v) => v === 'card' || v === 'cards') ? 'card'
    : searchIs.some((v) => v.startsWith('article') || v === 'rule' || v === 'rules') ? 'rule' : null;
  const effectiveKind = tokenKind || searchKind;
  useEffect(() => { if (!query.trim()) setSearchKind('all'); }, [query]);   // each new search starts at All
  const slideDirRef = useRef('right');   // direction the incoming pillar slides from (on tab tap)
  const goTab = (t) => {
    if (t !== tab) { haptic('light'); slideDirRef.current = SWIPE_TABS.indexOf(t) < SWIPE_TABS.indexOf(tab) ? 'left' : 'right'; }
    setTab(t); setDetail(null); setHistory([]); setQuery(''); setAddMode(null); setDeckEditMode(false);
  };
  // "Browse all decks" always lands on the Library, not whatever deck was last open.
  const goLibrary = () => { setDeckOpen(null); goTab('decks'); };

  if (boot.status === 'loading') return <Splash text="Opening the grimoire…" />;
  if (boot.status === 'error') return <Splash text={'Store error: ' + boot.error} error />;

  const pillar = PILLARS.find((p) => p.key === tab);
  const enterAdd = (deckId, deckName) => { setAddMode({ deckId, deckName }); setAddQuery(''); setAddFilterOpen(false); };
  const exitAdd = () => { setAddMode(null); bump(); };
  const openNewMatch = async (mode) => {
    const settings = await getSettings();
    if (mode === 'quick') setMatch({ mode, settings, you: null, opp: null });
    else setPreMatch({ mode, settings });
  };
  const startMatch = async (mode) => {
    if (ongoing && !(await confirmAction({ title: 'Discard match in progress?', body: 'You have a live match. Starting a new one will discard it.', confirmLabel: 'Discard & start', danger: true }))) return;
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
  const open = (kind, id, title, target) => {
    // Decks always open in the Decks pager (My Deck), NOT the legacy DeckDetail
    // route. Every deck link (Home carousel, search, resume, marginalia) lands here.
    if (kind === 'deck') {
      if (title) setResume('deck', id, title).catch(() => {});
      setQuery(''); goTab('decks'); setDeckOpen({ id, name: title });
      return;
    }
    // Remember where we were in the list so Back returns to that scroll position.
    const scrollTop = document.querySelector('.cx-scroll')?.scrollTop || 0;
    setHistory((h) => [...h, { detail, query, scrollTop }]);
    setDetail({ kind, id, title, target }); setQuery('');   // target = optional block id to scroll to
    if (['card', 'rule'].includes(kind) && title) setResume(kind, id, title).catch(() => {});
  };
  const back = () => {
    setHistory((h) => {
      const n = [...h]; const prev = n.pop();
      setDetail(prev ? prev.detail : null);
      setQuery(prev?.query || '');   // restore the search term so we land back IN the search, not the browse list
      // Restore the list scroll position once the list (search results or browse) re-renders.
      const y = prev?.scrollTop || 0;
      const restore = (tries) => requestAnimationFrame(() => {
        const el = document.querySelector('.cx-scroll');
        if (el && (el.scrollHeight > y + el.clientHeight || tries <= 0)) el.scrollTop = y;
        else if (tries > 0) restore(tries - 1);   // wait for async search results to fill height
      });
      restore(20);
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
    try { applyAppearance(await getSettings()); } catch { /* noop */ }   // appearance is per-profile
    // Clear ALL cross-profile UI state - a leaked deckOpen/addMode would edit
    // the previous profile's data (or spin forever on a deck this profile can't see).
    setProfileSheet(false); setDetail(null); setHistory([]); setQuery('');
    setAddMode(null); setDeckOpen(null); setDeckEditMode(false); setPreMatch(null); setCodexPreset(null); setScope('rules');
    setTab('home'); bump();
  }

  const initial = (profile?.name || '?').charAt(0).toUpperCase();
  const searchable = true;   // universal search on every pillar
  const placeholders = { home: 'Search rules, cards, decks…', codex: 'Search the codex…', collect: 'Search your collection…', decks: 'Search decks…', play: 'Search matches…' };

  // Hardware back peels one layer at a time - the precedence is declared ONCE
  // here (top of stack first), instead of a hand-maintained if-ladder. Falls
  // through to "go home", then exit.
  const backStack = [
    [match, () => counterApi.current?.closeTopmost?.()],   // peel counter modals, else minimize (preserves the match)
    [preMatch, () => setPreMatch(null)],
    [deckWizard, () => setDeckWizard(false)],
    [importMode, () => setImportMode(null)],
    [matchImport, () => setMatchImport(null)],
    [resultPaste, () => setResultPaste(false)],
    [searchHelpOpen, () => setSearchHelpOpen(false)],
    [creditsOpen, () => setCreditsOpen(false)],
    [settingsSheet, () => setSettingsSheet(false)],
    [profileSheet, () => setProfileSheet(false)],
    [addActive, exitAdd],
    [hasQuery, () => setQuery('')],
    [viewDetail, back],
    [tab === 'decks' && deckOpen && deckEditMode, () => setDeckEditMode(false)],
    [tab === 'decks' && deckOpen, () => setDeckOpen(null)],   // back to Library, not straight Home
    [tab !== 'home', () => goTab('home')],
  ];
  backRef.current = () => {
    if (runBackConsumers()) return;                            // an open FAB menu or sheet - close it first
    const entry = backStack.find(([active]) => active);
    if (entry) { entry[1](); return; }
    if (tab === 'home' && homeApi.current?.back?.()) return;   // Home edit mode / Overview<->Dashboard subtab
    if (Date.now() - lastBackAt.current < 2000) { exitApp(); return; }   // double-back to exit
    lastBackAt.current = Date.now();
    toast('Press back again to exit');
  };

  // Per-pillar top-down colour wash (over pure black). Home is pure black (no
  // wash) to signal active engagement; Codex=warm gold · Decks=Arcanum amethyst ·
  // Play=Vitarum green.
  const WASH = { home: '#000', codex: '#33260e', collect: '#2a1220', decks: '#2a1c44', play: '#18301f' };
  // Canonical list-row accent, morphing per pillar (grimoire gold default;
  // amethyst in Decks, jade in Play) - consumed by ListRow via --list-accent.
  const LIST = {
    home:    { a: 'var(--gold-leaf)',     g: 'rgba(201,163,90,.5)' },
    codex:   { a: 'var(--gold-leaf)',     g: 'rgba(201,163,90,.5)' },
    collect: { a: 'var(--accent-ruby)',   g: 'rgba(210,88,115,.5)' },
    decks:   { a: 'var(--accent-violet)', g: 'rgba(199,154,208,.5)' },
    play:    { a: 'var(--accent-jade)',   g: 'rgba(143,211,168,.5)' },
  };
  const list = LIST[tab] || LIST.home;
  // The Decks pillar is now Arcanum's single-page pager, which owns its own
  // panels, search bars and FAB. App chrome (bottom search, FAB) steps aside for it.
  const deckPagerActive = tab === 'decks' && !viewDetail && !hasQuery && !addActive;
  // Search bar only on Codex browse (and add-cards); Decks/Home/Play have none
  // in App chrome, and the Marginalia scope is a curated list - no search.
  const showSearch = addActive || (!viewDetail && !preMatch && tab === 'codex' && scope !== 'marginalia');
  const searchVal = addActive ? addQuery : query;
  const setSearchVal = addActive ? setAddQuery : setQuery;
  const searchPlaceholder = addActive ? 'Search cards to add…' : (placeholders[tab] || 'Search…');

  return (
    <div className="cx-app" style={{ ...S.app, '--wash': WASH[tab] || WASH.home, '--list-accent': list.a, '--list-glow': list.g }}>
      {/* BRAND BAR */}
      <div style={S.brandBar}>
        {/* Wordmark = the app's home button (platform convention). Only when
            already sitting on Home does it open Settings. */}
        <button onClick={() => {
          const atHome = tab === 'home' && !viewDetail && !hasQuery && !addActive && !preMatch;
          if (atHome) setSettingsSheet(true); else goTab('home');
        }} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} aria-label="Home / Settings">
          <span style={S.diamond} />
          <span style={S.wordmark}>Compendium</span>
        </button>
        <button onClick={() => setProfileSheet(true)} style={S.profileChip} title={profile?.name}>{initial}</button>
      </div>

      {storageFull && (
        <div onClick={() => setStorageFull(false)} role="alert"
          style={{ margin: '0 16px 8px', padding: '10px 14px', borderRadius: 12, background: 'rgba(60,20,16,.9)', border: '1px solid rgba(224,120,106,.5)', color: '#f0c9c2', font: "500 12.5px/1.45 var(--f-ui)", cursor: 'pointer' }}>
          Storage is full - recent changes may not be saved. Free up space or export a profile, then tap to dismiss.
        </div>
      )}

      {/* CONTEXT HEADER (no eyebrow) - shown on every screen except the immersive
          life tracker. The avatar picker keeps its own in-body header, so we only
          show the brand bar + divider above it. */}
      {addActive ? (
        <div style={S.detailHeader}>
          <button onClick={exitAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#e3c589', font: "500 16px/1 var(--f-ui)", cursor: 'pointer', padding: 0, flexShrink: 0 }}><IcBack size={16} />Done</button>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right', overflowWrap: 'normal', wordBreak: 'normal' }}>
            <span style={{ font: "600 11px/1 var(--f-display)", letterSpacing: '.18em', color: '#a08cc0' }}>EDITING</span>
            <span style={{ font: "600 13px/1.25 var(--f-display)", color: '#e3c589' }}> · {addMode.deckName}</span>
          </div>
        </div>
      ) : viewDetail ? (
        <div style={S.detailHeader}>
          <button onClick={back} style={S.back}><IcBack size={16} />Back</button>
          <div style={{ ...S.detailTitle, textTransform: detail.kind === 'rule' ? 'uppercase' : 'none' }}>{detail.title || ''}</div>
          <button onClick={async () => { await toggleSaved(detail.kind, detail.id); setDetailSaved((s) => !s); bump(); }}
            style={{ ...S.bmToggle, color: detailSaved ? 'var(--gold-leaf)' : 'var(--ink-muted)' }}
            aria-label={detailSaved ? 'Remove bookmark' : 'Bookmark this entry'} title={detailSaved ? 'Bookmarked' : 'Bookmark'}>
            <IcBookmark filled={detailSaved} />
          </button>
        </div>
      ) : (
        <div style={S.contextHeader}>
          <div style={S.title}>{pillar.label}</div>
        </div>
      )}

      {/* Shared pill slot, directly under the title on every pillar so the top
          segmented controls sit at one consistent height. Codex renders its scope
          bar here directly; Home and Decks portal their pill rows into this node. */}
      {!addActive && !viewDetail && (
        <div ref={setPillSlot} className="cx-header-pills">
          {tab === 'codex' && (
            <div style={{ padding: '0 20px 10px' }}>
              <CodexScopeBar hasQuery={hasQuery} scope={scope} setScope={setScope}
                searchKind={effectiveKind} setSearchKind={setSearchKind} locked={!!tokenKind} />
            </div>
          )}
        </div>
      )}

      {/* BODY - a keyed slide container animates each pillar change (swipe or nav)
          in the swipe direction. Decks is the full-height pager; the rest scroll in
          the standard body. */}
      <div key={tab} className={`cx-pillar-slide from-${slideDirRef.current}`} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {deckPagerActive ? (
        <DecksPager onNew={() => setDeckWizard(true)} onImport={(mode) => setImportMode(mode)}
          onImportMatch={(url) => { const p = parseMatchShare(url); if (p) setMatchImport(p); }}
          pillSlot={pillSlot}
          deckOpen={deckOpen} onOpenDeck={setDeckOpen} onChanged={bump}
          onOpenCodex={(id, name) => open('card', id, name)}
          editMode={deckEditMode} onEditMode={setDeckEditMode}
          onAddCards={() => deckOpen && enterAdd(deckOpen.id, deckOpen.name)} rev={rev} />
      ) : (
      <div className="cx-scroll" style={S.body}>
        {addActive ? (
          <DeckAddCards deckId={addMode.deckId} q={addQuery} setQ={setAddQuery}
            filterOpen={addFilterOpen} setFilterOpen={setAddFilterOpen}
            onChanged={bump} registerCount={setAddFilterCount} />
        ) : hasQuery ? (
          <SearchResults query={query} kind={effectiveKind} onOpen={open} onDuel={() => goTab('play')} />
        ) : viewDetail ? (
          <CodexDetail kind={detail.kind} id={detail.id} target={detail.target} onOpen={(kk, iid, t, tgt) => open(kk, iid, t, tgt)} onOpenName={openName}
            onOpenDeck={(id, name) => open('deck', id, name)} onChanged={bump} />
        ) : tab === 'codex' ? (
          <Codex scope={scope}
                 preset={codexPreset} onPresetApplied={() => setCodexPreset(null)}
                 onOpen={(k, id, t, tgt) => open(k, id, t, tgt)} rev={rev} />
        ) : tab === 'collect' ? (
          <Collection pillSlot={pillSlot} onOpen={(k, id, t) => open(k, id, t)}
            onGoDecks={() => goLibrary()} rev={rev} onChanged={bump} />
        ) : tab === 'play' ? (
          <Play onStart={startMatch} ongoing={ongoing} onResume={resumeMatch}
            onOpenDeck={(id, name) => open('deck', id, name)} rev={rev} onChanged={bump} onImport={() => setResultPaste(true)} />
        ) : (
          <Home onOpen={(t, id, title) => open(t, id, title)} ongoing={ongoing} onResume={resumeMatch} pillSlot={pillSlot}
            onGoTab={goTab} onGoLibrary={goLibrary} onAllNotes={() => { setCodexPreset({ marg: true }); goTab('codex'); }}
            onMarginalia={() => { setScope('marginalia'); goTab('codex'); }}
            onStartMatch={startMatch} registerApi={(api) => { homeApi.current = api; }}
            onImportMatch={(url) => { const p = parseMatchShare(url); if (p) setMatchImport(p); }}
            profile={profile} rev={rev} />
        )}
      </div>
      )}
      </div>

      {/* THE bottom dock - one keyboard-aware container the search pill + FAB both
          portal into, so they move as one unit. Mounted once, present on every page. */}
      <BottomDock />

      {/* Global bottom search (Codex + add-cards) - portals into the dock beside the FAB. */}
      {showSearch && (
        <SearchPill value={searchVal} onChange={setSearchVal} onClear={() => setSearchVal('')}
          placeholder={searchPlaceholder} ariaLabel={searchPlaceholder} onHelp={() => setSearchHelpOpen(true)} />
      )}

      {/* GLOBAL CONTEXT FAB - the gold interaction spine, on every page. Its icon
          mutates by context: Decks library = + (New/Import menu); deck editing /
          Codex = filter sliders; Home / Play = three dots. Actions beyond the
          Decks menu + add-cards filters are TBD. Hidden on the avatar picker. */}
      {/* App-owned FAB contexts. Codex detail and the Decks pager render their
          OWN FAB since those actions live inside them. */}
      {!preMatch && addActive && (
        <Fab variant="deck" icon={<FabGlyph kind="filters" />} label="Filters & sort"
          onClick={() => setAddFilterOpen(true)} badge={addFilterCount} />
      )}
      {/* Home owns no app-level FAB - the wordmark opens Settings, and the
          Dashboard renders its own "+" FAB. Play owns its Add-Match FAB. */}

      {/* BOTTOM NAV - verbatim Arcanum shell, bigger icons: house / book /
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
        onExport={async () => { try { await exportToFile(profile.id); toast('Profile exported'); } catch (e) { toast('Export failed: ' + e.message, { tone: 'danger' }); } }}
        onImport={async () => { try { const pid = await pickAndImport(); if (pid) { await onSwitchProfile(pid); toast('Profile imported'); } } catch (e) { toast('Import failed: ' + e.message, { tone: 'danger' }); } }} />

      {/* Create-deck wizard (mandatory name → avatar) */}
      {deckWizard && (
        <CreateDeckWizard onClose={() => setDeckWizard(false)}
          onCreated={(id, name) => { setDeckWizard(false); bump(); goTab('decks'); setDeckOpen({ id, name }); }} />
      )}

      {/* Import from Curiosa URL - separate flow, lands on the deck in the pager */}
      <ImportUrlSheet open={importMode === 'url'} onClose={() => setImportMode(null)}
        onImportUrl={async (url) => {
          const { id, name, warnings } = await importCuriosaUrl(url);
          setImportMode(null); bump();
          toast(warnings.length ? `Imported “${name}” · ${warnings.length} card(s) unrecognised` : `Imported “${name}”`);
          goTab('decks'); setDeckOpen({ id, name });
        }} />

      {/* Import from pasted text (Arcanum Format) */}
      <ImportTextSheet open={importMode === 'text'} onClose={() => setImportMode(null)}
        onImport={async (text, name) => {
          const { id, unresolved } = await importFromText(text, name); setImportMode(null); bump();
          toast(unresolved ? `Imported · ${unresolved} card(s) kept as placeholders` : 'Deck imported');
          goTab('decks'); setDeckOpen({ id, name: name || 'Imported deck' });
        }} />

      {/* Pre-match avatar picker - centered modal over the (dimmed) app, so it
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
      <SettingsSheet open={settingsSheet} onClose={() => setSettingsSheet(false)} onCredits={() => setCreditsOpen(true)} />
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <SearchHelpModal open={searchHelpOpen} kind={addActive ? 'deck' : 'codex'} onClose={() => setSearchHelpOpen(false)} />
      <ImportPasteModal open={resultPaste} onClose={() => setResultPaste(false)}
        onParsed={(p) => { setResultPaste(false); setMatchImport(p); }} />
      <ImportMatchSheet payload={matchImport} onClose={() => setMatchImport(null)}
        onSaved={() => { setMatchImport(null); bump(); goTab('play'); toast('Match imported'); }} />
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

// Bottom-nav icons - house · book · stacked squares (Arcanum's deck icon) ·
// crossed swords (Lucide).
function NavIcon({ icon }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (icon === 'home') return <svg viewBox="0 0 24 24" {...p}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>;
  if (icon === 'codex') return <svg viewBox="0 0 24 24" {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
  if (icon === 'collect') return <svg viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>;
  if (icon === 'decks') return <svg viewBox="0 0 24 24" {...p}><rect x="3" y="5" width="13" height="17" rx="2" /><rect x="8" y="2" width="13" height="17" rx="2" /></svg>;
  // play - crossed swords
  return <svg viewBox="0 0 24 24" {...p}><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" y1="19" x2="19" y2="13" /><line x1="16" y1="16" x2="20" y2="20" /><line x1="19" y1="21" x2="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" y1="14" x2="9" y2="18" /><line x1="7" y1="17" x2="4" y2="20" /><line x1="3" y1="19" x2="5" y2="21" /></svg>;
}

// House SVG icons for App chrome - no Unicode glyphs.
const ASvg = ({ children, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const IcBack = (p) => <ASvg {...p}><polyline points="15 18 9 12 15 6" /></ASvg>;
const IcBookmark = ({ filled, size = 19 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />
  </svg>
);
const IcX = (p) => <ASvg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></ASvg>;
const IcPlus = (p) => <ASvg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></ASvg>;
const IcDownload = (p) => <ASvg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></ASvg>;
const IcUpload = (p) => <ASvg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></ASvg>;
function ResultIcon({ kind }) {
  if (kind === 'deck') return <ASvg><rect x="3" y="5" width="13" height="16" rx="2" /><path d="M8 5V3h13v16h-2" /></ASvg>;
  if (kind === 'match' || kind === 'duel') return <ASvg><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /></ASvg>;
  if (kind === 'rule') return <ASvg><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><polyline points="14 4 14 9 19 9" /></ASvg>;
  return <ASvg><rect x="4" y="3" width="16" height="18" rx="2" /></ASvg>; // card
}

function SearchResults({ query, kind = 'all', onOpen, onDuel }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => searchAll(query.trim()).then((r) => alive && setRes(r)), 130);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);
  if (!res) return <Loading />;
  const showRules = kind !== 'card', showCards = kind !== 'rule';
  const total = (showRules ? res.articles.length + res.articleText.length : 0)
    + (showCards ? res.cards.length + res.cardText.length : 0)
    + (kind === 'all' ? res.decks.length + res.duels.length + (res.marginalia?.length || 0) : 0);
  if (total === 0) return (
    <div style={{ padding: '6px 20px 26px' }}>
      <div style={{ padding: '44px 0', textAlign: 'center', font: "400 15px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>No entries match “{query}.”</div>
    </div>
  );
  // rich=true renders the shared CardRow (art/pips/cost) for real card rows;
  // thumb adds the art thumbnail (CARDS only - the text-match group stays glyph-
  // light per the perf budget). Everything else keeps the one-line ListRow.
  const group = (label, dot, items, onItem, iconKind, rich = false, thumb = false) => items.length > 0 && (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 11 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: "600 11px/1 var(--f-display)", letterSpacing: '.16em', color: 'var(--gold-leaf)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />{label}
        </span>
        <span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{items.length}</span>
      </div>
      {items.map((it) => rich
        ? <CardRow key={'card' + it.id} card={it} thumb={thumb} icon={<ResultIcon kind="card" />} onClick={() => onItem(it)} />
        : <ListRow key={(it.kind || iconKind) + it.id} icon={<ResultIcon kind={it.kind || iconKind} />} title={it.name} sub={it.meta} onClick={() => onItem(it)} />)}
    </div>
  );
  const openCodex = (it) => onOpen(it.kind, it.id, it.name);
  return (
    <div style={{ padding: '6px 20px 26px' }}>
      {showRules && group('ARTICLES', 'var(--accent-gold)', res.articles, openCodex, 'rule')}
      {showCards && group('CARDS', 'var(--accent-gold)', res.cards, openCodex, 'card', true, true)}
      {showCards && group('MENTIONED IN CARD TEXT', 'var(--accent-gold)', res.cardText, openCodex, 'card', true, false)}
      {showRules && group('MENTIONED IN ARTICLES', 'var(--accent-gold)', res.articleText, openCodex, 'rule')}
      {kind === 'all' && group('MARGINALIA', 'var(--link-violet)', res.marginalia || [], openCodex, 'card')}
      {kind === 'all' && group('DECKS', 'var(--accent-violet)', res.decks, (it) => onOpen('deck', it.id, it.name), 'deck')}
      {kind === 'all' && group('MATCHES', 'var(--accent-jade)', res.duels, () => onDuel(), 'match')}
    </div>
  );
}

// The ONE Codex scope control, hoisted into the app contextHeader so it persists
// across the browse↔search boundary (typing no longer swaps out a second control).
// Browse: Rules / Cards (+ Marginalia, the personal layer, apart). Search: All /
// Rules / Cards post-filter over the mixed results. `locked` = an is:card/is:article
// token is driving the kind, so the chips only reflect it.
function CodexScopeBar({ hasQuery, scope, setScope, searchKind, setSearchKind, locked }) {
  if (hasQuery) {
    return (
      <ChipRow>
        {[['all', 'All'], ['rule', 'Rules'], ['card', 'Cards']].map(([k, label]) => (
          <Chip key={k} label={label} active={searchKind === k} onClick={() => { if (!locked) setSearchKind(k); }} />
        ))}
      </ChipRow>
    );
  }
  const marginalia = scope === 'marginalia';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <ChipRow>
        {[['rules', 'Rules'], ['cards', 'Cards']].map(([k, label]) => (
          <Chip key={k} label={label} active={scope === k} onClick={() => setScope(k)} />
        ))}
      </ChipRow>
      <button onClick={() => setScope('marginalia')} aria-pressed={marginalia}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
          padding: '7px 13px', borderRadius: 18, cursor: 'pointer', whiteSpace: 'nowrap',
          font: "600 13px/1 var(--f-ui)", color: '#e3c589',
          background: marginalia ? 'rgba(203,167,95,.16)' : 'transparent',
          border: `1px solid ${marginalia ? 'rgba(203,167,95,.5)' : 'rgba(203,167,95,.35)'}`,
        }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
        Marginalia
      </button>
    </div>
  );
}

// Profiles - the spine of the app, so the picker earns some ceremony: monogram
// discs, per-profile digests (decks · matches), gold ring on the active one.
// The default (oldest) profile is load-bearing and cannot be deleted; any
// profile can be renamed (data keys off the id - names are just labels),
// duplicated (full re-keyed copy) or exported.
function ProfileSheet({ open, active, onClose, onSwitch, onChanged, onExport, onImport }) {
  const [list, setList] = useState([]);
  const [stats, setStats] = useState({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);   // {id, name} - inline rename
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
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await createProfile(name.trim()); setName(''); setAdding(false); refresh(); }
    finally { setBusy(false); }
  }
  async function saveRename() {
    const nn = editing?.name.trim();
    if (nn) { await renameProfile(editing.id, nn); await onChanged(); refresh(); }
    setEditing(null);
  }
  async function duplicate(p) {
    if (busy) return;
    setBusy(true);
    try { await duplicateProfile(p.id); await refresh(); toast(`Duplicated “${p.name}”`); }
    catch (e) { toast('Could not duplicate: ' + e.message, { tone: 'danger' }); }
    finally { setBusy(false); }
  }
  async function remove(p) {
    if (!(await confirmAction({ title: `Delete “${p.name}”?`, body: 'This removes the profile and everything it owns - decks, matches, marginalia. This can’t be undone.', confirmLabel: 'Delete profile', danger: true }))) return;
    try { await deleteProfile(p.id); await onChanged(); refresh(); toast('Profile deleted'); }
    catch (e) { toast(e.message, { tone: 'danger' }); }
  }
  if (!open) return null;
  const defaultId = list.find((p) => p.is_default)?.id;   // explicit flag - the protected default
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
          <button onClick={add} disabled={busy} style={{ ...S.btnGold, opacity: busy ? 0.6 : 1 }}>Create</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...S.btnGhost, marginTop: 16, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><IcPlus size={14} />New profile</button>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button onClick={onExport} style={{ ...S.btnGhost, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><IcDownload size={14} />Export</button>
        <button onClick={onImport} style={{ ...S.btnGhost, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><IcUpload size={14} />Import</button>
      </div>
      </div>
    </Sheet>
  );
}

// App Settings - reached from the Home FAB. Accessibility only: font scale,
// high contrast, reduced motion, haptics - all applied live via applyAppearance.
// Match config (starting life, die) lives in the life tracker; rarity colours
// is an add-cards filter; counter comforts live in the tracker's Tweaks.
// Settings stays a single, focused surface.
function SettingsSheet({ open, onClose, onCredits }) {
  const [s, setS] = useState(null);
  useEffect(() => { if (open) getSettings().then(setS); }, [open]);
  async function put(key, value) {
    setS((p) => { const n = { ...p, [key]: value }; applyAppearance(n); return n; });
    await setSetting(key, value);
  }
  if (!open) return null;
  const label = (t) => <div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.14em', color: 'var(--ink-muted)', margin: '18px 0 10px' }}>{t}</div>;
  const Toggle = ({ label: lbl, k, hint }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', borderBottom: '1px solid var(--hair-12)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "500 14px/1.2 var(--f-ui)", color: 'var(--ink-body)' }}>{lbl}</div>
        {hint && <div style={{ font: "400 11.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', marginTop: 3 }}>{hint}</div>}
      </div>
      <button onClick={() => put(k, s[k] ? 0 : 1)} aria-label={lbl} aria-pressed={!!s?.[k]}
        style={{ width: 46, height: 28, minWidth: 46, borderRadius: 14, border: '1px solid var(--hair-30)', background: s?.[k] ? 'var(--gold-leaf)' : 'transparent', position: 'relative', cursor: 'pointer', flex: 'none' }}>
        <span style={{ position: 'absolute', top: 2, left: s?.[k] ? 20 : 2, width: 22, height: 22, borderRadius: '50%', background: s?.[k] ? '#1a1410' : 'var(--ink-faint)', transition: 'left .15s' }} />
      </button>
    </div>
  );
  const scale = clampFontScale(s?.font_scale);
  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      {s == null ? <Loading /> : (
        <div style={{ padding: '0 16px' }}>
          {label('ACCESSIBILITY')}
          <div style={{ padding: '4px 2px 12px', borderBottom: '1px solid var(--hair-12)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ font: "500 14px/1 var(--f-ui)", color: 'var(--ink-body)' }}>Text &amp; UI size</span>
              <span style={{ font: "600 12px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>{Math.round(scale * 100)}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <IconButton glyph="−" tone="muted" size={40} title="Smaller" onClick={() => put('font_scale', clampFontScale(scale - FONT_STEP))} />
              <input type="range" min={FONT_MIN} max={FONT_MAX} step={FONT_STEP} value={scale}
                onChange={(e) => put('font_scale', clampFontScale(e.target.value))}
                aria-label="Text and UI size"
                style={{ flex: 1, accentColor: 'var(--gold-leaf)' }} />
              <IconButton glyph="+" size={40} title="Larger" onClick={() => put('font_scale', clampFontScale(scale + FONT_STEP))} />
            </div>
          </div>
          <Toggle label="High contrast" k="high_contrast" hint="Brighter text and stronger outlines." />
          <Toggle label="Reduce motion" k="reduced_motion" hint="Minimise animations and transitions." />
          <Toggle label="Haptics" k="haptics" hint="Subtle vibration on key taps." />
          {label('ABOUT')}
          <button onClick={onCredits} style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 12, padding: '13px 2px', background: 'none', border: 'none', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ flex: 1, font: "500 14px/1.2 var(--f-ui)", color: 'var(--ink-body)' }}>Credits</span>
            <span style={{ color: 'var(--ink-faint)', display: 'flex' }}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
          </button>
        </div>
      )}
    </Sheet>
  );
}

// Credits / About - a centered modal (not a bottom sheet), ported from Arcanum
// and tailored to Compendium. Black chassis, gold wordmark, IP disclaimer.
function CreditsModal({ open, onClose }) {
  return (
    <CenteredModal open={open} label="Credits" maxWidth={350} onClose={onClose} boxStyle={{ overflow: 'hidden' }}>
        <div style={{ position: 'relative', textAlign: 'center', padding: '34px 26px 26px', background: 'radial-gradient(ellipse at 50% 0%, rgba(220,184,111,.14) 0%, transparent 70%)' }}>
          <span style={{ display: 'block', width: 54, height: 54, margin: '0 auto 14px', borderRadius: 14, background: 'linear-gradient(160deg,#2a2113,#12100a)', border: '1px solid rgba(220,184,111,.4)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)', position: 'relative' }}>
            <span style={{ position: 'absolute', top: '50%', left: '50%', width: 18, height: 18, transform: 'translate(-50%,-50%) rotate(45deg)', border: '2px solid var(--gold-leaf)', borderRadius: 3 }} />
          </span>
          <div style={{ font: "600 27px/1.1 var(--f-display)", color: 'var(--gold-leaf)', letterSpacing: '.01em' }}>Compendium</div>
          <div style={{ font: "500 11px/1 var(--f-mono)", letterSpacing: '.05em', color: '#b08d4e', margin: '8px 0 14px' }}>v1.0.0 beta</div>
          <div style={{ font: "400 13.5px/1.6 var(--f-read)", color: 'var(--ink-muted)' }}>
            Compendium is an unofficial, fan-made companion app for <strong style={{ color: 'var(--ink-body)', fontWeight: 600 }}>Sorcery: Contested Realm</strong> - unifying your codex, decks and life tracker in one place.
            <br /><br />
            Sorcery: Contested Realm and all related trademarks, artwork, characters, and intellectual property are owned by Erik&rsquo;s Curiosa. This app is not affiliated with, endorsed, sponsored, or approved by Erik&rsquo;s Curiosa.
            <br /><br />
            <em style={{ color: 'var(--gold-leaf)', fontStyle: 'italic' }}>Created by fans, for the community.</em>
          </div>
        </div>
    </CenteredModal>
  );
}

// Search-syntax cheatsheet - the faint ? on the search pill opens this. One
// grammar, one cheatsheet (src/store/cardQuery.js). QUERY_HELP = card-attribute
// tokens that work identically in both search bars; SCOPE_HELP = the Codex-only
// personal-layer tokens (inert in the deckbuilder). The 'codex'/'deck' variants
// differ only in chassis tint, not in grammar. Keep rows in step with the parser.
const QUERY_HELP = [
  ['airborne', 'Words match names, card text and article bodies (several words search as one phrase)'],
  ['t:minion', 'Card type or subtype - minion, aura, magic, artifact, site, avatar, mortal… (type:)'],
  ['r:draw', 'Rules text - commas require every term: r:"airborne, genesis" (rules:)'],
  ['kw:charge', 'Keyword ability, whole word - kw:airborne,charge needs both (keyword:)'],
  ['e:fire', 'Element - air, earth, fire, water; letters OR any of a/e/f/w: e:ae (el:/element:)'],
  ['attack>2', 'Attack - also defense>2 and life:20; use : = > < >= <='],
  ['th:3', 'Any element threshold meets it; per-element at: et: ft: wt: (threshold:)'],
  ['c<=3', 'Mana cost - c:2, c>=4, c<3 (cost:)'],
  ['s:got', 'Set - alp, bet, art, got, dra, pro, or a name (set:)'],
  ['rarity:unique', 'Rarity - ordinary, exceptional, elite, unique'],
];
const SCOPE_HELP = [
  ['has:faq', 'Cards with an official FAQ'],
  ['has:marginalia', 'Entries carrying your notes, highlights or links'],
  ['is:errata', 'Cards with updated rules text'],
  ['is:saved', 'Your bookmarked entries'],
  ['is:article', 'Articles only'],
  ['is:card', 'Cards only'],
];
// Manual fallback for importing a shared result when the camera deep link
// doesn't auto-open (desktop, or a phone that didn't offer the link): paste it.
function ImportPasteModal({ open, onClose, onParsed }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => { if (open) { setText(''); setErr(false); } }, [open]);
  if (!open) return null;
  const submit = () => { const p = parseMatchShare(text); if (p) onParsed(p); else setErr(true); };
  return (
    <CenteredModal open={open} label="Import a result" maxWidth={380} onClose={onClose} closeButton={false} boxStyle={{ padding: '24px 22px 20px' }}>
        <div style={{ font: "600 20px/1.15 var(--f-display)", color: 'var(--gold-leaf)', marginBottom: 6 }}>Import a result</div>
        <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', marginBottom: 14 }}>Scan your opponent's QR with your camera, or paste the link they share here.</div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setErr(false); }} placeholder="compendium://match?d=…"
          style={{ width: '100%', height: 88, resize: 'none', background: 'var(--surface-well)', border: `1px solid ${err ? 'var(--destructive)' : 'var(--hair-22)'}`, borderRadius: 12, padding: 12, color: 'var(--ink-body)', font: "400 12px/1.4 var(--f-mono)", boxSizing: 'border-box' }} />
        {err && <div style={{ font: "400 12px/1.4 var(--f-read)", color: 'var(--destructive)', marginTop: 6 }}>That doesn't look like a shared-result link.</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...BTN_GHOST, flex: 1 }}>Cancel</button>
          <button onClick={submit} style={{ ...BTN_GOLD, flex: 2, display: 'flex', justifyContent: 'center' }}>Review import</button>
        </div>
    </CenteredModal>
  );
}

function SearchHelpModal({ open, kind = 'codex', onClose }) {
  if (!open) return null;
  const deck = kind === 'deck';
  // Chassis + chip palette: gold for the codex, the deck pillar's amethyst here.
  const chassis = deck
    ? { background: 'linear-gradient(180deg,#1c1330,#0e0a1a)', border: '1px solid rgba(160,110,220,.32)' }
    : { background: 'linear-gradient(180deg,#151109,#0b0806)', border: '1px solid rgba(220,184,111,.24)' };
  const glow = deck ? 'rgba(157,106,214,.14)' : 'rgba(220,184,111,.12)';
  const chip = deck
    ? { color: '#c79af0', background: 'rgba(157,106,214,.12)', border: '1px solid rgba(160,110,220,.32)' }
    : { color: 'var(--gold-leaf)', background: 'rgba(220,184,111,.1)', border: '1px solid rgba(220,184,111,.22)' };
  const example = deck
    ? ['t:minion el:f c<=3 kw:charge', 'every cheap Fire minion with Charge']
    : ['t:minion e:air airborne', 'every Air minion whose text mentions airborne'];
  const Row = ([tok, desc]) => (
    <div key={tok} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--hair-12)' }}>
      <code style={{ flex: 'none', font: "600 12px/1 var(--f-mono)", borderRadius: 7, padding: '5px 8px', ...chip }}>{tok}</code>
      <span style={{ font: "400 12.5px/1.45 var(--f-read)", color: 'var(--ink-body-2)' }}>{desc}</span>
    </div>
  );
  return (
    <CenteredModal open={open} label="Search syntax" maxWidth={370} onClose={onClose} boxStyle={{ maxHeight: '82vh', overflowY: 'auto', ...chassis }}>
        <div style={{ padding: '26px 22px 22px', background: `radial-gradient(ellipse at 50% 0%, ${glow} 0%, transparent 60%)` }}>
          <div style={{ font: "600 21px/1.15 var(--f-display)", color: 'var(--gold-leaf)', marginBottom: 4 }}>Search Syntax</div>
          <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)', marginBottom: 16 }}>
            {deck ? 'Tokens narrow the card pool - they stack with the Refine sheet.' : 'Mix any of these in one search - tokens narrow, words match.'}
          </div>
          {QUERY_HELP.map(Row)}
          <div style={{ marginTop: 16, marginBottom: 2, font: "600 10.5px/1 var(--f-mono)", letterSpacing: '.14em', color: 'var(--ink-muted)' }}>
            {deck ? 'CODEX SCOPE — IGNORED HERE' : 'CODEX SCOPE'}
          </div>
          <div style={{ opacity: deck ? 0.5 : 1 }}>{SCOPE_HELP.map(Row)}</div>
          <div style={{ marginTop: 14, font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)' }}>
            Example: <code style={{ font: "600 12px/1 var(--f-mono)", color: chip.color }}>{example[0]}</code> - {example[1]}.
          </div>
        </div>
    </CenteredModal>
  );
}

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
  detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 12px', minHeight: 43 },
  back: { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#e3c589', font: "500 16px/1 var(--f-ui)", cursor: 'pointer', width: 60, padding: 0, flexShrink: 0 },
  detailTitle: { flex: 1, minWidth: 0, textAlign: 'center', font: "600 14px/1.15 var(--f-display)", letterSpacing: '.1em', color: '#efe7d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px' },
  bmToggle: { width: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', background: 'none', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent', transition: 'color .15s' },
  title: { font: "600 27px/1 var(--f-display)", color: 'var(--ink-head)' },
  // S.app already insets the whole shell by env(safe-area-inset-bottom); the scroller
  // lives inside that box, so it only needs nav overlap (62px) + search/FAB clearance
  // (92px) - adding env() again just wastes a strip at the end of every list.
  body: { flex: 1, overflowY: 'auto', overscrollBehaviorY: 'contain', paddingBottom: 'calc(154px + var(--kb,0px) / var(--ui-scale,1))' },
  input: { flex: 1, height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" },
  // Sheet primary - black glass, gold only in text/border (app rule: sheets stay black).
  btnGold: BTN_GOLD,
  btnGhost: BTN_GHOST,
};
