package com.sadkinglabs.compendium.scanner

import com.sadkinglabs.compendium.scanner.match.CardIndex
import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.model.Source
import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate
import com.sadkinglabs.compendium.scanner.reliability.SeedCorpus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The shared selection used by BOTH ScannerViewModel and the reliability harness. */
class FrameSelectorTest {

    private val matcher = Matcher(CardIndex(SeedCorpus.catalog()))

    @Test fun competing_strips_pick_the_higher_score_and_preserve_source() {
        // A noisy TOP that weakly resembles "Smite" vs a strong site-edge "Haystack".
        val sel = FrameSelector.selectCard(
            listOf(OcrCandidate("smitey", Source.TOP), OcrCandidate("Haystack", Source.RIGHT_90)),
            matcher,
        )
        assertEquals("haystack", sel!!.match.card.id)
        assertEquals(Source.RIGHT_90, sel.source)   // the WINNING strip's exact source is preserved
    }

    @Test fun a_top_reading_selects_a_spell_and_keeps_top_source() {
        val sel = FrameSelector.selectCard(listOf(OcrCandidate("Smite", Source.TOP)), matcher)
        assertEquals("smite", sel!!.match.card.id)
        assertEquals(Source.TOP, sel.source)
    }

    @Test fun no_confident_strip_yields_null() {
        assertNull(FrameSelector.selectCard(listOf(OcrCandidate("zzz qqq wwww", Source.TOP)), matcher))
        assertNull(FrameSelector.selectCard(emptyList(), matcher))
    }
}
