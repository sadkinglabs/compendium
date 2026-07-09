package com.sorcerycompendium.compendium.scanner

import com.getcapacitor.JSObject
import com.sorcerycompendium.compendium.scanner.match.Matcher

/**
 * In-process handoff between the Capacitor plugin (which owns the retained
 * PluginCall + built matcher) and the launched [ScannerActivity]. Passing the
 * ~1104-row catalog through Intent extras would risk TransactionTooLargeException,
 * so the Intent carries nothing and the Activity reads the matcher from here.
 */
object ScannerChannel {
    @Volatile var matcher: Matcher? = null
    @Volatile var minStreak: Int = 2

    /** Streaming add-actions (collection / wishlist) -> plugin.notifyListeners. The
     *  Activity stays open and keeps scanning. */
    @Volatile var onEvent: ((JSObject) -> Unit)? = null

    /** Terminal outcome (codex / cancelled / permission_denied) -> resolve/reject the
     *  retained call EXACTLY once. */
    @Volatile var onTerminal: ((JSObject) -> Unit)? = null

    fun clear() {
        matcher = null
        onEvent = null
        onTerminal = null
    }
}
