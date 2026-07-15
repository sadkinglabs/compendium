// Match statistics - the ONE calculation, kept pure so both callers share it and so it
// can be tested without a database. Run: npm run test:query
//
// THE BUG THIS EXISTS TO KILL
// `avgMin` divided by EVERY match while summing only the timed ones. A match recorded by
// hand has no duration, so it contributed 0 seconds to the numerator and 1 to the
// denominator - dragging the average toward zero. Ten tracked 30-minute matches plus ten
// manual ones reported 15: a number describing no match anyone played. The statistic did
// not merely lose precision, it got *more wrong the more the app was used as intended*.
//
// WHY THIS MODULE EXISTS AT ALL
// The same numbers were computed TWICE, independently: once in playRepository's
// historyStats() and once inline in the Play hub, which is the one people actually look
// at. Fixing either alone leaves the other wrong - and the visible one was not the one
// the repository owned. Two implementations of one idea drift; that is what happened, and
// the fix is one function, not two patches.
//
// UNTIMED IS NOT ZERO-LENGTH
// A match of zero seconds cannot occur: the live tracker writes elapsed time and no user
// means "it lasted no time". So `> 0` reads correctly over every row ever written, and
// no migration is needed:
//   duration_sec  > 0   -> timed
//   duration_sec <= 0   -> untimed (historical - the old writers coerced unknown to 0)
//   duration_sec  null  -> untimed (current - the column has always been nullable)

/**
 * The one duration writer-side guard. Everything that persists duration_sec goes through
 * this: recordMatch, addManualMatch, updateMatch, the import path, and the manual form.
 *
 * Scattered `?? null` at each call site is how the writers drifted apart in the first
 * place - and `|| 0` was worse than a bad default: it DESTROYED the distinction between
 * "untimed" and "zero" before it ever reached a column that has always been nullable.
 *
 * Absent, empty, unparseable, negative, and zero all mean the same thing - we do not know
 * how long it took - and they all become null, because that is what the column is for.
 * The empty-string case is not hypothetical: it is what a cleared number input yields.
 */
export function normalizeDurationSec(value) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // Math.max(1, ...) is the contract, not a nicety. Testing positivity BEFORE rounding
  // let 0.4 through the guard and then rounded it to 0 - a value this function promises
  // never to return, and which every reader defines as UNTIMED. A sub-second duration is
  // real time that was measured; it must not be silently reclassified as unmeasured.
  return Math.max(1, Math.round(seconds));
}

// The form-side contract, next to the writer-side one so the two cannot drift. Minutes
// are what a person types; seconds are what the column stores.
export const MAX_DURATION_MINUTES = 600;

// One error string for both sheets. Two copies of this sentence is how two sheets end up
// enforcing two different rules.
export const DURATION_RANGE_ERR = `Enter 1 to ${MAX_DURATION_MINUTES} minutes, or leave it empty.`;

/**
 * Is a typed minutes value acceptable? Empty is VALID - it means untimed, which is a real
 * answer and always allowed.
 *
 * This exists because `max` on a number input is advisory: it styles :invalid and stops
 * the steppers, and does nothing whatsoever about a typed 999. A limit the code does not
 * enforce is decoration.
 *
 * It validates what was TYPED, never what was stored. An existing match may legitimately
 * hold a duration beyond this bound - a tracked match whose timer ran long - and editing
 * that match's opponent name must not be blocked by a rule about form input.
 */
export function validDurationMinutes(value) {
  if (value === '' || value == null) return true;
  const mins = Number(value);
  return Number.isFinite(mins) && mins > 0 && mins <= MAX_DURATION_MINUTES;
}

/**
 * Aggregate durations over a match list. Pure; takes rows, returns numbers.
 *
 * avgSec/avgMin are NULL - never 0 - when nothing is timed. "No timed matches" and "an
 * average of zero minutes" are different statements, and a UI that cannot tell them apart
 * reprints the very conflation this module removes. Callers render null as an em dash.
 *
 * totalSec sums only timed matches, which is what it always claimed to be: untimed
 * matches contribute no known time, so they add nothing rather than adding zero.
 */
export function computeMatchStats(matches) {
  // Read through the SAME normaliser the writers use, rather than trusting the column.
  // Rows can arrive from a restored profile or a shared payload, and a raw `Infinity` or
  // a numeric string would otherwise poison every total here. One definition of "a
  // duration" on both sides of the database.
  const durations = (matches || [])
    .map((m) => normalizeDurationSec(m?.duration_sec))
    .filter((seconds) => seconds != null);
  const totalSec = durations.reduce((sum, seconds) => sum + seconds, 0);
  return {
    totalSec,
    timedCount: durations.length,
    // Divide by what we actually SUMMED. `matches.length` is not that number, and using
    // it is the entire defect.
    avgSec: durations.length ? totalSec / durations.length : null,
    avgMin: durations.length ? Math.round(totalSec / durations.length / 60) : null,
  };
}
