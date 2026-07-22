// The whole-paste wishlist draft, as pure data (brief §3.2). The ResolvePrintingsSheet drives this
// and holds only React state; every decision - which set a row can take, what finish it files at,
// whether it is skipped, whether the Confirm is allowed - is computed here so it is provable
// without a DOM.
//
// The rules that MUST NOT regress (each cost a review round somewhere on this branch):
//   - Nothing defaults to a silent set. A row with no chosen set BLOCKS Confirm (the v10 defect was
//     defaulting a reprint to sets[0]).
//   - Finish intent is never downgraded (P3). A foil-only chosen set files foil regardless (shown
//     as forced). A Foil batch over a row with no foil printing SKIPS it, visibly and reversibly -
//     never silently files non-foil.
//   - A [Foil] line annotation is a valid lock ONLY when some printing of the card supports foil;
//     when none does the lock is impossible and the row demands an explicit non-foil / skip choice.
//   - A want is NEVER uncategorised (the owned/wanted asymmetry): there is no Unspecified option
//     here, unlike the owned import.

/** Numeric-code set order (001 < 002 < 999), matching the app's SET_RANK; a non-numeric code sinks
 *  last. Injected in production so the two never drift; the default keeps this module catalog-free. */
const defaultSetRank = (code) => (code && /^\d+$/.test(code) ? parseInt(code, 10) : Number.MAX_SAFE_INTEGER);

/**
 * A row's TARGET finish before any per-set resolution, from the batch finish, its [Foil] lock, and
 * any per-row override for an impossible lock.
 *   { finish: 'nonFoil'|'foil'|null, forcedByLock, needLockChoice, skip }
 */
export function rowTarget(row, batchFinish, override) {
  if (row.lockedFinish === 'foil') {
    if (row.anyFoil) return { finish: 'foil', forcedByLock: true };
    // The lock is impossible - no printing of this card supports foil. Demand an explicit choice.
    if (override === 'nonFoil') return { finish: 'nonFoil', wasImpossibleLock: true };
    if (override === 'skip') return { finish: null, skip: true };
    return { finish: null, needLockChoice: true };
  }
  return { finish: batchFinish === 'foil' ? 'foil' : 'nonFoil' };
}

/**
 * The set options a row can take at a target finish. Each option names the finish it would FILE at:
 *   - target foil: only sets that support foil.
 *   - target non-foil: sets that support non-foil, PLUS foil-only sets (which file foil, `forced`).
 */
export function rowOptions(row, targetFinish) {
  const out = [];
  for (const s of row.sets) {
    if (targetFinish === 'foil') {
      if (s.foil) out.push({ code: s.code, name: s.name, foil: true });
    } else {
      if (s.nonFoil) out.push({ code: s.code, name: s.name, foil: false });
      else if (s.foil) out.push({ code: s.code, name: s.name, foil: true, forced: true });
    }
  }
  return out;
}

/**
 * Compute the full draft VIEW for a given UI state - the single source the sheet renders and the
 * CTA gates on.
 *
 * @param draft { resolved:[{cardId,setCode,foil,qty,parts,name}], needsChoice:[row], unknown, flagged }
 * @param ui    { batchFinish:'nonFoil'|'foil', choices:{[key]:setCode}, overrides:{[key]:'nonFoil'|'skip'} }
 * @returns view with per-row status/options, the committable items (parts EXPANDED so each is within
 *          the writer's per-item bound), counts, readiness, and the CTA label.
 */
export function planWantDraft(draft, ui = {}, setRank = defaultSetRank) {
  const batchFinish = ui.batchFinish === 'foil' ? 'foil' : 'nonFoil';
  const choices = ui.choices || {};
  const overrides = ui.overrides || {};

  const rows = (draft.needsChoice || []).map((row) => {
    const t = rowTarget(row, batchFinish, overrides[row.key]);
    if (t.needLockChoice) return { ...row, status: 'lockImpossible', options: [], forcedFoil: false, commit: null };
    if (t.skip) return { ...row, status: 'lockSkip', options: [], forcedFoil: false, commit: null };
    const options = rowOptions(row, t.finish);
    if (t.finish === 'foil' && !options.length) return { ...row, status: 'skipNoFoil', options: [], forcedFoil: false, commit: null };
    const chosen = choices[row.key] || null;
    const opt = chosen ? options.find((o) => o.code === chosen) : null;
    if (!opt) return { ...row, status: 'unchosen', options, forcedFoil: false, commit: null };
    return { ...row, status: 'chosen', options, forcedFoil: !!opt.forced, effectiveFoil: opt.foil, commit: { cardId: row.cardId, set: opt.code, foil: opt.foil, qty: row.qty, parts: row.parts } };
  });

  const resolvedCommits = (draft.resolved || []).map((r) => ({ cardId: r.cardId, set: r.setCode, foil: r.foil, qty: r.qty, parts: r.parts || [r.qty] }));
  const chosenCommits = rows.filter((r) => r.status === 'chosen').map((r) => r.commit);
  const commits = [...resolvedCommits, ...chosenCommits];

  // Expand parts so each contribution reaches addWantedItemsBulk within its per-item 999 bound; the
  // writer merges them. The printing COUNT is the collector items, not the expanded contributions.
  const commitItems = commits.flatMap((c) => (c.parts || [c.qty]).map((qty) => ({ cardId: c.cardId, set: c.set, foil: c.foil, qty })));

  const skipCount = rows.filter((r) => r.status === 'skipNoFoil' || r.status === 'lockSkip').length;
  const blocking = rows.filter((r) => r.status === 'unchosen' || r.status === 'lockImpossible').length;
  const addCount = commits.length;                                   // collector items (printings)
  const copies = commitItems.reduce((s, c) => s + c.qty, 0);
  const ready = blocking === 0 && addCount > 0;

  const printings = (n) => `${n} printing${n === 1 ? '' : 's'}`;
  const ctaLabel = blocking > 0
    ? `Choose a set for ${blocking} more`
    : `Add ${printings(addCount)}${skipCount ? ` · skipping ${skipCount}` : ''}`;

  const setForAllOptions = [...new Set((draft.needsChoice || []).flatMap((r) => r.sets.map((s) => s.code)))]
    .sort((a, b) => setRank(a) - setRank(b));

  return { rows, commitItems, addCount, copies, skipCount, blocking, ready, ctaLabel, setForAllOptions };
}

/**
 * SET FOR ALL: choose `setCode` for every row where the card is printed in that set AND the set
 * supports the row's target finish (P6). Rows the set cannot satisfy keep their current choice and
 * stay unresolved. Returns the NEW choices map (pure - the caller sets state).
 */
export function applySetForAll(draft, ui, setCode) {
  const next = { ...(ui.choices || {}) };
  for (const row of draft.needsChoice || []) {
    const t = rowTarget(row, ui.batchFinish === 'foil' ? 'foil' : 'nonFoil', (ui.overrides || {})[row.key]);
    if (!t.finish) continue;
    if (rowOptions(row, t.finish).some((o) => o.code === setCode)) next[row.key] = setCode;
  }
  return next;
}
