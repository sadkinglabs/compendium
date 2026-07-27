package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.match.CardRef
import com.sadkinglabs.compendium.scanner.model.SetRef
import com.sadkinglabs.compendium.scanner.model.Source
import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate

/**
 * The frozen seed corpus (version "seed-v2", envelope v2) for off-device verification of the harness.
 * SYNTHETIC observation sequences chosen to exercise the metrics + pin the current-behaviour baseline;
 * real device captures extend it in the same shape (and bump the version). A 5-card fixture catalog
 * stands in for the live ~1,100-card catalog the on-device harness uses.
 */
object SeedCorpus {

    fun catalog(): List<CardRef> = listOf(
        CardRef("smite", "Smite", isSite = false),
        CardRef("flame", "Flame", isSite = false),
        CardRef("flare", "Flare", isSite = false),                 // similar-name pair with Flame
        CardRef("haystack", "Haystack", isSite = true),
        CardRef("dragon", "Dragon Mage", isSite = false, sets = listOf(SetRef("Alpha", "001"), SetRef("Beta", "002"))),
    )

    private val T = listOf(0L, 150L, 300L, 450L)   // 4 frames, crosses the 350ms confirm window
    private fun top(text: String) = OcrCandidate(text, Source.TOP)
    private fun right(text: String) = OcrCandidate(text, Source.RIGHT_90)
    private fun left(text: String) = OcrCandidate(text, Source.LEFT_270)
    private fun steady(strips: List<OcrCandidate>, qr: String? = null, times: List<Long> = T) =
        times.map { FrameObservation(it, strips, qr) }

    private const val DECK_QR = "compendium://deck/AbC123"

    fun corpus() = Corpus(
        version = "seed-v2",
        cases = listOf(
            CorpusCase("spell_smite", Category.SPELL, steady(listOf(top("Smite"))), Expected.Identity("smite")),
            CorpusCase("site_haystack_right", Category.SITE_RIGHT, steady(listOf(right("Art Drew Tucker Haystack"))), Expected.Identity("haystack")),
            CorpusCase("site_haystack_left", Category.SITE_LEFT, steady(listOf(left("Haystack Drew Tucker Art"))), Expected.Identity("haystack")),
            CorpusCase("similar_flame", Category.SIMILAR_NAME, steady(listOf(top("Flame"))), Expected.Identity("flame")),
            CorpusCase("multi_set_dragon", Category.MULTI_SET, steady(listOf(top("Dragon Mage"))), Expected.Identity("dragon")),
            // Noisy winner that still clears threshold AND the ambiguity margin.
            CorpusCase("noisy_winner_flamme", Category.SIMILAR_NAME, steady(listOf(top("Flamme"))), Expected.Identity("flame")),
            // A close pair the margin guard must REJECT (equidistant Flame/Flare).
            CorpusCase("ambiguous_flae", Category.SIMILAR_NAME, steady(listOf(top("Flae"))), Expected.NoLock),
            // NEGATIVE baseline: the bare type word "Site" must NOT become a card. The current name-level
            // matcher false-locks it to "Smite" (Step 4's class policy fixes this).
            CorpusCase("type_word_site", Category.NON_CARD_TEXT, steady(listOf(right("site"))), Expected.NoLock),
            CorpusCase("empty", Category.EMPTY, steady(emptyList(), times = listOf(0L, 150L, 300L, 450L, 600L)), Expected.NoLock),
            CorpusCase("non_card_text", Category.NON_CARD_TEXT, steady(listOf(top("collector illus reserved"))), Expected.NoLock),
            // OCR dropout while the card is present: the blank frame is HELD within the confirmation
            // gap (dropout-tolerant confirmation), so this locks to smite at 450ms.
            CorpusCase(
                "dropout_while_present", Category.DROPOUT_WHILE_PRESENT,
                listOf(
                    FrameObservation(0, listOf(top("Smite"))), FrameObservation(150, emptyList()),
                    FrameObservation(300, listOf(top("Smite"))), FrameObservation(450, listOf(top("Smite"))), FrameObservation(600, listOf(top("Smite"))),
                ),
                Expected.Identity("smite"),
            ),
            // QR precedes OCR: a QR-only frame and a QR-next-to-a-card frame must NOT lock a card.
            CorpusCase("qr_only", Category.QR_ONLY, steady(emptyList(), qr = DECK_QR), Expected.NoLock),
            CorpusCase("qr_near_card", Category.QR_NEAR_CARD, steady(listOf(top("Smite")), qr = DECK_QR), Expected.NoLock),
            // QR is TERMINAL: a QR frame FOLLOWED by confirmable card-only frames must still not lock
            // the card (production freezes on the QR). Regression for the old "keep replaying" bug.
            CorpusCase(
                "qr_then_card", Category.QR_NEAR_CARD,
                listOf(
                    FrameObservation(0, emptyList(), qr = DECK_QR),
                    FrameObservation(150, listOf(top("Smite"))), FrameObservation(300, listOf(top("Smite"))),
                    FrameObservation(450, listOf(top("Smite"))), FrameObservation(600, listOf(top("Smite"))),
                ),
                Expected.NoLock,
            ),
            // Competing strips in ONE frame: a noisy TOP (weakly ~Smite) vs a strong site edge. The
            // higher score (the site) must win, with its Source preserved (asserted in FrameSelectorTest).
            CorpusCase("multi_strip_site_over_noisy_top", Category.SITE_RIGHT, steady(listOf(top("smitey"), right("Haystack"))), Expected.Identity("haystack")),
        ),
    )

    fun spec() = RunSpec(catalog = catalog())   // default NameLevelPolicy (id "name-level")
}
