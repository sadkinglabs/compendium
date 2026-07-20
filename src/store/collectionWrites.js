// Profile-safe serialized write queue for the INTERACTIVE Collection ledger (the
// owned_cards / card_list_entries steppers). One chain PER PERSISTED ROW, keyed by an
// opaque string the CALLER builds (see ownedRowKey / listRowKey in ownedRepository).
// Run: npm run test:query
//
// This module is a LEAF: it imports NOTHING from the repository/profile layer, because
// profileRepository imports IT (withExclusiveCollectionWrites). That is what keeps
//   profileRepository -> collectionWrites
// acyclic. Profile-binding correctness does NOT live here - the callers pass an explicit
// profileId to the profile-scoped repository writes, so a queued write mutates the
// profile it was scheduled under even if the active profile changes mid-flight.
//
// Two coordination levels, and the difference matters:
//   - enqueueWrite                    ORDERS writes per row (one chain per persisted row)
//   - withExclusiveCollectionWrites   EXCLUDES all row writes for the duration of a command
// Draining proves the queue was idle a moment ago and grants nothing about the next
// instant, so anything that reads-then-writes - a bulk command, a profile flip - needs the
// barrier, not a drain.
//
// ADMITTED vs PARKED. The barrier turns on a distinction that does not exist without it:
//   - ADMITTED work started before exclusivity was claimed. The holder MUST wait for it.
//   - PARKED work arrived after the gate closed. The holder must NOT wait for it, because
//     it is waiting for the holder - counting it would make the holder wait on something
//     that waits on the holder, a deadlock broken only by a timeout.
// The two are tracked by separate counters on purpose. `pending` is every outstanding
// write and answers "is the queue globally quiet" (settleCollectionWrites). `admitted` is
// only work the holder is genuinely blocked behind, and answers "may the holder run yet".
// Conflating them is what makes a barrier look correct while being a 4-second deadlock.

const chains = {};   // rowKey -> tail Promise (recovered per write, so it never rejects)
let pending = 0;     // ALL outstanding writes, admitted or parked - the global "is it quiet"
let admitted = 0;    // writes past the admission gate and unfinished - the holder's drain
let idle = [];       // settleCollectionWrites resolvers, run when `pending` returns to 0
let admittedIdle = [];   // holder-drain resolvers, run when `admitted` returns to 0
let admissionClosed = false;
let parked = [];     // release callbacks for writes waiting to be admitted
let exclusiveTail = Promise.resolve();   // serializes exclusive holders against each other

function finalizePending() {
  if (--pending === 0) { const waiters = idle; idle = []; waiters.forEach((f) => f()); }
}
function finalizeAdmitted() {
  if (--admitted === 0) { const waiters = admittedIdle; admittedIdle = []; waiters.forEach((f) => f()); }
}

/**
 * Reopen admission and admit every parked write SYNCHRONOUSLY.
 *
 * The counter is raised before any release callback runs, and before control can return to
 * a waiting holder. If parked writes instead became admitted on a microtask, the next
 * exclusive holder could close admission and observe `admitted === 0` while those writes
 * were about to run - it would hold a barrier that excludes nothing.
 */
function openAdmission() {
  admissionClosed = false;
  const list = parked;
  parked = [];
  admitted += list.length;
  for (const release of list) release();
}

/**
 * Serialize `fn` after any prior write on `rowKey`. The RETURNED promise reflects fn's
 * success/failure so a caller can reconcile immediately; the internal row tail is
 * `.catch`-recovered so one rejection can't wedge the next write, and because `result`
 * is chained through that recovered tail it is handled even if the caller ignores it
 * (no unhandled rejection). The finalizers run on the recovered tail, so their own
 * promises never reject either.
 * @param {string} rowKey  one key per persisted row (caller-built; includes the profile)
 * @param {() => Promise<any>} fn  a profile-bound repository write
 */
export function enqueueWrite(rowKey, fn) {
  pending++;
  // Admission is decided HERE, synchronously, so the holder's drain can never include a
  // write that arrived after the holder claimed the barrier.
  let admitGate;
  if (admissionClosed) {
    admitGate = new Promise((release) => { parked.push(release); });
  } else {
    admitted++;
    admitGate = Promise.resolve();
  }
  const prev = chains[rowKey] || Promise.resolve();   // already failure-recovered
  const result = admitGate.then(() => prev).then(() => fn());
  chains[rowKey] = result.catch(() => {}).finally(finalizeAdmitted).finally(finalizePending);
  return result;
}

