package com.sadkinglabs.compendium.scanner

import android.content.Intent
import android.content.pm.PackageManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.sadkinglabs.compendium.scanner.match.CardIndex
import com.sadkinglabs.compendium.scanner.match.Catalog
import com.getcapacitor.Logger
import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.session.RequestRegistry
import com.sadkinglabs.compendium.scanner.session.ScanSessionGate
import java.util.concurrent.ConcurrentHashMap

/**
 * Bridge for the native card scanner. `scan()` builds the match index from the JS-
 * supplied catalog, launches the full-screen [ScannerActivity], and keeps the call
 * alive: add-actions arrive as repeated `"scanAction"` events (scanner stays open),
 * while `codex` / `cancelled` (or a permission reject) resolve/reject the call once.
 * JS owns all DB writes - this plugin never touches the app database.
 */
@CapacitorPlugin(name = "CardScanner")
class CardScannerPlugin : Plugin() {

    @Volatile private var pendingCall: PluginCall? = null   // set on a worker thread, read on terminal
    // One scan at a time, settled exactly once. Kept together in a tested gate because their ORDER is the
    // subtle part: a session must be declared open before any fallible startup, or a failure has nothing to
    // close and the scanner wedges.
    private val gate = ScanSessionGate()

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val has = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        call.resolve(JSObject().put("available", has))
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        if (!gate.tryAcquire()) {
            // A launch is refused whenever a scan is active - including while the FIRST one is still
            // starting up. Treating "no Activity yet" as a stale flag raced legitimate startup: the
            // matcher builds on a background thread before the Activity exists, so a fast second launch
            // could cancel the first call and let two sessions overwrite the same shared channel.
            // Sessions now end deterministically (ScannerActivity.onStop/onDestroy), so a stuck flag is
            // no longer the failure mode this guarded against.
            call.reject("A scan is already in progress", "busy")
            return
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            gate.abandon()
            call.reject("No camera available", "no_camera")
            return
        }
        val cards = Catalog.parse(call.getArray("cards"))
        if (cards.isEmpty()) {
            gate.abandon()
            call.reject("Empty catalog", "empty_catalog")
            return
        }
        val threshold = call.getDouble("threshold") ?: 0.80
        val minStreak = call.getInt("minStreak") ?: 2
        val mode = call.getString("mode") ?: "universal"

        // Deck mode: seed the live per-card deck counts (cardId -> qty) so the sheet
        // can cap the quantity stepper at the remaining copy headroom.
        val counts = ConcurrentHashMap<String, Int>()
        call.getObject("deckCounts")?.let { obj ->
            val keys = obj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                counts[k] = obj.optInt(k, 0)
            }
        }

        // The resolved reduced-motion preference, so the reveal shows still states.
        val reduceMotion = call.getBoolean("reduceMotion") ?: false
        // JS owns the session id: native never invents one, so an ack can always be attributed to the
        // session that actually issued the request.
        val sessionId = call.getString("sessionId") ?: ""

        // Build the index off the caller thread, then hand off + launch. Any failure in here MUST
        // release `active`, or one bad startup would make the scanner unlaunchable for the whole session.
        // The session is opened and the call retained BEFORE the fallible work below, so a failure in
        // index building or launching always has an open session (and a retained call) to settle. The
        // previous order did the opposite: a throw after a completed scan hit a terminal that had already
        // been consumed, so nothing was resolved and the scanner could never be launched again.
        gate.open()
        pendingCall = call
        call.setKeepAlive(true)
        Thread {
          try {
            val matcher = Matcher(CardIndex(cards), threshold)
            ScannerChannel.matcher = matcher
            ScannerChannel.minStreak = minStreak
            ScannerChannel.mode = mode
            ScannerChannel.deckCounts = counts
            ScannerChannel.reduceMotion = reduceMotion
            ScannerChannel.sessionId = sessionId
            ScannerChannel.requests = RequestRegistry(sessionId)
            ScannerChannel.onEvent = { js -> notifyListeners("scanAction", js) }
            ScannerChannel.onTerminal = { js -> resolveOnce(js) }
            val act = activity ?: run { resolveOnce(JSObject().put("action", "cancelled")); return@Thread }
            act.runOnUiThread {
                act.startActivity(Intent(act, ScannerActivity::class.java))
            }
          } catch (t: Throwable) {
            Logger.error("CardScanner: scanner startup failed", t)
            resolveOnce(JSObject().put("action", "cancelled"))
          }
        }.start()
    }

    /**
     * JS acknowledges a scanner write. Native treats this as the ONLY evidence a write happened: the
     * result sheet reports success and deck headroom from here, never from having merely emitted the
     * request. Unknown ids and foreign sessions are dropped by the registry.
     */
    @PluginMethod
    fun respond(call: PluginCall) {
        val session = call.getString("sessionId") ?: ""
        val requestId = call.getString("requestId") ?: ""
        val ok = call.getBoolean("ok") ?: false
        val deckCount = if (call.getData().has("deckCount")) call.getInt("deckCount") else null
        ScannerChannel.deliverAck(session, requestId, ok, deckCount)
        call.resolve()
    }

    private fun resolveOnce(js: JSObject) {
        if (!gate.close()) return
        val call = pendingCall
        pendingCall = null
        if (call != null) {
            when (js.getString("action")) {
                "permission_denied" -> call.reject(js.getString("message") ?: "Camera permission denied", "permission_denied")
                "no_camera" -> call.reject("No camera available", "no_camera")
                else -> call.resolve(js)
            }
        }
        ScannerChannel.clear()
    }
}
