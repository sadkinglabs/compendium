package com.sadkinglabs.compendium.scanner.session

/**
 * Native-side correlation of OUTBOUND scanner requests to their inbound acknowledgements
 * (proposal §4). Pure (no Capacitor), so the idempotency rules are unit-testable; the plugin glue is
 * a thin shell over this. Enforces: at most ONE mutation in flight, dedupe-while-pending, and
 * dropping any ack for an unknown request or a foreign session (stale). Cleared on teardown.
 */
class RequestRegistry(private val sessionId: String) {

    enum class Kind { READ, MUTATION }
    enum class Admit { ACCEPTED, DUPLICATE_PENDING, MUTATION_IN_FLIGHT, STALE_SESSION }

    // insertion-ordered so "is a mutation pending" is a simple scan
    private val pending = LinkedHashMap<String, Kind>()

    /** Register an outbound request. */
    fun submit(reqSession: String, requestId: String, kind: Kind): Admit = when {
        reqSession != sessionId -> Admit.STALE_SESSION
        pending.containsKey(requestId) -> Admit.DUPLICATE_PENDING
        kind == Kind.MUTATION && hasMutationInFlight() -> Admit.MUTATION_IN_FLIGHT
        else -> { pending[requestId] = kind; Admit.ACCEPTED }
    }

    /** Route an inbound ack. Returns true iff it matched a live pending request for THIS session;
     *  an ack for an unknown requestId or a foreign session is dropped. */
    fun ack(reqSession: String, requestId: String): Boolean {
        if (reqSession != sessionId) return false
        return pending.remove(requestId) != null
    }

    fun hasMutationInFlight(): Boolean = pending.containsValue(Kind.MUTATION)

    fun pendingCount(): Int = pending.size

    /** Teardown (activity destroy / session end): forget everything; later acks are dropped. */
    fun clear() = pending.clear()
}
