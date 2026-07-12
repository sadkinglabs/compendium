package com.sadkinglabs.compendium.scanner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.getcapacitor.JSObject
import com.sadkinglabs.compendium.scanner.model.Phase
import com.sadkinglabs.compendium.scanner.model.Recognition
import com.sadkinglabs.compendium.scanner.ui.CompendiumScannerTheme
import com.sadkinglabs.compendium.scanner.ui.ScannerScreen

/**
 * The full-screen scanner. A plain ComponentActivity hosting Compose; it requests the
 * CAMERA permission, renders [ScannerScreen], and reports outcomes back to the plugin
 * through [ScannerChannel] (add-actions stream; codex / cancelled / permission_denied
 * are terminal). Never touches the app DB - JS owns every write.
 */
class ScannerActivity : ComponentActivity() {

    private val vm: ScannerViewModel by viewModels()
    private var terminalSent = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Launched without a built matcher (process death / bad launch) - bail cleanly.
        if (ScannerChannel.matcher == null) {
            finish()
            return
        }

        // Snapshot once - the mode is fixed for this scan session.
        val collectionMode = ScannerChannel.mode == "collection"
        val deckMode = ScannerChannel.mode == "deck"

        setContent {
            CompendiumScannerTheme {
                var granted by remember {
                    mutableStateOf(
                        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                            PackageManager.PERMISSION_GRANTED,
                    )
                }
                // On deny (incl. permanent), leave granted=false so PermissionPrompt shows
                // its rationale + Close, rather than dead-ending on a black screen; the
                // Activity reports 'cancelled' when the user closes it (onDestroy).
                val launcher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission(),
                ) { ok -> granted = ok }
                LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }

                val phase by vm.phase.collectAsStateWithLifecycle()
                val lockEvent by vm.lockEvent.collectAsStateWithLifecycle()
                val lastTick = remember { longArrayOf(0L) }
                // Haptics: a light tick while a new card is being confirmed (debounced so
                // detection-threshold flicker doesn't buzz repeatedly), a growing pulse on lock.
                LaunchedEffect(lockEvent) {
                    if (lockEvent > 0) ScannerHaptics.lockPulse(this@ScannerActivity)
                }
                LaunchedEffect(phase) {
                    if (phase == Phase.DETECTING) {
                        val now = System.currentTimeMillis()
                        if (now - lastTick[0] > 1200L) { lastTick[0] = now; ScannerHaptics.tick(this@ScannerActivity) }
                    }
                }
                ScannerScreen(
                    granted = granted,
                    viewModel = vm,
                    collectionMode = collectionMode,
                    deckMode = deckMode,
                    onSearchCodex = { rec -> onSearchCodex(rec) },
                    onAdd = { rec, action -> onAdd(rec, action) },
                    onSaveCollection = { rec, qty, set -> onSaveCollection(rec, qty, set) },
                    onAddToDeck = { rec, qty -> onAddToDeck(rec, qty) },
                    onSaveDeck = { rec -> onShareLink(rec, "deckUrl") },
                    onImportMatch = { rec -> onShareLink(rec, "matchUrl") },
                    onDismissSheet = { vm.onDismiss() },
                    onClose = { finish() },
                )
            }
        }
    }

    private fun onSearchCodex(rec: Recognition) {
        sendTerminal(
            JSObject().put("action", "codex").put("cardId", rec.cardId).put("name", rec.title),
        )
        finish()
    }

    private fun onAdd(rec: Recognition, action: String) {
        // Emit the add to JS; the sheet stays up (sticky) so both actions can be used.
        ScannerChannel.onEvent?.invoke(
            JSObject().put("action", action).put("cardId", rec.cardId).put("name", rec.title),
        )
    }

    /** Collection mode: emit +qty owned for the recognised card, onto the chosen
     *  printing (set code) when one was picked/auto-selected. The scanner stays open
     *  (the screen dismisses the sheet) so the build-your-collection loop keeps going. */
    private fun onSaveCollection(rec: Recognition, qty: Int, set: String?) {
        val js = JSObject().put("action", "collection").put("cardId", rec.cardId).put("name", rec.title).put("qty", qty)
        if (set != null) js.put("set", set)
        ScannerChannel.onEvent?.invoke(js)
    }

    /** Deck mode: emit +qty of the recognised card to the open deck (JS files it in
     *  its home zone, rarity-capped). Set is irrelevant to a deck (name-level). The
     *  sheet already capped qty at the remaining headroom; bump the live session
     *  count so re-scanning the same card offers the reduced remainder. */
    private fun onAddToDeck(rec: Recognition, qty: Int) {
        val id = rec.cardId ?: return
        ScannerChannel.deckCounts[id] = (ScannerChannel.deckCounts[id] ?: 0) + qty
        ScannerChannel.onEvent?.invoke(
            JSObject().put("action", "deck").put("cardId", id).put("name", rec.title).put("qty", qty),
        )
    }

    /** A shared deck / match QR: hand the url to JS (which decodes + imports) and exit. */
    private fun onShareLink(rec: Recognition, action: String) {
        sendTerminal(JSObject().put("action", action).put("url", rec.url))
        finish()
    }

    private fun sendTerminal(js: JSObject) {
        if (terminalSent) return
        terminalSent = true
        ScannerChannel.onTerminal?.invoke(js)
    }

    override fun onDestroy() {
        super.onDestroy()
        // Back button / system kill without an explicit action -> cancelled, so the
        // retained `await scan()` never hangs. Guarded so it can't override a real
        // terminal already sent.
        if (!terminalSent) sendTerminal(JSObject().put("action", "cancelled"))
    }
}
