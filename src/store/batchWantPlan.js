// The whole-paste wishlist draft, as pure data (brief §3.2). The ResolvePrintingsSheet drives this
// and holds only React state; every decision - which set a row can take, what finish it files at,
// whether it is skipped, whether Confirm is allowed, the final printing count - is computed here so
// it is provable without a DOM.
//
// THE UNIFYING IDEA (Codex increment-5 Major 1). Every recognized line is a ROW with a set that is
// either FIXED (the line named it, or the card has one set) or a CHOICE the user must make. Finish
// is NOT decided at resolve time - the batch finish governs every row unless the line carried an
// explicit [Foil] lock. So a `Card [Beta]` line follows the Finish for all control; a foil-only set
// files forced foil; a Foil batch over a set with no foil visibly SKIPS the row. A fixed set never
// exempts a row from that policy.
//
// Rules that must not regress (each cost a review round on this branch):
//   - Nothing defaults to a silent set (a choice row with no set BLOCKS Confirm).
//   - Finish is never downgraded (P3): foil-only files forced foil; a Foil batch skips a no-foil
//     row visibly and reversibly, never files it non-foil; an impossible [Foil] lock demands an
//     explicit non-foil / skip.
//   - A want is NEVER uncategorised (no Unspecified option, unlike the owned import).
//   - The final printing count is CANONICAL: rows that converge on one (card, set, finish) are one
//     printing, their quantities summed (Codex Major 3).

/** Numeric-code set order (001 < 002 < 999); a non-numeric code sinks last. Production injects the
 *  real SET_RANK so the two never drift; the default keeps this module catalog-free. */
const defaultSetRank = (code) => (code && /^\d+$/.test(code) ? parseInt(code, 10) : Number.MAX_SAFE_INTEGER);

/**
 * A row's TARGET finish before per-set resolution, from the batch finish, its [Foil] lock, and any
 * per-row override for an impossible lock.
 *   { finish: 'nonFoil'|'foil'|null, forcedByLock, needLockChoice, skip }
 */
export function rowTarget(row, batchFinish, override) {
  if (row.lockedFinish === 'foil') {
    if (row.anyFoil) return { finish: 'foil', forcedByLock: true };
    if (override === 'nonFoil') return { finish: 'nonFoil', wasImpossibleLock: true };
    if (override === 'skip') return { finish: null, skip: true };
    return { finish: null, needLockChoice: true };
  }
  return { finish: batchFinish === 'foil' ? 'foil' : 'nonFoil' };
}

/**
 * The set options a row can take at a target finish. Each option names the finish it FILES at:
 *   - target foil: only sets that support foil.
 *   - target non-foil: sets that support non-foil, PLUS foil-only sets (which file forced foil).
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

// Process one row (fixed or choice) against the current UI state into a rendered row + its commit.
function processRow(row, batchFinish, choices, overrides) {
  const fixed = row.fixedSet != null;
  const base = { ...row, fixed };
  const t = rowTarget(row, batchFinish, overrides[row.key]);
  if (t.needLockChoice) return { ...base, status: 'lockImpossible', options: [], forcedFoil: false, commit: null };
  if (t.skip) return { ...base, status: 'lockSkip', options: [], forcedFoil: false, commit: null };

  const options = rowOptions(row, t.finish);
  if (t.finish === 'foil' && !options.length) return { ...base, status: 'skipNoFoil', options, forcedFoil: false, commit: null };

  const chosenCode = fixed ? row.fixedSet : (choices[row.key] || null);
  const opt = chosenCode ? options.find((o) => o.code === chosenCode) : null;
  if (!opt) {
    // A fixed set that cannot meet the target finish is a foil-batch over a no-foil set: skip it,
    // visibly. A choice row with no set yet blocks Confirm.
    if (fixed) return { ...base, status: 'skipNoFoil', options, forcedFoil: false, commit: null };
    return { ...base, status: 'unchosen', options, forcedFoil: false, commit: null };
  }
  return {
    ...base, status: 'chosen', options, forcedFoil: !!opt.forced, effectiveFoil: opt.foil,
    commit: { cardId: row.cardId, set: opt.code, foil: opt.foil, qty: row.qty, parts: row.parts },
  };
}

/**
 * Compute the full draft VIEW for a UI state - the single source the sheet renders and the CTA
 * gates on.
 *
 * @param draft { fixed:[row], needsChoice:[row], unknown, flagged }  (a row carries its per-set
 *              finish availability, fixedSet|null, lockedFinish, key, name, qty, parts)
 * @param ui    { batchFinish:'nonFoil'|'foil', choices:{[key]:setCode}, overrides:{[key]:'nonFoil'|'skip'} }
 */
