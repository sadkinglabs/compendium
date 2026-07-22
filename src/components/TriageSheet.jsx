// "To Be Categorised" - the surface that empties the pile v11 left behind.
//
// Some ownership rows never had a set: copies filed by a text import or an early scanner, and
// legacy wants on reprinted cards that migration refused to guess about. triage.js turns those
// rows into decisions; this asks them, one at a time, and writes each through fileTriageLine.
//
// ONE LINE, ONE QUESTION. Owned copies and a want on the same card are separate rows here
// because they are separate answers - owning an Alpha copy while wanting the Beta one is
// ordinary. And the finish is stated, never asked: it survived migration intact, so offering to
// change it would invite the user to contradict their own ledger.
import React, { useState, useEffect } from 'react';
import { BottomSheet, BTN_GOLD, BTN_GHOST } from './ui.jsx';
import { pendingCount, fileLinePlan } from '../store/triage.js';
import { fileTriageLine } from '../store/triageRepository.js';
import { cardNames } from '../store/ownedRepository.js';
import { SET_LABEL, SET_RANK } from '../store/sets.js';
import { toast } from '../feedback.js';
import { lineKey, visiblePile, bulkDecisions, lineDescription, applySummary, shouldHideLine } from './triageSheetState.js';

const setName = (code) => SET_LABEL[code] || code;
const bySetOrder = (a, b) => (SET_RANK[a] ?? 99) - (SET_RANK[b] ?? 99);

const LABEL = { font: "600 10px/1 var(--f-display)", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-faint)' };
const NOTE = { font: "400 12.5px/1.5 var(--f-ui)", color: 'var(--ink-muted)' };

