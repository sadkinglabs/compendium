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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

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
    private val terminated = AtomicBoolean(false)
    private val active = AtomicBoolean(false)               // one scan at a time - guards the retained call

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val has = context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
        call.resolve(JSObject().put("available", has))
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        if (!active.compareAndSet(false, true)) {
            // A previous session that never delivered its terminal (process death, a swiped-away task,
            // an Activity that could not reach onDestroy) would otherwise make the scanner permanently
            // unlaunchable - the user sees "Scanner error" for ever with no way back. If no scanner
            // Activity is alive, the flag is stale: reclaim it rather than refusing.
            if (ScannerActivity.isAlive()) {
                android.util.Log.i("ScannerVisual", "scan refused: a scanner is still alive")
                call.reject("A scan is already in progress", "busy")
                return
            }
            Logger.warn("CardScanner: stale active flag with no live scanner - reclaiming")
            resolveOnce(JSObject().put("action", "cancelled"))
            active.set(true)
            terminated.set(false)
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            active.set(false)
            call.reject("No camera available", "no_camera")
            return
        }
        val cards = Catalog.parse(call.getArray("cards"))
        if (cards.isEmpty()) {
            active.set(false)
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

        // Build the index off the caller thread, then hand off + launch.
        Thread {
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
            terminated.set(false)
            pendingCall = call
            call.setKeepAlive(true)
            val act = activity ?: run { resolveOnce(JSObject().put("action", "cancelled")); return@Thread }
            act.runOnUiThread {
                act.startActivity(Intent(act, ScannerActivity::class.java))
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
        if (!terminated.compareAndSet(false, true)) return
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
        active.set(false)
    }
}
