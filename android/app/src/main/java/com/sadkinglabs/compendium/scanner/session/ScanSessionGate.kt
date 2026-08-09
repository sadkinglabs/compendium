package com.sadkinglabs.compendium.scanner.session

import java.util.concurrent.atomic.AtomicBoolean

/**
 * One scan at a time, and every scan settles exactly once.
 *
 * Two flags that must move together, which is why they live here rather than as loose fields on the
 * plugin: `active` gates launching, and `settled` makes the FIRST terminal win so a call cannot be
 * resolved twice. Getting their order wrong is not hypothetical - a startup that failed before the
 * session was opened left `active` set for ever (every later launch refused) while the terminal was
 * swallowed because the previous session's flag was still raised.
 *
 * The rule this enforces: [open] declares the session live BEFORE any fallible startup work, so a failure
 * always has a session to close. Pure and synchronous, so the ordering is unit-testable.
 */
class ScanSessionGate {

    private val active = AtomicBoolean(false)
    private val settled = AtomicBoolean(true)   // no session yet, so nothing is awaiting a terminal

    /** Try to take the scanner. False when one is already active - including one still starting up. */
    fun tryAcquire(): Boolean = active.compareAndSet(false, true)

    /**
     * Declare the acquired session live and awaiting its terminal. MUST be called before fallible startup
     * (index building, Activity launch), so that a failure can still close what it opened.
     */
    fun open() {
        settled.set(false)
    }

    /**
     * Settle the session, running [cleanup] BEFORE the scanner is released. Returns true for the FIRST
     * terminal of an open session; false for later ones and for a session that was never opened.
     *
     * Cleanup belongs inside the lock, not after it. Releasing first left a window where the next scan
     * could acquire the gate and retain its own call, only for the previous session's teardown to resolve
     * and null it - handing the new scan the old scan's result, or wiping the matcher and callbacks it had
     * just installed. The release is in a `finally` so a throwing cleanup cannot wedge the scanner.
     */
    fun close(cleanup: () -> Unit = {}): Boolean {
        if (!settled.compareAndSet(false, true)) return false
        try {
            cleanup()
        } finally {
            active.set(false)
        }
        return true
    }

    /**
     * Release a session that was acquired but never opened - a failure between [tryAcquire] and [open].
     * Without this the scanner would be permanently unlaunchable after one bad startup.
     */
    fun abandon() {
        settled.set(true)
        active.set(false)
    }

    fun isActive(): Boolean = active.get()
}
