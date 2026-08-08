package com.sadkinglabs.compendium.scanner.ui

import androidx.activity.compose.BackHandler
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sadkinglabs.compendium.scanner.ScannerHaptics
import com.sadkinglabs.compendium.scanner.ScannerViewModel
import com.sadkinglabs.compendium.scanner.camera.CameraController
import com.sadkinglabs.compendium.scanner.model.Recognition
import com.sadkinglabs.compendium.scanner.model.SnapCandidate
import com.sadkinglabs.compendium.scanner.model.SnapState
import kotlinx.coroutines.launch

/**
 * The pure-snapshot scanner UI (Rev 6): a live viewfinder with a gilt shutter, the captured still frozen in
 * place during the read, a text-first candidate pick-list, and the existing recognition sheet on confirm.
 * No guide frame; portrait or landscape.
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
    val snap by viewModel.snap.collectAsStateWithLifecycle()
    val still by viewModel.still.collectAsStateWithLifecycle()
    val sheet by viewModel.sheet.collectAsStateWithLifecycle()
    val searching by viewModel.searching.collectAsStateWithLifecycle()
    val lockEvent by viewModel.lockEvent.collectAsStateWithLifecycle()
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val reveal = remember(lockEvent) { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(lockEvent) { if (lockEvent > 0 && !reduceMotion) reveal.animateTo(1f, tween(650)) }
    val revealT = reveal.value

    // Back: sheet -> dismiss; mid-snapshot -> cancel; else let Back close.
    BackHandler(enabled = sheet != null) { onDismissSheet() }
    BackHandler(enabled = sheet == null && searching) { viewModel.closeSearch() }
    BackHandler(enabled = sheet == null && !searching && snap != SnapState.Ready) { viewModel.onCancelSnap() }

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
            // Frozen still: the user's own photo becomes the subject while it is read, chosen, and
            // finally stamped by the reveal.
            val frozen = still
            if ((snap != SnapState.Ready || sheet != null) && frozen != null && !frozen.isRecycled) {
                // The card crop that is actually being matched, shown whole (Fit) - what you see is what
                // it reads. A dim wash sits under any panel.
                Box(Modifier.fillMaxSize().background(Color(0xCC000000)))
                Image(
                    bitmap = frozen.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize().padding(12.dp),
                )
                // The reveal: on a confirmed identity the gilt double-rule stamps around the captured
                // card - the snapshot becomes the manuscript plate. The sheet carries the name.
                if (sheet != null) {
                    GiltStamp(
                        reveal = revealT,
                        aspect = frozen.width.toFloat() / frozen.height.toFloat(),
                        modifier = Modifier.fillMaxSize().padding(12.dp),
                    )
                }
            }
        } else {
            PermissionPrompt(onClose)
        }

        // Status line, top-centre.
        val status = when (val s = snap) {
            SnapState.Ready -> "Fill the frame with one card, portrait or landscape, then tap"
            SnapState.Capturing, SnapState.Identifying -> "Reading the card…"
            is SnapState.Shortlist -> "Couldn't be certain - pick the match"
            is SnapState.Empty -> if (s.unavailable) "Visual match unavailable" else ""
        }
        if (granted && sheet == null && status.isNotEmpty()) {
            Text(
                status, color = Color(0xFFEFE7D8), fontSize = 14.5.sp,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(top = 12.dp, start = 56.dp, end = 56.dp),
            )
        }

        // The gilt shutter, which hands over to a violet reading arc mid-capture. Hidden once a panel/sheet is up.
        val ss = snap
        if (granted && sheet == null && (ss == SnapState.Ready || ss == SnapState.Capturing || ss == SnapState.Identifying)) {
            val ctx = LocalContext.current
            ShutterButton(
                reading = ss == SnapState.Capturing || ss == SnapState.Identifying,
                reduceMotion = reduceMotion,
                onCapture = { ScannerHaptics.tick(ctx); viewModel.onShutter() },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 28.dp),
            )
        }

        // Shortlist / Empty panels (no sheet up).
        val s = snap
        if (granted && sheet == null && (s is SnapState.Shortlist || s is SnapState.Empty)) {
            SnapshotPanel(
                state = s,
                onPick = viewModel::onPickCandidate,
                onRetake = viewModel::onRetake,
                onCancel = viewModel::onCancelSnap,
                onSearchByName = viewModel::openSearch,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 20.dp),
            )
        }

        // Manual recovery: catalog name-search overlay (from "Search by name").
        if (granted && searching && sheet == null) {
            SearchOverlay(
                onQuery = viewModel::search,
                onPick = viewModel::onPickCandidate,
                onClose = viewModel::closeSearch,
                modifier = Modifier.fillMaxSize(),
            )
        }

        // Result sheet (after a pick or QR).
        val rec = sheet
        if (rec != null) {
            val key = rec.cardId ?: rec.url ?: rec.title
            Box(Modifier.fillMaxSize().pointerInput(key) { detectTapGestures { onDismissSheet() } })
            RecognitionCard(
                rec = rec,
                collectionMode = collectionMode,
                deckMode = deckMode,
                reveal = revealT,
                onSearchCodex = { onSearchCodex(rec) },
                onAddCollection = { set ->
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
                    onDismissSheet()
                },
                onAddToDeck = { qty ->
                    onAddToDeck(rec, qty)
                    scope.launch { snackbarHost.showSnackbar("Added $qty × ${rec.title} to the deck") }
                    onDismissSheet()
                },
                onSaveDeck = { onSaveDeck(rec) },
                onImportMatch = { onImportMatch(rec) },
                onDismiss = onDismissSheet,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding(),
            )
        }

        // Close (exit scanner). Hidden during search - the search bar has its own back control, top-left.
        if (!searching) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .windowInsetsPadding(WindowInsets.safeDrawing)
                    .padding(8.dp)
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(Color(0x59000000))
                    .border(1.dp, PillarGold.copy(alpha = 0.45f), CircleShape)
                    .clickable(onClick = onClose)
                    .semantics { contentDescription = "Close scanner" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Close, contentDescription = null, tint = PillarGold, modifier = Modifier.size(22.dp))
            }
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

/** Manual recovery: a catalog name search. Type a name, pick the card - it enters the same result sheet
 *  as a scanned card. The path for cards the scanner cannot read or rank. */
