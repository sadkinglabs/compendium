package com.sadkinglabs.compendium.scanner.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sadkinglabs.compendium.scanner.model.GuideGeometry
import com.sadkinglabs.compendium.scanner.model.Phase
import com.sadkinglabs.compendium.scanner.model.RectFraction
import com.sadkinglabs.compendium.scanner.model.Recognition
import com.sadkinglabs.compendium.scanner.model.ScanKind

// --- The Gilt Impression palette (shipping tokens only). ---
private val Parchment = Color(0xFFEFE7D8)   // ready corner guides + sheen + process text
private val Ink = Color(0xFF17130B)          // debossing shadow under the gold

private val Press = CubicBezierEasing(0.16f, 1f, 0.30f, 1f)     // the stamp contact
private val Settle = CubicBezierEasing(0.40f, 0f, 0.20f, 1f)    // fades, name, halo swell
private val Decay = CubicBezierEasing(0.33f, 0f, 0.67f, 1f)     // halo quiet-down + recognising breath

private val StatusShadow = Shadow(Color(0xB3000000), Offset(0f, 2f), 8f)

private fun lerpF(a: Float, b: Float, t: Float) = a + (b - a) * t
private fun seg(t: Float, start: Float, end: Float) = ((t - start) / (end - start)).coerceIn(0f, 1f)

/**
 * The scanner guide + recognition reveal - "The Gilt Impression", staged as ONE act on a single
 * shared clock ([reveal] 0->1, owned by [ScannerScreen] and shared with the result tray).
 *
 *  - READY       (SEARCHING, no [rec]): four still parchment corner guides over a lightly dimmed
 *                surround. "Position a card within the frame."
 *  - RECOGNISING (DETECTING, no [rec]): a full violet frame (55-75% breath) + violet corners -
 *                "engaged and reading". "Hold steady".
 *  - RECOGNISED  ([rec] present): as [reveal] runs, the violet guide extinguishes and a gilt
 *                double-rule with corner bosses makes firm contact (brightness + stroke weight,
 *                NO frame scaling), a strong short gold bloom flares (synced to the haptic peak),
 *                then the card NAME translates up into place. Settled by reveal=1 (~800ms).
 *
 * Material depth (ink shadow / body / halo / sheen + bosses) carries the luxe, not motion volume.
 * Nothing is drawn over the artwork; the live card stays visible; no remote image is involved.
 * Under reduced motion the shared clock is snapped to 1, so the settled state is shown at once.
 */
