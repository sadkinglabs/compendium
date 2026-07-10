package com.sorcerycompendium.compendium.scanner.ui

import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sorcerycompendium.compendium.scanner.ScannerViewModel
import com.sorcerycompendium.compendium.scanner.camera.CameraController
import com.sorcerycompendium.compendium.scanner.model.RecognisedCard
import kotlinx.coroutines.launch

/**
 * The full-screen scanner UI: live CameraX preview, the alignment overlay (colour driven
 * by phase + lockEvent), and the sticky recognition card ([ScannerViewModel.sheet]) with
 * a sparkle flourish + Snackbar. Tapping anywhere outside the sheet dismisses it.
 */
@Composable
fun ScannerScreen(
    granted: Boolean,
    viewModel: ScannerViewModel,
    onSearchCodex: (RecognisedCard) -> Unit,
    onAdd: (RecognisedCard, String) -> Unit,
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
            val context = LocalContext.current
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
            CameraOverlay(phase, lockEvent)
        } else {
            PermissionPrompt(onClose)
        }

        val card = sheet
        if (card != null) {
            // Tap anywhere outside the sheet to dismiss (the sheet swallows its own taps).
            Box(Modifier.fillMaxSize().pointerInput(card.id) { detectTapGestures { onDismissSheet() } })
            SparkleBurst(card.id, Modifier.fillMaxSize())
            RecognitionCard(
                card = card,
                onSearchCodex = { onSearchCodex(card) },
                onAddCollection = {
                    onAdd(card, "collection")
                    scope.launch { snackbarHost.showSnackbar("Added ${card.name} to your collection") }
                },
                onAddWishlist = {
                    onAdd(card, "wishlist")
                    scope.launch { snackbarHost.showSnackbar("Added ${card.name} to your wishlist") }
                },
                onDismiss = onDismissSheet,
                modifier = Modifier.align(Alignment.BottomCenter),
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
                    .padding(start = 10.dp, top = 60.dp, end = 10.dp)
                    .background(Color(0xAA000000))
                    .padding(6.dp),
            )
        }

        // Close (exit scanner) - drawn last so it stays tappable above the dismiss scrim.
        TextButton(
            onClick = onClose,
            modifier = Modifier.align(Alignment.TopStart).padding(8.dp),
        ) { Text("Close", color = Color.White) }

        SnackbarHost(
            snackbarHost,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
        )
    }
}
