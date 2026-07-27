package com.sadkinglabs.compendium.scanner

import com.sadkinglabs.compendium.scanner.match.MatchResult
import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.match.Norm
import com.sadkinglabs.compendium.scanner.model.Source
import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate

/**
 * How a frame's strip readings become a chosen card candidate. Consumed by [FrameSelector.selectCard]
 * and pinned into reliability reports, so a report's policy identity reflects the behaviour that
 * ACTUALLY executed - not a free-form label. Step 4 adds source-weighted / class-excluding variants;
 * [NameLevelPolicy] is the Phase-2a baseline.
 */
interface SelectionPolicy {
    val id: String
    /** Whether a reading from [source] is eligible to be selected at all. */
    fun eligible(source: Source): Boolean
}

/** Baseline: every strip is eligible; the best matcher score wins (Source maps to the matcher's
 *  `siteDetected`). No source weighting or class exclusion yet. */
object NameLevelPolicy : SelectionPolicy {
    override val id = "name-level"
    override fun eligible(source: Source) = true
}

/**
 * The ONE place a frame's strip readings are turned into a chosen card candidate. Both
 * [ScannerViewModel] (production) and the reliability replay harness call this with the SAME
 * [SelectionPolicy], so a policy that passes the harness behaves identically on-device and a report
 * cannot claim a policy that did not execute.
 */
object FrameSelector {

    /** The winning match plus the exact strip [Source] it came from (kept for Step-4 weighting). */
    data class Selected(val match: MatchResult, val source: Source)

    fun selectCard(candidates: List<OcrCandidate>, matcher: Matcher, policy: SelectionPolicy = NameLevelPolicy): Selected? {
        var best: Selected? = null
        var bestScore = -1.0
        for (c in candidates) {
            if (!policy.eligible(c.source)) continue
            val siteDetected = c.source != Source.TOP
            val m = matcher.match(Norm.normalize(c.text), siteDetected) ?: continue
            if (m.score > bestScore) { bestScore = m.score; best = Selected(m, c.source) }
        }
        return best
    }
}
