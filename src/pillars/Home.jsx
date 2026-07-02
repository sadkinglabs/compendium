// Home — Overview (resume · decks rail · notes · live record) and the
// customisable Dashboard (all widget kinds, edit mode: resize ½/full, move,
// remove, add, configure). The payoff of unification: every widget reads the
// merged, profile-scoped store, so it aggregates across pillars.
import React, { useEffect, useState } from 'react';
import {
  listBlocks, addBlock, removeBlock, resizeBlock, moveBlock, setConfig,
  widgetData, widgetTitle, isConfigurable, overview, WIDGETS,
  saveLayout, listLayouts, loadLayout, deleteLayout,
} from '../store/homeRepository.js';
import { listCollections } from '../store/codexRepository.js';
import { Chip, ChipRow, SectionLabel, IconButton } from '../components/ui.jsx';
import Sheet from '../components/Sheet.jsx';

const BASE = import.meta.env.BASE_URL;

export default function Home({ onOpen, ongoing, onResume, rev }) {
  const [tab, setTab] = useState('overview');
  const [edit, setEdit] = useState(false);
  return (
    <div style={{ padding: '6px 20px 26px', animation: 'cxfade .2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <ChipRow>
          <Chip label="Overview" active={tab === 'overview'} onClick={() => { setTab('overview'); setEdit(false); }} />
          <Chip label="Dashboard" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />
        </ChipRow>
        {tab === 'dashboard' && (
          <button onClick={() => setEdit((e) => !e)} style={editBtn}>{edit ? 'Done' : 'Edit'}</button>
        )}
      </div>
      {tab === 'overview' ? <Overview onOpen={onOpen} ongoing={ongoing} onResume={onResume} rev={rev} /> : <Dashboard onOpen={onOpen} edit={edit} rev={rev} />}
    </div>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ onOpen, ongoing, onResume, rev }) {
  const [d, setD] = useState(null);
  useEffect(() => { let a = true; overview().then((x) => a && setD(x)); return () => { a = false; }; }, [rev]);
  if (!d) return <div style={{ color: 'var(--ink-faint)' }}>…</div>;
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
      {d.resume && (
        <div onClick={() => onOpen(d.resume.target_type, d.resume.target_id, d.resume.title)} className="cx-row"
          style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid var(--hair-20,rgba(201,163,90,.2))', borderRadius: 16, padding: 14, background: 'linear-gradient(180deg,rgba(42,31,19,.6),rgba(26,19,13,.3))', marginBottom: 24, cursor: 'pointer' }}>
          <div><div style={{ font: "600 10px/1 var(--f-ui)", letterSpacing: '.16em', color: 'var(--ink-muted)' }}>JUMP BACK IN</div>
            <div style={{ font: "600 16px/1.1 var(--f-read)", color: 'var(--ink-body)', marginTop: 5 }}>{d.resume.title}</div></div>
        </div>
      )}
      <div style={{ marginBottom: 24 }}>
        <SectionLabel label="YOUR DECKS" count={d.decks.length} />
        {d.decks.length === 0 ? <Empty text="No decks yet — build one in Decks." />
          : (
            <div className="cx-deck-carousel">
              {d.decks.map((dk) => (
                <div key={dk.id} className="cx-deck-card" onClick={() => onOpen('deck', dk.id, dk.name)}>
                  {dk.avatar?.image_slug && <img className="cx-deck-card-bg" src={`${BASE}cards/${dk.avatar.image_slug}`} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                  <div className="cx-deck-card-grad" />
                  <div className="cx-deck-card-info">
                    <div className="cx-deck-card-name">{dk.name}</div>
                    <div className="cx-deck-card-sub">{dk.archetype || dk.record}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
      <div style={{ marginBottom: 24 }}>
        <SectionLabel label="NOTES & RULINGS" count={d.notes.count} />
        {d.notes.items.length === 0 ? <Empty text="No marginalia yet." />
          : d.notes.items.slice(0, 3).map((n, i) => (
            <div key={i} onClick={() => onOpen(n.type, n.id, n.on)} className="cx-row" style={{ borderLeft: '2px solid var(--gold)', background: 'rgba(201,163,90,.06)', borderRadius: '0 10px 10px 0', padding: '10px 12px', marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ font: "400 14px/1.45 var(--f-read)", color: 'var(--ink-body)', fontStyle: 'italic' }}>{n.body}</div>
              {n.on && <div style={{ font: "500 10px/1 var(--f-ui)", color: 'var(--ink-muted)', marginTop: 5 }}>on {n.on}</div>}
            </div>
          ))}
      </div>
      <div>
        <SectionLabel label="RECENT DUELS" count={d.duels.record} />
        {d.duels.items.length === 0 ? <Empty text="No duels yet — start a match in Play." />
          : d.duels.items.slice(0, 4).map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px', borderBottom: '1px solid var(--hair-12)' }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 12px/1 var(--f-display)", color: m.won ? 'var(--accent-jade)' : m.draw ? 'var(--ink-muted)' : '#c98f8f', background: 'rgba(34,26,20,.5)', border: '1px solid var(--hair-16)' }}>{m.won ? 'W' : m.draw ? 'D' : 'L'}</span>
              <span style={{ flex: 1, font: "600 14px/1 var(--f-read)", color: 'var(--ink-body)' }}>{m.name}</span>
              <span style={{ font: "500 12px/1 var(--f-mono)", color: 'var(--ink-muted)' }}>{m.score}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ onOpen, edit, rev }) {
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
  if (!blocks) return <div style={{ color: 'var(--ink-faint)' }}>…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={() => { setLayoutSheet(true); refreshLayouts(); }} style={editBtn}>⧉ Layouts</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {blocks.map((b, i) => (
          <div key={b.id} style={{ width: b.width === 'full' ? '100%' : 'calc(50% - 6px)' }}>
            <WidgetFrame block={b} data={data[b.id]} edit={edit} onOpen={onOpen}
              first={i === 0} last={i === blocks.length - 1}
              onResize={async () => { await resizeBlock(b.id, b.width === 'full' ? 'half' : 'full'); load(); }}
              onRemove={async () => { await removeBlock(b.id); load(); }}
              onUp={async () => { await moveBlock(b.id, -1); load(); }}
              onDown={async () => { await moveBlock(b.id, 1); load(); }}
              onConfig={() => setCfg(b)} />
          </div>
        ))}
        {edit && (
          <button onClick={() => setPicker(true)} style={addTile}>＋ Add a widget</button>
        )}
      </div>

      <Picker open={picker} onClose={() => setPicker(false)} onPick={async (k) => { await addBlock(k); setPicker(false); load(); }} />
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
        <button onClick={() => { if (name.trim()) { onSave(name.trim()); setName(''); } }} style={{ padding: '0 18px', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 13px/1 var(--f-ui)", border: 'none', cursor: 'pointer' }}>Save</button>
      </div>
      </div>
    </Sheet>
  );
}

function WidgetFrame({ block, data, edit, onOpen, first, last, onResize, onRemove, onUp, onDown, onConfig }) {
  return (
    <div style={{ border: '1px solid var(--hair-16)', borderRadius: 16, background: 'linear-gradient(180deg,rgba(34,26,20,.55),rgba(22,16,11,.35))', overflow: 'hidden', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px 8px' }}>
        <span style={{ flex: 1, font: "600 11px/1 var(--f-display)", letterSpacing: '.1em', color: 'var(--gold-leaf)' }}>{data?.title || widgetTitle(block.type)}</span>
        {!edit && data?.count != null && <span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>{data.count}</span>}
        {edit && (
          <div style={{ display: 'flex', gap: 4 }}>
            <Mini glyph="▲" disabled={first} onClick={onUp} />
            <Mini glyph="▼" disabled={last} onClick={onDown} />
            <Mini glyph={block.width === 'full' ? '½' : '1'} onClick={onResize} />
            {isConfigurable(block.type) && <Mini glyph="⚙" onClick={onConfig} />}
            <Mini glyph="✕" danger onClick={onRemove} />
          </div>
        )}
      </div>
      <div style={{ padding: '0 13px 13px' }}><WidgetBody block={block} data={data} onOpen={onOpen} /></div>
    </div>
  );
}

function WidgetBody({ block, data, onOpen }) {
  const k = block.type;
  if (!data) return null;
  const empty = (t) => <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '4px 0' }}>{t}</div>;

  if (k === 'stats') return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {data.stats.map(([l, v]) => <div key={l} style={{ textAlign: 'center', border: '1px solid var(--hair-12)', borderRadius: 9, padding: '9px 0' }}><div style={{ font: "700 18px/1 var(--f-mono)", color: 'var(--gold-leaf)' }}>{v}</div><div style={{ font: "500 9px/1 var(--f-ui)", color: 'var(--ink-faint)', marginTop: 5, letterSpacing: '.08em' }}>{l.toUpperCase()}</div></div>)}
    </div>
  );
  if (k === 'resume') return data.resume
    ? <Row onClick={() => onOpen(data.resume.type, data.resume.id, data.resume.title)} glyph="↻" name={data.resume.title} />
    : empty(data.empty);
  if (k === 'random' || k === 'randomArticle') return data.random
    ? <Row onClick={() => onOpen(data.random.type, data.random.id, data.random.name)} glyph={k === 'random' ? '◈' : '§'} name={data.random.name} />
    : empty('—');
  if (k === 'text') return <div style={{ font: "400 13.5px/1.5 var(--f-read)", color: 'var(--ink-body)', fontStyle: 'italic' }}>{data.text || 'Empty note — Edit ⚙ to write.'}</div>;
  if (k === 'urls') return (data.links || []).length
    ? data.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer" style={{ display: 'block', font: "500 13px/1.5 var(--f-ui)", color: 'var(--link-violet)' }}>↗ {l.label || l.url}</a>)
    : empty('No links — Edit ⚙ to add.');
  if (k === 'duels') return data.items?.length
    ? data.items.slice(0, 4).map((m, i) => <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0' }}><span style={{ width: 18, font: "700 11px/1 var(--f-display)", color: m.won ? 'var(--accent-jade)' : '#c98f8f' }}>{m.won ? 'W' : m.draw ? 'D' : 'L'}</span><span style={{ flex: 1, font: "500 13px/1.3 var(--f-read)", color: 'var(--ink-body)' }}>{m.name}</span><span style={{ font: "500 11px/1 var(--f-mono)", color: 'var(--ink-muted)' }}>{m.score}</span></div>)
    : empty(data.empty);
  if (data.quotes) return data.items?.length
    ? data.items.slice(0, 3).map((n, i) => <div key={i} onClick={() => onOpen(n.type, n.id, n.on)} className="cx-row" style={{ font: "400 13px/1.45 var(--f-read)", color: 'var(--ink-body)', fontStyle: 'italic', padding: '4px 0', cursor: 'pointer' }}>“{n.body}”</div>)
    : empty(data.empty);
  // list-style widgets (saved, notes-as-rows, collections, errata, decks, collection)
  return data.items?.length
    ? data.items.slice(0, 5).map((it, i) => <Row key={i} glyph={it.glyph || '§'} name={it.name} meta={it.meta} onClick={it.type ? () => onOpen(it.type, it.id, it.name) : undefined} />)
    : empty(data.empty || '—');
}

function Picker({ open, onClose, onPick }) {
  return (
    <Sheet open={open} title="Add a Widget" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 16px' }}>
        {WIDGETS.map((w) => (
          <button key={w.kind} onClick={() => onPick(w.kind)} style={{ padding: '12px 10px', borderRadius: 11, border: '1px solid var(--hair-22)', background: 'var(--surface-card)', color: 'var(--ink-body)', font: "600 12px/1.2 var(--f-ui)", cursor: 'pointer', textAlign: 'left' }}>{w.title}</button>
        ))}
      </div>
    </Sheet>
  );
}

function ConfigSheet({ block, onClose, onSaved }) {
  const [text, setText] = useState('');
  const [links, setLinks] = useState([]);
  const [cols, setCols] = useState([]);
  useEffect(() => {
    if (!block) return;
    setText(block.config?.text || '');
    setLinks(block.config?.links || []);
    if (block.type === 'collection') listCollections().then(setCols);
  }, [block]);
  if (!block) return null;
  const save = async (config) => { await setConfig(block.id, config); onSaved(); };
  return (
    <Sheet open={!!block} title={'Configure · ' + widgetTitle(block.type)} onClose={onClose}>
      <div style={{ padding: '0 16px' }}>
      {block.type === 'text' && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a note…" style={{ width: '100%', height: 100, resize: 'none', background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 12, padding: 12, color: 'var(--ink-body)', font: "400 14px/1.5 var(--f-read)" }} />
          <button onClick={() => save({ text })} style={goldBtn}>Save</button>
        </>
      )}
      {block.type === 'collection' && (
        <>
          {cols.length === 0 && <div style={{ font: "400 13px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', marginBottom: 10 }}>No collections yet — make one in Codex.</div>}
          {cols.map((c) => <div key={c.id} onClick={() => save({ collectionId: c.id })} className="cx-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 4px', borderBottom: '1px solid var(--hair-12)', cursor: 'pointer' }}><span style={{ font: "600 15px/1 var(--f-read)", color: 'var(--ink-body)' }}>{c.name}</span><span style={{ color: 'var(--ink-faint)' }}>{block.config?.collectionId === c.id ? '✓' : '›'}</span></div>)}
        </>
      )}
      {block.type === 'urls' && (
        <>
          {links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input value={l.label} onChange={(e) => setLinks(links.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" style={cfgInput} />
              <input value={l.url} onChange={(e) => setLinks(links.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" style={cfgInput} />
              <IconButton glyph="✕" tone="danger" size={28} onClick={() => setLinks(links.filter((_, j) => j !== i))} />
            </div>
          ))}
          <button onClick={() => setLinks([...links, { label: '', url: '' }])} style={{ ...ghostBtn, width: '100%', marginBottom: 10 }}>＋ Add link</button>
          <button onClick={() => save({ links: links.filter((l) => l.url) })} style={goldBtn}>Save</button>
        </>
      )}
      </div>
    </Sheet>
  );
}

const Row = ({ glyph, name, meta, onClick }) => (
  <div onClick={onClick} className={onClick ? 'cx-row' : ''} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', cursor: onClick ? 'pointer' : 'default' }}>
    <span style={{ color: 'var(--gold)', fontSize: 13, width: 16, textAlign: 'center' }}>{glyph}</span>
    <span style={{ flex: 1, minWidth: 0, font: "500 13.5px/1.25 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    {meta && <span style={{ font: "500 10px/1 var(--f-ui)", color: 'var(--ink-faint)' }}>{meta}</span>}
  </div>
);
const Mini = ({ glyph, onClick, disabled, danger }) => (
  <button disabled={disabled} onClick={onClick} style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--hair-22)', background: 'transparent', color: disabled ? 'var(--ink-faint)' : danger ? 'var(--destructive)' : 'var(--ink-status)', cursor: disabled ? 'default' : 'pointer', font: '11px/1', opacity: disabled ? 0.4 : 1 }}>{glyph}</button>
);
const Empty = ({ text }) => <div style={{ font: "400 13px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', padding: '6px 0' }}>{text}</div>;
const editBtn = { padding: '7px 16px', borderRadius: 18, border: '1px solid var(--hair-30)', background: 'transparent', color: 'var(--gold-leaf)', font: "600 12px/1 var(--f-ui)", cursor: 'pointer' };
const addTile = { width: '100%', padding: '18px 0', borderRadius: 16, border: '1px dashed var(--hair-30)', background: 'transparent', color: 'var(--gold-leaf)', font: "600 13px/1 var(--f-ui)", cursor: 'pointer' };
const goldBtn = { width: '100%', marginTop: 12, padding: '12px 0', borderRadius: 12, background: 'linear-gradient(180deg,#dcb86f,#c9a35a)', color: '#1a1410', font: "700 13px/1 var(--f-ui)", border: 'none', cursor: 'pointer' };
const ghostBtn = { padding: '11px 0', borderRadius: 12, background: 'transparent', color: 'var(--ink-status)', font: "600 12px/1 var(--f-ui)", border: '1px solid var(--hair-22)', cursor: 'pointer' };
const cfgInput = { flex: 1, minWidth: 0, height: 40, background: 'var(--surface-well)', border: '1px solid var(--hair-22)', borderRadius: 10, padding: '0 10px', color: 'var(--ink-body)', font: "400 13px/1 var(--f-read)" };
