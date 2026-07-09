package com.sorcerycompendium.compendium.scanner.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sorcerycompendium.compendium.scanner.model.RecognisedCard
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * The recognition surface: a Material 3 card that springs up on lock (re-springs when
 * the card changes) with the name + three large-touch-target (>=52dp) actions. Sticky -
 * the caller keeps it up until "Scan another", a tap outside, or a new card - so
 * add-actions don't dismiss it. Swallows its own taps so a tap ON the sheet never falls
 * through to the dismiss scrim behind it. The sparkle flourish is drawn separately (over
 * the whole screen) by [SparkleBurst] so it isn't hidden behind this opaque card.
 */
@Composable
fun RecognitionCard(
    card: RecognisedCard,
    onSearchCodex: () -> Unit,
    onAddCollection: () -> Unit,
    onAddWishlist: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reveal = remember(card.id) { Animatable(0f) }
    LaunchedEffect(card.id) {
        reveal.snapTo(0f)
        reveal.animateTo(1f, spring(dampingRatio = 0.52f, stiffness = Spring.StiffnessMediumLow))
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
            .semantics { contentDescription = "Recognised card ${card.name}" },
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 6.dp,
        shadowElevation = 16.dp,
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp)) {
            Text(
                "RECOGNISED CARD",
                color = MaterialTheme.colorScheme.primary,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 2.sp,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                card.name,
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(18.dp))
            Button(onClick = onSearchCodex, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) {
                Icon(Icons.Filled.Search, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Search Codex")
            }
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
            Spacer(Modifier.height(6.dp))
            TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Scan another")
            }
        }
    }
}

private data class Spark(val angle: Float, val dist: Float, val scale: Float, val delay: Float)

private val SparkGold = Color(0xFFF6DE92)

/**
 * A one-shot gold sparkle burst, drawn full-screen and radiating from just above the
 * sheet so it's visible over the camera (not hidden behind the opaque card). Re-plays
 * whenever [key] (the recognised card id) changes.
 */
@Composable
fun SparkleBurst(key: Any, modifier: Modifier = Modifier) {
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
            if (sz > 0.5f) sparkle(x, y, sz, SparkGold.copy(alpha = fade))
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
            "Allow camera access to scan cards. Everything stays on your device - nothing is uploaded.",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = onClose) { Text("Close") }
    }
}
