package com.sadkinglabs.compendium.scanner.session

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The scanner must be launchable again after ANY outcome - success, cancellation, or a startup that threw.
 * The bug this guards against wedged the scanner permanently: a startup failure following a completed scan
 * hit a terminal that the previous session had already consumed, so nothing was settled and every later
 * launch was refused as busy.
 */
class ScanSessionGateTest {

    @Test
    fun `a normal session releases the scanner`() {
        val g = ScanSessionGate()
        assertTrue(g.tryAcquire())
        g.open()
        assertTrue("the first terminal settles the call", g.close())
        assertFalse(g.isActive())
        assertTrue("the scanner must be launchable again", g.tryAcquire())
    }

    @Test
    fun `only the first terminal settles a session`() {
        val g = ScanSessionGate()
        g.tryAcquire(); g.open()
        assertTrue(g.close())
        assertFalse("a second terminal must not resolve the call twice", g.close())
    }

    @Test
    fun `a second launch is refused while one is active - including during startup`() {
        val g = ScanSessionGate()
        assertTrue(g.tryAcquire())
        // Startup is still running: no Activity exists yet, but the session IS taken. Treating this as
        // "stale" previously let a fast second launch cancel the first and run two sessions at once.
        assertFalse("startup must count as active", g.tryAcquire())
        g.open()
        assertFalse(g.tryAcquire())
    }

    @Test
    fun `successful session then a startup failure still leaves the scanner launchable`() {
        val g = ScanSessionGate()

        // 1. a complete, ordinary scan
        assertTrue(g.tryAcquire()); g.open()
        assertTrue(g.close())

        // 2. the next launch throws during startup - AFTER the session was opened, which is the whole
        //    point of opening before fallible work: the failure has a live session to close.
        assertTrue(g.tryAcquire())
        g.open()
        assertTrue("the failure must settle the call it opened", g.close())

        // 3. and the scanner is usable again
        assertTrue("a bad startup must not wedge the scanner for the rest of the app run", g.tryAcquire())
        assertFalse(g.isActive().not())
    }

    @Test
    fun `a failure before the session opens releases it and settles nothing`() {
        val g = ScanSessionGate()
        assertTrue(g.tryAcquire())
        // Rejected early (no camera, empty catalog): nothing was retained, so nothing must be resolved.
        g.abandon()
        assertFalse(g.isActive())
        assertFalse("there is no open session to settle", g.close())
        assertTrue(g.tryAcquire())
    }

    @Test
    fun `a first-ever launch that fails still settles its own call`() {
        // The other half of the original defect: on the very first launch the terminal flag happened to
        // allow a resolve, but the call had not been retained yet - so the JS promise hung for ever.
        val g = ScanSessionGate()
        assertTrue(g.tryAcquire())
        g.open()                       // retained + opened before anything fallible
        assertTrue(g.close())
        assertTrue(g.tryAcquire())
    }
}
