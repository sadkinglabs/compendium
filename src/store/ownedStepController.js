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
//   notify(reason): void         surface a failure to the user ("Couldn't save; count restored")
//   isAlive(): boolean           false after unmount / card change, to drop a late reconcile
//   onChange(state): void        re-render hook - called after every state mutation
export function createOwnedStepController({ read, write, notify = () => {}, isAlive = () => true, onChange = () => {} }) {
  let confirmedQty = 0;
  let pendingDelta = 0;
  let pendingCount = 0;
  let error = false;
  let failedInChain = false;
  let version = 0; // bumped per tap; a reconcile bound to an older version is stale

  const displayed = () => Math.max(0, confirmedQty + pendingDelta);
  const getState = () => ({ confirmedQty, pendingDelta, pendingCount, error, displayed: displayed() });
  const emit = () => onChange(getState());

  async function reconcile(forVersion) {
    let snap = null;
    let readFailed = false;
    try { snap = await read(); } catch { readFailed = true; }
    // Discard a stale reconcile: unmounted, a new write is in flight now (pendingCount>0),
    // or one began+finished during our read (version drifted). Any of these means the chain
    // is no longer drained and this snapshot predates the current optimistic state.
    if (!isAlive() || pendingCount !== 0 || version !== forVersion) return;

    // A FAILED authoritative read is not a confirmation. Clearing pendingDelta here would
    // snap the display back to the pre-write value even though the write itself succeeded -
    // silently showing stale data. Instead keep the provisional value (our best estimate of
    // storage), flag it, and let the next successful init() - driven by the collection
    // broadcast - confirm it.
    if (readFailed || typeof snap !== 'number') {
      error = true;
      if (failedInChain) { failedInChain = false; notify('save-failed'); }
      emit();
      return;
    }

    confirmedQty = snap;
    pendingDelta = 0;
    if (failedInChain) { error = true; failedInChain = false; notify('save-failed'); }
    else { error = false; }
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
