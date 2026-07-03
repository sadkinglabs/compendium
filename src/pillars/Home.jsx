// Home — Overview (the WELCOME screen: greeting, at-a-glance doorway tiles,
// capped deck rail / duel digest / notes) and the customisable Dashboard
// (all widget kinds, edit mode: resize ½/full, move, remove, add, configure).
// Overview is scale-safe by design: every section is hard-capped, collapsible,
// and redirects to the pillar where the items actually live — the Dashboard
// is where users compose their own deeper view.
import React, { useEffect, useState } from 'react';
import {
  listBlocks, addBlock, removeBlock, resizeBlock, moveBlock, setConfig,
  widgetData, widgetTitle, widgetMeta, isConfigurable, isStructural, pillarOf,
  sampleData, pickerSamples, overview, WIDGETS,
  saveLayout, listLayouts, loadLayout, deleteLayout,
} from '../store/homeRepository.js';
import { safeHref } from '../util.js';
import { Chip, ChipRow, IconButton, Loading, useSwipe, BTN_GOLD, BTN_GHOST } from '../components/ui.jsx';
import Sheet from '../components/Sheet.jsx';
import { haptic } from '../native.js';
import '../theme/dashboard.css';

const BASE = import.meta.env.BASE_URL;

export default function Home({ onOpen, ongoing, onResume, onGoTab, onAllNotes, profile, rev }) {
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  // Native feel: swipe horizontally between Overview ⇄ Dashboard.
  const swipe = useSwipe(
    () => { if (tab === 'overview') { setTab('dashboard'); haptic('light'); } },
    () => { if (tab === 'dashboard') { setTab('overview'); setEdit(false); haptic('light'); } }
  );
  return (
    <div {...swipe} style={{ padding: '6px 20px 26px', animation: 'cxfade .2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <ChipRow>
          <Chip label="Overview" active={tab === 'overview'} onClick={() => { setTab('overview'); setEdit(false); }} />
          <Chip label="Dashboard" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
        </ChipRow>
        {tab === 'dashboard' && (
          <button onClick={() => setEdit((e) => !e)} style={editBtn}>{edit ? 'Done' : 'Edit'}</button>
        )}
      </div>
      <div key={tab} className="cx-swipe-pane">
        {tab === 'overview'
          ? <Overview onOpen={onOpen} ongoing={ongoing} onResume={onResume} onGoTab={onGoTab} onAllNotes={onAllNotes} profile={profile} rev={rev} />
          : <Dashboard onOpen={onOpen} onGoTab={onGoTab} edit={edit} rev={rev} />}
      </div>
    </div>
  );
}

/* ---------------- Overview — the welcome digest ---------------- */
function Overview({ onOpen, ongoing, onResume, onGoTab, onAllNotes, profile, rev }) {
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
  useEffect(() => { let a = true; overview().then((x) => a && setD(x)); return () => { a = false; }; }, [rev]);
  if (!d) return <Loading />;

  const g = d.glance, s = d.duels.stats;
  const pct = s.winPct;
  const ring = `conic-gradient(#4db38a 0% ${pct || 0}%, rgba(255,255,255,.07) ${pct || 0}% 100%)`;
  // A brand-new profile with nothing yet gets an orientation line instead of
  // "welcome back" (they've never been here) — says what the app is for.
  const firstRun = g.decks === 0 && g.duels === 0 && g.marginalia === 0 && g.saved === 0;

  const Sec = ({ id, title, count, onAll, children }) => (
    <div className={`cx-ov-sec${closed[id] ? ' closed' : ''}`}>
      <div className="cx-ov-sec-head" onClick={() => toggle(id)} role="button">
        <span className="cx-ov-sec-title">{title}</span>
        {count != null && <span className="cx-ov-sec-count">{count}</span>}
        <span className="cx-ov-sec-spring" />
        {onAll && <span className="cx-ov-sec-all" onClick={(e) => { e.stopPropagation(); onAll(); }}>All ›</span>}
        <span className="cx-ov-sec-chev">▼</span>
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
  const EmptyCta = ({ text, cta, onClick }) => (
    <div style={{ font: "400 13px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '4px 0' }}>
      {text}{' '}
      <span onClick={onClick} style={{ color: 'var(--gold-leaf)', fontStyle: 'normal', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' }}>{cta} ›</span>
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
            Your offline companion for <b style={{ color: 'var(--ink-body-2)' }}>Sorcery: Contested Realm</b> — build decks, track life in a duel, and keep every card and ruling at hand. Start below.
          </div>
        )}
      </div>
      <div className="cx-ov-glance">
        <Tile val={g.decks} lbl="DECKS" onClick={() => onGoTab('decks')} />
        <Tile val={g.duels} lbl="MATCHES" onClick={() => onGoTab('play')} />
        <Tile val={pct != null ? pct + '%' : '—'} lbl="WIN RATE" onClick={() => onGoTab('play')} />
        <Tile val={g.marginalia} lbl="MARGINALIA" onClick={onAllNotes} />
      </div>

      {d.resume && (
        <div onClick={() => onOpen(d.resume.target_type, d.resume.target_id, d.resume.title)} className="cx-row"
          style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid var(--hair-20,rgba(201,163,90,.2))', borderRadius: 16, padding: 14, background: 'linear-gradient(180deg,rgba(42,31,19,.6),rgba(26,19,13,.3))', marginBottom: 24, cursor: 'pointer' }}>
          <div><div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.16em', color: 'var(--ink-muted)' }}>JUMP BACK IN</div>
            <div style={{ font: "600 16px/1.1 var(--f-read)", color: 'var(--ink-body)', marginTop: 5 }}>{d.resume.title}</div></div>
        </div>
      )}

      <Sec id="decks" title="YOUR DECKS" count={d.decks.total} onAll={() => onGoTab('decks')}>
        {d.decks.items.length === 0 ? <EmptyCta text="No decks yet." cta="Build your first deck" onClick={() => onGoTab('decks')} /> : (
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
              <div className="cx-deck-card cx-deck-card-all" onClick={() => onGoTab('decks')}>
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
                <div className="cx-ov-ring-inner">{pct != null ? pct + '%' : '—'}</div>
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
                {m.deck && <span className="cx-ov-duel-deck">◈ {m.deck}</span>}
                <span className="cx-ov-duel-score">{m.score}</span>
              </div>
            ))}
          </>
        )}
      </Sec>

      <Sec id="notes" title="NOTES & RULINGS" count={d.notes.count} onAll={onAllNotes}>
        {d.notes.items.length === 0 ? <EmptyCta text="No marginalia yet." cta="Annotate anything in the Codex" onClick={() => onGoTab('codex')} /> : (
          d.notes.items.map((n, i) => (
            <div key={i} onClick={() => onOpen(n.type, n.id, n.on)} className="cx-row" style={{ borderLeft: '2px solid var(--gold)', background: 'rgba(201,163,90,.06)', borderRadius: '0 10px 10px 0', padding: '10px 12px', marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ font: "400 14px/1.45 var(--f-read)", color: 'var(--ink-body)', fontStyle: 'italic' }}>{n.body}</div>
              {n.on && <div style={{ font: "500 10px/1 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 5 }}>on {n.on}</div>}
            </div>
          ))
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

  async function load() {
    const bs = await listBlocks();
    setBlocks(bs);
    const d = {};
    for (const b of bs) d[b.id] = await widgetData(b);
    setData(d);
  }
  const refreshLayouts = () => listLayouts().then(setLayouts);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rev]);
  if (!blocks) return <Loading />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={() => { setLayoutSheet(true); refreshLayouts(); }} className="dw-toolbtn">⧉ Layouts</button>
      </div>
      {blocks.length === 0 && (
        <div className="dw-empty" style={{ textAlign: 'center', padding: '34px 12px' }}>
          A blank canvas. Tap <b style={{ color: 'var(--gold-leaf)', fontStyle: 'normal' }}>Edit</b>, then ＋ to compose your dashboard.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' }}>
        {blocks.map((b, i) => {
          const full = b.width === 'full' || isStructural(b.type);
          const common = {
            block: b, edit, first: i === 0, last: i === blocks.length - 1,
            onResize: async () => { await resizeBlock(b.id, b.width === 'full' ? 'half' : 'full'); load(); },
            onRemove: async () => { await removeBlock(b.id); haptic('light'); load(); },
            onUp: async () => { await moveBlock(b.id, -1); load(); },
            onDown: async () => { await moveBlock(b.id, 1); load(); },
            onConfig: () => setCfg(b),
          };
          return (
            <div key={b.id} style={{ width: full ? '100%' : 'calc(50% - 6px)' }}>
              {isStructural(b.type)
                ? <StructuralBlock {...common} />
                : <WidgetFrame {...common} data={data[b.id]} onOpen={onOpen} onGoTab={onGoTab} />}
            </div>
          );
        })}
        {edit && <button onClick={() => setPicker(true)} className="dw-add">＋ Add a widget</button>}
      </div>

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

function WidgetFrame({ block, data, edit, onOpen, onGoTab, first, last, onResize, onRemove, onUp, onDown, onConfig, preview }) {
  const meta = widgetMeta(block.type);
  const title = block.config?.name || meta.title;
  return (
    <div className="dw" data-pillar={pillarOf(block.type) || undefined}>
      <div className="dw-head">
        <span className="dw-title">{title}</span>
        {!edit && data?.count != null && <span className="dw-count">{data.count}</span>}
        {edit && (
          <div className="dw-tools">
            <button className="dw-mini" disabled={first} onClick={onUp} aria-label="Move up">▲</button>
            <button className="dw-mini" disabled={last} onClick={onDown} aria-label="Move down">▼</button>
            <button className="dw-mini" onClick={onResize} aria-label="Resize">{block.width === 'full' ? '½' : '⤢'}</button>
            <button className="dw-mini" onClick={onConfig} aria-label="Rename or configure">✎</button>
            <button className="dw-mini danger" onClick={onRemove} aria-label="Remove">✕</button>
          </div>
        )}
      </div>
      <div className="dw-body"><WidgetBody block={block} data={data} onOpen={onOpen} onGoTab={onGoTab} preview={preview} /></div>
    </div>
  );
}

// Chrome-less layout furniture (Title / Separator). In edit mode a small control
// strip floats over it for reorder / rename / remove.
function StructuralBlock({ block, edit, first, last, onUp, onDown, onRemove, onConfig }) {
  return (
    <div style={{ position: 'relative' }}>
      {block.type === 'title'
        ? <div className="dw-titlecard"><span className="t">{block.config?.name || 'Title'}</span></div>
        : <div className="dw-sep"><span className="ln" /><span className="dia" /><span className="ln" /></div>}
      {edit && (
        <div className="dw-struct-edit">
          <button className="dw-mini" disabled={first} onClick={onUp} aria-label="Move up">▲</button>
          <button className="dw-mini" disabled={last} onClick={onDown} aria-label="Move down">▼</button>
          {block.type === 'title' && <button className="dw-mini" onClick={onConfig} aria-label="Edit title">✎</button>}
          <button className="dw-mini danger" onClick={onRemove} aria-label="Remove">✕</button>
        </div>
      )}
    </div>
  );
}

// Full-bleed card/deck art with a graceful monogram behind it — if the image is
// absent or fails to load, the gold monogram shows through.
function ArtHero({ image, name, sub, badge, onClick, tall, deck }) {
  return (
    <div className={`dw-hero${tall ? ' tall' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="dw-mono">{deck ? '◆' : '◈'}</div>
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
    ? <ArtHero image={data.card.image} name={data.card.name}
        badge={k === 'cardOfDay' ? 'CARD OF THE DAY' : (data.card.rarity ? data.card.rarity.toUpperCase() : null)}
        sub={`${data.card.type || 'Card'}${data.card.cost != null ? ` · ${data.card.cost} mana` : ''}`}
        tall={block.width !== 'full'} onClick={() => open('card', data.card.id, data.card.name)} />
    : empty(data.empty);

  if (k === 'deckSpotlight') return data.spotlight
    ? <ArtHero image={data.spotlight.image} name={data.spotlight.name} deck tall={block.width !== 'full'}
        sub={<>{(data.spotlight.elems || []).map((e, i) => <img key={i} src={`${BASE}icons/${e.el}.png`} alt="" onError={hideImg} />)}<span>{data.spotlight.record}{data.spotlight.winPct != null ? ` · ${data.spotlight.winPct}%` : ''}</span></>}
        onClick={() => open('deck', data.spotlight.id, data.spotlight.name)} />
    : empty(data.empty);

  if (k === 'yourDecks') return data.decks?.length
    ? <div className="dw-decks">{data.decks.map((d, i) => (
        <div key={i} className="dw-deckcard" onClick={() => open('deck', d.id, d.name)}>
          {d.image ? <img src={`${BASE}cards/${d.image}`} alt="" loading="lazy" onError={hideImg} /> : <div className="dw-deckmono">◆</div>}
          <div className="g" /><div className="n">{d.name}</div><div className="r">{d.record}</div>
        </div>))}</div>
    : empty(data.empty);

  if (k === 'elementAffinity') return data.any
    ? <div>{data.affinity.map((e) => (
        <div key={e.el} className="dw-el">
          <img src={`${BASE}icons/${e.el}.png`} alt={e.el} onError={hideImg} />
          <div className="dw-el-track"><div className="dw-el-fill" style={{ width: `${e.pct}%`, background: EL_HUE[e.el] }} /></div>
          <span className="dw-el-n">{e.n}</span>
        </div>))}</div>
    : empty(data.empty);

  if (k === 'winRate') {
    if (!data.total) return empty(data.empty);
    const pct = data.winPct;
    const ring = `conic-gradient(var(--accent-jade) 0% ${pct || 0}%, rgba(255,255,255,.08) ${pct || 0}% 100%)`;
    return (
      <div className="dw-ring-wrap" onClick={() => go('play')} style={{ cursor: 'pointer' }}>
        <div className="dw-ring" style={{ background: ring }}><div className="dw-ring-inner">{pct != null ? pct + '%' : '—'}</div></div>
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
    ? <div className="dw-row tap" onClick={() => open('rule', data.rule.id, data.rule.name)}><span className="gl">§</span><span className="nm">{data.rule.name}</span></div>
    : empty(data.empty || '—');

  if (k === 'note') return <div className="dw-note">{data.text || 'Empty note — open Edit ✎ to write.'}</div>;

  if (k === 'links') return data.links?.length
    ? data.links.map((l, i) => { const href = safeHref(l.url); return href
        ? <a key={i} className="dw-link" href={preview ? undefined : href} target="_blank" rel="noreferrer" onClick={preview ? (e) => e.preventDefault() : undefined}>↗ {l.label || l.url}</a>
        : <div key={i} className="dw-link" style={{ color: 'var(--ink-faint)' }}>↗ {l.label || l.url}</div>; })
    : empty('No links — open Edit ✎ to add.');

  if (data.quotes) return data.items?.length
    ? data.items.slice(0, 3).map((n, i) => <div key={i} className="dw-quote" onClick={() => open(n.type, n.id, n.on)}>“{n.body}”{n.on && <span className="on">{k === 'highlights' ? n.on : `on ${n.on}`}</span>}</div>)
    : empty(data.empty);

  // list widgets — pinned, collections, errata
  return data.items?.length
    ? data.items.slice(0, 5).map((it, i) => (
        <div key={i} className={`dw-row${it.type ? ' tap' : ''}`} onClick={it.type ? () => open(it.type, it.id, it.name) : undefined}>
          <span className="gl">{it.glyph || '§'}</span><span className="nm">{it.name}</span>{it.meta && <span className="mt">{it.meta}</span>}
        </div>))
    : empty(data.empty || '—');
}

// The Add-a-widget sheet renders a LIVE mini-preview of each widget (fed
// representative sample data + a few real card images), not just a name tile.
function Picker({ open, onClose, onPick }) {
  const [samples, setSamples] = useState([]);
  useEffect(() => { if (open) pickerSamples().then(setSamples).catch(() => setSamples([])); }, [open]);
  return (
    <Sheet open={open} title="Add a Widget" onClose={onClose}>
      <div className="dw-picker">
        <div style={{ font: "400 12px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', margin: '0 0 14px' }}>
          Tap a widget to add it. Resize, reorder and rename anything once it’s on your dashboard.
        </div>
        <div className="dw-picker-grid">
          {WIDGETS.map((w) => {
            const sample = { id: 'preview', type: w.kind, width: w.structural ? 'full' : 'half', config: {} };
            const sdata = sampleData(w.kind, samples);
            return (
              <button key={w.kind} className="dw-pick" onClick={() => onPick(w.kind)}>
                <div className="dw-pick-preview">
                  {w.kind === 'title'
                    ? <div className="dw"><div className="dw-body"><div className="dw-titlecard"><span className="t">My Layout</span></div></div></div>
                    : w.kind === 'separator'
                      ? <div className="dw"><div className="dw-body"><div className="dw-sep"><span className="ln" /><span className="dia" /><span className="ln" /></div></div></div>
                      : <WidgetFrame block={sample} data={sdata} edit={false} preview onOpen={() => {}} onGoTab={() => {}} />}
                </div>
                <div className="dw-pick-foot">
                  <span className={`pl ${w.pillar || ''}`} />
                  <span className="nm">{w.title}</span>
                  <span className="add">＋</span>
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
            <button onClick={() => setLinks([...links, { label: '', url: '' }])} style={{ ...ghostBtn, width: '100%', marginBottom: 2 }}>＋ Add link</button>
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
const EL_HUE = { fire: '#d98a5a', water: '#6fa8d9', earth: '#c9a35a', air: '#cdd0dc' };
const hideImg = (e) => { e.currentTarget.style.display = 'none'; };
