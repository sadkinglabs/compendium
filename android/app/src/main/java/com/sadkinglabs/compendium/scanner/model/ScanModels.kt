package com.sadkinglabs.compendium.scanner.model

import android.graphics.Rect

/** The kind of thing the scanner locked onto - drives the sheet colour + actions. */
enum class ScanKind { CARD, DECK, MATCH }

/** One printing's set - name for display, code ('001'…) written to the ledger. */
data class SetRef(val name: String, val code: String)

/** A locked scan result: a catalog card (cardId + its sets), or a shared deck /
 *  match QR (url). For a QR the native side does NOT decode the payload - it hands
 *  the url to JS. `sets` drives the collection-mode set picker: one set files
 *  automatically, several prompts a per-card choice. */
data class Recognition(
    val kind: ScanKind,
    val title: String,
    val cardId: String? = null,
    val url: String? = null,
    val sets: List<SetRef> = emptyList(),
    // Deck mode: the copy cap for this card and how many are already in the open
    // deck (a snapshot at lock time, kept live across the session), so the sheet
    // can cap "add N" at the remaining headroom.
    val limit: Int = 99,
    val inDeck: Int = 0,
)

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

    // DEV CAPTURE: record every frame's analyzer observation into a corpus file (written to the
    // app's external files dir on scanner close) for the reliability harness. Adds a tiny per-frame
    // append; NOT for release. TRUE only on the capture build - FLIP FALSE before merging to main.
    const val captureCorpus = false

    val guide = RectFraction(0.06f, 0.12f, 0.94f, 0.81f)     // ~0.716 card within the 9:16 frame

    val topStrip = RectFraction(0.10f, 0.14f, 0.90f, 0.26f)  // standard name banner
    val rightStrip = RectFraction(0.70f, 0.13f, 0.97f, 0.87f) // site name+rules, right vertical edge
    val leftStrip = RectFraction(0.03f, 0.13f, 0.30f, 0.87f)  // site name+rules, flipped left edge
}

/** The frame-colour phase: purple while searching, gold while a (new) card is being
 *  confirmed. A lock flashes green then fades back - see [ScannerViewModel]. */
enum class Phase { SEARCHING, DETECTING }

/** One visual-match suggestion. [cardId] is the catalog identity (keys every write); [displayName] is
 *  display only; [score] is cosine similarity (higher = closer). */
data class SnapCandidate(val cardId: String, val displayName: String, val score: Float)

/**
 * The pure-snapshot scanner state (Rev 6). Every scan is one deliberate shutter press; image recognition
 * is primary and runs once per capture. Shortlist-first: even a confident match is presented as a pick-list
 * until a sealed evaluation authorises automatic single Result.
 *  [Ready]       - open viewfinder; the shutter is armed (QR still detected passively).
 *  [Capturing]   - shutter pressed; grabbing the current frame (throttle-bypassed).
 *  [Identifying] - the frozen still is being embedded (one inference).
 *  [Shortlist]   - up to five distinct-card suggestions to confirm.
 *  [Empty]       - nothing above the floor ([unavailable]=false) OR the matcher could not load
 *                  ([unavailable]=true, fail-closed: never falls back to unrestricted OCR).
 */
sealed interface SnapState {
    data object Ready : SnapState
    data object Capturing : SnapState
    data object Identifying : SnapState
    data class Shortlist(val items: List<SnapCandidate>) : SnapState
    data class Empty(val unavailable: Boolean) : SnapState
}

/** Which strip a reading came from - the card's name-text orientation. EVIDENCE for the recognition
 *  policy (Phase-2a: weighted evidence by default), NOT a hard class gate. Shared by the OCR
 *  extractor, the session reducer, the shared FrameSelector, and the reliability corpus/harness. */
enum class Source { TOP, LEFT_270, RIGHT_90 }
