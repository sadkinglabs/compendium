// The optimistic write controller for a single owned quantity (one card/set/field), behind
// useOwnedLedger. Pure and injectable so the durability contract is deterministically
// testable. Run: npm run test:query   (src/store/** is the query suite, not the ui one)
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
//   notify(reason, cause): void  surface a failure. Three honest outcomes:
//       'save-failed'            the write failed and the read succeeded - the count WAS restored
//       'unconfirmed'            the write succeeded but the read never did - value is provisional
//       'save-failed-unresolved' both failed - we cannot say what the stored value is
//     `cause` is the REJECTION ITSELF for the two write-failure reasons, and this is the whole
//     point of passing it: a refusal is not always a malfunction. A storage conflict is the app
//     declining to guess which physical copy left, and a caller that only knows "it failed" can
//     only say "couldn't save" - which reads as a bug for behaviour that is working exactly as
//     designed. The controller stays DOM-free and renders nothing; it just stops discarding the
//     one piece of information the message needs.
//   isAlive(): boolean           false after unmount / card change, to drop a late reconcile
//   onChange(state): void        re-render hook - called after every state mutation
//   schedule(fn, ms):            timer seam, so the retry ladder is deterministic in tests
//   holdDelta(delta, displayed): boolean - GATE THE OPTIMISM, NEVER THE WRITE. See below.
//
// HOLDING A TAP. Optimism is right for a write that will succeed and wrong for one the store is
// going to refuse: the storage wall turned a minus into 1 -> 0 -> toast -> 1, so the user watched
// the app do the thing and then undo it, which reads as a bug in behaviour that is working exactly
// as designed. `holdDelta` lets a caller that can locally predict the refusal decline to paint.
//
// A HELD tap is IDENTICAL to any other in every respect except the provisional number: the version
// bumps, pendingCount rises, the durable write is enqueued, and the chain reconciles and notifies
// the same way. Only pendingDelta is left alone, so nothing moves on screen. That asymmetry is the
// whole design: the store stays the only authority, local knowledge decides presentation alone.
//   - predicted refusal that IS refused  -> no count movement at any point, one honest toast
//   - predicted refusal that SUCCEEDS    -> the prediction was stale; the drain-time authoritative
//     read moves the count once, correctly. A stale prediction costs a beat, never a lost write.
// The hook defaults to never-hold, so every consumer that does not pass one behaves as before, and
// a throwing hook is treated as "do not hold" - a broken prediction must degrade to today's paint,
// not to a silent hold.
//
// Held deltas are tracked in their own accumulator rather than left implicit, because
// confirmation.appliedDelta means "what this chain put into storage" and a held tap that succeeded
// put copies there too. A confirmation is published ONLY when no write in the chain failed, so at
// that moment every held write landed as well - which is what makes pendingDelta + heldDelta exact.
//
// RETRY_DELAYS is the ladder walked when the authoritative READ fails after a successful
// write. Without it the row could sit provisional forever: the write's own broadcast is
// ignored while pending, so nothing guarantees another refresh ever arrives.
const RETRY_DELAYS = [300, 900, 2500];

export function createOwnedStepController({
  read, write, notify = () => {}, isAlive = () => true, onChange = () => {},
  schedule = (fn, ms) => setTimeout(fn, ms), holdDelta = () => false,
}) {
  let confirmedQty = 0;
  let pendingDelta = 0;
  // Deltas whose writes are in flight but which were deliberately NOT painted (see holdDelta).
  // Kept apart from pendingDelta because that one is the display, and these must not touch it.
  let heldDelta = 0;
  let pendingCount = 0;
  let error = false;
  let failedInChain = false;
  let chainCause = null;   // the first rejection in this chain, surfaced with the notify
  let version = 0;   // bumped per tap; a reconcile bound to an older version is stale
  // Increments ONLY on a reconciled success: the authoritative read came back AND no write in
  // the chain failed. Consumers must key "confirmed" off this, never off pendingCount hitting
  // zero - the finally block emits that intermediate state BEFORE reconcile has run, so it is
  // true for a moment even when the write rejected or the read is about to fail.
  let okVersion = 0;
  // The reconciled chain result, published with each success so consumers never have to infer
  // how many copies a confirmation represents: { version, appliedDelta, confirmedQty }.
  let confirmation = null;

  const displayed = () => Math.max(0, confirmedQty + pendingDelta);
  const getState = () => ({ confirmedQty, pendingDelta, heldDelta, pendingCount, error, okVersion, confirmation, displayed: displayed() });
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
        notify(failedInChain ? 'save-failed-unresolved' : 'unconfirmed', chainCause);
        failedInChain = false;
        chainCause = null;
      }
      return;
    }

    // What this chain actually put into storage. HELD taps count: a confirmation is published only
    // when nothing in the chain failed, so every held write in it landed too. Deriving this from the
    // snapshot instead (snap - confirmedQty) was the obvious alternative and is worse - it would
    // change the number for every existing consumer even with no hold in sight, silently folding in
    // a clamped overshoot and any edit another surface made to the row mid-chain.
    const applied = pendingDelta + heldDelta;
    confirmedQty = snap;
    pendingDelta = 0;
    heldDelta = 0;
    if (failedInChain) { error = true; failedInChain = false; const cause = chainCause; chainCause = null; notify('save-failed', cause); }
    else {
      // The ONLY place success is declared - and it carries the chain's result, so no consumer
      // has to keep its own tally alongside.
      error = false;
      okVersion += 1;
      confirmation = { version: okVersion, appliedDelta: applied, confirmedQty };
    }
    emit();
  }

  return {
    /** Seed confirmedQty from an authoritative read (mount / card/set change). Ignored while
        writes are in flight, so it can't stomp an optimistic value. */
    init(qty) {
      if (pendingCount !== 0) return;
      confirmedQty = qty || 0;
      pendingDelta = 0;
      heldDelta = 0;
      error = false;
      emit();
    },
    /**
     * A tap: record a provisional delta and queue the durable write.
     *
     * The hold question is asked FIRST, before anything moves, because the prediction is about what
     * the user can currently see - `displayed()` here is the pre-tap count, so a hook works out its
     * target as `displayed + delta`.
     */
    step(delta) {
      let held = false;
      try { held = !!holdDelta(delta, displayed()); } catch { held = false; }
      version++;
      if (held) heldDelta += delta; else pendingDelta += delta;
      pendingCount++;
      error = false; // a fresh tap clears the stale error flag
      emit();
      // Enqueue the durable write NOW (synchronously), like the shipping ledger; wrap so a
      // sync throw and an async rejection both funnel to the same failure path.
      let p;
      try { p = Promise.resolve(write(delta)); } catch (e) { p = Promise.reject(e); }
      // FIRST rejection wins. Later taps in a drained chain are usually the same refusal repeated,
      // and the first one is the one the user actually caused.
      p.catch((e) => { if (!failedInChain) chainCause = e; failedInChain = true; })
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
