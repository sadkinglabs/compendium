package com.sorcerycompendium.compendium.scanner.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sorcerycompendium.compendium.scanner.model.Recognition
import com.sorcerycompendium.compendium.scanner.model.ScanKind
import com.sorcerycompendium.compendium.scanner.model.SetRef
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * The recognition surface: a Material 3 card that springs up on lock (re-springs when the
 * result changes) and colour-codes itself + its actions to WHAT was scanned - a Codex-gold
 * card, a Decks-violet shared deck, or a Play-jade shared match (see [accentFor]). Sticky:
 * the caller keeps it up until "Scan another", a tap outside, or a new result. Swallows its
 * own taps so a tap ON the sheet never falls through to the dismiss scrim. The sparkle
 * flourish is drawn separately (over the whole screen) by [SparkleBurst].
 */
@Composable
fun RecognitionCard(
    rec: Recognition,
    collectionMode: Boolean,
    onSearchCodex: () -> Unit,
    onAddCollection: () -> Unit,
    onAddWishlist: () -> Unit,
    onSaveCollection: (Int, String?) -> Unit,
    onSaveDeck: () -> Unit,
    onImportMatch: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = accentFor(rec.kind)
    val key = rec.cardId ?: rec.url ?: rec.title
    val reveal = remember(key) { Animatable(0f) }
    // Collection-mode quantity, reset for each newly recognised card.
    var qty by remember(key) { mutableStateOf(1) }
    // Collection-mode set choice: a single-set card auto-selects; a reprint starts
    // null (a pick is required); an unknown card has no sets (files Unspecified).
    var selectedSet by remember(key) { mutableStateOf(if (rec.sets.size == 1) rec.sets[0].code else null) }
    LaunchedEffect(key) {
        reveal.snapTo(0f)
        reveal.animateTo(1f, spring(dampingRatio = 0.52f, stiffness = Spring.StiffnessMediumLow))
    }
    val eyebrow: String; val title: String; val subtitle: String?
    when (rec.kind) {
        ScanKind.CARD -> { eyebrow = "RECOGNISED CARD"; title = rec.title; subtitle = null }
        ScanKind.DECK -> { eyebrow = "SHARED DECK"; title = "Sorcery deck"; subtitle = "Save it to your library to see every card." }
        ScanKind.MATCH -> { eyebrow = "SHARED MATCH"; title = "Match result"; subtitle = "Import it to review the game." }
    }
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
            .graphicsLayer {
                val v = reveal.value.coerceIn(0f, 1f)
                val s = 0.90f + 0.10f * v
                scaleX = s; scaleY = s
                alpha = v
                translationY = (1f - v) * 48f
            }
            .pointerInput(Unit) { detectTapGestures { } }  // swallow taps (don't dismiss on sheet tap)
            .semantics { contentDescription = "$eyebrow: $title" },
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, Color(0x3DDCB86F)),   // GothicSheet gilt hairline (gold @ .24)
        tonalElevation = 6.dp,
        shadowElevation = 16.dp,
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Text(eyebrow, color = accent, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp)
            Spacer(Modifier.height(4.dp))
            Text(title, color = MaterialTheme.colorScheme.onSurface, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            if (subtitle != null) {
                Spacer(Modifier.height(6.dp))
                Text(subtitle, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f), fontSize = 14.sp)
            }
            Spacer(Modifier.height(18.dp))
            when (rec.kind) {
                ScanKind.CARD -> if (collectionMode) {
                    // Which printing? One set files automatically (shown as a pill); a card
                    // reprinted across sets prompts a per-card pick before you can add.
                    if (rec.sets.isNotEmpty()) {
                        if (rec.sets.size > 1) {
                            Text("WHICH PRINTING?", color = accent, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp)
                            Spacer(Modifier.height(8.dp))
                        }
                        SetChips(rec.sets, selectedSet, single = rec.sets.size == 1, accent = accent, onPick = { selectedSet = it })
                        Spacer(Modifier.height(16.dp))
                    }
                    QtyStepper(qty, accent, onDec = { if (qty > 1) qty -= 1 }, onInc = { if (qty < 99) qty += 1 })
                    Spacer(Modifier.height(14.dp))
                    val effectiveSet = when {
                        rec.sets.size == 1 -> rec.sets[0].code
                        rec.sets.size > 1 -> selectedSet
                        else -> null
                    }
                    val ready = rec.sets.size <= 1 || selectedSet != null
                    PrimaryAction(
                        if (qty == 1) "Add 1 copy" else "Add $qty copies",
                        Icons.Filled.Add, accent, enabled = ready,
                    ) { onSaveCollection(qty, effectiveSet) }
                } else {
                    PrimaryAction("Search Codex", Icons.Filled.Search, accent, onClick = onSearchCodex)
                    Spacer(Modifier.height(10.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = onAddCollection, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                            Icon(Icons.Filled.Add, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Collection")
                        }
                        OutlinedButton(onClick = onAddWishlist, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                            Icon(Icons.Filled.FavoriteBorder, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Wishlist")
                        }
                    }
                }
                ScanKind.DECK -> PrimaryAction("Save to My Decks", Icons.Filled.Add, accent, onClick = onSaveDeck)
                ScanKind.MATCH -> PrimaryAction("Review & import", Icons.Filled.PlayArrow, accent, onClick = onImportMatch)
            }
            Spacer(Modifier.height(6.dp))
            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text(if (collectionMode && rec.kind == ScanKind.CARD) "Skip / keep scanning" else "Scan another")
            }
        }
    }
}

