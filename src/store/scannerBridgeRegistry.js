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
     * Gate an inbound request. [fingerprint] (optional) binds a resolved id to its operation, so a
     * REUSED id carrying a different operation is a collision, not a legit replay.
     *  - resolved, same fingerprint -> { action: 'replay', ack }   (answer with the stored ack; no re-work)
     *  - resolved, different fp     -> { action: 'reject', reason: 'id-reuse-collision' }
     *  - pending duplicate          -> { action: 'ignore' }        (a response is already coming)
     *  - mutation blocked           -> { action: 'reject', reason: 'mutation-in-flight' }
     *  - otherwise                  -> { action: 'accept' }        (caller does the work, then resolve())
     */
    admit(requestId, isMutation = false, fingerprint = null) {
      if (resolved.has(requestId)) {
        const prev = resolved.get(requestId);
        if (fingerprint != null && prev.fingerprint != null && fingerprint !== prev.fingerprint) {
          return { action: 'reject', reason: 'id-reuse-collision' };
        }
        return { action: 'replay', ack: prev.ack };
      }
      if (pending.has(requestId)) return { action: 'ignore' };
      if (isMutation && mutationInFlight) return { action: 'reject', reason: 'mutation-in-flight' };
      pending.set(requestId, { isMutation: !!isMutation, fingerprint });
      if (isMutation) mutationInFlight = true;
      return { action: 'accept' };
    },

    /** Record the terminal ack for an accepted request and free the mutation slot. */
    resolve(requestId, ack) {
      const p = pending.get(requestId);
      if (p === undefined) return;   // resolving something not pending (double-resolve) -> ignore
      pending.delete(requestId);
      resolved.set(requestId, { ack, fingerprint: p.fingerprint });
      if (p.isMutation) mutationInFlight = false;
    },

    /** Teardown (session end / WebView reload): forget everything; later acks are meaningless. */
    clear() { pending.clear(); resolved.clear(); mutationInFlight = false; },

    stats() { return { pending: pending.size, resolved: resolved.size, mutationInFlight }; },
  };
}