export default function TriageSheet({ open, pile = [], onClose, onChanged, onOpenCard }) {
  const [names, setNames] = useState(new Map());
  const [filed, setFiled] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);

  const entries = visiblePile(pile, filed);
  const decisions = bulkDecisions(entries);

  useEffect(() => {
    if (open) cardNames((pile || []).map((e) => e.card_id)).then(setNames);
  }, [open, pile]);

  // A fresh open starts from a fresh record. `filed` only exists to cover the gap before the
  // parent's re-read lands; carrying it across opens would hide lines that are genuinely back.
  useEffect(() => { if (open) { setFiled(new Set()); setPreview(null); setBusy(null); } }, [open]);

  const nameOf = (id) => names.get(id) || id;

  // ONE write path. Every route into filing - a tapped set, a bulk apply - comes through here,
  // so the confirmed/unconfirmed distinction is handled in exactly one place.
  const fileOne = async (entry, line, set) => {
    const result = await fileTriageLine(fileLinePlan(entry, line, set));
    // ONLY a confirmed result hides the line. An unconfirmed one means the transaction resolved
    // but the read-back could not verify what it left behind - so the line stays available
    // until an authoritative refresh removes it. Hiding it here would tell the user the work is
    // done on the strength of the one thing we could not establish.
    if (shouldHideLine(result)) {
      setFiled((prev) => new Set(prev).add(lineKey(entry.card_id, line.kind)));
    }
    return result;
  };

  const fileLine = async (entry, line, set) => {
    if (busy) return;
    setBusy(lineKey(entry.card_id, line.kind));
    try {
      const result = await fileOne(entry, line, set);
      // `confirmed` is the only success signal, and an unconfirmed write exposes no quantity -
      // so there is no number to put in this message and none is invented.
      // Not past tense: "filed" would claim the outcome we specifically could not confirm.
      if (!result.confirmed) toast('Could not confirm this move - check the line before retrying', { tone: 'danger' });
      else if (result.noop) toast('Nothing left to file here');
      else toast(`Filed ${result.moved} to ${setName(set)}`);
      onChanged?.();
    } catch (err) {
      toast(err?.message || 'Could not file this line', { tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  // Bulk goes through fileTriageLine per decision like everything else. It is a shortcut for the
  // asking, not for the writing - a batch that wrote its own way would be a second write path
  // with none of the barrier or read-back the single one has.
  const applyBulk = async () => {
    if (busy || !preview?.length) return;
    setBusy('bulk');
    let ok = 0; let unconfirmed = 0; let failed = 0;
    for (const d of preview) {
      try {
        const result = await fileOne(d.entry, d.line, d.set);
        if (result.confirmed) ok += 1; else unconfirmed += 1;
      } catch { failed += 1; }
    }
    setPreview(null);
    setBusy(null);
    toast(applySummary({ filed: ok, unconfirmed, failed, total: preview.length }),
      { tone: unconfirmed || failed ? 'danger' : 'default' });
    onChanged?.();
  };

  const pending = pendingCount(entries);
  const stuck = entries.filter((e) => !e.resolvable).length;

  return (
    <BottomSheet open={open} title="TO BE CATEGORISED" onClose={onClose}>
      {preview ? (
        <>
          <div style={{ ...NOTE, textAlign: 'center', marginBottom: 14 }}>
            These cards were printed in one set only, so there is nothing to choose. Here is every
            decision this will make.
          </div>
          {preview.map((d) => (
            <div key={lineKey(d.entry.card_id, d.line.kind)}
              style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--hair-12)' }}>
              <span style={{ minWidth: 0, font: "500 14px/1.3 var(--f-read)", color: 'var(--ink-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--gold-leaf)', font: "600 12px/1 var(--f-mono)", marginRight: 8 }}>{d.line.qty}×</span>
                {nameOf(d.entry.card_id)}
              </span>
              <span style={{ flex: 'none', font: "600 10.5px/1 var(--f-mono)", color: 'var(--ink-faint)' }}>
                {lineDescription(d.line)} → {setName(d.set)}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <button onClick={applyBulk} disabled={busy === 'bulk'} style={{ ...BTN_GOLD, flex: '1 1 100%', justifyContent: 'center' }}>
              {busy === 'bulk' ? 'Filing…' : `Apply ${preview.length} decision${preview.length === 1 ? '' : 's'}`}
            </button>
            <button onClick={() => setPreview(null)} disabled={busy === 'bulk'} style={{ ...BTN_GHOST, flex: '1 1 100%', justifyContent: 'center' }}>
              Go back without filing
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ ...NOTE, textAlign: 'center', marginBottom: 14 }}>
            {pending === 0
              ? 'Nothing is waiting to be categorised.'
              : `${pending} decision${pending === 1 ? '' : 's'} across ${entries.length} card${entries.length === 1 ? '' : 's'}. These copies were recorded without a set - choose the one they came from.`}
          </div>

          {decisions.length > 0 && (
            <button onClick={() => setPreview(decisions)} style={{ ...BTN_GOLD, width: '100%', justifyContent: 'center', marginBottom: 16 }}>
              Resolve {decisions.length} obvious item{decisions.length === 1 ? '' : 's'}
            </button>
          )}

          {entries.map((entry) => (
            <div key={entry.card_id} style={{ padding: '12px 0', borderBottom: '1px solid var(--hair-12)' }}>
              {onOpenCard ? (
                <button onClick={() => onOpenCard(entry.card_id)}
                  style={{ display: 'block', width: '100%', padding: 0, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', font: "500 15px/1.25 var(--f-read)", color: 'var(--ink-body)' }}>
                  {nameOf(entry.card_id)}
                </button>
              ) : (
                <div style={{ font: "500 15px/1.25 var(--f-read)", color: 'var(--ink-body)' }}>{nameOf(entry.card_id)}</div>
              )}

              {/* Rendered ONCE per card, not per line. It describes the CARD's situation - the
                  catalog knows no printings for it - so repeating it under each line said the
                  same thing twice for a card with both owned copies and a want. */}
              {!entry.resolvable && (
                <div style={{ ...NOTE, fontStyle: 'italic', color: 'var(--ink-faint)', marginTop: 8 }}>
                  The catalog lists no printings for this card, so there is no set to file it to.
                  It stays here until the catalog covers it.
                </div>
              )}

              {entry.lines.map((line) => {
                const key = lineKey(entry.card_id, line.kind);
                const working = busy === key;
                return (
                  <div key={key} style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: 'var(--gold-leaf)', font: "600 12px/1 var(--f-mono)" }}>{line.qty}×</span>
                      <span style={LABEL}>{lineDescription(line)}</span>
                    </div>
                    {/* A card the catalog has no printings for is still LISTED - hiding it would
                        leave the count wrong and the user with no idea why - but it offers no
                        destinations, because there are none to offer. */}
                    {entry.resolvable && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {[...entry.sets].sort(bySetOrder).map((code) => (
                          <button key={code} onClick={() => fileLine(entry, line, code)} disabled={!!busy}
                            style={{
                              padding: '8px 12px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                              font: "600 12px/1 var(--f-ui)", color: 'var(--gold-leaf)',
                              background: 'rgba(18,16,13,.85)', border: '1px solid var(--hair-22)',
                              opacity: busy && !working ? .5 : 1,
                            }}>
                            {setName(code)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {stuck > 0 && (
            <div style={{ ...NOTE, marginTop: 14, color: 'var(--ink-faint)' }}>
              {stuck} card{stuck === 1 ? '' : 's'} here cannot be filed yet - the catalog does not
              list a printing for {stuck === 1 ? 'it' : 'them'}.
            </div>
          )}

          <button onClick={onClose} style={{ ...BTN_GHOST, width: '100%', justifyContent: 'center', marginTop: 16 }}>
            Done for now
          </button>
        </>
      )}
    </BottomSheet>
  );
}
