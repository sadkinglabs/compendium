package com.sadkinglabs.compendium.scanner.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RequestRegistryTest {

    private val S = "session-1"
    private fun reg() = RequestRegistry(S)

    @Test fun accepts_a_new_request() {
        assertEquals(RequestRegistry.Admit.ACCEPTED, reg().submit(S, "r1", RequestRegistry.Kind.READ))
    }

    @Test fun drops_a_duplicate_while_pending() {
        val r = reg()
        r.submit(S, "r1", RequestRegistry.Kind.READ)
        assertEquals(RequestRegistry.Admit.DUPLICATE_PENDING, r.submit(S, "r1", RequestRegistry.Kind.READ))
    }

    @Test fun allows_only_one_mutation_in_flight_but_reads_alongside() {
        val r = reg()
        assertEquals(RequestRegistry.Admit.ACCEPTED, r.submit(S, "m1", RequestRegistry.Kind.MUTATION))
        assertEquals(RequestRegistry.Admit.MUTATION_IN_FLIGHT, r.submit(S, "m2", RequestRegistry.Kind.MUTATION))
        assertEquals(RequestRegistry.Admit.ACCEPTED, r.submit(S, "read1", RequestRegistry.Kind.READ))
        assertTrue(r.hasMutationInFlight())
    }

    @Test fun a_new_mutation_is_allowed_after_the_previous_one_is_acked() {
        val r = reg()
        r.submit(S, "m1", RequestRegistry.Kind.MUTATION)
        assertTrue(r.ack(S, "m1"))
        assertFalse(r.hasMutationInFlight())
        assertEquals(RequestRegistry.Admit.ACCEPTED, r.submit(S, "m2", RequestRegistry.Kind.MUTATION))
    }

    @Test fun rejects_a_foreign_session_request() {
        assertEquals(RequestRegistry.Admit.STALE_SESSION, reg().submit("other", "r1", RequestRegistry.Kind.READ))
    }

    @Test fun ack_matches_a_pending_request_and_removes_it() {
        val r = reg()
        r.submit(S, "r1", RequestRegistry.Kind.READ)
        assertTrue(r.ack(S, "r1"))
        assertEquals(0, r.pendingCount())
        assertFalse("second ack for the same id no longer matches", r.ack(S, "r1"))
    }

    @Test fun drops_ack_for_unknown_request_or_foreign_session() {
        val r = reg()
        r.submit(S, "r1", RequestRegistry.Kind.READ)
        assertFalse(r.ack(S, "unknown"))
        assertFalse(r.ack("other", "r1"))
        assertEquals(1, r.pendingCount())
    }

    @Test fun clear_forgets_everything() {
        val r = reg()
        r.submit(S, "m1", RequestRegistry.Kind.MUTATION)
        r.clear()
        assertEquals(0, r.pendingCount())
        assertFalse(r.hasMutationInFlight())
        assertFalse("an ack after teardown is dropped", r.ack(S, "m1"))
    }
}
