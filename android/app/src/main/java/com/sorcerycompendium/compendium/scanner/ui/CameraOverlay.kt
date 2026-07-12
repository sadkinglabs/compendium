package com.sorcerycompendium.compendium.scanner.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sorcerycompendium.compendium.scanner.model.GuideGeometry
import com.sorcerycompendium.compendium.scanner.model.Phase
import com.sorcerycompendium.compendium.scanner.model.RectFraction

private val Purple = Color(0xFFC79AD0)   // searching - Decks violet (= --accent-violet)
private val Gold = Color(0xFFDCB86F)      // a card being confirmed - "getting there"

/**
 * Card-shaped alignment guide (rounded corners) drawn in the SAME letterboxed frame
 * space the OCR crops use, so a filled card lands in a read-zone. The thick border is
 * PURPLE while searching and GOLD while confirming a card; a lock ([lockEvent]) flashes
 * the TYPE accent ([lockColor] - Codex gold for a card, Decks violet for a shared deck,
 * Play jade for a shared match) then fades back to purple, signalling scanning is allowed
 * again while the sheet stays up. DEBUG: the three OCR read-zones are drawn as coloured
 * rectangles so you can see whether a card's name text falls inside them.
 */
@Composable
fun CameraOverlay(phase: Phase, lockEvent: Int, lockColor: Color, modifier: Modifier = Modifier) {
    val base by animateColorAsState(if (phase == Phase.DETECTING) Gold else Purple, tween(300), label = "base")

    // Type-coloured success flash on each lock, decaying back to the base colour.
    val flash = remember { Animatable(0f) }
    LaunchedEffect(lockEvent) {
        if (lockEvent > 0) { flash.snapTo(1f); flash.animateTo(0f, tween(950)) }
    }
    val frameColor = lerp(base, lockColor, flash.value)

    val transition = rememberInfiniteTransition(label = "scan")
    val pulse by transition.animateFloat(
        0.55f, 1f, infiniteRepeatable(tween(950), RepeatMode.Reverse), label = "pulse",
    )
    val sweep by transition.animateFloat(
        0f, 1f, infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Restart), label = "sweep",
    )

    val label = if (phase == Phase.DETECTING) "Hold steady…" else "Point at a card or a shared code"

    Box(modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize()) {
            // Map fractions through the camera's FIT_CENTER letterbox.
            val fitH = size.width / GuideGeometry.frameAspect
            val fw: Float; val fh: Float; val ox: Float; val oy: Float
            if (fitH <= size.height) { fw = size.width; fh = fitH; ox = 0f; oy = (size.height - fh) / 2f }
            else { fh = size.height; fw = size.height * GuideGeometry.frameAspect; oy = 0f; ox = (size.width - fw) / 2f }
            fun place(f: RectFraction) = androidx.compose.ui.geometry.Rect(
                ox + f.left * fw, oy + f.top * fh, ox + f.right * fw, oy + f.bottom * fh,
            )

            val g = place(GuideGeometry.guide)
            val radius = g.width * 0.055f

            // scrim everywhere EXCEPT the rounded card window
            val hole = Path().apply {
                addRect(Rect(0f, 0f, size.width, size.height))
                addRoundRect(RoundRect(g.left, g.top, g.right, g.bottom, CornerRadius(radius, radius)))
                fillType = PathFillType.EvenOdd
            }
            drawPath(hole, Color(0xB8000000))

            // DEBUG read-zones: cyan = TOP (standard name), magenta = RIGHT (site),
            // yellow = LEFT (site flipped). If a card's name text isn't inside one of
            // these, that's why it won't lock.
            if (GuideGeometry.showReadZones) {
                zone(place(GuideGeometry.topStrip), Color(0xFF35E0E0))
                zone(place(GuideGeometry.rightStrip), Color(0xFFE879F9))
                zone(place(GuideGeometry.leftStrip), Color(0xFFFFD84D))
            }

            // thick card border, breathing
            drawRoundRect(
                color = frameColor.copy(alpha = pulse),
                topLeft = Offset(g.left, g.top),
                size = Size(g.width, g.height),
                cornerRadius = CornerRadius(radius, radius),
                style = Stroke(width = 12f),
            )

            // scan line sweeping down the card
            val y = g.top + g.height * sweep
            drawLine(frameColor.copy(alpha = 0.6f), Offset(g.left + 14f, y), Offset(g.right - 14f, y), strokeWidth = 3f)
        }
        Text(
            text = label,
            color = Color.White,
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(top = 24.dp, start = 32.dp, end = 32.dp)
                .semantics { contentDescription = label },
        )
    }
}

/** A translucent debug rectangle marking an OCR read-zone. */
private fun DrawScope.zone(r: Rect, color: Color) {
    drawRect(color.copy(alpha = 0.16f), topLeft = Offset(r.left, r.top), size = Size(r.width, r.height))
    drawRect(color, topLeft = Offset(r.left, r.top), size = Size(r.width, r.height), style = Stroke(width = 3f))
}
