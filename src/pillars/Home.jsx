// Home - Overview (the WELCOME screen: greeting, at-a-glance doorway tiles,
// capped deck rail / duel digest / notes) and the customisable Dashboard
// (all widget kinds, edit mode: resize ½/full, move, remove, add, configure).
// Overview is scale-safe by design: every section is hard-capped, collapsible,
// and redirects to the pillar where the items actually live - the Dashboard
// is where users compose their own deeper view.
import React, { useEffect, useState, useRef } from 'react';
import {
  listBlocks, addBlock, removeBlock, resizeBlock, reorderBlocks, setConfig,
  widgetData, widgetMeta, isStructural, isRollable, pillarOf,
  sampleData, overview, WIDGETS,
  saveLayout, listLayouts, loadLayout, deleteLayout,
} from '../store/homeRepository.js';
import { safeHref } from '../util.js';
import { createPortal } from 'react-dom';
import { Chip, ChipRow, IconButton, Loading, BlankState, EmptyCta, useSwipe, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import Sheet from '../components/Sheet.jsx';
import Fab, { FabGlyph } from '../components/Fab.jsx';
import { CodexGlyph } from './Codex.jsx';
import { haptic } from '../native.js';
import { launchScanner } from '../cardScanner.js';
import '../theme/dashboard.css';

const BASE = import.meta.env.BASE_URL;

// Compact play-time for a glance tile: "45s" → "12m" → "3h" (details live in Play).
function fmtSpanShort(secs) {
  secs = Math.max(0, Math.round(secs || 0));
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h`;
  if (secs >= 60) return `${Math.floor(secs / 60)}m`;
  return `${secs}s`;
}

export default function Home({ onOpen, ongoing, onResume, onGoTab, onGoLibrary, onAllNotes, onMarginalia, onStartMatch, registerApi, profile, rev, pillSlot }) {
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  // Hardware BACK peels edit mode, then the Overview<->Dashboard subtab, before App
  // falls through to exit. (Dashboard sheets self-register via the Sheet primitive.)
  const editRef = useRef(edit); editRef.current = edit;
  const homeTabRef = useRef(tab); homeTabRef.current = tab;
  useEffect(() => {
    registerApi?.({ back: () => {
      if (editRef.current) { setEdit(false); return true; }
      if (homeTabRef.current === 'dashboard') { setTab('overview'); return true; }
      return false;
    } });
    return () => registerApi?.(null);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Native feel: swipe horizontally between Overview ⇄ Dashboard.
  // Return true when a pane switch is consumed so the app-level pillar swipe doesn't
  // also fire; at an edge return falsy and let the gesture bubble to the next pillar.
  const swipe = useSwipe(
    () => { if (tab === 'overview') { setTab('dashboard'); haptic('light'); return true; } return false; },
    () => { if (tab === 'dashboard') { setTab('overview'); setEdit(false); haptic('light'); return true; } return false; }
  );
  // The top segmented control lives in the shared header slot (App.pillSlot) so it
  // lines up with every other pillar's pills; falls back inline if the slot is absent.
  const pillRow = (
    <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <ChipRow>
        <Chip label="Overview" active={tab === 'overview'} onClick={() => { setTab('overview'); setEdit(false); }} />
        <Chip label="Dashboard" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
      </ChipRow>
      {tab === 'dashboard' && (
        <button onClick={() => setEdit((e) => !e)} style={editBtn}>{edit ? 'Done' : 'Edit'}</button>
      )}
    </div>
  );
  return (
    <div {...swipe} style={{ padding: '6px 20px 26px', animation: 'cxfade .2s ease' }}>
      {pillSlot ? createPortal(pillRow, pillSlot) : pillRow}
      <div key={tab} className="cx-swipe-pane">
        {tab === 'overview'
          ? <Overview onOpen={onOpen} ongoing={ongoing} onResume={onResume} onGoTab={onGoTab} onGoLibrary={onGoLibrary} onAllNotes={onAllNotes} onMarginalia={onMarginalia} onStartMatch={onStartMatch} profile={profile} rev={rev} />
          : <Dashboard onOpen={onOpen} onGoTab={onGoTab} edit={edit} rev={rev} />}
      </div>
      {/* Offline card scanner - hidden in Dashboard edit mode (where the add-widget
          FAB takes the slot). Native only; on web it shows an "installed app" hint. */}
      {!edit && (
        <Fab variant="lib" label="Scan a card" icon={<FabGlyph kind="camera" />}
          onClick={() => launchScanner({ onOpenCard: (id, name) => onOpen('card', id, name) })} />
      )}
    </div>
  );
}

/* ---------------- Overview - the welcome digest ---------------- */
function Overview({ onOpen, ongoing, onResume, onGoTab, onGoLibrary, onAllNotes, onMarginalia, onStartMatch, profile, rev }) {
  const [d, setD] = useState(null);
  // Collapse state persists per profile so a curated Home survives restarts.
  const colKey = `cx-home-collapse:${profile?.id || 'anon'}`;
  const [closed, setClosed] = useState({});
  useEffect(() => { try { setClosed(JSON.parse(localStorage.getItem(colKey) || '{}')); } catch { setClosed({}); } }, [colKey]);
  const toggle = (k) => setClosed((c) => {
    const n = { ...c, [k]: !c[k] };
    try { localStorage.setItem(colKey, JSON.stringify(n)); } catch { /* private mode */ }
    return n;
  });
  useEffect(() => { let a = true; overview().then((x) => a && setD(x)).catch(() => a && setD({ error: true })); return () => { a = false; }; }, [rev]);
  if (!d) return <Loading />;
  if (d.error) return <BlankState hue="201,163,90" title="Couldn't load" body={<>Something went wrong loading your overview.<br />Pull down or reopen to retry.</>} />;

  const g = d.glance, s = d.duels.stats;
  const pct = s.winPct;
  const ring = `conic-gradient(#4db38a 0% ${pct || 0}%, rgba(255,255,255,.07) ${pct || 0}% 100%)`;
  // A brand-new profile with nothing yet gets an orientation line instead of
  // "welcome back" (they've never been here) - says what the app is for.
  const firstRun = g.decks === 0 && g.duels === 0 && g.marginalia === 0 && g.saved === 0;

  const Sec = ({ id, title, count, onAll, children }) => (
    <div className={`cx-ov-sec${closed[id] ? ' closed' : ''}`}>
      <div className="cx-ov-sec-head" onClick={() => toggle(id)} role="button">
        <span className="cx-ov-sec-title">{title}</span>
        {count != null && <span className="cx-ov-sec-count">{count}</span>}
        <span className="cx-ov-sec-spring" />
        {onAll && <span className="cx-ov-sec-all" onClick={(e) => { e.stopPropagation(); onAll(); }}>All<IcoChevR size={12} /></span>}
        <span className="cx-ov-sec-chev"><IcoDown size={13} /></span>
      </div>
      <div className="cx-ov-sec-body">{children}</div>
    </div>
  );
  const Tile = ({ val, lbl, onClick }) => (
    <div className="cx-ov-tile" onClick={onClick} role="button">
      <div className="cx-ov-tile-val">{val}</div>
      <div className="cx-ov-tile-lbl">{lbl}</div>
    </div>
  );

  return (
    <div>
      {ongoing && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <button className="cx-return-btn" onClick={onResume}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polygon points="10 8 16 12 10 16 10 8" /></svg>
            Return to Match<span className="cx-live-dot" />
          </button>
        </div>
      )}

      {/* Welcome + at-a-glance doorway tiles: each opens the pillar it counts. */}
      <div className="cx-ov-greet">
        <div className="cx-ov-greet-eyebrow">{firstRun ? 'WELCOME' : 'WELCOME BACK'}</div>
        <div className="cx-ov-greet-name">{profile?.name || 'Sorcerer'}</div>
        {firstRun && (
          <div style={{ font: "400 14px/1.55 var(--f-read)", color: 'var(--ink-muted)', marginTop: 9, maxWidth: 340 }}>
            Your offline companion for <b style={{ color: 'var(--ink-body-2)' }}>Sorcery: Contested Realm</b> - build decks, track life in a duel, and keep every card and ruling at hand. Start below.
          </div>
        )}
      </div>
      {onStartMatch && (
        <div style={{ display: 'flex', gap: 10, margin: '16px 0 20px' }}>
          <button onClick={() => onStartMatch('full')} style={{ ...BTN_GOLD, flex: 1, padding: '13px 0' }}>Start Match</button>
          <button onClick={() => onStartMatch('quick')} style={{ ...BTN_GHOST, flex: 1, padding: '13px 0' }}>Quick Match</button>
        </div>
      )}
      <div className="cx-ov-glance">
        <Tile val={g.marginalia} lbl="MARGINALIA" onClick={onMarginalia} />
        <Tile val={g.decks} lbl="DECKS" onClick={onGoLibrary} />
        <Tile val={g.duels} lbl="MATCHES" onClick={() => onGoTab('play')} />
        <Tile val={fmtSpanShort(s.totalSec)} lbl="TIME PLAYED" onClick={() => onGoTab('play')} />
      </div>

      {d.resume && (
        <div onClick={() => onOpen(d.resume.target_type, d.resume.target_id, d.resume.title)} className="cx-row"
          style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid var(--hair-20,rgba(201,163,90,.2))', borderRadius: 16, padding: 14, background: 'linear-gradient(180deg,rgba(42,31,19,.6),rgba(26,19,13,.3))', marginBottom: 24, cursor: 'pointer' }}>
          {/* icon reflects what you're jumping back into: card / article / deck */}
          <span style={{ width: 42, height: 42, flex: 'none', borderRadius: 12, border: '1px solid var(--hair-22)', background: 'rgba(0,0,0,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold-leaf)' }}>
            <CodexGlyph kind={d.resume.target_type} size={21} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.16em', color: 'var(--ink-muted)' }}>JUMP BACK IN</div>
            <div style={{ font: "600 16px/1.1 var(--f-read)", color: 'var(--ink-body)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.resume.title}</div>
          </div>
        </div>
      )}

      <Sec id="decks" title="YOUR DECKS" count={d.decks.total} onAll={onGoLibrary}>
        {d.decks.items.length === 0 ? <EmptyCta text="No decks yet." cta="Build your first deck" onClick={onGoLibrary} /> : (
          <div className="cx-deck-carousel">
            {d.decks.items.map((dk) => (
              <div key={dk.id} className="cx-deck-card" onClick={() => onOpen('deck', dk.id, dk.name)}>
                {dk.avatar?.image_slug && <img className="cx-deck-card-bg" src={`${BASE}cards/${dk.avatar.image_slug}`} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                <div className="cx-deck-card-grad" />
                <div className="cx-deck-card-info">
                  <div className="cx-deck-card-name">{dk.name}</div>
                  <div className="cx-deck-card-sub">
                    {(dk.elems || []).map((e) => <img key={e.el} src={`${BASE}icons/${e.el}.png`} alt={e.el} />)}
                    <span>{dk.wins}W – {dk.losses}L</span>
                  </div>
                </div>
              </div>
            ))}
            {d.decks.total > d.decks.items.length && (
              <div className="cx-deck-card cx-deck-card-all" onClick={onGoLibrary}>
                <span>All {d.decks.total} decks ›</span>
              </div>
            )}
          </div>
        )}
      </Sec>

      <Sec id="duels" title="RECENT MATCHES" count={s.total} onAll={() => onGoTab('play')}>
        {s.total === 0 ? <EmptyCta text="No matches yet." cta="Start a match" onClick={() => onGoTab('play')} /> : (
          <>
            <div className="cx-ov-rec" onClick={() => onGoTab('play')} role="button">
              <div className="cx-ov-ring" style={{ background: ring }}>
                <div className="cx-ov-ring-inner">{pct != null ? pct + '%' : '-'}</div>
              </div>
              <div className="cx-ov-rec-right">
                <div className="cx-ov-rec-wl">{s.wins}–{s.losses}</div>
                <div className="cx-ov-rec-sub">{s.total} PLAYED{s.streak > 0 ? ` · ${s.streak} WIN STREAK` : ''}</div>
                <div className="cx-ov-pips">
                  {s.last8.map((r, i) => <span key={i} className={`cx-ov-pip${r === 'W' ? ' w' : r === 'L' ? ' l' : ''}`} />)}
                </div>
              </div>
            </div>
            {d.duels.items.map((m, i) => (
              <div key={i} className="cx-ov-duel" onClick={() => onGoTab('play')} role="button">
                <span className="cx-ov-duel-badge" style={{ color: m.won ? 'var(--accent-jade)' : m.draw ? 'var(--ink-muted)' : '#c98f8f' }}>{m.won ? 'W' : m.draw ? 'D' : 'L'}</span>
                <span className="cx-ov-duel-name">{m.name}</span>
                {m.deck && <span className="cx-ov-duel-deck"><CodexGlyph kind="deck" size={11} /><span>{m.deck}</span></span>}
                <span className="cx-ov-duel-score">{m.score}</span>
              </div>
            ))}
          </>
        )}
      </Sec>

      <Sec id="bookmarks" title="BOOKMARKS" count={d.bookmarks?.count || 0} onAll={onMarginalia}>
        {(!d.bookmarks || d.bookmarks.items.length === 0) ? <EmptyCta text="No bookmarks yet." cta="Bookmark a rule or card" onClick={() => onGoTab('codex')} /> : (
          d.bookmarks.items.map((b, i) => {
            const hue = b.type === 'card' ? 'var(--link-violet)' : b.type === 'deck' ? 'var(--accent-violet)' : 'var(--gold-leaf)';
            return (
              <div key={i} onClick={() => onOpen(b.type, b.id, b.name)} className="cx-row"
                style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(18,16,13,.72)', border: '1px solid rgba(220,184,111,.2)', borderRadius: 12, padding: '11px 14px', marginBottom: 10, cursor: 'pointer' }}>
                <span style={{ color: hue, flex: 'none', display: 'flex' }}><CodexGlyph kind={b.type} size={15} /></span>
                <span style={{ flex: 1, minWidth: 0, font: "600 15px/1.2 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                {b.meta && <span style={{ font: "500 11px/1 var(--f-ui)", color: 'var(--ink-muted)', flex: 'none' }}>{b.meta}</span>}
              </div>
            );
          })
        )}
      </Sec>

      <Sec id="notes" title="NOTES & RULINGS" count={d.notes.count} onAll={onAllNotes}>
        {d.notes.items.length === 0 ? <EmptyCta text="No marginalia yet." cta="Annotate anything in the Codex" onClick={() => onGoTab('codex')} /> : (
          // Same card as Codex > Marginalia: the PLACE leads (icon + name + type,
          // hued card-violet / article-gold), then the note body upright beneath.
          d.notes.items.map((n, i) => {
            const isCard = n.type === 'card';
            const hue = isCard ? 'var(--link-violet)' : 'var(--gold-leaf)';
            return (
              <div key={i} onClick={() => onOpen(n.type, n.id, n.on)} className="cx-row"
                style={{ background: 'rgba(18,16,13,.72)', border: '1px solid rgba(220,184,111,.2)', borderRadius: 12, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.03)', padding: '11px 14px 12px', marginBottom: 10, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <span style={{ color: hue, flex: 'none', display: 'flex' }}><CodexGlyph kind={n.type} size={14} /></span>
                  <span style={{ font: "600 15px/1.2 var(--f-read)", color: 'var(--ink-body)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.on}</span>
                  <span style={{ font: "600 9px/1 var(--f-ui)", letterSpacing: '.1em', color: hue, flex: 'none' }}>{isCard ? 'CARD' : 'ARTICLE'}</span>
                </div>
                <div style={{ font: "400 14px/1.5 var(--f-read)", color: 'var(--ink-body-2)' }}>{n.body}</div>
              </div>
            );
          })
        )}
      </Sec>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ onOpen, onGoTab, edit, rev }) {
  const [blocks, setBlocks] = useState(null);
  const [data, setData] = useState({});
  const [picker, setPicker] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [layoutSheet, setLayoutSheet] = useState(false);
  const [layouts, setLayouts] = useState([]);
  const [dragId, setDragId] = useState(null);

  const blocksRef = useRef([]);
  useEffect(() => { blocksRef.current = blocks || []; }, [blocks]);

  async function load() {
    const bs = await listBlocks();
    setBlocks(bs);
    const d = {};
    for (const b of bs) d[b.id] = await widgetData(b);
    setData(d);
  }
  const refreshLayouts = () => listLayouts().then(setLayouts);
  // Re-roll a single widget (Random Card / Random Article) without reloading all.
  const roll = async (b) => { const d = await widgetData(b); setData((prev) => ({ ...prev, [b.id]: d })); haptic('light'); };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rev]);
  // The add-widget FAB is an edit-mode tool; leaving edit closes the picker too.
  useEffect(() => { if (!edit) setPicker(false); }, [edit]);

  // ── Long-press drag-to-reorder (edit mode). Hold a card still for ~300ms to
  // pick it up (haptic), then drag it over another card to swap positions; the
  // grid reorders live and persists on drop. Moving before the hold fires just
  // scrolls (the press is cancelled). ──
  const pd = useRef({ id: null, active: false, sx: 0, sy: 0, el: null, pid: 0, timer: null });
  function pdDown(e, id) {
    if (!edit) return;
    const d = pd.current;
    d.id = id; d.active = false; d.sx = e.clientX; d.sy = e.clientY; d.el = e.currentTarget; d.pid = e.pointerId;
    if (d.timer) clearTimeout(d.timer);
    d.timer = setTimeout(() => { d.active = true; d.timer = null; try { d.el.setPointerCapture(d.pid); } catch { /* noop */ } setDragId(id); haptic('medium'); }, 300);
  }
  function pdMove(e) {
    const d = pd.current;
    if (!d.id) return;
    if (!d.active) {
      if (Math.abs(e.clientX - d.sx) > 12 || Math.abs(e.clientY - d.sy) > 12) { clearTimeout(d.timer); d.timer = null; d.id = null; }
      return;
    }
    e.preventDefault();
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const slot = t && t.closest('[data-block-id]');
    const overId = slot && slot.getAttribute('data-block-id');
    if (overId && overId !== d.id) {
      setBlocks((prev) => {
        const arr = [...prev];
        const from = arr.findIndex((b) => b.id === d.id);
        const to = arr.findIndex((b) => b.id === overId);
        if (from < 0 || to < 0) return prev;
        const [m] = arr.splice(from, 1); arr.splice(to, 0, m);
        return arr;
      });
    }
  }
  function pdUp() {
    const d = pd.current;
    if (d.timer) { clearTimeout(d.timer); d.timer = null; }
    const wasActive = d.active;
    try { if (d.el && d.pid != null) d.el.releasePointerCapture(d.pid); } catch { /* noop */ }
    d.id = null; d.active = false; d.el = null;
    setDragId(null);
    if (wasActive) { reorderBlocks(blocksRef.current.map((b) => b.id)); haptic('light'); }
  }

  if (!blocks) return <Loading />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={() => { setLayoutSheet(true); refreshLayouts(); }} className="dw-toolbtn"><IcoLayers size={13} />Layouts</button>
      </div>
      {blocks.length === 0 && (
        <div className="dw-empty" style={{ textAlign: 'center', padding: '34px 12px' }}>
          A blank canvas. Tap <b style={{ color: 'var(--gold-leaf)', fontStyle: 'normal' }}>{edit ? '+' : 'Edit'}</b>{edit ? '' : ', then +,'} to add your first widget.
        </div>
      )}
      {edit && blocks.length > 1 && (
        <div className="dw-edithint">Hold a card to pick it up, then drag to reorder.</div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        {blocks.map((b) => {
          const full = b.width === 'full' || isStructural(b.type);
          const common = {
            block: b, edit,
            onResize: async () => { await resizeBlock(b.id, b.width === 'full' ? 'half' : 'full'); load(); },
            onRemove: async () => { await removeBlock(b.id); haptic('light'); load(); },
            onConfig: () => setCfg(b),
          };
          return (
            <div key={b.id} data-block-id={b.id}
              className={`dw-slot${edit ? ' editing' : ''}${dragId === b.id ? ' dragging' : ''}`}
              onPointerDown={(e) => pdDown(e, b.id)} onPointerMove={pdMove} onPointerUp={pdUp} onPointerCancel={pdUp}
              style={{ width: full ? '100%' : 'calc(50% - 6px)' }}>
              {isStructural(b.type)
                ? <StructuralBlock {...common} />
                : <WidgetFrame {...common} data={data[b.id]} onOpen={onOpen} onGoTab={onGoTab} onRoll={() => roll(b)} />}
            </div>
          );
        })}
      </div>

      {/* The Dashboard's own FAB - a plain "+" that adds a widget. Edit-mode only. */}
      {edit && <Fab variant="lib" active={picker} icon={<FabGlyph kind="add" />} label="Add a widget" onClick={() => setPicker((p) => !p)} />}

      <Picker open={picker} onClose={() => setPicker(false)} onPick={async (k) => { await addBlock(k); setPicker(false); haptic('light'); load(); }} />
      <ConfigSheet block={cfg} onClose={() => setCfg(null)} onSaved={() => { setCfg(null); load(); }} />
      <LayoutSheet open={layoutSheet} layouts={layouts} onClose={() => setLayoutSheet(false)}
        onSave={async (name) => { await saveLayout(name); refreshLayouts(); }}
        onLoad={async (id) => { await loadLayout(id); setLayoutSheet(false); load(); }}
        onDelete={async (id) => { await deleteLayout(id); refreshLayouts(); }} />
    </div>
  );
}

function LayoutSheet({ open, layouts, onClose, onSave, onLoad, onDelete }) {
  const [name, setName] = useState('');
  return (
    <Sheet open={open} title="Dashboard Layouts" onClose={onClose}>
      <div style={{ padding: '0 16px' }}>
      <div style={{ font: "400 12px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 12 }}>
        Save the current dashboard as a named layout, or load one (loading replaces the current widgets).
      </div>
      {layouts.length === 0 ? <div style={{ font: "400 13px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 10 }}>No saved layouts yet.</div>
        : layouts.map((l) => (
          <div key={l.id} className="cx-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 4px', borderBottom: '1px solid var(--hair-12)' }}>
            <span onClick={() => onLoad(l.id)} style={{ flex: 1, font: "600 15px/1 var(--f-read)", color: 'var(--ink-body)', cursor: 'pointer' }}>{l.name}</span>
            <IconButton glyph="✕" tone="danger" size={24} onClick={() => onDelete(l.id)} />
          </div>
        ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this layout…" style={{ flex: 1, height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)" }} />
        <button onClick={() => { if (name.trim()) { onSave(name.trim()); setName(''); } }} style={{ padding: '0 18px', borderRadius: 12, background: 'rgba(18,16,13,.85)', color: 'var(--gold-leaf)', font: "700 13px/1 var(--f-ui)", border: '1px solid rgba(220,184,111,.45)', cursor: 'pointer' }}>Save</button>
      </div>
      </div>
    </Sheet>
  );
}

// Edit controls live in a bar along the BOTTOM edge of the card, so picking a
// card up never hides its title. stopPropagation on pointerdown so tapping a
// control doesn't start a drag. Reordering is by long-press drag, not arrows.
const EditBar = ({ block, onResize, onConfig, onRemove }) => (
  <div className="dw-editbar" onPointerDown={(e) => e.stopPropagation()}>
    {!isStructural(block.type) && (
      <button className="dw-mini" onClick={onResize} aria-label={block.width === 'full' ? 'Make half width' : 'Make full width'}>{block.width === 'full' ? <IcoShrink size={13} /> : <IcoExpand size={13} />}</button>
    )}
    {(block.type !== 'separator') && <button className="dw-mini" onClick={onConfig} aria-label="Rename or configure"><IcoEdit size={13} /></button>}
    <button className="dw-mini danger" onClick={onRemove} aria-label="Remove"><IcoClose size={13} /></button>
  </div>
);

function WidgetFrame({ block, data, edit, onOpen, onGoTab, onRoll, onResize, onRemove, onConfig, preview }) {
  const meta = widgetMeta(block.type);
  const title = block.config?.name || meta.title;
  return (
    <div className="dw" data-pillar={pillarOf(block.type) || undefined}>
      <div className="dw-head">
        <span className="dw-title">{title}</span>
        {!edit && data?.count != null && <span className="dw-count">{data.count}</span>}
        {!edit && !preview && isRollable(block.type) && (
          <button className="dw-roll" onClick={onRoll} aria-label="Roll again"><IcoRoll size={12} />Roll</button>
        )}
      </div>
      <div className="dw-body"><WidgetBody block={block} data={data} onOpen={onOpen} onGoTab={onGoTab} preview={preview} /></div>
      {edit && <EditBar block={block} onResize={onResize} onConfig={onConfig} onRemove={onRemove} />}
    </div>
  );
}

// Chrome-less layout furniture (Title / Separator). The edit controls sit in the
// same bottom bar so the block stays readable while being arranged.
function StructuralBlock({ block, edit, onResize, onRemove, onConfig }) {
  return (
    <div className={`dw-struct${edit ? ' editing' : ''}`}>
      {block.type === 'title'
        ? <div className="dw-titlecard"><span className="t">{block.config?.name || 'Title'}</span></div>
        : <div className="dw-sep"><span className="ln" /><span className="dia" /><span className="ln" /></div>}
      {edit && <EditBar block={block} onResize={onResize} onConfig={onConfig} onRemove={onRemove} />}
    </div>
  );
}

// Full-bleed card/deck art with a graceful placeholder card-shape behind it - if
// the image is absent (or fails to load, or we're in a preview) the neutral card
// silhouette shows instead. No glyphs.
function ArtHero({ image, name, sub, badge, onClick, tall, deck }) {
  return (
    <div className={`dw-hero${tall ? ' tall' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="dw-cardph" />
      {image && <img className="dw-hero-img" src={`${BASE}cards/${image}`} alt="" loading="lazy" onError={hideImg} />}
      <div className="dw-hero-grad" />
      {badge && <span className="dw-hero-badge">{badge}</span>}
      <div className="dw-hero-info">
        <div className="dw-hero-name">{name}</div>
        {sub && <div className="dw-hero-sub">{sub}</div>}
      </div>
    </div>
  );
}

function WidgetBody({ block, data, onOpen, onGoTab, preview }) {
  const k = block.type;
  if (!data) return null;
  const empty = (t) => <div className="dw-empty">{t}</div>;
  const open = preview ? () => {} : (onOpen || (() => {}));
  const go = preview ? () => {} : (onGoTab || (() => {}));

  if (k === 'featuredCard' || k === 'cardOfDay') return data.card
    ? <ArtHero image={preview ? null : data.card.image} name={data.card.name}
        badge={k === 'cardOfDay' ? 'CARD OF THE DAY' : (data.card.rarity ? data.card.rarity.toUpperCase() : null)}
        sub={`${data.card.type || 'Card'}${data.card.cost != null ? ` · ${data.card.cost} mana` : ''}`}
        tall={block.width !== 'full'} onClick={() => open('card', data.card.id, data.card.name)} />
    : empty(data.empty);

  if (k === 'deckSpotlight') return data.spotlight
    ? <ArtHero image={preview ? null : data.spotlight.image} name={data.spotlight.name} deck tall={block.width !== 'full'}
        sub={<>{(data.spotlight.elems || []).map((e, i) => <img key={i} src={`${BASE}icons/${e.el}.png`} alt="" onError={hideImg} />)}<span>{data.spotlight.record}{data.spotlight.winPct != null ? ` · ${data.spotlight.winPct}%` : ''}</span></>}
        onClick={() => open('deck', data.spotlight.id, data.spotlight.name)} />
    : empty(data.empty);

  if (k === 'yourDecks') return data.decks?.length
    ? <div className="dw-decks">{data.decks.map((d, i) => (
        <div key={i} className="dw-deckcard" onClick={() => open('deck', d.id, d.name)}>
          {!preview && d.image ? <img src={`${BASE}cards/${d.image}`} alt="" loading="lazy" onError={hideImg} /> : <div className="dw-deckph" />}
          <div className="g" /><div className="n">{d.name}</div><div className="r">{d.record}</div>
        </div>))}</div>
    : empty(data.empty);

  if (k === 'winRate') {
    if (!data.total) return empty(data.empty);
    const pct = data.winPct;
    const ring = `conic-gradient(var(--accent-jade) 0% ${pct || 0}%, rgba(255,255,255,.08) ${pct || 0}% 100%)`;
    return (
      <div className="dw-ring-wrap" onClick={() => go('play')} style={{ cursor: 'pointer' }}>
        <div className="dw-ring" style={{ background: ring }}><div className="dw-ring-inner">{pct != null ? pct + '%' : '-'}</div></div>
        <div className="dw-ring-side">
          <div className="dw-ring-wl">{data.wins}–{data.losses}</div>
          <div className="dw-ring-sub">{data.total} PLAYED{data.streak > 0 ? ` · ${data.streak} STREAK` : ''}</div>
          <div className="dw-pips">{(data.last8 || []).map((r, i) => <span key={i} className={`dw-pip${r === 'W' ? ' w' : r === 'L' ? ' l' : ''}`} />)}</div>
        </div>
      </div>
    );
  }

  if (k === 'recentMatches') return data.items?.length
    ? data.items.slice(0, 5).map((m, i) => (
        <div key={i} className="dw-row tap" onClick={() => go('play')}>
          <span className="gl" style={{ color: m.won ? 'var(--accent-jade)' : m.draw ? 'var(--ink-muted)' : '#c98f8f' }}>{m.won ? 'W' : m.draw ? 'D' : 'L'}</span>
          <span className="nm">{m.name}</span><span className="mt">{m.score}</span>
        </div>))
    : empty(data.empty);

  if (k === 'nemesis') return data.items?.length
    ? data.items.slice(0, 5).map((n, i) => { const tot = (n.w + n.l) || 1; return (
        <div key={i} className="dw-nem">
          <span className="nm">{n.name}</span>
          <span className="bar"><i style={{ width: `${(n.w / tot) * 100}%` }} /></span>
          <span className="wl">{n.w}–{n.l}</span>
        </div>); })
    : empty(data.empty);

  if (k === 'randomRule') return data.rule
    ? <div className="dw-row tap" onClick={() => open('rule', data.rule.id, data.rule.name)}><span className="gl"><RowIcon t="rule" /></span><span className="nm">{data.rule.name}</span></div>
    : empty(data.empty || 'No articles found.');

  if (k === 'note') return <div className="dw-note">{data.text || 'Empty note - open Edit to write.'}</div>;

  if (k === 'links') return data.links?.length
    ? data.links.map((l, i) => { const href = safeHref(l.url); return href
        ? <a key={i} className="dw-link" href={preview ? undefined : href} target="_blank" rel="noreferrer" onClick={preview ? (e) => e.preventDefault() : undefined}><IcoExternal size={13} />{l.label || l.url}</a>
        : <div key={i} className="dw-link" style={{ color: 'var(--ink-faint)' }}><IcoExternal size={13} />{l.label || l.url}</div>; })
    : empty('No links - open Edit to add.');

  if (data.quotes) return data.items?.length
    ? data.items.slice(0, 3).map((n, i) => <div key={i} className="dw-quote" onClick={() => open(n.type, n.id, n.on)}>“{n.body}”{n.on && <span className="on">{k === 'highlights' ? n.on : `on ${n.on}`}</span>}</div>)
    : empty(data.empty);

  if (k === 'collectionStats') {
    if (!data.owned && !data.unique && !data.wishlist) return empty(data.empty);
    const cell = (v, l) => <div className="dw-cstat"><div className="v">{v}</div><div className="l">{l}</div></div>;
    return (
      <div className="dw-cstats" onClick={() => go('collect')} style={{ cursor: 'pointer' }}>
        {cell(data.owned, 'OWNED')}{cell(data.unique, 'UNIQUE')}{cell(data.wishlist, 'WISHLIST')}{cell(`${data.buildable}/${data.decks}`, 'BUILDABLE')}
      </div>
    );
  }

  // list widgets - pinned, collections
  return data.items?.length
    ? data.items.slice(0, 5).map((it, i) => (
        <div key={i} className={`dw-row${it.type ? ' tap' : ''}`} onClick={it.type ? () => open(it.type, it.id, it.name) : undefined}>
          <span className="gl"><RowIcon t={it.type || it.iconType} /></span><span className="nm">{it.name}</span>{it.meta && <span className="mt">{it.meta}</span>}
        </div>))
    : empty(data.empty || '-');
}

// The Add-a-widget sheet renders a LIVE mini-preview of each widget (fed
// representative sample data + a few real card images), not just a name tile.
function Picker({ open, onClose, onPick }) {
  return (
    <Sheet open={open} title="Add a Widget" onClose={onClose}>
      <div className="dw-picker">
        <div style={{ font: "400 12px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', margin: '0 0 14px' }}>
          Tap a widget to add it. Resize, reorder and rename anything once it’s on your dashboard.
        </div>
        <div className="dw-picker-grid">
          {WIDGETS.map((w) => {
            const sample = { id: 'preview', type: w.kind, width: w.structural ? 'full' : 'half', config: {} };
            return (
              <button key={w.kind} className="dw-pick" onClick={() => onPick(w.kind)}>
                <div className={`dw-pick-preview${w.structural ? ' short' : ''}`}>
                  {w.kind === 'title'
                    ? <div className="dw"><div className="dw-body"><div className="dw-titlecard"><span className="t">My Layout</span></div></div></div>
                    : w.kind === 'separator'
                      ? <div className="dw"><div className="dw-body"><div className="dw-sep"><span className="ln" /><span className="dia" /><span className="ln" /></div></div></div>
                      : <WidgetFrame block={sample} data={sampleData(w.kind)} edit={false} preview onOpen={() => {}} onGoTab={() => {}} />}
                </div>
                <div className="dw-pick-foot">
                  <span className={`pl ${w.pillar || ''}`} />
                  <span className="nm">{w.title}</span>
                  <IcoPlus size={15} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}

// One sheet for both renaming (every widget) and per-kind settings (Note text,
// Links list, Title text). config.name is the rename override the frame prefers.
function ConfigSheet({ block, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [links, setLinks] = useState([]);
  useEffect(() => {
    if (!block) return;
    setName(block.config?.name || '');
    setText(block.config?.text || '');
    setLinks(block.config?.links || []);
  }, [block]);
  if (!block) return null;
  const meta = widgetMeta(block.type);
  const isTitle = block.type === 'title';
  const save = () => {
    const extra = block.type === 'note' ? { text } : block.type === 'links' ? { links: links.filter((l) => l.url || l.label) } : {};
    setConfig(block.id, { ...block.config, name: name.trim() || undefined, ...extra }).then(onSaved);
  };
  return (
    <Sheet open={!!block} title={isTitle ? 'Title' : `Configure · ${meta.title}`} onClose={onClose}>
      <div style={{ padding: '0 16px' }}>
        <Lbl2 t={isTitle ? 'TITLE TEXT' : 'WIDGET NAME'} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isTitle ? 'Section title…' : meta.title} style={cfgInputFull} />
        {block.type === 'note' && (
          <>
            <Lbl2 t="TEXT" />
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note…" style={{ ...cfgInputFull, height: 120, padding: 12, resize: 'none' }} />
          </>
        )}
        {block.type === 'links' && (
          <>
            <Lbl2 t="LINKS" />
            {links.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input value={l.label} onChange={(e) => setLinks(links.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" style={cfgInput} />
                <input value={l.url} onChange={(e) => setLinks(links.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" style={cfgInput} />
                <IconButton glyph="✕" tone="danger" size={28} onClick={() => setLinks(links.filter((_, j) => j !== i))} />
              </div>
            ))}
            <button onClick={() => setLinks([...links, { label: '', url: '' }])} style={{ ...ghostBtn, width: '100%', marginBottom: 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><IcoPlus size={13} />Add link</button>
            <div style={{ font: "400 11px/1.4 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', marginTop: 6 }}>Only http(s) links are kept.</div>
          </>
        )}
        <button onClick={save} style={goldBtn}>Save</button>
      </div>
    </Sheet>
  );
}

const Lbl2 = ({ t }) => <div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.14em', color: 'var(--ink-muted)', margin: '16px 0 8px' }}>{t}</div>;
const editBtn = { padding: '7px 16px', borderRadius: 18, border: '1px solid var(--hair-30)', background: 'transparent', color: 'var(--gold-leaf)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' };
const goldBtn = { ...BTN_GOLD, width: '100%', marginTop: 18, padding: '12px 0', flex: undefined };
const ghostBtn = { ...BTN_GHOST, padding: '11px 0', font: "600 12px/1 var(--f-ui)" };
const cfgInput = { flex: 1, minWidth: 0, height: 40, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 10, padding: '0 10px', color: 'var(--ink-body)', font: "400 13px/1 var(--f-read)" };
const cfgInputFull = { width: '100%', height: 44, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: '0 14px', color: 'var(--ink-body)', font: "400 15px/1 var(--f-read)", boxSizing: 'border-box' };
const hideImg = (e) => { e.currentTarget.style.display = 'none'; };

// House SVG icons for the dashboard - no Unicode glyphs anywhere in the widgets.
const Svg = ({ children, size = 13, fill = 'none', ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>
);
const IcoUp = (p) => <Svg {...p}><polyline points="18 15 12 9 6 15" /></Svg>;
const IcoDown = (p) => <Svg {...p}><polyline points="6 9 12 15 18 9" /></Svg>;
const IcoChevR = (p) => <Svg {...p}><polyline points="9 18 15 12 9 6" /></Svg>;
const IcoExpand = (p) => <Svg {...p}><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></Svg>;
const IcoShrink = (p) => <Svg {...p}><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></Svg>;
const IcoEdit = (p) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>;
const IcoClose = (p) => <Svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>;
const IcoPlus = (p) => <Svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;
const IcoLayers = (p) => <Svg {...p}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></Svg>;
const IcoExternal = (p) => <Svg {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></Svg>;
const IcoRoll = (p) => <Svg {...p}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></Svg>;
// List-row markers reuse the shared entity-icon set (CodexGlyph): card / rule /
// deck read the same everywhere. Collections keep their bookmark shape.
const RowIcon = ({ t }) => t === 'collection'
  ? <Svg size={13}><path d="M4 4h16v14l-8-4-8 4Z" /></Svg>
  : <CodexGlyph kind={t === 'deck' ? 'deck' : t === 'rule' ? 'rule' : 'card'} size={13} />;
