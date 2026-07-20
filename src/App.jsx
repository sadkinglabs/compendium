import React, { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { openDatabase } from './store/db.js';
import {
  initProfiles, getActiveProfile, listProfiles, profileStats,
  createProfile, switchProfile, renameProfile, deleteProfile,
} from './store/profileRepository.js';
import { seedCatalogIfNeeded } from './store/catalog.js';
import { backfillSingleSetOwned } from './store/ownedRepository.js';
import { resolveByName, isSaved, toggleSaved } from './store/codexRepository.js';
import { searchAll } from './store/searchRepository.js';
import { ImportUrlSheet, ImportTextSheet } from './pillars/Decks.jsx';
import Fab, { FabGlyph } from './components/Fab.jsx';
import BottomDock from './components/BottomDock.jsx';
import SearchPill from './components/SearchPill.jsx';
import CardArt from './components/CardArt.jsx';
import { thresholdRuns } from './store/cardArt.js';
import { importCuriosaUrl } from './store/deckRepository.js';
import Home from './pillars/Home.jsx';
import { getSettings, setSetting, recordMatch } from './store/playRepository.js';
import { loadOngoing, saveOngoing, clearOngoing } from './store/ongoingMatch.js';
import { readMatchSnapshot } from './store/matchSnapshot.js';
import { setResume } from './store/homeRepository.js';
import { onBackButton, onAppUrlOpen, exitApp, haptic } from './native.js';
import { runBackConsumers } from './back.js';
import { resolveAppBackFallback } from './navBack.js';
import { parseMatchShare } from './store/matchShare.js';
import { importDeckShare } from './store/deckRepository.js';
import { applyAppearance, clampFontScale, FONT_MIN, FONT_MAX, FONT_STEP } from './appearance.js';
import { CHANGELOG } from './content/changelog.js';
import { getSeenBuild, setSeenBuild, pendingEntries } from './store/changelog.js';
import { reconcile as reconcileTelemetry, grantConsent, denyConsent, getConsent, isOn as telemetryOn, needsDisclosure, UNSET } from './store/telemetry.js';
import { TELEMETRY_SETTING } from './content/telemetry.js';
import { ListRow, IconButton, Loading, Chip, ChipRow, SectionLabel, ThresholdPips, BTN_GOLD, BTN_GHOST, CenteredModal } from './components/ui.jsx';
import { parseQuery } from './store/cardQuery.js';
import Sheet from './components/Sheet.jsx';
import { ToastHost, ConfirmHost } from './components/FeedbackHosts.jsx';
import { toast, confirmAction } from './feedback.js';
import { noticesText } from './thirdPartyNotices.js';

// Route-split: only Home + the app shell load eagerly (the landing screen). Every
// other pillar and the cold overlays (match, wizard, deck editor, card detail)
// load their own chunk on first use, so the initial bundle is a fraction of the
// whole app. Each renders behind a <Suspense fallback={<Loading/>}> below.
const Codex = lazy(() => import('./pillars/Codex.jsx'));
const CodexDetail = lazy(() => import('./pillars/CodexDetail.jsx'));
const Collection = lazy(() => import('./pillars/Collection.jsx'));
const DecksPager = lazy(() => import('./pillars/DecksPager.jsx'));
const DeckAddCards = lazy(() => import('./pillars/DeckAddCards.jsx'));
const Play = lazy(() => import('./pillars/Play.jsx'));
const ImportMatchSheet = lazy(() => import('./pillars/Play.jsx').then((m) => ({ default: m.ImportMatchSheet })));
const LifeCounter = lazy(() => import('./pillars/LifeCounter.jsx'));
const AvatarPicker = lazy(() => import('./pillars/AvatarPicker.jsx'));
const CreateDeckWizard = lazy(() => import('./components/CreateDeckWizard.jsx'));
const ChangelogModal = lazy(() => import('./components/ChangelogModal.jsx'));
const TelemetryDisclosure = lazy(() => import('./components/TelemetryDisclosure.jsx'));

// Bottom-nav pillars. Icons come from <NavIcon icon={key} /> (inline SVG); only
// key + label are read (glyph/eyebrow/accent fields were retired in the sweep).
const PILLARS = [
  { key: 'home',    label: 'Home' },
  { key: 'codex',   label: 'Codex' },
  { key: 'collect', label: 'Collection' },
  { key: 'decks',   label: 'Decks' },
  { key: 'play',    label: 'Play' },
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
  const [ongoing, setOngoing] = useState(null);  // resumable match snapshot; reconciled after initProfiles() in the boot effect (loadOngoing needs the active profile)
  const counterApi = useRef(null);                   // {minimize} - set by the live counter
  const homeApi = useRef(null);                       // {back} - Home edit mode / Overview<->Dashboard subtab
  const lastBackAt = useRef(0);                       // double-back-to-exit timestamp (Home root)
  const [settingsOpen, setSettingsOpen] = useState(false);   // app Settings (accessibility + prefs) - a modal over the profile sheet
  const [creditsOpen, setCreditsOpen] = useState(false);       // centered Credits/About modal - the Home wordmark's tap target
  const [changelogOpen, setChangelogOpen] = useState(false);   // release notes, opened on demand from Credits (never stamps)
  const [noticesOpen, setNoticesOpen] = useState(false);       // third-party licence notices, reached from Credits
  const [changelogPending, setChangelogPending] = useState(null);   // unseen entries from the update gate (stamps on dismiss)
  const [telemetryAsk, setTelemetryAsk] = useState(false);          // consent is `unset` - show the disclosure, once
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
  useEffect(() => onAppUrlOpen(async (url) => {
    const m = parseMatchShare(url); if (m) { setMatchImport(m); return; }
    // deckShare pulls fflate - load it only when a deck link actually arrives.
    const { parseDeckShare } = await import('./store/deckShare.js');
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
      const t0 = Date.now();
      try {
        await openDatabase();
        const { counts } = await seedCatalogIfNeeded((msg) => setBoot({ status: 'loading', msg }));
        const p = await initProfiles();
        setProfile(p);
        // Reconcile a live match that survived a process death. The former initializer
        // (`useState(() => loadOngoing())`) ran during first render - before profile
        // initialization - so activeProfileId() threw and it returned null; that is why
        // `ongoing` now starts null and is loaded HERE instead. initProfiles() has
        // resolved the active profile id, so the profile-scoped key is finally correct.
        // Splash is still up and nothing reads `ongoing` until Home paints, so this is the
        // point that makes "Return to Match" appear after an OS kill.
        setOngoing(loadOngoing());
        // Move any single-set card owned in the Unspecified bucket onto its real
        // set row (e.g. older scanner adds). Idempotent; never blocks boot.
        try { await backfillSingleSetOwned(); } catch (e) { console.error('single-set backfill failed', e); }
        try { applyAppearance(await getSettings()); } catch { /* pre-settings profile */ }
        // The update gate: show, once, the notes for every build this install
        // skipped. The stamp is app-global (Preferences), NOT a profile setting,
        // so it neither replays on a profile switch nor rides a profile import
        // in from another device. Number() is load-bearing: __APP_BUILD__ is a
        // string, and '9' > '35' lexicographically. Like the backfills above it,
        // a failure here logs and is forgotten - the gate must never cost a boot.
        try {
          const seen = await getSeenBuild();
          const pending = pendingEntries(CHANGELOG, seen, Number(__APP_BUILD__));
          if (pending.length) setChangelogPending(pending);
          // A fresh install with no notes to show still gets stamped, or it would
          // "catch up" on its own first release the next time one lands.
          else if (seen === null) await setSeenBuild(Number(__APP_BUILD__));
        } catch (e) { console.error('changelog gate failed', e); }
        // Telemetry reconciliation. ASSERTS the SDKs against the recorded consent on
        // every boot - it must not assume, because the manifest's collection flags are
        // only the INITIAL default and a persisted runtime override outlives them. A
        // granted-then-denied install whose disable call was interrupted would
        // otherwise boot collecting while Settings said off. `unset` and `denied` both
        // also delete unsent reports, which is what stops a crash captured before
        // consent from ever being submitted, and what clears what build 37 left behind
        // when an existing tester upgrades.
        //
        // Like the gates above: never blocks boot, a failure logs and is forgotten.
        // Fail-safe is the OFF direction - telemetry.js reports `unset` on a native
        // error, which asks again rather than collecting. On web it reports null
        // (not applicable, no Firebase to consent to) and we ask nothing: `unset`
        // there would strand the modal, because grantConsent no-ops on web too.
        // needsDisclosure, not `=== UNSET`: `granting` means the user HAS answered and
        // the cleanup is still settling. Re-asking them would be a bug, and treating it
        // as granted would claim a guarantee reconcile has not yet earned.
        try {
          if (needsDisclosure(await reconcileTelemetry())) setTelemetryAsk(true);
        } catch (e) { console.error('telemetry reconcile failed', e); }
        if (import.meta.env.DEV) {
          window.__cx = {
            transfer: await import('./store/profileTransfer.js'),
            deck: await import('./store/deckRepository.js'),
            codex: await import('./store/codexRepository.js'),
            profile: await import('./store/profileRepository.js'),
          };
        }
        // Floor the splash so the branded animation actually paints on a fast warm
        // boot (native SQLite resolves this whole chain in a few ms, faster than the
        // splash's own fade-in - so on device it flashed by unseen). Success path
        // only; an error must surface immediately.
        const MIN_SPLASH_MS = 1100;
        const rest = MIN_SPLASH_MS - (Date.now() - t0);
        if (rest > 0) await new Promise((r) => setTimeout(r, rest));
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

  if (boot.status === 'loading') return <Splash />;
  if (boot.status === 'error') return <Splash error errorText={'Store error: ' + boot.error} />;

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
    const r = readMatchSnapshot(ongoing);   // identity fields via the single-sourced contract
    setMatch({ mode: r.mode, settings: r.settings, you: r.you, opp: r.opp, deck: r.deck, resume: ongoing });
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

  // The update gate's ONE dismissal path. CenteredModal owns scrim, close button,
  // Escape and hardware back, and routes them all to onClose - so there is no
  // second route to keep in sync, and no backStack row (runBackConsumers() runs
  // before the declarative stack, so a row here would be unreachable anyway).
  // Stamping on dismiss rather than on display means a kill mid-read re-shows the
  // notes: the benign failure. Stamping on display would swallow them for good.
  const dismissChangelog = async () => {
    setChangelogPending(null);
    try { await setSeenBuild(Number(__APP_BUILD__)); }
    catch (e) { console.error('changelog stamp failed', e); }   // benign: re-shows next launch
  };

  const initial = (profile?.name || '?').charAt(0).toUpperCase();
  const searchable = true;   // universal search on every pillar
  const placeholders = { home: 'Search rules, cards, decks…', codex: 'Search the codex…', collect: 'Search your collection…', decks: 'Search decks…', play: 'Search matches…' };

  // Hardware back peels one layer at a time. The PRECEDENCE is declared ONCE in
  // navBack.js (APP_BACK_ORDER, top first) and resolved against this live state; the
  // ACTIONS stay here. `.find` used truthiness, so the two object-valued predicates
  // (detail, deckOpen) are coerced with `!!` - behaviour-identical. Consumers (FAB
  // menus, sheet/modal chassis) peel FIRST via runBackConsumers(); then this fallback
  // order; then Home edit / double-back to exit. Keys MUST match APP_BACK_ORDER.
  const backState = {
    match, preMatch, deckWizard, importMode, matchImport, resultPaste,
    searchHelp: searchHelpOpen, credits: creditsOpen, settings: settingsOpen, profileSheet,
    add: addActive, query: hasQuery, detail: !!viewDetail,
    deckEdit: tab === 'decks' && !!deckOpen && deckEditMode,
    deckOpen: tab === 'decks' && !!deckOpen,   // back to Library, not straight Home
    tabHome: tab !== 'home',
  };
  const BACK_ACTIONS = {
    match: () => counterApi.current?.closeTopmost?.(),   // peel counter modals, else minimize (preserves the match)
    preMatch: () => setPreMatch(null),
    deckWizard: () => setDeckWizard(false),
    importMode: () => setImportMode(null),
    matchImport: () => setMatchImport(null),
    resultPaste: () => setResultPaste(false),
    searchHelp: () => setSearchHelpOpen(false),
    credits: () => setCreditsOpen(false),
    settings: () => setSettingsOpen(false),
    profileSheet: () => setProfileSheet(false),
    add: exitAdd,
    query: () => setQuery(''),
    detail: back,
    deckEdit: () => setDeckEditMode(false),
    deckOpen: () => setDeckOpen(null),
    tabHome: () => goTab('home'),
  };
  backRef.current = () => {
    if (runBackConsumers()) return;                            // an open FAB menu or sheet - close it first
    const key = resolveAppBackFallback(backState);
    if (key) { BACK_ACTIONS[key](); return; }
    if (tab === 'home' && homeApi.current?.back?.()) return;   // Home edit mode / Overview<->Dashboard subtab
    if (Date.now() - lastBackAt.current < 2000) { exitApp(); return; }   // double-back to exit
    lastBackAt.current = Date.now();
    toast('Press back again to exit');
  };

  // Per-pillar top-down colour wash (over pure black). Home is pure black (no
  // wash) to signal active engagement; Codex=warm gold · Decks=amethyst · Play=jade.
  const WASH = { home: '#000', codex: '#33260e', collect: '#2a1220', decks: '#2a1c44', play: '#18301f' };
  // Canonical list-row accent, morphing per pillar (grimoire gold default;
  // amethyst in Decks, jade in Play) - consumed by ListRow via --list-accent.
  const LIST = {
    home:    { a: 'var(--gold-leaf)',     g: 'rgba(220,184,111,.5)' },
    codex:   { a: 'var(--gold-leaf)',     g: 'rgba(220,184,111,.5)' },
    collect: { a: 'var(--accent-ruby)',   g: 'rgba(210,88,115,.5)' },
    decks:   { a: 'var(--accent-violet)', g: 'rgba(199,154,208,.5)' },
    play:    { a: 'var(--accent-jade)',   g: 'rgba(143,211,168,.5)' },
  };
  const list = LIST[tab] || LIST.home;
  // The Decks pillar uses a single-page deckbuilder that owns its own
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
            already sitting on Home does it open Credits - the app's "about
            itself" surface, including the release notes. Settings moved to the
            profile sheet, where it has a visible row instead of a binding nothing
            advertises. */}
        <button onClick={() => {
          const atHome = tab === 'home' && !viewDetail && !hasQuery && !addActive && !preMatch;
          if (atHome) setCreditsOpen(true); else goTab('home');
        }} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} aria-label="Home / Credits">
          <span style={S.diamond} />
          <span style={S.wordmark}>Compendium</span>
        </button>
        <button onClick={() => setProfileSheet(true)} style={S.profileChip} title={profile?.name}>{initial}</button>
      </div>

      {storageFull && (
        <div onClick={() => setStorageFull(false)} role="alert"
          style={{ margin: '0 16px 8px', padding: '10px 14px', borderRadius: 12, background: 'rgba(42,26,20,.92)', border: '1px solid rgba(200,120,106,.45)', color: '#f0c9c2', font: "500 12.5px/1.45 var(--f-ui)", cursor: 'pointer' }}>
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
          <div style={{ ...S.detailTitle, fontSize: detail.kind === 'card' ? 15 : 14 }}>{detail.title || ''}</div>
          <button onClick={async () => { await toggleSaved(detail.kind, detail.id); setDetailSaved((s) => !s); /* no bump(): the browse list is unmounted behind the detail and reloads its saved state on remount, so a global rev bump here just re-renders the whole App for nothing */ }}
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
      <Suspense fallback={<Loading />}>
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
      </Suspense>
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
      {/* Home owns no app-level FAB - the wordmark opens Credits, and the
          Dashboard renders its own "+" FAB. Play owns its Add-Match FAB. */}

      {/* Bottom navigation: Home, Codex, Collection, Decks, and Play. */}
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
        onSwitch={onSwitchProfile} onChanged={reloadProfile} onSettings={() => setSettingsOpen(true)}
        onExport={async () => { try { const { exportToFile } = await import('./store/profileTransfer.js'); await exportToFile(profile.id); toast('Profile exported'); } catch (e) { toast('Export failed: ' + e.message, { tone: 'danger' }); } }}
        onImport={async () => { try { const { pickAndImport } = await import('./store/profileTransfer.js'); const pid = await pickAndImport(); if (pid) { await onSwitchProfile(pid); toast('Profile imported'); } } catch (e) { toast('Import failed: ' + e.message, { tone: 'danger' }); } }} />

      {/* Create-deck wizard (mandatory name → avatar) */}
      {deckWizard && (
        <Suspense fallback={<Loading />}>
          <CreateDeckWizard onClose={() => setDeckWizard(false)}
            onCreated={(id, name) => { setDeckWizard(false); bump(); goTab('decks'); setDeckOpen({ id, name }); }} />
        </Suspense>
      )}

      {/* Import from Curiosa URL - separate flow, lands on the deck in the pager */}
      <ImportUrlSheet open={importMode === 'url'} onClose={() => setImportMode(null)}
        onImportUrl={async (url) => {
          const { id, name, warnings } = await importCuriosaUrl(url);
          setImportMode(null); bump();
          toast(warnings.length ? `Imported “${name}” · ${warnings.length} card(s) unrecognised` : `Imported “${name}”`);
          goTab('decks'); setDeckOpen({ id, name });
        }} />

      {/* Import from pasted text - the sheet now runs its own parse -> review ->
          confirm; we just navigate to the created deck. */}
      <ImportTextSheet open={importMode === 'text'} onClose={() => setImportMode(null)}
        onDone={(id, name) => { setImportMode(null); bump(); goTab('decks'); setDeckOpen({ id, name }); }} />

      {/* Pre-match avatar picker - centered modal over the (dimmed) app, so it
          doesn't take over the interface. Scrim tap cancels. */}
      {preMatch && (
        <div className="cx-picker-modal" onClick={() => setPreMatch(null)}>
          <div className="cx-picker-box" onClick={(e) => e.stopPropagation()}>
            <Suspense fallback={<Loading />}>
              <AvatarPicker onConfirm={beginMatch} onCancel={() => setPreMatch(null)} />
            </Suspense>
          </div>
        </div>
      )}
      {match && (
        <Suspense fallback={<Loading />}>
          <LifeCounter settings={match.settings} mode={match.mode} players={{ you: match.you, opp: match.opp }}
            deck={match.deck || null} resume={match.resume || null} registerApi={(api) => { counterApi.current = api; }}
            onMinimize={minimizeMatch} onPersist={saveOngoing} onRecord={recordMatchResult} onExit={exitMatch} onNewMatch={newMatchFromEnd} />
        </Suspense>
      )}
      {/* Settings paints over the profile sheet, which stays mounted underneath so
          closing this returns the user to where they opened it from. */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} onChangelog={() => setChangelogOpen(true)}
        onNotices={() => setNoticesOpen(true)} />
      <NoticesModal open={noticesOpen} onClose={() => setNoticesOpen(false)} />
      {/* Opened from Credits, so it shows the WHOLE history on demand. Nothing is
          recorded when it closes: reading the notes because you went looking is not
          the same event as being shown them after an update. */}
      {changelogOpen && (
        <Suspense fallback={null}>
          <ChangelogModal open entries={CHANGELOG} onClose={() => setChangelogOpen(false)} />
        </Suspense>
      )}
      {/* The diagnostics disclosure - one of exactly TWO surfaces that may grant
          consent (the other is the Settings PRIVACY row); both show the disclosure
          text. See THE ONE RULE in src/telemetry.js before adding a third.

          It takes the screen ahead of the update gate below: the two can only ever
          collide on the single build that ships this (the disclosure fires once,
          ever), and a decision should not be read underneath a list of news. The
          buttons record what was ACTUALLY stored - a failed write leaves `unset`,
          which keeps the modal up rather than closing on a choice that did not land.

          It cannot be dismissed: no backdrop tap, no back, no close button. Tapping
          the scrim used to answer it, which left `unset` and so collected nothing -
          the fail-safe held, but a stray tap on the background is not consent, and
          off-by-accident should not look like off-by-choice. */}
      {telemetryAsk && (
        <Suspense fallback={null}>
          <TelemetryDisclosure open
            onAccept={async () => { if (await grantConsent() !== UNSET) setTelemetryAsk(false); }}
            onDecline={async () => { if (await denyConsent() !== UNSET) setTelemetryAsk(false); }} />
        </Suspense>
      )}
      {/* The update gate. Same component, different two things: only the entries
          this install hasn't seen, and a close that RECORDS having seen them. */}
      {changelogPending && !telemetryAsk && (
        <Suspense fallback={null}>
          <ChangelogModal open entries={changelogPending} onClose={dismissChangelog} />
        </Suspense>
      )}
      <SearchHelpModal open={searchHelpOpen} kind={addActive ? 'deck' : 'codex'} onClose={() => setSearchHelpOpen(false)} />
      <ImportPasteModal open={resultPaste} onClose={() => setResultPaste(false)}
        onParsed={(p) => { setResultPaste(false); setMatchImport(p); }} />
      {matchImport && (
        <Suspense fallback={null}>
          <ImportMatchSheet payload={matchImport} onClose={() => setMatchImport(null)}
            onSaved={() => { setMatchImport(null); bump(); goTab('play'); toast('Match imported'); }} />
        </Suspense>
      )}
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

// Bottom-nav icons: house, book, stacked cards, and crossed swords.
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

// Codex result-row chrome, shared by the Articles and Cards groups. Same anatomy
// as the reskinned browse A-Z index (.cx-codex-* in tokens.css): text-ledger
// rows, gold bookmark when saved else a quiet chevron. Duplicated here rather
// than shared out of Codex.jsx so the browse list stays untouched.
const CxBookmark = () => (
  <span className="cx-codex-bm" aria-label="Bookmarked"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" /></svg></span>
);
const CxChevron = () => (
  <svg className="cx-codex-chev" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
);
const CxSword = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" y1="19" x2="19" y2="13" /><line x1="16" y1="16" x2="20" y2="20" /><line x1="19" y1="21" x2="21" y2="19" /></svg>
);

// Match highlighting: light the matched substring gold. Strip the search grammar
// tokens (is:card, t:minion, set:beta …) and quotes, then highlight the plain
// terms (>=2 chars) wherever they fall in the title - colour only, no chrome.
function hlParts(text, q) {
  const terms = (q || '').replace(/[a-z]+:\S+/gi, ' ').replace(/["']/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
  if (!terms.length) return text;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp('(' + esc.join('|') + ')', 'ig');
  const lower = new Set(terms.map((t) => t.toLowerCase()));
  return text.split(re).map((p, i) => lower.has(p.toLowerCase())
    ? <span key={i} style={{ color: '#e3c589' }}>{p}</span> : p);
}

function SearchRuleRow({ it, q, onOpen }) {
  return (
    <div className="cx-row cx-codex-row" onClick={onOpen}>
      <span className="cx-codex-title">{hlParts(it.name, q)}</span>
      {it.saved ? <CxBookmark /> : <CxChevron />}
    </div>
  );
}

function SearchCardRow({ it, q, onOpen }) {
  const runs = thresholdRuns(it);
  const type = (it.type || 'Card').split(/[^A-Za-z]+/)[0];
  // Attack chip: a minion/automaton's attack, "N" or "N/Y" when defence differs.
  const atk = it.attack != null
    ? (it.defence != null && it.defence !== it.attack ? `${it.attack}/${it.defence}` : `${it.attack}`)
    : null;
  return (
    <div className="cx-row cx-codex-row" onClick={onOpen}>
      <span className="cx-codex-thumb"><CardArt card={{ ...it, card_id: it.id }} radius={7} aspect="5/7" /></span>
      <div className="cx-codex-body">
        <span className="cx-codex-name">{hlParts(it.name, q)}</span>
        <span className="cx-codex-meta">
          <span className="cx-codex-type">{type}</span>
          {it.cost != null && <><span className="cx-codex-sep" /><span><span className="cx-codex-mana">{it.cost}</span> mana</span></>}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        {runs.length > 0 && <ThresholdPips runs={runs} size={11} />}
        {atk != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 9, border: '1px solid rgba(74,60,34,.7)', font: "600 12px/1 var(--f-mono)", color: '#a99a80' }}>
            <CxSword />{atk}
          </span>
        )}
        <CxChevron />
      </div>
    </div>
  );
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
      <div style={{ padding: '48px 20px', textAlign: 'center', font: "400 15.5px/1.5 var(--f-read)", color: '#8a8175', fontStyle: 'italic' }}>No matches in the codex for <span style={{ color: '#e3c589' }}>“{query.trim()}”</span></div>
    </div>
  );
  // Section rubric (gold Cinzel caps + fade hairline + count) over the row list.
  // Articles/cards get the reskinned .cx-codex-* rows; decks/matches/marginalia -
  // out of this reskin's scope - keep the shared ListRow.
  const group = (label, items, renderRow) => items.length > 0 && (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel label={label} count={items.length} />
      {items.map(renderRow)}
    </div>
  );
  const openCodex = (it) => onOpen(it.kind, it.id, it.name);
  const ruleRow = (p) => (it) => <SearchRuleRow key={p + it.id} it={it} q={query} onOpen={() => openCodex(it)} />;
  const cardRow = (p) => (it) => <SearchCardRow key={p + it.id} it={it} q={query} onOpen={() => openCodex(it)} />;
  const listRow = (p, iconKind, onItem) => (it) => <ListRow key={p + it.id} icon={<ResultIcon kind={it.kind || iconKind} />} title={it.name} sub={it.meta} onClick={() => onItem(it)} />;
  return (
    <div style={{ padding: '6px 20px 26px' }}>
      {showRules && group('ARTICLES', res.articles, ruleRow('a'))}
      {showCards && group('CARDS', res.cards, cardRow('c'))}
      {showCards && group('MENTIONED IN CARD TEXT', res.cardText, cardRow('ct'))}
      {showRules && group('MENTIONED IN ARTICLES', res.articleText, ruleRow('at'))}
      {kind === 'all' && group('MARGINALIA', res.marginalia || [], listRow('m', 'card', openCodex))}
      {kind === 'all' && group('DECKS', res.decks, listRow('d', 'deck', (it) => onOpen('deck', it.id, it.name)))}
      {kind === 'all' && group('MATCHES', res.duels, listRow('x', 'match', () => onDuel()))}
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
      <Chip label="Marginalia" active={marginalia} onClick={() => setScope('marginalia')} />
    </div>
  );
}

// Profiles - the spine of the app, so the picker earns some ceremony: monogram
// discs, per-profile digests (decks · matches), gold ring on the active one.
// The default (oldest) profile is load-bearing and cannot be deleted; any
// profile can be renamed (data keys off the id - names are just labels),
// duplicated (full re-keyed copy) or exported.
function ProfileSheet({ open, active, onClose, onSwitch, onChanged, onExport, onImport, onSettings }) {
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
    try { const { duplicateProfile } = await import('./store/profileTransfer.js'); await duplicateProfile(p.id); await refresh(); toast(`Duplicated “${p.name}”`); }
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
      {/* Settings lives here because the profile chip is the app's account
          surface, and because a visible row beats the old binding: Settings used
          to open from a tap on the wordmark, which nothing advertised. This sheet
          stays open behind it - see SettingsModal. */}
      <div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.14em', color: 'var(--ink-muted)', margin: '22px 0 4px' }}>APP</div>
      <ChevronRow label="Settings" onClick={onSettings} />
      </div>
    </Sheet>
  );
}

// App Settings - reached from the profile sheet, and rendered as a centered
// modal OVER it rather than as a second bottom sheet. Two sheets would put two
// scrims at the same z-index with only DOM order to separate them; a modal at
// z:700 over the sheet at z:200 is an unambiguous hierarchy, and it's the stack
// the app already runs elsewhere. Because the profile sheet underneath is never
// unmounted, closing this returns to it - which is where the user came from.
// Both chassis register a back consumer and back.js is LIFO, so hardware back
// peels this first and lands on Profiles without any extra wiring.
//
// Accessibility only: font scale, high contrast, reduced motion, haptics - all
// applied live via applyAppearance. Match config (starting life, die) lives in
// the life tracker; rarity colours is an add-cards filter; counter comforts live
// in the tracker's Tweaks. Settings stays a single, focused surface.
function SettingsModal({ open, onClose }) {
  const [s, setS] = useState(null);
  // Telemetry consent is NOT a `settings` row and deliberately not per-profile: it
  // belongs to this install on this device, so it lives in native SharedPreferences
  // (see TelemetryPlugin.kt for why - a profile imported from another device must not
  // carry that device's consent decision here). It therefore has its own state and its
  // own writer; `put` below is for profile settings only.
  const [consent, setConsent] = useState(null);
  const [consentBusy, setConsentBusy] = useState(false);
  useEffect(() => { if (open) { getSettings().then(setS); getConsent().then(setConsent); } }, [open]);
  async function put(key, value) {
    setS((p) => { const n = { ...p, [key]: value }; applyAppearance(n); return n; });
    await setSetting(key, value);
  }
  // Renders the state that was ACTUALLY stored, never an optimistic flip. If the native
  // transition fails, grantConsent/denyConsent return the previous value and the switch
  // stays where it was: the change visibly failed, which is honest. Showing "off" while
  // collection persisted would be the one lie this feature exists to stop.
  //
  // `consentBusy` locks the control for the duration. Not a spinner-for-politeness: a
  // double-tap used to fire grant() and deny() concurrently, and they could interleave
  // into `denied` persisted while Analytics got switched on - stored consent and SDK
  // state disagreeing permanently. The native side serialises too (one executor, a
  // @Synchronized machine); this stops the queue forming in the first place.
  async function putConsent(on) {
    if (consentBusy) return;
    setConsentBusy(true);
    try { setConsent(await (on ? grantConsent() : denyConsent())); }
    finally { setConsentBusy(false); }
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
    <CenteredModal open={open} label="Settings" maxWidth={380} onClose={onClose} boxStyle={{ overflow: 'hidden' }}>
      <div style={{ font: "600 13px/1 var(--f-display)", letterSpacing: '.14em', color: 'var(--gold-leaf)', textAlign: 'center', padding: '22px 44px 4px' }}>SETTINGS</div>
      {s == null ? <Loading /> : (
        <div className="cx-scroll" style={{ maxHeight: 'min(64dvh, 480px)', overflowY: 'auto', padding: '0 20px calc(20px + env(safe-area-inset-bottom,0px))', WebkitOverflowScrolling: 'touch' }}>
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

          {/* PRIVACY. Note the scope change: every toggle above is per-profile
              (`settings` table), this one is app-global. They look identical, so the
              section header and the "On this device" in the hint are what tell them
              apart - flagged in the proposal as deliberately subtle rather than solved.

              The hint carries the disclosure summary, and that is not decoration: it
              is what makes this row one of the two surfaces allowed to grant consent
              (the other is the first-run disclosure). A bare switch here would be a
              third granting surface with nothing to read. */}
          {label('PRIVACY')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px', borderBottom: '1px solid var(--hair-12)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "500 14px/1.2 var(--f-ui)", color: 'var(--ink-body)' }}>{TELEMETRY_SETTING.label}</div>
              <div style={{ font: "400 11.5px/1.4 var(--f-read)", color: 'var(--ink-muted)', marginTop: 3 }}>{TELEMETRY_SETTING.hint}</div>
            </div>
            <button onClick={() => putConsent(!telemetryOn(consent))} aria-label={TELEMETRY_SETTING.label}
              aria-pressed={telemetryOn(consent)} aria-busy={consentBusy} disabled={consent == null || consentBusy}
              style={{ width: 46, height: 28, minWidth: 46, borderRadius: 14, border: '1px solid var(--hair-30)', background: telemetryOn(consent) ? 'var(--gold-leaf)' : 'transparent', position: 'relative', cursor: consentBusy ? 'default' : 'pointer', opacity: consentBusy ? .55 : 1, flex: 'none' }}>
              <span style={{ position: 'absolute', top: 2, left: telemetryOn(consent) ? 20 : 2, width: 22, height: 22, borderRadius: '50%', background: telemetryOn(consent) ? '#1a1410' : 'var(--ink-faint)', transition: 'left .15s' }} />
            </button>
          </div>

          {/* ABOUT/Credits used to live here. Credits is now the Home wordmark's
              tap target, so it's one tap from the landing screen instead of three
              taps deep behind the accessibility toggles. */}
        </div>
      )}
    </CenteredModal>
  );
}

// A label + chevron row: the "tap through to another surface" idiom. Defined once
// (Profiles -> Settings, Credits -> What's New) rather than inlined per caller.
function ChevronRow({ label, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', width: '100%', minHeight: 48, gap: 12, padding: '13px 2px', background: 'none', border: 'none', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer', textAlign: 'left' }}>
      <span style={{ flex: 1, font: "500 14px/1.2 var(--f-ui)", color: 'var(--ink-body)' }}>{label}</span>
      <span style={{ color: 'var(--ink-faint)', display: 'flex' }}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
    </button>
  );
}

