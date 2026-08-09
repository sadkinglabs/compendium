package com.sadkinglabs.compendium.scanner.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The write-acknowledgement contract, at the layer that owns it.
 *
 * The rule that matters: an unacknowledged write is UNCONFIRMED, not failed. JS may well have committed
 * it, so the registry must keep holding the mutation - a second write cannot be admitted while the first
 * outcome is unknown, and a late acknowledgement must still be routed rather than dropped.
 */
class WriteAckContractTest {

    private val session = "scan-1"
    private fun registry() = RequestRegistry(session)

    @Test
    fun `a timed-out write still holds the mutation, so a second one cannot slip in`() {
        val reg = registry()
        assertEquals(RequestRegistry.Admit.ACCEPTED, reg.submit(session, "req-1", RequestRegistry.Kind.MUTATION))

        // Six seconds pass with no acknowledgement. The UI reports "may not have saved" and releases, but
        // NOTHING has told the registry the write is over - because nothing knows that it is.
        assertTrue("the mutation must still be considered in flight", reg.hasMutationInFlight())
        assertEquals(
            "a second write must be refused while the first outcome is unknown",
            RequestRegistry.Admit.MUTATION_IN_FLIGHT,
            reg.submit(session, "req-2", RequestRegistry.Kind.MUTATION),
        )
    }

    @Test
    fun `a late acknowledgement is still routed and then frees the next write`() {
        val reg = registry()
        reg.submit(session, "req-1", RequestRegistry.Kind.MUTATION)

        // The acknowledgement arrives after the UI gave up waiting: it is the authoritative outcome and
        // must be delivered, so a success can correct an "unconfirmed" rather than being discarded.
        assertTrue("a late ack must still match its request", reg.ack(session, "req-1"))
        assertFalse(reg.hasMutationInFlight())
        assertEquals(RequestRegistry.Admit.ACCEPTED, reg.submit(session, "req-2", RequestRegistry.Kind.MUTATION))
    }

    @Test
    fun `an acknowledgement is never delivered twice`() {
        val reg = registry()
        reg.submit(session, "req-1", RequestRegistry.Kind.MUTATION)
        assertTrue(reg.ack(session, "req-1"))
        assertFalse("a duplicate ack must not re-report an outcome", reg.ack(session, "req-1"))
    }

    @Test
    fun `an acknowledgement from another session is ignored`() {
        val reg = registry()
        reg.submit(session, "req-1", RequestRegistry.Kind.MUTATION)
        assertFalse(reg.ack("some-other-scan", "req-1"))
        assertTrue("the real request must remain outstanding", reg.hasMutationInFlight())
    }

    @Test
    fun `a reused request id is a collision, not a retry`() {
        val reg = registry()
        reg.submit(session, "req-1", RequestRegistry.Kind.MUTATION)
        reg.ack(session, "req-1")
        assertEquals(
            RequestRegistry.Admit.REUSED_ID,
            reg.submit(session, "req-1", RequestRegistry.Kind.MUTATION),
        )
    }

    @Test
    fun `teardown drops later acknowledgements`() {
        val reg = registry()
        reg.submit(session, "req-1", RequestRegistry.Kind.MUTATION)
        reg.clear()
        assertFalse("an ack after teardown belongs to nothing", reg.ack(session, "req-1"))
        assertNotEquals(RequestRegistry.Admit.MUTATION_IN_FLIGHT, reg.submit(session, "req-2", RequestRegistry.Kind.MUTATION))
    }
}
