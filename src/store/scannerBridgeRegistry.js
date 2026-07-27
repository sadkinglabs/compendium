// The JS side of the scanner bridge's idempotency (proposal §4). The ScannerSessionCoordinator owns
// one of these per session; it dedupes requests while pending, REPLAYS the original acknowledgement
// for a resolved duplicate (never re-committing), and enforces at most one mutation in flight. Pure -
// no Capacitor, no DOM - so the load-bearing idempotency rules are unit-testable (npm run test:query).
//
// This is only the bookkeeping. The coordinator resolves the profile from the JS-owned sessionId
// (never a value echoed by native), validates the target, performs the domain work, and then calls
// `resolve(requestId, ack, isMutation)` with the AUTHORITATIVE ack it will send back via
// CardScanner.respond. A request that arrives for an already-resolved id is answered by replaying that
// stored ack.

/**
 * @returns a registry: admit() to gate an inbound request, resolve() when work commits, clear() on
 *          teardown. Terminal acks live in `resolved` so a duplicate can be answered without re-work.
 */
export function createScannerRegistry() {
  const pending = new Map();    // requestId -> isMutation
  const resolved = new Map();   // requestId -> the ack that was (or will be) sent
  let mutationInFlight = false;

  return {
    /**
     * Gate an inbound request.
     *  - already resolved   -> { action: 'replay', ack }      (answer with the stored ack; no re-work)
     *  - pending duplicate  -> { action: 'ignore' }           (a response is already coming)
     *  - mutation blocked   -> { action: 'reject', reason }   (one mutation in flight)
     *  - otherwise          -> { action: 'accept' }           (caller performs the work, then resolve())
     */
    admit(requestId, isMutation = false) {
      if (resolved.has(requestId)) return { action: 'replay', ack: resolved.get(requestId) };
      if (pending.has(requestId)) return { action: 'ignore' };
      if (isMutation && mutationInFlight) return { action: 'reject', reason: 'mutation-in-flight' };
      pending.set(requestId, !!isMutation);
      if (isMutation) mutationInFlight = true;
      return { action: 'accept' };
    },

    /** Record the terminal ack for an accepted request and free the mutation slot. */
    resolve(requestId, ack) {
      const isMutation = pending.get(requestId);
      if (isMutation === undefined) return;   // resolving something not pending (double-resolve) -> ignore
      pending.delete(requestId);
      resolved.set(requestId, ack);
      if (isMutation) mutationInFlight = false;
    },

    /** Teardown (session end / WebView reload): forget everything; later acks are meaningless. */
    clear() { pending.clear(); resolved.clear(); mutationInFlight = false; },

    stats() { return { pending: pending.size, resolved: resolved.size, mutationInFlight }; },
  };
}
