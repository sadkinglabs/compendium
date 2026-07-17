// The optimistic-goal drain lifecycle for ListDetail. Tracks in-flight goal writes and,
// when they all settle, reconciles the visible goals from the authoritative store - BUT
// ONLY if no newer write began since that reconcile was requested. Without that guard a
// slow reconcile can resolve after a fresh tap and overwrite (regress) the optimistic
// value - the exact rapid-tap flicker Stage C exists to remove. Pure and injectable so
// the race is deterministically testable. Run: npm run test:ui
//
//   read():  Promise<snapshot>   authoritative goals
//   apply(snapshot): void        install the snapshot into the optimistic mirror + state
//   isAlive(): boolean           false after unmount / list change, to drop a late apply
export function createGoalDrain({ read, apply, isAlive = () => true }) {
  let pending = 0;
  let version = 0;   // bumped per scheduled write; a reconcile bound to an older version is stale
  async function drain(forVersion) {
    const snap = await read();
    // Discard a stale snapshot: the drain was cancelled (unmounted / list changed), OR a
    // write is in flight now (pending > 0), OR one began and finished during our read
    // (version drifted). Any of these means `snap` predates the current optimistic state.
    if (!isAlive() || pending !== 0 || version !== forVersion) return;
    apply(snap);
  }
  return {
    /** Track a goal write; when the queue drains, request a reconcile for THIS version. */
    track(p) {
      version++;
      pending++;
      Promise.resolve(p).catch(() => {}).finally(() => { pending -= 1; if (pending === 0) drain(version); });
    },
    /** Test/introspection: in-flight write count. */
    pending: () => pending,
  };
}