@Composable
private fun SearchOverlay(
    onQuery: (String) -> List<SnapCandidate>,
    onPick: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var q by remember { mutableStateOf("") }
    val results = remember(q) { onQuery(q) }
    Column(
        modifier
            .background(Color(0xF2120D06))
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClose)
                    .semantics { contentDescription = "Back to scanning" },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Close, contentDescription = null, tint = PillarGold, modifier = Modifier.size(20.dp)) }
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Color(0x26FFFFFF))
                    .border(1.dp, PillarGold.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                    .padding(horizontal = 12.dp, vertical = 12.dp),
            ) {
                if (q.isEmpty()) Text("Search cards by name", color = Color(0x80EFE7D8), fontSize = 16.sp)
                BasicTextField(
                    value = q, onValueChange = { q = it }, singleLine = true,
                    textStyle = TextStyle(color = Color(0xFFEFE7D8), fontSize = 16.sp),
                    cursorBrush = SolidColor(PillarGold),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(Modifier.fillMaxWidth()) {
            items(results) { c ->
                Text(
                    c.displayName, color = Color(0xFFEFE7D8), fontSize = 16.sp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onPick(c.cardId) }
                        .padding(vertical = 12.dp, horizontal = 8.dp)
                        .semantics { contentDescription = "Select ${c.displayName}" },
                )
            }
        }
    }
}

/**
 * The Gilt Impression, retargeted from the old guide rect to the captured still: a gold double-rule
 * stamps around the photographed card as the identity settles. Contact is fast, the inner rule and the
 * halo follow - brightness and stroke weight only, never scale (the shipping reveal's law). [reveal] is
 * the shared 0..1 clock; reduced motion arrives at 1 immediately, so this simply paints the settled state.
 */
@Composable
private fun GiltStamp(reveal: Float, aspect: Float, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        // The image is drawn ContentScale.Fit, so the card occupies a letterboxed rect inside this box.
        val boxAspect = size.width / size.height
        val w = if (aspect > boxAspect) size.width else size.height * aspect
        val h = if (aspect > boxAspect) size.width / aspect else size.height
        val left = (size.width - w) / 2f
        val top = (size.height - h) / 2f

        fun seg(t: Float, a: Float, b: Float) = ((t - a) / (b - a)).coerceIn(0f, 1f)
        val contact = seg(reveal, 0f, 0.18f)      // the strike
        val inner = seg(reveal, 0.18f, 0.55f)     // the second rule follows
        val halo = seg(reveal, 0.10f, 0.42f)      // a brief flare, then quiet
        val haloAlpha = (halo * (1f - halo) * 4f).coerceIn(0f, 1f)

        val outerStroke = 2.25.dp.toPx()
        val inset = 6.dp.toPx()
        val r = 10.dp.toPx()

        if (haloAlpha > 0f) {
            drawRoundRect(
                color = PillarGold.copy(alpha = 0.22f * haloAlpha),
                topLeft = Offset(left - inset, top - inset),
                size = Size(w + inset * 2, h + inset * 2),
                cornerRadius = CornerRadius(r + inset, r + inset),
                style = Stroke(width = outerStroke * 3f),
            )
        }
        drawRoundRect(
            color = PillarGold.copy(alpha = 0.95f * contact),
            topLeft = Offset(left, top),
            size = Size(w, h),
            cornerRadius = CornerRadius(r, r),
            style = Stroke(width = outerStroke),
        )
        if (inner > 0f) {
            drawRoundRect(
                color = PillarGold.copy(alpha = 0.55f * inner),
                topLeft = Offset(left + inset, top + inset),
                size = Size(w - inset * 2, h - inset * 2),
                cornerRadius = CornerRadius(r * 0.6f, r * 0.6f),
                style = Stroke(width = 1.dp.toPx()),
            )
        }
    }
}

