package com.sadkinglabs.compendium.telemetry

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fault-injection tests for the consent machine. Run: `gradlew :app:testReleaseUnitTest`
 *
 * WHY THESE EXIST
 *
 * Review found two defects - deletion not awaited before enabling, and SDK failures
 * swallowed before persisting - and both lived in paths that could not be reached
 * without a device failing on cue. Device probes showed the happy path passing and told
 * us nothing about the rest. These tests reach every one of those paths, and several of
 * them fail against the implementation that shipped to review.
 *
 * The rule under test throughout: a transition may FAIL, but it may never LIE. Recording
 * `denied` while an SDK kept collecting is the one outcome this feature exists to prevent.
 */

/**
 * THE FAKE THAT HID THE BUG.
 *
 * A previous version modelled deleteUnsentReports() as "request accepted == reports
 * gone". That is exactly the assumption the real SDK does NOT make - the deletion is
 * async and unobservable - so the tests written to prove the fix were structurally
 * incapable of failing on the race the fix was for. The green ticks were then cited as
 * evidence. Review caught it; the fake did not, because the fake had the bug in it.
 *
 * So deletion here is DEFERRED by construction: requesting it does nothing until
 * [landDeletion] is called. A test that wants the deletion to have happened must say so,
 * which means a test that forgets is a test that fails.
 */
private class FakeSdk(
    var available: Boolean = true,
    var analyticsFails: Boolean = false,
    var crashlyticsFails: Boolean = false,
    var deleteFails: Boolean = false,
    var resetFails: Boolean = false,
    /** null models "cannot determine" - which must be treated as "reports remain". */
    var unsentReportsUndeterminable: Boolean = false,
    reportsOnDisk: Boolean = true,
) : TelemetrySdk {
    val calls = mutableListOf<String>()
    var analyticsEnabled: Boolean? = null
    var crashlyticsEnabled: Boolean? = null

    private var reports = reportsOnDisk       // what is actually on disk
    private var deletionRequested = false     // requested, NOT yet performed

    /** The async deletion finally executes. Nothing else makes reports disappear. */
    fun landDeletion() { if (deletionRequested) { reports = false; deletionRequested = false } }
    /** The process died before Crashlytics got round to it. */
    fun dropPendingDeletion() { deletionRequested = false }

    override fun isAvailable() = available
    override fun setAnalyticsEnabled(enabled: Boolean): Boolean {
        calls += "analytics=$enabled"
        if (analyticsFails) return false
        analyticsEnabled = enabled; return true
    }
    override fun setCrashlyticsEnabled(enabled: Boolean): Boolean {
        calls += "crashlytics=$enabled"
        if (crashlyticsFails) return false
        crashlyticsEnabled = enabled; return true
    }
    override fun resetAnalyticsData(): Boolean { calls += "reset"; return !resetFails }

    override fun deleteUnsentReports(): Boolean {
        calls += "delete"
        if (deleteFails) return false
        deletionRequested = true      // request only. See the class comment.
        return true
    }

    override fun hasUnsentReports(): Boolean? {
        calls += "check"
        return if (unsentReportsUndeterminable) null else reports
    }
}

private class FakeStore(var stored: String = Consent.UNSET, var writeFails: Boolean = false) : ConsentStore {
    val writes = mutableListOf<String>()
    override fun read() = stored
    override fun write(value: String): Boolean {
        writes += value
        if (writeFails) return false
        stored = value; return true
    }
}

private fun machine(sdk: FakeSdk, store: FakeStore) = TelemetryMachine(sdk, store)

class TelemetryMachineTest {

    // -----------------------------------------------------------------------
    // normalise: fail-safe is the OFF direction
    // -----------------------------------------------------------------------

    @Test fun `unrecognised consent collapses to unset, never granted`() {
        for (bad in listOf(null, "", "GRANTED", "true", "yes", "denyed", "Granted")) {
            assertEquals("'$bad' must collapse to unset", Consent.UNSET, Consent.normalise(bad))
        }
        assertEquals(Consent.GRANTED, Consent.normalise("granted"))
        assertEquals(Consent.DENIED, Consent.normalise("denied"))
    }

    // -----------------------------------------------------------------------
    // BLOCKER 1: deletion must not race the enable.
    // -----------------------------------------------------------------------

