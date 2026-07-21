package com.sadkinglabs.compendium.scanner.ui

import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sadkinglabs.compendium.scanner.ScannerViewModel
import com.sadkinglabs.compendium.scanner.camera.CameraController
import com.sadkinglabs.compendium.scanner.model.Recognition
import kotlinx.coroutines.launch

/**
 * The full-screen scanner UI: live CameraX preview, the alignment overlay (colour driven
 * by phase + lockEvent, flashing the type accent on lock), and the sticky recognition
 * sheet ([ScannerViewModel.sheet]) - a card, a shared deck, or a shared match - with a
 * type-coloured sparkle flourish + Snackbar. Tapping anywhere outside the sheet dismisses
 * it.
 */
@Composable
fun ScannerScreen(
    granted: Boolean,
    viewModel: ScannerViewModel,
    collectionMode: Boolean,
    deckMode: Boolean,
    onSearchCodex: (Recognition) -> Unit,
    onAdd: (Recognition, String, String?) -> Unit,
    onSaveCollection: (Recognition, Int, String?) -> Unit,
    onAddToDeck: (Recognition, Int) -> Unit,
    onSaveDeck: (Recognition) -> Unit,
    onImportMatch: (Recognition) -> Unit,
    onDismissSheet: () -> Unit,
    onClose: () -> Unit,
) {
    val phase by viewModel.phase.collectAsStateWithLifecycle()
    val lockEvent by viewModel.lockEvent.collectAsStateWithLifecycle()
    val sheet by viewModel.sheet.collectAsStateWithLifecycle()
    val debug by viewModel.debug.collectAsStateWithLifecycle()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    Box(Modifier.fillMaxSize()) {
        if (granted) {
            val lifecycleOwner = LocalLifecycleOwner.current
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    val pv = PreviewView(ctx).apply {
                        scaleType = PreviewView.ScaleType.FIT_CENTER
                        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    }
                    CameraController.bind(
                        ctx, lifecycleOwner, pv,
                        viewModel.analysisExecutor, viewModel.analyzer,
                    ) { scope.launch { snackbarHost.showSnackbar("Couldn't start the camera - close and try again.") } }
                    pv
                },
            )
            CameraOverlay(phase, lockEvent, sheet?.let { accentFor(it.kind) } ?: PillarGold)
        } else {
            PermissionPrompt(onClose)
        }

        val rec = sheet
        if (rec != null) {
            val key = rec.cardId ?: rec.url ?: rec.title
            // Tap anywhere outside the sheet to dismiss (the sheet swallows its own taps).
            Box(Modifier.fillMaxSize().pointerInput(key) { detectTapGestures { onDismissSheet() } })
            SparkleBurst(key, accentFor(rec.kind), Modifier.fillMaxSize())
            RecognitionCard(
                rec = rec,
                collectionMode = collectionMode,
                deckMode = deckMode,
                onSearchCodex = { onSearchCodex(rec) },
                onAddCollection = { set ->
                    // Universal-mode quick +1: files onto the chosen printing (single-set
                    // auto, reprint via the picker), then stays open to keep scanning.
                    onSaveCollection(rec, 1, set)
                    scope.launch { snackbarHost.showSnackbar("Added ${rec.title} to your collection") }
                },
                onAddWishlist = { set ->
                    onAdd(rec, "wishlist", set)
                    scope.launch { snackbarHost.showSnackbar("Added ${rec.title} to your wishlist") }
                },
                onSaveCollection = { qty, set ->
                    onSaveCollection(rec, qty, set)
                    scope.launch { snackbarHost.showSnackbar("Added $qty × ${rec.title}") }
                    onDismissSheet()   // keep scanning: drop the sheet and resume
                },
                onAddToDeck = { qty ->
                    onAddToDeck(rec, qty)
                    scope.launch { snackbarHost.showSnackbar("Added $qty × ${rec.title} to the deck") }
                    onDismissSheet()   // keep scanning
                },
                onSaveDeck = { onSaveDeck(rec) },
                onImportMatch = { onImportMatch(rec) },
                onDismiss = onDismissSheet,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding(),
            )
        }

        // DEBUG: raw OCR readout per strip (TOP / R90 / R270 / L90 / L270), so you can
        // see exactly what each edge reads. Driven by GuideGeometry.showReadZones.
        if (debug.isNotEmpty()) {
            Text(
                debug,
                color = Color(0xFFB6FF7A),
                fontSize = 10.sp,
                lineHeight = 13.sp,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(start = 10.dp, top = 44.dp, end = 10.dp)
                    .background(Color(0xAA000000))
                    .padding(6.dp),
            )
        }

        // Close (exit scanner) - drawn last so it stays tappable above the dismiss scrim.
        TextButton(
            onClick = onClose,
            modifier = Modifier
                .align(Alignment.TopStart)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(8.dp),
        ) { Text("Close", color = Color.White) }

        SnackbarHost(
            snackbarHost,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(bottom = 8.dp),
        )
    }
}
