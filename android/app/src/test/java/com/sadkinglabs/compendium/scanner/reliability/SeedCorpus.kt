package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.match.CardRef
import com.sadkinglabs.compendium.scanner.model.SetRef

/**
 * The frozen seed corpus (version "seed-v1") for off-device verification of the reliability harness.
 * These are SYNTHETIC reading sequences chosen to exercise the metrics and pin the current-behaviour
 * baseline; real device-captured readings extend the corpus in the same shape (and bump the version).
 * A tiny fixture catalog stands in for the ~1,100-card catalog that the on-device harness uses live.
 */
object SeedCorpus {

    fun catalog(): List<CardRef> = listOf(
        CardRef("smite", "Smite", isSite = false),
        CardRef("flame", "Flame", isSite = false),
        CardRef("flare", "Flare", isSite = false),                 // similar-name pair with Flame
        CardRef("haystack", "Haystack", isSite = true),
        CardRef("dragon", "Dragon Mage", isSite = false, sets = listOf(SetRef("Alpha", "001"), SetRef("Beta", "002"))),
    )

    fun classOf(cardId: String): CardClass? = catalog().firstOrNull { it.id == cardId }
        ?.let { if (it.isSite) CardClass.SITE else CardClass.SPELL }

    private fun steady(text: String, site: Boolean, times: List<Long>) =
        times.map { Frame(it, Reading(text, site)) }

    private val T = listOf(0L, 150L, 300L, 450L)   // 4 frames, crosses the 350ms confirm window

    fun corpus() = Corpus(
        version = "seed-v1",
        cases = listOf(
            CorpusCase("spell_smite", Category.SPELL, steady("Smite", false, T), Expected.Identity("smite")),
            // A site's edge OCR is "artist credit + NAME + rules"; the matcher's site sliding-window
            // must find the name mid-string.
            CorpusCase("site_haystack", Category.SITE_RIGHT, steady("Art Drew Tucker Haystack", true, T), Expected.Identity("haystack")),
            CorpusCase("similar_flame", Category.SIMILAR_NAME, steady("Flame", false, T), Expected.Identity("flame")),
            // NEGATIVE baseline: the bare type word "Site" must NOT become a card. The CURRENT
            // name-level matcher false-locks it to "Smite" (this is what Step 4's class policy fixes).
            CorpusCase("type_word_site", Category.NON_CARD_TEXT, steady("site", true, T), Expected.NoLock),
            CorpusCase("empty", Category.EMPTY, listOf(0L, 150L, 300L, 450L, 600L).map { Frame(it, null) }, Expected.NoLock),
            CorpusCase("non_card_text", Category.NON_CARD_TEXT, steady("collector illus reserved", false, T), Expected.NoLock),
            // OCR dropout while the card is still present. NOTE: the CURRENT reducer resets confirmation
            // on a null frame, so this MISSES today - evidence that Step 4 needs dropout-tolerant confirmation.
            CorpusCase(
                "dropout_while_present", Category.DROPOUT_WHILE_PRESENT,
                listOf(
                    Frame(0, Reading("Smite", false)), Frame(150, null),
                    Frame(300, Reading("Smite", false)), Frame(450, Reading("Smite", false)), Frame(600, Reading("Smite", false)),
                ),
                Expected.Identity("smite"),
            ),
        ),
    )
}
