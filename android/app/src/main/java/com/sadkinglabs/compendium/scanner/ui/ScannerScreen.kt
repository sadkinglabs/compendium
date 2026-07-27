package com.sadkinglabs.compendium.scanner.ui

import androidx.camera.view.PreviewView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
    reduceMotion: Boolean,
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

    // ONE presentation clock (0->1 over 800ms) keyed to each lock, shared by the overlay reveal
    // AND the result tray so they are staged on a single timeline instead of drifting apart.
    // Reduced motion snaps to the settled end-state.
    val reveal = remember { Animatable(0f) }
    LaunchedEffect(lockEvent) {
        if (lockEvent > 0) {
            if (reduceMotion) reveal.snapTo(1f)
            else { reveal.snapTo(0f); reveal.animateTo(1f, tween(800)) }
        }
    }
    val revealT = reveal.value

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
            CameraOverlay(phase, sheet, reduceMotion, revealT)
        } else {
            PermissionPrompt(onClose)
        }

        val rec = sheet
        if (rec != null) {
            val key = rec.cardId ?: rec.url ?: rec.title
            // Tap anywhere outside the sheet to dismiss (the sheet swallows its own taps).
            Box(Modifier.fillMaxSize().pointerInput(key) { detectTapGestures { onDismissSheet() } })
            RecognitionCard(
                rec = rec,
                collectionMode = collectionMode,
                deckMode = deckMode,
                reveal = revealT,
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

        // Close (exit scanner) - the app's language: a gold X in a round button, TOP-RIGHT.
        // Drawn last so it stays tappable above the dismiss scrim. The reveal status text is
        // offset below this corner so the two never conflict.
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(8.dp)
                .size(48.dp)   // architectural touch-target floor (OD-15)
                .clip(CircleShape)
                .background(Color(0x59000000))
                .border(1.dp, PillarGold.copy(alpha = 0.45f), CircleShape)
                .clickable(onClick = onClose)
                .semantics { contentDescription = "Close scanner" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Close, contentDescription = null, tint = PillarGold, modifier = Modifier.size(22.dp))
        }

        SnackbarHost(
            snackbarHost,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(bottom = 8.dp),
        )
    }
}