/** Resolve true when admitted work is done, false if it did not finish within `timeoutMs`. */
function drainAdmitted(timeoutMs) {
  if (admitted === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const settle = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const i = admittedIdle.indexOf(onIdle);
      if (i >= 0) admittedIdle.splice(i, 1);
      resolve(ok);
    };
    const onIdle = () => settle(true);
    admittedIdle.push(onIdle);
    timer = setTimeout(() => settle(false), timeoutMs);
  });
}

/**
 * Run `fn` with EXCLUSIVE ownership of the Collection write queue: work already in flight
 * drains first, and no new row write may run until `fn` settles.
 *
 * This exists because a bulk command computes absolute after-values from an authoritative
 * read. Without exclusivity a per-row write can commit between that read and the bulk
 * transaction, and the bulk write then overwrites it - an atomic transaction that still
 * silently loses a concurrent edit.
 *
 * Holders are serialized against one another, so a profile switch and a bulk command cannot
 * interleave. `fn`'s rejection propagates to the caller but never wedges the queue.
 *
 * Timeout tolerance is NOT a parameter. There are exactly two semantics and they are two
 * exported functions, so the tolerant path cannot be reached by passing an option - a caller
 * has to name it. See withProfileSwitchWriteBarrier for the single legitimate use.
 */
function runExclusive(fn, timeoutMs, failClosed) {
  const run = exclusiveTail.then(async () => {
    admissionClosed = true;
    try {
      const drained = await drainAdmitted(timeoutMs);
      if (!drained && failClosed) throw new Error('Collection write barrier: timed out draining in-flight writes');
      return await fn();
    } finally {
      openAdmission();
    }
  });
  exclusiveTail = run.then(() => {}, () => {});
  return run;
}

/**
 * The barrier for anything that READS THEN WRITES the Collection ledger - every bulk
 * command, and anything added later with the same shape.
 *
 * FAILS CLOSED. If admitted work does not drain within `timeoutMs` the barrier was never
 * achieved, so `fn` does NOT run and the caller is rejected. Proceeding on a timeout would
 * mean running an "exclusive" read-and-write alongside an active writer, which is the exact
 * corruption the barrier exists to prevent - a hung storage operation must cost the user a
 * failed command, never a silently lost edit.
 */
export function withExclusiveCollectionWrites(fn, { timeoutMs = 4000 } = {}) {
  return runExclusive(fn, timeoutMs, true);
}

/**
 * The barrier for a profile switch, and ONLY for a profile switch. This is the sole tolerant
 * holder: if the drain times out it proceeds anyway.
 *
 * That is safe here and nowhere else. A switch does not read-then-write the ledger, and
 * queued writes carry an explicit profileId, so a hung write still commits under the profile
 * it was scheduled for whatever the active id becomes - the drain preserves an edit's
 * visibility, not its correctness. Failing closed would let a hung storage operation trap the
 * user in a profile for no safety gain.
 *
 * If you are reaching for this because a command is timing out, you want the other function
 * and a real fix.
 */
export function withProfileSwitchWriteBarrier(fn, { timeoutMs = 4000 } = {}) {
  return runExclusive(fn, timeoutMs, false);
}

/**
 * Resolve when the queue is idle. Counts parked work too: a write held behind a barrier is
 * still outstanding, and reporting the queue as quiet while an edit waits to run would be a
 * lie to whoever is about to act on that claim.
 *
 * Bounded by `timeoutMs` so a permanently-hung storage operation can never freeze a caller;
 * a timed-out waiter removes itself from the idle set (and clears its timer) rather than
 * lingering until the hung op completes.
 */
export function settleCollectionWrites(timeoutMs = 4000) {
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false, timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const i = idle.indexOf(finish);
      if (i >= 0) idle.splice(i, 1);
      resolve();
    };
    idle.push(finish);
    timer = setTimeout(finish, timeoutMs);
  });
}

/** Test-only: the queue is a module singleton; reset it between fixtures. */
export function __resetCollectionWritesForTests() {
  for (const k of Object.keys(chains)) delete chains[k];
  pending = 0;
  admitted = 0;
  idle = [];
  admittedIdle = [];
  admissionClosed = false;
  parked = [];
  exclusiveTail = Promise.resolve();
}