    @Test fun `grant lands on granting, not granted, and never enables Crashlytics`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET)
        val r = machine(sdk, store).grant()

        assertTrue(r.ok)
        assertEquals("granted may not be claimed until the queue is PROVEN empty",
            Consent.GRANTING, store.stored)
        assertFalse("Crashlytics must not start over an unproven queue", sdk.calls.contains("crashlytics=true"))
        assertTrue("Analytics has no pending-report concept and may start", sdk.calls.contains("analytics=true"))
    }

    @Test fun `granting completes ONLY once the queue is proven empty`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET)
        val m = machine(sdk, store)
        m.grant()
        sdk.landDeletion()                      // the async deletion actually happens

        assertTrue(m.reconcile().ok)
        assertEquals(Consent.GRANTED, store.stored)
        assertEquals(true, sdk.crashlyticsEnabled)
    }

    /**
     * THE BLOCKER. The process dies before Crashlytics performs the deletion it was
     * asked for. The old design enabled Crashlytics on the next boot regardless - elapsed
     * time as a stand-in for evidence - and the pre-consent crash uploaded.
     */
    @Test fun `a deletion that never landed must NOT be enabled over`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET)
        val m = machine(sdk, store)
        m.grant()
        sdk.dropPendingDeletion()               // process died; the delete never ran

        assertTrue(m.reconcile().ok)
        assertEquals("must stay granting - the queue is NOT clear", Consent.GRANTING, store.stored)
        assertFalse("Crashlytics must NOT be enabled over a live pre-consent report",
            sdk.crashlyticsEnabled == true)
        assertTrue("and it must ask for the deletion again", sdk.calls.count { it == "delete" } >= 2)
    }

    @Test fun `granting converges - the retried deletion completes on a later boot`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET)
        val m = machine(sdk, store)
        m.grant(); sdk.dropPendingDeletion()
        m.reconcile()                           // boot 1: still dirty, re-requests
        assertEquals(Consent.GRANTING, store.stored)
        sdk.landDeletion()                      // boot 2: the retry lands
        m.reconcile()
        assertEquals(Consent.GRANTED, store.stored)
        assertEquals(true, sdk.crashlyticsEnabled)
    }

    @Test fun `cannot-determine is treated as reports-remain, never as safe`() {
        val sdk = FakeSdk(unsentReportsUndeterminable = true); val store = FakeStore(Consent.GRANTING)
        machine(sdk, store).reconcile()
        assertEquals("not knowing is not the same as knowing there are none",
            Consent.GRANTING, store.stored)
        assertFalse(sdk.crashlyticsEnabled == true)
    }

    @Test fun `the queue check only happens while Crashlytics is off`() {
        // checkForUnsentReports only reports while collection is disabled, so asking it
        // with collection on would hang or lie.
        val sdk = FakeSdk(); val store = FakeStore(Consent.GRANTING)
        machine(sdk, store).reconcile()
        val off = sdk.calls.indexOf("crashlytics=false")
        val check = sdk.calls.indexOf("check")
        assertTrue("Crashlytics must be asserted off before the check", off in 0 until check)
    }

    @Test fun `grant stays granting if the deletion could not even be requested`() {
        val sdk = FakeSdk(deleteFails = true); val store = FakeStore(Consent.UNSET)
        val r = machine(sdk, store).grant()

        assertFalse(r.ok)
        assertEquals("the decision stands; the cleanup retries next boot", Consent.GRANTING, store.stored)
        assertFalse("but nothing may be enabled over it", sdk.calls.contains("crashlytics=true"))
    }

    // -----------------------------------------------------------------------
    // BLOCKER 2: a failure must never be recorded as success.
    // -----------------------------------------------------------------------

    @Test fun `deny does NOT persist denied if Crashlytics failed to disable`() {
        val sdk = FakeSdk(crashlyticsFails = true); val store = FakeStore(Consent.GRANTED)
        val r = machine(sdk, store).deny()

        assertFalse(r.ok)
        assertEquals("Settings must keep showing ON: the change FAILED, it did not succeed quietly",
            Consent.GRANTED, store.stored)
        assertEquals(Consent.GRANTED, r.consent)
    }

    @Test fun `deny does NOT persist denied if Analytics failed to disable`() {
        val sdk = FakeSdk(analyticsFails = true); val store = FakeStore(Consent.GRANTED)
        val r = machine(sdk, store).deny()
        assertFalse(r.ok)
        assertEquals(Consent.GRANTED, store.stored)
    }

    @Test fun `deny attempts BOTH disables even when the first fails`() {
        val sdk = FakeSdk(analyticsFails = true); val store = FakeStore(Consent.GRANTED)
        machine(sdk, store).deny()
        // Short-circuiting on the first failure would leave Crashlytics collecting.
        assertTrue(sdk.calls.contains("analytics=false"))
        assertTrue("Crashlytics must still be told to stop", sdk.calls.contains("crashlytics=false"))
    }

    @Test fun `deny disables BEFORE persisting, so an interruption cannot strand a live override`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.GRANTED)
        machine(sdk, store).deny()
        val firstWrite = sdk.calls.indexOf("analytics=false")
        assertTrue("both disables precede the durable write", firstWrite == 0)
        assertEquals("crashlytics=false", sdk.calls[1])
    }

    @Test fun `deny does not claim success when the durable write fails`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.GRANTED, writeFails = true)
        val r = machine(sdk, store).deny()
        assertFalse(r.ok)
        assertEquals(Consent.GRANTED, r.consent)
    }

    @Test fun `grant does not claim success when the durable write fails`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET, writeFails = true)
        val r = machine(sdk, store).grant()
        assertFalse(r.ok)
        assertEquals(Consent.UNSET, r.consent)
        assertFalse("must not enable on a decision that was not saved", sdk.calls.contains("analytics=true"))
    }

    @Test fun `grant reports failure if Analytics will not start, but keeps the saved decision`() {
        val sdk = FakeSdk(analyticsFails = true); val store = FakeStore(Consent.UNSET)
        val r = machine(sdk, store).grant()
        assertFalse("the caller must know it did not fully take", r.ok)
        assertEquals("the decision itself is real and durable", Consent.GRANTING, store.stored)
    }

    // -----------------------------------------------------------------------
    // CONCURRENCY. Per-call threads let a double-tap interleave grant() and deny():
    // one persists `denied` while the other enables Analytics, and stored consent
    // disagrees with SDK state forever. The machine is @Synchronized and the plugin
    // funnels every call through one executor.
    // -----------------------------------------------------------------------

    @Test fun `overlapping grant and deny cannot interleave into an inconsistent state`() {
        repeat(50) {
            val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET)
            val m = machine(sdk, store)
            val start = java.util.concurrent.CountDownLatch(1)
            val done = java.util.concurrent.CountDownLatch(2)
            for (op in listOf({ m.grant() }, { m.deny() })) {
                Thread { start.await(); try { op() } finally { done.countDown() } }.start()
            }
            start.countDown()
            assertTrue(done.await(5, java.util.concurrent.TimeUnit.SECONDS))

            // Whichever won, the two must not be half-applied against each other.
            val end = m.consent()
            assertTrue("end state must be a real state, not a mix: $end",
                end == Consent.GRANTING || end == Consent.DENIED)
            if (end == Consent.DENIED) {
                assertFalse("denied must never leave Analytics enabled - that is the privacy lie",
                    sdk.analyticsEnabled == true)
            }
            assertFalse("neither path may enable Crashlytics without proving the queue is clear",
                sdk.crashlyticsEnabled == true)
        }
    }

    @Test fun `concurrent reconciles cannot double-complete a grant`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET)
        val m = machine(sdk, store)
        m.grant(); sdk.landDeletion()
        val start = java.util.concurrent.CountDownLatch(1)
        val done = java.util.concurrent.CountDownLatch(4)
        repeat(4) { Thread { start.await(); try { m.reconcile() } finally { done.countDown() } }.start() }
        start.countDown()
        assertTrue(done.await(5, java.util.concurrent.TimeUnit.SECONDS))
        assertEquals(Consent.GRANTED, store.stored)
        assertEquals(1, store.writes.count { it == Consent.GRANTED })
    }

    // -----------------------------------------------------------------------
    // reconcile: assert, never assume
    // -----------------------------------------------------------------------

    @Test fun `unset boot disables both and deletes`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.UNSET)
        assertTrue(machine(sdk, store).reconcile().ok)
        assertEquals(false, sdk.analyticsEnabled)
        assertEquals(false, sdk.crashlyticsEnabled)
        assertTrue("a crash captured before consent must never survive to be sent", sdk.calls.contains("delete"))
    }

    @Test fun `denied boot disables both and retries the deletion`() {
        val sdk = FakeSdk(); val store = FakeStore(Consent.DENIED)
        assertTrue(machine(sdk, store).reconcile().ok)
        assertEquals(false, sdk.analyticsEnabled)
        assertEquals(false, sdk.crashlyticsEnabled)
        assertTrue("an interrupted deny's cleanup is retried here", sdk.calls.contains("delete"))
    }

    @Test fun `a corrupt consent value boots disabled, not enabled`() {
        val sdk = FakeSdk(); val store = FakeStore("garbage")
        val r = machine(sdk, store).reconcile()
        assertEquals(Consent.UNSET, r.consent)
        assertEquals(false, sdk.crashlyticsEnabled)
    }

    @Test fun `reconcile reports failure rather than pretending the SDKs agree`() {
        val sdk = FakeSdk(crashlyticsFails = true); val store = FakeStore(Consent.DENIED)
        assertFalse(machine(sdk, store).reconcile().ok)
    }

    // -----------------------------------------------------------------------
    // A config-less clone is fail-CLOSED. That is not the same as a FAILED transition,
    // and swallowing both identically is what review caught.
    // -----------------------------------------------------------------------

    @Test fun `no Firebase - grant refuses rather than claiming diagnostics are on`() {
        val sdk = FakeSdk(available = false); val store = FakeStore(Consent.UNSET)
        val r = machine(sdk, store).grant()
        assertFalse(r.ok)
        assertEquals(Consent.UNSET, store.stored)
    }

    @Test fun `no Firebase - deny still records the refusal, and it is honest`() {
        val sdk = FakeSdk(available = false); val store = FakeStore(Consent.UNSET)
        val r = machine(sdk, store).deny()
        assertTrue("nothing is collecting and nothing can: the refusal is true", r.ok)
        assertEquals(Consent.DENIED, store.stored)
    }

    @Test fun `no Firebase - reconcile is a no-op that does not touch absent SDKs`() {
        val sdk = FakeSdk(available = false); val store = FakeStore(Consent.GRANTED)
        assertTrue(machine(sdk, store).reconcile().ok)
        assertTrue("must not call into an SDK that is not there", sdk.calls.isEmpty())
    }
}