@Composable
fun CameraOverlay(
    phase: Phase,
    rec: Recognition?,
    reduceMotion: Boolean,
    reveal: Float,
    modifier: Modifier = Modifier,
) {
    val shown = rec != null
    val accent = rec?.let { accentFor(it.kind) } ?: PillarGold
    val motion = !reduceMotion

    // Corners: parchment ready -> violet recognising (over ~180ms).
    val bracketTarget = if (phase == Phase.DETECTING) PillarViolet else Parchment
    val bracketColor = if (motion) animatedColor(bracketTarget) else bracketTarget

    // Recognising violet-frame breath (55-75% over 1.2s), a steady value otherwise.
    val breath = if (motion && phase == Phase.DETECTING && !shown) ambientBreath() else 0.65f

    Box(modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize()) {
            val fitH = size.width / GuideGeometry.frameAspect
            val fw: Float; val fh: Float; val ox: Float; val oy: Float
            if (fitH <= size.height) { fw = size.width; fh = fitH; ox = 0f; oy = (size.height - fh) / 2f }
            else { fh = size.height; fw = size.height * GuideGeometry.frameAspect; oy = 0f; ox = (size.width - fw) / 2f }
            fun place(f: RectFraction) = Rect(ox + f.left * fw, oy + f.top * fh, ox + f.right * fw, oy + f.bottom * fh)

            val g = place(GuideGeometry.guide)
            val r = g.width * 0.045f
            val dp1 = 1.dp.toPx(); val dp3 = 3.dp.toPx(); val dp6 = 6.dp.toPx()

            // Lightly dim the surround (~50%), no full-frame glow.
            val hole = Path().apply {
                addRect(Rect(0f, 0f, size.width, size.height))
                addRoundRect(RoundRect(g.left, g.top, g.right, g.bottom, CornerRadius(r, r)))
                fillType = PathFillType.EvenOdd
            }
            drawPath(hole, Color(0x80000000))

            if (GuideGeometry.showReadZones) {
                zone(place(GuideGeometry.topStrip), Color(0xFF35E0E0))
                zone(place(GuideGeometry.rightStrip), Color(0xFFE879F9))
                zone(place(GuideGeometry.leftStrip), Color(0xFFFFD84D))
            }

            // --- READY / RECOGNISING guides. They extinguish over the first 0.11 of the reveal. ---
            val bracketFade = if (!shown) 1f else (1f - seg(reveal, 0f, 0.11f))
            if (bracketFade > 0f) {
                val baseAlpha = if (phase == Phase.DETECTING) 0.70f else 0.45f
                val col = bracketColor.copy(alpha = baseAlpha * bracketFade)
                val arm = g.width * 0.10f
                for (path in roundedCorners(g, r, arm)) {
                    drawPath(path, col, style = Stroke(width = dp1, cap = StrokeCap.Round, join = StrokeJoin.Round))
                }
                // RECOGNISING: a full violet frame - the clear "engaged, reading this card" signal.
                if (phase == Phase.DETECTING && !shown) {
                    drawRoundRect(
                        PillarViolet.copy(alpha = breath),
                        topLeft = Offset(g.left, g.top), size = Size(g.width, g.height),
                        cornerRadius = CornerRadius(r, r), style = Stroke(width = 2.4.dp.toPx()),
                    )
                }
            }

            // --- RECOGNISED: the Gilt Impression, driven by the shared reveal clock. ---
            if (shown) {
                // Firm contact expressed by BRIGHTNESS + STROKE WEIGHT (no frame scaling).
                val core = when {
                    reveal < 0.11f -> 0.92f * Press.transform(reveal / 0.11f)
                    reveal < 0.16f -> 1f                                                  // brief full-bright contact
                    reveal < 0.26f -> lerpF(1f, 0.92f, Settle.transform((reveal - 0.16f) / 0.10f))
                    else -> 0.92f
                }
                val contactBoost = 1f - seg(reveal, 0.05f, 0.24f)   // heavier rule at contact, settling
                val inkA = 0.22f * seg(reveal, 0.11f, 0.26f)        // shadow seats after the gold
                val sheenA = 0.16f * seg(reveal, 0.14f, 0.34f)
                val bossA = Press.transform(seg(reveal, 0f, 0.11f))
                // Halo: a STRONG, SHORT flare (peak ~0.29, synced to the haptic), then a quick settle.
                val haloW: Float; val haloA: Float
                if (reveal < 0.29f) {
                    val s = Settle.transform(seg(reveal, 0.11f, 0.29f)); haloW = lerpF(3f, 13f, s).dp.toPx(); haloA = lerpF(0f, 0.50f, s)
                } else {
                    val d = Decay.transform(seg(reveal, 0.29f, 0.60f)); haloW = lerpF(13f, 5f, d).dp.toPx(); haloA = lerpF(0.50f, 0.12f, d)
                }

                val gold = accent
                val outer = Rect(g.left - dp6, g.top - dp6, g.right + dp6, g.bottom + dp6)
                val rOuter = r + dp6

                // 1. Ink shadow (debossing) - drawn first, +1dp offset.
                roundStroke(outer, rOuter, Ink.copy(alpha = inkA), 2.25.dp.toPx() + dp1, Offset(dp1, dp1))
                roundStroke(g, r, Ink.copy(alpha = inkA), dp1 + dp1, Offset(dp1, dp1))
                // 2. Halo (gold leaf catching light) - wide low-alpha stroke, no blur.
                if (haloA > 0f) roundStroke(outer, rOuter, gold.copy(alpha = haloA), haloW, Offset.Zero, cap = StrokeCap.Round)
                // 3-4. Double page-rule: thick outer, thin inner - heavier at contact.
                roundStroke(outer, rOuter, gold.copy(alpha = core), (2.25f + 1.0f * contactBoost).dp.toPx(), Offset.Zero)
                roundStroke(g, r, gold.copy(alpha = core), (1f + 0.5f * contactBoost).dp.toPx(), Offset.Zero)
                // 5. Sheen - light skimming the top of the leaf, -0.5dp offset.
                roundStroke(outer, rOuter, Parchment.copy(alpha = sheenA), 0.75.dp.toPx(), Offset(-0.5f * dp1, -0.5f * dp1))
                // 6. Corner bosses - gold studs midway between the rules, each on an ink dot.
                val mid = Rect(g.left - dp3, g.top - dp3, g.right + dp3, g.bottom + dp3)
                val rMid = r + dp3; val k = rMid * 0.293f
                val bosses = listOf(
                    Offset(mid.left + k, mid.top + k), Offset(mid.right - k, mid.top + k),
                    Offset(mid.left + k, mid.bottom - k), Offset(mid.right - k, mid.bottom - k),
                )
                for (b in bosses) {
                    drawCircle(Ink.copy(alpha = inkA), radius = dp3, center = Offset(b.x + dp1, b.y + dp1))
                    drawCircle(gold.copy(alpha = bossA), radius = dp3, center = b)
                }
            }
        }

        StatusText(phase, rec, reveal, accent, Modifier.align(Alignment.TopCenter))
    }
}

/**
 * The recognition result above the frame (never over the card). Ready/recognising show one process
 * line and announce it; on lock the card NAME TRANSLATES UP into place (no scaling) on the shared
 * clock, as a rubric on a gilt fade-hairline. The recognised block is decorative to assistive tech
 * (the result tray owns the single "Recognised: <name>" announcement), avoiding a double read.
 */
