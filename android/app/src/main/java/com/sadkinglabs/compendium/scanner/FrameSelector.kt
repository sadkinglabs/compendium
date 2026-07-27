package com.sadkinglabs.compendium.scanner

import com.sadkinglabs.compendium.scanner.match.MatchResult
import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.match.Norm
import com.sadkinglabs.compendium.scanner.model.Source
import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate

/**
 * The ONE place a frame's strip readings are turned into a chosen card candidate. Both
 * [ScannerViewModel] (production) and the reliability replay harness call this, so a policy that
 * passes the harness behaves identically on-device (the harness cannot silently diverge).
 *
 * Today it maps each reading's [Source] to the matcher's `siteDetected` (TOP = standard, the two
 * rotated edges = site) and takes the best-scoring reading, preserving current behaviour. Step 4
 * evolves THIS function with source-weighted scoring - and both callers get it for free. QR precedes
 * OCR; the caller checks [isCompendiumLink] first and only reaches selectCard when there is no link.
 */
object FrameSelector {

    /** The winning match plus the exact strip [Source] it came from (kept for Step-4 weighting). */
    data class Selected(val match: MatchResult, val source: Source)

    fun selectCard(candidates: List<OcrCandidate>, matcher: Matcher): Selected? {
        var best: Selected? = null
        var bestScore = -1.0
        for (c in candidates) {
            val siteDetected = c.source != Source.TOP
            val m = matcher.match(Norm.normalize(c.text), siteDetected) ?: continue
            if (m.score > bestScore) { bestScore = m.score; best = Selected(m, c.source) }
        }
        return best
    }

    /** A recognised shared-content QR that TERMINATES scanning - exactly what production locks on in
     *  ScannerViewModel.onLink (a compendium deck/match link). Shared by onLink and the harness so the
     *  two normalise identically (trim + these prefixes); a `compendium://` url that is neither is not
     *  terminal in either. */
    fun isCompendiumLink(qr: String?): Boolean {
        val u = qr?.trim() ?: return false
        return u.startsWith("compendium://deck", ignoreCase = true) ||
            u.startsWith("compendium://match", ignoreCase = true)
    }
}