/** The full-width primary action, filled in the result's type accent. Disabled
 *  (greyed) until [enabled] - used to gate "Add" on a set pick for reprints. */
@Composable
private fun PrimaryAction(label: String, icon: ImageVector, accent: Color, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
        colors = ButtonDefaults.buttonColors(containerColor = accent, contentColor = OnPillar),
    ) {
        Icon(icon, contentDescription = null)
        Spacer(Modifier.width(8.dp))
        Text(label)
    }
}

/** Set chooser for collection mode: a scrollable row of set pills. A single-set
 *  card shows one filled, non-interactive pill (auto-selected); a reprint shows
 *  pick-one pills that fill when chosen. */
@Composable
private fun SetChips(sets: List<SetRef>, selected: String?, single: Boolean, accent: Color, onPick: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (s in sets) {
            val on = single || s.code == selected
            val mod = Modifier
                .clip(CircleShape)
                .then(if (single) Modifier else Modifier.clickable { onPick(s.code) })
                .background(if (on) accent else Color.Transparent)
                .border(1.dp, if (on) accent else accent.copy(alpha = 0.4f), CircleShape)
                .heightIn(min = 40.dp)
                .padding(horizontal = 16.dp)
                .wrapContentHeight(Alignment.CenterVertically)
            Text(
                s.name.uppercase(),
                modifier = mod,
                color = if (on) OnPillar else accent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 1.sp,
            )
        }
    }
}

/** Collection mode: a big −/N/+ stepper for how many copies to record. */
@Composable
private fun QtyStepper(qty: Int, accent: Color, onDec: () -> Unit, onInc: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepButton("−", accent, enabled = qty > 1, onClick = onDec)   // minus sign
        Text(
            qty.toString(),
            color = MaterialTheme.colorScheme.onSurface,
            fontSize = 30.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(96.dp),
        )
        StepButton("+", accent, enabled = qty < 99, onClick = onInc)
    }
}

/** A round outlined step button; the glyph dims when the step is disabled. */
@Composable
private fun StepButton(glyph: String, accent: Color, enabled: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        modifier = Modifier.size(56.dp),
        contentPadding = PaddingValues(0.dp),
        border = BorderStroke(1.dp, accent.copy(alpha = if (enabled) 0.6f else 0.22f)),
    ) {
        Text(glyph, color = accent.copy(alpha = if (enabled) 1f else 0.35f), fontSize = 26.sp, fontWeight = FontWeight.Bold)
    }
}

private data class Spark(val angle: Float, val dist: Float, val scale: Float, val delay: Float)

/**
 * A one-shot sparkle burst in the result's type [color], drawn full-screen and radiating
 * from just above the sheet so it's visible over the camera (not hidden behind the opaque
 * card). Re-plays whenever [key] (the recognised card id / deck url) changes.
 */
@Composable
fun SparkleBurst(key: Any, color: Color, modifier: Modifier = Modifier) {
    val progress = remember(key) { Animatable(0f) }
    LaunchedEffect(key) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(950, easing = FastOutSlowInEasing))
    }
    val sparks = remember(key) {
        val rnd = Random(key.hashCode())
        List(24) {
            Spark(
                angle = rnd.nextFloat() * 360f,
                dist = 0.35f + rnd.nextFloat() * 0.65f,
                scale = 0.7f + rnd.nextFloat() * 1.0f,
                delay = rnd.nextFloat() * 0.30f,
            )
        }
    }
    Canvas(modifier.fillMaxSize()) {
        val cx = size.width / 2f
        val cy = size.height * 0.62f            // just above the bottom sheet
        val maxD = size.height * 0.32f
        val p = progress.value
        for (s in sparks) {
            val local = ((p - s.delay) / (1f - s.delay)).coerceIn(0f, 1f)
            if (local <= 0f) continue
            val rad = Math.toRadians(s.angle.toDouble())
            val d = s.dist * maxD * local
            val x = cx + (cos(rad) * d).toFloat()
            val y = cy + (sin(rad) * d).toFloat()
            val fade = 1f - local
            val sz = sin(local * Math.PI).toFloat() * 16f * s.scale
            if (sz > 0.5f) sparkle(x, y, sz, color.copy(alpha = fade))
        }
    }
}

/** A 4-point star. */
private fun DrawScope.sparkle(cx: Float, cy: Float, r: Float, color: Color) {
    val inner = r * 0.34f
    val path = Path().apply {
        moveTo(cx, cy - r)
        lineTo(cx + inner, cy - inner)
        lineTo(cx + r, cy)
        lineTo(cx + inner, cy + inner)
        lineTo(cx, cy + r)
        lineTo(cx - inner, cy + inner)
        lineTo(cx - r, cy)
        lineTo(cx - inner, cy - inner)
        close()
    }
    drawPath(path, color)
}

/** Shown when camera permission is denied. */
@Composable
fun PermissionPrompt(onClose: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "Camera permission needed",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 18.sp,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Allow camera access to scan cards and codes. Everything stays on your device - nothing is uploaded.",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onClose) { Text("Close") }
    }
}
