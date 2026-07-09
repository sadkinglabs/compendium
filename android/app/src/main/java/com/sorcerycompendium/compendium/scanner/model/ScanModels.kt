package com.sorcerycompendium.compendium.scanner.model

import android.graphics.Rect

/** A card the matcher resolved to. `id`/`name` are echoed to JS verbatim. */
data class RecognisedCard(val id: String, val name: String, val isSite: Boolean)

/** A rectangle in fractional (0..1) coordinates of the upright analysis frame. */
data class RectFraction(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    fun toPixels(w: Int, h: Int) = Rect(
        (left * w).toInt(), (top * h).toInt(), (right * w).toInt(), (bottom * h).toInt(),
    )
}

/**
 * THE on-device tuning surface. Everything here is fractions of the UPRIGHT analysis
 * frame (16:9 rotated to portrait, [frameAspect] = 0.5625), so the overlay - which
 * maps these through the camera's FIT_CENTER letterbox - and the OCR crops share ONE
 * coordinate space. That is what makes "align the card to the guide" actually put the
 * name inside a read-zone (the earlier decoupled guide is why a filled card missed
 * and you had to pull back).
 *
 * [guide] is a true 0.716 Sorcery-card rectangle (measured from the app's 1,103 card
 * images). [topStrip] reads a standard card's top banner; [rightStrip]/[leftStrip]
 * read a rotated site's vertical name edge (both orientations). If a card sits in the
 * guide but won't lock, nudge these.
 */
object GuideGeometry {
    const val frameAspect = 9f / 16f       // upright frame w/h

    // DEBUG: draw the OCR read-zones + the raw per-strip OCR readout on screen (and OCR
    // every strip each frame). Flip back to true to diagnose; false = normal fast scan.
    const val showReadZones = false

    val guide = RectFraction(0.06f, 0.12f, 0.94f, 0.81f)     // ~0.716 card within the 9:16 frame

    val topStrip = RectFraction(0.10f, 0.14f, 0.90f, 0.26f)  // standard name banner
    val rightStrip = RectFraction(0.70f, 0.13f, 0.97f, 0.87f) // site name+rules, right vertical edge
    val leftStrip = RectFraction(0.03f, 0.13f, 0.30f, 0.87f)  // site name+rules, flipped left edge
}

/** The frame-colour phase: purple while searching, gold while a (new) card is being
 *  confirmed. A lock flashes green then fades back - see [ScannerViewModel]. */
enum class Phase { SEARCHING, DETECTING }
