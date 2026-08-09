package com.sadkinglabs.compendium.scanner

import com.getcapacitor.JSObject
import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.session.RequestRegistry
import com.sadkinglabs.compendium.scanner.visual.VisualMatcher
import java.util.concurrent.ConcurrentHashMap

/**
 * In-process handoff between the Capacitor plugin (which owns the retained
 * PluginCall + built matcher) and the launched [ScannerActivity]. Passing the
 * ~1104-row catalog through Intent extras would risk TransactionTooLargeException,
 * so the Intent carries nothing and the Activity reads the matcher from here.
 */
object ScannerChannel {
    @Volatile var matcher: Matcher? = null
    @Volatile var minStreak: Int = 2

    /** Lazy loader for the visual-match fallback (DINOv2-small int8 + prototype index), set by the
     *  Activity (it owns the AssetManager). The ViewModel calls it once, off-thread, only if the user
     *  taps "Try visual match" - so the ~27MB model/index never load unless the fallback is used. */
    @Volatile var visualLoader: (() -> VisualMatcher)? = null

    /** Persist a user correction (an L2-normalised query embedding + the confirmed card) so the on-device
     *  hardening survives across sessions. Set by the Activity (it owns filesDir); stores the VECTOR, never
     *  the photo. Null-safe: if unset, hardening is in-memory only. */
    @Volatile var userProtoSink: ((entries: List<com.sadkinglabs.compendium.scanner.visual.CorrectionStore.Entry>) -> Unit)? = null

    /** Scanner mode: "universal" (Home/Decks - identify, then Codex / +1 collection /
     *  wishlist / deck / match) or "collection" (a focused build-your-collection loop:
     *  identify -> pick a quantity -> Add -> keep scanning). */
    @Volatile var mode: String = "universal"

    /** The open deck's name in deck mode, so a confirmation can say WHICH deck a card went to. */
    @Volatile var deckName: String = ""

    /** Deck mode: the open deck's per-card counts (cardId -> qty across all zones).
     *  Seeded from JS at scan start and incremented as deck-adds stream this session,
     *  so the recognition sheet can gate "add N" at (card limit − already in deck)
     *  and re-scanning a card sees the reduced headroom. Concurrent: written on the
     *  UI thread (add), read on the analysis thread (Recognition build). */
    @Volatile var deckCounts: MutableMap<String, Int> = ConcurrentHashMap()

    /** The resolved app-wide reduced-motion preference (user setting OR OS preference),
     *  passed in at scan start so the reveal can substitute deterministic still states. */
    @Volatile var reduceMotion: Boolean = false

    /** Streaming add-actions (collection / wishlist) -> plugin.notifyListeners. The
     *  Activity stays open and keeps scanning. */
    @Volatile var onEvent: ((JSObject) -> Unit)? = null

    // --- Write acknowledgement (proposal S4) ---------------------------------------------------
    // JS owns the session id and every durable write. Native therefore may not claim success: it
    // correlates each outbound mutation with the acknowledgement JS sends back once the write has
    // actually committed, and the UI reports only what has been acknowledged.

    /** The JS-owned session id for this scan. Acks carrying any other id are foreign and dropped. */
    @Volatile var sessionId: String = ""

    /** Correlates outbound requests with inbound acks: one mutation in flight, dedupe, id-reuse reject. */
    @Volatile var requests: RequestRegistry? = null

    /** Set by the Activity; invoked when JS acknowledges a request (ok, plus any authoritative state). */
    @Volatile var onAck: ((requestId: String, ok: Boolean, deckCount: Int?) -> Unit)? = null

    /** Route an inbound acknowledgement from JS. Ignores unknown ids and foreign sessions. */
    fun deliverAck(session: String, requestId: String, ok: Boolean, deckCount: Int?) {
        val reg = requests ?: return
        if (!reg.ack(session, requestId)) return          // unknown request or stale session
        onAck?.invoke(requestId, ok, deckCount)
    }

    /** Terminal outcome (codex / cancelled / permission_denied) -> resolve/reject the
     *  retained call EXACTLY once. */
    @Volatile var onTerminal: ((JSObject) -> Unit)? = null

    fun clear() {
        requests?.clear()
        requests = null
        sessionId = ""
        onAck = null
        matcher = null
        visualLoader = null
        userProtoSink = null
        onEvent = null
        onTerminal = null
        mode = "universal"
        deckName = ""
        deckCounts = ConcurrentHashMap()
        reduceMotion = false
    }
}
