// Profile-safe serialized write queue for the INTERACTIVE Collection ledger (the
// owned_cards / card_list_entries steppers). One chain PER PERSISTED ROW, keyed by an
// opaque string the CALLER builds (see ownedRowKey / listRowKey in ownedRepository).
// switchProfile drains this queue BEFORE flipping the active profile, so pending
// visible edits settle first. Run: npm run test:query
//
// This module is a LEAF: it imports NOTHING from the repository/profile layer, because
// profileRepository imports IT (settleCollectionWrites). That is what keeps
//   profileRepository -> collectionWrites
// acyclic. Profile-binding correctness does NOT live here - the callers pass an explicit
// profileId to the profile-scoped repository writes, so a queued write mutates the
// profile it was scheduled under even if the active profile changes mid-flight. This
// queue only ORDERS writes per row and lets a profile switch WAIT for them.

const chains = {};   // rowKey -> tail Promise (recovered per write, so it never rejects)
let pending = 0;
let idle = [];       // settle() resolvers, run when pending returns to 0

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
  const result = (chains[rowKey] || Promise.resolve()).then(() => fn());
  chains[rowKey] = result.catch(() => {}).finally(finalize);
  return result;
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
}