// Credits / About uses a centered modal rather than a bottom sheet.
// The full third-party notices, verbatim. MIT requires the copyright AND permission notice to
// accompany the distributed software - an acknowledgement line does not satisfy that - so this
// renders src/thirdPartyNotices.js in full rather than summarising it.
function NoticesModal({ open, onClose }) {
  return (
    <CenteredModal open={open} label="Third-party notices" maxWidth={380} onClose={onClose}>
      <div style={{ padding: '22px 20px 18px' }}>
        <div style={{ font: "600 15px/1.2 var(--f-display)", color: 'var(--gold-leaf)', marginBottom: 12 }}>Third-party notices</div>
        <pre style={{
          margin: 0, maxHeight: '60vh', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          font: "400 11px/1.55 var(--f-mono)", color: 'var(--ink-muted)',
        }}>{noticesText()}</pre>
      </div>
    </CenteredModal>
  );
}

function CreditsModal({ open, onClose, onChangelog, onNotices }) {
  return (
    <CenteredModal open={open} label="Credits" maxWidth={350} onClose={onClose} boxStyle={{ overflow: 'hidden' }}>
        <div style={{ position: 'relative', textAlign: 'center', padding: '34px 26px 22px', background: 'radial-gradient(ellipse at 50% 0%, rgba(220,184,111,.14) 0%, transparent 70%)' }}>
          <span style={{ display: 'block', width: 54, height: 54, margin: '0 auto 14px', borderRadius: 14, background: 'linear-gradient(160deg,#2a2113,#12100a)', border: '1px solid rgba(220,184,111,.4)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)', position: 'relative' }}>
            <span style={{ position: 'absolute', top: '50%', left: '50%', width: 18, height: 18, transform: 'translate(-50%,-50%) rotate(45deg)', border: '2px solid var(--gold-leaf)', borderRadius: 3 }} />
          </span>
          <div style={{ font: "600 27px/1.1 var(--f-display)", color: 'var(--gold-leaf)', letterSpacing: '.01em' }}>Compendium</div>
          {/* Baked in from package.json by vite.config.js - the same two values
              android/app/build.gradle reads for versionName/versionCode. This line
              used to be a hardcoded literal, so it could quietly disagree with the
              build it was printed on. Build is the number to quote in a bug report:
              version moves rarely, build moves on every install. */}
          <div style={{ font: "500 11px/1 var(--f-mono)", letterSpacing: '.05em', color: '#b08d4e', marginTop: 8 }}>v{__APP_VERSION__}</div>
          <div style={{ font: "500 10px/1 var(--f-mono)", letterSpacing: '.08em', color: 'var(--ink-faint)', margin: '5px 0 14px' }}>BUILD {__APP_BUILD__}</div>
          <div style={{ font: "400 13.5px/1.6 var(--f-read)", color: 'var(--ink-muted)' }}>
            Compendium is an unofficial, fan-made companion app for <strong style={{ color: 'var(--ink-body)', fontWeight: 600 }}>Sorcery: Contested Realm</strong> - unifying your codex, decks and life tracker in one place.
            <br /><br />
            Sorcery: Contested Realm and all related trademarks, artwork, characters, and intellectual property are owned by Erik&rsquo;s Curiosa. This app is not affiliated with, endorsed, sponsored, or approved by Erik&rsquo;s Curiosa.
            <br /><br />
            <em style={{ color: 'var(--gold-leaf)', fontStyle: 'italic' }}>Created by fans, for the community.</em>
          </div>
          {/* The release notes' permanent home. The update gate shows them once and
              is gone; this is how you read them again, and how anyone can check
              what a build contains without waiting for the next update. */}
          <div style={{ textAlign: 'left', marginTop: 18, borderTop: '1px solid var(--hair-12)' }}>
            <ChevronRow label="What’s New" onClick={onChangelog} />
            <ChevronRow label="Third-party notices" onClick={onNotices} />
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
  ['has:marginalia', 'Entries carrying your notes or links'],
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
  // One gold chassis + chip (large fills stay black+gold); the deck variant only
  // carries a subtle violet glow as chrome wayfinding.
  const chassis = { background: 'linear-gradient(180deg,#151109,#0b0806)', border: '1px solid rgba(220,184,111,.24)' };
  const glow = deck ? 'rgba(160,140,192,.13)' : 'rgba(220,184,111,.12)';
  const chip = { color: 'var(--gold-leaf)', background: 'rgba(220,184,111,.1)', border: '1px solid rgba(220,184,111,.22)' };
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
            {deck ? 'CODEX SCOPE - IGNORED HERE' : 'CODEX SCOPE'}
          </div>
          <div style={{ opacity: deck ? 0.5 : 1 }}>{SCOPE_HELP.map(Row)}</div>
          <div style={{ marginTop: 14, font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-muted)' }}>
            Example: <code style={{ font: "600 12px/1 var(--f-mono)", color: chip.color }}>{example[0]}</code> - {example[1]}.
          </div>
        </div>
    </CenteredModal>
  );
}

// Whispered incantations while the catalogue seeds. Shuffled per launch and cycled
// so a quick boot still shows a fresh one each time.
const BOOT_LINES = [
  'Grinding the pigments',
  'Marinating the mandrake jars',
  'Drawing the pentagram',
  'Lighting the black candles',
  'Casting the spells',
  'Opening the grimoire',
  'Consulting the spirits',
  'Unrolling the scrolls',
  'Charging the crystals',
  'Feeding the familiars',
  'Stirring the cauldron',
  'Sharpening the athame',
  'Translating the runes',
  'Summoning the avatars',
  'Dusting off the tomes',
  'Bottling the moonlight',
  'Waking the gargoyles',
  'Tuning the ley lines',
  'Counting the reagents',
  'Polishing the scrying glass',
  'Aligning the constellations',
  'Brewing the elixirs',
];

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The Compendium mark: a gold diamond that FILLS from the base as boot advances.
// SVG so the rising fill can be clipped cleanly to the diamond outline.
function BootDiamond({ pct, dim }) {
  const p = Math.max(0, Math.min(100, pct));
  const D = 'M50 5 L95 50 L50 95 L5 50 Z';
  return (
    <div className={`boot-diamond${dim ? ' dim' : ''}`} aria-hidden="true" style={{ lineHeight: 0 }}>
      <svg viewBox="0 0 100 100" width="60" height="60">
        <defs>
          <linearGradient id="bootFill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#e8cd92" /><stop offset="1" stopColor="#c2a05a" />
          </linearGradient>
          <clipPath id="bootClip"><path d={D} /></clipPath>
        </defs>
        <rect clipPath="url(#bootClip)" x="0" y={100 - p} width="100" height={p} fill="url(#bootFill)"
          style={{ transition: 'y .25s linear, height .25s linear' }} />
        <path d={D} fill="none" stroke="#cba75f" strokeWidth="4" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// Matches index.html's #boot-splash background so the pre-React frame and this one
// are the same dark ground - the mark + incantation just fade in over it.
const SPLASH_BG = 'radial-gradient(120% 80% at 50% 42%, #120d09 0%, #0a0705 60%, #000 100%)';

function Splash({ error, errorText }) {
  const [pct, setPct] = useState(0);
  const [line, setLine] = useState(0);
  const lines = useState(() => shuffled(BOOT_LINES))[0];   // fresh order each launch
  // Ease the fill toward (but not to) full - the mark is empty at launch and nearly
  // brimming by the time the catalogue is ready; it unmounts before hitting 100.
  useEffect(() => {
    if (error) return undefined;
    const iv = setInterval(() => setPct((p) => (p >= 94 ? 94 : p + Math.max(0.7, (98 - p) * 0.055))), 60);
    return () => clearInterval(iv);
  }, [error]);
  // Cycle the incantation (looping through the shuffled list).
  useEffect(() => {
    if (error) return undefined;
    const iv = setInterval(() => setLine((i) => (i + 1) % lines.length), 700);
    return () => clearInterval(iv);
  }, [error, lines.length]);

  return (
    <div style={{ ...S.app, background: SPLASH_BG, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20, animation: 'cxfade .4s ease' }}>
      <BootDiamond pct={error ? 0 : pct} dim={error} />
      <div style={{ font: "600 15px/1 var(--f-display)", letterSpacing: '.42em', textIndent: '.42em', textTransform: 'uppercase', color: '#cba75f' }}>Compendium</div>
      {error ? (
        <div style={{ font: "600 13.5px/1.5 var(--f-display)", color: 'var(--destructive)', textAlign: 'center', padding: '0 32px', maxWidth: 320 }}>{errorText}</div>
      ) : (
        <div key={line} className="boot-line" style={{ minHeight: 20, font: "italic 400 14px/1.4 var(--f-read)", color: '#8a7a55', letterSpacing: '.03em', textAlign: 'center' }}>
          {lines[line]}…
        </div>
      )}
    </div>
  );
}

const S = {
  app: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink-body)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', position: 'relative', overflow: 'hidden' },
  brandBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px 10px' },
  diamond: { width: 14, height: 14, transform: 'rotate(45deg)', border: '1.5px solid var(--gold-leaf)', borderRadius: 3, boxShadow: '0 0 8px rgba(220,184,111,.35)' },
  wordmark: { font: "600 20px/1 var(--f-display)", color: 'var(--ink-head)', letterSpacing: '.01em' },
  profileChip: { width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(140deg,#cf9a4a,#8c5a2a)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: "600 12px/1 var(--f-display)", color: '#1a1410', border: 'none', cursor: 'pointer' },
  contextHeader: { padding: '4px 20px 12px' },
  detailHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 12px', minHeight: 43 },
  back: { display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#e3c589', font: "500 16px/1 var(--f-ui)", cursor: 'pointer', width: 60, padding: 0, flexShrink: 0 },
  detailTitle: { flex: 1, minWidth: 0, textAlign: 'center', fontFamily: 'var(--f-display)', fontWeight: 600, fontSize: 14, lineHeight: 1.15, letterSpacing: '.1em', color: '#efe7d8', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px' },
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
