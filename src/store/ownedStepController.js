// The optimistic write controller for a single owned quantity (one card/set/field), behind
// useOwnedLedger. Pure and injectable so the durability contract is deterministically
// testable. Run: npm run test:ui
//
// Contract (Collection UX proposal §4.1 / Codex): counts are PROVISIONAL while a write is
// pending and CONFIRMED only when the durable write resolves. Displayed = confirmedQty +
// pendingDelta, clamped at 0. Reconcile ONLY when the whole row chain drains (pendingCount
// -> 0): a mid-chain failure is recorded but provisional state is NOT cleared early (later
// taps are still in flight); when the chain drains we do ONE authoritative read, replace
// confirmedQty, clear provisional state, and notify ONCE if any write in the chain failed.
// After unmount (isAlive() false) the queued write still persists, but no state is applied.
//
//   read():   Promise<number>   authoritative quantity from the store
//   write(delta): Promise       enqueue the durable, profile-bound write for this tap
//   notify(reason): void         surface a failure. Three honest outcomes:
//       'save-failed'            the write failed and the read succeeded - the count WAS restored
//       'unconfirmed'            the write succeeded but the read never did - value is provisional
//       'save-failed-unresolved' both failed - we cannot say what the stored value is
//   isAlive(): boolean           false after unmount / card change, to drop a late reconcile
//   onChange(state): void        re-render hook - called after every state mutation
//   schedule(fn, ms):            timer seam, so the retry ladder is deterministic in tests
//
// RETRY_DELAYS is the ladder walked when the authoritative READ fails after a successful
// write. Without it the row could sit provisional forever: the write's own broadcast is
// ignored while pending, so nothing guarantees another refresh ever arrives.
const RETRY_DELAYS = [300, 900, 2500];

export function createOwnedStepController({
  read, write, notify = () => {}, isAlive = () => true, onChange = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms),
}) {
  let confirmedQty = 0;
  let pendingDelta = 0;
  let pendingCount = 0;
  let error = false;
  let failedInChain = false;
  let version = 0;   // bumped per tap; a reconcile bound to an older version is stale
  // Increments ONLY on a reconciled success: the authoritative read came back AND no write in
  // the chain failed. Consumers must key "confirmed" off this, never off pendingCount hitting
  // zero - the finally block emits that intermediate state BEFORE reconcile has run, so it is
  // true for a moment even when the write rejected or the read is about to fail.
  let okVersion = 0;

  const displayed = () => Math.max(0, confirmedQty + pendingDelta);
  const getState = () => ({ confirmedQty, pendingDelta, pendingCount, error, okVersion, displayed: displayed() });
  const emit = () => onChange(getState());

  async function reconcile(forVersion, attempt = 0) {
    let snap = null;
    let readFailed = false;
    try { snap = await read(); } catch { readFailed = true; }
    // Discard a stale reconcile: unmounted, a new write is in flight now (pendingCount>0),
    // or one began+finished during our read (version drifted). Any of these means the chain
    // is no longer drained and this snapshot predates the current optimistic state.
    if (!isAlive() || pendingCount !== 0 || version !== forVersion) return;

    // A FAILED authoritative read is not a confirmation. Clearing pendingDelta here would
    // snap the display back to the pre-write value even though the write itself succeeded -
    // silently showing stale data. Keep the provisional value (our best estimate of storage),
    // mark it UNCONFIRMED, and walk a retry ladder. Recovery must not depend on some unrelated
    // future ledger mutation arriving: the write's own broadcast was ignored while pending.
    if (readFailed || typeof snap !== 'number') {
      error = true;
      emit();
      if (attempt < RETRY_DELAYS.length) {
        schedule(() => {
          if (isAlive() && pendingCount === 0 && version === forVersion) void reconcile(forVersion, attempt + 1);
        }, RETRY_DELAYS[attempt]);
      } else {
        // Ladder exhausted - stop silently carrying an unconfirmed value and say so. THREE
        // distinct outcomes, because "count restored" is only true when we could actually read
        // the store: the write failed AND we could not read it back is a different, worse
        // state than either alone, and the provisional delta is still on screen unresolved.
        notify(failedInChain ? 'save-failed-unresolved' : 'unconfirmed');
        failedInChain = false;
      }
      return;
    }

    confirmedQty = snap;
    pendingDelta = 0;
    if (failedInChain) { error = true; failedInChain = false; notify('save-failed'); }
    else { error = false; okVersion += 1; }   // the ONLY place success is declared
    emit();
  }

  return {
    /** Seed confirmedQty from an authoritative read (mount / card/set change). Ignored while
        writes are in flight, so it can't stomp an optimistic value. */
    init(qty) {
      if (pendingCount !== 0) return;
      confirmedQty = qty || 0;
      pendingDelta = 0;
      error = false;
      emit();
    },
    /** A tap: record a provisional delta and queue the durable write. */
    step(delta) {
      version++;
      pendingDelta += delta;
      pendingCount++;
      error = false; // a fresh tap clears the stale error flag
      emit();
      // Enqueue the durable write NOW (synchronously), like the shipping ledger; wrap so a
      // sync throw and an async rejection both funnel to the same failure path.
      let p;
      try { p = Promise.resolve(write(delta)); } catch (e) { p = Promise.reject(e); }
      p.catch(() => { failedInChain = true; })
        .finally(() => {
          pendingCount--;
          emit();
          if (pendingCount === 0) void reconcile(version);
        });
    },
    getState,
    displayed,
    /** Test/introspection: in-flight write count. */
    pending: () => pendingCount,
  };
}
