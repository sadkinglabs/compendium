package com.sadkinglabs.compendium.scanner.session

/**
 * Native-side correlation of OUTBOUND scanner requests to their inbound acknowledgements
 * (proposal §4). Pure (no Capacitor), so the idempotency rules are unit-testable; the plugin glue is
 * a thin shell over this. Enforces: at most ONE mutation in flight, dedupe-while-pending, rejecting
 * a REUSED request id (an id already acked this session - reuse is a collision, not a legit request),
 * and dropping any ack for an unknown request or a foreign session. Cleared on teardown.
 *
 * THREAD-SAFE by design: Compose submissions and Capacitor responses can arrive on different threads,
 * so every method is `@Synchronized` on the instance monitor.
 */
class RequestRegistry(private val sessionId: String) {

    enum class Kind { READ, MUTATION }
    enum class Admit { ACCEPTED, DUPLICATE_PENDING, REUSED_ID, MUTATION_IN_FLIGHT, STALE_SESSION }

    private val pending = LinkedHashMap<String, Kind>()   // insertion-ordered
    private val completed = HashSet<String>()             // ids acked this session (reuse -> reject)

    /** Register an outbound request. */
    @Synchronized
    fun submit(reqSession: String, requestId: String, kind: Kind): Admit = when {
        reqSession != sessionId -> Admit.STALE_SESSION
        completed.contains(requestId) -> Admit.REUSED_ID
        pending.containsKey(requestId) -> Admit.DUPLICATE_PENDING
        kind == Kind.MUTATION && hasMutationInFlightLocked() -> Admit.MUTATION_IN_FLIGHT
        else -> { pending[requestId] = kind; Admit.ACCEPTED }
    }

    /** Route an inbound ack. Returns true iff it matched a live pending request for THIS session;
     *  an ack for an unknown requestId or a foreign session is dropped. */
    @Synchronized
    fun ack(reqSession: String, requestId: String): Boolean {
        if (reqSession != sessionId) return false
        val removed = pending.remove(requestId) != null
        if (removed) completed.add(requestId)
        return removed
    }

    @Synchronized
    fun hasMutationInFlight(): Boolean = hasMutationInFlightLocked()

    @Synchronized
    fun pendingCount(): Int = pending.size

    /** Teardown (activity destroy / session end): forget everything; later acks are dropped. */
    @Synchronized
    fun clear() { pending.clear(); completed.clear() }

    private fun hasMutationInFlightLocked(): Boolean = pending.containsValue(Kind.MUTATION)
}
