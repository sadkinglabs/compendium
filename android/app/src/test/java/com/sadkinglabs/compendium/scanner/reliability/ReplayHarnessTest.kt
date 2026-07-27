package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.match.CardIndex
import com.sadkinglabs.compendium.scanner.match.Matcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Verifies the reliability harness end to end on the frozen seed corpus, and pins the current-
 * behaviour baseline (the two failures below are the evidence that motivates Step 4).
 */
class ReplayHarnessTest {

    private val catalog = SeedCorpus.catalog()
    private val matcher = Matcher(CardIndex(catalog))
    private val corpus = SeedCorpus.corpus()

    private fun outcome(id: String) =
        ReplayHarness.replay(corpus.cases.first { it.id == id }, matcher)

    @Test fun a_spell_confirms_and_reports_lock_latency() {
        val o = outcome("spell_smite")
        assertEquals("smite", o.lockedId)
        assertEquals(450L, o.lockLatencyMs)   // locked on the 4th frame (obs>=3 AND elapsed>=350ms)
    }

    @Test fun a_site_name_is_found_mid_strip_by_the_sliding_window() {
        assertEquals("haystack", outcome("site_haystack").lockedId)
    }

    @Test fun a_similar_name_resolves_by_the_ambiguity_margin() {
        assertEquals("flame", outcome("similar_flame").lockedId)   // Flame beats Flare
    }

    @Test fun empty_and_non_card_text_never_lock() {
        assertNull(outcome("empty").lockedId)
        assertNull(outcome("non_card_text").lockedId)
    }

    @Test fun baseline_current_matcher_false_locks_site_to_smite() {
        // Documents the pre-Step-4 defect the class policy must fix.
        assertEquals("smite", outcome("type_word_site").lockedId)
    }

    @Test fun baseline_a_dropout_frame_defeats_current_confirmation() {
        // Documents that Step 4 must make confirmation tolerant of transient OCR dropouts.
        assertNull(outcome("dropout_while_present").lockedId)
    }

    @Test fun report_aggregates_the_required_metrics() {
        val r = ReplayHarness.report(corpus, matcher, SeedCorpus::classOf)
        assertEquals("seed-v1", r.version)
        assertEquals(7, r.total)
        assertEquals(5, r.correct)                 // 3 identity-correct + 2 correct negatives
        assertEquals(1, r.misses)                  // the dropout case
        assertEquals(1, r.falseLocks)              // site->Smite
        assertEquals(3, r.negativeCount)
        assertEquals(1, r.negativeFalseLocks)
        assertEquals(1.0 / 3, r.negativeFalseLockRate, 0.001)
        assertEquals(1.0, r.perClass[CardClass.SITE]!!.recall, 0.001)
        assertEquals(2.0 / 3, r.perClass[CardClass.SPELL]!!.recall, 0.001)   // smite + flame ok, dropout missed
        assertEquals(2.0 / 3, r.perClass[CardClass.SPELL]!!.precision, 0.001) // smite, flame correct of {smite, flame, site->smite}
        assertEquals(450L, r.latencyP50Ms)
    }
}
