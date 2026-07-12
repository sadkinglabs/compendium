package com.sadkinglabs.compendium.scanner.ocr

import android.graphics.Bitmap
import android.graphics.Rect
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognizer
import com.sadkinglabs.compendium.scanner.model.GuideGeometry
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** What one extract() pass produced: the match candidates + a debug readout of the
 *  raw text each strip OCR'd (populated only when GuideGeometry.showReadZones). */
data class Extraction(val candidates: List<OcrCandidate>, val debug: String)

/**
 * Crops ONLY the name strips - never the whole card. Fast path: OCR the TOP banner; if
 * it has a word it's a standard card, return immediately (one OCR). Otherwise OCR both
 * side edges at both rotations for a rotated site's vertical name. In DEBUG mode
 * (showReadZones) it OCRs ALL strips regardless, so the on-screen readout shows exactly
 * what each edge reads.
 */
class StripExtractor(private val recognizer: TextRecognizer) {

    suspend fun extract(frame: Bitmap): Extraction {
        val w = frame.width
        val h = frame.height
        val debug = GuideGeometry.showReadZones
        val sb = if (debug) StringBuilder() else null
        val cands = ArrayList<OcrCandidate>(4)

        val top = recognizeStrip(frame, GuideGeometry.topStrip.toPixels(w, h), 0)
        sb?.append("TOP  : ${short(top)}\n")
        val topWord = top != null && hasWord(top)
        if (topWord) cands.add(OcrCandidate(top!!, false))
        if (topWord && !debug) return Extraction(cands, "")   // fast path: standard card = 1 OCR

        // Sites: the name reads on the RIGHT edge at 90° and the LEFT edge at 270°
        // (verified from device readouts) - those two are all we need to match.
        val r90 = recognizeStrip(frame, GuideGeometry.rightStrip.toPixels(w, h), 90)
        sb?.append("R90 : ${short(r90)}\n")
        if (r90 != null && hasWord(r90)) cands.add(OcrCandidate(r90, true))
        val l270 = recognizeStrip(frame, GuideGeometry.leftStrip.toPixels(w, h), 270)
        sb?.append("L270: ${short(l270)}\n")
        if (l270 != null && hasWord(l270)) cands.add(OcrCandidate(l270, true))

        // Debug only: also read the opposite rotations for the readout (not matched).
        if (debug) {
            sb?.append("R270: ${short(recognizeStrip(frame, GuideGeometry.rightStrip.toPixels(w, h), 270))}\n")
            sb?.append("L90 : ${short(recognizeStrip(frame, GuideGeometry.leftStrip.toPixels(w, h), 90))}\n")
        }
        return Extraction(cands, sb?.toString() ?: "")
    }

    private fun short(s: String?): String = (s ?: "—").replace('\n', ' ').take(26)

    private fun hasWord(s: String): Boolean = s.count { it.isLetter() } >= 4

    private suspend fun recognizeStrip(frame: Bitmap, rect: Rect, rotation: Int): String? {
        val x = rect.left.coerceIn(0, frame.width - 1)
        val y = rect.top.coerceIn(0, frame.height - 1)
        val cw = rect.width().coerceIn(1, frame.width - x)
        val ch = rect.height().coerceIn(1, frame.height - y)
        if (cw < 12 || ch < 12) return null

        var strip = Bitmap.createBitmap(frame, x, y, cw, ch)
        // Upscale so the (often rotated) name clears ML Kit's char-height floor. The
        // small side is the text height - for a vertical site strip that's the width.
        val small = minOf(cw, ch)
        val scale = (340f / small).coerceIn(1f, 2.5f)
        if (scale > 1.01f) {
            val scaled = Bitmap.createScaledBitmap(strip, (cw * scale).toInt(), (ch * scale).toInt(), true)
            if (scaled !== strip) strip.recycle()
            strip = scaled
        }
        val text = recognize(strip, rotation)
        strip.recycle()
        return TextParser.text(text)
    }

    private suspend fun recognize(bitmap: Bitmap, rotationDegrees: Int): Text? =
        suspendCancellableCoroutine { cont ->
            recognizer.process(InputImage.fromBitmap(bitmap, rotationDegrees))
                .addOnSuccessListener { if (cont.isActive) cont.resume(it) }
                .addOnFailureListener { if (cont.isActive) cont.resume(null) }
        }
}
