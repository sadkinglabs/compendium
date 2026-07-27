package com.sadkinglabs.compendium.scanner.ocr

import com.google.mlkit.vision.text.Text
import com.sadkinglabs.compendium.scanner.model.Source

/** A raw OCR candidate: the joined strip text + the EXACT strip it came from (TOP banner, or a
 *  rotated site edge). Carrying the exact [Source] (not a collapsed isSite) is what lets the
 *  reliability harness reproduce production's per-strip evidence and lets Step 4 weight by source. */
data class OcrCandidate(val text: String, val source: Source)

object TextParser {
    /** Concatenate a strip's lines in reading order (top-to-bottom, left-to-right). The
     *  card name is the leading run, so prefix-matching recovers it even when a site's
     *  rules text follows on the same strip. */
    fun text(t: Text?): String? {
        if (t == null) return null
        val lines = t.textBlocks.flatMap { it.lines }
        if (lines.isEmpty()) return null
        val s = lines
            .sortedWith(compareBy({ it.boundingBox?.top ?: 0 }, { it.boundingBox?.left ?: 0 }))
            .joinToString(" ") { it.text }
            .trim()
        return s.ifBlank { null }
    }
}
