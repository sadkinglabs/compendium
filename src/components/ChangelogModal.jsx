// What's New - the release notes, on the centered chassis (Credits' surface, so
// the two read as one family; they sit adjacent now that Credits opens it).
//
// Two callers, one component:
//   - the update gate passes the entries the user hasn't seen + a STAMPING close
//   - Credits passes the whole CHANGELOG + a plain close (browsing history is not
//     news, so it must not stamp)
// This component knows about neither: it renders `entries` and calls `onClose`.
//
// Content comes from src/content/changelog.js. Nothing here branches on a
// version, and adding a release touches only that file (invariant 7).
import React from 'react';
import { CenteredModal } from './ui.jsx';

// Rubrics are a lookup, not a conditional - a new `kind` is a row here. The
// palette stays gold on purpose: accent hues are chrome in this app, and the
// pillar accents (violet=Decks, jade=Play) mean something elsewhere. The rubric
// word does the sorting work, so it doesn't need a colour to help it.
const KINDS = [
  ['added', 'ADDED'],
  ['changed', 'CHANGED'],
  ['fixed', 'FIXED'],
];

// '2026-07-16' -> '16 July 2026'. Split by hand rather than via new Date(): the
// bare ISO form parses as UTC midnight, which renders as the previous day for
// anyone west of Greenwich.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`;
}

export default function ChangelogModal({ open, entries, onClose }) {
  const list = entries || [];
  return (
    <CenteredModal open={open} label="What's New" maxWidth={380} onClose={onClose} boxStyle={{ overflow: 'hidden' }}>
      <div style={{ padding: '30px 0 0', textAlign: 'center', background: 'radial-gradient(ellipse at 50% 0%, rgba(220,184,111,.14) 0%, transparent 70%)' }}>
        <div style={{ font: "600 21px/1.1 var(--f-display)", color: 'var(--gold-leaf)', letterSpacing: '.02em' }}>What&rsquo;s New</div>
        {list.length > 1 && (
          <div style={{ font: "400 12px/1.4 var(--f-read)", color: 'var(--ink-muted)', fontStyle: 'italic', margin: '6px 26px 0' }}>
            Everything that changed since you were last here.
          </div>
        )}
      </div>

      {/* The scroll region. A catch-up across several builds is long, so this is
          the part that moves; the title and the button stay put. */}
      <div className="cx-scroll" style={{ maxHeight: 'min(56dvh, 420px)', overflowY: 'auto', padding: '18px 24px 4px', WebkitOverflowScrolling: 'touch' }}>
        {list.length === 0 ? (
          <div style={{ font: "400 13px/1.6 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic', textAlign: 'center', padding: '8px 0 16px' }}>
            No release notes yet.
          </div>
        ) : list.map((e, i) => (
          <div key={e.build} style={{ marginBottom: 22, paddingTop: i === 0 ? 0 : 18, borderTop: i === 0 ? 'none' : '1px solid var(--hair-12)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: e.notes ? 7 : 12 }}>
              <span style={{ font: "600 15px/1.2 var(--f-display)", color: 'var(--gold-head)' }}>v{e.version}</span>
              <span style={{ font: "500 9.5px/1 var(--f-mono)", letterSpacing: '.08em', color: 'var(--ink-faint)' }}>BUILD {e.build}</span>
              <span style={{ flex: 1 }} />
              <span style={{ font: "400 11px/1 var(--f-read)", color: 'var(--ink-faint)' }}>{fmtDate(e.date)}</span>
            </div>

            {e.notes && (
              <div style={{ font: "400 13px/1.6 var(--f-read)", color: 'var(--ink-muted)', fontStyle: 'italic', marginBottom: 13 }}>{e.notes}</div>
            )}

            {KINDS.map(([kind, rubric]) => {
              const rows = (e.changes || []).filter((c) => c.kind === kind);
              if (!rows.length) return null;
              return (
                <div key={kind} style={{ marginBottom: 12 }}>
                  <div style={{ font: "600 9.5px/1 var(--f-ui)", letterSpacing: '.16em', color: 'var(--gold)', marginBottom: 7 }}>{rubric}</div>
                  {rows.map((c, j) => (
                    <div key={j} style={{ display: 'flex', gap: 9, padding: '3px 0' }}>
                      <span aria-hidden="true" style={{ flex: 'none', width: 3, height: 3, borderRadius: '50%', background: 'var(--gold)', marginTop: 8 }} />
                      <span style={{ flex: 1, font: "400 13.5px/1.55 var(--f-read)", color: 'var(--ink-body)' }}>{c.text}</span>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* A release with an entry but no listed changes shouldn't render an
                empty version header with nothing under it. */}
            {!(e.changes || []).length && !e.notes && (
              <div style={{ font: "400 12.5px/1.5 var(--f-read)", color: 'var(--ink-faint)', fontStyle: 'italic' }}>Maintenance release.</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 24px calc(20px + env(safe-area-inset-bottom,0px))', borderTop: '1px solid var(--hair-12)' }}>
        <button onClick={onClose} style={{ width: '100%', minHeight: 48, padding: '12px 18px', borderRadius: 12, background: 'transparent', border: '1px solid rgba(220,184,111,.45)', color: 'var(--gold-leaf)', font: "600 13px/1 var(--f-display)", letterSpacing: '.1em', cursor: 'pointer' }}>
          CONTINUE
        </button>
      </div>
    </CenteredModal>
  );
}