private val ReadViolet = Color(0xFFC79AD0)

/**
 * The gilt seal shutter (gold double-rule ring + parchment centre dot). While [reading] it hands the ring
 * over to a violet arc sweeping the same circle - the read lives in the shutter, not a separate spinner.
 * Reduced motion substitutes a static violet arc.
 */
@Composable
private fun ShutterButton(reading: Boolean, reduceMotion: Boolean, onCapture: () -> Unit, modifier: Modifier = Modifier) {
    if (!reading) {
        Box(
            modifier
                .size(72.dp)
                .clip(CircleShape)
                .background(Color(0x8C17130B))
                .border(2.25.dp, PillarGold, CircleShape)
                .clickable(onClick = onCapture)
                .semantics { contentDescription = "Capture card" },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(56.dp).clip(CircleShape).border(1.dp, PillarGold.copy(alpha = 0.5f), CircleShape))
            Box(Modifier.size(14.dp).clip(CircleShape).background(Color(0xFFEFE7D8)))
        }
        return
    }
    val t = rememberInfiniteTransition(label = "read")
    val sweep by t.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "sweep")
    Box(
        modifier.size(72.dp).semantics { contentDescription = "Reading the card" },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(Color(0x8C17130B)))
        Canvas(Modifier.size(72.dp)) {
            val stroke = 2.25.dp.toPx()
            val tl = Offset(stroke / 2, stroke / 2)
            val sz = Size(size.width - stroke, size.height - stroke)
            if (reduceMotion) {
                drawCircle(ReadViolet.copy(alpha = 0.3f), style = Stroke(stroke))
                drawArc(ReadViolet, -90f, 90f, false, topLeft = tl, size = sz, style = Stroke(stroke, cap = StrokeCap.Round))
            } else {
                drawArc(ReadViolet, sweep, 100f, false, topLeft = tl, size = sz, style = Stroke(stroke, cap = StrokeCap.Round))
            }
        }
    }
}

/** Text-first candidate list (Shortlist) or the honest Empty state. */
@Composable
private fun SnapshotPanel(
    state: SnapState,
    onPick: (String) -> Unit,
    onRetake: () -> Unit,
    onCancel: () -> Unit,
    onSearchByName: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val items: List<SnapCandidate> = (state as? SnapState.Shortlist)?.items ?: emptyList()
    val unavailable = (state as? SnapState.Empty)?.unavailable == true
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0xF01A1206))
            .border(1.dp, PillarGold.copy(alpha = 0.4f), RoundedCornerShape(18.dp))
            .padding(16.dp),
    ) {
        Column {
            Text(
                when {
                    items.isNotEmpty() -> "Is it one of these?"
                    unavailable -> "Visual match unavailable"
                    else -> "Couldn't identify the card"
                },
                color = PillarGold, fontSize = 16.sp,
            )
            if (items.isEmpty() && !unavailable) {
                Spacer(Modifier.height(4.dp))
                Text("Try more light, or fill the frame with the card.", color = Color(0xB8EFE7D8), fontSize = 14.sp)
            }
            Spacer(Modifier.height(8.dp))
            items.forEach { c ->
                Text(
                    c.displayName, color = Color(0xFFEFE7D8), fontSize = 16.sp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onPick(c.cardId) }
                        .padding(vertical = 12.dp, horizontal = 8.dp)
                        .semantics { contentDescription = "Select ${c.displayName}" },
                )
            }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onRetake) { Text("Try another photo", color = PillarGold) }
                TextButton(onClick = onSearchByName) { Text("Search by name", color = PillarGold) }
            }
            if (items.isNotEmpty()) {
                TextButton(onClick = onCancel) { Text("None of these", color = Color(0xB3EFE7D8)) }
            }
        }
    }
}
