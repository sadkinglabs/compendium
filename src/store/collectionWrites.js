// Profile-safe serialized write queue for the INTERACTIVE Collection ledger (the
// owned_cards / card_list_entries steppers). One chain PER PERSISTED ROW, keyed by an
// opaque string the CALLER builds (see ownedRowKey / listRowKey in ownedRepository).
// switchProfile drains this queue BEFORE flipping the active profile, so pending
// visible edits settle first. Run: npm run test:query
//
// This module is a LEAF: it imports NOTHING from the repository/profile layer, because
// profileRepository imports IT (withExclusiveCollectionWrites). That is what keeps
//   profileRepository -> collectionWrites
// acyclic. Profile-binding correctness does NOT live here - the callers pass an explicit
// profileId to the profile-scoped repository writes, so a queued write mutates the
// profile it was scheduled under even if the active profile changes mid-flight.
//
// The queue offers two coordination levels, and the difference matters:
//   - enqueueWrite            ORDERS writes per row (one chain per persisted row)
//   - withExclusiveCollectionWrites  EXCLUDES all row writes for the duration of a command
// Draining (settleCollectionWrites) proves the queue was idle a moment ago and grants
// nothing about the next instant, so anything that reads-then-writes - a bulk command, a
// profile flip - needs the barrier, not the drain.

const chains = {};   // rowKey -> tail Promise (recovered per write, so it never rejects)
let pending = 0;
let idle = [];       // settle() resolvers, run when pending returns to 0
let exclusive = null;             // held (non-null) while an exclusive holder owns the queue
let exclusiveTail = Promise.resolve();   // serializes exclusive holders against each other

function finalize() {
  if (--pending === 0) { const waiters = idle; idle = []; waiters.forEach((f) => f()); }
}

/**
 * Serialize `fn` after any prior write on `rowKey`. The RETURNED promise reflects fn's
 * success/failure so a caller can reconcile immediately; the internal row tail is
 * `.catch`-recovered so one rejection can't wedge the next write, and because `result`
 * is chained through that recovered tail it is handled even if the caller ignores it
 * (no unhandled rejection). `finalize` runs on the recovered tail, so its own promise
 * never rejects either.
 * @param {string} rowKey  one key per persisted row (caller-built; includes the profile)
 * @param {() => Promise<any>} fn  a profile-bound repository write
 */
export function enqueueWrite(rowKey, fn) {
  pending++;
  // The gate is read AT ENQUEUE TIME. That is what makes exclusivity a barrier rather than a
  // settle: a write arriving while a bulk command holds the queue captures the holder's
  // promise here and waits behind it, instead of slipping into the drain the holder is
  // waiting on. Both `prev` and `gate` are already failure-recovered, so this never rejects.
  const prev = chains[rowKey] || Promise.resolve();
  const gate = exclusive || Promise.resolve();
  const result = Promise.all([prev, gate]).then(() => fn());
  chains[rowKey] = result.catch(() => {}).finally(finalize);
  return result;
}

/**
 * Run `fn` with EXCLUSIVE ownership of the Collection write queue: existing queued writes
 * drain first, and no new row write may run until `fn` settles.
 *
 * This exists because a bulk command computes absolute after-values from an authoritative
 * read. Without exclusivity, a per-row write can commit between that read and the bulk
 * transaction, and the bulk write then overwrites it - an atomic transaction that still
 * silently loses a concurrent edit. Draining alone is not enough: `settleCollectionWrites`
 * only waits for the queue to reach idle, and grants nothing about what happens next.
 *
 * The order below is the whole point. Exclusivity is claimed BEFORE the drain, so any write
 * enqueued during the drain sees a held gate and queues behind us. Reversing those two lines
 * reintroduces exactly the race this function exists to close.
 *
 * Holders are serialized against one another, so a profile switch and a bulk command cannot
 * interleave. `fn`'s rejection is propagated to the caller but never wedges the queue.
 */
export function withExclusiveCollectionWrites(fn, timeoutMs = 4000) {
  const run = exclusiveTail.then(async () => {
    let release;
    exclusive = new Promise((r) => { release = r; });
    try {
      await settleCollectionWrites(timeoutMs);   // drain work queued BEFORE we claimed the gate
      return await fn();
    } finally {
      exclusive = null;
      release();
    }
  });
  exclusiveTail = run.then(() => {}, () => {});
  return run;
}

/**
 * Resolve when the queue is idle. Bounded by `timeoutMs` so a permanently-hung storage
 * operation can never freeze a profile switch; a timed-out waiter removes itself from
 * the idle set (and clears its timer) rather than lingering until the hung op completes.
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
  idle = [];
  exclusive = null;
  exclusiveTail = Promise.resolve();
}
