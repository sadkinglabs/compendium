package com.sorcerycompendium.compendium.scanner

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
import com.sorcerycompendium.compendium.scanner.model.Phase
import com.sorcerycompendium.compendium.scanner.model.RecognisedCard
import com.sorcerycompendium.compendium.scanner.ui.CompendiumScannerTheme
import com.sorcerycompendium.compendium.scanner.ui.ScannerScreen

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

        setContent {
            CompendiumScannerTheme {
                var granted by remember {
                    mutableStateOf(
                        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                            PackageManager.PERMISSION_GRANTED,
                    )
                }
                val launcher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission(),
                ) { ok ->
                    granted = ok
                    if (!ok) {
                        sendTerminal(JSObject().put("action", "permission_denied").put("message", "Camera permission denied"))
                        finish()
                    }
                }
                LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }

                val phase by vm.phase.collectAsStateWithLifecycle()
                val lockEvent by vm.lockEvent.collectAsStateWithLifecycle()
                // Haptics: a light tick while a new card is being confirmed, a growing
                // pulse on each lock (lockEvent bumps per recognition).
                LaunchedEffect(lockEvent) {
                    if (lockEvent > 0) ScannerHaptics.lockPulse(this@ScannerActivity)
                }
                LaunchedEffect(phase) {
                    if (phase == Phase.DETECTING) ScannerHaptics.tick(this@ScannerActivity)
                }
                ScannerScreen(
                    granted = granted,
                    viewModel = vm,
                    onSearchCodex = { card -> onSearchCodex(card) },
                    onAdd = { card, action -> onAdd(card, action) },
                    onDismissSheet = { vm.onDismiss() },
                    onClose = { finish() },
                )
            }
        }
    }

    private fun onSearchCodex(card: RecognisedCard) {
        sendTerminal(
            JSObject().put("action", "codex").put("cardId", card.id).put("name", card.name),
        )
        finish()
    }

    private fun onAdd(card: RecognisedCard, action: String) {
        // Emit the add to JS; the sheet stays up (sticky) so both actions can be used.
        ScannerChannel.onEvent?.invoke(
            JSObject().put("action", action).put("cardId", card.id).put("name", card.name),
        )
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
