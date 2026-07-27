package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.match.CardIndex
import com.sadkinglabs.compendium.scanner.match.Matcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the reworked reliability harness on the frozen seed corpus (envelope v2): the shared
 * FrameSelector path, QR-precedes-OCR, ambiguity-margin handling, fail-closed validation, and the
 * reproducible report metadata. Two cases pin the current-behaviour baseline that motivates Step 4.
 */
class ReplayHarnessTest {

    private val catalog = SeedCorpus.catalog()
    private val matcher = Matcher(CardIndex(catalog))
    private val corpus = SeedCorpus.corpus()

    private fun lock(id: String) = ReplayHarness.replay(corpus.cases.first { it.id == id }, matcher)

    @Test fun spell_site_and_multiset_confirm() {
        assertEquals("smite", lock("spell_smite").lockedId)
        assertEquals(450L, lock("spell_smite").lockLatencyMs)
        assertEquals("haystack", lock("site_haystack_right").lockedId)   // name found mid-strip (right edge)
        assertEquals("haystack", lock("site_haystack_left").lockedId)    // ...and left edge
        assertEquals("dragon", lock("multi_set_dragon").lockedId)
    }

    @Test fun ambiguity_margin_accepts_a_noisy_winner_and_rejects_a_close_pair() {
        assertEquals("flame", lock("similar_flame").lockedId)
        assertEquals("flame", lock("noisy_winner_flamme").lockedId)      // clears threshold + margin
        assertNull("equidistant Flame/Flare is rejected", lock("ambiguous_flae").lockedId)
    }

    @Test fun qr_precedes_ocr_so_no_card_locks() {
        assertNull(lock("qr_only").lockedId)
        assertNull("a QR beside a card still suppresses the card path", lock("qr_near_card").lockedId)
    }

    @Test fun empty_and_non_card_text_never_lock() {
        assertNull(lock("empty").lockedId)
        assertNull(lock("non_card_text").lockedId)
    }

    @Test fun baseline_current_matcher_false_locks_site_to_smite() {
        assertEquals("smite", lock("type_word_site").lockedId)   // documents the pre-Step-4 defect
    }

    @Test fun baseline_a_dropout_frame_defeats_current_confirmation() {
        assertNull(lock("dropout_while_present").lockedId)       // Step 4 must tolerate dropouts
    }

    @Test fun report_records_metadata_and_denominators() {
        val r = ReplayHarness.report(corpus, matcher, catalog, SeedCorpus.meta())
        assertEquals("seed-v2", r.corpusVersion)
        assertEquals(64, r.corpusDigest.length)          // sha-256 hex
        assertEquals(64, r.catalogDigest.length)
        assertEquals(5, r.catalogSize)
        assertEquals("name-level-baseline", r.policyMode)
        assertNull(r.deviceBuild)
        assertTrue(r.coverage.contains(Category.QR_ONLY) && r.coverage.contains(Category.SIMILAR_NAME))
        assertEquals(6, r.negativeCount)                 // ambiguous_flae, type_word_site, empty, non_card, qr_only, qr_near_card
        assertEquals(1, r.negativeFalseLocks)            // only site->Smite
        assertEquals(1.0, r.perClass[CardClass.SITE]!!.recall, 0.001)   // both haystack cases lock
        assertTrue(r.latencyP50Ms != null)
    }

    @Test fun report_is_fail_closed_on_an_unknown_expected_identity() {
        val bad = corpus.copy(cases = corpus.cases + CorpusCase(
            "ghost", Category.SPELL, listOf(FrameObservation(0, emptyList())), Expected.Identity("does-not-exist"),
        ))
        assertThrows(IllegalStateException::class.java) {
            ReplayHarness.report(bad, matcher, catalog, SeedCorpus.meta())
        }
    }

    @Test fun corpus_digest_is_deterministic_and_drift_sensitive() {
        val a = CorpusValidator.corpusDigest(corpus)
        assertEquals(a, CorpusValidator.corpusDigest(corpus))        // deterministic
        val drifted = corpus.copy(cases = corpus.cases.dropLast(1))   // a change (without a version bump)
        assertNotEquals("digest must change when contents drift", a, CorpusValidator.corpusDigest(drifted))
    }
}