@Composable
private fun StatusText(phase: Phase, rec: Recognition?, reveal: Float, accent: Color, modifier: Modifier) {
    val pad = modifier
        .fillMaxWidth()
        .windowInsetsPadding(WindowInsets.safeDrawing)
        // Offset below the top-right close button's row so the reveal text never runs under it.
        .padding(top = 60.dp, start = 32.dp, end = 32.dp)

    if (rec == null) {
        val text = if (phase == Phase.DETECTING) "Hold steady" else "Position a card or QR within the frame"
        Text(text, style = process(), modifier = pad.clearAndSetSemantics { contentDescription = text })
        return
    }

    val name = when (rec.kind) {
        ScanKind.CARD -> rec.title
        ScanKind.DECK -> "Shared deck"
        ScanKind.MATCH -> "Shared match"
    }
    // Name: translate up 14dp -> 0 and fade in over reveal 0.22 -> 0.52 (≈180-420ms).
    val nameP = Settle.transform(seg(reveal, 0.22f, 0.52f))
    val transPx = with(LocalDensity.current) { 14.dp.toPx() }

    Column(
        pad.clearAndSetSemantics { },   // the result tray announces; don't double-read here
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            name,
            style = TextStyle(color = accent, fontFamily = FontDisplay, fontSize = 21.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp, textAlign = TextAlign.Center, shadow = StatusShadow),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.fillMaxWidth().graphicsLayer {
                alpha = nameP
                translationY = (1f - nameP) * transPx
            },
        )
        // A centre-weighted fade gilt hairline - the app's manuscript divider idiom.
        Box(Modifier.fillMaxWidth().alpha(nameP), contentAlignment = Alignment.Center) {
            Box(
                Modifier.fillMaxWidth(0.52f).height(1.dp).background(
                    Brush.horizontalGradient(
                        0f to Color.Transparent, 0.5f to accent.copy(alpha = 0.55f), 1f to Color.Transparent,
                    ),
                ),
            )
        }
    }
}

private fun process() = TextStyle(color = Parchment, fontFamily = FontUi, fontSize = 14.5f.sp, letterSpacing = 0.3.sp, textAlign = TextAlign.Center, shadow = StatusShadow)

/** The animated corner colour (motion path only); ~180ms parchment -> violet. */
@Composable
private fun animatedColor(target: Color): Color {
    val c by animateColorAsState(target, tween(180, easing = Settle), label = "corner")
    return c
}

/** One slow ≈1.2s breath (55-75%) on the recognising violet frame (motion path only). */
@Composable
private fun ambientBreath(): Float {
    val loop = rememberInfiniteTransition(label = "loop")
    val b by loop.animateFloat(0.55f, 0.75f, infiniteRepeatable(tween(1200, easing = Decay), RepeatMode.Reverse), label = "breath")
    return b
}

/** A rounded-rect stroke at [rect]/[radius], optionally offset (for shadow/sheen layers). */
private fun DrawScope.roundStroke(rect: Rect, radius: Float, color: Color, strokeW: Float, offset: Offset, cap: StrokeCap = StrokeCap.Butt) {
    drawRoundRect(
        color = color,
        topLeft = Offset(rect.left + offset.x, rect.top + offset.y),
        size = Size(rect.width, rect.height),
        cornerRadius = CornerRadius(radius, radius),
        style = Stroke(width = strokeW, cap = cap),
    )
}

/** The four corner guides as rounded-corner paths: a 90° arc of the card's own radius [r] with a
 *  short straight arm along each edge, so the guides sit ON the card's rounded corners. */
private fun roundedCorners(g: Rect, r: Float, arm: Float): List<Path> {
    fun build(b: Path.() -> Unit) = Path().apply(b)
    val tl = build {
        moveTo(g.left, g.top + r + arm); lineTo(g.left, g.top + r)
        arcTo(Rect(g.left, g.top, g.left + 2 * r, g.top + 2 * r), 180f, 90f, false)
        lineTo(g.left + r + arm, g.top)
    }
    val tr = build {
        moveTo(g.right - r - arm, g.top); lineTo(g.right - r, g.top)
        arcTo(Rect(g.right - 2 * r, g.top, g.right, g.top + 2 * r), 270f, 90f, false)
        lineTo(g.right, g.top + r + arm)
    }
    val br = build {
        moveTo(g.right, g.bottom - r - arm); lineTo(g.right, g.bottom - r)
        arcTo(Rect(g.right - 2 * r, g.bottom - 2 * r, g.right, g.bottom), 0f, 90f, false)
        lineTo(g.right - r - arm, g.bottom)
    }
    val bl = build {
        moveTo(g.left + r + arm, g.bottom); lineTo(g.left + r, g.bottom)
        arcTo(Rect(g.left, g.bottom - 2 * r, g.left + 2 * r, g.bottom), 90f, 90f, false)
        lineTo(g.left, g.bottom - r - arm)
    }
    return listOf(tl, tr, br, bl)
}

/** A translucent debug rectangle marking an OCR read-zone. */
private fun DrawScope.zone(r: Rect, color: Color) {
    drawRect(color.copy(alpha = 0.16f), topLeft = Offset(r.left, r.top), size = Size(r.width, r.height))
    drawRect(color, topLeft = Offset(r.left, r.top), size = Size(r.width, r.height), style = Stroke(width = 3f))
}