export function planWantDraft(draft, ui = {}, setRank = defaultSetRank) {
  const batchFinish = ui.batchFinish === 'foil' ? 'foil' : 'nonFoil';
  const choices = ui.choices || {};
  const overrides = ui.overrides || {};

  const fixedRows = (draft.fixed || []).map((r) => processRow(r, batchFinish, choices, overrides));
  const choiceRows = (draft.needsChoice || []).map((r) => processRow(r, batchFinish, choices, overrides));
  const rows = [...fixedRows, ...choiceRows];

  // CANONICAL merge: rows that land on the same (card, set, finish) are ONE printing; quantities
  // (parts) concatenate. addCount and commitItems both derive from the merged plan, so the CTA
  // count matches what the repository returns.
  const merged = new Map();
  for (const r of rows) {
    if (!r.commit) continue;
    const k = `${r.commit.cardId}|${r.commit.set}|${r.commit.foil ? 1 : 0}`;
    const ex = merged.get(k);
    if (ex) ex.parts.push(...r.commit.parts);
    else merged.set(k, { cardId: r.commit.cardId, set: r.commit.set, foil: r.commit.foil, parts: [...r.commit.parts] });
  }
  const mergedCommits = [...merged.values()];
  // Expand parts so each contribution reaches addWantedItemsBulk within its per-item 999 bound.
  const commitItems = mergedCommits.flatMap((c) => c.parts.map((qty) => ({ cardId: c.cardId, set: c.set, foil: c.foil, qty })));

  const skipCount = rows.filter((r) => r.status === 'skipNoFoil' || r.status === 'lockSkip').length;
  const blocking = rows.filter((r) => r.status === 'unchosen' || r.status === 'lockImpossible').length;
  const addCount = mergedCommits.length;                             // canonical collector items
  const copies = commitItems.reduce((s, c) => s + c.qty, 0);
  const ready = blocking === 0 && addCount > 0;

  const printings = (n) => `${n} printing${n === 1 ? '' : 's'}`;
  const ctaLabel = blocking > 0
    ? `Choose a set for ${blocking} more`
    : `Add ${printings(addCount)}${skipCount ? ` · skipping ${skipCount}` : ''}`;

  // The finish control governs any recognized line that is NOT explicitly [Foil]-locked.
  const finishGoverns = [...(draft.fixed || []), ...(draft.needsChoice || [])].some((r) => r.lockedFinish == null);

  // SET FOR ALL is over the CHOICE rows only (fixed rows already have a set). A set is "pressed"
  // when every choice row that could take it currently has it.
  const codes = [...new Set((draft.needsChoice || []).flatMap((r) => r.sets.map((s) => s.code)))]
    .sort((a, b) => setRank(a) - setRank(b));
  const setForAll = codes.map((code) => {
    const eligible = (draft.needsChoice || []).filter((r) => {
      const t = rowTarget(r, batchFinish, overrides[r.key]);
      return t.finish && rowOptions(r, t.finish).some((o) => o.code === code);
    });
    const pressed = eligible.length > 0 && eligible.every((r) => choices[r.key] === code);
    return { code, pressed };
  });

  return {
    fixedRows, choiceRows, rows, commitItems, addCount, copies, skipCount, blocking, ready, ctaLabel,
    finishGoverns, setForAll, setForAllOptions: setForAll.map((s) => s.code),
  };
}

/**
 * SET FOR ALL: choose `setCode` for every CHOICE row where the card is printed in that set AND the
 * set supports the row's target finish (P6). Fixed rows are untouched. Returns the NEW choices map.
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
